// 管理后台 API：管理员可管理所有文章、评论、用户、商品
const db = require('../lib/db');
const { hashPassword } = require('../lib/passwords');
const { send, requireAdmin } = require('../lib/respond');
const lotteryMod = require('./lottery');

module.exports.register = (router) => {
  // 概览统计
  router.get('/api/admin/stats', (ctx) => {
    if (!requireAdmin(ctx)) return;
    send(ctx, 200, {
      posts: db.get('posts').length,
      comments: db.get('comments').length,
      users: db.get('users').length,
      orders: db.get('purchases').length,
      shopItems: db.get('shopItems').length,
    });
  });

  // ---- 用户管理 ----
  router.get('/api/admin/users', (ctx) => {
    if (!requireAdmin(ctx)) return;
    send(ctx, 200, {
      users: db.get('users').map((u) => ({
        id: u.id, username: u.username, coins: u.coins,
        title: u.title || '', role: u.role || 'user', createdAt: u.createdAt,
      })),
    });
  });

  // 修改用户：金币 / 头衔 / 密码 / 角色
  router.put('/api/admin/users/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const u = db.find('users', (x) => x.id === Number(ctx.params.id));
    if (!u) return send(ctx, 404, { error: '用户不存在' });
    const { coins, title, password, role } = ctx.body;
    const patch = {};
    if (coins !== undefined) patch.coins = Math.max(0, Number(coins) || 0);
    if (title !== undefined) patch.title = String(title);
    if (role !== undefined && u.id !== ctx.user.userId) patch.role = role === 'admin' ? 'admin' : 'user';
    if (password) {
      if (String(password).length < 6) return send(ctx, 400, { error: '密码至少 6 位' });
      Object.assign(patch, hashPassword(String(password)));
    }
    db.update('users', u.id, patch);
    send(ctx, 200, { ok: true });
  });

  // 删除用户（级联清理其文章、评论、订单）
  router.delete('/api/admin/users/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    if (id === ctx.user.userId) return send(ctx, 400, { error: '不能删除自己' });
    if (!db.find('users', (x) => x.id === id)) return send(ctx, 404, { error: '用户不存在' });
    db.filter('posts', (p) => p.authorId === id).forEach((p) => db.remove('posts', p.id));
    db.filter('comments', (c) => c.userId === id).forEach((c) => db.remove('comments', c.id));
    db.filter('purchases', (p) => p.userId === id).forEach((p) => db.remove('purchases', p.id));
    db.filter('draws', (d) => d.userId === id).forEach((d) => db.remove('draws', d.id));
    db.filter('themes', (x) => x.authorId === id && !x.isDefault).forEach((x) => db.remove('themes', x.id));
    db.filter('lotteries', (l) => l.authorId === id).forEach((l) => db.remove('lotteries', l.id));
    db.remove('users', id);
    send(ctx, 200, { ok: true });
  });

  // ---- 文章 / 评论管理（可删任何人的） ----
  // 管理员编辑任何文章
  router.put('/api/admin/posts/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const post = db.find('posts', (p) => p.id === Number(ctx.params.id));
    if (!post) return send(ctx, 404, { error: '文章不存在' });
    const { title, content, tags, category } = ctx.body;
    db.update('posts', post.id, {
      title: title !== undefined ? String(title) : post.title,
      content: content !== undefined ? String(content) : post.content,
      tags: Array.isArray(tags) ? tags.map(String)
        : tags !== undefined ? String(tags).split(/[,，\s]+/).filter(Boolean) : post.tags,
      category: category !== undefined ? String(category) : post.category,
    });
    send(ctx, 200, { ok: true });
  });

  router.delete('/api/admin/posts/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.params.id);
    if (!db.find('posts', (p) => p.id === id)) return send(ctx, 404, { error: '文章不存在' });
    db.remove('posts', id);
    db.filter('comments', (c) => c.postId === id).forEach((c) => db.remove('comments', c.id));
    const lottery = db.find('lotteries', (l) => l.postId === id);
    if (lottery) lotteryMod.refundLottery(lottery.id); // 退还未抽出的奖金
    send(ctx, 200, { ok: true });
  });

  router.delete('/api/admin/comments/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    if (!db.remove('comments', Number(ctx.params.id))) return send(ctx, 404, { error: '评论不存在' });
    send(ctx, 200, { ok: true });
  });

  // ---- 商品管理 ----
  router.post('/api/admin/shop', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const { name, desc, price } = ctx.body;
    if (!name) return send(ctx, 400, { error: '需要商品名' });
    const item = db.insert('shopItems', {
      name: String(name), desc: String(desc || ''), price: Math.max(0, Number(price) || 0),
    });
    send(ctx, 201, { item });
  });

  router.put('/api/admin/shop/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const item = db.find('shopItems', (i) => i.id === Number(ctx.params.id));
    if (!item) return send(ctx, 404, { error: '商品不存在' });
    const { name, desc, price } = ctx.body;
    db.update('shopItems', item.id, {
      name: name !== undefined ? String(name) : item.name,
      desc: desc !== undefined ? String(desc) : item.desc,
      price: price !== undefined ? Math.max(0, Number(price) || 0) : item.price,
    });
    send(ctx, 200, { ok: true });
  });

  router.delete('/api/admin/shop/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    if (!db.remove('shopItems', Number(ctx.params.id))) return send(ctx, 404, { error: '商品不存在' });
    send(ctx, 200, { ok: true });
  });

  // ---- 系统设置 ----
  router.get('/api/admin/settings', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const s = {};
    db.get('settings').forEach((row) => { s[row.key] = row.value; });
    send(ctx, 200, { settings: s });
  });

  router.put('/api/admin/settings', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const { komari_url, probe_sources } = ctx.body;

    if (komari_url !== undefined) {
      const v = String(komari_url).trim();
      if (v && !/^https?:\/\//.test(v)) return send(ctx, 400, { error: '地址需以 http:// 或 https:// 开头' });
      const existing = db.find('settings', (s) => s.key === 'komari_url');
      if (existing) db.update('settings', existing.id, { value: v });
      else db.insert('settings', { key: 'komari_url', value: v });
    }

    // 探针数据源列表（多面板：komari / nezha / serverstatus）
    if (probe_sources !== undefined) {
      if (!Array.isArray(probe_sources)) return send(ctx, 400, { error: 'probe_sources 需为数组' });
      const clean = probe_sources
        .filter((s) => s && String(s.url || '').trim())
        .map((s) => ({
          name: String(s.name || '').trim().slice(0, 50) || String(s.provider || 'komari'),
          provider: String(s.provider || 'komari').toLowerCase(),
          url: String(s.url).trim(),
          token: String(s.token || '').trim().slice(0, 200),
        }));
      for (const c of clean) {
        if (!/^https?:\/\//.test(c.url)) return send(ctx, 400, { error: `数据源 ${c.name} 的地址需以 http:// 或 https:// 开头` });
      }
      const row = db.find('settings', (s) => s.key === 'probe_sources');
      const val = JSON.stringify(clean);
      if (row) db.update('settings', row.id, { value: val });
      else db.insert('settings', { key: 'probe_sources', value: val });
    }
    send(ctx, 200, { ok: true });
  });
};
