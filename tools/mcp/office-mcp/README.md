# fluxology-office-mcp

Evidence-first office-space research MCP server (SDD v2 Part A). Zero runtime dependencies, Node ≥ 22, dual-era MCP (2026-07-28 + legacy `initialize`).

```bash
node bin/office-mcp.mjs          # stdio (primary)
node bin/office-mcp-http.mjs     # optional Streamable HTTP (modern-only, 127.0.0.1:8090)
node bin/approve.mjs             # human approval CLI for website form submissions
npm test                         # release-blocking suite (node --test)
```

## What it enforces (non-negotiable domain rules)

- Only a **confirmed enclosed, closeable private office** qualifies; desks/coworking/virtual products are stored but never surfaced as offices.
- A **per-desk/per-person price never becomes a private-office price** — recording a `sticker_price` without a `price_basis` is refused.
- **24/7 access ≠ 24/7 HVAC**: separate fields, separate scoring; unknown HVAC is penalized and flagged for clarification.
- History (quotes, prices, negotiation events) is **append-only**.
- Coverage counters increment **only for records actually processed** — a refused fetch is a limitation, not coverage.

## Typical session

1. `office_watchlist_upsert` — register managed providers (their hostnames become the fetch allowlist).
2. `office_search_start` (`daily_managed` / `daily_conventional` / `dual` / `provider_deep_dive` / `location_refresh` / `quote_followup`) → `search_run_id`.
3. `office_search_step` repeatedly until `COMPLETE`. Offline (default), fetch work returns as `needs_host_ingest`: fetch those URLs with your own tools and record findings via `office_ingest_observation`.
4. `office_search_results`, `office_score_explain`, `office_audit_coverage`.
5. `office_outreach_prepare` → draft the email yourself (follow `message_constraints`) → `office_outreach_validate` → hand to **fluxology-mail-mcp**.
6. On replies: `office_quote_record`, `office_negotiation_record`, `office_outreach_update`.
7. `office_dashboard_sync` (dry-run by default) → Office Scout v2.5 upsert payload + managed-providers snapshot.

## Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `FLUXOLOGY_OFFICE_DATA_DIR` | `~/.fluxology/office-mcp` | Data root (must be outside this package) |
| `FLUXOLOGY_OFFICE_REGION` | `GTA` | Market label |
| `FLUXOLOGY_OFFICE_BUDGET_CAD` | `850` | Conventional all-in monthly target |
| `FLUXOLOGY_OFFICE_ALLOW_NETWORK` | `0` | `1` enables server-side fetching (allowlist + robots + SSRF guard) |
| `FLUXOLOGY_OFFICE_ALLOWED_HOSTS` | – | Extra fetch-allowlisted hostnames (comma-separated) |
| `FLUXOLOGY_OFFICE_TRUSTED_INTERNAL_HOSTS` | – | Private-network hosts explicitly trusted (v1 §7.4 clause) |
| `FLUXOLOGY_OFFICE_FORM_SUBMIT_ENABLED` | `0` | `1` sends approved forms over the network; otherwise record-and-hold |
| `FLUXOLOGY_DASHBOARD_URL` | – | e.g. `https://office.fluxology.ca` |
| `OFFICE_INGEST_TOKEN` | – | Office-scoped dashboard bearer token (live sync only) |
| `FLUXOLOGY_OFFICE_HTTP_BIND/_PORT/_TOKEN/_ORIGINS` | `127.0.0.1`/`8090`/–/– | HTTP entry |

## Form submissions

`office_form_prepare` → `office_form_request_approval` (freezes exact fields, SHA-256) → human runs `node bin/approve.mjs approve <id> --hash <prefix>` → `office_form_submit` (consumes the approval, at most once). With submission disabled (default) the approved request is persisted for manual execution (`record_and_hold`). Ambiguous outcomes (`OUTCOME_UNKNOWN`) are never retried automatically.
