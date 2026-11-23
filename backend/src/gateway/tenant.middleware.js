import { tenantContext } from '../db/connectionManager.js';
import { ForbiddenError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export { tenantContext };

export const resolveTenant = asyncHandler(async (req, _res, next) => {
  // Tenancy must only derive from the verified JWT payload, never from untrusted headers or inputs
  const tenantId = req.tenant?.orgId || req.user?.tenantId;

  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new ForbiddenError('Tenant context is required');
  }

  req.tenantId = tenantId.trim();
  req.log?.debug({ tenantId: req.tenantId }, 'tenant resolved');
  next();
});

