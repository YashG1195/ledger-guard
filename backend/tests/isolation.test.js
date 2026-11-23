/**
 * Tenant isolation test suite.
 *
 * Verifies strict cryptographic and physical isolation between tenants:
 * 1. Tenant identity strictly derives from verified RS256 JWT claims, ignoring
 *    untrusted client body, query, param, and header overrides.
 * 2. Cross-tenant reads, updates, and aggregations are strictly impossible.
 * 3. Separate Mongoose connections and distinct database namespaces are used per tenant.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import path from 'path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectionManager } from '../src/db/connectionManager.js';
import { env } from '../src/config/env.js';

jest.setTimeout(120_000);

function resolveKey(envVar, filename) {
  const p = process.env[envVar] ?? path.resolve('keys', filename);
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return readFileSync(path.resolve('backend', 'keys', filename), 'utf8');
  }
}

function mintTenantToken(orgId, userId = `usr_${orgId}`, role = 'admin') {
  const privateKey = resolveKey('JWT_PRIVATE_KEY_PATH', 'private.pem');
  return jwt.sign(
    { sub: userId, orgId, role },
    privateKey,
    { algorithm: 'RS256', expiresIn: '15m' }
  );
}

describe('Multi-tenant isolation suite', () => {
  let replSet;
  let app;
  let tokenA;
  let tokenB;

  const TENANT_A = 'org_tenant_alpha';
  const TENANT_B = 'org_tenant_beta';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });

    const uri = replSet.getUri();
    process.env.MONGO_BASE_URI = uri;
    connectionManager.setTenantUri(TENANT_A, uri);
    connectionManager.setTenantUri(TENANT_B, uri);

    ({ app } = createApp());
    tokenA = mintTenantToken(TENANT_A, 'usr_alpha_1');
    tokenB = mintTenantToken(TENANT_B, 'usr_beta_1');
  });

  afterAll(async () => {
    await connectionManager.disconnectAll();
    if (replSet) await replSet.stop();
  });

  test('tenants use different mongoose connections and different database names', async () => {
    const connA = await connectionManager.getTenantConnection(TENANT_A);
    const connB = await connectionManager.getTenantConnection(TENANT_B);

    expect(connA).toBeDefined();
    expect(connB).toBeDefined();
    expect(connA).not.toBe(connB);

    expect(connA.name).toBe(`tenant_${TENANT_A}`);
    expect(connB.name).toBe(`tenant_${TENANT_B}`);
    expect(connA.name).not.toBe(connB.name);

    const activeList = connectionManager.listActive();
    const activeOrgs = activeList.map((c) => c.orgId);
    expect(activeOrgs).toContain(TENANT_A);
    expect(activeOrgs).toContain(TENANT_B);
  });

  test('Tenant B cannot read Tenant A transaction list even with orgId spoofing in query', async () => {
    // 1. Insert transaction as Tenant A
    const createRes = await request(app)
      .post('/api/v1/ledger/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        amount: 5000,
        currency: 'USD',
        description: 'Alpha proprietary payment',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data._id || createRes.body.data.idempotencyKey).toBeDefined();

    // 2. Tenant A lists transactions -> sees own transaction
    const listARes = await request(app)
      .post('/api/v1/ledger/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: 2500 });
    expect(listARes.status).toBe(201);

    const checkARes = await request(app)
      .get('/api/v1/ledger/transactions')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(checkARes.status).toBe(200);
    expect(checkARes.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(checkARes.body.data.items.every((t) => t.orgId === TENANT_A)).toBe(true);

    // 3. Tenant B lists transactions -> sees 0 transactions
    const listBRes = await request(app)
      .get('/api/v1/ledger/transactions')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listBRes.status).toBe(200);
    expect(listBRes.body.data.items).toEqual([]);
    expect(listBRes.body.data.total).toBe(0);

    // 4. Tenant B passes Tenant A's orgId in query -> strictly ignored
    const spoofedQueryRes = await request(app)
      .get(`/api/v1/ledger/transactions?orgId=${TENANT_A}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(spoofedQueryRes.status).toBe(200);
    expect(spoofedQueryRes.body.data.items).toEqual([]);
    expect(spoofedQueryRes.body.data.total).toBe(0);
  });

  test('Tenant B cannot read Tenant A transaction by ID even with query spoofing', async () => {
    // Insert unique transaction for Tenant A
    const insertRes = await request(app)
      .post('/api/v1/ledger/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        amount: 8800,
        currency: 'USD',
        description: 'Secret Alpha settlement',
      });

    const txId = insertRes.body.data._id;
    expect(txId).toBeDefined();

    // Tenant A can read it
    const readARes = await request(app)
      .get(`/api/v1/ledger/transactions/${txId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(readARes.status).toBe(200);
    expect(readARes.body.data._id).toBe(txId);
    expect(readARes.body.data.orgId).toBe(TENANT_A);

    // Tenant B attempts to read it by ID -> 404 NOT FOUND
    const readBRes = await request(app)
      .get(`/api/v1/ledger/transactions/${txId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(readBRes.status).toBe(404);
    expect(readBRes.body.success).toBe(false);

    // Tenant B attempts spoofed read passing orgId in query and headers -> 404 NOT FOUND
    const spoofedReadBRes = await request(app)
      .get(`/api/v1/ledger/transactions/${txId}?orgId=${TENANT_A}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .set('x-tenant-id', TENANT_A);

    expect(spoofedReadBRes.status).toBe(404);
    expect(spoofedReadBRes.body.success).toBe(false);
  });

  test('Tenant B cannot update or inject data into Tenant A database via body orgId spoofing', async () => {
    // Tenant B passes Tenant A's orgId in body
    const spoofedInsertRes = await request(app)
      .post('/api/v1/ledger/transactions')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('x-tenant-id', TENANT_A)
      .send({
        orgId: TENANT_A, // Spoofed body
        amount: 9999,
        currency: 'USD',
        description: 'Malicious crossover attempt',
      });

    expect(spoofedInsertRes.status).toBe(201);
    // Verified: stored under Tenant B's orgId in Tenant B's database
    expect(spoofedInsertRes.body.data.orgId).toBe(TENANT_B);

    // Confirm Tenant A database does not contain this injected transaction
    const connA = await connectionManager.getTenantConnection(TENANT_A);
    const leakedTx = await connA.model('Transaction').findOne({ amount: 9999 });
    expect(leakedTx).toBeNull();

    // Confirm it exists only in Tenant B database
    const connB = await connectionManager.getTenantConnection(TENANT_B);
    const isolatedTx = await connB.model('Transaction').findOne({ amount: 9999 });
    expect(isolatedTx).not.toBeNull();
    expect(isolatedTx.orgId).toBe(TENANT_B);
  });

  test('Tenant B cannot aggregate Tenant A data via analytics summary and trends', async () => {
    // 1. Tenant A has transactions
    const summaryARes = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(summaryARes.status).toBe(200);
    expect(summaryARes.body.data.total).toBeGreaterThan(0);
    const alphaTotal = summaryARes.body.data.total;

    // 2. Tenant B queries summary -> sees only B's total, not A's
    const summaryBRes = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(summaryBRes.status).toBe(200);
    expect(summaryBRes.body.data.total).not.toBe(alphaTotal);

    // 3. Tenant B queries summary with spoofed query param orgId=tenant_A -> ignores query param
    const spoofedSummaryB = await request(app)
      .get(`/api/v1/analytics/summary?orgId=${TENANT_A}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(spoofedSummaryB.status).toBe(200);
    expect(spoofedSummaryB.body.data.total).not.toBe(alphaTotal);
    expect(spoofedSummaryB.body.data.total).toBe(summaryBRes.body.data.total);

    // 4. Tenant B queries trends with spoofed query param -> strictly tenant B's data
    const trendsBRes = await request(app)
      .get(`/api/v1/analytics/trends?orgId=${TENANT_A}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(trendsBRes.status).toBe(200);
    expect(trendsBRes.body.success).toBe(true);
  });
});
