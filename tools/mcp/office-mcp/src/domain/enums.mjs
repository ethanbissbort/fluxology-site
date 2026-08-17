/**
 * Product taxonomy enums and qualification predicate (SDD v2 §A1).
 * These are the first defense against bad office recommendations: the
 * provider's actual pricing basis and enclosure status are preserved exactly,
 * never inferred into equivalence.
 */

export const PRODUCT_KIND = ['PRIVATE_OFFICE', 'TEAM_SUITE', 'DEDICATED_DESK', 'HOT_DESK', 'COWORKING_MEMBERSHIP', 'VIRTUAL_OFFICE', 'MEETING_ROOM', 'UNKNOWN'];
export const ENCLOSURE_STATUS = ['CONFIRMED', 'PROBABLE', 'UNKNOWN', 'OPEN_PLAN'];
export const DOOR_STATUS = ['CLOSEABLE_LOCKABLE', 'CLOSEABLE_UNKNOWN_LOCK', 'NO_DOOR', 'UNKNOWN'];
export const PRICE_BASIS = ['PER_OFFICE', 'PER_PERSON', 'PER_DESK', 'STARTING_FROM', 'QUOTE_ONLY', 'UNKNOWN'];
export const ACCESS_BASIS = ['24_7', 'EXTENDED', 'BUSINESS_HOURS', 'UNKNOWN'];
export const HVAC_BASIS = ['24_7_INCLUDED', '24_7_EXTRA_FEE', 'BUSINESS_HOURS_ONLY', 'ON_REQUEST', 'UNKNOWN'];
export const EXTRACTION_METHOD = ['server_fetch', 'host_reported', 'manual'];
export const SOURCE_TYPE = ['provider_page', 'provider_quote_page', 'provider_terms_page', 'third_party_listing', 'search_snippet', 'email', 'contract', 'other'];

export function assertEnum(field, value, allowed) {
  if (!allowed.includes(value)) {
    throw Object.assign(new Error(`${field} must be one of ${allowed.join(', ')}; got ${JSON.stringify(value)}`), { code: 'VALIDATION_FAILED' });
  }
  return value;
}

/**
 * Locked requirement 1: only a confirmed, enclosed, closeable private office
 * qualifies. This predicate is the single implementation used everywhere.
 */
export function qualifiesPrivateOffice({ product_kind, enclosure_status, door_status }) {
  return (
    product_kind === 'PRIVATE_OFFICE' &&
    enclosure_status === 'CONFIRMED' &&
    (door_status === 'CLOSEABLE_LOCKABLE' || door_status === 'CLOSEABLE_UNKNOWN_LOCK')
  );
}

/**
 * Locked requirement 2: a per-person/per-desk price is never a private-office
 * price. Returns the price usable AS a private-office monthly price, or null.
 */
export function privateOfficePrice(offer) {
  if (offer.price_basis === 'PER_PERSON' || offer.price_basis === 'PER_DESK') return null;
  if (offer.price_basis === 'QUOTE_ONLY' || offer.price_basis === 'UNKNOWN') return null;
  if (typeof offer.sticker_price !== 'number') return null;
  return offer.sticker_price; // PER_OFFICE and STARTING_FROM (flagged as floor elsewhere)
}

/** Reasons a candidate is hard-excluded, for coverage accounting (§A13). */
export const EXCLUSION_REASONS = ['not_private_office', 'enclosure_unconfirmed', 'no_closeable_door', 'over_budget', 'out_of_region', 'dead_or_stale_source', 'canonical_mismatch', 'duplicate'];
