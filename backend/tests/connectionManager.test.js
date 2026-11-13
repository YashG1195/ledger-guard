import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import { ConnectionManager } from '../src/db/connectionManager.js';

describe('ConnectionManager', () => {
  let manager;
  let connections;
  let createConnection;

  beforeEach(() => {
    connections = [];
    createConnection = jest.spyOn(mongoose, 'createConnection').mockImplementation((uri, options) => {
      const connection = {
        uri,
        options,
        models: {},
        readyState: 2,
        asPromise: jest.fn(async function () {
          this.readyState = 1;
          return this;
        }),
        model: jest.fn(function (name, schema) {
          const model = { modelName: name, schema };
          this.models[name] = model;
          return model;
        }),
        on: jest.fn(),
        close: jest.fn(async function () {
          this.readyState = 0;
        }),
      };

      connections.push(connection);
      return connection;
    });

    manager = new ConnectionManager({ cleanupIntervalMs: 60_000 });
  });

  afterEach(async () => {
    await manager.disconnectAll();
    jest.restoreAllMocks();
  });

  it('shares one pending connection and registers all tenant models', async () => {
    const [first, second] = await Promise.all([
      manager.getTenantConnection('org-one'),
      manager.getTenantConnection('org-one'),
    ]);

    expect(first).toBe(second);
    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(connections[0].options.dbName).toBe('tenant_org-one');
    expect(connections[0].model).toHaveBeenCalledTimes(3);
    expect(Object.keys(connections[0].models)).toEqual([
      'Ledger',
      'Transaction',
      'UsageEvent',
    ]);
  });

  it('uses a tenant URI and evicts the least recently used connection at the pool limit', async () => {
    manager.maxPoolSize = 1;
    manager.setTenantUri('org-one', 'mongodb://tenant-one:27017');

    const first = await manager.getTenantConnection('org-one');
    manager.connections.get('org-one').lastAccessed = 0;

    const second = await manager.getTenantConnection('org-two');

    expect(createConnection).toHaveBeenNthCalledWith(
      1,
      'mongodb://tenant-one:27017',
      expect.objectContaining({ dbName: 'tenant_org-one' })
    );
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(manager.connections.has('org-one')).toBe(false);
    expect(manager.connections.get('org-two').connection).toBe(second);
  });

  it('disconnects connections after they exceed the idle timeout', async () => {
    const connection = await manager.getTenantConnection('org-idle');
    manager.connections.get('org-idle').lastAccessed = Date.now() - manager.idleTimeoutMs - 1;

    await manager.evictIdleConnections();

    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(manager.connections.has('org-idle')).toBe(false);
  });
});
