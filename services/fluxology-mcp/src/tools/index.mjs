/**
 * Tool registry and dispatcher.
 *
 * Owns the last two steps the SDD assigns to every invocation: return a
 * structured result (§15) and emit a redacted structured log (§19.1). It also
 * re-checks the OAuth scope even though the HTTP layer already rejected the
 * request — a category write must be unreachable by two independent checks,
 * not one.
 */
import { randomUUID } from 'node:crypto';

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { ToolError } from '../errors.mjs';
import { formatAjvErrors } from '../schemas.mjs';
import { createReadTools } from './read-tools.mjs';
import { createOfficeTools } from './office-tools.mjs';
import { createDealsTools } from './deals-tools.mjs';
import { createJobsTools } from './jobs-tools.mjs';

/** Cap on the number of changed ids written to a single log line. */
const MAX_LOGGED_IDS = 25;

/**
 * Keep an error payload inside whatever the tool's own output schema declares.
 *
 * A declared `outputSchema` is a promise to the client, and conforming clients
 * enforce it — so an error result that echoes bad input (an unrecognised
 * `scope`, say) would be rejected by the transport and the caller would never
 * see why its call failed. Fields are first narrowed to the declared set, then
 * the whole payload is validated; anything still non-conforming collapses to
 * the minimal shape rather than breaking the response.
 */
function shapeErrorPayload(tool, payload) {
  const allowed = Object.keys(tool.outputSchema?.properties ?? {});
  const out = {};
  for (const key of allowed) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  out.ok = false;

  if (!tool.validateOutput || tool.validateOutput(out)) return out;

  // Drop only what Ajv objected to, so fields the schema *requires* survive.
  for (const error of tool.validateOutput.errors ?? []) {
    const key = error.instancePath.split('/')[1];
    if (key && !(tool.outputSchema.required ?? []).includes(key)) delete out[key];
  }
  if (tool.validateOutput(out)) return out;

  return { ok: false, code: payload.code, message: payload.message };
}

