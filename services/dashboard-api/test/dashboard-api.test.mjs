/**
 * End-to-end tests for the dashboard API.
 *
 * Every test drives a real server process over real HTTP (node's global
 * fetch) — no mocks, no in-process shortcuts. The server is spawned exactly
 * the way the container starts it (`node server.mjs`), with its own DATA_DIR
 * and SEED_DIR, so startup seeding, health, durability and SIGTERM handling
 * are all covered.
 *
 * Run with:  npm test
 * Ports 8300-8314 are used; temp files go to $DASHBOARD_API_TEST_TMP
 * (default: a mkdtemp under os.tmpdir).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STRACE = '/usr/bin/strace';
const HAS_STRACE = existsSync(STRACE);

/**
 * Binary presence is not capability: GitHub-hosted runners ship strace but
 * forbid attaching to a non-child process (`ptrace(PTRACE_SEIZE): Operation
 * not permitted` under the default Yama/seccomp policy), which failed the
 * durability test in CI while it passed everywhere ptrace is allowed. Probe
 * an actual attach against a throwaway child so the skip reflects what this
 * environment can really do — the assertion stays live locally and on any
 * runner with ptrace enabled.
 */
async function canPtraceAttach() {
  if (!HAS_STRACE) return false;
  const target = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });
  // Subscribe to 'exit' BEFORE any await: a child that exits while we are
  // waiting elsewhere (exactly what happens when the attach is denied and
  // strace bails out immediately) emits 'exit' once, and a later
  // once(child, 'exit') would wait forever on an event that already fired —
  // which left this very probe as an unsettled top-level await in CI.
  const targetExited = once(target, 'exit').catch(() => {});
  try {
    const tracer = spawn(STRACE, ['-p', String(target.pid), '-e', 'trace=exit_group', '-o', '/dev/null'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const tracerExited = once(tracer, 'exit').catch(() => {});
    let stderr = '';
    tracer.stderr.setEncoding('utf8');
    tracer.stderr.on('data', (d) => (stderr += d));
    const deadline = Date.now() + 3_000;
    while (!/attached/.test(stderr) && tracer.exitCode === null && Date.now() < deadline) {
      await delay(25);
    }
    const attached = /attached/.test(stderr);
    tracer.kill(attached ? 'SIGINT' : 'SIGKILL');
    await tracerExited;
    return attached;
  } finally {
    target.kill('SIGKILL');
    await targetExited;
  }
}

const CAN_TRACE = await canPtraceAttach();

/** Long enough not to trip the weak-token startup warning. */
const TOKEN = 'f0'.repeat(32);

let TMP_ROOT;

before(async () => {
  if (process.env.DASHBOARD_API_TEST_TMP) {
    const base = path.resolve(process.env.DASHBOARD_API_TEST_TMP);
    await mkdir(base, { recursive: true });
    TMP_ROOT = await mkdtemp(path.join(base, 'run-'));
  } else {
    TMP_ROOT = await mkdtemp(path.join(os.tmpdir(), 'dashboard-api-test-'));
  }
});

after(async () => {
  if (TMP_ROOT && !process.env.DASHBOARD_API_KEEP_TMP) await rm(TMP_ROOT, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ helpers */

const SEED_FEEDS = {
  office: {
    schemaVersion: '2.5',
    appVersion: '2.5.0',
    searchName: 'test office scout',
    hardAllInCeilingCad: 850,
    generatedAt: '2026-01-01T00:00:00.000Z',
    listings: [{ id: 'office-1', name: 'Suite 1', askingRent: 800 }],
  },
  deals: {
    schemaVersion: 3,
    appVersion: '3.0',
    searchName: 'test deals',
    currency: 'CAD',
    generatedAt: '2026-01-01T00:00:00.000Z',
    listings: [{ id: 'ebay-1', title: 'Lot 1' }],
  },
  jobs: {
    schemaVersion: 3,
    appVersion: '3.0',
    searchName: 'test jobs',
    currency: 'CAD',
    generatedAt: '2026-01-01T00:00:00.000Z',
    listings: [],
  },
};

/** Create a fresh DATA_DIR + SEED_DIR pair under the test temp root. */
async function prepareDirs(name, { seeds = SEED_FEEDS, makeDataDir = true } = {}) {
  const root = path.join(TMP_ROOT, name);
  const dataDir = path.join(root, 'data');
  const seedDir = path.join(root, 'seed');
  await mkdir(seedDir, { recursive: true });
  if (makeDataDir) await mkdir(dataDir, { recursive: true });
  for (const [scope, feed] of Object.entries(seeds)) {
    await writeFile(path.join(seedDir, `${scope}.json`), `${JSON.stringify(feed, null, 2)}\n`, 'utf8');
  }
  return { root, dataDir, seedDir };
}

/**
 * Attach strace to a running process for the duration of `fn`, and return the
 * matching trace lines. SIGINT makes strace detach cleanly and flush its
 * output file, which leaves the traced server untouched.
 */
async function traceSyncs(pid, tracePath, fn) {
  const tracer = spawn(STRACE, ['-f', '-p', String(pid), '-e', 'trace=fdatasync,fsync', '-o', tracePath], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  tracer.stderr.setEncoding('utf8');
  tracer.stderr.on('data', (d) => (stderr += d));
  const exited = once(tracer, 'exit');

  const deadline = Date.now() + 10_000;
  while (!/attached/.test(stderr)) {
    if (tracer.exitCode !== null) throw new Error(`strace exited before attaching: ${stderr}`);
    if (Date.now() > deadline) {
      tracer.kill('SIGKILL');
      throw new Error(`strace did not attach in time: ${stderr}`);
    }
    await delay(50);
  }

  try {
    await fn();
  } finally {
    tracer.kill('SIGINT');
    const hard = setTimeout(() => tracer.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(hard);
  }

  const trace = await readFile(tracePath, 'utf8');
  return trace.split('\n').filter((line) => /\b(fdatasync|fsync)\(/.test(line));
}

/** Spawn the service and wait until it reports it is listening. */
async function startServer({ port, dataDir, seedDir, env = {} }) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(port),
      DATA_DIR: dataDir,
      SEED_DIR: seedDir,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const exited = once(child, 'exit');

  const deadline = Date.now() + 15_000;
  while (!stdout.includes('listening on')) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`server exited during startup\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`server did not start in time\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    await delay(40);
  }

  return {
    child,
    port,
    dataDir,
    seedDir,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get log() { return `${stdout}\n${stderr}`; },
    async stop(signal = 'SIGTERM') {
      if (child.exitCode !== null || child.signalCode) return { code: child.exitCode, signal: child.signalCode };
      child.kill(signal);
      const hard = setTimeout(() => child.kill('SIGKILL'), 15_000);
      const [code, sig] = await exited;
      clearTimeout(hard);
      return { code, signal: sig };
    },
  };
}

function url(port, pathname) {
  return `http://127.0.0.1:${port}${pathname}`;
}

function get(port, pathname, init = {}) {
  return fetch(url(port, pathname), init);
}

function write(port, pathname, body, { method = 'POST', token = TOKEN, headers = {}, signal } = {}) {
  return fetch(url(port, pathname), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });
}

async function readFeedFile(dataDir, scope) {
  return JSON.parse(await readFile(path.join(dataDir, `${scope}.json`), 'utf8'));
}

async function idsOnDisk(dataDir, scope) {
  return (await readFeedFile(dataDir, scope)).listings.map((l) => l.id);
}

async function auditLines(dataDir, suffix = '') {
  try {
    const raw = await readFile(path.join(dataDir, `audit.jsonl${suffix}`), 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function tempFiles(dataDir) {
  try {
    return (await readdir(dataDir)).filter((n) => n.endsWith('.tmp'));
  } catch {
    return [];
  }
}

/** Nested-array JSON text of the given depth, built without recursion. */
function deepJson(depth) {
  return `${'['.repeat(depth)}"x"${']'.repeat(depth)}`;
}

/**
 * Wait until a `*.tmp` file appears in the data dir. A temp file exists only
 * between the start of an atomic write and its rename, so this pins a test to
 * the exact moment a write is in flight — no sleep-and-hope.
 */
async function waitForTempFile(dataDir, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await tempFiles(dataDir);
    if (found.length) return found[0];
    await delay(2);
  }
  throw new Error(`no temp file appeared in ${dataDir} within ${timeoutMs}ms`);
}

/* ================================================================== *
 * Routing, the read path, and conditional requests
 * ================================================================== */

describe('routing and the public read path', () => {
  const PORT = 8300;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('routing');
    server = await startServer({ port: PORT, dataDir: dirs.dataDir, seedDir: dirs.seedDir });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0, 'server should exit cleanly on SIGTERM');
  });

  it('seeds all three feeds and reports healthy', async () => {
    const res = await get(PORT, '/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.dataWritable, true);
    for (const scope of ['office', 'deals', 'jobs']) {
      assert.equal(body.scopes[scope].feedOk, true, `${scope} feed should be readable`);
    }
  });

  // The scope table used to be a plain object, so every key inherited from
  // Object.prototype looked like a real dashboard.
  it('rejects inherited Object.prototype keys as scopes', async () => {
    for (const fake of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf']) {
      for (const action of ['health', 'feed']) {
        const res = await get(PORT, `/v1/${fake}/${action}`);
        const text = await res.text();
        assert.equal(res.status, 404, `GET /v1/${fake}/${action} should be 404, got ${res.status} ${text}`);
        assert.equal(text, JSON.stringify({ error: 'not_found' }));
      }
    }
  });

  it('rejects an unknown scope with a machine-readable 404', async () => {
    const res = await get(PORT, '/v1/nope/feed');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
  });

  it('never leaks an internal path in an error body', async () => {
    for (const pathname of ['/v1/constructor/feed', '/v1/__proto__/feed', '/nope', '/v1/deals/nope']) {
      const res = await get(PORT, pathname);
      const text = await res.text();
      assert.ok(!text.includes('/'), `${pathname} leaked a path: ${text}`);
      assert.ok(!text.includes(TMP_ROOT), `${pathname} leaked the data dir: ${text}`);
    }
  });

  it('serves a feed that actually parses, with a strong ETag', async () => {
    const res = await get(PORT, '/v1/deals/feed');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.match(res.headers.get('etag') ?? '', /^"[A-Za-z0-9_-]+"$/);
    const body = await res.json();
    assert.ok(Array.isArray(body.listings));
  });

  it('honours If-None-Match for *, weak validators and etag lists', async () => {
    const first = await get(PORT, '/v1/deals/feed');
    const etag = first.headers.get('etag');
    await first.text();

    for (const header of [etag, `W/${etag}`, '*', `"aaa", ${etag}`, `"aaa",${etag}`]) {
      const res = await get(PORT, '/v1/deals/feed', { headers: { 'if-none-match': header } });
      assert.equal(res.status, 304, `If-None-Match: ${header} should be 304`);
      assert.equal(res.headers.get('etag'), etag);
      assert.equal(await res.text(), '');
    }

    const miss = await get(PORT, '/v1/deals/feed', { headers: { 'if-none-match': '"nope"' } });
    assert.equal(miss.status, 200);
    await miss.text();
  });

  it('answers HEAD wherever it answers GET, including 304', async () => {
    const probe = await get(PORT, '/v1/deals/feed');
    const etag = probe.headers.get('etag');
    const length = probe.headers.get('content-length');
    await probe.text();

    const head = await get(PORT, '/v1/deals/feed', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), length);
    assert.equal(await head.text(), '');

    const conditional = await get(PORT, '/v1/deals/feed', { method: 'HEAD', headers: { 'if-none-match': etag } });
    assert.equal(conditional.status, 304);
    await conditional.text();

    for (const pathname of ['/health', '/v1/deals/health']) {
      const res = await get(PORT, pathname, { method: 'HEAD' });
      assert.equal(res.status, 200, `HEAD ${pathname} should be 200`);
      assert.ok(Number(res.headers.get('content-length')) > 0);
      assert.equal(await res.text(), '');
    }
  });

  // /health described writeEnabled as an object while /v1/{scope}/health
  // described it as a boolean; a client could not read both the same way.
  it('reports writeEnabled with the same type on both health endpoints', async () => {
    const overall = await (await get(PORT, '/health')).json();
    const scoped = await (await get(PORT, '/v1/deals/health')).json();
    assert.equal(typeof overall.writeEnabled, 'boolean');
    assert.equal(typeof scoped.writeEnabled, 'boolean');
    assert.equal(typeof overall.scopes.deals.writeEnabled, 'boolean');
    assert.equal(overall.scopes.deals.writeEnabled, scoped.writeEnabled);
  });

  it('rejects the wrong method with 405 and an Allow header', async () => {
    const feed = await get(PORT, '/v1/deals/feed', { method: 'DELETE' });
    assert.equal(feed.status, 405);
    assert.equal(feed.headers.get('allow'), 'GET, HEAD, PUT');
    assert.deepEqual(await feed.json(), { error: 'method_not_allowed' });

    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await get(PORT, '/v1/deals/upsert', { method });
      assert.equal(res.status, 405, `${method} /upsert should be 405`);
      assert.equal(res.headers.get('allow'), 'POST');
      await res.text();
    }
  });

  it('logs every rejected credential instead of failing silently', async () => {
    const before = server.log.length;
    const res = await write(PORT, '/v1/deals/upsert', { listings: [] }, { token: 'wrong-token' });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    assert.deepEqual(await res.json(), { error: 'unauthorized' });

    const deadline = Date.now() + 3000;
    while (!/401 unauthorized/.test(server.log.slice(before)) && Date.now() < deadline) await delay(25);
    assert.match(server.log.slice(before), /401 unauthorized scope=deals/);
    assert.match(server.log.slice(before), /ip="127\.0\.0\.1"/);
    assert.ok(!server.log.includes('wrong-token'), 'the attempted token must never be logged');
  });
});

/* ================================================================== *
 * The write path: validation, ids, depth
 * ================================================================== */

describe('write path validation', () => {
  const PORT = 8301;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('write');
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { OFFICE_INGEST_TOKEN: TOKEN, DEALS_INGEST_TOKEN: TOKEN, JOBS_INGEST_TOKEN: TOKEN },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('upserts a new listing and has it on disk before answering', async () => {
    const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'ebay-2', title: 'Lot 2' }] });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.changedIds, ['ebay-2']);
    assert.deepEqual(await idsOnDisk(dirs.dataDir, 'deals'), ['ebay-1', 'ebay-2']);

    const audit = await auditLines(dirs.dataDir);
    assert.equal(audit.at(-1).operation, 'upsert');
    assert.deepEqual(audit.at(-1).changedIds, ['ebay-2']);
  });

  it('derives a deals id from a string or integer itemId', async () => {
    for (const [itemId, expected] of [['77', 'ebay-77'], [88, 'ebay-88']]) {
      const res = await write(PORT, '/v1/deals/upsert', { listings: [{ itemId, title: 'derived' }] });
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).changedIds, [expected]);
    }
  });

  // String(itemId) used to collapse every object onto `ebay-[object Object]`,
  // silently destroying every distinct record that landed in that bucket.
  it('refuses to String()-coerce a non-scalar itemId', async () => {
    const before = await idsOnDisk(dirs.dataDir, 'deals');
    for (const itemId of [{ id: 'AAA' }, [1, 2], true, 1.5]) {
      const res = await write(PORT, '/v1/deals/upsert', { listings: [{ itemId, title: 'listing' }] });
      assert.equal(res.status, 400, `itemId ${JSON.stringify(itemId)} should be rejected`);
      assert.deepEqual(await res.json(), { error: 'itemId_must_be_string_or_integer' });
    }
    const after = await idsOnDisk(dirs.dataDir, 'deals');
    assert.deepEqual(after, before, 'a rejected itemId must not persist anything');
    assert.ok(!after.some((id) => String(id).includes('[object Object]')));
  });

  it('canonicalises unicode ids so NFC and NFD are one record', async () => {
    const nfc = 'café-lot';
    const nfd = 'café-lot';
    assert.notEqual(nfc, nfd, 'the two forms must differ as raw strings');

    const first = await write(PORT, '/v1/deals/upsert', { listings: [{ id: nfc, title: 'A' }] });
    assert.equal(first.status, 200);
    await first.text();
    const second = await write(PORT, '/v1/deals/upsert', { listings: [{ id: nfd, title: 'B' }] });
    assert.equal(second.status, 200);
    await second.text();

    const listings = (await readFeedFile(dirs.dataDir, 'deals')).listings;
    const matches = listings.filter((l) => String(l.id).normalize('NFC') === nfc);
    assert.equal(matches.length, 1, `expected one cafe row, got ${JSON.stringify(matches.map((l) => l.id))}`);
    assert.equal(matches[0].title, 'B', 'the second write should have updated the same record');
  });

  it('rejects ids containing invisible or control characters', async () => {
    for (const id of ['a​b', 'x\ny', 'tab\there', 'bo' + '\ufeff' + 'm', 'soft­hyphen']) {
      const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id, title: 'sneaky' }] });
      assert.equal(res.status, 400, `id ${JSON.stringify(id)} should be rejected`);
      assert.deepEqual(await res.json(), { error: 'listing_id_invalid' });
    }
    const ids = await idsOnDisk(dirs.dataDir, 'deals');
    assert.ok(
      !ids.some((id) => /[\u0000-\u001f\u00ad\u200b-\u200f\ufeff]/.test(String(id))),
      `stored ids: ${JSON.stringify(ids)}`,
    );
  });

  it('rejects prototype-shaped keys instead of storing them in the feed', async () => {
    const cases = [
      JSON.parse('{"id":"pp1","__proto__":{"polluted":"yes"}}'),
      { id: 'pp2', constructor: { prototype: { polluted: 'yes' } } },
      { id: 'pp3', nested: { deeper: { prototype: {} } } },
    ];
    for (const listing of cases) {
      const res = await write(PORT, '/v1/deals/upsert', { listings: [listing] });
      assert.equal(res.status, 400, `${JSON.stringify(listing)} should be rejected`);
      assert.deepEqual(await res.json(), { error: 'listing_key_not_allowed' });
    }
    const raw = await readFile(path.join(dirs.dataDir, 'deals.json'), 'utf8');
    assert.ok(!raw.includes('__proto__'), 'the stored feed must not contain __proto__');
    assert.ok(!raw.includes('polluted'));
  });

  // JSON.parse accepts nesting that the recursive diff could not survive, so
  // an accepted write used to poison an id forever.
  it('rejects a listing nested deeper than the configured limit', async () => {
    const before = await idsOnDisk(dirs.dataDir, 'deals');
    const res = await write(PORT, '/v1/deals/upsert', `{"listings":[{"id":"poison-me","x":${deepJson(3000)}}]}`);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'listing_too_deeply_nested' });
    assert.deepEqual(await idsOnDisk(dirs.dataDir, 'deals'), before, 'nothing may persist');

    const mixed = `{"listings":[{"id":"innocent-1"},{"id":"poison-me","x":${deepJson(3000)}}]}`;
    const res2 = await write(PORT, '/v1/deals/upsert', mixed);
    assert.equal(res2.status, 400);
    await res2.text();
    assert.deepEqual(await idsOnDisk(dirs.dataDir, 'deals'), before);
  });

  it('rejects a malformed body with a specific code', async () => {
    const cases = [
      [{}, 'body_must_contain_listings_array'],
      [{ listings: 'nope' }, 'body_must_contain_listings_array'],
      [{ listings: [null] }, 'listing_must_be_object'],
      [{ listings: [[1, 2]] }, 'listing_must_be_object'],
      [{ listings: [{ title: 'no id' }] }, 'listing_id_required'],
      [{ listings: [{ id: '   ' }] }, 'listing_id_invalid'],
      ['{ not json', 'invalid_json'],
    ];
    for (const [body, expected] of cases) {
      const res = await write(PORT, '/v1/deals/upsert', body);
      assert.equal(res.status, 400, `${JSON.stringify(body)} -> ${res.status}`);
      assert.deepEqual(await res.json(), { error: expected });
    }
  });

  it('rejects an oversized body with 413 and stays alive', async () => {
    const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'huge', note: 'x'.repeat(2_000_000) }] });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'payload_too_large' });

    const health = await get(PORT, '/health');
    assert.equal(health.status, 200);
    await health.text();
  });

  // Answering 413 and then letting Node drain an unbounded body keeps the
  // socket alive and burns inbound bandwidth on the sender's behalf.
  it('tears the connection down after a bounded drain on 413', async () => {
    const socket = net.connect(PORT, '127.0.0.1');
    await once(socket, 'connect');
    socket.on('error', () => {});
    let response = '';
    socket.setEncoding('utf8');
    socket.on('data', (d) => { response += d; });
    socket.write(
      `POST /v1/deals/upsert HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${TOKEN}\r\n`
      + 'Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n',
    );

    const chunk = 'x'.repeat(64 * 1024);
    const frame = `${(64 * 1024).toString(16)}\r\n${chunk}\r\n`;
    let pushed = 0;
    const pump = setInterval(() => {
      if (socket.destroyed || socket.writableEnded || pushed > 32 * 1024 * 1024) {
        clearInterval(pump);
        return;
      }
      pushed += chunk.length;
      socket.write(frame);
    }, 5);

    // Not events.once(): it rejects on 'error', and a reset is the outcome
    // this test is waiting for.
    const closed = new Promise((resolve) => socket.once('close', resolve));
    try {
      await Promise.race([closed, delay(20_000)]);
    } finally {
      clearInterval(pump);
      socket.destroy();
    }

    assert.match(response, /^HTTP\/1\.1 413 /, `expected a 413, got: ${response.slice(0, 120)}`);
    assert.match(response, /payload_too_large/);
    assert.ok(
      pushed <= 16 * 1024 * 1024,
      `the server drained ${pushed} bytes after answering 413 instead of hanging up`,
    );
  });

  // The status code used to be chosen by substring-matching the error text,
  // and the error text embedded the client's own listing id.
  it('does not let a listing id choose the HTTP status code', async () => {
    const plain = await write(PORT, '/v1/office/feed', { listings: [{ id: 'aaa' }, { id: 'aaa' }] }, { method: 'PUT' });
    assert.equal(plain.status, 400);
    assert.deepEqual(await plain.json(), { error: 'duplicate_listing_id' });

    for (const id of ['x-too_many-x', 'x-required-x', 'x-invalid_-x']) {
      const res = await write(PORT, '/v1/office/feed', { listings: [{ id }, { id }] }, { method: 'PUT' });
      assert.equal(res.status, 400, `id ${id} should still be a 400`);
      const body = await res.json();
      assert.deepEqual(body, { error: 'duplicate_listing_id' });
      assert.ok(!JSON.stringify(body).includes(id), 'the error must not echo client input');
    }
  });

  it('replaces a whole feed with PUT and records the ids it stored', async () => {
    const res = await write(PORT, '/v1/jobs/feed', {
      schemaVersion: 3,
      searchName: 'restored',
      listings: [{ id: 'job-1', title: 'Welder' }, { id: 'job-2', title: 'Fitter' }],
    }, { method: 'PUT' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).count, 2);
    assert.deepEqual(await idsOnDisk(dirs.dataDir, 'jobs'), ['job-1', 'job-2']);

    const entry = (await auditLines(dirs.dataDir)).at(-1);
    assert.equal(entry.operation, 'replace');
    assert.deepEqual(entry.listingIds, ['job-1', 'job-2'], 'a replace must record what it stored');
  });

  it('preserves office price history across an upsert', async () => {
    const res = await write(PORT, '/v1/office/upsert', { listings: [{ id: 'office-1', askingRent: 900 }] });
    assert.equal(res.status, 200);
    await res.text();
    const row = (await readFeedFile(dirs.dataDir, 'office')).listings.find((l) => l.id === 'office-1');
    assert.ok(Array.isArray(row.priceHistory) && row.priceHistory.length >= 1);
    assert.equal(row.askingRent, 900);
  });
});

