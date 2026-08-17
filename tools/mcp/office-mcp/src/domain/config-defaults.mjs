/**
 * Scoring configuration tables (SDD v2 §A3). These carry the v1 design values
 * verbatim but are data, not code: `office_score_explain` reports against
 * whatever tables the server was constructed with, and tests pin these
 * defaults. All weights per family sum to 100.
 */

export const CONVENTIONAL_WEIGHTS = {
  space: 24,
  access_hvac: 20,
  economics: 18,
  room_quality: 10,
  contract_flexibility: 10,
  transit: 8,
  internet_utilities: 5,
  mail_logistics: 3,
  amenities: 2,
};

/** Usable private area tiers → points (of CONVENTIONAL_WEIGHTS.space). */
export const AREA_TIERS = [
  { min: 400, points: 24 },
  { min: 300, points: 21 },
  { min: 220, points: 17 },
  { min: 160, points: 13 },
  { min: 120, points: 9 },
  { min: 80, points: 5 },
  { min: 0, points: 2 },
];

/**
 * Access × HVAC matrix → points (of CONVENTIONAL_WEIGHTS.access_hvac).
 * 24/7 access with unknown or business-hours AC is heavily penalized: 24/7
 * building rights without around-the-clock cooling is not 24/7 operability.
 */
export const ACCESS_HVAC_POINTS = {
  '24_7': { '24_7_INCLUDED': 20, '24_7_EXTRA_FEE': 16, ON_REQUEST: 12, UNKNOWN: 10, BUSINESS_HOURS_ONLY: 5 },
  EXTENDED: { '24_7_INCLUDED': 12, '24_7_EXTRA_FEE': 9, ON_REQUEST: 7, UNKNOWN: 6, BUSINESS_HOURS_ONLY: 3 },
  BUSINESS_HOURS: { '24_7_INCLUDED': 0, '24_7_EXTRA_FEE': 0, ON_REQUEST: 0, UNKNOWN: 0, BUSINESS_HOURS_ONLY: 0 },
  UNKNOWN: { '24_7_INCLUDED': 5, '24_7_EXTRA_FEE': 4, ON_REQUEST: 3, UNKNOWN: 0, BUSINESS_HOURS_ONLY: 0 },
};

export const MANAGED_WEIGHTS = {
  economics: 22,
  office_quality: 16,
  access_certainty: 13,
  fnb: 12,
  network: 10,
  internet_tech: 8,
  meeting: 6,
  mail_logistics: 5,
  location: 5,
  contract_flexibility: 3,
};

/** F&B rubric: points (of MANAGED_WEIGHTS.fnb) by program level. */
export const FNB_RUBRIC = [
  { level: 0, points: 0, evidence: 'No included beverages/food established.' },
  { level: 1, points: 2, evidence: 'Basic coffee/tea/water station only.' },
  { level: 2, points: 4, evidence: 'Good coffee/tea plus cold water/beverages; reliable replenishment.' },
  { level: 3, points: 7, evidence: 'Espresso-quality beverage program plus regular snacks.' },
  { level: 4, points: 10, evidence: 'Strong café program, broad snacks, recurring food/breakfast or comparable daily value.' },
  { level: 5, points: 12, evidence: 'Excellent high-use program: quality coffee/espresso, snacks, substantial breakfast/food, strong availability and replenishment.' },
];

/** Score deltas applied when decision-relevant fields are unknown (§A7). */
export const MISSING_DATA_PENALTIES = {
  hvac_unknown: { component: 'access_hvac', note: 'HVAC basis unknown: clarification required', clarification: 'Confirm after-hours HVAC/air-conditioning policy' },
  fees_unknown: { component: 'economics', factor: 0.6, note: 'Mandatory recurring fees unverified', clarification: 'Confirm all mandatory recurring fees for the all-in monthly cost' },
  area_unknown: { component: 'space', points: 2, note: 'Usable private area unknown: floor tier assumed', clarification: 'Confirm usable enclosed square footage of the private room' },
};

/** Usability multiplier bounds for awkward/shared/partly-unusable floor area. */
export const USABILITY_MULTIPLIER = { min: 0.85, max: 1.0 };

export const DEFAULTS = {
  region: 'GTA',
  currency: 'CAD',
  budget_all_in_monthly: 850,
  excerpt_max_chars: 2000,
  fetch_max_bytes: 2 * 1024 * 1024,
  fetch_timeout_ms: 20_000,
  fetch_min_interval_ms: 1_500,
  search_step_max_items: 25,
};
