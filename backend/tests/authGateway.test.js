import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { getPrivateKey, getPublicKey } from '../src/crypto/keys.js';
import { MOCK_USERS } from '../src/gateway/auth.controller.js';

describe('authGateway and /auth routes', () => {
  let app;
  let privateKey;
  let publicKey;

  beforeAll(() => {
    ({ app } = createApp());
    privateKey = getPrivateKey();
    publicKey = getPublicKey();
  });

  describe('POST /auth/login', () => {
    it('issues a valid 15-minute RS256 token for valid mock credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'admin@acme.com',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.error).toBeNull();
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.tokenType).toBe('Bearer');
      expect(res.body.data.expiresIn).toBe(900);
      expect(res.body.data.user.userId).toBe('usr_admin_101');
      expect(res.body.data.user.orgId).toBe('org_acme_corp');
      expect(res.body.data.user.role).toBe('admin');

      // Verify the token decode
      const decoded = jwt.verify(res.body.data.token, publicKey, { algorithms: ['RS256'] });
      expect(decoded.sub).toBe('usr_admin_101');
      expect(decoded.orgId).toBe('org_acme_corp');
      expect(decoded.role).toBe('admin');
    });

    it('rejects invalid password with 401', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'admin@acme.com',
          password: 'wrongpassword',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects missing credentials with 400', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns the mock user directory for frontend testing', async () => {
      const res = await request(app).get('/auth/mock-users');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toHaveLength(MOCK_USERS.length);
    });
  });

  describe('authGateway middleware', () => {
    it('accepts a valid RS256 token and attaches req.tenant', async () => {
      const payload = {
        sub: 'usr_custom_999',
        orgId: 'org_enterprise_1',
        role: 'billing_manager',
      };

      const token = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
      });

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant).toEqual({
        orgId: 'org_enterprise_1',
        userId: 'usr_custom_999',
        role: 'billing_manager',
      });
    });

    it('rejects requests with missing Authorization header (401)', async () => {
      const res = await request(app).get('/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toMatch(/missing|malformed/i);
    });

    it('rejects requests with malformed Authorization header (401)', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Basic 123456');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects expired tokens with 401 and TOKEN_EXPIRED code', async () => {
      const payload = {
        sub: 'usr_expired_1',
        orgId: 'org_test',
        role: 'member',
      };

      // Expired 10 seconds ago
      const token = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '-10s',
      });

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
      expect(res.body.error.message).toMatch(/expired/i);
    });

    it('rejects tampered tokens with 401 and INVALID_TOKEN code', async () => {
      const payload = {
        sub: 'usr_tamper_1',
        orgId: 'org_test',
        role: 'member',
      };

      const validToken = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
      });

      // Modify the signature portion of the JWT
      const parts = validToken.split('.');
      parts[2] = parts[2].slice(0, -6) + 'abcdef';
      const tamperedToken = parts.join('.');

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
      expect(res.body.error.message).toMatch(/invalid/i);
    });

    it('rejects HS256 tokens to prevent algorithm confusion attacks', async () => {
      const payload = {
        sub: 'usr_attacker_1',
        orgId: 'org_target',
        role: 'admin',
      };

      // Attacker signs using HS256 with the public key string as symmetric secret
      const forgedToken = jwt.sign(payload, publicKey, {
        algorithm: 'HS256',
        expiresIn: '15m',
      });

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
  });
});
