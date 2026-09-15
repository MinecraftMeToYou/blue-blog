// 探针：对接多种监控面板 —— komari / 哪吒(Nezza v0) / ServerStatus(Hotaru)
// 支持同时配置多个数据源，后端代理拉取并归一化字段
const db = require('../lib/db');
const { send } = require('../lib/respond');

function getSetting(key) {
  const row = db.find('settings', (s) => s.key === key);
  return row ? row.value : '';
}

function getSources() {
  let list = [];
  try {
    const raw = getSetting('probe_sources');
    if (raw) list = JSON.parse(raw);
  } catch {}
  if (!Array.isArray(list)) list = [];
  list = list.filter((s) => s && s.url);
  // 兼容旧配置：只填了 komari_url
  if (!list.length) {
    const ku = (process.env.KOMARI_URL || getSetting('komari_url') || '').trim();
    if (ku) list = [{ name: 'komari', provider: 'komari', url: ku, token: '' }];
  }
  // 也支持环境变量 PROBE_SOURCES 传入 JSON 数组
  if (!list.length && process.env.PROBE_SOURCES) {
    try { const e = JSON.parse(process.env.PROBE_SOURCES); if (Array.isArray(e)) list = e; } catch {}
  }
  return list;
}

async function jget(url, headers) {
  const res = await fetch(url, {
    headers: Object.assign({ Accept: 'application/json' }, headers || {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`面板返回 ${res.status}`);
  return res.json();
}

async function fetchKomari(base, token) {
  const data = await jget(base + '/api/clients', token ? { Authorization: `Bearer ${token}` } : null);
  const arr = Array.isArray(data) ? data : (data.clients || data.data || []);
  return arr.map((c) => ({
    name: c.name || c.client_name || '未知节点',
    online: String(c.status ?? c.online ?? 'offline') === 'online',
    os: c.os || '',
    arch: c.arch || '',
    cpuPercent: Number(c.cpu_percent ?? c.load_percent ?? c.cpu ?? 0) || 0,
    memPercent: Number(c.mem_percent ?? c.memory_percent ?? c.mem ?? 0) || 0,
    diskPercent: Number(c.disk_percent ?? c.disk ?? 0) || 0,
    netIn: Number(c.net_in_speed ?? c.network_in ?? c.download ?? 0) || 0,
    netOut: Number(c.net_out_speed ?? c.network_out ?? c.upload ?? 0) || 0,
    uptime: Number(c.uptime ?? 0) || 0,
    region: c.region || c.location || '',
  }));
}

async function fetchNezha(base, token) {
  // 哪吒 v0：/api/v1/server/list，Authorization: Token xxx
  const data = await jget(base + '/api/v1/server/list', token ? { Authorization: `Token ${token}` } : null);
  const arr = Array.isArray(data) ? data : (data.result || data.data || []);
  return arr.map((it) => {
    const st = it.status || {};
    const host = it.host || {};
    const memTotal = Number(st.MemTotal ?? st.mem_total ?? 0);
    const memUsed = Number(st.MemUsed ?? st.mem_used ?? 0);
    const diskTotal = Number(st.DiskTotal ?? st.disk_total ?? 0);
    const diskUsed = Number(st.DiskUsed ?? st.disk_used ?? 0);
    return {
      name: it.name || '未知节点',
      online: Boolean(it.online4 || it.online6 || st.online4 || st.online6),
      os: [host.Platform, host.PlatformVersion].filter(Boolean).join(' '),
      arch: host.CPU || host.Arch || '',
      cpuPercent: Number(st.CPU ?? st.cpu ?? 0) || 0,
      memPercent: memTotal ? (memUsed / memTotal) * 100 : 0,
      diskPercent: diskTotal ? (diskUsed / diskTotal) * 100 : 0,
      netIn: Number(st.NetInSpeed ?? st.net_in_speed ?? 0) || 0,
      netOut: Number(st.NetOutSpeed ?? st.net_out_speed ?? 0) || 0,
      uptime: Number(st.Uptime ?? st.uptime ?? 0) || 0,
      region: host.Region || '',
    };
  });
}

async function fetchServerStatus(base) {
  // ServerStatus / Hotaru：/json/stats.json（数组或 {servers:[...]}）
  let lastErr;
  for (const path of ['/json/stats.json', '/stats.json']) {
    try {
      const data = await jget(base + path);
      const arr = Array.isArray(data) ? data : (data.servers || data.result || []);
      if (!Array.isArray(arr) || !arr.length) continue;
      return arr.map((it) => {
        let up = Number(it.uptime || 0);
        if (up > 1e13) up = Math.floor(up / 1e9);       // 纳秒
        else if (up > 1e10) up = Math.floor(up / 1e3);  // 毫秒
        const mt = Number(it.memory_total || 0), mu = Number(it.memory_used || 0);
        const dt = Number(it.disk_total || 0), du = Number(it.disk_used || 0);
        return {
          name: it.name || it.hostname || '未知节点',
          online: it.online === true || it.online === 1 || it.online === '1' || Boolean(it.online4 || it.online6),
          os: it.type || '',
          arch: '',
          cpuPercent: Number(it.cpu || 0) || 0,
          memPercent: mt ? (mu / mt) * 100 : 0,
          diskPercent: dt ? (du / dt) * 100 : 0,
          netIn: Number(it.rx ?? it.net_rx_speed ?? it.net_in_speed ?? 0) || 0,
          netOut: Number(it.tx ?? it.net_tx_speed ?? it.net_out_speed ?? 0) || 0,
          uptime: up,
          region: it.location || '',
        };
      });
    } catch (e) { lastErr = e; }
  }
  throw new Error('无法获取 ServerStatus 数据' + (lastErr ? `（${lastErr.message}）` : ''));
}

async function fetchSource(src) {
  const base = String(src.url || '').replace(/\/+$/, '');
  const provider = String(src.provider || 'komari').toLowerCase();
  const name = src.name || base;
  try {
    let servers;
    if (provider === 'komari') servers = await fetchKomari(base, src.token);
    else if (provider === 'nezha' || provider === '哪吒') servers = await fetchNezha(base, src.token);
    else if (provider === 'serverstatus') servers = await fetchServerStatus(base);
    else throw new Error(`不支持的探针类型: ${provider}`);
    return { name, provider, base, ok: true, servers };
  } catch (e) {
    return { name, provider, base, ok: false, error: String(e.message || e), servers: [] };
  }
}

module.exports.register = (router) => {
  router.get('/api/probe/servers', async (ctx) => {
    const sources = getSources();
    if (!sources.length) {
      return send(ctx, 200, {
        configured: false, sources: [], servers: [],
        hint: '未配置探针：管理员在后台「设置」里可添加 komari / 哪吒 / ServerStatus 数据源',
      });
    }
    const results = await Promise.all(sources.map(fetchSource));
    send(ctx, 200, {
      configured: true,
      sources: results,
      servers: results.flatMap((r) => r.servers), // 合并视图，便于导航栏统计
    });
  });
};
