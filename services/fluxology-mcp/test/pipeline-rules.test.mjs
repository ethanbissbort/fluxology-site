/**
 * The business-rule gate, exercised through the write pipeline (SDD §11 step 9).
 *
 * Every case here is a record that the canonical Ajv schema ACCEPTS and that
 * only `CATEGORY_RULES[scope].check()` rejects. That is the whole point: the
 * older suite proved the rules exist (by calling them as pure functions) but
 * not that the pipeline still calls them, so deleting the step-9 gate left all
 * 163 tests green. Each assertion below runs `pipeline.runUpsert`, so removing
 * the gate, short-circuiting its `errors` branch, or reordering the steps turns
 * the record into a successful `created`/`updated` and fails the suite.
 *
 * `assertRuleOnly` re-checks the premise on every run: if a rule case ever
 * starts being caught one step earlier by Ajv, the test says so instead of
 * quietly stopping to cover the gate.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEAL_RECORD,
  EMPTY_FEEDS,
  JOB_RECORD,
  OFFICE_RECORD,
  buildPipeline,
  envelope,
  testConfig,
} from './helpers/fixtures.mjs';
import { loadSchemas } from '../src/schemas.mjs';
import { startHarness } from './helpers/harness.mjs';

const SCHEMAS = loadSchemas(testConfig());

/** A guaranteed-valid companion record, so the call returns instead of throwing. */
const COMPANION = Object.freeze({
  office: { ...OFFICE_RECORD, id: 'rule-companion-office' },
  deals: { ...DEAL_RECORD, id: 'ebay-999000001', itemId: '999000001' },
  jobs: { ...JOB_RECORD, id: 'indeed-companion', sourceId: 'companion' },
});

function feedsWith(scope, listings) {
  return { ...EMPTY_FEEDS, [scope]: { ...EMPTY_FEEDS[scope], listings } };
}

/** Assert the canonical schema accepts the record, so only step 9 can reject it. */
function assertRuleOnly(scope, record, label) {
  const validate = SCHEMAS.categories[scope].validateListing;
  assert.equal(
    validate(record),
    true,
    `${label}: this case must be schema-VALID or it proves nothing about the rule gate (Ajv said: ${JSON.stringify(validate.errors)})`,
  );
}

/**
 * Cases the canonical schema accepts and only the category rules reject.
 * `stored` seeds the feed so partial-update cases have something to merge onto.
 */
