import type { ImageMetadata } from 'astro';

// Optimized build-time assets (astro:assets). Each import carries intrinsic
// width/height metadata, so ImageAsset no longer stores dimensions manually.
import fabricationShowcaseImg from '../assets/images/fabrication/welding-showcase.webp';
import fabricationCustomImg from '../assets/images/fabrication/custom-fabrication.webp';
import fabricationWeldingImg from '../assets/images/fabrication/precision-welding.webp';
import fabricationRepairImg from '../assets/images/fabrication/metal-repair.webp';
import labShowcaseImg from '../assets/images/3d-lab/lab-showcase.webp';
import labPrintingImg from '../assets/images/3d-lab/3d-printing.webp';
import labScanningImg from '../assets/images/3d-lab/3d-scanning.webp';
import labWireframeBackgroundImg from '../assets/images/3d-lab/wireframe-background.webp';
import greenhouseShowcaseMainImg from '../assets/images/greenhouse/showcase-main.webp';
import greenhouseShowcaseSunlitImg from '../assets/images/greenhouse/showcase-sunlit.webp';
import greenhouseShowcaseAisleImg from '../assets/images/greenhouse/showcase-growing-aisle.webp';
import greenhouseShowcaseWorkspaceImg from '../assets/images/greenhouse/showcase-workspace.webp';
import greenhouseGingerImg from '../assets/images/greenhouse/ginger-production.webp';
import greenhouseCoffeeImg from '../assets/images/greenhouse/coffee-cultivation.webp';
import greenhouseCocoaImg from '../assets/images/greenhouse/cocoa-growing.webp';
import greenhouseSpecialtyImg from '../assets/images/greenhouse/specialty-crops.webp';
import orchardShowcaseMainImg from '../assets/images/orchard/showcase-main.webp';
import orchardShowcaseUnderstoryImg from '../assets/images/orchard/showcase-understory.webp';
import orchardFruitTreeImg from '../assets/images/orchard/fruit-tree-production.webp';
import orchardNutImg from '../assets/images/orchard/nut-cultivation.webp';
import orchardPerennialImg from '../assets/images/orchard/perennial-crops.webp';
import orchardFoodForestImg from '../assets/images/orchard/food-forest-systems.webp';

export interface ImageAsset {
  src: ImageMetadata;
  alt: string;
  caption?: string;
}

export interface OverviewService {
  icon: string;
  title: string;
  description: string;
  meta?: string;
  image?: ImageAsset;
}

export interface OverviewFact {
  label: string;
  value: string;
}

export interface ProcessStep {
  title: string;
  description: string;
}

export interface DbaOverview {
  id: string;
  theme: 'industrial' | 'tech' | 'natural';
  particleVariant?: string;
  name: string;
  eyebrow?: string;
  status: string;
  classification: string;
  description: string;
  facts: OverviewFact[];
  servicesTitle: string;
  servicesIntro: string;
  services: OverviewService[];
  processTitle: string;
  processIntro: string;
  processSteps: ProcessStep[];
  boundary: {
    title: string;
    description: string;
  };
  showcaseImages: ImageAsset[];
  sectionBackground?: ImageMetadata;
  ctaText: string;
  ctaNote: string;
  detailHref: string;
}

export interface DetailTable {
  eyebrow: string;
  title: string;
  intro: string;
  headers: string[];
  rows: string[][];
}

export interface DetailCard {
  title: string;
  text: string;
}

export interface DetailMilestone {
  code: string;
  title: string;
  evidence: string;
}

export interface DbaDetail {
  pageTitle: string;
  metaDescription: string;
  heroImage: ImageAsset;
  roleEyebrow: string;
  roleTitle: string;
  roleParagraphs: string[];
  rolePoints: DetailCard[];
  offer: DetailTable;
  capital: DetailTable;
  controlsTitle: string;
  controlsIntro: string;
  controls: DetailCard[];
  milestonesTitle: string;
  milestonesIntro: string;
  milestones: DetailMilestone[];
  galleryTitle: string;
  galleryIntro: string;
  gallery: ImageAsset[];
  planningNote: string;
}

export interface DbaPlan {
  slug: string;
  shortName: string;
  overview: DbaOverview;
  detail: DbaDetail;
}

const fabricationShowcase: ImageAsset = {
  src: fabricationShowcaseImg,
  alt: 'Welder working on a large steel assembly as sparks cross the workshop',
  caption: 'Mobile first · fixed workshop later'
};

const fabricationCustom: ImageAsset = {
  src: fabricationCustomImg,
  alt: 'Fabricator measuring a newly assembled steel component on a workbench',
  caption: 'Small assemblies and practical fixtures'
};

const fabricationWelding: ImageAsset = {
  src: fabricationWeldingImg,
  alt: 'Close view of a bright welding arc joining steel',
  caption: 'Controlled process and documented scope'
};

const fabricationRepair: ImageAsset = {
  src: fabricationRepairImg,
  alt: 'Angle grinder restoring a worn industrial metal component',
  caption: 'Repair before replacement where practical'
};

const labShowcase: ImageAsset = {
  src: labShowcaseImg,
  alt: 'Large-format 3D printer operating in a dark digital fabrication laboratory',
  caption: 'One reliable process at a time'
};

const labPrinting: ImageAsset = {
  src: labPrintingImg,
  alt: 'FDM printer producing a complex white lattice under cyan and magenta light',
  caption: 'Prototypes, jigs, fixtures and low-volume parts'
};

const labScanning: ImageAsset = {
  src: labScanningImg,
  alt: 'Cyan scanning beams capturing an engine component as a digital point cloud',
  caption: 'Capture geometry when measurement alone is inefficient'
};

