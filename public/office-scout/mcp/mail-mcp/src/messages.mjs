/**
 * Message lifecycle and threading (SDD v2 §B2/§B3/§B6).
 *
 *   DRAFT → FROZEN → AWAITING_APPROVAL → APPROVED → SENDING → SENT
 *     │        │            │                          ├→ SEND_FAILED
 *     │        └→ (unfreeze) DRAFT                     └→ OUTCOME_UNKNOWN
 *     └→ CANCELLED (any pre-SENDING state)
 *
 * Freezing canonicalizes the exact wire-relevant content (from/to/cc/subject/
 * threading headers/body) and hashes it; approval binds that hash; sending
 * consumes the approval atomically (at-most-once) and executes the transport.
 * A consumed approval is spent — retrying a SEND_FAILED message requires
 * re-approval. OUTCOME_UNKNOWN is terminal for automation.
 */
import { newId, nowIso, sha256Hex, canonicalJson } from '../../mcp-core/ids.mjs';
import { requestApproval, verifyAndConsume, approvalState } from '../../mcp-core/approval.mjs';
import { renderEml, parseEml, normalizeSubject } from './eml.mjs';

function foldEntity(events) {
  let entity = null;
  for (const e of events) {
    if (e.type === 'upsert') entity = { ...(entity ?? {}), ...e.data, updated_at: e.at };
  }
  return entity;
}

class Ledger {
  constructor(store, ledger, idField, idPrefix) {
    this.store = store;
    this.ledger = ledger;
    this.idField = idField;
    this.idPrefix = idPrefix;
  }

  upsert(data) {
    const id = data[this.idField] ?? newId(this.idPrefix);
    this.store.appendEvent(this.ledger, { type: 'upsert', at: nowIso(), id, data: { ...data, [this.idField]: id } });
    return this.get(id);
  }

  get(id) {
    return foldEntity(this.store.readEvents(this.ledger, (e) => e.id === id));
  }

  list(filter) {
    const byId = new Map();
    for (const e of this.store.readEvents(this.ledger)) {
      if (!byId.has(e.id)) byId.set(e.id, []);
      byId.get(e.id).push(e);
    }
    const all = [...byId.values()].map(foldEntity).filter(Boolean);
    return filter ? all.filter(filter) : all;
  }
}

const EDITABLE_FIELDS = ['to', 'cc', 'subject', 'body', 'outreach_ref'];
const PRE_SENDING = ['DRAFT', 'FROZEN', 'AWAITING_APPROVAL', 'APPROVED'];

export class MailService {
  constructor({ store, config, transport }) {
    this.store = store;
    this.config = config;
    this.transport = transport;
    this.messages = new Ledger(store, 'messages', 'message_id', 'msg');
    this.threads = new Ledger(store, 'threads', 'thread_id', 'thr');
  }

  requireFrom() {
    if (!this.config.from) throw Object.assign(new Error('FLUXOLOGY_MAIL_FROM is not configured (e.g. "Ethan Bissbort <ethan@fluxology.ca>")'), { code: 'VALIDATION_FAILED' });
    return this.config.from;
  }

  fromDomain() {
    const match = this.requireFrom().match(/@([A-Za-z0-9.-]+)>?$/);
    return match ? match[1].replace(/>$/, '') : 'fluxology.local';
  }

  getMessage(id) {
    const message = this.messages.get(id);
    if (!message) throw Object.assign(new Error(`unknown message ${id}`), { code: 'NOT_FOUND' });
    return message;
  }

  getThread(id) {
    const thread = this.threads.get(id);
    if (!thread) throw Object.assign(new Error(`unknown thread ${id}`), { code: 'NOT_FOUND' });
    return thread;
  }

  prepareMessage({ to, cc = [], subject, body, outreach_ref = null, thread_id = null }) {
    this.requireFrom();
    let thread = thread_id ? this.getThread(thread_id) : null;
    if (!thread) {
      thread = this.threads.upsert({ subject_root: normalizeSubject(subject), participants: [...to, ...cc], status: 'active', message_ids: [] });
    }
    const message = this.messages.upsert({
      direction: 'outbound',
      state: 'DRAFT',
      thread_id: thread.thread_id,
      from: this.config.from,
      to,
      cc,
      subject,
      body,
      outreach_ref,
    });
    this.threads.upsert({ thread_id: thread.thread_id, message_ids: [...thread.message_ids, message.message_id] });
    return message;
  }

