// 信任等级（模仿 Discourse）：L0 新用户 → L4 领袖
// L0-L3 按活跃度自动晋升，L4 仅管理员手动授予
const db = require('./db');

const LEVELS = [
  { name: '新用户', color: '#919191' },
  { name: '基础用户', color: '#2e9ce0' },
  { name: '成员', color: '#8dc63f' },
  { name: '活跃用户', color: '#9b59b6' },
  { name: '领袖', color: '#e7c04a' },
];

// 自动晋升条件（账号天数 / 话题数 / 回复数）
function autoLevel(days, topics, comments) {
  if (days >= 30 && (topics >= 15 || comments >= 60)) return 3;
  if (days >= 7 && (topics >= 5 || comments >= 20)) return 2;
  if (days >= 1 && (topics >= 1 || comments >= 3)) return 1;
  return 0;
}

// 重算某用户的等级：生效值 = max(自动, 管理员手动授予)
function refreshLevel(userId) {
  const u = db.find('users', (x) => x.id === userId);
  if (!u) return;
  const days = Math.floor((Date.now() - new Date(u.createdAt).getTime()) / 86400000);
  const topics = db.filter('posts', (p) => p.authorId === userId).length;
  const comments = db.filter('comments', (c) => c.userId === userId).length;
  const eff = Math.max(autoLevel(days, topics, comments), u.manualLevel || 0);
  if (eff !== u.level) db.update('users', u.id, { level: eff });
  return eff;
}

module.exports = { LEVELS, autoLevel, refreshLevel };
