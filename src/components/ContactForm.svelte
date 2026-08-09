<script>
  const ENDPOINT = '/api/contact';
  const GENERIC_ERROR =
    'Sorry, there was a problem sending your message. Please try again, or email us directly at info@fluxology.ca.';

  const FIELDS = ['companyName', 'fullName', 'email', 'phone', 'serviceInterest', 'message'];

  const emptyForm = () => ({
    companyName: '',
    fullName: '',
    email: '',
    phone: '',
    serviceInterest: '',
    message: ''
  });

  let formData = $state(emptyForm());
  let website = $state('');
  let errors = $state({});
  let isSubmitting = $state(false);
  let submitStatus = $state(null);
  let submitMessage = $state('');
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

  function focusFirstInvalid() {
    const firstInvalid = FIELDS.find((field) => errors[field]);
    if (firstInvalid) document.getElementById(firstInvalid)?.focus();
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function isAccepted(response, data) {
    return response.ok && !!data && typeof data === 'object' && data.ok === true;
  }

  function applyFieldErrors(fields) {
    const applied = {};
    const extras = [];

    for (const [field, message] of Object.entries(fields)) {
      const text = typeof message === 'string' && message ? message : 'Please check this field';
      if (FIELDS.includes(field)) applied[field] = text;
      else extras.push(text);
    }

    errors = applied;
    return extras;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    submitStatus = null;
    submitMessage = '';

    if (!validate()) {
      focusFirstInvalid();
      return;
    }

    isSubmitting = true;

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, website })
      });

      const data = await readJson(response);

      if (isAccepted(response, data)) {
        formData = emptyForm();
        website = '';
        errors = {};
        submitStatus = 'success';
        submitMessage = 'Your inquiry has been received. We will respond as the planning schedule permits.';
        return;
      }

      if (response.status === 400 && data && typeof data.fields === 'object' && data.fields !== null) {
        const extras = applyFieldErrors(data.fields);
        submitStatus = 'error';
        submitMessage = extras.length
          ? extras.join(' ')
          : 'Please correct the highlighted fields and try again.';
        focusFirstInvalid();
        return;
      }

      if (response.status === 429) {
        submitStatus = 'error';
        submitMessage =
          'Too many attempts. Please try again shortly, or email us directly at info@fluxology.ca.';
        return;
      }

      submitStatus = 'error';
      submitMessage = GENERIC_ERROR;
    } catch (error) {
      submitStatus = 'error';
      submitMessage = GENERIC_ERROR;
    } finally {
      isSubmitting = false;
    }
  }

  function clearError(field) {
    if (errors[field]) errors[field] = undefined;
  }
</script>

<div class="contact-content observe-fade">
  <div class="contact-info">
    <div class="info-block">
      <h3 class="info-title">Contact</h3>
      <p class="info-text">
        Email: <a href="mailto:info@fluxology.ca">info@fluxology.ca</a><br />
        Software support: <a href="/support/">fluxology.ca/support/</a>
      </p>
    </div>

    <div class="info-block">
      <h3 class="info-title">Current Phase</h3>
      <p class="info-text">
        Software product development and publishing preparation are active now.<br />
        The trade and homestead operating lines remain staged future activities.<br />
        Earliest trade-service target: 2029
      </p>
    </div>

    <div class="info-block">
      <h3 class="info-title">Useful Inquiries</h3>
      <p class="info-text">
        Software support and feedback, company questions, future customer problems, local market validation,
        supplier relationships, used-equipment leads, rural collaboration and questions about the operating plan.
      </p>
    </div>
  </div>

  <form
    class="contact-form"
    action={ENDPOINT}
    method="POST"
    onsubmit={handleSubmit}
    novalidate={hydrated || undefined}
  >
    <p class="honeypot-field" aria-hidden="true">
      <label>
        Don't fill this out if you're human:
        <input name="website" tabindex="-1" autocomplete="off" bind:value={website} />
      </label>
    </p>

    <div class="form-row">
      <div class="form-group" class:error={errors.companyName}>
        <label for="companyName" class="form-label">
          Company Name <span class="optional">(Optional)</span>
        </label>
        <input
          type="text"
          id="companyName"
          name="companyName"
          class="form-input"
          bind:value={formData.companyName}
          oninput={() => clearError('companyName')}
          aria-invalid={!!errors.companyName}
          aria-describedby={errors.companyName ? 'companyName-error' : undefined}
          placeholder="Your Company"
        />
        {#if errors.companyName}
          <span class="form-error" id="companyName-error" role="alert">{errors.companyName}</span>
        {/if}
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
          minlength="2"
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
      <div class="form-group" class:error={errors.phone}>
        <label for="phone" class="form-label">
          Phone Number <span class="optional">(Optional)</span>
        </label>
        <input
          type="tel"
          id="phone"
          name="phone"
          class="form-input"
          bind:value={formData.phone}
          oninput={() => clearError('phone')}
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? 'phone-error' : undefined}
          placeholder="(123) 456-7890"
        />
        {#if errors.phone}
          <span class="form-error" id="phone-error" role="alert">{errors.phone}</span>
        {/if}
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
          <option value="software">Software / App Support or Feedback</option>
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
          minlength="10"
          aria-invalid={!!errors.message}
          aria-describedby={errors.message ? 'message-error' : undefined}
          placeholder="Describe the software issue, feedback, future need, collaboration or question, including relevant product and timing..."
        ></textarea>
        {#if errors.message}
          <span class="form-error" id="message-error" role="alert">{errors.message}</span>
        {/if}
      </div>
    </div>

    <div
      class="form-status"
      class:form-status--success={submitStatus === 'success'}
      class:form-status--error={submitStatus === 'error'}
      role={submitStatus === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {submitMessage}
    </div>

    <button type="submit" class="cta-button cta-primary form-submit" disabled={isSubmitting}>
      {isSubmitting ? 'Sending...' : 'Send Inquiry'}
    </button>
  </form>
</div>

<style>
  .honeypot-field {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

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
