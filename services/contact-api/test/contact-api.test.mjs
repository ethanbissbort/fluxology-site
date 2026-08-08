/**
 * End-to-end tests for the contact API.
 *
 * Every test drives a real server process over real HTTP (node's global
 * fetch) — no mocks, no in-process shortcuts. The server is spawned exactly
 * the way the container starts it (`node server.mjs`) so startup logging and
 * SIGTERM handling are covered too.
 *
 * Run with:  npm test
 * Temp files go to $CONTACT_API_TEST_TMP (default: a mkdtemp under os.tmpdir).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;

let TMP_ROOT;

before(async () => {
  if (process.env.CONTACT_API_TEST_TMP) {
    TMP_ROOT = path.resolve(process.env.CONTACT_API_TEST_TMP);
    await mkdir(TMP_ROOT, { recursive: true });
    TMP_ROOT = await mkdtemp(path.join(TMP_ROOT, 'run-'));
  } else {
    TMP_ROOT = await mkdtemp(path.join(os.tmpdir(), 'contact-api-test-'));
  }
});

after(async () => {
  if (TMP_ROOT && !process.env.CONTACT_API_KEEP_TMP) await rm(TMP_ROOT, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

/** Spawn the service on PORT and wait until it reports it is listening. */
async function startServer(env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(PORT),
      // Generous by default so unrelated tests never trip the limiter.
      RATE_LIMIT_MAX: '1000',
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
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    /** Graceful SIGTERM stop; returns the exit code. */
    async stop() {
      if (child.exitCode !== null || child.signalCode) return { code: child.exitCode, signal: child.signalCode };
      child.kill('SIGTERM');
      const hard = setTimeout(() => child.kill('SIGKILL'), 6000);
      const [code, signal] = await exited;
      clearTimeout(hard);
      return { code, signal };
    },
  };
}

const VALID = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  serviceInterest: 'fabrication',
  message: 'We would like a quote for a stainless steel fabrication run.',
  companyName: 'Analytical Engines Ltd',
  phone: '+1 555 0100',
};

function postJson(body, headers = {}) {
  return fetch(`${BASE}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
}

function postForm(fields, headers = {}) {
  const body = new URLSearchParams(fields).toString();
  return fetch(`${BASE}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
    redirect: 'manual',
  });
}

