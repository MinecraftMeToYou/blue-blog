// 前端单页应用逻辑（Discourse 风格）
const $ = (id) => document.getElementById(id);
let me = null;          // 当前登录用户
let activeTag = '';     // 当前筛选标签
let editingId = null;   // 正在编辑的文章 id

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天';
  return new Date(iso).toLocaleDateString();
}

const AV_COLORS = ['#e2574c', '#2e9ce0', '#8dc63f', '#9b59b6', '#e67e22', '#16a085', '#c0392b', '#34495e'];
function avColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function avatar(name, size) {
  const s = size || 40;
  return `<span class="avatar" style="width:${s}px;height:${s}px;line-height:${s}px;background:${avColor(name)}">${esc(String(name || '?')[0].toUpperCase())}</span>`;
}
function catColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 37 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

// ---- 正文标记渲染：[probe] [mc] [lottery] [shop] ----
const EMBEDS = { probe: '机器状态', mc: 'MC状态', lottery: '抽奖', shop: '商店' };
function renderContent(content) {
  const widgets = [];
  const html = esc(content).replace(/\[(probe|mc|lottery|shop)\]/gi, (_, name) => {
    const key = name.toLowerCase();
    const id = `w-${key}-${widgets.length}`;
    widgets.push({ id, key });
    return `<div class="embed" id="${id}"><div class="embed-label">${EMBEDS[key]}</div><div class="embed-body"></div></div>`;
  });
  return { html, widgets };
}
function mountWidgets(widgets) {
  for (const w of widgets) {
    const box = document.getElementById(w.id);
    if (!box) continue;
    const body = box.querySelector('.embed-body');
    if (w.key === 'probe') renderProbeInto(body);
    else if (w.key === 'mc') renderMcInto(body);
    else if (w.key === 'lottery') renderLotteryInto(body);
    else if (w.key === 'shop') renderShopInto(body);
  }
}

// ---- 标签页切换 ----
const panels = ['authPanel', 'postsPanel', 'postDetail', 'shopPanel', 'lotteryPanel', 'mcPanel', 'themesPanel', 'probePanel'];
const MORE_TABS = ['shop', 'lottery', 'mc', 'probe'];
function showTab(name) {
  panels.forEach((p) => $(p).classList.add('hidden'));
  const map = { posts: 'postsPanel', shop: 'shopPanel', mc: 'mcPanel', auth: 'authPanel', lottery: 'lotteryPanel', themes: 'themesPanel', probe: 'probePanel' };
  $(map[name]).classList.remove('hidden');
  document.querySelectorAll('.nav button[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  $('btnMore').classList.toggle('active', MORE_TABS.includes(name));
  closeMore();
  if (name === 'posts') loadPosts();
  if (name === 'shop') loadShop();
  if (name === 'lottery') loadLottery();
  if (name === 'mc') loadMc();
  if (name === 'themes') loadThemes();
  if (name === 'probe') loadProbe();
}
document.querySelectorAll('.nav button[data-tab]').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab)));

// 「其他」下拉菜单
function closeMore() { $('moreDrop').classList.remove('open'); $('moreMenu').classList.add('hidden'); }
$('btnMore').onclick = (e) => {
  e.stopPropagation();
  const open = $('moreDrop').classList.toggle('open');
  $('moreMenu').classList.toggle('hidden', !open);
};
document.addEventListener('click', (e) => {
  if (!$('moreDrop').contains(e.target)) closeMore();
});
$('moreMenu').querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => closeMore()));

// ---- 认证 ----
let SITE_REG = { requireInvite: false, verifyEmail: false, verifyPhone: false, qqBind: true };
async function refreshMe() {
  try { me = (await api('/api/me')).user; }
  catch { me = null; }
  renderUserBox();
}

const LEVEL_META = [
  ['L0 新用户', '#919191'], ['L1 基础用户', '#2e9ce0'], ['L2 成员', '#8dc63f'],
  ['L3 活跃用户', '#9b59b6'], ['L4 领袖', '#e7c04a'],
];
function levelBadge(level) {
  const [name, color] = LEVEL_META[level] || LEVEL_META[0];
  return `<span class="lv-badge" style="border-color:${color};color:${color}">${name}</span>`;
}

