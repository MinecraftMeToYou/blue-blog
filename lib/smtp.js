// 零依赖 SMTP 客户端：支持 SSL(465) / STARTTLS(587) / 明文(25)，AUTH LOGIN
const net = require('net');
const tls = require('tls');

function b64(s) { return Buffer.from(s).toString('base64'); }

// 发送一封纯文本邮件
// cfg: {host, port, secure, user, pass, from}   mail: {to, subject, text}
function sendMail(cfg, mail) {
  return new Promise((resolve, reject) => {
    if (!cfg || !cfg.host) return reject(new Error('SMTP 未配置'));
    let sock;
    let buffer = '';
    let closed = false;
    const queue = [];   // 等待回复的 resolve 队列

    const timeout = setTimeout(() => fail(new Error('SMTP 连接超时')), 20000);
    function fail(err) {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      try { sock && sock.destroy(); } catch {}
      reject(err);
    }

    // 解析完整回复行； multiline(250-) 继续等，单行(250 ) 返回状态码
    function parse() {
      while (true) {
        const idx = buffer.indexOf('\r\n');
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const m = line.match(/^(\d{3})([ -])/);
        if (!m) continue;
        if (m[2] === ' ') {
          const resolve = queue.shift();
          if (resolve) resolve(Number(m[1]));
        }
      }
    }
    function waitReply() {
      return new Promise((resolve) => { queue.push(resolve); parse(); });
    }
    function send(line) { sock.write(line + '\r\n'); }
    async function expect(code, what) {
      const got = await waitReply();
      if (got !== code) throw new Error(`SMTP ${what} 失败（响应 ${got}）`);
    }

    function attach() {
      sock.setEncoding('utf8');
      sock.on('data', (c) => { buffer += c; parse(); });
    }

    async function run() {
      await expect(220, '连接');
      send('EHLO blue-blog');
      await expect(250, 'EHLO');

      if (!cfg.secure) {
        // 尝试 STARTTLS，服务器不支持则继续明文
        send('STARTTLS');
        const c = await waitReply();
        if (c === 220) {
          sock.removeAllListeners('data');
          sock = tls.connect({ socket: sock, rejectUnauthorized: false });
          attach();
          send('EHLO blue-blog');
          await expect(250, 'EHLO(TLS)');
        }
      }

      if (cfg.user) {
        send('AUTH LOGIN');
        await expect(334, 'AUTH');
        send(b64(cfg.user));
        await expect(334, 'AUTH 用户名');
        send(b64(cfg.pass));
        await expect(235, 'AUTH 认证');
      }

      send('MAIL FROM:<' + cfg.from + '>');
      await expect(250, 'MAIL FROM');
      send('RCPT TO:<' + mail.to + '>');
      await expect(250, 'RCPT TO');
      send('DATA');
      await expect(354, 'DATA');

      const head = [
        'From: <' + cfg.from + '>',
        'To: <' + mail.to + '>',
        'Subject: =?UTF-8?B?' + b64(mail.subject) + '?=',
        'Date: ' + new Date().toUTCString(),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
      ].join('\r\n');
      send(head + '\r\n' + b64(mail.text) + '\r\n.');
      await expect(250, '发送');
      send('QUIT');
      closed = true;
      clearTimeout(timeout);
      try { sock.end(); } catch {}
      resolve(true);
    }

    function connect() {
      if (cfg.secure) {
        sock = tls.connect({ host: cfg.host, port: cfg.port || 465, rejectUnauthorized: false }, () => {});
        sock.once('secureConnect', () => { /* 握手后数据监听已就绪 */ });
      } else {
        sock = net.connect({ host: cfg.host, port: cfg.port || 25 }, () => {});
      }
      attach();
      sock.on('error', fail);
      run().catch(fail);
    }
    connect();
  });
}

module.exports = { sendMail };
