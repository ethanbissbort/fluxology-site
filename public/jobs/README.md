# Fluxology Jobs v3

Static dashboard frontend for:

`https://jobs.fluxology.ca/`

## Production feed

`data/listings.json` is the checked-in bootstrap/local-development snapshot.

In production, the dashboard's `/data/listings.json` request is routed to the persistent self-hosted dashboard API. Trusted job-search automation writes immediately to:

`POST https://jobs.fluxology.ca/api/upsert`

using the jobs-scoped bearer token.

See `services/dashboard-api/README.md` and `docs/CADDY-INTEGRATION.md`.

## Job schema and ranking

Normalize results from Indeed, WhatJobs, Workopia, ZipRecruiter, direct employer pages, and other useful sources. Stable IDs should use the source listing ID when possible; otherwise use a deterministic source/company/title/location key.

The T176 ranking model should prefer genuine entry-level jobs that build career capital for the user's current training phase. Direct welding/plumbing exposure ranks highly, followed by industrial maintenance/millwright, electromechanical, metal finishing/deburring, sheet metal/HVAC, and related industrial helper work. Generic labour should rank below roles with direct trade exposure.

`fitScore` is 0–100. Keep `careerValue` and `trainingValue` explicit so a higher-paying generic job does not automatically outrank a lower-paying role with materially better trade exposure.

Public-transit practicality is evaluated independently. The final walking segment may be roughly 20 minutes when it is practical to cover by electric skateboard.

The browser stores personal Unreviewed / Saved / Applied / Interview / Rejected / Offer state and personal notes in `localStorage`; server-side writers do not own those fields.

## Writer contract

A job-search skill should:

1. normalize and deduplicate with stable IDs;
2. upsert new or changed jobs;
3. preserve unchanged records;
4. mark confirmed closed jobs `active:false` instead of silently deleting them;
5. update `lastVerified` only when checked;
6. update material listing details when they change;
7. leave browser-local workflow state untouched.

The checked-in JSON snapshot remains available as a GitHub intermediary/fallback, but routine production writes should use the direct upsert endpoint.
