#!/usr/bin/env node
/**
 * Fluxology dashboard feed API.
 *
 * This service is the authoritative store for the office, deals and jobs
 * feeds, so it holds itself to three rules:
 *
 *   1. Never report success for something that did not happen. A 200 means
 *      the bytes are fsync'd on disk and the audit line is fsync'd with them.
 *   2. Never hand a dashboard garbage. Feeds are parsed and validated on the
 *      way in, on the way out, and at startup; an unusable feed fails loudly
 *      (503) instead of being served as 200 application/json.
 *   3. Never leak internals to a client. Errors are machine-readable codes;
 *      paths, stack traces and library messages go to the log only.
 */
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, open, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';

/* ------------------------------------------------------------------ config */

const DEFAULTS = Object.freeze({
  port: 8082,
  maxBodyBytes: 1_048_576,
  maxListingsPerWrite: 500,
  maxFullFeedListings: 50_000,
  maxListingDepth: 64,
  auditMaxBytes: 5_242_880,
  auditKeepFiles: 3,
});

/** Hard ceiling on MAX_LISTING_DEPTH; stableStringify recurses to this depth. */
const DEPTH_CEILING = 512;
/** Ingest tokens shorter than this get a startup warning (not a refusal). */
const MIN_TOKEN_LENGTH = 32;
/** Multiple of MAX_BODY_BYTES we are willing to drain after answering 413. */
const DRAIN_ALLOWANCE = 8;

/**
 * Strict positive-integer env parsing. An unparseable value must never
 * silently disable the limit it configures (`Number('1MB')` is NaN and every
 * enforcement site is a `>` comparison, which NaN always fails), so anything
 * that is not a positive integer falls back to the documented default and
 * says so loudly on stderr.
 */
