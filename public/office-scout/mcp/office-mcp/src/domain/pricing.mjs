/**
 * Pricing math (SDD v2 §A4): conventional all-in economics and the managed
 * four-price model, including prepayment normalization (§A8).
 *
 * Free months, waived fees, credits, and prepayment discounts each enter the
 * first-year total exactly once; `first_year_effective` divides by 12 with
 * free months entering as value, never by shrinking the divisor.
 */

export function conventionalEconomics({ rent, mandatory_recurring_fees = [], usable_private_sqft = null }) {
  const feeTotal = mandatory_recurring_fees.reduce((sum, fee) => sum + (typeof fee.monthly === 'number' ? fee.monthly : 0), 0);
  const unknownFees = mandatory_recurring_fees.filter((fee) => typeof fee.monthly !== 'number').map((fee) => fee.kind);
  const allIn = typeof rent === 'number' ? rent + feeTotal : null;
  return {
    all_in_monthly: allIn,
    fees_known: unknownFees.length === 0,
    unknown_fees: unknownFees,
    cost_per_private_sqft:
      allIn !== null && typeof usable_private_sqft === 'number' && usable_private_sqft > 0
        ? Math.round((allIn / usable_private_sqft) * 100) / 100
        : null,
  };
}

/**
 * Normalize a prepayment option against the same-term monthly-pay total.
 * `nominal_discount` is the cash difference; `effective_monthly_savings`
 * spreads it over the prepaid term.
 */
export function normalizePrepayOption({ prepay_term_months, prepay_total_cash, monthly_pay_price }) {
  if (![6, 12, 18].includes(prepay_term_months) && !(Number.isInteger(prepay_term_months) && prepay_term_months > 0)) {
    throw Object.assign(new Error('prepay_term_months must be a positive integer (typically 6, 12, or 18)'), { code: 'VALIDATION_FAILED' });
  }
  const sameTermMonthlyTotal = monthly_pay_price * prepay_term_months;
  const nominal = sameTermMonthlyTotal - prepay_total_cash;
  return {
    prepay_term_months,
    prepay_total_cash,
    nominal_discount: Math.round(nominal * 100) / 100,
    effective_monthly_savings: Math.round((nominal / prepay_term_months) * 100) / 100,
  };
}

/**
 * Managed four-price model. `contracted_cash_price` = sticker + mandatory
 * recurring; `first_year_effective` folds one-time fees and all concessions;
 * `fluxology_effective` subtracts conservative avoided costs and
 * probability-weighted option value.
 */
export function fourPriceModel({
  sticker_price,
  price_basis,
  mandatory_recurring_fees = [],
  mandatory_one_time_fees = [],
  free_months = 0,
  guaranteed_credits = 0,
  prepay_option = null,
  actual_avoided_costs_monthly = 0,
  conservative_option_value_monthly = 0,
}) {
  if (price_basis === 'PER_PERSON' || price_basis === 'PER_DESK') {
    return { error: 'PRICE_BASIS_AMBIGUOUS', note: 'Per-person/per-desk pricing is never normalized into a private-office price.' };
  }
  if (typeof sticker_price !== 'number') {
    return { error: 'PRICE_BASIS_AMBIGUOUS', note: `No numeric sticker price (basis ${price_basis}).` };
  }
  const recurringFees = mandatory_recurring_fees.reduce((s, f) => s + (f.monthly ?? 0), 0);
  const oneTimeFees = mandatory_one_time_fees.reduce((s, f) => s + (f.amount ?? 0), 0);
  const contracted = sticker_price + recurringFees;
  const recurringCash12m = contracted * 12;
  const freeMonthValue = free_months * contracted;
  const prepayDiscount = prepay_option ? Math.max(0, prepay_option.nominal_discount ?? 0) : 0;

  const firstYearEffective = (recurringCash12m + oneTimeFees - freeMonthValue - guaranteed_credits - prepayDiscount) / 12;
  const fluxologyEffective = firstYearEffective - actual_avoided_costs_monthly - conservative_option_value_monthly;

  const round = (n) => Math.round(n * 100) / 100;
  return {
    sticker_price,
    price_basis,
    contracted_cash_price: round(contracted),
    first_year_effective: round(firstYearEffective),
    fluxology_effective: round(fluxologyEffective),
    inputs: {
      recurring_cash_12m: round(recurringCash12m),
      mandatory_one_time_fees: round(oneTimeFees),
      free_month_value: round(freeMonthValue),
      guaranteed_credits: round(guaranteed_credits),
      prepayment_discount_value: round(prepayDiscount),
      actual_avoided_costs_monthly: round(actual_avoided_costs_monthly),
      conservative_option_value_monthly: round(conservative_option_value_monthly),
    },
  };
}
