<script>
  // Must match the `name` attribute on this form and the hidden detection
  // form in index.astro that Netlify's build bot parses at deploy time.
  const FORM_NAME = 'contact';

  let formData = {
    companyName: '',
    fullName: '',
    email: '',
    phone: '',
    serviceInterest: '',
    message: ''
  };

  // Netlify honeypot: real users leave this empty; bots that auto-fill
  // every field get silently rejected.
  let botField = '';

  let errors = {};
  let isSubmitting = false;
  let submitStatus = null; // 'success' | 'error' | null
  let submitMessage = '';

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

  // Netlify expects application/x-www-form-urlencoded submissions.
  function encode(data) {
    return Object.keys(data)
      .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(data[key] ?? ''))
      .join('&');
  }

  async function handleSubmit(e) {
    e.preventDefault();

    submitStatus = null;
    submitMessage = '';

    if (!validate()) {
      return;
    }

    isSubmitting = true;

    try {
      const payload = {
        'form-name': FORM_NAME,
        'bot-field': botField,
        ...formData
      };

      const response = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encode(payload)
      });

      if (!response.ok) {
        throw new Error(`Submission failed with status ${response.status}`);
      }

      // Reset form on success
      formData = {
        companyName: '',
        fullName: '',
        email: '',
        phone: '',
        serviceInterest: '',
        message: ''
      };
      errors = {};

      submitStatus = 'success';
      submitMessage = 'Thank you for your message! We will get back to you soon.';
    } catch (error) {
      submitStatus = 'error';
      submitMessage =
        'Sorry, there was a problem sending your message. Please try again, or email us directly at info@fluxology.ca.';
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

  <form
    class="contact-form"
    name="contact"
    method="POST"
    data-netlify="true"
    netlify-honeypot="bot-field"
    on:submit={handleSubmit}
    novalidate
  >
    <!-- Netlify Forms: required so submissions are attributed to the right form -->
    <input type="hidden" name="form-name" value="contact" />

    <!-- Netlify honeypot: hidden from humans, catches naive bots -->
    <p class="honeypot-field" aria-hidden="true">
      <label>
        Don't fill this out if you're human:
        <input
          name="bot-field"
          tabindex="-1"
          autocomplete="off"
          bind:value={botField}
        />
      </label>
    </p>

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

    {#if submitStatus}
      <div
        class="form-status form-status--{submitStatus}"
        role={submitStatus === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {submitMessage}
      </div>
    {/if}

    <button
      type="submit"
      class="cta-button cta-primary form-submit"
      disabled={isSubmitting}
    >
      {isSubmitting ? 'Sending...' : 'Send Message'}
    </button>
  </form>
</div>

<style>
  /* Netlify honeypot — visually removed but still submitted with the form */
  .honeypot-field {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  .form-status {
    margin-bottom: 1rem;
    padding: 0.85rem 1rem;
    border-radius: 8px;
    font-size: 0.95rem;
    line-height: 1.4;
    border: 1px solid transparent;
  }

  .form-status--success {
    color: #0f5132;
    background-color: #d1e7dd;
    border-color: #badbcc;
  }

  .form-status--error {
    color: #842029;
    background-color: #f8d7da;
    border-color: #f5c2c7;
  }
</style>
