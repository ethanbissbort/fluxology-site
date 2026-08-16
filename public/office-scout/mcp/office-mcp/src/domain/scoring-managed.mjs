/**
 * Managed-office value model (SDD v2 §A3/§A7). A managed provider is a service
 * vendor, not merely a landlord: F&B, network privileges, and operational
 * certainty carry real weight. Eligibility precedes scoring — a per-desk or
 * coworking product is never scored as private-office inventory.
 */
import { MANAGED_WEIGHTS, FNB_RUBRIC, MISSING_DATA_PENALTIES, DEFAULTS } from './config-defaults.mjs';
import { qualifiesPrivateOffice, privateOfficePrice } from './enums.mjs';
import { fourPriceModel } from './pricing.mjs';

export function fnbPoints(level) {
  const entry = FNB_RUBRIC.find((r) => r.level === level);
  return entry ? entry.points : 0;
}

/**
 * Score a managed candidate (provider + location + offer [+ latest quote]).
 * Returns { eligible:false } with reasons instead of a score when the offer
 * does not qualify as a confirmed enclosed private office.
 */
export function scoreManaged({ provider = {}, location = {}, offer = {}, quote = null }, { budget = DEFAULTS.budget_all_in_monthly } = {}) {
  const reasons = [];
  if (!qualifiesPrivateOffice(offer)) {
    if (offer.product_kind !== 'PRIVATE_OFFICE') reasons.push(`product_kind=${offer.product_kind} is not PRIVATE_OFFICE`);
    if (offer.enclosure_status !== 'CONFIRMED') reasons.push(`enclosure_status=${offer.enclosure_status} is not CONFIRMED`);
    if (!['CLOSEABLE_LOCKABLE', 'CLOSEABLE_UNKNOWN_LOCK'].includes(offer.door_status)) reasons.push(`door_status=${offer.door_status} has no closeable door`);
    return { eligible: false, reasons, clarification_required: true };
  }

  const components = [];
  const clarifications = [];
  const add = (key, points, max, note) => components.push({ component: key, points: Math.round(points * 100) / 100, max, note });

  // Economics (22): price basis is preserved; quoted price outranks sticker.
  const monthly = quote && typeof quote.quoted_price === 'number' && !['PER_PERSON', 'PER_DESK'].includes(quote.price_basis ?? offer.price_basis)
    ? quote.quoted_price
    : privateOfficePrice(offer);
  const fourPrice = fourPriceModel({
    sticker_price: monthly ?? offer.sticker_price,
    price_basis: quote?.price_basis ?? offer.price_basis,
    mandatory_recurring_fees: quote?.recurring_fees ?? offer.mandatory_recurring_fees ?? [],
    mandatory_one_time_fees: quote?.one_time_fees ?? [],
    free_months: quote?.free_months ?? 0,
    guaranteed_credits: quote?.guaranteed_credits ?? 0,
    prepay_option: quote?.prepay_options?.[0] ?? null,
    actual_avoided_costs_monthly: offer.actual_avoided_costs_monthly ?? 0,
    conservative_option_value_monthly: offer.conservative_option_value_monthly ?? 0,
  });
  let econPoints = 0;
  if (monthly === null || fourPrice.error) {
    clarifications.push(`Obtain a private-office price (current basis: ${offer.price_basis})`);
  } else {
    const effective = fourPrice.fluxology_effective;
    const ratio = effective / budget;
    if (ratio <= 0.75) econPoints = MANAGED_WEIGHTS.economics;
    else if (ratio <= 0.9) econPoints = 18;
    else if (ratio <= 1.0) econPoints = 14;
    else if (ratio <= 1.2) econPoints = 8;
    else if (ratio <= 1.4) econPoints = 3;
    if (offer.price_basis === 'STARTING_FROM' && !quote) {
      econPoints = Math.min(econPoints, 14);
      clarifications.push('Advertised price is a floor ("from"); confirm the actual one-person office quote');
    }
  }
  add('economics', econPoints, MANAGED_WEIGHTS.economics, fourPrice.error ? fourPrice.note : `fluxology_effective ≈ $${fourPrice.fluxology_effective}/mo vs target $${budget}`);

  // Private-office quality (16).
  let quality = 0;
  if (offer.door_status === 'CLOSEABLE_LOCKABLE') quality += 6;
  else { quality += 3; clarifications.push('Confirm the office door locks'); }
  if (typeof offer.usable_private_sqft === 'number') quality += offer.usable_private_sqft >= 100 ? 5 : offer.usable_private_sqft >= 70 ? 4 : 2;
  else clarifications.push('Confirm usable square footage of the private office');
  if (offer.window || offer.natural_light) quality += 2;
  if (offer.furnished !== false) quality += 3;
  add('office_quality', Math.min(quality, MANAGED_WEIGHTS.office_quality), MANAGED_WEIGHTS.office_quality, '');

  // Access & operational certainty (13): access and HVAC are separate facts.
  let certainty = 0;
  const access = location.access_basis ?? offer.access_basis ?? 'UNKNOWN';
  const hvac = location.hvac_basis ?? offer.hvac_basis ?? 'UNKNOWN';
  if (access === '24_7') certainty += 6;
  else if (access === 'EXTENDED') certainty += 3;
  else if (access === 'UNKNOWN') clarifications.push('Confirm 24/7 building access');
  if (hvac === '24_7_INCLUDED') certainty += 7;
  else if (hvac === '24_7_EXTRA_FEE') certainty += 5;
  else if (hvac === 'ON_REQUEST') certainty += 3;
  else if (hvac === 'BUSINESS_HOURS_ONLY') certainty += 1;
  else clarifications.push('Ask separately whether the suite is cooled during late nights and weekends');
  add('access_certainty', Math.min(certainty, MANAGED_WEIGHTS.access_certainty), MANAGED_WEIGHTS.access_certainty, `access=${access}, hvac=${hvac}`);

  // F&B (12): rubric level from the amenity profile.
  const fnbLevel = location.fnb_level ?? provider.fnb_level ?? null;
  const fnb = fnbLevel === null ? 0 : fnbPoints(fnbLevel);
  if (fnbLevel === null) clarifications.push('Establish the F&B program (coffee quality, snacks, breakfast, replenishment)');
  add('fnb', fnb, MANAGED_WEIGHTS.fnb, fnbLevel === null ? 'no F&B evidence' : FNB_RUBRIC.find((r) => r.level === fnbLevel).evidence);

  // Network privileges (10).
  let network = 0;
  if (provider.network_locations_count > 20) network += 6;
  else if (provider.network_locations_count > 3) network += 4;
  else if (provider.network_locations_count > 1) network += 2;
  if (provider.network_access_included === true) network += 4;
  else if (provider.network_access_included === undefined && provider.network_locations_count > 1) clarifications.push('Confirm network/reciprocal access included with the quoted office');
  add('network', Math.min(network, MANAGED_WEIGHTS.network), MANAGED_WEIGHTS.network, `${provider.network_locations_count ?? '?'} locations`);

  // Internet & technology (8).
  let tech = 0;
  if (offer.internet_included !== false) tech += 5;
  if (location.tech_amenities?.length) tech += 3;
  add('internet_tech', Math.min(tech, MANAGED_WEIGHTS.internet_tech), MANAGED_WEIGHTS.internet_tech, '');

  // Meeting/collaboration (6).
  let meeting = 0;
  if (typeof location.meeting_room_credits === 'number' && location.meeting_room_credits > 0) meeting += 4;
  if (location.meeting_rooms_onsite === true) meeting += 2;
  add('meeting', Math.min(meeting, MANAGED_WEIGHTS.meeting), MANAGED_WEIGHTS.meeting, '');

  // Mail/logistics (5).
  let mail = 0;
  if (location.mail_handling === true) mail += 3;
  if (location.package_acceptance === true) mail += 2;
  add('mail_logistics', Math.min(mail, MANAGED_WEIGHTS.mail_logistics), MANAGED_WEIGHTS.mail_logistics, '');

  // Location/access (5).
  let loc = 0;
  if (typeof location.final_walk_minutes === 'number' && location.final_walk_minutes <= 8) loc += 3;
  if (location.skateboard_practical === true) loc += 2;
  add('location', Math.min(loc, MANAGED_WEIGHTS.location), MANAGED_WEIGHTS.location, '');

  // Contract flexibility (3).
  let contract = 0;
  if (offer.month_to_month === true || offer.short_commitment === true) contract += 2;
  if (quote?.prepay_options?.length) contract += 1;
  add('contract_flexibility', Math.min(contract, MANAGED_WEIGHTS.contract_flexibility), MANAGED_WEIGHTS.contract_flexibility, '');

  const total = Math.round(components.reduce((s, c) => s + c.points, 0) * 10) / 10;
  return { eligible: true, total, components, four_price: fourPrice, clarifications };
}