/* ================================================================== *
 * A pre-existing too-deep record must be repairable, not permanent
 * ================================================================== */

describe('a feed that already contains an over-deep record', () => {
  const PORT = 8302;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('deep-prior');
    // Planted directly on disk: this is what an accepted write left behind
    // before incoming listings were depth-checked.
    await writeFile(
      path.join(dirs.dataDir, 'deals.json'),
      `{"schemaVersion":3,"generatedAt":"2026-01-01T00:00:00.000Z","listings":[{"id":"poison-me","x":${deepJson(3000)}},{"id":"ebay-1"}]}\n`,
      'utf8',
    );
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { DEALS_INGEST_TOKEN: TOKEN },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('still accepts a batch that touches the over-deep id', async () => {
    const res = await write(PORT, '/v1/deals/upsert', {
      listings: [{ id: 'innocent-1' }, { id: 'poison-me', note: 'fix me' }, { id: 'innocent-2' }],
    });
    const text = await res.text();
    assert.equal(res.status, 200, `expected 200, got ${res.status} ${text}`);

    const ids = await idsOnDisk(dirs.dataDir, 'deals');
    assert.ok(ids.includes('innocent-1'), 'the rest of the batch must not be discarded');
    assert.ok(ids.includes('innocent-2'));
  });

  it('lets a full-feed PUT evict the record entirely', async () => {
    const res = await write(PORT, '/v1/deals/feed', { schemaVersion: 3, listings: [{ id: 'ebay-1' }] }, { method: 'PUT' });
    assert.equal(res.status, 200);
    await res.text();
    assert.deepEqual(await idsOnDisk(dirs.dataDir, 'deals'), ['ebay-1']);
  });
});

