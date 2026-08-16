/**
 * Search orchestration — cooperative step model (SDD v2 §A6, audit A6).
 *
 * A search run is a persisted state machine with an explicit work queue.
 * `office_search_step` pops a bounded batch and processes it synchronously;
 * counters increment ONLY when a record is actually processed (locked
 * requirement 9), and invariants are enforced on every update. With the
 * network disabled, fetch work converts to `needs_host_ingest` items the MCP
 * host can satisfy via `office_ingest_observation`.
 */
import { nowIso } from '../../../mcp-core/ids.mjs';
import { qualifiesPrivateOffice } from '../domain/enums.mjs';
import { scoreConventional } from '../domain/scoring-conventional.mjs';
import { scoreManaged } from '../domain/scoring-managed.mjs';
import { recordObservation } from '../evidence.mjs';
import { extractCanonical, extractJsonLd, extractPriceSignals, extractTitle, canonicalKey } from './extract.mjs';
import { sanitizeExcerpt } from '../evidence.mjs';

export const PROFILES = ['daily_managed', 'daily_conventional', 'dual', 'provider_deep_dive', 'location_refresh', 'quote_followup'];

export function emptyCounters() {
  return {
    search_results_discovered: 0,
    search_results_inspected: 0,
    canonical_pages_attempted: 0,
    canonical_pages_validated: 0,
    provider_pages_inspected: 0,
    location_pages_inspected: 0,
    offer_or_inventory_pages_inspected: 0,
    candidates_detailed: 0,
    candidates_surfaced: 0,
    outreach_queue_count: 0,
    hard_exclusions: {},
  };
}

export function assertCounterInvariants(c) {
  const checks = [
    ['search_results_inspected', 'search_results_discovered'],
    ['canonical_pages_validated', 'canonical_pages_attempted'],
    ['candidates_surfaced', 'candidates_detailed'],
  ];
  for (const [lesser, greater] of checks) {
    if (c[lesser] > c[greater]) throw new Error(`coverage invariant violated: ${lesser} (${c[lesser]}) > ${greater} (${c[greater]})`);
  }
  for (const [key, value] of Object.entries(c)) {
    if (key === 'hard_exclusions') continue;
    if (value < 0) throw new Error(`coverage counter negative: ${key}`);
  }
}

export function initialQueue(profile, params = {}) {
  switch (profile) {
    case 'daily_managed':
      return [{ kind: 'enumerate_watchlist' }];
    case 'daily_conventional':
      return [{ kind: 'enumerate_listings' }];
    case 'dual':
      return [{ kind: 'enumerate_watchlist' }, { kind: 'enumerate_listings' }];
    case 'provider_deep_dive':
      if (!params.provider_id) throw Object.assign(new Error('provider_deep_dive requires params.provider_id'), { code: 'VALIDATION_FAILED' });
      return [{ kind: 'provider_research', provider_id: params.provider_id, deep: true }];
    case 'location_refresh':
      if (!params.location_id) throw Object.assign(new Error('location_refresh requires params.location_id'), { code: 'VALIDATION_FAILED' });
      return [{ kind: 'location_refresh', location_id: params.location_id }];
    case 'quote_followup':
      if (!params.provider_id) throw Object.assign(new Error('quote_followup requires params.provider_id'), { code: 'VALIDATION_FAILED' });
      return [{ kind: 'provider_research', provider_id: params.provider_id, purpose: 'quote_followup' }];
    default:
      throw Object.assign(new Error(`unknown profile ${profile}`), { code: 'VALIDATION_FAILED' });
  }
}

export class SearchEngine {
  constructor({ repos, store, fetcher, config, log = () => {} }) {
    this.repos = repos;
    this.store = store;
    this.fetcher = fetcher;
    this.config = config;
    this.log = log;
  }

  startRun(profile, params = {}) {
    const queue = initialQueue(profile, params);
    return this.repos.searchRuns.upsert({
      profile,
      params,
      region: this.config.region,
      status: 'RUNNING',
      queue,
      counters: emptyCounters(),
      limitations: [],
      needs_host: [],
      needs_manual: [],
      started_at: nowIso(),
    });
  }

  getRun(runId) {
    const run = this.repos.searchRuns.get(runId);
    if (!run) throw Object.assign(new Error(`unknown search run ${runId}`), { code: 'NOT_FOUND' });
    return run;
  }

