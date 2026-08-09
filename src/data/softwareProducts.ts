export interface SoftwareProduct {
  id: string;
  name: string;
  status: string;
  category: string;
  icon: string;
  shortDescription: string;
  longDescription: string;
  capabilities: string[];
  workflow: string[];
  previewLabels: string[];
}

export const softwareProducts: SoftwareProduct[] = [
  {
    id: 'office-scout',
    name: 'Office Scout',
    status: 'Active development',
    category: 'Decision-support software',
    icon: '/office-scout/favicon.svg',
    shortDescription:
      'Office Scout turns office-listing research into a structured decision workflow built around verified all-in cost, access, transit and fit rather than headline rent alone.',
    longDescription:
      'The product is designed to keep commercial-office research comparable as listings change. It separates verified costs from unresolved costs, records access and transit information, scores fit, preserves price history and supports a personal review workflow without mixing that personal state into the shared listing feed.',
    capabilities: [
      'Verified vs. needs-verification cost status',
      'All-in recurring cost and budget comparison',
      'Fit scoring and sortable comparison',
      'Transit, access, rights and amenity fields',
      'Listing-change and observed price-history tracking',
    ],
    workflow: [
      'Unreviewed',
      'Saved',
      'Contacted',
      'Tour booked',
      'Rejected',
      'Leased',
    ],
    previewLabels: ['All-in cost', 'Fit /100', 'Transit', 'Recently changed'],
  },
  {
    id: 'fluxology-deals',
    name: 'Fluxology Deals',
    status: 'Active development',
    category: 'Deal research and comparison',
    icon: '/deals/favicon.svg',
    shortDescription:
      'Fluxology Deals consolidates product searches into a persistent comparison workflow, with explicit landed-cost logic and a hard distinction between verified destination shipping and unresolved estimates.',
    longDescription:
      'The product is designed for searches where the headline item price is not enough to judge value. It keeps multiple shopping categories in one feed, preserves useful historical records, tracks landed-cost calculations and makes unresolved shipping visible instead of presenting an estimate as a confirmed destination quote.',
    capabilities: [
      'Multiple shopping searches in one persistent feed',
      'Landed-cost comparison with CAD normalization',
      'Resolved vs. unresolved destination-shipping status',
      'Historical listing and status preservation',
      'Category and search-specific filtering',
    ],
    workflow: [
      'Watch',
      'Saved',
      'Purchased',
      'Rejected',
    ],
    previewLabels: ['Landed cost', 'Shipping status', 'Listing history', 'Category feed'],
  },
];
