/**
 * Out-of-band human approval records (SDD v2 §0.7 / audit A3).
 *
 * The MCP tool surface can REQUEST an approval and VERIFY/CONSUME one, but a
 * grant can only be produced by the local CLI (`bin/approve.mjs`), which the
 * human operator runs in a terminal the model does not control. Approvals bind
 * a subject id to the SHA-256 hash of the exact frozen content, are single-use,
 * and are consumed atomically via a filesystem lock so parallel side-effect
 * calls can never double-execute.
 */
import { nowIso } from './ids.mjs';

const LEDGER = 'approvals';

export function requestApproval(store, { subjectId, contentHash, kind, summary }) {
  store.appendEvent(LEDGER, {
    type: 'approval_requested',
    subject_id: subjectId,
    content_hash: contentHash,
    kind,
    summary,
    at: nowIso(),
  });
  return {
    instruction:
      `Human approval required. Review the frozen content above, then in a terminal run:\n` +
      `  node bin/approve.mjs approve ${subjectId} --hash ${contentHash.slice(0, 12)}\n` +
      `(or: node bin/approve.mjs reject ${subjectId}) from the server package directory. ` +
      `Approval is granted only through that CLI; no MCP tool can grant it.`,
  };
}

export function recordDecision(store, { subjectId, contentHash, decision, approver }) {
  if (decision !== 'approve' && decision !== 'reject') throw new Error(`bad decision: ${decision}`);
  const event = {
    type: 'approval_decision',
    subject_id: subjectId,
    content_hash: contentHash,
    decision,
    approver,
    at: nowIso(),
  };
  store.appendEvent(LEDGER, event);
  return event;
}

export function approvalState(store, subjectId, contentHash) {
  const events = store.readEvents(LEDGER, (e) => e.subject_id === subjectId);
  const decisions = events.filter((e) => e.type === 'approval_decision' && e.content_hash === contentHash);
  const latest = decisions[decisions.length - 1] ?? null;
  const requested = events.some((e) => e.type === 'approval_requested' && e.content_hash === contentHash);
  const consumed = store.hasLock(`consume_${contentHash}`);
  return {
    requested,
    decision: latest ? latest.decision : null,
    decided_at: latest ? latest.at : null,
    approver: latest ? latest.approver : null,
    consumed,
  };
}

/**
 * Verify an approval and consume it in the same step. Returns an error code
 * string on failure, or null when this caller has exclusively consumed the
 * approval and may proceed with the side effect.
 */
export function verifyAndConsume(store, subjectId, contentHash) {
  const state = approvalState(store, subjectId, contentHash);
  if (!state.decision) return 'APPROVAL_MISSING';
  if (state.decision !== 'approve') return 'APPROVAL_REJECTED';
  if (state.consumed) return 'APPROVAL_CONSUMED';
  const won = store.acquireLock(`consume_${contentHash}`, { subject_id: subjectId });
  if (!won) return 'APPROVAL_CONSUMED';
  store.appendEvent(LEDGER, { type: 'approval_consumed', subject_id: subjectId, content_hash: contentHash, at: nowIso() });
  return null;
}

export function listPending(store) {
  const events = store.readEvents(LEDGER);
  const bySubject = new Map();
  for (const e of events) {
    const entry = bySubject.get(e.subject_id) ?? { requests: [], decisions: [] };
    if (e.type === 'approval_requested') entry.requests.push(e);
    if (e.type === 'approval_decision') entry.decisions.push(e);
    bySubject.set(e.subject_id, entry);
  }
  const pending = [];
  for (const [subjectId, entry] of bySubject) {
    const lastRequest = entry.requests[entry.requests.length - 1];
    if (!lastRequest) continue;
    const decided = entry.decisions.some((d) => d.content_hash === lastRequest.content_hash);
    if (!decided) pending.push(lastRequest);
  }
  return pending;
}

/**
 * Shared CLI used by both servers' bin/approve.mjs. The `resolveSubject`
 * callback returns { contentHash, render } for a subject id so the CLI can
 * re-display the exact frozen content before the human decides.
 */
export function runApprovalCli(store, argv, { kindLabel, resolveSubject }) {
  const [command, subjectId] = argv;
  const out = (s) => process.stdout.write(s + '\n');

  if (command === 'list' || command === undefined) {
    const pending = listPending(store);
    if (pending.length === 0) {
      out(`No ${kindLabel} awaiting approval.`);
      return 0;
    }
    out(`${kindLabel} awaiting approval:`);
    for (const p of pending) out(`  ${p.subject_id}  hash=${p.content_hash.slice(0, 12)}  ${p.summary ?? ''}`);
    out(`Inspect one with: node bin/approve.mjs show <id>`);
    return 0;
  }

  if (!subjectId) {
    out(`usage: node bin/approve.mjs [list|show <id>|approve <id> --hash <prefix>|reject <id>]`);
    return 2;
  }

  const subject = resolveSubject(subjectId);
  if (!subject) {
    out(`Unknown ${kindLabel} subject: ${subjectId}`);
    return 1;
  }

  if (command === 'show') {
    out(subject.render());
    out(`content hash: ${subject.contentHash}`);
    return 0;
  }

  if (command === 'approve') {
    const hashFlag = argv.indexOf('--hash');
    const prefix = hashFlag !== -1 ? argv[hashFlag + 1] : null;
    if (!prefix || !subject.contentHash.startsWith(prefix)) {
      out(subject.render());
      out(`Refused: pass --hash ${subject.contentHash.slice(0, 12)} after reviewing the content above.`);
      return 1;
    }
    out(subject.render());
    recordDecision(store, { subjectId, contentHash: subject.contentHash, decision: 'approve', approver: 'local-cli' });
    out(`Approved ${subjectId} (hash ${subject.contentHash.slice(0, 12)}). The server may now execute it exactly once.`);
    return 0;
  }

  if (command === 'reject') {
    recordDecision(store, { subjectId, contentHash: subject.contentHash, decision: 'reject', approver: 'local-cli' });
    out(`Rejected ${subjectId}.`);
    return 0;
  }

  out(`unknown command: ${command}`);
  return 2;
}
