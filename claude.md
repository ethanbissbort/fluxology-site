# Claude Development Documentation

**Project**: Fluxology Inc. Website
**Type**: Single-page scrollable corporate website
**Version**: 1.0.0
**Last Updated**: November 2025

This document provides comprehensive technical documentation for AI assistants and developers working on the Fluxology website.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Decisions](#architecture-decisions)
3. [File Structure & Organization](#file-structure--organization)
4. [Implementation Details](#implementation-details)
5. [Performance Optimizations](#performance-optimizations)
6. [Theme System](#theme-system)
7. [Animation System](#animation-system)
8. [Common Modification Patterns](#common-modification-patterns)
9. [Testing Strategy](#testing-strategy)
10. [Future Enhancements](#future-enhancements)
11. [Troubleshooting Guide](#troubleshooting-guide)

---

## Project Overview

### Business Context

Fluxology Inc. is a Canadian Controlled Private Corporation (CCPC) operating four distinct DBAs (Doing Business As):

1. **Fluxology Fabrication & Welding** (NAICS 332710)
2. **Fluxology 3D Lab** (NAICS 541990)
3. **Fluxology Greenhouse** (NAICS 111419)
4. **Fluxology Orchard & Food Forest** (NAICS 111330)

### Design Requirements

- **Single-page scrollable layout** with smooth theme transitions
- **Distinct visual themes** for each business division
- **Performance-first approach** (60fps target)
- **Accessibility compliance** (WCAG AA minimum)
- **Mobile-first responsive design**
- **No heavy frameworks** (vanilla JavaScript)

### Key Constraints

- Bundle size under 100KB (gzipped)
- Support modern browsers (latest 2 versions)
- Graceful degradation for older browsers
- Respect user preferences (reduced motion, high contrast)

---

## Architecture Decisions

### Why Vanilla JavaScript?

**Decision**: Use vanilla JavaScript ES6+ modules instead of React, Vue, or Angular.

**Rationale**:
- **Performance**: No framework overhead (~40-100KB saved)
- **Control**: Direct DOM manipulation for 60fps animations
- **Simplicity**: Easier to maintain for a single-page site
- **Load time**: Faster initial page load
- **Learning curve**: Easier for junior developers to understand

**Trade-offs**:
- More boilerplate code for state management
- Manual DOM updates (no virtual DOM)
- More careful memory management required

### Why CSS Custom Properties?

**Decision**: Use CSS custom properties (CSS variables) for theming instead of CSS-in-JS or preprocessor variables.

**Rationale**:
- **Runtime updates**: Can be changed dynamically with JavaScript
- **Performance**: No JavaScript execution needed for initial paint
- **Smooth transitions**: Native CSS transitions between theme changes
- **Maintainability**: Single source of truth in `variables.css`
- **Browser support**: Excellent (all modern browsers)

**Implementation**:
```css
/* variables.css defines all theme colors */
--corporate-accent-blue: #3A86FF;

/* themes.css maps them to current theme */
[data-theme="corporate"] {
  --current-accent-primary: var(--corporate-accent-blue);
}

/* base.css uses current theme */
.cta-button {
  background: var(--current-accent-primary);
}
```

### Why Intersection Observer?

**Decision**: Use Intersection Observer API instead of scroll event listeners for section detection.

**Rationale**:
- **Performance**: Runs on separate thread (doesn't block main thread)
- **Efficiency**: No need for getBoundingClientRect() calculations
- **Battery life**: Better for mobile devices
- **Accuracy**: Built-in threshold detection
- **Standard**: Well-supported API (96%+ browsers)

**Implementation Pattern**:
```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // Trigger theme change
      updateTheme(entry.target.dataset.theme);
    }
  });
}, {
  rootMargin: '-20% 0px -20% 0px', // Trigger in middle 60% of viewport
  threshold: 0
});
```

### Why Modular JavaScript?

**Decision**: Split JavaScript into separate ES6 modules rather than one large file.

**Rationale**:
- **Maintainability**: Each module has single responsibility
- **Testability**: Easier to unit test individual modules
- **Code organization**: Clear separation of concerns
- **Debugging**: Easier to locate and fix bugs
- **Reusability**: Modules can be reused in future projects

**Module Breakdown**:
- `main.js` - Application initialization and lifecycle
- `scroll-controller.js` - All scroll-related behavior
- `theme-manager.js` - Theme switching logic
- `animations.js` - Particle systems and effects
- `form-handler.js` - Form validation and submission

---

## File Structure & Organization

### Directory Layout

```
fluxology-site/
├── src/                        # Source files
│   ├── index.html              # Single HTML file (semantic structure)
│   ├── styles/                 # All stylesheets (organized by concern)
│   │   ├── reset.css           # Modern CSS reset (minimal)
│   │   ├── variables.css       # Design tokens (colors, spacing, typography)
│   │   ├── base.css            # Base styles, typography, layout primitives
│   │   ├── themes.css          # Theme-specific overrides
│   │   ├── transitions.css     # Animations and transition definitions
│   │   └── responsive.css      # Media queries (mobile-first)
│   ├── scripts/                # JavaScript modules
│   │   ├── main.js             # Entry point and app initialization
│   │   ├── scroll-controller.js # Scroll behavior management
│   │   ├── theme-manager.js    # Theme transition logic
│   │   ├── animations.js       # Particle systems and animations
│   │   └── form-handler.js     # Contact form validation
│   └── assets/                 # Static assets
│       ├── images/             # Image files (to be added)
│       └── icons/              # Icon files (to be added)
├── README.md                   # User-facing documentation
├── claude.md                   # This file - AI/developer documentation
└── .gitignore                  # Git ignore rules
```

### CSS Organization Strategy

**Cascading order** (specificity increases):

1. **reset.css** - Remove browser defaults
2. **variables.css** - Define design tokens
3. **base.css** - Base styles that apply everywhere
4. **themes.css** - Theme-specific overrides
5. **transitions.css** - Animation definitions
6. **responsive.css** - Media query adjustments

**Why this order?**
- Later files can override earlier ones
- Specificity increases naturally
- Easy to find where styles are defined
- Follows "progressive enhancement" principle

### JavaScript Module Dependencies

```
main.js
├── scroll-controller.js
│   └── (no dependencies)
├── theme-manager.js
│   └── (listens to scroll-controller events)
├── animations.js
│   └── (listens to theme-manager events)
└── form-handler.js
    └── (no dependencies)
```

**Communication Pattern**: Event-driven architecture
- Modules communicate via custom events
- Loose coupling between modules
- Easy to add/remove modules

---

## Implementation Details

### 1. Scroll Controller

**File**: `src/scripts/scroll-controller.js`

**Responsibilities**:
- Monitor scroll position
- Update scroll progress bar
- Trigger theme changes
- Manage parallax effects
- Handle navigation state
- Trigger scroll-based animations

**Key Methods**:

```javascript
setupIntersectionObserver() {
  // Observes sections entering viewport
  // Triggers theme changes at 20% from top/bottom
}

handleScroll() {
  // Called via requestAnimationFrame (60fps max)
  // Updates: progress bar, nav style, parallax
}

updateParallax() {
  // Calculates parallax offset for each layer
  // Only updates elements in viewport (performance)
}
```

**Performance Considerations**:
- Uses `requestAnimationFrame` to throttle scroll events to 60fps
- Only updates parallax for visible sections
- Unobserves elements after animation triggers (memory optimization)

### 2. Theme Manager

**File**: `src/scripts/theme-manager.js`

**Responsibilities**:
- Manage theme definitions
- Apply theme changes
- Transition between themes smoothly

**Theme Definition Structure**:

```javascript
themes = {
  'corporate': {
    bgPrimary: '#1B3A4B',        // Background colors
    bgSecondary: '#2E5266',
    textPrimary: '#FFFFFF',       // Text colors
    textSecondary: '#E9ECEF',
    accentPrimary: '#3A86FF',     // Accent colors
    accentSecondary: '#A8DADC',
    fontHeading: "'Outfit', sans-serif",  // Typography
    fontBody: "'Open Sans', sans-serif"
  }
  // ... other themes
}
```

**How Theme Transitions Work**:

1. Scroll controller detects section in viewport
2. Fires `themeChange` event with theme name
3. Theme manager receives event
4. Updates CSS custom properties
5. CSS transitions handle smooth color changes (800ms)

**Why this approach?**:
- Separation of concerns (scroll ≠ theme)
- Theme manager can be used independently
- Easy to add new themes
- Centralized theme definitions

### 3. Animation Controller

**File**: `src/scripts/animations.js`

**Responsibilities**:
- Create particle systems
- Manage custom cursor (desktop)
- Handle reduced motion preferences

**Particle System Types**:

1. **Corporate Particles** (Hero, About, Contact)
   - Floating gentle particles
   - Blue accent color
   - Slow movement

2. **Industrial Sparks** (Fabrication)
   - Falling spark particles
   - Orange/red colors
   - Faster movement

3. **Tech Particles** (3D Lab)
   - Digital pulsing particles
   - Cyan/magenta colors
   - Grid-like patterns

4. **Natural Particles** (Greenhouse, Orchard)
   - Floating leaf shapes
   - Green/brown colors
   - Organic movement

**Particle Creation Pattern**:

```javascript
createParticles(containerId, count) {
  const container = document.getElementById(containerId);

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';

    // Random properties
    const size = Math.random() * 4 + 2;
    const duration = Math.random() * 4 + 4;
    const delay = Math.random() * 5;

    // CSS custom properties for animation
    particle.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      --duration: ${duration}s;
      --delay: ${delay}s;
    `;

    container.appendChild(particle);
  }
}
```

**Why CSS animations over JavaScript?**:
- Better performance (GPU accelerated)
- Runs on compositor thread
- Respects prefers-reduced-motion automatically
- Easier to maintain

**Mobile Optimization**:
```javascript
const count = this.isMobile ? 8 : 15; // Fewer particles on mobile
```

### 4. Form Handler

**File**: `src/scripts/form-handler.js`

**Responsibilities**:
- Real-time form validation
- Error message display
- Form submission handling
- Loading state management

**Validation Strategy**:

```javascript
validators = {
  fullName: (value) => {
    if (!value || value.trim().length < 2) {
      return { valid: false, message: 'Please enter your full name' };
    }
    return { valid: true };
  },
  email: (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return { valid: false, message: 'Please enter a valid email' };
    }
    return { valid: true };
  }
  // ... other validators
}
```

**Validation Timing**:
- **On blur**: Validate field when user leaves it
- **On input**: Clear errors as user types
- **On submit**: Validate all fields

**Accessibility Features**:
- `aria-invalid` attribute on invalid fields
- `role="alert"` on error messages
- Focus management after submission

---

## Performance Optimizations

### Critical Rendering Path

**Strategy**: Inline critical CSS, defer non-critical resources

**Current Implementation**:
- All CSS loaded in `<head>` (small enough to be critical)
- JavaScript loaded with `type="module"` (deferred automatically)
- Google Fonts loaded with preconnect hints

**Future Optimization**:
```html
<!-- Inline critical CSS -->
<style>
  /* Critical above-the-fold styles */
</style>

<!-- Defer non-critical CSS -->
<link rel="preload" href="styles.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
```

### Animation Performance

**Hardware Acceleration**:
- Only animate `transform` and `opacity`
- Never animate `left`, `top`, `width`, `height`
- Use `translate3d()` to trigger GPU acceleration

**Example**:
```css
/* ❌ BAD - Causes layout recalculation */
.element {
  animation: slide 1s;
}
@keyframes slide {
  from { left: 0; }
  to { left: 100px; }
}

/* ✅ GOOD - GPU accelerated */
.element {
  animation: slide 1s;
}
@keyframes slide {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(100px, 0, 0); }
}
```

**Will-change Usage**:
```css
.service-card {
  will-change: transform; /* Hint browser to optimize */
}

.service-card:not(:hover) {
  will-change: auto; /* Remove hint when not needed */
}
```

### Scroll Performance

**RequestAnimationFrame Throttling**:

```javascript
setupScrollListener() {
  window.addEventListener('scroll', () => {
    this.lastScrollY = window.scrollY;

    if (!this.ticking) {
      window.requestAnimationFrame(() => {
        this.handleScroll(); // Called max 60fps
        this.ticking = false;
      });
      this.ticking = true;
    }
  }, { passive: true }); // Passive listener (performance)
}
```

**Why `passive: true`?**:
- Tells browser we won't call `preventDefault()`
- Allows browser to scroll immediately
- Improves scroll responsiveness

### Memory Management

**Observer Cleanup**:
```javascript
// Unobserve elements after animation triggers
elementObserver.observe(element);

// Later...
if (entry.isIntersecting) {
  element.classList.add('in-view');
  elementObserver.unobserve(element); // Free memory
}
```

**Destroy Methods**:
```javascript
destroy() {
  // Clean up event listeners
  // Remove DOM elements
  // Cancel animation frames
  // Unobserve all observers
}
```

### Mobile Optimizations

**Conditional Features**:
```javascript
const isMobile = window.innerWidth < 768;

if (!isMobile) {
  // Enable custom cursor (desktop only)
  this.setupCustomCursor();
}

// Reduce particle count on mobile
const particleCount = isMobile ? 8 : 15;
```

**Disable Parallax on Mobile**:
```css
@media (max-width: 767px) {
  .parallax-bg {
    transform: none !important; /* Disable for performance */
  }
}
```

---

## Theme System

### Color Palette Organization

**Four Theme Groups**:

1. **Corporate** (Hero, About, Contact)
   - Navy/slate blues
   - Clean, professional
   - High contrast

2. **Industrial** (Fabrication)
   - Charcoal/gunmetal grays
   - Orange/red accents (welding sparks)
   - Sharp, angular

3. **Tech** (3D Lab)
   - Deep blacks
   - Cyan/magenta/purple accents
   - High-tech, digital

4. **Natural** (Greenhouse, Orchard)
   - Forest greens
   - Terracotta/clay accents
   - Organic, earthy

### Typography System

**Scale**: Major Third (1.250 ratio)
```
Base: 16px (1rem)
xs:   12.8px  (0.8rem)
sm:   16px    (1rem)
md:   20px    (1.25rem)
lg:   25px    (1.563rem)
xl:   31.25px (1.953rem)
2xl:  39px    (2.441rem)
3xl:  48.8px  (3.052rem)
4xl:  61px    (3.815rem)
```

**Font Pairing Strategy**:

Each theme has 2-3 fonts:
- **Heading font**: Distinctive, attention-grabbing
- **Body font**: Readable, accessible
- **Technical/Accent font**: Optional, for special elements

**Example - Industrial Theme**:
- Headings: Rajdhani (bold, industrial feel)
- Body: Inter (clean, readable)
- Technical: JetBrains Mono (for specs/codes)

### Theme Transition Mechanics

**CSS Transition Settings**:
```css
* {
  transition-property: background-color, border-color, color;
  transition-duration: 800ms;
  transition-timing-function: cubic-bezier(0.645, 0.045, 0.355, 1);
}
```

**Why 800ms?**:
- Long enough to be smooth
- Short enough to not feel sluggish
- Matches typical scroll speed between sections

**Cubic-bezier easing**:
- `cubic-bezier(0.645, 0.045, 0.355, 1)` = ease-in-out-cubic
- Starts slow, speeds up, slows down
- Feels natural and organic

---

## Animation System

### Particle Animation Architecture

**CSS-based animations** (not JavaScript):
- Defined in `transitions.css`
- GPU accelerated
- Respects prefers-reduced-motion
- Runs even if JavaScript fails

**Keyframe Pattern**:
```css
@keyframes particle-float {
  0% {
    opacity: 0;
    transform: translate3d(var(--start-x), var(--start-y), 0) scale(0);
  }
  10% { opacity: var(--opacity); }
  90% { opacity: var(--opacity); }
  100% {
    opacity: 0;
    transform: translate3d(var(--end-x), var(--end-y), 0) scale(1);
  }
}
```

**Why CSS custom properties in keyframes?**:
- Each particle can have unique animation
- Set via JavaScript: `particle.style.setProperty('--end-x', '100px')`
- No need to generate unique keyframes

### Parallax Implementation

**Multi-layer parallax**:
```html
<section class="section">
  <div class="background-layer">
    <div class="parallax-bg" data-speed="0.5"></div>
  </div>
  <div class="content-layer">
    <!-- Content -->
  </div>
  <div class="accent-layer">
    <!-- Particles -->
  </div>
</section>
```

**Speed values**:
- `data-speed="0.3"` - Slowest (far background)
- `data-speed="0.5"` - Medium (mid background)
- `data-speed="0.7"` - Fastest (near background)
- Content layer: Speed 1.0 (moves with scroll)

**Calculation**:
```javascript
const offset = (window.innerHeight - sectionTop) * speed;
element.style.transform = `translate3d(0, ${offset}px, 0)`;
```

### Custom Cursor (Desktop)

**Implementation**:
```javascript
// Smooth cursor following
const animateCursor = () => {
  const speed = 0.2;
  cursorX += (mouseX - cursorX) * speed; // Ease towards mouse
  cursorY += (mouseY - cursorY) * speed;

  cursor.style.left = `${cursorX}px`;
  cursor.style.top = `${cursorY}px`;

  requestAnimationFrame(animateCursor);
};
```

**Why easing?**:
- Direct following feels robotic
- Easing (20% per frame) creates smooth lag
- More organic, pleasant feel

**Hover effects**:
```javascript
interactiveElement.addEventListener('mouseenter', () => {
  cursor.classList.add('hover'); // Expands cursor
});
```

---

## Common Modification Patterns

### Adding a New Business Section

**Step-by-step process**:

1. **Add HTML section** in `index.html`:
```html
<section class="section dba-section" id="new-business" data-theme="new-theme">
  <div class="background-layer">
    <div class="parallax-bg" data-speed="0.4"></div>
  </div>
  <div class="content-layer">
    <div class="container">
      <div class="dba-header">
        <h2 class="dba-name">New Business Name</h2>
        <p class="dba-naics">NAICS CODE - Industry</p>
      </div>
      <!-- ... rest of structure ... -->
    </div>
  </div>
  <div class="accent-layer" id="newBusinessParticles"></div>
</section>
```

2. **Define theme colors** in `variables.css`:
```css
/* New Theme Colors */
--new-theme-primary: #HEXCODE;
--new-theme-secondary: #HEXCODE;
--new-theme-accent: #HEXCODE;
--font-new-theme-heading: 'Font Name', sans-serif;
--font-new-theme-body: 'Font Name', sans-serif;
```

3. **Add theme mapping** in `themes.css`:
```css
[data-theme="new-theme"] {
  --current-bg-primary: var(--new-theme-primary);
  --current-bg-secondary: var(--new-theme-secondary);
  --current-text-primary: #FFFFFF;
  --current-accent-primary: var(--new-theme-accent);
  --current-font-heading: var(--font-new-theme-heading);
  --current-font-body: var(--font-new-theme-body);
}

#new-business {
  background: linear-gradient(135deg, var(--new-theme-primary) 0%, var(--new-theme-secondary) 100%);
}
```

4. **Add to theme manager** in `theme-manager.js`:
```javascript
this.themes = {
  // ... existing themes
  'new-theme': {
    bgPrimary: '#HEXCODE',
    bgSecondary: '#HEXCODE',
    textPrimary: '#FFFFFF',
    accentPrimary: '#HEXCODE',
    fontHeading: "'Font Name', sans-serif",
    fontBody: "'Font Name', sans-serif"
  }
};
```

5. **Add navigation link** in `index.html`:
```html
<li><a href="#new-business" class="nav-link">New Business</a></li>
```

6. **Create particles** in `animations.js`:
```javascript
this.createNewThemeParticles('newBusinessParticles', 15);
```

### Changing Colors

**Single color change**:
```css
/* In variables.css */
--corporate-accent-blue: #FF5733; /* Change to new color */
```

**All instances automatically update** due to CSS custom properties.

**Theme-wide color change**:
```css
/* Change all corporate theme colors */
--corporate-primary-navy: #NEW_COLOR;
--corporate-primary-slate: #NEW_COLOR;
--corporate-accent-blue: #NEW_COLOR;
```

### Updating Typography

**Change a single font**:
```css
/* In variables.css */
--font-corporate-heading: 'New Font', sans-serif;
```

**Don't forget to update Google Fonts import**:
```html
<!-- In index.html -->
<link href="https://fonts.googleapis.com/css2?family=New+Font:wght@400;600;700&display=swap" rel="stylesheet">
```

### Adding Service Cards

**Copy existing card structure**:
```html
<article class="service-card">
  <div class="service-icon">🔧</div>
  <h3 class="service-title">Service Name</h3>
  <p class="service-description">
    Service description text here.
  </p>
</article>
```

**Emoji icons vs. SVG**:
- Current: Using emoji for simplicity
- Future: Replace with SVG for better control
- Location for SVGs: `src/assets/icons/`

### Integrating Backend API

**Update form-handler.js**:
```javascript
async submitForm(data) {
  try {
    const response = await fetch('https://your-api.com/contact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add auth headers if needed
        'Authorization': 'Bearer YOUR_TOKEN'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error('Submission failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Submission error:', error);
    throw error;
  }
}
```

**Popular services**:

**Formspree**:
```javascript
const response = await fetch('https://formspree.io/f/YOUR_FORM_ID', {
  method: 'POST',
  body: formData,
  headers: { 'Accept': 'application/json' }
});
```

**EmailJS**:
```javascript
emailjs.send('service_id', 'template_id', data, 'user_id')
  .then(response => console.log('Success', response))
  .catch(error => console.error('Error', error));
```

---

## Testing Strategy

### Manual Testing Checklist

**Browser Testing**:
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS 14+)
- [ ] Chrome Mobile (Android 10+)

**Device Testing**:
- [ ] Desktop (1920x1080, 1440x900)
- [ ] Tablet (768x1024, 1024x768)
- [ ] Mobile (375x667, 414x896)
- [ ] Large desktop (2560x1440)

**Functionality Testing**:
- [ ] Scroll progress bar updates
- [ ] Theme transitions smooth
- [ ] Parallax effects work
- [ ] Particles animate
- [ ] Navigation links work
- [ ] Mobile menu toggles
- [ ] Form validation works
- [ ] Form submission works
- [ ] Back to top button appears
- [ ] Keyboard navigation works

**Performance Testing**:
- [ ] Lighthouse score > 90
- [ ] 60fps scrolling
- [ ] Time to Interactive < 3.5s
- [ ] First Contentful Paint < 1.5s
- [ ] No layout shifts (CLS < 0.1)

**Accessibility Testing**:
- [ ] Tab navigation works
- [ ] Skip to content works
- [ ] ARIA labels present
- [ ] Color contrast passes
- [ ] Screen reader test (NVDA/VoiceOver)
- [ ] Keyboard shortcuts work
- [ ] Focus states visible
- [ ] Form errors announced

**User Preference Testing**:
- [ ] Prefers-reduced-motion disables animations
- [ ] High contrast mode works
- [ ] Dark mode preference respected
- [ ] Large text scaling works

### Automated Testing Setup

**Lighthouse CI** (recommended):
```bash
npm install -g @lhci/cli

# Run Lighthouse
lhci autorun --config=lighthouserc.json
```

**Lighthouse config** (`lighthouserc.json`):
```json
{
  "ci": {
    "collect": {
      "staticDistDir": "./src"
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", {"minScore": 0.9}],
        "categories:accessibility": ["error", {"minScore": 0.9}],
        "categories:best-practices": ["error", {"minScore": 0.9}],
        "categories:seo": ["error", {"minScore": 0.9}]
      }
    }
  }
}
```

### Performance Monitoring

**Web Vitals**:
```javascript
// Add to main.js for production monitoring
import {getCLS, getFID, getFCP, getLCP, getTTFB} from 'web-vitals';

function sendToAnalytics(metric) {
  // Send to your analytics service
  console.log(metric);
}

getCLS(sendToAnalytics);
getFID(sendToAnalytics);
getFCP(sendToAnalytics);
getLCP(sendToAnalytics);
getTTFB(sendToAnalytics);
```

### Cross-browser Testing Tools

- **BrowserStack**: Test on real devices
- **LambdaTest**: Automated cross-browser testing
- **Can I Use**: Check feature support

---

## Future Enhancements

### Phase 2: E-Commerce Integration

**Recommended approach**: Shopify Buy Button

**Why Shopify?**:
- Easy integration
- Handles payments/inventory
- No backend needed
- Secure checkout

**Implementation locations** (marked in HTML):
```html
<!-- E-COMMERCE INTEGRATION: Product gallery would go here -->
<div class="dba-showcase">
  <!-- Add Shopify product cards here -->
</div>
```

**Service card → Product card**:
```html
<article class="service-card product-card">
  <img src="product.jpg" alt="Product name">
  <h3 class="product-title">Product Name</h3>
  <p class="product-price">$99.99</p>
  <button class="add-to-cart" data-product-id="123">
    Add to Cart
  </button>
</article>
```

### Phase 3: Content Management System

**Recommended**: Headless CMS approach

**Options**:
- **Contentful**: Easy API, great docs
- **Sanity**: Real-time collaboration
- **Strapi**: Open source, self-hosted

**Benefits**:
- Non-technical users can update content
- No code deployments for content changes
- Preview before publishing

**Implementation**:
```javascript
// Fetch content from CMS
async function loadContent() {
  const response = await fetch('https://cdn.contentful.com/spaces/...');
  const data = await response.json();

  // Populate sections with CMS content
  populateSections(data);
}
```

### Phase 4: Progressive Web App

**Service worker** for offline support:
```javascript
// service-worker.js
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('fluxology-v1').then((cache) => {
      return cache.addAll([
        '/',
        '/styles/base.css',
        '/scripts/main.js',
        // ... other assets
      ]);
    })
  );
});
```

**Manifest file** (`manifest.json`):
```json
{
  "name": "Fluxology Inc.",
  "short_name": "Fluxology",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1B3A4B",
  "theme_color": "#3A86FF",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

### Phase 5: Analytics & Tracking

**Google Analytics 4**:
```html
<!-- Add to <head> -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

**Custom events**:
```javascript
// Track section views
window.addEventListener('themeChange', (event) => {
  gtag('event', 'section_view', {
    'section_name': event.detail.theme
  });
});

// Track form submissions
gtag('event', 'form_submit', {
  'form_name': 'contact_form'
});
```

### Phase 6: Multi-language Support

**i18n structure**:
```javascript
const translations = {
  en: {
    'hero.title': 'Innovation Across Industries',
    'hero.description': 'A Canadian Controlled...'
  },
  fr: {
    'hero.title': 'Innovation dans tous les secteurs',
    'hero.description': 'Une société privée...'
  }
};

function t(key, lang = 'en') {
  return translations[lang][key] || key;
}
```

---

## Troubleshooting Guide

### Common Issues & Solutions

#### Issue: Theme transitions not smooth

**Symptoms**: Colors change instantly instead of smoothly

**Diagnosis**:
```javascript
// Check if CSS custom properties are updating
console.log(getComputedStyle(document.documentElement)
  .getPropertyValue('--current-accent-primary'));
```

**Solutions**:
1. Verify transition timing in `transitions.css`
2. Check theme definitions in `theme-manager.js`
3. Ensure CSS custom properties are defined in `variables.css`

**Check**:
```css
/* Should be present in transitions.css */
* {
  transition-property: background-color, border-color, color;
  transition-duration: 800ms;
}
```

#### Issue: Scroll performance is janky

**Symptoms**: Scrolling doesn't feel smooth, stutters

**Diagnosis**:
```javascript
// Check if too many elements being updated
console.log(document.querySelectorAll('[data-speed]').length);
```

**Solutions**:
1. Reduce number of particles on mobile
2. Disable parallax on mobile
3. Check for forced synchronous layouts
4. Use Chrome DevTools Performance tab

**Check**:
```javascript
// Should use requestAnimationFrame
if (!this.ticking) {
  window.requestAnimationFrame(() => {
    this.handleScroll();
    this.ticking = false;
  });
  this.ticking = true;
}
```

#### Issue: Particles not appearing

**Symptoms**: No floating particles in sections

**Diagnosis**:
```javascript
// Check if prefers-reduced-motion is enabled
console.log(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
```

**Solutions**:
1. Check if reduced motion is enabled (expected behavior)
2. Verify particle containers exist in HTML
3. Check console for JavaScript errors
4. Verify animations.js is loaded

**Check**:
```javascript
// In animations.js
if (this.isReducedMotion) {
  console.log('Reduced motion - particles disabled');
  return;
}
```

#### Issue: Form validation not working

**Symptoms**: Form submits without validation

**Diagnosis**:
```javascript
// Check if form handler initialized
console.log(window.FluxologyApp.formHandler);
```

**Solutions**:
1. Verify form has `id="contactForm"`
2. Check that `novalidate` attribute is present
3. Ensure form-handler.js is loaded
4. Check console for errors

**Check**:
```html
<!-- Form must have these attributes -->
<form id="contactForm" novalidate>
```

#### Issue: Mobile menu not opening

**Symptoms**: Hamburger button doesn't work

**Diagnosis**:
```javascript
// Check if elements exist
console.log(document.getElementById('navToggle'));
console.log(document.getElementById('navLinks'));
```

**Solutions**:
1. Verify IDs match in HTML and JavaScript
2. Check if click event listener is attached
3. Verify CSS classes in responsive.css
4. Check JavaScript console for errors

**Check**:
```javascript
// In main.js
navToggle.addEventListener('click', () => {
  console.log('Menu toggle clicked');
  navLinks.classList.toggle('open');
});
```

#### Issue: Fonts not loading

**Symptoms**: Fallback fonts showing instead of Google Fonts

**Diagnosis**:
```javascript
// Check if fonts loaded
document.fonts.ready.then(() => {
  console.log('Fonts loaded:', document.fonts.size);
});
```

**Solutions**:
1. Check internet connection
2. Verify Google Fonts URL is correct
3. Check font names match in CSS
4. Check browser console for CORS errors

**Check**:
```html
<!-- Verify this link is in <head> -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet">
```

### Debugging Tools

**Chrome DevTools**:

1. **Performance tab**:
   - Record scroll performance
   - Check for layout thrashing
   - Verify 60fps

2. **Coverage tab**:
   - See unused CSS/JS
   - Identify optimization opportunities

3. **Lighthouse**:
   - Generate performance report
   - Get optimization suggestions

4. **Accessibility tab**:
   - Check ARIA attributes
   - Verify color contrast
   - Test keyboard navigation

**Firefox DevTools**:

1. **Accessibility Inspector**:
   - Better than Chrome for a11y
   - Shows role and state

2. **Performance tab**:
   - Frame rate monitor
   - Paint flashing

**Console Commands**:

```javascript
// Check current theme
console.log(window.FluxologyApp.themeManager.getCurrentTheme());

// Check scroll position
console.log(window.FluxologyApp.scrollController.lastScrollY);

// Force theme change
window.dispatchEvent(new CustomEvent('themeChange', {
  detail: { theme: 'industrial' }
}));

// Test form validation
window.FluxologyApp.formHandler.validateForm();
```

### Performance Debugging

**Check animation frame rate**:
```javascript
let lastTime = performance.now();
let frames = 0;

function checkFPS() {
  const now = performance.now();
  frames++;

  if (now >= lastTime + 1000) {
    const fps = Math.round((frames * 1000) / (now - lastTime));
    console.log(`FPS: ${fps}`);
    frames = 0;
    lastTime = now;
  }

  requestAnimationFrame(checkFPS);
}

checkFPS();
```

**Expected**: 60fps (or close to it)

**If lower**:
- Check number of animated elements
- Verify using transform/opacity only
- Check for JavaScript blocking main thread

---

## Production Deployment Checklist

### Pre-deployment

- [ ] Remove console.log statements
- [ ] Minify CSS and JavaScript
- [ ] Optimize and compress images
- [ ] Add real content (replace placeholders)
- [ ] Test in all target browsers
- [ ] Run Lighthouse audit
- [ ] Check WCAG compliance
- [ ] Test form submission
- [ ] Verify all links work
- [ ] Check mobile responsiveness
- [ ] Test keyboard navigation
- [ ] Review meta tags for SEO

### Build Process

**Manual minification**:
```bash
# CSS
cat src/styles/*.css > dist/styles.all.css
cleancss -o dist/styles.min.css dist/styles.all.css

# JavaScript (if not using modules)
uglifyjs src/scripts/*.js -c -m -o dist/scripts.min.js
```

**Image optimization**:
```bash
# WebP conversion
for file in src/assets/images/*.jpg; do
  cwebp -q 80 "$file" -o "${file%.jpg}.webp"
done

# Image compression
imageoptim src/assets/images/*.{jpg,png}
```

### Server Configuration

**Apache** (.htaccess):
```apache
# Enable compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript
</IfModule>

# Enable caching
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType text/javascript "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
</IfModule>

# Force HTTPS
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

**Nginx**:
```nginx
# Enable gzip
gzip on;
gzip_types text/css text/javascript application/javascript;

# Enable caching
location ~* \.(css|js|webp|jpg|png)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}

# Force HTTPS
server {
  listen 80;
  return 301 https://$server_name$request_uri;
}
```

### Post-deployment

- [ ] Verify site loads correctly
- [ ] Test in production environment
- [ ] Check SSL certificate
- [ ] Verify analytics tracking
- [ ] Test form submissions
- [ ] Check all external links
- [ ] Monitor performance metrics
- [ ] Set up uptime monitoring
- [ ] Configure CDN (if using)
- [ ] Submit sitemap to search engines

---

## Conclusion

This website is built with performance, accessibility, and maintainability as core principles. The architecture is designed to be:

- **Performant**: 60fps animations, optimized assets
- **Accessible**: WCAG AA compliant, keyboard navigable
- **Maintainable**: Modular code, clear separation of concerns
- **Extensible**: Easy to add new sections, themes, features
- **Future-proof**: Modern standards, progressive enhancement

### Key Principles

1. **Progressive Enhancement**: Core functionality works without JavaScript
2. **Mobile First**: Design for small screens, enhance for large
3. **Performance Budget**: Keep bundle size under 100KB
4. **Accessibility First**: Not an afterthought, built-in from start
5. **Semantic HTML**: Use correct elements for meaning
6. **CSS Custom Properties**: Single source of truth for design tokens
7. **Modular JavaScript**: Single responsibility, loose coupling
8. **Event-Driven**: Components communicate via events

### When to Refactor

Consider refactoring when:
- Adding more than 2 additional business sections (consider templating)
- Form becomes complex (consider form library)
- Need state management (consider lightweight state library)
- Performance drops below 60fps (profile and optimize)

### Getting Help

**Resources**:
- MDN Web Docs: https://developer.mozilla.org
- Web.dev: https://web.dev
- CSS-Tricks: https://css-tricks.com
- A11y Project: https://www.a11yproject.com

**Questions?**
- Check README.md for user-facing docs
- Review code comments for implementation details
- Use browser DevTools for debugging
- Consult this document for architecture decisions

---

**Document Version**: 1.0.0
**Last Updated**: November 2025
**Maintained By**: Development Team
**Next Review**: When major features added
