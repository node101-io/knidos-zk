import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

interface StoredTask {
  _id: mongoose.Types.ObjectId;
  type: string;
  input: Record<string, unknown>;
  primus: unknown;
}

const taskStore = new Map<string, StoredTask>();

vi.mock('../src/db/task.js', () => {
  const TaskMock = {
    createTask: vi.fn(
      async (body: { type: string; input: Record<string, unknown> }): Promise<StoredTask> => {
        const _id = new mongoose.Types.ObjectId();
        const record: StoredTask = {
          _id,
          type: body.type,
          input: body.input,
          primus: null,
        };
        taskStore.set(_id.toString(), record);
        return record;
      },
    ),
    findById: vi.fn((id: string) => ({
      lean: async () => taskStore.get(id) ?? null,
    })),
    setPrimusCheckpoint: vi.fn(async (id: string, checkpoint: unknown) => {
      const doc = taskStore.get(id);
      if (doc) doc.primus = checkpoint;
    }),
    clearPrimusCheckpoint: vi.fn(async (id: string) => {
      const doc = taskStore.get(id);
      if (doc) doc.primus = null;
    }),
  };
  return { default: TaskMock };
});

const { default: Task } = await import('../src/db/task.js');
const { runZkTLSProcessor } = await import('../src/pipelines/zk-tls/processor.js');

describe('zk-tls processor', () => {
  it('fetches fills and produces valid NoirCircuitInput', async () => {
    const task = await Task.createTask({
      type: 'zkTLS',
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

    expect(result.action).toBe('completed');
    if (result.action !== 'completed') throw new Error('expected completed result');
    const input = result.input;

    expect(input.fillsCommitment).toHaveLength(2);
    const [fc0, fc1] = input.fillsCommitment;
    expect(fc0).toEqual(expect.any(String));
    expect(fc1).toEqual(expect.any(String));
    expect(fc0!.length).toBeGreaterThan(0);
    expect(fc1!.length).toBeGreaterThan(0);

    expect(input.rawFills).toHaveLength(8192);
    for (const byte of input.rawFills) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }

    expect(input.rawFillsLength).toBeGreaterThanOrEqual(0);
    expect(input.rawFillsLength).toBeLessThanOrEqual(8192);

    expect(input.startTime).toBe(1769172979000);
    expect(input.endTime).toBe(1769172996000);
    expect(input.baseBalance).toBe(100_000_000);
    expect(input.threshold).toBe(50_000_000);
  });
});
