/**
 * Conventional-office scoring (SDD v2 §A3/§A7). Conventional space is a
 * different product from managed space: weak F&B/network amenities are
 * expected, so usable enclosed square footage is the major compensating
 * benefit. A large, cheap, plain office beats a tiny polished room when
 * operating certainty is comparable.
 */
import { CONVENTIONAL_WEIGHTS, AREA_TIERS, ACCESS_HVAC_POINTS, MISSING_DATA_PENALTIES, USABILITY_MULTIPLIER, DEFAULTS } from './config-defaults.mjs';
import { conventionalEconomics } from './pricing.mjs';

export function areaPoints(usableSqft, tables = { AREA_TIERS }) {
  if (typeof usableSqft !== 'number' || usableSqft <= 0) return null;
  for (const tier of tables.AREA_TIERS) {
    if (usableSqft >= tier.min) return tier.points;
  }
  return tables.AREA_TIERS[tables.AREA_TIERS.length - 1].points;
}

export function accessHvacPoints(accessBasis, hvacBasis) {
  const row = ACCESS_HVAC_POINTS[accessBasis] ?? ACCESS_HVAC_POINTS.UNKNOWN;
  return row[hvacBasis] ?? row.UNKNOWN;
}

/**
 * Score a normalized ConventionalListing. Only private/enclosed usable area is
 * ever scored — gross building or shared common area must not be passed here,
 * and `area_source` records that provenance.
 */
