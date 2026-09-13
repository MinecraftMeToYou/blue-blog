// 评论：登录用户可对文章发表评论，作者可删除自己文章下的评论，本人可删自己的评论
const db = require('../lib/db');
const { send, requireLogin } = require('../lib/respond');

function withUser(c) {
  const u = db.find('users', (x) => x.id === c.userId);
  return Object.assign({}, c, {
    username: u ? u.username : '未知用户',
    userTitle: u ? u.title : '',
  });
}

module.exports.register = (router) => {
  router.post('/api/posts/:id/comments', (ctx) => {
    if (!requireLogin(ctx)) return;
    const post = db.find('posts', (p) => p.id === Number(ctx.params.id));
    if (!post) return send(ctx, 404, { error: '文章不存在' });
    const { content, replyTo } = ctx.body;
    if (!content || !String(content).trim()) return send(ctx, 400, { error: '评论内容不能为空' });

    // 回复目标必须是同一篇文章下的评论
    let replyToId = null;
    let replyToName = '';
    if (replyTo) {
      const target = db.find('comments', (c) => c.id === Number(replyTo) && c.postId === post.id);
      if (target) {
        replyToId = target.id;
        const tu = db.find('users', (u) => u.id === target.userId);
        replyToName = tu ? tu.username : '未知用户';
      }
    }

    const c = db.insert('comments', {
      postId: post.id,
      userId: ctx.user.userId,
      content: String(content).trim().slice(0, 1000),
      replyTo: replyToId,
      replyToName,
      createdAt: new Date().toISOString(),
    });
    send(ctx, 201, { comment: withUser(c) });
  });

  router.delete('/api/comments/:id', (ctx) => {
    if (!requireLogin(ctx)) return;
    const c = db.find('comments', (x) => x.id === Number(ctx.params.id));
    if (!c) return send(ctx, 404, { error: '评论不存在' });
    const post = db.find('posts', (p) => p.id === c.postId);
    const isOwner = c.userId === ctx.user.userId;
    const isPostAuthor = post && post.authorId === ctx.user.userId;
    if (!isOwner && !isPostAuthor) return send(ctx, 403, { error: '无权删除该评论' });
    db.remove('comments', c.id);
    send(ctx, 200, { ok: true });
  });
};
