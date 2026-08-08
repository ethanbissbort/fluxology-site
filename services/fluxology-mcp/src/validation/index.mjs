/** Category rule modules, keyed by dashboard scope. */
import { office } from './office.mjs';
import { deals } from './deals.mjs';
import { jobs } from './jobs.mjs';

export const CATEGORY_RULES = Object.freeze({ office, deals, jobs });

export { office, deals, jobs };
