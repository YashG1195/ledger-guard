import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { tenantSchemas } from './schemas/index.js';
import { sendError } from '../utils/response.js';

/**
 * Manages dynamically isolated MongoDB connections per tenant.
 * Guarantees zero shared default connection use across tenants.
 */
export class ConnectionManager {
  /**
   * @param {object} [options]
   * @param {number} [options.maxPoolSize=50] Maximum active tenant connections cached
   * @param {number} [options.idleTimeoutMinutes=10] Idle minutes before connection is evicted
   * @param {number} [options.cleanupIntervalMs=60000] Interval to check for idle connections
   * @param {Map<string, string>} [options.tenantUriMap] Tenant-specific MongoDB URIs
   */
  constructor(options = {}) {
    this.maxPoolSize = options.maxPoolSize ?? env.TENANT_CONNECTION_MAX_POOL_SIZE;
    this.idleTimeoutMs =
      (options.idleTimeoutMinutes ?? env.TENANT_CONNECTION_IDLE_TIMEOUT_MINUTES) * 60 * 1000;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;

    /** @type {Map<string, { connection: mongoose.Connection | null, promise: Promise<mongoose.Connection> | null, lastAccessed: number }>} */
    this.connections = new Map();

    /** @type {Map<string, string>} orgId -> dedicated MongoDB URI */
    this.tenantUriMap = options.tenantUriMap ?? new Map();

    this.cleanupTimer = setInterval(() => this.evictIdleConnections(), this.cleanupIntervalMs);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    this.isShuttingDown = false;
  }

  /**
   * Register a custom URI for a specific tenant (e.g. dedicated cluster/database)
   * @param {string} orgId
   * @param {string} uri
   */
  setTenantUri(orgId, uri) {
    if (typeof orgId !== 'string' || !orgId.trim() || typeof uri !== 'string' || !uri.trim()) {
      throw new Error('A tenant orgId and MongoDB URI are required');
    }

    this.tenantUriMap.set(orgId.trim(), uri.trim());
  }

  /**
   * Builds the database connection URI and options for a tenant.
   * @param {string} orgId
   * @returns {{ uri: string, dbName: string }}
   */
  resolveTenantConfig(orgId) {
    const cleanOrgId = Array.from(orgId, (character) =>
      /^[a-zA-Z0-9_-]$/.test(character)
        ? character
        : `%${character.codePointAt(0).toString(16)}`
    ).join('');
    const dbName = `tenant_${cleanOrgId}`;

    const customUri = this.tenantUriMap.get(orgId);
    if (customUri) {
      return { uri: customUri, dbName };
    }

    return { uri: env.MONGO_BASE_URI, dbName };
  }

  /**
   * Registers all tenant models on a connection using conn.model(name, schema).
   * @param {mongoose.Connection} conn
   */
  registerTenantModels(conn) {
    for (const [modelName, schema] of Object.entries(tenantSchemas)) {
      if (!conn.models[modelName]) {
        conn.model(modelName, schema);
      }
    }
  }

  /**
   * Returns a cached mongoose connection for the tenant.
   * Concurrent requests for the same tenant share a single pending connection promise.
   * @param {string} orgId
   * @returns {Promise<mongoose.Connection>}
   */
  async getTenantConnection(orgId) {
    if (typeof orgId !== 'string' || !orgId.trim()) {
      throw new Error('Valid orgId string is required to get a tenant connection');
    }

    orgId = orgId.trim();
    const cached = this.connections.get(orgId);
    if (cached) {
      cached.lastAccessed = Date.now();

      // If already connected and ready, return immediately
      if (cached.connection && cached.connection.readyState === 1) {
        return cached.connection;
      }

      // If connection in progress, await the existing promise
      if (cached.promise) {
        return cached.promise;
      }

      if (cached.connection) {
        await this.disconnectTenant(orgId);
        return this.getTenantConnection(orgId);
      }
    }

    // Deduplicate concurrent connection attempts for the same tenant
    const record = {
      connection: null,
      promise: null,
      lastAccessed: Date.now(),
    };
    const connectPromise = this.#createTenantConnection(orgId);
    record.promise = connectPromise;
    this.connections.set(orgId, record);

    try {
      const conn = await connectPromise;
      if (this.connections.get(orgId) === record) {
        record.connection = conn;
        record.promise = null;
        record.lastAccessed = Date.now();
      }

      await this.enforcePoolLimits();
      return conn;
    } catch (err) {
      if (this.connections.get(orgId) === record) {
        this.connections.delete(orgId);
      }
      logger.error({ err, orgId }, 'failed to establish tenant connection');
      throw err;
    }
  }

  /**
   * Creates and initializes a new isolated connection.
   * @param {string} orgId
   * @returns {Promise<mongoose.Connection>}
   */
  async #createTenantConnection(orgId) {
    const { uri, dbName } = this.resolveTenantConfig(orgId);

