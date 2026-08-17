/**
 * Environment-driven configuration (SDD v2 §0.8). All operational parameters
 * live here with safe defaults; secrets are only ever read from env and are
 * reported as booleans, never as values.
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeDataRoot } from '../../mcp-core/store.mjs';
import { DEFAULTS } from './domain/config-defaults.mjs';

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  const dataDir = env.FLUXOLOGY_OFFICE_DATA_DIR || path.join(os.homedir(), '.fluxology', 'office-mcp');
  assertSafeDataRoot(dataDir, PACKAGE_DIR);

  const allowedHosts = (env.FLUXOLOGY_OFFICE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  return {
    dataDir,
    region: env.FLUXOLOGY_OFFICE_REGION || DEFAULTS.region,
    currency: DEFAULTS.currency,
    budgetAllInMonthly: Number(env.FLUXOLOGY_OFFICE_BUDGET_CAD) || DEFAULTS.budget_all_in_monthly,
    allowNetwork: env.FLUXOLOGY_OFFICE_ALLOW_NETWORK === '1',
    allowedHosts,
    trustedInternalHosts: (env.FLUXOLOGY_OFFICE_TRUSTED_INTERNAL_HOSTS || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    formSubmitEnabled: env.FLUXOLOGY_OFFICE_FORM_SUBMIT_ENABLED === '1',
    dashboardUrl: (env.FLUXOLOGY_DASHBOARD_URL || '').replace(/\/$/, ''),
    dashboardToken: env.OFFICE_INGEST_TOKEN || '',
    http: {
      bind: env.FLUXOLOGY_OFFICE_HTTP_BIND || '127.0.0.1',
      port: Number(env.FLUXOLOGY_OFFICE_HTTP_PORT) || 8090,
      token: env.FLUXOLOGY_OFFICE_HTTP_TOKEN || '',
      origins: (env.FLUXOLOGY_OFFICE_HTTP_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
    },
    limits: {
      excerptMaxChars: DEFAULTS.excerpt_max_chars,
      fetchMaxBytes: DEFAULTS.fetch_max_bytes,
      fetchTimeoutMs: DEFAULTS.fetch_timeout_ms,
      fetchMinIntervalMs: DEFAULTS.fetch_min_interval_ms,
      searchStepMaxItems: DEFAULTS.search_step_max_items,
    },
  };
}
