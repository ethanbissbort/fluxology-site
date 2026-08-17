#!/usr/bin/env node
/**
 * Fluxology contact API — self-hosted replacement for a third-party form
 * service. Plain `node:http`, no web framework, one optional dependency
 * (nodemailer) that is only loaded when SMTP is actually configured.
 *
 * Endpoints:
 *   POST /api/contact  — accepts application/json and
 *                        application/x-www-form-urlencoded (no-JS fallback)
 *   GET  /api/health   — liveness/readiness probe
 *
 * See README.md and the API contract for the full behaviour.
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { loadConfig, REDIRECT_ERROR, REDIRECT_SUCCESS } from './config.mjs';
import { InquiryStore } from './store.mjs';
import { Mailer } from './mailer.mjs';
import { sanitizeSingleLine, validateSubmission } from './validate.mjs';

const CONTACT_PATH = '/api/contact';
const HEALTH_PATH = '/api/health';
const MAX_TRACKED_IPS = 10_000;
const SHUTDOWN_GRACE_MS = 8_000;
/** Multiple of MAX_BODY_BYTES we will read-and-throw-away after a 413. */
const DRAIN_ALLOWANCE = 8;

/* ------------------------------------------------------------------ *
 * Response helpers
 * ------------------------------------------------------------------ */

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

/** No CORS headers anywhere: this API is same-origin by design. */
function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    ...BASE_HEADERS,
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

function sendRedirect(res, location) {
  if (res.writableEnded) return;
  const body = Buffer.from(`Redirecting to ${location}\n`, 'utf8');
  res.writeHead(303, {
    ...BASE_HEADERS,
    Location: location,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

/* ------------------------------------------------------------------ *
 * Request helpers
 * ------------------------------------------------------------------ */

function contentTypeOf(req) {
  const raw = req.headers['content-type'];
  if (typeof raw !== 'string') return '';
  return raw.split(';', 1)[0].trim().toLowerCase();
}

function normalizeIp(value) {
  const clean = sanitizeSingleLine(value, 64).replace(/^::ffff:/i, '');
  return clean.slice(0, 45);
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const first = normalizeIp(raw.split(',')[0]);
      if (first) return first;
    }
  }
  return normalizeIp(req.socket?.remoteAddress ?? '') || 'unknown';
}

/**
 * Read the request body, enforcing the size cap **while streaming** — at most
 * one chunk beyond the cap is ever held in memory, and nothing is buffered
 * once the cap is passed.
 *
 * @returns {Promise<{tooLarge:boolean, aborted?:boolean, body?:Buffer}>}
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      resolve({ tooLarge: true });
      return;
    }

    /** @type {Buffer[]} */
    let chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };
    const settle = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks = []; // drop everything: never buffer an oversized body
        settle({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => settle({ tooLarge: false, body: Buffer.concat(chunks, size) });
    const onAborted = () => settle({ tooLarge: false, aborted: true });
    const onError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

/**
 * After rejecting an oversized upload, read-and-throw-away a bounded amount of
 * the remaining body (nothing is buffered) so a well-behaved client can finish
 * writing and actually read the 413 on a healthy connection. Past that
 * allowance the connection is torn down — we will not drain an arbitrarily
 * long stream on an attacker's behalf.
 */
function discardRest(req, allowance) {
  if (req.destroyed || req.readableEnded) return;
  let seen = 0;
  const detach = () => req.off('data', onData);
  const onData = (chunk) => {
    seen += chunk.length;
    if (seen > allowance) {
      detach();
      if (!req.destroyed) req.destroy();
    }
  };
  req.on('data', onData);
  req.once('end', detach);
  req.once('error', detach);
  req.resume();
}

/** Parse the decoded body for a known content type. */
function parseBody(buffer, type) {
  const text = buffer.toString('utf8');
  if (type === 'application/json') {
    let parsed;
    try {
      parsed = JSON.parse(text || 'null');
    } catch {
      return { ok: false, error: 'Malformed JSON body.' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Request body must be a JSON object.' };
    }
    return { ok: true, fields: parsed };
  }

  const params = new URLSearchParams(text);
  // Null prototype: a form field literally named `__proto__` must stay inert.
  /** @type {Record<string,string>} */
  const fields = Object.create(null);
  for (const key of new Set(params.keys())) fields[key] = params.get(key) ?? '';
  return { ok: true, fields };
}

/* ------------------------------------------------------------------ *
 * Rate limiting (in-memory, per IP, with pruning)
 * ------------------------------------------------------------------ */

export class RateLimiter {
  constructor({ max, windowMs, maxEntries = MAX_TRACKED_IPS, log = console.warn }) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.log = log;
    /** @type {Map<string, {count:number, resetAt:number}>} */
    this.hits = new Map();
    this.timer = null;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => this.prune(), Math.min(this.windowMs, 60_000));
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
    if (this.hits.size > this.maxEntries) {
      // Hard memory bound: a flood of unique source addresses must not grow
      // this map without limit. Dropping it only resets counters.
      this.log(`[contact-api] rate-limit table exceeded ${this.maxEntries} entries; resetting`);
      this.hits.clear();
    }
  }

  /** @returns {{allowed:boolean, retryAfterSec:number}} */
  check(key, now = Date.now()) {
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      if (this.hits.size >= this.maxEntries) this.prune(now);
      this.hits.set(key, entry);
    }
    entry.count += 1;
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: entry.count <= this.max, retryAfterSec };
  }
}

