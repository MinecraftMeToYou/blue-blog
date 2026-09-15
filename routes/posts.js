// 文章增删改查 + 标签/分类筛选
const db = require('../lib/db');
const { send, requireLogin } = require('../lib/respond');
const lotteryMod = require('./lottery');

function withAuthor(post) {
  const author = db.find('users', (u) => u.id === post.authorId);
  return Object.assign({}, post, {
    authorName: author ? author.username : '佚名',
    commentCount: db.filter('comments', (c) => c.postId === post.id).length,
  });
}

module.exports.register = (router) => {
  // 文章列表，支持 ?tag= &category= &q= 搜索
  router.get('/api/posts', (ctx) => {
    let list = db.get('posts');
    const { tag, category, q } = ctx.query;
    if (tag) list = list.filter((p) => p.tags && p.tags.includes(tag));
    if (category) list = list.filter((p) => p.category === category);
    if (q) list = list.filter((p) => (p.title + p.content).toLowerCase().includes(String(q).toLowerCase()));
    // 按创建时间倒序
    list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    send(ctx, 200, { posts: list.map(withAuthor) });
  });

  // 文章详情（含评论、文章抽奖）
  router.get('/api/posts/:id', (ctx) => {
    const post = db.find('posts', (p) => p.id === Number(ctx.params.id));
    if (!post) return send(ctx, 404, { error: '文章不存在' });
    const comments = db.filter('comments', (c) => c.postId === post.id);
    const lottery = db.find('lotteries', (l) => l.postId === post.id);
    send(ctx, 200, {
      post: withAuthor(post),
      comments,
      lottery: lottery ? lotteryMod.publicView(lottery) : null,
    });
  });

  // 发布文章（需登录）
  router.post('/api/posts', (ctx) => {
    if (!requireLogin(ctx)) return;
    const { title, content, tags, category } = ctx.body;
    if (!title || !content) return send(ctx, 400, { error: '需要标题和内容' });
    const post = db.insert('posts', {
      title: String(title),
      content: String(content),
      tags: Array.isArray(tags) ? tags.map(String) : String(tags || '').split(/[,，\s]+/).filter(Boolean),
      category: String(category || '默认'),
      authorId: ctx.user.userId,
      createdAt: new Date().toISOString(),
    });
    send(ctx, 201, { post: withAuthor(post) });
  });

  // 修改文章（仅作者）
  router.put('/api/posts/:id', (ctx) => {
    if (!requireLogin(ctx)) return;
    const post = db.find('posts', (p) => p.id === Number(ctx.params.id));
    if (!post) return send(ctx, 404, { error: '文章不存在' });
    if (post.authorId !== ctx.user.userId) return send(ctx, 403, { error: '只能修改自己的文章' });
    const { title, content, tags, category } = ctx.body;
    db.update('posts', post.id, {
      title: title !== undefined ? String(title) : post.title,
      content: content !== undefined ? String(content) : post.content,
      tags: Array.isArray(tags) ? tags.map(String) : post.tags,
      category: category !== undefined ? String(category) : post.category,
    });
    send(ctx, 200, { post: withAuthor(db.find('posts', (p) => p.id === post.id)) });
  });

  // 删除文章（仅作者），同时清理评论
  router.delete('/api/posts/:id', (ctx) => {
    if (!requireLogin(ctx)) return;
    const post = db.find('posts', (p) => p.id === Number(ctx.params.id));
    if (!post) return send(ctx, 404, { error: '文章不存在' });
    if (post.authorId !== ctx.user.userId) return send(ctx, 403, { error: '只能删除自己的文章' });
    db.remove('posts', post.id);
    db.filter('comments', (c) => c.postId === post.id).forEach((c) => db.remove('comments', c.id));
    const lottery = db.find('lotteries', (l) => l.postId === post.id);
    if (lottery) lotteryMod.refundLottery(lottery.id); // 退还未抽出的奖金
    send(ctx, 200, { ok: true });
  });

  // 所有标签（用于前端筛选栏）
  router.get('/api/tags', (ctx) => {
    const set = new Set();
    for (const p of db.get('posts')) (p.tags || []).forEach((t) => set.add(t));
    send(ctx, 200, { tags: [...set] });
  });
};
