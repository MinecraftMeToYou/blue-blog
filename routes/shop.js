// 商店系统：用金币购买物品，购买记录可查
const db = require('../lib/db');
const { send, requireLogin } = require('../lib/respond');

module.exports.register = (router) => {
  // 商品列表
  router.get('/api/shop', (ctx) => {
    send(ctx, 200, { items: db.get('shopItems') });
  });

  // 购买
  router.post('/api/shop/:id/buy', (ctx) => {
    if (!requireLogin(ctx)) return;
    const item = db.find('shopItems', (i) => i.id === Number(ctx.params.id));
    if (!item) return send(ctx, 404, { error: '商品不存在' });
    const user = db.find('users', (u) => u.id === ctx.user.userId);
    if (user.coins < item.price) return send(ctx, 400, { error: `金币不足，还差 ${item.price - user.coins} 枚` });

    db.update('users', user.id, { coins: user.coins - item.price });
    const order = db.insert('purchases', {
      userId: user.id,
      itemId: item.id,
      itemName: item.name,
      price: item.price,
      createdAt: new Date().toISOString(),
    });
    send(ctx, 200, { ok: true, coins: user.coins - item.price, order });
  });

  // 我的购买记录
  router.get('/api/purchases', (ctx) => {
    if (!requireLogin(ctx)) return;
    send(ctx, 200, { orders: db.filter('purchases', (p) => p.userId === ctx.user.userId) });
  });
};
