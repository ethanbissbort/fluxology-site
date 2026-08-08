/**
 * The connector must not report success while doing something else.
 *
 * Each case here was a live defect: a null written while reported as a no-op, a
 * misspelled field stored beside the real one under a green `created`, a
 * timezone-less auction end time accepted and read four hours wrong, an
 * 11,219-character hostile title returned verbatim with `truncated:false`, a
 * batch that paid one rate-limit token for a hundred writes. Every assertion
 * fails against the previous behaviour.
 */
import { after, before, describe, it } from 'node:test';
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
import { boundRecord } from '../src/tools/read-tools.mjs';
import { changedFieldNames, stableStringify } from '../src/validation/common.mjs';
import { AUDIT_FIELDS } from '../src/schemas.mjs';
import { DEV_TOKEN, startHarness } from './helpers/harness.mjs';

function feedsWith(scope, listings) {
  return { ...EMPTY_FEEDS, [scope]: { ...EMPTY_FEEDS[scope], listings } };
}

const JSON_RPC_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

/* --------------------------------------------------- absent is not null */

describe('an absent field and an explicit null are different things', () => {
  it('serialises undefined and null distinctly', () => {
    assert.notEqual(stableStringify(undefined), stableStringify(null));
    assert.equal(stableStringify(null), 'null');
  });

  it('reports absent -> null as a changed field', () => {
    const changed = changedFieldNames({ id: 'a' }, { id: 'a', landedCadPerLb: null }, AUDIT_FIELDS.deals);
    assert.deepEqual(changed, ['landedCadPerLb'], 'absent -> null used to be invisible to the material diff');
  });

  it('does not report a genuinely identical record as changed', () => {
    assert.deepEqual(changedFieldNames({ id: 'a', priceCad: 1 }, { id: 'a', priceCad: 1 }, AUDIT_FIELDS.deals), []);
  });
});

describe('null is never stored where the dashboards coerce it to zero', () => {
  it('deals: a null landed cost on a record that has none is stored as absent, not as null', async () => {
    const stored = { ...DEAL_RECORD };
    delete stored.landedCadPerLb;
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', [stored]) });

    const result = await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([{ id: DEAL_RECORD.id, landedCadPerLb: null }]),
    });

    const entry = result.structuredContent.results[0];
    // Whatever the outcome, the null must not reach the store: Number(null) is
    // 0, which passes isFinite and wins the "≤ $8/LB" badge at $0.00/lb.
    for (const upsert of client.upserts) {
      for (const listing of upsert.listings) {
        assert.equal('landedCadPerLb' in listing, false, 'an explicit null was persisted');
      }
    }
    assert.equal('landedCadPerLb' in client.state.deals.listings[0], false);
    assert.match((entry.warnings ?? []).join(' '), /absent field/);
  });

  it('deals: a null landed cost cannot silently clear a stored number', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ id: DEAL_RECORD.id, landedCadPerLb: null }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /null cannot clear a stored value/);
        return true;
      },
    );
    assert.equal(client.upserts.length, 0);
    assert.equal(client.state.deals.listings[0].landedCadPerLb, DEAL_RECORD.landedCadPerLb);
  });

  it('jobs: fitScore and finalWalkMinutes are held to the same rule', async () => {
    const stored = { ...JOB_RECORD };
    delete stored.fitScore;
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('jobs', [stored]) });
    await pipeline.runUpsert({
      scope: 'jobs',
      envelope: envelope([{ id: JOB_RECORD.id, fitScore: null, finalWalkMinutes: null }]),
    });
    const persisted = client.state.jobs.listings[0];
    assert.equal('fitScore' in persisted, false);
    assert.equal('finalWalkMinutes' in persisted, false);
  });

  it('office: mandatoryFeesKnown:true with a null all-in figure is refused outright', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('office', []) });
    await assert.rejects(
      () =>
        pipeline.runUpsert({
          scope: 'office',
          envelope: envelope([
            {
              id: 'null-allin',
              operator: 'Fabricated Op',
              address: '1 Fake St',
              municipality: 'Toronto',
              mandatoryFeesKnown: true,
              active: true,
              estimatedAllInMonthly: null,
              askingRent: 700,
            },
          ]),
        }),
      err => {
        // This is the record that rendered "VERIFIED ≤ $850" beside "Unknown",
        // earned +35 Fit and dropped out of the verification queue.
        assert.match(err.details.partial.results[0].reason, /mandatoryFeesKnown:true/);
        return true;
      },
    );
    assert.equal(client.upserts.length, 0);
  });

  it('office: a zero all-in figure is refused for the same reason', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('office', []) });
    await assert.rejects(
      () =>
        pipeline.runUpsert({
          scope: 'office',
          envelope: envelope([
            {
              id: 'zero-allin',
              operator: 'Fabricated Op',
              address: '1 Fake St',
              municipality: 'Toronto',
              mandatoryFeesKnown: true,
              active: true,
              estimatedAllInMonthly: 0,
            },
          ]),
        }),
      err => {
        assert.match(err.details.partial.results[0].reason, /above zero/);
        return true;
      },
    );
  });

  it('a required stored field cannot be blanked to null or an empty string', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('office', [{ ...OFFICE_RECORD }]) });
    await assert.rejects(
      () =>
        pipeline.runUpsert({
          scope: 'office',
          envelope: envelope([{ id: OFFICE_RECORD.id, operator: '', address: '', municipality: '' }]),
        }),
      err => {
        assert.match(err.details.partial.results[0].reason, /operator: is required and must not be blanked/);
        return true;
      },
    );
    assert.equal(client.state.office.listings[0].operator, OFFICE_RECORD.operator);
  });
});

