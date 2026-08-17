#!/usr/bin/env node
/**
 * Fluxology Office MCP — stdio entry (dual-era: MCP 2026-07-28 + legacy
 * initialize clients). Zero dependencies; Node >= 22.
 *
 *   node bin/office-mcp.mjs
 *
 * Configuration via environment (SDD v2 §0.8). Data lives OUTSIDE this
 * package (default ~/.fluxology/office-mcp); startup refuses an unsafe root.
 */
import { runStdioServer } from '../../mcp-core/jsonrpc.mjs';
import { buildOfficeServer } from '../src/server.mjs';

try {
  const { server } = buildOfficeServer();
  runStdioServer(server);
} catch (err) {
  process.stderr.write(`[office-mcp] startup failed: ${err.message}\n`);
  process.exit(1);
}