/* ================================================================== *
 * Configuration that cannot be parsed must not disable the limits
 * ================================================================== */

describe('unparseable numeric configuration', () => {
  const PORT = 8303;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('bad-config');
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: {
        DEALS_INGEST_TOKEN: TOKEN,
        // Exactly the typo the documented "(default 1 MiB)" comment invites.
        MAX_BODY_BYTES: '1MB',
        MAX_LISTINGS_PER_WRITE: 'unlimited',
      },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('warns loudly and falls back to the documented defaults', () => {
    assert.match(server.log, /ignoring invalid MAX_BODY_BYTES="1MB"; using 1048576/);
    assert.match(server.log, /ignoring invalid MAX_LISTINGS_PER_WRITE="unlimited"; using 500/);
    assert.match(server.log, /maxBodyBytes=1048576 maxListingsPerWrite=500/);
  });

  it('still enforces the body cap', async () => {
    const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'big', note: 'x'.repeat(2_000_000) }] });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'payload_too_large' });
  });

  it('still enforces the per-write listing cap', async () => {
    const listings = Array.from({ length: 600 }, (_, i) => ({ id: `bulk-${i}` }));
    const res = await write(PORT, '/v1/deals/upsert', { listings });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'too_many_listings' });
    assert.deepEqual(await idsOnDisk(dirs.dataDir, 'deals'), ['ebay-1'], 'nothing may be written');
  });
});

