/**
 * Main Application Entry Point
 * Initializes all components and manages application lifecycle
 */

import ScrollController from './scroll-controller.js';
import ThemeManager from './theme-manager.js';
import AnimationController from './animations.js';
import FormHandler from './form-handler.js';

class FluxologyApp {
  constructor() {
    this.scrollController = null;
    this.themeManager = null;
    this.animationController = null;
    this.formHandler = null;
    this.loadingScreen = document.getElementById('loadingScreen');

    this.init();
  }

  /**
   * Initialize application
   */
  async init() {
    // Wait for DOM to be fully loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.start());
    } else {
      this.start();
    }
  }

  /**
   * Start application
   */
  async start() {
    try {
      // Initialize all controllers
      this.themeManager = new ThemeManager();
      this.scrollController = new ScrollController();
      this.animationController = new AnimationController();
      this.formHandler = new FormHandler();

      // Setup additional features
      this.setupNavigationToggle();
      this.setupKeyboardNavigation();
      this.updateCurrentYear();

      // Hide loading screen
      setTimeout(() => {
        this.hideLoadingScreen();
      }, 500);

      // Log initialization
      console.log('✨ Fluxology website initialized successfully');
    } catch (error) {
      console.error('Error initializing application:', error);
      this.hideLoadingScreen();
    }
  }

  /**
   * Hide loading screen
   */
  hideLoadingScreen() {
    if (this.loadingScreen) {
      this.loadingScreen.classList.add('hidden');
      document.body.style.overflow = 'auto';
    }
  }

  /**
   * Setup mobile navigation toggle
   */
  setupNavigationToggle() {
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');

    if (!navToggle || !navLinks) return;

    navToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.contains('open');

      if (isOpen) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      } else {
        navLinks.classList.add('open');
        navToggle.setAttribute('aria-expanded', 'true');
      }
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });

    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.focus();
      }
    });
  }

  /**
   * Setup keyboard navigation for accessibility
   */
  setupKeyboardNavigation() {
    // Tab trap in mobile menu when open
    const navLinks = document.getElementById('navLinks');
    const navToggle = document.getElementById('navToggle');

    if (!navLinks || !navToggle) return;

    const focusableElements = navLinks.querySelectorAll('a');
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    navLinks.addEventListener('keydown', (e) => {
      if (!navLinks.classList.contains('open')) return;

      if (e.key === 'Tab') {
        if (e.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            navToggle.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            navToggle.focus();
          }
        }
      }
    });

    // Setup keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Alt + H = Home
      if (e.altKey && e.key === 'h') {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // Alt + C = Contact
      if (e.altKey && e.key === 'c') {
        e.preventDefault();
        const contact = document.getElementById('contact');
        if (contact) {
          contact.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  }

  /**
   * Update current year in footer
   */
  updateCurrentYear() {
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
      yearElement.textContent = new Date().getFullYear();
    }
  }

  /**
   * Cleanup and destroy all controllers
   */
  destroy() {
    if (this.scrollController) {
      this.scrollController.destroy();
    }

    if (this.animationController) {
      this.animationController.destroy();
    }
  }
}

// Initialize application
const app = new FluxologyApp();

// Make app globally available for debugging
if (typeof window !== 'undefined') {
  window.FluxologyApp = app;
}

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause animations when page is hidden
    console.log('Page hidden - pausing animations');
  } else {
    // Resume animations when page is visible
    console.log('Page visible - resuming animations');
  }
});

// Handle window resize with debounce
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    console.log('Window resized - adjusting layout');
    // You can add resize handlers here
  }, 250);
});

// Service Worker registration for future PWA support
if ('serviceWorker' in navigator) {
  // Uncomment when service worker is implemented
  /*
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => {
        console.log('Service Worker registered:', registration);
      })
      .catch(error => {
        console.log('Service Worker registration failed:', error);
      });
  });
  */
}

export default FluxologyApp;
