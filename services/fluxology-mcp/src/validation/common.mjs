/**
 * Shared record validation and diffing (SDD §13.4, §14).
 *
 * Everything here treats listing content as opaque, untrusted data. Strings are
 * bounded and checked for control characters; nothing is rendered, executed, or
 * dereferenced. A `sourceUrl` is validated for shape only — the connector never
 * fetches it (SDD §25.3, §25.4).
 */

/** Field-name buckets that decide which length limit applies. */
const ID_FIELDS = new Set(['id', 'itemId', 'sourceId']);
const URL_FIELDS = new Set(['url', 'imageUrl', 'sourceUrl']);
const TEXT_FIELDS = new Set(['notes', 'summary', 'calculation', 'mandatoryFeeNotes', 'skateboardNote', 'salaryText']);

const MAX_OBJECT_DEPTH = 8;
const MAX_FIELDS_PER_RECORD = 200;

/** C0 control characters other than tab, newline and carriage return. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Token for a key that is absent (or explicitly `undefined`).
 *
 * `JSON.stringify(undefined)` is `undefined`, so the previous `?? 'null'`
 * fallback collapsed "the record has no such field" and "the record has this
 * field, set to null" onto the same string. That made absent -> null invisible
 * to the material diff, and absent -> null is exactly the mutation that flips a
 * dashboard badge (`Number(null) === 0`). A bare `undefined` cannot collide
 * with any JSON output: `JSON.stringify('undefined')` is `"undefined"`, quoted.
 */
const ABSENT = 'undefined';

/** Deterministic serialisation, identical in spirit to the Dashboard API's. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? ABSENT;
}

/** Field names whose values differ, ignoring server-owned audit fields. */
export function changedFieldNames(before, after, auditFields) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed = [];
  for (const key of keys) {
    if (auditFields.has(key)) continue;
    if (stableStringify(before?.[key]) !== stableStringify(after?.[key])) changed.push(key);
  }
  return changed.sort();
}

/** True when at least one non-audit field differs (SDD §14 "updated"). */
export function materiallyDifferent(before, after, auditFields) {
  return changedFieldNames(before, after, auditFields).length > 0;
}

/** True when any field at all differs, audit fields included (SDD §14 "touched"). */
export function fullyDifferent(before, after) {
  return stableStringify(before) !== stableStringify(after);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** http(s) only, bounded length, parseable (SDD §13.1-13.3). */
export function isHttpUrl(value, maxChars) {
  if (typeof value !== 'string' || !value || value.length > maxChars) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/** Envelope `source` label: bounded and safe for the downstream audit header. */
export function normalizeSource(value, maxChars) {
  if (typeof value !== 'string') return { ok: false, reason: 'source must be a string' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: 'source must not be empty' };
  if (trimmed.length > maxChars) return { ok: false, reason: `source must be at most ${maxChars} characters` };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(trimmed)) {
    return { ok: false, reason: 'source may contain only letters, digits and . _ : @ / -, and must start with a letter or digit' };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate the envelope's `observedAt` (SDD §11 step 4).
 * Rejects unparseable values, values from the future beyond the allowed clock
 * skew, and values older than the configured horizon.
 */
export function validateObservedAt(value, { maxClockSkewMs, maxObservedAgeMs, now = Date.now() }) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, reason: 'observedAt must be an ISO 8601 timestamp string' };
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return { ok: false, reason: `observedAt is not a parseable timestamp: ${value.slice(0, 40)}` };
  if (parsed - now > maxClockSkewMs) {
    return { ok: false, reason: `observedAt is more than ${Math.round(maxClockSkewMs / 1000)}s in the future` };
  }
  if (now - parsed > maxObservedAgeMs) {
    return { ok: false, reason: `observedAt is older than the ${Math.round(maxObservedAgeMs / 86_400_000)}-day ingestion horizon` };
  }
  return { ok: true, value: new Date(parsed).toISOString(), epochMs: parsed };
}

function limitForField(name, limits) {
  if (ID_FIELDS.has(name)) return limits.maxIdChars;
  if (URL_FIELDS.has(name)) return limits.maxUrlChars;
  if (TEXT_FIELDS.has(name)) return limits.maxTextChars;
  return limits.maxNameChars;
}

/**
 * Walk a record enforcing the string, array, depth and breadth limits from
 * SDD §13.4 and §25.5. Returns a list of human-readable problems.
 */
export function checkRecordBounds(record, limits) {
  const errors = [];

  const walk = (value, pathParts, depth, fieldName) => {
    if (errors.length >= 12) return;
    if (depth > MAX_OBJECT_DEPTH) {
      errors.push(`${pathParts.join('.') || '(record)'}: nested more than ${MAX_OBJECT_DEPTH} levels deep`);
      return;
    }

    if (typeof value === 'string') {
      const max = limitForField(fieldName, limits);
      if (value.length > max) errors.push(`${pathParts.join('.')}: exceeds ${max} characters`);
      if (CONTROL_CHARS.test(value)) errors.push(`${pathParts.join('.')}: contains control characters`);
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > limits.maxArrayItems) {
        errors.push(`${pathParts.join('.')}: exceeds ${limits.maxArrayItems} elements`);
        return;
      }
      value.forEach((item, index) => walk(item, [...pathParts, String(index)], depth + 1, fieldName));
      return;
    }

    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.length > MAX_FIELDS_PER_RECORD) {
        errors.push(`${pathParts.join('.') || '(record)'}: has more than ${MAX_FIELDS_PER_RECORD} fields`);
        return;
      }
      for (const key of keys) {
        if (key.length > 120) {
          errors.push(`${[...pathParts, key].join('.')}: field name is too long`);
          continue;
        }
        walk(value[key], [...pathParts, key], depth + 1, key);
      }
    }
  };

  walk(record, [], 0, '(record)');
  return errors;
}