/* ================================================================== *
 * A feed grown by upserts must remain restorable at full size
 * ================================================================== */

describe('full-feed restore bound', () => {
  const PORT = 8304;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('restore', { seeds: { ...SEED_FEEDS, deals: { ...SEED_FEEDS.deals, listings: [] } } });
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { DEALS_INGEST_TOKEN: TOKEN, MAX_LISTINGS_PER_WRITE: '5', MAX_FULL_FEED_LISTINGS: '20' },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('restores a feed larger than the per-write cap', async () => {
    for (const batch of [0, 1]) {
      const listings = Array.from({ length: 5 }, (_, i) => ({ id: `row-${batch * 5 + i}` }));
      const res = await write(PORT, '/v1/deals/upsert', { listings });
      assert.equal(res.status, 200);
      await res.text();
    }
    const grown = await readFeedFile(dirs.dataDir, 'deals');
    assert.equal(grown.listings.length, 10, 'upserts grew the feed past the per-write cap');

    // The exact backup-restore the deployment docs describe.
    const res = await write(PORT, '/v1/deals/feed', grown, { method: 'PUT' });
    assert.equal(res.status, 200, `restoring a ${grown.listings.length}-row feed should succeed`);
    assert.equal((await res.json()).count, 10);
    assert.equal((await readFeedFile(dirs.dataDir, 'deals')).listings.length, 10);
  });

  it('refuses to grow the stored feed past what a restore could put back', async () => {
    let last;
    for (let batch = 0; batch < 4; batch += 1) {
      const listings = Array.from({ length: 5 }, (_, i) => ({ id: `grow-${batch * 5 + i}` }));
      last = await write(PORT, '/v1/deals/upsert', { listings });
      if (last.status !== 200) break;
      await last.text();
    }
    assert.equal(last.status, 413);
    assert.deepEqual(await last.json(), { error: 'feed_capacity_exceeded' });

    const stored = await readFeedFile(dirs.dataDir, 'deals');
    assert.ok(stored.listings.length <= 20, `stored ${stored.listings.length} listings`);
    const restore = await write(PORT, '/v1/deals/feed', stored, { method: 'PUT' });
    assert.equal(restore.status, 200, 'whatever is stored must still be restorable');
    await restore.text();
  });

  it('still refuses a PUT beyond the full-feed bound', async () => {
    const listings = Array.from({ length: 21 }, (_, i) => ({ id: `over-${i}` }));
    const res = await write(PORT, '/v1/deals/feed', { schemaVersion: 3, listings }, { method: 'PUT' });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'too_many_listings' });
  });
});

