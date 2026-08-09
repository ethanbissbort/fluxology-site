/**
 * Integration harness.
 *
 * Deliberately runs the *real* `services/dashboard-api/server.mjs` as a child
 * process rather than a stub, so the connector's merge, diff and suppression
 * behaviour is tested against the persistence semantics it actually has to
 * agree with (SDD §26.3). The MCP service runs in-process and is driven over
 * real HTTP by the official MCP SDK client (SDD §26.4).
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createServer } from '../../src/server.mjs';

const SERVICE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(SERVICE_DIR, '..', '..');
const DASHBOARD_SERVER = path.join(REPO_ROOT, 'services', 'dashboard-api', 'server.mjs');

export const TOKENS = Object.freeze({
  office: 'office-test-token-000000000000000000',
  deals: 'deals-test-token-0000000000000000000',
  jobs: 'jobs-test-token-00000000000000000000',
});

export const DEV_TOKEN = 'dev-test-bearer-token-0123456789';

const SEEDS = Object.freeze({
  office: path.join(REPO_ROOT, 'public', 'office-scout', 'data', 'listings.json'),
  deals: path.join(REPO_ROOT, 'public', 'deals', 'data', 'listings.json'),
  jobs: path.join(REPO_ROOT, 'public', 'jobs', 'data', 'listings.json'),
});

/** Collects log lines so tests can assert on what was and was not written. */
export function createLogSink() {
  const lines = [];
  const push = text => lines.push(String(text));
  return {
    sink: { log: push, error: push },
    lines,
    get text() {
      return lines.join('\n');
    },
    events(name) {
      return lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(entry => entry && (!name || entry.event === name));
    },
  };
}

async function waitForListening(child, name) {
  let output = '';
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`${name} exited early (${child.exitCode}): ${output}`);
    const chunk = await Promise.race([
      once(child.stdout, 'data').then(([data]) => String(data)),
      new Promise(resolve => setTimeout(() => resolve(null), 250)),
    ]);
    if (chunk) {
      output += chunk;
      if (output.includes('listening')) return output;
    }
  }
  throw new Error(`${name} did not start: ${output}`);
}

/**
 * Boot a Dashboard API child process seeded from the repository snapshots, plus
 * the MCP connector listening on its own port.
 *
 * @param {object} [options]
 * @param {number} [options.portBase] distinct per test file so files can run in parallel
 * @param {object} [options.mcpEnv]   extra environment for the connector
 * @param {object} [options.tokens]   downstream ingest tokens to provision
 */
export async function startHarness({ portBase = 8200, mcpEnv = {}, tokens = TOKENS } = {}) {
  const dashboardPort = portBase;
  const mcpPort = portBase + 1;

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'fluxology-mcp-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  const seedDir = path.join(tmpRoot, 'seed');
  await mkdir(dataDir, { recursive: true });
  await mkdir(seedDir, { recursive: true });
  for (const [scope, file] of Object.entries(SEEDS)) {
    await copyFile(file, path.join(seedDir, `${scope}.json`));
  }

  const dashboard = spawn(process.execPath, [DASHBOARD_SERVER], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      PORT: String(dashboardPort),
      DATA_DIR: dataDir,
      SEED_DIR: seedDir,
      OFFICE_INGEST_TOKEN: tokens.office ?? '',
      DEALS_INGEST_TOKEN: tokens.deals ?? '',
      JOBS_INGEST_TOKEN: tokens.jobs ?? '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let dashboardStderr = '';
  dashboard.stderr.on('data', chunk => {
    dashboardStderr += String(chunk);
  });
  await waitForListening(dashboard, 'dashboard-api');

  const logs = createLogSink();
  const publicUrl = `http://127.0.0.1:${mcpPort}/mcp`;

  const started = await createServer(
    {
      NODE_ENV: 'test',
      PORT: String(mcpPort),
      HOST: '127.0.0.1',
      MCP_PUBLIC_URL: publicUrl,
      DASHBOARD_API_URL: `http://127.0.0.1:${dashboardPort}`,
      MCP_DEV_AUTH_ENABLED: 'true',
      MCP_DEV_AUTH_TOKEN: DEV_TOKEN,
      // The development bearer defaults to read-only (it has no issuer, no
      // audience and no expiry). Tests that exercise writes ask for the write
      // scopes explicitly, exactly as a local developer now has to.
      MCP_DEV_AUTH_SCOPES: 'dashboards:read office:write deals:write jobs:write',
      MCP_SCHEMA_DIR: path.join(tmpRoot, 'no-such-schema-dir'),
      OFFICE_INGEST_TOKEN: tokens.office ?? '',
      DEALS_INGEST_TOKEN: tokens.deals ?? '',
      JOBS_INGEST_TOKEN: tokens.jobs ?? '',
      // Reads must always hit the live feed in tests.
      DASHBOARD_FEED_CACHE_TTL_MS: '0',
      LOG_LEVEL: 'debug',
      ...mcpEnv,
    },
    { sink: logs.sink },
  );

  await new Promise((resolve, reject) => {
    started.server.once('error', reject);
    started.server.listen(mcpPort, '127.0.0.1', resolve);
  });

  /** Raw HTTP against the connector, for transport-level assertions. */
  async function http(pathname, init = {}) {
    const res = await fetch(`http://127.0.0.1:${mcpPort}${pathname}`, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  /** A connected MCP client carrying the given bearer token. */
  async function connectClient({ token = DEV_TOKEN, name = 'harness-client' } = {}) {
    const transport = new StreamableHTTPClientTransport(new URL(publicUrl), {
      requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} },
    });
    const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    return {
      client,
      transport,
      async close() {
        await client.close().catch(() => {});
      },
    };
  }

  async function readFeed(scope) {
    return JSON.parse(await readFile(path.join(dataDir, `${scope}.json`), 'utf8'));
  }

  async function readAudit() {
    try {
      const raw = await readFile(path.join(dataDir, 'audit.jsonl'), 'utf8');
      return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  async function stop() {
    await new Promise(resolve => started.server.close(resolve));
    dashboard.kill('SIGTERM');
    await Promise.race([once(dashboard, 'exit'), new Promise(resolve => setTimeout(resolve, 3_000))]);
    if (dashboard.exitCode == null) dashboard.kill('SIGKILL');
    await rm(tmpRoot, { recursive: true, force: true });
  }

  return {
    ...started,
    mcpPort,
    dashboardPort,
    publicUrl,
    dataDir,
    logs,
    http,
    connectClient,
    readFeed,
    readAudit,
    stop,
    get dashboardStderr() {
      return dashboardStderr;
    },
  };
}

/** Call a tool and return its parsed result. */
export async function callTool(client, name, args) {
  return client.callTool({ name, arguments: args });
}
