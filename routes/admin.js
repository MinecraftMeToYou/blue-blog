// 管理后台 API：管理员可管理所有文章、评论、用户、商品
const crypto = require('crypto');
const db = require('../lib/db');
const { hashPassword } = require('../lib/passwords');
const { send, requireAdmin } = require('../lib/respond');
const lotteryMod = require('./lottery');
const settings = require('../lib/settings');
const levels = require('../lib/levels');
const { sendMail } = require('../lib/smtp');

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

  // ---- SMTP 测试 ----
  router.post('/api/admin/test-smtp', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const cfg = settings.smtp();
    if (!cfg) return send(ctx, 400, { error: '请先保存 SMTP 配置' });
    try {
      await sendMail(cfg, {
        to: String(ctx.body.to || cfg.from),
        subject: 'blue-blog SMTP 测试',
        text: '这是一封测试邮件，收到说明 SMTP 配置成功。\n',
      });
      send(ctx, 200, { ok: true });
    } catch (e) {
      send(ctx, 502, { error: e.message });
    }
  });

  // ---- 邀请码 ----
  router.get('/api/admin/invites', (ctx) => {
    if (!requireAdmin(ctx)) return;
    send(ctx, 200, { invites: db.get('invites').slice().reverse() });
  });

  router.post('/api/admin/invites', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const count = Math.min(20, Math.max(1, Number(ctx.body.count) || 1));
    const maxUses = Math.min(999, Math.max(1, Number(ctx.body.maxUses) || 1));
    const days = Math.max(0, Number(ctx.body.days) || 0);
    const created = [];
    for (let i = 0; i < count; i++) {
      created.push(db.insert('invites', {
        code: crypto.randomBytes(4).toString('hex').toUpperCase(),
        maxUses, uses: 0,
        expiresAt: days ? Date.now() + days * 86400000 : 0,
        createdBy: ctx.user.userId,
        createdAt: new Date().toISOString(),
      }));
    }
    send(ctx, 201, { invites: created });
  });

  router.delete('/api/admin/invites/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    if (!db.remove('invites', Number(ctx.params.id))) return send(ctx, 404, { error: '邀请码不存在' });
    send(ctx, 200, { ok: true });
  });

  // ---- 用户管理 ----
  router.get('/api/admin/users', (ctx) => {
    if (!requireAdmin(ctx)) return;
    send(ctx, 200, {
      users: db.get('users').map((u) => ({
        id: u.id, username: u.username, coins: u.coins,
        title: u.title || '', role: u.role || 'user', createdAt: u.createdAt,
        level: u.level || 0, manualLevel: u.manualLevel || 0,
        email: u.email || '', emailVerified: !!u.emailVerified,
        phone: u.phone || '', phoneVerified: !!u.phoneVerified,
        qq: u.qq || '',
      })),
      levelNames: levels.LEVELS.map((l) => l.name),
    });
  });

  // 修改用户：金币 / 头衔 / 密码 / 角色 / 等级
  router.put('/api/admin/users/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const u = db.find('users', (x) => x.id === Number(ctx.params.id));
    if (!u) return send(ctx, 404, { error: '用户不存在' });
    const { coins, title, password, role, level } = ctx.body;
    const patch = {};
    if (coins !== undefined) patch.coins = Math.max(0, Number(coins) || 0);
    if (title !== undefined) patch.title = String(title);
    if (role !== undefined && u.id !== ctx.user.userId) patch.role = role === 'admin' ? 'admin' : 'user';
    if (level !== undefined) {
      const lv = Math.min(4, Math.max(0, Number(level) || 0));
      patch.manualLevel = lv;
    }
    if (password) {
      if (String(password).length < 6) return send(ctx, 400, { error: '密码至少 6 位' });
      Object.assign(patch, hashPassword(String(password)));
    }
    db.update('users', u.id, patch);
    if (level !== undefined) levels.refreshLevel(u.id);
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
        db.filter('verifications', (v) => v.userId === id).forEach((v) => db.remove('verifications', v.id));
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
    const { komari_url, probe_sources, site_name, smtp, sms_webhook, reg } = ctx.body;

    if (site_name !== undefined) {
      const v = String(site_name).trim().slice(0, 50);
      const row = db.find('settings', (s) => s.key === 'site_name');
      if (row) db.update('settings', row.id, { value: v });
      else db.insert('settings', { key: 'site_name', value: v });
    }

    // SMTP 配置 {host,port,secure,user,pass,from}
    if (smtp !== undefined) {
      if (smtp && smtp.host) {
        if (!/^https?:\/\/|^[\w.-]+$/.test(smtp.host) || !smtp.from) {
          return send(ctx, 400, { error: 'SMTP 配置不完整：需要服务器地址和发件人' });
        }
        const clean = {
          host: String(smtp.host).trim(),
          port: Number(smtp.port) || (smtp.secure ? 465 : 25),
          secure: !!smtp.secure,
          user: String(smtp.user || ''),
          pass: String(smtp.pass || ''),
          from: String(smtp.from).trim(),
        };
        settings.set('smtp', clean);
      } else {
        settings.set('smtp', {});
      }
    }

    // 短信 webhook 通道
    if (sms_webhook !== undefined) {
      const v = String(sms_webhook).trim();
      if (v && !/^https?:\/\//.test(v)) return send(ctx, 400, { error: '短信通道地址需以 http:// 或 https:// 开头' });
      settings.set('sms_webhook', v);
    }

    // 注册开关 {requireInvite,verifyEmail,verifyPhone,qqBind}
    if (reg !== undefined) {
      const cur = settings.reg();
      settings.set('reg', Object.assign(cur, {
        requireInvite: !!(reg && reg.requireInvite),
        verifyEmail: !!(reg && reg.verifyEmail),
        verifyPhone: !!(reg && reg.verifyPhone),
        qqBind: reg && reg.qqBind !== undefined ? !!reg.qqBind : cur.qqBind,
      }));
    }

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
