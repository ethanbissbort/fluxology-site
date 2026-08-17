# Fluxology Office & Mail MCP — Software Design Document v2.0

| | |
|---|---|
| Document version | 2.0 (supersedes v1.0; changes per [DESIGN-AUDIT-v1.md](./DESIGN-AUDIT-v1.md)) |
| Status | Implementation-ready design — executed by the reference implementation in this directory |
| Legal entity | Fluxology Inc. |
| Primary operator | Single-user / owner-operated workflow |
| Protocol basis | MCP 2026-07-28 (modern) with legacy `initialize` compatibility (2025-11-25 … 2024-11-05); stdio primary, minimal Streamable HTTP optional |
| Deliverables | Two MCP servers: `fluxology-office-mcp` (Part A) and `fluxology-mail-mcp` (Part B), delivered under `fluxology-site/tools/mcp/` (relocated from `public/office-scout/mcp/` on 2026-08-17) |

**Core operating rule (unchanged from v1):**
Research broadly. Preserve evidence. Distinguish product types exactly. Prepare outreach deliberately. Require human authorization for external side effects.

---

## Part 0 — Shared architecture

### 0.1 Executive summary

Two vendor-neutral MCP servers support researching, normalizing, scoring, tracking, and contacting office-space providers for a one-person private office:

- **Fluxology Office MCP** (Part A) — evidence and workflow service for two intentionally separate markets: conventional/non-managed private offices and managed-office providers. It normalizes offers, scores candidates, tracks quotes and negotiations append-only, prepares evidence-backed outreach, brokers website form submissions behind a freeze→approve→submit-once state machine, and syncs to the Fluxology Office Scout dashboard.
- **Fluxology Mail MCP** (Part B) — the only component that renders external email side effects. It freezes exact messages, requires out-of-band human approval per message, sends exactly once through a pluggable transport (default: RFC 5322 `.eml` outbox), and maintains thread state including ingested replies.

The MCP host supplies reasoning and natural-language generation; the servers supply deterministic retrieval, normalization, scoring, state transitions, persistence, and adapters. A managed-office provider is treated as a service vendor, not merely a landlord: network privileges, F&B programs, cleaning, internet, meeting facilities, mail handling, after-hours HVAC, security, contract terms, promotions, and current private-office inventory are first-class data. For conventional offices, usable enclosed square footage is weighted heavily; 24/7 access without 24/7 air conditioning is never treated as genuine around-the-clock operability.

### 0.2 Locked requirements (carried from v1, with v2 additions)

1. Every surfaced workspace must be a fully enclosed, closeable private office. Hot desks, coworking memberships, dedicated desks, open workstations, booths, and pods are non-qualifying products.
2. Never convert a per-desk or per-person price into a private-office price unless the source explicitly establishes the pricing basis.
3. 24/7 building-access rights and 24/7 HVAC availability are separate data fields and separate scoring inputs.
4. Conventional-office scoring strongly rewards usable enclosed square footage and reports all-in monthly cost per usable private square foot.
5. Managed-office scoring gives meaningful weight to F&B programs (coffee, snacks, breakfast, café-style offerings).
6. Outreach and negotiation consider term-prepayment discounts (6/12/18-month upfront) as a standing lever.
7. External email sending is exclusively Fluxology Mail MCP's job; Office MCP prepares evidence-backed context and validates drafts.
8. Website form submissions use a freeze → human approval → submit-once state machine.
9. Every search run produces auditable coverage counts incremented only by actually-processed records.
10. History is append-oriented: prices, quotes, promotions, and negotiation outcomes are never overwritten.
11. **(v2)** Human approval for any external side effect is granted only through a channel unreachable from the MCP tool surface (§0.7).
12. **(v2)** Runtime data lives outside the delivered package; the servers refuse to write inside their own (web-served) directory (§0.8).
13. **(v2)** Zero runtime npm dependencies; both servers run on the Node ≥ 22 standard library alone (§0.5).

### 0.3 Non-goals (carried from v1)

- Office MCP is not an email server, IMAP client, or SMTP client.
- No generic autonomous browser agent with unrestricted side effects.
- Marketing copy is never authoritative over a provider-specific quote or contract.
- No automatic lease signing, quote acceptance, deposits, or payment submission.
- No bypassing CAPTCHA, anti-bot controls, authentication challenges, or access restrictions.
- **(v2)** No credential custody beyond what a configured adapter explicitly requires via environment variables (dashboard ingest token; optional SMTP).

### 0.4 System context

```text
MCP Host / LLM Client
   │ stdio (newline-delimited JSON-RPC; dual-era)
   │ or Streamable HTTP (modern-only, optional)
   ├────────────────► fluxology-office-mcp
   │                    ├─ Search Orchestrator (cooperative steps)
   │                    ├─ Provider Registry / Watchlist
   │                    ├─ HTTP Fetcher (allowlist, robots, SSRF guard) [env-gated]
   │                    ├─ Host-Assisted Ingestion (observations)
   │                    ├─ Evidence / Provenance Store
   │                    ├─ Normalization & Classification
   │                    ├─ Scoring Engines (conventional + managed)
   │                    ├─ Quote & Negotiation Ledger (append-only)
   │                    ├─ Outreach Context Builder / Validator
   │                    ├─ Form Submission Broker (freeze→approve→submit-once)
   │                    ├─ Dashboard Adapters (Office Scout v2.5, managed snapshot)
   │                    └─ Audit / Coverage Service
   │                          │
   │                          ├──► provider & listing websites (only when network enabled)
   │                          └──► Fluxology dashboard API (only when token configured)
   │
   └────────────────► fluxology-mail-mcp
                        ├─ Draft / Freeze / Approval / Send lifecycle
                        ├─ Thread Ledger + Reply Ingestion
                        └─ Transports: outbox (.eml, default) | smtp (env-gated)

Human operator ──► bin/approve.mjs (per server)  ← the ONLY approval channel
```

