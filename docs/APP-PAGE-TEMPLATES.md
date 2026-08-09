# Per-app privacy and support page templates

Fluxology uses data-driven Astro routes for the two stable URLs needed by each published app:

- `/apps/<app-slug>/privacy/`
- `/apps/<app-slug>/support/`

The route templates live in:

- `src/pages/apps/[appName]/privacy.astro`
- `src/pages/apps/[appName]/support.astro`

The reusable page renderers live in:

- `src/components/app/AppPrivacyPage.astro`
- `src/components/app/AppSupportPage.astro`

App-specific content is registered in `src/data/appPages.ts`.

## Publication rule

Only entries with `published: true` generate public routes. Keep an app at `published: false` while its release build, included SDKs, permissions, server APIs and App Store Connect privacy answers are still being reviewed.

Do not use generic or guessed privacy statements. Replace every `TODO` below with statements verified against the actual shipping build before setting `published: true`.

## Starter configuration

Copy this object into the `appPages` array in `src/data/appPages.ts` and replace every placeholder.

```ts
{
  slug: 'app-name',
  name: 'App Name',
  description: 'TODO: one-sentence description of the app.',
  version: '1.0',
  platform: 'iOS',
  supportEmail: 'info@fluxology.ca',
  published: false,

  privacy: {
    effectiveDate: 'YYYY-MM-DD',
    lastUpdated: 'YYYY-MM-DD',
    summary: 'TODO: concise summary of the app privacy model.',

    dataCollected: [
      'TODO: list each category of data the shipping app actually collects, or state precisely that the app does not collect user data if verified.'
    ],

    dataNotCollected: [
      'TODO: optional — identify material categories users may reasonably expect but the app does not collect.'
    ],

    uses: [
      'TODO: explain each purpose for which collected data is used.'
    ],

    sharing: [
      'TODO: explain whether and when data is transmitted to Fluxology, service providers, analytics/crash services, or other parties.'
    ],

    thirdPartyServices: [
      // Remove this example if no third-party SDK/service receives user data.
      {
        name: 'TODO: Service Name',
        purpose: 'TODO: what the service does and what data reaches it.',
        privacyUrl: 'https://example.com/privacy'
      }
    ],

    permissions: [
      // Include only permissions actually requested by the shipping app.
      {
        name: 'TODO: Camera / Location / Photos / Microphone / etc.',
        purpose: 'TODO: why the app requests this permission and how the resulting data is used.'
      }
    ],

    retention: [
      'TODO: explain how long each stored data category is retained and what determines deletion.'
    ],

    deletion: [
      'TODO: explain how users can delete app data or request deletion from Fluxology, including any in-app account deletion flow if applicable.'
    ],

    security: 'TODO: describe the relevant safeguards without making guarantees that cannot be supported.',
    children: 'TODO: state the app’s intended audience and any child-directed data handling that actually applies.',
    changes: 'Fluxology may update this policy when the app or its data practices change. The effective and last-updated dates above identify the current version.'
  },

  support: {
    intro: 'Fluxology, Inc. provides support for App Name.',

    issueChecklist: [
      'App version.',
      'iPhone or iPad model.',
      'iOS or iPadOS version.',
      'A concise description of the problem and the steps that reproduce it.',
      'Relevant screenshots, if they do not contain information you do not want to send by email.'
    ],

    troubleshooting: [
      'Confirm the device is running a supported operating-system version.',
      'Quit and reopen the app.',
      'Restart the device.',
      'Check the App Store for an available update.',
      'If the problem continues, contact Fluxology with the information listed above.'
    ],

    accountAndDataRequests: 'TODO: include only if the app has accounts or server-side user data. Otherwise remove this property.',
    purchasesAndBilling: 'TODO: include only if the app has paid downloads, subscriptions or in-app purchases. Otherwise remove this property.',
    responseNote: 'TODO: optional support-hours or response-time statement. Do not promise a response time Fluxology cannot consistently meet.'
  }
}
```

## Release checklist

Before changing `published` to `true`:

1. Build the exact app version intended for submission.
2. Inventory every Apple privacy-sensitive permission used by the app.
3. Inventory every third-party SDK, API and remote service in that build.
4. Verify what data leaves the device, what stays on-device, and what is stored by Fluxology or a service provider.
5. Reconcile the page with the App Store Connect privacy questionnaire.
6. Verify the support mailbox is monitored.
7. Replace every placeholder and remove sections that do not apply.
8. Set the correct app version and policy dates.
9. Set `published: true` and run the production site build.
10. Verify both public URLs before entering them in App Store Connect.

Because the routes are generated from one registry entry, the privacy and support URLs remain consistent and use the same app name, version, platform and support email.
