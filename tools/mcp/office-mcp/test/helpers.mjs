import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOfficeServer } from '../src/server.mjs';

export function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-mcp-test-'));
}

export function testServer(extraEnv = {}) {
  const dataDir = tempDataDir();
  const built = buildOfficeServer({ env: { FLUXOLOGY_OFFICE_DATA_DIR: dataDir, ...extraEnv } });
  return { ...built, dataDir };
}

/** Call a tool through the full protocol layer (modern era) and return structuredContent. */
export async function callTool(server, name, args = {}) {
  const response = await server.handleMessage({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9),
    method: 'tools/call',
    params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
  });
  if (response.error) throw new Error(`protocol error: ${JSON.stringify(response.error)}`);
  return { isError: response.result.isError, value: response.result.structuredContent, result: response.result };
}

export async function runSearchToCompletion(server, profile, params = {}) {
  const start = await callTool(server, 'office_search_start', { profile, ...(Object.keys(params).length ? { params } : {}) });
  const runId = start.value.search_run_id;
  let last;
  for (let i = 0; i < 50; i += 1) {
    last = await callTool(server, 'office_search_step', { search_run_id: runId });
    if (last.isError) throw new Error(`search step failed: ${JSON.stringify(last.value)}`);
    if (last.value.status !== 'RUNNING') break;
  }
  return { runId, last };
}
