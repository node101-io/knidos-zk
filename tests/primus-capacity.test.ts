import { BigNumber } from 'ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMaxUnsettledTaskCount = vi.fn();
const mockSdk = vi.fn();
const mockContract = vi.fn();
const mockTaskTimeoutMs = vi.fn();
const mockWithdrawBalance = vi.fn();

vi.mock('../src/primus/client.js', () => ({
  TOKEN_SYMBOL_ETH: 0,
  primusClient: {
    userAddress: '0xuser',
    sdk: (...args: unknown[]) => mockSdk(...args),
    contract: (...args: unknown[]) => mockContract(...args),
    maxUnsettledTaskCount: (...args: unknown[]) => mockMaxUnsettledTaskCount(...args),
    taskTimeoutMs: (...args: unknown[]) => mockTaskTimeoutMs(...args),
  },
}));

function buildTaskInfo(submittedAtSeconds: number) {
  return { submittedAt: BigNumber.from(submittedAtSeconds) };
}

function buildContractMock(args: {
  unsettled: Array<{ totalCount: number; taskInfos: Array<{ submittedAt: BigNumber }> }>;
}) {
  return {
    queryUnsettledTasks: vi.fn().mockImplementation(async () => {
      const next = args.unsettled.shift();
      if (!next) throw new Error('missing queryUnsettledTasks mock');
      return {
        taskInfos: next.taskInfos,
        totalCount: BigNumber.from(next.totalCount),
      };
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  mockMaxUnsettledTaskCount.mockReset();
  mockSdk.mockReset();
  mockContract.mockReset();
  mockTaskTimeoutMs.mockReset();
  mockWithdrawBalance.mockReset();
  mockMaxUnsettledTaskCount.mockResolvedValue(100);
  mockSdk.mockResolvedValue({ withdrawBalance: mockWithdrawBalance } as never);
  mockTaskTimeoutMs.mockResolvedValue(900_000);
});

describe('submitWithCapacity — capacity decisions', () => {
  it('submits when the wallet has free slots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_776_538_500_000));
    const contract = buildContractMock({
      unsettled: [{ totalCount: 50, taskInfos: [buildTaskInfo(1_776_538_412)] }],
    });
    const submitTask = vi.fn().mockResolvedValue({
      taskId: '0xtask',
      taskTxHash: '0xtx',
      taskAttestors: ['0xattestor'],
    });
    mockSdk.mockResolvedValue({ submitTask, withdrawBalance: mockWithdrawBalance } as never);
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const primus = await mockSdk();
    const result = await submitWithCapacity(primus);

    expect(submitTask).toHaveBeenCalledTimes(1);
    expect(mockWithdrawBalance).not.toHaveBeenCalled();
    expect(result).toMatchObject({ taskId: '0xtask' });
  });

  it('reclaims when saturated with a full batch of timed-out tasks, then submits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(9_999_999_999_000));
    // First snapshot: 100 unsettled; 80 are timed-out (submittedAt too old).
    // After reclaim: 20 unsettled, none timed-out.
    const oldSec = 9_999_000_000;
    const recentSec = 9_999_999_000;
    const contract = buildContractMock({
      unsettled: [
        {
          totalCount: 100,
          taskInfos: [
            ...Array.from({ length: 80 }, () => buildTaskInfo(oldSec)),
            ...Array.from({ length: 20 }, () => buildTaskInfo(recentSec)),
          ],
        },
        {
          totalCount: 20,
          taskInfos: Array.from({ length: 20 }, () => buildTaskInfo(recentSec)),
        },
      ],
    });
    const submitTask = vi.fn().mockResolvedValue({
      taskId: '0xtask',
      taskTxHash: '0xtx',
      taskAttestors: ['0xattestor'],
    });
    mockWithdrawBalance.mockResolvedValue(Array.from({ length: 80 }, (_, i) => `0xsettled-${i}`));
    mockSdk.mockResolvedValue({ submitTask, withdrawBalance: mockWithdrawBalance } as never);
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const primus = await mockSdk();
    const result = await submitWithCapacity(primus);

    expect(mockWithdrawBalance).toHaveBeenCalledTimes(1);
    expect(mockWithdrawBalance).toHaveBeenCalledWith(0, 100);
    expect(submitTask).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ taskId: '0xtask' });
  });

  it('defers until nextUnlockAt when saturated with nothing reclaimable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_776_538_500_000));
    const contract = buildContractMock({
      unsettled: [
        { totalCount: 100, taskInfos: [buildTaskInfo(1_776_538_412)] },
      ],
    });
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const primus = await mockSdk();
    const result = await submitWithCapacity(primus);

    expect(result).toEqual({
      action: 'defer',
      reason: 'primus_capacity_full_wait',
      deferUntil: new Date(1_776_538_412_000 + 900_000 + 15_000),
      sourceError: undefined,
    });
  });

  it('defers with batch_wait when saturated but batch is too small', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(9_999_999_999_000));
    // 100 unsettled, 50 timed-out (< MIN_RECLAIM_BATCH = 80), 50 still active.
    // timeoutSec=900, nowSec=9_999_999_999 → boundary is 9_999_999_099.
    const oldSec = 9_999_000_000; // well past timeout
    const activeSec = 9_999_999_999; // submitted right now, not timed out
    const contract = buildContractMock({
      unsettled: [
        {
          totalCount: 100,
          taskInfos: [
            ...Array.from({ length: 50 }, () => buildTaskInfo(oldSec)),
            ...Array.from({ length: 50 }, () => buildTaskInfo(activeSec)),
          ],
        },
      ],
    });
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const primus = await mockSdk();
    const result = await submitWithCapacity(primus);

    expect(result).toMatchObject({
      action: 'defer',
      reason: 'primus_capacity_batch_wait',
    });
    expect(mockWithdrawBalance).not.toHaveBeenCalled();
  });

  it('returns primus_capacity_retry when submit exhausts twice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_776_538_500_000));
    // Both evaluates see freeSlots > 0, but raw submitTask reverts with
    // exhaust both times (a degenerate race).
    const contract = buildContractMock({
      unsettled: [
        { totalCount: 50, taskInfos: [buildTaskInfo(1_776_538_412)] },
        { totalCount: 50, taskInfos: [buildTaskInfo(1_776_538_412)] },
      ],
    });
    const exhaustError = {
      code: 'CALL_EXCEPTION',
      reason: 'unsettled task count exceed max count',
    };
    const submitTask = vi.fn().mockRejectedValue(exhaustError);
    const primus = { submitTask, withdrawBalance: mockWithdrawBalance };
    mockSdk.mockResolvedValue(primus as never);
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const result = await submitWithCapacity(primus as never);

    expect(submitTask).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      action: 'defer',
      reason: 'primus_capacity_retry',
    });
  });
});

describe('reclaimTimedOutTasks', () => {
  it('calls withdrawBalance with ETH and the max unsettled limit', async () => {
    mockWithdrawBalance.mockResolvedValue(['0xsettled-1', '0xsettled-2']);
    const { reclaimTimedOutTasks } = await import('../src/primus/capacity.js');

    const result = await reclaimTimedOutTasks();

    expect(mockWithdrawBalance).toHaveBeenCalledWith(0, 100);
    expect(result).toEqual({ settled: ['0xsettled-1', '0xsettled-2'] });
  });
});
