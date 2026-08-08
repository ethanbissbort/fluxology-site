/** Jobs write tool (SDD §10.5, §23). */
import { OAUTH_SCOPES } from '../config.mjs';
import { createWriteTool } from './write-tool.mjs';

export function createJobsTools(deps) {
  return [
    createWriteTool(
      {
        scope: 'jobs',
        name: 'upsert_job_listings',
        title: 'Upsert Jobs listings',
        requiredScope: OAUTH_SCOPES.jobs,
        examples: { source: '"t176-trades-job-scout"' },
        summary: [
          'Create or update records on the Fluxology Jobs dashboard (jobs.fluxology.ca).',
          'Every new record needs title and company, plus a stable id or both source and sourceId to derive one from.',
          'The connector does not calculate job fit: supply the already-normalized fitScore (0-100) and',
          'keep careerValue and trainingValue separate from overall fit. Field bounds are validated here, ranking is not.',
          'Retire a listing with active:false; there is no delete tool.',
        ],
      },
      deps,
    ),
  ];
}
