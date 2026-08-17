/**
 * Mail MCP configuration (SDD v2 §0.8). Transport defaults to `outbox`
 * (zero credentials, zero network): approved messages are rendered to RFC
 * 5322 .eml files the operator sends with their own mail client. SMTP is
 * env-gated and only read when explicitly selected.
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeDataRoot } from '../../mcp-core/store.mjs';

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  const dataDir = env.FLUXOLOGY_MAIL_DATA_DIR || path.join(os.homedir(), '.fluxology', 'mail-mcp');
  assertSafeDataRoot(dataDir, PACKAGE_DIR);

  const transport = env.FLUXOLOGY_MAIL_TRANSPORT || 'outbox';
  if (!['outbox', 'smtp'].includes(transport)) {
    throw Object.assign(new Error(`FLUXOLOGY_MAIL_TRANSPORT must be "outbox" or "smtp", got "${transport}"`), { code: 'VALIDATION_FAILED' });
  }

  return {
    dataDir,
    from: env.FLUXOLOGY_MAIL_FROM || '',
    transport,
    inboxDir: env.FLUXOLOGY_MAIL_INBOX_DIR || path.join(dataDir, 'inbox'),
    outboxDir: path.join(dataDir, 'outbox'),
    smtp: {
      host: env.FLUXOLOGY_MAIL_SMTP_HOST || '',
      port: Number(env.FLUXOLOGY_MAIL_SMTP_PORT) || 587,
      user: env.FLUXOLOGY_MAIL_SMTP_USER || '',
      pass: env.FLUXOLOGY_MAIL_SMTP_PASS || '',
      secure: env.FLUXOLOGY_MAIL_SMTP_SECURE === '1', // implicit TLS; otherwise STARTTLS
      // Dev/test only: skip STARTTLS for a plaintext local relay. Never use
      // against a real internet mail server.
      allowPlaintext: env.FLUXOLOGY_MAIL_SMTP_ALLOW_PLAINTEXT === '1',
      timeoutMs: Number(env.FLUXOLOGY_MAIL_SMTP_TIMEOUT_MS) || 30_000,
    },
  };
}
