# Fluxology scheduled automations (Claude Routines)

The three ChatGPT dashboard automations were taken over by Claude Routines
on 2026-08-18. Each Routine fires a fresh Claude session in the
fluxology-site environment with a self-contained prompt (mirrored by the
skills in `.claude/skills/`), and every run must end with a user-visible
completion report + coverage audit (NO-SILENCE) delivered via the Routine's
push/email completion notification.

## Schedule

All three run **every 12 hours at 08:00 and 20:00 America/Toronto**.
Routines store cron in UTC: `0 0,12 * * *` (= 08:00/20:00 EDT). Note: this
UTC schedule does not track DST — after the clocks fall back the local fire
times become 07:00/19:00 EST until the cron is updated (`update_trigger`).

| Routine | Skill / spec | Sources | Write path |
| --- | --- | --- | --- |
| Fluxology Deals Run | `.claude/skills/fluxology-deals-run` | Browser Bridge → eBay.ca + Kijiji (both marketplaces enabled by default) | `dashboard.upsert {dashboard:"deals"}`; fallback `public/deals/data/listings.json` on main |
| Fluxology Office Run | `.claude/skills/fluxology-office-run` | WebSearch/WebFetch + Browser Bridge for JS-heavy/Kijiji pages | `dashboard.upsert {dashboard:"office"}`; fallback `public/office-scout/data/*.json` on main |
| Fluxology Jobs Run | `.claude/skills/fluxology-jobs-run` | Indeed connector + employer-direct web | `dashboard.upsert {dashboard:"jobs"}`; fallback `public/jobs/data/listings.json` on main |

## Dependencies at fire time

- **Deals (fully) and Office (partly)** need the Browser Bridge connector
  attached to the account (`https://browser-mcp.fluxology.ca/mcp`, Lane B)
  **and at least one Windows agent online** (laptop/desktop with
  `lane-a-run` pointed at the VPS gateway, per LANE-B runbook §5). A run
  that fires without them reports the missing capability and completes what
  it can — it must never fabricate coverage.
- **Jobs** has no bridge dependency and runs from day one.
- Dashboard writes ride the bridge's `dashboard.feed`/`dashboard.upsert`
  (ingest tokens live in the gateway env on the VPS). Until the bridge is
  deployed, runs use the GitHub fallback: single-file merge-by-id commits to
  `main`, which the **Sync dashboard feeds** workflow pushes to the
  dashboard-api. Never rewrite a feed file when nothing materially changed.

## Email (office outreach)

Scheduled runs draft outreach text and queue records only — sending is
always human-approved per message through mail-mcp against
`mail.fluxology.ca`. See `docs/EMAIL-WORKFLOW.md`.

## Operating the Routines

From any Claude session with the claude-code-remote tools: `list_triggers`
to see them, `update_trigger` to change cron/prompt/pause, `fire_trigger`
to run one immediately, `delete_trigger` to remove. The prompts are
self-contained copies of the skill specs; when a skill changes materially,
update the corresponding Routine prompt too.
