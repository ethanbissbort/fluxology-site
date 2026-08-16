/**
 * Deals category rules (SDD §13.2).
 *
 * Multiple searches and marketplaces share one feed, so `category`,
 * `searchName`, `marketplace`, and a stable id keep records attributable.
 * Shipping uncertainty remains authoritative for shipped listings; local
 * pickup listings use the separate pickup/effective-cost fields instead.
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
  'priceCadPerLb',
  'effectiveCadPerLb',
  'weightLb',
  'bidCount',
  'distanceKm',
  'estimatedTripMinutes',
  'zipcarIncrementCad',
  'tollParkingCad',
  'pickupCostCad',
  'effectiveAcquisitionCad',
];
const URL_FIELDS = ['url', 'imageUrl'];
const SHIPPED_PER_POUND_FIELDS = ['landedCadPerLb', 'allInCadPerLb'];
const LISTING_TYPES = new Set(['auction', 'buy_it_now', 'classified', 'search_run']);

/** Workflow states public/deals/README.md documents and the dashboard understands. */
const KNOWN_STATUSES = new Set([
  'active',
  'watching',
  'tracked',
  'purchased',
  'rejected',
  'needs_revalidation',
  'ended',
  'expired',
  'audit',
]);

function marketplacePrefix(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export const deals = {
  scope: 'deals',

  /** An explicit null here becomes `$0.00/lb` and the "≤ $8/LB" badge. */
  nullAsAbsentFields: NULL_AS_ABSENT_FIELDS.deals,
  /** The auction countdown and local recheck date are time-sensitive signals. */
  temporalFields: Object.freeze(['endTime', 'recheckAfter', 'sellerContactedAt']),

  /**
   * Stable ids are preferred. eBay retains the historical `ebay-<itemId>`
   * derivation. Other marketplaces may derive `<marketplace>-<listingId>`
   * when both marketplace and marketplaceListingId are present.
   */
  resolveId(raw, limits) {
    const explicit = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (explicit) {
      if (explicit.length > limits.maxIdChars) return { error: `id: exceeds ${limits.maxIdChars} characters` };
      const warnings = [];
      const market = marketplacePrefix(raw?.marketplace);
      if (raw.itemId != null && (!market || market === 'ebay') && explicit !== `ebay-${String(raw.itemId).trim()}`) {
        warnings.push(`id: stable eBay ids should use the ebay-<itemId> form (expected ebay-${String(raw.itemId).trim()})`);
      }
      if (raw.marketplaceListingId != null && market && explicit !== `${market}-${String(raw.marketplaceListingId).trim()}`) {
        warnings.push(`id: stable ${raw.marketplace} ids should use the ${market}-<marketplaceListingId> form (expected ${market}-${String(raw.marketplaceListingId).trim()})`);
      }
      return { id: explicit, warnings };
    }

    if (raw?.marketplaceListingId != null) {
      const market = marketplacePrefix(raw?.marketplace);
      const token = String(raw.marketplaceListingId).trim();
      if (!market) return { error: 'marketplace: required when marketplaceListingId is used to derive an id' };
      if (!token) return { error: 'marketplaceListingId: must not be empty when it is used to derive the id' };
      const derived = `${market}-${token}`;
      if (derived.length > limits.maxIdChars) return { error: `marketplaceListingId: derived id exceeds ${limits.maxIdChars} characters` };
      return { id: derived };
    }

    if (raw?.itemId != null) {
      const derived = `ebay-${String(raw.itemId).trim()}`;
      if (derived === 'ebay-') return { error: 'itemId: must not be empty when it is used to derive the id' };
      if (derived.length > limits.maxIdChars) return { error: `itemId: derived id exceeds ${limits.maxIdChars} characters` };
      return { id: derived };
    }
    return { error: 'id: a deals record requires a stable id, marketplaceListingId + marketplace, or an eBay itemId' };
  },

  stripCallerOwned(raw) {
    const out = withoutUndefined(raw);
    for (const field of SERVER_OWNED_FIELDS) delete out[field];
    return out;
  },

  /**
   * Unresolved shipping must be visible in the stored record for shipped lots.
   * Local-classified priceCadPerLb/effectiveCadPerLb are independent of this
   * rule because their transport cost is represented by pickupCostCad.
   */
  normalize(merged) {
    let out = normalizeTimestamps(merged, deals.temporalFields);
    if (typeof out.itemId === 'number' && Number.isFinite(out.itemId)) {
      out = { ...out, itemId: String(out.itemId) };
    }
    if (typeof out.marketplaceListingId === 'number' && Number.isFinite(out.marketplaceListingId)) {
      out = { ...out, marketplaceListingId: String(out.marketplaceListingId) };
    }
    const hasShippedPerPound = SHIPPED_PER_POUND_FIELDS.some(field => out[field] != null);
    if (hasShippedPerPound && out.shippingResolved !== true) {
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
    const isSearchRun = merged.recordType === 'search_run' || merged.listingType === 'search_run';

    if (isNew) {
      for (const field of ['category', 'searchName', 'title']) {
        const problem = requireText(merged, field, limits.maxNameChars);
        if (problem) errors.push(problem);
      }
      if (!LISTING_TYPES.has(merged.listingType)) {
        errors.push('listingType: a new deals record requires "auction", "buy_it_now", "classified", or "search_run"');
      }
    }

    if (isSearchRun) {
      if (merged.listingType !== 'search_run') errors.push('listingType: search_run records must use listingType "search_run"');
      if (merged.recordType !== 'search_run') errors.push('recordType: search_run records must use recordType "search_run"');
      const audit = merged.searchAudit;
      if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
        errors.push('searchAudit: search_run records require a searchAudit object');
      } else {
        if (typeof audit.profileId !== 'string' || !audit.profileId.trim()) errors.push('searchAudit.profileId: required');
        if (typeof audit.radiusKm !== 'number' || !Number.isFinite(audit.radiusKm)) errors.push('searchAudit.radiusKm: numeric radius is required');
        for (const field of ['resultRecordsInspected', 'listingPagesOpened']) {
          if (!Number.isInteger(audit[field]) || audit[field] < 0) errors.push(`searchAudit.${field}: non-negative integer is required`);
        }
      }
    }

    if (merged.shippingResolved === true && merged.pickupOnly !== true) {
      const shipping = merged.shippingCad;
      if (typeof shipping !== 'number' || !Number.isFinite(shipping)) {
        errors.push('shippingResolved: cannot be true without a confirmed numeric shippingCad');
      }
    }

    if (Number.isInteger(merged.bidCount) === false && merged.bidCount != null) {
      errors.push('bidCount: must be an integer');
    }

    if (merged.shippingResolved !== true && SHIPPED_PER_POUND_FIELDS.some(field => merged[field] != null)) {
      warnings.push('shipping is unresolved: landedCadPerLb/allInCadPerLb are provisional and are stored with shippingResolved:false');
    }

    if (merged.pickupOnly === true && merged.shippingCad != null && merged.shippingCad !== 0) {
      warnings.push('pickupOnly: shippingCad is non-zero; use pickupCostCad for local acquisition travel costs');
    }

    if (merged.rejectionClass === 'temporary_value' && merged.active === false && !merged.recheckAfter) {
      warnings.push('temporary_value rejection has no recheckAfter; preserve the listing, but consider scheduling a re-evaluation date');
    }

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
