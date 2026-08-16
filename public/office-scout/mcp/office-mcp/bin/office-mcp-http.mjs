#!/usr/bin/env node
/**
 * Fluxology Office MCP — optional Streamable HTTP entry (modern-only,
 * MCP 2026-07-28). Binds 127.0.0.1 by default; set FLUXOLOGY_OFFICE_HTTP_TOKEN
 * for bearer auth before exposing beyond loopback (SDD v2 §0.6, §0.9).
 */
import { runHttpServer } from '../../mcp-core/jsonrpc.mjs';
import { buildOfficeServer } from '../src/server.mjs';

try {
  const { server, config, log } = buildOfficeServer();
  runHttpServer(server, { ...config.http, log });
} catch (err) {
  process.stderr.write(`[office-mcp-http] startup failed: ${err.message}\n`);
  process.exit(1);
}
