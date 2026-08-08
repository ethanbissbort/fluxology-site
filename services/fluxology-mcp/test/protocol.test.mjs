/**
 * MCP protocol and security tests (SDD §26.4, §31).
 *
 * Driven by the official MCP SDK client over real Streamable HTTP, plus raw
 * HTTP where the assertion is about the transport itself: the unauthenticated
 * challenge, cross-category scope isolation, body and rate limits.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEV_TOKEN, startHarness } from './helpers/harness.mjs';
import { createServer } from '../src/server.mjs';

const EXPECTED_TOOLS = ['get_dashboard_summary', 'get_dashboard_listing', 'upsert_office_listings', 'upsert_deal_listings', 'upsert_job_listings'];

const FORBIDDEN_TOOLS = ['delete_listing', 'replace_feed', 'run_http_request', 'execute_shell', 'read_file', 'write_file', 'git_commit'];

const JSON_RPC_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

describe('MCP protocol surface', () => {
  let harness;
  let session;

  before(async () => {
    harness = await startHarness({ portBase: 8220 });
    session = await harness.connectClient();
  });

  after(async () => {
    await session?.close();
    await harness?.stop();
  });

  it('completes initialize and reports its identity', () => {
    const info = session.client.getServerVersion();
    assert.equal(info.name, 'fluxology-dashboard-writer');
    assert.equal(info.version, '1.0.0');
    assert.match(session.client.getInstructions() ?? '', /untrusted data/);
  });

  it('lists exactly the five designed tools', async () => {
    const { tools } = await session.client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), [...EXPECTED_TOOLS].sort());
  });

  it('exposes no delete, feed-replacement, shell, filesystem or arbitrary HTTP tool', async () => {
    const { tools } = await session.client.listTools();
    const names = tools.map(t => t.name);
    for (const forbidden of FORBIDDEN_TOOLS) assert.equal(names.includes(forbidden), false, `${forbidden} must not exist`);
  });

  it('accepts no URL, path, host or token parameter anywhere in its input schemas', async () => {
    const { tools } = await session.client.listTools();
    const banned = /^(url|uri|endpoint|host|hostname|path|file|filepath|command|token|authorization|bearer|feed)$/i;
    for (const tool of tools) {
      for (const property of Object.keys(tool.inputSchema.properties ?? {})) {
        assert.equal(banned.test(property), false, `${tool.name} exposes a ${property} parameter`);
      }
    }
  });

  it('carries the conservative write annotations from the design', async () => {
    const { tools } = await session.client.listTools();
    for (const tool of tools) {
      const write = tool.name.startsWith('upsert_');
      assert.equal(tool.annotations.readOnlyHint, !write);
      assert.equal(tool.annotations.destructiveHint, false);
      assert.equal(tool.annotations.idempotentHint, !write);
      assert.equal(tool.annotations.openWorldHint, false);
    }
  });

  it('declares an output schema for every tool', async () => {
    const { tools } = await session.client.listTools();
    for (const tool of tools) {
      assert.equal(tool.outputSchema?.type, 'object', `${tool.name} has no output schema`);
      assert.ok(tool.outputSchema.required.includes('ok'));
    }
  });

  it('caps the advertised batch size at the configured maximum', async () => {
    const { tools } = await session.client.listTools();
    for (const tool of tools.filter(t => t.name.startsWith('upsert_'))) {
      assert.equal(tool.inputSchema.properties.listings.maxItems, 50);
      assert.deepEqual(tool.inputSchema.required, ['source', 'observedAt', 'listings']);
    }
  });

  it('returns both human text and machine-readable structured content', async () => {
    const result = await session.client.callTool({ name: 'get_dashboard_summary', arguments: { scope: 'jobs' } });
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /record\(s\)/);
    assert.equal(result.structuredContent.ok, true);
    assert.equal(result.structuredContent.scope, 'jobs');
    assert.equal(typeof result.structuredContent.recordCount, 'number');
  });

  it('rejects input that violates the tool schema', async () => {
    const result = await session.client.callTool({ name: 'get_dashboard_summary', arguments: { scope: 'not-a-dashboard' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'VALIDATION_ERROR');
  });

  it('rejects an unexpected extra input property', async () => {
    const result = await session.client.callTool({
      name: 'upsert_deal_listings',
      arguments: { source: 'x', observedAt: new Date().toISOString(), listings: [], dashboardUrl: 'http://evil.example' },
    });
    assert.equal(result.isError, true);
    assert.match(result.structuredContent.message, /dashboardUrl/);
  });

  it('reports an unknown tool as an error rather than crashing', async () => {
    await assert.rejects(() => session.client.callTool({ name: 'delete_listing', arguments: {} }));
  });

  it('serves the protected resource metadata document at both RFC 9728 locations', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await harness.http(path);
      assert.equal(res.status, 200);
      assert.equal(res.json.resource, harness.publicUrl);
      assert.deepEqual(res.json.scopes_supported, ['dashboards:read', 'office:write', 'deals:write', 'jobs:write']);
      assert.deepEqual(res.json.bearer_methods_supported, ['header']);
    }
  });

  it('challenges an unauthenticated request with a discoverable metadata pointer', async () => {
    const res = await harness.http('/mcp', {
      method: 'POST',
      headers: JSON_RPC_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
    const challenge = res.headers.get('www-authenticate');
    assert.match(challenge, /^Bearer /);
    assert.match(challenge, /error="invalid_token"/);
    assert.match(challenge, /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/mcp"/);
  });

  it('rejects an invalid bearer token', async () => {
    const res = await harness.http('/mcp', {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, authorization: 'Bearer not-the-development-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'invalid_token');
  });

  it('rejects a browser origin outright', async () => {
    const res = await harness.http('/mcp', {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, authorization: `Bearer ${DEV_TOKEN}`, origin: 'https://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error, 'origin_not_allowed');
  });

  it('emits no CORS headers', async () => {
    const res = await harness.http('/.well-known/oauth-protected-resource');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('rejects a body larger than the configured limit', async () => {
    const res = await harness.http('/mcp', {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, authorization: `Bearer ${DEV_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { padding: 'x'.repeat(600_000) } }),
    });
    assert.equal(res.status, 413);
    assert.equal(res.json.error, 'payload_too_large');
  });

  it('rejects a malformed JSON body', async () => {
    const res = await harness.http('/mcp', {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, authorization: `Bearer ${DEV_TOKEN}` },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'invalid_json');
  });

  it('is not a dashboard read path', async () => {
    for (const path of ['/v1/deals/feed', '/v1/office/upsert', '/data/listings.json', '/']) {
      const res = await harness.http(path);
      assert.equal(res.status, 404, `${path} should not be routed`);
    }
  });

  it('serves liveness and readiness outside the MCP tool surface', async () => {
    const live = await harness.http('/healthz');
    assert.equal(live.status, 200);
    const ready = await harness.http('/readyz');
    assert.equal(ready.status, 200);
    assert.equal(ready.json.checks.schemaDrift.ok, true);
    assert.equal(ready.json.checks.auth.mode, 'development-bearer');
  });

  it('sets conservative response headers', async () => {
    const res = await harness.http('/healthz');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });

  it('supports repeated stateless sessions without server-side state', async () => {
    const second = await harness.connectClient({ name: 'second-client' });
    const { tools } = await second.client.listTools();
    assert.equal(tools.length, EXPECTED_TOOLS.length);
    await second.close();
    // The original session is unaffected by the second one closing.
    const { tools: again } = await session.client.listTools();
    assert.equal(again.length, EXPECTED_TOOLS.length);
  });
});

/* --------------------------------------------------------- scope isolation */

