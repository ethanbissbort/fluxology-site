<script>
  import { onMount } from 'svelte';

  // Values are var() references into the canonical palette in variables.css —
  // never literal colors or font names. Hardcoded font strings previously
  // broke themed typography entirely: astro:fonts registers HASHED family
  // names (e.g. "Outfit-1af0…"), so a raw 'Outfit' set at runtime resolved to
  // the generic sans-serif fallback on every theme change.
  //
  // KNOWN AND DELIBERATE: accentPrimary here does NOT match the value the
  // matching [data-theme] block in themes.css gives --current-accent-primary
  // (industrial: orange here / amber there; natural: terracotta here /
  // terracotta-text there). The two are consumed by different things and both
  // are correct where they land:
  //   * this map sets the token on <html>, whose only consumers are non-text
  //     (nav focus ring, scroll-progress bar, back-to-top surface, cursor) and
  //     want the saturated brand tone — measured 4.2:1 on the nav background,
  //     over the 3:1 non-text bar;
  //   * themes.css sets it inside each section, where it tints small TEXT
  //     labels that need the lightened tone to hold AA.
  // Do NOT "unify" these by copying one into the other: it is a silent
  // contrast change in whichever context loses. If they are ever merged, split
  // the token into text/non-text variants first.
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

    // DBA detail routes keep the matching division link active while their
    // local sections (role, offer, workflow, etc.) intersect. Those section
    // IDs intentionally do not appear in the global navigation.
    if (window.location.pathname !== '/') {
      const currentPath = window.location.pathname;

      navLinks.forEach(link => {
        const isCurrentPage = link.getAttribute('href') === currentPath;

        link.classList.toggle('active', isCurrentPage);
        if (isCurrentPage) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      });
      return;
    }

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
    // This island is the ONLY thing that adds `.observed`, so the fail-open
    // watchdog in BaseLayout's <head> waits for this marker before it decides
    // that the scroll reveal is never coming and unhides everything.
    document.documentElement.classList.add('reveal-ready');

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