/* ------------------------------------------------------ misspelled fields */

describe('a misspelled field never becomes a silent shadow field', () => {
  it('rejects a case-only near miss of a canonical property', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ id: DEAL_RECORD.id, landedCadPerlb: 3 }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /did you mean "landedCadPerLb"/);
        return true;
      },
    );
    assert.equal(client.upserts.length, 0, 'a shadow field must never be persisted');
    assert.equal(client.state.deals.listings[0].landedCadPerLb, DEAL_RECORD.landedCadPerLb);
  });

  it('rejects a shouted spelling too', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ id: DEAL_RECORD.id, LANDEDCADPERLB: 3 }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /did you mean "landedCadPerLb"/);
        return true;
      },
    );
  });

  it('drops an unrecognised field with a loud warning instead of storing it', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    const result = await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([{ id: DEAL_RECORD.id, priceCad: 190, notARealField: { a: 1 }, weirdNumber: 1e999 }]),
    });
    const entry = result.structuredContent.results[0];
    assert.match((entry.warnings ?? []).join(' '), /unrecognised field/);
    assert.match((entry.warnings ?? []).join(' '), /notARealField/);
    const sent = client.upserts[0].listings[0];
    assert.equal('notARealField' in sent, false);
    assert.equal('weirdNumber' in sent, false, 'Infinity in an unknown field used to arrive downstream as null');
    assert.equal(sent.priceCad, 190, 'the legitimate part of the update still lands');
    assert.deepEqual(entry.changedFields, ['priceCad'], 'changedFields must not name a field that was not stored');
  });
});

/* ------------------------------------------------ store growth and repair */

describe('the authoritative store has a ceiling', () => {
  it('refuses a write that would push the feed past its configured maximum', async () => {
    const existing = Array.from({ length: 9 }, (_, index) => ({ ...JOB_RECORD, id: `job-${index}`, sourceId: String(index) }));
    const { pipeline, client } = buildPipeline({
      feeds: feedsWith('jobs', existing),
      config: testConfig({ MCP_MAX_FEED_LISTINGS: '10' }),
    });

    await assert.rejects(
      () =>
        pipeline.runUpsert({
          scope: 'jobs',
          envelope: envelope([
            { ...JOB_RECORD, id: 'job-new-1', sourceId: 'n1' },
            { ...JOB_RECORD, id: 'job-new-2', sourceId: 'n2' },
          ]),
        }),
      err => {
        assert.equal(err.code, 'BATCH_TOO_LARGE');
        assert.match(err.message, /record ceiling/);
        return true;
      },
    );
    assert.equal(client.upserts.length, 0);
  });

  it('still allows updates to existing records at the ceiling', async () => {
    const existing = Array.from({ length: 10 }, (_, index) => ({ ...JOB_RECORD, id: `job-${index}`, sourceId: String(index) }));
    const { pipeline } = buildPipeline({
      feeds: feedsWith('jobs', existing),
      config: testConfig({ MCP_MAX_FEED_LISTINGS: '10' }),
    });
    const result = await pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ id: 'job-0', fitScore: 91 }]) });
    assert.equal(result.structuredContent.updated, 1);
  });
});