Why Mail stays separate (unchanged rationale): Office MCP never holds mail credentials or sending capability. It emits an `OutreachPackage` of verified facts, unresolved questions, negotiation targets, and personalization hooks; the host drafts prose; Mail MCP owns freezing, approval, idempotent sending, threading, and audit.

### 0.5 Runtime, dependencies, and repository layout (new in v2)

- **Runtime:** Node.js ≥ 22, ESM (`.mjs`). Matches the host repository (`engines.node >= 22.12`, existing services).
- **Dependencies:** none at runtime. The MCP protocol core, JSON Schema checking (subset), fetching, hashing, `.eml` composition, and persistence use the Node standard library. (Historical rationale: the original delivery directory under `public/` was web-served and copied into the site image. The August 17, 2026 audit moved the packages to `tools/mcp/`, outside the web-served tree, so the zero-dependency constraint is now a simplicity choice rather than a security requirement.)
- **Delivery layout** (all paths relative to `fluxology-site/tools/mcp/`; relocated from `public/office-scout/mcp/` on 2026-08-17):

```text
mcp/
├── README.md                  # quickstart + client configuration
├── docs/
│   ├── DESIGN-AUDIT-v1.md     # audit of v1 (input to this document)
│   └── SDD-v2.md              # this document
├── mcp-core/                  # shared, dependency-free library (not a server)
│   ├── jsonrpc.mjs            # framing, dispatch, dual-era protocol server
│   ├── schema.mjs             # JSON Schema subset validator (inputs)
│   ├── store.mjs              # JSONL ledgers + JSON snapshots, atomic writes
│   ├── ids.mjs                # prefixed ULID-like ids, SHA-256 hashing
│   └── approval.mjs           # out-of-band approval records (shared semantics)
├── office-mcp/
│   ├── package.json           # name fluxology-office-mcp; scripts only
│   ├── README.md
│   ├── bin/office-mcp.mjs     # stdio entry
│   ├── bin/office-mcp-http.mjs# optional Streamable HTTP entry (modern-only)
│   ├── bin/approve.mjs        # human approval CLI (forms)
│   ├── src/…                  # per §A
│   └── test/…                 # node:test
└── mail-mcp/
    ├── package.json           # name fluxology-mail-mcp; scripts only
    ├── README.md
    ├── bin/mail-mcp.mjs       # stdio entry
    ├── bin/approve.mjs        # human approval CLI (messages)
    ├── src/…                  # per §B
    └── test/…                 # node:test
```

`mcp-core` is imported by relative path; the `mcp/` directory is the delivery unit.

### 0.6 MCP protocol implementation (dual-era)

Both servers implement the **dual-era server** pattern from the 2026-07-28 specification:

**Modern era** (request carries `_meta["io.modelcontextprotocol/protocolVersion"]`):
- `server/discover` implemented (MUST): returns `resultType`, `supportedVersions`, `capabilities`, `instructions`, `ttlMs`, `cacheScope`, and `_meta["io.modelcontextprotocol/serverInfo"]`. Always answers, regardless of requested version (it is the discovery mechanism).
- Any other modern request with an unsupported version → `UnsupportedProtocolVersionError` (code −32022, `data.supported`/`data.requested`).
- All results carry `resultType: "complete"` and serverInfo `_meta`. List results (`tools/list`, `resources/list`, `resources/templates/list`, `resources/read`) carry `ttlMs` and `cacheScope`.
- `ping` is not a modern method → −32601. Resource-not-found → −32602.
- No server-initiated requests; no sessions; deterministic `tools/list` ordering.

**Legacy era** (process receives `initialize`):
- Handshake honored for `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`; unsupported requested versions are answered with the newest legacy version. `notifications/initialized` accepted; `ping` answered; classic result shapes (no `resultType`).
- Era selection is per-process (stdio): `initialize` switches the process to legacy semantics; modern `_meta` requests are served statelessly. Requests with neither (era-ambiguous) are served leniently with legacy shapes.

**Common:** stdio framing is one JSON-RPC message per line, UTF-8, no embedded newlines; all logging goes to stderr; the server exits on stdin EOF. `notifications/cancelled` is accepted and safely ignored (all tool work is synchronous and bounded). JSON-RPC batch arrays are rejected (−32600). Tool-level failures use `isError: true` results with a machine-readable `code` in `structuredContent` (taxonomy §A9); protocol errors are reserved for malformed requests and unknown tools/methods (−32602 / −32601).

**Streamable HTTP (office-mcp optional):** single `POST /mcp` endpoint, modern-only. Validates `Origin` (loopback origins and configured extras), requires `MCP-Protocol-Version` and `Mcp-Method` headers matching the body (`Mcp-Name` for `tools/call`), answers JSON (a JSON response is a compliant response mode; no SSE streaming, which 2026-07-28 no longer requires for resumability). Binds `127.0.0.1` by default; optional static bearer token via env. `initialize` over HTTP receives the spec-recommended error naming the supported versions. The MCP Tasks extension is not implemented; long work uses the cooperative step model (§A6). MRTR is not required for correctness; approval flows use §0.7.

### 0.7 Human-approval channel (new in v2; closes audit A3)

External side effects (form submission in Office MCP; sending in Mail MCP) require an **approval record** that only the human operator can create:

