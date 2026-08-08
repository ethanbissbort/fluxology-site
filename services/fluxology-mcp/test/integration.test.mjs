/**
 * Dashboard API integration tests (SDD §26.3).
 *
 * These run the connector against the real `services/dashboard-api` process, so
 * every assertion is about behaviour the two services actually agree on:
 * create, update, unchanged retry, retirement, Office price-history
 * preservation, downstream failures, and concurrency.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TOKENS, startHarness } from './helpers/harness.mjs';

const OFFICE_ID = 'integration-office-1';

function officeRecord(overrides = {}) {
  return {
    id: OFFICE_ID,
    operator: 'Integration Offices',
    address: '100 Test Street',
    municipality: 'Toronto',
    mandatoryFeesKnown: true,
    active: true,
    askingRent: 600,
    estimatedAllInMonthly: 780,
    costStatus: 'verified',
    ...overrides,
  };
}

function dealRecord(overrides = {}) {
  return {
    itemId: '7000001',
    category: 'Bulk LEGO',
    searchName: 'Bulk LEGO Deal Watch',
    title: 'Integration lot',
    listingType: 'buy_it_now',
    marketplace: 'ebay',
    priceCad: 120,
    shippingCad: 30,
    shippingResolved: true,
    weightLb: 15,
    landedCadPerLb: 10,
    active: true,
    ...overrides,
  };
}

describe('connector against the real dashboard API', () => {
  let harness;
  let session;

  before(async () => {
    harness = await startHarness({ portBase: 8210 });
    session = await harness.connectClient();
  });

  after(async () => {
    await session?.close();
    await harness?.stop();
  });

  const call = (name, args) => session.client.callTool({ name, arguments: args });

  it('creates a record and persists it to the live feed', async () => {
    const result = await call('upsert_office_listings', {
      source: 'office-scout-skill',
      observedAt: '2026-08-08T12:00:00Z',
      listings: [officeRecord()],
    });
    assert.equal(result.structuredContent.ok, true);
    assert.equal(result.structuredContent.created, 1);

    const feed = await harness.readFeed('office');
    const stored = feed.listings.find(l => l.id === OFFICE_ID);
    assert.ok(stored, 'record should exist in the live feed');
    assert.equal(stored.operator, 'Integration Offices');
    assert.equal(stored.lastVerified, '2026-08-08T12:00:00.000Z');
  });

  it('applies a partial update without losing untouched fields', async () => {
    const result = await call('upsert_office_listings', {
      source: 'office-scout-skill',
      observedAt: '2026-08-08T13:00:00Z',
      listings: [{ id: OFFICE_ID, askingRent: 650, estimatedAllInMonthly: 820 }],
    });
    assert.equal(result.structuredContent.updated, 1);
    assert.deepEqual(result.structuredContent.results[0].changedFields, ['askingRent', 'estimatedAllInMonthly']);

    const stored = (await harness.readFeed('office')).listings.find(l => l.id === OFFICE_ID);
    assert.equal(stored.askingRent, 650);
    assert.equal(stored.municipality, 'Toronto', 'omitted fields must survive');
    assert.equal(stored.costStatus, 'verified');
  });

  it('preserves and extends office price history across the update', async () => {
    const stored = (await harness.readFeed('office')).listings.find(l => l.id === OFFICE_ID);
    assert.ok(Array.isArray(stored.priceHistory), 'the dashboard API owns price history');
    assert.ok(stored.priceHistory.length >= 2, `expected an appended point, got ${JSON.stringify(stored.priceHistory)}`);
    assert.equal(stored.priceHistory.at(-1).askingRent, 650);
    assert.equal(stored.priceHistory[0].askingRent, 600);
  });

  it('suppresses an identical retry instead of rewriting the feed', async () => {
    const envelope = {
      source: 'office-scout-skill',
      observedAt: '2026-08-08T14:00:00Z',
      listings: [officeRecord({ askingRent: 650, estimatedAllInMonthly: 820 })],
    };
    await call('upsert_office_listings', envelope);
    const generatedBefore = (await harness.readFeed('office')).generatedAt;
    const auditBefore = (await harness.readAudit()).length;

    const retry = await call('upsert_office_listings', envelope);
    assert.equal(retry.structuredContent.unchanged, 1);
    assert.equal(retry.structuredContent.updated, 0);
    assert.equal(retry.structuredContent.touched, 0);

    const feed = await harness.readFeed('office');
    assert.equal(feed.generatedAt, generatedBefore, 'an unchanged retry must not rewrite the feed');
    assert.equal((await harness.readAudit()).length, auditBefore, 'an unchanged retry must not add an audit entry');
  });

  it('refreshes the freshness stamp when only observedAt moves', async () => {
    const listings = [officeRecord({ askingRent: 650, estimatedAllInMonthly: 820 })];
    const result = await call('upsert_office_listings', {
      source: 'office-scout-skill',
      observedAt: '2026-08-08T15:30:00Z',
      listings,
    });
    assert.equal(result.structuredContent.touched, 1);
    const stored = (await harness.readFeed('office')).listings.find(l => l.id === OFFICE_ID);
    assert.equal(stored.lastVerified, '2026-08-08T15:30:00.000Z');
  });

  it('retires a record with active:false rather than deleting it', async () => {
    const result = await call('upsert_office_listings', {
      source: 'office-scout-skill',
      observedAt: '2026-08-08T16:00:00Z',
      listings: [{ id: OFFICE_ID, active: false }],
    });
    assert.equal(result.structuredContent.updated, 1);
    const feed = await harness.readFeed('office');
    const stored = feed.listings.find(l => l.id === OFFICE_ID);
    assert.equal(stored.active, false);
    assert.ok(stored.operator, 'a retired record keeps its data');

    const summary = await call('get_dashboard_summary', { scope: 'office' });
    assert.equal(summary.structuredContent.recordCount, feed.listings.length);
    assert.equal(summary.structuredContent.activeCount, feed.listings.filter(l => l.active !== false).length);
  });

  it('records the connector as the audit source', async () => {
    const audit = await harness.readAudit();
    const officeEntries = audit.filter(entry => entry.scope === 'office');
    assert.ok(officeEntries.length > 0);
    for (const entry of officeEntries) {
      assert.equal(entry.source, 'mcp:office-scout-skill');
    }
  });

  it('reads back an individual record for reconciliation', async () => {
    const result = await call('get_dashboard_listing', { scope: 'office', id: OFFICE_ID });
    assert.equal(result.structuredContent.found, true);
    assert.equal(result.structuredContent.listing.id, OFFICE_ID);
    assert.equal(result.structuredContent.truncated, false);
  });

  it('treats a missing record as a normal result', async () => {
    const result = await call('get_dashboard_listing', { scope: 'office', id: 'does-not-exist' });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.found, false);
  });

  it('writes deals and jobs through their own tools', async () => {
    const deals = await call('upsert_deal_listings', {
      source: 'bulk-lego-deal-watch',
      observedAt: '2026-08-08T12:00:00Z',
      listings: [dealRecord()],
    });
    assert.equal(deals.structuredContent.created, 1);
    assert.ok((await harness.readFeed('deals')).listings.some(l => l.id === 'ebay-7000001'));

    const jobs = await call('upsert_job_listings', {
      source: 't176-trades-job-scout',
      observedAt: '2026-08-08T12:00:00Z',
      listings: [{ source: 'indeed', sourceId: 'int-1', title: 'Apprentice Plumber', company: 'Testco', fitScore: 74 }],
    });
    assert.equal(jobs.structuredContent.created, 1);
    assert.ok((await harness.readFeed('jobs')).listings.some(l => l.id === 'indeed-int-1'));
  });

  it('runs the three categories concurrently without interference', async () => {
    const observedAt = '2026-08-08T17:00:00Z';
    const [office, deals, jobs] = await Promise.all([
      call('upsert_office_listings', {
        source: 'office-scout-skill',
        observedAt,
        listings: [officeRecord({ id: 'concurrent-office', address: '200 Parallel Ave' })],
      }),
      call('upsert_deal_listings', {
        source: 'bulk-lego-deal-watch',
        observedAt,
        listings: [dealRecord({ itemId: '7000002', title: 'Concurrent lot' })],
      }),
      call('upsert_job_listings', {
        source: 't176-trades-job-scout',
        observedAt,
        listings: [{ source: 'indeed', sourceId: 'int-2', title: 'Apprentice HVAC', company: 'Testco', fitScore: 66 }],
      }),
    ]);

    assert.equal(office.structuredContent.created, 1);
    assert.equal(deals.structuredContent.created, 1);
    assert.equal(jobs.structuredContent.created, 1);
  });

  it('serialises concurrent writes inside one category and keeps both records', async () => {
    const observedAt = '2026-08-08T18:00:00Z';
    const results = await Promise.all([
      call('upsert_deal_listings', {
        source: 'bulk-lego-deal-watch',
        observedAt,
        listings: [dealRecord({ itemId: '7000010', title: 'Serial A' })],
      }),
      call('upsert_deal_listings', {
        source: 'bulk-minifigure-watch',
        observedAt,
        listings: [dealRecord({ itemId: '7000011', title: 'Serial B', category: 'Bulk minifigures', searchName: 'Bulk Minifigure Watch' })],
      }),
    ]);

    for (const result of results) assert.equal(result.structuredContent.ok, true);
    const ids = (await harness.readFeed('deals')).listings.map(l => l.id);
    assert.ok(ids.includes('ebay-7000010'), 'first concurrent write survived');
    assert.ok(ids.includes('ebay-7000011'), 'second concurrent write survived');
  });

  it('never writes a downstream secret into the connector log', () => {
    const text = harness.logs.text;
    for (const token of Object.values(TOKENS)) {
      assert.equal(text.includes(token), false, 'an ingest token reached the log');
    }
    assert.equal(text.toLowerCase().includes('"authorization"'), false);
  });

  it('logs one structured invocation event per tool call', () => {
    const events = harness.logs.events('tool_invocation');
    assert.ok(events.length > 0);
    const write = events.find(event => event.tool === 'upsert_office_listings' && event.outcome === 'ok');
    assert.ok(write, 'a successful office write should be logged');
    for (const field of ['requestId', 'tool', 'subject', 'grantedScopes', 'durationMs', 'source', 'counts', 'changedIds']) {
      assert.ok(field in write, `log event is missing ${field}`);
    }
    // Listing bodies must never appear in a log line.
    assert.equal(JSON.stringify(write).includes('Integration Offices'), false);
  });
});

describe('downstream failure handling', () => {
  let harness;
  let session;

  before(async () => {
    // The connector holds tokens the dashboard API will not accept.
    harness = await startHarness({
      portBase: 8214,
      tokens: { office: 'wrong-office-token-0000000', deals: TOKENS.deals, jobs: TOKENS.jobs },
      mcpEnv: { OFFICE_INGEST_TOKEN: 'a-different-office-token-11111' },
    });
    session = await harness.connectClient();
  });

  after(async () => {
    await session?.close();
    await harness?.stop();
  });

  it('reports a rejected downstream credential without disclosing it', async () => {
    const result = await session.client.callTool({
      name: 'upsert_office_listings',
      arguments: {
        source: 'office-scout-skill',
        observedAt: '2026-08-08T12:00:00Z',
        listings: [officeRecord({ id: 'auth-failure-office' })],
      },
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'DOWNSTREAM_REJECTED');
    assert.equal(result.structuredContent.message.includes('a-different-office-token'), false);
    assert.equal(JSON.stringify(result).includes('a-different-office-token'), false);
    // Per-record work still gets reported back.
    assert.equal(result.structuredContent.created, 1);
  });

  it('still serves categories whose credential is correct', async () => {
    const result = await session.client.callTool({
      name: 'upsert_deal_listings',
      arguments: { source: 'bulk-lego-deal-watch', observedAt: '2026-08-08T12:00:00Z', listings: [dealRecord({ itemId: '7100001' })] },
    });
    assert.equal(result.structuredContent.ok, true);
  });
});

describe('unreachable dashboard API', () => {
  let harness;
  let session;

  before(async () => {
    harness = await startHarness({
      portBase: 8218,
      // Nothing is listening here.
      mcpEnv: { DASHBOARD_API_URL: 'http://127.0.0.1:8219', DASHBOARD_CONNECT_TIMEOUT_MS: '500', DASHBOARD_REQUEST_TIMEOUT_MS: '1000' },
    });
    session = await harness.connectClient();
  });

  after(async () => {
    await session?.close();
    await harness?.stop();
  });

  it('returns DOWNSTREAM_UNAVAILABLE rather than hanging', async () => {
    const result = await session.client.callTool({ name: 'get_dashboard_summary', arguments: { scope: 'deals' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'DOWNSTREAM_UNAVAILABLE');
  });

  it('fails readiness while the dependency is down', async () => {
    const res = await harness.http('/readyz');
    assert.equal(res.status, 503);
    assert.equal(res.json.checks.dashboardApi.ok, false);
  });

  it('keeps liveness green so the container is not needlessly restarted', async () => {
    const res = await harness.http('/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'ok');
  });
});
