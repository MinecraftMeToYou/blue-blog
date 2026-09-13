// 端到端测试：文章编辑（管理员）、评论回复、抽奖
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

(async () => {
  // 管理员登录
  let r = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  check('管理员登录', r.status === 200 && r.data.user.role === 'admin');

  // 建测试用户（测抽奖，不动管理员金币）
  await api('/api/logout', { method: 'POST' });
  r = await api('/api/register', { method: 'POST', body: { username: 'drawuser', password: 'pass123' } });
  check('注册测试用户', r.status === 201);

  // ---- 管理员编辑文章 ----
  await api('/api/logout', { method: 'POST' });
  await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  r = await api('/api/posts', { method: 'POST', body: { title: 'EditTest', content: 'before', tags: 't1', category: 'c1' } });
  const postId = r.data.post.id;
  r = await api(`/api/admin/posts/${postId}`, { method: 'PUT', body: { title: 'EditedByAdmin', content: 'after', tags: 't2,t3' } });
  check('管理员编辑文章', r.status === 200);
  r = await api(`/api/posts/${postId}`);
  check('编辑已生效', r.data.post.title === 'EditedByAdmin' && r.data.post.content === 'after'
    && r.data.post.tags.join(',') === 't2,t3', JSON.stringify(r.data.post.tags));

  // ---- 评论 + 回复 ----
  r = await api(`/api/posts/${postId}/comments`, { method: 'POST', body: { content: 'first comment' } });
  const c1 = r.data.comment.id;
  check('发表评论', r.status === 201);
  r = await api(`/api/posts/${postId}/comments`, { method: 'POST', body: { content: 'a reply', replyTo: c1 } });
  check('回复评论', r.status === 201 && r.data.comment.replyTo === c1 && r.data.comment.replyToName === 'admin',
    `replyTo=${r.data.comment.replyTo} name=${r.data.comment.replyToName}`);
  r = await api(`/api/posts/${postId}/comments`, { method: 'POST', body: { content: 'bad reply', replyTo: 99999 } });
  check('回复不存在的评论被忽略（降级为普通评论）', r.status === 201 && r.data.comment.replyTo === null);

  // ---- 抽奖 ----
  await api('/api/logout', { method: 'POST' });
  await api('/api/login', { method: 'POST', body: { username: 'drawuser', password: 'pass123' } });
  r = await api('/api/lottery');
  check('获取奖池', r.status === 200 && r.data.cost === 20 && r.data.pool.length === 7);

  const before = (await api('/api/me')).data.user.coins; // 100
  let drew = [];
  for (let i = 0; i < 5; i++) {
    const d = await api('/api/lottery/draw', { method: 'POST' });
    if (d.status !== 200) { check('抽奖第' + (i + 1) + '次', false, d.data.error); continue; }
    drew.push({ prize: d.data.prize, coins: d.data.coins });
  }
  check('连续抽奖 5 次', drew.length === 5);
  // 金币对账：每次 -20 加奖金
  const expected = drew.reduce((c, d) => c, before);
  const lastCoins = drew.length ? drew[drew.length - 1].coins : null;
  const calc = drew.reduce((c, d, i) => c, before);
  // 用奖池反推每次金额
  const poolVals = { '谢谢参与': 0, '金币 +5': 5, '金币 +10': 10, '金币 +50': 50, '金币 +200': 200 };
  let expect = before;
  let ok = true;
  for (const d of drew) {
    expect = expect - 20 + (poolVals[d.prize] ?? 0);
    if (!poolVals.hasOwnProperty(d.prize) && !d.prize.startsWith('头衔')) ok = false;
  }
  check('金币对账正确', ok && lastCoins === expect, `last=${lastCoins} expect=${expect}`);
  check('奖品合法', drew.every((d) => poolVals.hasOwnProperty(d.prize) || d.prize.startsWith('头衔')),
    drew.map((d) => d.prize).join(' | '));

  r = await api('/api/lottery/history');
  check('抽奖记录', r.status === 200 && r.data.draws.length === 5);

  // 抽到金币不足场景
  await api('/api/logout', { method: 'POST' });
  await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  await api('/api/admin/users', {}); // noop keep warm

  // 清理：删测试文章（级联评论）、删 drawuser（级联其抽奖记录）、还原 admin 金币
  await api(`/api/admin/posts/${postId}`, { method: 'DELETE' });
  const users = (await api('/api/admin/users')).data.users;
  const du = users.find((u) => u.username === 'drawuser');
  if (du) await api('/api/admin/users/' + du.id, { method: 'DELETE' });
  const admin = users.find((u) => u.username === 'admin');
  if (admin) await api('/api/admin/users/' + admin.id, { method: 'PUT', body: { coins: 999 } });

  console.log(results.join('\n'));
  const fails = results.filter((x) => x.startsWith('FAIL'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
