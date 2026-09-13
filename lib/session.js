// 会话管理：Cookie + SQLite 持久化（重启不掉登录）
const crypto = require('crypto');
const db = require('./db');

class Session {
  constructor() {
    this.map = new Map(); // token -> { userId, expires, rowId }
  }

  // 服务启动时加载未过期会话
  init() {
    for (const s of db.get('sessions')) {
      if (Date.now() > s.expires) {
        db.remove('sessions', s.id);
      } else {
        this.map.set(s.token, { userId: s.userId, expires: s.expires, rowId: s.id });
      }
    }
  }

  create(userId) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires = Date.now() + 7 * 24 * 3600 * 1000;
    const row = db.insert('sessions', { token, userId, expires });
    this.map.set(token, { userId, expires, rowId: row.id });
    return token;
  }

  get(token) {
    if (!token) return null;
    const s = this.map.get(token);
    if (!s) return null;
    if (Date.now() > s.expires) {
      this.destroy(token);
      return null;
    }
    return { userId: s.userId };
  }

  destroy(token) {
    const s = this.map.get(token);
    if (s) {
      db.remove('sessions', s.rowId);
      this.map.delete(token);
    }
  }
}

module.exports = { Session };
