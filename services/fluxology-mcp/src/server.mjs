#!/usr/bin/env node
/**
 * Fluxology write-capable MCP connector.
 *
 * A narrow, authenticated bridge between approved model clients and the
 * existing self-hosted Fluxology Dashboard API. It is not a second data store
 * and it is not in the public dashboard read path: if this service is down, the
 * three dashboards keep serving (SDD §28).
 *
 * Public surface, all behind the VPS edge proxy:
 *   POST/GET/DELETE  {MCP_PUBLIC_URL path}   MCP over Streamable HTTP
 *   GET  /.well-known/oauth-protected-resource[/<path>]
 *   GET  /healthz    process liveness
 *   GET  /readyz     schemas, auth metadata, dashboard reachability, schema drift
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { SCOPES, describeConfig, loadConfig } from './config.mjs';
import { createAuthenticator, protectedResourceMetadataPath } from './auth.mjs';
import { createDashboardClient } from './dashboard-client.mjs';
import { createMcpServerFactory } from './mcp.mjs';
import { createRateLimiter, createScopeGates, createSemaphore } from './concurrency.mjs';
import { createToolRegistry } from './tools/index.mjs';
import { createWritePipeline } from './pipeline.mjs';
import { HttpError } from './errors.mjs';
import { createLogger, registerSecret } from './logging.mjs';
import { checkSchemaDrift, loadSchemas } from './schemas.mjs';

const SHUTDOWN_GRACE_MS = 8_000;
const DRIFT_CACHE_MS = 30_000;

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

function sendJson(res, status, value, extraHeaders = {}) {
  if (res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    ...BASE_HEADERS,
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

/** Read the request body under a hard byte cap (SDD §20). */
async function readRawBody(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'payload_too_large', `request body exceeds ${maxBytes} bytes`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', `request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Every `tools/call` in a request, whether it arrived alone or in a JSON-RPC batch. */
function toolCallsIn(body) {
  const messages = Array.isArray(body) ? body : [body];
  return messages
    .filter(message => message && typeof message === 'object' && message.method === 'tools/call')
    .map(message => (typeof message.params?.name === 'string' ? message.params.name : ''));
}

export async function createServer(env = process.env, { sink } = {}) {
  const config = loadConfig(env);

  const log = createLogger({
    level: config.logLevel,
    service: config.serviceName,
    version: config.serverVersion,
    ...(sink ? { sink } : {}),
  });

  // Registering the downstream secrets makes them unprintable everywhere else.
  for (const scope of SCOPES) registerSecret(config.secrets[scope]);
  if (config.auth.devAuthEnabled) registerSecret(config.auth.devAuthToken);

  const schemas = loadSchemas(config);
  const client = createDashboardClient(config, log);
  const authenticator = createAuthenticator(config, log);
  const scopeGates = createScopeGates(SCOPES, config.limits.maxConcurrentWritesPerScope);
  const pipeline = createWritePipeline({ config, schemas, client, scopeGates });
  const registry = createToolRegistry({ config, schemas, client, pipeline, log });
  const createMcpServer = createMcpServerFactory({
    config,
    registry,
    requireScope: authenticator.requireScope,
    log,
  });

  const toolSlots = createSemaphore(config.limits.maxActiveToolExecutions);
  const rateLimiter = createRateLimiter({ windowMs: 60_000 });

  const metadataPaths = new Set(['/.well-known/oauth-protected-resource', protectedResourceMetadataPath(config.mcpPath)]);
  const startedAt = Date.now();

  /* ---------------------------------------------------------------- drift */

  let driftState = { checkedAt: 0, ok: null, details: null, inFlight: null };

  async function probeDrift() {
    const now = Date.now();
    if (driftState.ok !== null && now - driftState.checkedAt < DRIFT_CACHE_MS) return driftState;
    if (driftState.inFlight) return driftState.inFlight;

    driftState.inFlight = (async () => {
      const details = {};
      let ok = true;
      for (const scope of SCOPES) {
        try {
          const feed = await client.getFeed(scope);
          const result = checkSchemaDrift(scope, feed, schemas);
          details[scope] = result;
          if (!result.compatible) ok = false;
        } catch (err) {
          details[scope] = { scope, error: err?.message ?? 'unreachable' };
          ok = false;
        }
      }
      driftState = { checkedAt: Date.now(), ok, details, inFlight: null };
      if (!ok) log.warn('schema_drift_detected', { details });
      return driftState;
    })().catch(err => {
      driftState = { checkedAt: Date.now(), ok: false, details: { error: err?.message ?? 'probe failed' }, inFlight: null };
      return driftState;
    });

    return driftState.inFlight;
  }

  async function readiness() {
    const auth = await authenticator.ready();
    let dashboard;
    try {
      const health = await client.health();
      dashboard = { ok: true, writeEnabled: health?.writeEnabled ?? null };
    } catch (err) {
      dashboard = { ok: false, reason: err?.message ?? 'unreachable' };
    }
    const drift = await probeDrift();
    const ok = Boolean(auth.ok && dashboard.ok && drift.ok);
    return {
      status: ok ? 'ready' : 'not_ready',
      service: config.serviceName,
      version: config.serverVersion,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      checks: {
        schemas: { ok: true, versions: schemas.describe() },
        auth,
        dashboardApi: dashboard,
        schemaDrift: { ok: Boolean(drift.ok), details: drift.details },
      },
    };
  }

  /* ------------------------------------------------------------- requests */

  async function handleMcp(req, res, httpRequestId) {
    if (config.allowedOrigins.length === 0) {
      // No browser is expected to reach this endpoint and no CORS headers are
      // emitted, so a cross-origin attempt is refused outright.
      if (typeof req.headers.origin === 'string') {
        throw new HttpError(403, 'origin_not_allowed', 'browser origins are not permitted');
      }
    } else if (typeof req.headers.origin === 'string' && !config.allowedOrigins.includes(req.headers.origin)) {
      throw new HttpError(403, 'origin_not_allowed', 'this origin is not permitted');
    }

    const authInfo = await authenticator.authenticate(req);
    const subject = authInfo.extra?.subject ?? authInfo.clientId ?? 'unknown';

    let body;
    if (req.method === 'POST') {
      const raw = await readRawBody(req, config.limits.maxBodyBytes);
      if (!raw) throw new HttpError(400, 'empty_body', 'the request body is empty');
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'invalid_json', 'the request body is not valid JSON');
      }
    }

    const calls = body ? toolCallsIn(body) : [];
    const writeCalls = calls.filter(name => registry.get(name)?.kind === 'write');

    // Rate limits are per authenticated subject (SDD §20).
    const readCheck = rateLimiter.consume('read', subject, config.limits.readsPerMinute);
    if (!readCheck.allowed) {
      throw new HttpError(429, 'rate_limited', 'too many requests', { retryAfterSeconds: readCheck.retryAfterSeconds });
    }
    if (writeCalls.length) {
      const writeCheck = rateLimiter.consume('write', subject, config.limits.writesPerMinute);
      if (!writeCheck.allowed) {
        throw new HttpError(429, 'rate_limited', 'too many write requests', { retryAfterSeconds: writeCheck.retryAfterSeconds });
      }
    }

    /*
     * Enforce the category scope here so an under-scoped call fails with a real
     * HTTP 403 and a standards-compliant challenge (SDD §16.1), rather than
     * only as a JSON-RPC-level error. The dispatcher checks again.
     */
    for (const name of calls) {
      const tool = registry.get(name);
      if (tool) authenticator.requireScope(authInfo, tool.requiredScope);
    }

    // Shed load rather than queueing indefinitely (SDD §18).
    if (calls.length && toolSlots.saturated) {
      throw new HttpError(503, 'busy', 'the connector is at its concurrent execution limit', { retryAfterSeconds: 2 });
    }
    const release = calls.length ? await toolSlots.acquire(config.limits.scopeLockTimeoutMs) : null;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcpServer = createMcpServer();

    req.auth = authInfo;
    res.setHeader('X-Request-Id', httpRequestId);

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    } finally {
      release?.();
      await transport.close().catch(() => {});
      await mcpServer.close().catch(() => {});
    }
  }

  const server = http.createServer(async (req, res) => {
    const httpRequestId = randomUUID();
    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendJson(res, 400, { error: 'invalid_request_target' });
    }

    try {
      if (url.pathname === '/healthz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
        return sendJson(res, 200, {
          status: 'ok',
          service: config.serviceName,
          version: config.serverVersion,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        });
      }

      if (url.pathname === '/readyz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
        const report = await readiness();
        return sendJson(res, report.status === 'ready' ? 200 : 503, report);
      }

      if (metadataPaths.has(url.pathname)) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
        return sendJson(res, 200, authenticator.protectedResourceMetadata());
      }

      if (url.pathname === config.mcpPath) {
        return await handleMcp(req, res, httpRequestId);
      }

      return sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      if (err instanceof HttpError) {
        const headers = { ...err.headers };
        if (err.retryAfterSeconds != null) headers['Retry-After'] = String(err.retryAfterSeconds);
        if (err.status >= 500) log.error('request_failed', { httpRequestId, status: err.status, code: err.code });
        else log.warn('request_rejected', { httpRequestId, status: err.status, code: err.code, path: url.pathname });
        return sendJson(res, err.status, { error: err.code, error_description: err.message }, headers);
      }
      log.error('request_unhandled_error', { httpRequestId, path: url.pathname, error: err });
      return sendJson(res, 500, { error: 'internal_error' });
    }
  });

  server.requestTimeout = config.limits.requestTimeoutMs;
  server.headersTimeout = Math.min(config.limits.requestTimeoutMs, 20_000);
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return { server, config, log, schemas, client, registry, readiness, probeDrift, authenticator };
}

/* -------------------------------------------------------------- bootstrap */

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  let started;
  try {
    started = await createServer();
  } catch (err) {
    // Configuration failures must be loud and fatal, never silently degraded.
    console.error(JSON.stringify({ at: new Date().toISOString(), level: 'error', event: 'startup_failed', message: err?.message ?? String(err) }));
    process.exit(1);
  }

  const { server, config, log, schemas, probeDrift } = started;

  server.listen(config.port, config.host, () => {
    log.info('listening', { address: `${config.host}:${config.port}`, ...describeConfig(config) });
    // SDD §12.3: state the loaded contracts explicitly at startup.
    log.info('schemas_loaded', { schemas: schemas.describe() });
    for (const scope of SCOPES) {
      if (!config.secrets[scope]) log.warn('write_disabled', { scope, reason: `${scope}_ingest_token is not configured` });
    }
    if (config.auth.devAuthEnabled) log.warn('development_auth_enabled', { note: 'never enable this on a publicly reachable deployment' });
    // Probe in the background so a slow dashboard API cannot block startup.
    probeDrift().catch(() => {});
  });

  const shutdown = signal => {
    log.info('shutting_down', { signal });
    const timer = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    server.close(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
