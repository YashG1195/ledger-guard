/**
 * Wraps an async Express route handler so that any rejected promise is
 * forwarded to Express's next(err) — no try/catch boilerplate required.
 *
 * @param {(req, res, next) => Promise<any>} fn  Async route handler
 * @returns Express middleware
 *
 * @example
 *   router.get('/items', asyncHandler(async (req, res) => {
 *     const items = await ItemService.list();
 *     res.json({ success: true, data: items, error: null });
 *   }));
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
