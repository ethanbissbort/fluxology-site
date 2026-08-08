/**
 * Internal client for the Fluxology Dashboard API (SDD §7.3, §18, §19.2).
 *
 * Anti-SSRF design (SDD §25.3): there is no URL parameter anywhere in the tool
 * surface. The base URL comes from configuration, the path comes from a frozen
 * endpoint map keyed by category, and the bearer secret is selected by
 * server-side dispatch. A model can influence *what* is written, never *where*.
 *
 * Implemented on `node:http` rather than `fetch` so the SDD's separate connect
 * and request timeouts are both enforceable.
 */
import http from 'node:http';
import https from 'node:https';

import { ToolError } from './errors.mjs';

/** The only downstream paths this service will ever call. */
const ENDPOINTS = Object.freeze({
  office: Object.freeze({ feed: '/v1/office/feed', upsert: '/v1/office/upsert' }),
  deals: Object.freeze({ feed: '/v1/deals/feed', upsert: '/v1/deals/upsert' }),
  jobs: Object.freeze({ feed: '/v1/jobs/feed', upsert: '/v1/jobs/upsert' }),
});

const HEALTH_PATH = '/health';

class DownstreamTransportError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'DownstreamTransportError';
    this.kind = kind;
  }
}

function httpRequest(baseUrl, { method, path, headers = {}, body = null, connectTimeoutMs, requestTimeoutMs, maxResponseBytes }) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body == null ? null : Buffer.from(body, 'utf8');

    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: payload ? { ...headers, 'content-length': String(payload.length) } : headers,
    });

    let settled = false;
    let connectTimer = null;

    const clearConnectTimer = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
    };
    const overallTimer = setTimeout(() => fail('timeout', 'downstream request timed out'), requestTimeoutMs);
    const cleanup = () => {
      clearTimeout(overallTimer);
      clearConnectTimer();
    };

    function fail(kind, message) {
      if (settled) return;
      settled = true;
      cleanup();
      req.destroy();
      reject(new DownstreamTransportError(kind, message));
    }

    connectTimer = setTimeout(() => fail('connect_timeout', 'downstream connection timed out'), connectTimeoutMs);

    req.on('socket', socket => {
      if (!socket.connecting) clearConnectTimer();
      else {
        socket.once('connect', clearConnectTimer);
        socket.once('secureConnect', clearConnectTimer);
      }
    });

    req.on('error', err => fail('network', `downstream request failed (${err.code || err.message})`));

    req.on('response', res => {
      clearConnectTimer();
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          res.destroy();
          fail('too_large', 'downstream response exceeded the configured size limit');
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', err => fail('network', `downstream response failed (${err.code || err.message})`));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
      });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Downstream `{error: "..."}` codes are short machine strings and safe to relay.
 *
 * The upstream chooses 400-vs-500 by substring-matching its own error text, so
 * "it is always a machine token" is an implicit contract rather than a
 * guaranteed one. Enforce the shape here instead of trusting it: anything that
 * is not a short snake_case token is logged and withheld from the model.
 */
const MACHINE_TOKEN = /^[a-z][a-z0-9_.:-]{0,79}$/;

/** Bounded upstream reason, for the log only. */
function downstreamReason(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.error === 'string') return parsed.error.slice(0, 120);
  } catch {
    /* fall through */
  }
  return null;
}

/** The subset of that reason it is safe to put in front of the model. */
function relayableReason(reason) {
  return typeof reason === 'string' && MACHINE_TOKEN.test(reason) ? reason : null;
}