1. A tool freezes exact content and computes `content_hash = sha256(canonical_json)`.
2. `*_request_approval` moves the record to `AWAITING_APPROVAL` and returns the exact frozen content plus the command the human must run.
3. The human runs `node bin/approve.mjs approve <id> --hash <first-12-of-hash>` (or `reject`). The CLI re-displays the frozen content, verifies the hash prefix, and writes an approval record `{subject_id, content_hash, decision, approved_at, approver: "local-cli"}` to the data root.
4. The side-effect tool (`office_form_submit` / `mail_send`) verifies: record exists, decision is `approve`, hash matches the *current* frozen content, and the record is unconsumed. It consumes the record atomically before executing the side effect (submit-once).
5. Any edit after freezing invalidates approval by construction (the hash changes).

No MCP tool can create or consume approval records except the side-effect tool's consume step. MCP elicitation/MRTR may later front-end this flow but must terminate in the same record store.

### 0.8 Configuration and data locations (new in v2; closes audits A10/A11)

All operational parameters are environment variables with safe defaults. Neither server ever writes inside its package directory; both **refuse to start** if the resolved data root is inside the package (the package ships inside a web-served `public/` tree).

| Variable | Default | Meaning |
|---|---|---|
| `FLUXOLOGY_OFFICE_DATA_DIR` | `~/.fluxology/office-mcp` | Office MCP data root |
| `FLUXOLOGY_OFFICE_REGION` | `GTA` | Market/region label used by search profiles |
| `FLUXOLOGY_OFFICE_BUDGET_CAD` | `850` | Conventional all-in monthly target (also feeds `hardAllInCeilingCad`) |
| `FLUXOLOGY_OFFICE_ALLOW_NETWORK` | `0` | `1` enables the server-side fetcher; default is offline/host-assisted mode |
| `FLUXOLOGY_OFFICE_ALLOWED_HOSTS` | *(empty)* | Extra allowlisted hostnames for fetching (comma-separated; watchlist hosts are allowed automatically) |
| `FLUXOLOGY_OFFICE_FORM_SUBMIT_ENABLED` | `0` | `1` enables real network form submission; otherwise approved submissions are executed in record-and-hold mode |
| `FLUXOLOGY_DASHBOARD_URL` | *(empty)* | Office dashboard base URL (e.g. `https://office.fluxology.ca`) |
| `OFFICE_INGEST_TOKEN` | *(empty)* | Office-scoped dashboard bearer token; live sync requires it (name matches repo convention) |
| `FLUXOLOGY_OFFICE_HTTP_BIND` / `_PORT` / `_TOKEN` / `_ORIGINS` | `127.0.0.1` / `8090` / *(empty)* / *(loopback)* | Optional HTTP entry |
| `FLUXOLOGY_MAIL_DATA_DIR` | `~/.fluxology/mail-mcp` | Mail MCP data root |
| `FLUXOLOGY_MAIL_FROM` | *(required to send)* | RFC 5322 From (e.g. `Ethan Bissbort <ethan@fluxology.ca>`) |
| `FLUXOLOGY_MAIL_TRANSPORT` | `outbox` | `outbox` writes `.eml` to `<data>/outbox/`; `smtp` uses env-configured SMTP |
| `FLUXOLOGY_MAIL_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_SECURE` | *(empty)* | SMTP settings; only read when transport is `smtp` |
| `FLUXOLOGY_MAIL_INBOX_DIR` | `<data>/inbox` | Directory scanned by `mail_ingest_scan` for reply `.eml` files |

Scoring weight tables, F&B rubric, area tiers, and the access/HVAC matrix are configuration constants in one module (`src/domain/config-defaults.mjs`) holding the v1 values; they are data, not code.

### 0.9 Security model (carried from v1 §15, concretized)

- **Web content is hostile input.** Fetched or host-supplied page content is data, never instructions; it cannot alter hosts, scopes, approval state, or configuration. Stored excerpts are tag-stripped, whitespace-collapsed, and length-capped (2,000 chars). Raw HTML is retained only as hash-addressed evidence files.
- **Fetcher policy** (when network is enabled): hostname allowlist (watchlist + configured extras); deny non-HTTP(S) schemes; resolve and deny private/loopback/link-local/metadata addresses per hop, re-validating on every redirect (max 5); honor robots.txt by default (refusals counted in `limitations`); per-host min-interval rate limiting with jitter; response caps (2 MiB, 20 s); descriptive User-Agent. CAPTCHA/anti-bot walls yield `BROWSER_INTERVENTION_REQUIRED` with the URL — never bypass.
- **Secrets:** only via environment variables; never returned by any tool, never logged, never stored in evidence or config snapshots (`office_health` reports booleans like `dashboard_token_present`).
- **Logs:** IDs, hashes, URLs, timestamps, outcomes — not message bodies or contact details.
- **Side-effect boundary:** read-only research runs unattended; the only external side effects are `office_form_submit`, `office_dashboard_sync` (live mode), and `mail_send`, each gated as specified (§0.7, §A12, §B5).
- **Authorization scopes** (HTTP profile): `office:read`, `office:search`, `office:write`, `office:form_submit`, `office:dashboard_write` map onto tool groups; the shipped HTTP entry gates all-or-nothing with a static token and documents the scope split for an OAuth deployment. Tool annotations are metadata, never authorization; enforcement is server-side.

---

## Part A — Fluxology Office MCP

### A1. Product taxonomy and qualification (carried from v1 §2)

