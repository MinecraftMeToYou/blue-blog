// 前端单页应用逻辑
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

// ---- 标签页切换 ----
const panels = ['authPanel', 'postsPanel', 'postDetail', 'shopPanel', 'lotteryPanel', 'mcPanel', 'themesPanel', 'probePanel'];
function showTab(name) {
  panels.forEach((p) => $(p).classList.add('hidden'));
  const map = { posts: 'postsPanel', shop: 'shopPanel', mc: 'mcPanel', auth: 'authPanel', lottery: 'lotteryPanel', themes: 'themesPanel', probe: 'probePanel' };
  $(map[name]).classList.remove('hidden');
  document.querySelectorAll('nav button[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'posts') loadPosts();
  if (name === 'shop') loadShop();
  if (name === 'lottery') loadLottery();
  if (name === 'mc') loadMc();
  if (name === 'themes') loadThemes();
  if (name === 'probe') loadProbe();
}

document.querySelectorAll('nav button[data-tab]').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---- 认证 ----
async function refreshMe() {
  try { me = (await api('/api/me')).user; }
  catch { me = null; }
  renderUserBox();
}

function renderUserBox() {
  const box = $('userBox');
  // 导航栏"登录/注册"标签：未登录显示，登录后隐藏
  $('navAuth').classList.toggle('hidden', !!me);
  if (me) {
    box.innerHTML = `<button>👤 ${esc(me.username)}（🪙${me.coins}）· 退出</button>`;
    box.querySelector('button').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      me = null; renderUserBox(); showTab('posts');
    };
    $('btnNewPost').classList.remove('hidden');
  } else {
    box.innerHTML = '';
    $('btnNewPost').classList.add('hidden');
    $('editorCard').classList.add('hidden');
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

// ---- 文章 ----
async function loadPosts() {
  const { posts } = await api('/api/posts' + (activeTag ? `?tag=${encodeURIComponent(activeTag)}` : ''));
  const { tags } = await api('/api/tags');
  $('tagBar').innerHTML = `<button class="${!activeTag ? 'on' : ''}" data-t="">全部</button>` +
    tags.map((t) => `<button class="${activeTag === t ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('');
  $('tagBar').querySelectorAll('button').forEach((b) =>
    b.onclick = () => { activeTag = b.dataset.t; loadPosts(); });

  $('postList').innerHTML = posts.length ? posts.map((p) => `
    <div class="card post-item">
      <h3 data-id="${p.id}">${esc(p.title)}</h3>
      <div>${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="meta">✍️ ${esc(p.authorName)} · 📁 ${esc(p.category)} · ${new Date(p.createdAt).toLocaleString()}</div>
    </div>`).join('')
    : '<p class="hint">暂无文章</p>';
  $('postList').querySelectorAll('h3').forEach((h) =>
    h.onclick = () => openPost(h.dataset.id));
}

$('btnNewPost').onclick = () => {
  editingId = null;
  $('editorTitle').textContent = '写文章';
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

async function openPost(id) {
  const { post, comments, lottery } = await api(`/api/posts/${id}`);
  const canEdit = me && post.authorId === me.id;
  let replyTo = null;       // 正在回复的评论 id
  let replyToName = '';

  // ---- 文章抽奖卡片 ----
  function lotteryCard() {
    if (lottery) {
      const joined = me && lottery.participants.some((p) => p.userId === me.id);
      const isStarter = me && me.id === lottery.authorId;
      const canJoin = me && !isStarter && !joined && !lottery.closed;
      const winnerNames = lottery.participants.filter((p) => p.won).map((p) => p.username);
      return `
      <div class="card" style="border:2px dashed #ffd54a; background:#fffdf3">
        <h3>🎁 文章抽奖 ${lottery.closed ? '（已结束）' : '（进行中）'}</h3>
        <p style="margin:8px 0">单份奖金 🪙${lottery.perWinner} × 剩余 ${lottery.winnersLeft}/${lottery.winners} 份 ·
          已参与 ${lottery.maxDraws - lottery.drawsLeft}/${lottery.maxDraws} 人</p>
        ${lottery.winners - lottery.winnersLeft > 0 ? `<p>🎉 已中奖：${esc(winnerNames.join('、'))}</p>` : ''}
        ${canJoin ? `<button id="btnJoinLottery" class="primary">🎲 立即抽奖</button>` : ''}
        ${joined ? '<p class="hint">你已参与过本次抽奖</p>' : ''}
        ${me && !isStarter && !joined && lottery.closed ? '<p class="hint">来晚一步，抽奖已结束</p>' : ''}
        ${isStarter ? `<button id="btnCancelLottery" class="danger">撤销抽奖（退回 🪙${lottery.winnersLeft * lottery.perWinner}）</button>
          <p class="hint">你是发起人，不能参与自己的抽奖</p>` : ''}
        <p id="lotteryMsg" style="font-size:1.1rem;margin-top:8px"></p>
      </div>`;
    }
    if (canEdit) {
      return `
      <div class="card" style="border:2px dashed #cfe8ff; background:#fbfdff">
        <h3>🎁 发起文章抽奖</h3>
        <div class="row" style="align-items:center">
          <label>中奖名额 <input id="lw" type="number" value="3" min="1" style="width:70px;margin:0"></label>
          <label>单份奖金 <input id="lp" type="number" value="10" min="1" style="width:70px;margin:0"></label>
          <label>参与上限 <input id="lm" type="number" value="10" min="1" style="width:70px;margin:0"></label>
        </div>
        <p class="hint">发起即冻结 名额×奖金 金币作奖池，读者在文章页抽取；未抽出的部分可撤销退回；发起人本人不能参与</p>
        <button id="btnCreateLottery" class="primary">发起抽奖</button>
        <p id="lotteryMsg" class="hint"></p>
      </div>`;
    }
    return '';
  }

  function setReply(cid, name) {
    replyTo = cid;
    replyToName = name || '';
    const hint = $('replyHint');
    if (hint) {
      hint.innerHTML = cid ? `↪ 回复 @${esc(name)} <button data-cancel="1">取消</button>` : '';
      const btn = hint.querySelector('button');
      if (btn) btn.onclick = () => setReply(null);
    }
    if ($('cmtInput')) $('cmtInput').placeholder = cid ? `回复 @${name}...` : '写下你的评论...';
  }

  $('postDetail').innerHTML = `
    <div class="card">
      <button class="secondary" onclick="showTab('posts')">← 返回列表</button>
      <h2 style="margin:12px 0">${esc(post.title)}</h2>
      <div>${(post.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">📁 ${esc(post.category)}</span></div>
      <p style="white-space:pre-wrap;margin:16px 0;line-height:1.7">${esc(post.content)}</p>
      <div class="meta">✍️ ${esc(post.authorName)} · ${new Date(post.createdAt).toLocaleString()}
        ${canEdit ? ` <button data-act="edit">编辑</button> <button class="danger" data-act="del">删除</button>` : ''}
      </div>
    </div>
    ${lotteryCard()}
    <div class="card">
      <h3>评论（${comments.length}）</h3>
      <div id="cmts">${comments.map((c) => `
        <div class="comment">
          <b>${esc(c.username)}</b>${c.userTitle ? `<span class="tag">${esc(c.userTitle)}</span>` : ''}
          ${c.replyTo ? `<span class="tag">↪ 回复 @${esc(c.replyToName)}</span>` : ''}
          <p style="margin-top:4px">${esc(c.content)}</p>
          <div class="meta">${new Date(c.createdAt).toLocaleString()}
            ${me ? ` <button data-act="reply" data-cid="${c.id}" data-name="${esc(c.username)}">回复</button>` : ''}
            ${(me && (c.userId === me.id || canEdit)) ? `<button class="danger" data-cid="${c.id}" data-act="delcmt">删除</button>` : ''}
          </div>
        </div>`).join('') || '<p class="hint">还没有评论</p>'}
      </div>
      ${me ? `<p id="replyHint" class="hint"></p>
        <div class="row"><input id="cmtInput" placeholder="写下你的评论..." style="flex:1;margin:0">
        <button id="btnCmt" class="primary">发送</button></div>`
        : '<p class="hint">登录后才能评论</p>'}
    </div>`;
  panels.forEach((p) => $(p).classList.add('hidden'));
  $('postDetail').classList.remove('hidden');

  // 抽奖按钮事件
  const joinBtn = $('btnJoinLottery');
  if (joinBtn) joinBtn.onclick = async () => {
    try {
      joinBtn.disabled = true;
      const r = await api(`/api/posts/${id}/lottery/draw`, { method: 'POST' });
      $('lotteryMsg').textContent = r.won ? `🎉 恭喜中奖 +🪙${r.prize}！` : ' :( 很遗憾，未中奖';
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
      alert(`已撤销，退回 🪙${r.refunded}`);
      refreshMe();
      openPost(id);
    } catch (e) { alert(e.message); }
  };

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
    if (b.dataset.act === 'reply') b.onclick = () => setReply(Number(b.dataset.cid), b.dataset.name);
    if (b.dataset.act === 'del') b.onclick = async () => {
      if (!confirm('确定删除这篇文章？')) return;
      await api(`/api/posts/${id}`, { method: 'DELETE' }); showTab('posts');
    };
    if (b.dataset.act === 'edit') b.onclick = () => {
      editingId = id;
      $('editorTitle').textContent = '编辑文章';
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
  $('shopCoins').textContent = me ? `我的金币：🪙 ${me.coins}` : '登录后可购买';
  $('shopList').innerHTML = items.map((i) => `
    <div class="card shop-item">
      <div><b>${esc(i.name)}</b><p class="hint">${esc(i.desc)}</p></div>
      <div>🪙${i.price} <button class="primary" data-id="${i.id}">购买</button></div>
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
      `<p class="meta">${new Date(o.createdAt).toLocaleString()} — ${esc(o.itemName)}（🪙${o.price}）</p>`).join('') || '<p class="hint">暂无订单</p>';
  } else $('orderList').innerHTML = '';
}

// ---- 抽奖 ----
let poolLabels = [];
async function loadLottery() {
  const { pool } = await api('/api/lottery');
  poolLabels = pool.map((p) => p.label);
  $('poolList').innerHTML = pool.map((p) =>
    `<span class="tag">${esc(p.label)} <small>${p.weight}%</small></span>`).join('');
  loadDrawHistory();
}

async function loadDrawHistory() {
  if (!me) { $('drawHistory').innerHTML = '<p class="hint">登录后可参与抽奖</p>'; return; }
  const { draws } = await api('/api/lottery/history');
  $('drawHistory').innerHTML = draws.map((d) =>
    `<p class="meta">${new Date(d.createdAt).toLocaleString()} — ${esc(d.prize)}（消耗 🪙${d.cost}）</p>`).join('')
    || '<p class="hint">暂无记录</p>';
}

$('btnDraw').onclick = async () => {
  try {
    $('btnDraw').disabled = true;
    $('drawResult').textContent = '🎲 抽奖中...';
    const r = await api('/api/lottery/draw', { method: 'POST' });
    // 转动效果：快速滚动奖池文案
    let i = 0;
    const timer = setInterval(() => {
      $('drawResult').textContent = '🎲 ' + poolLabels[i++ % poolLabels.length];
    }, 80);
    setTimeout(() => {
      clearInterval(timer);
      $('drawResult').textContent = `🎉 恭喜获得：${r.prize}`;
      $('btnDraw').disabled = false;
      refreshMe();
      loadDrawHistory();
    }, 900);
  } catch (e) {
    $('drawResult').textContent = e.message;
    $('btnDraw').disabled = false;
  }
};

// ---- 主题系统 ----
let themes = [];
let editingThemeId = null;   // 正在编辑的主题 id（null = 新建）
let appliedThemeId = Number(localStorage.getItem('themeId')) || 1;

function applyTheme(id, css) {
  $('userTheme').textContent = css || '';
  appliedThemeId = id;
  localStorage.setItem('themeId', id);
  localStorage.setItem('themeCSS', css || '');
}

// 启动时先应用本地缓存（避免闪烁），再与服务器同步
(function bootTheme() {
  $('userTheme').textContent = localStorage.getItem('themeCSS') || '';
})();

async function loadThemes() {
  const data = await api('/api/themes');
  themes = data.themes;
  // 本地主题已被删除则回退默认
  if (!themes.some((t) => t.id === appliedThemeId)) applyTheme(1, '');
  const cur = themes.find((t) => t.id === appliedThemeId);
  const curCss = cur ? cur.css : '';

  $('themeList').innerHTML = themes.map((t) => {
    const mine = me && t.authorId === me.id;
    return `
    <div class="card theme-item">
      <div class="row" style="justify-content:space-between">
        <b>${esc(t.name)} ${t.id === appliedThemeId ? '<span class="tag">使用中</span>' : ''}${t.isDefault ? '<span class="tag">预置</span>' : ''}</b>
        <div>
          <button class="primary" data-apply="${t.id}">应用</button>
          <button data-fork="${t.id}">复制编辑</button>
          ${mine ? `<button data-edit="${t.id}">编辑</button> <button class="danger" data-del="${t.id}">删除</button>` : ''}
        </div>
      </div>
      <pre class="csspeek">${esc((t.css || '/* 基础蔚蓝档案样式 */').slice(0, 120))}</pre>
    </div>`;
  }).join('') + (me
    ? `<button class="primary" id="btnNewTheme">✏️ 从空白编写新主题</button>`
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
  void curCss;
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

// ---- 探针（komari） ----
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
  const color = pct > 90 ? '#ff6b81' : pct > 70 ? '#ffd54a' : '#2fd07f';
  return `<div class="bar"><i style="width:${Math.min(100, pct)}%;background:${color}"></i></div>`;
}

async function loadProbe() {
  $('probeHint').textContent = '加载中...';
  const data = await api('/api/probe/servers');
  $('probeHint').textContent = data.hint || (data.error ? data.error : `数据源：${data.base} · 数据来自 komari 探针面板`);
  $('probeList').innerHTML = data.servers.length ? data.servers.map((s) => `
    <div class="card probe-item">
      <div class="row" style="justify-content:space-between">
        <b><span class="dot ${s.online ? 'on' : 'off'}"></span>${esc(s.name)}
          <span class="tag">${esc(s.os || '未知系统')} ${esc(s.arch || '')}</span></b>
        <span class="meta">⏱ ${s.online ? fmtUptime(s.uptime) : '离线'}</span>
      </div>
      <div class="metrics">
        <div><label>CPU ${s.cpuPercent.toFixed(1)}%</label>${bar(s.cpuPercent)}</div>
        <div><label>内存 ${s.memPercent.toFixed(1)}%</label>${bar(s.memPercent)}</div>
        <div><label>磁盘 ${s.diskPercent.toFixed(1)}%</label>${bar(s.diskPercent)}</div>
      </div>
      <div class="meta">⬇️ ${fmtBytes(s.netIn)} · ⬆️ ${fmtBytes(s.netOut)}</div>
    </div>`).join('') : '<p class="hint">暂无节点数据</p>';
}
$('btnRefreshProbe').onclick = loadProbe;

// ---- 导航栏机器状态小组件（与 komari 同步，30s 自动刷新） ----
let probeTimer = null;
async function syncMachines() {
  const chip = $('navMachines');
  try {
    const d = await api('/api/probe/servers');
    if (!d.configured) {
      chip.textContent = '🖥 未配置';
      chip.className = 'machchip off';
    } else if (d.error) {
      chip.textContent = '🖥 同步失败';
      chip.className = 'machchip off';
    } else {
      const total = d.servers.length;
      const online = d.servers.filter((s) => s.online).length;
      chip.textContent = `🖥 ${online}/${total}`;
      chip.className = 'machchip ' + (online === 0 ? 'off' : online < total ? 'warn' : 'ok');
    }
  } catch {
    chip.textContent = '🖥 --';
    chip.className = 'machchip off';
  }
}
$('navMachines').onclick = () => {
  showTab('probe');
  syncMachines();
};
syncMachines();
probeTimer = setInterval(syncMachines, 30000);

// ---- MC 状态 ----
async function loadMc() {
  $('mcList').innerHTML = '<p class="hint">查询中...</p>';
  const { servers } = await api('/api/mc');
  $('mcList').innerHTML = servers.map((s) => `
    <div class="card mc-card">
      <div><b><span class="dot ${s.online ? 'on' : 'off'}"></span>${esc(s.host)}:${s.port}</b>
        ${s.online ? `<p class="hint">${esc(s.motd)} · 版本 ${esc(s.version)}</p>` : '<p class="hint">服务器离线或未开启 Query</p>'}
      </div>
      ${s.online ? `<div style="font-size:1.4rem">${s.players}<small>/${s.maxPlayers}</small></div>` : ''}
    </div>`).join('');
}
$('btnRefreshMc').onclick = loadMc;

// ---- 启动 ----
// 恢复上次主题（同步服务器确认仍存在）
api('/api/themes').then(({ themes: ts }) => {
  if (!ts.some((t) => t.id === appliedThemeId)) applyTheme(1, '');
}).catch(() => {});
refreshMe().then(() => showTab('posts'));