/* ================================================================== *
 * Corrupt data present at startup
 * ================================================================== */

describe('a corrupt feed already on the volume at startup', () => {
  const PORT = 8305;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('corrupt-boot');
    await writeFile(path.join(dirs.dataDir, 'office.json'), '', 'utf8');
    await writeFile(path.join(dirs.dataDir, 'deals.json'), '{"schemaVersion":3,"listings":[{"id":"trunc', 'utf8');
    await writeFile(path.join(dirs.dataDir, 'jobs.json'), '{"schemaVersion":3,"listings":[null,null]}', 'utf8');
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { DEALS_INGEST_TOKEN: TOKEN },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('says so loudly instead of adopting the file', () => {
    for (const scope of ['office', 'deals', 'jobs']) {
      assert.match(server.log, new RegExp(`${scope} feed is unusable`), `no warning for ${scope}`);
    }
  });

  it('quarantines the bad file rather than deleting it', async () => {
    const entries = await readdir(dirs.dataDir);
    for (const scope of ['office', 'deals', 'jobs']) {
      assert.ok(
        entries.some((n) => n.startsWith(`${scope}.json.corrupt-`)),
        `${scope} should have been quarantined; saw ${JSON.stringify(entries)}`,
      );
    }
  });

  it('re-seeds every scope so the dashboards get real data', async () => {
    for (const scope of ['office', 'deals', 'jobs']) {
      const res = await get(PORT, `/v1/${scope}/feed`);
      assert.equal(res.status, 200, `${scope} feed should be served`);
      const body = await res.json();
      assert.ok(Array.isArray(body.listings), `${scope} feed should parse`);
    }
    const health = await (await get(PORT, '/health')).json();
    assert.equal(health.status, 'ok');
  });

  it('accepts writes again', async () => {
    const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'ebay-9' }] });
    assert.equal(res.status, 200);
    await res.text();
    assert.ok((await idsOnDisk(dirs.dataDir, 'deals')).includes('ebay-9'));
  });
});

