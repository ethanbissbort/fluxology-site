/** Office Scout write tool (SDD §10.3, §23). */
import { OAUTH_SCOPES } from '../config.mjs';
import { createWriteTool } from './write-tool.mjs';

export function createOfficeTools(deps) {
  return [
    createWriteTool(
      {
        scope: 'office',
        name: 'upsert_office_listings',
        title: 'Upsert Office Scout listings',
        requiredScope: OAUTH_SCOPES.office,
        examples: { source: '"office-scout-skill"' },
        summary: [
          'Create or update records on the Fluxology Office Scout dashboard (office.fluxology.ca).',
          'Every record needs a stable id; send all accepted records from one search run in a single call.',
          'A NEW record must also carry operator, address, municipality, mandatoryFeesKnown and active;',
          'updates to an existing record may send any subset of fields.',
          'mandatoryFeesKnown:true asserts that every mandatory recurring cost is known, so it requires',
          'estimatedAllInMonthly to be a real number above zero — never null, never 0. Leave mandatoryFeesKnown',
          'false while the figure is unknown; costStatus:"verified" additionally requires that figure to sit at or',
          'below the search\'s hard all-in ceiling. Unknown costs stay unknown.',
          'Retire a listing with active:false; there is no delete tool, and one call can retire a whole dashboard.',
        ],
      },
      deps,
    ),
  ];
}
