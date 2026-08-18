---
name: fluxology-jobs-run
description: Find, verify, deduplicate, and rank GTA entry-level skilled-trades jobs for a George Brown T176 Construction Techniques student, then upsert the shortlist to the Jobs dashboard. Multi-source (Indeed + employer-direct + web), multi-lane (welding, plumbing, machine shop, finishing, labour, adjacent), ranked for career capital not title match. Use when asked to run the jobs scout, trades job search, or T176 watch.
---

# T176 Trades Job Scout (Fluxology Jobs Run)

Ported from the ChatGPT "t176-trades-job-scout" skill (snapshot 2026-08-17).
The OPERATIONS section maps it onto the Fluxology tool stack. The three
`references/` files were RECONSTRUCTED from the skill body and known user
context because the originals were not exported; refine them as the user
supplies corrections.

## OPERATIONS (tool mapping)

- **Sources** — the Indeed MCP connector (search_jobs / get_job_details /
  get_company_data) plus WebSearch/WebFetch for employer-direct career
  pages, union/apprenticeship channels, and boards without connectors.
  Never claim a source was searched when it was not invoked.
- **Dashboard writes** — `dashboard.feed` `{dashboard:"jobs", mode:"ids"}`
  to diff, then `dashboard.upsert` `{dashboard:"jobs", listings:[...]}`.
  The jobs feed is schemaVersion 3 with a `listings` array; use this record
  convention (established 2026-08-18, keep it stable):
  `id` (`indeed-<jobKey>` when discovered on Indeed, else
  `job-<slug-of-employer-title>`), `title`, `employer`, `lane`
  (welding|plumbing|machine-shop|finishing|labour|adjacent), `verdict`
  (APPLY|STRETCH|MAYBE|SKIP), `careerFitScore` (0-10), `shortlistChance`
  (text range, labelled estimate), `pay` (text or null), `employmentType`,
  `location`, `schedule`, `url` (exact posting URL), `source`,
  `employerDirectVerified` (bool), `whyT176`, `mainGate`, `applicationAngle`,
  `status` (tracked|applied|closed|repost), `active` (bool),
  `firstSeen`/`lastSeen`/`lastChanged` (ISO). Preserve unrelated records.
- **Fallback write path** — update `public/jobs/data/listings.json` on
  `main` of `ethanbissbort/fluxology-site` via the GitHub API, merging by
  stable id; skip the commit when nothing materially changed.
- **Degraded runs** — if the Indeed connector is unavailable, run
  employer-direct/web lanes and say plainly that Indeed coverage was
  missing this run.

Before a live search, read:
- `references/search-profile.md`
- `references/source-strategy.md`
- `references/ranking-rubric.md`

## Core objective

Find paid work that lets the user accumulate credible, transferable construction/shop-floor experience while studying T176, with special priority on the trades currently being studied.

The user's cohort begins T176 with **welding and plumbing in Semester 1**. Current search priority is therefore:

1. welding/fabrication helper, trainee, junior fabricator, junior welder, fitter-helper, metalworking production;
2. plumbing/pipefitting/sprinkler/mechanical-piping helper or apprenticeship pathways;
3. machine-shop/fabrication helper;
4. metal finishing, deburring, grinding, surface preparation and weld cleanup;
5. construction/industrial labour that includes real tool, piping, metal, machinery, drawing or fabrication exposure;
6. electromechanical, millwright, HVAC, sheet-metal and maintenance roles that build useful later-semester competence.

Do not treat this ordering as permanent. If the user gives a newer course sequence or current semester, immediately reweight the lanes around the active coursework.

## Multi-source requirement

For a substantial live search, use **more than one job source when available**. Do not rely on one board's title taxonomy or inventory if other connected job-search apps can materially expand coverage.

Preferred source mix in this environment: employer-direct career postings and exact company vacancy pages; Indeed (connector); current public web search for employer career sites, unions, contractors, apprenticeship channels and postings missed by the job apps. Use only sources actually available in the current environment. When one provider limits search geography or query shape, respect that provider's tool contract and run multiple focused calls rather than inventing unsupported filters.

## Source hierarchy and verification

Discovery source and authoritative source are not necessarily the same. Prefer this hierarchy for final verification: (1) exact employer career posting; (2) exact authorized recruiter posting; (3) exact major-job-board posting; (4) secondary aggregator or mirror. If a job appears on several sources, deduplicate it and prefer the employer-direct version when available. Never count duplicate copies or reposts as separate opportunities. Use title + employer + location + core posting text + source job ID when available to identify duplicates. If two postings appear to be the same vacancy but differ materially in pay, requirements or status, flag the discrepancy rather than silently merging them.

