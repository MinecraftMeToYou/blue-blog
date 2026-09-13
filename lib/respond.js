// 统一的 JSON 响应辅助函数
const db = require('./db');

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

module.exports = { send, requireLogin, requireAdmin };
