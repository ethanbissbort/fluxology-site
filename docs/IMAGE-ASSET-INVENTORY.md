# Image asset inventory

This integration uses 28 of the 30 files supplied in `Fluxology Images - Round 2.zip`.
The production files are resized, stripped of unnecessary metadata, converted to WebP,
and stored under `public/images/` with semantic names. The resulting web payload is about
4.5 MB, down from the 70.7 MB source archive.

## Coverage by site area

| Site area | Production assets | Use | Coverage |
| --- | ---: | --- | --- |
| Corporate | 6 | Hero medallion, full-section texture, four value icons | Complete |
| Fabrication & Welding | 4 | Three service cards and one showcase | Parts Manufacturing still needs a dedicated 1:1 image |
| 3D Lab | 4 | Two service cards, one showcase, and the section texture | Rapid Prototyping and Resin Art still need dedicated 1:1 images |
| Greenhouse | 8 | Four service cards and a four-image showcase mosaic | Complete |
| Orchard & Food Forest | 6 | Four service cards and a two-image showcase | Complete |

## Remaining image gaps

1. **Parts Manufacturing** — a 1:1 image of short-run custom components, fixtures,
   or machined/fabricated parts laid out for inspection.
2. **Rapid Prototyping** — a 1:1 image showing an iteration sequence, CAD reference,
   calipers, and multiple physical prototype revisions.
3. **Resin Art** — a 1:1 image of a finished translucent resin piece with controlled
   cyan/magenta studio lighting.

The three uncovered cards intentionally use themed graphical placeholders so the current
layout remains complete without pretending that a nearby image represents the wrong service.

## Surplus or source-only files

| Source file | Status | Reason |
| --- | --- | --- |
| `ChatGPT Image Aug 2, 2026, 09_00_01 AM.png` | Excluded | Composite board duplicates the four individual transparent value icons and is less flexible in responsive layouts. |
| `fluxology-logo-options-array.png` | Excluded | Logo-development reference sheet, not a production web asset. |

The Greenhouse set contains three showcase alternatives beyond the original single showcase
slot, and the Orchard set contains one. They are not discarded: the section template now
supports responsive mosaics so these useful alternates appear without duplicating service-card
content.

## Source-to-production map

| Source filename | Production filename |
| --- | --- |
| `ChatGPT Image Aug 2, 2026, 09_27_04 AM.png` | `corporate/flux-background.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_39 AM (1).png` | `corporate/value-excellence.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_39 AM (2).png` | `corporate/value-innovation.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_39 AM (3).png` | `corporate/value-sustainability.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_39 AM (4).png` | `corporate/value-integrity.webp` |
| `fluxology-logo-candidate-6.png` | `corporate/logo-medallion.webp` |
| `ChatGPT Image Aug 2, 2026, 09_27_15 AM.png` | `fabrication/custom-fabrication.webp` |
| `ChatGPT Image Aug 2, 2026, 09_27_29 AM.png` | `fabrication/precision-welding.webp` |
| `ChatGPT Image Aug 2, 2026, 09_29_03 AM.png` | `fabrication/metal-repair.webp` |
| `ChatGPT Image Aug 2, 2026, 09_27_38 AM.png` | `fabrication/welding-showcase.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_51 AM.png` | `3d-lab/3d-printing.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_56 AM.png` | `3d-lab/3d-scanning.webp` |
| `ChatGPT Image Aug 2, 2026, 09_29_09 AM.png` | `3d-lab/lab-showcase.webp` |
| `ChatGPT Image Aug 2, 2026, 09_29_15 AM.png` | `3d-lab/wireframe-background.webp` |
| `ChatGPT Image Aug 2, 2026, 09_29_20 AM.png` | `greenhouse/ginger-production.webp` |
| `ChatGPT Image Aug 2, 2026, 09_29_24 AM.png` | `greenhouse/coffee-cultivation.webp` |
| `ChatGPT Image Aug 2, 2026, 09_29_29 AM.png` | `greenhouse/cocoa-growing.webp` |
| `ChatGPT Image Aug 2, 2026, 09_29_32 AM.png` | `greenhouse/specialty-crops.webp` |
| `ChatGPT Image Aug 2, 2026, 09_27_43 AM.png` | `greenhouse/showcase-main.webp` |
| `ChatGPT Image Aug 2, 2026, 09_27_47 AM.png` | `greenhouse/showcase-sunlit.webp` |
| `ChatGPT Image Aug 2, 2026, 09_27_53 AM.png` | `greenhouse/showcase-growing-aisle.webp` |
| `ChatGPT Image Aug 2, 2026, 09_27_56 AM.png` | `greenhouse/showcase-workspace.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_13 AM.png` | `orchard/fruit-tree-production.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_20 AM.png` | `orchard/nut-cultivation.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_25 AM.png` | `orchard/perennial-crops.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_29 AM.png` | `orchard/food-forest-systems.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_02 AM.png` | `orchard/showcase-main.webp` |
| `ChatGPT Image Aug 2, 2026, 09_28_04 AM.png` | `orchard/showcase-understory.webp` |
