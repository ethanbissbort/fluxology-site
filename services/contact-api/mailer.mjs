/**
 * Optional SMTP notification.
 *
 * Email is a best-effort extra on top of the durable JSONL log: the service is
 * fully functional with no SMTP configuration at all, and a send failure never
 * fails a request (the inquiry is already on disk).
 *
 * `nodemailer` is imported dynamically the first time a message is sent, so a
 * log-only deployment never loads it.
 */

import { SERVICE_LABELS } from './config.mjs';

/** Belt-and-braces: nothing with CR/LF may reach a mail header. */
function headerSafe(value, maxLen = 200) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export class Mailer {
  /**
   * @param {ReturnType<import('./config.mjs').loadConfig>} config
   * @param {(msg: string, err?: unknown) => void} logError
   */
  constructor(config, logError = (msg, err) => console.error(msg, err ?? '')) {
    this.config = config;
    this.logError = logError;
    this._transport = null;
  }

  get enabled() {
    return this.config.smtp !== null;
  }

  async _getTransport() {
    if (!this._transport) {
      const { smtp } = this.config;
      const { default: nodemailer } = await import('nodemailer');
      this._transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        // Keep a stuck relay from wedging request handling.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return this._transport;
  }

  /**
   * Send the notification. Never throws: failures are logged and swallowed.
   * @param {{fullName:string,email:string,serviceInterest:string,message:string,companyName:string,phone:string}} data
   * @param {{receivedAt:string, ip:string, userAgent:string}} meta
   * @returns {Promise<boolean>} true if the message was handed to the relay
   */
  async send(data, meta) {
    if (!this.enabled) return false;
    try {
      const transport = await this._getTransport();
      const name = headerSafe(data.fullName, 120);
      const label = SERVICE_LABELS[data.serviceInterest] ?? 'Website inquiry';

      await transport.sendMail({
        // Envelope identities are operator-controlled, never user input.
        from: this.config.mailFrom,
        to: this.config.mailTo,
        // The submitter's address is used for replies only, and is passed as a
        // structured object so nodemailer does the header encoding.
        replyTo: { name, address: headerSafe(data.email, 200) },
        subject: headerSafe(`Fluxology website inquiry — ${label} — ${name}`, 200),
        text: renderBody(data, meta),
      });
      return true;
    } catch (err) {
      // Inquiry is already persisted; surface the problem without failing.
      this.logError('[contact-api] email notification failed (inquiry is stored):', err);
      return false;
    }
  }

  async close() {
    try {
      this._transport?.close?.();
    } catch {
      /* ignore */
    }
    this._transport = null;
  }
}

function renderBody(data, meta) {
  const label = SERVICE_LABELS[data.serviceInterest] ?? data.serviceInterest;
  return [
    'New inquiry from the Fluxology website.',
    '',
    `Name:      ${data.fullName}`,
    `Email:     ${data.email}`,
    `Company:   ${data.companyName || '—'}`,
    `Phone:     ${data.phone || '—'}`,
    `Interest:  ${label} (${data.serviceInterest})`,
    `Received:  ${meta.receivedAt}`,
    `IP:        ${meta.ip}`,
    `UserAgent: ${meta.userAgent || '—'}`,
    '',
    'Message:',
    '--------',
    data.message,
    '',
  ].join('\n');
}
