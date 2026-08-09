/**
 * Configuration for the Fluxology write-capable MCP connector.
 *
 * Everything tunable is an environment variable with a safe upper bound, per
 * SDD §20. Downstream Dashboard API secrets are loaded server-side only
 * (SDD §9.4) and are never reachable from an MCP tool argument.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPES = Object.freeze(['office', 'deals', 'jobs']);

export const OAUTH_SCOPES = Object.freeze({
  read: 'dashboards:read',
  office: 'office:write',
  deals: 'deals:write',
  jobs: 'jobs:write',
});

export const ALL_OAUTH_SCOPES = Object.freeze([
  OAUTH_SCOPES.read,
  OAUTH_SCOPES.office,
  OAUTH_SCOPES.deals,
  OAUTH_SCOPES.jobs,
]);

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(SRC_DIR, '..');
const REPO_ROOT = path.resolve(SERVICE_DIR, '..', '..');

/** Canonical schema locations inside the repository, used for local development. */
const REPO_SCHEMA_DIR = path.join(REPO_ROOT, 'public');

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function str(env, name, fallback = '') {
  const raw = env[name];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
}

function bool(env, name, fallback = false) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/**
 * Numeric setting clamped into [min, max]. `max` is the safe upper bound the
 * SDD asks for: a typo in the VPS `.env` cannot lift a limit past what the
 * service was designed to survive.
 */
function num(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ConfigError(`${name} must be a number`);
  if (value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max} (got ${value})`);
  }
  return value;
}

/**
 * Read a downstream ingest token. Preference order matches SDD §9.4:
 * an explicit secret file, then the conventional Docker secret mount, then a
 * protected environment value.
 */
function readSecret(env, scope) {
  const upper = scope.toUpperCase();
  const explicitFile = str(env, `${upper}_INGEST_TOKEN_FILE`);
  const defaultFile = `/run/secrets/${scope}_ingest_token`;

  for (const file of [explicitFile, defaultFile]) {
    if (!file) continue;
    try {
      const value = readFileSync(file, 'utf8').trim();
      if (value) return { value, origin: `file:${file}` };
    } catch (err) {
      // A missing conventional mount is normal; an unreadable explicit file is not.
      if (file === explicitFile) throw new ConfigError(`cannot read ${upper}_INGEST_TOKEN_FILE: ${err.code || 'unreadable'}`);
    }
  }

  const inline = str(env, `${upper}_INGEST_TOKEN`);
  if (inline) return { value: inline, origin: 'env' };
  return { value: '', origin: 'unset' };
}

/**
 * Parse a base URL into `{origin, path, href}` with any trailing slash removed.
 *
 * The trailing slash matters: `new URL()` normalises an empty path back to "/",
 * and concatenating that with "/v1/office/feed" yields "//v1/office/feed",
 * which a receiving `new URL()` reads as a *protocol-relative* URL pointing at
 * host "v1". Returning a plain string keeps every join unambiguous.
 */
function normalizeBaseUrl(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL (got ${JSON.stringify(raw)})`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`${name} must use http or https`);
  }
  if (url.search || url.hash) throw new ConfigError(`${name} must not contain a query string or fragment`);
  const path = url.pathname.replace(/\/+$/, '');
  return { origin: url.origin, path, href: `${url.origin}${path}`, protocol: url.protocol };
}

/**
 * Environments where the relaxed local-development rules apply.
 *
 * The production guard used to be `nodeEnv === 'production'`, so `NODE_ENV`
 * unset, `prod`, or `Production` all silently disabled both the https
 * requirement and the development-bearer refusal. Fail closed: anything that is
 * not explicitly a development or test environment is treated as production.
 */
const RELAXED_ENVIRONMENTS = Object.freeze(['development', 'test', 'local']);

