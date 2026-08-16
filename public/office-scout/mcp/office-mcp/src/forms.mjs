/**
 * Website inquiry/quote form broker (SDD v2 §A11). Form submission is an
 * external side effect and runs behind the full state machine:
 *
 *   DISCOVERED → PREPARED → FROZEN → AWAITING_APPROVAL → APPROVED
 *     → SUBMITTING → SUBMITTED | FAILED | OUTCOME_UNKNOWN
 *
 * Any field edit after freezing reverts to PREPARED (the approval binds the
 * SHA-256 of the canonicalized fields, so a changed field is a changed hash).
 * Submission is at-most-once via atomic approval consumption; an ambiguous
 * outcome is never retried automatically. With submission disabled by
 * configuration, an approved submit executes in record-and-hold mode: the
 * exact request is persisted for manual execution and the state machine
 * completes as SUBMITTED (held).
 */
import { canonicalJson, sha256Hex, nowIso, newId } from '../../mcp-core/ids.mjs';
import { requestApproval, verifyAndConsume, approvalState } from '../../mcp-core/approval.mjs';

export function canonicalizeFields(fields) {
  const normalized = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    normalized[key.trim()] = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : value;
  }
  return normalized;
}

export function formContentHash({ target_url, method, fields }) {
  return sha256Hex(canonicalJson({ target_url, method, fields }));
}

export class FormBroker {
  constructor({ repos, store, fetcher, config }) {
    this.repos = repos;
    this.store = store;
    this.fetcher = fetcher;
    this.config = config;
  }

  get(submissionId) {
    const record = this.repos.forms.get(submissionId);
    if (!record) throw Object.assign(new Error(`unknown form submission ${submissionId}`), { code: 'NOT_FOUND' });
    return record;
  }

  prepare({ target_url, method = 'POST', fields, provider_id = null, discovered_fields = null, notes = null }) {
    const normalized = canonicalizeFields(fields);
    return this.repos.forms.upsert({
      target_url,
      method: method.toUpperCase(),
      fields: normalized,
      provider_id,
      discovered_fields,
      notes,
      state: 'PREPARED',
      idempotency_key: newId('idem'),
    });
  }

  /** Edit fields — legal only before submission; always lands back in PREPARED. */
  update(submissionId, fields) {
    const record = this.get(submissionId);
    if (['SUBMITTING', 'SUBMITTED'].includes(record.state)) {
      throw Object.assign(new Error(`form ${submissionId} is ${record.state}; it can no longer be edited`), { code: 'VALIDATION_FAILED' });
    }
    return this.repos.forms.upsert({
      submission_id: submissionId,
      fields: canonicalizeFields({ ...record.fields, ...fields }),
      state: 'PREPARED',
      content_hash: null, // previous freeze/approval void by construction
    });
  }

  freezeAndRequestApproval(submissionId) {
    const record = this.get(submissionId);
    if (record.state === 'SUBMITTED' || record.state === 'SUBMITTING') {
      throw Object.assign(new Error(`form ${submissionId} already ${record.state}`), { code: 'VALIDATION_FAILED' });
    }
    const contentHash = formContentHash(record);
    const frozen = this.repos.forms.upsert({ submission_id: submissionId, state: 'AWAITING_APPROVAL', content_hash: contentHash, frozen_at: nowIso() });
    const { instruction } = requestApproval(this.store, {
      subjectId: submissionId,
      contentHash,
      kind: 'form_submission',
      summary: `${record.method} ${record.target_url}`,
    });
    return { submission: frozen, exact_fields: frozen.fields, content_hash: contentHash, approval_instruction: instruction };
  }

  status(submissionId) {
    const record = this.get(submissionId);
    const approval = record.content_hash ? approvalState(this.store, submissionId, record.content_hash) : null;
    return { ...record, approval };
  }

  async submit(submissionId) {
    const record = this.get(submissionId);
    if (record.state === 'SUBMITTED') {
      return { submission_id: submissionId, state: 'SUBMITTED', note: 'already submitted; not resubmitting', outcome: record.outcome ?? null };
    }
    if (record.state === 'OUTCOME_UNKNOWN') {
      throw Object.assign(new Error('previous submission outcome is unknown; manual verification required before any resubmission'), { code: 'FORM_OUTCOME_UNKNOWN' });
    }
    if (record.state !== 'AWAITING_APPROVAL' && record.state !== 'APPROVED') {
      throw Object.assign(new Error(`form ${submissionId} is ${record.state}; freeze and obtain approval first`), { code: 'FORM_APPROVAL_REQUIRED' });
    }

    // Recompute the hash immediately before submission: the approval must
    // match the CURRENT content exactly.
    const currentHash = formContentHash(record);
    if (currentHash !== record.content_hash) {
      this.repos.forms.upsert({ submission_id: submissionId, state: 'PREPARED', content_hash: null });
      throw Object.assign(new Error('frozen content changed since approval was requested; re-freeze and re-approve'), { code: 'APPROVAL_STALE' });
    }
    const failure = verifyAndConsume(this.store, submissionId, currentHash);
    if (failure) {
      const message = {
        APPROVAL_MISSING: 'no human approval on record for this exact content',
        APPROVAL_REJECTED: 'the human operator rejected this submission',
        APPROVAL_CONSUMED: 'this approval was already consumed; at most one submission is permitted',
      }[failure] ?? failure;
      throw Object.assign(new Error(message), { code: failure });
    }

    this.repos.forms.upsert({ submission_id: submissionId, state: 'SUBMITTING', submitting_at: nowIso() });

    if (!this.config.formSubmitEnabled) {
      const held = this.repos.forms.upsert({
        submission_id: submissionId,
        state: 'SUBMITTED',
        outcome: {
          mode: 'record_and_hold',
          note: 'FLUXOLOGY_OFFICE_FORM_SUBMIT_ENABLED is not set; the exact approved request was persisted for manual execution and will not be sent by the server.',
          request: { url: record.target_url, method: record.method, fields: record.fields },
          at: nowIso(),
        },
      });
      return { submission_id: submissionId, state: held.state, outcome: held.outcome };
    }

    const body = new URLSearchParams(record.fields).toString();
    const result = await this.fetcher.fetchUrl(record.target_url, {
      method: record.method,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!result.ok) {
      // Distinguish "definitely not sent" from "may have been sent".
      const definitelyNotSent = ['NETWORK_DISABLED', 'HOST_NOT_ALLOWED', 'ROBOTS_DISALLOWED', 'VALIDATION_FAILED'].includes(result.error);
      const state = definitelyNotSent ? 'FAILED' : 'OUTCOME_UNKNOWN';
      const updated = this.repos.forms.upsert({ submission_id: submissionId, state, outcome: { mode: 'network', error: result.error, detail: result.detail, at: nowIso() } });
      return { submission_id: submissionId, state: updated.state, outcome: updated.outcome, note: state === 'OUTCOME_UNKNOWN' ? 'outcome ambiguous; will NOT auto-resubmit' : undefined };
    }

    const succeeded = result.status >= 200 && result.status < 400;
    const updated = this.repos.forms.upsert({
      submission_id: submissionId,
      state: succeeded ? 'SUBMITTED' : 'FAILED',
      outcome: { mode: 'network', http_status: result.status, confirmation_excerpt: (result.body ?? '').slice(0, 500), final_url: result.final_url, at: nowIso() },
    });
    return { submission_id: submissionId, state: updated.state, outcome: updated.outcome };
  }
}
