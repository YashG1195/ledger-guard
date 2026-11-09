import { ForbiddenError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Resolves the tenant context for a request.
 *
 * Priority order:
 *  1. JWT claim  req.user.tenantId
 *  2. Header     X-Tenant-Id
 *
 * Sets req.tenantId so downstream handlers and services can scope DB queries.
 */
export const resolveTenant = asyncHandler(async (req, _res, next) => {
  const tenantId = req.user?.tenantId ?? req.headers['x-tenant-id'];

  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new ForbiddenError('Tenant context is required');
  }

  req.tenantId = tenantId.trim();
  req.log.debug({ tenantId: req.tenantId }, 'Tenant resolved');
  next();
});
