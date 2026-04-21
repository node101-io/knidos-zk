import dns from 'node:dns/promises';

import logger from './logger.js';

export async function waitForHost(hostname: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      await dns.lookup(hostname);
      if (attempt > 0) {
        logger.info(
          { hostname, attempts: attempt + 1, elapsedMs: Date.now() - start },
          '[wait-for-host] resolved',
        );
      }
      return;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`DNS lookup for ${hostname} timed out after ${timeoutMs}ms`);
      }
      const delayMs = Math.min(250 * 2 ** Math.min(attempt, 5), 2000);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