/* ------------------------------------------------------------------ *
 * Application
 * ------------------------------------------------------------------ */

/**
 * Build the HTTP request handler.
 * Exported so tests (and any future embedding) can drive it directly.
 */
export function createHandler({ config, store, mailer, limiter, logError = console.error }) {
  const startedAt = Date.now();
  /** @type {Set<Promise<unknown>>} in-flight best-effort email sends */
  const pendingMail = new Set();

  /**
   * Health must not assert what it has not tested. An unwritable volume makes
   * every submission fail with 500 while this endpoint kept answering 200 —
   * and both the container HEALTHCHECK and the edge's active check read it,
   * so the broken instance stayed green and in rotation. The probe is
   * store.check(): the same mkdir + open-for-append path a real submission
   * takes (a failed attempt is not memoised, so recovery is picked up).
   * Cached briefly, like dashboard-api's write probe, so edge checks cannot
   * hammer the filesystem.
   */
  const PERSISTENCE_PROBE_CACHE_MS = 5_000;
  let persistenceProbe = { at: 0, ok: true };
  let persistenceLogged = null;
  async function probePersistence() {
    if (Date.now() - persistenceProbe.at < PERSISTENCE_PROBE_CACHE_MS) return persistenceProbe;
    try {
      await store.check();
      persistenceProbe = { at: Date.now(), ok: true };
    } catch (err) {
      persistenceProbe = { at: Date.now(), ok: false };
      if (persistenceLogged !== false) logError('[contact-api] inquiry log is NOT writable; reporting degraded health:', err.code ?? err.message);
    }
    if (persistenceLogged === false && persistenceProbe.ok) console.log('[contact-api] inquiry log is writable again');
    persistenceLogged = persistenceProbe.ok;
    return persistenceProbe;
  }

  const handler = async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendJson(res, 400, { ok: false, error: 'Malformed request URL.', fields: {} });
      return;
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === HEALTH_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
        return;
      }
      // `inquiryLog` exists so that "has anything come in?" is answerable
      // without exec-ing into the container. With SMTP unset — the shipping
      // default — the JSONL log is the authoritative and only copy of a
      // submission, and nothing else in the deployment surfaces its arrival.
      // stats() is derived from stat(2), so this stays O(1) as the log grows.
      let inquiryLog;
      try {
        inquiryLog = await store.stats();
      } catch {
        inquiryLog = null; // the status field must not fail the whole check
      }
      const persistence = await probePersistence();
      sendJson(res, persistence.ok ? 200 : 503, {
        status: persistence.ok ? 'ok' : 'degraded',
        ...(persistence.ok ? {} : { degradedReason: 'inquiry_log_unwritable' }),
        emailEnabled: mailer.enabled,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        inquiryLog,
      });
      return;
    }

    if (path !== CONTACT_PATH) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed. Use POST.' }, { Allow: 'POST' });
      return;
    }

    const type = contentTypeOf(req);
    const wantsRedirect = type === 'application/x-www-form-urlencoded';
    const ip = clientIp(req, config.trustProxy);

    const { allowed, retryAfterSec } = limiter.check(ip);
    if (!allowed) {
      // A no-JS submit is a browser navigation: send it to the error page
      // rather than rendering a raw JSON body at a human.
      if (wantsRedirect) sendRedirect(res, REDIRECT_ERROR);
      else
        sendJson(
          res,
          429,
          { ok: false, error: 'Too many submissions from this address. Please try again later.' },
          { 'Retry-After': String(retryAfterSec) },
        );
      return;
    }

    let read;
    try {
      read = await readBody(req, config.maxBodyBytes);
    } catch (err) {
      logError('[contact-api] error reading request body:', err);
      if (wantsRedirect) sendRedirect(res, REDIRECT_ERROR);
      else sendJson(res, 400, { ok: false, error: 'Could not read the request body.', fields: {} });
      return;
    }

    if (read.tooLarge) {
      if (wantsRedirect) sendRedirect(res, REDIRECT_ERROR);
      else sendJson(res, 413, { ok: false, error: 'Submission is too large.' });
      discardRest(req, config.maxBodyBytes * DRAIN_ALLOWANCE);
      return;
    }
    if (read.aborted) return;

    if (type !== 'application/json' && !wantsRedirect) {
      sendJson(res, 400, {
        ok: false,
        error: 'Unsupported content type. Send JSON or form-urlencoded data.',
        fields: {},
      });
      return;
    }

    const parsed = parseBody(read.body, type);
    if (!parsed.ok) {
      if (wantsRedirect) sendRedirect(res, REDIRECT_ERROR);
      else sendJson(res, 400, { ok: false, error: parsed.error, fields: {} });
      return;
    }

    const result = validateSubmission(parsed.fields);

    // Honeypot: behave exactly like success, store nothing, send nothing.
    if (result.honeypot) {
      if (wantsRedirect) sendRedirect(res, REDIRECT_SUCCESS);
      else sendJson(res, 200, { ok: true });
      return;
    }

    if (!result.ok) {
      if (wantsRedirect) {
        sendRedirect(res, REDIRECT_ERROR);
        return;
      }
      sendJson(res, 400, {
        ok: false,
        error: 'Some details need fixing before we can send your message.',
        fields: result.fields,
      });
      return;
    }

    const meta = {
      receivedAt: new Date().toISOString(),
      ip,
      userAgent: sanitizeSingleLine(req.headers['user-agent'], 300),
    };

    // Durability rule: the inquiry must be on disk before we report success.
    try {
      await store.append({ ...meta, ...result.data });
    } catch (err) {
      logError('[contact-api] FAILED to persist inquiry:', err);
      if (wantsRedirect) sendRedirect(res, REDIRECT_ERROR);
      else
        sendJson(res, 500, {
          ok: false,
          error: 'We could not record your message. Please email info@fluxology.ca directly.',
        });
      return;
    }

    if (wantsRedirect) sendRedirect(res, REDIRECT_SUCCESS);
    else sendJson(res, 200, { ok: true });

    // Email is best-effort and never blocks the response: the inquiry is
    // already durable, and a slow or broken relay must not stall the user.
    if (mailer.enabled) {
      const task = mailer.send(result.data, meta).finally(() => pendingMail.delete(task));
      pendingMail.add(task);
    }
  };

  handler.pendingMail = pendingMail;
  return handler;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function main(env = process.env) {
  const config = loadConfig(env);
  const store = new InquiryStore(config.inquiryLogPath);
  const mailer = new Mailer(config);
  const limiter = new RateLimiter({
    max: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
  }).start();

  // Exactly one informational line about email, whichever mode we are in.
  if (mailer.enabled) {
    console.log(
      `[contact-api] Email delivery enabled: relaying via ${config.smtp.host}:${config.smtp.port} to ${config.mailTo}`,
    );
  } else {
    console.log(
      `[contact-api] Email delivery is disabled (SMTP_HOST is not set). ` +
        `Inquiries are being recorded to ${config.inquiryLogPath} — read them there.`,
    );
  }

  // Surface an unusable log path early, but do not refuse to start: the mount
  // may appear a moment later, and every write retries from scratch.
  try {
    await store.check();
  } catch (err) {
    console.warn(
      `[contact-api] inquiry log ${config.inquiryLogPath} is not writable yet (${err.code ?? err.message}); will retry on first submission`,
    );
  }

  const handler = createHandler({ config, store, mailer, limiter });
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error('[contact-api] unhandled request error:', err);
      sendJson(res, 500, { ok: false, error: 'Internal error.' });
    });
  });

  // Slow-loris defences.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  console.log(`[contact-api] listening on ${config.host}:${config.port}`);

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`[contact-api] ${signal} received — shutting down`);

    const forced = setTimeout(() => {
      server.closeAllConnections?.();
    }, SHUTDOWN_GRACE_MS);
    forced.unref?.();

    await new Promise((resolve) => server.close(() => resolve()));
    server.closeIdleConnections?.();
    clearTimeout(forced);

    // Give in-flight notification emails a brief chance to finish.
    if (handler.pendingMail.size > 0) {
      await Promise.race([
        Promise.allSettled([...handler.pendingMail]),
        new Promise((r) => setTimeout(r, 5_000).unref?.()),
      ]);
    }

    limiter.stop();
    await mailer.close();
    await store.close();
    console.log('[contact-api] shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    console.error('[contact-api] unhandled promise rejection:', err);
  });

  return { server, config, store, mailer, limiter, shutdown };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[contact-api] failed to start:', err);
    process.exit(1);
  });
}
