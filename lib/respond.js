// 统一的 JSON 响应辅助函数
const db = require('./db');
const settings = require('./settings');

function send(ctx, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  ctx.res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
  ctx.res.end(body);
}

function requireLogin(ctx) {
  if (!ctx.user) {
    send(ctx, 401, { error: '请先登录' });
    return false;
  }
  return true;
}

function requireAdmin(ctx) {
  if (!requireLogin(ctx)) return false;
  const user = db.find('users', (u) => u.id === ctx.user.userId);
  if (!user || user.role !== 'admin') {
    send(ctx, 403, { error: '需要管理员权限' });
    return false;
  }
  return true;
}

// 活跃行为门禁：按后台开关要求先完成邮箱/手机验证（管理员豁免）
function requireActive(ctx) {
  if (!requireLogin(ctx)) return false;
  const user = db.find('users', (u) => u.id === ctx.user.userId);
  if (!user || user.role === 'admin') return true;
  const reg = settings.reg();
  if (reg.verifyEmail && !user.emailVerified) {
    send(ctx, 403, { error: '请先到个人设置完成邮箱验证后再进行此操作' });
    return false;
  }
  if (reg.verifyPhone && !user.phoneVerified) {
    send(ctx, 403, { error: '请先到个人设置完成手机号验证后再进行此操作' });
    return false;
  }
  return true;
}

module.exports = { send, requireLogin, requireAdmin, requireActive };
