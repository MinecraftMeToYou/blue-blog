// 抽奖系统：花金币抽奖，随机获得金币或专属头衔
const db = require('../lib/db');
const { send, requireLogin, requireActive } = require('../lib/respond');

const COST = 20;
// 权重总和恰好为 100，可直接当百分比展示
const POOL = [
  { type: 'coins', amount: 0, label: '谢谢参与', weight: 35 },
  { type: 'coins', amount: 5, label: '金币 +5', weight: 25 },
  { type: 'coins', amount: 10, label: '金币 +10', weight: 18 },
  { type: 'coins', amount: 50, label: '金币 +50', weight: 12 },
  { type: 'coins', amount: 200, label: '金币 +200', weight: 5 },
  { type: 'title', value: '欧皇本皇', label: '头衔「欧皇本皇」', weight: 4 },
  { type: 'title', value: '超级锦鲤', label: '头衔「超级锦鲤」', weight: 1 },
];

function draw() {
  let r = Math.random() * POOL.reduce((s, p) => s + p.weight, 0);
  for (const p of POOL) if ((r -= p.weight) < 0) return p;
  return POOL[0];
}

module.exports.register = (router) => {
  // 奖池信息
  router.get('/api/lottery', (ctx) => {
    send(ctx, 200, { cost: COST, pool: POOL.map(({ label, weight }) => ({ label, weight })) });
  });

  // 抽一次
  router.post('/api/lottery/draw', (ctx) => {
    if (!requireActive(ctx)) return;
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    if (user.coins < COST) return send(ctx, 400, { error: `金币不足，抽奖需要 ${COST} 金币` });
    const prize = draw();
    const patch = { coins: user.coins - COST };
    if (prize.type === 'coins') patch.coins += prize.amount;
    if (prize.type === 'title') patch.title = prize.value;
    db.update('users', user.id, patch);
    const record = db.insert('draws', {
      userId: user.id, prize: prize.label, type: prize.type, cost: COST,
      createdAt: new Date().toISOString(),
    });
    send(ctx, 200, { prize: prize.label, coins: patch.coins, record });
  });

  // 我的抽奖记录
  router.get('/api/lottery/history', (ctx) => {
    if (!requireLogin(ctx)) return;
    send(ctx, 200, { draws: db.filter('draws', (d) => d.userId === ctx.user.userId).reverse() });
  });

  // ---- 文章抽奖：作者发起，读者参与 ----

  // 发起抽奖（冻结 名额×奖金 金币作为奖池）
  router.post('/api/posts/:id/lottery', (ctx) => {
    if (!requireLogin(ctx)) return;
    const post = db.find('posts', (p) => p.id === Number(ctx.params.id));
    if (!post) return send(ctx, 404, { error: '文章不存在' });
    if (post.authorId !== ctx.user.userId) return send(ctx, 403, { error: '只有文章作者能发起抽奖' });
    if (db.find('lotteries', (l) => l.postId === post.id)) return send(ctx, 409, { error: '该文章已有抽奖' });

    const winners = Math.floor(Number(ctx.body.winners));
    const perWinner = Math.floor(Number(ctx.body.perWinner));
    const maxDraws = Math.floor(Number(ctx.body.maxDraws));
    if (!(winners > 0) || !(perWinner > 0) || !(maxDraws >= winners)) {
      return send(ctx, 400, { error: '参数无效：名额、奖金需为正整数，参与上限不小于名额' });
    }
    const cost = winners * perWinner;
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    if (user.coins < cost) return send(ctx, 400, { error: `金币不足，发起需要冻结 ${cost} 金币` });

    db.update('users', user.id, { coins: user.coins - cost });
    const lottery = db.insert('lotteries', {
      postId: post.id, authorId: user.id,
      winners, perWinner, maxDraws,
      winnersLeft: winners, drawsLeft: maxDraws,
      closed: false, participants: [],
      createdAt: new Date().toISOString(),
    });
    send(ctx, 201, { lottery });
  });

  // 参与抽奖（每人限一次，发起人除外）
  // 中奖概率 = 剩余名额 / 剩余参与次数，保证名额必然用完
  router.post('/api/posts/:id/lottery/draw', (ctx) => {
    if (!requireLogin(ctx)) return;
    const post = db.find('posts', (p) => p.id === Number(ctx.params.id));
    if (!post) return send(ctx, 404, { error: '文章不存在' });
    const l = db.find('lotteries', (x) => x.postId === post.id);
    if (!l) return send(ctx, 404, { error: '该文章没有抽奖' });
    if (l.authorId === ctx.user.userId) return send(ctx, 403, { error: '发起人不能参与自己的抽奖' });
    if (l.participants.some((p) => p.userId === ctx.user.userId)) return send(ctx, 409, { error: '你已经参与过了' });
    if (l.closed || l.drawsLeft <= 0 || l.winnersLeft <= 0) return send(ctx, 400, { error: '抽奖已结束' });

    const user = db.find('users', (u) => u.id === ctx.user.userId);
    const won = Math.random() < l.winnersLeft / l.drawsLeft;
    let coins = user.coins;
    if (won) {
      coins += l.perWinner;
      db.update('users', user.id, { coins });
      l.winnersLeft--;
    }
    l.drawsLeft--;
    l.participants.push({ userId: user.id, username: user.username, won, at: new Date().toISOString() });
    if (l.drawsLeft <= 0 || l.winnersLeft <= 0) l.closed = true;
    db.save('lotteries');
    send(ctx, 200, { won, coins, prize: won ? l.perWinner : 0 });
  });

  // 撤销抽奖（仅发起人），退还未抽出的奖金
  router.delete('/api/posts/:id/lottery', (ctx) => {
    if (!requireLogin(ctx)) return;
    const l = db.find('lotteries', (x) => x.postId === Number(ctx.params.id));
    if (!l) return send(ctx, 404, { error: '该文章没有抽奖' });
    if (l.authorId !== ctx.user.userId) return send(ctx, 403, { error: '只有发起人能撤销抽奖' });
    const refunded = l.winnersLeft * l.perWinner;
    refundLottery(l.id);
    send(ctx, 200, { ok: true, refunded });
  });
};

// 撤销/删除抽奖并退还未抽出的奖金（文章被删时也调用）
function refundLottery(lotteryId) {
  const l = db.find('lotteries', (x) => x.id === lotteryId);
  if (!l) return;
  const refund = l.winnersLeft * l.perWinner;
  if (refund > 0) {
    const author = db.find('users', (u) => u.id === l.authorId);
    if (author) db.update('users', author.id, { coins: author.coins + refund });
  }
  db.remove('lotteries', lotteryId);
}
module.exports.refundLottery = refundLottery;

// 对外展示视图（含参与者名单）
module.exports.publicView = (l) => ({
  id: l.id, postId: l.postId, authorId: l.authorId,
  winners: l.winners, perWinner: l.perWinner, maxDraws: l.maxDraws,
  winnersLeft: l.winnersLeft, drawsLeft: l.drawsLeft,
  closed: l.closed, participants: l.participants, createdAt: l.createdAt,
});
