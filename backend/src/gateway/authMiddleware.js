import { authGateway } from './auth.middleware.js';

// Alias for backwards compatibility across existing routes
export const authenticate = authGateway;
export default authGateway;
