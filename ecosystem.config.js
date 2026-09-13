// PM2 配置：宝塔「PM2管理器」或命令行 pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'blue-blog',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      PORT: 3000,
      // KOMARI_URL: 'http://127.0.0.1:8080',
      // MC_SERVERS: 'mc.example.com:25565',
    },
  }],
};
