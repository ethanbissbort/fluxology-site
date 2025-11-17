# Astro Migration Guide

## Migration Status: IN PROGRESS

This document tracks the migration from vanilla JavaScript to Astro + Svelte stack.

## What's Been Completed

✅ **Project Setup**
- Astro 4.x + Svelte 4.x + Vite 5.x installed
- Project structure created
- Configuration files (astro.config.mjs, tsconfig.json)
- CSS system updated with:
  - Variable font loading (@font-face with font-display: swap)
  - Performance utilities (content-visibility, CSS containment)
  - All existing styles preserved (reset, variables, base, themes, transitions, responsive)

## What Needs to Be Built

### 1. Astro Components (Static)

**src/layouts/BaseLayout.astro**
```astro
---
const { title } = Astro.props;
---
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>

  <!-- Preload critical variable fonts -->
  <link rel="preload" href="/fonts/Inter-Variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/Outfit-Variable.woff2" as="font" type="font/woff2" crossorigin>

  <!-- CSS -->
  <link rel="stylesheet" href="/src/styles/reset.css">
  <link rel="stylesheet" href="/src/styles/variables.css">
  <link rel="stylesheet" href="/src/styles/base.css">
  <link rel="stylesheet" href="/src/styles/themes.css">
  <link rel="stylesheet" href="/src/styles/transitions.css">
  <link rel="stylesheet" href="/src/styles/utilities.css">
  <link rel="stylesheet" href="/src/styles/responsive.css">
</head>
<body>
  <slot />

  <script>
    // Register service worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js');
      });
    }

    // Set current year
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
      yearElement.textContent = new Date().getFullYear().toString();
    }
  </script>
</body>
</html>
```

**src/components/Navigation.astro**
- Fixed navigation bar
- Smooth scroll anchors
- Mobile hamburger menu (behavior handled by Svelte)

**src/components/Hero.astro**
- Hero section with title and CTA buttons
- Scroll indicator

**src/components/About.astro**
- Company overview
- Values grid
- Stats cards

**src/components/DBASection.astro**
- Reusable template for all 4 DBA sections
- Props: id, theme, name, naics, description, services
- Slots: particles, showcase images

**src/components/Footer.astro**
- Footer content

### 2. Svelte Components (Interactive)

**src/components/ScrollProgress.svelte**
```svelte
<script>
  import { onMount } from 'svelte';

  let progress = 0;

  function updateProgress() {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.scrollY;
    progress = (scrollTop / (documentHeight - windowHeight)) * 100;
  }

  onMount(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateProgress();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    updateProgress();

    return () => window.removeEventListener('scroll', handleScroll);
  });
</script>

<div class="scroll-progress">
  <div class="scroll-progress-bar" style="width: {progress}%"></div>
</div>
```

**src/components/ThemeTransition.svelte**
- Intersection Observer for section detection
- CSS custom property updates for theme transitions

**src/components/ParticleSystem.svelte**
- Themed particle animations
- Props: theme (corporate|industrial|tech|natural)
- Respects prefers-reduced-motion

**src/components/ContactForm.svelte**
- Form with validation
- Error handling
- Submit logic

**src/components/NavigationMenu.svelte**
- Mobile menu toggle logic
- Active link tracking

**src/components/BackToTop.svelte**
- Back to top button with scroll threshold

### 3. Main Page

**src/pages/index.astro**
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import Navigation from '../components/Navigation.astro';
import Hero from '../components/Hero.astro';
import About from '../components/About.astro';
import DBASection from '../components/DBASection.astro';
import Footer from '../components/Footer.astro';

import ScrollProgress from '../components/ScrollProgress.svelte';
import ThemeTransition from '../components/ThemeTransition.svelte';
import ParticleSystem from '../components/ParticleSystem.svelte';
import ContactForm from '../components/ContactForm.svelte';
import NavigationMenu from '../components/NavigationMenu.svelte';
import BackToTop from '../components/BackToTop.svelte';

