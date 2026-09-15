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

// 相对时间：刚发帖显示“x 分钟”，更早显示日期
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

// ---- 标签页切换 ----
const panels = ['authPanel', 'postsPanel', 'postDetail', 'shopPanel', 'lotteryPanel', 'mcPanel', 'themesPanel', 'probePanel'];
function showTab(name) {
  panels.forEach((p) => $(p).classList.add('hidden'));
  const map = { posts: 'postsPanel', shop: 'shopPanel', mc: 'mcPanel', auth: 'authPanel', lottery: 'lotteryPanel', themes: 'themesPanel', probe: 'probePanel' };
  $(map[name]).classList.remove('hidden');
  document.querySelectorAll('.nav button[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'posts') loadPosts();
  if (name === 'shop') loadShop();
  if (name === 'lottery') loadLottery();
  if (name === 'mc') loadMc();
  if (name === 'themes') loadThemes();
  if (name === 'probe') loadProbe();
}
document.querySelectorAll('.nav button[data-tab]').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---- 认证 ----
async function refreshMe() {
  try { me = (await api('/api/me')).user; }
  catch { me = null; }
  renderUserBox();
}

function renderUserBox() {
  const box = $('userBox');
  $('navAuth').classList.toggle('hidden', !!me);
  $('btnNewPost').classList.toggle('hidden', !me);
  if (!me) $('editorCard').classList.add('hidden');
  if (me) {
    box.innerHTML = `<button class="user-btn">${avatar(me.username, 26)}<b>${esc(me.username)}</b><span class="u-coins">${me.coins} 金币</span><span class="u-quit">退出</span></button>`;
    box.querySelector('button').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      me = null; renderUserBox(); showTab('posts');
    };
  } else {
    box.innerHTML = '';
  }
}

$('btnLogin').onclick = async () => {
  try {
    me = (await api('/api/login', { method: 'POST', body: { username: $('authUser').value, password: $('authPass').value } })).user;
    renderUserBox(); showTab('posts');
  } catch (e) { alert(e.message); }
};

