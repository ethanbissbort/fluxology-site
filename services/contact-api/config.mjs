/**
 * Configuration for the Fluxology contact API.
 *
 * Every value comes from an environment variable documented in README.md and
 * in the API contract. Defaults are chosen so that the service runs correctly
 * with NO environment configuration at all (log-only mode, no email).
 */

/** Slugs accepted for the `serviceInterest` field. */
export const ALLOWED_SERVICES = Object.freeze([
  'fabrication',
  '3d-lab',
  'greenhouse',
  'orchard',
  'multiple',
  'general',
]);

/** Human labels used in the notification email subject/body only. */
export const SERVICE_LABELS = Object.freeze({
  fabrication: 'Fabrication',
  '3d-lab': '3D Lab',
  greenhouse: 'Greenhouse',
  orchard: 'Orchard',
  multiple: 'Multiple services',
  general: 'General inquiry',
});

/** Redirect targets used for no-JS (form-urlencoded) submissions. */
export const REDIRECT_SUCCESS = '/contact-received/';
export const REDIRECT_ERROR = '/contact-received/?error=1';

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInt(value, fallback, name, warn) {
  const raw = str(value);
  if (raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    warn(`[contact-api] ignoring invalid ${name}=${JSON.stringify(raw)}; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

function bool(value, fallback) {
  const raw = str(value).toLowerCase();
  if (raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

/**
 * Build the runtime config from an environment object.
 * @param {Record<string, string | undefined>} env
 * @param {(msg: string) => void} warn
 */
export function loadConfig(env = process.env, warn = console.warn) {
  const smtpHost = str(env.SMTP_HOST);
  const mailTo = str(env.MAIL_TO) || 'info@fluxology.ca';
  const smtpUser = str(env.SMTP_USER);
  const smtpPass = typeof env.SMTP_PASS === 'string' ? env.SMTP_PASS : '';

  return Object.freeze({
    port: positiveInt(env.PORT, 8081, 'PORT', warn),
    host: '0.0.0.0',
    inquiryLogPath: str(env.INQUIRY_LOG_PATH) || '/data/inquiries.jsonl',
    trustProxy: bool(env.TRUST_PROXY, true),
    rateLimitMax: positiveInt(env.RATE_LIMIT_MAX, 5, 'RATE_LIMIT_MAX', warn),
    rateLimitWindowMs: positiveInt(env.RATE_LIMIT_WINDOW_MS, 900_000, 'RATE_LIMIT_WINDOW_MS', warn),
    maxBodyBytes: positiveInt(env.MAX_BODY_BYTES, 32_768, 'MAX_BODY_BYTES', warn),
    mailTo,
    mailFrom: str(env.MAIL_FROM) || mailTo,
    smtp: smtpHost
      ? Object.freeze({
          host: smtpHost,
          port: positiveInt(env.SMTP_PORT, 587, 'SMTP_PORT', warn),
          secure: bool(env.SMTP_SECURE, false),
          user: smtpUser || null,
          pass: smtpUser ? smtpPass : null,
        })
      : null,
  });
}
