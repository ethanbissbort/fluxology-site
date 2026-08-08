# Fluxology Dashboard Architecture v3

Three independent static dashboards live in one repository and are exposed through dedicated subdomains.

| Category | Public URL | Static app path | Canonical feed |
|---|---|---|---|
| Office search | `https://office.fluxology.ca/` | `public/office-scout/` | `public/office-scout/data/listings.json` |
| Deals / shopping | `https://deals.fluxology.ca/` | `public/deals/` | `public/deals/data/listings.json` |
| Jobs | `https://jobs.fluxology.ca/` | `public/jobs/` | `public/jobs/data/listings.json` |

Netlify host-based 200 rewrites map each subdomain to its isolated static directory while leaving the subdomain visible in the browser.

## Data flow

### Current preferred transport: GitHub intermediary

`ChatGPT skill / scheduled task -> GitHub JSON feed -> Netlify deploy -> open dashboard tab -> hourly refresh`

This is the default because the connected GitHub tool is a supported write surface for ChatGPT tasks, gives version history and rollback, and keeps the dashboards static.

Each task or skill reads the current feed before writing, merges by stable ID, preserves records belonging to other searches in the same category, and avoids rewriting the feed when nothing materially changed.

### Future direct-push transport

If the installed skill runtime gains an authenticated arbitrary HTTP write tool, or a purpose-built Fluxology connector is installed, transport can change to:

`ChatGPT skill / scheduled task -> authenticated ingest API -> feed store -> dashboard`

The dashboard schemas are intentionally independent of transport, so moving from GitHub to a VPS/API later does not require redesigning the UI.

A direct API should use a separate token per category and should expose category-specific endpoints such as `/ingest/office`, `/ingest/deals`, and `/ingest/jobs`. The public dashboards should have read-only access; write credentials must never be embedded in browser JavaScript.

## Separation of concerns

The GitHub JSON files contain curated research state. Personal workflow state is browser-local and is not owned by scheduled tasks.

- Office: Saved / Contacted / Tour Booked / Rejected / Leased plus personal notes.
- Deals: Watch / Saved / Purchased / Rejected plus personal notes.
- Jobs: Saved / Applied / Interview / Rejected / Offer plus personal notes.

Scheduled tasks must never invent or overwrite browser-local state.

## Skill ownership

Each major category has one primary ChatGPT skill that owns normalization rules for its feed. Sub-searches can share a category feed by using stable IDs and category/search labels.

- Office skill -> Office Scout schema.
- Deals skill -> shopping schema, with sub-searches such as bulk LEGO and bulk minifigures.
- Jobs skill -> T176/trades job schema and ranking model.

## Deployment requirement

The Netlify site must have `office.fluxology.ca`, `deals.fluxology.ca`, and `jobs.fluxology.ca` assigned as production domain aliases. With external DNS, each subdomain should be a CNAME to the site's Netlify hostname. The repository already contains the host-based rewrite rules; domain assignment/DNS remains an infrastructure configuration step outside the repository.