function renderUserBox() {
  const box = $('userBox');
  $('navAuth').classList.toggle('hidden', !!me);
  $('btnNewPost').classList.toggle('hidden', !me);
  $('profileBox').classList.toggle('hidden', !me);
  $('authForms').classList.toggle('hidden', !!me);
  $('btnNewPost').classList.add('hidden');
  if (me) {
    $('btnNewPost').classList.remove('hidden');
    box.innerHTML = `<button class="user-btn" title="个人设置">${avatar(me.username, 26)}<b>${esc(me.username)}</b><span class="u-coins">${me.coins} 金币</span></button>`;
    box.querySelector('button').onclick = () => openProfile();
    fillProfile();
  } else {
    box.innerHTML = '';
  }
}

function renderAuthForm() {
  document.querySelectorAll('.reg-extra').forEach((el) => el.classList.add('hidden'));
  if (SITE_REG.verifyEmail) $('regEmailRow').classList.remove('hidden');
  if (SITE_REG.verifyPhone) $('regPhoneRow').classList.remove('hidden');
  if (SITE_REG.requireInvite) $('regInviteRow').classList.remove('hidden');
}

$('btnLogin').onclick = async () => {
  try {
    me = (await api('/api/login', { method: 'POST', body: { username: $('authUser').value, password: $('authPass').value } })).user;
    renderUserBox(); showTab('posts');
  } catch (e) { alert(e.message); }
};

$('btnRegister').onclick = async () => {
  try {
    const body = { username: $('authUser').value, password: $('authPass').value };
    if (SITE_REG.verifyEmail) body.email = $('regEmail').value;
    if (SITE_REG.verifyPhone) body.phone = $('regPhone').value;
    if (SITE_REG.requireInvite) body.invite = $('regInvite').value;
    const r = await api('/api/register', { method: 'POST', body });
    me = r.user;
    renderUserBox();
    if (r.notices && r.notices.length) alert(r.notices.join('\n'));
    else if (SITE_REG.verifyEmail || SITE_REG.verifyPhone) alert('注册成功！验证码已发送，请到「个人设置」完成验证');
    showTab('posts');
  } catch (e) { alert(e.message); }
};

// ---- 个人设置 ----
function openProfile() {
  showTab('auth');
  renderAuthForm();
}

function fillProfile() {
  if (!me) return;
  $('profLevel').innerHTML = levelBadge(me.level);
  $('profName').textContent = `${me.username} · ${me.coins} 金币` + (me.title ? ` · ${me.title}` : '');
  $('profEmail').value = me.email || '';
  $('profPhone').value = me.phone || '';
  $('profQQ').value = me.qq || '';
  $('profEmailState').textContent = me.emailVerified ? '✓ 已验证' : (me.email ? '未验证' : '');
  $('profPhoneState').textContent = me.phoneVerified ? '✓ 已验证' : (me.phone ? '未验证' : '');
  $('profQQState').textContent = me.qq ? '已绑定' : '';
  const reg = SITE_REG;
  $('profEmail').parentElement.parentElement.style.display = '';
  if (!reg.qqBind) { $('qqSec').style.display = 'none'; $('qqRow').style.display = 'none'; }
  else { $('qqSec').style.display = ''; $('qqRow').style.display = ''; }
}

$('btnProfLogout').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  me = null; renderUserBox(); showTab('posts');
};
$('btnBackForum').onclick = () => showTab('posts');

$('btnProfQQ').onclick = async () => {
  try {
    const r = await api('/api/profile/qq', { method: 'PUT', body: { qq: $('profQQ').value } });
    me = r.user; fillProfile();
    $('profQQState').textContent = me.qq ? '已绑定' : '已清除';
  } catch (e) { alert(e.message); }
};

$('btnProfEmailSend').onclick = async () => {
  try {
    const r = await api('/api/verify/email/send', { method: 'POST', body: { email: $('profEmail').value } });
    $('profEmailState').textContent = r.hint || '已发送';
  } catch (e) { $('profEmailState').textContent = e.message; }
};
$('btnProfEmailConfirm').onclick = async () => {
  try {
    const r = await api('/api/verify/email/confirm', { method: 'POST', body: { code: $('profEmailCode').value } });
    me = r.user; renderUserBox(); openProfile();
    $('profEmailState').textContent = '✓ 验证成功';
  } catch (e) { alert(e.message); }
};
$('btnProfPhoneSend').onclick = async () => {
  try {
    const r = await api('/api/verify/phone/send', { method: 'POST', body: { phone: $('profPhone').value } });
    $('profPhoneState').textContent = r.hint || '已发送';
  } catch (e) { $('profPhoneState').textContent = e.message; }
};
$('btnProfPhoneConfirm').onclick = async () => {
  try {
    const r = await api('/api/verify/phone/confirm', { method: 'POST', body: { code: $('profPhoneCode').value } });
    me = r.user; renderUserBox(); openProfile();
    $('profPhoneState').textContent = '✓ 验证成功';
  } catch (e) { alert(e.message); }
};

