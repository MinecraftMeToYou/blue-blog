// MC 服务器人数查询：通过 Minecraft 服务端的标准 Query 协议（GS4）获取在线人数
// 协议参考: https://wiki.vg/Query
const dgram = require('dgram');
const { send } = require('../lib/respond');

// 配置要查询的服务器（可通过环境变量覆盖）
const MC_SERVERS = (process.env.MC_SERVERS || 'localhost:25565')
  .split(',')
  .map((s) => {
    const [host, port] = s.trim().split(':');
    return { host, port: Number(port) || 25565 };
  });

const QUERY_MAGIC = Buffer.from([0xfe, 0xfd]);

// GS4 Query: handshake -> full stat
function queryServer(host, port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const done = (result) => { try { sock.close(); } catch {} resolve(result); };
    const fail = () => done({ host, port, online: false });

    sock.on('error', fail);
    const timer = setTimeout(fail, 3000);

    // 1) handshake: 获取 challenge token
    const handshake = Buffer.concat([QUERY_MAGIC, Buffer.from([0x09]), Buffer.from([0x11, 0x22, 0x33, 0x44])]);
    sock.once('message', (msg) => {
      // 响应: [type][sessionId][challengeToken(4)]
      const token = msg.slice(5, 9);

      // 2) full stat 请求
      const req = Buffer.concat([
        QUERY_MAGIC, Buffer.from([0x00]),
        Buffer.from([0x11, 0x22, 0x33, 0x44]), token,
        Buffer.from([0x00, 0x00, 0x00, 0x00]), // full stat
      ]);
      sock.once('message', (stat) => {
        clearTimeout(timer);
        try {
          // 响应: [type][sessionId][padding(11)][kv section ...null][players ...null]
          let off = 5 + 11;
          const kv = {};
          let key = null;
          // 解析键值段
          while (off < stat.length) {
            const b = stat[off];
            if (b === 0) {
              if (key === null) break; // 连续两个 0 表示段结束
              key = null;
              off++;
            } else {
              let end = stat.indexOf(0, off);
              const str = stat.slice(off, end).toString();
              if (key === null) key = str; else kv[key] = str;
              off = end + 1;
            }
          }
          // 玩家列表段
          off += 10; // 跳过 padding
          const players = [];
          while (off < stat.length) {
            if (stat[off] === 0) break;
            let end = stat.indexOf(0, off);
            players.push(stat.slice(off, end).toString());
            off = end + 1;
          }
          done({
            host, port, online: true,
            motd: kv.MOTD || kv.Message || '',
            players: Number(kv.Players || 0),
            maxPlayers: Number(kv.MaxPlayers || 0),
            version: kv.Version || '',
            playerList: players,
          });
        } catch {
          fail();
        }
      });
      sock.send(req, port, host);
    });
    sock.send(handshake, port, host);
  });
}

module.exports.register = (router) => {
  // 查询所有配置的服务器在线人数
  router.get('/api/mc', async (ctx) => {
    const results = await Promise.all(MC_SERVERS.map((s) => queryServer(s.host, s.port)));
    send(ctx, 200, { servers: results });
  });
};
