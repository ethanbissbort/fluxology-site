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
import { bearerFromRequest, createAuthenticator, protectedResourceMetadataPath } from './auth.mjs';
import { createDashboardClient } from './dashboard-client.mjs';
import { createMcpServerFactory } from './mcp.mjs';
import { createRateLimiter, createScopeGates, createSemaphore } from './concurrency.mjs';
import { createToolRegistry } from './tools/index.mjs';
import { createWritePipeline } from './pipeline.mjs';
import { HttpError } from './errors.mjs';
import { createLogger, registerSecret } from './logging.mjs';
import { checkSchemaDrift, loadSchemas } from './schemas.mjs';

const DRIFT_CACHE_MS = 30_000;

/**
 * Shutdown must outlast the connector's own worst-case tool duration, or SIGTERM
 * severs an in-flight write: the scope lock can hold for `scopeLockTimeoutMs`
 * and the downstream call for `requestTimeoutMs` on top of it. The old flat 8 s
 * was shorter than the 10 s downstream timeout alone, so a deploy could kill a
 * write mid-flight, exit 1, and leave the client with an ECONNRESET and no idea
 * whether the write landed.
 */
function shutdownGraceMs(config) {
  return config.limits.scopeLockTimeoutMs + config.downstream.requestTimeoutMs + 5_000;
}

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
  /** Set on SIGTERM: existing work drains, new tool calls are refused. */
  let draining = false;

  /* ---------------------------------------------------------------- drift */

  let driftState = { checkedAt: 0, ok: null, details: null, inFlight: null };

  async function probeDrift() {
    const now = Date.now();
    if (driftState.ok !== null && now - driftState.checkedAt < DRIFT_CACHE_MS) return driftState;
    if (driftState.inFlight) return driftState.inFlight;

    driftState.inFlight = (async () => {
      const details = {};
      let ok = true;
      // Probe the three scopes in PARALLEL. Sequentially, three feed timeouts
      // stack to 30 s at production defaults, which no health probe survives.
      const probes = await Promise.all(
        SCOPES.map(async scope => {
          try {
            const feed = await client.getFeed(scope);
            const result = checkSchemaDrift(scope, feed, schemas);
            // The compiled full-feed validator is otherwise never called; it is
            // reported here as a diagnostic and deliberately does not gate
            // readiness, since a neighbouring bad record cannot spread through
            // the connector's per-id writes.
            result.feedValid = schemas.categories[scope].validateFeed(feed);
            return [scope, result, result.compatible];
          } catch (err) {
            return [scope, { scope, error: err?.message ?? 'unreachable' }, false];
          }
        }),
      );
      for (const [scope, result, compatible] of probes) {
        details[scope] = result;
        if (!compatible) ok = false;
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

    /*
     * This deployment is stateless: `sessionIdGenerator` is undefined and a
     * fresh Server + transport is built per request, so the standalone GET
     * stream the Streamable HTTP spec describes can never carry anything to
     * anyone. The SDK used to hand out an endless ReadableStream that
     * `handleRequest` never resolved, so the cleanup in the finally below never
     * ran and the socket stayed open for the life of the client. The spec
     * allows exactly this answer for a server that offers no SSE stream.
     */
    if (req.method === 'GET') {
      throw new HttpError(405, 'method_not_allowed', 'this MCP endpoint is stateless and offers no server-initiated stream; use POST', {
        headers: { Allow: 'POST, DELETE' },
      });
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

    if (calls.length > config.limits.maxToolCallsPerRequest) {
      throw new HttpError(
        400,
        'too_many_tool_calls',
        `a single request may carry at most ${config.limits.maxToolCallsPerRequest} tool calls; send them as separate requests`,
      );
    }

    if (draining) {
      throw new HttpError(503, 'shutting_down', 'the connector is shutting down and is not accepting new work', { retryAfterSeconds: 5 });
    }

    /*
     * Rate limits are per authenticated subject (SDD §20), and they are charged
     * per TOOL CALL, not per HTTP request. `toolCallsIn` already knew the body
     * might be a JSON-RPC array and the SDK executes every element, so a batch
     * used to cost exactly one token however many writes it carried. The
     * official SDK client sends one message per POST — this is defence in depth
     * against a bespoke client, and it costs a loop.
     */
    const readCharges = Math.max(1, calls.length);
    let readCheck;
    for (let i = 0; i < readCharges; i += 1) readCheck = rateLimiter.consume('read', subject, config.limits.readsPerMinute);
    if (!readCheck.allowed) {
      throw new HttpError(429, 'rate_limited', 'too many requests', { retryAfterSeconds: readCheck.retryAfterSeconds });
    }
    let writeCheck;
    for (let i = 0; i < writeCalls.length; i += 1) writeCheck = rateLimiter.consume('write', subject, config.limits.writesPerMinute);
    if (writeCheck && !writeCheck.allowed) {
      throw new HttpError(429, 'rate_limited', 'too many write requests', { retryAfterSeconds: writeCheck.retryAfterSeconds });
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

    // Shed load rather than queueing indefinitely (SDD §18). One slot per tool
    // call, for the same reason the rate limiter charges per tool call.
    if (calls.length && toolSlots.saturated) {
      throw new HttpError(503, 'busy', 'the connector is at its concurrent execution limit', { retryAfterSeconds: 2 });
    }
    // A request that needs more slots than exist would hold some and wait for
    // the rest until the timeout, blocking others meanwhile. Refuse it up front.
    if (calls.length > toolSlots.capacity) {
      throw new HttpError(503, 'busy', 'this request needs more concurrent tool slots than the connector has', { retryAfterSeconds: 2 });
    }
    const releases = [];
    try {
      for (let i = 0; i < calls.length; i += 1) releases.push(await toolSlots.acquire(config.limits.scopeLockTimeoutMs));
    } catch (err) {
      for (const release of releases) release();
      if (err?.code === 'ACQUIRE_TIMEOUT') {
        throw new HttpError(503, 'busy', 'the connector is at its concurrent execution limit', { retryAfterSeconds: 2 });
      }
      throw err;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcpServer = createMcpServer({ httpRequestId });

    req.auth = authInfo;
    res.setHeader('X-Request-Id', httpRequestId);

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    } finally {
      for (const release of releases) release();
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
        const status = report.status === 'ready' ? 200 : 503;
        /*
         * The documented Caddy block proxies this hostname with no path matcher,
         * so /readyz is internet-facing. An anonymous caller gets the verdict —
         * enough for a probe or a deploy gate — while the detail (on-disk schema
         * paths, the resolved JWKS URI, which ingest tokens are live, raw
         * downstream error text) needs the same bearer the tools need.
         */
        let authorized = false;
        // Only attempt validation when a credential was offered: an anonymous
        // probe must never make this endpoint call the authorization server.
        if (bearerFromRequest(req)) {
          try {
            await authenticator.authenticate(req);
            authorized = true;
          } catch {
            authorized = false;
          }
        }
        if (!authorized) {
          return sendJson(res, status, {
            status: report.status,
            service: report.service,
            version: report.version,
            uptimeSeconds: report.uptimeSeconds,
            detail: 'authenticate to see the per-check detail',
          });
        }
        return sendJson(res, status, report);
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

  return {
    server,
    config,
    log,
    schemas,
    client,
    registry,
    readiness,
    probeDrift,
    authenticator,
    /** Refuse new tool calls while in-flight work drains (SDD §18). */
    startDraining() {
      draining = true;
    },
  };
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

  const { server, config, log, schemas, probeDrift, startDraining } = started;

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
    const graceMs = shutdownGraceMs(config);
    log.info('shutting_down', { signal, graceMs });
    // Refuse new tool calls immediately, then let in-flight ones finish, so a
    // clean exit 0 is the normal outcome rather than a severed write.
    startDraining();
    const timer = setTimeout(() => {
      log.error('shutdown_forced', { signal, graceMs, note: 'work was still in flight when the grace period expired' });
      process.exit(1);
    }, graceMs).unref();
    // The grace period is for in-flight work, not for idle keep-alive sockets:
    // `server.close()` alone waits for those too, which would turn a longer
    // grace into a longer shutdown for every ordinary deploy.
    const reaper = setInterval(() => server.closeIdleConnections(), 100).unref();
    server.closeIdleConnections();
    server.close(() => {
      clearTimeout(timer);
      clearInterval(reaper);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
