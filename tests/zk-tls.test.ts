import { describe, expect, it } from 'vitest';

import { runZkTLSProcessor } from '../src/pipelines/zk-tls/processor.js';

describe('zk-tls processor', () => {
  it('fetches fills and produces valid NoirCircuitInput', async () => {
    const result = await runZkTLSProcessor({
      startTime: new Date(1769172979000),
      endTime: new Date(1769172996000),
      symbol: 'BTCUSDT',
      baseBalance: 100_000_000,
      threshold: 50_000_000,
    });

    expect(result).toBeDefined();

    // fillsCommitment: 2-element string array
    expect(result.fillsCommitment).toHaveLength(2);
    const [fc0, fc1] = result.fillsCommitment;
    expect(fc0).toEqual(expect.any(String));
    expect(fc1).toEqual(expect.any(String));
    expect(fc0!.length).toBeGreaterThan(0);
    expect(fc1!.length).toBeGreaterThan(0);

    // rawFills: 8192-element byte array
    expect(result.rawFills).toHaveLength(8192);
    for (const byte of result.rawFills) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }

    // rawFillsLength within bounds
    expect(result.rawFillsLength).toBeGreaterThanOrEqual(0);
    expect(result.rawFillsLength).toBeLessThanOrEqual(8192);

    // passthrough values
    expect(result.startTime).toBe(1769172979000);
    expect(result.endTime).toBe(1769172996000);
    expect(result.baseBalance).toBe(100_000_000);
    expect(result.threshold).toBe(50_000_000);
  });
});
