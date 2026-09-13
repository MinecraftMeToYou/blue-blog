# 蔚蓝博客 · Blue Blog

纯 Node.js 从零实现的博客系统（蔚蓝档案主题），**零 npm 依赖**，数据保存在单个 SQLite 文件。

## ✨ 功能

- 📝 文章管理：发布/编辑/删除、标签、分类、搜索
- 💬 评论系统：楼中楼回复
- 🔐 用户认证：注册登录、scrypt 加盐密码、会话持久化（重启不掉线）
- 🛍 商店系统：金币经济、购买、订单
- 🎰 抽奖：全局抽奖（金币/头衔奖池）+ 文章抽奖（作者冻结金币做奖池，名额必抽完，可撤销退款）
- 🎨 主题系统：用户在线编写 CSS 主题、实时预览、一键换肤
- 🖥 机器状态：接入 [komari](https://github.com/komari-monitor/komari) 探针，导航栏实时节点概览
- ⛏ MC 服务器查询：GS4 Query 协议查在线人数/MOTD/版本
- 🛠 管理后台：文章/评论/用户/商品/订单管理、系统设置

## 🚀 运行

```bash
# 需要 Node >= 22.13（内置 node:sqlite）
node server.js          # http://localhost:3000
```

首次启动自动创建管理员 `admin / admin123`（请立即修改），管理后台在 `/admin`。

## 📦 Linux 部署

支持宝塔 / 1Panel / systemd / Docker，详见 [部署指南.md](部署指南.md)。

数据全部在 `data/blog.db`（SQLite），备份这一个文件即备份整站。

## 🧪 测试

```bash
node test-features.js        # 认证/文章/评论/商店/抽奖
node test-post-lottery.js    # 文章抽奖全流程
node test-theme-probe.js     # 主题系统/komari 探针
```

## 结构

```
server.js          # HTTP 服务器 + 静态文件
lib/               # 核心：路由器 / SQLite 存储层 / 会话 / 密码哈希
routes/            # API：auth posts comments shop lottery themes probe admin minecraft
public/            # 前端 SPA（博客 + 管理后台）
data/              # 运行数据（不入库）
```
