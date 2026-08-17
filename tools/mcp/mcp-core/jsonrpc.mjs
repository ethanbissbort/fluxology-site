/**
 * Dual-era MCP protocol server over JSON-RPC 2.0 (SDD v2 §0.6).
 *
 * Modern era — MCP 2026-07-28: stateless per-request `_meta` versioning,
 * mandatory `server/discover`, required `resultType`, cacheable list results,
 * UnsupportedProtocolVersionError (-32022), no `ping`.
 *
 * Legacy era — 2025-11-25 … 2024-11-05: `initialize` handshake, `ping`,
 * classic result shapes. An `initialize` request switches the process to
 * legacy semantics; requests carrying modern `_meta` are always served
 * statelessly with modern shapes; era-ambiguous requests are served leniently
 * with legacy shapes (matches how deployed hosts actually behave).
 *
 * Framing (stdio): one JSON-RPC message per line, UTF-8, no embedded
 * newlines; stdout carries only MCP messages; all logging goes to stderr;
 * the process exits when stdin closes.
 */
import { createInterface } from 'node:readline';
import http from 'node:http';
import { validateSchema } from './schema.mjs';

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/; // host-portable subset (SDD v2 audit A4)
const LIST_TTL_MS = 300_000;

export class ToolError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

export function createProtocolServer({ serverInfo, instructions, tools = [], resources = null, log = () => {} }) {
  for (const tool of tools) {
    if (!TOOL_NAME_PATTERN.test(tool.name)) throw new Error(`tool name violates host pattern: ${tool.name}`);
  }
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name)); // deterministic order

  const capabilities = { tools: {} };
  if (resources) capabilities.resources = {};

  const state = { legacyInitialized: false, legacyVersion: null };

  function toolDefinitions() {
    return sortedTools.map((t) => {
      const def = { name: t.name, description: t.description, inputSchema: t.inputSchema };
      if (t.title) def.title = t.title;
      if (t.annotations) def.annotations = t.annotations;
      return def;
    });
  }

  function finishResult(result, era) {
    if (era === 'modern') {
      return { resultType: 'complete', ...result, _meta: { [META_SERVER_INFO]: serverInfo } };
    }
    return result;
  }

  function cacheable(result, era) {
    if (era === 'modern') return { ...result, ttlMs: LIST_TTL_MS, cacheScope: 'private' };
    return result;
  }

  async function callTool(params, era, id) {
    const name = params?.name;
    const tool = toolsByName.get(name);
    if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
    const args = params?.arguments ?? {};

    const schemaErrors = validateSchema(tool.inputSchema, args);
    let result;
    if (schemaErrors.length > 0) {
      result = toolFailure({ code: 'VALIDATION_FAILED', message: 'Tool input failed schema validation.', data: { errors: schemaErrors } });
    } else {
      try {
        const value = await tool.handler(args);
        const structured = value === undefined ? { ok: true } : value;
        result = {
          content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
          isError: false,
        };
      } catch (err) {
        if (err instanceof ToolError || typeof err?.code === 'string') {
          result = toolFailure({ code: err.code, message: err.message, data: err.data });
        } else {
          log(`tool ${name} internal error: ${err.stack ?? err}`);
          result = toolFailure({ code: 'INTERNAL', message: `Internal error in ${name}: ${err.message}` });
        }
      }
    }
    return { jsonrpc: '2.0', id, result: finishResult(result, era) };
  }

  function toolFailure({ code, message, data }) {
    const error = { code, message, ...(data !== undefined ? { data } : {}) };
    return {
      content: [{ type: 'text', text: `${code}: ${message}${data !== undefined ? `\n${JSON.stringify(data, null, 2)}` : ''}` }],
      structuredContent: { error },
      isError: true,
    };
  }

  /** Handle one parsed JSON-RPC message. Returns a response object, or null for notifications. */
  async function handleMessage(message) {
    if (Array.isArray(message)) return rpcError(null, -32600, 'Batch requests are not supported.');
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return rpcError(message?.id, -32600, 'Invalid JSON-RPC request.');
    }
    const { id, method, params } = message;
    const isNotification = id === undefined;
    const metaVersion = params?._meta?.[META_VERSION];

    // Era selection per request (SDD v2 §0.6).
    let era;
    if (metaVersion !== undefined) era = 'modern';
    else if (state.legacyInitialized || method === 'initialize') era = 'legacy';
    else era = 'legacy'; // era-ambiguous: serve leniently with legacy shapes

    // --- Notifications ---
    if (isNotification) {
      if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
      return null; // unknown notifications are ignored per JSON-RPC
    }

    // --- Modern discovery: always answered, whatever version was requested ---
    if (method === 'server/discover') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resultType: 'complete',
          supportedVersions: MODERN_VERSIONS,
          capabilities,
          instructions,
          ttlMs: 3_600_000,
          cacheScope: 'private',
          _meta: { [META_SERVER_INFO]: serverInfo },
        },
      };
    }

    // --- Modern version gate ---
    if (era === 'modern' && !MODERN_VERSIONS.includes(metaVersion)) {
      return rpcError(id, -32022, 'Unsupported protocol version', {
        supported: MODERN_VERSIONS,
        requested: metaVersion,
      });
    }

    // --- Legacy lifecycle ---
    if (method === 'initialize') {
      state.legacyInitialized = true;
      const requested = params?.protocolVersion;
      state.legacyVersion = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: state.legacyVersion,
          capabilities,
          serverInfo,
          instructions,
        },
      };
    }
    if (method === 'ping') {
      if (era === 'modern') return rpcError(id, -32601, 'Method not found: ping (removed in 2026-07-28)');
      return { jsonrpc: '2.0', id, result: {} };
    }

    // --- Shared feature methods ---
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: finishResult(cacheable({ tools: toolDefinitions() }, era), era) };
    }
    if (method === 'tools/call') {
      return callTool(params, era, id);
    }
    if (resources && method === 'resources/list') {
      return { jsonrpc: '2.0', id, result: finishResult(cacheable({ resources: resources.list() }, era), era) };
    }
    if (resources && method === 'resources/templates/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: finishResult(cacheable({ resourceTemplates: resources.templates?.() ?? [] }, era), era),
      };
    }
    if (resources && method === 'resources/read') {
      const uri = params?.uri;
      const contents = uri ? resources.read(uri) : null;
      if (!contents) {
        // 2026-07-28 aligned resource-not-found with JSON-RPC Invalid Params; legacy used -32002.
        return rpcError(id, era === 'modern' ? -32602 : -32002, `Resource not found: ${uri}`, { uri });
      }
      return { jsonrpc: '2.0', id, result: finishResult(cacheable({ contents }, era), era) };
    }

    return rpcError(id, -32601, `Method not found: ${method}`);
  }

  return { handleMessage, serverInfo, get state() { return state; } };
}

