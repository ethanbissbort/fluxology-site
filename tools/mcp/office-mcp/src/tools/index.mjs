/**
 * Office MCP tool surface (SDD v2 §A5). Snake_case names (host-portable),
 * JSON Schema inputs, read/write/side-effect annotations. Handlers delegate
 * to domain modules; anything that fails throws ToolError with a code from
 * the failure taxonomy (§A9) and surfaces as an isError result.
 */
import { ToolError } from '../../../mcp-core/jsonrpc.mjs';
import { nowIso } from '../../../mcp-core/ids.mjs';
import { PRODUCT_KIND, ENCLOSURE_STATUS, DOOR_STATUS, PRICE_BASIS, ACCESS_BASIS, HVAC_BASIS, SOURCE_TYPE, assertEnum } from '../domain/enums.mjs';
import { scoreConventional } from '../domain/scoring-conventional.mjs';
import { scoreManaged } from '../domain/scoring-managed.mjs';
import { normalizePrepayOption } from '../domain/pricing.mjs';
import { recordObservation } from '../evidence.mjs';
import { PROFILES } from '../search/run.mjs';
import { prepareOutreachPackage, validateDraft, OUTREACH_STATUSES } from '../outreach.mjs';

const OBSERVABLE_FIELDS = {
  provider: ['display_name', 'brands', 'website', 'known_urls', 'network_access_policy', 'network_access_included', 'network_locations_count', 'network_notes', 'fnb_level', 'fnb_notes', 'fee_notes', 'contract_notes', 'outreach_questions', 'region_relevant'],
  location: ['address', 'municipality', 'page_url', 'access_basis', 'hvac_basis', 'fnb_level', 'fnb_notes', 'meeting_rooms_onsite', 'meeting_room_credits', 'mail_handling', 'package_acceptance', 'transit_connection', 'final_walk_minutes', 'skateboard_practical', 'skateboard_note', 'security_notes', 'tech_amenities'],
  offer: ['product_kind', 'enclosure_status', 'door_status', 'capacity', 'usable_private_sqft', 'price_basis', 'sticker_price', 'mandatory_recurring_fees', 'promotion', 'term', 'availability_date', 'source_url', 'access_basis', 'hvac_basis', 'internet_included', 'furnished', 'month_to_month', 'short_commitment', 'window', 'natural_light', 'active'],
  listing: ['operator', 'address', 'municipality', 'rent', 'mandatory_recurring_fees', 'usable_private_sqft', 'usability_multiplier', 'usability_reason', 'area_source', 'access_basis', 'hvac_basis', 'door_status', 'enclosure_status', 'furnished', 'internet_included', 'utilities_included', 'mail_rights', 'signage_rights', 'short_commitment', 'month_to_month', 'term', 'amenities', 'parking', 'transit_connection', 'final_walk_minutes', 'skateboard_practical', 'skateboard_note', 'overnight_equipment_ok', 'condition_good', 'natural_light', 'prepay_discount_available', 'source_url', 'summary', 'notes', 'active', 'still_live'],
};

const ENUM_FIELDS = {
  product_kind: PRODUCT_KIND,
  enclosure_status: ENCLOSURE_STATUS,
  door_status: DOOR_STATUS,
  price_basis: PRICE_BASIS,
  access_basis: ACCESS_BASIS,
  hvac_basis: HVAC_BASIS,
};

function validateEntityFields(entity, fields) {
  const allowed = OBSERVABLE_FIELDS[entity];
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) {
      throw new ToolError('VALIDATION_FAILED', `field "${key}" is not a recordable ${entity} field`, { allowed });
    }
    if (ENUM_FIELDS[key]) assertEnumToolError(key, value, ENUM_FIELDS[key]);
  }
  // Locked requirement 2: a sticker price cannot be recorded without a basis.
  if (fields.sticker_price !== undefined && fields.price_basis === undefined) {
    throw new ToolError('PRICE_BASIS_AMBIGUOUS', 'sticker_price requires price_basis in the same observation; a bare number is not a private-office price');
  }
}

