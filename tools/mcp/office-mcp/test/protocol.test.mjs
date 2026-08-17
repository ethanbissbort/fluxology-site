/**
 * Dual-era protocol conformance (SDD v2 §0.6, §C2): modern 2026-07-28
 * semantics (server/discover, resultType, cacheable lists, -32022, no ping),
 * legacy initialize semantics, era isolation, tool-name portability, and a
 * real child-process stdio harness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testServer, tempDataDir } from './helpers.mjs';

const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'office-mcp.mjs');

test('modern era: discover, resultType, cacheable lists, serverInfo meta', async () => {
  const { server } = testServer();
  const discover = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: MODERN_META } });
  assert.equal(discover.result.resultType, 'complete');
  assert.deepEqual(discover.result.supportedVersions, ['2026-07-28']);
  assert.ok(discover.result.capabilities.tools);
  assert.ok(discover.result.instructions.length > 100);
  assert.equal(discover.result._meta['io.modelcontextprotocol/serverInfo'].name, 'fluxology-office-mcp');

  const tools = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: MODERN_META } });
  assert.equal(tools.result.resultType, 'complete');
  assert.equal(typeof tools.result.ttlMs, 'number');
  assert.ok(['public', 'private'].includes(tools.result.cacheScope));

  // Deterministic ordering.
  const again = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: MODERN_META } });
  assert.deepEqual(tools.result.tools.map((t) => t.name), again.result.tools.map((t) => t.name));

  // Host-portable tool names (Claude API pattern) and schema presence.
  for (const tool of tools.result.tools) {
    assert.match(tool.name, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 10);
    assert.notEqual(tool.annotations, undefined);
  }
});

test('modern era: unsupported version -> -32022 with supported list; ping removed; unknown tool -32602; batch -32600', async () => {
  const { server } = testServer();
  const bad = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2030-01-01' } } });
  assert.equal(bad.error.code, -32022);
  assert.deepEqual(bad.error.data.supported, ['2026-07-28']);
  assert.equal(bad.error.data.requested, '2030-01-01');

  const ping = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping', params: { _meta: MODERN_META } });
  assert.equal(ping.error.code, -32601);

  const unknown = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'no_such_tool', arguments: {}, _meta: MODERN_META } });
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /Unknown tool/);

  const batch = await server.handleMessage([{ jsonrpc: '2.0', id: 4, method: 'tools/list' }]);
  assert.equal(batch.error.code, -32600);
});

test('legacy era: initialize handshake, ping answered, classic shapes, era isolation', async () => {
  const { server } = testServer();
  const init = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'fluxology-office-mcp');
  assert.equal(init.result.resultType, undefined); // classic shape

  const unknownVersion = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2019-01-01' } });
  assert.equal(unknownVersion.result.protocolVersion, '2025-11-25'); // newest legacy offered

  const initialized = await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(initialized, null);

  const ping = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.deepEqual(ping.result, {});

  const tools = await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} });
  assert.equal(tools.result.resultType, undefined);
  assert.equal(tools.result.ttlMs, undefined);
  assert.ok(tools.result.tools.length >= 20);

  // A modern request against the same process still gets modern shapes.
  const modern = await server.handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: MODERN_META } });
  assert.equal(modern.result.resultType, 'complete');
});

test('resources: modern read + not-found codes differ by era (-32602 vs -32002)', async () => {
  const { server, repos } = testServer();
  const provider = repos.providers.upsert({ display_name: 'X' });
  const read = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: `office://providers/${provider.provider_id}`, _meta: MODERN_META } });
  assert.equal(read.result.resultType, 'complete');
  assert.equal(read.result.contents[0].mimeType, 'application/json');

  const modernMissing = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'office://providers/prov_missing00000000000000000', _meta: MODERN_META } });
  assert.equal(modernMissing.error.code, -32602);

  const legacyMissing = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'office://providers/prov_missing00000000000000000' } });
  assert.equal(legacyMissing.error.code, -32002);

  const templates = await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'resources/templates/list', params: { _meta: MODERN_META } });
  assert.ok(templates.result.resourceTemplates.length >= 8);
});

test('input schema violations return isError tool results (self-correctable), not protocol errors', async () => {
  const { server } = testServer();
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'office_search_start', arguments: { profile: 'not_a_profile' }, _meta: MODERN_META } });
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'VALIDATION_FAILED');
});

test('stdio child process: legacy handshake, tool call, clean EOF shutdown, stderr-only logging', async () => {
  const dataDir = tempDataDir();
  const child = spawn(process.execPath, [BIN], {
    env: { ...process.env, FLUXOLOGY_OFFICE_DATA_DIR: dataDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    let idx;
    while ((idx = buffered.indexOf('\n')) !== -1) {
      lines.push(JSON.parse(buffered.slice(0, idx)));
      buffered = buffered.slice(idx + 1);
    }
  });
  const waitFor = (count) =>
    new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (lines.length >= count) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${count} responses; got ${lines.length}`));
      }, 8000);
    });

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'harness', version: '1' } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'office_health', arguments: {} } }) + '\n');
  await waitFor(3);

  assert.equal(lines[0].id, 1);
  assert.equal(lines[0].result.protocolVersion, '2025-06-18');
  assert.equal(lines[1].id, 2);
  assert.ok(lines[1].result.tools.length >= 20);
  assert.equal(lines[2].id, 3);
  assert.equal(lines[2].result.isError, false);
  assert.equal(lines[2].result.structuredContent.server, 'fluxology-office-mcp');

  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.stdin.end();
  const code = await exited;
  assert.equal(code, 0);
});

test('stdio child process: modern probe (server/discover) works before any handshake', async () => {
  const dataDir = tempDataDir();
  const child = spawn(process.execPath, [BIN], { env: { ...process.env, FLUXOLOGY_OFFICE_DATA_DIR: dataDir }, stdio: ['pipe', 'pipe', 'pipe'] });
  const line = new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const idx = buf.indexOf('\n');
      if (idx !== -1) resolve(JSON.parse(buf.slice(0, idx)));
    });
    setTimeout(() => reject(new Error('no discover response')), 8000);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'probe-1', method: 'server/discover', params: { _meta: MODERN_META } }) + '\n');
  const response = await line;
  assert.equal(response.id, 'probe-1');
  assert.deepEqual(response.result.supportedVersions, ['2026-07-28']);
  child.stdin.end();
  await new Promise((resolve) => child.on('exit', resolve));
});