    // Mongoose createConnection creates an isolated client instance without touching global default
    const conn = mongoose.createConnection(uri, {
      dbName,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      autoIndex: env.NODE_ENV !== 'production',
    });

    conn.on('error', (err) => {
      logger.error({ err, orgId, dbName }, 'tenant connection error');
    });

    conn.on('disconnected', () => {
      logger.warn({ orgId, dbName }, 'tenant connection disconnected');
    });

    try {
      await conn.asPromise();
      this.registerTenantModels(conn);
    } catch (err) {
      try {
        await conn.close(false);
      } catch (closeError) {
        logger.warn({ err: closeError, orgId, dbName }, 'error closing failed tenant connection');
      }
      throw err;
    }

    logger.info({ orgId, dbName }, 'isolated tenant connection established');
    return conn;
  }

  /**
   * Enforces maxPoolSize using LRU eviction.
   */
  async enforcePoolLimits() {
    while (this.connections.size > this.maxPoolSize) {
      let oldestKey = null;
      let oldestTime = Infinity;

      for (const [key, record] of this.connections.entries()) {
        if (record.connection && !record.promise && record.lastAccessed < oldestTime) {
          oldestTime = record.lastAccessed;
          oldestKey = key;
        }
      }

      if (!oldestKey) return;

      logger.info({ orgId: oldestKey }, 'lru evicting tenant connection');
      await this.disconnectTenant(oldestKey);
    }
  }

  /**
   * Evicts connections that have been idle longer than idleTimeoutMs.
   */
  async evictIdleConnections() {
    const now = Date.now();
    const evictions = [];

    for (const [orgId, record] of this.connections.entries()) {
      if (record.connection && !record.promise && now - record.lastAccessed > this.idleTimeoutMs) {
        logger.info({ orgId, idleForMs: now - record.lastAccessed }, 'evicting idle tenant connection');
        evictions.push(this.disconnectTenant(orgId));
      }
    }

    await Promise.allSettled(evictions);
  }

  /**
   * Disconnects and removes a single tenant connection.
   * @param {string} orgId
   * @returns {Promise<boolean>}
   */
  async disconnectTenant(orgId) {
    const record = this.connections.get(orgId);
    if (!record) return false;

    this.connections.delete(orgId);

    try {
      const conn = record.connection || (await record.promise.catch(() => null));
      if (conn) {
        await conn.close(false);
        logger.info({ orgId }, 'tenant connection closed');
      }
      return true;
    } catch (err) {
      logger.warn({ err, orgId }, 'error closing tenant connection');
      return false;
    }
  }

  /**
   * Closes all tenant connections and cleans up background timers.
   * @returns {Promise<void>}
   */
  async disconnectAll() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const closePromises = [];
    for (const [orgId, record] of this.connections.entries()) {
      closePromises.push(
        (async () => {
          try {
            const conn = record.connection || (await record.promise.catch(() => null));
            if (conn) await conn.close(false);
          } catch (err) {
            logger.warn({ err, orgId }, 'error during disconnectAll');
          }
        })()
      );
    }

    this.connections.clear();
    await Promise.allSettled(closePromises);
    logger.info('all tenant connections closed');
  }

  /**
   * Returns list of currently tracked tenant connections.
   * @returns {Array<{ orgId: string, readyState: number, lastAccessed: number }>}
   */
  listActive() {
    const list = [];
    for (const [orgId, record] of this.connections.entries()) {
      list.push({
        orgId,
        readyState: record.connection ? record.connection.readyState : 2, // 2 = connecting
        lastAccessed: record.lastAccessed,
      });
    }
    return list;
  }
}

// Singleton instance
export const connectionManager = new ConnectionManager();

// Convenience delegates matching prompt methods
export const getTenantConnection = (orgId) => connectionManager.getTenantConnection(orgId);
export const disconnectTenant = (orgId) => connectionManager.disconnectTenant(orgId);
export const disconnectAll = () => connectionManager.disconnectAll();
export const listActive = () => connectionManager.listActive();
export default connectionManager;

/**
 * Express middleware that runs after authGateway and injects isolated tenant db into req.db.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function tenantContext(req, res, next) {
  const orgId = req.tenant?.orgId || req.tenantId;

  if (!orgId) {
    return sendError(res, 'FORBIDDEN', 'Tenant context required', null, 403);
  }

  let db;
  try {
    db = await connectionManager.getTenantConnection(orgId);
  } catch (err) {
    req.log?.error({ err, orgId }, 'failed to attach tenant database context');
    return sendError(
      res,
      'SERVICE_UNAVAILABLE',
      'Tenant database is temporarily unavailable',
      null,
      503
    );
  }

  req.db = db;
  req.models = db.models;
  next();
}
