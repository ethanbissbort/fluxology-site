/**
 * Workflow tests: search coverage integrity, host-assisted ingestion,
 * stale-listing exclusion, form freeze→approve→submit-once, outreach
 * preparation and draft validation (SDD v2 §C2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer, callTool, runSearchToCompletion } from './helpers.mjs';
import { recordDecision } from '../../mcp-core/approval.mjs';
import { assertCounterInvariants } from '../src/search/run.mjs';

function seedListing(repos, overrides = {}) {
  return repos.listings.upsert({
    operator: 'Plain Landlord',
    address: '100 Test St Unit 2',
    municipality: 'Scarborough',
    rent: 700,
    mandatory_recurring_fees: [{ kind: 'hst', monthly: 91 }],
    usable_private_sqft: 300,
    access_basis: '24_7',
    hvac_basis: '24_7_INCLUDED',
    door_status: 'CLOSEABLE_LOCKABLE',
    enclosure_status: 'CONFIRMED',
    source_url: 'https://listings.example.com/office/100-test',
    active: true,
    ...overrides,
  });
}

test('coverage counters equal the records actually processed (fixtures)', async () => {
  const { server, repos } = testServer();
  repos.providers.upsert({ display_name: 'ManagedCo', website: 'https://managedco.example.com' });
  repos.providers.upsert({ display_name: 'OtherCo', website: 'https://otherco.example.com' });
  seedListing(repos);
  seedListing(repos, { address: '200 Test St', usable_private_sqft: 120 });
  seedListing(repos, { address: '300 Test St', usable_private_sqft: 90, rent: 1400 });

  const { runId, last } = await runSearchToCompletion(server, 'dual');
  assert.equal(last.value.status, 'COMPLETE');
  const audit = await callTool(server, 'office_audit_coverage', { search_run_id: runId });
  const c = audit.value.counters;

  assert.equal(c.search_results_discovered, 5); // 2 providers + 3 listings enumerated
  assert.equal(c.search_results_inspected, 5); // each actually processed
  assert.equal(c.candidates_detailed, 3); // three listings evaluated field-by-field
  assert.equal(c.candidates_surfaced, 2); // the C$1,400 listing is over budget (>1.4× target)
  assert.equal(c.hard_exclusions.over_budget, 1);
  assert.equal(c.canonical_pages_attempted, 0); // network disabled: no page was claimed inspected
  assert.ok(audit.value.limitations.filter((l) => l.kind === 'network_disabled').length >= 2); // provider page + listing checks deferred to host
  assertCounterInvariants(c);
  assert.match(audit.value.statement, /Discovered 5, inspected 5/);
});

test('a stale or redirected conventional listing cannot be surfaced as validated', async () => {
  const { server, repos } = testServer();
  const listing = seedListing(repos);
  repos.listings.upsert({ listing_id: listing.listing_id, canonical_validation: 'redirected', canonical_redirect_target: 'https://listings.example.com/gone' });
  const { runId } = await runSearchToCompletion(server, 'daily_conventional');
  const results = await callTool(server, 'office_search_results', { search_run_id: runId, include_excluded: true });
  const evaluated = results.value.conventional.find((l) => l.listing_id === listing.listing_id);
  assert.equal(evaluated.evaluation.surfaced, false);
  assert.equal(evaluated.evaluation.reason, 'dead_or_stale_source');
  const audit = await callTool(server, 'office_audit_coverage', { search_run_id: runId });
  assert.equal(audit.value.counters.hard_exclusions.dead_or_stale_source, 1);
});

test('host-assisted ingestion: needs_host item satisfied via office_ingest_observation, taxonomy enforced', async () => {
  const { server, repos } = testServer();
  const provider = repos.providers.upsert({ display_name: 'ManagedCo', website: 'https://managedco.example.com' });
  const { runId, last } = await runSearchToCompletion(server, 'daily_managed');
  assert.ok(last.value.needs_host_ingest?.some((n) => n.url === 'https://managedco.example.com'));

  // A bare sticker price without basis is refused (locked requirement 2).
  const bad = await callTool(server, 'office_ingest_observation', {
    url: 'https://managedco.example.com',
    source_type: 'provider_page',
    claims: [{ entity: 'offer', create: true, parent_id: 'loc_missing', fields: { sticker_price: 399 } }],
  });
  assert.equal(bad.isError, true);
  assert.equal(bad.value.error.code, 'PRICE_BASIS_AMBIGUOUS');

  // A proper claim set lands, preserving the per-desk basis.
  const location = repos.locations.upsert({ provider_id: provider.provider_id, address: '33 Bloor St E' });
  const good = await callTool(server, 'office_ingest_observation', {
    url: 'https://managedco.example.com',
    content: '<html><body>Private offices from $399/desk</body></html>',
    source_type: 'provider_page',
    search_run_id: runId,
    claims: [{ entity: 'offer', create: true, parent_id: location.location_id, fields: { product_kind: 'PRIVATE_OFFICE', price_basis: 'PER_DESK', sticker_price: 399 }, quote: 'from $399/desk' }],
  });
  assert.equal(good.isError, false);
  assert.equal(good.value.satisfied_needs_host, true);
  const offer = repos.offers.get(good.value.applied[0].id);
  assert.equal(offer.price_basis, 'PER_DESK');
  assert.equal(offer.enclosure_status, 'UNKNOWN'); // never assumed enclosed

  // An unknown field is rejected outright — content cannot smuggle new state.
  const smuggle = await callTool(server, 'office_ingest_observation', {
    url: 'https://managedco.example.com',
    source_type: 'provider_page',
    claims: [{ entity: 'provider', id: provider.provider_id, fields: { allowed_hosts_override: ['evil.com'] } }],
  });
  assert.equal(smuggle.isError, true);
  assert.equal(smuggle.value.error.code, 'VALIDATION_FAILED');
});

test('form workflow: freeze → approve → submit exactly once; edits invalidate approval', async () => {
  const { server, store, repos } = testServer();
  const prep = await callTool(server, 'office_form_prepare', {
    target_url: 'https://managedco.example.com/quote',
    fields: { name: 'Ethan Bissbort', email: 'ethan@fluxology.ca', message: 'Interested in a private office.' },
  });
  const submissionId = prep.value.submission_id;

  // Submitting without approval fails closed.
  const early = await callTool(server, 'office_form_submit', { submission_id: submissionId });
  assert.equal(early.isError, true);
  assert.equal(early.value.error.code, 'FORM_APPROVAL_REQUIRED');

  const frozen = await callTool(server, 'office_form_request_approval', { submission_id: submissionId });
  const hash = frozen.value.content_hash;
  assert.match(frozen.value.approval_instruction, /approve\.mjs approve/);

  // No MCP tool can grant approval — verify none exists.
  const tools = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } });
  assert.ok(!tools.result.tools.some((t) => /approve|grant/.test(t.name)), 'no approval-granting tool may exist');

  // Still unapproved → APPROVAL_MISSING.
  const missing = await callTool(server, 'office_form_submit', { submission_id: submissionId });
  assert.equal(missing.value.error.code, 'APPROVAL_MISSING');

  // Human approves out-of-band (what bin/approve.mjs writes).
  recordDecision(store, { subjectId: submissionId, contentHash: hash, decision: 'approve', approver: 'local-cli' });

  const submit = await callTool(server, 'office_form_submit', { submission_id: submissionId });
  assert.equal(submit.isError, false);
  assert.equal(submit.value.state, 'SUBMITTED');
  assert.equal(submit.value.outcome.mode, 'record_and_hold'); // network submission disabled by default

  // Second submit does not resubmit.
  const again = await callTool(server, 'office_form_submit', { submission_id: submissionId });
  assert.equal(again.isError, false);
  assert.match(again.value.note, /not resubmitting/);

  // A new submission whose fields change after approval is rejected stale.
  const prep2 = await callTool(server, 'office_form_prepare', { target_url: 'https://managedco.example.com/quote', fields: { name: 'E', email: 'e@fluxology.ca' } });
  const id2 = prep2.value.submission_id;
  const frozen2 = await callTool(server, 'office_form_request_approval', { submission_id: id2 });
  recordDecision(store, { subjectId: id2, contentHash: frozen2.value.content_hash, decision: 'approve', approver: 'local-cli' });
  repos.forms.upsert({ submission_id: id2, fields: { name: 'E', email: 'attacker@evil.com' } }); // content changed post-approval
  const stale = await callTool(server, 'office_form_submit', { submission_id: id2 });
  assert.equal(stale.isError, true);
  assert.equal(stale.value.error.code, 'APPROVAL_STALE');
});

test('parallel submissions consume at most one approval; unknown outcome never auto-resubmits', async () => {
  const { server, store, repos } = testServer();
  const prep = await callTool(server, 'office_form_prepare', { target_url: 'https://x.example.com/f', fields: { a: '1' } });
  const id = prep.value.submission_id;
  const frozen = await callTool(server, 'office_form_request_approval', { submission_id: id });
  recordDecision(store, { subjectId: id, contentHash: frozen.value.content_hash, decision: 'approve', approver: 'local-cli' });

  const { verifyAndConsume } = await import('../../mcp-core/approval.mjs');
  const first = verifyAndConsume(store, id, frozen.value.content_hash);
  const second = verifyAndConsume(store, id, frozen.value.content_hash);
  assert.equal(first, null); // exactly one winner
  assert.equal(second, 'APPROVAL_CONSUMED');

  // OUTCOME_UNKNOWN is terminal for automation.
  repos.forms.upsert({ submission_id: id, state: 'OUTCOME_UNKNOWN' });
  const retry = await callTool(server, 'office_form_submit', { submission_id: id });
  assert.equal(retry.isError, true);
  assert.equal(retry.value.error.code, 'FORM_OUTCOME_UNKNOWN');
});

test('outreach: prepare produces evidence-backed package; validator enforces the drafting rules', async () => {
  const { server, repos } = testServer();
  const provider = repos.providers.upsert({ display_name: 'ManagedCo', website: 'https://managedco.example.com', fnb_notes: 'daily breakfast advertised' });
  const location = repos.locations.upsert({ provider_id: provider.provider_id, address: '33 Bloor St E', hvac_basis: 'UNKNOWN' });
  repos.offers.upsert({ location_id: location.location_id, product_kind: 'PRIVATE_OFFICE', enclosure_status: 'CONFIRMED', door_status: 'CLOSEABLE_LOCKABLE', price_basis: 'PER_DESK', sticker_price: 399 });

  const prep = await callTool(server, 'office_outreach_prepare', { provider_id: provider.provider_id, location_ids: [location.location_id] });
  const pkg = prep.value.package;
  assert.equal(pkg.confirmed_private_office_requirement, true);
  assert.ok(pkg.unresolved_questions.some((q) => q.question.includes('per desk')));
  assert.ok(pkg.unresolved_questions.some((q) => q.question.toLowerCase().includes('air-condition')));
  assert.ok(pkg.message_constraints.length >= 5);

  // A bad draft: no private-office statement, budget as hard ceiling, desk language.
  const bad = await callTool(server, 'office_outreach_validate', {
    outreach_id: pkg.outreach_id,
    subject: 'Office inquiry',
    body: 'Hi, I want a desk. My maximum budget is $850 and I cannot go above it. What are your rates?',
  });
  assert.equal(bad.value.verdict, 'fail');
  const failedRules = bad.value.results.filter((r) => !r.passed).map((r) => r.rule);
  assert.ok(failedRules.includes('private_office_stated'));
  assert.ok(failedRules.includes('no_desk_invitation'));
  assert.ok(failedRules.includes('budget_not_ceiling'));
  assert.ok(failedRules.includes('hvac_question_present'));

  // A good draft passes: specific hook, enclosed office, both questions, soft budget.
  const good = await callTool(server, 'office_outreach_validate', {
    outreach_id: pkg.outreach_id,
    subject: 'One-person private office at 33 Bloor',
    body:
      'Hi — I run Fluxology Inc. and saw the daily breakfast program you advertise at 33 Bloor Street East. ' +
      'I am looking for a fully enclosed private office with a door that closes, for one person. ' +
      'Could you share the monthly price for an available office, and what it includes? ' +
      'Is access genuinely 24/7? And if I come in late or on a weekend, is the suite actually air-conditioned then as well? ' +
      'My target depends on the overall package.',
  });
  assert.equal(good.value.verdict, 'pass');

  // Unsupported claimed figure fails.
  const fabricated = await callTool(server, 'office_outreach_validate', {
    outreach_id: pkg.outreach_id,
    body: 'I saw your advertised price of $250 for a fully enclosed private office. Is it 24/7 access, and air-conditioned on weekends? What is the monthly price?',
  });
  assert.ok(fabricated.value.results.find((r) => r.rule === 'claims_evidence_backed' && !r.passed));
});

test('quotes and negotiation events are append-only ledger records', async () => {
  const { server, repos } = testServer();
  const provider = repos.providers.upsert({ display_name: 'ManagedCo' });
  const q1 = await callTool(server, 'office_quote_record', {
    provider_id: provider.provider_id,
    quoted_price: 800,
    price_basis: 'PER_OFFICE',
    prepay_options: [{ prepay_term_months: 12, prepay_total_cash: 8640 }],
  });
  assert.equal(q1.isError, false);
  assert.equal(q1.value.quote.prepay_options[0].nominal_discount, 960);
  const q2 = await callTool(server, 'office_quote_record', { provider_id: provider.provider_id, quoted_price: 760, price_basis: 'PER_OFFICE' });
  assert.equal(q2.isError, false);
  const quotes = repos.quotes.list((q) => q.provider_id === provider.provider_id);
  assert.equal(quotes.length, 2); // history preserved, nothing overwritten
  assert.equal(quotes[0].quoted_price, 800);
  assert.equal(quotes[1].quoted_price, 760);
});