export function loadConfig(env = process.env) {
  const nodeEnv = str(env, 'NODE_ENV', 'development');
  const production = !RELAXED_ENVIRONMENTS.includes(nodeEnv.toLowerCase());

  const publicUrlRaw = str(env, 'MCP_PUBLIC_URL', 'http://127.0.0.1:8083/mcp');
  const parsedPublic = normalizeBaseUrl(publicUrlRaw, 'MCP_PUBLIC_URL');
  if (production && parsedPublic.protocol !== 'https:') {
    throw new ConfigError('MCP_PUBLIC_URL must be https in production (SDD §9.1)');
  }
  // The MCP resource always lives at a path, so the canonical identifier and
  // the route the server listens on can never drift apart.
  const mcpPath = parsedPublic.path || '/mcp';
  const publicUrl = { ...parsedPublic, path: mcpPath, href: `${parsedPublic.origin}${mcpPath}` };

  const devAuthEnabled = bool(env, 'MCP_DEV_AUTH_ENABLED', false);
  if (production && devAuthEnabled) {
    // SDD §9.5: production startup SHALL fail if development authentication is enabled.
    throw new ConfigError(
      `MCP_DEV_AUTH_ENABLED must not be set unless NODE_ENV is one of ${RELAXED_ENVIRONMENTS.join('/')} (got ${JSON.stringify(nodeEnv)}) (SDD §9.5)`,
    );
  }

  const devAuthToken = str(env, 'MCP_DEV_AUTH_TOKEN');
  if (devAuthEnabled && devAuthToken.length < 16) {
    throw new ConfigError('MCP_DEV_AUTH_TOKEN must be at least 16 characters when development auth is enabled');
  }
  /**
   * Read-only by default. The development bearer has no issuer, no audience and
   * no expiry; defaulting it to all four scopes made it a full write credential
   * for all three dashboards on every local run. Opt into writes explicitly.
   */
  const devAuthScopes = str(env, 'MCP_DEV_AUTH_SCOPES', OAUTH_SCOPES.read)
    .split(/\s+/)
    .filter(Boolean);
  for (const scope of devAuthScopes) {
    if (!ALL_OAUTH_SCOPES.includes(scope)) throw new ConfigError(`MCP_DEV_AUTH_SCOPES contains unknown scope ${JSON.stringify(scope)}`);
  }

  const oauthIssuer = str(env, 'OAUTH_ISSUER');
  const oauthAudience = str(env, 'OAUTH_AUDIENCE', publicUrl.href);
  const oauthJwksUri = str(env, 'OAUTH_JWKS_URI');

  if (!devAuthEnabled) {
    // Name both spellings: docker-compose.yml maps OAUTH_ISSUER=${MCP_OAUTH_ISSUER},
    // so an operator reading this log sets a variable whose name never appears
    // in it, and dev auth is not an escape hatch here — compose pins
    // NODE_ENV=production, which refuses MCP_DEV_AUTH_ENABLED outright.
    if (!oauthIssuer) {
      throw new ConfigError(
        'OAUTH_ISSUER is required unless development auth is enabled. ' +
          'Under docker compose set MCP_OAUTH_ISSUER in .env (compose passes it through as OAUTH_ISSUER) ' +
          'to the https URL of your authorization server. To deploy the rest of the stack without this ' +
          'connector, run: docker compose up -d --scale mcp=0',
      );
    }
    const issuerUrl = normalizeBaseUrl(oauthIssuer, 'OAUTH_ISSUER');
    // The token trust root decides who may write to all three dashboards. Over
    // cleartext http, any on-path attacker serves their own metadata and JWKS.
    if (production && issuerUrl.protocol !== 'https:') {
      throw new ConfigError('OAUTH_ISSUER must be https outside development (it is the token trust root)');
    }
    if (oauthJwksUri) {
      const jwksUrl = normalizeBaseUrl(oauthJwksUri, 'OAUTH_JWKS_URI');
      if (production && jwksUrl.protocol !== 'https:') {
        throw new ConfigError('OAUTH_JWKS_URI must be https outside development');
      }
      if (jwksUrl.origin !== issuerUrl.origin) {
        throw new ConfigError('OAUTH_JWKS_URI must share the OAUTH_ISSUER origin: signing keys may not live on an unrelated host');
      }
    }
  }

  const secrets = {};
  const secretOrigins = {};
  for (const scope of SCOPES) {
    const { value, origin } = readSecret(env, scope);
    secrets[scope] = value;
    secretOrigins[scope] = origin;
  }

  const config = {
    nodeEnv,
    production,
    serviceName: 'fluxology-mcp',
    serverName: str(env, 'MCP_SERVER_NAME', 'fluxology-dashboard-writer'),
    serverVersion: str(env, 'MCP_SERVER_VERSION', '1.0.0'),
    serverDescription: 'Authenticated write bridge for Fluxology Office, Deals, and Jobs dashboards.',

    host: str(env, 'HOST', '0.0.0.0'),
    port: num(env, 'PORT', 8083, 1, 65535),

    /** Canonical MCP resource identifier (SDD §8.1, §9.1). */
    publicUrl: publicUrl.href,
    /** Origin of the canonical resource, used to build .well-known URLs. */
    publicOrigin: publicUrl.origin,
    mcpPath,

    dashboardApiUrl: normalizeBaseUrl(str(env, 'DASHBOARD_API_URL', 'http://fluxology-dashboard-api:8082'), 'DASHBOARD_API_URL').href,

    schemaDir: str(env, 'MCP_SCHEMA_DIR', path.join(SERVICE_DIR, 'schemas')),
    repoSchemaDir: REPO_SCHEMA_DIR,

    auth: {
      devAuthEnabled,
      devAuthToken,
      devAuthScopes,
      issuer: oauthIssuer,
      audience: oauthAudience,
      jwksUri: oauthJwksUri,
      clockToleranceSeconds: num(env, 'OAUTH_CLOCK_TOLERANCE_SECONDS', 30, 0, 300),
      metadataTtlMs: num(env, 'OAUTH_METADATA_TTL_MS', 3_600_000, 60_000, 86_400_000),
      documentationUrl: str(env, 'MCP_RESOURCE_DOCUMENTATION', ''),
    },

    secrets,
    secretOrigins,

    limits: {
      /** SDD §20: MCP HTTP request body. */
      maxBodyBytes: num(env, 'MCP_MAX_BODY_BYTES', 524_288, 1_024, 4_194_304),
      /** SDD §10.3-10.5: listings per write tool. */
      maxListingsPerWrite: num(env, 'MCP_MAX_LISTINGS_PER_WRITE', 50, 1, 200),
      /**
       * Ceiling on the whole stored feed. Per-call limits bound one invocation
       * but nothing bounded the store, so a looping or badly de-duplicating
       * client could append new ids indefinitely into the only copy of the data.
       */
      maxFeedListings: num(env, 'MCP_MAX_FEED_LISTINGS', 5_000, 10, 200_000),
      /**
       * JSON-RPC `tools/call` elements one HTTP request may carry. MCP dropped
       * batching in 2025-06-18 and the official SDK client sends one message per
       * POST, so anything beyond a handful is a bespoke client.
       */
      maxToolCallsPerRequest: num(env, 'MCP_MAX_TOOL_CALLS_PER_REQUEST', 8, 1, 100),
      readsPerMinute: num(env, 'MCP_READS_PER_MINUTE', 120, 1, 6_000),
      writesPerMinute: num(env, 'MCP_WRITES_PER_MINUTE', 30, 1, 3_000),
      maxSourceChars: num(env, 'MCP_MAX_SOURCE_CHARS', 100, 8, 100),
      maxTextChars: num(env, 'MCP_MAX_TEXT_CHARS', 8_000, 200, 32_000),
      maxArrayItems: num(env, 'MCP_MAX_ARRAY_ITEMS', 100, 1, 1_000),
      maxIdChars: 200,
      maxNameChars: 300,
      maxUrlChars: 2_048,
      /** SDD §20: overall MCP request timeout. */
      requestTimeoutMs: num(env, 'MCP_REQUEST_TIMEOUT_MS', 30_000, 1_000, 120_000),
      /** SDD §18: concurrency envelope. */
      maxActiveToolExecutions: num(env, 'MCP_MAX_ACTIVE_TOOL_EXECUTIONS', 20, 1, 200),
      maxConcurrentWritesPerScope: num(env, 'MCP_MAX_CONCURRENT_WRITES_PER_SCOPE', 1, 1, 8),
      scopeLockTimeoutMs: num(env, 'MCP_SCOPE_LOCK_TIMEOUT_MS', 20_000, 1_000, 60_000),
      /** Largest single record a read tool will return before it is trimmed. */
      maxReadRecordBytes: num(env, 'MCP_MAX_READ_RECORD_BYTES', 65_536, 4_096, 1_048_576),
    },

    downstream: {
      /** SDD §18 recommended defaults. */
      connectTimeoutMs: num(env, 'DASHBOARD_CONNECT_TIMEOUT_MS', 3_000, 250, 30_000),
      requestTimeoutMs: num(env, 'DASHBOARD_REQUEST_TIMEOUT_MS', 10_000, 500, 60_000),
      maxResponseBytes: num(env, 'DASHBOARD_MAX_RESPONSE_BYTES', 8_388_608, 65_536, 67_108_864),
      feedCacheTtlMs: num(env, 'DASHBOARD_FEED_CACHE_TTL_MS', 5_000, 0, 300_000),
    },

    write: {
      /**
       * SDD §30 open decision 3. Default `true`: a direct API write refreshes
       * the category freshness stamp even when no material field moved, which
       * the SDD explicitly permits because it creates no source-control noise.
       */
      sendTouchWrites: bool(env, 'MCP_SEND_TOUCH_WRITES', true),
      /** Stamp the category freshness field from the envelope's observedAt. */
      stampObservedAt: bool(env, 'MCP_STAMP_OBSERVED_AT', true),
      /** Reject observedAt further in the future than this. */
      maxClockSkewMs: num(env, 'MCP_MAX_OBSERVED_SKEW_MS', 300_000, 0, 3_600_000),
      /** Reject observedAt older than this. */
      maxObservedAgeMs: num(env, 'MCP_MAX_OBSERVED_AGE_MS', 604_800_000, 60_000, 2_592_000_000),
    },

    /**
     * Browser origins permitted to reach the MCP endpoint. Empty means "no
     * browser origins": the connector is a server-to-server resource and emits
     * no CORS headers.
     */
    allowedOrigins: str(env, 'MCP_ALLOWED_ORIGINS').split(/[\s,]+/).filter(Boolean),

    /** Expected canonical feed schema versions, used for the drift gate (SDD §12.3). */
    expectedSchemaVersions: {
      office: str(env, 'MCP_OFFICE_SCHEMA_VERSION', '2.5'),
      deals: str(env, 'MCP_DEALS_SCHEMA_VERSION', '3'),
      jobs: str(env, 'MCP_JOBS_SCHEMA_VERSION', '3'),
    },

    logLevel: str(env, 'LOG_LEVEL', 'info'),
  };

  if (config.limits.writesPerMinute > config.limits.readsPerMinute * 10) {
    throw new ConfigError('MCP_WRITES_PER_MINUTE is implausibly high relative to MCP_READS_PER_MINUTE');
  }

  return Object.freeze(config);
}

/** Human-readable, secret-free summary for the startup banner. */
export function describeConfig(config) {
  return {
    nodeEnv: config.nodeEnv,
    resource: config.publicUrl,
    dashboardApiUrl: config.dashboardApiUrl,
    authMode: config.auth.devAuthEnabled ? 'development-bearer' : 'oauth2',
    issuer: config.auth.devAuthEnabled ? null : config.auth.issuer,
    audience: config.auth.audience,
    writeEnabled: Object.fromEntries(SCOPES.map(scope => [scope, Boolean(config.secrets[scope])])),
    secretOrigins: config.secretOrigins,
    limits: config.limits,
  };
}
