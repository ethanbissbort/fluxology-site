/**
 * RFC 5322 rendering/parsing round-trips, SMTP transport against a scripted
 * mock server (incl. dot-stuffing and ambiguous-outcome behavior), and reply
 * threading (SDD v2 §B5/§B6).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderEml, parseEml, normalizeSubject } from '../src/eml.mjs';
import { SmtpTransport } from '../src/transports.mjs';
import { buildMailServer } from '../src/server.mjs';
import { recordDecision } from '../../mcp-core/approval.mjs';

function mailServer(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mcp-test-'));
  return { ...buildMailServer({ env: { FLUXOLOGY_MAIL_DATA_DIR: dataDir, FLUXOLOGY_MAIL_FROM: 'Ethan Bissbort <ethan@fluxology.ca>', ...extraEnv } }), dataDir };
}

async function call(server, name, args = {}) {
  const response = await server.handleMessage({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method: 'tools/call', params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } });
  return { isError: response.result?.isError, value: response.result?.structuredContent, error: response.error };
}

test('renderEml/parseEml round-trip preserves headers, unicode, and body', () => {
  const eml = renderEml({
    from: 'Ethan Bissbort <ethan@fluxology.ca>',
    to: ['Sales Team <sales@managedco.example.com>', 'leasing@managedco.example.com'],
    cc: ['ops@fluxology.ca'],
    subject: 'Private office — café & 24/7 HVAC questions ☕',
    messageId: '<msg_test123@fluxology.ca>',
    inReplyTo: '<abc@managedco.example.com>',
    references: ['<root@managedco.example.com>', '<abc@managedco.example.com>'],
    bodyText: 'Line one.\nLine two with unicode: 350 pi².\n.A line starting with a dot.\n',
  });
  // No raw line exceeds RFC 5322 limits.
  for (const line of eml.split('\r\n')) assert.ok(line.length <= 998, `line too long: ${line.length}`);

  const parsed = parseEml(eml);
  assert.equal(parsed.subject, 'Private office — café & 24/7 HVAC questions ☕');
  assert.match(parsed.from, /ethan@fluxology\.ca/);
  assert.equal(parsed.message_id, '<msg_test123@fluxology.ca>');
  assert.equal(parsed.in_reply_to, '<abc@managedco.example.com>');
  assert.deepEqual(parsed.references, ['<root@managedco.example.com>', '<abc@managedco.example.com>']);
  assert.match(parsed.body, /unicode: 350 pi²/);
  assert.match(parsed.body, /^\.A line starting with a dot\.$/m);
});

test('parseEml handles quoted-printable and multipart, preferring text/plain', () => {
  const qp = 'From: a@b.c\r\nSubject: =?UTF-8?Q?caf=C3=A9_update?=\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nPrice =3D C$750/month caf=C3=A9 included=\r\n and more.';
  const parsedQp = parseEml(qp);
  assert.equal(parsedQp.subject, 'café update');
  assert.match(parsedQp.body, /Price = C\$750\/month café included and more\./);

  const multipart = [
    'From: sales@x.com',
    'Subject: Quote',
    'Content-Type: multipart/alternative; boundary="BOUND"',
    '',
    '--BOUND',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>HTML version</p>',
    '--BOUND',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Plain version: C$795 all-in.',
    '--BOUND--',
  ].join('\r\n');
  const parsedMp = parseEml(multipart);
  assert.match(parsedMp.body, /Plain version: C\$795 all-in\./);
});

/** Scripted SMTP server; records the DATA payload it receives. */
function mockSmtp({ rejectRcpt = false, dieAfterData = false } = {}) {
  const received = { data: null, commands: [] };
  const server = net.createServer((socket) => {
    let collectingData = false;
    let dataBuf = '';
    socket.write('220 mock ESMTP\r\n');
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (collectingData) {
        dataBuf += text;
        if (dataBuf.includes('\r\n.\r\n')) {
          received.data = dataBuf.slice(0, dataBuf.indexOf('\r\n.\r\n'));
          collectingData = false;
          if (dieAfterData) {
            socket.destroy(); // ambiguous: DATA transmitted, no reply
            return;
          }
          socket.write('250 2.0.0 accepted queued as MOCK1\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        received.commands.push(line);
        if (line.startsWith('EHLO')) socket.write('250-mock\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 ok\r\n');
        else if (line.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
        else if (line.startsWith('RCPT TO')) socket.write(rejectRcpt ? '550 no such user\r\n' : '250 ok\r\n');
        else if (line === 'DATA') {
          collectingData = true;
          dataBuf = '';
          socket.write('354 go\r\n');
        } else if (line === 'QUIT') socket.write('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received })));
}

function plaintextSmtp(port) {
  // allowPlaintext is the dev/test-only escape hatch (FLUXOLOGY_MAIL_SMTP_ALLOW_PLAINTEXT).
  return { host: '127.0.0.1', port, user: 'ethan', pass: 'secret', secure: false, allowPlaintext: true, timeoutMs: 3000 };
}

test('SMTP transport: full session with AUTH, dot-stuffing on the wire, receipt recorded', async () => {
  const { server, port, received } = await mockSmtp();
  try {
    const transport = new SmtpTransport({ smtp: plaintextSmtp(port) });
    const eml = 'Subject: t\r\n\r\nbody line\r\n.dot line\r\n';
    const receipt = await transport.send({ eml, envelope: { from: 'ethan@fluxology.ca', to: ['sales@x.com'] } });
    assert.equal(receipt.kind, 'smtp');
    assert.match(receipt.accepted, /queued as MOCK1/);
    assert.ok(received.commands.some((c) => c.startsWith('AUTH PLAIN')));
    assert.ok(received.commands.some((c) => c === 'MAIL FROM:<ethan@fluxology.ca>'));
    assert.ok(received.commands.some((c) => c === 'RCPT TO:<sales@x.com>'));
    assert.match(received.data, /\r\n\.\.dot line/); // dot-stuffed on the wire
  } finally {
    server.close();
  }
});

test('SMTP definite rejection is SEND_FAILED; connection death after DATA is OUTCOME_UNKNOWN', async () => {
  // RCPT rejection: definite failure before DATA → SEND_FAILED.
  const rejecting = await mockSmtp({ rejectRcpt: true });
  try {
    const transport = new SmtpTransport({ smtp: plaintextSmtp(rejecting.port) });
    await assert.rejects(
      () => transport.send({ eml: 'Subject: x\r\n\r\nb\r\n', envelope: { from: 'a@b.c', to: ['bad@x.com'] } }),
      (err) => err.code === 'SEND_FAILED' && /no such user/.test(err.data?.reply ?? err.message),
    );
  } finally {
    rejecting.server.close();
  }

  // Death after DATA was transmitted → OUTCOME_UNKNOWN, surfaced through the full service.
  const dying = await mockSmtp({ dieAfterData: true });
  try {
    const { server, store, service } = mailServer();
    service.transport = new SmtpTransport({ smtp: plaintextSmtp(dying.port) });

    const prep = await call(server, 'mail_prepare_message', { to: ['sales@x.com'], subject: 'T', body: 'B' });
    const messageId = prep.value.message_id;
    const request = await call(server, 'mail_request_approval', { message_id: messageId });
    recordDecision(store, { subjectId: messageId, contentHash: request.value.content_hash, decision: 'approve', approver: 'local-cli' });
    const send = await call(server, 'mail_send', { message_id: messageId });
    assert.equal(send.isError, true);
    assert.equal(send.value.error.code, 'OUTCOME_UNKNOWN');
    assert.equal(service.getMessage(messageId).state, 'OUTCOME_UNKNOWN');
    assert.match(send.value.error.message, /never auto-resend/);
  } finally {
    dying.server.close();
  }
});

test('reply threading: references match, heuristic subject match is flagged, provenance recorded', async () => {
  const { server, store, service } = mailServer();
  const prep = await call(server, 'mail_prepare_message', { to: ['sales@managedco.example.com'], subject: 'Office inquiry', body: 'Q' });
  const messageId = prep.value.message_id;
  const request = await call(server, 'mail_request_approval', { message_id: messageId });
  recordDecision(store, { subjectId: messageId, contentHash: request.value.content_hash, decision: 'approve', approver: 'local-cli' });
  const sent = await call(server, 'mail_send', { message_id: messageId });
  const rfcId = sent.value.rfc_message_id;

  // A reply that references our Message-ID lands in the same thread.
  const reply = [
    'From: Sales <sales@managedco.example.com>',
    'To: ethan@fluxology.ca',
    'Subject: Re: Office inquiry',
    'Message-ID: <reply1@managedco.example.com>',
    `In-Reply-To: ${rfcId}`,
    `References: ${rfcId}`,
    '',
    'Our private office is C$795/month plus HST. It is 190 sq ft with a locking door.',
  ].join('\r\n');
  const ingest = await call(server, 'mail_ingest_paste', { raw: reply });
  assert.equal(ingest.isError, false);
  assert.equal(ingest.value.thread_id, prep.value.thread_id);
  assert.equal(ingest.value.thread_match, 'references');
  assert.equal(ingest.value.provenance, 'PASTED_TEXT');

  // A reply with no references but a matching normalized subject is heuristic.
  const heuristic = await call(server, 'mail_ingest_paste', { raw: 'no headers here', from: 'other@managedco.example.com', subject: 'RE: office inquiry' });
  assert.equal(heuristic.value.thread_id, prep.value.thread_id);
  assert.equal(heuristic.value.thread_match, 'heuristic');
  assert.equal(normalizeSubject('RE: Fwd: Office inquiry'), 'office inquiry');

  // mail_prepare_reply chains In-Reply-To/References to the inbound message.
  const replyDraft = await call(server, 'mail_prepare_reply', { thread_id: prep.value.thread_id, body: 'Thanks — does that include after-hours HVAC?' });
  assert.equal(replyDraft.isError, false);
  const draft = service.getMessage(replyDraft.value.message_id);
  assert.equal(draft.in_reply_to, '<reply1@managedco.example.com>');
  assert.ok(draft.references.includes(rfcId));
  assert.deepEqual(draft.to, ['sales@managedco.example.com']);
  assert.equal(draft.subject, 'Re: Office inquiry');

  // Thread view holds all four messages in order.
  const thread = await call(server, 'mail_thread_get', { thread_id: prep.value.thread_id });
  assert.equal(thread.value.messages.length, 4);
});

test('mail_ingest_scan processes .eml files from the inbox directory', async () => {
  const { server, config } = mailServer();
  fs.mkdirSync(config.inboxDir, { recursive: true });
  fs.writeFileSync(path.join(config.inboxDir, 'reply-a.eml'), 'From: p@q.r\r\nSubject: Quote follow-up\r\nMessage-ID: <z1@q.r>\r\n\r\nAll-in is C$810.', 'utf8');
  const scan = await call(server, 'mail_ingest_scan', {});
  assert.equal(scan.isError, false);
  assert.equal(scan.value.scanned, 1);
  assert.equal(scan.value.results[0].thread_match, 'new_thread');
  assert.ok(fs.existsSync(path.join(config.inboxDir, 'reply-a.eml.ingested')));
  const rescan = await call(server, 'mail_ingest_scan', {});
  assert.equal(rescan.value.scanned, 0); // ingested files are not reprocessed
});
