#!/usr/bin/env node
/**
 * Guards the design-system layer shared by the three dashboards.
 *
 *   node tools/check-dashboard-ds.mjs
 *
 * Each dashboard under public/ is served at its own subdomain root
 * (jobs./deals./office.fluxology.ca) as well as a shadow path under
 * fluxology.ca, so every asset reference has to stay relative and each app
 * carries its own copy of the shared files rather than sharing one absolute
 * /ds/ path that would 404 on the subdomains.
 *
 * That duplication is only safe if it is enforced, so this script checks:
 *
 *   1. the shared files are byte-identical across all three dashboards;
 *   2. every text/surface pair in the palette clears WCAG AA (4.5:1),
 *      measured against the real values parsed out of ds-tokens.css, in both
 *      colour modes.
 *
 * Exits non-zero on any failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const APPS = ['jobs', 'deals', 'office-scout'];
const SHARED = ['ds-tokens.css', 'ds-dashboard.css', 'ds-mode.js'];

let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL  ${msg}`); };
const pass = (msg) => console.log(`pass  ${msg}`);

// --- 1. shared files identical across apps ----------------------------------

for (const file of SHARED) {
  const seen = new Map();
  for (const app of APPS) {
    const p = path.join(PUBLIC, app, file);
    if (!fs.existsSync(p)) { fail(`${app}/${file} is missing`); continue; }
    seen.set(app, fs.readFileSync(p, 'utf8'));
  }
  const values = [...new Set(seen.values())];
  if (values.length > 1) {
    fail(`${file} differs between dashboards — re-sync the copies (${[...seen.keys()].join(', ')})`);
  } else if (values.length === 1) {
    pass(`${file} identical across ${APPS.length} dashboards`);
  }
}

// --- 2. contrast of the palette in ds-tokens.css -----------------------------

const tokensPath = path.join(PUBLIC, 'jobs', 'ds-tokens.css');
const tokensCss = fs.existsSync(tokensPath) ? fs.readFileSync(tokensPath, 'utf8') : '';

// Comments routinely mention token names and ratios ("--text-on-accent: navy
// …, 3.48:1"), which would otherwise parse as declarations and swallow the real
// one that follows.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Parse `--name: value;` declarations out of one selector block. */
function block(css, selector) {
  const i = css.indexOf(selector);
  if (i === -1) return {};
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  const out = {};
  for (const m of stripComments(css.slice(open + 1, close)).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const base = block(tokensCss, ':root {');
const dark = { ...base, ...block(tokensCss, "[data-mode='dark']") };
const light = block(tokensCss, "[data-mode='light']");

/** Resolve var() indirection against a scope, then the base :root scope. */
function resolve(value, scope, depth = 0) {
  if (!value || depth > 10) return value;
  const m = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!m) return value;
  const next = scope[m[1]] ?? base[m[1]];
  return resolve(next, scope, depth + 1);
}

const parseColor = (c) => {
  c = c.trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x.trim()));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
};

const over = (src, dst) => {
  const s = parseColor(src);
  const d = parseColor(dst);
  if (!s || !d) return null;
  return [
    s[0] * s[3] + d[0] * (1 - s[3]),
    s[1] * s[3] + d[1] * (1 - s[3]),
    s[2] * s[3] + d[2] * (1 - s[3]),
    1,
  ];
};

const lum = (rgb) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// text token, surface token(s) it is painted on. Surfaces composite over the
// page because the dark palette states them as translucent white.
const PAIRS = [
  ['--dash-heading', '--dash-surface'],
  ['--dash-body', '--dash-surface'],
  ['--dash-muted', '--dash-surface'],
  ['--dash-muted', '--dash-panel'],
  ['--dash-heading', '--dash-page'],
  ['--dash-body', '--dash-page'],
  ['--dash-muted', '--dash-page'],
  ['--dash-accent-text', '--dash-surface'],
  ['--dash-accent-text', '--dash-panel'],
  ['--dash-success-text', '--dash-surface'],
  ['--dash-warn-text', '--dash-surface'],
  ['--dash-danger-text', '--dash-surface'],
  ['--dash-on-accent', '--dash-accent'],
];

const MIN = 4.5;

for (const [modeName, scope] of [['dark', dark], ['light', { ...base, ...light }]]) {
  const page = resolve(scope['--dash-page'], scope);
  for (const [fgTok, bgTok] of PAIRS) {
    const fgRaw = resolve(scope[fgTok], scope);
    const bgRaw = resolve(scope[bgTok], scope);
    if (!fgRaw || !bgRaw) { fail(`${modeName}: could not resolve ${fgTok} on ${bgTok}`); continue; }

    // surface first onto the page, then the text onto that surface
    const bg = bgTok === '--dash-page' ? parseColor(bgRaw) : over(bgRaw, page);
    const fg = over(fgRaw, `rgba(${bg[0]},${bg[1]},${bg[2]},1)`);
    if (!bg || !fg) { fail(`${modeName}: could not composite ${fgTok} on ${bgTok}`); continue; }

    const r = ratio(fg, bg);
    const label = `${modeName}: ${fgTok} on ${bgTok} = ${r.toFixed(2)}:1`;
    if (r < MIN) fail(`${label} (needs ${MIN})`); else pass(label);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall dashboard design-system checks passed');
process.exit(failures ? 1 : 0);
