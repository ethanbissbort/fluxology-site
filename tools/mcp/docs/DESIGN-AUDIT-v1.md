# Design Audit — Fluxology Office MCP SDD v1.0

**Audited document:** `Fluxology_Office_MCP_Software_Design_Document_v1.docx` (v1.0, "Implementation-ready design")
**Audit date:** 2026-08-16
**Auditor:** Claude Code (repository-grounded review against `fluxology-site` and the MCP 2026-07-28 specification)
**Outcome:** v1 is architecturally sound but **not implementation-ready as written**. Eleven findings require changes; they are incorporated in [SDD v2](./SDD-v2.md), which supersedes v1.

---

## Verdict summary

| # | Severity | Finding | v2 disposition |
|---|----------|---------|----------------|
| A1 | Blocker | Mail MCP is a load-bearing dependency but is never specified | v2 adds a full Fluxology Mail MCP specification (Part B) |
| A2 | Blocker | No runtime, language, dependency, or distribution decision | v2 pins Node ≥ 22, ESM, zero runtime dependencies, delivery under `public/office-scout/mcp/` |
| A3 | Blocker | Human-approval mechanism is abstract; a model-callable "approve" tool would be self-approval | v2 pins an out-of-band CLI approval channel that is not reachable from the MCP tool surface |
| A4 | Major | Tool names use dots (`office.search.start`), rejected by the primary host's tool-name pattern | v2 renames the entire surface to snake_case (`office_search_start`) |
| A5 | Major | Dashboard integration is not grounded in the real dashboard API and its invariants | v2 specifies concrete adapters for Office Scout feed v2.5 upsert and the managed-providers snapshot |
| A6 | Major | Server-side background search execution conflicts with a stateless, single-process stdio server | v2 replaces polling with a cooperative `office_search_step` execution model |
| A7 | Major | Tool surface is internally inconsistent and incomplete | v2 publishes a complete, closed tool table; every referenced tool exists |
| A8 | Major | All ingestion assumed server-side; no path for host-assisted evidence | v2 adds `office_ingest_observation` / `office_listing_record` with server-enforced qualification |
| A9 | Moderate | Protocol basis correct but stated without a compatibility strategy | v2 mandates a dual-era server (modern 2026-07-28 + legacy `initialize` clients) |
| A10 | Moderate | Personal/operational constants embedded in prose (C$850, GTA) | v2 moves them to configuration with defaults |
| A11 | Moderate | Runtime data location unspecified — dangerous given web-served delivery directory | v2 mandates a data root outside the package (`~/.fluxology/…`), never inside `public/` |

Verified-correct elements of v1 that v2 preserves unchanged are listed at the end.

---

## A1 — Mail MCP is referenced everywhere and specified nowhere (Blocker)

v1 §3.1, §11.3, §15.2, §19.2 and the acceptance criteria all depend on a "Fluxology Mail MCP": it must expose `mail.prepare_message` / `mail.prepare_reply`, freeze exact messages, obtain per-message human approval, send exactly once, record `Message-ID`/thread state, and provide IMAP thread readback. **None of that is designed anywhere.** v1 is titled as *the* SDD, yet the system it describes cannot meet its own acceptance criteria ("Mail MCP can receive the validated draft and enforce human approval before sending") without a second, unwritten design.

Since the delivery order is explicitly *two* MCP servers, this is the largest gap in v1.

**v2 change:** Part B of SDD v2 specifies Fluxology Mail MCP completely: data model (Message, Thread, Approval, TransportReceipt), lifecycle (`DRAFT → FROZEN → AWAITING_APPROVAL → APPROVED → SENDING → SENT`, with `REJECTED`/`CANCELLED`/`SEND_FAILED`/`OUTCOME_UNKNOWN`), tool surface, transports (default `outbox` writing RFC 5322 `.eml` files; optional env-gated SMTP), and reply ingestion. IMAP readback is explicitly rescoped (see v2 §B7): v1 assumed credentialed IMAP in a design whose own core rule is credential minimization; v2 ships file/paste-based reply ingestion with provenance labels and leaves IMAP as a defined adapter extension point.

