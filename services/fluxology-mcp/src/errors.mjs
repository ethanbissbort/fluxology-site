/**
 * Error model (SDD §16).
 *
 * Two distinct families:
 *
 *   HttpError — transport/authentication failures that must surface as an HTTP
 *   status before MCP framing (401, 403, 413, 429, 503).
 *
 *   ToolError — recoverable, per-invocation failures reported inside a tool
 *   result with a machine-readable code so the model can correct its input.
 *
 * Neither carries stack traces or downstream bearer material into a response.
 */

export const TOOL_ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SCHEMA_VERSION_MISMATCH: 'SCHEMA_VERSION_MISMATCH',
  DOWNSTREAM_UNAVAILABLE: 'DOWNSTREAM_UNAVAILABLE',
  DOWNSTREAM_REJECTED: 'DOWNSTREAM_REJECTED',
  CONFLICT: 'CONFLICT',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
});

export class HttpError extends Error {
  constructor(status, code, message, { headers = {}, retryAfterSeconds } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
    if (retryAfterSeconds != null) this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ToolError extends Error {
  /**
   * @param {string} code one of TOOL_ERROR_CODES
   * @param {string} message short, model-facing, secret-free
   * @param {object} [details] additional structured context (already safe to expose)
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = TOOL_ERROR_CODES[code] ? code : 'VALIDATION_ERROR';
    this.details = details;
  }
}

/**
 * Errors that a caller may safely retry (SDD §17.1). Validation problems and
 * authorization failures are deterministic and must not be retried.
 */
export function isRetryable(error) {
  if (error instanceof HttpError) return error.status === 429 || error.status === 503;
  if (error instanceof ToolError) return error.code === 'DOWNSTREAM_UNAVAILABLE' || error.code === 'CONFLICT';
  return false;
}