| Field | Allowed values | Rule |
|---|---|---|
| `product_kind` | `PRIVATE_OFFICE`, `TEAM_SUITE`, `DEDICATED_DESK`, `HOT_DESK`, `COWORKING_MEMBERSHIP`, `VIRTUAL_OFFICE`, `MEETING_ROOM`, `UNKNOWN` | Only `PRIVATE_OFFICE` qualifies. `TEAM_SUITE` may be stored; surfaced only if fully enclosed and economically exceptional. |
| `enclosure_status` | `CONFIRMED`, `PROBABLE`, `UNKNOWN`, `OPEN_PLAN` | `PRIVATE_OFFICE` requires `CONFIRMED` before final recommendation; `PROBABLE`/`UNKNOWN` stays in the clarification queue. |
| `door_status` | `CLOSEABLE_LOCKABLE`, `CLOSEABLE_UNKNOWN_LOCK`, `NO_DOOR`, `UNKNOWN` | Lockable strongly preferred; closeable door is the minimum qualification. |
| `price_basis` | `PER_OFFICE`, `PER_PERSON`, `PER_DESK`, `STARTING_FROM`, `QUOTE_ONLY`, `UNKNOWN` | Never normalize `PER_PERSON`/`PER_DESK` into `PER_OFFICE` without explicit evidence. |
| `access_basis` | `24_7`, `EXTENDED`, `BUSINESS_HOURS`, `UNKNOWN` | Stored independently of HVAC. |
| `hvac_basis` | `24_7_INCLUDED`, `24_7_EXTRA_FEE`, `BUSINESS_HOURS_ONLY`, `ON_REQUEST`, `UNKNOWN` | Unknown HVAC materially lowers confidence and score. |

```text
qualifies_private_office =
      product_kind == PRIVATE_OFFICE
  and enclosure_status == CONFIRMED
  and door_status in {CLOSEABLE_LOCKABLE, CLOSEABLE_UNKNOWN_LOCK}

if price_basis in {PER_PERSON, PER_DESK}:
    private_office_price = UNKNOWN   # never scored as a private-office price
```

### A2. Data model (carried from v1 §6; provenance-aware)

Entities and key fields (every recommendation-relevant field carries `SourceObservation` references):

- **Provider** — `provider_id`, legal/display names, brands, watch status, priority, regional footprint, network-access policy, fee profile, contract profile, provider-level F&B, contacts, observations.
- **Location** — `location_id`, `provider_id`, canonical address, coordinates, transit notes, skateboard practicality, access/security, location-level F&B, meeting facilities, mail handling, HVAC policy, observations.
- **OfficeOffer** — `offer_id`, `location_id`, `product_kind`, `enclosure_status`, `door_status`, capacity, `usable_private_sqft`, `price_basis`, sticker price, mandatory fees, promotion, term, availability date, source URL, observations.
- **ConventionalListing** — `listing_id`, address/unit, `usable_private_sqft`, rent, HST/TMI/utilities/internet/cleaning statuses, access, HVAC, lock, furnishings, term, mail/signage, source URL, canonical validation status, observations. Field names align with Office Scout v2.5 where they overlap.
- **AmenityProfile** — coffee, espresso, tea, water, cold beverages, snacks, breakfast, alcohol-if-relevant, service hours, replenishment, included/paid, confidence.
- **Quote** — `quote_id`, provider/location/offer refs, quoted price + basis, recurring fees, one-time fees, free months, credits, prepay options (§A8), term, renewal/escalation, expiration, salesperson, source ref. Append-only.
- **Contact** — provider/location refs, name, role, email, phone, public contact page, provenance.
- **OutreachPackage** — §A10.
- **FormSubmission** — §A11.
- **SearchRun** — profile, params, timestamps, work queue, exact counters, limitations, status.
- **SourceObservation** — `observation_id`, URL/message ref, `fetched_at`, `content_hash` (SHA-256), source type, `extraction_method` (`server_fetch` | `host_reported` | `manual`), extracted field/value pairs, confidence.
- **NegotiationEvent** — timestamp, actor, channel, offer change, concession, user response, next action. Append-only.

**Evidence precedence** (v1 §6.1, unchanged): signed proposal/contract > direct provider email > location-specific first-party page > provider-level first-party page > third-party listing with exact unit > search snippet (discovery-only). Specificity, authority, date, and explicit time-bounds decide; newer generic marketing never outranks an older still-valid location-specific quote. Within the same URL and specificity, `server_fetch` outranks `host_reported`.

**Persistence:** append-only JSONL event ledgers per entity family plus derived JSON snapshots, written atomically (`store.mjs`); repository interfaces (`ProviderRepository`, …, `AuditRepository`) isolate domain code from storage. SQL engines remain alternate implementations.

### A3. Configuration defaults (v1 constants as data)

Conventional weights (sum 100): space 24, access+HVAC 20, all-in economics 18, room security/quality 10, contract+prepay flexibility 10, transit+skateboard 8, internet/utilities 5, mail/logistics 3, basic amenities 2.
Area tiers (of 24): <80 → 2; 80–119 → 5; 120–159 → 9; 160–219 → 13; 220–299 → 17; 300–399 → 21; 400+ → 24; usability multiplier 0.85–1.00 with recorded reason.
Access/HVAC matrix (of 20): (24_7, 24_7_INCLUDED) 20; (24_7, 24_7_EXTRA_FEE) 16 (fee added to all-in when known); (24_7, UNKNOWN) 10 + clarification flag; (24_7, BUSINESS_HOURS_ONLY) 5; (BUSINESS_HOURS, \*) 0; EXTENDED interpolates at 12/9/6/3/0.
Managed weights (sum 100): all-in economics 22, private-office quality 16, access & operational certainty 13, F&B 12, network privileges 10, internet & technology 8, meeting/collaboration 6, mail/logistics 5, location/access 5, contract flexibility 3.
F&B rubric (of 12): 0 none · 2 basic station · 4 good coffee/tea + cold · 7 espresso-quality + snacks · 10 café program + breakfast/daily value · 12 excellent high-use program. Store both the preference score and a conservative monthly avoided-spend estimate; a high score never subtracts full retail value.

