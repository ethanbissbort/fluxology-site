import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deals } from '../src/validation/deals.mjs';
import { buildPipeline, envelope, testConfig } from './helpers/fixtures.mjs';

const LIMITS = testConfig().limits;
const CTX = { isNew: true, feedRoot: {}, limits: LIMITS };

function kijijiListing(overrides = {}) {
  return {
    marketplace: 'Kijiji',
    marketplaceListingId: '1699999999',
    category: 'Bulk LEGO',
    searchName: 'Kijiji LEGO Local Watch — 45 km',
    title: 'Large mixed LEGO bin',
    listingType: 'classified',
    pickupOnly: true,
    originPostalCode: 'M6H 2W9',
    pickupArea: 'Mississauga, ON',
    distanceKm: 28,
    seenInRadiiKm: [45, 65],
    searchProfileIds: ['kijiji-lego-m6h2w9-45km', 'kijiji-lego-m6h2w9-65km'],
    matchedQueries: ['lego bin', 'lego'],
    priceCad: 60,
    weightLb: 10,
    priceCadPerLb: 6,
    photoAssessment: 'promising_needs_1_2_photos',
    diversityGrade: 'high',
    decisionBasis: 'exceptional_commodity_price',
    cleanoutSignalScore: 5,
    active: true,
    status: 'active',
    ...overrides,
  };
}

function searchRun(radiusKm, overrides = {}) {
  const profileId = `kijiji-lego-m6h2w9-${radiusKm}km`;
  return {
    id: `kijiji-search-run-${radiusKm}-20260816T100000Z`,
    recordType: 'search_run',
    marketplace: 'Kijiji',
    category: 'Bulk LEGO',
    searchName: `Kijiji LEGO Local Watch — ${radiusKm} km`,
    title: `Kijiji LEGO ${radiusKm} km search audit`,
    listingType: 'search_run',
    status: 'audit',
    active: false,
    searchAudit: {
      profileId,
      originPostalCode: 'M6H 2W9',
      radiusKm,
      startedAt: '2026-08-16T09:55:00Z',
      completedAt: '2026-08-16T10:00:00Z',
      resultRecordsInspected: radiusKm === 45 ? 137 : 201,
      listingPagesOpened: radiusKm === 45 ? 31 : 44,
      duplicates: 18,
      staleOrRemoved: 3,
      counterfeitOrCompatible: 4,
      outsidePracticalPickupArea: 0,
      detailedEvaluations: 22,
      surfacedCandidates: 7,
      truncated: false,
    },
    ...overrides,
  };
}

describe('Kijiji Deals schema and business rules', () => {
  it('derives a marketplace-stable Kijiji id', () => {
    const resolved = deals.resolveId({ marketplace: 'Kijiji', marketplaceListingId: '1234567890' }, LIMITS);
    assert.equal(resolved.id, 'kijiji-1234567890');
  });

  it('accepts a local Kijiji classified listing with pickup economics unresolved', () => {
    const listing = kijijiListing();
    const { errors } = deals.check(listing, CTX);
    assert.deepEqual(errors, []);
    assert.equal(listing.pickupCostCad, undefined, 'unknown Zipcar cost must remain unresolved rather than guessed');
  });

  it('does not allow an eBay record to be re-labelled as a local classified', () => {
    const listing = {
      ...kijijiListing(),
      marketplace: 'eBay',
      marketplaceListingId: undefined,
      itemId: '12345',
      listingType: 'classified',
    };
    const { errors } = deals.check(listing, CTX);
    assert.match(errors.join(' '), /eBay records cannot use "classified"/);
  });

  it('accepts a complete 45 km search audit and requires both audited coverage counters', () => {
    assert.deepEqual(deals.check(searchRun(45), CTX).errors, []);

    const missingResultCount = searchRun(45);
    delete missingResultCount.searchAudit.resultRecordsInspected;
    assert.match(deals.check(missingResultCount, CTX).errors.join(' '), /resultRecordsInspected/);

    const missingOpenedCount = searchRun(45);
    delete missingOpenedCount.searchAudit.listingPagesOpened;
    assert.match(deals.check(missingOpenedCount, CTX).errors.join(' '), /listingPagesOpened/);
  });

  it('warns when a temporary value rejection is retired without a recheck date', () => {
    const noRecheck = kijijiListing({ rejectionClass: 'temporary_value', active: false, status: 'rejected' });
    assert.match(deals.check(noRecheck, CTX).warnings.join(' '), /no recheckAfter/);

    const withRecheck = kijijiListing({
      rejectionClass: 'temporary_value',
      active: false,
      status: 'rejected',
      recheckAfter: '2026-08-23T12:00:00Z',
    });
    assert.equal(deals.check(withRecheck, CTX).warnings.some(warning => warning.includes('no recheckAfter')), false);
  });
});

describe('Kijiji Deals pipeline persistence', () => {
  it('persists a classified listing and both independent radius audit records through the normal Deals writer', async () => {
    const { pipeline, client } = buildPipeline();
    const result = await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([
        kijijiListing(),
        searchRun(45),
        searchRun(65),
      ]),
    });

    assert.equal(result.structuredContent.created, 3);
    assert.equal(client.upserts.length, 1);
    const written = client.upserts[0].listings;
    const listing = written.find(record => record.id === 'kijiji-1699999999');
    assert.ok(listing, 'Kijiji listing did not reach the downstream Deals write');
    assert.equal(listing.listingType, 'classified');
    assert.deepEqual(listing.seenInRadiiKm, [45, 65]);
    assert.equal(listing.priceCadPerLb, 6);

    const audits = written.filter(record => record.recordType === 'search_run');
    assert.equal(audits.length, 2, '45 km and 65 km audit records must both persist');
    assert.deepEqual(audits.map(record => record.searchAudit.radiusKm).sort((a, b) => a - b), [45, 65]);
    assert.equal(audits.every(record => Number.isInteger(record.searchAudit.resultRecordsInspected)), true);
    assert.equal(audits.every(record => Number.isInteger(record.searchAudit.listingPagesOpened)), true);
  });
});
