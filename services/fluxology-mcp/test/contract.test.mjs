/**
 * Contract tests (SDD §26.2).
 *
 * For each category: load the canonical JSON Schema, prove that representative
 * existing records and new records validate, prove that a partial update
 * merged onto a stored record validates, and prove that malformed records are
 * rejected before anything reaches the Dashboard API.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSchemas } from '../src/schemas.mjs';
import { DEAL_RECORD, JOB_RECORD, OFFICE_RECORD, buildPipeline, envelope, testConfig } from './helpers/fixtures.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const config = testConfig();
const schemas = loadSchemas(config);

const CATEGORIES = [
  { scope: 'office', dir: 'office-scout', record: OFFICE_RECORD },
  { scope: 'deals', dir: 'deals', record: DEAL_RECORD },
  { scope: 'jobs', dir: 'jobs', record: JOB_RECORD },
];

function feedsWith(scope, listings, extra = {}) {
  const base = {
    office: { schemaVersion: '2.5', appVersion: '2.5.0', generatedAt: '2026-08-01T00:00:00Z', hardAllInCeilingCad: 850, listings: [] },
    deals: { schemaVersion: 3, appVersion: '3.0', generatedAt: '2026-08-01T00:00:00Z', currency: 'CAD', listings: [] },
    jobs: { schemaVersion: 3, appVersion: '3.0', generatedAt: '2026-08-01T00:00:00Z', currency: 'CAD', listings: [] },
  };
  base[scope] = { ...base[scope], ...extra, listings };
  return base;
}

describe('canonical schemas load from the repository contracts', () => {
  it('compiles all three feed contracts', () => {
    for (const { scope } of CATEGORIES) {
      assert.equal(typeof schemas.categories[scope].validateFeed, 'function');
      assert.equal(typeof schemas.categories[scope].validateListing, 'function');
    }
  });

  it('validates the checked-in bootstrap snapshots against their own schemas', () => {
    for (const { scope, dir } of CATEGORIES) {
      const snapshot = JSON.parse(readFileSync(path.join(REPO_ROOT, 'public', dir, 'data', 'listings.json'), 'utf8'));
      const valid = schemas.categories[scope].validateFeed(snapshot);
      assert.equal(valid, true, `${scope} snapshot: ${JSON.stringify(schemas.categories[scope].validateFeed.errors)}`);
    }
  });

  it('validates every stored record against the standalone item schema', () => {
    for (const { scope, dir } of CATEGORIES) {
      const snapshot = JSON.parse(readFileSync(path.join(REPO_ROOT, 'public', dir, 'data', 'listings.json'), 'utf8'));
      for (const listing of snapshot.listings) {
        const valid = schemas.categories[scope].validateListing(listing);
        assert.equal(valid, true, `${scope}/${listing.id}: ${JSON.stringify(schemas.categories[scope].validateListing.errors)}`);
      }
    }
  });

  it('never advertises a server-owned field on the write tool input', () => {
    for (const { scope } of CATEGORIES) {
      const properties = Object.keys(schemas.categories[scope].inputSchema.properties);
      for (const field of ['priceHistory', 'lastChanged', 'lastSeen', 'lastVerified', 'firstSeen']) {
        assert.equal(properties.includes(field), false, `${scope} advertises ${field}`);
      }
    }
  });

  it('keeps the input schema open to additive canonical fields', () => {
    for (const { scope } of CATEGORIES) {
      assert.equal(schemas.categories[scope].inputSchema.additionalProperties, true);
    }
  });

  it('prefers the schemas the image packages over the repository copies', () => {
    // The container copies public/*/data/schema.json to /app/schemas/<scope>.json
    // at build time. Prove that layout resolves, so the image is not silently
    // depending on a repository checkout that will not exist at runtime.
    const packaged = mkdtempSync(path.join(os.tmpdir(), 'fluxology-mcp-schemas-'));
    try {
      for (const { scope, dir } of CATEGORIES) {
        copyFileSync(path.join(REPO_ROOT, 'public', dir, 'data', 'schema.json'), path.join(packaged, `${scope}.json`));
      }
      const packagedSchemas = loadSchemas(testConfig({ MCP_SCHEMA_DIR: packaged }));
      for (const { scope } of CATEGORIES) {
        assert.equal(packagedSchemas.categories[scope].file, path.join(packaged, `${scope}.json`));
        assert.equal(packagedSchemas.categories[scope].schemaVersion, schemas.categories[scope].schemaVersion);
      }
    } finally {
      rmSync(packaged, { recursive: true, force: true });
    }
  });
});