## Search workflow

### 1. Establish the active search profile

Use `references/search-profile.md` unless the user has supplied newer information. Do not ask the user to repeat location, transit assumptions, cohort sequence, school objective or obvious search intent when already known.

### 2. Run separate trade-lane passes

Do **not** issue one giant generic search. Job-board title taxonomy is inconsistent, and broad searches over-rank experienced or irrelevant positions. For Semester 1 welding + plumbing, use the lanes below across the available sources.

**A. Welding / fabrication** — start narrow: `welder helper fabrication helper welding trainee fitter helper`; `fabrication helper metal shop helper`. If zero or poor results, broaden progressively: `metal fabrication welding`; `fabrication shop`; `metal shop`; `production welding`; `welder`. Manually filter experienced-only results instead of trusting a board's entry-level label. A role titled simply `Welder` may still be a strategic stretch if certifications and prior experience are stated as preferred/assets rather than mandatory.

**B. Plumbing / piping** — start narrow: `plumber helper plumbing apprentice pipefitter helper sprinkler fitter helper`; `mechanical piping helper`. Then broaden if needed: `plumbing apprentice`; `pipefitter sprinkler fitter`; `mechanical contractor helper`; `plumbing`. If broad plumbing searches produce facilities, sales or management roles, retain only jobs that offer hands-on piping, plumbing, pumps, water systems, mechanical rooms, fixtures, valves, service work or a legitimate apprenticeship pathway. If major job boards return little, explicitly expand employer-direct and apprenticeship-channel searching rather than concluding the market is empty.

**C. Machine / fabrication shop helper** — `shop helper machine shop`; `machine shop helper fabrication helper`; `manufacturing shop helper`; `general helper machine shop`; `production helper metal`.

**D. Metal finishing / deburring** — `metal finisher deburrer grinder`; `metal polisher`; `grinding deburring metal`; `weld cleanup surface preparation`.

**E. Construction / industrial labour** — `construction labourer industrial labourer manufacturing`; `general labourer metal manufacturing`; `mechanical contractor labourer`. Reject generic warehouse or packing jobs unless there is meaningful machinery, fabrication, assembly, drawings, maintenance, piping or trade-tool exposure.

**F. Adjacent technical lanes** — when the core lanes are sparse or the user requests broader options: `maintenance helper millwright apprentice industrial maintenance`; `electromechanical technician trainee electrical mechanical assembler`; `HVAC helper refrigeration helper`; `sheet metal helper`; `appliance repair helper`. These remain useful but should not displace stronger current-semester welding/plumbing reinforcement without a reason.

### 3. Expand intelligently when searches fail

A zero-result query is not evidence that an occupational lane is empty. When a narrow query returns zero: (1) remove `helper`, `trainee` or `apprentice` one at a time; (2) search the underlying work domain; (3) use a second/third job source rather than only reformulating on one board; (4) search employer-direct career pages or contractor websites when board coverage appears weak; (5) inspect descriptions manually for trainable roles; (6) separate **hard requirements** from **preferred/assets**. Do not widen until the result set becomes meaningless. Stop when the results cease to provide plausible hands-on trade exposure.

### 4. Hard-filter obvious mismatches

Normally exclude or mark Skip when: a mandatory journeyperson licence is required; the posting requires several years of directly relevant experience as a hard gate; a mandatory advanced apprenticeship year is specified; the role is supervisory, foreperson, manager, lead or senior technician; the work is mostly retail, sales, office administration, packing or generic warehouse labour; there is no meaningful transfer to T176 skills; schedule conflicts clearly make full-time study impossible and no accommodation is plausible. Do **not** automatically reject a role because it says `1 year` if the description otherwise reads like elementary helper work. Distinguish: required; preferred; asset; boilerplate wish-list language.

### 5. Identify career-capital signals

Strong positive signals include: welding, tack welding, fitting and joint preparation; grinders, saws, drill presses, brakes, shears and ironworkers; blueprint/shop-drawing interpretation; measurement, tolerances, calipers and inspection; deburring, weld cleanup and surface preparation; material handling with cranes, hoists or forklifts; pipe cutting, threading, fitting, soldering/brazing, pumps and valves; plumbing, hydronic, refrigeration, boiler or mechanical-room exposure; preventative maintenance and troubleshooting; machine setup and industrial equipment; formal on-the-job training; progression into an apprenticeship or technician role; union training or recognized skilled-trades pathways; exposure to multiple trades in one industrial environment.

