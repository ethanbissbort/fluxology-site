# Source strategy

> RECONSTRUCTED 2026-08-18 from the skill body — the original ChatGPT
> reference file was not exported. The connector set differs from the
> ChatGPT environment: Indeed is the connected board; Workopia, WhatJobs,
> ZipRecruiter and joblet.ai have no connectors here and are reached (when
> useful) via web search only.

## Order of operations

1. **Indeed (connector)** — broad inventory and detailed posting text. Run
   each trade lane as its own focused query set; title taxonomy is noisy and
   experienced roles leak into helper searches, so filter by description,
   not title. Respect the tool contract (query + location parameters); run
   multiple focused calls rather than inventing unsupported filters.
2. **Employer-direct and apprenticeship channels (web search + fetch)** —
   unionized contractors, mechanical contractors, fabrication shops,
   manufacturer career pages, union training boards, and Ontario
   apprenticeship channels often never post cleanly under helper titles.
   This lane is mandatory whenever a board lane comes back thin, and is the
   preferred **verification** source for every top recommendation.
3. **Other boards via web search** — use site-scoped web searches to spot
   postings Indeed missed; treat them as discovery pools and verify against
   the employer when possible.

## Verification hierarchy

employer career posting → authorized recruiter posting → major-board
posting → aggregator/mirror. Prefer the highest available tier for the URL
surfaced to the user; keep the discovery source noted separately.

## Honesty rules

- Never claim a source was searched when it was not invoked this run.
- Report genuine coverage differences between sources when they change the
  conclusion; never assume one source is universally better.
- Deduplicate across sources before counting anything.
