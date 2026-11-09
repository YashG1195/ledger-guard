/**
 * Integration tests for core app infrastructure.
 * Env vars are injected via tests/globalSetup.js (Jest globalSetup)
 * before any ESM module is evaluated.
 */
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /health', () => {
  let app;

  beforeAll(() => {
    ({ app } = createApp());
  });

  it('responds 200 with the standard success shape', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.status).toBe('ok');
  });

  it('includes X-Request-Id header in the response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('echoes an upstream X-Request-Id header', async () => {
    const res = await request(app)
      .get('/health')
      .set('X-Request-Id', 'test-req-123');
    expect(res.headers['x-request-id']).toBe('test-req-123');
  });
});

describe('Unknown route', () => {
  let app;

  beforeAll(() => {
    ({ app } = createApp());
  });

  it('returns 404 with the standard error shape', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