  async step(runId, maxItems) {
    let run = this.getRun(runId);
    if (run.status !== 'RUNNING') {
      return { search_run_id: runId, status: run.status, processed: 0, remaining: run.queue.length, counters: run.counters };
    }
    const batch = run.queue.slice(0, maxItems);
    const rest = run.queue.slice(maxItems);
    const context = {
      counters: structuredClone(run.counters),
      limitations: [...run.limitations],
      needsHost: [...run.needs_host],
      needsManual: [...run.needs_manual],
      newItems: [],
      processed: 0,
    };

    for (const item of batch) {
      await this.processItem(item, context, run);
      context.processed += 1;
      assertCounterInvariants(context.counters);
    }

    const queue = [...rest, ...context.newItems];
    const status = queue.length === 0 ? 'COMPLETE' : 'RUNNING';
    run = this.repos.searchRuns.upsert({
      search_run_id: runId,
      queue,
      counters: context.counters,
      limitations: context.limitations,
      needs_host: context.needsHost,
      needs_manual: context.needsManual,
      status,
      ...(status === 'COMPLETE' ? { finished_at: nowIso() } : {}),
    });
    return {
      search_run_id: runId,
      status,
      processed: context.processed,
      remaining: queue.length,
      needs_host_ingest: context.needsHost.filter((n) => !n.satisfied),
      needs_manual: context.needsManual,
      counters: context.counters,
    };
  }

  async processItem(item, ctx, run) {
    switch (item.kind) {
      case 'enumerate_watchlist': {
        const providers = this.repos.providers.list((p) => p.watch_status !== 'ignored');
        ctx.counters.search_results_discovered += providers.length;
        for (const provider of providers) {
          ctx.newItems.push({ kind: 'provider_research', provider_id: provider.provider_id, counted_discovered: true });
        }
        return;
      }
      case 'enumerate_listings': {
        const listings = this.repos.listings.list((l) => l.active !== false);
        ctx.counters.search_results_discovered += listings.length;
        for (const listing of listings) {
          ctx.newItems.push({ kind: 'listing_check', listing_id: listing.listing_id, counted_discovered: true });
        }
        return;
      }
      case 'provider_research': {
        const provider = this.repos.providers.get(item.provider_id);
        if (!provider) return this.limit(ctx, 'missing_entity', `provider ${item.provider_id} not found`);
        // A direct-target profile (deep dive / quote followup) discovers its
        // target itself; enumerated items were already counted.
        if (!item.counted_discovered) ctx.counters.search_results_discovered += 1;
        ctx.counters.search_results_inspected += 1;
        const urls = [provider.website, ...(item.deep ? provider.known_urls ?? [] : [])].filter(Boolean);
        if (urls.length === 0) this.limit(ctx, 'no_source', `provider ${provider.provider_id} has no website on file`);
        for (const url of urls) {
          ctx.newItems.push({ kind: 'fetch_page', url, role: 'provider_page', provider_id: provider.provider_id });
        }
        for (const location of this.repos.locations.list((l) => l.provider_id === provider.provider_id)) {
          ctx.newItems.push({ kind: 'evaluate_managed', location_id: location.location_id });
          if (item.deep && location.page_url) {
            ctx.newItems.push({ kind: 'fetch_page', url: location.page_url, role: 'location_page', provider_id: provider.provider_id, location_id: location.location_id });
          }
        }
        return;
      }
      case 'location_refresh': {
        const location = this.repos.locations.get(item.location_id);
        if (!location) return this.limit(ctx, 'missing_entity', `location ${item.location_id} not found`);
        if (!item.counted_discovered) ctx.counters.search_results_discovered += 1;
        ctx.counters.search_results_inspected += 1;
        if (location.page_url) ctx.newItems.push({ kind: 'fetch_page', url: location.page_url, role: 'location_page', provider_id: location.provider_id, location_id: location.location_id });
        ctx.newItems.push({ kind: 'evaluate_managed', location_id: location.location_id });
        return;
      }
      case 'fetch_page':
        return this.fetchPage(item, ctx);
      case 'listing_check':
        return this.listingCheck(item, ctx);
      case 'evaluate_managed':
        return this.evaluateManaged(item, ctx, run);
      case 'evaluate_listing':
        return this.evaluateListing(item, ctx, run);
      default:
        this.limit(ctx, 'unknown_work_item', `skipped unknown work item kind ${item.kind}`);
    }
  }

  limit(ctx, kind, detail) {
    ctx.limitations.push({ kind, detail, at: nowIso() });
  }

