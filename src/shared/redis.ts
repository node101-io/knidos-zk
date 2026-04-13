import { Redis } from 'ioredis';
import type { RedisClient } from 'hono-rate-limiter';
import { env } from '../env.js';

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
});

/** ioredis → hono-rate-limiter RedisClient adapter */
export const redisRateLimitClient: RedisClient = {
  scriptLoad: (script) => redis.script('LOAD', script) as Promise<string>,
  evalsha: (sha, keys, args) =>
    redis.evalsha(sha, keys.length, ...keys, ...(args as string[])) as Promise<never>,
  decr: (key) => redis.decr(key),
  del: (key) => redis.del(key),
};
