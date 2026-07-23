<script>
  import { onMount } from 'svelte';

  // Values are var() references into the canonical palette in variables.css —
  // never literal colors or font names. Hardcoded font strings previously
  // broke themed typography entirely: astro:fonts registers HASHED family
  // names (e.g. "Outfit-1af0…"), so a raw 'Outfit' set at runtime resolved to
  // the generic sans-serif fallback on every theme change.
  const themes = {
    corporate: {
      bgPrimary: 'var(--corporate-primary-navy)',
      textPrimary: 'var(--corporate-neutral-white)',
      textSecondary: 'var(--corporate-neutral-gray)',
      accentPrimary: 'var(--corporate-accent-blue)',
      fontHeading: 'var(--font-corporate-heading)'
    },
    industrial: {
      bgPrimary: 'var(--industrial-primary-charcoal)',
      textPrimary: 'var(--industrial-neutral-white)',
      textSecondary: 'var(--industrial-neutral-silver)',
      accentPrimary: 'var(--industrial-accent-orange)',
      fontHeading: 'var(--font-industrial-heading)'
    },
    tech: {
      bgPrimary: 'var(--tech-primary-black)',
      textPrimary: 'var(--tech-neutral-white)',
      textSecondary: 'var(--tech-neutral-gray)',
      accentPrimary: 'var(--tech-accent-cyan)',
      fontHeading: 'var(--font-tech-heading)'
    },
    natural: {
      bgPrimary: 'var(--natural-primary-forest)',
      textPrimary: 'var(--natural-neutral-white)',
      textSecondary: 'var(--natural-neutral-cream)',
      accentPrimary: 'var(--natural-accent-terracotta)',
      fontHeading: 'var(--font-natural-heading)'
    }
  };

  function applyTheme(themeName) {
    const theme = themes[themeName];
    if (!theme) return;

    const root = document.documentElement;

    root.style.setProperty('--current-bg-primary', theme.bgPrimary);
    root.style.setProperty('--current-text-primary', theme.textPrimary);
    root.style.setProperty('--current-text-secondary', theme.textSecondary);
    root.style.setProperty('--current-accent-primary', theme.accentPrimary);
    root.style.setProperty('--current-font-heading', theme.fontHeading);

    // Update navigation theme attribute
    const nav = document.getElementById('mainNav');
    if (nav) {
      nav.setAttribute('data-current-theme', themeName);
    }
  }

  function updateActiveNavLink(sectionId) {
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
      const href = link.getAttribute('href')?.substring(1);

      if (href === sectionId) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });
  }

  onMount(() => {
    // Only page sections drive theming. A bare [data-theme] selector also
    // matched ParticleSystem containers, which have no id — every time one
    // intersected, updateActiveNavLink('') wiped the nav's active state.
    const sections = document.querySelectorAll('section[data-theme]');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const theme = entry.target.dataset.theme;
            const sectionId = entry.target.id;

            applyTheme(theme);
            updateActiveNavLink(sectionId);

            // Trigger animations for observe elements
            const observeElements = entry.target.querySelectorAll('.observe-fade, .observe-slide-up, .observe-scale');
            observeElements.forEach((el) => {
              el.classList.add('observed');
            });
          }
        });
      },
      {
        rootMargin: '-20% 0px -20% 0px',
        threshold: 0
      }
    );

    sections.forEach((section) => observer.observe(section));

    // Update navigation on scroll
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const nav = document.getElementById('mainNav');
          if (nav) {
            if (window.scrollY > 100) {
              nav.classList.add('scrolled');
            } else {
              nav.classList.remove('scrolled');
            }
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
    };
  });
</script>

<!-- This component has no visual output, it just manages theme transitions -->