/* ================================================================== *
 * Corruption that appears while the service is running
 * ================================================================== */

describe('a feed corrupted underneath a running service', () => {
  const PORT = 8306;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('corrupt-live');
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { DEALS_INGEST_TOKEN: TOKEN },
    });
    await writeFile(path.join(dirs.dataDir, 'deals.json'), 'not json', 'utf8');
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('refuses to serve unparsed bytes as application/json', async () => {
    const res = await get(PORT, '/v1/deals/feed');
    const text = await res.text();
    assert.equal(res.status, 503, `expected 503, got ${res.status} with body ${JSON.stringify(text)}`);
    assert.equal(text, JSON.stringify({ error: 'feed_unavailable' }));
    assert.ok(!text.includes('not json'));
  });

  it('reports the scope as degraded on both health endpoints', async () => {
    const overall = await get(PORT, '/health');
    assert.equal(overall.status, 503);
    const body = await overall.json();
    assert.equal(body.status, 'degraded');
    assert.equal(body.scopes.deals.feedOk, false);
    assert.equal(body.scopes.office.feedOk, true, 'a healthy scope must stay healthy');

    const scoped = await get(PORT, '/v1/deals/health');
    assert.equal(scoped.status, 503);
    assert.equal((await scoped.json()).feedOk, false);
  });

  it('fails an upsert with an opaque error that leaks no path', async () => {
    const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'ebay-5' }] });
    const text = await res.text();
    assert.equal(res.status, 503);
    assert.equal(text, JSON.stringify({ error: 'feed_unavailable' }));
    assert.ok(!text.includes(TMP_ROOT));
    assert.ok(!text.includes('JSON'), `parser text leaked: ${text}`);
  });

  it('is repairable with a full-feed PUT', async () => {
    const res = await write(PORT, '/v1/deals/feed', { schemaVersion: 3, listings: [{ id: 'ebay-1' }] }, { method: 'PUT' });
    assert.equal(res.status, 200);
    await res.text();

    const feed = await get(PORT, '/v1/deals/feed');
    assert.equal(feed.status, 200);
    assert.deepEqual((await feed.json()).listings.map((l) => l.id), ['ebay-1']);

    const health = await get(PORT, '/health');
    assert.equal(health.status, 200);
    await health.text();
  });
});

/* ================================================================== *
 * Failed writes: no orphan temp files, no path leak, ids recorded
 * ================================================================== */

describe('a feed file that cannot be written', () => {
  const PORT = 8307;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('write-fail');
    // A non-empty directory standing where jobs.json belongs: rename() onto
    // it always fails, even as root.
    await mkdir(path.join(dirs.dataDir, 'jobs.json'), { recursive: true });
    await writeFile(path.join(dirs.dataDir, 'jobs.json', 'blocker'), 'x', 'utf8');
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { JOBS_INGEST_TOKEN: TOKEN, DEALS_INGEST_TOKEN: TOKEN },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
    await rm(path.join(dirs.dataDir, 'jobs.json'), { recursive: true, force: true });
  });

  it('leaves no temp file behind when the write fails', async () => {
    assert.deepEqual(await tempFiles(dirs.dataDir), [], 'startup seeding must clean up after itself');

    const res = await write(PORT, '/v1/jobs/feed', { schemaVersion: 3, listings: [{ id: 'job-1' }] }, { method: 'PUT' });
    assert.equal(res.status, 500);
    await res.text();
    assert.deepEqual(await tempFiles(dirs.dataDir), [], 'a failed write must not orphan a temp file');
  });

  it('answers with an opaque code instead of the internal path', async () => {
    const res = await write(PORT, '/v1/jobs/feed', { schemaVersion: 3, listings: [{ id: 'job-1' }] }, { method: 'PUT' });
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.equal(text, JSON.stringify({ error: 'write_failed' }));
    assert.ok(!text.includes(TMP_ROOT), `leaked the data dir: ${text}`);
    assert.ok(!/EISDIR|ENOTEMPTY|ENOENT/.test(text), `leaked an errno: ${text}`);
  });

  it('records the ids that were lost, not just a count', async () => {
    const lines = await auditLines(dirs.dataDir);
    const failure = lines.filter((l) => l.operation === 'replace_failed').at(-1);
    assert.ok(failure, `expected a replace_failed audit entry, saw ${JSON.stringify(lines.map((l) => l.operation))}`);
    assert.deepEqual(failure.listingIds, ['job-1']);
    assert.equal(failure.scope, 'jobs');
    assert.ok(typeof failure.error === 'string' && failure.error.length > 0);
  });

  it('reports the broken scope as degraded and the healthy ones as fine', async () => {
    const body = await (await get(PORT, '/health')).json();
    assert.equal(body.scopes.jobs.feedOk, false);
    assert.equal(body.scopes.deals.feedOk, true);

    const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'ebay-3' }] });
    assert.equal(res.status, 200, 'an unrelated scope must keep working');
    await res.text();
  });
});

/* ================================================================== *
 * An audit log that cannot be appended must not commit the change
 * ================================================================== */

