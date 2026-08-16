/**
 * Outreach package builder and draft validator (SDD v2 §A10). Office MCP
 * supplies the factual substrate; the host model writes the prose; Mail MCP
 * sends. The validator enforces evidence-backing and negotiation-state rules
 * without ever generating or sending anything itself.
 */
import { nowIso } from '../../mcp-core/ids.mjs';
import { readObservations } from './evidence.mjs';

const DRAFTING_CONSTRAINTS = [
  'Reference a specific location, amenity, network benefit, or piece of marketing rather than a generic procurement introduction.',
  'Use ordinary first-person business language ("I run Fluxology Inc. and I\'m looking for…"), not RFP jargon.',
  'State the need for a fully enclosed / closeable private office early enough to prevent desk-membership quotes.',
  'Ask about 24/7 access and 24/7 air conditioning as two separate questions (e.g. "If I come in late or on a weekend, is the suite actually cooled then as well?").',
  'Phrase budget as a target that depends on the package; never present the number as an absolute ceiling.',
  'Do not ask every stored question; prioritize price, private-office confirmation, 24/7 + HVAC, main inclusions, and one or two provider-specific uncertainties.',
  'Move renewal escalators, deposits, and prepayment details to follow-ups when that feels more natural.',
  'When asking about prepayment, make the trade explicit but casual: does paying 6/12/18 months upfront change the monthly economics or earn concessions?',
];

export function prepareOutreachPackage({ repos, store }, { provider_id, location_ids = [], recommended_next_action = 'initial_inquiry' }) {
  const provider = repos.providers.get(provider_id);
  if (!provider) throw Object.assign(new Error(`unknown provider ${provider_id}`), { code: 'NOT_FOUND' });

  const locations = location_ids.map((id) => repos.locations.get(id)).filter(Boolean);
  const offers = repos.offers.list((o) => location_ids.includes(o.location_id) || (locations.length === 0 && repos.locations.get(o.location_id)?.provider_id === provider_id));
  const quotes = repos.quotes.list((q) => q.provider_id === provider_id);
  const contacts = repos.contacts.list((c) => c.provider_id === provider_id);
  const observations = readObservations(store, (o) => (o.extracted ?? []).some((x) => x.provider_id === provider_id) || o.provider_id === provider_id);

  const confirmedFacts = [];
  const unresolvedQuestions = [];
  const personalizationHooks = [];

  for (const offer of offers) {
    if (offer.evaluation?.eligible) {
      confirmedFacts.push({ fact: `Confirmed enclosed private office at ${repos.locations.get(offer.location_id)?.address ?? offer.location_id}`, evidence: offer.source_url ?? offer.last_observation_id ?? null });
    }
    if (offer.price_basis === 'PER_DESK' || offer.price_basis === 'PER_PERSON') {
      unresolvedQuestions.push({ question: 'Actual one-person enclosed private-office monthly price (advertised pricing is per desk/person)', priority: 'first_email' });
    }
    if (offer.price_basis === 'STARTING_FROM') {
      unresolvedQuestions.push({ question: 'Exact all-in quote for the specific available office (advertised price is a floor)', priority: 'first_email' });
    }
  }
  for (const location of locations.length ? locations : repos.locations.list((l) => l.provider_id === provider_id)) {
    const hvac = location.hvac_basis ?? 'UNKNOWN';
    if (hvac === 'UNKNOWN' || hvac === 'ON_REQUEST') {
      unresolvedQuestions.push({ question: 'Is the suite air-conditioned during late nights and weekends (separately from 24/7 door access)?', priority: 'first_email' });
    }
    if ((location.access_basis ?? 'UNKNOWN') === 'UNKNOWN') {
      unresolvedQuestions.push({ question: 'Is building/suite access genuinely 24/7?', priority: 'first_email' });
    }
    if (location.fnb_level == null) {
      unresolvedQuestions.push({ question: 'What does the included coffee/snack/breakfast program actually cover day to day?', priority: 'followup_ok' });
    }
  }
  if (provider.fnb_notes) personalizationHooks.push({ hook: `Their advertised F&B: ${provider.fnb_notes}` });
  if (provider.network_notes) personalizationHooks.push({ hook: `Network privileges: ${provider.network_notes}` });
  if (provider.last_page_title) personalizationHooks.push({ hook: `Recently on their site: "${provider.last_page_title}"` });

  const negotiationTargets = [
    { target: 'all_in_monthly_at_or_under_budget', detail: 'Land the all-in monthly (including any HVAC/after-hours fees) at or under target once inclusions are known.' },
    { target: 'prepay_concession', detail: 'Establish baseline first; then ask whether 6/12/18-month upfront payment earns a lower rate, waived fees, free months, credits, an upgrade, or flexible termination.', timing: quotes.length > 0 ? 'now' : 'after_baseline' },
  ];

  const pkg = {
    target_provider: provider_id,
    target_location_ids: location_ids,
    contact_channels: contacts.map((c) => ({ name: c.name, role: c.role, email: c.email ?? null, phone: c.phone ?? null, page: c.public_contact_page ?? null })),
    confirmed_private_office_requirement: true,
    confirmed_facts: confirmedFacts,
    unresolved_questions: dedupeQuestions(unresolvedQuestions),
    personalization_hooks: personalizationHooks,
    negotiation_targets: negotiationTargets,
    budget_language: 'target depends on the package; do not state a hard ceiling',
    prepayment_strategy: quotes.length > 0 ? 'raise_now' : 'establish_baseline_first',
    source_evidence_refs: observations.slice(-10).map((o) => o.observation_id),
    recommended_next_action,
    message_constraints: DRAFTING_CONSTRAINTS,
    status: 'PREPARED',
    prepared_at: nowIso(),
  };
  return repos.outreach.upsert(pkg);
}

