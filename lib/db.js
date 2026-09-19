// 存储层：SQLite（Node 内置 node:sqlite，零依赖），单文件数据库 data/blog.db
// 对上层暴露与旧版一致的内存式 API：get/find/filter/insert/update/remove/save
const fs = require('fs');
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error('[致命] 需要 Node 22.13+ 或 24+（内置 node:sqlite 模块），当前版本: ' + process.version);
  process.exit(1);
}

const { hashPassword } = require('./passwords');

const TABLES = ['users', 'posts', 'comments', 'shopItems', 'purchases', 'draws', 'lotteries', 'themes', 'settings', 'sessions', 'invites', 'verifications'];
const state = {};   // 各表数据缓存，如 state.posts
let sql = null;
let dataDir = null;

function t(table) { return 't_' + table; }

const SEEDS = {
  users: [],
  posts: [
    {
      title: '欢迎来到我的博客',
      content: '这是从零手写的 Node.js 博客第一篇文章。\n\n支持 Markdown 风格的纯文本、标签、评论等功能。',
      tags: ['公告'],
      category: '默认',
      authorId: null,
      createdAt: new Date().toISOString(),
    },
  ],
  comments: [],
  draws: [],
  lotteries: [],
  shopItems: [
    { name: '亲密度 +1', desc: '感谢支持博客运营！', price: 10 },
    { name: '自定义头衔', desc: '在评论区显示专属头衔', price: 50 },
    { name: '神秘礼物盒', desc: '随机获得一句鼓励的话', price: 100 },
  ],
  purchases: [],
  themes: [
    { name: '白天（默认亮色）', authorId: null, isDefault: true, css: '' },
    {
      name: '夜晚（暗色）', authorId: null, isDefault: false,
      css: `/* 夜晚（暗色）主题 */
:root { --blue:#4f8cff; --head:#0d1420; --text:#cfe0f5; --muted:#7d93a8; --line:#1d2c49; --hover:#1a2740; }
body { background:#0d1420; color:#cfe0f5; }
header { background:#0a0f1a; box-shadow:0 2px 4px rgba(0,0,0,.5); }
.box, .card { background:#141f36; border-color:#27395e; }
input, textarea { background:#0f1830; border-color:#27395e; color:#cfe0f5; }
.nav .nav-drop .drop-menu button { background:#141f36; color:#cfe0f5; }
.nav .nav-drop .drop-menu button:hover { background:#1d2c49; color:#6ea3ff; }
.drop-menu { background:#141f36; border-color:#27395e; }
.topics th { color:#7d93a8; border-color:#1d2c49; }
.topics td { border-color:#1d2c49; }
tr.topic-row:hover { background:#141f36; }
.topic-title { color:#cfe0f5; }
.d-post { border-color:#1d2c49; }
.reply-quote { background:#1d2c49; color:#9db8e0; }
.title-badge { background:#3a3020; color:#d8b878; }
.mini-tag { background:#1d2c49; color:#9db8e0; }
button { background:#1d2c49; color:#cfe0f5; }
button.primary { background:#4f8cff; color:#fff; }
button.danger { background:#d9534f; color:#fff; }
button.link-btn { background:none; color:#6ea3ff; }
.pills button { background:#1d2c49; color:#9db8e0; }
.pills button.on { background:#4f8cff; color:#fff; }
.embed { border-color:#27395e; }
.embed-label { background:#0f1830; border-color:#27395e; color:#7d93a8; }
.csspeek { background:#0f1830; border-color:#27395e; color:#7d93a8; }
.bar { background:#1d2c49; }
th, td { border-color:#1d2c49; }
footer { color:#7d93a8; }
/* 补漏：表格与抽奖框 */
table, .topics { background: transparent; }
.box-lottery { background:#1a2440; border-color:#4a4423; }
.box-lottery h3, .box-lottery p { color:#cfe0f5; }`,
    },
    {
      name: '羊皮纸', authorId: null, isDefault: false,
      css: `:root { --blue:#b3652d; --head:#5b4636; --text:#3d3229; --muted:#9a8a7a; --line:#e8ddd0; --hover:#f2eadf; }
body { background:#faf6f0; color:#3d3229; }
header { background:#5b4636; }
.box, .card { background:#fffdf8; border-color:#e8ddd0; }`,
    },
  ],
  settings: [],
  sessions: [],
};

