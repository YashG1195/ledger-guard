import { generateRealisticEvents, seedTenantUsage } from '../scripts/seedUsage.js';
import { connectionManager } from '../src/db/connectionManager.js';
import { jest } from '@jest/globals';

describe('seedUsage', () => {
  describe('generateRealisticEvents', () => {
    it('generates chronological events spanning 180 days', () => {
      const events = generateRealisticEvents('org_test', 180);

      expect(events.length).toBeGreaterThan(500);
      expect(events[0].orgId).toBe('org_test');

      // Assert chronological sorting
      for (let i = 1; i < events.length; i += 1) {
        expect(events[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          events[i - 1].timestamp.getTime()
        );
      }
    });

    it('stores all costs as positive integer cents across the four resource types', () => {
      const events = generateRealisticEvents('org_test', 30);
      const resourcesSeen = new Set();

      for (const event of events) {
        resourcesSeen.add(event.resource);
        expect(Number.isInteger(event.cost)).toBe(true);
        expect(event.cost).toBeGreaterThan(0);
      }

      expect(resourcesSeen).toContain('api_calls');
      expect(resourcesSeen).toContain('storage');
      expect(resourcesSeen).toContain('compute');
      expect(resourcesSeen).toContain('bandwidth');
    });

    it('generates higher weekday traffic compared to weekends', () => {
      const events = generateRealisticEvents('org_test', 60);

      const weekdayCounts = [];
      const weekendCounts = [];

      // Group counts by date string
      const dailyBuckets = new Map();
      for (const event of events) {
        const key = event.timestamp.toISOString().slice(0, 10);
        dailyBuckets.set(key, (dailyBuckets.get(key) || 0) + 1);
      }

      for (const [dateStr, count] of dailyBuckets.entries()) {
        const day = new Date(dateStr).getDay();
        if (day === 0 || day === 6) {
          weekendCounts.push(count);
        } else {
          weekdayCounts.push(count);
        }
      }

      const avgWeekday = weekdayCounts.reduce((a, b) => a + b, 0) / weekdayCounts.length;
      const avgWeekend = weekendCounts.reduce((a, b) => a + b, 0) / weekendCounts.length;

      expect(avgWeekday).toBeGreaterThan(avgWeekend);
    });
  });

  describe('seedTenantUsage', () => {
    let mockInsertMany;
    let mockDeleteMany;
    let originalGetTenantConnection;

    beforeEach(() => {
      mockInsertMany = jest.fn().mockResolvedValue([]);
      mockDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 5 });

      const mockConn = {
        model: jest.fn().mockReturnValue({
          insertMany: mockInsertMany,
          deleteMany: mockDeleteMany,
        }),
      };

      originalGetTenantConnection = connectionManager.getTenantConnection;
      connectionManager.getTenantConnection = jest.fn().mockResolvedValue(mockConn);
    });

    afterEach(() => {
      connectionManager.getTenantConnection = originalGetTenantConnection;
      jest.restoreAllMocks();
    });

    it('inserts events via tenant connection and respects reset flag', async () => {
      const result = await seedTenantUsage('org_mock', { reset: true });

      expect(connectionManager.getTenantConnection).toHaveBeenCalledWith('org_mock');
      expect(mockDeleteMany).toHaveBeenCalledWith({ orgId: 'org_mock' });
      expect(mockInsertMany).toHaveBeenCalled();
      expect(result.count).toBeGreaterThan(0);
      expect(result.totalCostCents).toBeGreaterThan(0);
    });

    it('skips deleteMany when reset is false', async () => {
      await seedTenantUsage('org_mock', { reset: false });

      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(mockInsertMany).toHaveBeenCalled();
    });
  });
});