const RULE_CASES = [
  {
    scope: 'office',
    label: 'a verified record above the hard all-in ceiling',
    stored: [{ ...OFFICE_RECORD }],
    listing: { id: OFFICE_RECORD.id, estimatedAllInMonthly: 900 },
    merged: { ...OFFICE_RECORD, estimatedAllInMonthly: 900 },
    reason: /exceeds the hard all-in ceiling of 850/,
  },
  {
    scope: 'office',
    label: 'a verified record whose mandatory fees are not known',
    stored: [{ ...OFFICE_RECORD }],
    listing: { id: OFFICE_RECORD.id, mandatoryFeesKnown: false },
    merged: { ...OFFICE_RECORD, mandatoryFeesKnown: false },
    reason: /requires mandatoryFeesKnown:true/,
  },
  {
    scope: 'office',
    label: 'mandatoryFeesKnown:true with no all-in figure at all',
    stored: [{ ...OFFICE_RECORD, costStatus: 'plausible', estimatedAllInMonthly: 700 }],
    listing: { id: OFFICE_RECORD.id, estimatedAllInMonthly: 0 },
    merged: { ...OFFICE_RECORD, costStatus: 'plausible', estimatedAllInMonthly: 0 },
    reason: /mandatoryFeesKnown:true/,
  },
  {
    scope: 'office',
    label: 'a non-http sourceUrl',
    stored: [{ ...OFFICE_RECORD }],
    listing: { id: OFFICE_RECORD.id, sourceUrl: 'javascript:alert(1)' },
    merged: { ...OFFICE_RECORD, sourceUrl: 'javascript:alert(1)' },
    reason: /sourceUrl: must be an http\(s\) URL/,
  },
  {
    scope: 'office',
    label: 'a negative asking rent',
    stored: [{ ...OFFICE_RECORD }],
    listing: { id: OFFICE_RECORD.id, askingRent: -5 },
    merged: { ...OFFICE_RECORD, askingRent: -5 },
    reason: /askingRent: must not be negative/,
  },
  {
    scope: 'office',
    label: 'a control character inside free text',
    stored: [{ ...OFFICE_RECORD }],
    listing: { id: OFFICE_RECORD.id, notes: `landlord${String.fromCharCode(0)}note` },
    merged: { ...OFFICE_RECORD, notes: `landlord${String.fromCharCode(0)}note` },
    reason: /notes: contains control characters/,
  },
  {
    scope: 'deals',
    label: 'shippingResolved:true without a confirmed shipping cost',
    stored: [{ ...DEAL_RECORD }],
    listing: { id: DEAL_RECORD.id, shippingCad: null },
    merged: { ...DEAL_RECORD, shippingCad: null },
    reason: /cannot be true without a confirmed numeric shippingCad/,
  },
  {
    scope: 'deals',
    label: 'a negative price',
    stored: [{ ...DEAL_RECORD }],
    listing: { id: DEAL_RECORD.id, priceCad: -1 },
    merged: { ...DEAL_RECORD, priceCad: -1 },
    reason: /priceCad: must not be negative/,
  },
  {
    scope: 'deals',
    label: 'a non-http listing URL',
    stored: [{ ...DEAL_RECORD }],
    listing: { id: DEAL_RECORD.id, url: 'ftp://example.com/x' },
    merged: { ...DEAL_RECORD, url: 'ftp://example.com/x' },
    reason: /url: must be an http\(s\) URL/,
  },
  {
    scope: 'deals',
    label: 'a new record with no searchName',
    stored: [],
    listing: { itemId: '888000001', category: 'Bulk LEGO', title: 'Ruleless lot', listingType: 'auction' },
    merged: { id: 'ebay-888000001', itemId: '888000001', category: 'Bulk LEGO', title: 'Ruleless lot', listingType: 'auction' },
    reason: /searchName: is required on a new record/,
  },
  {
    scope: 'deals',
    label: 'a new record whose title is only whitespace',
    stored: [],
    listing: { itemId: '888000002', category: 'Bulk LEGO', searchName: 'Bulk LEGO Deal Watch', title: '   ', listingType: 'auction' },
    merged: { id: 'ebay-888000002', itemId: '888000002', category: 'Bulk LEGO', searchName: 'Bulk LEGO Deal Watch', title: '   ', listingType: 'auction' },
    reason: /title: is required on a new record/,
  },
  {
    scope: 'jobs',
    label: 'a new record whose company is only whitespace',
    stored: [],
    listing: { source: 'indeed', sourceId: 'rule-1', title: 'Apprentice Roofer', company: '   ' },
    merged: { id: 'indeed-rule-1', source: 'indeed', sourceId: 'rule-1', title: 'Apprentice Roofer', company: '   ' },
    reason: /company: is required on a new record/,
  },
  {
    scope: 'jobs',
    label: 'an empty entry in tracks',
    stored: [{ ...JOB_RECORD }],
    listing: { id: JOB_RECORD.id, tracks: ['electrical', ''] },
    merged: { ...JOB_RECORD, tracks: ['electrical', ''] },
    reason: /tracks: every entry must be a non-empty string/,
  },
  {
    scope: 'jobs',
    label: 'a negative hourly rate',
    stored: [{ ...JOB_RECORD }],
    listing: { id: JOB_RECORD.id, hourlyCadMin: -1 },
    merged: { ...JOB_RECORD, hourlyCadMin: -1 },
    reason: /hourlyCadMin: must not be negative/,
  },
  {
    scope: 'jobs',
    label: 'a file:// job URL',
    stored: [{ ...JOB_RECORD }],
    listing: { id: JOB_RECORD.id, url: 'file:///etc/passwd' },
    merged: { ...JOB_RECORD, url: 'file:///etc/passwd' },
    reason: /url: must be an http\(s\) URL/,
  },
];

