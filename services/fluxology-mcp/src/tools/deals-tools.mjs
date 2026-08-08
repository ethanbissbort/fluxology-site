/** Deals write tool (SDD §10.4, §23). */
import { OAUTH_SCOPES } from '../config.mjs';
import { createWriteTool } from './write-tool.mjs';

export function createDealsTools(deps) {
  return [
    createWriteTool(
      {
        scope: 'deals',
        name: 'upsert_deal_listings',
        title: 'Upsert Deals listings',
        requiredScope: OAUTH_SCOPES.deals,
        examples: { source: '"bulk-lego-deal-watch" or "bulk-minifigure-watch"' },
        summary: [
          'Create or update records on the Fluxology Deals dashboard (deals.fluxology.ca).',
          'Several searches share one feed, so every new record needs category, searchName, title and listingType.',
          'Use the stable id form ebay-<itemId>, or send itemId and let the connector derive it.',
          'If destination shipping is not confirmed, leave shippingResolved false: landedCadPerLb and allInCadPerLb',
          'are then stored as provisional and must not be presented as resolved.',
          'Retire a listing with active:false; there is no delete tool.',
        ],
      },
      deps,
    ),
  ];
}