$('btnRegister').onclick = async () => {
  try {
    me = (await api('/api/register', { method: 'POST', body: { username: $('authUser').value, password: $('authPass').value } })).user;
    renderUserBox(); showTab('posts');
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
            <span class="p-time">#1 · ${timeAgo(post.createdAt)}</span>
            ${canEdit ? `<span class="p-ops"><button data-act="edit">编辑</button><button class="danger" data-act="del">删除</button></span>` : ''}
          </div>
          <div class="d-post-body">${esc(post.content)}</div>
        </div>
      </div>
      ${comments.map((c, i) => `
      <div class="d-post">
        ${avatar(c.username)}
        <div class="d-post-main">
          <div class="d-post-info">
            <b>${esc(c.username)}</b>
            ${c.userTitle ? `<span class="title-badge">${esc(c.userTitle)}</span>` : ''}
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

// ---- 商店 ----
async function loadShop() {
  const { items } = await api('/api/shop');
  $('shopCoins').textContent = me ? `我的金币：${me.coins}` : '登录后可购买';
  $('shopList').innerHTML = items.map((i) => `
    <div class="box shop-item">
      <div><b>${esc(i.name)}</b><p class="hint">${esc(i.desc)}</p></div>
      <div class="shop-buy">${i.price} 金币 <button class="primary" data-id="${i.id}">购买</button></div>
    </div>`).join('');
  $('shopList').querySelectorAll('button[data-id]').forEach((b) =>
    b.onclick = async () => {
      try {
        const r = await api(`/api/shop/${b.dataset.id}/buy`, { method: 'POST' });
        me.coins = r.coins; renderUserBox(); loadShop();
      } catch (e) { alert(e.message); }
    });
  if (me) {
    const { orders } = await api('/api/purchases');
    $('orderList').innerHTML = orders.map((o) =>
      `<p class="hint line">${new Date(o.createdAt).toLocaleString()} — ${esc(o.itemName)}（${o.price} 金币）</p>`).join('') || '<p class="hint">暂无订单</p>';
  } else $('orderList').innerHTML = '';
}

// ---- 抽奖 ----
let poolLabels = [];
async function loadLottery() {
  const { pool } = await api('/api/lottery');
  poolLabels = pool.map((p) => p.label);
  $('poolList').innerHTML = pool.map((p) =>
    `<span class="mini-tag pool-item">${esc(p.label)} ${p.weight}%</span>`).join('');
  loadDrawHistory();
}

async function loadDrawHistory() {
  if (!me) { $('drawHistory').innerHTML = '<p class="hint">登录后可参与抽奖</p>'; return; }
  const { draws } = await api('/api/lottery/history');
  $('drawHistory').innerHTML = draws.map((d) =>
    `<p class="hint line">${new Date(d.createdAt).toLocaleString()} — ${esc(d.prize)}（消耗 ${d.cost} 金币）</p>`).join('')
    || '<p class="hint">暂无记录</p>';
}

$('btnDraw').onclick = async () => {
  try {
    $('btnDraw').disabled = true;
    $('drawResult').textContent = '抽奖中...';
    const r = await api('/api/lottery/draw', { method: 'POST' });
    let i = 0;
    const timer = setInterval(() => {
      $('drawResult').textContent = poolLabels[i++ % poolLabels.length];
    }, 80);
    setTimeout(() => {
      clearInterval(timer);
      $('drawResult').textContent = `恭喜获得：${r.prize}`;
      $('btnDraw').disabled = false;
      refreshMe();
      loadDrawHistory();
    }, 900);
  } catch (e) {
    $('drawResult').textContent = e.message;
    $('btnDraw').disabled = false;
  }
};

// ---- 导航栏机器状态（与探针同步，30s 刷新） ----
let probeTimer = null;
async function syncMachines() {
  const chip = $('navMachines');
  try {
    const d = await api('/api/probe/servers');
    if (!d.configured) { chip.textContent = '未配置'; chip.className = 'machchip off'; }
    else if (d.error || (d.sources || []).some((s) => !s.ok)) {
      const total = d.servers.length, online = d.servers.filter((s) => s.online).length;
      chip.textContent = `${online}/${total}`;
      chip.className = 'machchip ' + (total && online === total ? 'ok' : 'off');
    } else {
      const total = d.servers.length;
      const online = d.servers.filter((s) => s.online).length;
      chip.textContent = `${online}/${total}`;
      chip.className = 'machchip ' + (online === 0 ? 'off' : online < total ? 'warn' : 'ok');
    }
  } catch {
    chip.textContent = '--';
    chip.className = 'machchip off';
  }
}
$('navMachines').onclick = () => { showTab('probe'); syncMachines(); };
syncMachines();
probeTimer = setInterval(syncMachines, 30000);

// ---- 机器状态页（多数据源分组展示） ----
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

async function loadProbe() {
  $('probeHint').textContent = '加载中...';
  const d = await api('/api/probe/servers');
  if (!d.configured) {
    $('probeHint').textContent = d.hint || '未配置探针';
    $('probeList').innerHTML = '';
    return;
  }
  const bad = (d.sources || []).filter((s) => !s.ok).map((s) => s.name);
  $('probeHint').textContent = bad.length
    ? `部分数据源异常：${bad.join('、')}`
    : `已接入 ${d.sources.length} 个探针面板，共 ${d.servers.length} 个节点`;
  $('probeList').innerHTML = (d.sources || []).map((src) => `
    <h3 class="sec-title">${esc(src.name)} <span class="mini-tag">${esc(src.provider)}</span>
      ${src.ok ? '' : `<span class="src-err">${esc(src.error || '获取失败')}</span>`}</h3>
    ${src.ok ? (src.servers.map(serverCard).join('') || '<p class="hint">暂无节点</p>') : ''}
  `).join('');
}
$('btnRefreshProbe').onclick = loadProbe;

// ---- MC 状态 ----
async function loadMc() {
  $('mcList').innerHTML = '<p class="hint">查询中...</p>';
  const { servers } = await api('/api/mc');
  $('mcList').innerHTML = servers.map((s) => `
    <div class="box mc-card">
      <div><b><span class="dot ${s.online ? 'on' : 'off'}"></span>${esc(s.host)}:${s.port}</b>
        ${s.online ? `<p class="hint">${esc(s.motd)} · 版本 ${esc(s.version)}</p>` : '<p class="hint">服务器离线或未开启 Query</p>'}
      </div>
      ${s.online ? `<div style="font-size:1.4rem">${s.players}<small>/${s.maxPlayers}</small></div>` : ''}
    </div>`).join('');
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
}

(function bootTheme() {
  $('userTheme').textContent = localStorage.getItem('themeCSS') || '';
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
api('/api/themes').then(({ themes: ts }) => {
  if (!ts.some((t) => t.id === appliedThemeId)) applyTheme(1, '');
}).catch(() => {});
refreshMe().then(() => showTab('posts'));