export function createToolRegistry({ config, schemas, client, pipeline, log }) {
  const limits = config.limits;
  const deps = { schemas, pipeline, limits, client };

  const tools = [
    ...createReadTools(deps),
    ...createOfficeTools(deps),
    ...createDealsTools(deps),
    ...createJobsTools(deps),
  ];

  const byName = new Map();
  for (const tool of tools) {
    byName.set(tool.name, {
      ...tool,
      validateInput: schemas.ajv.compile(tool.inputSchema),
      validateOutput: schemas.ajv.compile(tool.outputSchema),
    });
  }

  /** The `tools/list` payload. Stable once the ChatGPT app is approved (SDD §24). */
  const definitions = tools.map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
  }));

  function get(name) {
    return byName.get(name) ?? null;
  }

  /** `tools/list` narrowed to what the presented token may actually call. */
  function definitionsFor(grantedScopes) {
    if (!Array.isArray(grantedScopes)) return definitions;
    const granted = new Set(grantedScopes);
    return definitions.filter(definition => granted.has(byName.get(definition.name).requiredScope));
  }

  async function call(name, rawArgs, { authInfo, requireScope, httpRequestId } = {}) {
    const tool = byName.get(name);
    const requestId = randomUUID();
    const startedAt = Date.now();

    const logFields = () => ({
      requestId,
      // The HTTP layer's id is what the X-Request-Id response header carries;
      // without it on this line the two correlation ids can never be joined.
      httpRequestId: httpRequestId ?? null,
      tool: name,
      subject: authInfo?.extra?.subject ?? authInfo?.clientId ?? 'unknown',
      clientId: authInfo?.clientId ?? 'unknown',
      grantedScopes: authInfo?.scopes ?? [],
      durationMs: Date.now() - startedAt,
    });

    if (!tool) {
      log.warn('tool_unknown', logFields());
      // A protocol error, not a tool result: ToolError.code is a string, which
      // the SDK maps to InternalError (-32603) where the spec wants InvalidParams.
      throw new McpError(ErrorCode.InvalidParams, `unknown tool ${String(name).slice(0, 60)}`);
    }

    try {
      // Defence in depth: the HTTP layer already enforced this with a 403.
      if (requireScope) requireScope(authInfo, tool.requiredScope);

      const args = rawArgs ?? {};
      if (!tool.validateInput(args)) {
        throw new ToolError('VALIDATION_ERROR', formatAjvErrors(tool.validateInput.errors).join('; '), {
          scope: tool.dashboardScope ?? args.scope,
        });
      }

      const result = await tool.run(args, { requestId, authInfo });
      const structured = result.structuredContent;

      // A declared output schema is a promise to the client, and conforming
      // clients reject a result that breaks it. Surface the bug here, loudly,
      // rather than letting it read as an opaque transport failure.
      if (!tool.validateOutput(structured)) {
        log.error('tool_output_schema_violation', {
          requestId,
          tool: name,
          errors: formatAjvErrors(tool.validateOutput.errors),
        });
      }

      log.info('tool_invocation', {
        ...logFields(),
        outcome: 'ok',
        scope: tool.dashboardScope ?? args.scope ?? null,
        source: structured?.source ?? null,
        received: structured?.received ?? null,
        counts: result.counts ?? null,
        changedIds: (result.changedIds ?? []).slice(0, MAX_LOGGED_IDS),
        changedIdCount: (result.changedIds ?? []).length,
        deactivatedIds: (result.deactivatedIds ?? []).slice(0, MAX_LOGGED_IDS),
        downstreamChanged: structured?.downstream?.changed ?? null,
      });

      /*
       * Recovery record. dashboard_data is the only copy of these feeds and the
       * downstream audit entry stores ids and counts but no prior values, so
       * without this line a bad write — a mass `active:false`, an overwritten
       * address — cannot be reconstructed from anything.
       */
      if (result.beforeImage && Object.keys(result.beforeImage).length) {
        log.info('write_before_image', {
          requestId,
          httpRequestId: httpRequestId ?? null,
          tool: name,
          scope: tool.dashboardScope ?? null,
          subject: authInfo?.extra?.subject ?? authInfo?.clientId ?? 'unknown',
          deactivatedIds: (result.deactivatedIds ?? []).slice(0, MAX_LOGGED_IDS),
          beforeImage: result.beforeImage,
        });
      }

      return {
        content: [{ type: 'text', text: result.text }],
        structuredContent: structured,
      };
    } catch (err) {
      // An HttpError (401/403) must keep its status: let the caller map it.
      if (err?.name === 'HttpError') {
        log.warn('tool_denied', { ...logFields(), status: err.status, code: err.code });
        throw err;
      }

      const toolError = err instanceof ToolError ? err : new ToolError('DOWNSTREAM_UNAVAILABLE', 'the tool failed unexpectedly');
      if (!(err instanceof ToolError)) {
        // Never let an unexpected stack trace reach the model (SDD §16.2).
        log.error('tool_unexpected_error', { ...logFields(), error: err });
      }

      const partial = toolError.details?.partial ?? {};
      const payload = shapeErrorPayload(tool, {
        ...partial,
        scope: tool.dashboardScope ?? partial.scope ?? rawArgs?.scope,
        requestId,
        code: toolError.code,
        message: toolError.message,
      });

      // The ids a failed write may have touched are exactly what an operator
      // needs afterwards, and the success path already logs them.
      const affectedIds = (partial.results ?? [])
        .filter(entry => entry.outcome === 'unknown')
        .map(entry => entry.id)
        .filter(Boolean);

      log.warn('tool_invocation', {
        ...logFields(),
        outcome: 'error',
        code: toolError.code,
        scope: payload.scope ?? null,
        source: partial.source ?? null,
        received: partial.received ?? null,
        persistence: partial.persistence ?? null,
        unknownIds: affectedIds.slice(0, MAX_LOGGED_IDS),
        unknownIdCount: affectedIds.length,
        counts: partial.received == null ? null : {
          created: partial.created ?? 0,
          updated: partial.updated ?? 0,
          touched: partial.touched ?? 0,
          unchanged: partial.unchanged ?? 0,
          rejected: partial.rejected ?? 0,
          unknown: partial.unknown ?? 0,
        },
      });

      /*
       * Say the ambiguity out loud in the text block too. `ok:false` alone reads
       * as "nothing happened", and for this class of failure that is exactly
       * what the model must not assume.
       */
      const ambiguityNote =
        payload.persistence === 'unknown'
          ? `. ${affectedIds.length} record(s) were accepted before the failure and may or may not have been persisted — re-read them with get_dashboard_listing before retrying.`
          : '';

      return {
        content: [{ type: 'text', text: `${toolError.code}: ${toolError.message}${ambiguityNote}` }],
        structuredContent: payload,
        isError: true,
      };
    }
  }

  return { definitions, definitionsFor, tools, get, call };
}
