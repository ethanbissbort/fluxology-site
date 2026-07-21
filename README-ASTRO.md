# Fluxology Inc. Website (Astro + Svelte)

**Version 2.0** - High-performance static site with modern stack

A blazingly fast, single-page scrollable website showcasing Fluxology Inc.'s diverse business divisions with smooth theme transitions and optimized performance.

## 🚀 Technology Stack

- **[Astro 4.x](https://astro.build)** - Static site generator with zero JavaScript by default
- **[Svelte 4.x](https://svelte.dev)** - Reactive UI components (hydrated on demand)
- **[Vite 5.x](https://vitejs.dev)** - Lightning-fast build tool
- **[Sharp](https://sharp.pixelplumbing.com)** - High-performance image optimization
- **Variable Fonts** - Self-hosted for optimal performance

## ⚡ Performance Metrics

**Achieved:**
- ✅ JavaScript Bundle: **~10KB** gzipped (target: <50KB)
- ✅ Build Time: **< 2 seconds**
- ✅ Zero JavaScript for static content
- ✅ Progressive hydration for interactive components

**Lighthouse Targets:**
- Performance: 95+
- Accessibility: 95+
- Best Practices: 95+
- SEO: 95+

**Core Web Vitals Targets:**
- First Contentful Paint (FCP): <500ms
- Largest Contentful Paint (LCP): <1500ms
- Time to Interactive (TTI): <1000ms
- Cumulative Layout Shift (CLS): <0.05

## 📁 Project Structure

```
fluxology-site/
├── public/
│   ├── fonts/                    # Variable font files (.woff2)
│   ├── images/                   # Optimized images (AVIF, WebP, JPG)
│   └── service-worker.js         # PWA service worker
├── src/
│   ├── components/
│   │   ├── Navigation.astro      # Fixed navigation
│   │   ├── Hero.astro            # Hero section
│   │   ├── About.astro           # About section
│   │   ├── DBASection.astro      # Reusable DBA template
│   │   ├── Footer.astro          # Footer
│   │   ├── ScrollProgress.svelte # Scroll progress bar (Svelte)
│   │   ├── ThemeTransition.svelte # Theme manager (Svelte)
│   │   ├── ParticleSystem.svelte # Particle animations (Svelte)
│   │   ├── ContactForm.svelte    # Contact form (Svelte)
│   │   ├── NavigationMenu.svelte # Mobile menu logic (Svelte)
│   │   └── BackToTop.svelte      # Back to top button (Svelte)
│   ├── layouts/
│   │   └── BaseLayout.astro      # Main HTML wrapper
│   ├── pages/
│   │   └── index.astro           # Main page
│   └── styles/
│       ├── reset.css             # CSS reset
│       ├── variables.css         # Design tokens + variable fonts
│       ├── base.css              # Base styles
│       ├── themes.css            # Theme-specific styles
│       ├── transitions.css       # Animations
│       ├── utilities.css         # Performance utilities
│       └── responsive.css        # Media queries
├── scripts/
│   └── optimize-images.js        # Image optimization pipeline
├── astro.config.mjs              # Astro configuration
├── tsconfig.json                 # TypeScript config
└── package.json                  # Dependencies
```

## 🛠️ Setup & Development

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
# Install dependencies
npm install

# Download variable fonts (see public/fonts/README.md)
# Place .woff2 files in public/fonts/
```

### Development

```bash
# Start development server with hot reload
npm run dev

# Server runs at http://localhost:4321
```

### Production Build

```bash
# Build static site
npm run build

# Preview production build
npm run preview

# Output in dist/ folder
```

### Image Optimization

```bash
# Place source images in src/assets/raw/
# Run optimization script
npm run optimize-images

# Generates AVIF, WebP, JPG, and blur placeholders
```

## 🎨 Component Architecture

### Astro Components (Static)

Pre-rendered to HTML at build time. Zero JavaScript unless needed.

- `BaseLayout.astro` - HTML wrapper, meta tags, font preloading
- `Navigation.astro` - Navigation markup
- `Hero.astro`, `About.astro`, `Footer.astro` - Static sections
- `DBASection.astro` - Reusable template for business sections

### Svelte Components (Interactive)

Hydrated on demand using client directives:

- `client:load` - Load immediately (critical)
- `client:visible` - Load when visible (recommended for most)
- `client:idle` - Load when browser idle (non-critical)

**Components:**
- `ScrollProgress.svelte` - Scroll progress bar
- `ThemeTransition.svelte` - Intersection Observer for themes
- `ParticleSystem.svelte` - Themed particle animations
- `ContactForm.svelte` - Form with validation
- `NavigationMenu.svelte` - Mobile menu interactions
- `BackToTop.svelte` - Back to top button

## 🎯 Performance Features

### CSS Containment

```css
.section {
  content-visibility: auto;  /* Skip rendering off-screen sections */
  contain: layout style paint;  /* Contain layout calculations */
  contain-intrinsic-size: 0 100vh;  /* Estimated size */
}
```

### Variable Fonts

Self-hosted variable fonts with `font-display: swap` reduce:
- HTTP requests (1 file vs. multiple weights)
- File size (~80KB vs. ~200KB for traditional fonts)
- Layout shift (swap ensures text renders immediately)

### Image Optimization

Automated pipeline generates:
- **AVIF** - 50% smaller than WebP (primary)
- **WebP** - 30% smaller than JPG (fallback)
- **JPG** - Progressive, optimized (legacy fallback)
- **Blur placeholders** - Base64 for instant load

### Service Worker

- Caches critical assets (fonts, CSS)
- Offline support
- Runtime caching for visited pages
- Background sync ready

## 🌈 Theme System

Four distinct themes with smooth CSS transitions (800ms):

1. **Corporate** - Hero, About, Contact (Navy/Blue)
2. **Industrial** - Fabrication & Welding (Charcoal/Orange)
3. **Tech** - 3D Lab (Black/Cyan/Magenta)
4. **Natural** - Greenhouse & Orchard (Green/Terracotta)

Themes transition automatically using Intersection Observer when scrolling.

## ♿ Accessibility Features

- ✅ Semantic HTML5 structure
- ✅ ARIA labels and landmarks
- ✅ Keyboard navigation
- ✅ Skip-to-content link
- ✅ Focus states (WCAG AA compliant)
- ✅ Color contrast (WCAG AA: 4.5:1 normal, 3:1 large text)
- ✅ Alt text for images
- ✅ `prefers-reduced-motion` support
- ✅ Screen reader tested (NVDA/VoiceOver)

## 📱 Responsive Design

Mobile-first with optimizations:

**Breakpoints:**
- Mobile: 320px - 767px
- Tablet: 768px - 1023px
- Desktop: 1024px - 1439px
- Large: 1440px+

**Mobile Optimizations:**
- Fewer particles (8 vs. 15)
- Simplified animations
- Touch-friendly (44px minimum tap targets)
- Hamburger navigation

## 🚢 Deployment

### Build Output

```bash
npm run build
```

**Output:** `dist/` folder contains:
- Static HTML files
- Minified JavaScript bundles
- Optimized CSS
- Service worker
- Font files

### Deploy to Hosting

**Recommended Hosts:**
- **Netlify** - Zero config, auto-deploy from Git
- **Vercel** - Optimized for static sites
- **Cloudflare Pages** - Global CDN included
- **GitHub Pages** - Free for public repos

**Apache/Nginx:**
- Upload `dist/` contents to web root
- Configure compression (gzip/brotli)
- Set cache headers for assets

## 🔧 Customization

### Adding a New Section

1. **Create data** in `src/pages/index.astro`:
```javascript
const newSection = {
  id: 'new-section',
  theme: 'custom',
  name: 'Section Name',
  naics: 'NAICS Code',
  description: '...',
  services: [...]
};
```

2. **Add theme** in `src/components/ThemeTransition.svelte`:
```javascript
custom: {
  bgPrimary: '#HEXCODE',
  accentPrimary: '#HEXCODE',
  // ...
}
```

3. **Add styles** in `src/styles/themes.css`

### Changing Colors

Edit `src/styles/variables.css`:
```css
--corporate-accent-blue: #NEW_COLOR;
```

All instances update automatically via CSS custom properties.

### Adding Content

Edit the `dbaSections` array in `src/pages/index.astro`.

## 📊 Bundle Analysis

**JavaScript (gzipped):**
- ContactForm: 3.97 KB
- ParticleSystem: 1.42 KB
- ThemeTransition: 1.05 KB
- Svelte Runtime: 2.59 KB
- Others: ~1.5 KB
- **Total: ~10 KB** ✅

**Comparison:**
- Previous (Vanilla): ~100 KB
- Current (Astro): ~10 KB
- **90% reduction!**

## 🐛 Troubleshooting

### Build Fails

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Fonts Not Loading

1. Check font files exist in `public/fonts/`
2. Verify font file names match `variables.css`
3. See `public/fonts/README.md` for download links

### Dev Server Issues

```bash
# Clear Astro cache
rm -rf node_modules/.astro
npm run dev
```

## 📚 Documentation

- **ASTRO-MIGRATION.md** - Migration guide and component templates
- **claude.md** - Technical documentation for AI/developers
- **public/fonts/README.md** - Font download instructions

## 🔐 Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile Safari (iOS 15+)
- Chrome Mobile (Android 11+)

## 📝 License

All rights reserved © Fluxology Inc.

## 🤝 Contributing

This is a private corporate website. Contact info@fluxology.ca for inquiries.

---

**Built with ❤️ using Astro, Svelte, and modern web standards**

**Version**: 2.0.0
**Last Updated**: November 2025
**Performance**: Enterprise-grade, production-ready
