/**
 * Release-blocking domain tests (SDD v2 §C2, carried from v1 §19.1):
 * product-type fidelity, price-basis preservation, access/HVAC separation,
 * area dominance, prepayment normalization, no double-counting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualifiesPrivateOffice, privateOfficePrice } from '../src/domain/enums.mjs';
import { scoreConventional, areaPoints, accessHvacPoints } from '../src/domain/scoring-conventional.mjs';
import { scoreManaged } from '../src/domain/scoring-managed.mjs';
import { fourPriceModel, normalizePrepayOption, conventionalEconomics } from '../src/domain/pricing.mjs';
import { CONVENTIONAL_WEIGHTS, MANAGED_WEIGHTS, FNB_RUBRIC, AREA_TIERS } from '../src/domain/config-defaults.mjs';

test('weight tables are internally consistent (sum to 100; rubric maxima match weights)', () => {
  assert.equal(Object.values(CONVENTIONAL_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.equal(Object.values(MANAGED_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.equal(Math.max(...FNB_RUBRIC.map((r) => r.points)), MANAGED_WEIGHTS.fnb);
  assert.equal(Math.max(...AREA_TIERS.map((t) => t.points)), CONVENTIONAL_WEIGHTS.space);
  assert.equal(accessHvacPoints('24_7', '24_7_INCLUDED'), CONVENTIONAL_WEIGHTS.access_hvac);
});

test('a $399/desk offer is never reported as a $399 private office', () => {
  const deskPricedOffer = {
    product_kind: 'PRIVATE_OFFICE',
    enclosure_status: 'CONFIRMED',
    door_status: 'CLOSEABLE_LOCKABLE',
    price_basis: 'PER_DESK',
    sticker_price: 399,
  };
  assert.equal(privateOfficePrice(deskPricedOffer), null);
  const scored = scoreManaged({ offer: deskPricedOffer });
  assert.equal(scored.eligible, true); // the room qualifies…
  assert.equal(scored.four_price.error, 'PRICE_BASIS_AMBIGUOUS'); // …but the desk price never becomes its price
  const econ = scored.components.find((c) => c.component === 'economics');
  assert.equal(econ.points, 0);
  assert.ok(scored.clarifications.some((c) => c.includes('private-office price')));
});

test('desk/coworking/virtual products can be stored but never pass private-office eligibility', () => {
  for (const kind of ['DEDICATED_DESK', 'HOT_DESK', 'COWORKING_MEMBERSHIP', 'VIRTUAL_OFFICE', 'MEETING_ROOM']) {
    const offer = { product_kind: kind, enclosure_status: 'CONFIRMED', door_status: 'CLOSEABLE_LOCKABLE' };
    assert.equal(qualifiesPrivateOffice(offer), false, kind);
    assert.equal(scoreManaged({ offer }).eligible, false, kind);
  }
  // Enclosure and door are independently required.
  assert.equal(qualifiesPrivateOffice({ product_kind: 'PRIVATE_OFFICE', enclosure_status: 'PROBABLE', door_status: 'CLOSEABLE_LOCKABLE' }), false);
  assert.equal(qualifiesPrivateOffice({ product_kind: 'PRIVATE_OFFICE', enclosure_status: 'CONFIRMED', door_status: 'NO_DOOR' }), false);
});

test('24/7 access with business-hours HVAC scores materially below confirmed 24/7 + 24/7 AC', () => {
  const base = { rent: 700, mandatory_recurring_fees: [], usable_private_sqft: 200, door_status: 'CLOSEABLE_LOCKABLE' };
  const both = scoreConventional({ ...base, access_basis: '24_7', hvac_basis: '24_7_INCLUDED' });
  const accessOnly = scoreConventional({ ...base, access_basis: '24_7', hvac_basis: 'BUSINESS_HOURS_ONLY' });
  const unknownHvac = scoreConventional({ ...base, access_basis: '24_7', hvac_basis: 'UNKNOWN' });
  assert.equal(both.components.find((c) => c.component === 'access_hvac').points, 20);
  assert.equal(accessOnly.components.find((c) => c.component === 'access_hvac').points, 5);
  assert.equal(unknownHvac.components.find((c) => c.component === 'access_hvac').points, 10);
  assert.ok(both.total - accessOnly.total >= 15, `expected material gap, got ${both.total} vs ${accessOnly.total}`);
  assert.ok(unknownHvac.clarifications.some((c) => c.toLowerCase().includes('hvac')));
});

test('a 350 sq ft office materially outranks a 100 sq ft office at the same all-in cost', () => {
  const base = { rent: 800, mandatory_recurring_fees: [], access_basis: '24_7', hvac_basis: '24_7_INCLUDED', door_status: 'CLOSEABLE_LOCKABLE' };
  const big = scoreConventional({ ...base, usable_private_sqft: 350 });
  const small = scoreConventional({ ...base, usable_private_sqft: 100 });
  assert.ok(big.total - small.total >= 12, `expected >=12 gap, got ${big.total} vs ${small.total}`);
  assert.equal(big.components.find((c) => c.component === 'space').points, 21);
  assert.equal(small.components.find((c) => c.component === 'space').points, 5);
  assert.equal(big.economics.cost_per_private_sqft, Math.round((800 / 350) * 100) / 100);
});

test('usability multiplier is bounded and never substitutes for usable area', () => {
  assert.equal(areaPoints(undefined), null);
  assert.equal(areaPoints(0), null);
  const adjusted = scoreConventional({ rent: 800, usable_private_sqft: 350, usability_multiplier: 0.5, usability_reason: 'L-shaped', door_status: 'CLOSEABLE_LOCKABLE' });
  assert.equal(adjusted.components.find((c) => c.component === 'space').points, Math.round(21 * 0.85 * 100) / 100); // clamped at 0.85
});

test('a 12-month upfront discount normalizes correctly into first-year effective price', () => {
  const prepay = normalizePrepayOption({ prepay_term_months: 12, prepay_total_cash: 8640, monthly_pay_price: 800 });
  assert.equal(prepay.nominal_discount, 960);
  assert.equal(prepay.effective_monthly_savings, 80);
  const model = fourPriceModel({ sticker_price: 800, price_basis: 'PER_OFFICE', prepay_option: prepay });
  assert.equal(model.contracted_cash_price, 800);
  assert.equal(model.first_year_effective, (800 * 12 - 960) / 12);
});

test('free months and waived fees are never double-counted with prepayment discounts', () => {
  const prepay = normalizePrepayOption({ prepay_term_months: 12, prepay_total_cash: 8640, monthly_pay_price: 800 });
  const model = fourPriceModel({
    sticker_price: 800,
    price_basis: 'PER_OFFICE',
    mandatory_one_time_fees: [{ kind: 'setup', amount: 240 }],
    free_months: 1,
    guaranteed_credits: 120,
    prepay_option: prepay,
  });
  // Each concession appears exactly once: (9600 + 240 − 800 − 120 − 960) / 12
  assert.equal(model.inputs.recurring_cash_12m, 9600);
  assert.equal(model.inputs.free_month_value, 800);
  assert.equal(model.inputs.prepayment_discount_value, 960);
  assert.equal(model.first_year_effective, Math.round(((9600 + 240 - 800 - 120 - 960) / 12) * 100) / 100);
});

test('managed scoring: STARTING_FROM price is treated as a floor, capped and flagged', () => {
  const offer = { product_kind: 'PRIVATE_OFFICE', enclosure_status: 'CONFIRMED', door_status: 'CLOSEABLE_LOCKABLE', price_basis: 'STARTING_FROM', sticker_price: 528, usable_private_sqft: 90 };
  const scored = scoreManaged({ offer, location: { access_basis: '24_7', hvac_basis: '24_7_INCLUDED', fnb_level: 4 }, provider: { network_locations_count: 100, network_access_included: true } });
  assert.equal(scored.eligible, true);
  assert.ok(scored.components.find((c) => c.component === 'economics').points <= 14);
  assert.ok(scored.clarifications.some((c) => c.includes('floor')));
});

test('unknown mandatory fees keep economics unverified', () => {
  const econ = conventionalEconomics({ rent: 750, mandatory_recurring_fees: [{ kind: 'internet' }, { kind: 'hst', monthly: 97.5 }] });
  assert.equal(econ.fees_known, false);
  assert.deepEqual(econ.unknown_fees, ['internet']);
  assert.equal(econ.all_in_monthly, 847.5); // known fees included; unknown ones flagged, not guessed at zero silently
});