### A4. Pricing models (v1 §9.2 + §8, formalized)

```text
# Conventional
all_in_monthly        = rent + mandatory_recurring_fees      # unknown fees keep the listing unverified
cost_per_private_sqft = all_in_monthly / usable_private_sqft

# Managed four-price model
sticker_price                      # basis preserved
contracted_cash_price   = sticker + all mandatory recurring charges
first_year_effective    = (recurring_cash_12m + mandatory_one_time_fees
                           − free_month_value − guaranteed_credits
                           − prepayment_discount_value) / 12
fluxology_effective     = first_year_effective − actual_avoided_costs
                          − conservative_option_value
```

`recurring_cash_12m` is the contracted cash price × 12; free months enter as `free_month_value`, never by shrinking the divisor. Free months, waived fees, and prepayment discounts are never double-counted (test-pinned).

### A5. MCP tool surface (closes audit A4/A7 — complete and closed)

All names snake_case. Annotations: **R** `readOnlyHint`, **W** local persistent write, **X** external side effect (`openWorldHint`), **D** `destructiveHint:false` for all (nothing destroys history).

| Tool | Class | Purpose |
|---|---|---|
| `office_health` | R | Server, data-root, adapter, network/dashboard readiness (booleans only; no secrets). |
| `office_watchlist_list` | R | Managed-provider and source watchlists. |
| `office_watchlist_upsert` | W | Add/update provider, brand, hosts, priority, market status. |
| `office_search_start` | W | Create a search run (`profile` ∈ `daily_managed`, `daily_conventional`, `dual`, `provider_deep_dive`, `location_refresh`, `quote_followup`) → `search_run_id` + initial work queue. |
| `office_search_step` | W(+X if network enabled) | Execute a bounded batch of queued work; returns exact progress and any items needing host assistance or manual intervention. |
| `office_search_status` | R | Run status + exact coverage counters. |
| `office_search_results` | R | Normalized candidates + evidence refs (paginated, filterable, deterministic order). |
| `office_ingest_observation` | W | Host-assisted evidence: URL + content/excerpt + extracted field claims + confidence; server enforces taxonomy, price-basis, and provenance rules. |
| `office_listing_record` | W | Record/update a conventional listing from evidence (qualification enforced; history preserved). |
| `office_provider_get` / `office_location_get` / `office_offer_get` / `office_listing_get` | R | Entity reads with provenance and history. |
| `office_score_explain` | R | Component scores, effective-cost math, missing-data penalties, clarification list. |
| `office_quote_record` | W | Append a quote (fees, concessions, prepay options, expiration, source). |
| `office_negotiation_record` | W | Append a `NegotiationEvent`. |
| `office_outreach_prepare` | W | Build an `OutreachPackage` (no sending). |
| `office_outreach_validate` | R | Validate a drafted email against evidence + negotiation state (§A10). |
| `office_outreach_get` | R | Read a package including validation history. |
| `office_outreach_update` | W | Package status transitions (`PREPARED → SENT_TO_MAIL → AWAITING_REPLY → …`) and fact/question refresh. |
| `office_form_prepare` | W | Discover/normalize a website inquiry form into a draft payload. |
| `office_form_request_approval` | W | Freeze exact fields (hash) and emit the human approval instruction. |
| `office_form_submit` | X | Submit an approved frozen form exactly once (record-and-hold unless submission enabled). |
| `office_form_status` | R | Submission state machine status. |
| `office_dashboard_sync` | X | Build Office Scout v2.5 upsert payload + managed snapshot; `dry_run` default true; live push requires token. |
| `office_audit_coverage` | R | Exact audited counters and limitations for one run. |

**Resources** (stable read models; tools remain the action interface):
`office://providers/{id}`, `office://locations/{id}`, `office://offers/{id}`, `office://listings/{id}`, `office://quotes/{id}`, `office://search-runs/{id}`, `office://search-runs/{id}/coverage`, `office://outreach/{id}`, `office://form-submissions/{id}`.

### A6. Search orchestration — cooperative step model (closes audit A6)

A search run is an explicit, persisted state machine:

```text
office_search_start(profile, params)
   → creates SearchRun{status: RUNNING, queue: [WorkItem…], counters: 0…}

office_search_step(search_run_id, max_items ≤ 25)
   → pops up to max_items work items and processes each synchronously:
        enumerate_watchlist   → provider work items          (counters: discovered)
        fetch_page            → fetcher (if network) else → needs_host_ingest
        parse_evidence        → observations + normalization (inspected/validated)
        evaluate_candidate    → qualification + scoring      (detailed/surfaced/excluded)
   → returns {processed, remaining, needs_host: […], needs_manual: […], counters}

run completes when queue is empty → status: COMPLETE (or FAILED with reason)
```

- Counters increment **only** when a record is actually processed (locked req. 9); invariants enforced and tested: `inspected ≤ discovered`, `validated ≤ attempted`, `surfaced ≤ detailed`, all monotonic.
- `needs_host_ingest` items name the exact URL and wanted fields; the host may fetch with its own tools and call `office_ingest_observation`, which requeues dependent evaluation work.
- Runs survive restarts (queue and counters are persisted); a step is idempotent per work item (items are consumed atomically).
- Fetch strategy per v1 §7.2 (HTML/JSON first; JSON-LD/canonical/text extraction; canonicalize + dedupe before scoring; every contributing page gets a `SourceObservation` with content hash). Browser automation from v1 §7.4 is out of scope for the reference implementation; interactive-only pages surface as `needs_manual` with `BROWSER_INTERVENTION_REQUIRED`, and the provider-adapter port (`src/search/adapters.mjs`) keeps the extension point.