const SCOPE_CASES = [
  { granted: 'office:write', allowed: 'upsert_office_listings', denied: ['upsert_deal_listings', 'upsert_job_listings'], portBase: 8230 },
  { granted: 'deals:write', allowed: 'upsert_deal_listings', denied: ['upsert_office_listings', 'upsert_job_listings'], portBase: 8234 },
  { granted: 'jobs:write', allowed: 'upsert_job_listings', denied: ['upsert_office_listings', 'upsert_deal_listings'], portBase: 8238 },
];

describe('cross-category scope isolation (SDD §25.2, §31)', () => {
  for (const testCase of SCOPE_CASES) {
    describe(`a token holding only ${testCase.granted}`, () => {
      let harness;

      before(async () => {
        harness = await startHarness({
          portBase: testCase.portBase,
          mcpEnv: { MCP_DEV_AUTH_SCOPES: `dashboards:read ${testCase.granted}` },
        });
      });

      after(async () => {
        await harness?.stop();
      });

      const callRaw = tool =>
        harness.http('/mcp', {
          method: 'POST',
          headers: { ...JSON_RPC_HEADERS, authorization: `Bearer ${DEV_TOKEN}` },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: tool, arguments: { source: 'scope-test', observedAt: new Date().toISOString(), listings: [] } },
          }),
        });

      for (const denied of testCase.denied) {
        it(`is refused ${denied} with HTTP 403`, async () => {
          const res = await callRaw(denied);
          assert.equal(res.status, 403);
          assert.equal(res.json.error, 'insufficient_scope');
          assert.match(res.headers.get('www-authenticate'), /error="insufficient_scope"/);
        });
      }

      it(`is allowed past the scope gate for ${testCase.allowed}`, async () => {
        const res = await callRaw(testCase.allowed);
        // An empty listings array fails schema validation, not authorization:
        // reaching a 200 with a tool-level error proves the scope gate opened.
        assert.equal(res.status, 200);
      });

      it('can still read every dashboard', async () => {
        const session = await harness.connectClient();
        const result = await session.client.callTool({ name: 'get_dashboard_summary', arguments: { scope: 'deals' } });
        assert.equal(result.structuredContent.ok, true);
        await session.close();
      });
    });
  }
});