describe('an unwritable audit log', () => {
  const PORT = 8308;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('audit-fail');
    await mkdir(path.join(dirs.dataDir, 'audit.jsonl'), { recursive: true });
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { DEALS_INGEST_TOKEN: TOKEN },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
    await rm(path.join(dirs.dataDir, 'audit.jsonl'), { recursive: true, force: true });
  });

  it('does not commit a change it cannot record', async () => {
    const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'ghost-write', title: 'committed?' }] });
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.equal(text, JSON.stringify({ error: 'audit_write_failed' }));
    assert.ok(!text.includes(TMP_ROOT), `leaked the data dir: ${text}`);

    assert.ok(!(await idsOnDisk(dirs.dataDir, 'deals')).includes('ghost-write'), 'the change must not be on disk');
    const served = await (await get(PORT, '/v1/deals/feed')).json();
    assert.ok(!served.listings.some((l) => l.id === 'ghost-write'), 'the change must not be served to the public');
  });
});

/* ================================================================== *
 * The data volume itself is unusable
 * ================================================================== */

describe('an unusable data volume', () => {
  const PORT = 8309;
  let server;

  before(async () => {
    const dirs = await prepareDirs('no-volume', { makeDataDir: false });
    // A regular file standing where the data directory should be: mkdir,
    // seeding and every probe fail.
    await writeFile(path.join(dirs.root, 'blocker'), 'not a directory\n', 'utf8');
    server = await startServer({
      port: PORT,
      dataDir: path.join(dirs.root, 'blocker', 'data'),
      seedDir: dirs.seedDir,
      env: { DEALS_INGEST_TOKEN: TOKEN },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('starts anyway and warns instead of dying with an unhandled rejection', () => {
    assert.match(server.log, /not writable|not usable/);
  });

  it('reports itself degraded rather than ok', async () => {
    const res = await get(PORT, '/health');
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.status, 'degraded');
    assert.equal(body.dataWritable, false);
    assert.equal(body.writeEnabled, false, 'writes cannot succeed, so writeEnabled must be false');
    assert.equal(body.scopes.deals.writeEnabled, false);
    assert.equal(body.scopes.deals.tokenConfigured, true);
  });

  it('fails reads and writes with opaque errors', async () => {
    const read = await get(PORT, '/v1/deals/feed');
    const readText = await read.text();
    assert.equal(read.status, 503);
    assert.equal(readText, JSON.stringify({ error: 'feed_unavailable' }));
    assert.ok(!readText.includes(TMP_ROOT));

    const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'ebay-7' }] });
    const text = await res.text();
    assert.ok(res.status >= 500, `expected a 5xx, got ${res.status}`);
    assert.ok(!text.includes(TMP_ROOT), `leaked the data dir: ${text}`);
    assert.ok(!/ENOTDIR|ENOENT|EACCES/.test(text), `leaked an errno: ${text}`);
  });
});

/* ================================================================== *
 * Durability: the bytes are fsync'd before the 200
 * ================================================================== */

describe('durability of an acknowledged write', () => {
  const PORT = 8310;
  let server;
  let dirs;
  let tracePath;

  before(async () => {
    if (!CAN_TRACE) return;
    dirs = await prepareDirs('durability');
    tracePath = path.join(dirs.root, 'fsync-trace.txt');
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { DEALS_INGEST_TOKEN: TOKEN },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('fsyncs the feed and the audit line before answering 200', { skip: CAN_TRACE ? false : 'strace cannot attach here (missing binary or ptrace not permitted)' }, async () => {
    let status = 0;
    const syncs = await traceSyncs(server.child.pid, tracePath, async () => {
      const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: 'ebay-durable' }] });
      status = res.status;
      await res.text();
    });
    assert.equal(status, 200);
    assert.ok(
      syncs.length >= 2,
      `expected the feed and the audit append to be fsync'd; saw ${syncs.length} sync calls:\n${syncs.join('\n')}`,
    );
    assert.deepEqual(await tempFiles(dirs.dataDir), [], 'the temp file must be gone once the write is acknowledged');
  });
});

/* ================================================================== *
 * Shutdown must not truncate an in-flight write
 * ================================================================== */

