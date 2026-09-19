// 博客核心服务器 —— 纯 Node.js，不依赖任何第三方框架
const http = require('http');
const fs = require('fs');
const path = require('path');

const { Router } = require('./lib/router');
const { Session } = require('./lib/session');
const db = require('./lib/db');
const settings = require('./lib/settings');

const auth = require('./routes/auth');
const posts = require('./routes/posts');
const comments = require('./routes/comments');
const shop = require('./routes/shop');
const minecraft = require('./routes/minecraft');
const admin = require('./routes/admin');
const lottery = require('./routes/lottery');
const themes = require('./routes/themes');
const probe = require('./routes/probe');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const router = new Router();
const session = new Session();

// ---- 注册所有路由 ----
auth.register(router, session);
posts.register(router, session);
comments.register(router, session);
shop.register(router, session);
minecraft.register(router);
admin.register(router);
lottery.register(router);
themes.register(router);
probe.register(router);

// 公开的站点信息（站名在后台「设置」里改；注册开关公开给注册表单）
router.get('/api/site', (ctx) => {
  const reg = settings.reg();
  send(ctx.res, 200, {
    name: settings.siteName(),
    reg: {
      requireInvite: reg.requireInvite,
      verifyEmail: reg.verifyEmail,
      verifyPhone: reg.verifyPhone,
      qqBind: reg.qqBind,
    },
  });
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 读取请求体（JSON）
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { // 1MB 上限
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// 解析 Cookie 头
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
  res.end(body);
}

// 静态文件服务（防目录穿越）
function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[\/\\])+/, ''));
  if (pathname === '/') filePath = path.join(PUBLIC_DIR, 'index.html');
  if (pathname === '/admin') filePath = path.join(PUBLIC_DIR, 'admin.html');
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    // 尝试匹配 API 路由
    const matched = router.match(req.method, pathname);
    if (matched) {
      const ctx = {
        req, res,
        query: Object.fromEntries(url.searchParams),
        params: matched.params,
        cookies: parseCookies(req.headers.cookie),
        body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {},
      };
      // 从会话中恢复当前用户
      ctx.user = session.get(ctx.cookies.sid);
      return await matched.handler(ctx);
    }
    // 否则当作静态文件
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message || 'internal error' });
  }
});

db.init(path.join(__dirname, 'data')).then(() => {
  session.init(); // 从数据库恢复登录会话
  server.listen(PORT, () => {
    console.log(`博客已启动: http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});
