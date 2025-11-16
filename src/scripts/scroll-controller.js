/**
 * Scroll Controller
 * Manages scroll behavior, intersection observers, and scroll-triggered animations
 */

class ScrollController {
  constructor() {
    this.sections = document.querySelectorAll('.section');
    this.observedElements = [];
    this.scrollProgressBar = document.getElementById('scrollProgressBar');
    this.backToTopButton = document.getElementById('backToTop');
    this.mainNav = document.getElementById('mainNav');
    this.lastScrollY = 0;
    this.ticking = false;

    this.init();
  }

  /**
   * Initialize scroll controller
   */
  init() {
    this.setupIntersectionObserver();
    this.setupScrollListener();
    this.setupBackToTop();
    this.setupSmoothScroll();
    this.observeElements();
  }

  /**
   * Setup Intersection Observer for section detection
   */
  setupIntersectionObserver() {
    const options = {
      root: null,
      rootMargin: '-20% 0px -20% 0px',
      threshold: 0
    };

    this.sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const theme = entry.target.dataset.theme;
          this.updateCurrentTheme(theme);
          this.updateActiveNavLink(entry.target.id);
        }
      });
    }, options);

    this.sections.forEach(section => {
      this.sectionObserver.observe(section);
    });
  }

  /**
   * Setup scroll event listener with requestAnimationFrame
   */
  setupScrollListener() {
    window.addEventListener('scroll', () => {
      this.lastScrollY = window.scrollY;

      if (!this.ticking) {
        window.requestAnimationFrame(() => {
          this.handleScroll();
          this.ticking = false;
        });

        this.ticking = true;
      }
    }, { passive: true });
  }

  /**
   * Handle scroll events
   */
  handleScroll() {
    this.updateScrollProgress();
    this.updateNavStyle();
    this.updateBackToTopVisibility();
    this.updateParallax();
  }

  /**
   * Update scroll progress bar
   */
  updateScrollProgress() {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.scrollY;
    const scrollPercent = (scrollTop / (documentHeight - windowHeight)) * 100;

    this.scrollProgressBar.style.width = `${Math.min(scrollPercent, 100)}%`;
    this.scrollProgressBar.parentElement.setAttribute('aria-valuenow', Math.round(scrollPercent));
  }

  /**
   * Update navigation style on scroll
   */
  updateNavStyle() {
    if (this.lastScrollY > 100) {
      this.mainNav.classList.add('scrolled');
    } else {
      this.mainNav.classList.remove('scrolled');
    }
  }

  /**
   * Update back to top button visibility
   */
  updateBackToTopVisibility() {
    if (this.lastScrollY > 500) {
      this.backToTopButton.classList.add('visible');
    } else {
      this.backToTopButton.classList.remove('visible');
    }
  }

  /**
   * Update parallax effect for background layers
   */
  updateParallax() {
    const parallaxElements = document.querySelectorAll('[data-speed]');

    parallaxElements.forEach(element => {
      const speed = parseFloat(element.dataset.speed) || 0.5;
      const section = element.closest('.section');

      if (section) {
        const rect = section.getBoundingClientRect();
        const sectionTop = rect.top;
        const sectionHeight = rect.height;

        // Only apply parallax when section is in viewport
        if (sectionTop < window.innerHeight && sectionTop > -sectionHeight) {
          const offset = (window.innerHeight - sectionTop) * speed;
          element.style.transform = `translate3d(0, ${offset}px, 0)`;
        }
      }
    });
  }

  /**
   * Update current theme in navigation
   * @param {string} theme - Theme name
   */
  updateCurrentTheme(theme) {
    this.mainNav.setAttribute('data-current-theme', theme);

    // Dispatch custom event for theme manager
    window.dispatchEvent(new CustomEvent('themeChange', {
      detail: { theme }
    }));
  }

  /**
   * Update active navigation link
   * @param {string} sectionId - Section ID
   */
  updateActiveNavLink(sectionId) {
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
      const href = link.getAttribute('href').substring(1); // Remove #

      if (href === sectionId) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Setup back to top button functionality
   */
  setupBackToTop() {
    this.backToTopButton.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }

  /**
   * Setup smooth scroll for anchor links
   */
  setupSmoothScroll() {
    const anchorLinks = document.querySelectorAll('a[href^="#"]');

    anchorLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');

        // Skip if it's just "#"
        if (href === '#') return;

        e.preventDefault();

        const targetId = href.substring(1);
        const target = document.getElementById(targetId);

        if (target) {
          // Close mobile menu if open
          const navLinks = document.getElementById('navLinks');
          if (navLinks.classList.contains('open')) {
            navLinks.classList.remove('open');
            const navToggle = document.getElementById('navToggle');
            navToggle.setAttribute('aria-expanded', 'false');
          }

          // Smooth scroll to target
          const offsetTop = target.offsetTop - 70; // Account for fixed nav

          window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
          });
        }
      });
    });
  }

  /**
   * Observe elements for scroll-triggered animations
   */
  observeElements() {
    const elementsToObserve = document.querySelectorAll(
      '.section-header, .dba-header, .about-content, .services-grid, ' +
      '.dba-showcase, .contact-content, .about-stats'
    );

    const observerOptions = {
      root: null,
      rootMargin: '0px',
      threshold: 0.1
    };

    const elementObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          // Unobserve after animation to improve performance
          elementObserver.unobserve(entry.target);
        }
      });
    }, observerOptions);

    elementsToObserve.forEach(element => {
      elementObserver.observe(element);
    });
  }

  /**
   * Cleanup method
   */
  destroy() {
    if (this.sectionObserver) {
      this.sections.forEach(section => {
        this.sectionObserver.unobserve(section);
      });
    }
  }
}

// Export for use in main.js
export default ScrollController;