const greenhouseShowcase: ImageAsset[] = [
  {
    src: greenhouseShowcaseMainImg,
    alt: 'Sunlit greenhouse aisle filled with ginger, coffee, and tropical food crops',
    caption: 'Household food infrastructure first'
  },
  {
    src: greenhouseShowcaseSunlitImg,
    alt: 'Warm sunlight crossing a greenhouse filled with vegetables and tropical plants',
    caption: 'Season extension and crop reliability'
  },
  {
    src: greenhouseShowcaseAisleImg,
    alt: 'Narrow greenhouse growing aisle bordered by coffee plants and fresh crops',
    caption: 'Small, modular and repairable systems'
  },
  {
    src: greenhouseShowcaseWorkspaceImg,
    alt: 'Working greenhouse with hand tools, irrigation hose, and mature plantings',
    caption: 'Manual fallback behind every automation layer'
  }
];

const greenhouseServiceImages: ImageAsset[] = [
  {
    src: greenhouseGingerImg,
    alt: 'Ginger plants and harvested rhizomes arranged inside a productive greenhouse',
    caption: 'Staple and preservation crop study'
  },
  {
    src: greenhouseCoffeeImg,
    alt: 'Long-season plants growing among terracotta containers beneath greenhouse glazing',
    caption: 'Protected long-season crop concept'
  },
  {
    src: greenhouseCocoaImg,
    alt: 'Tropical greenhouse planting with companion crops',
    caption: 'Controlled-environment research concept'
  },
  {
    src: greenhouseSpecialtyImg,
    alt: 'Dense collection of specialty crops growing in terracotta pots and raised beds',
    caption: 'Crop-diversity trial concept'
  }
];

const orchardShowcase: ImageAsset[] = [
  {
    src: orchardShowcaseMainImg,
    alt: 'Wide food forest orchard at golden hour with layered perennial plantings',
    caption: 'Land improvement first · revenue last'
  },
  {
    src: orchardShowcaseUnderstoryImg,
    alt: 'Orchard path crossing a dense edible understory beneath mature trees',
    caption: 'Every vegetation layer needs a defined function'
  }
];

const orchardServiceImages: ImageAsset[] = [
  {
    src: orchardFruitTreeImg,
    alt: 'Young fruit trees surrounded by layered edible understory planting',
    caption: 'Small annual planting cohorts'
  },
  {
    src: orchardNutImg,
    alt: 'Mixed orchard canopy above a biodiverse herbaceous understory',
    caption: 'Diverse cultivars and harvest windows'
  },
  {
    src: orchardPerennialImg,
    alt: 'Perennial vegetables and flowering companions arranged beneath orchard trees',
    caption: 'Perennial understory with practical functions'
  },
  {
    src: orchardFoodForestImg,
    alt: 'Established food forest path winding through trees, shrubs, and groundcover',
    caption: 'Access, harvest and maintenance remain designed in'
  }
];