describe('a stored record with an invalid server-owned field can still be updated', () => {
  it('drops the un-repairable field rather than freezing the record forever', async () => {
    // Records can enter the feed without passing the connector (the GitHub
    // feed-sync bridge, a direct curl). A normal field is repairable by sending
    // a valid value, but SERVER_OWNED_FIELDS are stripped from caller input, so
    // a bad one used to reject every future update to that record.
    const broken = { ...JOB_RECORD, lastChanged: 12345 };
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('jobs', [broken]) });

    const result = await pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ id: JOB_RECORD.id, fitScore: 88 }]) });
    const entry = result.structuredContent.results[0];
    assert.equal(entry.outcome, 'updated');
    assert.match((entry.warnings ?? []).join(' '), /lastChanged/);
    assert.equal(client.upserts[0].listings[0].fitScore, 88);
    assert.equal('lastChanged' in client.upserts[0].listings[0], false);
  });

  it('still rejects a defect the caller could have fixed', async () => {
    const broken = { ...JOB_RECORD, fitScore: 500 };
    const { pipeline } = buildPipeline({ feeds: feedsWith('jobs', [broken]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ id: JOB_RECORD.id, company: 'Renamed Co' }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /fitScore/);
        return true;
      },
    );
  });
});

/* --------------------------------------------------------------- time */

describe('record timestamps are placed on a real timeline', () => {
  it('rejects a timezone-less auction end time', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'deals', envelope: envelope([{ id: DEAL_RECORD.id, endTime: '2026-08-09 20:00' }]) }),
      err => {
        // The browser reads this as local time, so the countdown was four hours
        // wrong under America/Toronto with no indication.
        assert.match(err.details.partial.results[0].reason, /explicit UTC offset/);
        return true;
      },
    );
  });

  it('rejects a free-form posted date', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('jobs', [{ ...JOB_RECORD }]) });
    await assert.rejects(
      () => pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ id: JOB_RECORD.id, postedAt: 'yesterday' }]) }),
      err => {
        assert.match(err.details.partial.results[0].reason, /postedAt/);
        return true;
      },
    );
  });

  it('normalises an offset timestamp to UTC so every reader agrees', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([{ id: DEAL_RECORD.id, endTime: '2026-08-09T20:00:00-04:00' }]),
    });
    assert.equal(client.upserts[0].listings[0].endTime, '2026-08-10T00:00:00.000Z');
  });

  it('accepts an unambiguous calendar date', async () => {
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('jobs', [{ ...JOB_RECORD }]) });
    await pipeline.runUpsert({ scope: 'jobs', envelope: envelope([{ id: JOB_RECORD.id, postedAt: '2026-08-01' }]) });
    assert.equal(client.upserts[0].listings[0].postedAt, '2026-08-01T00:00:00.000Z');
  });
});

/* ------------------------------------------- cross-layer disagreements */

describe('the two connector layers agree with each other', () => {
  it('accepts a numeric eBay itemId, which the id derivation already assumed', async () => {
    // resolveId does String(raw.itemId) — written for the natural eBay form —
    // while the canonical schema types itemId ["string","null"], so a numeric
    // itemId derived a valid id and was then rejected by Ajv.
    const { pipeline, client } = buildPipeline({ feeds: feedsWith('deals', []) });
    const result = await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([
        {
          itemId: 267743096355,
          category: 'Bulk LEGO',
          searchName: 'Bulk LEGO Deal Watch',
          title: 'Numeric item id lot',
          listingType: 'buy_it_now',
        },
      ]),
    });
    assert.equal(result.structuredContent.results[0].outcome, 'created');
    assert.equal(client.upserts[0].listings[0].id, 'ebay-267743096355');
    assert.equal(client.upserts[0].listings[0].itemId, '267743096355');
  });

  it('warns when a deals status falls outside the vocabulary the dashboard understands', async () => {
    const { pipeline } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    const capitalised = await pipeline.runUpsert({
      scope: 'deals',
      envelope: envelope([{ id: DEAL_RECORD.id, status: 'Expired' }]),
    });
    // public/deals/app.js special-cases only the exact lowercase token.
    assert.match((capitalised.structuredContent.results[0].warnings ?? []).join(' '), /use the lowercase form/);

    const { pipeline: second } = buildPipeline({ feeds: feedsWith('deals', [{ ...DEAL_RECORD }]) });
    const invented = await second.runUpsert({
      scope: 'deals',
      envelope: envelope([{ id: DEAL_RECORD.id, status: 'archived' }]),
    });
    assert.match((invented.structuredContent.results[0].warnings ?? []).join(' '), /outside the documented vocabulary/);
  });
});