/** Run a protocol server over stdio with newline-delimited framing. */
export function runStdioServer(server, { input = process.stdin, output = process.stdout, log = (s) => process.stderr.write(s + '\n') } = {}) {
  const rl = createInterface({ input, crlfDelay: Infinity });
  let queue = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
        return;
      }
      try {
        const response = await server.handleMessage(message);
        if (response) output.write(JSON.stringify(response) + '\n');
      } catch (err) {
        log(`unhandled protocol error: ${err.stack ?? err}`);
        if (message?.id !== undefined) {
          output.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal error' } }) + '\n');
        }
      }
    });
  });
  rl.on('close', () => {
    queue.then(() => process.exit(0));
  });
  log(`${server.serverInfo.name} ${server.serverInfo.version} listening on stdio`);
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Minimal Streamable HTTP entry (SDD v2 §0.6): modern-only, single POST /mcp
 * endpoint, JSON responses, Origin validation, MCP request headers enforced,
 * loopback bind by default, optional static bearer token.
 */
export function runHttpServer(server, { bind = '127.0.0.1', port = 8090, token = '', origins = [], log = (s) => process.stderr.write(s + '\n') } = {}) {
  const httpServer = http.createServer((req, res) => {
    const respond = (status, body, headers = {}) => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(payload);
    };

    if (req.method === 'GET' && req.url === '/healthz') {
      return respond(200, { ok: true, server: server.serverInfo });
    }
    if (req.method !== 'POST' || req.url !== '/mcp') {
      return respond(req.method === 'POST' ? 404 : 405, { error: 'POST /mcp only' });
    }

    const origin = req.headers.origin;
    if (origin && !LOOPBACK_ORIGIN.test(origin) && !origins.includes(origin)) {
      return respond(403, { error: 'Origin not allowed' });
    }
    if (token) {
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${token}`) {
        return respond(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
      }
    }

    let body = '';
    let overflow = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_048_576) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (overflow) return;
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        return respond(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }

      // Modern-only endpoint: initialize gets the spec-recommended diagnostic.
      if (message?.method === 'initialize') {
        return respond(200, {
          jsonrpc: '2.0',
          id: message.id ?? null,
          error: {
            code: -32601,
            message:
              'This endpoint serves MCP 2026-07-28 (per-request _meta versioning) only; the initialize handshake is not supported here. Use the stdio entry for legacy clients.',
            data: { supported: MODERN_VERSIONS },
          },
        });
      }

      // Required modern request headers (2026-07-28 Streamable HTTP).
      const headerVersion = req.headers['mcp-protocol-version'];
      const headerMethod = req.headers['mcp-method'];
      if (!headerVersion || !MODERN_VERSIONS.includes(headerVersion)) {
        return respond(400, { error: `MCP-Protocol-Version header required; supported: ${MODERN_VERSIONS.join(', ')}` });
      }
      if (!headerMethod || headerMethod !== message?.method) {
        return respond(400, { error: 'Mcp-Method header must match the request method' });
      }
      if (message?.method === 'tools/call') {
        const headerName = req.headers['mcp-name'];
        if (!headerName || headerName !== message?.params?.name) {
          return respond(400, { error: 'Mcp-Name header must match params.name for tools/call' });
        }
      }

      try {
        const response = await server.handleMessage(message);
        return respond(200, response ?? { ok: true });
      } catch (err) {
        log(`http handler error: ${err.stack ?? err}`);
        return respond(500, { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'Internal error' } });
      }
    });
  });
  httpServer.listen(port, bind, () => log(`${server.serverInfo.name} listening on http://${bind}:${port}/mcp (modern-only)`));
  return httpServer;
}
