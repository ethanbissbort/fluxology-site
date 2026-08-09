/**
 * The category write pipeline (SDD §11, §12.2, §14, §15).
 *
 * Steps 1 and 2 — authenticate the OAuth token and authorize the required
 * category scope — happen in the tool dispatcher before this module is reached.
 * Everything from step 3 onward lives here:
 *
 *    3. validate the envelope
 *    4. validate observedAt
 *    5. fetch the current live feed
 *    6. resolve stable ids
 *    7. merge the incoming candidate onto the existing record
 *    8. validate the merged record against the canonical schema
 *    9. apply category business rules
 *   10. compute the material field diff
 *   11. drop unchanged records from the downstream batch
 *   12. map the tool to its downstream bearer secret  (dashboard-client)
 *   13. POST the changed records                      (dashboard-client)
 *   14. return a structured result
 *   15. emit a redacted structured log                (tool dispatcher)
 *
 * Preflight reconciliation exists because a model-generated partial update must
 * never be able to produce an invalid stored record through a shallow merge.
 */
import { randomUUID } from 'node:crypto';

import { ToolError } from './errors.mjs';
import { AUDIT_FIELDS, FRESHNESS_FIELD, SERVER_OWNED_FIELDS, checkSchemaDrift, formatAjvErrors } from './schemas.mjs';
import { CATEGORY_RULES } from './validation/index.mjs';
import {
  applyNullAsAbsent,
  changedFieldNames,
  fullyDifferent,
  isPlainObject,
  materiallyDifferent,
  normalizeSource,
  validateObservedAt,
} from './validation/common.mjs';

/** Keep `changedFields` bounded so a wide record cannot flood model context. */
const MAX_CHANGED_FIELDS = 50;

/** Cap the reconstruction record the connector logs for each changed listing. */
const MAX_BEFORE_IMAGE_RECORDS = 25;
const MAX_BEFORE_IMAGE_FIELDS = 30;
const MAX_BEFORE_IMAGE_CHARS = 300;

function boundedFields(names) {
  if (names.length <= MAX_CHANGED_FIELDS) return names;
  return [...names.slice(0, MAX_CHANGED_FIELDS), `+${names.length - MAX_CHANGED_FIELDS} more`];
}

function summaryText(scope, counts) {
  const parts = [];
  if (counts.created) parts.push(`${counts.created} created`);
  if (counts.updated) parts.push(`${counts.updated} updated`);
  if (counts.touched) parts.push(`${counts.touched} touched`);
  if (counts.unchanged) parts.push(`${counts.unchanged} unchanged`);
  if (counts.rejected) parts.push(`${counts.rejected} rejected`);
  const detail = parts.length ? parts.join(', ') : 'no records';
  return `${scope[0].toUpperCase()}${scope.slice(1)} upsert accepted: ${detail}.`;
}

/**
 * The prior value of every field this write changes, per record.
 *
 * The downstream audit entry stores only ids and counts, so before this existed
 * nothing anywhere could reconstruct what a bad write overwrote. Values are
 * serialised and clipped here rather than logged raw: this is a recovery aid,
 * not a copy of the feed.
 */
function beforeImage(entries) {
  const image = {};
  for (const { id, prior, changedFields } of entries.slice(0, MAX_BEFORE_IMAGE_RECORDS)) {
    if (!prior) {
      // Undoing a creation means removing the record, so there is no prior state
      // to keep — but "this id did not exist" is itself worth recording.
      image[id] = { '(new)': 'the record did not exist before this write' };
      continue;
    }
    const fields = {};
    for (const field of changedFields.slice(0, MAX_BEFORE_IMAGE_FIELDS)) {
      if (/^\+\d+ more$/.test(field)) continue;
      const serialized = JSON.stringify(prior[field]) ?? '(absent)';
      fields[field] = serialized.length > MAX_BEFORE_IMAGE_CHARS ? `${serialized.slice(0, MAX_BEFORE_IMAGE_CHARS)}…` : serialized;
    }
    image[id] = fields;
  }
  if (entries.length > MAX_BEFORE_IMAGE_RECORDS) image['+more'] = `${entries.length - MAX_BEFORE_IMAGE_RECORDS} further record(s) omitted`;
  return image;
}

/**
 * Unrecognised keys, split into "probably a typo" and "probably a new field".
 *
 * `additionalProperties` is deliberately `true` (SDD §24), which means a
 * misspelled ranking field used to be stored silently beside the real one: a
 * green `created` naming `landedCadPerlb` in changedFields while the dashboard
 * kept ranking on the untouched `landedCadPerLb`. A key that differs from a
 * canonical property by case alone is never additive evolution, so it is an
 * error; anything else is dropped with a warning rather than persisted.
 */
