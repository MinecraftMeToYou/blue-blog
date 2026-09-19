// 端到端测试：SMTP 验证 / 短信验证 / QQ 绑定 / 邀请码 / 信任等级
const http = require('http');
const net = require('net');
const BASE = 'http://localhost:3000';
let cookie = '';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', cookie },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function login(u, p) { await api('/api/login', { method: 'POST', body: { username: u, password: p } }); }
async function logout() { await api('/api/logout', { method: 'POST' }); }

const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

// --- Mock SMTP 服务器（无认证、明文） ---
let smtpMail = '';
const smtpMock = net.createServer((s) => {
  s.write('220 mock ESMTP\r\n');
  let buf = '';
  let inData = false;
  s.on('data', (c) => {
    buf += c.toString();
    let idx;
    while ((idx = buf.indexOf('\r\n')) !== -1) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
      if (inData) {
        if (line === '.') { inData = false; s.write('250 OK queued\r\n'); }
        else smtpMail += line + '\n';
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO')) s.write('250-mock\r\n250 8BITMIME\r\n');
      else if (cmd.startsWith('MAIL FROM') || cmd.startsWith('RCPT TO')) s.write('250 OK\r\n');
      else if (cmd.startsWith('DATA')) { inData = true; smtpMail = ''; s.write('354 go\r\n'); }
      else if (cmd.startsWith('QUIT')) { s.write('221 bye\r\n'); s.end(); }
      else s.write('250 OK\r\n');
    }
  });
});

// --- Mock 短信 webhook ---
let lastSms = null;
const smsMock = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => { lastSms = JSON.parse(b); res.writeHead(200); res.end('ok'); });
});

