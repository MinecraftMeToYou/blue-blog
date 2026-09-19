// 站点设置中心：统一读取 settings 表中的各配置块
const db = require('./db');

function get(key) {
  const row = db.find('settings', (s) => s.key === key);
  return row ? row.value : '';
}

function getJSON(key, dflt) {
  const raw = get(key);
  if (!raw) return dflt;
  try { return JSON.parse(raw); } catch { return dflt; }
}

module.exports = {
  get,
  set(key, value) {
    const val = typeof value === 'string' ? value : JSON.stringify(value);
    const row = db.find('settings', (s) => s.key === key);
    if (row) db.update('settings', row.id, { value: val });
    else db.insert('settings', { key, value: val });
  },
  siteName() {
    return get('site_name') || 'MinecraftMeToYou的私人博客';
  },
  smtp() {
    const c = getJSON('smtp', {});
    return (c && c.host) ? c : null;   // {host,port,secure,user,pass,from}
  },
  smsWebhook() {
    return get('sms_webhook') || '';
  },
  // 注册相关开关：{requireInvite, verifyEmail, verifyPhone, qqBind}
  reg() {
    return Object.assign(
      { requireInvite: false, verifyEmail: false, verifyPhone: false, qqBind: true },
      getJSON('reg', {})
    );
  },
};
