import { BigNumber } from 'ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMaxUnsettledTaskCount = vi.fn();
const mockContract = vi.fn();
const mockTaskTimeoutMs = vi.fn();

vi.mock('../src/primus/client.js', () => ({
  TOKEN_SYMBOL_ETH: 0,
  MAX_FEE_PER_GAS_WEI: 50_000_000,
  MAX_PRIORITY_FEE_PER_GAS_WEI: 2_000_000,
  primusClient: {
    userAddress: '0xuser',
    contract: (...args: unknown[]) => mockContract(...args),
    maxUnsettledTaskCount: (...args: unknown[]) => mockMaxUnsettledTaskCount(...args),
    taskTimeoutMs: (...args: unknown[]) => mockTaskTimeoutMs(...args),
  },
}));

function buildTaskInfo(submittedAtSeconds: number) {
  return { submittedAt: BigNumber.from(submittedAtSeconds) };
}

// Builds an object that looks like a signer-connected ethers Contract
// for the purposes of our tests: queryUnsettledTasks returns canned
// shapes from `unsettled`; submitTask and withdrawBalance are provided
// by the test to stub write-path behaviour.
function buildContractMock(args: {
  unsettled: Array<{ totalCount: number; taskInfos: Array<{ submittedAt: BigNumber }> }>;
  submitTask?: ReturnType<typeof vi.fn>;
  withdrawBalance?: ReturnType<typeof vi.fn>;
}) {
  return {
    address: '0xC02234058caEaA9416506eABf6Ef3122fCA939E8',
    queryUnsettledTasks: vi.fn().mockImplementation(async () => {
      const next = args.unsettled.shift();
      if (!next) throw new Error('missing queryUnsettledTasks mock');
      return {
        taskInfos: next.taskInfos,
        totalCount: BigNumber.from(next.totalCount),
      };
    }),
    submitTask: args.submitTask ?? vi.fn(),
    withdrawBalance: args.withdrawBalance ?? vi.fn(),
    queryLatestFeeInfo: vi.fn().mockResolvedValue({
      primusFee: BigNumber.from(3),
      attestorFee: BigNumber.from(7),
    }),
  };
}

// Submit returns a ContractTransaction whose .wait() receipt contains a
// SubmitTask event. This mirrors what our code consumes.
function fakeSubmitTx(taskId: string, attestors: string[]) {
  return {
    hash: '0xsubmit-tx',
    wait: async () => ({
      events: [{ event: 'SubmitTask', args: { taskId, attestors } }],
    }),
  };
}

