#!/usr/bin/env node
/**
 * Fluxology Mail MCP — stdio entry (dual-era: MCP 2026-07-28 + legacy
 * initialize clients). Zero dependencies; Node >= 22.
 *
 *   FLUXOLOGY_MAIL_FROM="Ethan Bissbort <ethan@fluxology.ca>" node bin/mail-mcp.mjs
 */
import { runStdioServer } from '../../mcp-core/jsonrpc.mjs';
import { buildMailServer } from '../src/server.mjs';

try {
  const { server } = buildMailServer();
  runStdioServer(server);
} catch (err) {
  process.stderr.write(`[mail-mcp] startup failed: ${err.message}\n`);
  process.exit(1);
}