describe('shutdown while a write is in flight', () => {
  const PORT = 8311;
  const ROWS = 80_000;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('shutdown', { seeds: { ...SEED_FEEDS, deals: { ...SEED_FEEDS.deals, listings: [] } } });
    // A large stored feed makes one upsert take a few hundred milliseconds of
    // read-modify-write, which is the window this test needs.
    const big = {
      schemaVersion: 3,
      generatedAt: '2026-01-01T00:00:00.000Z',
      listings: Array.from({ length: ROWS }, (_, i) => ({
        id: `bulk-${i}`,
        title: `Listing number ${i} with enough text to make the stored feed large`,
      })),
    };
    await writeFile(path.join(dirs.dataDir, 'deals.json'), `${JSON.stringify(big, null, 2)}\n`, 'utf8');
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: {
        DEALS_INGEST_TOKEN: TOKEN,
        MAX_FULL_FEED_LISTINGS: '200000',
      },
    });
  });

  after(async () => {
    if (server) await server.stop();
  });

  it('drains an in-flight write whose client has hung up', async () => {
    // A raw socket, so the hang-up is a real reset rather than a polite
    // close the server can keep waiting on.
    const socket = net.connect(PORT, '127.0.0.1');
    await once(socket, 'connect');
    socket.on('error', () => {});
    const body = JSON.stringify({ listings: [{ id: 'late-arrival', title: 'accepted' }] });
    socket.write(
      `POST /v1/deals/upsert HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${TOKEN}\r\n`
      + `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );

    // The body is tiny, so by now the server has it and is deep in the
    // read-modify-write. Hang up: server.close() now sees no connections.
    await delay(60);
    socket.destroy();
    const { code } = await server.stop();
    server = null;

    assert.equal(code, 0, 'the service should still exit cleanly');
    assert.deepEqual(await tempFiles(dirs.dataDir), [], 'shutdown must not orphan a temp file');

    const feed = await readFeedFile(dirs.dataDir, 'deals');
    assert.equal(feed.listings.length, ROWS + 1, 'the feed must not be truncated');
    assert.ok(
      feed.listings.some((l) => l.id === 'late-arrival'),
      'the in-flight write must be finished, not abandoned mid-flight',
    );
  });
});

/* ================================================================== *
 * A second writer on the same volume must not silently win
 * ================================================================== */

describe('a second writer on the same volume', () => {
  const PORT = 8312;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('concurrent', { seeds: { ...SEED_FEEDS, deals: { ...SEED_FEEDS.deals, listings: [] } } });
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: {
        DEALS_INGEST_TOKEN: TOKEN,
        MAX_BODY_BYTES: '60000000',
        MAX_LISTINGS_PER_WRITE: '30000',
        MAX_FULL_FEED_LISTINGS: '60000',
      },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('refuses to overwrite a feed that changed under it', async () => {
    const listings = Array.from({ length: 30_000 }, (_, i) => ({
      id: `slow-${i}`,
      title: `Listing number ${i} with enough text to make the write take a while`,
    }));
    const slow = write(PORT, '/v1/deals/upsert', { listings });

    // Another writer on the same volume replaces the feed while the first
    // write is between its read and its rename.
    await waitForTempFile(dirs.dataDir);
    const sentinel = {
      schemaVersion: 3,
      generatedAt: '2026-02-02T00:00:00.000Z',
      listings: [{ id: 'written-by-someone-else' }],
    };
    await writeFile(path.join(dirs.dataDir, 'deals.json'), `${JSON.stringify(sentinel, null, 2)}\n`, 'utf8');

    const res = await slow;
    const text = await res.text();
    assert.equal(res.status, 409, `expected 409, got ${res.status} ${text.slice(0, 200)}`);
    assert.equal(text, JSON.stringify({ error: 'feed_changed_concurrently' }));
    assert.deepEqual(
      await idsOnDisk(dirs.dataDir, 'deals'),
      ['written-by-someone-else'],
      "the other writer's data must survive",
    );
    assert.deepEqual(await tempFiles(dirs.dataDir), [], 'the refused write must clean up its temp file');
  });

  // PUT /feed used to skip the guard entirely: replaceFeed called commitFeed
  // with no signature, so `assertUnchanged` returned immediately and a
  // restore silently renamed over anything a second process had written in
  // the meantime. The asymmetry was invisible to this suite in either
  // direction until this test.
  it('a full-feed replace also refuses to overwrite a feed that changed under it', async () => {
    const listings = Array.from({ length: 30_000 }, (_, i) => ({
      id: `restore-${i}`,
      title: `Restored listing number ${i} with enough text to make the write take a while`,
    }));
    const slow = write(PORT, '/v1/deals/feed', { schemaVersion: 3, listings }, { method: 'PUT' });

    await waitForTempFile(dirs.dataDir);
    const sentinel = {
      schemaVersion: 3,
      generatedAt: '2026-02-03T00:00:00.000Z',
      listings: [{ id: 'upserted-during-the-restore' }],
    };
    await writeFile(path.join(dirs.dataDir, 'deals.json'), `${JSON.stringify(sentinel, null, 2)}\n`, 'utf8');

    const res = await slow;
    const text = await res.text();
    assert.equal(res.status, 409, `expected 409, got ${res.status} ${text.slice(0, 200)}`);
    assert.equal(text, JSON.stringify({ error: 'feed_changed_concurrently' }));
    assert.deepEqual(
      await idsOnDisk(dirs.dataDir, 'deals'),
      ['upserted-during-the-restore'],
      "the interleaved writer's data must survive the refused restore",
    );
    assert.deepEqual(await tempFiles(dirs.dataDir), [], 'the refused restore must clean up its temp file');
  });
});

/* ================================================================== *
 * The audit log is bounded
 * ================================================================== */

describe('audit log rotation', () => {
  const PORT = 8313;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('audit-rotate');
    server = await startServer({
      port: PORT,
      dataDir: dirs.dataDir,
      seedDir: dirs.seedDir,
      env: { DEALS_INGEST_TOKEN: TOKEN, AUDIT_MAX_BYTES: '600', AUDIT_KEEP_FILES: '2' },
    });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('rotates instead of growing without bound', async () => {
    for (let i = 0; i < 12; i += 1) {
      const res = await write(PORT, '/v1/deals/upsert', { listings: [{ id: `rot-${i}`, note: 'x'.repeat(100) }] });
      assert.equal(res.status, 200);
      await res.text();
    }

    const live = await stat(path.join(dirs.dataDir, 'audit.jsonl'));
    assert.ok(live.size <= 600, `live audit log should stay under the cap, is ${live.size} bytes`);

    const entries = await readdir(dirs.dataDir);
    assert.ok(entries.includes('audit.jsonl.1'), `expected a rotated generation, saw ${JSON.stringify(entries)}`);
    assert.ok(!entries.includes('audit.jsonl.3'), 'only AUDIT_KEEP_FILES generations may be kept');

    // Rotation must not lose the most recent history.
    const recent = [...(await auditLines(dirs.dataDir)), ...(await auditLines(dirs.dataDir, '.1'))];
    assert.ok(recent.some((l) => l.changedIds?.includes('rot-11')));
  });
});

/* ================================================================== *
 * The snapshots the container actually ships as seeds
 * ================================================================== */

describe('the checked-in feed snapshots', () => {
  const PORT = 8314;
  let server;
  let dirs;

  before(async () => {
    dirs = await prepareDirs('real-seeds', { seeds: {} });
    const sources = {
      office: 'public/office-scout/data/listings.json',
      deals: 'public/deals/data/listings.json',
      jobs: 'public/jobs/data/listings.json',
    };
    for (const [scope, relative] of Object.entries(sources)) {
      await writeFile(
        path.join(dirs.seedDir, `${scope}.json`),
        await readFile(path.join(REPO_ROOT, relative), 'utf8'),
        'utf8',
      );
    }
    server = await startServer({ port: PORT, dataDir: dirs.dataDir, seedDir: dirs.seedDir });
  });

  after(async () => {
    if (server) assert.equal((await server.stop()).code, 0);
  });

  it('are valid feeds the service can seed from', async () => {
    assert.doesNotMatch(server.log, /built-in default envelope/, 'every snapshot should have been usable');
    for (const scope of ['office', 'deals', 'jobs']) {
      const res = await get(PORT, `/v1/${scope}/feed`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.listings));
      assert.ok(body.generatedAt, `${scope} feed should carry generatedAt`);
    }
  });

  it('keeps the snapshot timestamp instead of pretending the data is fresh', async () => {
    const raw = JSON.parse(await readFile(path.join(REPO_ROOT, 'public/deals/data/listings.json'), 'utf8'));
    const served = await (await get(PORT, '/v1/deals/feed')).json();
    assert.equal(served.generatedAt, raw.generatedAt);
  });
});