function fakeWithdrawTx(settledTaskIds: string[]) {
  return {
    hash: '0xwithdraw-tx',
    wait: async () => ({
      events: [{ event: 'WithdrawBalance', args: { settledTaskIds } }],
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  mockMaxUnsettledTaskCount.mockReset();
  mockContract.mockReset();
  mockTaskTimeoutMs.mockReset();
  mockMaxUnsettledTaskCount.mockResolvedValue(100);
  mockTaskTimeoutMs.mockResolvedValue(900_000);
});

describe('submitWithCapacity — capacity decisions', () => {
  it('submits when the wallet has free slots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_776_538_500_000));
    const submitTask = vi.fn().mockResolvedValue(fakeSubmitTx('0xtask', ['0xattestor']));
    const withdrawBalance = vi.fn();
    const contract = buildContractMock({
      unsettled: [{ totalCount: 50, taskInfos: [buildTaskInfo(1_776_538_412)] }],
      submitTask,
      withdrawBalance,
    });
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const result = await submitWithCapacity();

    expect(submitTask).toHaveBeenCalledTimes(1);
    expect(withdrawBalance).not.toHaveBeenCalled();
    expect(result).toMatchObject({ taskId: '0xtask' });
  });

  it('reclaims when saturated with a full batch of timed-out tasks, then submits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(9_999_999_999_000));
    // First snapshot: 100 unsettled; 80 are timed-out. After reclaim: 20.
    const oldSec = 9_999_000_000;
    const recentSec = 9_999_999_999; // "now" — not timed out
    const submitTask = vi.fn().mockResolvedValue(fakeSubmitTx('0xtask', ['0xattestor']));
    const withdrawBalance = vi
      .fn()
      .mockResolvedValue(fakeWithdrawTx(Array.from({ length: 80 }, (_, i) => `0xsettled-${i}`)));
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
      submitTask,
      withdrawBalance,
    });
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const result = await submitWithCapacity();

    expect(withdrawBalance).toHaveBeenCalledTimes(1);
    const [tokenSymbol, limit, overrides] = withdrawBalance.mock.calls[0] as [
      number,
      number,
      { gasLimit: number; maxFeePerGas: number; maxPriorityFeePerGas: number },
    ];
    expect(tokenSymbol).toBe(0);
    expect(limit).toBe(100);
    expect(overrides.gasLimit).toBe(3_000_000);
    expect(overrides.maxFeePerGas).toBe(50_000_000);
    expect(overrides.maxPriorityFeePerGas).toBe(2_000_000);
    expect(submitTask).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ taskId: '0xtask' });
  });

  it('defers until nextUnlockAt when saturated with nothing reclaimable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_776_538_500_000));
    const contract = buildContractMock({
      unsettled: [{ totalCount: 100, taskInfos: [buildTaskInfo(1_776_538_412)] }],
    });
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const result = await submitWithCapacity();

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
    const oldSec = 9_999_000_000;
    const activeSec = 9_999_999_999;
    const withdrawBalance = vi.fn();
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
      withdrawBalance,
    });
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const result = await submitWithCapacity();

    expect(result).toMatchObject({
      action: 'defer',
      reason: 'primus_capacity_batch_wait',
    });
    expect(withdrawBalance).not.toHaveBeenCalled();
  });

  it('defers a submitTask receipt revert as capacity exhaustion when ethers omits the reason', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_776_538_500_000));
    const exhaustError = {
      code: 'CALL_EXCEPTION',
      receipt: {
        status: 0,
        to: '0xC02234058caEaA9416506eABf6Ef3122fCA939E8',
      },
      transaction: {
        to: '0xC02234058caEaA9416506eABf6Ef3122fCA939E8',
        data: '0x5ae543eb00000000000000000000000052ca55973e855c2a8b93274a2b9be358a294a916',
      },
    };
    const submitTask = vi.fn().mockRejectedValue(exhaustError);
    const contract = buildContractMock({
      unsettled: [
        { totalCount: 99, taskInfos: [buildTaskInfo(1_776_538_412)] },
        { totalCount: 100, taskInfos: [buildTaskInfo(1_776_538_412)] },
        { totalCount: 100, taskInfos: [buildTaskInfo(1_776_538_412)] },
      ],
      submitTask,
    });
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const result = await submitWithCapacity();

    expect(submitTask).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      action: 'defer',
      reason: 'primus_capacity_full_wait',
      deferUntil: new Date(1_776_538_412_000 + 900_000 + 15_000),
      sourceError: exhaustError,
    });
  });

  it('returns primus_capacity_retry when submit exhausts twice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_776_538_500_000));
    const exhaustError = {
      code: 'CALL_EXCEPTION',
      reason: 'unsettled task count exceed max count',
    };
    const submitTask = vi.fn().mockRejectedValue(exhaustError);
    const contract = buildContractMock({
      unsettled: [
        { totalCount: 50, taskInfos: [buildTaskInfo(1_776_538_412)] },
        { totalCount: 50, taskInfos: [buildTaskInfo(1_776_538_412)] },
      ],
      submitTask,
    });
    mockContract.mockReturnValue(contract as never);

    const { submitWithCapacity } = await import('../src/primus/capacity.js');
    const result = await submitWithCapacity();

    expect(submitTask).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      action: 'defer',
      reason: 'primus_capacity_retry',
    });
  });
});

describe('reclaimTimedOutTasks', () => {
  it('calls withdrawBalance with ETH, the max unsettled limit, and an explicit gasLimit', async () => {
    const withdrawBalance = vi
      .fn()
      .mockResolvedValue(fakeWithdrawTx(['0xsettled-1', '0xsettled-2']));
    const contract = buildContractMock({ unsettled: [], withdrawBalance });
    mockContract.mockReturnValue(contract as never);

    const { reclaimTimedOutTasks } = await import('../src/primus/capacity.js');

    const result = await reclaimTimedOutTasks();

    const [tokenSymbol, limit, overrides] = withdrawBalance.mock.calls[0] as [
      number,
      number,
      { gasLimit: number; maxFeePerGas: number; maxPriorityFeePerGas: number },
    ];
    expect(tokenSymbol).toBe(0);
    expect(limit).toBe(100);
    expect(overrides.gasLimit).toBe(3_000_000);
    expect(overrides.maxFeePerGas).toBe(50_000_000);
    expect(overrides.maxPriorityFeePerGas).toBe(2_000_000);
    expect(result).toEqual({ settled: ['0xsettled-1', '0xsettled-2'] });
  });
});