/* ------------------------------------------------- untrusted text bounds */

describe('untrusted listing text is bounded per field, not per record', () => {
  const limits = testConfig().limits;

  it('trims a long field even when the whole record is small', () => {
    const title = 'x'.repeat(11_219);
    const { listing, truncated } = boundRecord({ id: 'a', title }, limits);
    assert.equal(truncated, true, 'an 11,219-character title used to return byte-identical with truncated:false');
    assert.ok(listing.title.length <= limits.maxTextChars + 1);
  });

  it('neutralises control characters that could hide text', () => {
    const { listing } = boundRecord({ id: 'a', notes: `visible${String.fromCharCode(27)}[2Khidden` }, limits);
    assert.equal(listing.notes.includes(String.fromCharCode(27)), false);
  });

  it('leaves an ordinary record untouched and unflagged', () => {
    const record = { id: 'a', title: 'A normal 20 lb lot', priceCad: 180, active: true };
    const { listing, truncated } = boundRecord(record, limits);
    assert.equal(truncated, false);
    assert.deepEqual(listing, record);
  });
});

/* ------------------------------------------------------------ end to end */

describe('honest reporting end to end against the real dashboard API', () => {
  let harness;
  let session;

  before(async () => {
    harness = await startHarness({ portBase: 8324 });
    session = await harness.connectClient();
  });

  after(async () => {
    await session?.close();
    await harness?.stop();
  });

  const call = (name, args) => session.client.callTool({ name, arguments: args });

  it('a null on a field the stored record lacks is never persisted and never mis-summarised', async () => {
    await call('upsert_deal_listings', {
      source: 'bulk-lego-deal-watch',
      observedAt: '2026-08-08T12:00:00Z',
      listings: [
        {
          itemId: 'e2e777',
          category: 'Bulk LEGO',
          searchName: 'Bulk LEGO Deal Watch',
          title: 'No landed cost yet',
          listingType: 'buy_it_now',
          priceCad: 150,
          active: true,
        },
      ],
    });

    const before = (await harness.readFeed('deals')).listings.find(l => l.id === 'ebay-e2e777');
    assert.equal('landedCadPerLb' in before, false);

    const result = await call('upsert_deal_listings', {
      source: 'bulk-lego-deal-watch',
      observedAt: '2026-08-08T13:00:00Z',
      listings: [{ id: 'ebay-e2e777', landedCadPerLb: null }],
    });

    const after = (await harness.readFeed('deals')).listings.find(l => l.id === 'ebay-e2e777');
    assert.equal('landedCadPerLb' in after, false, 'the null was persisted while being reported as a no-op');
    assert.equal(after.landedCadPerLb, undefined);
    // And the report matches what happened.
    assert.equal(result.structuredContent.results[0].changedFields.includes('landedCadPerLb'), false);
    assert.match((result.structuredContent.results[0].warnings ?? []).join(' '), /absent field/);
  });

  it('records a reconstructable before-image for every changed record', async () => {
    await call('upsert_office_listings', {
      source: 'office-scout-skill',
      observedAt: '2026-08-08T12:00:00Z',
      listings: [
        {
          id: 'before-image-1',
          operator: 'Original Operator',
          address: '5 Original Road',
          municipality: 'Toronto',
          mandatoryFeesKnown: false,
          active: true,
          askingRent: 600,
        },
      ],
    });

    await call('upsert_office_listings', {
      source: 'office-scout-skill',
      observedAt: '2026-08-08T13:00:00Z',
      listings: [{ id: 'before-image-1', operator: 'ATTACKER CONTROLLED', active: false }],
    });

    const images = harness.logs.events('write_before_image');
    const image = images.reverse().find(entry => entry.beforeImage?.['before-image-1']);
    assert.ok(image, 'a write with no before-image cannot be undone from any record anywhere');
    assert.equal(image.beforeImage['before-image-1'].operator, '"Original Operator"');
    assert.equal(image.beforeImage['before-image-1'].active, 'true');
    assert.deepEqual(image.deactivatedIds, ['before-image-1'], 'a retirement must be called out');
  });

  it('refuses a JSON-RPC batch larger than the configured cap', async () => {
    const batch = Array.from({ length: 12 }, (_, index) => ({
      jsonrpc: '2.0',
      id: index,
      method: 'tools/call',
      params: { name: 'get_dashboard_summary', arguments: { scope: 'deals' } },
    }));
    const res = await harness.http('/mcp', {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, authorization: `Bearer ${DEV_TOKEN}` },
      body: JSON.stringify(batch),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'too_many_tool_calls');
  });

  it('refuses GET on the stateless MCP endpoint instead of holding a stream open forever', async () => {
    const res = await harness.http('/mcp', {
      method: 'GET',
      headers: { accept: 'text/event-stream', authorization: `Bearer ${DEV_TOKEN}` },
    });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST, DELETE');
  });

  it('still lets the official SDK client connect and list tools', async () => {
    // The SDK client opens the standalone GET stream on connect; a 405 is the
    // spec's answer for a server that offers no SSE stream and must not break it.
    const second = await harness.connectClient({ name: 'post-405-client' });
    const { tools } = await second.client.listTools();
    assert.ok(tools.length > 0);
    await second.close();
  });
});

