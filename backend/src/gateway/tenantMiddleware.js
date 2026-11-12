import { ForbiddenError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const resolveTenant = asyncHandler(async (req, _res, next) => {
  const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];

  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new ForbiddenError('Tenant context is required');
  }

  req.tenantId = tenantId.trim();
  req.log.debug({ tenantId: req.tenantId }, 'tenant resolved');
  next();
});
