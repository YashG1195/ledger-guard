/**
 * Multi-tenant concurrency and isolation load test.
 *
 * Simulates 200 concurrent requests alternating across 10 distinct tenants.
 * Measures connection switching latency (p50/p95) and verifies that zero cross-tenant
 * data crossover occurs.
 *
 * Can be run from project root or backend directory:
 *   node scripts/loadtest.js
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { readFileSync, existsSync } from 'fs';

// Set baseline environment variables before loading any application modules
process.env.PORT = process.env.PORT || '3001';
process.env.NODE_ENV = 'test';
process.env.MONGO_BASE_URI = process.env.MONGO_BASE_URI || 'mongodb://localhost:27017';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_PRIVATE_KEY_PATH = process.env.JWT_PRIVATE_KEY_PATH || 'keys/private.pem';
process.env.JWT_PUBLIC_KEY_PATH = process.env.JWT_PUBLIC_KEY_PATH || 'keys/public.pem';
process.env.LOG_LEVEL = 'silent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const backendDir = path.resolve(rootDir, 'backend');

// Resolve node_modules path from backend directory
const nodeModulesDir = existsSync(path.join(backendDir, 'node_modules'))
  ? path.join(backendDir, 'node_modules')
  : path.join(rootDir, 'node_modules');

const supertestPath = pathToFileURL(path.join(nodeModulesDir, 'supertest', 'index.js')).href;
const jwtPath = pathToFileURL(path.join(nodeModulesDir, 'jsonwebtoken', 'index.js')).href;
const mmsPath = pathToFileURL(path.join(nodeModulesDir, 'mongodb-memory-server', 'index.js')).href;
const appPath = pathToFileURL(path.join(backendDir, 'src', 'app.js')).href;
const connMgrPath = pathToFileURL(path.join(backendDir, 'src', 'db', 'connectionManager.js')).href;

const request = (await import(supertestPath)).default;
const jwt = (await import(jwtPath)).default;
const { MongoMemoryReplSet } = await import(mmsPath);
const { createApp } = await import(appPath);
const { connectionManager } = await import(connMgrPath);

function resolvePrivateKey() {
  const candidates = [
    process.env.JWT_PRIVATE_KEY_PATH,
    path.resolve(backendDir, 'keys', 'private.pem'),
    path.resolve(rootDir, 'keys', 'private.pem'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  throw new Error('JWT private key not found');
}

function mintToken(privateKey, orgId) {
  return jwt.sign(
    { sub: `user_${orgId}`, orgId, role: 'admin' },
    privateKey,
    { algorithm: 'RS256', expiresIn: '1h' }
  );
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runLoadTest() {
  console.log('Initializing in-memory replica set for multi-tenant load test...');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri();
  process.env.MONGO_BASE_URI = uri;

  const { app } = createApp();
  const privateKey = resolvePrivateKey();

  const NUM_TENANTS = 10;
  const TOTAL_REQUESTS = 200;

  const tenants = Array.from({ length: NUM_TENANTS }, (_, i) => {
    const orgId = `tenant_load_${i}`;
    return {
      orgId,
      token: mintToken(privateKey, orgId),
    };
  });

  console.log(`Starting load test: ${TOTAL_REQUESTS} concurrent requests alternating between ${NUM_TENANTS} tenants...`);

  const latencies = [];
  const responses = [];

  const requests = Array.from({ length: TOTAL_REQUESTS }, async (_, idx) => {
    const tenant = tenants[idx % NUM_TENANTS];
    const amount = 1000 + (idx % 100);
    const start = performance.now();

    try {
      const res = await request(app)
        .post('/api/v1/ledger/transactions')
        .set('Authorization', `Bearer ${tenant.token}`)
        .send({
          amount,
          currency: 'USD',
          description: `Load test tx ${idx} for ${tenant.orgId}`,
        });

      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      responses.push({
        idx,
        expectedOrgId: tenant.orgId,
        receivedOrgId: res.body?.data?.orgId,
        status: res.status,
      });
    } catch (err) {
      responses.push({
        idx,
        expectedOrgId: tenant.orgId,
        error: err.message,
        status: 500,
      });
    }
  });

  await Promise.all(requests);

  // Compute performance metrics
  const p50 = percentile(latencies, 50).toFixed(2);
  const p95 = percentile(latencies, 95).toFixed(2);
  const p99 = percentile(latencies, 99).toFixed(2);
  const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);

  // Assert zero data crossover across responses
  let crossoverViolations = 0;
  for (const resp of responses) {
    if (resp.status !== 201 || resp.receivedOrgId !== resp.expectedOrgId) {
      crossoverViolations++;
      console.error(`Crossover detected at request ${resp.idx}: expected ${resp.expectedOrgId}, got ${resp.receivedOrgId}`);
    }
  }

  // Physical database boundary audit: verify transactions inside each tenant's isolated database
  console.log('Auditing physical database boundaries across all tenant databases...');
  for (const tenant of tenants) {
    const conn = await connectionManager.getTenantConnection(tenant.orgId);
    const transactions = await conn.model('Transaction').find({}).lean();

    for (const tx of transactions) {
      if (tx.orgId !== tenant.orgId) {
        crossoverViolations++;
        console.error(`Physical crossover detected in ${conn.name}: found record with orgId ${tx.orgId}`);
      }
    }
  }

  // Summary output
  console.log('--------------------------------------------------');
  console.log('Load Test and Isolation Results:');
  console.log(`- Total Requests Completed: ${latencies.length} / ${TOTAL_REQUESTS}`);
  console.log(`- Active Tenants:           ${NUM_TENANTS}`);
  console.log(`- Average Latency:          ${avg} ms`);
  console.log(`- Connection Switch (p50):  ${p50} ms`);
  console.log(`- Connection Switch (p95):  ${p95} ms`);
  console.log(`- Connection Switch (p99):  ${p99} ms`);
  console.log(`- Crossover Violations:     ${crossoverViolations}`);
  console.log(`- Isolation Audit Status:   ${crossoverViolations === 0 ? 'VERIFIED (ZERO CROSSOVER)' : 'FAILED'}`);
  console.log('--------------------------------------------------');

  await connectionManager.disconnectAll();
  await replSet.stop();

  if (crossoverViolations > 0) {
    process.exit(1);
  }
}

runLoadTest().catch((err) => {
  console.error('Load test encountered an error:', err);
  process.exit(1);
});
