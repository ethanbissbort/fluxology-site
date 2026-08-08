/**
 * Sanitising + validation for contact submissions.
 *
 * Sanitising always runs BEFORE validation, so no control character (in
 * particular CR/LF, the email-header-injection vector) can survive into stored
 * records or into anything handed to the mailer.
 */

import { ALLOWED_SERVICES } from './config.mjs';

/** Control characters, excluding nothing — used for single-line fields. */
const CONTROL_ALL = /[\u0000-\u001f\u007f]/g;
/** Control characters except newline — used for the multi-line message body. */
const CONTROL_EXCEPT_LF = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/**
 * Collapse a value to a single line with no control characters.
 * CR/LF/TAB become a single space so header injection attempts turn into
 * harmless inline text rather than new headers.
 */
export function sanitizeSingleLine(value, maxLen = 1000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_ALL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** Normalise a multi-line value: CRLF/CR -> LF, drop other control chars. */
export function sanitizeMultiLine(value, maxLen = 20000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_EXCEPT_LF, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, maxLen);
}

/**
 * Basic email shape check. Deliberately permissive (one @, no whitespace,
 * a dotted domain) — real verification is "can we reply to it", not a regex.
 */
const EMAIL_RE = /^[^\s@,;:<>"'\\]+@[^\s@,;:<>"'\\.]+(?:\.[^\s@,;:<>"'\\.]+)+$/;

const LIMITS = Object.freeze({
  fullName: 120,
  email: 200,
  serviceInterest: 60,
  message: 5000,
  companyName: 160,
  phone: 40,
});

export { LIMITS };

function pick(raw, key) {
  const value = raw?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Validate a raw submission (already decoded from JSON or urlencoded).
 *
 * @param {Record<string, unknown>} raw
 * @returns {{ ok: boolean, fields?: Record<string,string>, data?: object, honeypot?: boolean }}
 */
export function validateSubmission(raw) {
  // Honeypot: any non-empty value means a bot filled a hidden field.
  const honeypot = sanitizeSingleLine(pick(raw, 'website'), 200);
  if (honeypot !== '') return { ok: false, honeypot: true };

  const fullName = sanitizeSingleLine(pick(raw, 'fullName'), LIMITS.fullName + 1);
  const email = sanitizeSingleLine(pick(raw, 'email'), LIMITS.email + 1);
  const serviceInterest = sanitizeSingleLine(pick(raw, 'serviceInterest'), LIMITS.serviceInterest + 1)
    .toLowerCase();
  const message = sanitizeMultiLine(pick(raw, 'message'), LIMITS.message + 1);
  const companyName = sanitizeSingleLine(pick(raw, 'companyName'), LIMITS.companyName + 1);
  const phone = sanitizeSingleLine(pick(raw, 'phone'), LIMITS.phone + 1);

  /** @type {Record<string,string>} */
  const fields = {};

  if (fullName.length < 2) {
    fields.fullName = 'Please enter your full name (at least 2 characters).';
  } else if (fullName.length > LIMITS.fullName) {
    fields.fullName = `Please keep your name to ${LIMITS.fullName} characters or fewer.`;
  }

  if (email === '') {
    fields.email = 'Please enter your email address.';
  } else if (email.length > LIMITS.email) {
    fields.email = `Please keep your email address to ${LIMITS.email} characters or fewer.`;
  } else if (!EMAIL_RE.test(email)) {
    fields.email = 'Please enter a valid email address.';
  }

  if (serviceInterest === '') {
    fields.serviceInterest = 'Please choose the service you are interested in.';
  } else if (!ALLOWED_SERVICES.includes(serviceInterest)) {
    fields.serviceInterest = 'Please choose one of the listed services.';
  }

  if (message.length < 10) {
    fields.message = 'Please tell us a bit more (at least 10 characters).';
  } else if (message.length > LIMITS.message) {
    fields.message = `Please keep your message to ${LIMITS.message} characters or fewer.`;
  }

  if (companyName.length > LIMITS.companyName) {
    fields.companyName = `Please keep the company name to ${LIMITS.companyName} characters or fewer.`;
  }

  if (phone.length > LIMITS.phone) {
    fields.phone = `Please keep the phone number to ${LIMITS.phone} characters or fewer.`;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    data: {
      fullName: fullName.slice(0, LIMITS.fullName),
      email: email.slice(0, LIMITS.email),
      serviceInterest: serviceInterest.slice(0, LIMITS.serviceInterest),
      message: message.slice(0, LIMITS.message),
      companyName: companyName.slice(0, LIMITS.companyName),
      phone: phone.slice(0, LIMITS.phone),
    },
  };
}
