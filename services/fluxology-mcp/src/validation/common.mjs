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

/** Deterministic serialisation, identical in spirit to the Dashboard API's. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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

/** Drop `undefined` so a partial update never blanks a stored field by accident. */
export function withoutUndefined(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
