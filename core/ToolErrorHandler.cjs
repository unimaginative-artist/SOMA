/**
 * ToolErrorHandler.cjs - Standardized Error Handling for Tools (CommonJS)
 *
 * CRITICAL RELIABILITY: Converts all error types to consistent format
 *
 * Based on: agentic_repo/apps/gateway/src/lib/handle-mcp-tool-call-error.ts
 * Integrated: January 15, 2026
 */

const logger = require('./SecureLogger.cjs');

// ═══════════════════════════════════════════════════════════════════
// ERROR TYPE DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if error is from fetch API
 */
function isFetchError(error) {
  return (
    error.name === 'FetchError' ||
    error.name === 'AbortError' ||
    (error.response && typeof error.response.status === 'number')
  );
}

/**
 * Check if error is from axios
 */
function isAxiosError(error) {
  return error.isAxiosError === true || error.config !== undefined;
}

/**
 * Check if error is from ky (modern fetch wrapper)
 */
function isKyError(error) {
  return error.name === 'HTTPError' && error.response && error.request;
}

/**
 * Check if error is a custom HTTP error with statusCode property
 */
function isHttpError(error) {
  return (
    error.statusCode !== undefined ||
    error.status !== undefined
  );
}

// ═══════════════════════════════════════════════════════════════════
// STATUS CODE EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract HTTP status code from various error types
 */
function extractStatusCode(error) {
  // Try different properties where status might be
  const status =
    error.statusCode ||
    error.status ||
    error.response?.status ||
    error.response?.statusCode ||
    500;

  return status;
}

/**
 * Sanitize status code to ensure it's a valid HTTP status
 */
function sanitizeStatusCode(status) {
  // Ensure it's a number
  const code = typeof status === 'number' ? status : parseInt(status, 10);

  // Check if it's a safe integer and in valid HTTP range (100-599)
  if (Number.isSafeInteger(code) && code >= 100 && code < 600) {
    return code;
  }

  // Default to 500 for invalid status codes
  return 500;
}

// ═══════════════════════════════════════════════════════════════════
// MESSAGE EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract error message from various error types
 */
function extractErrorMessage(error, options = {}) {
  const { isProd = process.env.NODE_ENV === 'production' } = options;

  // Try different properties where message might be
  let message =
    error.message ||
    error.statusText ||
    error.response?.statusText ||
    error.response?.data?.message ||
    error.response?.data?.error ||
    'Internal Server Error';

  // In production, don't expose internal error details for 5xx errors
  const status = extractStatusCode(error);
  if (isProd && status >= 500) {
    message = 'Internal Server Error';
  }

  return message;
}

// ═══════════════════════════════════════════════════════════════════
// HEADER EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract headers from error (especially rate limit headers)
 */
function extractHeaders(error) {
  const headers = {};

  // Get headers from various locations
  const sourceHeaders =
    error.headers ||
    error.response?.headers ||
    {};

  // Copy relevant headers (especially rate limit headers)
  const relevantHeaders = [
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'ratelimit-limit',
    'ratelimit-remaining',
    'ratelimit-reset',
  ];

  for (const key of relevantHeaders) {
    const lowerKey = key.toLowerCase();

    // Check both cases
    if (sourceHeaders[key]) {
      headers[key] = sourceHeaders[key];
    } else if (sourceHeaders[lowerKey]) {
      headers[key] = sourceHeaders[lowerKey];
    }
  }

  return headers;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ERROR HANDLER
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert any error into standardized format
 *
 * @param {Error} error - The error to handle
 * @param {Object} options - Configuration options
 * @param {string} options.toolName - Name of tool that threw error
 * @param {string} options.context - Additional context (e.g., 'Gemini API', 'Brave Search')
 * @param {boolean} options.isProd - Whether running in production
 * @returns {Object} Standardized error object
 *
 * @example
 * try {
 *   const data = await apiCall();
 * } catch (error) {
 *   const standardError = handleToolError(error, {
 *     toolName: 'gemini_api',
 *     context: 'Gemini API call'
 *   });
 *   return standardError;
 * }
 */
function handleToolError(error, options = {}) {
  const {
    toolName = 'unknown_tool',
    context = '',
    isProd = process.env.NODE_ENV === 'production'
  } = options;

  // Extract status code and sanitize
  const rawStatus = extractStatusCode(error);
  const status = sanitizeStatusCode(rawStatus);

  // Extract message
  const message = extractErrorMessage(error, { isProd });

  // Extract headers
  const headers = extractHeaders(error);

  // Create standardized error object
  const standardError = {
    isError: true,
    toolName,
    status,
    message,
    headers,
    context: context || toolName,
    timestamp: new Date().toISOString(),
  };

  // Log based on severity
  // Status codes to suppress logging for (common, expected errors)
  const suppressedStatuses = new Set([401, 403, 404, 409]);

  if (!suppressedStatuses.has(status)) {
    if (status >= 500) {
      // Server errors - log as error
      logger.error(`Tool "${toolName}" error [${status}]:`, {
        context,
        message,
        stack: isProd ? undefined : error.stack
      });
    } else if (status >= 400) {
      // Client errors - log as warning
      logger.warn(`Tool "${toolName}" warning [${status}]:`, {
        context,
        message
      });
    }
  }

  return standardError;
}

/**
 * Create a standardized error response for tool execution
 */
function createToolErrorResponse(error, options = {}) {
  const standardError = handleToolError(error, options);

  return {
    success: false,
    error: standardError.message,
    status: standardError.status,
    headers: standardError.headers,
    metadata: {
      toolName: standardError.toolName,
      context: standardError.context,
      timestamp: standardError.timestamp
    }
  };
}

/**
 * Wrap a tool function with error handling
 *
 * @example
 * const safeTool = withErrorHandling(
 *   async () => await apiCall(),
 *   { toolName: 'my_tool', context: 'API call' }
 * );
 */
function withErrorHandling(fn, options = {}) {
  return async function (...args) {
    try {
      const result = await fn.apply(this, args);
      return {
        success: true,
        data: result,
        status: 200
      };
    } catch (error) {
      return createToolErrorResponse(error, options);
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOM ERROR CLASSES
// ═══════════════════════════════════════════════════════════════════

/**
 * Custom HTTP error class
 */
class HttpError extends Error {
  constructor(message, statusCode = 500, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.status = statusCode;
    this.headers = headers;
  }
}

/**
 * Rate limit error class
 */
class RateLimitError extends HttpError {
  constructor(message, retryAfter, headers = {}) {
    super(message, 429, {
      'retry-after': retryAfter,
      ...headers
    });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  handleToolError,
  createToolErrorResponse,
  withErrorHandling,
  HttpError,
  RateLimitError,
  extractStatusCode,
  sanitizeStatusCode,
  extractErrorMessage,
  extractHeaders,
};
