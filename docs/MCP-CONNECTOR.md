# MCP Connector (`fluxology-mcp`)

Implementation of *Fluxology Write-Capable MCP Connector — Software Design
Document v1.0*.

The connector is a narrow, authenticated bridge that lets approved model
clients publish curated records into the three Fluxology dashboards through the
existing Dashboard API. It is not a second data store, it does not host the
dashboard frontends, and it is not in the public read path.

- Source: `services/fluxology-mcp/`
- Service README (tools, semantics, full configuration table): `services/fluxology-mcp/README.md`
- Internal port: **8083**, never published to the host
- Public endpoint: `https://mcp.fluxology.ca/mcp`

```text
                         public Internet
                                │
                                ▼
                     existing VPS Caddy container
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
  https://mcp.fluxology.ca/mcp            dashboard subdomains
             │                                     │
             ▼                                     ▼
     fluxology-mcp:8083                   fluxology-apache:6080
             │
             │  internal Docker network (fluxology-edge)
             ▼
   fluxology-dashboard-api:8082
             │
             ▼
       dashboard_data volume
```

An outage of `fluxology-mcp` must never take `office.fluxology.ca`,
`deals.fluxology.ca` or `jobs.fluxology.ca` offline. Nothing in the dashboard
read path depends on it.

## Authorization model

The connector is an OAuth 2.1 **resource server**. It never issues tokens and
contains no token-minting code; a separate, standards-compliant authorization
server does that. The connector:

- serves RFC 9728 protected resource metadata at
  `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-protected-resource/mcp`;
- answers a missing or invalid credential with `401` and a `WWW-Authenticate`
  challenge that points at that metadata document;
- validates issuer, signature, expiry, **audience** and scopes on every request;
- rejects any token not audience-bound to `https://mcp.fluxology.ca/mcp`.

### Scopes

| Scope | Capability |
| --- | --- |
| `dashboards:read` | Feed summary and individual records |
| `office:write` | Upsert Office Scout records |
| `deals:write` | Upsert Deals records |
| `jobs:write` | Upsert Jobs records |

There is no general `dashboards:write` scope. A token holding `office:write`
receives `403 insufficient_scope` from the Deals and Jobs write tools.

### Downstream credentials

The connector holds the three Dashboard API ingest tokens server-side and
selects one **by the invoked tool**, never from anything a caller supplied. The
tokens are never returned to a client and never logged. Preference order:

1. `<SCOPE>_INGEST_TOKEN_FILE`
2. `/run/secrets/<scope>_ingest_token`
3. `<SCOPE>_INGEST_TOKEN`

The Compose service ships with the environment form so the stack deploys with
the same `.env` the Dashboard API already uses. To move to Docker secrets,
create the three files, uncomment the `secrets:` key on the `mcp` service and
the top-level `secrets:` block in `docker-compose.yml`, and remove the three
token environment entries. No code change is required.

## Deployment

### 1. DNS

Create an A/AAAA record for `mcp.fluxology.ca` pointing at the VPS, the same
way the dashboard subdomains are configured. If the authorization server is
self-hosted, give it its own hostname (for example `auth.fluxology.ca`) and its
own proxy block.

### 2. Environment

Add to the VPS `.env` (see `.env.example`):

```bash
MCP_PUBLIC_URL=https://mcp.fluxology.ca/mcp
MCP_OAUTH_ISSUER=https://auth.fluxology.ca
```

The connector reuses `OFFICE_INGEST_TOKEN`, `DEALS_INGEST_TOKEN` and
`JOBS_INGEST_TOKEN`, which are already present for the Dashboard API. It needs
no downstream credentials of its own.

### 3. Caddy site block

Merge into the VPS-wide Caddyfile alongside the blocks in
`docs/CADDY-INTEGRATION.md`:

```caddyfile
# -----------------------------------------------------------------------------
# MCP connector
# -----------------------------------------------------------------------------
mcp.fluxology.ca {
    encode zstd gzip

    request_body {
        max_size 512KB
    }

    # Streamable HTTP may hold a response stream open; do not buffer it.
    reverse_proxy fluxology-mcp:8083 {
        flush_interval -1
    }
}
```