(async () => {
  await new Promise((r) => smtpMock.listen(19876, r));
  await new Promise((r) => smsMock.listen(19877, r));

  // 管理员配置
  await login('admin', 'admin123');
  // 幂等清理：上次运行可能残留测试用户/邀请码
  let us = (await api('/api/admin/users')).data.users;
  for (const name of ['vuser', 'vuser2']) {
    const u = us.find((x) => x.username === name);
    if (u) await api('/api/admin/users/' + u.id, { method: 'DELETE' });
  }
  for (const i of (await api('/api/admin/invites')).data.invites) {
    await api('/api/admin/invites/' + i.id, { method: 'DELETE' });
  }
  let r = await api('/api/admin/settings', {
    method: 'PUT',
    body: {
      smtp: { host: '127.0.0.1', port: 19876, secure: false, user: '', pass: '', from: 'blog@test.dev' },
      sms_webhook: 'http://127.0.0.1:19877/sms',
      reg: { requireInvite: true, verifyEmail: true, verifyPhone: true, qqBind: true },
    },
  });
  check('保存 SMTP/短信/注册开关', r.status === 200);
  r = await api('/api/site');
  check('注册开关公开到 /api/site', r.data.reg.requireInvite === true && r.data.reg.verifyEmail === true);

  // 邀请码
  r = await api('/api/admin/invites', { method: 'POST', body: { count: 2, maxUses: 1, days: 7 } });
  const inv = r.data.invites[0];
  check('生成邀请码', r.status === 201 && inv.code.length === 8);

  // ---- 注册流程 ----
  await logout();
  r = await api('/api/register', { method: 'POST', body: { username: 'vuser', password: 'pass123', email: 'vuser@test.dev', phone: '13800138000' } });
  check('无邀请码注册被拒', r.status === 400, r.data.error || '');
  r = await api('/api/register', { method: 'POST', body: { username: 'vuser', password: 'pass123', email: 'vuser@test.dev', phone: '13800138000', invite: 'WRONGCOD' } });
  check('错误邀请码被拒', r.status === 400);
  r = await api('/api/register', { method: 'POST', body: { username: 'vuser', password: 'pass123', email: 'vuser@test.dev', phone: '13800138000', invite: inv.code } });
  check('带邀请码注册成功', r.status === 201, JSON.stringify(r.data.notices || []));
  check('SMTP 收到验证邮件', smtpMail.includes('vuser@test.dev') && smtpMail.includes('Subject: =?UTF-8?B?'));
  const mailB64 = smtpMail.split('Content-Transfer-Encoding: base64\n\n')[1];
  const mailText = Buffer.from((mailB64 || '').replace(/\s+/g, ''), 'base64').toString();
  const emailCode = mailText.match(/(\d{6})/)[1];
  check('邮件中包含 6 位验证码', /^\d{6}$/.test(emailCode), emailCode);
  check('短信 webhook 收到验证码', lastSms && lastSms.phone === '13800138000' && /^\d{6}$/.test(lastSms.code));

  // 未验证时发帖被门禁拦截
  r = await api('/api/posts', { method: 'POST', body: { title: 'T', content: 'c' } });
  check('未验证发帖被拦截', r.status === 403, r.data.error || '');
  r = await api('/api/shop/1/buy', { method: 'POST' });
  check('未验证购买被拦截', r.status === 403);

  // 邮箱验证
  r = await api('/api/verify/email/confirm', { method: 'POST', body: { code: '000000' } });
  check('错误验证码被拒', r.status === 400);
  r = await api('/api/verify/email/confirm', { method: 'POST', body: { code: emailCode } });
  check('邮箱验证成功', r.status === 200 && r.data.user.emailVerified === true);

  // 手机验证
  const phoneCode = lastSms.code;
  r = await api('/api/verify/phone/confirm', { method: 'POST', body: { code: phoneCode } });
  check('手机验证成功', r.status === 200 && r.data.user.phoneVerified === true);

  // QQ 绑定
  r = await api('/api/profile/qq', { method: 'PUT', body: { qq: '123456789' } });
  check('QQ 绑定成功', r.status === 200 && r.data.user.qq === '123456789');
  r = await api('/api/profile/qq', { method: 'PUT', body: { qq: 'abcd' } });
  check('非法 QQ 被拒', r.status === 400);

  // 验证后可以发帖
  r = await api('/api/posts', { method: 'POST', body: { title: 'VerifyPost', content: 'x' } });
  check('验证后发帖成功', r.status === 201);
  const postId = r.data.post.id;
  r = await api(`/api/posts/${postId}/comments`, { method: 'POST', body: { content: 'self comment' } });
  check('验证后评论成功', r.status === 201);

  // 邀请码次数耗尽
  await logout();
  r = await api('/api/register', { method: 'POST', body: { username: 'vuser2', password: 'pass123', email: 'v2@test.dev', phone: '13900139000', invite: inv.code } });
  check('邀请码用完被拒', r.status === 400, r.data.error || '');

  // ---- 等级 ----
  await login('admin', 'admin123');
  const users = (await api('/api/admin/users')).data.users;
  const vu = users.find((u) => u.username === 'vuser');
  check('用户列表含联系方式与等级', !!vu && vu.emailVerified === true && vu.phoneVerified === true && vu.qq === '123456789' && typeof vu.level === 'number');
  r = await api('/api/admin/users/' + vu.id, { method: 'PUT', body: { level: 4 } });
  check('管理员手动授予 L4', r.status === 200);
  await logout(); await login('vuser', 'pass123');
  r = await api('/api/me');
  check('等级生效为 L4', r.data.user.level === 4, 'level=' + r.data.user.level);

  // 评论里带等级
  r = await api(`/api/posts/${postId}`);
  check('评论含用户等级', r.data.comments.every((c) => typeof c.userLevel === 'number'));

  // ---- 清理 ----
  await logout(); await login('admin', 'admin123');
  await api('/api/admin/posts/' + postId, { method: 'DELETE' });
  for (const name of ['vuser', 'vuser2']) {
    const us = (await api('/api/admin/users')).data.users;
    const u = us.find((x) => x.username === name);
    if (u) await api('/api/admin/users/' + u.id, { method: 'DELETE' });
  }
  const invites = (await api('/api/admin/invites')).data.invites;
  for (const i of invites) await api('/api/admin/invites/' + i.id, { method: 'DELETE' });
  await api('/api/admin/settings', { method: 'PUT', body: { reg: { requireInvite: false, verifyEmail: false, verifyPhone: false, qqBind: true }, sms_webhook: '' } });
  const admin = (await api('/api/admin/users')).data.users.find((u) => u.username === 'admin');
  if (admin) await api('/api/admin/users/' + admin.id, { method: 'PUT', body: { coins: 999 } });

  smtpMock.close(); smsMock.close();
  console.log(results.join('\n'));
  process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
