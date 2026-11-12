import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /health', () => {
  let app;

  beforeAll(() => {
    ({ app } = createApp());
  });

  it('responds 200 with success status', async () => {
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

  it('returns 404 for missing route', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
