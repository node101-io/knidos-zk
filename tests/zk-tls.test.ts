import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import Task from '../src/db/task.js';
import { env } from '../src/env.js';
import { runZkTLSProcessor } from '../src/pipelines/zk-tls/processor.js';

describe('zk-tls processor', () => {
  beforeAll(async () => {
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('fetches fills and produces valid NoirCircuitInput', async () => {
    const task = await Task.createTask({
      type: 'zkTLS',
      pipelineId: new mongoose.Types.ObjectId(),
      input: {
        startTime: new Date(1769172979000),
        endTime: new Date(1769172996000),
        symbol: 'BTCUSDT',
        proofType: 'binance-fills',
        baseBalance: 100_000_000,
        threshold: 50_000_000,
      },
    });

    const result = await runZkTLSProcessor(task._id.toString(), {
      startTime: new Date(1769172979000),
      endTime: new Date(1769172996000),
      symbol: 'BTCUSDT',
      baseBalance: 100_000_000,
      threshold: 50_000_000,
    });

    expect(result).toBeDefined();

    expect(result.fillsCommitment).toHaveLength(2);
    const [fc0, fc1] = result.fillsCommitment;
    expect(fc0).toEqual(expect.any(String));
    expect(fc1).toEqual(expect.any(String));
    expect(fc0!.length).toBeGreaterThan(0);
    expect(fc1!.length).toBeGreaterThan(0);

    expect(result.rawFills).toHaveLength(8192);
    for (const byte of result.rawFills) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }

    expect(result.rawFillsLength).toBeGreaterThanOrEqual(0);
    expect(result.rawFillsLength).toBeLessThanOrEqual(8192);

    expect(result.startTime).toBe(1769172979000);
    expect(result.endTime).toBe(1769172996000);
    expect(result.baseBalance).toBe(100_000_000);
    expect(result.threshold).toBe(50_000_000);
  });
});
