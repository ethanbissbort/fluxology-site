/**
 * MCP resources (SDD v2 §A5): stable read models for context attachment and
 * audit inspection. Tools remain the interface for actions.
 */

const TEMPLATES = [
  { uriTemplate: 'office://providers/{provider_id}', name: 'Provider profile', mimeType: 'application/json' },
  { uriTemplate: 'office://locations/{location_id}', name: 'Location profile', mimeType: 'application/json' },
  { uriTemplate: 'office://offers/{offer_id}', name: 'Office offer', mimeType: 'application/json' },
  { uriTemplate: 'office://listings/{listing_id}', name: 'Conventional listing', mimeType: 'application/json' },
  { uriTemplate: 'office://quotes/{quote_id}', name: 'Quote', mimeType: 'application/json' },
  { uriTemplate: 'office://search-runs/{search_run_id}', name: 'Search run', mimeType: 'application/json' },
  { uriTemplate: 'office://search-runs/{search_run_id}/coverage', name: 'Search run coverage audit', mimeType: 'application/json' },
  { uriTemplate: 'office://outreach/{outreach_id}', name: 'Outreach package', mimeType: 'application/json' },
  { uriTemplate: 'office://form-submissions/{submission_id}', name: 'Form submission', mimeType: 'application/json' },
];

export function buildResources({ repos }) {
  function resolve(uri) {
    const match = uri.match(/^office:\/\/([a-z-]+)\/([A-Za-z0-9_]+)(\/coverage)?$/);
    if (!match) return null;
    const [, family, id, coverage] = match;
    const lookup = {
      providers: () => repos.providers.get(id),
      locations: () => repos.locations.get(id),
      offers: () => repos.offers.get(id),
      listings: () => repos.listings.get(id),
      quotes: () => repos.quotes.get(id),
      'search-runs': () => {
        const run = repos.searchRuns.get(id);
        if (!run) return null;
        if (coverage) return { search_run_id: id, status: run.status, counters: run.counters, limitations: run.limitations };
        return run;
      },
      outreach: () => repos.outreach.get(id),
      'form-submissions': () => repos.forms.get(id),
    }[family];
    return lookup ? lookup() : null;
  }

  return {
    list() {
      const entries = [];
      for (const run of repos.searchRuns.list()) {
        entries.push({ uri: `office://search-runs/${run.search_run_id}`, name: `Search run ${run.search_run_id} (${run.profile}, ${run.status})`, mimeType: 'application/json' });
        entries.push({ uri: `office://search-runs/${run.search_run_id}/coverage`, name: `Coverage audit ${run.search_run_id}`, mimeType: 'application/json' });
      }
      for (const pkg of repos.outreach.list()) {
        entries.push({ uri: `office://outreach/${pkg.outreach_id}`, name: `Outreach package ${pkg.outreach_id} (${pkg.status})`, mimeType: 'application/json' });
      }
      return entries.sort((a, b) => a.uri.localeCompare(b.uri));
    },
    templates() {
      return TEMPLATES;
    },
    read(uri) {
      const value = resolve(uri);
      if (!value) return null;
      return [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }];
    },
  };
}
