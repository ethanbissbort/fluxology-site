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
scope exists: a token for one category cannot write another. `tools/list` is
filtered to the scopes the presented token actually holds.

The three write tools are annotated `destructiveHint: true`. That is honest
rather than cautious: `active:false` is the retirement mechanism, and one call
carrying every id can hide an entire dashboard. Hosts use this flag to decide
whether a call needs human confirmation. Every write that changes an existing
record also emits a `write_before_image` log line carrying the prior value of
each changed field (bounded), because `dashboard_data` is the only copy of the
data and the Dashboard API's audit entry records ids and counts but no prior
values.

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
| `rejected` | Validation or authorization failed for that record. Nothing was sent downstream for it. |
| `unknown` | The record was accepted, then the downstream write failed. It may or may not have been persisted. |

The freshness stamp comes from the envelope's `observedAt`, not the wall clock,
so replaying an identical envelope produces a byte-identical record and is
suppressed rather than rewritten.

`ok:true` means the invocation completed and every accepted record was
persisted. Per-record rejections do not flip `ok`; they appear in `rejected`
and `results[].reason`. A call in which *every* record was rejected returns
`ok:false` and `isError:true`.

When `ok:false`, read `persistence` before deciding what to do:

| `persistence` | Meaning |
| --- | --- |
| `persisted` | Every accepted record reached the Dashboard API. |
| `none` | Nothing was sent; the call failed before the downstream write. |
| `unknown` | The downstream call failed *after* the records were accepted. The connector cannot tell a 5xx raised before the store was touched from one raised after, so it says so instead of reporting the pre-write diff. Re-read with `get_dashboard_listing` before retrying. |

Cancelling a call or disconnecting mid-flight is the same situation: the write
is not aborted, so a cancelled upsert may already have landed.

### Nulls, unknown fields and dates

Three rules exist because the dashboards and the schemas disagreed about what
"unknown" means:

- **An unknown number is an absent field, never `null`.** Every frontend
  computes `Number(null) === 0`, which passes `isFinite`, so a null landed cost
  rendered as `$0.00/lb` and won the "best deal" badge. For
  `landedCadPerLb` (deals), `fitScore` and `finalWalkMinutes` (jobs) and
  `estimatedAllInMonthly` (office), an explicit `null` is normalised to an
  absent field with a warning — and is **refused** if the stored record already
  holds a number there, because the Dashboard API merges per id with a shallow
  spread and would silently restore the old value.
- **`mandatoryFeesKnown:true` requires a real all-in figure.** Office Scout
  recomputes its cost badge from `mandatoryFeesKnown` plus a finite
  `estimatedAllInMonthly` and ignores the stored `costStatus`, so the invariant
  is attached to those two facts. `null` and `0` are both refused.
- **Unrecognised fields are never persisted.** A key that differs from a
  canonical property only by case (`landedCadPerlb`) is rejected with a "did you
  mean" message; any other unknown key is dropped with a warning. Additive
  schema evolution still flows through, because the canonical
  `public/*/data/schema.json` files are the source of the known-property set.
- **Record timestamps need an explicit UTC offset.** `endTime` (deals) and
  `postedAt` (jobs) are parsed and normalised to UTC; a timezone-less value is
  refused, because the browser reads it as *local* time and silently moves the
  auction countdown by the viewer's offset.

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
| `OAUTH_ISSUER` | — | Required unless development auth is enabled. Must be https outside development: it is the token trust root. Access tokens must carry `iss`, `aud`, `sub` and `exp`. |
| `OAUTH_AUDIENCE` | `MCP_PUBLIC_URL` | Tokens not bound to this audience are rejected. |
| `OAUTH_JWKS_URI` | discovered | Skips authorization-server metadata discovery. Must share the issuer's origin, discovered or configured. |
| `DASHBOARD_API_URL` | `http://fluxology-dashboard-api:8082` | Container DNS only; never a public dashboard hostname. |
| `MCP_SCHEMA_DIR` | `<service>/schemas` | Falls back to the repository `public/` copies for local development. |
| `MCP_MAX_BODY_BYTES` | `524288` | |
| `MCP_MAX_LISTINGS_PER_WRITE` | `50` | Per invocation. |
| `MCP_MAX_FEED_LISTINGS` | `5000` | Ceiling on the whole stored feed, so a looping client cannot grow it without limit. |
| `MCP_MAX_TOOL_CALLS_PER_REQUEST` | `8` | JSON-RPC batching was dropped from MCP in 2025-06-18; the SDK sends one message per POST. |
| `MCP_READS_PER_MINUTE` | `120` | Per authenticated subject, charged per tool call. |
| `MCP_WRITES_PER_MINUTE` | `30` | Per authenticated subject, charged per tool call. |
| `MCP_MAX_ACTIVE_TOOL_EXECUTIONS` | `20` | One slot per tool call. Excess requests get `503 busy` with `Retry-After`. |
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

The development bearer defaults to **`dashboards:read` only**. It has no
issuer, no audience and no expiry, so writes must be opted into explicitly with
`MCP_DEV_AUTH_SCOPES`.

Startup **fails** if development auth is enabled unless `NODE_ENV` is
`development`, `test` or `local`. The guard fails closed: an unset, misspelled
or unexpected `NODE_ENV` counts as production, and so does the `https`
requirement on `MCP_PUBLIC_URL` and `OAUTH_ISSUER`.

## Endpoints

| Path | Purpose |
| --- | --- |
| `POST /mcp`, `DELETE /mcp` | MCP over Streamable HTTP. Authentication required. `GET` returns `405`: this deployment is stateless, so a standalone SSE stream could never carry anything to anyone. |
| `GET /.well-known/oauth-protected-resource[/mcp]` | RFC 9728 protected resource metadata. |
| `GET /healthz` | Process liveness. |
| `GET /readyz` | Schemas loaded, auth metadata reachable, Dashboard API reachable, no schema drift. An anonymous caller gets the verdict only; the per-check detail needs a bearer token. Container health uses `/healthz`, not this. |

An unauthenticated request gets `401` with a `WWW-Authenticate` challenge
pointing at the metadata document, so a client can discover the authorization
server. A token missing the category scope gets `403 insufficient_scope`.

## Tests

```bash
npm test
```

Six suites: unit, canonical-schema contract, integration against a real
`services/dashboard-api` child process, MCP protocol/security tests driven by
the official SDK client over real HTTP, the category business-rule gate
(`pipeline-rules.test.mjs`), and honest-reporting regressions
(`honest-reporting.test.mjs`).

`pipeline-rules.test.mjs` exists because the older suite proved the category
rules *existed* without proving the pipeline still *called* them: deleting the
step-9 gate outright left every test green. Every case in that file is a record
the canonical Ajv schema accepts and only a business rule rejects, driven
through `runUpsert`, so removing or short-circuiting the gate turns the suite
red.

## Dependencies

`@modelcontextprotocol/sdk`, `ajv`, `ajv-formats` and `jose`, all pinned to
exact versions so MCP protocol support moves only through reviewed releases.
Only the SDK's low-level `Server`, its Streamable HTTP transport and its type
schemas are imported directly. That import is not free: the SDK's
`server/streamableHttp.js` is a thin wrapper over `@hono/node-server`, so Hono
and the zod runtime are loaded transitively. Express is installed as an SDK
runtime dependency but is never loaded.
