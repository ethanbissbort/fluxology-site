# Fluxology Inc. Website

A modern, high-performance single-page website showcasing Fluxology Inc.'s diverse business divisions with smooth theme transitions and immersive animations.

## Overview

Fluxology Inc. is a Canadian Controlled Private Corporation (CCPC) operating four distinct business lines:

1. **Fluxology Fabrication & Welding** - Metalworking and fabrication services
2. **Fluxology 3D Lab** - 3D printing and digital fabrication
3. **Fluxology Greenhouse** - Specialty crop production
4. **Fluxology Orchard & Food Forest** - Perennial food systems

This website features smooth scrolling, theme transitions, particle effects, and a fully responsive design optimized for performance.

## Features

- **Smooth Theme Transitions**: Seamless color and typography transitions as you scroll between sections
- **Particle Systems**: Themed ambient animations for each business division
- **Parallax Effects**: Multi-layer parallax scrolling for depth
- **Performance Optimized**: 60fps scrolling, lazy loading, optimized animations
- **Fully Responsive**: Mobile-first design with breakpoints for all devices
- **Accessible**: WCAG AA compliant, keyboard navigation, screen reader support
- **Modern Stack**: Vanilla JavaScript ES6+, CSS Grid, Flexbox

## Project Structure

```
fluxology-site/
├── src/
│   ├── index.html              # Main HTML file
│   ├── styles/
│   │   ├── reset.css           # CSS reset
│   │   ├── variables.css       # CSS custom properties (colors, typography, spacing)
│   │   ├── base.css            # Base styles and typography
│   │   ├── themes.css          # Theme-specific styles for each DBA
│   │   ├── transitions.css     # Animations and transitions
│   │   └── responsive.css      # Media queries and responsive design
│   ├── scripts/
│   │   ├── main.js             # Application entry point
│   │   ├── scroll-controller.js # Scroll behavior and Intersection Observer
│   │   ├── theme-manager.js    # Theme transition logic
│   │   ├── animations.js       # Particle systems and custom animations
│   │   └── form-handler.js     # Contact form validation
│   └── assets/
│       ├── images/             # Image assets (add your images here)
│       └── icons/              # Icon assets
└── README.md                   # This file
```

## Setup Instructions

### 1. Local Development

Simply open the HTML file in a modern web browser:

```bash
cd src
open index.html
```

Or use a local development server for better performance:

```bash
# Using Python 3
cd src
python3 -m http.server 8000

# Using Node.js
npx serve src

# Using PHP
cd src
php -S localhost:8000
```

Then navigate to `http://localhost:8000` in your browser.

### 2. Production Deployment

For production deployment:

1. **Minify CSS and JavaScript**:
   ```bash
   # Install build tools
   npm install -g clean-css-cli uglify-js

   # Minify CSS
   cat src/styles/*.css | cleancss -o dist/styles.min.css

   # Minify JavaScript
   uglifyjs src/scripts/*.js -o dist/scripts.min.js
   ```

2. **Optimize Images**:
   - Convert images to WebP format with fallbacks
   - Use responsive image sizes
   - Compress all images

3. **Update HTML** to use minified files

4. **Deploy** to your hosting provider (Netlify, Vercel, etc.)

## Customization Guide

### Updating Content

#### 1. Modify Text Content

Edit the HTML in `src/index.html`:

- Section titles: Look for `<h2 class="dba-name">` tags
- Descriptions: Look for `<p>` tags in `.dba-description`
- Service cards: Edit content in `.service-card` elements

#### 2. Change Colors

All colors are defined as CSS custom properties in `src/styles/variables.css`:

```css
/* Example: Change corporate theme accent color */
--corporate-accent-blue: #3A86FF; /* Change to your color */
```

Available theme color groups:
- Corporate (Hero, About, Contact)
- Industrial (Fabrication & Welding)
- Tech (3D Lab)
- Natural (Greenhouse & Orchard)

#### 3. Update Typography

Font families are also in `variables.css`:

```css
/* Example: Change corporate heading font */
--font-corporate-heading: 'Your Font', sans-serif;
```

Don't forget to update the Google Fonts import in `index.html`.

#### 4. Add Images

Replace placeholder showcase sections:

1. Add your images to `src/assets/images/`
2. Update the showcase divs in `index.html`:

```html
<div class="showcase-placeholder">
  <img src="assets/images/your-image.jpg" alt="Description" class="showcase-image">
</div>
```

**Recommended image sizes**:
- Showcase images: 1200x600px
- Service icons: 64x64px
- Hero background: 1920x1080px

**Image optimization**:
- Use WebP format with JPG fallback
- Compress images (target < 200KB per image)
- Use responsive images with srcset

### Adding New Sections

To add a new business division:

1. **Add HTML section** in `index.html`:

```html
<section class="section dba-section" id="new-business" data-theme="your-theme">
  <!-- Follow the existing DBA section structure -->
</section>
```

2. **Define theme colors** in `variables.css`:

```css
--your-theme-primary: #HEXCODE;
--your-theme-accent: #HEXCODE;
/* etc. */
```

3. **Add theme styles** in `themes.css`:

```css
[data-theme="your-theme"] {
  --current-bg-primary: var(--your-theme-primary);
  /* etc. */
}
```

4. **Update navigation** in `index.html`:

```html
<li><a href="#new-business" class="nav-link">New Business</a></li>
```

5. **Add to ThemeManager** in `scripts/theme-manager.js`:

```javascript
this.themes = {
  // ... existing themes
  'your-theme': {
    bgPrimary: '#HEXCODE',
    // etc.
  }
};
```

## Contact Form Configuration

The contact form includes validation but requires backend integration for actual submission.

### Integrating with a Backend

Edit `src/scripts/form-handler.js`:

```javascript
async submitForm(data) {
  const response = await fetch('YOUR_API_ENDPOINT', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    throw new Error('Submission failed');
  }

  return response.json();
}
```

### Popular Form Services

- **Formspree**: `https://formspree.io/f/YOUR_FORM_ID`
- **Netlify Forms**: Built-in (add `netlify` attribute to form)
- **EmailJS**: JavaScript-based email service
- **Custom API**: Your own backend endpoint

## Performance Optimization

### Current Optimizations

- ✅ Hardware-accelerated CSS transforms
- ✅ Intersection Observer API for scroll triggers
- ✅ RequestAnimationFrame for smooth animations
- ✅ Throttled scroll handlers
- ✅ Reduced motion support
- ✅ Mobile-optimized (fewer particles, simplified effects)

### Additional Optimization Tips

1. **Enable Compression**: Configure your server to use gzip/brotli
2. **Use a CDN**: Host static assets on a CDN
3. **Lazy Load Images**: Add `loading="lazy"` to images
4. **Preload Critical Resources**:

```html
<link rel="preload" href="styles/variables.css" as="style">
```

5. **Monitor Performance**: Use Lighthouse and WebPageTest

### Performance Targets

- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Time to Interactive: < 3.5s
- Cumulative Layout Shift: < 0.1
- Page Weight: < 500KB (initial load)

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile Safari iOS 14+
- Chrome Mobile Android 10+

### Graceful Degradation

- Fallbacks for CSS custom properties
- Reduced animations for older browsers
- Mobile-first responsive design

## Accessibility Features

- ✅ Semantic HTML5 structure
- ✅ ARIA labels and landmarks
- ✅ Keyboard navigation support
- ✅ Skip-to-content link
- ✅ Focus states for all interactive elements
- ✅ Color contrast WCAG AA compliant
- ✅ Prefers-reduced-motion support
- ✅ Screen reader tested

### Keyboard Shortcuts

- `Alt + H` - Scroll to top (Home)
- `Alt + C` - Scroll to contact section
- `Tab` - Navigate through interactive elements
- `Escape` - Close mobile menu

## Future Enhancements

### E-Commerce Integration

The website is structured to easily add e-commerce functionality:

1. **Product cards** can be added to service grids
2. **Shopping cart** icon placeholder in navigation
3. **Quick-view modals** for products
4. Integration points marked with `<!-- E-COMMERCE INTEGRATION -->` comments

### Recommended Platforms

- Shopify Buy Button
- WooCommerce API
- Stripe Checkout
- Custom solution

### Progressive Web App (PWA)

To convert to a PWA:

1. Create `manifest.json`
2. Implement service worker
3. Add offline support
4. Enable install prompt

### Analytics Integration

Add Google Analytics, Plausible, or similar:

```html
<!-- Add before closing </head> tag -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
```

## Troubleshooting

### Common Issues

**Issue**: Fonts not loading
- Check Google Fonts URL in `<head>`
- Verify internet connection
- Check browser console for errors

**Issue**: Animations not working
- Check `prefers-reduced-motion` setting
- Verify JavaScript is enabled
- Check browser console for errors

**Issue**: Mobile menu not opening
- Check JavaScript console for errors
- Verify `navToggle` and `navLinks` IDs match

**Issue**: Form validation not working
- Ensure form has `id="contactForm"`
- Check that FormHandler is initialized
- Verify field `name` attributes match validators

## License

All rights reserved © Fluxology Inc.

## Credits

**Design & Development**: Built with modern web standards
**Fonts**: Google Fonts
**Icons**: [Specify your icon source]

## Contact

For questions or support regarding this website:

- Email: info@fluxology.ca
- Phone: (123) 456-7890

---

**Version**: 1.0.0
**Last Updated**: November 2025
**Built for**: Enterprise deployment on high-performance hardware
