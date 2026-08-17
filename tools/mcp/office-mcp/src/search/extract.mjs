/**
 * Page extraction (SDD v2 §A6). Pulls structured signals out of fetched HTML:
 * JSON-LD blocks, canonical URL, title, a sanitized text body, and form
 * definitions for the form-preparation workflow. Purely syntactic — extracted
 * content is data and never interpreted as instructions.
 */
import { sanitizeExcerpt } from '../evidence.mjs';

export function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // malformed JSON-LD is ignored, not repaired
    }
  }
  return blocks;
}

export function extractCanonical(html, baseUrl) {
  const match = html.match(/<link[^>]*rel\s*=\s*["']canonical["'][^>]*>/i);
  if (!match) return null;
  const href = match[0].match(/href\s*=\s*["']([^"']+)["']/i);
  if (!href) return null;
  try {
    return new URL(href[1], baseUrl).href;
  } catch {
    return null;
  }
}

export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? sanitizeExcerpt(match[1], 300) : null;
}

/** Normalize a URL for dedupe: lowercase host, drop fragment/tracking params, trim trailing slash. */
export function canonicalKey(url) {
  try {
    const u = new URL(url);
    const params = new URLSearchParams();
    for (const [key, value] of u.searchParams) {
      if (!/^(utm_|fbclid|gclid|mc_|ref$)/i.test(key)) params.append(key, value);
    }
    const query = params.toString();
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '') || '/'}${query ? `?${query}` : ''}`;
  } catch {
    return url;
  }
}

/** Extract <form> definitions: action, method, and named fields (crude but sufficient for discovery). */
export function extractForms(html, baseUrl) {
  const forms = [];
  const formRe = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
  let match;
  while ((match = formRe.exec(html)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const action = attrs.match(/action\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    const method = (attrs.match(/method\s*=\s*["']([^"']*)["']/i)?.[1] ?? 'GET').toUpperCase();
    const fields = [];
    const inputRe = /<(input|textarea|select)([^>]*)>/gi;
    let inputMatch;
    while ((inputMatch = inputRe.exec(body)) !== null) {
      const inputAttrs = inputMatch[2];
      const name = inputAttrs.match(/name\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!name) continue;
      fields.push({
        name,
        tag: inputMatch[1].toLowerCase(),
        type: inputAttrs.match(/type\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? 'text',
        required: /\brequired\b/i.test(inputAttrs),
      });
    }
    let actionUrl = null;
    try {
      actionUrl = action ? new URL(action, baseUrl).href : baseUrl;
    } catch {
      actionUrl = null;
    }
    forms.push({ action: actionUrl, method, fields });
  }
  return forms;
}

/** Currency amounts near per-desk/per-person wording get their basis preserved. */
export function extractPriceSignals(text) {
  const signals = [];
  const re = /(?:C?\$|CAD\s?)\s?([\d,]+(?:\.\d{2})?)\s*(?:\/|per\s+)?\s*(person|desk|month|mo|office|seat)?/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const amount = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount < 50 || amount > 100_000) continue;
    const unit = (match[2] ?? '').toLowerCase();
    let basis = 'UNKNOWN';
    if (unit === 'person' || unit === 'seat') basis = 'PER_PERSON';
    else if (unit === 'desk') basis = 'PER_DESK';
    else if (unit === 'month' || unit === 'mo') basis = 'STARTING_FROM';
    else if (unit === 'office') basis = 'PER_OFFICE';
    const context = text.slice(Math.max(0, match.index - 60), match.index + 60);
    if (/from|starting at/i.test(context) && basis === 'PER_OFFICE') basis = 'STARTING_FROM';
    signals.push({ amount, basis, context: context.trim() });
  }
  return signals;
}