  prepareReply({ thread_id, body, subject = null }) {
    const thread = this.getThread(thread_id);
    const messages = thread.message_ids.map((id) => this.messages.get(id)).filter(Boolean);
    if (!messages.length) throw Object.assign(new Error('thread has no messages to reply to'), { code: 'VALIDATION_FAILED' });
    // Chain to the most recent inbound message that carries an RFC
    // Message-ID (heuristic pastes may have none); fall back sensibly.
    const inbound = messages.filter((m) => m.direction === 'inbound');
    const replyTarget = [...inbound].reverse().find((m) => m.rfc_message_id) ?? inbound[inbound.length - 1] ?? messages[messages.length - 1];
    const to = replyTarget.direction === 'inbound'
      ? [extractEmail(replyTarget.from_header)].filter(Boolean)
      : replyTarget.to;
    const references = [...(replyTarget.references ?? []), replyTarget.rfc_message_id].filter(Boolean);
    const strippedSubject = (replyTarget.subject ?? '').replace(/^(\s*(re|fwd?|aw)\s*:\s*)+/i, '');
    const message = this.messages.upsert({
      direction: 'outbound',
      state: 'DRAFT',
      thread_id,
      from: this.requireFrom(),
      to: to.length ? to : replyTarget.to ?? [],
      cc: [],
      subject: subject ?? `Re: ${strippedSubject}`,
      body,
      in_reply_to: replyTarget.rfc_message_id ?? null,
      references,
    });
    this.threads.upsert({ thread_id, message_ids: [...thread.message_ids, message.message_id] });
    return message;
  }