describe('the category business-rule gate is wired into the write pipeline (SDD §11 step 9)', () => {
  for (const testCase of RULE_CASES) {
    it(`rejects ${testCase.label} (${testCase.scope})`, async () => {
      // Premise: Ajv must accept this record, or the case proves nothing.
      assertRuleOnly(testCase.scope, testCase.merged, testCase.label);

      const { pipeline, client } = buildPipeline({ feeds: feedsWith(testCase.scope, testCase.stored) });
      const result = await pipeline.runUpsert({
        scope: testCase.scope,
        // The companion record keeps the call from failing wholesale, so the
        // assertion is about this record specifically, not about the batch.
        envelope: envelope([testCase.listing, COMPANION[testCase.scope]]),
      });

      const entry = result.structuredContent.results[0];
      assert.equal(
        entry.outcome,
        'rejected',
        `the step-9 gate did not reject ${testCase.label}; it reported "${entry.outcome}". ` +
          'Either a category rule stopped firing or the pipeline stopped calling category.check().',
      );
      assert.match(entry.reason, testCase.reason);
      assert.equal(result.structuredContent.rejected, 1);

      // And nothing about the rejected record may reach the downstream store.
      const persisted = client.upserts.flatMap(upsert => upsert.listings.map(listing => listing.id));
      assert.equal(persisted.includes(entry.id ?? '(none)'), false, 'a rule-rejected record was still persisted');
      assert.equal(result.structuredContent.results[1].outcome, 'created', 'the valid companion record must still be written');
    });
  }

  it('covers every category, so no single category can lose its gate unnoticed', () => {
    for (const scope of ['office', 'deals', 'jobs']) {
      assert.ok(
        RULE_CASES.some(testCase => testCase.scope === scope),
        `no schema-valid/rule-invalid case covers ${scope}`,
      );
    }
  });

  it('carries category warnings out of the gate and into the tool result', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', []) });
    const result = await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([
        {
          itemId: '888000009',
          category: 'Bulk LEGO',
          searchName: 'Bulk LEGO Deal Watch',
          title: 'Provisional landed cost',
          listingType: 'auction',
          priceCad: 90,
          weightLb: 10,
          landedCadPerLb: 12,
        },
      ]),
    });
    const entry = result.structuredContent.results[0];
    assert.equal(entry.outcome, 'created');
    assert.match(
      (entry.warnings ?? []).join(' '),
      /shipping is unresolved/,
      'step 9 produced no warning, so warnings are no longer flowing through the pipeline',
    );
  });

  it('rejects a rule-invalid record even when it is the only one in the batch', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('office', [{ ...OFFICE_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'office', envelope: envelope([{ id: OFFICE_RECORD.id, estimatedAllInMonthly: 900 }]) }),
      err => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.details.partial.results[0].reason, /exceeds the hard all-in ceiling/);
        return true;
      },
    );
    assert.equal(client.upserts.length, 0, 'nothing may be persisted when every record was rule-rejected');
  });
});

describe('the business-rule gate holds end to end against the real dashboard API', () => {
  let harness;
  let session;

  before(async () => {
    harness = await startHarness({ portBase: 8320 });
    session = await harness.connectClient();
  });

  after(async () => {
    await session?.close();
    await harness?.stop();
  });

  const call = (name, args) => session.client.callTool({ name, arguments: args });

  /** One rule per category, driven by the official SDK client over real HTTP. */
  const E2E_CASES = [
    {
      tool: 'upsert_office_listings',
      scope: 'office',
      source: 'office-scout-skill',
      id: 'e2e-rule-office',
      listing: {
        id: 'e2e-rule-office',
        operator: 'Rule Test Offices',
        address: '9 Gate Street',
        municipality: 'Toronto',
        mandatoryFeesKnown: true,
        active: true,
        costStatus: 'verified',
        askingRent: 700,
        estimatedAllInMonthly: 1200,
      },
      reason: /exceeds the hard all-in ceiling/,
    },
    {
      tool: 'upsert_deal_listings',
      scope: 'deals',
      source: 'bulk-lego-deal-watch',
      id: 'ebay-777000001',
      listing: {
        itemId: '777000001',
        category: 'Bulk LEGO',
        searchName: 'Bulk LEGO Deal Watch',
        title: 'Laundered shipping lot',
        listingType: 'buy_it_now',
        priceCad: 100,
        shippingResolved: true,
      },
      reason: /cannot be true without a confirmed numeric shippingCad/,
    },
    {
      tool: 'upsert_job_listings',
      scope: 'jobs',
      source: 't176-trades-job-scout',
      id: 'indeed-e2e-rule',
      listing: {
        source: 'indeed',
        sourceId: 'e2e-rule',
        title: 'Apprentice Millwright',
        company: 'Gate Testco',
        url: 'file:///etc/passwd',
      },
      reason: /must be an http\(s\) URL/,
    },
  ];

  for (const testCase of E2E_CASES) {
    it(`${testCase.scope}: a schema-valid but rule-invalid record never reaches the live feed`, async () => {
      const result = await call(testCase.tool, {
        source: testCase.source,
        observedAt: '2026-08-08T12:00:00Z',
        listings: [testCase.listing],
      });

      assert.equal(result.isError, true, 'a rule-invalid single-record batch must be an error result');
      assert.match(result.structuredContent.results[0].reason, testCase.reason);

      const feed = await harness.readFeed(testCase.scope);
      assert.equal(
        feed.listings.some(listing => listing.id === testCase.id),
        false,
        'the rule-rejected record was persisted to the live feed',
      );
    });
  }
});
