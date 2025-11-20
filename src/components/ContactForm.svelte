<script>
  let formData = {
    companyName: '',
    fullName: '',
    email: '',
    phone: '',
    serviceInterest: '',
    message: ''
  };

  let errors = {};
  let isSubmitting = false;

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validate() {
    errors = {};

    if (!formData.fullName || formData.fullName.trim().length < 2) {
      errors.fullName = 'Please enter your full name';
    }

    if (!formData.email || !validateEmail(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }

    if (!formData.serviceInterest) {
      errors.serviceInterest = 'Please select a service';
    }

    if (!formData.message || formData.message.trim().length < 10) {
      errors.message = 'Please provide more details (at least 10 characters)';
    }

    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    isSubmitting = true;

    try {
      // Simulate API call - replace with actual endpoint
      await new Promise((resolve) => setTimeout(resolve, 1500));

      console.log('Form submitted:', formData);

      // Reset form
      formData = {
        companyName: '',
        fullName: '',
        email: '',
        phone: '',
        serviceInterest: '',
        message: ''
      };

      alert('Thank you for your message! We will get back to you soon.');
    } catch (error) {
      console.error('Submission error:', error);
      alert('Sorry, there was an error submitting your message. Please try again.');
    } finally {
      isSubmitting = false;
    }
  }

  function clearError(field) {
    if (errors[field]) {
      errors = { ...errors, [field]: undefined };
    }
  }
</script>

<div class="contact-content">
  <div class="contact-info">
    <div class="info-block">
      <h3 class="info-title">Address</h3>
      <p class="info-text">
        [Street Address]<br />
        [City, Province, Postal Code]<br />
        Canada
      </p>
    </div>

    <div class="info-block">
      <h3 class="info-title">Contact</h3>
      <p class="info-text">
        Email: <a href="mailto:info@fluxology.ca">info@fluxology.ca</a><br />
        Phone: <a href="tel:+1234567890">(123) 456-7890</a>
      </p>
    </div>

    <div class="info-block">
      <h3 class="info-title">Business Hours</h3>
      <p class="info-text">
        Monday - Friday: 8:00 AM - 6:00 PM<br />
        Saturday: 9:00 AM - 4:00 PM<br />
        Sunday: Closed
      </p>
    </div>

    <div class="info-block">
      <h3 class="info-title">Follow Us</h3>
      <div class="social-links">
        <a href="#" class="social-link" aria-label="Facebook">
          <span class="social-icon">📘</span>
        </a>
        <a href="#" class="social-link" aria-label="Instagram">
          <span class="social-icon">📷</span>
        </a>
        <a href="#" class="social-link" aria-label="LinkedIn">
          <span class="social-icon">💼</span>
        </a>
        <a href="#" class="social-link" aria-label="Twitter">
          <span class="social-icon">🐦</span>
        </a>
        <a href="#" class="social-link" aria-label="YouTube">
          <span class="social-icon">📹</span>
        </a>
      </div>
    </div>
  </div>

  <form class="contact-form" on:submit={handleSubmit} novalidate>
    <div class="form-row">
      <div class="form-group">
        <label for="companyName" class="form-label">
          Company Name <span class="optional">(Optional)</span>
        </label>
        <input
          type="text"
          id="companyName"
          name="companyName"
          class="form-input"
          bind:value={formData.companyName}
          placeholder="Your Company"
        />
      </div>
    </div>

    <div class="form-row">
      <div class="form-group" class:error={errors.fullName}>
        <label for="fullName" class="form-label">
          Full Name <span class="required">*</span>
        </label>
        <input
          type="text"
          id="fullName"
          name="fullName"
          class="form-input"
          bind:value={formData.fullName}
          on:input={() => clearError('fullName')}
          required
          aria-invalid={!!errors.fullName}
          placeholder="John Doe"
        />
        {#if errors.fullName}
          <span class="form-error" role="alert">{errors.fullName}</span>
        {/if}
      </div>
    </div>

    <div class="form-row">
      <div class="form-group" class:error={errors.email}>
        <label for="email" class="form-label">
          Email Address <span class="required">*</span>
        </label>
        <input
          type="email"
          id="email"
          name="email"
          class="form-input"
          bind:value={formData.email}
          on:input={() => clearError('email')}
          required
          aria-invalid={!!errors.email}
          placeholder="john@example.com"
        />
        {#if errors.email}
          <span class="form-error" role="alert">{errors.email}</span>
        {/if}
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="phone" class="form-label">
          Phone Number <span class="optional">(Optional)</span>
        </label>
        <input
          type="tel"
          id="phone"
          name="phone"
          class="form-input"
          bind:value={formData.phone}
          placeholder="(123) 456-7890"
        />
      </div>
    </div>

    <div class="form-row">
      <div class="form-group" class:error={errors.serviceInterest}>
        <label for="serviceInterest" class="form-label">
          Service Interest <span class="required">*</span>
        </label>
        <select
          id="serviceInterest"
          name="serviceInterest"
          class="form-select"
          bind:value={formData.serviceInterest}
          on:change={() => clearError('serviceInterest')}
          required
          aria-invalid={!!errors.serviceInterest}
        >
          <option value="">Select a service...</option>
          <option value="fabrication">Fabrication & Welding</option>
          <option value="3d-lab">3D Lab</option>
          <option value="greenhouse">Greenhouse</option>
          <option value="orchard">Orchard & Food Forest</option>
          <option value="multiple">Multiple Services</option>
          <option value="general">General Inquiry</option>
        </select>
        {#if errors.serviceInterest}
          <span class="form-error" role="alert">{errors.serviceInterest}</span>
        {/if}
      </div>
    </div>

    <div class="form-row">
      <div class="form-group" class:error={errors.message}>
        <label for="message" class="form-label">
          Message <span class="required">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          class="form-textarea"
          rows="6"
          bind:value={formData.message}
          on:input={() => clearError('message')}
          required
          aria-invalid={!!errors.message}
          placeholder="Tell us about your project or inquiry..."
        />
        {#if errors.message}
          <span class="form-error" role="alert">{errors.message}</span>
        {/if}
      </div>
    </div>

    <button
      type="submit"
      class="cta-button cta-primary form-submit"
      disabled={isSubmitting}
    >
      {isSubmitting ? 'Sending...' : 'Send Message'}
    </button>
  </form>
</div>