/** Numeric field must be absent, null, or a finite non-negative number. */
export function checkNonNegative(record, fields) {
  const errors = [];
  for (const field of fields) {
    const value = record[field];
    if (value == null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${field}: must be a finite number`);
    } else if (value < 0) {
      errors.push(`${field}: must not be negative`);
    }
  }
  return errors;
}

/** Optional URL fields must be http(s) when present. */
export function checkUrls(record, fields, limits) {
  const errors = [];
  for (const field of fields) {
    const value = record[field];
    if (value == null || value === '') continue;
    if (!isHttpUrl(value, limits.maxUrlChars)) errors.push(`${field}: must be an http(s) URL of at most ${limits.maxUrlChars} characters`);
  }
  return errors;
}

/** Non-empty, bounded string, used for fields a new record cannot omit. */
export function requireText(record, field, maxChars) {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) return `${field}: is required on a new record`;
  if (value.length > maxChars) return `${field}: exceeds ${maxChars} characters`;
  return null;
}

/**
 * Ranking fields where an explicit `null` must never be stored.
 *
 * Every validation layer reads `null` as "unknown", but every dashboard reads
 * it as zero: `Number(null) === 0` passes `Number.isFinite`, so a null landed
 * cost becomes `$0.00/lb` and wins the "≤ $8/LB" badge, a null fit score sorts
 * as 0, and `{mandatoryFeesKnown:true, estimatedAllInMonthly:null}` renders
 * "VERIFIED ≤ $850" next to "Unknown". An ABSENT field already degrades
 * correctly on all three dashboards, so `null` is normalised to absent here and
 * the two layers finally agree.
 */
export const NULL_AS_ABSENT_FIELDS = Object.freeze({
  office: Object.freeze(['estimatedAllInMonthly']),
  deals: Object.freeze(['landedCadPerLb']),
  jobs: Object.freeze(['fitScore', 'finalWalkMinutes']),
});

/**
 * Apply the null-is-absent rule to one merged record.
 *
 * A null for a field the stored record does not have is dropped: the result is
 * the "unknown" the caller meant. A null for a field that *does* have a stored
 * value is refused, because the Dashboard API merges per id with a shallow
 * spread — omitting the key there restores the stored value, so accepting the
 * null would report a change the store would silently undo.
 */
export function applyNullAsAbsent({ incoming, prior, merged, fields }) {
  if (!fields?.length) return { merged, warnings: [], errors: [] };
  const warnings = [];
  const errors = [];
  let out = merged;

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(incoming ?? {}, field) || incoming[field] !== null) continue;
    if (prior?.[field] != null) {
      errors.push(
        `${field}: null cannot clear a stored value — omit the field to leave it unchanged, or send the number you observed`,
      );
      continue;
    }
    if (out === merged) out = { ...merged };
    delete out[field];
    warnings.push(`${field}: null was stored as an absent field, because the dashboards read null as zero and absent as unknown`);
  }

  return { merged: out, warnings, errors };
}

/** An ISO 8601 instant with an explicit offset, or an unambiguous calendar date. */
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate and normalise a caller-supplied record timestamp.
 *
 * A timezone-less value is refused rather than guessed at: the browser parses
 * `"2026-08-09 20:00"` as *local* time, which silently moves the deals auction
 * countdown by the viewer's UTC offset (four hours under America/Toronto).
 * A date-only value is unambiguous by specification (UTC midnight) and is kept.
 */
export function normalizeTimestampField(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, reason: 'must be an ISO 8601 timestamp string' };
  }
  const trimmed = value.trim();
  if (!OFFSET_TIMESTAMP.test(trimmed) && !DATE_ONLY.test(trimmed)) {
    return {
      ok: false,
      reason: 'must be an ISO 8601 timestamp with an explicit UTC offset, for example 2026-08-09T20:00:00-04:00 or 2026-08-10T00:00:00Z',
    };
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return { ok: false, reason: `is not a parseable timestamp: ${trimmed.slice(0, 40)}` };
  return { ok: true, value: new Date(parsed).toISOString() };
}

/** Normalise every declared temporal field in place-ish, returning a new record when needed. */
export function normalizeTimestamps(merged, fields) {
  let out = merged;
  for (const field of fields) {
    const value = merged[field];
    if (value == null) continue;
    const normalized = normalizeTimestampField(value);
    if (!normalized.ok) continue; // reported by checkTimestamps, which runs at step 9
    if (normalized.value === value) continue;
    if (out === merged) out = { ...merged };
    out[field] = normalized.value;
  }
  return out;
}

/** Reject temporal fields the connector cannot place on a timeline. */
export function checkTimestamps(record, fields) {
  const errors = [];
  for (const field of fields) {
    const value = record[field];
    if (value == null) continue;
    const normalized = normalizeTimestampField(value);
    if (!normalized.ok) errors.push(`${field}: ${normalized.reason}`);
  }
  return errors;
}

/** Drop `undefined` so a partial update never blanks a stored field by accident. */
export function withoutUndefined(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
