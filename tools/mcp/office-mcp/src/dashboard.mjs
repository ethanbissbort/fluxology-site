/**
 * Dashboard adapters (SDD v2 §A12, audit A5) — grounded in the real
 * Fluxology dashboard contract:
 *
 *   OfficeScoutV25Adapter → Office Scout feed v2.5 listing upsert payloads.
 *     Invariants honored: partial merge by stable id; NEVER null for an
 *     unknown numeric (the field is omitted); costStatus "verified" only when
 *     mandatoryFeesKnown and within ceiling; retire with active:false; the
 *     server-owned fields (priceHistory, firstSeen, lastSeen, lastVerified,
 *     lastChanged) are never emitted; upsert only — never full-feed PUT.
 *
 *   ManagedSnapshotAdapter → managed-providers.json research feed document,
 *     written under the DATA ROOT for human review-and-commit; prior snapshot
 *     content is carried forward, never destructively rewritten.
 */
import { nowIso } from '../../mcp-core/ids.mjs';
import { MANAGED_WEIGHTS } from './domain/config-defaults.mjs';
import { scoreConventional } from './domain/scoring-conventional.mjs';

const SERVER_OWNED_FIELDS = ['priceHistory', 'firstSeen', 'lastSeen', 'lastVerified', 'lastChanged'];

function putIfKnown(target, key, value) {
  if (value === undefined || value === null) return;
  target[key] = value;
}

/** Map a qualified ConventionalListing to an Office Scout v2.5 upsert record. */
export function toOfficeScoutRecord(listing, { budget }) {
  const scored = scoreConventional(listing, { budget });
  const record = { id: listing.dashboard_id ?? listing.listing_id, active: listing.active !== false };

  putIfKnown(record, 'operator', listing.operator);
  putIfKnown(record, 'address', listing.address);
  putIfKnown(record, 'municipality', listing.municipality);
  putIfKnown(record, 'askingRent', typeof listing.rent === 'number' ? listing.rent : undefined);
  putIfKnown(record, 'estimatedAllInMonthly', scored.economics.all_in_monthly ?? undefined);
  record.mandatoryFeesKnown = scored.economics.fees_known === true;
  if (scored.economics.all_in_monthly !== null) {
    record.costStatus = !record.mandatoryFeesKnown ? 'plausible' : scored.economics.all_in_monthly <= budget ? 'verified' : 'over';
  }
  for (const fee of listing.mandatory_recurring_fees ?? []) {
    const key = { hst: 'hstStatus', tmi: 'tmiStatus', utilities: 'utilitiesStatus', internet: 'internetStatus', cleaning: 'cleaningStatus' }[fee.kind];
    if (key) record[key] = typeof fee.monthly === 'number' ? (fee.monthly === 0 ? 'included' : `+$${fee.monthly}/mo`) : 'unknown';
  }
  putIfKnown(record, 'size', typeof listing.usable_private_sqft === 'number' ? `${listing.usable_private_sqft} sq ft usable private` : undefined);
  putIfKnown(record, 'lockableDoor', listing.door_status === 'CLOSEABLE_LOCKABLE' ? true : listing.door_status === 'NO_DOOR' ? false : undefined);
  putIfKnown(record, 'access24h', listing.access_basis === '24_7' ? true : listing.access_basis === 'BUSINESS_HOURS' ? false : undefined);
  putIfKnown(record, 'furnished', listing.furnished);
  putIfKnown(record, 'mailRights', listing.mail_rights);
  putIfKnown(record, 'signageRights', listing.signage_rights);
  putIfKnown(record, 'shortCommitment', listing.short_commitment);
  putIfKnown(record, 'term', listing.term);
  putIfKnown(record, 'amenities', listing.amenities);
  putIfKnown(record, 'parking', listing.parking);
  putIfKnown(record, 'transitConnection', listing.transit_connection);
  putIfKnown(record, 'finalWalkMinutes', listing.final_walk_minutes);
  putIfKnown(record, 'skateboardPractical', listing.skateboard_practical);
  putIfKnown(record, 'skateboardNote', listing.skateboard_note);
  putIfKnown(record, 'sourceUrl', listing.source_url);
  putIfKnown(record, 'summary', listing.summary);
  const hvacNote = listing.hvac_basis && listing.hvac_basis !== 'UNKNOWN' ? `HVAC: ${listing.hvac_basis}` : 'HVAC: unverified — clarify after-hours cooling';
  record.notes = [listing.notes, hvacNote, `Fit ${scored.total}/100`].filter(Boolean).join(' | ');

  for (const owned of SERVER_OWNED_FIELDS) delete record[owned];
  return record;
}

