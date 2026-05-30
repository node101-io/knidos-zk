import { createHash } from 'crypto';

import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredTask = { _id: mongoose.Types.ObjectId; primus: unknown };

const taskStore = new Map<string, StoredTask>();
const mockFetchRawFillsByUrl = vi.fn();
const mockSubmitWithCapacity = vi.fn();
const mockAttestPrimusTask = vi.fn();
const mockVerifyPrimusTask = vi.fn();

const input = {
  startTime: new Date(1769172979000),
  endTime: new Date(1769172996000),
  symbol: 'BTCUSDT' as const,
  baseBalance: 100_000_000,
  threshold: 50_000_000,
};

const attest = {
  reportTxHash: '0xreport-tx',
  url: 'https://test.binance/fapi/v1/userTrades?signature=stub',
  attestedAt: Date.now(),
};

vi.mock('../src/db/task.js', async () => {
  const actual = await vi.importActual<typeof import('../src/db/task.js')>('../src/db/task.js');
  return {
    ...actual,
    Task: {
      findById: vi.fn((id: string) => ({
        lean: async () => taskStore.get(id) ?? null,
      })),
    },
  };
});

vi.mock('../src/db/task-helpers.js', () => ({
  setPrimusCheckpoint: vi.fn(async (id: string, checkpoint: unknown) => {
    const task = taskStore.get(id);
    if (task) task.primus = checkpoint;
  }),
  clearPrimusCheckpoint: vi.fn(async (id: string) => {
    const task = taskStore.get(id);
    if (task) task.primus = null;
  }),
}));

vi.mock('../src/primus/capacity.js', () => ({
  submitWithCapacity: (...args: unknown[]) => mockSubmitWithCapacity(...args),
}));

vi.mock('../src/primus/client.js', () => ({
  primusClient: {
    taskTimeoutMs: vi.fn(async () => 15 * 60 * 1000),
    sdk: vi.fn(async () => ({})),
  },
}));

vi.mock('../src/primus/task.js', () => ({
  attestPrimusTask: (...args: unknown[]) => mockAttestPrimusTask(...args),
  verifyPrimusTask: (...args: unknown[]) => mockVerifyPrimusTask(...args),
}));

vi.mock('../src/utils/fetch-raw-fills.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/utils/fetch-raw-fills.js')>(
      '../src/utils/fetch-raw-fills.js',
    );
  return {
    ...actual,
    fetchRawFillsByUrl: (...args: unknown[]) => mockFetchRawFillsByUrl(...args),
  };
});

const { runZkTLSProcessor } = await import('../src/pipelines/zk-tls/processor.js');

function makeTask(): StoredTask {
  const task = { _id: new mongoose.Types.ObjectId(), primus: null };
  taskStore.set(task._id.toString(), task);
  return task;
}

function sha256Hex(body: string): string {
  return `0x${createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex')}`;
}

function mockRawFills(body: string, commitment = sha256Hex(body)): void {
  mockFetchRawFillsByUrl.mockResolvedValue(new Uint8Array(Buffer.from(body, 'utf8')));
  mockVerifyPrimusTask.mockResolvedValue(commitment);
}

beforeEach(() => {
  taskStore.clear();
  mockFetchRawFillsByUrl.mockReset();
  mockSubmitWithCapacity.mockReset();
  mockAttestPrimusTask.mockReset();
  mockVerifyPrimusTask.mockReset();

  mockSubmitWithCapacity.mockResolvedValue({
    taskId: '0xprimus-task',
    taskTxHash: '0xsubmit-tx',
    taskAttestors: ['0xattestor'],
    submittedAt: Date.now(),
  });
  mockAttestPrimusTask.mockResolvedValue(attest);
});

describe('zk-tls processor', () => {
  it('accepts valid empty fills when the Primus commitment matches', async () => {
    mockRawFills('[]');

    const task = makeTask();
    const result = await runZkTLSProcessor(task._id.toString(), input);

    expect(result.action).toBe('completed');
    if (result.action !== 'completed') throw new Error('expected completed result');
    expect(result.input.rawFillsLength).toBe(2);
  });

  it('defers Binance error bodies before creating Noir input', async () => {
    const body = '{"code":-1021,"msg":"Timestamp for this request is outside of the recvWindow."}';
    mockRawFills(body);

    const task = makeTask();
    const result = await runZkTLSProcessor(task._id.toString(), input);

    expect(result).toMatchObject({ action: 'defer', reason: 'binance_response_invalid' });
    expect(task.primus).toBeNull();
  });

  it('defers when local rawFills do not match the Primus commitment', async () => {
    const errorBody =
      '{"code":-1021,"msg":"Timestamp for this request is outside of the recvWindow."}';
    mockRawFills('[]', sha256Hex(errorBody));

    const task = makeTask();
    const result = await runZkTLSProcessor(task._id.toString(), input);

    expect(result).toMatchObject({ action: 'defer', reason: 'primus_commitment_mismatch' });
    expect(task.primus).toBeNull();
  });
});
