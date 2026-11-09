/**
 * Standard JSON response helpers.
 *
 * Every API response MUST follow the shape:
 *   { success: boolean, data: any | null, error: object | null }
 *
 * Use these helpers instead of calling res.json() directly in controllers.
 */

/**
 * Send a successful response.
 * @param {import('express').Response} res
 * @param {any}    data        Payload to include in `data` field
 * @param {number} [status=200]  HTTP status code
 */
export const sendSuccess = (res, data, status = 200) =>
  res.status(status).json({ success: true, data, error: null });

/**
 * Send an error response.
 * Prefer throwing AppError subclasses inside handlers — the global error
 * handler calls this automatically. Use directly only when you need a
 * non-throwing path (e.g., partial-success scenarios).
 *
 * @param {import('express').Response} res
 * @param {string} code    Machine-readable error code
 * @param {string} message Human-readable message
 * @param {any}    [details=null]
 * @param {number} [status=500]
 */
export const sendError = (res, code, message, details = null, status = 500) =>
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message, ...(details !== null && { details }) },
  });

