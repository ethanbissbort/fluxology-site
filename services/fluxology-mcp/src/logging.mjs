/**
 * Redacted structured logging (SDD §19.1, §25.1).
 *
 * One JSON object per line on stdout. Two independent defences keep secrets
 * out of the stream:
 *
 *   1. key-based redaction — any field whose name looks like a credential is
 *      replaced before serialisation;
 *   2. value-based scrubbing — literal secret values registered at startup are
 *      replaced wherever they appear, including inside error messages that
 *      were built by code we do not own.
 *
 * Callers are additionally expected never to hand full listing bodies to the
 * logger; `MAX_STRING` truncation bounds the damage if one slips through.
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

const SECRET_KEY_RE = /(authorization|auth[-_]?header|token|secret|password|passwd|credential|cookie|api[-_]?key|bearer|jwks|private[-_]?key)/i;

/** Field names that carry model-supplied listing content and must not be logged. */
const BODY_KEY_RE = /^(listings|listing|record|records|payload|body|notes|summary|calculation|priceHistory)$/;

const MAX_STRING = 512;
const MAX_ARRAY = 50;
const MAX_DEPTH = 6;

export const REDACTED = '[redacted]';

/** Registry of literal secret values to scrub out of any logged string. */
const knownSecrets = new Set();

/**
 * Register a literal secret so it is scrubbed from every future log line.
 * Very short values are ignored: scrubbing them would mangle unrelated text.
 */
export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 8) knownSecrets.add(value);
}

/** Testing hook. */
export function clearRegisteredSecrets() {
  knownSecrets.clear();
}

/** Replace every registered secret value inside a string. */
export function scrubText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  // Catch bearer material that was never registered (e.g. a caller's access token).
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`);
  return out;
}

function truncate(text) {
  const scrubbed = scrubText(text);
  return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed;
}

/**
 * Deep-copy a value with credentials removed, listing bodies dropped, and
 * strings/arrays bounded.
 */
export function redact(value, depth = 0) {
  if (value == null) return value ?? null;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: truncate(value.message), code: value.code ?? undefined };
  }
  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map(item => redact(item, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY} more]`);
    return items;
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      if (BODY_KEY_RE.test(key)) {
        out[key] = Array.isArray(item) ? `[${item.length} item(s) omitted]` : '[omitted]';
        continue;
      }
      out[key] = redact(item, depth + 1);
    }
    return out;
  }

  return String(value);
}

export function createLogger({ level = 'info', service = 'fluxology-mcp', version = '1.0.0', sink = console } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(levelName, event, fields) {
    if ((LEVELS[levelName] ?? LEVELS.info) < threshold) return;
    const line = {
      at: new Date().toISOString(),
      level: levelName,
      service,
      version,
      event,
      ...redact(fields ?? {}),
    };
    let text;
    try {
      text = JSON.stringify(line);
    } catch {
      text = JSON.stringify({ at: line.at, level: 'error', service, version, event: 'log_serialization_failed', originalEvent: event });
    }
    if (levelName === 'error' || levelName === 'warn') sink.error(text);
    else sink.log(text);
  }

  return {
    level,
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
