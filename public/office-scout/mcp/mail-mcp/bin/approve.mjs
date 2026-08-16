#!/usr/bin/env node
/**
 * Human approval CLI for outbound email (SDD v2 §0.7).
 *
 * This terminal command is the ONLY way an email can be approved for sending —
 * no MCP tool can grant approval. It re-displays the exact frozen message and
 * requires the content-hash prefix so the human confirms what they reviewed.
 *
 *   node bin/approve.mjs                # list pending
 *   node bin/approve.mjs show msg_…     # display frozen message
 *   node bin/approve.mjs approve msg_… --hash abc123def456
 *   node bin/approve.mjs reject msg_…
 */
import { Store } from '../../mcp-core/store.mjs';
import { runApprovalCli } from '../../mcp-core/approval.mjs';
import { loadConfig } from '../src/config.mjs';
import { createTransport } from '../src/transports.mjs';
import { MailService } from '../src/messages.mjs';

const config = loadConfig();
const store = new Store(config.dataDir);
const service = new MailService({ store, config, transport: createTransport(config) });

const code = runApprovalCli(store, process.argv.slice(2), {
  kindLabel: 'outbound emails',
  resolveSubject(messageId) {
    const message = service.messages.get(messageId);
    if (!message || !message.content_hash) return null;
    return {
      contentHash: message.content_hash,
      render() {
        return [
          `Message ${messageId}  [${message.state}]`,
          `From:    ${message.from}`,
          `To:      ${message.to.join(', ')}`,
          ...(message.cc?.length ? [`Cc:      ${message.cc.join(', ')}`] : []),
          `Subject: ${message.subject}`,
          '',
          message.body,
        ].join('\n');
      },
    };
  },
});
process.exit(code);
