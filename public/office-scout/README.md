# Fluxology Office Scout v2.5

This folder is an isolated static application deployed by the main Fluxology site from:

`public/office-scout/`

Production route:

`https://fluxology.ca/office-scout/`

## Architecture

- `index.html` — static application shell
- `styles.css` — Office Scout-specific Fluxology UI
- `app.js` — feed rendering, filtering, local workflow state, price history and hourly refresh
- `data/listings.json` — canonical curated machine-readable feed
- `data/schema.json` — feed contract for future automated/scheduled writers

No framework build step is required inside this folder. Astro/Netlify serves it as static public assets.

## v1 features preserved

- responsive card grid
- click/keyboard detail view
- hourly feed refresh and manual refresh
- free-text search
- municipality and cost-status filters
- fit/newest/cost/walk sorting
- active/verified/needs-verification/new-changed counters
- strict verified / needs verification / over-budget distinction
- full cost, access, rights, amenities, transit and research detail fields
- Fit score /100
- Fluxology navy/cream/cyan branding

## v2.5 additions

- personal workflow states: Unreviewed, Saved, Contacted, Tour booked, Rejected, Leased
- browser-local personal notes
- export/import of the personal workspace as JSON
- dedicated Needs Cost Verification queue
- observed price-history sparklines and price-delta sorting
- recently-changed sort
- active-only control and workflow filtering
- backwards-compatible feed loading
- safer escaped rendering and validated outbound listing links

Personal workflow state is intentionally kept outside `listings.json`, in browser `localStorage`,
so scheduled feed updates cannot overwrite acquisition notes or pipeline status.

## Scheduled search integration contract

The canonical feed remains `data/listings.json`.

A scheduled curator should:

1. Read the existing feed before writing.
2. Merge by stable `id`.
3. Preserve old listings and mark dead listings `active:false`.
4. Update `lastVerified` every time a listing is checked.
5. Update `lastChanged` only for a material listing change.
6. Never set a listing to verified unless `mandatoryFeesKnown:true` and all mandatory recurring costs are represented in `estimatedAllInMonthly`.
7. Preserve and append `priceHistory` when asking rent or all-in cost changes.
8. Avoid writing the file when there is no material feed change.
9. Keep unknown costs unknown rather than filling them with assumptions.

The dashboard refreshes `data/listings.json` every hour while open.
