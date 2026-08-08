/**
 * Deals category rules (SDD §13.2).
 *
 * Multiple searches share one feed, so `category` and `searchName` are what
 * keep a new record attributable. The other load-bearing rule is that an
 * unresolved shipping cost can never be laundered into a confirmed landed
 * price: `shippingResolved:false` stays authoritative.
 */
import { SERVER_OWNED_FIELDS } from '../schemas.mjs';
import {
  NULL_AS_ABSENT_FIELDS,
  checkNonNegative,
  checkRecordBounds,
  checkTimestamps,
  checkUrls,
  normalizeTimestamps,
  requireText,
  withoutUndefined,
} from './common.mjs';

const MONEY_FIELDS = [
  'priceCad',
  'currentBidCad',
  'shippingCad',
  'maxShippingCad',
  'maxBidCad',
  'landedCadPerLb',
  'allInCadPerLb',
  'weightLb',
  'bidCount',
];
const URL_FIELDS = ['url', 'imageUrl'];
const PER_POUND_FIELDS = ['landedCadPerLb', 'allInCadPerLb'];

/** Workflow states public/deals/README.md documents and the dashboard understands. */
const KNOWN_STATUSES = new Set(['active', 'watching', 'purchased', 'rejected', 'ended', 'expired']);

export const deals = {
  scope: 'deals',

  /** An explicit null here becomes `$0.00/lb` and the "≤ $8/LB" badge. */
  nullAsAbsentFields: NULL_AS_ABSENT_FIELDS.deals,
  /** The auction countdown is the most time-critical signal on this dashboard. */
  temporalFields: Object.freeze(['endTime']),

  /**
   * A stable id, or the documented eBay derivation key. Mirrors the Dashboard
   * API's own `ebay-<itemId>` derivation so both layers agree on identity.
   */
  resolveId(raw, limits) {
    const explicit = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (explicit) {
      if (explicit.length > limits.maxIdChars) return { error: `id: exceeds ${limits.maxIdChars} characters` };
      const warnings = [];
      if (raw.itemId != null && explicit !== `ebay-${String(raw.itemId).trim()}`) {
        warnings.push(`id: stable eBay ids should use the ebay-<itemId> form (expected ebay-${String(raw.itemId).trim()})`);
      }
      return { id: explicit, warnings };
    }
    if (raw?.itemId != null) {
      const derived = `ebay-${String(raw.itemId).trim()}`;
      if (derived === 'ebay-') return { error: 'itemId: must not be empty when it is used to derive the id' };
      if (derived.length > limits.maxIdChars) return { error: `itemId: derived id exceeds ${limits.maxIdChars} characters` };
      return { id: derived };
    }
    return { error: 'id: a deals record requires a stable id, or an itemId to derive ebay-<itemId> from' };
  },

  stripCallerOwned(raw) {
    const out = withoutUndefined(raw);
    for (const field of SERVER_OWNED_FIELDS) delete out[field];
    return out;
  },

  /**
   * Unresolved shipping must be visible in the stored record. If a per-pound
   * figure is present without confirmed shipping, `shippingResolved` is pinned
   * to an explicit `false` rather than being left absent.
   */
  normalize(merged) {
    let out = normalizeTimestamps(merged, deals.temporalFields);
    // The canonical schema types itemId ["string","null"], but the natural eBay
    // form is a JSON number and the id derivation already coerces it. Coerce it
    // here too, so a numeric itemId derives a valid id AND survives Ajv.
    if (typeof out.itemId === 'number' && Number.isFinite(out.itemId)) {
      out = { ...out, itemId: String(out.itemId) };
    }
    const hasPerPound = PER_POUND_FIELDS.some(field => out[field] != null);
    if (hasPerPound && out.shippingResolved !== true) {
      return { ...out, shippingResolved: false };
    }
    return out;
  },

  check(merged, { isNew, limits }) {
    const errors = [
      ...checkRecordBounds(merged, limits),
      ...checkNonNegative(merged, MONEY_FIELDS),
      ...checkUrls(merged, URL_FIELDS, limits),
      ...checkTimestamps(merged, deals.temporalFields),
    ];
    const warnings = [];

    if (isNew) {
      for (const field of ['category', 'searchName', 'title']) {
        const problem = requireText(merged, field, limits.maxNameChars);
        if (problem) errors.push(problem);
      }
      if (merged.listingType !== 'auction' && merged.listingType !== 'buy_it_now') {
        errors.push('listingType: a new deals record requires "auction" or "buy_it_now"');
      }
    }

    if (merged.shippingResolved === true) {
      const shipping = merged.shippingCad;
      if (typeof shipping !== 'number' || !Number.isFinite(shipping)) {
        errors.push('shippingResolved: cannot be true without a confirmed numeric shippingCad');
      }
    }

    if (Number.isInteger(merged.bidCount) === false && merged.bidCount != null) {
      errors.push('bidCount: must be an integer');
    }

    if (merged.shippingResolved !== true && PER_POUND_FIELDS.some(field => merged[field] != null)) {
      warnings.push('shipping is unresolved: landedCadPerLb/allInCadPerLb are provisional and are stored with shippingResolved:false');
    }

    /*
     * `status` is an unconstrained string at every layer, but public/deals/app.js
     * special-cases only the exact lowercase token 'expired' and counts every
     * other value as active. Warn rather than reject: the vocabulary is
     * documentation (deals/README.md), and `active:false` is the mechanism that
     * actually retires a record.
     */
    if (typeof merged.status === 'string' && merged.status.trim() && !KNOWN_STATUSES.has(merged.status)) {
      const shown = merged.status.slice(0, 40);
      warnings.push(
        KNOWN_STATUSES.has(merged.status.toLowerCase())
          ? `status: the dashboard matches these values exactly, so "${shown}" is treated as an ordinary active record; use the lowercase form`
          : `status: "${shown}" is outside the documented vocabulary (${[...KNOWN_STATUSES].join(', ')}); retire a record with active:false`,
      );
    }

    return { errors, warnings };
  },
};