const dbaSections = [
  {
    id: 'fabrication',
    theme: 'industrial',
    name: 'Fluxology Fabrication & Welding',
    naics: 'NAICS 332710 - Machine Shops',
    description: 'Precision metalworking and fabrication services delivering custom solutions for industrial, commercial, and residential applications.',
    services: [
      { icon: '⚙️', title: 'Custom Fabrication', description: 'Bespoke metal fabrication tailored to your exact specifications.' },
      { icon: '🔥', title: 'Precision Welding', description: 'Expert welding services including MIG, TIG, and stick welding.' },
      { icon: '🔧', title: 'Metal Repair', description: 'Professional repair and restoration services for damaged metal components.' },
      { icon: '⚒️', title: 'Parts Manufacturing', description: 'Production of custom metal parts and components.' },
    ],
  },
  // ... other DBA sections
];
---

<BaseLayout title="Fluxology Inc. - Innovation Across Industries">
  <ScrollProgress client:load />
  <ThemeTransition client:load />
  <BackToTop client:load />

  <Navigation />
  <NavigationMenu client:load />

  <main id="main-content">
    <Hero />
    <About />

    {dbaSections.map((dba) => (
      <DBASection {...dba}>
        <ParticleSystem slot="particles" theme={dba.theme} client:visible />
      </DBASection>
    ))}

    <section id="contact" data-theme="corporate" class="section contact-section">
      <div class="container">
        <h2>Get In Touch</h2>
        <ContactForm client:visible />
      </div>
    </section>
  </main>

  <Footer />
</BaseLayout>
```

### 4. Image Optimization Script

**scripts/optimize-images.js**
```javascript
import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

const inputDir = './src/assets/raw';
const outputDir = './public/images';

async function optimizeImages() {
  const files = await fs.readdir(inputDir);

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const name = path.parse(file).name;

    // Generate AVIF (primary)
    await sharp(inputPath)
      .avif({ quality: 80, effort: 9 })
      .toFile(path.join(outputDir, `${name}.avif`));

    // Generate WebP (fallback)
    await sharp(inputPath)
      .webp({ quality: 85 })
      .toFile(path.join(outputDir, `${name}.webp`));

    // Generate JPG (legacy)
    await sharp(inputPath)
      .jpeg({ quality: 80, progressive: true })
      .toFile(path.join(outputDir, `${name}.jpg`));

    console.log(`Optimized: ${name}`);
  }
}

optimizeImages().catch(console.error);
```

### 5. Service Worker

**public/service-worker.js**
```javascript
const CACHE_NAME = 'fluxology-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/fonts/Inter-Variable.woff2',
  '/fonts/Outfit-Variable.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});
```

## Client Directives in Astro

When adding Svelte components to Astro, use these client directives:

- `client:load` - Load immediately (critical interactive elements)
- `client:visible` - Load when visible (particles, contact form)
- `client:idle` - Load when browser is idle (non-critical)

## Performance Targets

- Lighthouse Score: 95+ on all metrics
- First Contentful Paint: <500ms
- Time to Interactive: <1000ms
- Largest Contentful Paint: <1500ms
- Cumulative Layout Shift: <0.05
- JavaScript Bundle: <50KB gzipped

## Build Commands

```bash
# Development
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Optimize images
npm run optimize-images
```

## Deployment

After `npm run build`, the `dist/` folder contains the static site ready for deployment.

## Next Steps

1. Create all Astro components listed above
2. Create all Svelte components listed above
3. Implement image optimization pipeline
4. Test performance with Lighthouse
5. Update README.md with new stack information
6. Commit and push changes

## Notes

- The existing CSS system is fully compatible and has been enhanced
- Variable fonts reduce font loading from ~200KB to ~80KB
- AVIF images are ~50% smaller than WebP
- Service worker enables offline support
- Astro pre-renders everything to static HTML for maximum performance