  updateDraft(messageId, fields) {
    const message = this.getMessage(messageId);
    if (message.state !== 'DRAFT') {
      throw Object.assign(new Error(`message ${messageId} is ${message.state}; call mail_unfreeze first to edit`), { code: 'VALIDATION_FAILED' });
    }
    const updates = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!EDITABLE_FIELDS.includes(key)) throw Object.assign(new Error(`field "${key}" is not editable`), { code: 'VALIDATION_FAILED' });
      updates[key] = value;
    }
    return this.messages.upsert({ message_id: messageId, ...updates });
  }

  canonicalContent(message) {
    return {
      from: message.from,
      to: message.to,
      cc: message.cc ?? [],
      subject: message.subject,
      in_reply_to: message.in_reply_to ?? null,
      references: message.references ?? [],
      body: message.body,
    };
  }

  freeze(messageId) {
    const message = this.getMessage(messageId);
    if (!PRE_SENDING.includes(message.state)) {
      throw Object.assign(new Error(`message ${messageId} is ${message.state} and can no longer be frozen`), { code: 'VALIDATION_FAILED' });
    }
    const content = this.canonicalContent(message);
    const hash = sha256Hex(canonicalJson(content));
    const frozen = this.messages.upsert({ message_id: messageId, state: 'FROZEN', content_hash: hash, frozen_at: nowIso() });
    return { message: frozen, frozen_content: content, content_hash: hash };
  }

  unfreeze(messageId) {
    const message = this.getMessage(messageId);
    if (!['FROZEN', 'AWAITING_APPROVAL'].includes(message.state)) {
      throw Object.assign(new Error(`message ${messageId} is ${message.state}; only frozen messages can be unfrozen`), { code: 'VALIDATION_FAILED' });
    }
    return this.messages.upsert({ message_id: messageId, state: 'DRAFT', content_hash: null });
  }

  requestSendApproval(messageId) {
    const message = this.getMessage(messageId);
    if (message.state === 'DRAFT') this.freeze(messageId);
    const fresh = this.getMessage(messageId);
    const updated = this.messages.upsert({ message_id: messageId, state: 'AWAITING_APPROVAL' });
    const { instruction } = requestApproval(this.store, {
      subjectId: messageId,
      contentHash: fresh.content_hash,
      kind: 'outbound_email',
      summary: `to ${fresh.to.join(', ')} — "${fresh.subject}"`,
    });
    return { message: updated, frozen_content: this.canonicalContent(fresh), content_hash: fresh.content_hash, approval_instruction: instruction };
  }

  approvalStatus(messageId) {
    const message = this.getMessage(messageId);
    if (!message.content_hash) return { state: message.state, approval: null };
    return { state: message.state, content_hash: message.content_hash, approval: approvalState(this.store, messageId, message.content_hash) };
  }

  cancel(messageId) {
    const message = this.getMessage(messageId);
    if (!PRE_SENDING.includes(message.state)) {
      throw Object.assign(new Error(`message ${messageId} is ${message.state} and cannot be cancelled`), { code: 'VALIDATION_FAILED' });
    }
    return this.messages.upsert({ message_id: messageId, state: 'CANCELLED', cancelled_at: nowIso() });
  }

  async send(messageId) {
    const message = this.getMessage(messageId);
    if (message.state === 'SENT') {
      return { message_id: messageId, state: 'SENT', note: 'already sent; not resending', receipt: message.transport_receipt ?? null };
    }
    if (message.state === 'OUTCOME_UNKNOWN') {
      throw Object.assign(new Error('previous send outcome is unknown; verify manually before any resend'), { code: 'OUTCOME_UNKNOWN' });
    }
    if (!['AWAITING_APPROVAL', 'APPROVED', 'FROZEN'].includes(message.state)) {
      throw Object.assign(new Error(`message ${messageId} is ${message.state}; freeze and obtain approval first`), { code: 'APPROVAL_MISSING' });
    }

    // The approval must match the CURRENT content exactly.
    const currentHash = sha256Hex(canonicalJson(this.canonicalContent(message)));
    if (currentHash !== message.content_hash) {
      this.messages.upsert({ message_id: messageId, state: 'FROZEN', content_hash: currentHash });
      throw Object.assign(new Error('message content changed since approval was requested; re-request approval'), { code: 'APPROVAL_STALE' });
    }
    const failure = verifyAndConsume(this.store, messageId, currentHash);
    if (failure) {
      const text = {
        APPROVAL_MISSING: 'no human approval on record for this exact message',
        APPROVAL_REJECTED: 'the human operator rejected this message',
        APPROVAL_CONSUMED: 'this approval was already consumed; at most one send is permitted per approval',
      }[failure] ?? failure;
      throw Object.assign(new Error(text), { code: failure });
    }

    this.messages.upsert({ message_id: messageId, state: 'SENDING', sending_at: nowIso() });
    const rfcMessageId = `<${messageId.toLowerCase()}@${this.fromDomain()}>`;
    const eml = renderEml({
      from: message.from,
      to: message.to,
      cc: message.cc ?? [],
      subject: message.subject,
      messageId: rfcMessageId,
      inReplyTo: message.in_reply_to ?? null,
      references: message.references ?? [],
      bodyText: message.body,
    });
    const envelope = { from: extractEmail(message.from), to: [...message.to, ...(message.cc ?? [])].map((a) => extractEmail(a)).filter(Boolean) };

    try {
      const receipt = await this.transport.send({ eml, envelope, messageDbId: messageId });
      const sent = this.messages.upsert({ message_id: messageId, state: 'SENT', rfc_message_id: rfcMessageId, transport_receipt: receipt, sent_at: nowIso() });
      return { message_id: messageId, state: sent.state, rfc_message_id: rfcMessageId, receipt };
    } catch (err) {
      const state = err.code === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'SEND_FAILED';
      this.messages.upsert({ message_id: messageId, state, send_error: { code: err.code, message: err.message, at: nowIso() } });
      throw Object.assign(new Error(`${err.message} (message is now ${state}${state === 'SEND_FAILED' ? '; the approval was consumed — re-approve to retry' : '; never auto-resend'})`), { code: err.code, data: err.data });
    }
  }

  /** Attach an inbound reply to its thread (SDD v2 §B6). */
  ingestInbound(raw, provenance) {
    const parsed = parseEml(raw);
    let thread = null;
    let matchKind = null;

    const refs = [parsed.in_reply_to, ...(parsed.references ?? [])].filter(Boolean);
    if (refs.length) {
      const target = this.messages.list((m) => m.rfc_message_id && refs.some((r) => r.includes(m.rfc_message_id)))[0];
      if (target) {
        thread = this.getThread(target.thread_id);
        matchKind = 'references';
      }
    }
    if (!thread && parsed.subject) {
      const subjectKey = normalizeSubject(parsed.subject);
      thread = this.threads.list((t) => t.subject_root === subjectKey)[0] ?? null;
      if (thread) matchKind = 'heuristic';
    }
    if (!thread) {
      thread = this.threads.upsert({ subject_root: normalizeSubject(parsed.subject), participants: [parsed.from].filter(Boolean), status: 'active', message_ids: [] });
      matchKind = 'new_thread';
    }

    const message = this.messages.upsert({
      direction: 'inbound',
      state: 'RECEIVED',
      thread_id: thread.thread_id,
      from_header: parsed.from,
      to: parsed.to ? [parsed.to] : [],
      subject: parsed.subject,
      body: parsed.body,
      rfc_message_id: parsed.message_id,
      in_reply_to: parsed.in_reply_to,
      references: parsed.references,
      received_date_header: parsed.date,
      provenance,
      thread_match: matchKind,
    });
    this.threads.upsert({ thread_id: thread.thread_id, message_ids: [...thread.message_ids, message.message_id] });
    return { message, thread_id: thread.thread_id, thread_match: matchKind };
  }
}

export function extractEmail(address) {
  if (!address) return null;
  const match = String(address).match(/<([^>]+)>/);
  if (match) return match[1];
  const bare = String(address).trim();
  return /^[^\s@]+@[^\s@]+$/.test(bare) ? bare : null;
}