## A2 — No runtime, language, dependency, or distribution decision (Blocker)

"Platform-agnostic" is appropriate for the domain model, but v1 never chooses an implementation stack, and its §20 repository layout (`fluxology-office-mcp/` as a standalone repo) contradicts the actual delivery target (`fluxology-site/public/office-scout`). Pseudocode is Python-flavored while the destination repository is a Node 22 ESM codebase whose existing MCP connector (`services/fluxology-mcp`) sets house conventions (`.mjs`, `node:test`, JSON Schema tool inputs).

There is also a consequence v1 could not have caught without repository grounding: **everything under `public/` is copied verbatim into the built site and served publicly** by the Apache container. Any delivered package there must therefore be safe to publish: no secrets, no runtime state, and ideally no `node_modules` (the site image would ingest it — the repo's own `.dockerignore` history shows this exact class of accident).

**v2 change:** Reference implementation pinned to Node ≥ 22, ESM `.mjs`, **zero runtime npm dependencies** (Node standard library only; the MCP protocol core is implemented in-tree), `node:test` suites, delivered as two self-contained packages under `public/office-scout/mcp/` sharing a small `mcp-core/` library. No install step is required to run either server.

## A3 — The human-approval boundary has no concrete mechanism (Blocker)

v1's strongest rule — *"Require human authorization for external side effects"* — is enforced by a state machine (`FROZEN → AWAITING_APPROVAL → APPROVED`) whose approval transition has no specified actor. If approval were an MCP tool, the model operating the server could call it, collapsing the entire boundary into self-approval. v1 gestures at "host confirmation, MCP input-required workflow, or out-of-band local UI" without choosing, and correctly notes an out-of-band fallback must always exist — but a fallback to an unspecified mechanism is not implementable.

**v2 change:** Approval is granted **only** through a channel the model cannot reach: a local CLI (`bin/approve.mjs`) run by the human operator, which writes an approval record binding the frozen content hash. `office_form_submit` and `mail_send` verify record + hash + single-use. The MCP surface can *request* approval (which surfaces the exact frozen content and the command to run) but can never *grant* it. MCP 2026-07-28 MRTR/elicitation is documented as an optional future path that must terminate in the same record store.

## A4 — Dotted tool names fail the primary host (Major)

v1 names tools `office.health`, `office.search.start`, etc. MCP 2026-07-28 does allow dots in tool names, but the Claude API — the first host this system will run under — constrains tool names to `^[a-zA-Z0-9_-]{1,128}$`, and the repository's existing connector already established snake_case (`upsert_office_listings`). Shipping dotted names would make every tool unusable or silently renamed in the primary deployment.

**v2 change:** Entire surface renamed to snake_case with server prefixes: `office_*` and `mail_*`.

## A5 — Dashboard integration ignores the real dashboard contract (Major)

v1 §13 invents a `DashboardAdapter` with `upsert_provider / upsert_location / upsert_offer / append_quote …` against an assumed rich API. The real system (per `claude.md` and `services/dashboard-api`) exposes:

- `POST /v1/office/upsert` (edge: `POST https://office.fluxology.ca/api/upsert`) for **Office Scout feed v2.5 listings** with hard invariants: partial merge by stable `id`; `mandatoryFeesKnown` gating verified status; `priceHistory`, `firstSeen/lastSeen/lastVerified/lastChanged` server-owned; never null-clear a numeric; retire with `active:false`; **never** use full-feed `PUT`.
- A **static** `managed-providers.json` research feed with no write API yet (its README explicitly defers provider/location/offer promotion to future API work).

v1's adapter can neither be implemented against this nor safely invented around it.

**v2 change:** The `DashboardAdapter` port is retained, with two concrete adapters specified against reality: (1) `OfficeScoutV25Adapter` mapping qualified `ConventionalListing` records to v2.5 upsert payloads honoring every invariant above; (2) `ManagedSnapshotAdapter` producing the `managed-providers.json` document shape from the provider watchlist (append-preserving, review-then-commit). The richer provider/location/offer API remains a stated forward target, matching the dashboard README. Sync defaults to dry-run diff output; live push requires the `OFFICE_INGEST_TOKEN` env var.

## A6 — Background search execution does not fit the chosen architecture (Major)

v1 §5 models searches as fire-and-poll (`office.search.start` → background work → `office.search.status`). A zero-dependency, single-process stdio server has no job runner; timers running between requests make behavior nondeterministic and untestable, and the 2026-07-28 protocol's own answer (Tasks) is an extension v1 rightly refuses to depend on.

**v2 change:** Cooperative execution. `office_search_start` creates the run and its work queue; `office_search_step` performs a bounded batch of work synchronously and returns exact progress; `office_search_status` / `office_audit_coverage` read counters that are incremented only by processed records. This is deterministic, resumable across process restarts (queue is persisted), honest about coverage, and maps cleanly onto the stateless protocol's explicit-handle model.

## A7 — Tool surface inconsistencies (Major)

- §11.3 step 7 calls `office.outreach.update` — absent from the §5 tool table.
- Resources list `office://listings/{listing_id}` but no tool reads or writes a conventional listing.
- No tool records a `NegotiationEvent` although the entity and dashboard view exist (`office.quote.record` covers quotes only).
- No tool retrieves an `OutreachPackage` after preparation.

**v2 change:** Closed tool table (§A5 of SDD v2); every tool referenced by any workflow exists in the table; reads/writes and side-effect classes are annotated per tool (`readOnlyHint`, `destructiveHint`, `openWorldHint`).

## A8 — No host-assisted ingestion path (Major)

v1 assumes the server performs all fetching and parsing. In real MCP operation the host model often has superior page access (its own browsing/fetch tools) and judgment; and in offline or restricted-network deployments the server cannot fetch at all. v1 provides no way to feed evidence in without violating provenance rules.

**v2 change:** `office_ingest_observation` (URL + retrieved content/excerpt + extracted field claims + confidence) and `office_listing_record` accept host-supplied evidence. The server — not the host — enforces normalization, product-type qualification, price-basis preservation, and provenance recording, so the locked requirements hold regardless of who fetched the page. Host-supplied evidence is marked `extraction_method: "host_reported"` and ranks below server-verified fetches of the same URL in evidence precedence.

## A9 — Protocol basis: verified correct, but needs a compatibility strategy (Moderate)

Verified against the published specification on 2026-08-16: **2026-07-28 is the current MCP revision**, and v1's characterization is accurate — stateless core with per-request `_meta` version/capability declaration, mandatory `server/discover`, `UnsupportedProtocolVersionError` (−32022), MRTR replacing server-initiated requests, Tasks moved to the `io.modelcontextprotocol/tasks` extension, `Mcp-Method`/`Mcp-Name` headers on Streamable HTTP, required `resultType` and cacheable list results.

What v1 misses is that **widely deployed hosts still speak legacy handshake revisions** (2025-11-25 and earlier, negotiated via `initialize`). A server implementing only 2026-07-28 semantics would fail against them; the spec itself defines the dual-era server pattern for exactly this.

**v2 change:** Both servers are dual-era on stdio: modern per-request `_meta` requests are served with 2026-07-28 semantics (including `server/discover`, `resultType`, `ttlMs`/`cacheScope`); an `initialize` request selects legacy semantics for the process (2025-11-25 … 2024-11-05). The optional Streamable HTTP entry is modern-only and answers legacy `initialize` with the spec-recommended error naming supported versions.

## A10 — Operational constants hardcoded in the design (Moderate)

The C$850/month conventional all-in target, GTA as the market, currency, and the F&B taste weighting are the operator's current parameters, not architecture. Embedding them in normative prose forces a document revision for a budget change and invites constants sprinkled through code. (Notably, the live dashboard already carries `hardAllInCeilingCad` as feed data, confirming these are data, not design.)

**v2 change:** A Configuration section defines every operational parameter (region, budget target, currency, scoring weight tables, F&B rubric, area tiers, access/HVAC matrix) as configuration with the v1 values as defaults. Scoring code takes the tables as input; tests pin the defaults.

## A11 — Runtime data location unspecified (Moderate)

v1 never says where SQLite files, evidence stores, or ledgers live. Because the delivery directory is web-served (A2), a naive "data/ next to the code" default would publish quote ledgers, contacts, and outreach drafts to the public internet on the next site deploy. The repo's `.dockerignore` (`**/data/*.jsonl`, `services/*/data`) shows this hazard is real and already defended against elsewhere.

**v2 change:** Hard rule: runtime data roots default to `~/.fluxology/office-mcp/` and `~/.fluxology/mail-mcp/`, overridable by env var, and both servers **refuse to start** with a data root inside their own package directory. Nothing under `public/` is ever written at runtime.

---

## Minor corrections absorbed into v2 without discussion

1. §7.2 mentions robots handling only as a *limitation counter*; v2 makes robots.txt compliance an explicit fetcher policy (on by default) with its refusals counted in `limitations`.
2. Evidence hashing/sanitization unpinned; v2 specifies SHA-256 content hashes, tag-stripped whitespace-collapsed excerpts with length caps, and byte-size/timeout caps on fetches.
3. §8.1's "modest shape/usability adjustment" quantified: usability multiplier 0.85–1.00 on space points, with a recorded reason.
4. Error envelope standardized: tool-level failures return MCP `isError: true` with a machine-readable `code` from v1 §17's taxonomy (kept intact) in `structuredContent`.
5. The four-price model divides by 12 while prose says "divided by usable months"; v2 defines `usable_months` explicitly (12 + free months treated as value, not divisor change) and keeps the v1 formula as the definition.
6. SQLite/PostgreSQL repositories deferred: the repository-interface rule stands, with the shipped implementation being append-only JSONL ledgers + JSON snapshots (crash-safe, greppable, diffable — and consistent with zero dependencies). SQL engines remain alternate repository implementations, as v1 intended.
7. Search-profile names keep v1 semantics but drop the region from the identifier (`daily_managed`, `daily_conventional`, …) since region is configuration (A10).

## What v1 got right (preserved verbatim in v2)

- The locked requirements, especially: private-office-only qualification; per-desk price never converted to office price; 24/7 access vs 24/7 HVAC as separate fields and scores; append-only history; auditable coverage counts.
- The product taxonomy and enum design of §2, including the qualification predicate.
- Evidence precedence ordering (§6.1) and the provenance-aware data model (§6).
- Conventional scoring (§8: weights, area tiers, access/HVAC matrix) and managed scoring (§9: weights, F&B rubric, four-price model) — all tables internally consistent (weights sum to 100; rubric maxima match weights). These are adopted as the default configuration tables.
- The negotiation/prepayment model (§10) and human-sounding outreach guidance (§11.2) — the latter moves into the OutreachPackage as `message_constraints` guidance strings.
- The form-submission state machine (§12) including hash-freeze, approval invalidation on any edit, submit-exactly-once idempotency, and `OUTCOME_UNKNOWN` never auto-resubmitting.
- Coverage counter definitions (§14) — adopted unchanged, with added monotonicity/consistency invariants.
- The security model (§15), failure taxonomy (§17), phases (§18), release-blocking tests (§19.1 — all carried into v2's test plan), coding-agent instructions (§21), and acceptance criteria (§22, amended only where findings above require).
- The final architectural rule and pipeline: DISCOVER → VERIFY → NORMALIZE → SCORE → PRESERVE EVIDENCE → PREPARE OUTREACH → HUMAN AUTHORIZE SIDE EFFECTS → AUDIT.
