/**
 * Theme Manager
 * Handles smooth theme transitions between different DBA sections
 */

class ThemeManager {
  constructor() {
    this.currentTheme = 'corporate';
    this.root = document.documentElement;
    this.body = document.body;

    // Theme color definitions
    this.themes = {
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

    this.init();
  }

  /**
   * Initialize theme manager
   */
  init() {
    this.listenForThemeChanges();
    this.setInitialTheme();
  }

  /**
   * Set initial theme
   */
  setInitialTheme() {
    this.applyTheme('corporate');
  }

  /**
   * Listen for theme change events from scroll controller
   */
  listenForThemeChanges() {
    window.addEventListener('themeChange', (event) => {
      const { theme } = event.detail;
      if (theme && this.themes[theme]) {
        this.transitionToTheme(theme);
      }
    });
  }

  /**
   * Transition to a new theme
   * @param {string} themeName - Name of the theme to transition to
   */
  transitionToTheme(themeName) {
    if (themeName === this.currentTheme) return;

    this.currentTheme = themeName;
    this.applyTheme(themeName);
  }

  /**
   * Apply theme to document
   * @param {string} themeName - Name of the theme to apply
   */
  applyTheme(themeName) {
    const theme = this.themes[themeName];

    if (!theme) {
      console.warn(`Theme "${themeName}" not found`);
      return;
    }

    // Update CSS custom properties with smooth transitions
    this.root.style.setProperty('--current-bg-primary', theme.bgPrimary);
    this.root.style.setProperty('--current-bg-secondary', theme.bgSecondary);
    this.root.style.setProperty('--current-text-primary', theme.textPrimary);
    this.root.style.setProperty('--current-text-secondary', theme.textSecondary);
    this.root.style.setProperty('--current-accent-primary', theme.accentPrimary);
    this.root.style.setProperty('--current-accent-secondary', theme.accentSecondary);
    this.root.style.setProperty('--current-font-heading', theme.fontHeading);
    this.root.style.setProperty('--current-font-body', theme.fontBody);

    // Update scroll progress bar color
    this.updateScrollProgressColor(theme.accentPrimary);

    // Dispatch event for other components
    window.dispatchEvent(new CustomEvent('themeApplied', {
      detail: { theme: themeName, colors: theme }
    }));
  }

  /**
   * Update scroll progress bar color
   * @param {string} color - Hex color code
   */
  updateScrollProgressColor(color) {
    const progressBar = document.getElementById('scrollProgressBar');
    if (progressBar) {
      progressBar.style.background = color;
    }
  }

  /**
   * Get current theme
   * @returns {string} Current theme name
   */
  getCurrentTheme() {
    return this.currentTheme;
  }

  /**
   * Get theme colors
   * @param {string} themeName - Name of the theme
   * @returns {Object} Theme color object
   */
  getThemeColors(themeName) {
    return this.themes[themeName] || null;
  }
}

// Export for use in main.js
export default ThemeManager;
