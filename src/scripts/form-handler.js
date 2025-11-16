/**
 * Form Handler
 * Manages contact form validation and submission
 */

class FormHandler {
  constructor() {
    this.form = document.getElementById('contactForm');
    this.submitButton = null;
    this.validators = {
      fullName: this.validateFullName,
      email: this.validateEmail,
      phone: this.validatePhone,
      serviceInterest: this.validateServiceInterest,
      message: this.validateMessage
    };

    if (this.form) {
      this.init();
    }
  }

  /**
   * Initialize form handler
   */
  init() {
    this.submitButton = this.form.querySelector('.form-submit');
    this.setupEventListeners();
  }

  /**
   * Setup form event listeners
   */
  setupEventListeners() {
    // Form submission
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    // Real-time validation on blur
    const inputs = this.form.querySelectorAll('.form-input, .form-select, .form-textarea');
    inputs.forEach(input => {
      input.addEventListener('blur', () => {
        this.validateField(input);
      });

      // Clear error on input
      input.addEventListener('input', () => {
        this.clearFieldError(input);
      });
    });
  }

  /**
   * Handle form submission
   */
  async handleSubmit() {
    // Validate all fields
    const isValid = this.validateForm();

    if (!isValid) {
      this.showFormError('Please fix the errors above before submitting.');
      return;
    }

    // Get form data
    const formData = new FormData(this.form);
    const data = Object.fromEntries(formData.entries());

    // Show loading state
    this.setSubmitLoading(true);

    // Simulate form submission (replace with actual API call)
    try {
      await this.submitForm(data);
      this.handleSuccess();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setSubmitLoading(false);
    }
  }

  /**
   * Submit form data (placeholder - implement actual submission)
   * @param {Object} data - Form data
   * @returns {Promise}
   */
  async submitForm(data) {
    // Simulate API call
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log('Form submitted:', data);
        resolve({ success: true });
      }, 1500);
    });
  }

  /**
   * Validate entire form
   * @returns {boolean} Is form valid
   */
  validateForm() {
    let isValid = true;

    // Validate all required fields
    const requiredFields = this.form.querySelectorAll('[required]');

    requiredFields.forEach(field => {
      if (!this.validateField(field)) {
        isValid = false;
      }
    });

    return isValid;
  }

  /**
   * Validate individual field
   * @param {HTMLElement} field - Input field
   * @returns {boolean} Is field valid
   */
  validateField(field) {
    const fieldName = field.name;
    const validator = this.validators[fieldName];

    if (!validator) {
      return true;
    }

    const result = validator.call(this, field.value);

    if (!result.valid) {
      this.showFieldError(field, result.message);
      return false;
    } else {
      this.clearFieldError(field);
      return true;
    }
  }

  /**
   * Validate full name
   * @param {string} value - Field value
   * @returns {Object} Validation result
   */
  validateFullName(value) {
    if (!value || value.trim().length === 0) {
      return { valid: false, message: 'Full name is required' };
    }

    if (value.trim().length < 2) {
      return { valid: false, message: 'Please enter your full name' };
    }

    return { valid: true };
  }

  /**
   * Validate email
   * @param {string} value - Field value
   * @returns {Object} Validation result
   */
  validateEmail(value) {
    if (!value || value.trim().length === 0) {
      return { valid: false, message: 'Email address is required' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(value)) {
      return { valid: false, message: 'Please enter a valid email address' };
    }

    return { valid: true };
  }

  /**
   * Validate phone (optional field)
   * @param {string} value - Field value
   * @returns {Object} Validation result
   */
  validatePhone(value) {
    // Phone is optional, so empty is valid
    if (!value || value.trim().length === 0) {
      return { valid: true };
    }

    // Basic phone validation
    const phoneRegex = /^[\d\s\-\(\)\+]+$/;

    if (!phoneRegex.test(value)) {
      return { valid: false, message: 'Please enter a valid phone number' };
    }

    return { valid: true };
  }

  /**
   * Validate service interest
   * @param {string} value - Field value
   * @returns {Object} Validation result
   */
  validateServiceInterest(value) {
    if (!value || value.trim().length === 0) {
      return { valid: false, message: 'Please select a service' };
    }

    return { valid: true };
  }

  /**
   * Validate message
   * @param {string} value - Field value
   * @returns {Object} Validation result
   */
  validateMessage(value) {
    if (!value || value.trim().length === 0) {
      return { valid: false, message: 'Message is required' };
    }

    if (value.trim().length < 10) {
      return { valid: false, message: 'Please provide more details (at least 10 characters)' };
    }

    return { valid: true };
  }

  /**
   * Show field error
   * @param {HTMLElement} field - Input field
   * @param {string} message - Error message
   */
  showFieldError(field, message) {
    const formGroup = field.closest('.form-group');
    const errorElement = formGroup.querySelector('.form-error');

    formGroup.classList.add('error');
    if (errorElement) {
      errorElement.textContent = message;
    }

    field.setAttribute('aria-invalid', 'true');
  }

  /**
   * Clear field error
   * @param {HTMLElement} field - Input field
   */
  clearFieldError(field) {
    const formGroup = field.closest('.form-group');
    const errorElement = formGroup.querySelector('.form-error');

    formGroup.classList.remove('error');
    if (errorElement) {
      errorElement.textContent = '';
    }

    field.removeAttribute('aria-invalid');
  }

  /**
   * Show general form error
   * @param {string} message - Error message
   */
  showFormError(message) {
    // You can implement a general error display here
    console.error(message);
  }

  /**
   * Set submit button loading state
   * @param {boolean} loading - Is loading
   */
  setSubmitLoading(loading) {
    if (!this.submitButton) return;

    if (loading) {
      this.submitButton.disabled = true;
      this.submitButton.textContent = 'Sending...';
      this.submitButton.style.opacity = '0.7';
    } else {
      this.submitButton.disabled = false;
      this.submitButton.textContent = 'Send Message';
      this.submitButton.style.opacity = '1';
    }
  }

  /**
   * Handle successful submission
   */
  handleSuccess() {
    // Clear form
    this.form.reset();

    // Show success message (you can implement a modal or notification)
    alert('Thank you for your message! We will get back to you soon.');

    // Optional: Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Handle submission error
   * @param {Error} error - Error object
   */
  handleError(error) {
    console.error('Form submission error:', error);
    alert('Sorry, there was an error submitting your message. Please try again.');
  }
}

// Export for use in main.js
export default FormHandler;