### A7. Scoring engines

Pure functions over normalized entities + config tables (§A3): `scoreConventional(listing) → {total, components[], penalties[], clarifications[]}`, `scoreManaged(provider, location, offer, quote?) → {total, components[], four_price, clarifications[]}`. Eligibility precedes scoring; non-qualifying products are never scored as private offices. `office_score_explain` returns the full decomposition — the same object the dashboard sync embeds.

### A8. Negotiation and prepayment (v1 §10, unchanged)

Prepayment is a standing lever, normally raised after the baseline package is established; it may enter the first contact only when short and the provider already advertises term incentives. Prepay options carry: `prepay_term_months` (6/12/18/provider-defined), `prepay_total_cash`, `nominal_discount`, `effective_monthly_savings`, `refundability`, `transferability`, `renewal_effect`, `risk_note`. Normalization into `first_year_effective` is test-pinned, including the no-double-count rule.

### A9. Failure taxonomy (v1 §17, kept; wire format fixed)

`SOURCE_FETCH_FAILED`, `CANONICAL_MISMATCH`, `PRODUCT_TYPE_AMBIGUOUS`, `PRICE_BASIS_AMBIGUOUS`, `HVAC_UNKNOWN`, `BROWSER_INTERVENTION_REQUIRED`, `FORM_APPROVAL_REQUIRED`, `FORM_OUTCOME_UNKNOWN`, `DASHBOARD_CONFLICT`, `RATE_LIMITED`, plus v2: `NOT_FOUND`, `VALIDATION_FAILED`, `NETWORK_DISABLED`, `HOST_NOT_ALLOWED`, `ROBOTS_DISALLOWED`, `APPROVAL_MISSING`, `APPROVAL_STALE`, `DATA_DIR_UNSAFE`. Behaviors as in v1 (record-and-continue for fetch failures; ambiguity never upgraded; unknown outcomes never auto-resubmitted). Tool failures return `isError: true` with `structuredContent.error = {code, message, data?}`.

### A10. Outreach design (v1 §11, kept; tools per §A5)

`OutreachPackage{outreach_id, target_provider, target_location_ids[], contact_channels[], confirmed_private_office_requirement: true, confirmed_facts[], unresolved_questions[], personalization_hooks[], negotiation_targets[], budget_language, prepayment_strategy, source_evidence_refs[], recommended_next_action, message_constraints[], status}` — where `message_constraints` carries v1 §11.2's human-sounding drafting guidance (reference something specific; plain first-person business language; "fully enclosed/closeable private office" early; 24/7 access and 24/7 cooling as two separate questions; budget as package-dependent target, never an announced ceiling; few questions per email; prepayment casual and explicit when raised).

`office_outreach_validate(draft)` checks: every factual claim resolves to evidence (unsupported claims listed); product-type language cannot invite desk quotes; the critical questions for the current negotiation state are present (price+basis, private-office confirmation, 24/7 + HVAC as two questions on first contact); budget phrasing rule; negotiation-state consistency (e.g., no prepay opener when strategy says establish baseline first). Returns pass/warn/fail per rule; failing drafts are returned to the host with reasons, not sent anywhere.

**Handoff:** host calls `office_outreach_prepare` → drafts prose → `office_outreach_validate` → passes the validated draft to Mail MCP (`mail_prepare_message`) → Mail MCP freezes/approves/sends (Part B) → on reply, host calls `mail_ingest_*`, then `office_quote_record` / `office_negotiation_record` / `office_outreach_update`.

### A11. Website form workflow (v1 §12 + §0.7)

```text
DISCOVERED → PREPARED → FROZEN → AWAITING_APPROVAL → APPROVED → SUBMITTING → SUBMITTED
                                            │             └→ FAILED / OUTCOME_UNKNOWN
any field edit after FROZEN → PREPARED (approval invalid by hash construction)
```

Canonicalized fields; SHA-256 content hash; hash recomputed immediately before submission; idempotency record keyed by (endpoint, hash, key) with atomic consume so parallel submits produce at most one external submission; `OUTCOME_UNKNOWN` never auto-resubmits; confirmation text/metadata persisted. With `FLUXOLOGY_OFFICE_FORM_SUBMIT_ENABLED=0` (default) an approved submit executes in **record-and-hold** mode: the exact HTTP request that would have been sent is persisted for manual execution, and the state machine completes as `SUBMITTED (held)` — the full workflow is exercisable without external effect.

### A12. Dashboard integration (closes audit A5)

`DashboardAdapter` port with two shipped implementations:

1. **OfficeScoutV25Adapter** — maps qualified `ConventionalListing`s to Office Scout feed v2.5 listing objects (`id`, `operator`, `address`, `municipality`, `askingRent`, `estimatedAllInMonthly`, `costStatus`, `mandatoryFeesKnown`, per-fee statuses, `size`, `lockableDoor`, `access24h`, `skateboardPractical`, …). Invariants enforced: partial upsert by stable `id` only; never emit `null` for an unknown numeric (omit the field); `costStatus: "verified"` only when `mandatoryFeesKnown` and all-in ≤ ceiling; retire with `active:false`; never touch server-owned fields (`priceHistory`, `firstSeen`, `lastSeen`, `lastVerified`, `lastChanged` are not emitted); never full-feed `PUT`. Pushes via `POST {FLUXOLOGY_DASHBOARD_URL}/api/upsert` with the office token.
2. **ManagedSnapshotAdapter** — renders the provider watchlist + latest research into the `managed-providers.json` document shape (same `scoreModel` weights), written to a build path for review-and-commit; it never destructively rewrites: previous snapshot content is diffed and quote/price history is carried forward.

