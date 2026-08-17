/**
 * Identifier and hashing primitives (SDD v2 §0.5, §A2).
 *
 * IDs are prefixed, time-ordered, URL-safe: `<prefix>_<10 char time><16 char random>`
 * in Crockford base32. Content hashes are SHA-256 over a canonical JSON encoding
 * with stable key order, so semantically identical payloads always hash equally.
 */
import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ms, chars) {
  let out = '';
  let value = ms;
  for (let i = 0; i < chars; i += 1) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(chars) {
  const bytes = randomBytes(chars);
  let out = '';
  for (let i = 0; i < chars; i += 1) out += CROCKFORD[bytes[i] % 32];
  return out;
}

export function newId(prefix) {
  if (!/^[a-z][a-z0-9]{1,15}$/.test(prefix)) throw new Error(`bad id prefix: ${prefix}`);
  return `${prefix}_${encodeTime(Date.now(), 10)}${encodeRandom(16)}`;
}

export function isId(value, prefix) {
  return typeof value === 'string' && new RegExp(`^${prefix}_[0-9A-Z]{26}$`).test(value);
}

/** Stable JSON: object keys sorted at every depth, no insignificant whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256Hex(input) {
  const data = typeof input === 'string' || Buffer.isBuffer(input) ? input : canonicalJson(input);
  return createHash('sha256').update(data).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}
