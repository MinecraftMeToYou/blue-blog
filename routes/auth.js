// 用户注册 / 登录 / 登出 / 个人信息
const db = require('../lib/db');
const { hashPassword, verifyPassword } = require('../lib/passwords');
const { send, requireLogin } = require('../lib/respond');

function setSidCookie(ctx, token, maxAge) {
  ctx.res.setHeader('Set-Cookie',
    `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function publicUser(u) {
  return u ? { id: u.id, username: u.username, coins: u.coins, title: u.title || '', role: u.role || 'user' } : null;
}

module.exports.register = (router, session) => {
  // 注册
  router.post('/api/register', (ctx) => {
    const { username, password } = ctx.body;
    if (!username || !password) return send(ctx, 400, { error: '需要用户名和密码' });
    if (String(username).length < 2) return send(ctx, 400, { error: '用户名至少 2 个字符' });
    if (String(password).length < 6) return send(ctx, 400, { error: '密码至少 6 位' });
    if (db.find('users', (u) => u.username === username)) {
      return send(ctx, 409, { error: '用户名已存在' });
    }
    const { salt, hash } = hashPassword(String(password));
    const user = db.insert('users', {
      username: String(username),
      salt, hash,
      coins: 100,       // 注册送 100 金币，可用于商店
      title: '',
      createdAt: new Date().toISOString(),
    });
    const token = session.create(user.id);
    setSidCookie(ctx, token, 7 * 24 * 3600);
    send(ctx, 201, { user: publicUser(user) });
  });

  // 登录
  router.post('/api/login', (ctx) => {
    const { username, password } = ctx.body;
    const user = db.find('users', (u) => u.username === username);
    if (!user || !verifyPassword(String(password || ''), user.salt, user.hash)) {
      return send(ctx, 401, { error: '用户名或密码错误' });
    }
    const token = session.create(user.id);
    setSidCookie(ctx, token, 7 * 24 * 3600);
    send(ctx, 200, { user: publicUser(user) });
  });

  // 登出
  router.post('/api/logout', (ctx) => {
    session.destroy(ctx.cookies.sid);
    setSidCookie(ctx, '', 0);
    send(ctx, 200, { ok: true });
  });

  // 当前用户信息
  router.get('/api/me', (ctx) => {
    if (!requireLogin(ctx)) return;
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    send(ctx, 200, { user: publicUser(user) });
  });
};