export class DashboardSync {
  constructor({ repos, store, config, fetchImpl = globalThis.fetch }) {
    this.repos = repos;
    this.store = store;
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  buildConventionalPayload() {
    const listings = this.repos.listings.list((l) => l.evaluation?.surfaced === true || l.active === false);
    return listings.map((l) => toOfficeScoutRecord(l, { budget: this.config.budgetAllInMonthly }));
  }

  buildManagedSnapshot() {
    const previous = this.store.readSnapshot('managed-providers') ?? { providers: [] };
    const prevById = new Map((previous.providers ?? []).map((p) => [p.id, p]));
    const providers = this.repos.providers.list((p) => p.watch_status !== 'ignored').map((provider) => {
      const prior = prevById.get(provider.dashboard_id ?? provider.provider_id) ?? {};
      const locations = this.repos.locations.list((l) => l.provider_id === provider.provider_id);
      const offers = this.repos.offers.list((o) => locations.some((l) => l.location_id === o.location_id));
      const best = offers.filter((o) => o.evaluation?.eligible).sort((a, b) => (b.evaluation?.score ?? 0) - (a.evaluation?.score ?? 0))[0];
      return {
        ...prior, // prior fields (including any history arrays) are carried forward, never dropped
        id: provider.dashboard_id ?? provider.provider_id,
        name: provider.display_name ?? provider.name ?? provider.provider_id,
        status: provider.watch_status ?? 'watch',
        priority: provider.priority ?? prior.priority ?? 3,
        preliminaryScore: best?.evaluation?.score ?? prior.preliminaryScore ?? null,
        scoreConfidence: best ? 'evidence-backed' : prior.scoreConfidence ?? 'low',
        gtaRelevant: provider.region_relevant ?? prior.gtaRelevant ?? true,
        priceSignal: summarizePriceSignals(provider, offers) ?? prior.priceSignal,
        foodBeverage: provider.fnb_notes ?? prior.foodBeverage,
        network: provider.network_notes ?? prior.network,
        outreachPriority: provider.outreach_priority ?? prior.outreachPriority ?? 'normal',
        outreachQuestions: provider.outreach_questions ?? prior.outreachQuestions ?? [],
        website: provider.website ?? prior.website,
        researchFreshness: provider.last_fetched_at ?? prior.researchFreshness ?? null,
      };
    });
    return {
      schemaVersion: 1,
      generatedAt: nowIso(),
      searchName: 'Fluxology Inc. Managed Office Watchlist',
      scoreModel: {
        allInEconomics: MANAGED_WEIGHTS.economics,
        privateOfficeQuality: MANAGED_WEIGHTS.office_quality,
        accessOperationalCertainty: MANAGED_WEIGHTS.access_certainty,
        foodBeverage: MANAGED_WEIGHTS.fnb,
        networkPrivileges: MANAGED_WEIGHTS.network,
        internetTechnology: MANAGED_WEIGHTS.internet_tech,
        meetingCollaboration: MANAGED_WEIGHTS.meeting,
        mailLogistics: MANAGED_WEIGHTS.mail_logistics,
        locationAccess: MANAGED_WEIGHTS.location,
        contractFlexibility: MANAGED_WEIGHTS.contract_flexibility,
      },
      providers,
    };
  }

  async sync({ dryRun = true } = {}) {
    const conventional = this.buildConventionalPayload();
    const managed = this.buildManagedSnapshot();
    const managedPath = this.store.writeSnapshot('managed-providers', managed);

    if (dryRun) {
      return {
        dry_run: true,
        conventional_upsert_payload: { listings: conventional },
        conventional_count: conventional.length,
        managed_snapshot_path: managedPath,
        managed_provider_count: managed.providers.length,
        note: 'No external write performed. Re-run with dry_run:false and OFFICE_INGEST_TOKEN set to push listings; commit the managed snapshot after review.',
      };
    }

    if (!this.config.dashboardUrl || !this.config.dashboardToken) {
      throw Object.assign(new Error('live sync requires FLUXOLOGY_DASHBOARD_URL and OFFICE_INGEST_TOKEN'), { code: 'VALIDATION_FAILED' });
    }
    const response = await this.fetchImpl(`${this.config.dashboardUrl}/api/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.dashboardToken}` },
      body: JSON.stringify({ listings: conventional }),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(`dashboard upsert failed: HTTP ${response.status}`), { code: 'DASHBOARD_CONFLICT', data: { status: response.status, body: bodyText.slice(0, 500) } });
    }
    return { dry_run: false, pushed: conventional.length, dashboard_response: safeJson(bodyText), managed_snapshot_path: managedPath };
  }
}

function summarizePriceSignals(provider, offers) {
  const signals = [];
  for (const offer of offers) {
    if (typeof offer.sticker_price === 'number') {
      signals.push(`${offer.price_basis === 'PER_DESK' ? 'C$' + offer.sticker_price + '/desk' : offer.price_basis === 'PER_PERSON' ? 'C$' + offer.sticker_price + '/person' : 'C$' + offer.sticker_price + '/mo'} (${offer.price_basis})`);
    }
  }
  if (signals.length === 0 && provider.last_price_signals?.length) {
    return provider.last_price_signals.slice(0, 2).map((s) => `C$${s.amount} (${s.basis})`).join('; ');
  }
  return signals.length ? signals.slice(0, 3).join('; ') : null;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 300);
  }
}