describe('office contract', () => {
  it('accepts a new record that satisfies the canonical required fields', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('office', []) });
    const result = await pipeline.runUpsert({ scope: 'office', envelope: envelope([{ ...OFFICE_RECORD }]) });
    assert.equal(result.structuredContent.created, 1);
    assert.equal(client.upserts.length, 1);
    assert.equal(client.upserts[0].listings[0].id, OFFICE_RECORD.id);
  });

  it('rejects a new record that is missing canonical required fields', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('office', []) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'office', envelope: envelope([{ id: 'partial-only', operator: 'Regus' }]) }),
      err => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        const [record] = err.details.partial.results;
        assert.equal(record.outcome, 'rejected');
        assert.match(record.reason, /must have required property/);
        return true;
      },
    );
    assert.equal(client.upserts.length, 0);
  });

  it('accepts a partial update once merged with the stored record', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('office', [{ ...OFFICE_RECORD }]) });
    const result = await pipeline.runUpsert({
      scope: 'office',
      envelope: envelope([{ id: OFFICE_RECORD.id, askingRent: 640 }]),
    });
    assert.equal(result.structuredContent.updated, 1);
    const sent = client.upserts[0].listings[0];
    // Fields the caller omitted survive the merge.
    assert.equal(sent.operator, 'Regus');
    assert.equal(sent.municipality, 'Toronto');
    assert.equal(sent.askingRent, 640);
  });

  it('rejects a partial update that would make the stored record invalid', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('office', [{ ...OFFICE_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'office', envelope: envelope([{ id: OFFICE_RECORD.id, mandatoryFeesKnown: 'yes' }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /mandatoryFeesKnown/);
        return true;
      },
    );
    assert.equal(client.upserts.length, 0);
  });

  it('rejects an unknown costStatus value', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('office', [{ ...OFFICE_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'office', envelope: envelope([{ id: OFFICE_RECORD.id, costStatus: 'probably-fine' }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /costStatus/);
        return true;
      },
    );
  });

  it('never forwards caller-supplied price history', async () => {
    const stored = { ...OFFICE_RECORD, priceHistory: [{ date: '2026-01-01T00:00:00Z', askingRent: 600, estimatedAllInMonthly: 800 }] };
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('office', [stored]) });
    await pipeline.runUpsert({
      scope: 'office',
      envelope: envelope([{ id: OFFICE_RECORD.id, askingRent: 700, priceHistory: [{ date: '1999-01-01T00:00:00Z', askingRent: 1 }] }]),
    });
    const sent = client.upserts[0].listings[0];
    assert.deepEqual(sent.priceHistory, stored.priceHistory);
  });
});

describe('deals contract', () => {
  it('accepts a new record and derives its stable id', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', []) });
    const { id, ...withoutId } = DEAL_RECORD;
    const result = await pipeline.runUpsert({ scope: 'deals', envelope: envelope([withoutId]) });
    assert.equal(result.structuredContent.created, 1);
    assert.equal(client.upserts[0].listings[0].id, 'ebay-123456789');
  });

  it('rejects a new record missing category and searchName', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', []) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ id: 'ebay-1', title: 'x', listingType: 'auction' }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /category|searchName/);
        return true;
      },
    );
  });

  it('accepts a partial price update on a stored record', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    const result = await pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ id: DEAL_RECORD.id, priceCad: 160 }]) });
    assert.equal(result.structuredContent.updated, 1);
    assert.deepEqual(result.structuredContent.results[0].changedFields, ['priceCad']);
    assert.equal(client.upserts[0].listings[0].category, 'Bulk LEGO');
  });

  it('rejects an invalid listingType through the canonical enum', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ id: DEAL_RECORD.id, listingType: 'classified' }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /listingType/);
        return true;
      },
    );
  });

  it('stores an unresolved landed cost with shippingResolved false', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', []) });
    await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([
        {
          itemId: '555',
          category: 'Bulk LEGO',
          searchName: 'Bulk LEGO Deal Watch',
          title: 'Unresolved shipping lot',
          listingType: 'auction',
          priceCad: 90,
          weightLb: 10,
          landedCadPerLb: 12,
        },
      ]),
    });
    const sent = client.upserts[0].listings[0];
    assert.equal(sent.shippingResolved, false);
    assert.equal(sent.landedCadPerLb, 12);
  });
});

describe('jobs contract', () => {
  it('accepts a new record and derives its stable id from source and sourceId', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('jobs', []) });
    const { id, ...withoutId } = JOB_RECORD;
    const result = await pipeline.runUpsert({ scope: 'jobs', envelope: envelope([withoutId]) });
    assert.equal(result.structuredContent.created, 1);
    assert.equal(client.upserts[0].listings[0].id, 'indeed-abc123');
  });

  it('rejects a new record missing title and company', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('jobs', []) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ id: 'job-1', location: 'Toronto' }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /title|company/);
        return true;
      },
    );
  });

  it('accepts a partial ranking update', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('jobs', [{ ...JOB_RECORD }]) });
    const result = await pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ id: JOB_RECORD.id, fitScore: 91 }]) });
    assert.equal(result.structuredContent.updated, 1);
    assert.equal(client.upserts[0].listings[0].company, 'Northbridge Electric');
    assert.equal(client.upserts[0].listings[0].fitScore, 91);
  });

  it('rejects a fitScore outside the canonical range', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('jobs', [{ ...JOB_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ id: JOB_RECORD.id, fitScore: 120 }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /fitScore/);
        return true;
      },
    );
  });
});

