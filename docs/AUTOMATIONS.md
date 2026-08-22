# Fluxology scheduled automations (Claude Routines)

The three ChatGPT dashboard automations were taken over by Claude Routines
on 2026-08-18. Each Routine fires a **fresh Claude session** whose trigger
config attaches **fluxology-site as a repository source with push
credentials** (added 2026-08-22; Deals also carries mcp-ebay), so the run
starts with a credentialed clone already on disk and follows the matching
skill in `.claude/skills/`. Every run must end with a user-visible
completion report + coverage audit (NO-SILENCE) delivered via the
Routine's push/email completion notification.

## Fire-time contract (finalized 2026-08-22)

History: from 2026-08-18 to 2026-08-22 every scheduled run failed on "no
repo attached" — the triggers carried no repository sources while the
prompts assumed a checkout. An interim `add_repo` bootstrap did not work
either, because **scheduled sessions have no MCP servers at all** (no
claude-code-remote, no GitHub MCP; connector tools like Indeed exist at
org level but are not loaded — `enabledInChat: false`). The working
architecture, verified end to end on 2026-08-22 (jobs commit `b2b1084`,
office commit `d2ac060`), is:

1. **Repo access**: the trigger's session template attaches fluxology-site
   as a source, so the clone (with push credentials) exists at container
   start. Step 1 of every prompt is a REPO CHECK: verify the checkout,
   `git fetch origin main && git checkout main && git reset --hard
   origin/main`; plain `git clone` as fallback; stop and report the exact
   error if the repo is unreadable after 3 retries — never fabricate.
2. **Tooling**: prompts ToolSearch-probe for optional tools (Browser
   Bridge, dashboard.feed/upsert, Indeed) and degrade gracefully when
   absent, always stating the exact coverage impact.
3. **Write path**: when no direct dashboard tool is attached (the normal
   headless case), the run makes ONE merge-by-id feed commit locally on
   `main` and pushes it with `git push origin main` (backoff retries,
   never force-push, never a PR). The prompt grants explicit permission to
   push to `main`; the session's harness-designated `claude/…` outcome
   branch is never used for feed commits.

The canonical prompt texts installed on the triggers are version-controlled
in `docs/routines/*.prompt.txt`. When a skill changes materially, update
both the prompt file and the live trigger (`update_trigger`).

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
- **Connector grants cannot be stored on Routines** for this org
  (`create_trigger`'s `connectors` parameter is rejected), and scheduled
  sessions load no MCP servers at all, so headless fires arrive with no
  Indeed, no Browser Bridge, no dashboard tools, and no GitHub MCP. Every
  prompt therefore ToolSearch-probes for each optional tool, uses it when
  present, and otherwise degrades to the git fallback while reporting the
  exact coverage impact.
- Dashboard writes ride the bridge's `dashboard.feed`/`dashboard.upsert`
  (ingest tokens live in the gateway env on the VPS). Until the bridge is
  deployed, runs use the git fallback: single-file merge-by-id commits
  pushed to `main` with the session's source credentials, which the
  **Sync dashboard feeds** workflow pushes to the dashboard-api. Never
  rewrite a feed file when nothing materially changed.

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