  async fetchPage(item, ctx) {
    const result = await this.fetcher.fetchUrl(item.url);
    // "Attempted" counts real network attempts only — a pre-flight policy
    // refusal (network disabled, host not allowed, robots) never inflates
    // coverage (locked requirement 9).
    if (result.ok || !['NETWORK_DISABLED', 'HOST_NOT_ALLOWED', 'ROBOTS_DISALLOWED', 'VALIDATION_FAILED'].includes(result.error)) {
      ctx.counters.canonical_pages_attempted += 1;
    }
    if (!result.ok) {
      if (result.error === 'NETWORK_DISABLED') {
        const wanted = item.role === 'provider_page'
          ? ['network_access_policy', 'fnb_program', 'private_office_offers', 'terms_and_fees', 'contact_channels']
          : ['private_office_offers', 'access_basis', 'hvac_basis', 'fnb_program'];
        ctx.needsHost.push({ url: item.url, role: item.role, provider_id: item.provider_id ?? null, location_id: item.location_id ?? null, wanted_fields: wanted, hint: 'Fetch this page with host tools and record findings via office_ingest_observation.' });
        this.limit(ctx, 'network_disabled', `${item.url} queued for host-assisted ingestion`);
      } else if (result.error === 'BROWSER_INTERVENTION_REQUIRED' || result.error === 'RATE_LIMITED') {
        ctx.needsManual.push({ url: item.url, state: result.error, detail: result.detail });
        this.limit(ctx, result.error.toLowerCase(), result.detail);
      } else {
        this.limit(ctx, result.error.toLowerCase(), `${item.url}: ${result.detail}`);
      }
      return;
    }

    ctx.counters.search_results_inspected += 1;
    if (result.status >= 200 && result.status < 300) {
      const canonical = extractCanonical(result.body, result.final_url);
      const requestedKey = canonicalKey(item.url);
      const finalKey = canonicalKey(result.final_url);
      const matches = finalKey === requestedKey || (canonical && canonicalKey(canonical) === requestedKey);
      if (matches || finalKey.startsWith(requestedKey) || requestedKey.startsWith(finalKey)) {
        ctx.counters.canonical_pages_validated += 1;
      } else {
        this.limit(ctx, 'canonical_mismatch', `${item.url} resolved to ${result.final_url}`);
      }
      if (item.role === 'provider_page') ctx.counters.provider_pages_inspected += 1;
      if (item.role === 'location_page') ctx.counters.location_pages_inspected += 1;
      if (item.role === 'offer_page') ctx.counters.offer_or_inventory_pages_inspected += 1;

      const observation = recordObservation(this.store, {
        url: result.final_url,
        content: result.body,
        source_type: item.role === 'location_page' ? 'provider_page' : 'provider_page',
        extraction_method: 'server_fetch',
        extracted: [],
        confidence: 'medium',
      });

      // Price signals keep their basis; nothing here upgrades a desk price
      // into an office price (locked requirement 2).
      const text = sanitizeExcerpt(result.body, 8000);
      const signals = extractPriceSignals(text);
      const jsonLd = extractJsonLd(result.body);
      if (item.provider_id) {
        this.repos.providers.upsert({
          provider_id: item.provider_id,
          last_page_title: extractTitle(result.body),
          last_observation_id: observation.observation_id,
          last_price_signals: signals.slice(0, 10),
          last_jsonld_types: jsonLd.map((b) => b['@type']).filter(Boolean).slice(0, 5),
          last_fetched_at: nowIso(),
        });
      }
    } else {
      this.limit(ctx, 'source_fetch_failed', `${item.url} returned HTTP ${result.status}`);
    }
  }

  async listingCheck(item, ctx) {
    const listing = this.repos.listings.get(item.listing_id);
    if (!listing) return this.limit(ctx, 'missing_entity', `listing ${item.listing_id} not found`);
    if (!item.counted_discovered) ctx.counters.search_results_discovered += 1;
    ctx.counters.search_results_inspected += 1;

    if (listing.source_url && this.config.allowNetwork) {
      ctx.counters.canonical_pages_attempted += 1;
      const result = await this.fetcher.fetchUrl(listing.source_url);
      if (result.ok && result.status >= 200 && result.status < 300) {
        const finalKey = canonicalKey(result.final_url);
        const sourceKey = canonicalKey(listing.source_url);
        if (finalKey === sourceKey) {
          ctx.counters.canonical_pages_validated += 1;
          this.repos.listings.upsert({ listing_id: listing.listing_id, canonical_validation: 'validated', last_verified: nowIso() });
        } else {
          this.repos.listings.upsert({ listing_id: listing.listing_id, canonical_validation: 'redirected', canonical_redirect_target: result.final_url });
          this.limit(ctx, 'canonical_mismatch', `${listing.source_url} now resolves to ${result.final_url}`);
        }
      } else {
        this.repos.listings.upsert({ listing_id: listing.listing_id, canonical_validation: 'dead' });
        this.limit(ctx, 'source_fetch_failed', `${listing.source_url}: ${result.detail ?? `HTTP ${result.status}`}`);
      }
    } else if (listing.source_url) {
      ctx.needsHost.push({ url: listing.source_url, role: 'listing_page', listing_id: listing.listing_id, wanted_fields: ['still_live', 'asking_rent', 'usable_private_sqft', 'access_basis', 'hvac_basis'], hint: 'Verify the listing is live and unchanged; record via office_ingest_observation.' });
      this.limit(ctx, 'network_disabled', `${listing.source_url} queued for host verification`);
    }
    ctx.newItems.push({ kind: 'evaluate_listing', listing_id: item.listing_id });
  }

