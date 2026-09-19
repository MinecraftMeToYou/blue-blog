// 通知渠道：邮箱验证码（SMTP）与短信验证码（webhook 通道）
const settings = require('./settings');
const { sendMail } = require('./smtp');
const crypto = require('crypto');
const db = require('./db');

const CODE_TTL = 10 * 60 * 1000; // 10 分钟

// 生成并保存验证码；deliver=true 时实际发送
async function issueCode(type, target, userId, deliver) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.insert('verifications', {
    type, target, code, userId,
    expiresAt: Date.now() + CODE_TTL,
    used: false,
  });
  if (deliver) {
    if (type === 'email') {
      const cfg = settings.smtp();
      if (!cfg) throw new Error('SMTP 未配置，请联系管理员在后台设置');
      await sendMail(cfg, {
        to: target,
        subject: '邮箱验证码',
        text: `你的验证码是：${code}\n\n10 分钟内有效。如果不是本人操作，请忽略这封邮件。\n`,
      });
    } else if (type === 'phone') {
      const url = settings.smsWebhook();
      if (!url) throw new Error('短信通道未配置，请联系管理员在后台设置');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: target, code }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error('短信通道返回 ' + res.status);
    }
  }
  return code;
}

// 校验验证码：通过则标记已用
function checkCode(type, target, code, userId) {
  const c = db.find('verifications', (v) =>
    v.type === type && v.target === target && !v.used && v.userId === userId);
  if (!c) return '验证码不存在或已使用，请重新获取';
  if (Date.now() > c.expiresAt) return '验证码已过期，请重新获取';
  if (String(c.code) !== String(code).trim()) return '验证码错误';
  db.update('verifications', c.id, { used: true });
  return null;
}

module.exports = { issueCode, checkCode };
