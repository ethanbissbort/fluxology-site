/**
 * In-process fixtures for unit and contract tests: a real config, real compiled
 * canonical schemas, and a fake Dashboard API client that records exactly what
 * the pipeline tried to persist.
 */
import { loadConfig } from '../../src/config.mjs';
import { loadSchemas } from '../../src/schemas.mjs';
import { createWritePipeline } from '../../src/pipeline.mjs';
import { createScopeGates } from '../../src/concurrency.mjs';
import { SCOPES } from '../../src/config.mjs';

export const BASE_ENV = Object.freeze({
  NODE_ENV: 'test',
  MCP_DEV_AUTH_ENABLED: 'true',
  MCP_DEV_AUTH_TOKEN: 'unit-test-token-0123456789',
  MCP_PUBLIC_URL: 'http://127.0.0.1:8083/mcp',
  OFFICE_INGEST_TOKEN: 'office-unit-token-000000',
  DEALS_INGEST_TOKEN: 'deals-unit-token-0000000',
  JOBS_INGEST_TOKEN: 'jobs-unit-token-00000000',
});

export function testConfig(overrides = {}) {
  return loadConfig({ ...BASE_ENV, ...overrides });
}

export const EMPTY_FEEDS = Object.freeze({
  office: { schemaVersion: '2.5', appVersion: '2.5.0', generatedAt: '2026-08-01T00:00:00Z', hardAllInCeilingCad: 850, listings: [] },
  deals: { schemaVersion: 3, appVersion: '3.0', generatedAt: '2026-08-01T00:00:00Z', currency: 'CAD', listings: [] },
  jobs: { schemaVersion: 3, appVersion: '3.0', generatedAt: '2026-08-01T00:00:00Z', currency: 'CAD', listings: [] },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Fake Dashboard API client. `upserts` records every batch the pipeline sent so
 * a test can assert on suppression as well as on the final state.
 */
export function createFakeClient(feeds = EMPTY_FEEDS, { failUpsert = null } = {}) {
  const state = clone(feeds);
  const upserts = [];

  return {
    upserts,
    state,
    async getFeed(scope) {
      return state[scope];
    },
    async upsert(scope, listings, meta) {
      upserts.push({ scope, listings: clone(listings), meta });
      if (failUpsert) throw failUpsert;
      const feed = state[scope];
      for (const listing of listings) {
        const index = feed.listings.findIndex(existing => existing.id === listing.id);
        if (index >= 0) feed.listings[index] = clone(listing);
        else feed.listings.push(clone(listing));
      }
      feed.generatedAt = new Date().toISOString();
      return { ok: true, scope, changed: true, count: feed.listings.length };
    },
    async health() {
      return { status: 'ok' };
    },
    invalidate() {},
  };
}

/** A pipeline wired to a fake client, for tests that need no network. */
export function buildPipeline({ feeds = EMPTY_FEEDS, config = testConfig(), failUpsert = null } = {}) {
  const schemas = loadSchemas(config);
  const client = createFakeClient(feeds, { failUpsert });
  const scopeGates = createScopeGates(SCOPES, config.limits.maxConcurrentWritesPerScope);
  const pipeline = createWritePipeline({ config, schemas, client, scopeGates });
  return { pipeline, client, schemas, config };
}

/* ------------------------------------------------------------ specimens */

export const OFFICE_RECORD = Object.freeze({
  id: 'regus-yonge-eglinton',
  operator: 'Regus',
  address: '2300 Yonge Street',
  municipality: 'Toronto',
  mandatoryFeesKnown: true,
  active: true,
  costStatus: 'verified',
  askingRent: 620,
  estimatedAllInMonthly: 812,
  finalWalkMinutes: 4,
  sourceUrl: 'https://example.com/office/1',
});

export const DEAL_RECORD = Object.freeze({
  id: 'ebay-123456789',
  itemId: '123456789',
  category: 'Bulk LEGO',
  searchName: 'Bulk LEGO Deal Watch',
  title: '20 lb bulk LEGO lot',
  listingType: 'buy_it_now',
  marketplace: 'ebay',
  url: 'https://www.ebay.ca/itm/123456789',
  priceCad: 180,
  shippingCad: 45,
  shippingResolved: true,
  weightLb: 20,
  landedCadPerLb: 11.25,
  active: true,
});

export const JOB_RECORD = Object.freeze({
  id: 'indeed-abc123',
  source: 'indeed',
  sourceId: 'abc123',
  title: 'Apprentice Electrician',
  company: 'Northbridge Electric',
  location: 'Toronto, ON',
  tracks: ['electrical'],
  fitScore: 82,
  hourlyCadMin: 22,
  hourlyCadMax: 28,
  url: 'https://example.com/jobs/abc123',
  active: true,
});

/** Build a write envelope for a category. */
export function envelope(listings, { source = 'unit-test-source', observedAt = new Date().toISOString() } = {}) {
  return { source, observedAt, listings };
}