export function createDashboardClient(config, log) {
  const base = config.dashboardApiUrl;
  const { connectTimeoutMs, requestTimeoutMs, maxResponseBytes, feedCacheTtlMs } = config.downstream;
  /** scope -> { etag, feed, fetchedAt } */
  const feedCache = new Map();
  /** The Dashboard API's own body cap, minus headroom for its framing. */
  const maxOutboundBodyBytes = 1_000_000;

  function call(path, options) {
    return httpRequest(base, {
      path,
      connectTimeoutMs,
      requestTimeoutMs,
      maxResponseBytes,
      ...options,
    });
  }

  /**
   * One extra attempt, for GET only.
   *
   * `isRetryable` documented a retry policy the code never implemented, and a
   * single dropped TCP connection on the idempotent feed read failed a whole
   * write pipeline before anything had been touched. The upsert is deliberately
   * NOT retried: repeating a write whose outcome is unknown is exactly the
   * ambiguity the connector is trying to stop reporting.
   */
  async function retryIdempotent(attempt, { scope, operation }) {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof DownstreamTransportError) || err.kind === 'too_large') throw err;
      log.warn('downstream_retry', { scope, operation, kind: err.kind });
      await new Promise(resolve => setTimeout(resolve, 150));
      return attempt();
    }
  }

  function transportToToolError(err, scope, operation) {
    if (err instanceof DownstreamTransportError) {
      log.warn('downstream_transport_error', { scope, operation, kind: err.kind });
      return new ToolError('DOWNSTREAM_UNAVAILABLE', `the dashboard API is not reachable (${err.kind})`, { scope });
    }
    log.error('downstream_unexpected_error', { scope, operation, error: err });
    return new ToolError('DOWNSTREAM_UNAVAILABLE', 'the dashboard API call failed unexpectedly', { scope });
  }

  /**
   * Read a category feed. Uses the Dashboard API's ETag so a repeated
   * reconciliation costs a 304 rather than a full feed transfer.
   *
   * The returned objects are shared with the cache: callers must treat them as
   * read-only and build new objects when merging.
   */
  async function getFeed(scope, { revalidate = false } = {}) {
    const cached = feedCache.get(scope);
    const fresh = cached && Date.now() - cached.fetchedAt < feedCacheTtlMs;
    if (cached && fresh && !revalidate) return cached.feed;

    let res;
    try {
      res = await retryIdempotent(
        () =>
          call(ENDPOINTS[scope].feed, {
            method: 'GET',
            headers: {
              accept: 'application/json',
              ...(cached?.etag ? { 'if-none-match': cached.etag } : {}),
            },
          }),
        { scope, operation: 'feed' },
      );
    } catch (err) {
      throw transportToToolError(err, scope, 'feed');
    }

    if (res.status === 304 && cached) {
      feedCache.set(scope, { ...cached, fetchedAt: Date.now() });
      return cached.feed;
    }

    if (res.status !== 200) {
      const reason = downstreamReason(res.text);
      log.warn('downstream_feed_error', { scope, status: res.status, reason });
      throw new ToolError('DOWNSTREAM_UNAVAILABLE', `the dashboard API returned ${res.status} for the ${scope} feed`, { scope });
    }

    let feed;
    try {
      feed = JSON.parse(res.text);
    } catch {
      throw new ToolError('DOWNSTREAM_UNAVAILABLE', `the ${scope} feed is not valid JSON`, { scope });
    }
    if (!feed || typeof feed !== 'object' || !Array.isArray(feed.listings)) {
      throw new ToolError('DOWNSTREAM_UNAVAILABLE', `the ${scope} feed is malformed`, { scope });
    }

    const etag = typeof res.headers.etag === 'string' ? res.headers.etag : null;
    feedCache.set(scope, { etag, feed, fetchedAt: Date.now() });
    return feed;
  }

  /**
   * Persist changed records. The bearer secret is chosen here, from the scope
   * the tool dispatcher passed in — never from anything the caller supplied.
   */
  async function upsert(scope, listings, { source, requestId, principal }) {
    const token = config.secrets[scope];
    if (!token) {
      // Writes stay disabled for a category until its token is provisioned.
      throw new ToolError('DOWNSTREAM_UNAVAILABLE', `${scope} writes are not enabled on this connector`, { scope });
    }

    /*
     * The outbound body carries fully MERGED records, so a small inbound request
     * can produce a large upstream one (a 1,486-byte request measured at
     * 567,644 bytes outbound). Check the real size before sending, so the model
     * gets an actionable message instead of an upstream 413 that blames the
     * listing count.
     */
    const body = JSON.stringify({ listings });
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    if (bodyBytes > maxOutboundBodyBytes) {
      throw new ToolError(
        'BATCH_TOO_LARGE',
        `the merged records total ${bodyBytes} bytes, past the ${maxOutboundBodyBytes}-byte upstream limit; send fewer records per call (the stored records are large, not the update)`,
        { scope, bytes: bodyBytes, maximum: maxOutboundBodyBytes },
      );
    }

    let res;
    try {
      res = await call(ENDPOINTS[scope].upsert, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          // SDD §19.2: makes the Dashboard API audit entry traceable to this connector.
          'x-fluxology-source': `mcp:${source}`,
          'x-request-id': requestId,
          // The authenticated OAuth principal, so the durable audit record can
          // name who drove the write and not only which skill label it claimed.
          ...(principal ? { 'x-fluxology-principal': principal } : {}),
        },
        body,
      });
    } catch (err) {
      throw transportToToolError(err, scope, 'upsert');
    }

    // A successful write invalidates our cached view of the feed.
    feedCache.delete(scope);

    if (res.status === 200 || res.status === 201) {
      try {
        return JSON.parse(res.text);
      } catch {
        throw new ToolError('DOWNSTREAM_UNAVAILABLE', 'the dashboard API returned an unreadable response', { scope });
      }
    }

    const reason = downstreamReason(res.text);

    if (res.status === 401 || res.status === 403) {
      // The connector's own credential is wrong. Loud in logs, opaque to the model.
      log.error('downstream_credential_rejected', { scope, status: res.status });
      throw new ToolError('DOWNSTREAM_REJECTED', `the dashboard API rejected this connector's ${scope} credential`, { scope });
    }
    if (res.status === 429 || res.status >= 500) {
      log.warn('downstream_unavailable', { scope, status: res.status, reason });
      throw new ToolError('DOWNSTREAM_UNAVAILABLE', `the dashboard API returned ${res.status}`, { scope, retryable: true });
    }
    if (res.status === 413) {
      throw new ToolError('BATCH_TOO_LARGE', 'the dashboard API rejected the batch as too large', { scope, reason: relayableReason(reason) });
    }
    const relayable = relayableReason(reason);
    if (res.status === 409) {
      throw new ToolError('CONFLICT', `the dashboard API reported a conflict${relayable ? `: ${relayable}` : ''}`, { scope });
    }

    log.warn('downstream_rejected', { scope, status: res.status, reason });
    throw new ToolError('DOWNSTREAM_REJECTED', `the dashboard API rejected the write${relayable ? `: ${relayable}` : ''}`, {
      scope,
      status: res.status,
    });
  }

  async function health() {
    const res = await call(HEALTH_PATH, { method: 'GET', headers: { accept: 'application/json' } });
    if (res.status !== 200) throw new DownstreamTransportError('status', `dashboard API health returned ${res.status}`);
    return JSON.parse(res.text);
  }

  function invalidate(scope) {
    if (scope) feedCache.delete(scope);
    else feedCache.clear();
  }

  return { getFeed, upsert, health, invalidate, endpoints: ENDPOINTS };
}