function positiveInt(value, fallback, name) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`[dashboard-api] ignoring invalid ${name}=${JSON.stringify(raw)}; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

const PORT = positiveInt(process.env.PORT, DEFAULTS.port, 'PORT');
const DATA_DIR = process.env.DATA_DIR || '/data';
const SEED_DIR = process.env.SEED_DIR || '/seed';
const MAX_BODY_BYTES = positiveInt(process.env.MAX_BODY_BYTES, DEFAULTS.maxBodyBytes, 'MAX_BODY_BYTES');
const MAX_LISTINGS_PER_WRITE = positiveInt(process.env.MAX_LISTINGS_PER_WRITE, DEFAULTS.maxListingsPerWrite, 'MAX_LISTINGS_PER_WRITE');
/**
 * Full-feed replacement (PUT /feed) gets its own, larger bound: the per-write
 * cap exists to bound one ingest batch, but a restore has to be able to put
 * back everything the store legitimately holds. The same bound also caps how
 * far an upsert may grow the stored feed, which keeps the invariant "anything
 * this service will store, a restore can put back" true at all times.
 */
const MAX_FULL_FEED_LISTINGS = Math.max(
  positiveInt(process.env.MAX_FULL_FEED_LISTINGS, DEFAULTS.maxFullFeedListings, 'MAX_FULL_FEED_LISTINGS'),
  MAX_LISTINGS_PER_WRITE,
);
const MAX_LISTING_DEPTH = Math.min(
  positiveInt(process.env.MAX_LISTING_DEPTH, DEFAULTS.maxListingDepth, 'MAX_LISTING_DEPTH'),
  DEPTH_CEILING,
);
const AUDIT_MAX_BYTES = positiveInt(process.env.AUDIT_MAX_BYTES, DEFAULTS.auditMaxBytes, 'AUDIT_MAX_BYTES');
const AUDIT_KEEP_FILES = positiveInt(process.env.AUDIT_KEEP_FILES, DEFAULTS.auditKeepFiles, 'AUDIT_KEEP_FILES');
const TRUST_PROXY = String(process.env.TRUST_PROXY || 'true').toLowerCase() === 'true';
const SHUTDOWN_GRACE_MS = 8_000;
/** How long a writability probe / feed integrity check is reused for. */
const HEALTH_CACHE_MS = 5_000;

const DASHBOARD_DEFS = {
  office: {
    file: 'office.json',
    seed: 'office.json',
    tokenEnv: 'OFFICE_INGEST_TOKEN',
    defaultRoot: {
      schemaVersion: '2.5',
      appVersion: '2.5.0',
      searchName: 'Fluxology GTA private office scout',
      hardAllInCeilingCad: 850,
      listings: [],
    },
    freshnessFields: new Set(['lastVerified', 'firstSeen', 'lastSeen', 'lastChanged', 'priceHistory']),
    priceFields: ['askingRent', 'estimatedAllInMonthly'],
  },
  deals: {
    file: 'deals.json',
    seed: 'deals.json',
    tokenEnv: 'DEALS_INGEST_TOKEN',
    defaultRoot: {
      schemaVersion: 3,
      appVersion: '3.0',
      searchName: 'Fluxology curated shopping deals',
      currency: 'CAD',
      listings: [],
    },
    freshnessFields: new Set(['firstSeen', 'lastSeen', 'lastChanged']),
    priceFields: [],
  },
  jobs: {
    file: 'jobs.json',
    seed: 'jobs.json',
    tokenEnv: 'JOBS_INGEST_TOKEN',
    defaultRoot: {
      schemaVersion: 3,
      appVersion: '3.0',
      searchName: 'Fluxology T176 trades job scout',
      currency: 'CAD',
      listings: [],
    },
    freshnessFields: new Set(['firstSeen', 'lastVerified', 'lastSeen', 'lastChanged']),
    priceFields: [],
  },
};

/**
 * A Map, not a plain object: `DASHBOARDS[scope]` on an object is truthy for
 * every inherited key, so `/v1/__proto__/health` and `/v1/constructor/feed`
 * were accepted as real scopes. Map lookups only ever see own entries.
 */
const DASHBOARDS = new Map(Object.entries(DASHBOARD_DEFS));
const SCOPES = Object.freeze([...DASHBOARDS.keys()]);

const writeQueues = new Map(SCOPES.map(k => [k, Promise.resolve()]));
/** scope -> { ok: boolean, error: string | null } */
const feedState = new Map(SCOPES.map(k => [k, { ok: false, error: 'unchecked' }]));
const startedAt = Date.now();

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

/* ------------------------------------------------------------------ errors */

/**
 * Every error a client can see is one of these: a stable machine-readable
 * code plus an HTTP status chosen at the throw site. `detail` is for the log
 * only and is never serialised into a response, so filesystem paths and
 * parser messages cannot escape.
 */
class ApiError extends Error {
  constructor(code, statusCode = 400, detail = null) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

const badRequest = (code, detail = null) => new ApiError(code, 400, detail);

/* -------------------------------------------------------------- http utils */

function sendJson(res, statusCode, value, extraHeaders = {}, req = null) {
  if (res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(statusCode, {
    ...BASE_HEADERS,
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  if (req && req.method === 'HEAD') return res.end();
  res.end(body);
}

function methodNotAllowed(res, allow, req) {
  sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: allow.join(', ') }, req);
}

/**
 * After answering 413, allow the client a bounded amount of further body so a
 * well-behaved one can finish writing and read the response, then hang up.
 * The budget is measured on the socket because rejecting the body already
 * tore down the request stream — after which Node quietly auto-drains
 * whatever else arrives, with no ceiling at all.
 */
function hangUpAfterDrain(req, allowance) {
  const socket = req.socket;
  if (!socket || socket.destroyed) return;
  let seen = 0;
  const stop = (destroy) => {
    socket.off('data', onData);
    clearTimeout(timer);
    if (destroy && !socket.destroyed) socket.destroy();
  };
  const onData = (chunk) => {
    seen += chunk.length;
    if (seen > allowance) stop(true);
  };
  const timer = setTimeout(() => stop(true), 30_000);
  timer.unref?.();
  socket.on('data', onData);
  socket.once('close', () => stop(false));
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff[0] : xff;
    if (typeof raw === 'string' && raw.trim()) return raw.split(',')[0].trim().slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '').slice(0, 64);
}

function sourceName(req) {
  const raw = req.headers['x-fluxology-source'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.trim()) return 'unknown';
  return value.replace(/[^A-Za-z0-9_.:@/ -]/g, '').trim().slice(0, 96) || 'unknown';
}

function tokenFor(scope) {
  const cfg = DASHBOARDS.get(scope);
  return cfg ? String(process.env[cfg.tokenEnv] || '') : '';
}

function authorized(req, scope) {
  const expected = tokenFor(scope);
  if (!expected) return false;
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false;
  const actual = auth.slice(7);
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * A rejected credential must leave a trace. There is deliberately no audit
 * entry here: audit.jsonl lives on the data volume, and letting an
 * unauthenticated client append to it would be a disk-filling primitive.
 */
function denyUnauthorized(req, res, scope) {
  console.warn(
    `[dashboard-api] 401 unauthorized scope=${scope} method=${req.method} path=${JSON.stringify(String(req.url || '').slice(0, 128))} ip=${JSON.stringify(clientIp(req))} source=${JSON.stringify(sourceName(req))}`,
  );
  sendJson(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' }, req);
}

async function readBody(req) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError('payload_too_large', 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApiError('payload_too_large', 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch (err) {
    throw badRequest('invalid_json', err.message);
  }
}

/* ------------------------------------------------------------------ storage */

function dataPath(scope) {
  return path.join(DATA_DIR, DASHBOARDS.get(scope).file);
}
function seedPath(scope) {
  return path.join(SEED_DIR, DASHBOARDS.get(scope).seed);
}
function auditPath() {
  return path.join(DATA_DIR, 'audit.jsonl');
}

let tmpCounter = 0;

/**
 * Durable atomic replace: write a temp file, fsync it, rename it into place,
 * then fsync the directory so the rename itself survives a power cut. A
 * failure at any step removes the temp file instead of leaving a full-size
 * orphan on the volume.
 *
 * `expectedSignature` is a compare-and-swap guard checked immediately before
 * the rename: an in-process queue cannot stop a second process on the same
 * volume from overwriting the feed between our read and our write, and a
 * silent last-writer-wins loss on the authoritative store is the worst
 * possible failure mode. A mismatch fails the request loudly instead.
 */
async function atomicWrite(file, value, expectedSignature) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  tmpCounter = (tmpCounter + 1) % 1_000_000;
  const tmp = `${file}.${process.pid}.${Date.now()}.${tmpCounter}.tmp`;
  let handle = null;
  try {
    handle = await open(tmp, 'wx', 0o600);
    await handle.writeFile(body, 'utf8');
    await handle.datasync();
    await handle.close();
    handle = null;
    await assertUnchanged(file, expectedSignature);
    await rename(tmp, file);
    await syncDir(path.dirname(file));
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

async function assertUnchanged(file, expectedSignature) {
  if (expectedSignature === undefined) return;
  const current = await stat(file).then(signatureOf).catch(() => null);
  if (current === expectedSignature) return;
  console.error(`[dashboard-api] ${path.basename(file)} changed underneath an in-flight write; refusing to overwrite`);
  throw new ApiError('feed_changed_concurrently', 409);
}

/** Best-effort directory fsync; not every filesystem supports it. */
async function syncDir(dir) {
  let handle = null;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    /* best effort */
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/** Identity of the exact bytes we read, used for cross-process compare-and-swap. */
function signatureOf(info) {
  return `${info.ino}:${info.size}:${info.mtimeMs}`;
}

function feedProblem(feed) {
  if (!feed || typeof feed !== 'object' || Array.isArray(feed)) return 'root is not an object';
  if (!Array.isArray(feed.listings)) return 'listings is not an array';
  for (let i = 0; i < feed.listings.length; i += 1) {
    const row = feed.listings[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) return `listings[${i}] is not an object`;
  }
  return null;
}

/** Parse + validate feed text. Throws an ApiError whose detail stays server-side. */
function parseFeed(raw, scope) {
  let feed;
  try {
    feed = JSON.parse(raw);
  } catch (err) {
    throw new ApiError('feed_unavailable', 503, `${scope} feed is not valid JSON: ${err.message}`);
  }
  const problem = feedProblem(feed);
  if (problem) throw new ApiError('feed_unavailable', 503, `${scope} feed is malformed: ${problem}`);
  return feed;
}

/** Read the feed together with the signature of the bytes we actually read. */
async function readFeedWithSignature(scope) {
  const file = dataPath(scope);
  let handle = null;
  try {
    handle = await open(file, 'r');
    const raw = await handle.readFile('utf8');
    const info = await handle.stat();
    const feed = parseFeed(raw, scope);
    feedState.set(scope, { ok: true, error: null });
    return { feed, signature: signatureOf(info) };
  } catch (err) {
    if (err instanceof ApiError) {
      feedState.set(scope, { ok: false, error: 'corrupt' });
      throw err;
    }
    feedState.set(scope, { ok: false, error: err.code || 'unreadable' });
    throw new ApiError('feed_unavailable', 503, `${scope} feed could not be read: ${err.message}`);
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/* --------------------------------------------------------------- audit log */

let auditQueue = Promise.resolve();

/** Serialise audit appends (and rotation) across scopes. */
function queuedAudit(fn) {
  const next = auditQueue.catch(() => {}).then(fn);
  auditQueue = next.catch(() => {});
  return next;
}

async function rotateAuditIfNeeded(incomingBytes) {
  const file = auditPath();
  const info = await stat(file).catch(() => null);
  if (!info || info.size + incomingBytes <= AUDIT_MAX_BYTES) return;
  for (let i = AUDIT_KEEP_FILES; i >= 1; i -= 1) {
    const from = i === 1 ? file : `${file}.${i - 1}`;
    await rename(from, `${file}.${i}`).catch(() => {});
  }
  console.warn(`[dashboard-api] rotated audit log at ${info.size} bytes (keeping ${AUDIT_KEEP_FILES} generations)`);
}

/** Append one audit line and fsync it before resolving. */
async function appendAudit(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  return queuedAudit(async () => {
    await rotateAuditIfNeeded(Buffer.byteLength(line, 'utf8'));
    const handle = await open(auditPath(), 'a', 0o600);
    try {
      await handle.write(line, null, 'utf8');
      await handle.datasync();
    } finally {
      await handle.close().catch(() => {});
    }
  });
}

/** Best-effort record of a write that did NOT land, including the ids lost. */
async function auditFailure(entry, err) {
  const failure = { ...entry, operation: `${entry.operation}_failed`, error: err?.code || 'write_failed' };
  await appendAudit(failure).catch((auditErr) => {
    console.error('[dashboard-api] could not record failed write in the audit log:', auditErr);
  });
}

/* --------------------------------------------------------------- startup fs */

/**
 * Remove temp files left behind by a previous process. A failed or
 * interrupted write used to leave a full-size `*.tmp` on the volume forever,
 * which is exactly what makes a disk-full condition unrecoverable.
 */
async function sweepTempFiles() {
  let entries;
  try {
    entries = await readdir(DATA_DIR);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith('.tmp')) continue;
    const file = path.join(DATA_DIR, name);
    try {
      const info = await stat(file);
      await unlink(file);
      console.warn(`[dashboard-api] removed stale temp file ${name} (${info.size} bytes)`);
    } catch (err) {
      console.error(`[dashboard-api] could not remove stale temp file ${name}:`, err);
    }
  }
}

async function seedFeed(scope, cfg) {
  let value = null;
  let origin = seedPath(scope);
  try {
    value = parseFeed(await readFile(seedPath(scope), 'utf8'), scope);
  } catch {
    value = null;
  }
  if (!value) {
    value = { ...cfg.defaultRoot, generatedAt: new Date().toISOString() };
    origin = 'built-in default envelope';
  }
  // Seed through atomicWrite: a plain copyFile is not atomic, so a container
  // killed during its first boot used to leave a partial file that every
  // later boot then "skipped" forever.
  await atomicWrite(dataPath(scope), value);
  return origin;
}

/**
 * Make sure every scope has a *parseable* feed. A file that merely exists is
 * not good enough: a zero-byte or truncated feed used to be latched in
 * permanently, served as 200 application/json, and fatal to every write.
 * An unusable file is quarantined (never deleted) and re-seeded.
 */
async function ensureDataFile(scope, cfg) {
  const target = dataPath(scope);
  let raw = null;
  try {
    raw = await readFile(target, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[dashboard-api] cannot read the ${scope} feed:`, err);
  }

  if (raw !== null) {
    try {
      parseFeed(raw, scope);
      feedState.set(scope, { ok: true, error: null });
      return;
    } catch (err) {
      const quarantine = `${target}.corrupt-${Date.now()}`;
      console.error(`[dashboard-api] ${scope} feed is unusable (${err.detail || err.message}); quarantining as ${path.basename(quarantine)} and re-seeding`);
      try {
        await rename(target, quarantine);
      } catch (renameErr) {
        console.error(`[dashboard-api] could not quarantine the ${scope} feed:`, renameErr);
        feedState.set(scope, { ok: false, error: 'corrupt' });
        return;
      }
    }
  }

  try {
    const origin = await seedFeed(scope, cfg);
    feedState.set(scope, { ok: true, error: null });
    console.log(`[dashboard-api] seeded ${scope} feed from ${origin}`);
  } catch (err) {
    console.error(`[dashboard-api] could not seed the ${scope} feed:`, err);
    feedState.set(scope, { ok: false, error: 'seed_failed' });
  }
}

