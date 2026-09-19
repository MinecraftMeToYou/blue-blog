// 用户注册 / 登录 / 登出 / 个人信息 / 资料绑定 / 验证码
const db = require('../lib/db');
const { hashPassword, verifyPassword } = require('../lib/passwords');
const { send, requireLogin } = require('../lib/respond');
const settings = require('../lib/settings');
const { issueCode, checkCode } = require('../lib/notify');

function setSidCookie(ctx, token, maxAge) {
  ctx.res.setHeader('Set-Cookie',
    `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, coins: u.coins,
    title: u.title || '', role: u.role || 'user',
    level: u.level || 0,
  };
}

// 本人视角：含验证状态与绑定信息
function meUser(u) {
  return Object.assign(publicUser(u), {
    email: u.email || '',
    emailVerified: !!u.emailVerified,
    phone: u.phone || '',
    phoneVerified: !!u.phoneVerified,
    qq: u.qq || '',
  });
}

function isEmail(s) { return /^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(s); }
function isPhone(s) { return /^1\d{10}$/.test(s); }
function isQQ(s) { return /^[1-9]\d{4,10}$/.test(s); }

// 消费邀请码
function consumeInvite(codeStr) {
  const inv = db.find('invites', (i) => i.code === codeStr);
  if (!inv) return '邀请码无效';
  if (inv.expiresAt && Date.now() > inv.expiresAt) return '邀请码已过期';
  if (inv.uses >= inv.maxUses) return '邀请码已达使用上限';
  db.update('invites', inv.id, { uses: inv.uses + 1 });
  return null;
}

module.exports.register = (router, session) => {
  // 注册（按后台开关要求邮箱/手机/邀请码）
  router.post('/api/register', async (ctx) => {
    const reg = settings.reg();
    const { username, password, email, phone, invite } = ctx.body;
    if (!username || !password) return send(ctx, 400, { error: '需要用户名和密码' });
    if (String(username).length < 2) return send(ctx, 400, { error: '用户名至少 2 个字符' });
    if (String(password).length < 6) return send(ctx, 400, { error: '密码至少 6 位' });
    if (db.find('users', (u) => u.username === username)) {
      return send(ctx, 409, { error: '用户名已存在' });
    }
    if (reg.requireInvite) {
      const err = consumeInvite(String(invite || '').trim());
      if (err) return send(ctx, 400, { error: err });
    }
    if (reg.verifyEmail) {
      if (!email) return send(ctx, 400, { error: '需要邮箱' });
      if (!isEmail(email)) return send(ctx, 400, { error: '邮箱格式不正确' });
      if (db.find('users', (u) => u.email === email)) return send(ctx, 409, { error: '该邮箱已被绑定' });
    }
    if (reg.verifyPhone) {
      if (!phone) return send(ctx, 400, { error: '需要手机号' });
      if (!isPhone(phone)) return send(ctx, 400, { error: '手机号格式不正确' });
      if (db.find('users', (u) => u.phone === phone)) return send(ctx, 409, { error: '该手机号已被绑定' });
    }

    const { salt, hash } = hashPassword(String(password));
    const user = db.insert('users', {
      username: String(username),
      salt, hash,
      coins: 100,
      title: '',
      role: 'user',
      level: 0, manualLevel: 0,
      email: reg.verifyEmail ? String(email) : (email && isEmail(email) ? String(email) : ''),
      emailVerified: false,
      phone: reg.verifyPhone ? String(phone) : (phone && isPhone(phone) ? String(phone) : ''),
      phoneVerified: false,
      qq: '',
      createdAt: new Date().toISOString(),
    });

    // 按开关立即发送验证码（失败不阻塞注册，可稍后重发）
    const notices = [];
    if (reg.verifyEmail && user.email) {
      try { await issueCode('email', user.email, user.id, true); }
      catch (e) { notices.push('验证邮件发送失败：' + e.message); }
    }
    if (reg.verifyPhone && user.phone) {
      try { await issueCode('phone', user.phone, user.id, true); }
      catch (e) { notices.push('验证短信发送失败：' + e.message); }
    }

    const token = session.create(user.id);
    setSidCookie(ctx, token, 7 * 24 * 3600);
    send(ctx, 201, { user: meUser(user), notices });
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
    send(ctx, 200, { user: meUser(user) });
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
    send(ctx, 200, { user: meUser(user) });
  });

  // ---- 资料绑定 ----
  // QQ 绑定
  router.put('/api/profile/qq', (ctx) => {
    if (!requireLogin(ctx)) return;
    if (!settings.reg().qqBind) return send(ctx, 400, { error: '管理员未开启 QQ 绑定' });
    const qq = String(ctx.body.qq || '').trim();
    if (qq && !isQQ(qq)) return send(ctx, 400, { error: 'QQ 号格式不正确' });
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    db.update('users', user.id, { qq });
    send(ctx, 200, { ok: true, user: meUser(db.find('users', (u) => u.id === user.id)) });
  });

  // 发送邮箱验证码（可同时改绑邮箱）
  router.post('/api/verify/email/send', async (ctx) => {
    if (!requireLogin(ctx)) return;
    const reg = settings.reg();
    if (!reg.verifyEmail) return send(ctx, 400, { error: '管理员未开启邮箱验证' });
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    const email = String(ctx.body.email || user.email || '').trim();
    if (!isEmail(email)) return send(ctx, 400, { error: '邮箱格式不正确' });
    if (email !== user.email && db.find('users', (u) => u.email === email && u.id !== user.id)) {
      return send(ctx, 409, { error: '该邮箱已被其他账号绑定' });
    }
    if (email !== user.email) db.update('users', user.id, { email, emailVerified: false });
    try {
      await issueCode('email', email, user.id, true);
      send(ctx, 200, { ok: true, hint: '验证码已发送到 ' + email });
    } catch (e) {
      send(ctx, 502, { error: e.message });
    }
  });

  router.post('/api/verify/email/confirm', (ctx) => {
    if (!requireLogin(ctx)) return;
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    const err = checkCode('email', user.email, ctx.body.code, user.id);
    if (err) return send(ctx, 400, { error: err });
    db.update('users', user.id, { emailVerified: true });
    send(ctx, 200, { ok: true, user: meUser(db.find('users', (u) => u.id === user.id)) });
  });

  // 发送手机验证码（可同时改绑手机号）
  router.post('/api/verify/phone/send', async (ctx) => {
    if (!requireLogin(ctx)) return;
    const reg = settings.reg();
    if (!reg.verifyPhone && !ctx.body.phone) return send(ctx, 400, { error: '管理员未开启手机号验证' });
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    const phone = String(ctx.body.phone || user.phone || '').trim();
    if (!isPhone(phone)) return send(ctx, 400, { error: '手机号格式不正确' });
    if (phone !== user.phone && db.find('users', (u) => u.phone === phone && u.id !== user.id)) {
      return send(ctx, 409, { error: '该手机号已被其他账号绑定' });
    }
    if (phone !== user.phone) db.update('users', user.id, { phone, phoneVerified: false });
    try {
      await issueCode('phone', phone, user.id, true);
      send(ctx, 200, { ok: true, hint: '验证码已发送到 ' + phone });
    } catch (e) {
      send(ctx, 502, { error: e.message });
    }
  });

  router.post('/api/verify/phone/confirm', (ctx) => {
    if (!requireLogin(ctx)) return;
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    const err = checkCode('phone', user.phone, ctx.body.code, user.id);
    if (err) return send(ctx, 400, { error: err });
    db.update('users', user.id, { phoneVerified: true });
    send(ctx, 200, { ok: true, user: meUser(db.find('users', (u) => u.id === user.id)) });
  });
};
