# fluxology-mcp

Write-capable Model Context Protocol connector for the Fluxology dashboards.

A narrow, authenticated bridge that lets approved model clients publish curated
records into `office.fluxology.ca`, `deals.fluxology.ca` and `jobs.fluxology.ca`
through the existing self-hosted Dashboard API. It is **not** a second data
store, and it is **not** in the public dashboard read path — if this service is
down, all three dashboards keep serving.

Implements `docs/MCP-CONNECTOR.md` (design: *Fluxology Write-Capable MCP
Connector SDD v1.0*).

```text
model client
     │  MCP tool call
     ▼
https://mcp.fluxology.ca/mcp        ← OAuth 2.1 resource server
     │  validated, authorized, internal HTTP
     ▼
fluxology-dashboard-api:8082        ← the only authoritative persistence layer
     ▼
dashboard_data volume
```

## Tools

| Tool | Required scope | Purpose |
| --- | --- | --- |
| `get_dashboard_summary` | `dashboards:read` | Counters and feed versions for one dashboard. Returns no listing content. |
| `get_dashboard_listing` | `dashboards:read` | One bounded record by stable id, for reconciliation. |
| `upsert_office_listings` | `office:write` | Create/update Office Scout records. |
| `upsert_deal_listings` | `deals:write` | Create/update Deals records. |
| `upsert_job_listings` | `jobs:write` | Create/update Jobs records. |

There is deliberately **no** delete tool, no full-feed replacement, no shell,
no filesystem access, and no tool that takes a URL, path or token. A listing is
retired with an ordinary upsert carrying `active:false`. No `dashboards:write`
scope exists: a token for one category cannot write another.

## Write semantics

Every upsert runs the same pipeline: validate the envelope and `observedAt`,
fetch the live feed, resolve stable ids, merge the partial update onto the
stored record, validate the **merged** record against the canonical JSON Schema,
apply category rules, diff, drop records that need no write, then POST the
remainder with the category's downstream bearer secret.

Each record comes back with one outcome:

| Outcome | Meaning |
| --- | --- |
| `created` | New stable id. |
| `updated` | At least one material field changed. |
| `touched` | Only the freshness stamp moved. |
| `unchanged` | Nothing to persist; suppressed before the downstream call. |
| `rejected` | Validation or authorization failed for that record. |

The freshness stamp comes from the envelope's `observedAt`, not the wall clock,
so replaying an identical envelope produces a byte-identical record and is
suppressed rather than rewritten.

`ok:true` means the invocation completed and every accepted record was
persisted. Per-record rejections do not flip `ok`; they appear in `rejected`
and `results[].reason`. A call in which *every* record was rejected returns
`ok:false` and `isError:true`.

## Fields the connector owns

Callers must not send `firstSeen`, `lastSeen`, `lastVerified`, `lastChanged` or
`priceHistory`. They are absent from the advertised input schemas and stripped
server-side if sent anyway. Price history stays under the Dashboard API's
existing preserve/append logic.

## Configuration

Startup fails loudly on a bad configuration rather than degrading. Every limit
is clamped to a safe upper bound.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8083` | Never published to the host. |
| `MCP_PUBLIC_URL` | `http://127.0.0.1:8083/mcp` | Canonical resource id and default token audience. Must be https in production. |
| `OAUTH_ISSUER` | — | Required unless development auth is enabled. |
| `OAUTH_AUDIENCE` | `MCP_PUBLIC_URL` | Tokens not bound to this audience are rejected. |
| `OAUTH_JWKS_URI` | discovered | Skips authorization-server metadata discovery. |
| `DASHBOARD_API_URL` | `http://fluxology-dashboard-api:8082` | Container DNS only; never a public dashboard hostname. |
| `MCP_SCHEMA_DIR` | `<service>/schemas` | Falls back to the repository `public/` copies for local development. |
| `MCP_MAX_BODY_BYTES` | `524288` | |
| `MCP_MAX_LISTINGS_PER_WRITE` | `50` | |
| `MCP_READS_PER_MINUTE` | `120` | Per authenticated subject. |
| `MCP_WRITES_PER_MINUTE` | `30` | Per authenticated subject. |
| `MCP_MAX_ACTIVE_TOOL_EXECUTIONS` | `20` | Excess requests get 429. |
| `MCP_MAX_CONCURRENT_WRITES_PER_SCOPE` | `1` | Categories still run in parallel with each other. |
| `DASHBOARD_CONNECT_TIMEOUT_MS` | `3000` | |
| `DASHBOARD_REQUEST_TIMEOUT_MS` | `10000` | |
| `MCP_SEND_TOUCH_WRITES` | `true` | Whether a freshness-only change is persisted. |
| `MCP_STAMP_OBSERVED_AT` | `true` | Stamp the category freshness field from `observedAt`. |
| `MCP_ALLOWED_ORIGINS` | *(empty)* | Empty means no browser origin may call the endpoint. |
| `LOG_LEVEL` | `info` | |

### Downstream credentials

The three Dashboard API ingest tokens are read, in order, from
`<SCOPE>_INGEST_TOKEN_FILE`, then `/run/secrets/<scope>_ingest_token`, then
`<SCOPE>_INGEST_TOKEN`. They are held server-side only, selected by tool
dispatch, and never returned to a client. A category whose token is unset has
its writes disabled and logs a startup warning; reads still work.

### Development auth

For local work only:

```bash
MCP_DEV_AUTH_ENABLED=true \
MCP_DEV_AUTH_TOKEN=$(openssl rand -hex 24) \
DASHBOARD_API_URL=http://127.0.0.1:8082 \
npm start
```

Startup **fails** if development auth is enabled while `NODE_ENV=production`.

## Endpoints

| Path | Purpose |
| --- | --- |
| `POST/GET/DELETE /mcp` | MCP over Streamable HTTP. Authentication required. |
| `GET /.well-known/oauth-protected-resource[/mcp]` | RFC 9728 protected resource metadata. |
| `GET /healthz` | Process liveness. |
| `GET /readyz` | Schemas loaded, auth metadata reachable, Dashboard API reachable, no schema drift. |

An unauthenticated request gets `401` with a `WWW-Authenticate` challenge
pointing at the metadata document, so a client can discover the authorization
server. A token missing the category scope gets `403 insufficient_scope`.

## Tests

```bash
npm test
```

Four suites: unit, canonical-schema contract, integration against a real
`services/dashboard-api` child process, and MCP protocol/security tests driven
by the official SDK client over real HTTP.

## Dependencies

`@modelcontextprotocol/sdk`, `ajv`, `ajv-formats` and `jose`, all pinned to
exact versions so MCP protocol support moves only through reviewed releases.
Only the SDK's low-level `Server`, its Streamable HTTP transport and its type
schemas are imported; the transitive Express/Hono helpers the SDK ships are
never loaded.
