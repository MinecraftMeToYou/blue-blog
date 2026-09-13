// 端到端测试：主题系统 + 探针（本地 mock komari 面板）
const http = require('http');
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

const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

// 模拟一个 komari 面板（/api/clients）
const mockKomari = http.createServer((req, res) => {
  if (req.url === '/api/clients') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      clients: [
        { name: 'Tokyo-01', status: 'online', os: 'linux', arch: 'amd64', cpu_percent: 12.5, mem_percent: 45.2, disk_percent: 60, net_in_speed: 204800, net_out_speed: 102400, uptime: 86400 * 3 },
        { name: 'US-02', status: 'offline', os: 'windows', arch: 'amd64' },
      ],
    }));
  } else { res.writeHead(404); res.end(); }
});

(async () => {
  await new Promise((r) => mockKomari.listen(18923, r));

  // ---- 探针：未配置 ----
  let r = await api('/api/probe/servers');
  check('未配置时返回提示', r.status === 200 && r.data.configured === false && r.data.hint.length > 0);

  // ---- 管理员配置 komari 地址 ----
  await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  r = await api('/api/admin/settings', { method: 'PUT', body: { komari_url: 'http://localhost:18923' } });
  check('保存探针地址', r.status === 200);
  r = await api('/api/admin/settings');
  check('读取探针地址', r.data.settings.komari_url === 'http://localhost:18923');
  r = await api('/api/admin/settings', { method: 'PUT', body: { komari_url: 'ftp://bad' } });
  check('非法地址被拒绝', r.status === 400);

  // ---- 探针：代理拉取并归一化 ----
  r = await api('/api/probe/servers');
  const s0 = r.data.servers[0], s1 = r.data.servers[1];
  check('代理返回节点', r.status === 200 && r.data.servers.length === 2);
  check('在线节点归一化', s0.name === 'Tokyo-01' && s0.online === true && s0.cpuPercent === 12.5
    && s0.memPercent === 45.2 && s0.netIn === 204800 && s0.uptime === 86400 * 3);
  check('离线节点归一化', s1.name === 'US-02' && s1.online === false);

  // 坏地址容错
  await api('/api/admin/settings', { method: 'PUT', body: { komari_url: 'http://localhost:1' } });
  r = await api('/api/probe/servers');
  check('komari 不可达时优雅降级', r.status === 200 && r.data.error && r.data.error.includes('获取失败'));

  // ---- 主题系统 ----
  r = await api('/api/themes');
  check('主题列表含3个预置', r.data.themes.length === 3 && r.data.themes.some((t) => t.isDefault));

  // 未登录不能建主题
  cookie = '';
  r = await api('/api/themes', { method: 'POST', body: { name: 'X', css: '' } });
  check('未登录建主题被拒', r.status === 401);

  // 注册测试用户建主题
  await api('/api/register', { method: 'POST', body: { username: 'thememan', password: 'pass123' } });
  r = await api('/api/themes', { method: 'POST', body: { name: '我的主题', css: ':root{--ba-blue:#123456}' } });
  check('创建主题', r.status === 201 && r.data.theme.id > 0);
  const tid = r.data.theme.id;

  r = await api('/api/themes/' + tid, { method: 'PUT', body: { css: ':root{--ba-blue:#654321}' } });
  check('作者修改主题', r.status === 200);
  r = await api('/api/themes');
  check('修改已生效', r.data.themes.find((t) => t.id === tid).css.includes('654321'));

  // 超长 CSS 拒绝
  r = await api('/api/themes', { method: 'POST', body: { name: 'big', css: 'x'.repeat(20001) } });
  check('超长CSS被拒', r.status === 400);

  // 他人不能改/删
  cookie = '';
  await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  r = await api('/api/themes/' + tid, { method: 'PUT', body: { css: 'hacked' } });
  check('非作者修改被拒', r.status === 403);
  r = await api('/api/themes/' + tid, { method: 'DELETE' });
  check('非作者删除被拒', r.status === 403);

  // 预置主题保护
  r = await api('/api/themes/1', { method: 'PUT', body: { css: 'x' } });
  check('预置主题不可改', r.status === 403);
  r = await api('/api/themes/1', { method: 'DELETE' });
  check('预置主题不可删', r.status === 403);

  // 清理：删测试用户（级联其数据）、清测试主题、还原 komari 设置与 admin 金币
  const users = (await api('/api/admin/users')).data.users;
  const tu = users.find((u) => u.username === 'thememan');
  if (tu) await api('/api/admin/users/' + tu.id, { method: 'DELETE' });
  await api('/api/themes/' + tid, { method: 'DELETE' }).catch(() => {});
  await api('/api/admin/settings', { method: 'PUT', body: { komari_url: '' } });
  const admin = users.find((u) => u.username === 'admin');
  if (admin) await api('/api/admin/users/' + admin.id, { method: 'PUT', body: { coins: 999 } });

  mockKomari.close();
  console.log(results.join('\n'));
  process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
