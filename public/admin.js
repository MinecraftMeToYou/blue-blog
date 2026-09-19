// 管理后台逻辑
const $ = (id) => document.getElementById(id);

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

// ---- 登录 ----
$('btnAdminLogin').onclick = async () => {
  try {
    await api('/api/login', { method: 'POST', body: { username: $('aUser').value, password: $('aPass').value } });
    const { user } = await api('/api/me');
    if (user.role !== 'admin') {
      $('loginErr').textContent = '该账号不是管理员';
      await api('/api/logout', { method: 'POST' });
      return;
    }
    $('loginCard').classList.add('hidden');
    $('tabs').classList.remove('hidden');
    $('dash').classList.remove('hidden');
    showTab('overview');
  } catch (e) { $('loginErr').textContent = e.message; }
};

$('btnLogout').onclick = async () => location.reload();

// ---- 标签页 ----
const loaders = { overview: loadOverview, posts: loadPosts, comments: loadComments, users: loadUsers, shop: loadShop, settings: loadSettings };
function showTab(name) {
  ['Overview', 'Posts', 'Comments', 'Users', 'Shop', 'Settings'].forEach((t) =>
    $('tab' + t).classList.toggle('hidden', t.toLowerCase() !== name));
  document.querySelectorAll('#tabs button[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  loaders[name]();
}

// ---- 设置（探针数据源：komari / 哪吒 / ServerStatus） ----
const PROVIDERS = [['komari', 'komari'], ['nezha', 'Nezha v0'], ['serverstatus', 'ServerStatus']];
let srcList = [];

async function loadSettings() {
  const { settings } = await api('/api/admin/settings');

  // 站名
  const defName = 'MinecraftMeToYou的私人博客';
  $('siteNameInput').value = settings.site_name || defName;
  $('btnSaveSite').onclick = async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { site_name: $('siteNameInput').value } });
      $('siteMsg').textContent = '已保存';
      setTimeout(() => ($('siteMsg').textContent = ''), 2000);
    } catch (e) { $('siteMsg').textContent = e.message; }
  };

  srcList = [];
  try {
    const p = settings.probe_sources ? JSON.parse(settings.probe_sources) : null;
    if (Array.isArray(p)) srcList = p;
  } catch {}
  if (!srcList.length && settings.komari_url) {
    srcList = [{ name: 'komari', provider: 'komari', url: settings.komari_url, token: '' }];
  }
  if (!srcList.length) srcList = [{ name: '', provider: 'komari', url: '', token: '' }];
  renderSources();

  $('btnAddSrc').onclick = () => {
    srcList.push({ name: '', provider: 'komari', url: '', token: '' });
    renderSources();
  };
  $('btnSaveSettings').onclick = async () => {
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: { probe_sources: srcList.filter((s) => s.url.trim()), komari_url: '' },
      });
      $('settingsMsg').textContent = '已保存';
      setTimeout(() => ($('settingsMsg').textContent = ''), 2000);
    } catch (e) { $('settingsMsg').textContent = e.message; }
  };
}