/* --------------------------------------- per-tool-call rate accounting */

describe('rate limits are charged per tool call, not per HTTP request', () => {
  let harness;

  before(async () => {
    harness = await startHarness({
      portBase: 8328,
      mcpEnv: { MCP_WRITES_PER_MINUTE: '2', MCP_READS_PER_MINUTE: '60', MCP_MAX_TOOL_CALLS_PER_REQUEST: '20' },
    });
  });

  after(async () => {
    await harness?.stop();
  });

  function writeCall(id, itemId) {
    return {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: 'upsert_deal_listings',
        arguments: {
          source: 'batch-test',
          observedAt: '2026-08-08T12:00:00Z',
          listings: [
            {
              itemId: String(itemId),
              category: 'Bulk LEGO',
              searchName: 'Bulk LEGO Deal Watch',
              title: `Batch lot ${itemId}`,
              listingType: 'buy_it_now',
              priceCad: 10,
            },
          ],
        },
      },
    };
  }

  // These two run in order against one 60-second window: MCP_WRITES_PER_MINUTE
  // is 2, the single write below spends 1, and the three-element batch that
  // follows must spend 3 more rather than 1.
  it('a single write spends one token from the budget', async () => {
    const res = await harness.http('/mcp', {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, authorization: `Bearer ${DEV_TOKEN}` },
      body: JSON.stringify(writeCall(4, 9000004)),
    });
    assert.equal(res.status, 200);
    assert.ok((await harness.readFeed('deals')).listings.some(l => l.id === 'ebay-9000004'));
  });

  it('a batch of writes spends one token per write, not one per request', async () => {
    // MCP dropped JSON-RPC batching in 2025-06-18 and the official SDK client
    // sends one message per POST, so this is defence in depth — but the batch
    // used to cost exactly one write token however many writes it carried, and
    // no test in the suite had ever sent a JSON-RPC array.
    const batch = [writeCall(1, 9000001), writeCall(2, 9000002), writeCall(3, 9000003)];
    const res = await harness.http('/mcp', {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, authorization: `Bearer ${DEV_TOKEN}` },
      body: JSON.stringify(batch),
    });
    assert.equal(res.status, 429, 'three writes in one request must cost three write tokens, not one');
    assert.equal(res.json.error, 'rate_limited');

    const feed = await harness.readFeed('deals');
    assert.equal(feed.listings.some(l => l.id === 'ebay-9000001'), false, 'the batch must not have been executed');
  });
});
