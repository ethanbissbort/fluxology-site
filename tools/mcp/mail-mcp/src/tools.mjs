/**
 * Mail MCP tool surface (SDD v2 §B4). Mail MCP validates PROCESS, not
 * content: Office MCP checks facts; this server enforces freeze → human
 * approval → send-exactly-once, and keeps thread state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { nowIso } from '../../mcp-core/ids.mjs';
import { ToolError } from '../../mcp-core/jsonrpc.mjs';

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const EXTERNAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

const EMAIL_LIST = { type: 'array', items: { type: 'string', minLength: 3 }, minItems: 1 };

export function buildTools({ config, service, transport }) {
  const tools = [];
  const t = (name, title, description, inputSchema, annotations, handler) =>
    tools.push({ name, title, description, inputSchema, annotations, handler });
  const idParam = (name, desc) => ({ type: 'object', properties: { [name]: { type: 'string', description: desc } }, required: [name], additionalProperties: false });

  t('mail_health', 'Mail MCP health', 'Transport and configuration readiness (booleans only; no secrets).', { type: 'object', additionalProperties: false }, READ, async () => ({
    server: 'fluxology-mail-mcp',
    time: nowIso(),
    data_root: config.dataDir,
    from_configured: Boolean(config.from),
    transport: transport.describe(),
    inbox_dir: config.inboxDir,
    smtp_configured: Boolean(config.smtp.host),
    messages_total: service.messages.list().length,
    awaiting_approval: service.messages.list((m) => m.state === 'AWAITING_APPROVAL').length,
  }));

  t('mail_prepare_message', 'Prepare outbound message', 'Create a DRAFT outbound message (optionally bound to an Office MCP outreach package via outreach_ref). Nothing is frozen or sent.',
    {
      type: 'object',
      properties: {
        to: EMAIL_LIST,
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string', minLength: 1 },
        body: { type: 'string', minLength: 1 },
        outreach_ref: { type: 'string' },
        thread_id: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
    WRITE,
    async (args) => {
      const message = service.prepareMessage(args);
      return { message_id: message.message_id, thread_id: message.thread_id, state: message.state, next: 'Review, then mail_request_approval to freeze and request human approval.' };
    });

  t('mail_prepare_reply', 'Prepare reply', 'Draft a reply into an existing thread; In-Reply-To/References are set from the thread automatically.',
    {
      type: 'object',
      properties: {
        thread_id: { type: 'string' },
        body: { type: 'string', minLength: 1 },
        subject: { type: 'string' },
      },
      required: ['thread_id', 'body'],
      additionalProperties: false,
    },
    WRITE,
    async (args) => {
      const message = service.prepareReply(args);
      return { message_id: message.message_id, thread_id: message.thread_id, state: message.state, to: message.to, subject: message.subject };
    });

  t('mail_update_draft', 'Update draft', 'Edit a DRAFT message (to/cc/subject/body). Frozen messages must be unfrozen first, which voids any approval.',
    {
      type: 'object',
      properties: {
        message_id: { type: 'string' },
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['message_id'],
      additionalProperties: false,
    },
    WRITE,
    async ({ message_id, ...fields }) => {
      const message = service.updateDraft(message_id, fields);
      return { message_id, state: message.state };
    });

  t('mail_freeze', 'Freeze message', 'Canonicalize the exact wire content and compute its SHA-256. Returns the frozen content for review.', idParam('message_id', 'Draft to freeze'), WRITE, async ({ message_id }) => service.freeze(message_id));

  t('mail_unfreeze', 'Unfreeze message', 'Return a frozen message to DRAFT for editing. Any approval is void by construction (the hash changes).', idParam('message_id', 'Frozen message'), WRITE, async ({ message_id }) => {
    const message = service.unfreeze(message_id);
    return { message_id, state: message.state };
  });

  t('mail_request_approval', 'Request human approval', 'Freeze (if needed) and move to AWAITING_APPROVAL. Returns the exact frozen content plus the terminal command the human must run — approval can ONLY be granted through that CLI, never by a tool.', idParam('message_id', 'Message to submit for approval'), WRITE, async ({ message_id }) => service.requestSendApproval(message_id));

  t('mail_approval_status', 'Approval status', 'Approval state for the current frozen revision of a message.', idParam('message_id', 'Message id'), READ, async ({ message_id }) => service.approvalStatus(message_id));

  t('mail_send', 'Send approved message', 'Verify and consume the human approval (at-most-once), render RFC 5322, and execute the configured transport (default: outbox .eml for manual sending). SEND_FAILED consumes the approval; OUTCOME_UNKNOWN is never auto-resent.', idParam('message_id', 'Approved message'), EXTERNAL, async ({ message_id }) => service.send(message_id));

  t('mail_cancel', 'Cancel message', 'Cancel a message in any pre-SENDING state.', idParam('message_id', 'Message to cancel'), WRITE, async ({ message_id }) => {
    const message = service.cancel(message_id);
    return { message_id, state: message.state };
  });

  t('mail_message_get', 'Get message', 'Full message record with lifecycle history and transport receipt.', idParam('message_id', 'Message id'), READ, async ({ message_id }) => ({ message: service.getMessage(message_id) }));

  t('mail_thread_get', 'Get thread', 'Thread with its ordered messages.', idParam('thread_id', 'Thread id'), READ, async ({ thread_id }) => {
    const thread = service.getThread(thread_id);
    return { thread, messages: thread.message_ids.map((id) => service.messages.get(id)).filter(Boolean) };
  });

  t('mail_thread_list', 'List threads', 'All threads with status and last activity.', { type: 'object', additionalProperties: false }, READ, async () => ({
    threads: service.threads.list().map((thread) => ({
      thread_id: thread.thread_id,
      subject_root: thread.subject_root,
      status: thread.status,
      messages: thread.message_ids.length,
      updated_at: thread.updated_at,
    })),
  }));

  t('mail_outbox_list', 'List messages by state', 'Outbound messages filtered by lifecycle state (default: AWAITING_APPROVAL).',
    {
      type: 'object',
      properties: { state: { type: 'string', enum: ['DRAFT', 'FROZEN', 'AWAITING_APPROVAL', 'APPROVED', 'SENDING', 'SENT', 'SEND_FAILED', 'OUTCOME_UNKNOWN', 'CANCELLED', 'all'] } },
      additionalProperties: false,
    },
    READ,
    async ({ state = 'AWAITING_APPROVAL' }) => ({
      messages: service.messages
        .list((m) => m.direction === 'outbound' && (state === 'all' || m.state === state))
        .map((m) => ({ message_id: m.message_id, state: m.state, to: m.to, subject: m.subject, thread_id: m.thread_id, content_hash: m.content_hash ?? null })),
    }));

  t('mail_ingest_scan', 'Scan inbox directory', `Parse .eml files dropped into the inbox directory (${config.inboxDir}) and attach them to threads. Files are renamed .ingested afterwards. Provenance: EML_FILE.`, { type: 'object', additionalProperties: false }, WRITE, async () => {
    fs.mkdirSync(config.inboxDir, { recursive: true });
    const results = [];
    for (const file of fs.readdirSync(config.inboxDir).filter((f) => f.endsWith('.eml')).sort()) {
      const full = path.join(config.inboxDir, file);
      try {
        const raw = fs.readFileSync(full, 'utf8');
        const outcome = service.ingestInbound(raw, 'EML_FILE');
        fs.renameSync(full, `${full}.ingested`);
        results.push({ file, message_id: outcome.message.message_id, thread_id: outcome.thread_id, thread_match: outcome.thread_match });
      } catch (err) {
        results.push({ file, error: err.message });
      }
    }
    return { scanned: results.length, results, note: results.length === 0 ? `No .eml files found in ${config.inboxDir}. Export replies from your mail client into that directory.` : undefined };
  });

  t('mail_ingest_paste', 'Ingest pasted reply', 'Ingest a raw reply pasted as text (full message with headers preferred; body-only accepted with explicit sender). Provenance: PASTED_TEXT — ranked below .eml files as evidence.',
    {
      type: 'object',
      properties: {
        raw: { type: 'string', minLength: 10, description: 'Raw RFC 5322 text, or the body if headers are unavailable' },
        from: { type: 'string', description: 'Sender, required when raw has no headers' },
        subject: { type: 'string', description: 'Subject, required when raw has no headers' },
      },
      required: ['raw'],
      additionalProperties: false,
    },
    WRITE,
    async ({ raw, from, subject }) => {
      let material = raw;
      if (!/^[A-Za-z-]+:\s/m.test(raw.slice(0, 200))) {
        if (!from || !subject) throw new ToolError('VALIDATION_FAILED', 'pasted text has no headers; provide from and subject');
        material = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${raw}`;
      }
      const outcome = service.ingestInbound(material, 'PASTED_TEXT');
      return { message_id: outcome.message.message_id, thread_id: outcome.thread_id, thread_match: outcome.thread_match, provenance: 'PASTED_TEXT' };
    });

  return tools;
}

export function buildResources({ service }) {
  return {
    list() {
      const entries = [];
      for (const thread of service.threads.list()) {
        entries.push({ uri: `mail://threads/${thread.thread_id}`, name: `Thread ${thread.thread_id} (${thread.subject_root || 'no subject'})`, mimeType: 'application/json' });
      }
      entries.push({ uri: 'mail://outbox', name: 'Messages awaiting approval', mimeType: 'application/json' });
      return entries.sort((a, b) => a.uri.localeCompare(b.uri));
    },
    templates() {
      return [
        { uriTemplate: 'mail://messages/{message_id}', name: 'Message', mimeType: 'application/json' },
        { uriTemplate: 'mail://threads/{thread_id}', name: 'Thread', mimeType: 'application/json' },
      ];
    },
    read(uri) {
      if (uri === 'mail://outbox') {
        const pending = service.messages.list((m) => m.state === 'AWAITING_APPROVAL');
        return [{ uri, mimeType: 'application/json', text: JSON.stringify(pending, null, 2) }];
      }
      const match = uri.match(/^mail:\/\/(messages|threads)\/([A-Za-z0-9_]+)$/);
      if (!match) return null;
      const value = match[1] === 'messages' ? service.messages.get(match[2]) : service.threads.get(match[2]);
      if (!value) return null;
      return [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }];
    },
  };
}
