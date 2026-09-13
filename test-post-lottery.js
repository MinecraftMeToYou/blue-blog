// 端到端测试：文章抽奖（发起/参与/撤销/删除退款）
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

(async () => {
  // 作者：admin；准备三个读者
  await login('admin', 'admin123');
  let r = await api('/api/posts', { method: 'POST', body: { title: 'LotteryPost', content: 'x' } });
  const postId = r.data.post.id;

  await logout();
  for (const name of ['lucky1', 'lucky2', 'lucky3']) {
    await api('/api/register', { method: 'POST', body: { username: name, password: 'pass123' } });
    await logout();
  }

  // ---- 发起抽奖（确定性：名额=参与上限=2，必中） ----
  await login('admin', 'admin123');
  let me = (await api('/api/me')).data.user;
  const coins0 = me.coins; // 999
  r = await api(`/api/posts/${postId}/lottery`, { method: 'POST', body: { winners: 2, perWinner: 10, maxDraws: 2 } });
  check('作者发起抽奖', r.status === 201, JSON.stringify(r.data).slice(0, 80));
  me = (await api('/api/me')).data.user;
  check('发起后冻结奖金', me.coins === coins0 - 20, `${coins0} -> ${me.coins}`);

  r = await api(`/api/posts/${postId}`);
  check('文章详情带抽奖信息', r.data.lottery && r.data.lottery.winners === 2 && r.data.lottery.drawsLeft === 2);

  // 非作者不能发起第二个
  r = await api(`/api/posts/${postId}/lottery`, { method: 'POST', body: { winners: 1, perWinner: 5, maxDraws: 5 } });
  check('重复发起被拒绝', r.status === 409);

  // ---- 作者本人不能参与 ----
  r = await api(`/api/posts/${postId}/lottery/draw`, { method: 'POST' });
  check('发起人参与被拒绝', r.status === 403);

  // ---- lucky1 / lucky2 参与，必中 ----
  await logout(); await login('lucky1', 'pass123');
  r = await api(`/api/posts/${postId}/lottery/draw`, { method: 'POST' });
  const l1 = r.data;
  check('lucky1 参与并中奖', r.status === 200 && l1.won === true && l1.coins === 110, `coins=${l1.coins}`);

  r = await api(`/api/posts/${postId}/lottery/draw`, { method: 'POST' });
  check('重复参与被拒绝', r.status === 409);

  await logout(); await login('lucky2', 'pass123');
  r = await api(`/api/posts/${postId}/lottery/draw`, { method: 'POST' });
  check('lucky2 参与并中奖', r.status === 200 && r.data.won === true && r.data.coins === 110);

  // 名额用完，已结束
  await logout(); await login('lucky3', 'pass123');
  r = await api(`/api/posts/${postId}/lottery/draw`, { method: 'POST' });
  check('结束后参与被拒绝', r.status === 400, r.data.error || '');

  await logout(); await login('admin', 'admin123');
  r = await api(`/api/posts/${postId}`);
  check('名单与状态正确', r.data.lottery.closed === true
    && r.data.lottery.participants.length === 2
    && r.data.lottery.participants.every((p) => p.won),
    JSON.stringify(r.data.lottery.participants.map((p) => p.username)));

  // ---- 撤销退款：名额2 份奖5 上限5，1 人参与后撤销 ----
  r = await api('/api/posts', { method: 'POST', body: { title: 'CancelTest', content: 'x' } });
  const post2 = r.data.post.id;
  await api(`/api/posts/${post2}/lottery`, { method: 'POST', body: { winners: 2, perWinner: 5, maxDraws: 5 } });
  me = (await api('/api/me')).data.user; // 979 - 10 = 969
  const beforeCancel = me.coins;
  await logout(); await login('lucky1', 'pass123');
  r = await api(`/api/posts/${post2}/lottery/draw`, { method: 'POST' }); // P=2/5 随机
  const won1 = r.data.won;
  await logout(); await login('admin', 'admin123');
  r = await api(`/api/posts/${post2}/lottery`, { method: 'DELETE' });
  const expectedRefund = (won1 ? 1 : 2) * 5;
  check('撤销并退还未抽出奖金', r.status === 200 && r.data.refunded === expectedRefund,
    `won1=${won1} refunded=${r.data.refunded}`);
  me = (await api('/api/me')).data.user;
  check('退款到账', me.coins === beforeCancel + expectedRefund, `${beforeCancel} -> ${me.coins}`);

  // ---- 非发起人不能撤销 ----
  await logout(); await login('lucky1', 'pass123');
  r = await api(`/api/posts/${postId}/lottery`, { method: 'DELETE' });
  check('非发起人撤销被拒绝', r.status === 403);

  // ---- 删除文章时自动退款 ----
  await logout(); await login('admin', 'admin123');
  r = await api('/api/posts', { method: 'POST', body: { title: 'DelRefund', content: 'x' } });
  const post3 = r.data.post.id;
  await api(`/api/posts/${post3}/lottery`, { method: 'POST', body: { winners: 1, perWinner: 7, maxDraws: 3 } });
  me = (await api('/api/me')).data.user;
  const beforeDel = me.coins;
  r = await api(`/api/posts/${post3}`, { method: 'DELETE' });
  me = (await api('/api/me')).data.user;
  check('删除文章自动退款', r.status === 200 && me.coins === beforeDel + 7, `${beforeDel} -> ${me.coins}`);

  // ---- 清理测试数据 ----
  await api(`/api/posts/${postId}`, { method: 'DELETE' }); // 已结束，退款 0
  const users = (await api('/api/admin/users')).data.users;
  for (const name of ['lucky1', 'lucky2', 'lucky3']) {
    const u = users.find((x) => x.username === name);
    if (u) await api('/api/admin/users/' + u.id, { method: 'DELETE' }); // 级联清理抽奖记录
  }
  const admin = users.find((x) => x.username === 'admin');
  if (admin) await api('/api/admin/users/' + admin.id, { method: 'PUT', body: { coins: 999 } });

  console.log(results.join('\n'));
  process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
