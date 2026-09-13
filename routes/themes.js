// 主题系统：用户可编写/修改 CSS 主题，所有登录用户可用
const db = require('../lib/db');
const { send, requireLogin } = require('../lib/respond');

const MAX_CSS = 20000; // 20KB 上限

module.exports.register = (router) => {
  // 主题列表（含预置与用户主题）
  router.get('/api/themes', (ctx) => {
    send(ctx, 200, {
      themes: db.get('themes').map((t) => ({
        id: t.id, name: t.name, authorId: t.authorId,
        isDefault: !!t.isDefault, css: t.css, updatedAt: t.updatedAt || null,
      })),
    });
  });

  // 创建主题
  router.post('/api/themes', (ctx) => {
    if (!requireLogin(ctx)) return;
    const { name, css } = ctx.body;
    if (!name || !String(name).trim()) return send(ctx, 400, { error: '需要主题名' });
    if (String(css || '').length > MAX_CSS) return send(ctx, 400, { error: `CSS 超过 ${MAX_CSS} 字符上限` });
    const theme = db.insert('themes', {
      name: String(name).trim().slice(0, 50),
      css: String(css || ''),
      authorId: ctx.user.userId,
      isDefault: false,
      updatedAt: new Date().toISOString(),
    });
    send(ctx, 201, { theme });
  });

  // 修改主题（仅作者本人，预置主题不可改）
  router.put('/api/themes/:id', (ctx) => {
    if (!requireLogin(ctx)) return;
    const t = db.find('themes', (x) => x.id === Number(ctx.params.id));
    if (!t) return send(ctx, 404, { error: '主题不存在' });
    if (t.isDefault) return send(ctx, 403, { error: '预置主题不可修改，可复制后编辑' });
    if (t.authorId !== ctx.user.userId) return send(ctx, 403, { error: '只能修改自己的主题' });
    const { name, css } = ctx.body;
    if (css !== undefined && String(css).length > MAX_CSS) return send(ctx, 400, { error: `CSS 超过 ${MAX_CSS} 字符上限` });
    db.update('themes', t.id, {
      name: name !== undefined ? String(name).trim().slice(0, 50) || t.name : t.name,
      css: css !== undefined ? String(css) : t.css,
      updatedAt: new Date().toISOString(),
    });
    send(ctx, 200, { theme: db.find('themes', (x) => x.id === t.id) });
  });

  // 删除主题（仅作者本人，预置不可删）
  router.delete('/api/themes/:id', (ctx) => {
    if (!requireLogin(ctx)) return;
    const t = db.find('themes', (x) => x.id === Number(ctx.params.id));
    if (!t) return send(ctx, 404, { error: '主题不存在' });
    if (t.isDefault) return send(ctx, 403, { error: '预置主题不可删除' });
    if (t.authorId !== ctx.user.userId) return send(ctx, 403, { error: '只能删除自己的主题' });
    db.remove('themes', t.id);
    send(ctx, 200, { ok: true });
  });
};