/* ------------------------------------------------- real OAuth mode, no dev auth */

describe('OAuth mode with an unreachable authorization server', () => {
  const port = 8246;
  let started;

  before(async () => {
    started = await createServer(
      {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(port),
        MCP_PUBLIC_URL: `http://127.0.0.1:${port}/mcp`,
        // Nothing is listening on this issuer.
        OAUTH_ISSUER: 'http://127.0.0.1:8247',
        DASHBOARD_API_URL: 'http://127.0.0.1:8248',
        DASHBOARD_REQUEST_TIMEOUT_MS: '1000',
        DASHBOARD_CONNECT_TIMEOUT_MS: '500',
      },
      { sink: { log: () => {}, error: () => {} } },
    );
    await new Promise(resolve => started.server.listen(port, '127.0.0.1', resolve));
  });

  after(async () => {
    await new Promise(resolve => started.server.close(resolve));
  });

  const request = (headers = {}) =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

  it('still challenges an anonymous request', async () => {
    const res = await request();
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /resource_metadata=/);
  });

  it('reports an unreachable authorization server as a dependency outage, not a bad token', async () => {
    const res = await request({ authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.sig' });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'temporarily_unavailable');
  });

  it('advertises the configured authorization server in its metadata', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`);
    const body = await res.json();
    assert.deepEqual(body.authorization_servers, ['http://127.0.0.1:8247']);
    assert.equal(body.resource, `http://127.0.0.1:${port}/mcp`);
  });
});

/* -------------------------------------------------------------- rate limits */

describe('per-subject rate limits (SDD §20)', () => {
  let harness;

  before(async () => {
    harness = await startHarness({
      portBase: 8242,
      mcpEnv: { MCP_READS_PER_MINUTE: '4', MCP_WRITES_PER_MINUTE: '1' },
    });
  });

  after(async () => {
    await harness?.stop();
  });

  it('sheds excess requests with 429 and a Retry-After hint', async () => {
    const request = () =>
      harness.http('/mcp', {
        method: 'POST',
        headers: { ...JSON_RPC_HEADERS, authorization: `Bearer ${DEV_TOKEN}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await request()).status);

    assert.equal(statuses.slice(0, 4).every(status => status === 200), true, `expected four allowed, got ${statuses}`);
    assert.equal(statuses[4], 429);
    const limited = await request();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  });
});
