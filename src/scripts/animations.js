/**
 * Animations Controller
 * Manages particle systems, ambient effects, and custom animations
 */

class AnimationController {
  constructor() {
    this.particles = [];
    this.animationFrameId = null;
    this.isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.isMobile = window.innerWidth < 768;

    this.init();
  }

  /**
   * Initialize animations
   */
  init() {
    if (this.isReducedMotion) {
      console.log('Reduced motion preference detected - animations disabled');
      return;
    }

    this.createParticleSystems();
    this.setupCustomCursor();
    this.listenForThemeChanges();
  }

  /**
   * Create particle systems for each section
   */
  createParticleSystems() {
    // Corporate particles (hero and about)
    this.createCorporateParticles('heroParticles', 15);
    this.createCorporateParticles('aboutParticles', 12);

    // Industrial sparks (fabrication)
    this.createIndustrialSparks('fabricationParticles', this.isMobile ? 8 : 15);

    // Tech digital particles (3D lab)
    this.createTechParticles('labParticles', this.isMobile ? 10 : 20);

    // Natural floating leaves (greenhouse and orchard)
    this.createNaturalParticles('greenhouseParticles', this.isMobile ? 6 : 12);
    this.createNaturalParticles('orchardParticles', this.isMobile ? 6 : 12);

    // Contact particles
    this.createCorporateParticles('contactParticles', 10);
  }

  /**
   * Create corporate-themed particles
   * @param {string} containerId - Container element ID
   * @param {number} count - Number of particles
   */
  createCorporateParticles(containerId, count) {
    const container = document.getElementById(containerId);
    if (!container) return;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';

      const size = Math.random() * 4 + 2;
      const startX = Math.random() * 100;
      const startY = Math.random() * 100;
      const endX = startX + (Math.random() - 0.5) * 30;
      const endY = startY - Math.random() * 50;
      const duration = Math.random() * 4 + 4;
      const delay = Math.random() * 5;

      particle.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        background: rgba(58, 134, 255, 0.3);
        left: ${startX}%;
        top: ${startY}%;
        --start-x: 0px;
        --start-y: 0px;
        --end-x: ${(endX - startX) * 10}px;
        --end-y: ${(endY - startY) * 10}px;
        --duration: ${duration}s;
        --delay: ${delay}s;
        --opacity: ${Math.random() * 0.4 + 0.2};
      `;

      container.appendChild(particle);
    }
  }

  /**
   * Create industrial-themed spark particles
   * @param {string} containerId - Container element ID
   * @param {number} count - Number of particles
   */
  createIndustrialSparks(containerId, count) {
    const container = document.getElementById(containerId);
    if (!container) return;

    for (let i = 0; i < count; i++) {
      const spark = document.createElement('div');
      spark.className = 'spark-particle';

      const size = Math.random() * 3 + 1;
      const startX = Math.random() * 100;
      const endX = startX + (Math.random() - 0.5) * 20;
      const duration = Math.random() * 3 + 2;
      const delay = Math.random() * 5;

      spark.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        left: ${startX}%;
        top: ${Math.random() * 30}%;
        --start-x: 0px;
        --end-x: ${(endX - startX) * 10}px;
        --duration: ${duration}s;
        --delay: ${delay}s;
      `;

      container.appendChild(spark);
    }
  }

  /**
   * Create tech-themed digital particles
   * @param {string} containerId - Container element ID
   * @param {number} count - Number of particles
   */
  createTechParticles(containerId, count) {
    const container = document.getElementById(containerId);
    if (!container) return;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'digital-particle';

      const x = Math.random() * 100;
      const y = Math.random() * 100;
      const duration = Math.random() * 2 + 1.5;
      const delay = Math.random() * 3;

      particle.style.cssText = `
        left: ${x}%;
        top: ${y}%;
        --x: ${(Math.random() - 0.5) * 50}px;
        --y: ${(Math.random() - 0.5) * 50}px;
        --duration: ${duration}s;
        --delay: ${delay}s;
      `;

      container.appendChild(particle);
    }
  }

  /**
   * Create natural-themed leaf particles
   * @param {string} containerId - Container element ID
   * @param {number} count - Number of particles
   */
  createNaturalParticles(containerId, count) {
    const container = document.getElementById(containerId);
    if (!container) return;

    for (let i = 0; i < count; i++) {
      const leaf = document.createElement('div');
      leaf.className = 'leaf-particle';

      const startX = Math.random() * 100;
      const endX = startX + (Math.random() - 0.5) * 40;
      const duration = Math.random() * 8 + 6;
      const delay = Math.random() * 8;

      leaf.style.cssText = `
        left: ${startX}%;
        --start-x: 0px;
        --end-x: ${(endX - startX) * 10}px;
        --duration: ${duration}s;
        --delay: ${delay}s;
      `;

      container.appendChild(leaf);
    }
  }

  /**
   * Setup custom cursor effect (desktop only)
   */
  setupCustomCursor() {
    // Only enable on desktop with mouse
    if (this.isMobile || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }

    const cursor = document.createElement('div');
    cursor.className = 'custom-cursor';
    document.body.appendChild(cursor);

    let mouseX = 0;
    let mouseY = 0;
    let cursorX = 0;
    let cursorY = 0;

    // Update mouse position
    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    // Smooth cursor movement
    const animateCursor = () => {
      const speed = 0.2;
      cursorX += (mouseX - cursorX) * speed;
      cursorY += (mouseY - cursorY) * speed;

      cursor.style.left = `${cursorX}px`;
      cursor.style.top = `${cursorY}px`;

      requestAnimationFrame(animateCursor);
    };

    animateCursor();

    // Show cursor after first movement
    document.addEventListener('mousemove', () => {
      cursor.classList.add('active');
    }, { once: true });

    // Hover effect on interactive elements
    const interactiveElements = document.querySelectorAll('a, button, .cta-button');

    interactiveElements.forEach(el => {
      el.addEventListener('mouseenter', () => {
        cursor.classList.add('hover');
      });

      el.addEventListener('mouseleave', () => {
        cursor.classList.remove('hover');
      });
    });

    // Enable custom cursor class on body
    document.body.classList.add('custom-cursor-enabled');
  }

  /**
   * Listen for theme changes to update particle colors
   */
  listenForThemeChanges() {
    window.addEventListener('themeApplied', (event) => {
      const { theme, colors } = event.detail;
      this.updateParticleColors(theme, colors);
    });
  }

  /**
   * Update particle colors based on theme
   * @param {string} theme - Theme name
   * @param {Object} colors - Theme colors
   */
  updateParticleColors(theme, colors) {
    // This can be extended to dynamically update particle colors
    // For now, particles are themed via CSS
  }

  /**
   * Cleanup animations
   */
  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Remove all particles
    const allParticles = document.querySelectorAll('.particle, .spark-particle, .digital-particle, .leaf-particle');
    allParticles.forEach(particle => particle.remove());

    // Remove custom cursor
    const cursor = document.querySelector('.custom-cursor');
    if (cursor) {
      cursor.remove();
      document.body.classList.remove('custom-cursor-enabled');
    }
  }
}

// Export for use in main.js
export default AnimationController;
