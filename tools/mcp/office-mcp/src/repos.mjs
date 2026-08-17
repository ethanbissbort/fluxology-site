/**
 * Repositories over the append-only store (SDD v2 §A2). Entity state is a
 * fold over ledger events: `upsert` events merge fields (last-write-wins per
 * field, never deleting history), while quotes, negotiation events, and
 * observations are pure appends. Domain code depends on these interfaces,
 * not on the storage layout.
 */
import { newId, nowIso } from '../../mcp-core/ids.mjs';

function foldEntity(events) {
  let entity = null;
  const history = [];
  for (const e of events) {
    if (e.type === 'upsert') {
      history.push({ at: e.at, fields: Object.keys(e.data) });
      entity = { ...(entity ?? {}), ...e.data, updated_at: e.at };
      if (!entity.created_at) entity.created_at = e.at;
    }
  }
  if (entity) entity.change_history = history;
  return entity;
}

class EntityRepo {
  constructor(store, ledger, idPrefix, idField) {
    this.store = store;
    this.ledger = ledger;
    this.idPrefix = idPrefix;
    this.idField = idField;
  }

  upsert(data) {
    const id = data[this.idField] ?? newId(this.idPrefix);
    const event = { type: 'upsert', at: nowIso(), id, data: { ...data, [this.idField]: id } };
    this.store.appendEvent(this.ledger, event);
    return this.get(id);
  }

  get(id) {
    return foldEntity(this.store.readEvents(this.ledger, (e) => e.id === id));
  }

  list(filter) {
    const byId = new Map();
    for (const e of this.store.readEvents(this.ledger)) {
      if (!byId.has(e.id)) byId.set(e.id, []);
      byId.get(e.id).push(e);
    }
    const entities = [...byId.values()].map(foldEntity).filter(Boolean);
    return filter ? entities.filter(filter) : entities;
  }
}

class AppendRepo {
  constructor(store, ledger, idPrefix, idField) {
    this.store = store;
    this.ledger = ledger;
    this.idPrefix = idPrefix;
    this.idField = idField;
  }

  append(data) {
    const id = data[this.idField] ?? newId(this.idPrefix);
    const record = { ...data, [this.idField]: id, recorded_at: nowIso() };
    this.store.appendEvent(this.ledger, { type: 'append', at: record.recorded_at, id, data: record });
    return record;
  }

  get(id) {
    const events = this.store.readEvents(this.ledger, (e) => e.id === id);
    return events.length ? events[0].data : null;
  }

  list(filter) {
    const records = this.store.readEvents(this.ledger).map((e) => e.data);
    return filter ? records.filter(filter) : records;
  }
}

export function createRepos(store) {
  return {
    providers: new EntityRepo(store, 'providers', 'prov', 'provider_id'),
    locations: new EntityRepo(store, 'locations', 'loc', 'location_id'),
    offers: new EntityRepo(store, 'offers', 'offer', 'offer_id'),
    listings: new EntityRepo(store, 'listings', 'lst', 'listing_id'),
    outreach: new EntityRepo(store, 'outreach', 'outr', 'outreach_id'),
    forms: new EntityRepo(store, 'form-submissions', 'form', 'submission_id'),
    searchRuns: new EntityRepo(store, 'search-runs', 'run', 'search_run_id'),
    contacts: new EntityRepo(store, 'contacts', 'cont', 'contact_id'),
    quotes: new AppendRepo(store, 'quotes', 'quote', 'quote_id'),
    negotiation: new AppendRepo(store, 'negotiation-events', 'neg', 'event_id'),
  };
}