describe('envelope handling (SDD §11 steps 3-4)', () => {
  it('rejects a batch larger than the configured maximum', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', []) });
    const listings = Array.from({ length: 51 }, (_, i) => ({ ...DEAL_RECORD, id: `ebay-${i}`, itemId: String(i) }));
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope(listings) }),
      err => err.code === 'BATCH_TOO_LARGE',
    );
    assert.equal(client.upserts.length, 0);
  });

  it('rejects an unusable source label', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', []) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }], { source: 'bad source!' }) }),
      err => err.code === 'VALIDATION_ERROR',
    );
  });

  it('rejects an unusable observedAt', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', []) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }], { observedAt: 'last Tuesday' }) }),
      err => err.code === 'INVALID_TIMESTAMP',
    );
  });

  it('rejects an empty listings array', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', []) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([]) }),
      err => err.code === 'VALIDATION_ERROR',
    );
  });

  it('reports per-record results when only part of a batch is bad', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', []) });
    const result = await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([{ ...DEAL_RECORD }, { id: 'ebay-broken', title: 'no category' }]),
    });
    assert.equal(result.structuredContent.ok, true);
    assert.equal(result.structuredContent.created, 1);
    assert.equal(result.structuredContent.rejected, 1);
    assert.equal(client.upserts[0].listings.length, 1);
    assert.equal(result.structuredContent.results[1].outcome, 'rejected');
  });

  it('fails a schema-drifted feed instead of writing into it', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', [], { schemaVersion: 9 }) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }]) }),
      err => err.code === 'SCHEMA_VERSION_MISMATCH',
    );
    assert.equal(client.upserts.length, 0);
  });
});

describe('outcome classification (SDD §14)', () => {
  it('suppresses an identical resend', async () => {
    const observedAt = '2026-08-08T12:00:00Z';
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', []) });
    await pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }], { observedAt }) });
    const second = await pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }], { observedAt }) });
    assert.equal(second.structuredContent.unchanged, 1);
    assert.equal(client.upserts.length, 1, 'the second call must not reach the dashboard API');
  });

  it('reports a freshness-only change as touched', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', []) });
    await pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }], { observedAt: '2026-08-08T12:00:00Z' }) });
    const second = await pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }], { observedAt: '2026-08-08T13:00:00Z' }) });
    assert.equal(second.structuredContent.touched, 1);
    assert.equal(second.structuredContent.results[0].changedFields.length, 0);
    assert.equal(client.upserts.length, 2);
  });

  it('does not persist a touch when touch writes are disabled', async () => {
    const config = testConfig({ MCP_SEND_TOUCH_WRITES: 'false' });
    const { pipeline, client } = buildPipeline({ config, feeds: feedsWith('deals', []) });
    await pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }], { observedAt: '2026-08-08T12:00:00Z' }) });
    const second = await pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ ...DEAL_RECORD }], { observedAt: '2026-08-08T13:00:00Z' }) });
    assert.equal(second.structuredContent.touched, 0);
    assert.equal(second.structuredContent.unchanged, 1);
    assert.equal(client.upserts.length, 1);
  });

  it('deduplicates repeated ids inside one batch into a single downstream record', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', []) });
    const result = await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([{ ...DEAL_RECORD }, { id: DEAL_RECORD.id, priceCad: 150 }]),
    });
    assert.equal(result.structuredContent.results.length, 2);
    assert.equal(client.upserts[0].listings.length, 1);
    assert.equal(client.upserts[0].listings[0].priceCad, 150);
  });

  it('reports the source and requestId the downstream write was made with', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('jobs', []) });
    const result = await pipeline.runUpsert({
      scope: 'jobs',
      envelope: envelope([{ ...JOB_RECORD }], { source: 't176-trades-job-scout' }),
      requestId: 'req-fixed-1',
    });
    assert.equal(result.structuredContent.source, 't176-trades-job-scout');
    assert.equal(result.structuredContent.requestId, 'req-fixed-1');
    assert.deepEqual(client.upserts[0].meta, { source: 't176-trades-job-scout', requestId: 'req-fixed-1' });
  });

  it('attaches partial results to a downstream failure', async () => {
    const { ToolError } = await import('../src/errors.mjs');
    const { pipeline } = buildPipeline({
      feeds: feedsWith('jobs', []),
      failUpsert: new ToolError('DOWNSTREAM_UNAVAILABLE', 'dashboard down'),
    });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ ...JOB_RECORD }]) }),
      err => {
        assert.equal(err.code, 'DOWNSTREAM_UNAVAILABLE');
        assert.equal(err.details.partial.created, 1);
        return true;
      },
    );
  });
});
