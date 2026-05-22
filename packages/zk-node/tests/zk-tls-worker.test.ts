import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindById = vi.fn();
const mockUpdateTaskStatus = vi.fn();
const mockCreateTask = vi.fn();
const mockRunZkTLSProcessor = vi.fn();

vi.mock('../src/db/task.js', async () => {
  const actual = await vi.importActual<typeof import('../src/db/task.js')>('../src/db/task.js');
  return {
    ...actual,
    Task: {
      findById: (...args: unknown[]) => mockFindById(...args),
      updateOne: vi.fn(),
    },
  };
});

vi.mock('../src/db/task-helpers.js', () => ({
  updateTaskStatus: (...args: unknown[]) => mockUpdateTaskStatus(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
}));

vi.mock('../src/pipelines/zk-tls/processor.js', () => ({
  runZkTLSProcessor: (...args: unknown[]) => mockRunZkTLSProcessor(...args),
}));

vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      startSession: vi.fn(async () => ({
        withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()),
        endSession: vi.fn(),
      })),
    },
    startSession: vi.fn(async () => ({
      withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()),
      endSession: vi.fn(),
    })),
  };
});

const { processZkTLSJob } = await import('../src/pipelines/zk-tls/worker.js');
const { createTaskEventCtx } = await import('../src/shared/task-event.js');

function buildCtx() {
  return createTaskEventCtx({});
}

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    status: 'QUEUED',
    deferCount: 0,
    ...overrides,
  };
}

function buildJob(taskId: string) {
  return {
    id: 'job-1',
    data: {
      taskId,
      input: {
        startTime: new Date('2026-01-01T00:00:00.000Z'),
        endTime: new Date('2026-01-01T00:15:00.000Z'),
        symbol: 'BTCUSDT',
        proofType: 'binance-fills',
        baseBalance: 100_000_000,
        threshold: 50_000_000,
      },
    },
  };
}

beforeEach(() => {
  mockFindById.mockReset();
  mockUpdateTaskStatus.mockReset();
  mockCreateTask.mockReset();
  mockRunZkTLSProcessor.mockReset();
});

describe('processZkTLSJob', () => {
  it('marks rate-limited tasks as DEFERRED instead of FAILED', async () => {
    const task = buildTask();
    mockFindById.mockResolvedValue(task);
    mockRunZkTLSProcessor.mockRejectedValue({
      code: '00000',
      message: 'Operation too frequent. Please try again later.',
    });

    await processZkTLSJob(0, buildJob(task._id.toString()) as never, buildCtx());

    expect(mockUpdateTaskStatus).toHaveBeenNthCalledWith(1, {
      taskId: task._id.toString(),
      status: 'RUNNING',
    });
    expect(mockUpdateTaskStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: task._id.toString(),
        status: 'DEFERRED',
        deferReason: 'primus_rate_limited',
        deferCount: 1,
      }),
    );
  });

  it('marks Primus websocket transport errors as DEFERRED', async () => {
    const task = buildTask();
    mockFindById.mockResolvedValue(task);
    mockRunZkTLSProcessor.mockRejectedValue({
      code: '10003',
      message: 'Unstable internet connection. Please try again.',
      data: {
        retdesc:
          '10003:run_client do_offline exception: [PrimusServerNetworkError]recv websocket header error',
      },
    });

    await processZkTLSJob(0, buildJob(task._id.toString()) as never, buildCtx());

    expect(mockUpdateTaskStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: task._id.toString(),
        status: 'DEFERRED',
        deferReason: 'primus_attestor_transient',
        deferCount: 1,
      }),
    );
  });

  it('preserves explicit defer decisions from the capacity manager', async () => {
    const task = buildTask({ deferCount: 2 });
    mockFindById.mockResolvedValue(task);
    mockRunZkTLSProcessor.mockResolvedValue({
      action: 'defer',
      reason: 'primus_capacity_full_wait',
      deferUntil: new Date('2026-01-01T00:20:00.000Z'),
    });

    await processZkTLSJob(0, buildJob(task._id.toString()) as never, buildCtx());

    expect(mockUpdateTaskStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: task._id.toString(),
        status: 'DEFERRED',
        deferReason: 'primus_capacity_full_wait',
        deferCount: 3,
        deferUntil: new Date('2026-01-01T00:20:00.000Z'),
      }),
    );
  });

  it('marks insufficient-funds errors as FAILED', async () => {
    const task = buildTask();
    mockFindById.mockResolvedValue(task);
    mockRunZkTLSProcessor.mockRejectedValue(
      new Error('insufficient funds for intrinsic transaction cost'),
    );

    await processZkTLSJob(0, buildJob(task._id.toString()) as never, buildCtx());

    expect(mockUpdateTaskStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: task._id.toString(),
        status: 'FAILED',
      }),
    );
  });

  // Production INSUFFICIENT_FUNDS from ethers v5 is wrapped with a nested
  // SERVER_ERROR. Before the classifier split, this was routed to DEFERRED
  // via the 'server_error' transient token, causing a 60s retry loop.
  it('marks wrapped ethers INSUFFICIENT_FUNDS errors as FAILED, not DEFERRED', async () => {
    const task = buildTask();
    mockFindById.mockResolvedValue(task);
    mockRunZkTLSProcessor.mockRejectedValue({
      code: 'INSUFFICIENT_FUNDS',
      reason: 'insufficient funds for intrinsic transaction cost',
      error: {
        code: 'SERVER_ERROR',
        body: '{"jsonrpc":"2.0","error":{"code":-32003,"message":"insufficient funds for gas * price + value: have X want Y"},"id":1}',
      },
    });

    await processZkTLSJob(0, buildJob(task._id.toString()) as never, buildCtx());

    expect(mockUpdateTaskStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: task._id.toString(),
        status: 'FAILED',
      }),
    );
  });

  it('marks nested upstream 502 wrappers as DEFERRED', async () => {
    const task = buildTask();
    mockFindById.mockResolvedValue(task);
    mockRunZkTLSProcessor.mockRejectedValue({
      name: 'Error',
      message:
        'missing revert data in call exception; Transaction reverted without a reason string',
      code: 'CALL_EXCEPTION',
      error: {
        name: 'Error',
        message: 'bad response',
        code: 'SERVER_ERROR',
        status: 502,
        body: 'error code: 502',
        url: 'https://sepolia.base.org',
      },
    });

    await processZkTLSJob(0, buildJob(task._id.toString()) as never, buildCtx());

    expect(mockUpdateTaskStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: task._id.toString(),
        status: 'DEFERRED',
        deferReason: 'primus_rpc_transient',
        deferCount: 1,
      }),
    );
  });

  it('marks tasks FAILED once the defer cap is reached', async () => {
    const task = buildTask({ deferCount: 50 });
    mockFindById.mockResolvedValue(task);
    mockRunZkTLSProcessor.mockRejectedValue({
      code: '10003',
      message: 'Unstable internet connection. Please try again.',
      data: {
        retdesc:
          '10003:run_client do_offline exception: [PrimusServerNetworkError]recv websocket header error',
      },
    });

    await processZkTLSJob(0, buildJob(task._id.toString()) as never, buildCtx());

    expect(mockUpdateTaskStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: task._id.toString(),
        status: 'FAILED',
      }),
    );
  });
});