`office_dashboard_sync{dry_run=true}` returns payloads + diff; `dry_run=false` requires the token (v2.5 push) and returns per-record acceptance. History preservation is the adapter's problem to respect and the dashboard's to enforce — both sides are append-oriented.

### A13. Coverage audit (v1 §14, unchanged counters)

`search_results_discovered`, `search_results_inspected`, `canonical_pages_attempted`, `canonical_pages_validated`, `provider_pages_inspected`, `location_pages_inspected`, `offer_or_inventory_pages_inspected`, `candidates_detailed`, `candidates_surfaced`, `outreach_queue_count`, `hard_exclusions{by_reason}`, `limitations[]` (rate limits, caps, pagination failure, robots restriction, rendering failure, CAPTCHA, timeout, network_disabled). First-class data; incremented only from processed records; invariants tested.

---

## Part B — Fluxology Mail MCP (new in v2; closes audit A1)

### B1. Purpose and boundary

Mail MCP is the sole email side-effect surface. It renders drafts into exact RFC 5322 messages, freezes them, requires per-message human approval (§0.7), sends exactly once via a pluggable transport, records `Message-ID` and thread state, and ingests replies so Office MCP can normalize quotes. It holds no research logic and trusts no factual claims — Office MCP validates content; Mail MCP validates process.

### B2. Data model

- **Message** — `message_id`, direction (`outbound`/`inbound`), `thread_id`, from/to/cc, subject, body (text/plain; optional text/html), headers, `outreach_ref` (opaque Office MCP reference), lifecycle state, `content_hash` (frozen), `rfc_message_id` (post-send), transport receipt, timestamps. Append-only versions: editing a frozen draft creates a new revision with a new hash.
- **Thread** — `thread_id`, participants, subject root, ordered message refs, `In-Reply-To`/`References` chain, status (`active`/`closed`).
- **Approval** — per §0.7 (subject = message revision hash). Single-use.
- **TransportReceipt** — transport kind, target (path or server), outcome, evidence (accepted response / file path), timestamp.

### B3. Message lifecycle

```text
DRAFT → FROZEN → AWAITING_APPROVAL → APPROVED → SENDING → SENT
  │        │            │               │          └→ SEND_FAILED (re-approval NOT required if hash unchanged and unconsumed;
  │        │            │               │              consumed approvals are spent — a retry needs re-approval)
  │        │            └→ REJECTED     └→ (hash mismatch) → FROZEN (approval void)
  └→ CANCELLED (any pre-SENDING state)
Ambiguous transport outcome → OUTCOME_UNKNOWN: never auto-resend; surface for human check.
```

Freezing canonicalizes the exact wire content (headers considered part of the message: From, To, Cc, Subject, In-Reply-To, References, body) and hashes it. `mail_send` consumes the approval atomically before transport execution (send-at-most-once even under parallel calls).

### B4. Tool surface

| Tool | Class | Purpose |
|---|---|---|
| `mail_health` | R | Transport/config readiness (booleans; no secrets), data-root safety. |
| `mail_prepare_message` | W | Create a draft (to/cc/subject/body, optional `outreach_ref`, optional `thread_id`). |
| `mail_prepare_reply` | W | Draft into an existing thread; sets `In-Reply-To`/`References` from the thread. |
| `mail_update_draft` | W | Edit an unfrozen draft (frozen drafts revert to DRAFT via explicit `mail_unfreeze`). |
| `mail_freeze` | W | Canonicalize + hash; returns exact frozen content. |
| `mail_unfreeze` | W | Back to DRAFT (voids any approval by construction). |
| `mail_request_approval` | W | AWAITING_APPROVAL; returns frozen content + the human CLI instruction. |
| `mail_approval_status` | R | Approval state for a message revision. |
| `mail_send` | X | Verify + consume approval, send exactly once via configured transport, record receipt + `rfc_message_id`. |
| `mail_cancel` | W | Cancel a pre-SENDING message. |
| `mail_message_get` / `mail_thread_get` / `mail_thread_list` | R | Reads with full lifecycle history. |
| `mail_outbox_list` | R | Messages by state (e.g., all AWAITING_APPROVAL). |
| `mail_ingest_scan` | W | Scan the inbox dir for `.eml` files; parse and attach to threads (provenance `EML_FILE`). |
| `mail_ingest_paste` | W | Ingest a pasted raw reply (provenance `PASTED_TEXT`, lower evidentiary rank). |

**Resources:** `mail://messages/{id}`, `mail://threads/{id}`, `mail://outbox`.

### B5. Transports

- **`outbox` (default)** — renders the approved message to `<data>/outbox/<message_id>.eml` (RFC 5322, UTF-8, proper header folding and body encoding) and marks SENT with a file receipt. The operator sends it with any mail client; zero credentials, zero network. This is the reference implementation's production-default posture.
- **`smtp` (env-gated)** — minimal SMTP client (Node `net`/`tls`; implicit TLS or STARTTLS; AUTH PLAIN/LOGIN) used only when `FLUXOLOGY_MAIL_TRANSPORT=smtp` and the `FLUXOLOGY_MAIL_SMTP_*` variables are set. Failures surface as `SEND_FAILED` with the server reply; ambiguous outcomes (connection lost after DATA accepted-unclear) → `OUTCOME_UNKNOWN`, never auto-resend.
- Transport is an interface (`src/transports/`); Graph/API transports are extension points.

### B6. Threading

