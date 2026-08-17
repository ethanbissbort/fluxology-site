/**
 * Mail transports (SDD v2 §B5). The transport interface is
 * `send({eml, envelope}) → receipt`; it throws {code:'SEND_FAILED'} for
 * definite failures and {code:'OUTCOME_UNKNOWN'} when the message may or may
 * not have been accepted (never auto-resent).
 *
 *  - outbox (default): writes the .eml to <data>/outbox for the operator to
 *    send with their own client. Zero credentials, zero network.
 *  - smtp (env-gated): minimal RFC 5321 client over node:net/node:tls with
 *    STARTTLS or implicit TLS and AUTH PLAIN. Dot-stuffing applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';

export function createTransport(config) {
  return config.transport === 'smtp' ? new SmtpTransport(config) : new OutboxTransport(config);
}

export class OutboxTransport {
  constructor(config) {
    this.outboxDir = config.outboxDir;
  }

  describe() {
    return { kind: 'outbox', target: this.outboxDir };
  }

  async send({ eml, envelope, messageDbId }) {
    fs.mkdirSync(this.outboxDir, { recursive: true });
    const file = path.join(this.outboxDir, `${messageDbId}.eml`);
    fs.writeFileSync(file, eml, 'utf8');
    return {
      kind: 'outbox',
      path: file,
      note: `Rendered to ${file}. Send it with your mail client (most clients open .eml files directly), or switch FLUXOLOGY_MAIL_TRANSPORT=smtp.`,
      envelope,
      at: new Date().toISOString(),
    };
  }
}

const CRLF = '\r\n';

export class SmtpTransport {
  constructor(config) {
    this.smtp = config.smtp;
    if (!this.smtp.host) throw Object.assign(new Error('FLUXOLOGY_MAIL_SMTP_HOST is required for the smtp transport'), { code: 'VALIDATION_FAILED' });
  }

  describe() {
    return { kind: 'smtp', target: `${this.smtp.host}:${this.smtp.port}`, tls: this.smtp.secure ? 'implicit' : 'starttls' };
  }

  async send({ eml, envelope }) {
    const session = new SmtpSession(this.smtp);
    let dataSent = false;
    try {
      await session.connect();
      await session.expect([220]);
      await session.command(`EHLO fluxology-mail-mcp`, [250]);
      if (!this.smtp.secure && !this.smtp.allowPlaintext) {
        await session.command('STARTTLS', [220]);
        await session.upgradeTls();
        await session.command(`EHLO fluxology-mail-mcp`, [250]);
      }
      if (this.smtp.user) {
        // RFC 4616 SASL PLAIN: authzid NUL authcid NUL passwd (empty authzid).
        // Written as explicit \u0000 escapes: this line previously contained
        // literal NUL bytes, which render as spaces in most tools, make grep
        // treat the file as binary, and read as a wrong space-separated
        // payload to any reviewer. The test mock now decodes and verifies
        // the separators like a real server would.
        const token = Buffer.from(`\u0000${this.smtp.user}\u0000${this.smtp.pass}`, 'utf8').toString('base64');
        await session.command(`AUTH PLAIN ${token}`, [235]);
      }
      await session.command(`MAIL FROM:<${envelope.from}>`, [250]);
      for (const rcpt of envelope.to) {
        await session.command(`RCPT TO:<${rcpt}>`, [250, 251]);
      }
      await session.command('DATA', [354]);
      const stuffed = eml.replace(/\r?\n/g, CRLF).replace(/(^|\r\n)\./g, '$1..');
      dataSent = true;
      const reply = await session.command(stuffed + (stuffed.endsWith(CRLF) ? '' : CRLF) + '.', [250]);
      await session.command('QUIT', [221]).catch(() => {});
      session.close();
      return { kind: 'smtp', server: `${this.smtp.host}:${this.smtp.port}`, accepted: reply.trim(), envelope, at: new Date().toISOString() };
    } catch (err) {
      session.close();
      if (dataSent && err.code !== 'SMTP_REJECT') {
        // The message body was transmitted and no definitive rejection was
        // read: the server may have accepted it. Never auto-resend.
        throw Object.assign(new Error(`SMTP outcome ambiguous after DATA: ${err.message}`), { code: 'OUTCOME_UNKNOWN' });
      }
      throw Object.assign(new Error(`SMTP send failed: ${err.message}`), { code: 'SEND_FAILED', data: { reply: err.reply ?? null } });
    }
  }
}

class SmtpSession {
  constructor(smtp) {
    this.smtp = smtp;
    this.socket = null;
    this.buffer = '';
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(Object.assign(new Error(err.message), { code: 'CONNECT' }));
      this.socket = this.smtp.secure
        ? tls.connect({ host: this.smtp.host, port: this.smtp.port, servername: this.smtp.host }, resolve)
        : net.connect({ host: this.smtp.host, port: this.smtp.port }, resolve);
      this.socket.setTimeout(this.smtp.timeoutMs, () => this.socket.destroy(new Error('SMTP timeout')));
      this.socket.on('error', onError);
      this.socket.on('data', (chunk) => this.onData(chunk));
      this.socket.on('close', () => this.flushWaiters(new Error('connection closed')));
    });
  }

  upgradeTls() {
    return new Promise((resolve, reject) => {
      const plain = this.socket;
      plain.removeAllListeners('data');
      const secured = tls.connect({ socket: plain, servername: this.smtp.host }, () => resolve());
      secured.setTimeout(this.smtp.timeoutMs, () => secured.destroy(new Error('SMTP TLS timeout')));
      secured.on('error', reject);
      secured.on('data', (chunk) => this.onData(chunk));
      secured.on('close', () => this.flushWaiters(new Error('connection closed')));
      this.socket = secured;
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    // A complete reply ends with "NNN " at the start of its final line.
    const lines = this.buffer.split(CRLF);
    let completeUpTo = -1;
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d{3} /.test(lines[i])) completeUpTo = i;
    }
    if (completeUpTo >= 0) {
      const reply = lines.slice(0, completeUpTo + 1).join(CRLF);
      this.buffer = lines.slice(completeUpTo + 1).join(CRLF);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(reply);
    }
  }

  flushWaiters(error) {
    while (this.waiters.length) this.waiters.shift().reject(error);
  }

  readReply() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) {
          this.waiters.splice(idx, 1);
          reject(new Error('SMTP reply timeout'));
        }
      }, this.smtp.timeoutMs).unref?.();
    });
  }

  async expect(codes) {
    const reply = await this.readReply();
    const code = Number(reply.match(/^(\d{3})[ -]/m)?.[1]);
    if (!codes.includes(code)) {
      throw Object.assign(new Error(`unexpected SMTP reply: ${reply.split(CRLF)[0]}`), { code: 'SMTP_REJECT', reply });
    }
    return reply;
  }

  async command(text, codes) {
    this.socket.write(text + CRLF);
    return this.expect(codes);
  }

  close() {
    this.socket?.destroy();
  }
}
