import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Baseline environment configuration before dynamic imports
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.MONGO_BASE_URI = process.env.MONGO_BASE_URI || 'mongodb://localhost:27017';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_PRIVATE_KEY_PATH =
  process.env.JWT_PRIVATE_KEY_PATH || path.join(backendDir, 'keys', 'private.pem');
process.env.JWT_PUBLIC_KEY_PATH =
  process.env.JWT_PUBLIC_KEY_PATH || path.join(backendDir, 'keys', 'public.pem');
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const connMgrPath = pathToFileURL(path.join(backendDir, 'src', 'db', 'connectionManager.js')).href;
const { connectionManager } = await import(connMgrPath);

const RESOURCE_PROFILES = {
  api_calls: {
    minCostCents: 1,
    maxCostCents: 25,
    weekdayEvents: { min: 20, max: 45 },
    weekendEvents: { min: 4, max: 12 },
  },
  storage: {
    minCostCents: 50,
    maxCostCents: 350,
    weekdayEvents: { min: 1, max: 3 },
    weekendEvents: { min: 1, max: 2 },
  },
  compute: {
    minCostCents: 100,
    maxCostCents: 1400,
    weekdayEvents: { min: 8, max: 20 },
    weekendEvents: { min: 2, max: 6 },
  },
  bandwidth: {
    minCostCents: 15,
    maxCostCents: 280,
    weekdayEvents: { min: 12, max: 28 },
    weekendEvents: { min: 3, max: 8 },
  },
};

function parseArgs(args) {
  const tenants = [];
  let reset = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--reset') {
      reset = true;
    } else if (arg.startsWith('--tenant=')) {
      const raw = arg.slice('--tenant='.length);
      raw.split(',').forEach((t) => {
        const clean = t.trim();
        if (clean) tenants.push(clean);
      });
    } else if (arg === '--tenant' && i + 1 < args.length) {
      i += 1;
      const raw = args[i];
      raw.split(',').forEach((t) => {
        const clean = t.trim();
        if (clean) tenants.push(clean);
      });
    }
  }

  if (tenants.length === 0) {
    tenants.push('org_demo_1', 'org_demo_2');
  }

  return { tenants: Array.from(new Set(tenants)), reset };
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateRealisticEvents(orgId, totalDays = 180) {
  const events = [];
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (let daysAgo = totalDays; daysAgo >= 0; daysAgo -= 1) {
    const dayStart = new Date(now - daysAgo * ONE_DAY_MS);
    dayStart.setHours(0, 0, 0, 0);

    const dayOfWeek = dayStart.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Upward trend: usage increases steadily by up to 50% across 6 months
    const trendFactor = 1.0 + ((totalDays - daysAgo) / totalDays) * 0.5;

    // Occasional traffic spikes (~4% chance per day)
    const isSpike = Math.random() < 0.04;
    const spikeMultiplier = isSpike ? 2.5 + Math.random() * 2.5 : 1.0;

    for (const [resource, config] of Object.entries(RESOURCE_PROFILES)) {
      const eventRange = isWeekend ? config.weekendEvents : config.weekdayEvents;
      const baseCount = getRandomInt(eventRange.min, eventRange.max);
      const eventCount = Math.max(1, Math.round(baseCount * trendFactor * spikeMultiplier));

      for (let i = 0; i < eventCount; i += 1) {
        // Random time distributed throughout the day
        const timestamp = new Date(dayStart.getTime() + Math.floor(Math.random() * ONE_DAY_MS));

        const baseCost = getRandomInt(config.minCostCents, config.maxCostCents);
        const adjustedCost = Math.round(baseCost * (isSpike ? 1.4 : 1.0));
        const cost = Math.max(1, Math.round(adjustedCost));

        events.push({
          orgId,
          resource,
          cost,
          timestamp,
        });
      }
    }
  }

  // Sort chronologically
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return events;
}

export async function seedTenantUsage(orgId, { reset = false } = {}) {
  // Always use isolated connection from tenant connection manager
  const conn = await connectionManager.getTenantConnection(orgId);
  const UsageEvent = conn.model('UsageEvent');

  if (reset) {
    const result = await UsageEvent.deleteMany({ orgId });
    console.log(`[seed] Reset: cleared ${result.deletedCount} existing events for ${orgId}`);
  }

  const events = generateRealisticEvents(orgId, 180);
  const batchSize = 500;

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    await UsageEvent.insertMany(batch, { ordered: false });
  }

  const totalCostCents = events.reduce((sum, item) => sum + item.cost, 0);
  const totalDollars = (totalCostCents / 100).toFixed(2);
  console.log(
    `[seed] Seeded ${events.length} usage events for ${orgId} (total cost: $${totalDollars})`
  );

  return { count: events.length, totalCostCents };
}

export async function run() {
  const { tenants, reset } = parseArgs(process.argv.slice(2));

  console.log(
    `[seed] Starting usage seeding for ${tenants.length} tenant(s) (reset: ${reset})`
  );

  try {
    for (const tenantId of tenants) {
      await seedTenantUsage(tenantId, { reset });
    }
    console.log('[seed] Seeding completed successfully');
  } catch (err) {
    console.error('[seed] Error seeding usage data:', err);
    process.exitCode = 1;
  } finally {
    await connectionManager.disconnectAll();
  }
}

// Auto-run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await run();
}