Outbound messages generate `Message-ID` (`<ulid@fluxology.ca>` from the From domain). Replies ingested via `.eml` are matched to threads by `In-Reply-To`/`References`, else by normalized subject + participants (flagged `thread_match: "heuristic"`). All inbound content is untrusted data; bodies are stored verbatim as evidence with sanitized excerpts for display, and nothing in them alters server behavior.

### B7. IMAP rescope (explicit v1 deviation)

v1 assumed "IMAP thread readback." v1's own principles (credential minimization; Office MCP must not hold mail credentials; single-user workflow) argue against baking an IMAP client and its credentials into the first production release. v2 ships file/paste ingestion (`mail_ingest_scan`/`mail_ingest_paste`) with provenance labels; an IMAP poller remains a defined future adapter behind the same ingestion interface, requiring no tool-surface change.

---

## Part C — Delivery, phases, testing, acceptance

### C1. Implementation phases (v1 §18 adapted to the delivery)

| Phase | Deliverable | Exit gate | Shipped in this drop |
|---|---|---|---|
| 0 | Domain + persistence (entities, repos, scoring math, fixtures) | Domain tests pass with no network/MCP | ✅ |
| 1 | Protocol core + read tools (dual-era stdio; health/watchlist/reads) | Fixture search reproducible offline | ✅ |
| 2 | Ingestion (observations, listing record, qualification enforcement) | Per-desk/private-office confusion tests pass | ✅ |
| 3 | Search orchestration + audit (runs, steps, counters, limitations) | Dual-category run auditable end-to-end | ✅ |
| 4 | Dashboard adapters (v2.5 payloads + managed snapshot; dry-run/live) | Fresh sync never overwrites history / server-owned fields | ✅ |
| 5 | Outreach + Mail MCP (packages, validation, full mail lifecycle) | Draft → validate → freeze → approve → send-once demonstrated | ✅ |
| 6 | Website forms (prepare/freeze/approve/submit-once; record-and-hold) | No submission without matching approval hash; at-most-once | ✅ |
| 7 | Hardening (HTTP entry, OAuth scopes, monitoring, backup) | Security/idempotency suites in remote deployment | HTTP entry + scope doc shipped; OAuth deployment deferred |

### C2. Release-blocking tests (v1 §19.1 kept verbatim, plus v2 additions)

All of v1's thirteen release-blocking functional tests are implemented, including: $399/desk never becomes a $399 office; desk products never pass eligibility; 24/7-access-without-24/7-HVAC scores materially below confirmed both; 350 sq ft beats 100 sq ft at equal cost; usable-area-only; 12-month prepay normalization; no double-count of free months and prepay discounts; edited form fields invalidate approval; parallel submits produce at most one submission; ambiguous outcome never auto-resubmits; coverage counts equal processed fixtures; stale/redirected listing cannot surface as validated; prompt-injection page text cannot alter hosts/scopes/approval state.

v2 additions: dual-era protocol conformance (modern `server/discover`/`resultType`/−32022; legacy `initialize`/`ping`); era isolation; tool-name pattern conformance (`^[a-zA-Z0-9_-]{1,128}$`); data-root safety refusal; SSRF/allowlist/robots fetcher policy; approval channel unreachable from tool surface; mail send-at-most-once under parallel calls; consumed approvals cannot be replayed; v2.5 payloads never contain nulls for unknown numerics or server-owned fields; JSONL ledgers append-only under rewrite attempts.

### C3. Integration tests (v1 §19.2 adapted)

Mocked Mail-MCP contract for Office-side flows; provider parsing against saved HTML/JSON fixtures; both stdio eras exercised through a real child-process harness; HTTP entry smoke (modern request, legacy-initialize error shape, origin/header validation); dashboard adapter against a local mock API verifying invariant compliance.

### C4. Acceptance criteria (v1 §22, amended by the audit)

Accepted when: one tool call launches a dual-category search returning `search_run_id`; results separate managed vs conventional datasets with separate coverage; every surfaced managed offer is a confirmed enclosed closeable private office or is explicitly clarification-flagged without a price claim; every price retains its basis; access and HVAC tracked independently; conventional results report cost per usable private sq ft and reward large enclosed rooms; managed results produce the 100-point score and four-price model; quotes preserve fees/free months/credits/prepay alternatives; OutreachPackage + draft validation work without sending; Mail MCP enforces freeze→human-approval→send-once; forms cannot submit without exact-content approval; dashboard sync preserves history and watchlist state; coverage reports state exact inspected/validated/evaluated/excluded/surfaced counts; **and** both servers pass their full `node --test` suites with zero installed dependencies.

### C5. Coding-agent instructions (v1 §21, updated)

Unchanged rules 1–9 and 12 (no schema collapsing; no per-desk inference; access ≠ HVAC; area is high-weight; page content never alters behavior; no mail credentials in Office MCP; no direct-submit form tool; no history overwrites; no fabricated coverage; eligibility/approval tests before enabling side effects). Rule 10 amended: domain/application code stays independent of any specific LLM vendor, MCP client, browser engine, database, or the current dashboard implementation — the shipped storage/adapters are behind interfaces. Rule 11 amended: explicit IDs/handles everywhere; no hidden session state (2026-07-28 stateless model; legacy sessions exist only as protocol-era accommodation).

### C6. Final architectural rule (unchanged)

Any implementation shortcut that breaks product-type fidelity, evidence provenance, 24/7-HVAC separation, historical quote preservation, or the human-authorization boundary is a design regression.

**DISCOVER → VERIFY → NORMALIZE → SCORE → PRESERVE EVIDENCE → PREPARE OUTREACH → HUMAN AUTHORIZE SIDE EFFECTS → AUDIT**
