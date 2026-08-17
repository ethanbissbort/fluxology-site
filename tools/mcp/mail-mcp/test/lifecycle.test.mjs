/**
 * Mail lifecycle tests (SDD v2 §B3, §C2): freeze→approve→send-exactly-once,
 * hash invalidation on edit, consumed approvals cannot replay, SEND_FAILED
 * consumes approval, OUTCOME_UNKNOWN never auto-resends, cancellation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMailServer } from '../src/server.mjs';
import { recordDecision, verifyAndConsume } from '../../mcp-core/approval.mjs';
import { DataDirUnsafeError } from '../../mcp-core/store.mjs';
import { PACKAGE_DIR } from '../src/config.mjs';

function mailServer(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mcp-test-'));
  const built = buildMailServer({
    env: { FLUXOLOGY_MAIL_DATA_DIR: dataDir, FLUXOLOGY_MAIL_FROM: 'Ethan Bissbort <ethan@fluxology.ca>', ...extraEnv },
  });
  return { ...built, dataDir };
}

async function call(server, name, args = {}) {
  const response = await server.handleMessage({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9),
    method: 'tools/call',
    params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
  });
  if (response.error) throw new Error(`protocol error: ${JSON.stringify(response.error)}`);
  return { isError: response.result.isError, value: response.result.structuredContent };
}

const DRAFT = {
  to: ['sales@managedco.example.com'],
  subject: 'One-person private office inquiry',
  body: 'Hi — I run Fluxology Inc. and am looking for a fully enclosed private office. Is access 24/7, and is the suite air-conditioned late nights and weekends?',
};

test('freeze → approve → send exactly once via outbox transport', async () => {
  const { server, store, dataDir } = mailServer();
  const prep = await call(server, 'mail_prepare_message', DRAFT);
  const messageId = prep.value.message_id;

  // Send before approval fails closed.
  const early = await call(server, 'mail_send', { message_id: messageId });
  assert.equal(early.isError, true);
  assert.equal(early.value.error.code, 'APPROVAL_MISSING');

  const request = await call(server, 'mail_request_approval', { message_id: messageId });
  const hash = request.value.content_hash;
  assert.match(request.value.approval_instruction, /approve\.mjs approve/);
  assert.equal(request.value.frozen_content.subject, DRAFT.subject);

  // No approval-granting tool exists on the surface.
  const tools = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } });
  assert.ok(!tools.result.tools.some((t) => /approve|grant/.test(t.name) && t.name !== 'mail_approval_status'), 'no tool may grant approval');

  recordDecision(store, { subjectId: messageId, contentHash: hash, decision: 'approve', approver: 'local-cli' });
  const send = await call(server, 'mail_send', { message_id: messageId });
  assert.equal(send.isError, false);
  assert.equal(send.value.state, 'SENT');
  assert.match(send.value.rfc_message_id, /^<msg_[a-z0-9]+@fluxology\.ca>$/);
  const emlPath = send.value.receipt.path;
  assert.ok(emlPath.startsWith(dataDir), 'outbox file lives under the data root');
  const eml = fs.readFileSync(emlPath, 'utf8');
  assert.match(eml, /Subject: One-person private office inquiry/);
  assert.match(eml, /Content-Transfer-Encoding: base64/);

  // Second send does not resend.
  const again = await call(server, 'mail_send', { message_id: messageId });
  assert.equal(again.isError, false);
  assert.match(again.value.note, /not resending/);
});

test('editing after freezing voids the approval by hash construction', async () => {
  const { server, store, service } = mailServer();
  const prep = await call(server, 'mail_prepare_message', DRAFT);
  const messageId = prep.value.message_id;
  const request = await call(server, 'mail_request_approval', { message_id: messageId });
  recordDecision(store, { subjectId: messageId, contentHash: request.value.content_hash, decision: 'approve', approver: 'local-cli' });

  // A frozen message cannot be edited directly…
  const editFrozen = await call(server, 'mail_update_draft', { message_id: messageId, body: 'changed' });
  assert.equal(editFrozen.isError, true);

  // …and content mutated any other way fails the pre-send hash recomputation.
  service.messages.upsert({ message_id: messageId, body: 'attacker changed the body after approval' });
  const send = await call(server, 'mail_send', { message_id: messageId });
  assert.equal(send.isError, true);
  assert.equal(send.value.error.code, 'APPROVAL_STALE');

  // The legitimate path: unfreeze → edit → refreeze produces a NEW hash needing NEW approval.
  const unfrozen = await call(server, 'mail_unfreeze', { message_id: messageId });
  assert.equal(unfrozen.value.state, 'DRAFT');
  await call(server, 'mail_update_draft', { message_id: messageId, body: 'Revised body.' });
  const request2 = await call(server, 'mail_request_approval', { message_id: messageId });
  assert.notEqual(request2.value.content_hash, request.value.content_hash);
  const sendOld = await call(server, 'mail_send', { message_id: messageId });
  assert.equal(sendOld.isError, true); // old approval does not match the new hash
  assert.equal(sendOld.value.error.code, 'APPROVAL_MISSING');
});

test('an approval is consumed exactly once, even under parallel sends', async () => {
  const { server, store } = mailServer();
  const prep = await call(server, 'mail_prepare_message', DRAFT);
  const messageId = prep.value.message_id;
  const request = await call(server, 'mail_request_approval', { message_id: messageId });
  recordDecision(store, { subjectId: messageId, contentHash: request.value.content_hash, decision: 'approve', approver: 'local-cli' });

  assert.equal(verifyAndConsume(store, messageId, request.value.content_hash), null);
  assert.equal(verifyAndConsume(store, messageId, request.value.content_hash), 'APPROVAL_CONSUMED');
});

test('rejected messages cannot send; cancellation is terminal for drafts', async () => {
  const { server, store } = mailServer();
  const prep = await call(server, 'mail_prepare_message', DRAFT);
  const messageId = prep.value.message_id;
  const request = await call(server, 'mail_request_approval', { message_id: messageId });
  recordDecision(store, { subjectId: messageId, contentHash: request.value.content_hash, decision: 'reject', approver: 'local-cli' });
  const send = await call(server, 'mail_send', { message_id: messageId });
  assert.equal(send.isError, true);
  assert.equal(send.value.error.code, 'APPROVAL_REJECTED');

  const prep2 = await call(server, 'mail_prepare_message', DRAFT);
  const cancelled = await call(server, 'mail_cancel', { message_id: prep2.value.message_id });
  assert.equal(cancelled.value.state, 'CANCELLED');
  const sendCancelled = await call(server, 'mail_send', { message_id: prep2.value.message_id });
  assert.equal(sendCancelled.isError, true);
});

test('SEND_FAILED consumes the approval; OUTCOME_UNKNOWN never auto-resends', async () => {
  const { server, store, service } = mailServer();
  // Force transport failure.
  service.transport = { describe: () => ({ kind: 'failing' }), send: async () => { throw Object.assign(new Error('boom'), { code: 'SEND_FAILED' }); } };
  const prep = await call(server, 'mail_prepare_message', DRAFT);
  const messageId = prep.value.message_id;
  const request = await call(server, 'mail_request_approval', { message_id: messageId });
  recordDecision(store, { subjectId: messageId, contentHash: request.value.content_hash, decision: 'approve', approver: 'local-cli' });
  const failed = await call(server, 'mail_send', { message_id: messageId });
  assert.equal(failed.isError, true);
  assert.equal(failed.value.error.code, 'SEND_FAILED');
  assert.equal(service.getMessage(messageId).state, 'SEND_FAILED');
  assert.match(failed.value.error.message, /re-approve to retry/);

  // Retry without a fresh approval: the consumed approval cannot be replayed.
  service.messages.upsert({ message_id: messageId, state: 'FROZEN' });
  const replay = await call(server, 'mail_send', { message_id: messageId });
  assert.equal(replay.isError, true);
  assert.equal(replay.value.error.code, 'APPROVAL_CONSUMED');

  // Ambiguous outcome is terminal for automation.
  const prep2 = await call(server, 'mail_prepare_message', DRAFT);
  service.messages.upsert({ message_id: prep2.value.message_id, state: 'OUTCOME_UNKNOWN' });
  const retry = await call(server, 'mail_send', { message_id: prep2.value.message_id });
  assert.equal(retry.isError, true);
  assert.equal(retry.value.error.code, 'OUTCOME_UNKNOWN');
});

test('sending requires FLUXOLOGY_MAIL_FROM; data root inside the package is refused', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mcp-test-'));
  const { server } = buildMailServer({ env: { FLUXOLOGY_MAIL_DATA_DIR: dataDir } });
  const prep = await call(server, 'mail_prepare_message', DRAFT);
  assert.equal(prep.isError, true);
  assert.equal(prep.value.error.code, 'VALIDATION_FAILED');
  assert.match(prep.value.error.message, /FLUXOLOGY_MAIL_FROM/);

  assert.throws(() => buildMailServer({ env: { FLUXOLOGY_MAIL_DATA_DIR: path.join(PACKAGE_DIR, 'data') } }), DataDirUnsafeError);
});