export function scoreConventional(listing, { budget = DEFAULTS.budget_all_in_monthly } = {}) {
  const components = [];
  const penalties = [];
  const clarifications = [];
  const add = (key, points, max, note) => components.push({ component: key, points: Math.round(points * 100) / 100, max, note });

  // Space (24): usable enclosed square footage only, with usability multiplier.
  const usable = listing.usable_private_sqft;
  let space = areaPoints(usable);
  if (space === null) {
    space = MISSING_DATA_PENALTIES.area_unknown.points;
    penalties.push(MISSING_DATA_PENALTIES.area_unknown.note);
    clarifications.push(MISSING_DATA_PENALTIES.area_unknown.clarification);
    add('space', space, CONVENTIONAL_WEIGHTS.space, 'area unknown — floor tier assumed');
  } else {
    let multiplier = 1.0;
    if (typeof listing.usability_multiplier === 'number') {
      multiplier = Math.min(USABILITY_MULTIPLIER.max, Math.max(USABILITY_MULTIPLIER.min, listing.usability_multiplier));
      if (multiplier < 1.0 && !listing.usability_reason) clarifications.push('Record the reason for the usability adjustment');
    }
    space *= multiplier;
    add('space', space, CONVENTIONAL_WEIGHTS.space, `${usable} usable private sq ft${multiplier < 1 ? ` × ${multiplier} usability (${listing.usability_reason ?? 'unstated'})` : ''}`);
  }

  // Access + HVAC (20): both must be confirmed for the maximum.
  const access = listing.access_basis ?? 'UNKNOWN';
  const hvac = listing.hvac_basis ?? 'UNKNOWN';
  const ah = accessHvacPoints(access, hvac);
  add('access_hvac', ah, CONVENTIONAL_WEIGHTS.access_hvac, `access=${access}, hvac=${hvac}`);
  if (hvac === 'UNKNOWN') {
    penalties.push(MISSING_DATA_PENALTIES.hvac_unknown.note);
    clarifications.push(MISSING_DATA_PENALTIES.hvac_unknown.clarification);
  }

  // All-in economics (18) against the configured target.
  const econ = conventionalEconomics(listing);
  let econPoints = 0;
  if (econ.all_in_monthly === null) {
    penalties.push('No asking rent — economics unscored');
    clarifications.push('Confirm asking rent and mandatory recurring costs');
  } else {
    const ratio = econ.all_in_monthly / budget;
    if (ratio <= 0.7) econPoints = CONVENTIONAL_WEIGHTS.economics;
    else if (ratio <= 0.85) econPoints = 15;
    else if (ratio <= 1.0) econPoints = 12;
    else if (ratio <= 1.15) econPoints = 6;
    else econPoints = 0;
    if (!econ.fees_known) {
      econPoints *= MISSING_DATA_PENALTIES.fees_unknown.factor;
      penalties.push(MISSING_DATA_PENALTIES.fees_unknown.note + ` (${econ.unknown_fees.join(', ')})`);
      clarifications.push(MISSING_DATA_PENALTIES.fees_unknown.clarification);
    }
  }
  add('economics', econPoints, CONVENTIONAL_WEIGHTS.economics, econ.all_in_monthly === null ? 'unknown all-in' : `all-in ≈ $${econ.all_in_monthly}/mo vs target $${budget}`);

  // Private-room security/quality (10).
  let quality = 0;
  if (listing.door_status === 'CLOSEABLE_LOCKABLE') quality += 5;
  else if (listing.door_status === 'CLOSEABLE_UNKNOWN_LOCK') {
    quality += 3;
    clarifications.push('Confirm the door locks');
  }
  if (listing.overnight_equipment_ok === true) quality += 2;
  if (listing.condition_good === true) quality += 2;
  if (listing.natural_light === true) quality += 1;
  add('room_quality', Math.min(quality, CONVENTIONAL_WEIGHTS.room_quality), CONVENTIONAL_WEIGHTS.room_quality, `door=${listing.door_status}`);

  // Contract + prepayment flexibility (10).
  let contract = 0;
  if (listing.short_commitment === true) contract += 4;
  if (listing.month_to_month === true) contract += 2;
  if (listing.prepay_discount_available === true) contract += 4;
  else if (listing.prepay_discount_available === undefined) clarifications.push('Ask whether 6/12/18-month prepayment earns a discount or concessions');
  add('contract_flexibility', Math.min(contract, CONVENTIONAL_WEIGHTS.contract_flexibility), CONVENTIONAL_WEIGHTS.contract_flexibility, listing.term ?? 'term unknown');

  // Transit + skateboard practicality (8).
  let transit = 0;
  if (typeof listing.final_walk_minutes === 'number') {
    if (listing.final_walk_minutes <= 5) transit += 5;
    else if (listing.final_walk_minutes <= 12) transit += 3;
    else transit += 1;
  }
  if (listing.skateboard_practical === true) transit += 3;
  add('transit', Math.min(transit, CONVENTIONAL_WEIGHTS.transit), CONVENTIONAL_WEIGHTS.transit, `walk=${listing.final_walk_minutes ?? '?'}min, skate=${listing.skateboard_practical ?? '?'}`);

  // Internet/utilities (5).
  let internet = 0;
  if (listing.internet_included === true) internet += 3;
  if (listing.utilities_included === true) internet += 2;
  add('internet_utilities', Math.min(internet, CONVENTIONAL_WEIGHTS.internet_utilities), CONVENTIONAL_WEIGHTS.internet_utilities, '');

  // Mail/logistics (3).
  let mail = 0;
  if (listing.mail_rights === true) mail += 2;
  if (listing.signage_rights) mail += 1;
  add('mail_logistics', Math.min(mail, CONVENTIONAL_WEIGHTS.mail_logistics), CONVENTIONAL_WEIGHTS.mail_logistics, '');

  // Basic amenities/furnishing (2) — intentionally low weight.
  let amen = 0;
  if (listing.furnished === true) amen += 1;
  if ((listing.amenities ?? []).length > 0) amen += 1;
  add('amenities', Math.min(amen, CONVENTIONAL_WEIGHTS.amenities), CONVENTIONAL_WEIGHTS.amenities, '');

  const total = Math.round(components.reduce((s, c) => s + c.points, 0) * 10) / 10;
  return { total, components, penalties, clarifications, economics: econ };
}