export const dbaPlans: DbaPlan[] = [
  {
    slug: 'fabrication',
    shortName: 'Fabrication & Welding',
    overview: {
      id: 'fabrication',
      theme: 'industrial',
      name: 'Fluxology Fabrication & Welding',
      status: 'Target launch 2029 · First proposed operating name to register',
      classification:
        '811310 is the provisional primary code if non-construction repair welding and equipment repair lead actual corporate revenue. The code must be reviewed annually and may change if construction-site welding or fence work dominates.',
      description:
        'A controlled one-person trade service for mobile repair, local custom fabrication and selective shop overflow. It is designed to operate around full-time trade employment, earn the corporation\'s first customer revenue and later anchor a carefully zoned homestead workshop.',
      facts: [
        { label: 'Portfolio role', value: 'Primary customer-revenue engine' },
        { label: 'Operating mode', value: 'Mobile first; fixed shop after property' },
        { label: 'Best-fit work', value: 'Short, inspectable, local one-person scopes' }
      ],
      servicesTitle: 'A narrow, practical launch offer',
      servicesIntro:
        'The initial portfolio favours work that can be quoted from clear evidence, transported or reached locally, completed without a crew and closed out with documented results.',
      services: [
        {
          icon: '🔧',
          title: 'Repair Welding',
          meta: 'Core · Mobile or shop',
          description:
            'Broken brackets, frames, hinges and light non-code equipment repairs for homeowners, farms and small shops.',
          image: fabricationRepair
        },
        {
          icon: '🚪',
          title: 'Fence & Gate Work',
          meta: 'Core · Mostly mobile',
          description:
            'Hinge and latch repair, damaged sections, gate alignment and modest new fabrication where classification and insurance fit.'
        },
        {
          icon: '⚙️',
          title: 'Custom Fabrication',
          meta: 'Core · Controlled shop work',
          description:
            'Brackets, carts, racks, guards, fixtures and simple assemblies built to a written, visually verifiable scope.',
          image: fabricationCustom
        },
        {
          icon: '🔥',
          title: 'Shop Overflow',
          meta: 'Selective · Purchase-order scope',
          description:
            'Cut, fit, tack, weld or finish defined parts for local fabricators without imitating a full-service structural contractor.',
          image: fabricationWelding
        }
      ],
      processTitle: 'A complete field-service workflow',
      processIntro:
        'Mobile work is viable only when intake, travel, setup, safety and closeout are treated as part of the service rather than invisible overhead.',
      processSteps: [
        { title: 'Intake', description: 'Collect photos, dimensions, material, access conditions and safety information.' },
        { title: 'Triage', description: 'Decide repairability, code sensitivity, field versus shop mode, or decline and refer.' },
        { title: 'Quote', description: 'State call-out, labour, travel, material, tax, site assumptions and change rules in writing.' },
        { title: 'Execute', description: 'Complete the job hazard assessment, isolate hazards, perform the work and obtain sign-off.' },
        { title: 'Close', description: 'Invoice, record actuals, preserve closeout photos and retain reusable design information.' }
      ],
      boundary: {
        title: 'Capability is not authorization',
        description:
          'Pressure systems, fuel-gas systems, engineered structural connections and other code-sensitive work are declined until the required qualifications, procedures, professional responsibility and insurance are in place.'
      },
      showcaseImages: [fabricationShowcase],
      ctaText: 'Explore the Full Fabrication Plan',
      ctaNote: 'Detailed scope, workflow, capital gates and launch milestones',
      detailHref: '/fabrication/'
    },
    detail: {
      pageTitle: 'Fluxology Fabrication & Welding | 2029+ Operating Plan',
      metaDescription:
        'Detailed 2029+ plan for Fluxology Fabrication & Welding: mobile repair, local custom fabrication, shop overflow, field workflow, equipment gates and milestones.',
      heroImage: fabricationShowcase,
      roleEyebrow: 'Strategic role',
      roleTitle: 'The trade business is the cash engine - but not the only income source',
      roleParagraphs: [
        'The line begins as a disciplined field-and-shop practice around full-time trade employment. Employment supplies stable personal income, apprentice hours and continuous skill formation; Fluxology separately earns only the work it quotes, performs and invoices.',
        'The strongest early jobs are visually inspectable, short-duration, paid promptly and reachable inside a controlled service radius. Repeat farms, rural property owners, property managers, contractors and small shops are more valuable than anonymous work with unclear access or specifications.'
      ],
      rolePoints: [
        { title: 'Side-business by design', text: 'No employees, fixed industrial lease or large standing inventory in the base model.' },
        { title: 'Local service advantage', text: 'Photo-first intake and mobile capability solve repair problems that do not fit online purchasing.' },
        { title: 'Job-cost feedback', text: 'Every completed job improves the estimating template with actual travel, setup, material and rework data.' },
        { title: 'Workshop later', text: 'The homestead shop is commissioned only after property, zoning, utilities, fire access and insurance are confirmed.' }
      ],
      offer: {
        eyebrow: 'Service portfolio',
        title: 'Customer selection matters more than raw lead volume',
        intro: 'The launch offer stays narrow enough to control liability, travel time, equipment needs and workload for one operator.',
        headers: ['Service family', 'Initial scope', 'Best-fit buyer', 'Mode', 'Launch posture'],
        rows: [
          ['Repair welding', 'Broken brackets, frames, hinges, light equipment and non-code metal repairs', 'Homeowners, farms, small shops', 'Mobile or shop', 'Core'],
          ['Fence and gate work', 'Hinges, latches, alignment, damaged sections and modest new fabrication', 'Homeowners and rural property owners', 'Mostly mobile', 'Core; classification-sensitive'],
          ['Custom fabrication', 'Brackets, carts, racks, guards, fixtures and simple assemblies', 'Local contractors and small businesses', 'Shop', 'Core'],
          ['Shop overflow', 'Defined cutting, fitting, tacking, welding or finishing under purchase order', 'Local fabricators', 'Shop or client site', 'Selective'],
          ['Code-sensitive work', 'Pressure, fuel gas, engineered structural connections and regulated systems', 'Commercial or industrial', 'Varies', 'Decline until fully qualified and insured']
        ]
      },
      capital: {
        eyebrow: 'Capital ladder',
        title: 'Used and surplus equipment funded by utilization',
        intro: 'A machine enters the plan only when paid work or a recurring bottleneck proves the need, the asset can be inspected and supported, and the base-case payback fits within 24 months.',
        headers: ['Phase', 'Used-first setup', 'Planning envelope', 'Purchase gate'],
        rows: [
          ['2029 mobile launch', 'Multi-process welder, leads, PPE, grinders, clamps, fire controls, hand tools, storage and consumables', '$5.8k', 'First paid jobs and insured operating setup'],
          ['2030 field reliability', 'Portable workholding, better metrology, weather protection, power contingency and repair reserve', '$2.7k', 'Recurring mobile work exposes a bottleneck'],
          ['2032 shop fit-out', 'Used benches, saw, drill press, ventilation, storage, handling and electrical fit-out', '$6k-$8.5k', 'Homestead acquired; zoning and utilities confirmed'],
          ['Later optional capacity', 'Used plasma cutting, positioner or larger machine', 'Project-specific', 'Signed or repeated demand supports 24-month payback']
        ]
      },
      controlsTitle: 'Field, legal and one-person operating controls',
      controlsIntro: 'The control system is what turns tools in a vehicle into a repeatable service business.',
      controls: [
        { title: 'Written intake and quote', text: 'Photos, access, material, site power, travel, fire watch, payment and changed-condition rules are explicit.' },
        { title: 'Hot-work control', text: 'A field risk assessment, isolation, extinguishers, fire watch and closeout photographs are part of every applicable job.' },
        { title: 'Scope and qualification gate', text: 'Regulated or engineered work stays outside the offer until procedures, credentials and coverage match.' },
        { title: 'Employment separation', text: 'T4 employment and Fluxology contracts use separate schedules, tools, customers, records and invoices.' },
        { title: 'Property zoning', text: 'The later shop requires municipal, noise, access, ventilation, cylinder, wastewater and insurer review.' },
        { title: 'Capacity ceiling', text: 'Work is accepted only when it fits the owner\'s rest, employment schedule, access and completion capacity.' }
      ],
      milestonesTitle: 'Launch gates and first 24 months',
      milestonesIntro: 'Administration and safe process come before equipment expansion.',
      milestones: [
        { code: 'G0', title: 'Readiness', evidence: 'Trade school complete, practical hours underway, safe core processes and no employer conflict.' },
        { code: 'G1', title: 'Legal and insurance', evidence: 'DBA and CRA operating name, bank/invoice system, insurance binders and documented WSIB position.' },
        { code: 'G2', title: 'Demand', evidence: 'At least 10 paid jobs, three repeat or referral customers and positive job-cost contribution.' },
        { code: 'G3', title: 'Repeatability', evidence: 'Estimate variance below 20%, rework below 3% of revenue and collections under 30 days.' },
        { code: 'G4', title: 'Property', evidence: 'Homestead, zoning, electrical capacity, fire access and property insurance confirmed.' },
        { code: 'G5', title: 'Expansion', evidence: 'A specific used machine has a 24-month payback on signed or repeated demand.' }
      ],
      galleryTitle: 'Fabrication visual system',
      galleryIntro: 'Imagery emphasizes controlled hot work, practical repair, measurable fit-up and small-shop craftsmanship.',
      gallery: [fabricationShowcase, fabricationRepair, fabricationCustom, fabricationWelding],
      planningNote:
        'Public service booking is not yet open. Scope, rates, insurance, WSIB position, municipality and classification will be revalidated before the targeted 2029 launch.'
    }
  },
  {
    slug: '3d-lab',
    shortName: '3D Lab',
    overview: {
      id: '3d-lab',
      theme: 'tech',
      name: 'Fluxology 3D Lab',
      status: 'Target 2029-2030 · Internal capability may precede public launch',
      classification:
        '541420 is the provisional service code when industrial design and modelling lead this line. If production of goods becomes dominant, classification follows the manufactured product rather than the printer itself.',
      description:
        'A compact scan-to-solution capability paired with Fabrication & Welding - not a speculative print farm. Its primary value is reducing measurement error, creating jigs, restoring unavailable parts and building reusable digital records; selective external work follows proven demand.',
      facts: [
        { label: 'Portfolio role', value: 'Fabrication force multiplier' },
        { label: 'Starting system', value: 'One reliable enclosed FDM printer' },
        { label: 'Expansion rule', value: 'One validated process at a time' }
      ],
      servicesTitle: 'Local problem-solving, not commodity printer time',
      servicesIntro:
        'The advantage comes from physical access, measurement, material judgement and integration with metalwork - the parts of a project that cannot be reduced to uploading a file to a global print bureau.',
      services: [
        {
          icon: '📐',
          title: '3D Scanning',
          meta: 'Demand-gated capability',
          description: 'Capture irregular geometry and establish a digital reference when manual measurement is slow or incomplete.',
          image: labScanning
        },
        {
          icon: '🧩',
          title: 'CAD & Model Cleanup',
          meta: 'Core digital work',
          description: 'Convert scans, sketches and measurements into cleaned, dimensioned and manufacturable model revisions.'
        },
        {
          icon: '🖨️',
          title: 'FDM Printing',
          meta: 'Starter production process',
          description: 'Produce prototypes, fit checks, jigs, fixtures, covers and low-volume functional parts with documented material intent.',
          image: labPrinting
        },
        {
          icon: '🔩',
          title: 'Fit-up & Reverse Modelling',
          meta: 'Hybrid fabrication service',
          description: 'Combine physical measurement, digital geometry and fabrication judgement for replacement or hybrid metal-polymer solutions.'
        }
      ],
      processTitle: 'Scan-to-solution with clear handoffs',
      processIntro:
        'The line sells a verified problem-solving process. Visual models, fit-check prototypes and functional end-use parts are explicitly distinguished.',
      processSteps: [
        { title: 'Define', description: 'Record intended use, loads, environment, failure mode and customer permission.' },
        { title: 'Capture', description: 'Use photographs, manual measurements and scanning only where it adds useful geometry.' },
        { title: 'Model', description: 'Clean or rebuild geometry, set datums and tolerances, and retain a revision record.' },
        { title: 'Prototype', description: 'Produce a low-cost test piece, verify fit and obtain customer approval.' },
        { title: 'Release', description: 'Deliver the print, fabrication drawing or hybrid solution with final inspection records.' }
      ],
      boundary: {
        title: 'Verified intended use before functional claims',
        description:
          'Material, temperature, UV, chemical exposure, tolerance, load and failure consequence determine whether a printed part is appropriate. Fluxology does not present modelling work as licensed engineering or make unverified safety-critical claims.'
      },
      sectionBackground: labWireframeBackgroundImg,
      showcaseImages: [labShowcase],
      ctaText: 'Explore the Full 3D Lab Plan',
      ctaNote: 'Detailed scan workflow, equipment ladder, data controls and validation gates',
      detailHref: '/3d-lab/'
    },
    detail: {
      pageTitle: 'Fluxology 3D Lab | Scan-to-Solution Operating Plan',
      metaDescription:
        'Detailed plan for Fluxology 3D Lab: scanning, CAD cleanup, FDM printing, reverse modelling, equipment gates, quality controls and milestones.',
      heroImage: labShowcase,
      roleEyebrow: 'Strategic position',
      roleTitle: 'A force multiplier for local repair and fabrication',
      roleParagraphs: [
        'The 3D Lab earns modest direct revenue, but its larger value is making Fabrication & Welding more capable. It can capture irregular geometry, produce jigs and fit checks, restore unavailable components and preserve customer-approved models for repeat work.',
        'Commodity online printing is not the target. A decorative print competes globally; a replacement cover that fits a local machine, a weld fixture derived from site measurement or a hybrid repair delivered quickly has a defensible local advantage.'
      ],
      rolePoints: [
        { title: 'Internal utility first', text: 'The first printer must save fabrication time or outsourcing cost before the DBA needs separate marketing.' },
        { title: 'Reusable digital assets', text: 'Source scans, cleaned geometry, revisions and release files make repeat work faster and more reliable.' },
        { title: 'Local measurement advantage', text: 'On-site capture and fabrication judgement differentiate the offer from commodity print services.' },
        { title: 'No print-farm model', text: 'A second printer, scanner or resin process is added only when queue, capture or material evidence justifies it.' }
      ],
      offer: {
        eyebrow: 'Technical service portfolio',
        title: 'The output may be a model, prototype, print, drawing or hybrid repair',
        intro: 'Every project begins by identifying the real physical problem and the consequence of failure.',
        headers: ['Capability', 'Customer outcome', 'Commercial form', 'Strategic value'],
        rows: [
          ['3D scanning', 'Irregular geometry captured as a digital reference', 'Setup plus capture time', 'Enables repair and replacement work'],
          ['CAD and model cleanup', 'Scans, sketches or dimensions become manufacturable geometry', 'Hourly or fixed project', 'Creates reusable digital assets'],
          ['FDM printing', 'Prototypes, jigs, fixtures, covers and low-volume parts', 'Project minimum plus material and machine occupancy', 'Low capital and fast iteration'],
          ['Fit-up and reverse modelling', 'Measurement, scan data and fabrication judgement are combined', 'Project quote', 'Differentiates the welding line'],
          ['Digital archive', 'Customer-approved models and revision history remain reproducible', 'Included or defined retention arrangement', 'Supports repeat orders']
        ]
      },
      capital: {
        eyebrow: 'Equipment ladder',
        title: 'One machine at a time',
        intro: 'Used or refurbished equipment is valuable only when mechanical condition, electronics, software licensing, serviceability and parts support can be verified.',
        headers: ['Phase', 'Equipment', 'Planning envelope', 'Purchase gate'],
        rows: [
          ['Starter', 'Enclosed FDM printer, dryer, basic filament, calipers, inserts and finishing tools', '$1.2k-$1.8k', 'Internal fabrication use plus first paid demand'],
          ['Scan capability', 'Used or refurbished handheld scanner, targets, turntable and controlled lighting', '$700-$1.4k', 'Five jobs where scanning would reduce time or enable work'],
          ['Quality upgrade', 'Surface plate, better metrology, ventilation and material storage', '$500-$1.2k', 'Repeat tolerance-sensitive work'],
          ['Optional second process', 'Second FDM printer or resin system', '$700-$1.8k', 'Queue delay or recurring material/resolution need']
        ]
      },
      controlsTitle: 'Quality, files, privacy and intellectual property',
      controlsIntro: 'The digital record can be more valuable than the physical print, so the release process needs explicit ownership and verification.',
      controls: [
        { title: 'Measurement record', text: 'Tool, verification date, datum scheme, tolerance assumptions and relevant conditions are preserved.' },
        { title: 'File versioning', text: 'Immutable project IDs link source scans, cleaned meshes, CAD revisions, slicer profiles and release files.' },
        { title: 'Customer IP', text: 'Ownership, backup retention and repeat-production permission are stated rather than assumed.' },
        { title: 'Intended-use class', text: 'Visual model, fit-check prototype and functional end-use part are labelled distinctly.' },
        { title: 'Material and process', text: 'Temperature, UV, chemical exposure, load and failure consequence are checked before suitability claims.' },
        { title: 'Data retention', text: 'Access is restricted and deletion or archival periods are defined to avoid indefinite, unmanaged storage.' }
      ],
      milestonesTitle: 'Validation gates and stop conditions',
      milestonesIntro: 'The commercial risk is less the printer than unpaid cleanup and poorly defined customer expectations.',
      milestones: [
        { code: 'M1', title: 'Internal utility', evidence: 'At least five fabrication jobs save measurable time or outsourced cost.' },
        { code: 'M2', title: 'Paid validation', evidence: 'Ten external jobs show positive contribution after modelling time.' },
        { code: 'M3', title: 'Scanning gate', evidence: 'Five lost or inefficient jobs are specifically attributable to missing scan capability.' },
        { code: 'M4', title: 'Repeatability', evidence: 'Three repeat customers and a documented QA and file-release process.' },
        { code: 'STOP', title: 'Simplify if needed', evidence: 'If cleanup remains unbillable or external revenue stays below fixed cost for two years, keep the tools internal.' }
      ],
      galleryTitle: 'Digital fabrication visual system',
      galleryIntro: 'The page uses the Lab image set for scanning, printing and the dark wireframe production environment.',
      gallery: [labShowcase, labScanning, labPrinting],
      planningNote:
        'The 3D Lab may begin as an internal Fluxology capability. The operating name will be registered only before separate public marketing or invoicing.'
    }
  },
  {
    slug: 'greenhouse',
    shortName: 'Greenhouse',
    overview: {
      id: 'greenhouse',
      theme: 'natural',
      particleVariant: 'mist',
      name: 'Fluxology Greenhouse',
      status: 'Post-property · Base case begins with the 2032 growing season',
      classification:
        '111419 is a secondary code candidate only when a real covered-crop sales activity exists. Household production alone does not justify a public DBA, commercial revenue claim or farm-property assumption.',
      description:
        'A small, modular protected-growing system built for household food security, season extension, preservation and propagation. Corporate sales begin only when the homestead exists, recurring surplus remains after household commitments, and simple local channels fit the one-person workload.',
      facts: [
        { label: 'Primary return', value: 'Food not purchased, stored nutrition and site knowledge' },
        { label: 'Starting system', value: 'Repairable tunnel or hoop structure with manual fallback' },
        { label: 'Sales rule', value: 'Only genuine surplus after household allocation' }
      ],
      servicesTitle: 'Growing-system priorities',
      servicesIntro:
        'Crop planning follows household value and labour fit, not theoretical market price. Experimental crops remain separately recorded and carry no base-case sales promise.',
      services: [
        {
          icon: '🥬',
          title: 'Household Staples',
          meta: 'Priority 1 · Fresh use + storage',
          description: 'High-consumption vegetables, herbs and other crops with strong quality, nutrition or preservation value.',
          image: greenhouseServiceImages[0]
        },
        {
          icon: '🌤️',
          title: 'Season Extension',
          meta: 'Priority 2 · Early, late and winter harvest',
          description: 'Greens, herbs and protected crops that extend useful harvest windows without forcing commercial winter production.',
          image: greenhouseServiceImages[1]
        },
        {
          icon: '🌱',
          title: 'Propagation & Starts',
          meta: 'Priority 3 · Homestead support',
          description: 'Vegetable transplants, herbs and perennial starts for outdoor beds and the orchard understory.',
          image: greenhouseServiceImages[2]
        },
        {
          icon: '🧪',
          title: 'Preservation & Trial Crops',
          meta: 'Priority 4-5 · Separate records',
          description: 'Crops suited to drying, freezing, fermenting or canning, plus contained research-scale protected-growing trials.',
          image: greenhouseServiceImages[3]
        }
      ],
      processTitle: 'Subsistence-first harvest allocation',
      processIntro: 'A sales target never overrides fresh food, winter stores, propagation stock or a reasonable loss reserve.',
      processSteps: [
        { title: 'Measure harvest', description: 'Record crop, grade, timing and expected storage life.' },
        { title: 'Allocate household use', description: 'Reserve fresh consumption, preservation targets and winter stores.' },
        { title: 'Reserve resilience', description: 'Set aside seed, propagation stock, loss allowance, gifts and barter.' },
        { title: 'Apply surplus gate', description: 'Only the quantity remaining after those commitments is available for sale.' },
        { title: 'Use simple channels', description: 'Prefer pre-order pickup or controlled local sale with minimal packaging.' }
      ],
      boundary: {
        title: 'Automation supports the grower; it does not become fragile life support',
        description:
          'Sensing and alerts come first, irrigation actuation second, and optimization last. Manual hose, valve, vent and crop-cover fallbacks remain available, while heating is added only when crop value and household energy resilience justify it.'
      },
      showcaseImages: greenhouseShowcase,
      ctaText: 'Explore the Full Greenhouse Plan',
      ctaNote: 'Detailed crop priorities, physical systems, allocation rules and readiness gates',
      detailHref: '/greenhouse/'
    },
    detail: {
      pageTitle: 'Fluxology Greenhouse | Subsistence-First Growing Plan',
      metaDescription:
        'Detailed plan for Fluxology Greenhouse: household-first crops, season extension, modular infrastructure, harvest allocation, surplus channels and milestones.',
      heroImage: greenhouseShowcase[0],
      roleEyebrow: 'Operating doctrine',
      roleTitle: 'Food security first, sales second',
      roleParagraphs: [
        'The greenhouse is evaluated as homestead infrastructure before it is evaluated as a business line. Its first returns are groceries not purchased, nutrition, season extension, preserved food, propagation capacity and practical knowledge of the property.',
        'A crop becomes available for commercial sale only after expected fresh consumption, preservation and winter-storage targets, seed or propagation stock and a reasonable loss reserve are satisfied. Only actual arm\'s-length sales belong in corporate revenue.'
      ],
      rolePoints: [
        { title: 'Household staples first', text: 'Crop choices begin with consumption, nutrition, quality and preservation value.' },
        { title: 'Small repeatable crop families', text: 'Constrained diversity simplifies seeding, irrigation, trellising, scouting and harvest.' },
        { title: 'Experiments stay separate', text: 'Specialty or high-energy trials use distinct beds and records with no base-case revenue.' },
        { title: 'Surplus is an outcome', text: 'Sales happen only after food, storage, propagation and resilience targets are physically reserved.' }
      ],
      offer: {
        eyebrow: 'Crop system',
        title: 'Priorities for one person and one household',
        intro: 'The highest market-price crop is not automatically the best protected-space crop.',
        headers: ['Priority', 'Crop role', 'Examples', 'Surplus posture'],
        rows: [
          ['1 · Household staples', 'High-consumption produce with a strong quality benefit', 'Tomatoes, peppers, cucumbers, greens and herbs', 'Moderate; only after preservation target'],
          ['2 · Season extension', 'Early, late and winter harvest', 'Spinach, kale, lettuce, Asian greens and herbs', 'Small but potentially frequent'],
          ['3 · Propagation', 'Starts for outdoor beds and orchard understory', 'Vegetable transplants, herbs and perennial starts', 'Live plants are a separate taxable product class'],
          ['4 · Storage and preservation', 'Crops suitable for canning, drying, freezing or fermenting', 'Tomatoes, peppers and herbs', 'Only after processing capacity is reserved'],
          ['5 · Experimental', 'Higher-energy or climate-sensitive research', 'Specialty varieties and contained growing trials', 'Research scale; no base-case revenue']
        ]
      },
      capital: {
        eyebrow: 'Physical system and capital',
        title: 'Small, modular, repairable and manually recoverable',
        intro: 'The first structure follows at least one season of site observation and shares water, access and monitoring plans with the wider homestead.',
        headers: ['System', 'Used or DIY strategy', 'Planning range', 'Business trigger'],
        rows: [
          ['Structure', 'Used hoops, locally fabricated frame and verifiable surplus film', '$400-$1.2k', 'Property and site observation complete'],
          ['Irrigation', 'Common fittings, drip lines, filters, valves and manual bypass', '$250-$700', 'Water source and crop layout known'],
          ['Environmental sensing', 'Existing homestead network, durable sensors and alerting', '$150-$500', 'After the shell is stable'],
          ['Growing and trellis', 'Reusable beds, benches, containers and trellis', '$300-$900', 'Crop plan validated'],
          ['Harvest and storage', 'Washable totes, scale, labels, shelving and cold-storage allocation', '$250-$700', 'Recurring surplus sales'],
          ['Contingency', 'Film repair, pest exclusion, pumps and crop-loss reserve', '$200-$500', 'Held as cash and parts']
        ]
      },
      controlsTitle: 'One-person growing and sales controls',
      controlsIntro: 'The base case avoids permanently heated commercial production, complex life-support automation and volume promises.',
      controls: [
        { title: 'Observe the site first', text: 'Sun, wind, snow drifting, drainage and frost are watched before the protected area is fixed.' },
        { title: 'Manual fallback', text: 'Hose, hand valve, roll-up vent and crop cover remain usable if sensors, actuators or power fail.' },
        { title: 'Household allocation records', text: 'Harvest weight, fresh use, preserved inventory, seed and loss reserve are documented before sales.' },
        { title: 'Simple local channels', text: 'Pre-order pickup and capped neighbour baskets fit the workload better than guaranteed volume.' },
        { title: 'No assumed tax benefit', text: 'Farm-property treatment requires real eligibility and does not extend to general welding or 3D areas.' },
        { title: 'Seasonal capacity', text: 'Peak watering, harvest and preservation orders are capped when trade work or orchard labour also peaks.' }
      ],
      milestonesTitle: 'Reliability, surplus and farm-program readiness',
      milestonesIntro: 'The greenhouse can be useful without becoming a large commercial operation.',
      milestones: [
        { code: 'H1', title: 'Household reliability', evidence: 'Two seasons meet defined household fresh and preservation targets.' },
        { code: 'H2', title: 'Surplus validation', evidence: 'At least ten documented surplus transactions occur without reducing household allocation.' },
        { code: 'H3', title: 'Accounting separation', evidence: 'Crop, sale and expense records are reviewed; personal-use treatment is documented.' },
        { code: 'H4', title: 'Farm tax review', evidence: 'Farmland assessment, FBR or exemption eligibility and ownership structure are reviewed before application.' },
        { code: 'H5', title: 'Market expansion', evidence: 'Recurring surplus, low spoilage and customer demand justify only modest additional protected area.' }
      ],
      galleryTitle: 'Protected-growing visual system',
      galleryIntro: 'The image set covers the working greenhouse, crop diversity and longer-horizon protected-crop concepts without converting those concepts into sales promises.',
      gallery: [...greenhouseShowcase, ...greenhouseServiceImages],
      planningNote:
        'The Greenhouse operating name remains unregistered during household-only production. Public branding begins only when recurring surplus sales and the required records justify a separate line.'
    }
  },
  {
    slug: 'orchard',
    shortName: 'Orchard & Food Forest',
    overview: {
      id: 'orchard',
      theme: 'natural',
      particleVariant: 'leaf',
      name: 'Fluxology Orchard & Food Forest',
      status: 'Post-property · Public launch follows biological maturity and recurring surplus',
      classification:
        '111330 is a secondary orchard code when fruit and tree-nut sales become a real activity. It remains subordinate to the trade-led corporate classification and applies only according to actual revenue and use.',
      description:
        'A slow, site-specific perennial system planted for household nutrition, preservation, shade, water management, pollinators and land resilience. Trees and supporting layers are established in small cohorts; sales remain a secondary consequence after survival and maturity.',
      facts: [
        { label: 'Primary return', value: 'Household food, resilience and land improvement' },
        { label: 'Initial cohort', value: '12-25 trees plus berries and support plants' },
        { label: 'Expansion gate', value: 'More than 85% survival through winter and summer' }
      ],
      servicesTitle: 'A functional perennial system',
      servicesIntro:
        'A food forest label is earned by function. Canopy, shrubs, groundcover, pollinator habitat and propagation areas are included only where the owner can prune, protect, harvest and maintain them.',
      services: [
        {
          icon: '🍎',
          title: 'Site-Led Fruit Trees',
          meta: 'Small annual cohorts',
          description: 'Cultivars and rootstocks selected for household use, storage, climate, disease pressure and accessible harvest.',
          image: orchardServiceImages[0]
        },
        {
          icon: '🌰',
          title: 'Nut & Resilience Crops',
          meta: 'Diverse harvest windows',
          description: 'Tree and shrub choices that spread risk, add storage food and avoid a single pest or frost eliminating the year.',
          image: orchardServiceImages[1]
        },
        {
          icon: '🌿',
          title: 'Perennial Understory',
          meta: 'Every layer has a job',
          description: 'Berries, perennial foods, biomass plants, pollinator habitat and groundcovers selected for defined functions.',
          image: orchardServiceImages[2]
        },
        {
          icon: '🌳',
          title: 'Food Forest Integration',
          meta: 'Water + access + maintenance',
          description: 'Ecological layers arranged around practical irrigation, protection, harvest paths, equipment access and workload.',
          image: orchardServiceImages[3]
        }
      ],
      processTitle: 'Perennial establishment: survival before sales',
      processIntro: 'Biological feedback is slow, so design mistakes are controlled through observation, small cohorts and explicit stop conditions.',
      processSteps: [
        { title: 'Read the site', description: 'Observe sun, frost pockets, drainage, wind, wildlife, soil and access for a full season.' },
        { title: 'Prepare water & soil', description: 'Use testing, mulch, irrigation and only site-appropriate water-spreading earthworks.' },
        { title: 'Plant framework', description: 'Establish windbreaks, canopy trees, berries, pollinator strips and functional groundcovers.' },
        { title: 'Protect & train', description: 'Install guards, stake and prune, scout disease and retain replacement stock.' },
        { title: 'Allocate harvest', description: 'Reserve household use, storage and propagation before identifying genuine surplus.' }
      ],
      boundary: {
        title: 'Density never exceeds maintenance capacity',
        description:
          'The plan pauses expansion when mortality, wildlife damage, disease pressure or owner-hour burden remains high. Infrastructure and variety fit are corrected before more plants are added.'
      },
      showcaseImages: orchardShowcase,
      ctaText: 'Explore the Full Orchard Plan',
      ctaNote: 'Detailed site criteria, planting capital, harvest allocation and survival gates',
      detailHref: '/orchard/'
    },
    detail: {
      pageTitle: 'Fluxology Orchard & Food Forest | Perennial Establishment Plan',
      metaDescription:
        'Detailed plan for Fluxology Orchard & Food Forest: site reading, phased planting, water and access, harvest allocation, capital and survival milestones.',
      heroImage: orchardShowcase[0],
      roleEyebrow: 'Strategic role',
      roleTitle: 'Land improvement first, revenue last',
      roleParagraphs: [
        'The orchard has the longest biological lead time and the least aggressive revenue forecast in the portfolio. Its primary return is household food, long-term resilience and a better-functioning property rather than near-term cash flow.',
        'Early planting is still rational because trees compound slowly, but the planting remains deliberately small. Each annual cohort tests winter survival, wildlife protection, irrigation and disease pressure before the system is expanded.'
      ],
      rolePoints: [
        { title: 'One full site year', text: 'Sun, wind, cold-air drainage, water, wildlife and access are observed before the first permanent layout.' },
        { title: 'Plant in cohorts', text: 'Small trees, local cultivars, propagation and standardized protection reduce capital and replacement risk.' },
        { title: 'Preservation before customers', text: 'Storage and processing capacity grows before customer commitments create a harvest-time conflict.' },
        { title: 'Function before density', text: 'Every plant layer must improve food, biomass, pollination, water, habitat or maintenance efficiency.' }
      ],
      offer: {
        eyebrow: 'Site and varieties',
        title: 'The first design task is understanding the land',
        intro: 'Cultivar catalogues come after the property\'s physical limits and the household\'s actual use are known.',
        headers: ['Decision', 'Evaluation criteria'],
        rows: [
          ['Location', 'Sun hours, slope, cold-air drainage, soil depth, drainage, water access, wind, wildlife pressure and equipment access'],
          ['Species mix', 'Household consumption, storage life, preservation, pollination, disease susceptibility, bearing age and harvest spread'],
          ['Rootstock and form', 'Cold hardiness, soil fit, anchorage, mature size, pruning access and lifespan'],
          ['Redundancy', 'Multiple cultivars and harvest windows to avoid one pest, frost or storage failure eliminating the year'],
          ['Labour', 'Staggered pruning and harvest with forms reachable without specialized commercial equipment'],
          ['Market fit', 'Considered only after household needs: local familiarity, storage, visual quality and direct-sale demand']
        ]
      },
      capital: {
        eyebrow: 'Establishment capital',
        title: 'Plant in cohorts and propagate',
        intro: 'The largest savings come from small stock, local scionwood, shared irrigation, standardized guards and avoiding speculative plant orders.',
        headers: ['Use', 'Planning range', 'Low-cost strategy'],
        rows: [
          ['Initial trees and shrubs', '$500-$1.2k', 'Bare-root or small stock, local disease-resistant cultivars and annual cohorts'],
          ['Tree guards and fencing', '$300-$900', 'Standardized reusable guards focused on highest-risk zones'],
          ['Irrigation', '$250-$700', 'Shared greenhouse main line, simple zone valves and drip'],
          ['Mulch and soil amendments', '$150-$500', 'Safe on-site biomass and soil-test-driven amendments'],
          ['Propagation and nursery', '$150-$450', 'Rooting beds, grafting materials, labels and protected holding area'],
          ['Replacement reserve', '$150-$350', 'Assume mortality and replant deliberately']
        ]
      },
      controlsTitle: 'Biological, water and workload controls',
      controlsIntro: 'Low annual cash burn does not make the system low-risk; biological mistakes can take years to become visible.',
      controls: [
        { title: 'Site-specific water design', text: 'Swales are used only where slope, infiltration, groundwater and overflow make them appropriate.' },
        { title: 'Wildlife protection', text: 'Perimeter strategy, guards, netting and access are designed before valuable planting expands.' },
        { title: 'Cohort survival gate', text: 'Expansion follows more than 85% survival through the first winter and summer, with failures diagnosed.' },
        { title: 'Harvest access', text: 'Paths, shade, washable totes and propagation areas are integrated with greenhouse and maintenance routes.' },
        { title: 'Preservation capacity', text: 'Fresh use, cold storage, freezing, drying or permitted processing are reserved before surplus routes.' },
        { title: 'Planting records', text: 'Maps, cultivars, rootstocks, invoices, losses, yields, allocation and sales remain traceable.' }
      ],
      milestonesTitle: 'Establishment milestones and stop conditions',
      milestonesIntro: 'The first commercial milestone is evidence of reliable household surplus without heroic labour.',
      milestones: [
        { code: 'O1', title: 'Site year', evidence: 'At least one full season of sun, drainage, wind, wildlife and frost observation.' },
        { code: 'O2', title: 'First cohort', evidence: 'A small planting is installed with irrigation, protection, labels and a map.' },
        { code: 'O3', title: 'Survival', evidence: 'More than 85% survives winter and the first summer; failures are diagnosed.' },
        { code: 'O4', title: 'Household harvest', evidence: 'Early-bearing berries and trees produce a reliable harvest with preservation capacity.' },
        { code: 'O5', title: 'Surplus sales', evidence: 'Recurring surplus remains after storage targets, with low spoilage and manageable labour.' },
        { code: 'STOP', title: 'Pause and redesign', evidence: 'If mortality, wildlife damage or owner-hour burden stays high, correct infrastructure before planting more.' }
      ],
      galleryTitle: 'Perennial-system visual study',
      galleryIntro: 'The orchard set shows canopy, understory, paths and plant diversity as an integrated working system rather than isolated tree rows.',
      gallery: [...orchardShowcase, ...orchardServiceImages],
      planningNote:
        'The Orchard & Food Forest operating name remains a cost-centre or establishment project until recurring harvest and sales make public commercial branding meaningful.'
    }
  }
];

export const dbaOverviews = dbaPlans.map((plan) => plan.overview);

export function getDbaPlan(slug: string) {
  return dbaPlans.find((plan) => plan.slug === slug);
}
