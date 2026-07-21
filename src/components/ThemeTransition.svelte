<script>
  import { onMount } from 'svelte';

  const themes = {
    corporate: {
      bgPrimary: '#1B3A4B',
      bgSecondary: '#2E5266',
      textPrimary: '#FFFFFF',
      textSecondary: '#E9ECEF',
      accentPrimary: '#3A86FF',
      accentSecondary: '#A8DADC',
      fontHeading: "'Outfit', sans-serif",
      fontBody: "'Open Sans', sans-serif"
    },
    industrial: {
      bgPrimary: '#2C3440',
      bgSecondary: '#4A5F7F',
      textPrimary: '#F8F9FA',
      textSecondary: '#C9CDD1',
      accentPrimary: '#FF6B35',
      accentSecondary: '#FFA559',
      fontHeading: "'Rajdhani', sans-serif",
      fontBody: "'Inter', sans-serif"
    },
    tech: {
      bgPrimary: '#0A0E27',
      bgSecondary: '#1B2845',
      textPrimary: '#FFFFFF',
      textSecondary: '#E8EAF0',
      accentPrimary: '#00D9FF',
      accentSecondary: '#FF006E',
      fontHeading: "'Space Grotesk', sans-serif",
      fontBody: "'DM Sans', sans-serif"
    },
    natural: {
      bgPrimary: '#2D4A2B',
      bgSecondary: '#6B8E6B',
      textPrimary: '#FDFBF7',
      textSecondary: '#F5F1E8',
      accentPrimary: '#C77D58',
      accentSecondary: '#D4A574',
      fontHeading: "'Sora', sans-serif",
      fontBody: "'Nunito', sans-serif"
    }
  };

  function applyTheme(themeName) {
    const theme = themes[themeName];
    if (!theme) return;

    const root = document.documentElement;

    root.style.setProperty('--current-bg-primary', theme.bgPrimary);
    root.style.setProperty('--current-bg-secondary', theme.bgSecondary);
    root.style.setProperty('--current-text-primary', theme.textPrimary);
    root.style.setProperty('--current-text-secondary', theme.textSecondary);
    root.style.setProperty('--current-accent-primary', theme.accentPrimary);
    root.style.setProperty('--current-accent-secondary', theme.accentSecondary);
    root.style.setProperty('--current-font-heading', theme.fontHeading);
    root.style.setProperty('--current-font-body', theme.fontBody);

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
    const sections = document.querySelectorAll('[data-theme]');

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