### 6. Deduplicate before ranking

Before presenting roles: collapse duplicate board copies of the same vacancy; prefer the employer-direct posting when found; identify obvious reposts when possible; do not label an old/reposted role as newly discovered if it was already reviewed; preserve source links for verification. A multi-source search should yield **more coverage, not more duplicates**.

### 7. Account for transit without over-filtering industrial areas

Use `references/search-profile.md`. Do not reject a good industrial job merely because the final stop is not beside the plant. The user accepts a substantial final walking segment and is willing to use a small electric skateboard for last-mile access. Rank in this order: (1) T176 career value; (2) realistic attainability; (3) compatibility with school schedule; (4) total public-transit burden; (5) last-mile difficulty; (6) pay and benefits. Pay can break a close tie, but should not outrank substantially stronger training value unless the user changes priorities.

## Ranking rubric

Use `references/ranking-rubric.md`. For each seriously considered role, classify: **APPLY** — realistic enough and strategically valuable; **APPLY — STRATEGIC STRETCH** — worthwhile despite a meaningful experience gap because no decisive hard gate is violated; **MAYBE** — useful but has a substantial schedule, commute, skill, credential or career-value tradeoff; **SKIP** — a hard gate fails or career value is too weak. Do not inflate shortlist probabilities. Use broad, clearly estimated ranges when evidence is incomplete.

## Output rules

Do not dump raw board results back at the user. First summarize the market pattern across sources, including differences between sources when useful. Then present only the genuinely useful shortlist. Five to eight roles is usually enough; fewer is better than filler.

For each displayed role include: (1) role title and employer; (2) trade lane; (3) Apply / Strategic Stretch / Maybe / Skip; (4) T176 career-fit score out of 10; (5) estimated shortlist-chance range, clearly labelled as an estimate; (6) listed pay and basis, or `not listed`; (7) employment type when known; (8) location and schedule when available; (9) exact authoritative posting URL when available, otherwise exact board posting URL; (10) discovery source and whether employer-direct verification was found; (11) why it builds useful T176 skills; (12) main risk or gate; (13) CV/application angle; (14) whether it belongs in the user's tracker.

## Semester-aware reweighting

**Current default: Semester 1 — welding + plumbing.** Suggested search weighting: welding/fabrication 35–40%; plumbing/pipefitting/sprinkler 20–25%; machine shop/fabrication helper 15–20%; metal finishing/deburring 10–15%; construction/industrial labour 5–10%; electromechanical/HVAC/millwright/adjacent 5–10%. When the user gives active courses, shift weighting toward immediate reinforcement.

## Search-market interpretation

Report genuine gaps instead of hiding them. If repeated plumbing-helper searches fail across several boards but broad plumbing searches reveal mostly licensed plumbers, say current board coverage is weak for zero-experience plumbing and shift more effort toward contractor/apprenticeship channels. If helper-title searches fail but trainable roles appear under `General Helper`, `Production Worker`, `Metal Polisher`, `Assembler`, `Machine Operator`, or even `Welder`, explain the title mismatch. If one job appears on three boards, count it once and mention the best authoritative source, not three times.

## Recurring job watch

Each scheduled run must: search all available relevant job sources plus employer-direct sources when practical; check newly posted roles; deduplicate previously reviewed jobs (diff against the Jobs dashboard feed) and cross-board duplicates; prioritize genuine new entry points; surface only meaningful matches; include title, employer, location, pay if listed, trade lane, why it fits current T176 coursework, main gate and exact link; keep plumbing/piping active even when major boards return few results; identify reposts rather than labelling them new when evidence permits.

## Final quality checks

Before finishing a live search, verify: separate trade-lane passes were actually used; at least two job sources were used when available and useful; employer-direct verification was attempted for top recommendations when practical; duplicates were collapsed; current semester weighting is correct; no senior/licensed role slipped into Apply without an explicit stretch rationale; `preferred` was not silently treated as `required`; generic labour was not rewarded without career-capital evidence; school schedule compatibility was considered; public transit plus last-mile tolerance was applied correctly; every named recommended role has an exact usable posting URL when available; rankings explain **why the job is useful to T176**, not merely why the user could get it.

NO-SILENCE RULE: every scheduled run returns a user-visible completion report with the market pattern, the shortlist (or an explicit "zero qualifying roles" per lane), and a coverage audit (queries run per lane per source, results inspected, postings opened/verified, duplicates collapsed, records upserted).
