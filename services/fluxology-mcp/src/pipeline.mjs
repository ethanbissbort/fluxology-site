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
import { AUDIT_FIELDS, FRESHNESS_FIELD, checkSchemaDrift, formatAjvErrors } from './schemas.mjs';
import { CATEGORY_RULES } from './validation/index.mjs';
import {
  changedFieldNames,
  fullyDifferent,
  isPlainObject,
  materiallyDifferent,
  normalizeSource,
  validateObservedAt,
} from './validation/common.mjs';

/** Keep `changedFields` bounded so a wide record cannot flood model context. */
const MAX_CHANGED_FIELDS = 50;

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

export function createWritePipeline({ config, schemas, client, scopeGates }) {
  const limits = config.limits;

  async function runUpsert({ scope, envelope, requestId = randomUUID(), now = Date.now() }) {
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
      const validateListing = schemas.categories[scope].validateListing;

      const results = [];
      /** id -> merged record queued for persistence (deduplicated within the batch). */
      const outbound = new Map();

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
        let merged = { ...(prior ?? {}), ...incoming, id };

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
          results.push({
            index,
            id,
            outcome: 'rejected',
            changedFields: [],
            reason: formatAjvErrors(validateListing.errors).join('; '),
          });
          continue;
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

        if (persist) outbound.set(id, merged);
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
        results,
      };

      // Nothing at all was accepted: that is a failed call the caller must fix,
      // not a partial success.
      if (counts.rejected === listings.length) {
        throw new ToolError('VALIDATION_ERROR', `every ${scope} record was rejected`, { partial: base });
      }

      /* 12-13. persist ---------------------------------------------------- */
      let downstream = null;
      if (outbound.size) {
        try {
          const response = await client.upsert(scope, [...outbound.values()], { source: source.value, requestId });
          downstream = {
            changed: Boolean(response?.changed),
            totalListings: Number.isFinite(response?.count) ? response.count : null,
          };
        } catch (err) {
          if (err instanceof ToolError) err.details = { ...err.details, partial: base };
          throw err;
        }
      } else {
        downstream = { changed: false, totalListings: feed.listings.length };
      }

      /* 14. structured result --------------------------------------------- */
      return {
        structuredContent: { ok: true, ...base, downstream },
        text: summaryText(scope, counts),
        counts,
        changedIds: [...outbound.keys()],
      };
    } finally {
      releaseScope();
    }
  }

  return { runUpsert };
}