function classifyUnknownKeys(incoming, category) {
  const errors = [];
  const unknown = [];
  for (const key of Object.keys(incoming)) {
    if (category.knownProperties.has(key)) continue;
    const canonical = category.propertyByLowerName.get(key.toLowerCase());
    if (canonical) errors.push(`${key}: unknown field — did you mean "${canonical}"? Field names are case-sensitive`);
    else unknown.push(key);
  }
  return { errors, unknown };
}

export function createWritePipeline({ config, schemas, client, scopeGates }) {
  const limits = config.limits;

  async function runUpsert({ scope, envelope, requestId = randomUUID(), now = Date.now(), principal = null }) {
    const category = CATEGORY_RULES[scope];
    const auditFields = AUDIT_FIELDS[scope];

    /* 3. envelope ------------------------------------------------------- */
    const source = normalizeSource(envelope?.source, limits.maxSourceChars);
    if (!source.ok) throw new ToolError('VALIDATION_ERROR', source.reason, { scope, field: 'source' });

    const listings = envelope?.listings;
    if (!Array.isArray(listings) || listings.length === 0) {
      throw new ToolError('VALIDATION_ERROR', 'listings must be a non-empty array', { scope, field: 'listings' });
    }
    if (listings.length > limits.maxListingsPerWrite) {
      throw new ToolError('BATCH_TOO_LARGE', `at most ${limits.maxListingsPerWrite} listings may be sent per invocation`, {
        scope,
        received: listings.length,
        maximum: limits.maxListingsPerWrite,
      });
    }

    /* 4. observedAt ------------------------------------------------------ */
    const observed = validateObservedAt(envelope?.observedAt, {
      maxClockSkewMs: config.write.maxClockSkewMs,
      maxObservedAgeMs: config.write.maxObservedAgeMs,
      now,
    });
    if (!observed.ok) throw new ToolError('INVALID_TIMESTAMP', observed.reason, { scope, field: 'observedAt' });

    /* Serialise writes within a category; different categories run freely. */
    let releaseScope;
    try {
      releaseScope = await scopeGates.acquire(scope, limits.scopeLockTimeoutMs);
    } catch (err) {
      if (err?.code === 'ACQUIRE_TIMEOUT') {
        throw new ToolError('CONFLICT', `another ${scope} write is still in progress; retry shortly`, { scope });
      }
      throw err;
    }

    try {
      /* 5. current live feed --------------------------------------------- */
      const feed = await client.getFeed(scope, { revalidate: true });

      const drift = checkSchemaDrift(scope, feed, schemas);
      if (!drift.compatible) {
        throw new ToolError(
          'SCHEMA_VERSION_MISMATCH',
          `the live ${scope} feed reports schemaVersion ${String(drift.actual)} but this connector was built for ${String(drift.expected)}`,
          { scope, expected: drift.expected, actual: drift.actual },
        );
      }

      const working = new Map(feed.listings.map(listing => [String(listing?.id ?? ''), listing]));
      const categorySchema = schemas.categories[scope];
      const validateListing = categorySchema.validateListing;

      const results = [];
      /** id -> merged record queued for persistence (deduplicated within the batch). */
      const outbound = new Map();
      /** Prior values of every field this call changes, for the reconstruction log. */
      const priorImages = [];
      /** Existing, currently-active records this call would retire. */
      const deactivated = [];

      for (const [index, raw] of listings.entries()) {
        if (!isPlainObject(raw)) {
          results.push({ index, id: null, outcome: 'rejected', changedFields: [], reason: 'listing must be a JSON object' });
          continue;
        }

        /* 6. stable id --------------------------------------------------- */
        const resolved = category.resolveId(raw, limits);
        if (resolved.error) {
          results.push({ index, id: null, outcome: 'rejected', changedFields: [], reason: resolved.error });
          continue;
        }
        const id = resolved.id;
        const warnings = [...(resolved.warnings ?? [])];

        const prior = working.get(id) ?? null;
        const isNew = !prior;

        /* 7. merge ------------------------------------------------------- */
        const incoming = category.stripCallerOwned(raw);
        delete incoming.id;

        /*
         * 7a. unknown-property policy. A case-only near miss of a canonical
         * field is refused outright; any other unrecognised key is dropped
         * with a warning rather than persisted, so a model never gets a green
         * result for a write the dashboard will not read.
         */
        const unknownKeys = classifyUnknownKeys(incoming, categorySchema);
        if (unknownKeys.errors.length) {
          results.push({ index, id, outcome: 'rejected', changedFields: [], reason: unknownKeys.errors.join('; ') });
          continue;
        }
        if (unknownKeys.unknown.length) {
          for (const key of unknownKeys.unknown) delete incoming[key];
          warnings.push(
            `ignored ${unknownKeys.unknown.length} unrecognised field(s) — not stored: ${unknownKeys.unknown.slice(0, 10).join(', ')}`,
          );
        }

        /*
         * 7b. a required stored field may not be blanked by a partial update.
         * Ajv types most fields ["string","null"], so "" and null pass the
         * schema and would quietly hollow out a record the dashboard renders.
         * New records are left to the category rules, which say "is required on
         * a new record" — there is nothing to blank yet.
         */
        const blanked = isNew ? [] : categorySchema.requiredFields.filter(field => {
          if (!Object.prototype.hasOwnProperty.call(incoming, field)) return false;
          const value = incoming[field];
          return value === null || (typeof value === 'string' && !value.trim());
        });
        if (blanked.length) {
          results.push({
            index,
            id,
            outcome: 'rejected',
            changedFields: [],
            reason: blanked.map(field => `${field}: is required and must not be blanked with null or an empty string`).join('; '),
          });
          continue;
        }

        let merged = { ...(prior ?? {}), ...incoming, id };

        /* 7c. null on a ranking field means "unknown", which is stored as absent. */
        const nulled = applyNullAsAbsent({ incoming, prior, merged, fields: category.nullAsAbsentFields ?? [] });
        if (nulled.errors.length) {
          results.push({ index, id, outcome: 'rejected', changedFields: [], reason: nulled.errors.join('; ') });
          continue;
        }
        merged = nulled.merged;
        warnings.push(...nulled.warnings);

        /**
         * Stamp the category freshness field from the envelope, not from the
         * wall clock: a literal retry of the same envelope then produces a
         * byte-identical record and is suppressed (SDD §17.1).
         */
        if (config.write.stampObservedAt) {
          merged[FRESHNESS_FIELD[scope]] = observed.value;
        }

        merged = category.normalize(merged, { isNew, feedRoot: feed, limits });

        /* 8. canonical schema, on the complete merged record -------------- */
        if (!validateListing(merged)) {
          /*
           * A stored record that never passed through the connector (the GitHub
           * feed-sync bridge, or a direct curl) can be schema-invalid, and step
           * 8 validates the MERGED record — so every future partial update
           * re-inherits the defect. A caller can repair a normal field by
           * sending a valid value, but SERVER_OWNED_FIELDS are stripped from
           * caller input and can never be overwritten, which froze such a record
           * permanently. Drop the offending server-owned field and re-validate:
           * the connector and the Dashboard API own those fields anyway.
           */
          const offending = new Set(
            (validateListing.errors ?? [])
              .map(err => err.instancePath.split('/')[1])
              .filter(field => field && SERVER_OWNED_FIELDS.includes(field)),
          );
          const repairable = offending.size === (validateListing.errors ?? []).length && offending.size > 0;
          const repaired = repairable ? { ...merged } : null;
          if (repaired) for (const field of offending) delete repaired[field];

          if (repaired && validateListing(repaired)) {
            merged = repaired;
            warnings.push(
              `dropped ${[...offending].join(', ')} from this write: the stored value is invalid against the canonical schema and is server-owned, so the connector cannot repair it in place`,
            );
          } else {
            results.push({
              index,
              id,
              outcome: 'rejected',
              changedFields: [],
              reason: formatAjvErrors(validateListing.errors).join('; '),
            });
            continue;
          }
        }

        /* 9. category business rules -------------------------------------- */
        const checked = category.check(merged, { isNew, feedRoot: feed, limits });
        if (checked.errors.length) {
          results.push({ index, id, outcome: 'rejected', changedFields: [], reason: checked.errors.join('; ') });
          continue;
        }
        warnings.push(...checked.warnings);

        /* 10. material diff ------------------------------------------------ */
        let outcome;
        let changedFields = [];
        if (isNew) {
          outcome = 'created';
          changedFields = boundedFields(Object.keys(merged).filter(key => !auditFields.has(key)).sort());
        } else if (materiallyDifferent(prior, merged, auditFields)) {
          outcome = 'updated';
          changedFields = boundedFields(changedFieldNames(prior, merged, auditFields));
        } else if (fullyDifferent(prior, merged)) {
          outcome = 'touched';
        } else {
          outcome = 'unchanged';
        }

        /* 11. drop records that need no downstream write -------------------- */
        let persist = outcome === 'created' || outcome === 'updated';
        if (outcome === 'touched') {
          persist = config.write.sendTouchWrites;
          // Nothing was persisted, so do not claim the record was touched.
          if (!persist) outcome = 'unchanged';
        }

        if (persist) {
          outbound.set(id, merged);
          priorImages.push({ id, prior, changedFields: isNew ? [] : changedFields });
          if (prior && prior.active !== false && merged.active === false) deactivated.push(id);
        }
        working.set(id, merged);

        const entry = { index, id, outcome, changedFields };
        if (warnings.length) entry.warnings = warnings.slice(0, 5);
        results.push(entry);
      }

      const counts = {
        created: results.filter(r => r.outcome === 'created').length,
        updated: results.filter(r => r.outcome === 'updated').length,
        touched: results.filter(r => r.outcome === 'touched').length,
        unchanged: results.filter(r => r.outcome === 'unchanged').length,
        rejected: results.filter(r => r.outcome === 'rejected').length,
      };

      const base = {
        scope,
        source: source.value,
        requestId,
        observedAt: observed.value,
        received: listings.length,
        ...counts,
        // Nothing has been sent downstream yet, so nothing is persisted yet.
        persistence: 'none',
        results,
      };

      // Nothing at all was accepted: that is a failed call the caller must fix,
      // not a partial success.
      if (counts.rejected === listings.length) {
        throw new ToolError('VALIDATION_ERROR', `every ${scope} record was rejected`, { partial: base });
      }

      /* 11b. total feed size ---------------------------------------------- */
      const newIds = [...outbound.keys()].filter(id => !feed.listings.some(listing => String(listing?.id ?? '') === id));
      const projectedTotal = feed.listings.length + newIds.length;
      if (newIds.length && projectedTotal > limits.maxFeedListings) {
        throw new ToolError(
          'BATCH_TOO_LARGE',
          `the ${scope} feed holds ${feed.listings.length} records and this write would add ${newIds.length}, past the ${limits.maxFeedListings}-record ceiling; retire records with active:false or raise MCP_MAX_FEED_LISTINGS`,
          { scope, partial: base, currentTotal: feed.listings.length, maximum: limits.maxFeedListings },
        );
      }

      /* 12-13. persist ---------------------------------------------------- */
      let downstream = null;
      if (outbound.size) {
        try {
          const response = await client.upsert(scope, [...outbound.values()], { source: source.value, requestId, principal });
          downstream = {
            changed: Boolean(response?.changed),
            totalListings: Number.isFinite(response?.count) ? response.count : null,
          };
        } catch (err) {
          /*
           * The per-record outcomes were computed BEFORE this call, so shipping
           * them verbatim tells the model "created: 2" for records that may
           * never have been written — and produces a byte-identical payload
           * whether the write landed or not. Downgrade every candidate to an
           * explicitly unknown state instead: the connector genuinely cannot
           * tell a 5xx raised before the store was touched from one raised
           * after, so saying so is the only truthful option.
           */
          if (err instanceof ToolError) err.details = { ...err.details, partial: ambiguous(base, outbound) };
          throw err;
        }
      } else {
        downstream = { changed: false, totalListings: feed.listings.length };
      }

      /* 14. structured result --------------------------------------------- */
      return {
        structuredContent: { ok: true, ...base, persistence: outbound.size ? 'persisted' : 'none', downstream },
        text: summaryText(scope, counts),
        counts,
        changedIds: [...outbound.keys()],
        deactivatedIds: deactivated,
        beforeImage: beforeImage(priorImages),
      };
    } finally {
      releaseScope();
    }
  }

  return { runUpsert };
}

/**
 * Rewrite an optimistic pre-write report into an honest post-failure one.
 * Anything queued for persistence becomes `unknown`; anything the pipeline
 * rejected before the call stays rejected, because that verdict is still true.
 */
function ambiguous(base, outbound) {
  const results = base.results.map(entry =>
    outbound.has(entry.id)
      ? {
          ...entry,
          outcome: 'unknown',
          reason: 'the downstream write failed after this record was accepted: it may or may not have been persisted',
        }
      : entry,
  );
  const unknown = results.filter(entry => entry.outcome === 'unknown').length;
  return {
    ...base,
    created: 0,
    updated: 0,
    touched: 0,
    unchanged: results.filter(entry => entry.outcome === 'unchanged').length,
    unknown,
    persistence: 'unknown',
    results,
  };
}