function dedupeQuestions(questions) {
  const seen = new Set();
  return questions.filter((q) => {
    if (seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  });
}

/**
 * Validate a drafted email against the package and evidence (SDD v2 §A10).
 * Returns rule-by-rule pass/warn/fail; a failing draft is returned to the
 * host with reasons — it is never sent anywhere from here.
 */
export function validateDraft({ repos }, { outreach_id, subject = '', body }) {
  const pkg = repos.outreach.get(outreach_id);
  if (!pkg) throw Object.assign(new Error(`unknown outreach package ${outreach_id}`), { code: 'NOT_FOUND' });
  const text = `${subject}\n${body}`.toLowerCase();
  const results = [];
  const rule = (id, level, passed, detail) => results.push({ rule: id, level, passed, detail });

  // 1. Private-office requirement stated (prevents desk quotes).
  const statesPrivate = /(private|enclosed).{0,40}office|office.{0,40}(with a door|closeable|lockable)/.test(text);
  rule('private_office_stated', 'fail', statesPrivate, statesPrivate ? 'States enclosed/private office requirement.' : 'Draft never states the fully enclosed / closeable private-office requirement — desk-membership quotes are likely.');

  // 2. Desk-language guard: wording that invites per-desk quoting.
  const invitesDesk = /\b(hot ?desk|dedicated desk|coworking membership|a desk)\b/.test(text) && !/not (a |looking for a )?(hot ?desk|desk|coworking)/.test(text);
  rule('no_desk_invitation', 'fail', !invitesDesk, invitesDesk ? 'Draft language invites a desk/coworking quote.' : 'No desk/coworking framing.');

  // 3. First contact must ask 24/7 access and after-hours HVAC as two separate questions.
  if (pkg.recommended_next_action === 'initial_inquiry') {
    const asksAccess = /24\s*\/\s*7|24-7|around the clock|after hours access|late|weekend/.test(text);
    const asksHvac = /(air.?condition|a\/c|hvac|cool(ed|ing)|climate)/.test(text);
    rule('access_question_present', 'fail', asksAccess, asksAccess ? 'Asks about access hours.' : 'Missing 24/7 access question.');
    rule('hvac_question_present', 'fail', asksHvac, asksHvac ? 'Asks about after-hours cooling/HVAC.' : 'Missing after-hours HVAC/air-conditioning question — access and cooling are separate facts.');
    const priceAsked = /(price|rate|cost|quote|monthly)/.test(text);
    rule('price_question_present', 'fail', priceAsked, priceAsked ? 'Asks about price.' : 'Missing price/quote question.');
  }

  // 4. Budget phrasing: never an announced hard ceiling.
  const ceilingPhrases = /(hard (cap|ceiling|limit)|absolute max|cannot (go|pay) (above|over)|my ceiling is|max(imum)? budget is)/.test(text);
  rule('budget_not_ceiling', 'fail', !ceilingPhrases, ceilingPhrases ? 'Budget presented as a hard ceiling; phrase it as package-dependent target instead.' : 'Budget phrasing acceptable.');

  // 5. Unsupported factual claims: numbers claimed as known must trace to package facts/quotes.
  const knownNumbers = new Set();
  for (const fact of pkg.confirmed_facts ?? []) for (const m of `${fact.fact}`.matchAll(/\$?([\d,]{3,})/g)) knownNumbers.add(m[1].replace(/,/g, ''));
  for (const quote of repos.quotes.list((q) => q.provider_id === pkg.target_provider)) if (typeof quote.quoted_price === 'number') knownNumbers.add(String(quote.quoted_price));
  const claimed = [...body.matchAll(/your (?:advertised|listed|quoted)[^.\n]{0,40}\$\s?([\d,]+)/gi)].map((m) => m[1].replace(/,/g, ''));
  const unsupported = claimed.filter((n) => !knownNumbers.has(n));
  rule('claims_evidence_backed', 'fail', unsupported.length === 0, unsupported.length ? `Claims cite figures not in evidence: $${unsupported.join(', $')}` : 'No unsupported cited figures.');

  // 6. Question volume: an inquiry should stay small.
  const questionCount = (body.match(/\?/g) ?? []).length;
  rule('question_volume', 'warn', questionCount <= 6, `${questionCount} questions (guideline ≤ 6; move the rest to follow-up).`);

  // 7. Prepayment timing consistency with the package strategy.
  const mentionsPrepay = /(prepay|up ?front|pay .{0,20}(months? )?(in )?advance|6.{0,8}12.{0,8}18)/.test(text);
  if (pkg.prepayment_strategy === 'establish_baseline_first' && pkg.recommended_next_action === 'initial_inquiry') {
    rule('prepay_timing', 'warn', !mentionsPrepay, mentionsPrepay ? 'Package strategy is baseline-first; raising prepayment in the first email is off-strategy unless the provider advertises term incentives.' : 'Prepayment correctly held for follow-up.');
  } else if (pkg.prepayment_strategy === 'raise_now') {
    rule('prepay_timing', 'warn', mentionsPrepay, mentionsPrepay ? 'Prepayment raised as planned.' : 'Strategy says raise prepayment now, but the draft never does.');
  }

  const failures = results.filter((r) => r.level === 'fail' && !r.passed);
  const warnings = results.filter((r) => r.level === 'warn' && !r.passed);
  const verdict = failures.length ? 'fail' : warnings.length ? 'pass_with_warnings' : 'pass';
  repos.outreach.upsert({ outreach_id, last_validation: { verdict, at: nowIso(), failures: failures.length, warnings: warnings.length } });
  return { verdict, results, failures: failures.length, warnings: warnings.length };
}

export const OUTREACH_STATUSES = ['PREPARED', 'SENT_TO_MAIL', 'AWAITING_REPLY', 'QUOTE_RECEIVED', 'NEGOTIATING', 'FOLLOWUP_DUE', 'REJECTED', 'CLOSED'];
