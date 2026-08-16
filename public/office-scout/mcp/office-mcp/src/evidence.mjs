/**
 * Evidence and provenance (SDD v2 §A2, §0.9). Every normalized field that can
 * influence a recommendation is backed by a SourceObservation answering
 * "which source stated that, when, with what confidence?" Web content is
 * hostile input: excerpts are tag-stripped, whitespace-collapsed, and capped;
 * raw content is retained only as hash-addressed evidence bytes.
 */
import { newId, sha256Hex, nowIso } from '../../mcp-core/ids.mjs';
import { assertEnum, EXTRACTION_METHOD, SOURCE_TYPE } from './domain/enums.mjs';
import { DEFAULTS } from './domain/config-defaults.mjs';

/** Strip markup/scripts and collapse whitespace for a display-safe excerpt. */
export function sanitizeExcerpt(html, maxChars = DEFAULTS.excerpt_max_chars) {
  if (typeof html !== 'string') return '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/**
 * Evidence precedence rank (SDD v2 §A2): lower is stronger. Within the same
 * source type, server-verified fetches outrank host-reported content.
 */
export function precedenceRank(observation) {
  const typeRank = { contract: 0, email: 1, provider_quote_page: 2, provider_page: 3, provider_terms_page: 3, third_party_listing: 4, search_snippet: 5, other: 5 };
  const methodRank = { server_fetch: 0, manual: 0.25, host_reported: 0.5 };
  return (typeRank[observation.source_type] ?? 5) + (methodRank[observation.extraction_method] ?? 0.5);
}

export function buildObservation({ url = null, message_ref = null, content = null, source_type, extraction_method, extracted = [], confidence = 'medium', fetched_at = null }) {
  assertEnum('source_type', source_type, SOURCE_TYPE);
  assertEnum('extraction_method', extraction_method, EXTRACTION_METHOD);
  if (!url && !message_ref) {
    throw Object.assign(new Error('an observation needs a url or message_ref'), { code: 'VALIDATION_FAILED' });
  }
  const raw = content ?? '';
  return {
    observation_id: newId('obs'),
    url,
    message_ref,
    fetched_at: fetched_at ?? nowIso(),
    content_hash: raw ? sha256Hex(raw) : null,
    excerpt: raw ? sanitizeExcerpt(raw) : null,
    source_type,
    extraction_method,
    extracted, // [{field, value, quote?}] — claims this source supports
    confidence,
  };
}

/** Persist an observation (and raw bytes when present) and return it. */
export function recordObservation(store, observationInput) {
  const observation = buildObservation(observationInput);
  if (observationInput.content) {
    observation.evidence_path = store.writeEvidence(observation.content_hash, observationInput.content);
  }
  store.appendEvent('observations', { type: 'observation', at: observation.fetched_at, data: observation });
  return observation;
}

export function readObservations(store, filter) {
  return store
    .readEvents('observations', (e) => e.type === 'observation')
    .map((e) => e.data)
    .filter((o) => (filter ? filter(o) : true));
}
