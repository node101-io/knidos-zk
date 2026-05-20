import { Redis } from 'ioredis';
import { env } from '../env.js';
import { waitForHost } from './wait-for-host.js';

// Block module evaluation until REDIS_HOST resolves. On swarm overlay networks
// the embedded DNS can take a few seconds to propagate a fresh container's
// peer — without this, BullMQ worker blocking connections race the DNS and
// emit noisy ENOTFOUND retries for ~10s before stabilising.
await waitForHost(env.REDIS_HOST);

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
