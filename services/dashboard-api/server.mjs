#!/usr/bin/env node
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, appendFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8082);
const DATA_DIR = process.env.DATA_DIR || '/data';
const SEED_DIR = process.env.SEED_DIR || '/seed';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1_048_576);
const MAX_LISTINGS_PER_WRITE = Number(process.env.MAX_LISTINGS_PER_WRITE || 500);
const TRUST_PROXY = String(process.env.TRUST_PROXY || 'true').toLowerCase() === 'true';
const SHUTDOWN_GRACE_MS = 8_000;

const DASHBOARDS = Object.freeze({
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
});

const writeQueues = new Map(Object.keys(DASHBOARDS).map(k => [k, Promise.resolve()]));
const startedAt = Date.now();

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

function sendJson(res, statusCode, value, extraHeaders = {}) {
  if (res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(statusCode, {
    ...BASE_HEADERS,
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

function methodNotAllowed(res, allow) {
  sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: allow.join(', ') });
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
  return String(process.env[DASHBOARDS[scope].tokenEnv] || '');
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

async function readBody(req) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    const err = new Error('payload_too_large');
    err.statusCode = 413;
    throw err;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error('payload_too_large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const err = new Error('invalid_json');
    err.statusCode = 400;
    throw err;
  }
}

function dataPath(scope) {
  return path.join(DATA_DIR, DASHBOARDS[scope].file);
}
function seedPath(scope) {
  return path.join(SEED_DIR, DASHBOARDS[scope].seed);
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

async function atomicWrite(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, file);
}

async function ensureDataFiles() {
  await mkdir(DATA_DIR, { recursive: true });
  for (const [scope, cfg] of Object.entries(DASHBOARDS)) {
    const target = dataPath(scope);
    if (await exists(target)) continue;
    const seed = seedPath(scope);
    if (await exists(seed)) await copyFile(seed, target);
    else await atomicWrite(target, { ...cfg.defaultRoot, generatedAt: new Date().toISOString() });
  }
}

async function readFeed(scope) {
  const raw = await readFile(dataPath(scope), 'utf8');
  const feed = JSON.parse(raw);
  if (!feed || typeof feed !== 'object' || !Array.isArray(feed.listings)) throw new Error(`corrupt_${scope}_feed`);
  return feed;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function materiallyDifferent(before, after, scope) {
  const ignored = DASHBOARDS[scope].freshnessFields;
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

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function normalizeIncomingListing(raw, scope, prior, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('listing_must_be_object');
  let id = raw.id;
  if (!validId(id) && scope === 'deals' && raw.itemId != null) id = `ebay-${String(raw.itemId).trim()}`;
  if (!validId(id)) throw new Error('listing_id_required');
  id = id.trim();

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
    const changedPrice = DASHBOARDS.office.priceFields.some(field => prior && raw[field] !== undefined && stableStringify(prior[field]) !== stableStringify(merged[field]));
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

function normalizePayload(body) {
  const listings = Array.isArray(body) ? body : body?.listings;
  if (!Array.isArray(listings)) throw new Error('body_must_contain_listings_array');
  if (listings.length > MAX_LISTINGS_PER_WRITE) throw new Error('too_many_listings');
  return listings;
}

async function appendAudit(entry) {
  await appendFile(path.join(DATA_DIR, 'audit.jsonl'), `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function queued(scope, fn) {
  const previous = writeQueues.get(scope) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  writeQueues.set(scope, next);
  return next;
}

async function upsert(scope, incoming, req) {
  return queued(scope, async () => {
    const feed = await readFeed(scope);
    const now = new Date().toISOString();
    const byId = new Map(feed.listings.map((l, i) => [String(l.id || ''), { listing: l, index: i }]));
    const changedIds = [];
    const materialIds = [];

    for (const raw of incoming) {
      const candidateId = validId(raw?.id)
        ? raw.id.trim()
        : scope === 'deals' && raw?.itemId != null ? `ebay-${String(raw.itemId).trim()}` : '';
      const priorEntry = byId.get(candidateId);
      const { merged, material } = normalizeIncomingListing(raw, scope, priorEntry?.listing, now);
      if (!priorEntry) {
        feed.listings.push(merged);
        byId.set(merged.id, { listing: merged, index: feed.listings.length - 1 });
        changedIds.push(merged.id);
        materialIds.push(merged.id);
      } else if (fullDifferent(priorEntry.listing, merged)) {
        feed.listings[priorEntry.index] = merged;
        byId.set(merged.id, { listing: merged, index: priorEntry.index });
        changedIds.push(merged.id);
        if (material) materialIds.push(merged.id);
      }
    }

    if (!changedIds.length) return { changed: false, count: feed.listings.length, changedIds: [], materialIds: [] };
    feed.generatedAt = now;
    await atomicWrite(dataPath(scope), feed);
    await appendAudit({
      at: now,
      scope,
      operation: 'upsert',
      source: sourceName(req),
      ip: clientIp(req),
      changedIds,
      materialIds,
      totalListings: feed.listings.length,
    });
    return { changed: true, count: feed.listings.length, changedIds, materialIds, generatedAt: now };
  });
}

async function replaceFeed(scope, body, req) {
  return queued(scope, async () => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.listings)) throw new Error('full_feed_object_required');
    if (body.listings.length > MAX_LISTINGS_PER_WRITE) throw new Error('too_many_listings');
    const seen = new Set();
    for (const row of body.listings) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || !validId(row.id)) throw new Error('every_listing_requires_id');
      if (seen.has(row.id)) throw new Error(`duplicate_listing_id:${row.id}`);
      seen.add(row.id);
    }
    const next = { ...body, generatedAt: new Date().toISOString() };
    await atomicWrite(dataPath(scope), next);
    await appendAudit({
      at: next.generatedAt,
      scope,
      operation: 'replace',
      source: sourceName(req),
      ip: clientIp(req),
      totalListings: next.listings.length,
    });
    return { changed: true, count: next.listings.length, generatedAt: next.generatedAt };
  });
}

function etagFor(raw) {
  return `\"${createHash('sha256').update(raw).digest('base64url')}\"`;
}

async function serveFeed(scope, req, res) {
  const raw = await readFile(dataPath(scope));
  const etag = etagFor(raw);
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...BASE_HEADERS, ETag: etag });
    return res.end();
  }
  res.writeHead(200, {
    ...BASE_HEADERS,
    ETag: etag,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': raw.length,
  });
  res.end(raw);
}

function parseRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'v1') return null;
  const scope = parts[1];
  if (!DASHBOARDS[scope]) return null;
  return { scope, action: parts.slice(2).join('/') };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') {
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, {
        status: 'ok',
        service: 'fluxology-dashboard-api',
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        writeEnabled: Object.fromEntries(Object.keys(DASHBOARDS).map(scope => [scope, Boolean(tokenFor(scope))])),
      });
    }

    const route = parseRoute(url.pathname);
    if (!route) return sendJson(res, 404, { error: 'not_found' });
    const { scope, action } = route;

    if (action === 'health') {
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, { status: 'ok', scope, writeEnabled: Boolean(tokenFor(scope)) });
    }

    if (action === 'feed') {
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (req.method === 'HEAD') {
          const raw = await readFile(dataPath(scope));
          res.writeHead(200, { ...BASE_HEADERS, ETag: etagFor(raw), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.length });
          return res.end();
        }
        return await serveFeed(scope, req, res);
      }
      if (req.method === 'PUT') {
        if (!authorized(req, scope)) return sendJson(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
        const body = await readBody(req);
        const result = await replaceFeed(scope, body, req);
        return sendJson(res, 200, { ok: true, scope, ...result });
      }
      return methodNotAllowed(res, ['GET', 'HEAD', 'PUT']);
    }

    if (action === 'upsert') {
      if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
      if (!authorized(req, scope)) return sendJson(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
      const body = await readBody(req);
      const incoming = normalizePayload(body);
      const result = await upsert(scope, incoming, req);
      return sendJson(res, 200, { ok: true, scope, ...result });
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal_error';
    const badRequest = message.includes('required') || message.includes('must_') || message.includes('duplicate_') || message.includes('invalid_') || message.includes('full_feed');
    const statusCode = Number(err?.statusCode) || (message.includes('too_many') ? 413 : badRequest ? 400 : 500);
    if (statusCode >= 500) console.error(err);
    sendJson(res, statusCode, { error: message });
  }
});

await ensureDataFiles();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`fluxology-dashboard-api listening on 0.0.0.0:${PORT}`);
  for (const scope of Object.keys(DASHBOARDS)) console.log(`${scope} writes ${tokenFor(scope) ? 'enabled' : 'DISABLED (token not set)'}`);
});

function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  const timer = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  server.close(() => {
    clearTimeout(timer);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