  evaluateManaged(item, ctx, run) {
    const location = this.repos.locations.get(item.location_id);
    if (!location) return this.limit(ctx, 'missing_entity', `location ${item.location_id} not found`);
    const provider = this.repos.providers.get(location.provider_id) ?? {};
    const offers = this.repos.offers.list((o) => o.location_id === item.location_id && o.active !== false);
    for (const offer of offers) {
      ctx.counters.candidates_detailed += 1;
      const quotes = this.repos.quotes.list((q) => q.offer_id === offer.offer_id);
      const latestQuote = quotes[quotes.length - 1] ?? null;
      const scored = scoreManaged({ provider, location, offer, quote: latestQuote }, { budget: this.config.budgetAllInMonthly });
      if (!scored.eligible) {
        const reason = offer.product_kind !== 'PRIVATE_OFFICE' ? 'not_private_office' : offer.enclosure_status !== 'CONFIRMED' ? 'enclosure_unconfirmed' : 'no_closeable_door';
        ctx.counters.hard_exclusions[reason] = (ctx.counters.hard_exclusions[reason] ?? 0) + 1;
        this.repos.offers.upsert({ offer_id: offer.offer_id, evaluation: { eligible: false, reasons: scored.reasons, run_id: run.search_run_id, at: nowIso() } });
        continue;
      }
      ctx.counters.candidates_surfaced += 1;
      if ((provider.outreach_priority ?? 'normal') === 'immediate' || scored.total >= 70) ctx.counters.outreach_queue_count += 1;
      this.repos.offers.upsert({ offer_id: offer.offer_id, evaluation: { eligible: true, score: scored.total, components: scored.components, four_price: scored.four_price, clarifications: scored.clarifications, run_id: run.search_run_id, at: nowIso() } });
    }
    if (offers.length === 0) this.limit(ctx, 'no_offers', `location ${item.location_id} has no recorded private-office offers`);
  }

  evaluateListing(item, ctx, run) {
    const listing = this.repos.listings.get(item.listing_id);
    if (!listing) return this.limit(ctx, 'missing_entity', `listing ${item.listing_id} not found`);
    ctx.counters.candidates_detailed += 1;

    if (listing.canonical_validation === 'dead' || listing.canonical_validation === 'redirected') {
      ctx.counters.hard_exclusions.dead_or_stale_source = (ctx.counters.hard_exclusions.dead_or_stale_source ?? 0) + 1;
      this.repos.listings.upsert({ listing_id: listing.listing_id, evaluation: { surfaced: false, reason: 'dead_or_stale_source', run_id: run.search_run_id, at: nowIso() } });
      return;
    }
    if (!qualifiesPrivateOffice({ product_kind: 'PRIVATE_OFFICE', enclosure_status: listing.enclosure_status ?? 'CONFIRMED', door_status: listing.door_status ?? 'UNKNOWN' })) {
      const reason = (listing.enclosure_status ?? 'CONFIRMED') !== 'CONFIRMED' ? 'enclosure_unconfirmed' : 'no_closeable_door';
      ctx.counters.hard_exclusions[reason] = (ctx.counters.hard_exclusions[reason] ?? 0) + 1;
      this.repos.listings.upsert({ listing_id: listing.listing_id, evaluation: { surfaced: false, reason, run_id: run.search_run_id, at: nowIso() } });
      return;
    }
    const scored = scoreConventional(listing, { budget: this.config.budgetAllInMonthly });
    const overBudget = scored.economics.all_in_monthly !== null && scored.economics.all_in_monthly > this.config.budgetAllInMonthly * 1.4;
    if (overBudget) {
      ctx.counters.hard_exclusions.over_budget = (ctx.counters.hard_exclusions.over_budget ?? 0) + 1;
      this.repos.listings.upsert({ listing_id: listing.listing_id, evaluation: { surfaced: false, reason: 'over_budget', score: scored.total, run_id: run.search_run_id, at: nowIso() } });
      return;
    }
    ctx.counters.candidates_surfaced += 1;
    this.repos.listings.upsert({ listing_id: listing.listing_id, evaluation: { surfaced: true, score: scored.total, components: scored.components, penalties: scored.penalties, clarifications: scored.clarifications, run_id: run.search_run_id, at: nowIso() } });
  }
}