The connector emits no CORS headers and refuses any request carrying an
`Origin` header unless `MCP_ALLOWED_ORIGINS` explicitly lists it, so no browser
can drive it cross-origin.

Then validate and reload:

```bash
docker exec <caddy-container> caddy validate --config /etc/caddy/Caddyfile
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

### 4. Deploy

```bash
git pull --ff-only
docker compose up -d --build mcp
docker compose ps mcp
```

The container must show as healthy. `expose: 8083` with no `ports:` mapping is
deliberate — confirm with `docker compose config | grep -c published` returning
`0`.

### 5. Verify

```bash
# Liveness and readiness, from inside the network.
docker compose exec mcp node -e "fetch('http://127.0.0.1:8083/readyz').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"

# Public discovery and the unauthenticated challenge.
curl -fsS https://mcp.fluxology.ca/.well-known/oauth-protected-resource | jq
curl -isS -X POST https://mcp.fluxology.ca/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -20
```

The second command must return `401` with a `WWW-Authenticate: Bearer …
resource_metadata="…"` header. A `200` there means authentication is not being
enforced — stop and fix it before continuing.

`readyz` returns `503` until schemas are loaded, authorization-server metadata
is reachable, the Dashboard API answers, and all three live feeds report a
compatible schema version.

### 6. Protocol validation

Before wiring any model client, validate with MCP Inspector or another
conforming client against a development instance:

```bash
cd services/fluxology-mcp
npm ci
MCP_DEV_AUTH_ENABLED=true \
MCP_DEV_AUTH_TOKEN=$(openssl rand -hex 24) \
DASHBOARD_API_URL=http://127.0.0.1:8082 \
npm start
```

Development auth is local-only: startup fails outright if it is enabled while
`NODE_ENV=production`.

MCP Inspector runs in a browser and therefore sends an `Origin` header, which
the connector refuses by default. Allow it explicitly on the development
instance only:

```bash
MCP_ALLOWED_ORIGINS=http://localhost:6274
```

Never set `MCP_ALLOWED_ORIGINS` on the production deployment: no browser should
be able to drive the write tools.

## Client app configuration

When the workspace entitlement supports write-capable custom MCP apps:

1. Enable developer mode in the applicable workspace.
2. Create a custom app pointing at `https://mcp.fluxology.ca/mcp`.
3. Complete OAuth authorization.
4. Scan tools — five must appear, and no delete or feed-replacement tool.
5. Review each write action and its permissions.
6. Enable only the required actions.
7. Test interactive reads and writes.
8. Test scheduled-skill execution **separately** — this is its own gate.
9. Publish/approve only after the write and scope tests pass.

Tool definitions may be frozen in a reviewed snapshot, so tool names and
required input fields must stay stable after approval. Prefer additive optional
fields over breaking schema changes.

## Skill integration

Each skill owns exactly one category write tool:

| Skill | Tool | `source` examples |
| --- | --- | --- |
| Office Scout | `upsert_office_listings` | `office-scout-skill` |
| Deals | `upsert_deal_listings` | `bulk-lego-deal-watch`, `bulk-minifigure-watch` |
| Jobs | `upsert_job_listings` | `t176-trades-job-scout` |

Skill logic:

```text
if the Fluxology MCP write tool is available:
    use the direct MCP upsert
else:
    use the existing GitHub feed fallback
```

The fallback must not run after a successful direct write. The GitHub
intermediary in `.github/workflows/sync-dashboard-feeds.yml` stays enabled
until scheduled direct writes are proven.

## Operations

### Logs

One JSON line per invocation, carrying the request id, authenticated subject,
granted scopes, tool name, source label, record and outcome counts, changed
ids, duration and downstream status. Access tokens, ingest tokens,
authorization headers and full listing bodies are never logged; registered
secret values are scrubbed from any string before it is written.

Trace a write end to end:

```bash
docker compose logs mcp | grep '"event":"tool_invocation"' | tail -5
docker compose exec dashboard-api cat /data/audit.jsonl | tail -5
```

The connector sets `X-Fluxology-Source: mcp:<source>` on every downstream
write, so each dashboard audit entry names the skill that caused it.

### Rollback

1. Disable or remove the custom MCP app action.
2. Leave the Dashboard API and dashboard frontends running.
3. Scheduled skills fall back to the GitHub intermediary.
4. Roll back the MCP container image independently:
   `docker compose up -d --no-deps mcp`.

### Backup

The connector is stateless and needs no backup. Keep backing up the Dashboard
API's `dashboard_data` volume, the authorization server's state and keys, and
the edge proxy's TLS/ACME state. Do not back up short-lived access tokens;
downstream ingest tokens must be recoverable from a secure secrets source or
rotated after a restore.

## Decisions recorded during implementation

The SDD left six decisions open (§30). The implementation takes the SDD's
recommended defaults and records the rest here.

| Decision | Choice |
| --- | --- |
| Authorization server | Not selected in code. The connector is issuer-agnostic: set `MCP_OAUTH_ISSUER` to any standards-compliant OAuth 2.1/OIDC server. Metadata is discovered via RFC 8414 then OIDC discovery, or pinned with `MCP_OAUTH_JWKS_URI`. |
| Hostname layout | `mcp.fluxology.ca` for the resource; the authorization server gets its own hostname. |
| Verification timestamps on every check | Yes, by default. `observedAt` is stamped onto the category freshness field and freshness-only writes are persisted (`MCP_SEND_TOUCH_WRITES=true`). Set it to `false` to suppress them. |
| Observation period before retiring the GitHub fallback | Not encoded in code; the fallback is untouched and stays enabled. |
| Explicit idempotency key | Deferred to v1.1, as recommended. `idempotentHint` stays `false`. Replaying an identical envelope is already suppressed, because the freshness stamp comes from `observedAt` rather than the wall clock. |
| Splitting into three services | One service in v1. Category tools, scopes and secrets are already fully separated, so a later split needs no Dashboard API change. |

Two tightenings beyond the SDD, both to keep model input from colliding with
server-owned state:

- `firstSeen`, `lastSeen`, `lastVerified`, `lastChanged` and `priceHistory` are
  absent from the advertised input schemas and stripped server-side. The SDD
  requires this for `priceHistory` (§13.1) and treats the timestamps as
  server-owned audit fields (§14); this makes both mechanical.
- A request carrying an `Origin` header is refused unless the origin is
  explicitly allowlisted.

## Acceptance criteria

Automated coverage lives in `services/fluxology-mcp/test/` and runs with
`npm test` from that directory.

| Criterion | Status |
| --- | --- |
| `https://mcp.fluxology.ca/mcp` negotiates MCP over Streamable HTTP | Covered by protocol tests against the official SDK client; confirm on the VPS after step 5 |
| Unauthenticated access receives a valid OAuth challenge | Automated |
| Audience and scope validation are enforced | Automated |
| Dashboard API bearer tokens never appear in tool output or logs | Automated |
| Office token cannot write Deals or Jobs | Automated |
| Deals token cannot write Office or Jobs | Automated |
| Jobs token cannot write Office or Deals | Automated |
| All three upsert tools validate merged records against canonical schemas | Automated |
| Malformed records are rejected before downstream persistence | Automated |
| Repeated identical write calls do not cause material feed duplication | Automated |
| No tool exposes delete, feed replacement, shell, filesystem or arbitrary HTTP access | Automated |
| Connector publishes no host port | Enforced in `docker-compose.yml`; verify with `docker compose config` |
| Connector outage does not affect dashboard read availability | Architectural; the connector serves no feed route |
| Interactive client write test succeeds | Manual, once the workspace supports write-capable MCP apps |
| Scheduled-run direct-write test succeeds before the GitHub fallback is retired | Manual gate; keep the fallback until it passes |