/** POST `chunks` x 64 KiB with no Content-Length (chunked transfer-encoding). */
async function postChunked(chunks) {
  const chunk = new TextEncoder().encode('y'.repeat(64 * 1024));
  let pushed = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pushed >= chunks) {
        controller.close();
        return;
      }
      pushed += 1;
      controller.enqueue(chunk);
    },
  });
  try {
    const res = await fetch(`${BASE}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
      redirect: 'manual',
    });
    res.pushed = pushed;
    return res;
  } catch (err) {
    err.pushed = pushed;
    throw err;
  }
}

/** Resident memory of a pid in MiB, or null where /proc is unavailable. */
function residentMiB(pid) {
  try {
    const pages = Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]);
    return Math.round((pages * 4096) / 1048576);
  } catch {
    return null;
  }
}

async function readLog(logPath) {
  try {
    const text = await readFile(logPath, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/* ================================================================== *
 * Main behaviour — email disabled (the owner's default deployment)
 * ================================================================== */

describe('contact-api (log-only mode)', () => {
  let server;
  let logPath;

  before(async () => {
    logPath = path.join(TMP_ROOT, 'main', 'inquiries.jsonl');
    server = await startServer({ INQUIRY_LOG_PATH: logPath, TRUST_PROXY: 'true' });
  });

  after(async () => {
    if (server) {
      const { code } = await server.stop();
      assert.equal(code, 0, 'server should exit cleanly on SIGTERM');
    }
  });

  it('logs exactly one informational line about email being disabled', () => {
    const lines = server.stdout.split('\n').filter((l) => /Email delivery is disabled/.test(l));
    assert.equal(lines.length, 1, `expected one email-disabled line, got:\n${server.stdout}`);
    assert.match(lines[0], /SMTP_HOST is not set/);
    assert.ok(lines[0].includes(logPath), 'the line should name the inquiry log path');
    assert.doesNotMatch(server.stdout, /error|Error|ERROR/, 'startup must not look like a failure');
  });

  it('GET /api/health returns 200 with status and email state', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.emailEnabled, false);
  });

  it('non-POST on /api/contact returns 405 with an Allow header', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await fetch(`${BASE}/api/contact`, { method });
      assert.equal(res.status, 405, `${method} should be rejected`);
      assert.equal(res.headers.get('allow'), 'POST');
      const body = await res.json();
      assert.equal(body.ok, false);
    }
  });

  it('sends no CORS headers', async () => {
    const res = await fetch(`${BASE}/api/health`);
    await res.text();
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  });

  it('unknown paths return 404', async () => {
    const res = await fetch(`${BASE}/api/nope`);
    assert.equal(res.status, 404);
  });

  it('accepts a valid JSON submission and persists it before responding', async () => {
    const res = await postJson(VALID, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const rows = await readLog(logPath);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.fullName, VALID.fullName);
    assert.equal(row.email, VALID.email);
    assert.equal(row.serviceInterest, 'fabrication');
    assert.equal(row.message, VALID.message);
    assert.equal(row.companyName, VALID.companyName);
    assert.equal(row.phone, VALID.phone);
    assert.equal(row.ip, '203.0.113.7', 'X-Forwarded-For should be honoured when TRUST_PROXY is on');
    assert.equal(typeof row.userAgent, 'string');
    assert.ok(!Number.isNaN(Date.parse(row.receivedAt)), 'receivedAt must be an ISO timestamp');
    assert.equal(new Date(row.receivedAt).toISOString(), row.receivedAt);
  });

  it('stores the log file with mode 0600', async () => {
    const info = await stat(logPath);
    assert.equal(info.mode & 0o777, 0o600);
  });

  it('rejects each invalid field with 400 and a fields entry', async () => {
    const cases = [
      ['fullName', { ...VALID, fullName: undefined }],
      ['fullName', { ...VALID, fullName: 'A' }],
      ['email', { ...VALID, email: 'not-an-email' }],
      ['email', { ...VALID, email: 'nope@localhost' }],
      ['serviceInterest', { ...VALID, serviceInterest: undefined }],
      ['serviceInterest', { ...VALID, serviceInterest: 'rocket-surgery' }],
      ['message', { ...VALID, message: 'too short' }],
    ];

    const before = (await readLog(logPath)).length;
    for (const [field, payload] of cases) {
      const res = await postJson(payload);
      assert.equal(res.status, 400, `${field}: ${JSON.stringify(payload[field])}`);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(typeof body.error, 'string');
      assert.ok(body.fields && typeof body.fields[field] === 'string',
        `expected fields.${field} in ${JSON.stringify(body)}`);
      // Never echo the submitted value back.
      const submitted = payload[field];
      if (typeof submitted === 'string' && submitted.length > 3) {
        assert.ok(!JSON.stringify(body).includes(submitted), 'error must not echo user input');
      }
    }
    assert.equal((await readLog(logPath)).length, before, 'invalid submissions must not be stored');
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await postJson('{ this is not json');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  it('rejects an unsupported content type with 400', async () => {
    const res = await fetch(`${BASE}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'fullName=x',
    });
    assert.equal(res.status, 400);
  });

  it('answers 200 and discards silently when the honeypot is filled', async () => {
    const before = await readLog(logPath);
    const res = await postJson({ ...VALID, website: 'http://spam.example' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const after = await readLog(logPath);
    assert.equal(after.length, before.length, 'honeypot submissions must not be stored');
  });

  it('redirects a valid urlencoded (no-JS) submission with 303', async () => {
    const before = (await readLog(logPath)).length;
    const res = await postForm({ ...VALID, website: '' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/contact-received/');
    await res.text();
    const rows = await readLog(logPath);
    assert.equal(rows.length, before + 1);
    assert.equal(rows.at(-1).email, VALID.email);
  });

  it('redirects an invalid urlencoded submission to ?error=1', async () => {
    const before = (await readLog(logPath)).length;
    const res = await postForm({ ...VALID, email: 'bogus' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/contact-received/?error=1');
    await res.text();
    assert.equal((await readLog(logPath)).length, before);
  });

  it('redirects a honeypot urlencoded submission to success and stores nothing', async () => {
    const before = (await readLog(logPath)).length;
    const res = await postForm({ ...VALID, website: 'gotcha' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/contact-received/');
    await res.text();
    assert.equal((await readLog(logPath)).length, before);
  });

  it('rejects an oversized body with 413 (declared Content-Length)', async () => {
    const before = (await readLog(logPath)).length;
    const res = await postJson({ ...VALID, message: 'x'.repeat(200_000) });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal((await readLog(logPath)).length, before);
  });

  it('rejects an oversized chunked body with 413 while streaming', async () => {
    // No Content-Length, so the cap must be enforced chunk by chunk. 128 KiB is
    // 4x the 32 KiB cap but inside the drain allowance, so the client reliably
    // gets to read the response on a healthy connection.
    const res = await postChunked(2);
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  it('cuts off an enormous chunked upload instead of buffering it', async () => {
    const rssBefore = residentMiB(server.child.pid);
    let outcome;
    try {
      const res = await postChunked(256); // 16 MiB
      outcome = { status: res.status, pushed: res.pushed };
      await res.text();
    } catch (err) {
      // Expected: the server tears the connection down partway through.
      outcome = { status: 'cut-off', code: err.cause?.code ?? err.message, pushed: err.pushed };
    }
    assert.ok(outcome.status === 413 || outcome.status === 'cut-off', JSON.stringify(outcome));

    const rssAfter = residentMiB(server.child.pid);
    if (rssBefore !== null && rssAfter !== null) {
      assert.ok(
        rssAfter - rssBefore < 32,
        `server RSS grew ${rssAfter - rssBefore} MiB during a 16 MiB upload — body was buffered`,
      );
    }

    const health = await fetch(`${BASE}/api/health`);
    assert.equal(health.status, 200, 'server must survive an oversized upload');
    await health.text();
  });

  it('still accepts a normal submission after the oversized ones', async () => {
    const res = await postJson({ ...VALID, message: 'Following up after the big upload test.' });
    assert.equal(res.status, 200);
    await res.text();
  });

  it('strips CR/LF injection attempts from stored and header-bound fields', async () => {
    const res = await postJson({
      ...VALID,
      fullName: 'Eve\r\nBcc: victim@example.com',
      companyName: 'Acme\nX-Injected: yes',
      message: 'Line one\r\nLine two — legitimate newlines are kept.\r\n\r\nRegards.',
    });
    assert.equal(res.status, 200);
    await res.text();

    const raw = await readFile(logPath, 'utf8');
    const rows = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const row = rows.at(-1);

    assert.ok(!/[\r\n]/.test(row.fullName), 'fullName must contain no CR/LF');
    assert.ok(!/[\r\n]/.test(row.companyName), 'companyName must contain no CR/LF');
    assert.ok(!/[\r\n]/.test(row.email), 'email must contain no CR/LF');
    assert.equal(row.fullName, 'Eve Bcc: victim@example.com');
    assert.equal(row.companyName, 'Acme X-Injected: yes');
    // Legitimate message newlines survive, normalised to \n, and stay JSON-escaped
    // so one inquiry is always exactly one line of JSONL.
    assert.ok(row.message.includes('\n'));
    assert.ok(!row.message.includes('\r'));
    assert.equal(raw.split('\n').filter(Boolean).length, rows.length);
  });

  it('rejects an email address containing CRLF', async () => {
    const res = await postJson({ ...VALID, email: 'ada@example.com\r\nBcc: victim@example.com' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.fields.email, 'string');
  });

  it('caps over-long fields with a 400 rather than truncating silently', async () => {
    const res = await postJson({ ...VALID, message: 'x'.repeat(5001) });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.fields.message, /5000/);
  });

  it('accepts every allowed serviceInterest slug', async () => {
    for (const slug of ['fabrication', '3d-lab', 'greenhouse', 'orchard', 'multiple', 'general']) {
      const res = await postJson({ ...VALID, serviceInterest: slug });
      assert.equal(res.status, 200, `slug ${slug} should be accepted`);
      await res.text();
    }
    const rows = await readLog(logPath);
    assert.equal(rows.at(-1).serviceInterest, 'general');
  });

  it('treats optional fields as optional', async () => {
    const res = await postJson({
      fullName: VALID.fullName,
      email: VALID.email,
      serviceInterest: 'general',
      message: 'No company, no phone, just a question about lead times.',
    });
    assert.equal(res.status, 200);
    await res.text();
    const row = (await readLog(logPath)).at(-1);
    assert.equal(row.companyName, '');
    assert.equal(row.phone, '');
  });
});

/* ================================================================== *
 * Rate limiting
 * ================================================================== */

describe('rate limiting', () => {
  let server;
  let logPath;

  before(async () => {
    logPath = path.join(TMP_ROOT, 'ratelimit', 'inquiries.jsonl');
    server = await startServer({
      INQUIRY_LOG_PATH: logPath,
      RATE_LIMIT_MAX: '3',
      RATE_LIMIT_WINDOW_MS: '60000',
      TRUST_PROXY: 'true',
    });
  });

  after(async () => {
    if (server) await server.stop();
  });

  it('returns 429 once RATE_LIMIT_MAX is exceeded for an IP', async () => {
    const ip = '198.51.100.9';
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await postJson(VALID, { 'x-forwarded-for': ip });
      statuses.push(res.status);
      if (res.status === 429) {
        assert.ok(Number(res.headers.get('retry-after')) > 0, 'Retry-After should be set');
        const body = await res.json();
        assert.equal(body.ok, false);
      } else {
        await res.text();
      }
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });

  it('limits per IP, not globally', async () => {
    const res = await postJson(VALID, { 'x-forwarded-for': '198.51.100.10' });
    assert.equal(res.status, 200);
    await res.text();
  });

  // A no-JS submit is a browser navigation, so every outcome must be a
  // redirect to a real page — never a raw JSON body rendered at a human.
  it('redirects a rate-limited urlencoded submission instead of returning JSON', async () => {
    const ip = '198.51.100.11';
    let res;
    for (let i = 0; i < 5; i += 1) {
      res = await postForm(VALID, { 'x-forwarded-for': ip });
      await res.text();
      if (res.status !== 303) break;
    }
    assert.equal(res.status, 303, 'rate-limited no-JS submit should still redirect');
    assert.equal(res.headers.get('location'), '/contact-received/?error=1');
  });
});

/* ================================================================== *
 * Durability: a failed log write must fail the request
 * ================================================================== */

describe('unwritable inquiry log', () => {
  let server;

  before(async () => {
    // A regular file standing where the log directory should be: creating the
    // directory is impossible, so every append fails (even as root).
    const blocker = path.join(TMP_ROOT, 'blocked');
    await writeFile(blocker, 'not a directory\n');
    server = await startServer({ INQUIRY_LOG_PATH: path.join(blocker, 'inquiries.jsonl') });
  });

  after(async () => {
    if (server) await server.stop();
  });

  it('starts anyway and warns instead of crashing', () => {
    assert.match(server.stdout + server.stderr, /not writable yet/);
  });

  it('returns 500 when the inquiry cannot be persisted', async () => {
    const res = await postJson(VALID);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /info@fluxology\.ca/);
  });

  it('redirects a urlencoded submission to the error page on persist failure', async () => {
    const res = await postForm(VALID);
    await res.text();
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/contact-received/?error=1');
  });

  it('keeps serving health checks', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.status, 200);
    await res.text();
  });
});

/* ================================================================== *
 * SMTP configuration surface (no mail is actually sent)
 * ================================================================== */

describe('SMTP configured', () => {
  let server;

  before(async () => {
    server = await startServer({
      INQUIRY_LOG_PATH: path.join(TMP_ROOT, 'smtp', 'inquiries.jsonl'),
      // Nothing is listening here: sends must fail without failing requests.
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '2525',
      MAIL_TO: 'info@fluxology.ca',
    });
  });

  after(async () => {
    if (server) {
      const { code } = await server.stop();
      assert.equal(code, 0);
    }
  });

  it('reports email as enabled', async () => {
    assert.match(server.stdout, /Email delivery enabled/);
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.json();
    assert.equal(body.emailEnabled, true);
  });

  it('still returns 200 and stores the inquiry when the relay is unreachable', async () => {
    const res = await postJson(VALID);
    assert.equal(res.status, 200);
    await res.text();
    const rows = await readLog(path.join(TMP_ROOT, 'smtp', 'inquiries.jsonl'));
    assert.equal(rows.length, 1);
    // The failure is reported on stderr, not to the user.
    const deadline = Date.now() + 8000;
    while (!/email notification failed/.test(server.stderr) && Date.now() < deadline) {
      await delay(100);
    }
    assert.match(server.stderr, /email notification failed/);
  });
});

/* ================================================================== *
 * Security controls that had no coverage
 * ------------------------------------------------------------------
 * The suite above exercises the happy paths and the size limits
 * thoroughly, but the parts of the code explicitly marked as security
 * controls — the TRUST_PROXY=false branch, the null-prototype form
 * parse, the parameterised Content-Type, and header sanitisation in
 * mailer.mjs — had no assertion behind any of them. A regression to
 * one of those would have shipped silently.
 * ================================================================== */

describe('TRUST_PROXY=false ignores X-Forwarded-For', () => {
  let server;
  let logPath;

  before(async () => {
    logPath = path.join(TMP_ROOT, 'notrust', 'inquiries.jsonl');
    server = await startServer({
      INQUIRY_LOG_PATH: logPath,
      TRUST_PROXY: 'false',
      RATE_LIMIT_MAX: '2',
      RATE_LIMIT_WINDOW_MS: '60000',
    });
  });

  after(async () => {
    if (server) await server.stop();
  });

  it('records the connection peer, not the header the client sent', async () => {
    const res = await postJson(VALID, { 'x-forwarded-for': '203.0.113.99' });
    assert.equal(res.status, 200);
    await res.text();
    const rows = await readLog(logPath);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].ip, '203.0.113.99', 'a spoofed XFF must be ignored');
    assert.equal(rows[0].ip, '127.0.0.1', 'the loopback peer address is the client IP');
  });

  it('rate-limits on the peer address, so a rotating X-Forwarded-For cannot evade it', async () => {
    // RATE_LIMIT_MAX is 2 and one submission is already spent above.
    const second = await postJson(VALID, { 'x-forwarded-for': '198.51.100.1' });
    assert.equal(second.status, 200);
    await second.text();
    const third = await postJson(VALID, { 'x-forwarded-for': '198.51.100.2' });
    assert.equal(third.status, 429, 'a different XFF must not buy a fresh quota');
    await third.text();
  });
});

describe('input shapes that must not surprise the parser', () => {
  let server;
  let logPath;

  before(async () => {
    logPath = path.join(TMP_ROOT, 'shapes', 'inquiries.jsonl');
    server = await startServer({ INQUIRY_LOG_PATH: logPath, TRUST_PROXY: 'true' });
  });

  after(async () => {
    if (server) await server.stop();
  });

  it('accepts a Content-Type with parameters, as a real browser sends', async () => {
    // A form POST from a browser carries `; charset=UTF-8`. contentTypeOf must
    // split on ';' — an exact-match comparison here would 415 every no-JS
    // submission from a real user while every test still passed.
    for (const ct of [
      'application/json; charset=utf-8',
      'application/json;charset=UTF-8',
      'application/x-www-form-urlencoded; charset=UTF-8',
    ]) {
      const isForm = ct.startsWith('application/x-www-form-urlencoded');
      const res = await fetch(`${BASE}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': ct },
        body: isForm ? new URLSearchParams(VALID).toString() : JSON.stringify(VALID),
        redirect: 'manual',
      });
      assert.ok(res.status === 200 || res.status === 303, `${ct} should be accepted, got ${res.status}`);
      await res.text();
    }
  });

  it('keeps a form field named __proto__ inert', async () => {
    const res = await postForm({ ...VALID, __proto__: 'polluted' });
    assert.ok(res.status === 200 || res.status === 303, `unexpected status ${res.status}`);
    await res.text();
    // Nothing may have been grafted onto Object.prototype in the server, and
    // the field must not appear in the stored record.
    const rows = await readLog(logPath);
    const stored = rows[rows.length - 1];
    assert.equal(stored.fullName, VALID.fullName);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, '__proto__'), false);
    // If prototype pollution had happened server-side, a subsequent request
    // would inherit the polluted value; prove the server is still healthy and
    // answering normally.
    const health = await fetch(`${BASE}/api/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.polluted, undefined);
  });

  it('rejects a non-GET/HEAD method on /api/health with an Allow header', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await fetch(`${BASE}/api/health`, { method });
      assert.equal(res.status, 405, `${method} on /api/health should be rejected`);
      assert.equal(res.headers.get('allow'), 'GET, HEAD');
      await res.text();
    }
  });

  it('reports inquiry arrival on /api/health so it is detectable without exec', async () => {
    const before = await (await fetch(`${BASE}/api/health`)).json();
    assert.ok(before.inquiryLog, '/api/health must carry an inquiryLog summary');
    const seen = before.inquiryLog.appendedSinceStart;

    const res = await postJson(VALID);
    assert.equal(res.status, 200);
    await res.text();

    const after = await (await fetch(`${BASE}/api/health`)).json();
    assert.equal(after.inquiryLog.appendedSinceStart, seen + 1);
    assert.ok(after.inquiryLog.bytes > before.inquiryLog.bytes, 'log should have grown');
    assert.match(
      after.inquiryLog.lastInquiryAt,
      /^\d{4}-\d{2}-\d{2}T/,
      'lastInquiryAt should be an ISO timestamp',
    );
  });
});

/* ================================================================== *
 * Mail header sanitisation
 * ------------------------------------------------------------------
 * mailer.mjs is the only place user-supplied text reaches an email
 * header (the Reply-To display name and address, and the Subject).
 * headerSafe() strips control characters for exactly that reason and
 * nothing exercised it. These tests capture the real SMTP conversation
 * from a minimal in-process sink and assert on the bytes that would go
 * out over the wire.
 * ================================================================== */

/** Minimal SMTP sink: accepts one message and records the raw DATA payload. */
async function startSmtpSink() {
  const net = await import('node:net');
  const messages = [];

  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let data = '';
    socket.setEncoding('utf8');
    socket.write('220 sink.test ESMTP\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(data);
            data = '';
            socket.write('250 2.0.0 Ok: queued\r\n');
          } else {
            // Undo SMTP dot-stuffing so the captured payload is the message.
            data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          }
          continue;
        }

        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') socket.write('250-sink.test\r\n250 8BITMIME\r\n');
        else if (verb === 'HELO') socket.write('250 sink.test\r\n');
        else if (verb === 'MAIL' || verb === 'RCPT' || verb === 'RSET') socket.write('250 2.1.0 Ok\r\n');
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else socket.write('502 5.5.2 Not implemented\r\n');
      }
    });
    socket.on('error', () => {});
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    messages,
    async waitForMessage(timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (messages.length === 0 && Date.now() < deadline) await delay(50);
      return messages[0];
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

describe('mail header sanitisation (real SMTP capture)', () => {
  let server;
  let sink;

  before(async () => {
    sink = await startSmtpSink();
    server = await startServer({
      INQUIRY_LOG_PATH: path.join(TMP_ROOT, 'headers', 'inquiries.jsonl'),
      TRUST_PROXY: 'true',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(sink.port),
      SMTP_SECURE: 'false',
      MAIL_TO: 'inbox@fluxology.test',
      MAIL_FROM: 'notifications@fluxology.test',
    });
  });

  after(async () => {
    if (server) await server.stop();
    if (sink) await sink.close();
  });

  it('strips CR/LF out of the name, address and subject before they reach a header', async () => {
    const res = await postJson({
      ...VALID,
      // A classic header-injection attempt in both header-bearing fields.
      fullName: 'Ada\r\nBcc: attacker@evil.test\r\nX-Injected: yes',
      email: 'ada@example.com',
      serviceInterest: 'fabrication',
      message: 'Body text may legitimately contain\r\nnewlines and must not be mangled.',
    });
    assert.equal(res.status, 200);
    await res.text();

    const raw = await sink.waitForMessage();
    assert.ok(raw, 'the sink should have received a message');

    const headerBlock = raw.split(/\n\s*\n/)[0];

    // The point of headerSafe() is that the CR/LF is gone, so the injected
    // text cannot start a header of its own — it stays a value inside the
    // header it was submitted into. Assert the structure, not the absence of
    // the string: "Bcc: attacker@evil.test" appearing inside the quoted
    // Reply-To display name is the DEFENCE working, not a leak.
    assert.doesNotMatch(headerBlock, /^Bcc:/im, 'an injected Bcc header must not appear');
    assert.doesNotMatch(headerBlock, /^X-Injected:/im, 'an injected header must not appear');
    assert.doesNotMatch(headerBlock, /^To:.*attacker@evil\.test/im, 'no injected recipient');

    // Every header line either starts a known header or is a folded
    // continuation (leading whitespace). A CR/LF that survived would show up
    // here as an unfolded line that is not a header we emit.
    const known = /^(From|To|Reply-To|Subject|Message-ID|Content-Transfer-Encoding|Date|MIME-Version|Content-Type|X-Mailer):/i;
    for (const line of headerBlock.split('\n')) {
      if (line === '' || /^\s/.test(line)) continue;
      assert.match(line, known, `unexpected header line injected: ${line}`);
    }

    // The legitimate parts still made it through.
    assert.match(headerBlock, /^Reply-To:.*<ada@example\.com>/im);
    assert.match(headerBlock, /^Subject:/im);
    assert.match(raw, /Fluxology_website_inquiry|Fluxology website inquiry/);

    // The envelope sender is operator-controlled, never the visitor.
    assert.match(headerBlock, /^From:.*notifications@fluxology\.test/im);
    assert.doesNotMatch(headerBlock, /^From:.*ada@example\.com/im);
  });
});
