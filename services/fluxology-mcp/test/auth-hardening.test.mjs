/**
 * Token and trust-root hardening, driven against a real local authorization
 * server (SDD §9).
 *
 * Three gaps sat at the edges of an otherwise sound auth core: a token with no
 * `exp` validated and then never expired; metadata that simply omitted `issuer`
 * skipped the RFC 8414 §3.3 check; and the discovered `jwks_uri` was honoured
 * on any origin, so one hijacked metadata response relocated the trust root for
 * every write scope on the connector.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { SignJWT, exportJWK, generateKeyPair } from 'jose';

import { createServer } from '../src/server.mjs';
import { createLogSink } from './helpers/harness.mjs';

const AS_PORT = 8332;
const FOREIGN_PORT = 8333;
const MCP_PORT = 8334;

const ISSUER = `http://127.0.0.1:${AS_PORT}`;
const FOREIGN = `http://127.0.0.1:${FOREIGN_PORT}`;
const AUDIENCE = `http://127.0.0.1:${MCP_PORT}/mcp`;

/** A tiny authorization server whose metadata document the test can rewrite. */
function startAuthServer(port, { jwk, metadata }) {
  const state = { metadata, jwk, jwksHits: 0 };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/.well-known/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.metadata));
      return;
    }
    if (req.url.startsWith('/jwks')) {
      state.jwksHits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [state.jwk] }));
      return;
    }
    res.writeHead(404).end('{}');
  });
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve({ server, state }));
  });
}

async function bootConnector(env) {
  const logs = createLogSink();
  const started = await createServer(
    {
      NODE_ENV: 'test',
      PORT: String(MCP_PORT),
      HOST: '127.0.0.1',
      MCP_PUBLIC_URL: AUDIENCE,
      DASHBOARD_API_URL: `http://127.0.0.1:${MCP_PORT + 10}`,
      OAUTH_ISSUER: ISSUER,
      LOG_LEVEL: 'debug',
      ...env,
    },
    { sink: logs.sink },
  );
  await new Promise(resolve => started.server.listen(MCP_PORT, '127.0.0.1', resolve));
  return started;
}

describe('access-token and trust-root hardening', () => {
  let authServer;
  let foreignServer;
  let connector;
  let signingKey;
  let foreignKey;

  before(async () => {
    const pair = await generateKeyPair('RS256');
    const foreignPair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    foreignKey = foreignPair.privateKey;

    authServer = await startAuthServer(AS_PORT, {
      jwk: { ...(await exportJWK(pair.publicKey)), kid: 'primary', alg: 'RS256', use: 'sig' },
      metadata: { issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` },
    });
    foreignServer = await startAuthServer(FOREIGN_PORT, {
      jwk: { ...(await exportJWK(foreignPair.publicKey)), kid: 'foreign', alg: 'RS256', use: 'sig' },
      metadata: { issuer: FOREIGN, jwks_uri: `${FOREIGN}/jwks` },
    });

    connector = await bootConnector({});
  });

  after(async () => {
    await new Promise(resolve => connector?.server.close(resolve));
    await new Promise(resolve => authServer?.server.close(resolve));
    await new Promise(resolve => foreignServer?.server.close(resolve));
  });

  async function sign(claims, { key = signingKey, expiry = '5m' } = {}) {
    let jwt = new SignJWT({ scope: 'dashboards:read', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: key === signingKey ? 'primary' : 'foreign' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('test-subject')
      .setIssuedAt();
    if (expiry) jwt = jwt.setExpirationTime(expiry);
    return jwt.sign(key);
  }

  async function listTools(token) {
    const res = await fetch(AUDIENCE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    return { status: res.status, body: await res.text() };
  }

  it('accepts a properly-claimed token', async () => {
    const res = await listTools(await sign({}));
    assert.equal(res.status, 200);
  });

  it('refuses a token with no exp claim', async () => {
    // jose only enforces exp when the claim is present, so this token used to
    // validate and then never expire. RFC 9068 makes exp REQUIRED.
    const res = await listTools(await sign({}, { expiry: null }));
    assert.equal(res.status, 401);
    assert.match(res.body, /missing the required exp claim/);
  });

  it('refuses a token signed by a key from an unrelated origin', async () => {
    const res = await listTools(await sign({}, { key: foreignKey }));
    assert.equal(res.status, 401);
  });

  it('advertises only the tools the token can actually invoke', async () => {
    const readOnly = await listTools(await sign({ scope: 'dashboards:read' }));
    const names = JSON.parse(readOnly.body).result.tools.map(tool => tool.name);
    assert.deepEqual(names.sort(), ['get_dashboard_listing', 'get_dashboard_summary']);

    const withOffice = await listTools(await sign({ scope: 'dashboards:read office:write' }));
    const officeNames = JSON.parse(withOffice.body).result.tools.map(tool => tool.name);
    assert.ok(officeNames.includes('upsert_office_listings'));
    assert.equal(officeNames.includes('upsert_deal_listings'), false, 'a tool this token can never call must not be advertised');
  });
});

describe('authorization-server metadata is not taken on trust', () => {
  let authServer;
  let foreignServer;
  let connector;

  before(async () => {
    const pair = await generateKeyPair('RS256');
    const foreignPair = await generateKeyPair('RS256');

    authServer = await startAuthServer(AS_PORT, {
      jwk: { ...(await exportJWK(pair.publicKey)), kid: 'primary', alg: 'RS256', use: 'sig' },
      // No `issuer` field: RFC 8414 §3.3 makes it REQUIRED, and it was only
      // checked when present.
      metadata: { jwks_uri: `${ISSUER}/jwks` },
    });
    foreignServer = await startAuthServer(FOREIGN_PORT, {
      jwk: { ...(await exportJWK(foreignPair.publicKey)), kid: 'foreign', alg: 'RS256', use: 'sig' },
      metadata: { issuer: FOREIGN, jwks_uri: `${FOREIGN}/jwks` },
    });

    connector = await bootConnector({});
  });

  after(async () => {
    await new Promise(resolve => connector?.server.close(resolve));
    await new Promise(resolve => authServer?.server.close(resolve));
    await new Promise(resolve => foreignServer?.server.close(resolve));
  });

  it('refuses metadata with no issuer claim, and fails closed', async () => {
    const ready = await connector.authenticator.ready();
    assert.equal(ready.ok, false);
    assert.match(ready.reason, /issuer missing or mismatched/);
    assert.equal(authServer.state.jwksHits, 0, 'the JWKS must not be fetched from a document that failed validation');
  });

  it('refuses a jwks_uri pointed at an unrelated origin', async () => {
    // One hijacked or misconfigured metadata response used to relocate the whole
    // trust root — and give a blind SSRF primitive inside the edge network.
    authServer.state.metadata = { issuer: ISSUER, jwks_uri: `${FOREIGN}/jwks` };
    const ready = await connector.authenticator.ready();
    assert.equal(ready.ok, false);
    assert.match(ready.reason, /not on the issuer's origin/);
    assert.equal(foreignServer.state.jwksHits, 0, 'the connector must never fetch keys from a foreign host');
  });

  it('recovers once the metadata document is correct', async () => {
    authServer.state.metadata = { issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` };
    const ready = await connector.authenticator.ready();
    assert.equal(ready.ok, true);
    assert.equal(ready.jwksUri, `${ISSUER}/jwks`);
  });
});
