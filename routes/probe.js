// 探针：代理 komari（github.com/komari-monitor/komari）监控面板的数据
// 后端代理可绕过浏览器跨域限制，komari 地址由管理后台配置
const db = require('../lib/db');
const { send } = require('../lib/respond');

function getSetting(key) {
  const row = db.find('settings', (s) => s.key === key);
  return row ? row.value : '';
}

// komari 各版本字段名略有差异，这里做兼容归一化
function pick(obj, keys, dflt) {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return dflt;
}

function normalizeClient(c) {
  return {
    name: pick(c, ['name', 'client_name'], '未知节点'),
    online: String(pick(c, ['status', 'online'], 'offline')) === 'online',
    os: pick(c, ['os'], ''),
    arch: pick(c, ['arch'], ''),
    cpuPercent: Number(pick(c, ['cpu_percent', 'load_percent', 'cpu'], 0)) || 0,
    memPercent: Number(pick(c, ['mem_percent', 'memory_percent', 'mem'], 0)) || 0,
    diskPercent: Number(pick(c, ['disk_percent', 'disk'], 0)) || 0,
    netIn: Number(pick(c, ['net_in_speed', 'network_in', 'download'], 0)) || 0,
    netOut: Number(pick(c, ['net_out_speed', 'network_out', 'upload'], 0)) || 0,
    uptime: Number(pick(c, ['uptime'], 0)) || 0,
    region: pick(c, ['region', 'location'], ''),
  };
}

module.exports.register = (router) => {
  router.get('/api/probe/servers', async (ctx) => {
    const base = (process.env.KOMARI_URL || getSetting('komari_url') || '').replace(/\/+$/, '');
    if (!base) {
      return send(ctx, 200, {
        configured: false,
        servers: [],
        hint: '未配置探针地址：管理员可在后台“设置”中填写 komari 面板地址（如 http://demo.komari-monitor.dev）',
      });
    }
    try {
      const res = await fetch(base + '/api/clients', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`komari 返回 ${res.status}`);
      const data = await res.json();
      // komari: { clients: [...] }；兼容直接返回数组的老版本
      const list = Array.isArray(data) ? data : (data.clients || data.data || []);
      send(ctx, 200, { configured: true, base, servers: list.map(normalizeClient) });
    } catch (err) {
      send(ctx, 200, { configured: true, base, servers: [], error: `探针数据获取失败: ${err.message}` });
    }
  });
};