// 旧版 JSON 文件自动导入 SQLite（仅当对应表为空），导入后改名 .bak 保留
function migrateLegacy(dir) {
  for (const tb of TABLES) {
    if (tb === 'sessions') continue; // 旧版会话本就不落盘
    const f = path.join(dir, tb + '.json');
    if (!fs.existsSync(f)) continue;
    if (state[tb].length === 0) {
      try {
        const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (Array.isArray(rows)) {
          rows.forEach((row) => {
            const keepId = row.id ? { _keepId: row.id } : {};
            const { id, ...rest } = row;
            db.insert(tb, Object.assign(rest, keepId));
          });
          console.log(`[迁移] ${tb}.json → SQLite（${rows.length} 条）`);
        }
      } catch (e) {
        console.error(`[迁移] ${tb}.json 解析失败，已跳过:`, e.message);
        continue;
      }
    }
    try { fs.renameSync(f, f + '.bak'); } catch {}
  }
}

const db = {
  async init(dir) {
    dataDir = dir;
    fs.mkdirSync(dir, { recursive: true });
    sql = new DatabaseSync(path.join(dir, 'blog.db'));
    sql.exec('PRAGMA journal_mode = WAL');
    sql.exec('PRAGMA busy_timeout = 3000');

    for (const tb of TABLES) {
      sql.exec(`CREATE TABLE IF NOT EXISTS ${t(tb)} (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)`);
      state[tb] = [];
      for (const r of sql.prepare(`SELECT id, data FROM ${t(tb)} ORDER BY id`).all()) {
        const obj = JSON.parse(r.data);
        obj.id = Number(r.id);
        state[tb].push(obj);
      }
    }

    migrateLegacy(dir);

    // 种子数据（仅表为空时写入）
    for (const tb of Object.keys(SEEDS)) {
      if (SEEDS[tb].length && state[tb].length === 0) SEEDS[tb].forEach((row) => db.insert(tb, row));
    }

    // 确保存在管理员账号（默认 admin/admin123）
    if (!state.users.some((u) => u.role === 'admin')) {
      const { salt, hash } = hashPassword('admin123');
      db.insert('users', {
        username: 'admin', salt, hash,
        coins: 999, title: '站长', role: 'admin',
        createdAt: new Date().toISOString(),
      });
      console.log('[初始化] 已创建管理员账号 admin/admin123，请尽快修改密码');
    }
  },

  get(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  },

  find(table, pred) {
    return this.get(table).find(pred);
  },

  filter(table, pred) {
    return this.get(table).filter(pred);
  },

  // 插入；{ _keepId } 可在导入旧数据时保留原 id
  insert(table, row) {
    const arr = this.get(table);
    const data = Object.assign({}, row);
    let targetId = null;
    if (data._keepId) { targetId = Number(data._keepId); delete data._keepId; }
    delete data.id;
    const info = targetId
      ? sql.prepare(`INSERT INTO ${t(table)} (id, data) VALUES (?, ?)`).run(targetId, JSON.stringify(data))
      : sql.prepare(`INSERT INTO ${t(table)} (data) VALUES (?)`).run(JSON.stringify(data));
    row.id = Number(info.lastInsertRowid);
    arr.push(row);
    return row;
  },

  update(table, id, patch) {
    const row = this.get(table).find((r) => r.id === id);
    if (!row) return undefined;
    Object.assign(row, patch);
    const data = Object.assign({}, row);
    delete data.id;
    sql.prepare(`UPDATE ${t(table)} SET data = ? WHERE id = ?`).run(JSON.stringify(data), id);
    return row;
  },

  remove(table, id) {
    const arr = this.get(table);
    const i = arr.findIndex((r) => r.id === id);
    if (i > -1) arr.splice(i, 1);
    sql.prepare(`DELETE FROM ${t(table)} WHERE id = ?`).run(id);
    return i > -1;
  },

  // 整表同步：用于路由直接修改缓存对象后的落盘（如抽奖状态）
  save(table) {
    const arr = this.get(table);
    sql.exec('BEGIN IMMEDIATE');
    try {
      sql.prepare(`DELETE FROM ${t(table)}`).run();
      const ins = sql.prepare(`INSERT INTO ${t(table)} (id, data) VALUES (?, ?)`);
      for (const row of arr) {
        const data = Object.assign({}, row);
        delete data.id;
        ins.run(row.id, JSON.stringify(data));
      }
      sql.exec('COMMIT');
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};

module.exports = db;
