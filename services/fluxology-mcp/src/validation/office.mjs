/**
 * Office Scout category rules (SDD §13.1).
 *
 * The invariant that matters most: a record may only be presented as
 * cost-verified when every mandatory recurring charge is actually known and the
 * resulting all-in figure sits under the search's hard ceiling. Unknown costs
 * stay unknown.
 */
import { SERVER_OWNED_FIELDS } from '../schemas.mjs';
import { checkNonNegative, checkRecordBounds, checkUrls, withoutUndefined } from './common.mjs';

const MONEY_FIELDS = ['askingRent', 'estimatedAllInMonthly'];
const URL_FIELDS = ['sourceUrl'];

export const office = {
  scope: 'office',

  /** Office records always carry a caller-chosen stable id. */
  resolveId(raw, limits) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (!id) return { error: 'id: an office record requires a stable id' };
    if (id.length > limits.maxIdChars) return { error: `id: exceeds ${limits.maxIdChars} characters` };
    return { id };
  },

  /**
   * priceHistory is not caller-authoritative (SDD §13.1): it is stripped here
   * so the Dashboard API's existing preserve/append logic stays in charge.
   * The audit timestamps are stripped for the same reason (SDD §14).
   */
  stripCallerOwned(raw) {
    const out = withoutUndefined(raw);
    for (const field of SERVER_OWNED_FIELDS) delete out[field];
    return out;
  },

  normalize(merged) {
    return merged;
  },

  check(merged, { isNew, feedRoot, limits }) {
    const errors = [
      ...checkRecordBounds(merged, limits),
      ...checkNonNegative(merged, [...MONEY_FIELDS, 'finalWalkMinutes']),
      ...checkUrls(merged, URL_FIELDS, limits),
    ];
    const warnings = [];

    if (merged.costStatus === 'verified') {
      if (merged.mandatoryFeesKnown !== true) {
        errors.push('costStatus: "verified" requires mandatoryFeesKnown:true');
      }
      const allIn = merged.estimatedAllInMonthly;
      if (typeof allIn !== 'number' || !Number.isFinite(allIn)) {
        errors.push('estimatedAllInMonthly: a verified record requires a finite all-in monthly cost');
      } else {
        const ceiling = feedRoot?.hardAllInCeilingCad;
        if (typeof ceiling !== 'number' || !Number.isFinite(ceiling)) {
          errors.push('hardAllInCeilingCad: the live office feed has no usable ceiling, so a verified record cannot be accepted');
        } else if (allIn > ceiling) {
          errors.push(`estimatedAllInMonthly: ${allIn} exceeds the hard all-in ceiling of ${ceiling}`);
        }
      }
    }

    if (isNew && merged.mandatoryFeesKnown === undefined) {
      errors.push('mandatoryFeesKnown: is required on a new office record');
    }

    if (merged.costStatus === 'verified' && merged.active === false) {
      warnings.push('record is marked verified but inactive; the dashboard will hide it');
    }

    return { errors, warnings };
  },
};