// ---- 文章（话题列表） ----
async function loadPosts() {
  const { posts } = await api('/api/posts' + (activeTag ? `?tag=${encodeURIComponent(activeTag)}` : ''));
  const { tags } = await api('/api/tags');
  $('tagBar').innerHTML = `<button class="${!activeTag ? 'on' : ''}" data-t="">最新</button>` +
    tags.map((t) => `<button class="${activeTag === t ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('');
  $('tagBar').querySelectorAll('button').forEach((b) =>
    b.onclick = () => { activeTag = b.dataset.t; loadPosts(); });

  $('postList').innerHTML = posts.length ? posts.map((p) => `
    <tr class="topic-row" data-id="${p.id}">
      <td class="c-topic">
        <a class="topic-title">${esc(p.title)}</a>
        <div class="topic-meta">
          <span class="cat-badge" style="background:${catColor(p.category)}"></span>
          <span>${esc(p.category)}</span>
          ${(p.tags || []).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('')}
        </div>
      </td>
      <td class="c-poster">${avatar(p.authorName, 30)}<span class="poster-name">${esc(p.authorName)}</span></td>
      <td class="c-num">${p.commentCount || 0}</td>
      <td class="c-act">${timeAgo(p.createdAt)}</td>
    </tr>`).join('')
    : '<tr><td colspan="4" class="hint" style="padding:24px 6px">暂无话题</td></tr>';
  $('postList').querySelectorAll('tr.topic-row').forEach((tr) =>
    tr.onclick = () => openPost(tr.dataset.id));
}

$('btnNewPost').onclick = () => {
  editingId = null;
  $('editorTitle').textContent = '新话题';
  $('postTitle').value = $('postContent').value = $('postTags').value = $('postCategory').value = '';
  $('editorCard').classList.remove('hidden');
  $('btnCancelEdit').classList.remove('hidden');
};

$('btnCancelEdit').onclick = () => $('editorCard').classList.add('hidden');

$('btnPublish').onclick = async () => {
  const body = {
    title: $('postTitle').value,
    content: $('postContent').value,
    tags: $('postTags').value,
    category: $('postCategory').value,
  };
  try {
    if (editingId) await api(`/api/posts/${editingId}`, { method: 'PUT', body });
    else await api('/api/posts', { method: 'POST', body });
    $('editorCard').classList.add('hidden');
    loadPosts();
  } catch (e) { alert(e.message); }
};

// ---- 话题详情（楼层式） ----
async function openPost(id) {
  const { post, comments, lottery } = await api(`/api/posts/${id}`);
  const canEdit = me && post.authorId === me.id;
  let replyTo = null;       // 正在回复的评论 id
  let replyToName = '';

  function setReply(cid, name) {
    replyTo = cid;
    replyToName = name || '';
    const hint = $('replyHint');
    if (hint) {
      hint.innerHTML = cid ? `回复 @${esc(name)} <button data-cancel="1">取消</button>` : '';
      const btn = hint.querySelector('button');
      if (btn) btn.onclick = () => setReply(null);
    }
    if ($('cmtInput')) $('cmtInput').placeholder = cid ? `回复 @${name}...` : '写回复...';
  }

  function lotteryCard() {
    if (lottery) {
      const joined = me && lottery.participants.some((p) => p.userId === me.id);
      const isStarter = me && me.id === lottery.authorId;
      const canJoin = me && !isStarter && !joined && !lottery.closed;
      const winnerNames = lottery.participants.filter((p) => p.won).map((p) => p.username);
      return `
      <div class="box box-lottery">
        <h3>文章抽奖 ${lottery.closed ? '（已结束）' : '（进行中）'}</h3>
        <p class="hint">单份奖金 ${lottery.perWinner} 金币，剩余 ${lottery.winnersLeft}/${lottery.winners} 份，已参与 ${lottery.maxDraws - lottery.drawsLeft}/${lottery.maxDraws} 人</p>
        ${lottery.winners - lottery.winnersLeft > 0 ? `<p>已中奖：${esc(winnerNames.join('、'))}</p>` : ''}
        ${canJoin ? `<p style="margin-top:10px"><button id="btnJoinLottery" class="primary">立即抽奖</button></p>` : ''}
        ${joined ? '<p class="hint">你已参与过本次抽奖</p>' : ''}
        ${me && !isStarter && !joined && lottery.closed ? '<p class="hint">来晚一步，抽奖已结束</p>' : ''}
        ${isStarter ? `<p style="margin-top:10px"><button id="btnCancelLottery" class="danger">撤销抽奖（退回 ${lottery.winnersLeft * lottery.perWinner} 金币）</button></p>
          <p class="hint">你是发起人，不能参与自己的抽奖</p>` : ''}
        <p id="lotteryMsg" style="margin-top:8px"></p>
      </div>`;
    }
    if (canEdit) {
      return `
      <div class="box">
        <h3>发起文章抽奖</h3>
        <div class="row">
          <label>中奖名额 <input id="lw" type="number" value="3" min="1" style="width:70px"></label>
          <label>单份奖金 <input id="lp" type="number" value="10" min="1" style="width:70px"></label>
          <label>参与上限 <input id="lm" type="number" value="10" min="1" style="width:70px"></label>
        </div>
        <p class="hint">发起即冻结 名额×奖金 金币作奖池；未抽出的部分可撤销退回；发起人本人不能参与</p>
        <p style="margin-top:10px"><button id="btnCreateLottery" class="primary">发起抽奖</button></p>
        <p id="lotteryMsg" class="hint"></p>
      </div>`;
    }
    return '';
  }

  const { html: postHtml, widgets } = renderContent(post.content);

  $('postDetail').innerHTML = `
    <div class="topic-head">
      <button class="link-btn" onclick="showTab('posts')">← 返回列表</button>
      <h1>${esc(post.title)}</h1>
      <div class="topic-meta">
        <span class="cat-badge" style="background:${catColor(post.category)}"></span>
        <span>${esc(post.category)}</span>
        ${(post.tags || []).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('')}
      </div>
    </div>
    ${lotteryCard()}
    <div class="posts">
      <div class="d-post">
        ${avatar(post.authorName)}
        <div class="d-post-main">
          <div class="d-post-info">
            <b>${esc(post.authorName)}</b>
            ${levelBadge(post.authorLevel || 0)}
            <span class="p-time">#1 · ${timeAgo(post.createdAt)}</span>
            ${canEdit ? `<span class="p-ops"><button data-act="edit">编辑</button><button class="danger" data-act="del">删除</button></span>` : ''}
          </div>
          <div class="d-post-body">${postHtml}</div>
        </div>
      </div>
      ${comments.map((c, i) => `
      <div class="d-post">
        ${avatar(c.username)}
        <div class="d-post-main">
          <div class="d-post-info">
            <b>${esc(c.username)}</b>
            ${levelBadge(c.userLevel || 0)}
            ${c.userTitle ? `<span class="title-badge">${esc(c.userTitle)}</span>` : ''}
            ${c.userQQ ? `<span class="qq-badge" title="QQ：${esc(c.userQQ)}">🐧 ${esc(c.userQQ)}</span>` : ''}
            ${c.replyTo ? `<span class="reply-quote">回复 @${esc(c.replyToName)}</span>` : ''}
            <span class="p-time">#${i + 2} · ${timeAgo(c.createdAt)}</span>
            <span class="p-ops">
              ${me ? `<button data-act="reply" data-cid="${c.id}" data-name="${esc(c.username)}">回复</button>` : ''}
              ${(me && (c.userId === me.id || canEdit)) ? `<button class="danger" data-cid="${c.id}" data-act="delcmt">删除</button>` : ''}
            </span>
          </div>
          <div class="d-post-body">${esc(c.content)}</div>
        </div>
      </div>`).join('') || '<p class="hint" style="padding:16px 0">暂无回复</p>'}
    </div>
    ${me ? `
    <div class="composer">
      <p id="replyHint" class="hint"></p>
      <textarea id="cmtInput" rows="4" placeholder="写回复..."></textarea>
      <div class="row" style="justify-content:flex-end"><button id="btnCmt" class="primary">回复</button></div>
    </div>` : '<p class="hint" style="margin:20px 0">登录后才能回复</p>'}`;

  panels.forEach((p) => $(p).classList.add('hidden'));
  $('postDetail').classList.remove('hidden');

  // 渲染正文里的功能组件
  mountWidgets(widgets);

  // 抽奖按钮
  const joinBtn = $('btnJoinLottery');
  if (joinBtn) joinBtn.onclick = async () => {
    try {
      joinBtn.disabled = true;
      const r = await api(`/api/posts/${id}/lottery/draw`, { method: 'POST' });
      $('lotteryMsg').textContent = r.won ? `恭喜中奖，获得 ${r.prize} 金币` : '很遗憾，未中奖';
      if (r.won) refreshMe();
    } catch (e) { $('lotteryMsg').textContent = e.message; joinBtn.disabled = false; }
  };
  const createBtn = $('btnCreateLottery');
  if (createBtn) createBtn.onclick = async () => {
    try {
      await api(`/api/posts/${id}/lottery`, {
        method: 'POST',
        body: { winners: Number($('lw').value), perWinner: Number($('lp').value), maxDraws: Number($('lm').value) },
      });
      refreshMe();
      openPost(id);
    } catch (e) { $('lotteryMsg').textContent = e.message; }
  };
  const cancelBtn = $('btnCancelLottery');
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (!confirm('撤销本次抽奖？未抽出的奖金将退回你的账户')) return;
    try {
      const r = await api(`/api/posts/${id}/lottery`, { method: 'DELETE' });
      alert(`已撤销，退回 ${r.refunded} 金币`);
      refreshMe();
      openPost(id);
    } catch (e) { alert(e.message); }
  };

  // 回复
  const btn = $('btnCmt');
  if (btn) btn.onclick = async () => {
    try {
      await api(`/api/posts/${id}/comments`, {
        method: 'POST',
        body: { content: $('cmtInput').value, replyTo },
      });
      openPost(id);
    } catch (e) { alert(e.message); }
  };
  $('postDetail').querySelectorAll('button[data-act]').forEach((b) => {
    if (b.dataset.act === 'delcmt') b.onclick = async () => {
      await api(`/api/comments/${b.dataset.cid}`, { method: 'DELETE' }); openPost(id);
    };
    if (b.dataset.act === 'reply') b.onclick = () => { setReply(Number(b.dataset.cid), b.dataset.name); $('cmtInput').focus(); };
    if (b.dataset.act === 'del') b.onclick = async () => {
      if (!confirm('确定删除这篇话题？')) return;
      await api(`/api/posts/${id}`, { method: 'DELETE' }); showTab('posts');
    };
    if (b.dataset.act === 'edit') b.onclick = () => {
      editingId = id;
      $('editorTitle').textContent = '编辑话题';
      $('postTitle').value = post.title;
      $('postContent').value = post.content;
      $('postTags').value = (post.tags || []).join(',');
      $('postCategory').value = post.category;
      showTab('posts');
      $('editorCard').classList.remove('hidden');
      $('btnCancelEdit').classList.remove('hidden');
    };
  });
}

// ---- 商店（可嵌入） ----
async function renderShopInto(el) {
  el.innerHTML = '<p class="hint">加载中...</p>';
  let items;
  try { items = (await api('/api/shop')).items; }
  catch (e) { el.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  el.innerHTML = items.map((i) => `
    <div class="box shop-item">
      <div><b>${esc(i.name)}</b><p class="hint">${esc(i.desc)}</p></div>
      <div class="shop-buy">${i.price} 金币 <button class="primary" data-id="${i.id}">购买</button></div>
    </div>`).join('') || '<p class="hint">商店暂无商品</p>';
  el.querySelectorAll('button[data-id]').forEach((b) =>
    b.onclick = async () => {
      try {
        const r = await api(`/api/shop/${b.dataset.id}/buy`, { method: 'POST' });
        me = r.user || me;
        if (r.coins !== undefined && me) me.coins = r.coins;
        renderUserBox();
        renderShopInto(el);
      } catch (e) { alert(e.message); }
    });
}

async function loadShop() {
  $('shopCoins').textContent = me ? `我的金币：${me.coins}` : '登录后可购买';
  await renderShopInto($('shopList'));
  if (me) {
    const { orders } = await api('/api/purchases');
    $('orderList').innerHTML = orders.map((o) =>
      `<p class="hint line">${new Date(o.createdAt).toLocaleString()} — ${esc(o.itemName)}（${o.price} 金币）</p>`).join('') || '<p class="hint">暂无订单</p>';
  } else $('orderList').innerHTML = '';
}

// ---- 抽奖（可嵌入） ----
async function renderLotteryInto(el, opts = {}) {
  el.innerHTML = '<p class="hint">加载中...</p>';
  let pool;
  try { pool = (await api('/api/lottery')).pool; }
  catch (e) { el.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  el.innerHTML = `
    <div class="pool">${pool.map((p) => `<span class="mini-tag">${esc(p.label)} ${p.weight}%</span>`).join('')}</div>
    <p class="embed-center"><button class="primary">${me ? '抽一次（20 金币）' : '登录后可抽奖'}</button></p>
    <p class="hint w-result"></p>`;
  const result = el.querySelector('.w-result');
  const drawBtn = el.querySelector('button.primary');
  drawBtn.onclick = async () => {
    if (!me) return showTab('auth');
    try {
      drawBtn.disabled = true;
      result.textContent = '抽奖中...';
      const r = await api('/api/lottery/draw', { method: 'POST' });
      result.textContent = `恭喜获得：${r.prize}`;
      refreshMe();
      if (opts.onSuccess) opts.onSuccess(r);
    } catch (e) { result.textContent = e.message; }
    drawBtn.disabled = false;
  };
}

async function loadLottery() {
  await renderLotteryInto($('lotteryBody'), { onSuccess: () => loadDrawHistory() });
  loadDrawHistory();
}

async function loadDrawHistory() {
  if (!me) { $('drawHistory').innerHTML = '<p class="hint">登录后可参与抽奖</p>'; return; }
  const { draws } = await api('/api/lottery/history');
  $('drawHistory').innerHTML = draws.map((d) =>
    `<p class="hint line">${new Date(d.createdAt).toLocaleString()} — ${esc(d.prize)}（消耗 ${d.cost} 金币）</p>`).join('')
    || '<p class="hint">暂无记录</p>';
}

// ---- 导航栏机器状态（与探针同步，30s 刷新） ----
async function syncMachines() {
  const chip = $('navMachines');
  try {
    const d = await api('/api/probe/servers');
    if (!d.configured) { chip.textContent = '未配置'; chip.className = 'machchip off'; return; }
    const total = d.servers.length;
    const online = d.servers.filter((s) => s.online).length;
    chip.textContent = `${online}/${total}`;
    chip.className = 'machchip ' + (online === 0 ? 'off' : online < total ? 'warn' : 'ok');
  } catch {
    chip.textContent = '--';
    chip.className = 'machchip off';
  }
}
$('navMachines').onclick = () => { showTab('probe'); syncMachines(); };
$('navDayNight').onclick = toggleDayNight;
syncMachines();
setInterval(syncMachines, 30000);

// ---- 机器状态（可嵌入） ----
function fmtBytes(n) {
  if (!n) return '0 B/s';
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 100 ? 0 : 1) + ' ' + u[i];
}
function fmtUptime(s) {
  if (!s) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d ? `${d}天${h}时` : `${h}时${Math.floor((s % 3600) / 60)}分`;
}
function bar(pct) {
  const color = pct > 90 ? '#e2574c' : pct > 70 ? '#e7c04a' : '#8dc63f';
  return `<div class="bar"><i style="width:${Math.min(100, pct)}%;background:${color}"></i></div>`;
}
function serverCard(s) {
  return `
  <div class="box probe-item">
    <div class="row" style="justify-content:space-between">
      <b><span class="dot ${s.online ? 'on' : 'off'}"></span>${esc(s.name)}
        <span class="mini-tag">${esc(s.os || '未知系统')} ${esc(s.arch || '')}</span></b>
      <span class="p-time">运行 ${s.online ? fmtUptime(s.uptime) : '离线'}</span>
    </div>
    <div class="metrics">
      <div><label>CPU ${s.cpuPercent.toFixed(1)}%</label>${bar(s.cpuPercent)}</div>
      <div><label>内存 ${s.memPercent.toFixed(1)}%</label>${bar(s.memPercent)}</div>
      <div><label>磁盘 ${s.diskPercent.toFixed(1)}%</label>${bar(s.diskPercent)}</div>
    </div>
    <p class="p-time">下行 ${fmtBytes(s.netIn)} · 上行 ${fmtBytes(s.netOut)}</p>
  </div>`;
}

async function renderProbeInto(el, hintEl) {
  el.innerHTML = '<p class="hint">加载中...</p>';
  let d;
  try { d = await api('/api/probe/servers'); }
  catch (e) { el.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  if (!d.configured) {
    if (hintEl) hintEl.textContent = d.hint || '未配置探针';
    el.innerHTML = '<p class="hint">未配置探针数据源，管理员可在后台「设置」里添加 komari / 哪吒 / ServerStatus</p>';
    return;
  }
  const bad = (d.sources || []).filter((s) => !s.ok).map((s) => s.name);
  if (hintEl) hintEl.textContent = bad.length
    ? `部分数据源异常：${bad.join('、')}`
    : `已接入 ${d.sources.length} 个探针面板，共 ${d.servers.length} 个节点`;
  el.innerHTML = (d.sources || []).map((src) => `
    <h3 class="sec-title">${esc(src.name)} <span class="mini-tag">${esc(src.provider)}</span>
      ${src.ok ? '' : `<span class="src-err">${esc(src.error || '获取失败')}</span>`}</h3>
    ${src.ok ? (src.servers.map(serverCard).join('') || '<p class="hint">暂无节点</p>') : ''}
  `).join('');
}

async function loadProbe() {
  $('probeHint').textContent = '加载中...';
  await renderProbeInto($('probeList'), $('probeHint'));
}
$('btnRefreshProbe').onclick = loadProbe;

// ---- MC 状态（可嵌入） ----
async function renderMcInto(el) {
  el.innerHTML = '<p class="hint">查询中...</p>';
  let servers;
  try { servers = (await api('/api/mc')).servers; }
  catch (e) { el.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  el.innerHTML = servers.map((s) => `
    <div class="box mc-card">
      <div><b><span class="dot ${s.online ? 'on' : 'off'}"></span>${esc(s.host)}:${s.port}</b>
        ${s.online ? `<p class="hint">${esc(s.motd)} · 版本 ${esc(s.version)}</p>` : '<p class="hint">服务器离线或未开启 Query</p>'}
      </div>
      ${s.online ? `<div style="font-size:1.4rem">${s.players}<small>/${s.maxPlayers}</small></div>` : ''}
    </div>`).join('') || '<p class="hint">未配置服务器</p>';
}

async function loadMc() {
  $('mcList').innerHTML = '<p class="hint">查询中...</p>';
  await renderMcInto($('mcList'));
}
$('btnRefreshMc').onclick = loadMc;

// ---- 主题系统 ----
let themes = [];
let editingThemeId = null;
let appliedThemeId = Number(localStorage.getItem('themeId')) || 1;

function applyTheme(id, css) {
  $('userTheme').textContent = css || '';
  appliedThemeId = id;
  localStorage.setItem('themeId', id);
  localStorage.setItem('themeCSS', css || '');
  renderDayNight();
}

// ---- 白天/夜晚一键切换（夜晚=预置暗色主题 id 2，白天=默认亮色 id 1） ----
const NIGHT_THEME_ID = 2;
function renderDayNight() {
  const btn = $('navDayNight');
  if (!btn) return;
  const isNight = appliedThemeId === NIGHT_THEME_ID;
  btn.textContent = isNight ? '☀️ 白天' : '🌙 夜晚';
  btn.title = isNight ? '切回白天（亮色）' : '切换到夜晚（暗色）';
}

async function toggleDayNight() {
  const targetId = appliedThemeId === NIGHT_THEME_ID ? 1 : NIGHT_THEME_ID;
  try {
    const ts = (await api('/api/themes')).themes;
    const t = ts.find((x) => x.id === targetId);
    if (t) applyTheme(t.id, t.css);
  } catch (e) { alert(e.message); }
}

(function bootTheme() {
  $('userTheme').textContent = localStorage.getItem('themeCSS') || '';
  renderDayNight();
})();

async function loadThemes() {
  const data = await api('/api/themes');
  themes = data.themes;
  if (!themes.some((t) => t.id === appliedThemeId)) applyTheme(1, '');

  $('themeList').innerHTML = themes.map((t) => {
    const mine = me && t.authorId === me.id;
    return `
    <div class="box theme-item">
      <div class="row" style="justify-content:space-between">
        <b>${esc(t.name)} ${t.id === appliedThemeId ? '<span class="mini-tag on-use">使用中</span>' : ''}${t.isDefault ? '<span class="mini-tag">预置</span>' : ''}</b>
        <div>
          <button class="primary" data-apply="${t.id}">应用</button>
          <button data-fork="${t.id}">复制编辑</button>
          ${mine ? `<button data-edit="${t.id}">编辑</button> <button class="danger" data-del="${t.id}">删除</button>` : ''}
        </div>
      </div>
      <pre class="csspeek">${esc((t.css || '/* 默认样式 */').slice(0, 120))}</pre>
    </div>`;
  }).join('') + (me
    ? `<button class="primary" id="btnNewTheme">从空白编写新主题</button>`
    : '<p class="hint">登录后可编写自己的主题</p>');

  $('themeList').querySelectorAll('button[data-apply]').forEach((b) =>
    b.onclick = () => {
      const t = themes.find((x) => x.id === Number(b.dataset.apply));
      applyTheme(t.id, t.css);
      loadThemes();
    });
  $('themeList').querySelectorAll('button[data-fork]').forEach((b) =>
    b.onclick = () => {
      const t = themes.find((x) => x.id === Number(b.dataset.fork));
      openThemeEditor(null, t.name + ' 副本', t.css);
    });
  $('themeList').querySelectorAll('button[data-edit]').forEach((b) => {
    const t = themes.find((x) => x.id === Number(b.dataset.edit));
    b.onclick = () => openThemeEditor(t.id, t.name, t.css);
  });
  $('themeList').querySelectorAll('button[data-del]').forEach((b) =>
    b.onclick = async () => {
      if (!confirm('删除该主题？')) return;
      try {
        await api('/api/themes/' + b.dataset.del, { method: 'DELETE' });
        if (Number(b.dataset.del) === appliedThemeId) applyTheme(1, '');
        loadThemes();
      } catch (e) { alert(e.message); }
    });
  const nt = $('btnNewTheme');
  if (nt) nt.onclick = () => openThemeEditor(null, '', '');
}

function openThemeEditor(id, name, css) {
  if (!me) { showTab('auth'); return; }
  editingThemeId = id;
  $('themeEditorTitle').textContent = id ? '编辑主题 #' + id : '编写新主题';
  $('themeName').value = name;
  $('themeCSS').value = css;
  $('themeEditor').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('btnThemePreview').onclick = () => {
  $('userTheme').textContent = $('themeCSS').value;
  alert('已预览（未保存）。点“还原当前主题”可撤销预览');
};
$('btnThemeReset').onclick = async () => {
  const t = (await api('/api/themes')).themes.find((x) => x.id === appliedThemeId);
  applyTheme(appliedThemeId, t ? t.css : '');
};
$('btnThemeCancel').onclick = () => $('themeEditor').classList.add('hidden');
$('btnThemeSave').onclick = async () => {
  try {
    const body = { name: $('themeName').value, css: $('themeCSS').value };
    if (editingThemeId) {
      await api('/api/themes/' + editingThemeId, { method: 'PUT', body });
    } else {
      const r = await api('/api/themes', { method: 'POST', body });
      applyTheme(r.theme.id, r.theme.css);
    }
    $('themeEditor').classList.add('hidden');
    loadThemes();
  } catch (e) { alert(e.message); }
};

// ---- 启动 ----
api('/api/site').then(({ name, reg }) => {
  if (name) {
    document.title = name;
    $('logoBtn').textContent = name;
  }
  if (reg) SITE_REG = reg;
  renderAuthForm();
}).catch(() => {});
api('/api/themes').then(({ themes: ts }) => {
  if (!ts.some((t) => t.id === appliedThemeId)) return applyTheme(1, '');
  // 缓存的主题 CSS 与服务器不一致时自动更新（主题被作者改过）
  const t = ts.find((x) => x.id === appliedThemeId);
  if (t && t.css !== (localStorage.getItem('themeCSS') || '')) applyTheme(t.id, t.css);
}).catch(() => {});
refreshMe().then(() => showTab('posts'));
