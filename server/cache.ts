import Redis from 'ioredis';
import { config } from './config';

/**
 * Redis-backed cache with a transparent in-memory fallback so the platform
 * boots even when no Redis instance is reachable (local dev / sandbox).
 * Real deployments: set REDIS_URL and every read goes through Redis.
 */
type MemoryEntry = { value: string; expiresAt: number };

class CacheLayer {
  private client: Redis | null = null;
  private memory = new Map<string, MemoryEntry>();
  status: 'connected' | 'memory-fallback' | 'connecting' = 'connecting';
  hits = 0;
  misses = 0;

  async init(): Promise<void> {
    if (!config.redisUrl) {
      this.status = 'memory-fallback';
      return;
    }
    try {
      const client = new Redis(config.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2500,
        retryStrategy: () => null
      });
      client.on('error', () => {
        /* handled below */
      });
      await client.connect();
      await client.ping();
      this.client = client;
      this.status = 'connected';
    } catch {
      this.client = null;
      this.status = 'memory-fallback';
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.client) {
      try {
        const raw = await this.client.get(key);
        if (raw) this.hits++;
        else this.misses++;
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        /* fall through to memory */
      }
    }
    const entry = this.memory.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.misses++;
      return null;
    }
    this.hits++;
    return JSON.parse(entry.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds = 5): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.client) {
      try {
        await this.client.set(key, raw, 'EX', ttlSeconds);
        return;
      } catch {
        /* fall through */
      }
    }
    this.memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
    if (this.memory.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.memory) if (v.expiresAt < now) this.memory.delete(k);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (this.client) {
      try {
        if (keys.length) await this.client.del(...keys);
      } catch {
        /* ignore */
      }
    }
    keys.forEach((k) => this.memory.delete(k));
  }

  async delPrefix(prefix: string): Promise<void> {
    if (this.client) {
      try {
        const keys = await this.client.keys(`${prefix}*`);
        if (keys.length) await this.client.del(...keys);
      } catch {
        /* ignore */
      }
    }
    for (const k of [...this.memory.keys()]) if (k.startsWith(prefix)) this.memory.delete(k);
  }

  stats() {
    return {
      status: this.status,
      keys: this.memory.size,
      hits: this.hits,
      misses: this.misses
    };
  }
}

export const cache = new CacheLayer();
export const cacheKeys = {
  examState: (examId: string, studentId: string) => `axiom:exam:${examId}:state:${studentId}`,
  leaderboard: (examId: string) => `axiom:exam:${examId}:leaderboard`,
  analytics: (examId: string) => `axiom:exam:${examId}:analytics`,
  examPrefix: (examId: string) => `axiom:exam:${examId}:`
};
