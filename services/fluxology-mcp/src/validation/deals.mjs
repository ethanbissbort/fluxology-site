/**
 * Deals category rules (SDD §13.2).
 *
 * Multiple searches share one feed, so `category` and `searchName` are what
 * keep a new record attributable. The other load-bearing rule is that an
 * unresolved shipping cost can never be laundered into a confirmed landed
 * price: `shippingResolved:false` stays authoritative.
 */
import { SERVER_OWNED_FIELDS } from '../schemas.mjs';
import { checkNonNegative, checkRecordBounds, checkUrls, requireText, withoutUndefined } from './common.mjs';

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

export const deals = {
  scope: 'deals',

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
    const hasPerPound = PER_POUND_FIELDS.some(field => merged[field] != null);
    if (hasPerPound && merged.shippingResolved !== true) {
      return { ...merged, shippingResolved: false };
    }
    return merged;
  },

  check(merged, { isNew, limits }) {
    const errors = [
      ...checkRecordBounds(merged, limits),
      ...checkNonNegative(merged, MONEY_FIELDS),
      ...checkUrls(merged, URL_FIELDS, limits),
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

    return { errors, warnings };
  },
};
