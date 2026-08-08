# Fluxology Jobs v3

Static dashboard intended for `https://jobs.fluxology.ca/`.

## Canonical feed

`public/jobs/data/listings.json`

The job-search skill should normalize results from Indeed, WhatJobs, Workopia, ZipRecruiter, direct employer pages, and other useful sources into this feed. Stable IDs should be based on the source listing ID when possible; otherwise use a deterministic source/company/title/location key.

The feed is research state. The browser stores personal application workflow separately in `localStorage` using the states Unreviewed, Saved, Applied, Interview, Rejected, and Offer. Scheduled or manual skill runs must never overwrite those browser-local states or personal notes.

## T176 ranking model

The skill should prefer real entry-level roles that build career capital for the user's current T176 phase, especially welding and plumbing first, then industrial maintenance/millwright, electromechanical, metal finishing/deburring, sheet metal/HVAC, and related industrial helper work. Generic labour jobs should rank below jobs with direct trade exposure.

`fitScore` is 0–100 and should summarize overall career fit. `careerValue` and `trainingValue` should remain explicit so a high-paying generic role does not automatically outrank a lower-paying role with materially better trade exposure.

Public-transit practicality should be evaluated independently from career fit. The final walk may be up to roughly 20 minutes because an electric skateboard can cover the final segment.

## Automation contract

A skill run should:

1. read the current feed;
2. search all configured job sources;
3. normalize and deduplicate by stable listing ID;
4. preserve unchanged records;
5. mark confirmed closed roles `active:false` rather than deleting them;
6. update `lastVerified` only when checked and `lastChanged` only for material changes;
7. avoid rewriting the feed when nothing materially changed;
8. write the complete valid JSON document back to GitHub.

Routine runs should modify only `data/listings.json`.
