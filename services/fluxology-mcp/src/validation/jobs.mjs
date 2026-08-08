/**
 * Jobs category rules (SDD §13.3).
 *
 * The connector deliberately does not calculate job fit. The skill supplies the
 * normalized ranking result and this module only enforces field bounds and
 * schema consistency.
 */
import { SERVER_OWNED_FIELDS } from '../schemas.mjs';
import { checkNonNegative, checkRecordBounds, checkUrls, requireText, withoutUndefined } from './common.mjs';

const MONEY_FIELDS = ['hourlyCadMin', 'hourlyCadMax', 'annualCadMin', 'annualCadMax'];
const URL_FIELDS = ['url'];

export const jobs = {
  scope: 'jobs',

  /** A stable id, or the documented `<source>-<sourceId>` derivation key. */
  resolveId(raw, limits) {
    const explicit = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (explicit) {
      if (explicit.length > limits.maxIdChars) return { error: `id: exceeds ${limits.maxIdChars} characters` };
      return { id: explicit };
    }
    const source = typeof raw?.source === 'string' ? raw.source.trim() : '';
    const sourceId = raw?.sourceId == null ? '' : String(raw.sourceId).trim();
    if (source && sourceId) {
      const derived = `${source}-${sourceId}`;
      if (derived.length > limits.maxIdChars) return { error: `id: derived id exceeds ${limits.maxIdChars} characters` };
      return { id: derived };
    }
    return { error: 'id: a jobs record requires a stable id, or both source and sourceId to derive one from' };
  },

  stripCallerOwned(raw) {
    const out = withoutUndefined(raw);
    for (const field of SERVER_OWNED_FIELDS) delete out[field];
    return out;
  },

  normalize(merged) {
    return merged;
  },

  check(merged, { isNew, limits }) {
    const errors = [
      ...checkRecordBounds(merged, limits),
      ...checkNonNegative(merged, [...MONEY_FIELDS, 'finalWalkMinutes']),
      ...checkUrls(merged, URL_FIELDS, limits),
    ];
    const warnings = [];

    if (isNew) {
      for (const field of ['title', 'company']) {
        const problem = requireText(merged, field, limits.maxNameChars);
        if (problem) errors.push(problem);
      }
    }

    if (merged.fitScore != null) {
      const score = merged.fitScore;
      if (typeof score !== 'number' || !Number.isFinite(score)) errors.push('fitScore: must be a finite number');
      else if (score < 0 || score > 100) errors.push('fitScore: must be between 0 and 100');
    }

    if (merged.tracks != null) {
      if (!Array.isArray(merged.tracks)) {
        errors.push('tracks: must be an array of strings');
      } else if (merged.tracks.length > limits.maxArrayItems) {
        errors.push(`tracks: exceeds ${limits.maxArrayItems} elements`);
      } else if (merged.tracks.some(track => typeof track !== 'string' || !track.trim() || track.length > limits.maxNameChars)) {
        errors.push(`tracks: every entry must be a non-empty string of at most ${limits.maxNameChars} characters`);
      }
    }

    const { hourlyCadMin, hourlyCadMax, annualCadMin, annualCadMax } = merged;
    if (typeof hourlyCadMin === 'number' && typeof hourlyCadMax === 'number' && hourlyCadMin > hourlyCadMax) {
      warnings.push('hourlyCadMin is greater than hourlyCadMax');
    }
    if (typeof annualCadMin === 'number' && typeof annualCadMax === 'number' && annualCadMin > annualCadMax) {
      warnings.push('annualCadMin is greater than annualCadMax');
    }

    return { errors, warnings };
  },
};
