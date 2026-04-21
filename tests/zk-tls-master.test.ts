import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindOne = vi.fn();
const mockMarkTaskQueued = vi.fn();
const mockQueueAdd = vi.fn();

vi.mock('../src/db/task.js', () => ({
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    markTaskQueued: (...args: unknown[]) => mockMarkTaskQueued(...args),
  },
}));

vi.mock('../src/pipelines/zk-tls/worker.js', () => ({
  zkTLSQueue: {
    add: (...args: unknown[]) => mockQueueAdd(...args),
  },
}));

const { ZkTLSMaster } = await import('../src/pipelines/zk-tls/master.js');

class TestZkTLSMaster extends ZkTLSMaster {
  async runOnce(): Promise<void> {
    await this.handleTask();
  }
}

function buildTask(status: string) {
  return {
    _id: new mongoose.Types.ObjectId(),
    status,
    input: {
      startTime: new Date('2026-01-01T00:00:00.000Z'),
      endTime: new Date('2026-01-01T00:15:00.000Z'),
      symbol: 'BTCUSDT',
      proofType: 'binance-fills',
      baseBalance: 100_000_000,
      threshold: 50_000_000,
    },
  };
}

beforeEach(() => {
  mockFindOne.mockReset();
  mockMarkTaskQueued.mockReset();
  mockQueueAdd.mockReset();
});

describe('ZkTLSMaster', () => {
  it('queries the oldest pending or due deferred task and queues only one job', async () => {
    const task = buildTask('DEFERRED');
    const exec = vi.fn().mockResolvedValue(task);
    const sort = vi.fn().mockReturnValue({ exec });
    mockFindOne.mockReturnValue({ sort });
    mockQueueAdd.mockResolvedValue(undefined);
    mockMarkTaskQueued.mockResolvedValue(undefined);

    const master = new TestZkTLSMaster({
      queueName: 'zkTLS-queue',
      workerLabel: 'zkTLS',
      connection: {} as never,
      workerCount: 1,
      retryAttempts: 1,
      retryBackoffMs: 5000,
      lockDurationMs: 60_000,
      stalledIntervalMs: 60_000,
      processJob: vi.fn(),
    });

    await master.runOnce();

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'zkTLS',
        $or: [
          { status: 'PENDING' },
          { status: 'DEFERRED', deferUntil: { $lte: expect.any(Date) } },
        ],
      }),
    );
    expect(sort).toHaveBeenCalledWith({ 'input.endTime': 1, _id: 1 });
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockMarkTaskQueued).toHaveBeenCalledWith(task._id.toString());
  });
});