function assertEnumToolError(field, value, allowed) {
  try {
    assertEnum(field, value, allowed);
  } catch (err) {
    throw new ToolError('VALIDATION_FAILED', err.message);
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const EXTERNAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

export function buildTools({ config, store, repos, engine, formBroker, dashboardSync, fetcher }) {
  const tools = [];
  const t = (name, title, description, inputSchema, annotations, handler) =>
    tools.push({ name, title, description, inputSchema, annotations, handler });

  const idParam = (name, desc) => ({ type: 'object', properties: { [name]: { type: 'string', description: desc } }, required: [name], additionalProperties: false });

  const getOr404 = (repo, id, label) => {
    const entity = repo.get(id);
    if (!entity) throw new ToolError('NOT_FOUND', `unknown ${label}: ${id}`);
    return entity;
  };

  // ---------------------------------------------------------------- health
  t('office_health', 'Office MCP health', 'Server, data-root, adapter and connectivity readiness. Secrets are reported as booleans only.', { type: 'object', additionalProperties: false }, READ, async () => ({
    server: 'fluxology-office-mcp',
    time: nowIso(),
    data_root: config.dataDir,
    region: config.region,
    budget_all_in_monthly: config.budgetAllInMonthly,
    network_enabled: config.allowNetwork,
    form_submission_enabled: config.formSubmitEnabled,
    dashboard_url_configured: Boolean(config.dashboardUrl),
    dashboard_token_present: Boolean(config.dashboardToken),
    providers_on_watchlist: repos.providers.list().length,
    open_search_runs: repos.searchRuns.list((r) => r.status === 'RUNNING').length,
  }));

  // ------------------------------------------------------------- watchlist
  t('office_watchlist_list', 'List watchlist', 'Managed-office provider watchlist with priorities and research freshness.', { type: 'object', additionalProperties: false }, READ, async () => ({
    providers: repos.providers.list().map((p) => ({
      provider_id: p.provider_id,
      name: p.display_name ?? p.name,
      watch_status: p.watch_status ?? 'watch',
      priority: p.priority ?? 3,
      website: p.website ?? null,
      outreach_priority: p.outreach_priority ?? 'normal',
      last_fetched_at: p.last_fetched_at ?? null,
      locations: repos.locations.list((l) => l.provider_id === p.provider_id).length,
    })),
  }));

  t('office_watchlist_upsert', 'Upsert watchlist entry', 'Add or update a managed-office provider on the watchlist. Hostnames listed become fetch-allowlisted for research.',
    {
      type: 'object',
      properties: {
        provider_id: { type: 'string', description: 'Omit to create a new provider' },
        display_name: { type: 'string' },
        website: { type: 'string' },
        brands: { type: 'array', items: { type: 'string' } },
        allowed_hosts: { type: 'array', items: { type: 'string' }, description: 'Extra hostnames of this provider (fetch allowlist)' },
        watch_status: { type: 'string', enum: ['watch', 'active_outreach', 'paused', 'ignored'] },
        priority: { type: 'integer', minimum: 1, maximum: 5 },
        outreach_priority: { type: 'string', enum: ['immediate', 'normal', 'low'] },
        region_relevant: { type: 'boolean' },
        notes: { type: 'string' },
      },
      additionalProperties: false,
    },
    WRITE,
    async (args) => {
      if (args.provider_id) getOr404(repos.providers, args.provider_id, 'provider');
      const provider = repos.providers.upsert(args);
      return { provider_id: provider.provider_id, provider };
    });

  // ---------------------------------------------------------------- search
  t('office_search_start', 'Start search run', `Create a search run and its work queue. Profiles: ${PROFILES.join(', ')}. Advance it with office_search_step.`,
    {
      type: 'object',
      properties: {
        profile: { type: 'string', enum: PROFILES },
        params: {
          type: 'object',
          properties: { provider_id: { type: 'string' }, location_id: { type: 'string' }, outreach_id: { type: 'string' } },
          additionalProperties: false,
        },
      },
      required: ['profile'],
      additionalProperties: false,
    },
    WRITE,
    async ({ profile, params = {} }) => {
      const run = engine.startRun(profile, params);
      return { search_run_id: run.search_run_id, status: run.status, queued: run.queue.length, next: `call office_search_step with search_run_id ${run.search_run_id}` };
    });

  t('office_search_step', 'Advance search run', 'Process a bounded batch of queued work synchronously. Returns exact progress, coverage counters, and any items needing host-assisted ingestion (fetch the URL yourself and call office_ingest_observation) or manual intervention.',
    {
      type: 'object',
      properties: {
        search_run_id: { type: 'string' },
        max_items: { type: 'integer', minimum: 1, maximum: 25 },
      },
      required: ['search_run_id'],
      additionalProperties: false,
    },
    WRITE,
    async ({ search_run_id, max_items = config.limits.searchStepMaxItems }) => engine.step(search_run_id, max_items));

  t('office_search_status', 'Search run status', 'Run state and exact coverage counters (incremented only by processed records).', idParam('search_run_id', 'The run to inspect'), READ, async ({ search_run_id }) => {
    const run = engine.getRun(search_run_id);
    return { search_run_id, profile: run.profile, status: run.status, remaining_work: run.queue.length, counters: run.counters, limitations_count: run.limitations.length, needs_host_ingest: run.needs_host, needs_manual: run.needs_manual };
  });

  t('office_search_results', 'Search results', 'Normalized candidates with evidence refs, separated by category, deterministic order. Excluded candidates carry their exclusion reason.',
    {
      type: 'object',
      properties: {
        search_run_id: { type: 'string' },
        category: { type: 'string', enum: ['managed', 'conventional', 'all'] },
        include_excluded: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 },
      },
      required: ['search_run_id'],
      additionalProperties: false,
    },
    READ,
    async ({ search_run_id, category = 'all', include_excluded = false, limit = 50, offset = 0 }) => {
      engine.getRun(search_run_id);
      const managed = repos.offers
        .list((o) => o.evaluation?.run_id === search_run_id && (include_excluded || o.evaluation?.eligible))
        .map((o) => ({ kind: 'managed_offer', offer_id: o.offer_id, location_id: o.location_id, product_kind: o.product_kind, price_basis: o.price_basis, sticker_price: o.sticker_price ?? null, evaluation: o.evaluation }))
        .sort((a, b) => (b.evaluation?.score ?? -1) - (a.evaluation?.score ?? -1) || a.offer_id.localeCompare(b.offer_id));
      const conventional = repos.listings
        .list((l) => l.evaluation?.run_id === search_run_id && (include_excluded || l.evaluation?.surfaced))
        .map((l) => ({ kind: 'conventional_listing', listing_id: l.listing_id, address: l.address ?? null, usable_private_sqft: l.usable_private_sqft ?? null, evaluation: l.evaluation }))
        .sort((a, b) => (b.evaluation?.score ?? -1) - (a.evaluation?.score ?? -1) || a.listing_id.localeCompare(b.listing_id));
      const all = { managed: category !== 'conventional' ? managed : [], conventional: category !== 'managed' ? conventional : [] };
      return {
        search_run_id,
        managed: all.managed.slice(offset, offset + limit),
        conventional: all.conventional.slice(offset, offset + limit),
        totals: { managed: all.managed.length, conventional: all.conventional.length },
      };
    });

  // ------------------------------------------------------------- ingestion
  t('office_ingest_observation', 'Ingest host-fetched evidence', 'Record evidence you (the host) retrieved: the URL, its content or excerpt, and field claims. The server enforces taxonomy, price-basis preservation, and provenance; host-reported evidence ranks below server-verified fetches of the same page.',
    {
      type: 'object',
      properties: {
        url: { type: 'string' },
        content: { type: 'string', description: 'Raw page content or the relevant excerpt' },
        source_type: { type: 'string', enum: SOURCE_TYPE },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entity: { type: 'string', enum: ['provider', 'location', 'offer', 'listing'] },
              id: { type: 'string', description: 'Existing entity id; omit with create:true to create' },
              create: { type: 'boolean' },
              parent_id: { type: 'string', description: 'provider_id when creating a location; location_id when creating an offer' },
              fields: { type: 'object' },
              quote: { type: 'string', description: 'Verbatim supporting text from the source' },
            },
            required: ['entity', 'fields'],
            additionalProperties: false,
          },
        },
        search_run_id: { type: 'string', description: 'Satisfies a needs_host_ingest item of this run when given' },
      },
      required: ['url', 'source_type', 'claims'],
      additionalProperties: false,
    },
    WRITE,
    async ({ url, content = '', source_type, confidence = 'medium', claims, search_run_id }) => {
      const applied = [];
      for (const claim of claims) {
        validateEntityFields(claim.entity, claim.fields);
        const repo = { provider: repos.providers, location: repos.locations, offer: repos.offers, listing: repos.listings }[claim.entity];
        const idField = { provider: 'provider_id', location: 'location_id', offer: 'offer_id', listing: 'listing_id' }[claim.entity];
        let id = claim.id;
        if (!id && claim.create) {
          const seed = { ...claim.fields };
          if (claim.entity === 'location') {
            if (!claim.parent_id) throw new ToolError('VALIDATION_FAILED', 'creating a location requires parent_id (provider_id)');
            seed.provider_id = claim.parent_id;
          }
          if (claim.entity === 'offer') {
            if (!claim.parent_id) throw new ToolError('VALIDATION_FAILED', 'creating an offer requires parent_id (location_id)');
            seed.location_id = claim.parent_id;
            seed.product_kind = seed.product_kind ?? 'UNKNOWN';
            seed.enclosure_status = seed.enclosure_status ?? 'UNKNOWN';
            seed.door_status = seed.door_status ?? 'UNKNOWN';
            seed.price_basis = seed.price_basis ?? 'UNKNOWN';
          }
          id = repo.upsert(seed)[idField];
        } else if (id) {
          getOr404(repo, id, claim.entity);
          repo.upsert({ [idField]: id, ...claim.fields });
        } else {
          throw new ToolError('VALIDATION_FAILED', 'each claim needs an id, or create:true');
        }
        applied.push({ entity: claim.entity, id, fields: Object.keys(claim.fields) });
      }
      const observation = recordObservation(store, {
        url,
        content,
        source_type,
        extraction_method: 'host_reported',
        extracted: claims.map((c) => ({ entity: c.entity, id: c.id ?? null, fields: c.fields, quote: c.quote ?? null })),
        confidence,
      });
      let satisfied = null;
      if (search_run_id) {
        const run = engine.getRun(search_run_id);
        const needs = run.needs_host.map((n) => (n.url === url ? { ...n, satisfied: true, observation_id: observation.observation_id } : n));
        repos.searchRuns.upsert({ search_run_id, needs_host: needs });
        satisfied = needs.some((n) => n.url === url);
      }
      return { observation_id: observation.observation_id, applied, satisfied_needs_host: satisfied };
    });

  t('office_listing_record', 'Record conventional listing', 'Create or update a conventional (non-managed) office listing from evidence. Qualification and history rules are enforced server-side.',
    {
      type: 'object',
      properties: {
        listing_id: { type: 'string', description: 'Omit to create' },
        source_url: { type: 'string' },
        fields: { type: 'object', description: `Listing fields (${OBSERVABLE_FIELDS.listing.slice(0, 12).join(', ')}, …)` },
        source_content: { type: 'string' },
        source_type: { type: 'string', enum: SOURCE_TYPE },
      },
      required: ['fields'],
      additionalProperties: false,
    },
    WRITE,
    async ({ listing_id, source_url, fields, source_content = '', source_type = 'third_party_listing' }) => {
      validateEntityFields('listing', fields);
      if (listing_id) getOr404(repos.listings, listing_id, 'listing');
      if (!listing_id && !source_url) throw new ToolError('VALIDATION_FAILED', 'a new listing requires source_url');
      const listing = repos.listings.upsert({ ...(listing_id ? { listing_id } : {}), ...fields, ...(source_url ? { source_url } : {}) });
      let observation = null;
      if (source_url) {
        observation = recordObservation(store, {
          url: source_url,
          content: source_content,
          source_type,
          extraction_method: 'host_reported',
          extracted: [{ entity: 'listing', id: listing.listing_id, fields }],
          confidence: 'medium',
        });
      }
      return { listing_id: listing.listing_id, listing, observation_id: observation?.observation_id ?? null };
    });

  // ----------------------------------------------------------------- reads
  t('office_provider_get', 'Get provider', 'Provider profile with network rights, F&B, fees, contacts, provenance and change history.', idParam('provider_id', 'Provider id'), READ, async ({ provider_id }) => {
    const provider = getOr404(repos.providers, provider_id, 'provider');
    return {
      provider,
      locations: repos.locations.list((l) => l.provider_id === provider_id),
      contacts: repos.contacts.list((c) => c.provider_id === provider_id),
      quotes: repos.quotes.list((q) => q.provider_id === provider_id),
    };
  });
  t('office_location_get', 'Get location', 'Location profile with offers and availability history.', idParam('location_id', 'Location id'), READ, async ({ location_id }) => {
    const location = getOr404(repos.locations, location_id, 'location');
    return { location, offers: repos.offers.list((o) => o.location_id === location_id) };
  });
  t('office_offer_get', 'Get offer', 'Normalized offer with pricing basis, qualification state and evaluation.', idParam('offer_id', 'Offer id'), READ, async ({ offer_id }) => {
    const offer = getOr404(repos.offers, offer_id, 'offer');
    return { offer, quotes: repos.quotes.list((q) => q.offer_id === offer_id) };
  });
  t('office_listing_get', 'Get conventional listing', 'Conventional listing with canonical-validation state and evaluation.', idParam('listing_id', 'Listing id'), READ, async ({ listing_id }) => ({ listing: getOr404(repos.listings, listing_id, 'listing') }));

  t('office_score_explain', 'Explain a score', 'Component-by-component score decomposition, effective-cost math, missing-data penalties and the clarification list.',
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['listing', 'offer'] },
        id: { type: 'string' },
      },
      required: ['kind', 'id'],
      additionalProperties: false,
    },
    READ,
    async ({ kind, id }) => {
      if (kind === 'listing') {
        const listing = getOr404(repos.listings, id, 'listing');
        return { kind, id, ...scoreConventional(listing, { budget: config.budgetAllInMonthly }) };
      }
      const offer = getOr404(repos.offers, id, 'offer');
      const location = offer.location_id ? repos.locations.get(offer.location_id) ?? {} : {};
      const provider = location.provider_id ? repos.providers.get(location.provider_id) ?? {} : {};
      const quotes = repos.quotes.list((q) => q.offer_id === id);
      return { kind, id, ...scoreManaged({ provider, location, offer, quote: quotes[quotes.length - 1] ?? null }, { budget: config.budgetAllInMonthly }) };
    });

  // ------------------------------------------------------ quotes/negotiation
  t('office_quote_record', 'Record quote', 'Append a quote to the ledger: price with basis, fees, concessions, prepayment alternatives, expiration, source. History is never overwritten.',
    {
      type: 'object',
      properties: {
        provider_id: { type: 'string' },
        location_id: { type: 'string' },
        offer_id: { type: 'string' },
        quoted_price: { type: 'number' },
        price_basis: { type: 'string', enum: PRICE_BASIS },
        recurring_fees: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, monthly: { type: 'number' } }, required: ['kind'], additionalProperties: false } },
        one_time_fees: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, amount: { type: 'number' } }, required: ['kind'], additionalProperties: false } },
        free_months: { type: 'number', minimum: 0 },
        guaranteed_credits: { type: 'number', minimum: 0 },
        prepay_options: { type: 'array', items: { type: 'object', properties: { prepay_term_months: { type: 'integer' }, prepay_total_cash: { type: 'number' }, refundability: { type: 'string' }, transferability: { type: 'string' }, renewal_effect: { type: 'string' }, risk_note: { type: 'string' } }, required: ['prepay_term_months', 'prepay_total_cash'], additionalProperties: false } },
        term: { type: 'string' },
        renewal_escalation: { type: 'string' },
        expiration: { type: 'string' },
        salesperson: { type: 'string' },
        source_ref: { type: 'string', description: 'Mail MCP message id, form submission id, or URL' },
      },
      required: ['provider_id', 'quoted_price', 'price_basis'],
      additionalProperties: false,
    },
    WRITE,
    async (args) => {
      getOr404(repos.providers, args.provider_id, 'provider');
      const prepay = (args.prepay_options ?? []).map((option) => ({
        ...option,
        ...normalizePrepayOption({ prepay_term_months: option.prepay_term_months, prepay_total_cash: option.prepay_total_cash, monthly_pay_price: args.quoted_price }),
      }));
      const quote = repos.quotes.append({ ...args, prepay_options: prepay });
      return { quote_id: quote.quote_id, quote };
    });

  t('office_negotiation_record', 'Record negotiation event', 'Append a negotiation event: offer change, concession, response, next action.',
    {
      type: 'object',
      properties: {
        provider_id: { type: 'string' },
        outreach_id: { type: 'string' },
        channel: { type: 'string', enum: ['email', 'form', 'phone', 'in_person', 'other'] },
        actor: { type: 'string', enum: ['us', 'provider'] },
        summary: { type: 'string' },
        offer_change: { type: 'string' },
        concession: { type: 'string' },
        next_action: { type: 'string' },
      },
      required: ['provider_id', 'channel', 'actor', 'summary'],
      additionalProperties: false,
    },
    WRITE,
    async (args) => {
      getOr404(repos.providers, args.provider_id, 'provider');
      const event = repos.negotiation.append(args);
      return { event_id: event.event_id, event };
    });

  // -------------------------------------------------------------- outreach
  t('office_outreach_prepare', 'Prepare outreach package', 'Build an evidence-backed OutreachPackage (facts, unresolved questions, hooks, negotiation targets, drafting constraints). Does not draft or send anything.',
    {
      type: 'object',
      properties: {
        provider_id: { type: 'string' },
        location_ids: { type: 'array', items: { type: 'string' } },
        recommended_next_action: { type: 'string', enum: ['initial_inquiry', 'followup', 'negotiation_reply', 'tour_request'] },
      },
      required: ['provider_id'],
      additionalProperties: false,
    },
    WRITE,
    async ({ provider_id, location_ids = [], recommended_next_action = 'initial_inquiry' }) => {
      const pkg = prepareOutreachPackage({ repos, store }, { provider_id, location_ids, recommended_next_action });
      return { outreach_id: pkg.outreach_id, package: pkg, next: 'Draft the email yourself using message_constraints, then call office_outreach_validate.' };
    });

  t('office_outreach_validate', 'Validate outreach draft', 'Check a drafted email against evidence and negotiation state: unsupported claims, desk-quote risk, missing critical questions, budget phrasing, prepayment timing. Failing drafts are returned with reasons, never sent.',
    {
      type: 'object',
      properties: {
        outreach_id: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['outreach_id', 'body'],
      additionalProperties: false,
    },
    READ,
    async (args) => validateDraft({ repos }, args));

  t('office_outreach_get', 'Get outreach package', 'Read a package including validation history and status.', idParam('outreach_id', 'Package id'), READ, async ({ outreach_id }) => ({ package: getOr404(repos.outreach, outreach_id, 'outreach package') }));

  t('office_outreach_update', 'Update outreach status', `Transition package status (${OUTREACH_STATUSES.join(' → ')}) and refresh facts/questions after replies.`,
    {
      type: 'object',
      properties: {
        outreach_id: { type: 'string' },
        status: { type: 'string', enum: OUTREACH_STATUSES },
        mail_message_id: { type: 'string', description: 'Mail MCP message id once handed off' },
        note: { type: 'string' },
      },
      required: ['outreach_id', 'status'],
      additionalProperties: false,
    },
    WRITE,
    async ({ outreach_id, status, mail_message_id, note }) => {
      getOr404(repos.outreach, outreach_id, 'outreach package');
      const pkg = repos.outreach.upsert({ outreach_id, status, ...(mail_message_id ? { mail_message_id } : {}), ...(note ? { last_note: note } : {}), status_changed_at: nowIso() });
      return { outreach_id, status: pkg.status };
    });

  // ----------------------------------------------------------------- forms
  t('office_form_prepare', 'Prepare website form', 'Normalize a provider inquiry/quote form into a draft submission (no freezing, no sending). Use discovered fields from a fetched page or supply them directly.',
    {
      type: 'object',
      properties: {
        target_url: { type: 'string' },
        method: { type: 'string', enum: ['POST', 'GET'] },
        fields: { type: 'object', description: 'Exact field name → value map to transmit' },
        provider_id: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['target_url', 'fields'],
      additionalProperties: false,
    },
    WRITE,
    async (args) => {
      const submission = formBroker.prepare(args);
      return { submission_id: submission.submission_id, state: submission.state, fields: submission.fields, next: 'Review, then office_form_request_approval to freeze.' };
    });

  t('office_form_request_approval', 'Freeze form + request approval', 'Freeze the exact fields (SHA-256) and emit the out-of-band human approval instruction. Any later edit invalidates the approval by construction.', idParam('submission_id', 'Prepared submission id'), WRITE, async ({ submission_id }) => formBroker.freezeAndRequestApproval(submission_id));

  t('office_form_submit', 'Submit approved form', 'Submit an approved frozen form exactly once. Requires a matching human approval record; runs record-and-hold unless network submission is enabled by configuration. Ambiguous outcomes are never retried automatically.', idParam('submission_id', 'Approved submission id'), EXTERNAL, async ({ submission_id }) => formBroker.submit(submission_id));

  t('office_form_status', 'Form status', 'State machine status including approval state.', idParam('submission_id', 'Submission id'), READ, async ({ submission_id }) => formBroker.status(submission_id));

  // ------------------------------------------------------------- dashboard
  t('office_dashboard_sync', 'Sync dashboard', 'Build the Office Scout v2.5 upsert payload and the managed-providers snapshot. dry_run (default) returns payloads without writing externally; live push requires the configured token and never touches server-owned fields or history.',
    {
      type: 'object',
      properties: { dry_run: { type: 'boolean' } },
      additionalProperties: false,
    },
    EXTERNAL,
    async ({ dry_run = true }) => dashboardSync.sync({ dryRun: dry_run }));

  // ----------------------------------------------------------------- audit
  t('office_audit_coverage', 'Coverage audit', 'Exact audited counters and limitations for one search run — counts equal records actually processed, never planned work.', idParam('search_run_id', 'Run id'), READ, async ({ search_run_id }) => {
    const run = engine.getRun(search_run_id);
    return {
      search_run_id,
      profile: run.profile,
      status: run.status,
      started_at: run.started_at,
      finished_at: run.finished_at ?? null,
      counters: run.counters,
      limitations: run.limitations,
      statement: `Discovered ${run.counters.search_results_discovered}, inspected ${run.counters.search_results_inspected}, attempted ${run.counters.canonical_pages_attempted} canonical pages (${run.counters.canonical_pages_validated} validated), detailed ${run.counters.candidates_detailed} candidates, surfaced ${run.counters.candidates_surfaced}, excluded ${Object.values(run.counters.hard_exclusions).reduce((a, b) => a + b, 0)} (${Object.entries(run.counters.hard_exclusions).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'}), with ${run.limitations.length} limitation(s).`,
    };
  });

  return tools;
}
