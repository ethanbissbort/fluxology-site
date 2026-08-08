/**
 * Unit tests (SDD §26.1).
 *
 * OAuth scope mapping, stable id derivation, the category invariants, URL
 * validation, material diffing, secret redaction, error mapping, and the
 * configuration guards that keep development auth out of production.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ConfigError, OAUTH_SCOPES, loadConfig } from '../src/config.mjs';
import { buildChallenge, extractScopes, metadataCandidates, protectedResourceMetadataPath, scopeForTool } from '../src/auth.mjs';
import { HttpError, ToolError, isRetryable } from '../src/errors.mjs';
import { AUDIT_FIELDS, SERVER_OWNED_FIELDS, formatAjvErrors, majorVersion } from '../src/schemas.mjs';
import { clearRegisteredSecrets, createLogger, redact, registerSecret, scrubText } from '../src/logging.mjs';
import { createRateLimiter, createScopeGates, createSemaphore } from '../src/concurrency.mjs';
import { boundRecord } from '../src/tools/read-tools.mjs';
import {
  changedFieldNames,
  checkNonNegative,
  checkRecordBounds,
  checkUrls,
  fullyDifferent,
  isHttpUrl,
  materiallyDifferent,
  normalizeSource,
  validateObservedAt,
} from '../src/validation/common.mjs';
import { office } from '../src/validation/office.mjs';
import { deals } from '../src/validation/deals.mjs';
import { jobs } from '../src/validation/jobs.mjs';
import { BASE_ENV, DEAL_RECORD, JOB_RECORD, OFFICE_RECORD, testConfig } from './helpers/fixtures.mjs';

const LIMITS = testConfig().limits;

describe('configuration', () => {
  it('rejects development auth when NODE_ENV is production', () => {
    assert.throws(
      () => loadConfig({ ...BASE_ENV, NODE_ENV: 'production', MCP_PUBLIC_URL: 'https://mcp.fluxology.ca/mcp', OAUTH_ISSUER: 'https://auth.fluxology.ca' }),
      ConfigError,
    );
  });

  it('requires https for the public resource in production', () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', MCP_PUBLIC_URL: 'http://mcp.fluxology.ca/mcp', OAUTH_ISSUER: 'https://auth.fluxology.ca' }),
      /https in production/,
    );
  });

  it('requires an issuer when development auth is off', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'test' }), /OAUTH_ISSUER is required/);
  });

  it('treats any unrecognised NODE_ENV as production', () => {
    // The guard used to be `nodeEnv === 'production'`, so 'prod', 'Production'
    // and an unset value all quietly disabled it along with the https rule.
    // An UNSET NODE_ENV still means development, per the Node convention the
    // rest of the ecosystem uses; a *misspelled* one no longer does.
    for (const nodeEnv of ['prod', 'Production', 'staging', 'prod-eu']) {
      assert.throws(
        () => loadConfig({ ...BASE_ENV, NODE_ENV: nodeEnv, MCP_PUBLIC_URL: 'https://mcp.fluxology.ca/mcp', OAUTH_ISSUER: 'https://auth.fluxology.ca' }),
        ConfigError,
        `NODE_ENV=${JSON.stringify(nodeEnv)} must not enable development auth`,
      );
    }
    // ...while the genuinely relaxed environments still work.
    for (const nodeEnv of ['development', 'test', 'local']) {
      assert.equal(loadConfig({ ...BASE_ENV, NODE_ENV: nodeEnv }).production, false);
    }
  });

  it('grants the development bearer read-only scopes by default', () => {
    // It carries no issuer, no audience and no expiry; defaulting it to all
    // four scopes made it a full write credential for all three dashboards.
    assert.deepEqual(testConfig().auth.devAuthScopes, [OAUTH_SCOPES.read]);
    assert.deepEqual(testConfig({ MCP_DEV_AUTH_SCOPES: 'dashboards:read jobs:write' }).auth.devAuthScopes, [
      OAUTH_SCOPES.read,
      OAUTH_SCOPES.jobs,
    ]);
  });

  it('refuses a cleartext token trust root outside development', () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', MCP_PUBLIC_URL: 'https://mcp.fluxology.ca/mcp', OAUTH_ISSUER: 'http://auth.internal' }),
      /OAUTH_ISSUER must be https/,
    );
  });

  it('refuses signing keys hosted on an origin other than the issuer', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'production',
          MCP_PUBLIC_URL: 'https://mcp.fluxology.ca/mcp',
          OAUTH_ISSUER: 'https://auth.fluxology.ca',
          OAUTH_JWKS_URI: 'https://169.254.169.254/latest/meta-data/',
        }),
      /must share the OAUTH_ISSUER origin/,
    );
    assert.equal(
      loadConfig({
        NODE_ENV: 'production',
        MCP_PUBLIC_URL: 'https://mcp.fluxology.ca/mcp',
        OAUTH_ISSUER: 'https://auth.fluxology.ca',
        OAUTH_JWKS_URI: 'https://auth.fluxology.ca/jwks',
      }).auth.jwksUri,
      'https://auth.fluxology.ca/jwks',
    );
  });

  it('clamps limits to their safe upper bounds', () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, MCP_MAX_LISTINGS_PER_WRITE: '100000' }), /must be between/);
    assert.equal(loadConfig({ ...BASE_ENV, MCP_MAX_LISTINGS_PER_WRITE: '25' }).limits.maxListingsPerWrite, 25);
  });

  it('defaults the audience to the canonical MCP resource', () => {
    const config = testConfig();
    assert.equal(config.auth.audience, 'http://127.0.0.1:8083/mcp');
    assert.equal(config.mcpPath, '/mcp');
  });

  it('never leaves a trailing slash on the downstream base URL', () => {
    const config = testConfig({ DASHBOARD_API_URL: 'http://fluxology-dashboard-api:8082/' });
    assert.equal(config.dashboardApiUrl, 'http://fluxology-dashboard-api:8082');
    assert.equal(new URL(`${config.dashboardApiUrl}/v1/office/feed`).pathname, '/v1/office/feed');
  });

  it('reads downstream secrets from a secret file when one is configured', () => {
    const config = loadConfig({ ...BASE_ENV, OFFICE_INGEST_TOKEN_FILE: new URL('./helpers/fixtures.mjs', import.meta.url).pathname });
    assert.equal(config.secretOrigins.office.startsWith('file:'), true);
    assert.equal(config.secretOrigins.deals, 'env');
  });
});

describe('oauth scope mapping', () => {
  it('maps every tool to exactly one scope', () => {
    assert.equal(scopeForTool('get_dashboard_summary'), OAUTH_SCOPES.read);
    assert.equal(scopeForTool('get_dashboard_listing'), OAUTH_SCOPES.read);
    assert.equal(scopeForTool('upsert_office_listings'), OAUTH_SCOPES.office);
    assert.equal(scopeForTool('upsert_deal_listings'), OAUTH_SCOPES.deals);
    assert.equal(scopeForTool('upsert_job_listings'), OAUTH_SCOPES.jobs);
  });

  it('defines no scope that grants more than one category', () => {
    const writeScopes = [OAUTH_SCOPES.office, OAUTH_SCOPES.deals, OAUTH_SCOPES.jobs];
    assert.equal(new Set(writeScopes).size, 3);
    assert.equal(writeScopes.includes('dashboards:write'), false);
  });

  it('returns null for an unknown tool', () => {
    assert.equal(scopeForTool('delete_listing'), null);
    assert.equal(scopeForTool('replace_feed'), null);
  });

  it('extracts scopes from scope, scp and scopes claims', () => {
    assert.deepEqual(extractScopes({ scope: 'dashboards:read office:write' }).sort(), ['dashboards:read', 'office:write']);
    assert.deepEqual(extractScopes({ scp: ['deals:write'] }), ['deals:write']);
    assert.deepEqual(extractScopes({ scopes: 'jobs:write' }), ['jobs:write']);
    assert.deepEqual(extractScopes({}), []);
  });
});

describe('oauth resource metadata and challenges', () => {
  const config = testConfig();

  it('places the metadata document under the resource path', () => {
    assert.equal(protectedResourceMetadataPath('/mcp'), '/.well-known/oauth-protected-resource/mcp');
    assert.equal(protectedResourceMetadataPath(''), '/.well-known/oauth-protected-resource');
  });

  it('points the challenge at the metadata document', () => {
    const challenge = buildChallenge(config, { error: 'invalid_token', description: 'expired' });
    assert.match(challenge, /^Bearer realm="fluxology-dashboard-writer"/);
    assert.match(challenge, /error="invalid_token"/);
    assert.match(challenge, /resource_metadata="http:\/\/127\.0\.0\.1:8083\/\.well-known\/oauth-protected-resource\/mcp"/);
  });

  it('cannot be broken out of by a hostile description', () => {
    const challenge = buildChallenge(config, { error: 'invalid_token', description: 'bad", scope="office:write' });
    assert.equal(challenge.includes('bad, scope=office:write'), true);
    assert.equal((challenge.match(/scope="/g) ?? []).length, 0);
  });

  it('offers both RFC 8414 and OIDC discovery locations', () => {
    assert.deepEqual(metadataCandidates('https://auth.fluxology.ca'), [
      'https://auth.fluxology.ca/.well-known/oauth-authorization-server',
      'https://auth.fluxology.ca/.well-known/openid-configuration',
    ]);
    assert.equal(
      metadataCandidates('https://auth.example.com/realms/fluxology')[0],
      'https://auth.example.com/.well-known/oauth-authorization-server/realms/fluxology',
    );
  });
});

describe('stable id derivation', () => {
  it('requires an explicit id for office', () => {
    assert.equal(office.resolveId({ id: 'abc' }, LIMITS).id, 'abc');
    assert.match(office.resolveId({}, LIMITS).error, /requires a stable id/);
    assert.match(office.resolveId({ id: 'x'.repeat(201) }, LIMITS).error, /exceeds 200/);
  });

  it('derives ebay-<itemId> for deals', () => {
    assert.equal(deals.resolveId({ itemId: '123456789' }, LIMITS).id, 'ebay-123456789');
    assert.equal(deals.resolveId({ id: 'ebay-9', itemId: '9' }, LIMITS).id, 'ebay-9');
    assert.match(deals.resolveId({}, LIMITS).error, /requires a stable id/);
  });

  it('warns when an explicit deals id ignores the ebay convention', () => {
    const resolved = deals.resolveId({ id: 'lot-42', itemId: '99' }, LIMITS);
    assert.equal(resolved.id, 'lot-42');
    assert.match(resolved.warnings[0], /ebay-99/);
  });

  it('derives <source>-<sourceId> for jobs', () => {
    assert.equal(jobs.resolveId({ source: 'indeed', sourceId: 'abc' }, LIMITS).id, 'indeed-abc');
    assert.equal(jobs.resolveId({ id: ' spaced ' }, LIMITS).id, 'spaced');
    assert.match(jobs.resolveId({ source: 'indeed' }, LIMITS).error, /both source and sourceId/);
  });
});

describe('office invariants (SDD §13.1)', () => {
  const ctx = { isNew: false, feedRoot: { hardAllInCeilingCad: 850 }, limits: LIMITS };

  it('accepts a well-formed verified record', () => {
    assert.deepEqual(office.check({ ...OFFICE_RECORD }, ctx).errors, []);
  });

  it('rejects verified without mandatoryFeesKnown', () => {
    const { errors } = office.check({ ...OFFICE_RECORD, mandatoryFeesKnown: false }, ctx);
    assert.match(errors.join(' '), /requires mandatoryFeesKnown:true/);
  });

  it('rejects a claim that the fees are known with no all-in figure', () => {
    // The dashboard recomputes the badge from mandatoryFeesKnown plus a finite
    // estimatedAllInMonthly and ignores stored costStatus, so the invariant is
    // attached to those two facts rather than to the costStatus label.
    const { errors } = office.check({ ...OFFICE_RECORD, estimatedAllInMonthly: null }, ctx);
    assert.match(errors.join(' '), /mandatoryFeesKnown:true/);
  });

  it('rejects a zero all-in figure, which Number.isFinite would accept as verified', () => {
    const { errors } = office.check({ ...OFFICE_RECORD, estimatedAllInMonthly: 0 }, ctx);
    assert.match(errors.join(' '), /above zero/);
  });

  it('rejects the cost-honesty bypass even when costStatus is not "verified"', () => {
    const { errors } = office.check({ ...OFFICE_RECORD, costStatus: 'plausible', estimatedAllInMonthly: null }, ctx);
    assert.match(errors.join(' '), /mandatoryFeesKnown:true/);
  });

  it('still accepts an honest record whose known costs sit above the ceiling', () => {
    // costStatus 'over' is the truthful state for a record whose real all-in
    // figure exceeds the budget; only the "verified" claim is ceiling-bound.
    const { errors } = office.check(
      { ...OFFICE_RECORD, costStatus: 'over', mandatoryFeesKnown: true, estimatedAllInMonthly: 900.61 },
      ctx,
    );
    assert.deepEqual(errors, []);
  });

  it('rejects verified without a finite all-in cost', () => {
    const { errors } = office.check({ ...OFFICE_RECORD, mandatoryFeesKnown: false, estimatedAllInMonthly: null }, ctx);
    assert.match(errors.join(' '), /requires a finite all-in monthly cost/);
  });

  it('rejects a verified all-in cost above the hard ceiling', () => {
    const { errors } = office.check({ ...OFFICE_RECORD, estimatedAllInMonthly: 900 }, ctx);
    assert.match(errors.join(' '), /exceeds the hard all-in ceiling of 850/);
  });

  it('rejects a verified record when the feed has no usable ceiling', () => {
    const { errors } = office.check({ ...OFFICE_RECORD }, { ...ctx, feedRoot: {} });
    assert.match(errors.join(' '), /no usable ceiling/);
  });

  it('rejects negative money and walking minutes', () => {
    const { errors } = office.check({ ...OFFICE_RECORD, askingRent: -1, finalWalkMinutes: -2 }, ctx);
    assert.match(errors.join(' '), /askingRent: must not be negative/);
    assert.match(errors.join(' '), /finalWalkMinutes: must not be negative/);
  });

  it('rejects a non-http source URL', () => {
    const { errors } = office.check({ ...OFFICE_RECORD, sourceUrl: 'javascript:alert(1)' }, ctx);
    assert.match(errors.join(' '), /sourceUrl: must be an http\(s\) URL/);
  });

  it('strips caller-supplied priceHistory and audit stamps', () => {
    const stripped = office.stripCallerOwned({
      ...OFFICE_RECORD,
      priceHistory: [{ date: '2020-01-01', askingRent: 1 }],
      lastVerified: '2020-01-01',
      lastChanged: '2020-01-01',
    });
    for (const field of SERVER_OWNED_FIELDS) assert.equal(field in stripped, false, `${field} should be stripped`);
    assert.equal(stripped.operator, 'Regus');
  });
});

describe('deals invariants (SDD §13.2)', () => {
  const ctx = { isNew: true, feedRoot: {}, limits: LIMITS };

  it('accepts a well-formed new record', () => {
    assert.deepEqual(deals.check({ ...DEAL_RECORD }, ctx).errors, []);
  });

  it('requires category, searchName, title and listingType on a new record', () => {
    const { errors } = deals.check({ id: 'x' }, ctx);
    const text = errors.join(' ');
    for (const field of ['category', 'searchName', 'title', 'listingType']) assert.match(text, new RegExp(field));
  });

  it('does not require them on an update', () => {
    const { errors } = deals.check({ id: 'x', priceCad: 5 }, { ...ctx, isNew: false });
    assert.deepEqual(errors, []);
  });

  it('refuses to call shipping resolved without a shipping number', () => {
    const { errors } = deals.check({ ...DEAL_RECORD, shippingResolved: true, shippingCad: null }, ctx);
    assert.match(errors.join(' '), /cannot be true without a confirmed numeric shippingCad/);
  });

  it('pins shippingResolved:false when a per-pound figure has unresolved shipping', () => {
    const normalized = deals.normalize({ id: 'x', landedCadPerLb: 9 });
    assert.equal(normalized.shippingResolved, false);
    const warned = deals.check(normalized, { ...ctx, isNew: false });
    assert.match(warned.warnings.join(' '), /provisional/);
  });

  it('leaves a resolved record alone', () => {
    const normalized = deals.normalize({ ...DEAL_RECORD });
    assert.equal(normalized.shippingResolved, true);
  });

  it('rejects negative prices and non-integer bid counts', () => {
    const { errors } = deals.check({ ...DEAL_RECORD, priceCad: -1, bidCount: 1.5 }, ctx);
    assert.match(errors.join(' '), /priceCad: must not be negative/);
    assert.match(errors.join(' '), /bidCount: must be an integer/);
  });
});

describe('jobs invariants (SDD §13.3)', () => {
  const ctx = { isNew: true, feedRoot: {}, limits: LIMITS };

  it('accepts a well-formed new record', () => {
    assert.deepEqual(jobs.check({ ...JOB_RECORD }, ctx).errors, []);
  });

  it('requires title and company on a new record', () => {
    const { errors } = jobs.check({ id: 'x' }, ctx);
    assert.match(errors.join(' '), /title: is required/);
    assert.match(errors.join(' '), /company: is required/);
  });

  it('bounds fitScore to 0..100', () => {
    assert.match(jobs.check({ ...JOB_RECORD, fitScore: 101 }, ctx).errors.join(' '), /between 0 and 100/);
    assert.match(jobs.check({ ...JOB_RECORD, fitScore: -1 }, ctx).errors.join(' '), /between 0 and 100/);
    assert.deepEqual(jobs.check({ ...JOB_RECORD, fitScore: 0 }, ctx).errors, []);
    assert.deepEqual(jobs.check({ ...JOB_RECORD, fitScore: 100 }, ctx).errors, []);
  });

  it('rejects negative compensation', () => {
    assert.match(jobs.check({ ...JOB_RECORD, hourlyCadMin: -5 }, ctx).errors.join(' '), /hourlyCadMin: must not be negative/);
  });

  it('requires tracks to be bounded strings', () => {
    assert.match(jobs.check({ ...JOB_RECORD, tracks: 'electrical' }, ctx).errors.join(' '), /tracks: must be an array/);
    assert.match(jobs.check({ ...JOB_RECORD, tracks: [''] }, ctx).errors.join(' '), /non-empty string/);
    assert.match(
      jobs.check({ ...JOB_RECORD, tracks: Array.from({ length: 101 }, (_, i) => `t${i}`) }, ctx).errors.join(' '),
      /exceeds 100 elements/,
    );
  });
});

describe('common validation helpers', () => {
  it('accepts only http(s) URLs', () => {
    assert.equal(isHttpUrl('https://example.com/a', 2048), true);
    assert.equal(isHttpUrl('http://example.com', 2048), true);
    assert.equal(isHttpUrl('ftp://example.com', 2048), false);
    assert.equal(isHttpUrl('javascript:alert(1)', 2048), false);
    assert.equal(isHttpUrl('file:///etc/passwd', 2048), false);
    assert.equal(isHttpUrl('not a url', 2048), false);
    assert.equal(isHttpUrl(`https://example.com/${'a'.repeat(3000)}`, 2048), false);
  });

  it('bounds strings by field class', () => {
    assert.deepEqual(checkRecordBounds({ id: 'a'.repeat(200) }, LIMITS), []);
    assert.match(checkRecordBounds({ id: 'a'.repeat(201) }, LIMITS).join(' '), /exceeds 200 characters/);
    assert.deepEqual(checkRecordBounds({ notes: 'n'.repeat(8000) }, LIMITS), []);
    assert.match(checkRecordBounds({ notes: 'n'.repeat(8001) }, LIMITS).join(' '), /exceeds 8000 characters/);
    assert.match(checkRecordBounds({ title: 't'.repeat(301) }, LIMITS).join(' '), /exceeds 300 characters/);
    assert.match(checkRecordBounds({ amenities: new Array(101).fill('x') }, LIMITS).join(' '), /exceeds 100 elements/);
  });

  it('rejects control characters but allows newlines and tabs', () => {
    assert.match(checkRecordBounds({ notes: `bad${String.fromCharCode(0)}` }, LIMITS).join(' '), /control characters/);
    assert.match(checkRecordBounds({ notes: `bell${String.fromCharCode(7)}` }, LIMITS).join(' '), /control characters/);
    assert.deepEqual(checkRecordBounds({ notes: 'line\nline\ttab' }, LIMITS), []);
  });

  it('rejects pathologically deep records', () => {
    let nested = { value: 1 };
    for (let i = 0; i < 12; i += 1) nested = { nested };
    assert.match(checkRecordBounds(nested, LIMITS).join(' '), /nested more than/);
  });

  it('treats null numeric fields as absent', () => {
    assert.deepEqual(checkNonNegative({ a: null, b: undefined }, ['a', 'b']), []);
    assert.match(checkNonNegative({ a: Number.NaN }, ['a']).join(' '), /finite number/);
  });

  it('ignores empty URL fields', () => {
    assert.deepEqual(checkUrls({ url: '', imageUrl: null }, ['url', 'imageUrl'], LIMITS), []);
  });

  it('constrains the source label to the downstream audit charset', () => {
    assert.equal(normalizeSource('bulk-lego-deal-watch', 100).value, 'bulk-lego-deal-watch');
    assert.equal(normalizeSource('office-scout-skill', 100).ok, true);
    assert.equal(normalizeSource('bad source!', 100).ok, false);
    assert.equal(normalizeSource('-leading', 100).ok, false);
    assert.equal(normalizeSource('x'.repeat(101), 100).ok, false);
    assert.equal(normalizeSource('', 100).ok, false);
  });
});

describe('observedAt validation (SDD §11 step 4)', () => {
  const now = Date.parse('2026-08-08T18:00:00Z');
  const opts = { maxClockSkewMs: 300_000, maxObservedAgeMs: 604_800_000, now };

  it('accepts an offset timestamp and normalises it to UTC', () => {
    const result = validateObservedAt('2026-08-08T14:00:00-04:00', opts);
    assert.equal(result.ok, true);
    assert.equal(result.value, '2026-08-08T18:00:00.000Z');
  });

  it('rejects unparseable values', () => {
    assert.equal(validateObservedAt('yesterday', opts).ok, false);
    assert.equal(validateObservedAt('', opts).ok, false);
    assert.equal(validateObservedAt(null, opts).ok, false);
  });

  it('rejects timestamps beyond the clock skew allowance', () => {
    assert.equal(validateObservedAt('2026-08-08T18:04:00Z', opts).ok, true);
    const far = validateObservedAt('2026-08-08T18:30:00Z', opts);
    assert.equal(far.ok, false);
    assert.match(far.reason, /in the future/);
  });

  it('rejects timestamps older than the ingestion horizon', () => {
    const old = validateObservedAt('2026-07-01T00:00:00Z', opts);
    assert.equal(old.ok, false);
    assert.match(old.reason, /ingestion horizon/);
  });
});

describe('material change semantics (SDD §14)', () => {
  const audit = AUDIT_FIELDS.deals;

  it('ignores audit fields when deciding materiality', () => {
    const before = { id: 'a', priceCad: 10, lastSeen: '2026-01-01', lastChanged: '2026-01-01' };
    const after = { id: 'a', priceCad: 10, lastSeen: '2026-02-02', lastChanged: '2026-01-01' };
    assert.equal(materiallyDifferent(before, after, audit), false);
    assert.equal(fullyDifferent(before, after), true);
  });

  it('detects a real field change', () => {
    const before = { id: 'a', priceCad: 10 };
    const after = { id: 'a', priceCad: 12 };
    assert.equal(materiallyDifferent(before, after, audit), true);
    assert.deepEqual(changedFieldNames(before, after, audit), ['priceCad']);
  });

  it('treats an added field as a change and an identical record as no change', () => {
    assert.deepEqual(changedFieldNames({ id: 'a' }, { id: 'a', title: 't' }, audit), ['title']);
    assert.deepEqual(changedFieldNames({ id: 'a', title: 't' }, { id: 'a', title: 't' }, audit), []);
  });

  it('compares nested values by content, not by reference', () => {
    const before = { id: 'a', tracks: ['x', 'y'] };
    assert.equal(materiallyDifferent(before, { id: 'a', tracks: ['x', 'y'] }, AUDIT_FIELDS.jobs), false);
    assert.equal(materiallyDifferent(before, { id: 'a', tracks: ['y', 'x'] }, AUDIT_FIELDS.jobs), true);
  });

  it('excludes office priceHistory from the material diff', () => {
    const before = { id: 'a', askingRent: 1, priceHistory: [{ date: '1' }] };
    const after = { id: 'a', askingRent: 1, priceHistory: [{ date: '1' }, { date: '2' }] };
    assert.equal(materiallyDifferent(before, after, AUDIT_FIELDS.office), false);
  });
});

describe('secret redaction (SDD §19.1, §25.1)', () => {
  it('redacts credential-shaped keys', () => {
    const out = redact({ authorization: 'Bearer abc', nested: { apiKey: 'k', token: 't' }, safe: 'value' });
    assert.equal(out.authorization, '[redacted]');
    assert.equal(out.nested.apiKey, '[redacted]');
    assert.equal(out.nested.token, '[redacted]');
    assert.equal(out.safe, 'value');
  });

  it('omits listing bodies entirely', () => {
    const out = redact({ listings: [{ id: 'a' }, { id: 'b' }], notes: 'personal note' });
    assert.equal(out.listings, '[2 item(s) omitted]');
    assert.equal(out.notes, '[omitted]');
  });

  it('keeps the one credential-shaped key that carries no credential', () => {
    // secretOrigins says whether each ingest token came from a Docker secret
    // mount, an env var or nowhere. It was redacted by its own name.
    const out = redact({ secretOrigins: { office: 'file:/run/secrets/office_ingest_token', deals: 'env', jobs: 'unset' } });
    assert.equal(out.secretOrigins.deals, 'env');
    assert.equal(out.secretOrigins.jobs, 'unset');
  });

  it('lets the bounded before-image through, and only that', () => {
    const out = redact({
      beforeImage: { 'rec-1': { notes: '"landlord confirmed 780"', operator: '"Regus"' } },
      notes: 'a listing body that is not a before-image',
    });
    assert.equal(out.beforeImage['rec-1'].notes, '"landlord confirmed 780"', 'a write must stay reconstructable');
    assert.equal(out.notes, '[omitted]');
  });

  it('scrubs registered secret values wherever they appear', () => {
    clearRegisteredSecrets();
    registerSecret('super-secret-ingest-token');
    assert.equal(scrubText('failed with super-secret-ingest-token in it'), 'failed with [redacted] in it');
    assert.equal(redact({ message: 'saw super-secret-ingest-token' }).message, 'saw [redacted]');
    clearRegisteredSecrets();
  });

  it('scrubs unregistered bearer material', () => {
    assert.equal(scrubText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9'), 'Authorization: Bearer [redacted]');
  });

  it('never emits a registered secret through the logger', () => {
    clearRegisteredSecrets();
    registerSecret('deals-ingest-token-value');
    const lines = [];
    const log = createLogger({ sink: { log: l => lines.push(l), error: l => lines.push(l) } });
    log.info('downstream_call', { authorization: 'Bearer deals-ingest-token-value', note: 'used deals-ingest-token-value' });
    assert.equal(lines.join('').includes('deals-ingest-token-value'), false);
    clearRegisteredSecrets();
  });

  it('bounds long strings and wide arrays', () => {
    assert.equal(redact({ text: 'x'.repeat(900) }).text.length, 513);
    assert.equal(redact({ ids: new Array(80).fill('id') }).ids.length, 51);
  });

  it('survives a circular structure without throwing', () => {
    const circular = { name: 'a' };
    circular.self = circular;
    const lines = [];
    const log = createLogger({ sink: { log: l => lines.push(l), error: l => lines.push(l) } });
    log.info('circular', circular);
    assert.equal(lines.length, 1);
  });
});

describe('error mapping (SDD §16)', () => {
  it('coerces an unknown tool error code to VALIDATION_ERROR', () => {
    assert.equal(new ToolError('NOPE', 'x').code, 'VALIDATION_ERROR');
    assert.equal(new ToolError('CONFLICT', 'x').code, 'CONFLICT');
  });

  it('marks only transient failures as retryable', () => {
    assert.equal(isRetryable(new ToolError('DOWNSTREAM_UNAVAILABLE', 'x')), true);
    assert.equal(isRetryable(new ToolError('CONFLICT', 'x')), true);
    assert.equal(isRetryable(new ToolError('VALIDATION_ERROR', 'x')), false);
    assert.equal(isRetryable(new HttpError(401, 'invalid_token', 'x')), false);
    assert.equal(isRetryable(new HttpError(403, 'insufficient_scope', 'x')), false);
    assert.equal(isRetryable(new HttpError(429, 'rate_limited', 'x')), true);
    assert.equal(isRetryable(new HttpError(503, 'busy', 'x')), true);
  });

  it('formats Ajv errors without dumping values', () => {
    const formatted = formatAjvErrors([
      { instancePath: '/listings/0/title', message: 'must be string', keyword: 'type' },
      { instancePath: '', message: "must have required property 'id'", keyword: 'required', params: { missingProperty: 'id' } },
    ]);
    assert.deepEqual(formatted, ['listings.0.title: must be string', "(record): must have required property 'id' (id)"]);
  });
});

describe('schema version comparison', () => {
  it('compares by major component', () => {
    assert.equal(majorVersion('2.5'), '2');
    assert.equal(majorVersion(3), '3');
    assert.equal(majorVersion('3.1.4'), '3');
    assert.equal(majorVersion(null), null);
  });
});

describe('concurrency controls (SDD §18)', () => {
  it('serialises beyond its capacity', async () => {
    const semaphore = createSemaphore(1);
    const first = await semaphore.acquire(1_000);
    assert.equal(semaphore.saturated, true);
    let secondAcquired = false;
    const second = semaphore.acquire(1_000).then(release => {
      secondAcquired = true;
      return release;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(secondAcquired, false);
    first();
    (await second)();
    assert.equal(semaphore.active, 0);
  });

  it('times out rather than queueing forever', async () => {
    const semaphore = createSemaphore(1);
    await semaphore.acquire(1_000);
    await assert.rejects(() => semaphore.acquire(20), err => err.code === 'ACQUIRE_TIMEOUT');
  });

  it('keeps categories independent', async () => {
    const gates = createScopeGates(['office', 'deals', 'jobs'], 1);
    const officeLock = await gates.acquire('office', 1_000);
    // A different category is unaffected by the office lock.
    const dealsLock = await gates.acquire('deals', 50);
    officeLock();
    dealsLock();
  });

  it('rate limits per subject and per bucket', () => {
    const limiter = createRateLimiter({ windowMs: 60_000 });
    for (let i = 0; i < 3; i += 1) assert.equal(limiter.consume('write', 'alice', 3).allowed, true);
    assert.equal(limiter.consume('write', 'alice', 3).allowed, false);
    // Reads are a separate bucket, and Bob has his own window.
    assert.equal(limiter.consume('read', 'alice', 3).allowed, true);
    assert.equal(limiter.consume('write', 'bob', 3).allowed, true);
  });

  it('opens a new window once the old one expires', () => {
    const limiter = createRateLimiter({ windowMs: 1_000 });
    const start = Date.now();
    assert.equal(limiter.consume('read', 'carol', 1, start).allowed, true);
    assert.equal(limiter.consume('read', 'carol', 1, start + 500).allowed, false);
    assert.equal(limiter.consume('read', 'carol', 1, start + 1_500).allowed, true);
  });
});

describe('bounded read records (SDD §10.2)', () => {
  it('returns a small record untouched', () => {
    const result = boundRecord({ id: 'a', title: 'small' }, LIMITS);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.listing, { id: 'a', title: 'small' });
  });

  it('trims an oversized record instead of withholding it', () => {
    const record = {
      id: 'a',
      notes: 'n'.repeat(70_000),
      priceHistory: Array.from({ length: 40 }, (_, i) => ({ date: `d${i}` })),
    };
    const result = boundRecord(record, LIMITS);
    assert.equal(result.truncated, true);
    assert.equal(result.listing.priceHistory.length, 10);
    assert.equal(result.listing.notes.length, LIMITS.maxTextChars + 1);
    assert.equal(result.listing.id, 'a');
  });
});