function renderSources() {
  $('srcRows').innerHTML = srcList.map((s, i) => `
    <div class="row src-row" data-i="${i}" style="flex-wrap:nowrap">
      <select data-f="provider" style="width:130px">
        ${PROVIDERS.map(([v, label]) => `<option value="${v}" ${s.provider === v ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <input data-f="name" placeholder="显示名" value="${esc(s.name || '')}" style="width:110px">
      <input data-f="url" placeholder="http://面板地址" value="${esc(s.url || '')}" style="flex:1">
      <input data-f="token" placeholder="Token（可选）" value="${esc(s.token || '')}" style="width:150px">
      <button class="danger" data-del="${i}">删除</button>
    </div>`).join('') || '<p class="hint">暂无数据源</p>';

  $('srcRows').querySelectorAll('.src-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelectorAll('[data-f]').forEach((el) => {
      el.oninput = () => { srcList[i][el.dataset.f] = el.value; };
      el.onchange = el.oninput;
    });
    row.querySelector('button[data-del]').onclick = () => {
      srcList.splice(i, 1);
      renderSources();
    };
  });
}
document.querySelectorAll('#tabs button[data-tab]').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---- 概览 ----
async function loadOverview() {
  const s = await api('/api/admin/stats');
  $('statCards').innerHTML = [
    ['📝 文章', s.posts], ['💬 评论', s.comments], ['👥 用户', s.users],
    ['🛍 商品', s.shopItems], ['📦 订单', s.orders],
  ].map(([label, n]) => `<div class="card stat"><b>${n}</b><span>${label}</span></div>`).join('');
}

// ---- 文章管理 ----
async function loadPosts() {
  const { posts } = await api('/api/posts');
  $('tabPosts').innerHTML = `
    <div class="card hidden" id="pEdit">
      <h3>编辑文章 #<span id="pEditId"></span></h3>
      <input id="pEditTitle" placeholder="标题">
      <textarea id="pEditContent" rows="6" placeholder="内容"></textarea>
      <div class="row">
        <input id="pEditTags" placeholder="标签（逗号分隔）" style="flex:1">
        <input id="pEditCategory" placeholder="分类" style="flex:1">
      </div>
      <div class="row">
        <button id="pEditSave" class="primary">保存</button>
        <button id="pEditCancel" class="secondary">取消</button>
      </div>
    </div>
    <table>
      <tr><th>ID</th><th>标题</th><th>作者</th><th>分类</th><th>时间</th><th>操作</th></tr>
      ${posts.map((p) => `<tr>
        <td>${p.id}</td><td>${esc(p.title)}</td><td>${esc(p.authorName)}</td>
        <td>${esc(p.category)}</td><td>${new Date(p.createdAt).toLocaleString()}</td>
        <td>
          <button data-edit="${p.id}">编辑</button>
          <button class="danger" data-del="${p.id}">删除</button>
        </td>
      </tr>`).join('')}</table>`;

  const closeEdit = () => $('pEdit').classList.add('hidden');
  $('pEditCancel').onclick = closeEdit;
  $('pEditSave').onclick = async () => {
    try {
      await api('/api/admin/posts/' + $('pEditId').textContent, {
        method: 'PUT',
        body: {
          title: $('pEditTitle').value,
          content: $('pEditContent').value,
          tags: $('pEditTags').value,
          category: $('pEditCategory').value,
        },
      });
      closeEdit();
      loadPosts();
    } catch (e) { alert(e.message); }
  };

  $('tabPosts').querySelectorAll('button[data-edit]').forEach((b) =>
    b.onclick = () => {
      const p = posts.find((x) => x.id === Number(b.dataset.edit));
      $('pEditId').textContent = p.id;
      $('pEditTitle').value = p.title;
      $('pEditContent').value = p.content;
      $('pEditTags').value = (p.tags || []).join(',');
      $('pEditCategory').value = p.category;
      $('pEdit').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  $('tabPosts').querySelectorAll('button[data-del]').forEach((b) =>
    b.onclick = async () => {
      if (!confirm('删除该文章及其所有评论？')) return;
      await api('/api/admin/posts/' + b.dataset.del, { method: 'DELETE' });
      loadPosts();
    });
}

// ---- 评论管理 ----
async function loadComments() {
  // 汇总所有文章下的评论
  const { posts } = await api('/api/posts');
  const rows = [];
  for (const p of posts) {
    const { comments } = await api(`/api/posts/${p.id}`);
    comments.forEach((c) => rows.push({ ...c, postTitle: p.title }));
  }
  $('tabComments').innerHTML = rows.length ? `<table>
    <tr><th>ID</th><th>评论者</th><th>内容</th><th>文章</th><th>时间</th><th>操作</th></tr>
    ${rows.map((c) => `<tr>
      <td>${c.id}</td><td>${esc(c.username)}</td><td>${esc(c.content.slice(0, 40))}</td>
      <td>${esc(c.postTitle)}</td><td>${new Date(c.createdAt).toLocaleString()}</td>
      <td><button class="danger" data-del="${c.id}">删除</button></td>
    </tr>`).join('')}</table>` : '<p class="hint">暂无评论</p>';
  $('tabComments').querySelectorAll('button[data-del]').forEach((b) =>
    b.onclick = async () => {
      await api('/api/admin/comments/' + b.dataset.del, { method: 'DELETE' });
      loadComments();
    });
}

// ---- 用户管理 ----
async function loadUsers() {
  const { users } = await api('/api/admin/users');
  $('tabUsers').innerHTML = `<table>
    <tr><th>ID</th><th>用户名</th><th>金币</th><th>头衔</th><th>角色</th><th>操作</th></tr>
    ${users.map((u) => `<tr>
      <td>${u.id}</td><td>${esc(u.username)}</td><td>${u.coins}</td>
      <td>${esc(u.title) || '—'}</td><td>${u.role === 'admin' ? '管理员' : '用户'}</td>
      <td>
        <button data-act="coins" data-id="${u.id}" data-cur="${u.coins}">金币</button>
        <button data-act="title" data-id="${u.id}" data-cur="${esc(u.title)}">头衔</button>
        <button data-act="pass" data-id="${u.id}">改密</button>
        <button class="danger" data-act="del" data-id="${u.id}">删除</button>
      </td>
    </tr>`).join('')}</table>`;
  $('tabUsers').querySelectorAll('button[data-act]').forEach((b) => {
    const id = b.dataset.id;
    b.onclick = async () => {
      try {
        if (b.dataset.act === 'coins') {
          const v = prompt('新金币数量', b.dataset.cur);
          if (v === null) return;
          await api('/api/admin/users/' + id, { method: 'PUT', body: { coins: Number(v) } });
        } else if (b.dataset.act === 'title') {
          const v = prompt('新头衔（留空清除）', b.dataset.cur);
          if (v === null) return;
          await api('/api/admin/users/' + id, { method: 'PUT', body: { title: v } });
        } else if (b.dataset.act === 'pass') {
          const v = prompt('为该用户设置新密码（至少 6 位）');
          if (!v) return;
          await api('/api/admin/users/' + id, { method: 'PUT', body: { password: v } });
        } else if (b.dataset.act === 'del') {
          if (!confirm('删除该用户及其全部文章/评论/订单？')) return;
          await api('/api/admin/users/' + id, { method: 'DELETE' });
        }
        loadUsers();
      } catch (e) { alert(e.message); }
    };
  });
}

// ---- 商品管理 ----
async function loadShop() {
  const { items } = await api('/api/shop');
  $('tabShop').innerHTML = `
    <div class="card row" style="align-items:center">
      <input id="sName" placeholder="商品名" style="flex:1;margin:0">
      <input id="sDesc" placeholder="描述" style="flex:2;margin:0">
      <input id="sPrice" type="number" placeholder="价格" style="width:90px;margin:0">
      <button id="btnAddItem" class="primary">添加</button>
    </div>
    <table>
      <tr><th>ID</th><th>名称</th><th>描述</th><th>价格</th><th>操作</th></tr>
      ${items.map((i) => `<tr>
        <td>${i.id}</td><td>${esc(i.name)}</td><td>${esc(i.desc)}</td><td>🪙${i.price}</td>
        <td>
          <button data-act="edit" data-id="${i.id}">编辑</button>
          <button class="danger" data-act="del" data-id="${i.id}">删除</button>
        </td>
      </tr>`).join('')}</table>`;

  $('btnAddItem').onclick = async () => {
    try {
      await api('/api/admin/shop', {
        method: 'POST',
        body: { name: $('sName').value, desc: $('sDesc').value, price: Number($('sPrice').value) },
      });
      loadShop();
    } catch (e) { alert(e.message); }
  };
  $('tabShop').querySelectorAll('button[data-act]').forEach((b) => {
    const item = items.find((i) => i.id === Number(b.dataset.id));
    b.onclick = async () => {
      try {
        if (b.dataset.act === 'del') {
          if (!confirm('删除商品「' + item.name + '」？')) return;
          await api('/api/admin/shop/' + item.id, { method: 'DELETE' });
        } else {
          const name = prompt('商品名', item.name); if (name === null) return;
          const desc = prompt('描述', item.desc); if (desc === null) return;
          const price = prompt('价格', item.price); if (price === null) return;
          await api('/api/admin/shop/' + item.id, { method: 'PUT', body: { name, desc, price: Number(price) } });
        }
        loadShop();
      } catch (e) { alert(e.message); }
    };
  });
}