async function ensureDataFiles() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error(`[dashboard-api] data directory ${DATA_DIR} is not usable:`, err);
  }
  await sweepTempFiles();
  for (const [scope, cfg] of DASHBOARDS) {
    try {
      await ensureDataFile(scope, cfg);
    } catch (err) {
      console.error(`[dashboard-api] unexpected error preparing the ${scope} feed:`, err);
      feedState.set(scope, { ok: false, error: 'unavailable' });
    }
  }
}

/* -------------------------------------------------------------- diff helpers */

/**
 * Depth-bounded so a deeply nested value cannot blow the V8 stack. Input
 * validation rejects anything past MAX_LISTING_DEPTH, so the sentinel is only
 * ever reached by data persisted before that check existed — in which case a
 * shallow incoming value compares unequal to it and the record gets repaired.
 */
const STRINGIFY_DEPTH_LIMIT = MAX_LISTING_DEPTH + 8;
const DEPTH_SENTINEL = '"__fluxology_depth_exceeded__"';

function stableStringify(value, depth = 0) {
  if (depth > STRINGIFY_DEPTH_LIMIT) return DEPTH_SENTINEL;
  if (Array.isArray(value)) return `[${value.map(v => stableStringify(v, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k], depth + 1)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function materiallyDifferent(before, after, scope) {
  const ignored = DASHBOARDS.get(scope).freshnessFields;
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (ignored.has(key)) continue;
    if (stableStringify(before?.[key]) !== stableStringify(after?.[key])) return true;
  }
  return false;
}

function fullDifferent(before, after) {
  return stableStringify(before) !== stableStringify(after);
}

/* ---------------------------------------------------------- input validation */

/** Keys that must never enter the stored feed. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
/** Control, format (incl. zero-width), line/paragraph separators. */
const FORBIDDEN_ID_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Canonical primary key: NFC-normalised so `café` (NFC) and `café` (NFD)
 * cannot become two rows that render identically, and free of invisible
 * characters. Returns '' when the value cannot be used as an id.
 */
function canonicalId(value) {
  if (typeof value !== 'string') return '';
  let normalized;
  try {
    normalized = value.normalize('NFC').trim();
  } catch {
    return '';
  }
  if (!normalized || normalized.length > 256) return '';
  if (FORBIDDEN_ID_CHARS.test(normalized)) return '';
  return normalized;
}

/** Deals may derive an id from itemId — but only from a scalar id-shaped value. */
function itemIdToken(value) {
  if (typeof value === 'string') {
    const token = canonicalId(value);
    if (token) return token;
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  throw badRequest('itemId_must_be_string_or_integer');
}

/**
 * One iterative traversal per listing: bounds nesting depth (recursive
 * comparison used to overflow the stack on data JSON.parse accepted happily)
 * and rejects prototype-shaped keys before they reach the stored feed.
 */
function validateListingShape(root) {
  const stack = [[root, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (depth > MAX_LISTING_DEPTH) throw badRequest('listing_too_deeply_nested');
    if (Array.isArray(node)) {
      for (const child of node) if (child && typeof child === 'object') stack.push([child, depth + 1]);
      continue;
    }
    for (const key of Object.getOwnPropertyNames(node)) {
      if (FORBIDDEN_KEYS.has(key)) throw badRequest('listing_key_not_allowed');
      const child = node[key];
      if (child && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
}

function listingIdOf(raw, scope) {
  if (raw.id !== undefined && raw.id !== null && raw.id !== '') {
    const id = canonicalId(raw.id);
    if (!id) throw badRequest('listing_id_invalid');
    return id;
  }
  if (scope === 'deals' && raw.itemId !== undefined && raw.itemId !== null) {
    const id = canonicalId(`ebay-${itemIdToken(raw.itemId)}`);
    if (!id) throw badRequest('listing_id_invalid');
    return id;
  }
  throw badRequest('listing_id_required');
}

/** Validate one incoming listing completely, before anything is persisted. */
function validateIncomingListing(raw, scope) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('listing_must_be_object');
  validateListingShape(raw);
  return listingIdOf(raw, scope);
}

function normalizePayload(body, scope) {
  const listings = Array.isArray(body) ? body : body?.listings;
  if (!Array.isArray(listings)) throw badRequest('body_must_contain_listings_array');
  if (listings.length > MAX_LISTINGS_PER_WRITE) throw new ApiError('too_many_listings', 413);
  return listings.map(row => ({ row, id: validateIncomingListing(row, scope) }));
}

function normalizeIncomingListing(raw, id, scope, prior, now) {
  const merged = { ...(prior || {}), ...raw, id };
  if (prior?.firstSeen && raw.firstSeen == null) merged.firstSeen = prior.firstSeen;
  if (!prior && merged.firstSeen == null && scope !== 'office') merged.firstSeen = now;

  const material = prior ? materiallyDifferent(prior, merged, scope) : true;
  if (material && raw.lastChanged == null) merged.lastChanged = now;
  else if (!material && prior?.lastChanged && raw.lastChanged == null) merged.lastChanged = prior.lastChanged;

  if (scope === 'office') {
    const history = Array.isArray(prior?.priceHistory)
      ? prior.priceHistory.map(x => ({ ...x }))
      : Array.isArray(raw.priceHistory) ? raw.priceHistory.map(x => ({ ...x })) : [];
    const changedPrice = DASHBOARD_DEFS.office.priceFields.some(field => prior && raw[field] !== undefined && stableStringify(prior[field]) !== stableStringify(merged[field]));
    if (prior && changedPrice) {
      const point = {
        date: merged.lastChanged || now,
        askingRent: merged.askingRent ?? null,
        estimatedAllInMonthly: merged.estimatedAllInMonthly ?? null,
      };
      const last = history.at(-1);
      if (!last || stableStringify(last) !== stableStringify(point)) history.push(point);
    }
    if (!prior && !history.length && (merged.askingRent != null || merged.estimatedAllInMonthly != null)) {
      history.push({
        date: merged.lastChanged || now,
        askingRent: merged.askingRent ?? null,
        estimatedAllInMonthly: merged.estimatedAllInMonthly ?? null,
      });
    }
    merged.priceHistory = history;
  }

  return { merged, material };
}

/* -------------------------------------------------------------- write paths */

async function queued(scope, fn) {
  const previous = writeQueues.get(scope) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  writeQueues.set(scope, next);
  return next;
}

/**
 * In-flight write requests. `server.close()` only waits for open connections,
 * so a request whose client hung up would otherwise be killed mid-write by
 * the shutdown path — losing the write and orphaning its temp file.
 */
let inFlightWrites = 0;
let notifyIdle = null;

async function trackedWrite(fn) {
  inFlightWrites += 1;
  try {
    return await fn();
  } finally {
    inFlightWrites -= 1;
    if (inFlightWrites === 0 && notifyIdle) {
      notifyIdle();
      notifyIdle = null;
    }
  }
}

function writesIdle() {
  if (inFlightWrites === 0) return Promise.resolve();
  return new Promise((resolve) => { notifyIdle = resolve; });
}

/**
 * Commit a feed, then record it. The audit line is written *before* the
 * rename so a failing audit log cannot leave a change live-but-unrecorded
 * while the client is told 500; if the commit itself then fails, a
 * compensating `*_failed` entry naming the affected ids is appended.
 */
async function commitFeed(scope, feed, entry, expectedSignature) {
  // Cheap early-out; atomicWrite re-checks immediately before the rename.
  await assertUnchanged(dataPath(scope), expectedSignature);
  try {
    await appendAudit(entry);
  } catch (err) {
    console.error(`[dashboard-api] audit append failed for ${scope}; the change was NOT committed:`, err);
    throw new ApiError('audit_write_failed', 500, err.message);
  }
  try {
    await atomicWrite(dataPath(scope), feed, expectedSignature);
  } catch (err) {
    console.error(`[dashboard-api] ${scope} ${entry.operation} FAILED for ids ${JSON.stringify(entry.changedIds || entry.listingIds || [])}:`, err);
    await auditFailure(entry, err);
    if (err instanceof ApiError) throw err;
    throw new ApiError('write_failed', 500, err.message);
  }
}

async function upsert(scope, incoming, req) {
  return queued(scope, async () => {
    const { feed, signature } = await readFeedWithSignature(scope);
    const now = new Date().toISOString();

    const byId = new Map();
    feed.listings.forEach((listing, index) => {
      const stored = typeof listing?.id === 'string' ? listing.id : String(listing?.id ?? '');
      const entry = { listing, index };
      if (stored && !byId.has(stored)) byId.set(stored, entry);
      const canonical = canonicalId(stored);
      if (canonical && !byId.has(canonical)) byId.set(canonical, entry);
    });

    const changedIds = [];
    const materialIds = [];

    for (const { row, id } of incoming) {
      const priorEntry = byId.get(id);
      const { merged, material } = normalizeIncomingListing(row, id, scope, priorEntry?.listing, now);
      if (!priorEntry) {
        feed.listings.push(merged);
        byId.set(id, { listing: merged, index: feed.listings.length - 1 });
        changedIds.push(id);
        materialIds.push(id);
      } else if (fullDifferent(priorEntry.listing, merged)) {
        feed.listings[priorEntry.index] = merged;
        byId.set(id, { listing: merged, index: priorEntry.index });
        changedIds.push(id);
        if (material) materialIds.push(id);
      }
    }

    if (!changedIds.length) return { changed: false, count: feed.listings.length, changedIds: [], materialIds: [] };
    if (feed.listings.length > MAX_FULL_FEED_LISTINGS) {
      // Refusing here keeps the store restorable: a feed that grew past what
      // PUT /feed accepts could never be put back from a backup.
      throw new ApiError('feed_capacity_exceeded', 413);
    }

    feed.generatedAt = now;
    await commitFeed(scope, feed, {
      at: now,
      scope,
      operation: 'upsert',
      source: sourceName(req),
      ip: clientIp(req),
      changedIds,
      materialIds,
      totalListings: feed.listings.length,
    }, signature);

    return { changed: true, count: feed.listings.length, changedIds, materialIds, generatedAt: now };
  });
}

/** Ids recorded per replace entry; a full restore must not bloat the log. */
const AUDIT_ID_SAMPLE = 500;

async function replaceFeed(scope, body, req) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.listings)) {
    throw badRequest('full_feed_object_required');
  }
  if (body.listings.length > MAX_FULL_FEED_LISTINGS) throw new ApiError('too_many_listings', 413);

  const seen = new Set();
  const listings = body.listings.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw badRequest('every_listing_requires_id');
    validateListingShape(row);
    const id = canonicalId(row.id);
    if (!id) throw badRequest('every_listing_requires_id');
    if (seen.has(id)) {
      // The id is deliberately not echoed: it used to be interpolated into
      // the error message, and the status code was derived from that text.
      console.warn(`[dashboard-api] rejected ${scope} PUT: duplicate listing id ${JSON.stringify(id.slice(0, 256))}`);
      throw badRequest('duplicate_listing_id');
    }
    seen.add(id);
    return { ...row, id };
  });

  return queued(scope, async () => {
    const next = { ...body, listings, generatedAt: new Date().toISOString() };
    const listingIds = listings.slice(0, AUDIT_ID_SAMPLE).map(row => row.id);
    await commitFeed(scope, next, {
      at: next.generatedAt,
      scope,
      operation: 'replace',
      source: sourceName(req),
      ip: clientIp(req),
      listingIds,
      listingIdsTruncated: listings.length > AUDIT_ID_SAMPLE,
      totalListings: listings.length,
    });
    feedState.set(scope, { ok: true, error: null });
    return { changed: true, count: listings.length, generatedAt: next.generatedAt };
  });
}

/* --------------------------------------------------------------- read paths */

function etagFor(raw) {
  return `"${createHash('sha256').update(raw).digest('base64url')}"`;
}

/** RFC 9110 If-None-Match: handles `*`, weak validators and etag lists. */
function etagMatches(header, etag) {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string' || !raw.trim()) return false;
  if (raw.trim() === '*') return true;
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .some(candidate => candidate === etag || candidate.replace(/^W\//, '') === etag);
}

/**
 * Serve the feed only after proving it parses. Serving unparsed bytes meant a
 * corrupt file went out as 200 application/json and every dashboard rendered
 * whatever it got.
 */
async function serveFeed(scope, req, res) {
  let raw;
  try {
    raw = await readFile(dataPath(scope));
  } catch (err) {
    feedState.set(scope, { ok: false, error: err.code || 'unreadable' });
    throw new ApiError('feed_unavailable', 503, `${scope} feed could not be read: ${err.message}`);
  }
  try {
    parseFeed(raw.toString('utf8'), scope);
    feedState.set(scope, { ok: true, error: null });
  } catch (err) {
    feedState.set(scope, { ok: false, error: 'corrupt' });
    throw err;
  }

  const etag = etagFor(raw);
  if (etagMatches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, { ...BASE_HEADERS, ETag: etag });
    return res.end();
  }
  res.writeHead(200, {
    ...BASE_HEADERS,
    ETag: etag,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': raw.length,
  });
  if (req.method === 'HEAD') return res.end();
  res.end(raw);
}

/* ------------------------------------------------------------------- health */

let writeProbe = { at: 0, ok: false, error: 'unchecked' };
let probeLogged = null;

/** Actually try to write to the data volume; health must not assert what it has not tested. */
async function probeWritable() {
  if (Date.now() - writeProbe.at < HEALTH_CACHE_MS) return writeProbe;
  const file = path.join(DATA_DIR, `.write-probe.${process.pid}`);
  let handle = null;
  try {
    handle = await open(file, 'w', 0o600);
    await handle.writeFile(String(Date.now()), 'utf8');
    await handle.datasync();
    writeProbe = { at: Date.now(), ok: true, error: null };
  } catch (err) {
    writeProbe = { at: Date.now(), ok: false, error: err.code || 'write_failed' };
    if (probeLogged !== false) console.error('[dashboard-api] data volume is NOT writable:', err);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(file).catch(() => {});
  }
  if (probeLogged === false && writeProbe.ok) console.log('[dashboard-api] data volume is writable again');
  probeLogged = writeProbe.ok;
  return writeProbe;
}

let feedCheckAt = 0;

/** Re-parse each feed (cached briefly) so health reflects the real files. */
async function refreshFeedState() {
  if (Date.now() - feedCheckAt < HEALTH_CACHE_MS) return;
  feedCheckAt = Date.now();
  for (const scope of SCOPES) {
    try {
      parseFeed(await readFile(dataPath(scope), 'utf8'), scope);
      feedState.set(scope, { ok: true, error: null });
    } catch (err) {
      feedState.set(scope, { ok: false, error: err instanceof ApiError ? 'corrupt' : err.code || 'unreadable' });
    }
  }
}

async function healthSnapshot() {
  const [probe] = await Promise.all([probeWritable(), refreshFeedState()]);
  const scopes = {};
  let anyWritable = false;
  let allFeedsOk = true;
  for (const scope of SCOPES) {
    const state = feedState.get(scope) || { ok: false, error: 'unchecked' };
    const tokenConfigured = Boolean(tokenFor(scope));
    const writeEnabled = tokenConfigured && probe.ok;
    if (writeEnabled) anyWritable = true;
    if (!state.ok) allFeedsOk = false;
    scopes[scope] = { writeEnabled, tokenConfigured, feedOk: state.ok };
  }
  return { probe, scopes, anyWritable, allFeedsOk };
}

/* ------------------------------------------------------------------ routing */

function parseRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'v1') return null;
  const scope = parts[1];
  if (!DASHBOARDS.has(scope)) return null;
  return { scope, action: parts.slice(2).join('/') };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD'], req);
      const { probe, scopes, anyWritable, allFeedsOk } = await healthSnapshot();
      const healthy = probe.ok && allFeedsOk;
      return sendJson(res, healthy ? 200 : 503, {
        status: healthy ? 'ok' : 'degraded',
        service: 'fluxology-dashboard-api',
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        writeEnabled: anyWritable,
        dataWritable: probe.ok,
        scopes,
      }, {}, req);
    }

    const route = parseRoute(url.pathname);
    if (!route) return sendJson(res, 404, { error: 'not_found' }, {}, req);
    const { scope, action } = route;

    if (action === 'health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD'], req);
      const { probe, scopes } = await healthSnapshot();
      const state = scopes[scope];
      const healthy = probe.ok && state.feedOk;
      return sendJson(res, healthy ? 200 : 503, {
        status: healthy ? 'ok' : 'degraded',
        scope,
        writeEnabled: state.writeEnabled,
        tokenConfigured: state.tokenConfigured,
        feedOk: state.feedOk,
        dataWritable: probe.ok,
      }, {}, req);
    }

    if (action === 'feed') {
      if (req.method === 'GET' || req.method === 'HEAD') return await serveFeed(scope, req, res);
      if (req.method === 'PUT') {
        if (!authorized(req, scope)) return denyUnauthorized(req, res, scope);
        const result = await trackedWrite(async () => {
          const body = await readBody(req);
          return replaceFeed(scope, body, req);
        });
        return sendJson(res, 200, { ok: true, scope, ...result }, {}, req);
      }
      return methodNotAllowed(res, ['GET', 'HEAD', 'PUT'], req);
    }

    if (action === 'upsert') {
      if (req.method !== 'POST') return methodNotAllowed(res, ['POST'], req);
      if (!authorized(req, scope)) return denyUnauthorized(req, res, scope);
      const result = await trackedWrite(async () => {
        const body = await readBody(req);
        return upsert(scope, normalizePayload(body, scope), req);
      });
      return sendJson(res, 200, { ok: true, scope, ...result }, {}, req);
    }

    return sendJson(res, 404, { error: 'not_found' }, {}, req);
  } catch (err) {
    const api = err instanceof ApiError ? err : null;
    const statusCode = api ? api.statusCode : 500;
    const code = api ? api.code : 'internal_error';
    if (statusCode >= 500) {
      console.error(`[dashboard-api] ${req.method} ${req.url} -> ${statusCode} ${code}:`, api?.detail ?? err);
    }
    sendJson(res, statusCode, { error: code }, statusCode === 413 ? { Connection: 'close' } : {}, req);
    if (statusCode === 413) hangUpAfterDrain(req, MAX_BODY_BYTES * DRAIN_ALLOWANCE);
  }
});

// Slow-loris defences, matching contact-api.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

await ensureDataFiles();
await probeWritable();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`fluxology-dashboard-api listening on 0.0.0.0:${PORT}`);
  console.log(`[dashboard-api] limits: maxBodyBytes=${MAX_BODY_BYTES} maxListingsPerWrite=${MAX_LISTINGS_PER_WRITE} maxFullFeedListings=${MAX_FULL_FEED_LISTINGS} maxListingDepth=${MAX_LISTING_DEPTH} auditMaxBytes=${AUDIT_MAX_BYTES}`);
  for (const [scope, cfg] of DASHBOARDS) {
    const token = tokenFor(scope);
    console.log(`${scope} writes ${token ? 'enabled' : 'DISABLED (token not set)'}`);
    if (token && token.length < MIN_TOKEN_LENGTH) {
      console.warn(`[dashboard-api] WARNING: ${cfg.tokenEnv} is only ${token.length} characters; generate at least ${MIN_TOKEN_LENGTH} (openssl rand -hex 32)`);
    }
  }
  if (!writeProbe.ok) console.error(`[dashboard-api] WARNING: ${DATA_DIR} is not writable (${writeProbe.error}); /health will report degraded`);
});

/** Wait for every in-flight write to finish, including ones queued while draining. */
async function drainWrites(rounds = 5) {
  await writesIdle();
  for (let i = 0; i < rounds; i += 1) {
    const pending = [...writeQueues.values()];
    await Promise.allSettled([...pending, auditQueue]);
    const after = [...writeQueues.values()];
    if (pending.every((promise, index) => promise === after[index])) return;
  }
}

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: shutting down`);
  const timer = setTimeout(() => {
    console.error('[dashboard-api] shutdown timed out; exiting');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
  try {
    server.closeIdleConnections?.();
    await new Promise(resolve => server.close(resolve));
    // server.close() knows nothing about the write queues: a request whose
    // client hung up leaves its handler running, and exiting here would
    // truncate an in-progress write.
    await drainWrites();
  } catch (err) {
    console.error('[dashboard-api] error during shutdown:', err);
  }
  clearTimeout(timer);
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });
