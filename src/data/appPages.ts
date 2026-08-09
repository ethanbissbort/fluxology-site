export interface AppThirdPartyService {
  name: string;
  purpose: string;
  privacyUrl?: string;
}

export interface AppPermission {
  name: string;
  purpose: string;
}

export interface AppPrivacyConfig {
  effectiveDate: string;
  lastUpdated: string;
  summary: string;
  dataCollected: string[];
  dataNotCollected?: string[];
  uses: string[];
  sharing: string[];
  thirdPartyServices: AppThirdPartyService[];
  permissions: AppPermission[];
  retention: string[];
  deletion: string[];
  security: string;
  children: string;
  changes: string;
}

export interface AppSupportConfig {
  intro: string;
  issueChecklist: string[];
  troubleshooting: string[];
  accountAndDataRequests?: string;
  purchasesAndBilling?: string;
  responseNote?: string;
}

export interface AppPageConfig {
  /** URL-safe path segment used in /apps/<slug>/privacy/ and /support/. */
  slug: string;
  /** Public App Store / product name. */
  name: string;
  /** One-sentence product description. */
  description: string;
  /** Current public version, e.g. "1.0". */
  version: string;
  /** Platform label, normally "iOS" or "iOS and iPadOS". */
  platform: string;
  /** Support mailbox monitored by Fluxology, Inc. */
  supportEmail: string;
  /** Keep false until every statement below matches the shipping app. */
  published: boolean;
  privacy: AppPrivacyConfig;
  support: AppSupportConfig;
}

/**
 * Registry for app-specific Apple-facing policy/support pages.
 *
 * IMPORTANT:
 * - Only entries with published:true generate public routes.
 * - Do not publish placeholder privacy language.
 * - Privacy statements must match the exact shipping build, included SDKs,
 *   permissions, server APIs and App Store Connect privacy disclosures.
 *
 * To add an app, copy the example object from docs/APP-PAGE-TEMPLATES.md into
 * this array, replace every TODO, review it against the release build, then
 * change published to true.
 */
export const appPages: AppPageConfig[] = [];
