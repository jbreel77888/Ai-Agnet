/**
 * Redis client — singleton
 *
 * Used by:
 * - ShortTermMemory
 * - BullMQ queues
 * - Rate limiter
 * - Caching
 */
import Redis from 'ioredis';

let redisClient: Redis | null = null;
let redisConnection: Redis | null = null; // for BullMQ (separate connection)

function createClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[redis] REDIS_URL not set — using memory fallback (dev only)');
    return createMemoryFallback();
  }
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
}

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = createClient();
    redisClient.on('error', (err) => console.error('[redis] Error:', err));
    redisClient.on('connect', () => console.log('[redis] Connected'));
  }
  return redisClient;
}

export function getRedisConnection(): Redis {
  // BullMQ requires a separate connection for subscriber events
  if (!redisConnection) {
    redisConnection = createClient();
  }
  return redisConnection;
}

// In-memory fallback for development without Redis
function createMemoryFallback(): Redis {
  console.warn('[redis] Using in-memory fallback — NOT for production!');
  const store = new Map<string, { value: string; expiresAt?: number }>();
  const mock: any = {
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, opts?: any) {
      let expiresAt: number | undefined;
      if (opts?.EX) expiresAt = Date.now() + opts.EX * 1000;
      if (opts?.PX) expiresAt = Date.now() + opts.PX;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async del(...keys: string[]) {
      let count = 0;
      for (const k of keys) if (store.delete(k)) count++;
      return count;
    },
    async exists(key: string) {
      const entry = store.get(key);
      if (!entry) return 0;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        store.delete(key);
        return 0;
      }
      return 1;
    },
    async incr(key: string) {
      const cur = parseInt((await mock.get(key)) || '0', 10);
      const next = cur + 1;
      const entry = store.get(key);
      await mock.set(key, String(next), entry?.expiresAt ? { PX: entry.expiresAt - Date.now() } : undefined);
      return next;
    },
    async expire(key: string, seconds: number) {
      const entry = store.get(key);
      if (entry) {
        entry.expiresAt = Date.now() + seconds * 1000;
        return 1;
      }
      return 0;
    },
    async hset(key: string, field: string, value: string) {
      const fullKey = `${key}__hset__${field}`;
      store.set(fullKey, { value });
      return 1;
    },
    async hget(key: string, field: string) {
      const fullKey = `${key}__hset__${field}`;
      return (await mock.get(fullKey)) || null;
    },
    async hgetall(key: string) {
      const result: Record<string, string> = {};
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${key}__hset__`)) {
          result[k.slice(`${key}__hset__`.length)] = v.value;
        }
      }
      return result;
    },
    async lpush(key: string, ...values: string[]) {
      // Simplified — not a real list
      const listKey = `${key}__list`;
      const cur = JSON.parse((await mock.get(listKey)) || '[]');
      cur.unshift(...values);
      await mock.set(listKey, JSON.stringify(cur));
      return cur.length;
    },
    async lrange(key: string, start: number, stop: number) {
      const listKey = `${key}__list`;
      const cur = JSON.parse((await mock.get(listKey)) || '[]');
      const end = stop === -1 ? cur.length : stop + 1;
      return cur.slice(start, end);
    },
    async ltrim(key: string, start: number, stop: number) {
      const listKey = `${key}__list`;
      const cur = JSON.parse((await mock.get(listKey)) || '[]');
      const end = stop === -1 ? cur.length : stop + 1;
      const trimmed = cur.slice(start, end);
      await mock.set(listKey, JSON.stringify(trimmed));
      return 'OK';
    },
    async llen(key: string) {
      const listKey = `${key}__list`;
      const cur = JSON.parse((await mock.get(listKey)) || '[]');
      return cur.length;
    },
    on() { return mock; },
    disconnect() {},
    ping: async () => 'PONG',
  };
  return mock as Redis;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
  }
  if (redisConnection) {
    await redisConnection.quit().catch(() => {});
    redisConnection = null;
  }
}
