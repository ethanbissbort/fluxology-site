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
          'A record may only be marked costStatus:"verified" when mandatoryFeesKnown is true and',
          'estimatedAllInMonthly is a real number at or below the search\'s hard all-in ceiling — unknown costs stay unknown.',
          'Retire a listing with active:false; there is no delete tool.',
        ],
      },
      deps,
    ),
  ];
}
