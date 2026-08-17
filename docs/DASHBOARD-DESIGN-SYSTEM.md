# Dashboard design system

The three dashboards under `public/` — Jobs, Deals and Office Scout — render on
the Fluxology design system's **corporate** theme: Outfit headings, Open Sans
body, JetBrains Mono for technical and numeric data, blue accent on a dark
solarized navy ground, with a light mode derived from the umbrella brand.

## Files

Each dashboard directory carries its own copy of three shared files:

| File | Contents |
|---|---|
| `ds-tokens.css` | The design-system token set (colour, type scale, spacing, radii, shadows, motion, layout) plus the dashboard semantic layer and both colour modes. |
| `ds-dashboard.css` | The component layer shared by all three dashboards: shell, header, hero, stat tiles, controls, result cards, badges, detail dialog, forms, toast, footer. |
| `ds-mode.js` | Colour-mode bootstrap and the theme toggle. Also initialises Lucide icons. |

Each dashboard's own `styles.css` holds only what is unique to it — Deals'
listing media and badge tones, Office Scout's verification queue, sparklines and
two-column workspace, and so on.

### Why the files are duplicated rather than shared

Every dashboard is served both at its own subdomain root
(`jobs.`/`deals.`/`office.fluxology.ca`) and as a shadow path under
`fluxology.ca`. An absolute `/ds/…` path would resolve on the shadow paths but
404 on the subdomains, so every asset reference stays relative and each app is
self-contained.

The duplication is enforced rather than trusted:

```
node tools/check-dashboard-ds.mjs
```

That script fails if the shared files drift apart, and re-checks every
text-on-surface pair in the palette against WCAG AA (4.5:1) in both colour
modes, using the values parsed out of `ds-tokens.css` itself.

**When you change a shared file, change it in one dashboard and copy it to the
other two**, then run the script.

## Colour modes

Dark is the brand default. `ds-mode.js` runs in `<head>` before first paint, so
the stored mode never flashes. Precedence:

1. an explicit choice stored in `localStorage` under `fluxology.dashboard.mode`;
2. otherwise the OS `prefers-color-scheme`, which it keeps tracking until the
   operator picks a side.

The mode is applied as `data-mode="dark|light"` on `<html>`, and the
`<meta name="theme-color">` is kept in step.

### Accent and danger split into fill and text values

`--dash-accent` (`#3A86FF`) reaches only 3.42:1 as text on the light card
surface, and the system's `--danger` (`#E63946`) only 4.03:1 on the dark card
surface. Neither is safe as body-weight text in both modes, so the palette
carries a separate readable value for each:

- `--dash-accent` / `--dash-accent-text`
- `--dash-danger` / `--dash-danger-text`

Use the plain token for fills, borders and rules; use the `-text` token whenever
the colour carries words. Same pattern for success and warn.

Text on the accent fill is navy (`--dash-on-accent`), not white — white lands at
3.48:1 on `#3A86FF`.

## Icons

Lucide is loaded from its CDN, matching the design system's approved icon set.
Every glyph in the dashboards is decorative and sits beside a real text label,
so a blocked or slow CDN costs appearance only and never a control the operator
needs. If you want to drop the third-party dependency, vendor the handful of
glyphs actually used (`sun`, `moon`, `refresh-cw`, `search`) into the repo.

Fonts likewise come from the Google Fonts CDN: the main Astro site self-hosts
them through `astro:fonts`, but these dashboards are plain static files under
`public/` with no build step.

## What was deliberately left alone

The feed, filter, sort, workspace and rendering logic in each dashboard's
`app.js` is untouched by the design-system work — the markup those render paths
already emitted (`.card`, `.badge`, `.facts`, `.fact`, `.dh`, `.sec`, `.line`,
…) maps one-to-one onto the system's primitives, so restyling needed no changes
to behaviour. Keep it that way: presentation belongs in the CSS layer.
