# blue-blog

一个用 Node.js 写的博客程序。不依赖任何第三方包，数据存在一个 SQLite 文件里。默认主题是蔚蓝档案风格，主题可以自己改。

## 功能

- 文章：发布、编辑、删除，标签、分类、搜索
- 评论，支持回复
- 用户注册登录，密码 scrypt 加盐，会话存数据库，重启不掉线
- 商店：金币购买商品，有订单记录
- 抽奖：全局抽奖，以及文章抽奖（作者发起，读者参与，可撤销退款）
- 主题：在线写 CSS 换肤，实时预览
- 服务器监控：对接 [komari](https://github.com/komari-monitor/komari) 面板
- Minecraft 服务器在线人数查询（GS4 Query 协议）
- 后台管理：文章、评论、用户、商品、系统设置

## 运行

需要 Node 22.13 以上（用到内置的 node:sqlite）。

```
git clone https://github.com/MinecraftMeToYou/blue-blog.git
cd blue-blog
node server.js
```

打开 http://localhost:3000。管理员账号 admin / admin123，后台在 /admin，登录后记得改密码。

## 部署

宝塔、1Panel、Docker、systemd 都可以，见 [部署指南.md](部署指南.md)。

数据都在 `data/blog.db`，备份这一个文件就行。

## 测试

```
node test-features.js
node test-post-lottery.js
node test-theme-probe.js
```

## 目录结构

```
server.js   入口
lib/        路由、数据库、会话、密码
routes/     各功能的接口
public/     前端页面
```
