/**
 * Canonical schema loading and compilation (SDD §12).
 *
 * `public/{office-scout,deals,jobs}/data/schema.json` stay canonical. The image
 * copies them at build time and this module compiles them with Ajv at startup,
 * so there is never a second hand-maintained copy of the feed contracts.
 *
 * Three compiled artefacts per category:
 *   feed    — the whole feed document, used by the drift gate;
 *   listing — `properties.listings.items` on its own, used to validate a
 *             *merged* record before it is allowed downstream (SDD §12.2);
 *   input   — a partial-update shape advertised to the model, derived from the
 *             canonical item schema with server-owned fields removed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { SCOPES } from './config.mjs';

/** Where each category's canonical schema lives inside `public/`. */
const REPO_SCHEMA_FILES = Object.freeze({
  office: path.join('office-scout', 'data', 'schema.json'),
  deals: path.join('deals', 'data', 'schema.json'),
  jobs: path.join('jobs', 'data', 'schema.json'),
});

/**
 * Fields the connector owns. Callers never supply them and they are stripped
 * from the advertised input schema (SDD §13.1 for priceHistory, §14 for the
 * audit timestamps).
 */
export const SERVER_OWNED_FIELDS = Object.freeze(['firstSeen', 'lastSeen', 'lastVerified', 'lastChanged', 'priceHistory']);

/**
 * The freshness field each category actually carries in its feed. Stamped from
 * the envelope's observedAt so "touched" is a meaningful outcome.
 */
export const FRESHNESS_FIELD = Object.freeze({
  office: 'lastVerified',
  deals: 'lastSeen',
  jobs: 'lastVerified',
});

/**
 * Fields excluded from the material-change comparison (SDD §14). These mirror
 * `DASHBOARDS[scope].freshnessFields` in services/dashboard-api/server.mjs so
 * the connector's "unchanged" verdict matches what the Dashboard API would do.
 */
export const AUDIT_FIELDS = Object.freeze({
  office: Object.freeze(new Set(['lastVerified', 'firstSeen', 'lastSeen', 'lastChanged', 'priceHistory'])),
  deals: Object.freeze(new Set(['firstSeen', 'lastSeen', 'lastChanged', 'lastVerified'])),
  jobs: Object.freeze(new Set(['firstSeen', 'lastVerified', 'lastSeen', 'lastChanged'])),
});

function resolveSchemaPath(scope, { schemaDir, repoSchemaDir }) {
  const packaged = path.join(schemaDir, `${scope}.json`);
  try {
    readFileSync(packaged);
    return packaged;
  } catch {
    return path.join(repoSchemaDir, REPO_SCHEMA_FILES[scope]);
  }
}

/** Version identifiers compare by leading major component: "2.5" and "2.9" match. */
export function majorVersion(value) {
  if (value == null) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d+)/);
  return match ? match[1] : text;
}

/**
 * Derive the schema version the canonical contract pins, preferring an explicit
 * `const` (deals and jobs both pin 3) and falling back to configuration.
 */
function declaredSchemaVersion(schema, fallback) {
  const node = schema?.properties?.schemaVersion;
  if (node && Object.prototype.hasOwnProperty.call(node, 'const')) return node.const;
  return fallback;
}

/**
 * Build the partial-update schema shown to the model. Same field names and
 * types as the canonical record so additive schema evolution flows through, but
 * with server-owned fields removed and the canonical `required` list dropped —
 * partial updates are merged onto the stored record before validation.
 */
function toInputSchema(itemSchema, scope) {
  const properties = {};
  for (const [key, value] of Object.entries(itemSchema.properties ?? {})) {
    if (SERVER_OWNED_FIELDS.includes(key)) continue;
    properties[key] = value;
  }
  return {
    type: 'object',
    // Office records always carry a caller-chosen stable id. Deals and jobs may
    // instead supply a derivation key, which the pipeline resolves and reports
    // on precisely, so the frozen tool snapshot stays free of `anyOf`.
    required: scope === 'office' ? ['id'] : [],
    properties,
    // Additive optional fields must keep flowing through (SDD §24).
    additionalProperties: true,
  };
}

export function loadSchemas(config) {
  const ajv = new Ajv2020({
    // The canonical schemas are authored for the dashboards, not for Ajv's
    // strict-mode conventions; validating them is the job, not policing style.
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
    validateFormats: true,
  });
  addFormats(ajv);

  const categories = {};

  for (const scope of SCOPES) {
    const file = resolveSchemaPath(scope, config);
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`cannot load canonical ${scope} schema from ${file}: ${err.message}`);
    }

    const itemSchema = raw?.properties?.listings?.items;
    if (!itemSchema || typeof itemSchema !== 'object') {
      throw new Error(`canonical ${scope} schema has no properties.listings.items`);
    }

    const standaloneItem = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...itemSchema };

    categories[scope] = {
      scope,
      file,
      title: raw.title ?? scope,
      source: raw,
      schemaVersion: declaredSchemaVersion(raw, config.expectedSchemaVersions[scope]),
      requiredFields: Object.freeze([...(itemSchema.required ?? [])]),
      validateFeed: ajv.compile(raw),
      validateListing: ajv.compile(standaloneItem),
      inputSchema: Object.freeze(toInputSchema(itemSchema, scope)),
    };
  }

  return {
    ajv,
    categories,
    /** Startup banner content for SDD §12.3. */
    describe() {
      return Object.fromEntries(
        SCOPES.map(scope => [
          scope,
          {
            title: categories[scope].title,
            schemaVersion: categories[scope].schemaVersion,
            file: categories[scope].file,
            expected: config.expectedSchemaVersions[scope],
          },
        ]),
      );
    },
  };
}

/**
 * Compare a live feed's declared version against the canonical contract.
 * A differing major version is "grossly incompatible" and fails readiness
 * rather than silently accepting data (SDD §12.3).
 */
export function checkSchemaDrift(scope, feed, schemas) {
  const expected = schemas.categories[scope].schemaVersion;
  const actual = feed?.schemaVersion;
  const compatible = majorVersion(expected) === majorVersion(actual);
  return {
    scope,
    expected,
    actual: actual ?? null,
    appVersion: feed?.appVersion ?? null,
    compatible,
  };
}

/** Format Ajv errors into short, model-actionable strings without leaking data values. */
export function formatAjvErrors(errors, limit = 8) {
  if (!Array.isArray(errors) || !errors.length) return ['schema validation failed'];
  return errors.slice(0, limit).map(err => {
    const where = err.instancePath ? err.instancePath.replace(/^\//, '').replace(/\//g, '.') : '(record)';
    const extra = err.keyword === 'additionalProperties' ? ` (${err.params?.additionalProperty})` : '';
    const missing = err.keyword === 'required' ? ` (${err.params?.missingProperty})` : '';
    return `${where}: ${err.message}${extra}${missing}`;
  });
}
