import jwt from 'jsonwebtoken';
import { getPrivateKey } from '../crypto/keys.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const MOCK_USERS = [
  {
    userId: 'usr_admin_101',
    orgId: 'org_acme_corp',
    email: 'admin@acme.com',
    password: 'password123',
    role: 'admin',
    name: 'Alice Admin',
  },
  {
    userId: 'usr_billing_202',
    orgId: 'org_acme_corp',
    email: 'billing@acme.com',
    password: 'password123',
    role: 'billing_manager',
    name: 'Bob Billing',
  },
  {
    userId: 'usr_auditor_303',
    orgId: 'org_globex_corp',
    email: 'auditor@globex.com',
    password: 'password123',
    role: 'auditor',
    name: 'Charlie Auditor',
  },
];

export async function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return sendError(
      res,
      'VALIDATION_ERROR',
      'Email and password are required',
      { missing: [!email && 'email', !password && 'password'].filter(Boolean) },
      400
    );
  }

  const user = MOCK_USERS.find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
  );

  if (!user) {
    return sendError(
      res,
      'INVALID_CREDENTIALS',
      'Invalid email or password',
      null,
      401
    );
  }

  const privateKey = getPrivateKey();
  if (!privateKey) {
    req.log?.error('cannot sign jwt: private key unavailable');
    return sendError(
      res,
      'SERVICE_UNAVAILABLE',
      'Signing key unavailable',
      null,
      503
    );
  }

  // 15-minute expiration as required for token rotation & security
  const payload = {
    sub: user.userId,
    orgId: user.orgId,
    role: user.role,
  };

  const token = jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
  });

  return sendSuccess(res, {
    token,
    tokenType: 'Bearer',
    expiresIn: 900,
    user: {
      userId: user.userId,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
      name: user.name,
    },
  });
}

export function listMockUsers(_req, res) {
  // helpful endpoint for frontend development & integration testing
  const users = MOCK_USERS.map(({ password: _pw, ...safeUser }) => ({
    ...safeUser,
    samplePassword: 'password123',
  }));

  return sendSuccess(res, { users });
}

export function getCurrentUser(req, res) {
  return sendSuccess(res, { tenant: req.tenant });
}
