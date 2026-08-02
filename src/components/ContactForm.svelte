<script>
  // Must match the `name` attribute on this form and the hidden detection
  // form in index.astro that Netlify's build bot parses at deploy time.
  const FORM_NAME = 'contact';

  let formData = $state({
    companyName: '',
    fullName: '',
    email: '',
    phone: '',
    serviceInterest: '',
    message: ''
  });

  // Netlify honeypot: real users leave this empty; bots that auto-fill
  // every field get silently rejected.
  let botField = $state('');

  let errors = $state({});
  let isSubmitting = $state(false);
  let submitStatus = $state(null); // 'success' | 'error' | null
  let submitMessage = $state('');

  // novalidate is hydration-gated: the server-rendered form must NOT carry it,
  // so native required/email validation still guards pre-hydration and no-JS
  // submits (a bare native POST bypasses validation and 404s off-Netlify).
  // Once hydrated, novalidate hands validation over to validate() below.
  let hydrated = $state(false);

  $effect(() => {
    hydrated = true;
  });

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
      errors.serviceInterest = 'Please select an inquiry topic';
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
      // Move focus to the first invalid field so keyboard and screen-reader
      // users land on the problem instead of a silent no-op.
      const firstInvalid = ['fullName', 'email', 'serviceInterest', 'message']
        .find((field) => errors[field]);
      if (firstInvalid) {
        document.getElementById(firstInvalid)?.focus();
      }
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
      submitMessage = 'Your inquiry has been received. We will respond as the planning schedule permits.';
    } catch (error) {
      submitStatus = 'error';
      submitMessage =
        'Sorry, there was a problem sending your message. Please try again, or email us directly at info@fluxology.ca.';
    } finally {
      isSubmitting = false;
    }
  }

  function clearError(field) {
    // $state objects are deeply reactive, so a direct assignment updates the UI.
    if (errors[field]) {
      errors[field] = undefined;
    }
  }
</script>

<div class="contact-content observe-fade">
  <div class="contact-info">
    <div class="info-block">
      <h3 class="info-title">Contact</h3>
      <p class="info-text">
        Email: <a href="mailto:info@fluxology.ca">info@fluxology.ca</a>
      </p>
    </div>

    <div class="info-block">
      <h3 class="info-title">Current Phase</h3>
      <p class="info-text">
        2026-2028 foundation period<br />
        Training, employment entry, corporate maintenance and launch preparation<br />
        Earliest commercial target: 2029
      </p>
    </div>

    <div class="info-block">
      <h3 class="info-title">Useful Inquiries</h3>
      <p class="info-text">
        Future customer problems, local market validation, supplier relationships, used-equipment leads,
        rural collaboration and questions about the operating plan.
      </p>
    </div>
  </div>

  <form
    class="contact-form"
    name="contact"
    method="POST"
    data-netlify="true"
    netlify-honeypot="bot-field"
    onsubmit={handleSubmit}
    novalidate={hydrated || undefined}
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
          oninput={() => clearError('fullName')}
          required
          aria-invalid={!!errors.fullName}
          aria-describedby={errors.fullName ? 'fullName-error' : undefined}
          placeholder="John Doe"
        />
        {#if errors.fullName}
          <span class="form-error" id="fullName-error" role="alert">{errors.fullName}</span>
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
          oninput={() => clearError('email')}
          required
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          placeholder="john@example.com"
        />
        {#if errors.email}
          <span class="form-error" id="email-error" role="alert">{errors.email}</span>
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
          Inquiry Topic <span class="required">*</span>
        </label>
        <select
          id="serviceInterest"
          name="serviceInterest"
          class="form-select"
          bind:value={formData.serviceInterest}
          onchange={() => clearError('serviceInterest')}
          required
          aria-invalid={!!errors.serviceInterest}
          aria-describedby={errors.serviceInterest ? 'serviceInterest-error' : undefined}
        >
          <option value="">Select an inquiry topic...</option>
          <option value="fabrication">Future Fabrication & Welding Need</option>
          <option value="3d-lab">Future 3D Lab Need</option>
          <option value="greenhouse">Greenhouse / Growing-System Interest</option>
          <option value="orchard">Orchard & Food Forest Interest</option>
          <option value="multiple">Cross-Division Collaboration</option>
          <option value="general">Company / General Inquiry</option>
        </select>
        {#if errors.serviceInterest}
          <span class="form-error" id="serviceInterest-error" role="alert">{errors.serviceInterest}</span>
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
          oninput={() => clearError('message')}
          required
          aria-invalid={!!errors.message}
          aria-describedby={errors.message ? 'message-error' : undefined}
          placeholder="Describe the future need, collaboration or question, including location and timing where relevant..."
        ></textarea>
        {#if errors.message}
          <span class="form-error" id="message-error" role="alert">{errors.message}</span>
        {/if}
      </div>
    </div>

    <!-- Permanently rendered live region: aria-live only reliably announces
         CHANGES inside an existing element, so the container stays in the DOM
         (empty and collapsed when idle) and only its text/class swap. -->
    <div
      class="form-status"
      class:form-status--success={submitStatus === 'success'}
      class:form-status--error={submitStatus === 'error'}
      role={submitStatus === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {submitMessage}
    </div>

    <button
      type="submit"
      class="cta-button cta-primary form-submit"
      disabled={isSubmitting}
    >
      {isSubmitting ? 'Sending...' : 'Send Inquiry'}
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

  /* Box styles live on the modifier classes so the always-present live
     region collapses to nothing while idle/empty. */
  .form-status {
    border-radius: 8px;
    font-size: 0.95rem;
    line-height: 1.4;
  }

  .form-status--success,
  .form-status--error {
    margin-bottom: 1rem;
    padding: 0.85rem 1rem;
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
