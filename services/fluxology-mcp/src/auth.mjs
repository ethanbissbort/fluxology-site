/**
 * OAuth 2.1 resource-server behaviour (SDD §9).
 *
 * The connector never issues tokens. It validates access tokens minted by a
 * separate, standards-compliant authorization server and enforces that each
 * token was audience-bound to *this* MCP resource. Category write scopes are
 * checked independently of the Dashboard API's internal bearer secrets, which
 * are chosen by server-side tool dispatch and never appear here.
 */
import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { ALL_OAUTH_SCOPES, OAUTH_SCOPES } from './config.mjs';
import { HttpError } from './errors.mjs';

/** RFC 9728 metadata path for a resource whose identifier has a path component. */
export function protectedResourceMetadataPath(mcpPath) {
  const suffix = String(mcpPath || '').replace(/^\/+/, '');
  return suffix ? `/.well-known/oauth-protected-resource/${suffix}` : '/.well-known/oauth-protected-resource';
}

export function protectedResourceMetadata(config) {
  const doc = {
    resource: config.publicUrl,
    authorization_servers: config.auth.issuer ? [config.auth.issuer] : [],
    scopes_supported: [...ALL_OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Fluxology dashboard writer',
  };
  if (config.auth.documentationUrl) doc.resource_documentation = config.auth.documentationUrl;
  return doc;
}

/** Strip anything that could break out of a quoted `WWW-Authenticate` parameter. */
function safeParam(value) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, ' ').replace(/["\\]/g, '').slice(0, 200);
}

/**
 * Build a standards-compliant challenge that points the client at this
 * resource's metadata document so it can discover the authorization server.
 */
export function buildChallenge(config, { error, description, scope } = {}) {
  const metadataUrl = `${config.publicOrigin}${protectedResourceMetadataPath(config.mcpPath)}`;
  const parts = [`Bearer realm="${safeParam(config.serverName)}"`];
  if (error) parts.push(`error="${safeParam(error)}"`);
  if (description) parts.push(`error_description="${safeParam(description)}"`);
  if (scope) parts.push(`scope="${safeParam(scope)}"`);
  parts.push(`resource_metadata="${safeParam(metadataUrl)}"`);
  return parts.join(', ');
}

export function unauthorized(config, description, error = 'invalid_token') {
  return new HttpError(401, error, description, {
    headers: { 'WWW-Authenticate': buildChallenge(config, { error, description }) },
  });
}

export function forbidden(config, requiredScope) {
  const description = `token is missing the ${requiredScope} scope`;
  return new HttpError(403, 'insufficient_scope', description, {
    headers: {
      'WWW-Authenticate': buildChallenge(config, {
        error: 'insufficient_scope',
        description,
        scope: requiredScope,
      }),
    },
  });
}

/** Constant-time comparison that does not leak length through an early return. */
function secretEquals(actual, expected) {
  const a = Buffer.from(String(actual), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length || a.length === 0) {
    // Still burn a comparison so the timing profile does not depend on length.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function bearerFromRequest(req) {
  const raw = req.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/** Normalise the several shapes an authorization server may use for scopes. */
export function extractScopes(payload) {
  const found = new Set();
  const push = value => {
    if (typeof value === 'string') {
      for (const part of value.split(/\s+/)) {
        if (part) found.add(part);
      }
    } else if (Array.isArray(value)) {
      for (const part of value) {
        if (typeof part === 'string' && part) found.add(part);
      }
    }
  };
  push(payload?.scope);
  push(payload?.scp);
  push(payload?.scopes);
  return [...found];
}

/**
 * Candidate metadata URLs for an issuer, in the order the specs prefer:
 * RFC 8414 path-insertion, then OpenID Connect discovery.
 */
export function metadataCandidates(issuer) {
  const url = new URL(issuer);
  const basePath = url.pathname.replace(/\/+$/, '');
  const origin = url.origin;
  const candidates = [];
  if (basePath) {
    candidates.push(`${origin}/.well-known/oauth-authorization-server${basePath}`);
    candidates.push(`${origin}/.well-known/openid-configuration${basePath}`);
    candidates.push(`${origin}${basePath}/.well-known/openid-configuration`);
  } else {
    candidates.push(`${origin}/.well-known/oauth-authorization-server`);
    candidates.push(`${origin}/.well-known/openid-configuration`);
  }
  return candidates;
}

export function createAuthenticator(config, log) {
  const { auth } = config;

  let cached = null; // { jwks, jwksUri, expiresAt }
  let inFlight = null;
  let lastError = null;

  async function fetchMetadata() {
    const errors = [];
    for (const candidate of metadataCandidates(auth.issuer)) {
      try {
        const res = await fetch(candidate, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(config.downstream.requestTimeoutMs),
        });
        if (!res.ok) {
          errors.push(`${candidate} -> ${res.status}`);
          continue;
        }
        const doc = await res.json();
        if (doc?.issuer && doc.issuer.replace(/\/+$/, '') !== auth.issuer.replace(/\/+$/, '')) {
          errors.push(`${candidate} -> issuer mismatch`);
          continue;
        }
        if (typeof doc?.jwks_uri !== 'string') {
          errors.push(`${candidate} -> no jwks_uri`);
          continue;
        }
        return doc.jwks_uri;
      } catch (err) {
        errors.push(`${candidate} -> ${err.name}`);
      }
    }
    throw new Error(`authorization server metadata unavailable (${errors.join('; ')})`);
  }

  async function resolveKeys() {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const jwksUri = auth.jwksUri || (await fetchMetadata());
      const jwks = createRemoteJWKSet(new URL(jwksUri), {
        timeoutDuration: config.downstream.requestTimeoutMs,
        cooldownDuration: 30_000,
      });
      cached = { jwks, jwksUri, expiresAt: Date.now() + auth.metadataTtlMs };
      lastError = null;
      log.info('oauth_metadata_resolved', { jwksUri, issuer: auth.issuer });
      return cached;
    })()
      .catch(err => {
        lastError = err;
        cached = null;
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  /**
   * Validate the request's credentials and return an MCP `AuthInfo`.
   * Throws an HttpError carrying the correct challenge on failure.
   */
  async function authenticate(req) {
    const token = bearerFromRequest(req);
    if (!token) throw unauthorized(config, 'an OAuth 2.1 bearer token is required');

    if (auth.devAuthEnabled) {
      if (!secretEquals(token, auth.devAuthToken)) throw unauthorized(config, 'invalid development token');
      return {
        token,
        clientId: 'development',
        scopes: [...auth.devAuthScopes],
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        resource: new URL(config.publicUrl),
        extra: { subject: 'development', mode: 'development' },
      };
    }

    let keys;
    try {
      keys = await resolveKeys();
    } catch {
      // The authorization server is unreachable: this is a dependency outage,
      // not a client error, and must not be reported as a bad token.
      throw new HttpError(503, 'temporarily_unavailable', 'authorization server metadata is unavailable');
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys.jwks, {
        issuer: auth.issuer,
        audience: auth.audience,
        clockTolerance: auth.clockToleranceSeconds,
      }));
    } catch (err) {
      const reason =
        err?.code === 'ERR_JWT_EXPIRED' ? 'the access token has expired'
        : err?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && err?.claim === 'aud' ? 'the access token was not issued for this MCP resource'
        : err?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' ? `the access token has an invalid ${err.claim} claim`
        : 'the access token could not be validated';
      throw unauthorized(config, reason);
    }

    const scopes = extractScopes(payload);
    return {
      token,
      clientId: payload.client_id || payload.azp || payload.cid || payload.sub || 'unknown',
      scopes,
      expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
      resource: new URL(config.publicUrl),
      extra: {
        subject: typeof payload.sub === 'string' ? payload.sub : 'unknown',
        tokenId: typeof payload.jti === 'string' ? payload.jti : undefined,
        mode: 'oauth2',
      },
    };
  }

  /** Throw 403 unless the validated token carries `requiredScope` (SDD §9.2). */
  function requireScope(authInfo, requiredScope) {
    if (!authInfo || !Array.isArray(authInfo.scopes) || !authInfo.scopes.includes(requiredScope)) {
      throw forbidden(config, requiredScope);
    }
  }

  /** Readiness probe input: are auth metadata and signing keys reachable? */
  async function ready() {
    if (auth.devAuthEnabled) return { ok: true, mode: 'development-bearer' };
    try {
      const keys = await resolveKeys();
      return { ok: true, mode: 'oauth2', jwksUri: keys.jwksUri };
    } catch (err) {
      return { ok: false, mode: 'oauth2', reason: err.message || String(lastError || 'unavailable') };
    }
  }

  return { authenticate, requireScope, ready, protectedResourceMetadata: () => protectedResourceMetadata(config) };
}

/** The OAuth scope a given tool requires. Fixed at dispatch; never caller-supplied. */
export function scopeForTool(toolName) {
  switch (toolName) {
    case 'get_dashboard_summary':
    case 'get_dashboard_listing':
      return OAUTH_SCOPES.read;
    case 'upsert_office_listings':
      return OAUTH_SCOPES.office;
    case 'upsert_deal_listings':
      return OAUTH_SCOPES.deals;
    case 'upsert_job_listings':
      return OAUTH_SCOPES.jobs;
    default:
      return null;
  }
}
