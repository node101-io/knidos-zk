import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { BigNumber } from 'ethers';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { env } from '../src/env.js';

const mockSubmitTaskCall = vi.fn();
const mockQueryLatestFeeInfo = vi.fn();
const mockContract = vi.fn();

vi.mock('../src/primus/client.js', () => ({
  TOKEN_SYMBOL_ETH: 0,
  MAX_FEE_PER_GAS_WEI: 50_000_000,
  MAX_PRIORITY_FEE_PER_GAS_WEI: 2_000_000,
  primusClient: {
    userAddress: '0xuser',
    contract: (...args: unknown[]) => mockContract(...args),
  },
}));

type PrimusMock = {
  attest: MockInstance;
  verifyAndPollTaskResult: MockInstance;
  getPrivateData: MockInstance;
};

function buildPrimusMock(overrides: Partial<PrimusMock> = {}): PrimusMock & PrimusNetwork {
  const base: PrimusMock = {
    attest: vi.fn().mockResolvedValue([{ reportTxHash: '0xreport-tx' }]),
    verifyAndPollTaskResult: vi.fn().mockResolvedValue([
      {
        attestor: '0xwinning-attestor',
        attestation: {
          recipient: '0xrecipient',
          data: JSON.stringify({ fills_commitment: '0xdeadbeef', user_commitment: '0xaddr' }),
        },
      },
    ]),
    getPrivateData: vi.fn((_taskId: string, key: string) => `0xsalt-${key}`),
    ...overrides,
  };
  return base as PrimusMock & PrimusNetwork;
}

const submit = {
  taskId: '0xtask',
  taskTxHash: '0xsubmit-tx',
  taskAttestors: ['0xattestor'],
  submittedAt: 1,
};

const request = {
  url: env.HYPERLIQUID_API_URL,
  method: 'POST' as const,
  header: { 'Content-Type': 'application/json' },
  body: {
    type: 'userFillsByTime' as const,
    user: env.HYPERLIQUID_USER_ADDRESS,
    startTime: 1,
    endTime: 2,
  },
};

const attest = {
  reportTxHash: '0xreport-tx',
  request,
  attestedAt: 1,
  fillsSalt: '0xsalt-fills_commitment',
  addressSalt: '0xsalt-user_commitment',
};

beforeEach(() => {
  mockSubmitTaskCall.mockReset();
  mockQueryLatestFeeInfo.mockReset();
  mockContract.mockReset();

  mockQueryLatestFeeInfo.mockResolvedValue({
    primusFee: BigNumber.from(3),
    attestorFee: BigNumber.from(7),
  });
  mockSubmitTaskCall.mockResolvedValue({
    hash: '0xsubmit-tx',
    wait: async () => ({
      events: [
        {
          event: 'SubmitTask',
          args: {
            taskId: '0xtask',
            attestors: ['0xattestor'],
          },
        },
      ],
    }),
  });
  mockContract.mockReturnValue({
    queryLatestFeeInfo: mockQueryLatestFeeInfo,
    submitTask: mockSubmitTaskCall,
  });
});

describe('submitPrimusTaskRaw', () => {
  it('computes totalFee from queryLatestFeeInfo and pins an explicit gasLimit', async () => {
    const before = Date.now();
    const { submitPrimusTaskRaw } = await import('../src/primus/task.js');

    const result = await submitPrimusTaskRaw();

    expect(mockQueryLatestFeeInfo).toHaveBeenCalledWith(0);
    expect(mockSubmitTaskCall).toHaveBeenCalledTimes(1);
    const [addr, templateId, attestorCount, tokenSymbol, callback, overrides] = mockSubmitTaskCall
      .mock.calls[0] as [
      string,
      string,
      number,
      number,
      string,
      { value: BigNumber; gasLimit: number; maxFeePerGas: number; maxPriorityFeePerGas: number },
    ];
    expect(addr).toBe(env.PRIMUS_USER_ADDRESS);
    expect(templateId).toBe('');
    expect(attestorCount).toBe(1);
    expect(tokenSymbol).toBe(0);
    expect(callback).toBe('0x0000000000000000000000000000000000000000');
    expect(overrides.value.toNumber()).toBe(10); // 3 + 7
    expect(overrides.gasLimit).toBe(500_000);
    expect(overrides.maxFeePerGas).toBe(50_000_000); // 0.05 gwei
    expect(overrides.maxPriorityFeePerGas).toBe(2_000_000); // 0.002 gwei

    expect(result.taskId).toBe('0xtask');
    expect(result.taskTxHash).toBe('0xsubmit-tx');
    expect(result.taskAttestors).toEqual(['0xattestor']);
    expect(result.submittedAt).toBeGreaterThanOrEqual(before);
  });

  it('throws if the receipt does not contain a SubmitTask event', async () => {
    mockSubmitTaskCall.mockResolvedValue({
      hash: '0xtx',
      wait: async () => ({ events: [] }),
    });
    const { submitPrimusTaskRaw } = await import('../src/primus/task.js');

    await expect(submitPrimusTaskRaw()).rejects.toThrow('submit_task_event_missing');
  });
});

describe('attestPrimusTask', () => {
  it('passes the request through to the Primus SDK and captures the salt', async () => {
    const primus = buildPrimusMock();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(3_000));
    try {
      const { attestPrimusTask } = await import('../src/primus/task.js');
      const result = await attestPrimusTask(primus, submit, request);

      expect(primus.attest).toHaveBeenCalledTimes(1);
      const call = primus.attest.mock.calls[0]?.[0] as {
        taskId: string;
        taskTxHash: string;
        taskAttestors: string[];
        requests: unknown[];
        responseResolves: Array<Array<{ keyName: string; parsePath: string; op?: string }>>;
        extendedParams?: string;
        getAllJsonResponse?: string;
        attMode?: { algorithmType: string; resultType: string };
      };
      expect(call.taskId).toBe(submit.taskId);
      expect(call.taskTxHash).toBe(submit.taskTxHash);
      expect(call.taskAttestors).toEqual(submit.taskAttestors);

      expect(call.requests).toEqual([request]);
      // Both resolvers are salted; the body one must be, since the body is
      // publicly reproducible.
      expect(call.responseResolves[0]?.map((resolve) => [resolve.parsePath, resolve.op])).toEqual([
        ['$', 'SHA256_WITH_SALT'],
        ['^.user', 'SHA256_WITH_SALT'],
      ]);
      expect(call.extendedParams).toBe(JSON.stringify({ attUrlOptimization: true }));
      expect(call.getAllJsonResponse).toBe('true');
      // mpctls keeps the request (and with it the trading address) hidden
      // from the attestor.
      expect(call.attMode).toEqual({ algorithmType: 'mpctls', resultType: 'cipher' });
      // The salts only exist on the attesting SDK instance, so they must be
      // captured here rather than looked up later.
      expect(primus.getPrivateData).toHaveBeenCalledWith(submit.taskId, 'fills_commitment');
      expect(primus.getPrivateData).toHaveBeenCalledWith(submit.taskId, 'user_commitment');
      expect(result).toEqual({
        reportTxHash: '0xreport-tx',
        request,
        attestedAt: 3_000,
        fillsSalt: '0xsalt-fills_commitment',
        addressSalt: '0xsalt-user_commitment',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when the SDK returns no reportTxHash', async () => {
    const primus = buildPrimusMock({ attest: vi.fn().mockResolvedValue([{}]) });
    const { attestPrimusTask } = await import('../src/primus/task.js');

    await expect(attestPrimusTask(primus, submit, request)).rejects.toThrow(
      'attestation_report_missing',
    );
  });

  it('throws when the SDK exposes no salt for the address commitment', async () => {
    const primus = buildPrimusMock({ getPrivateData: vi.fn().mockReturnValue(undefined) });
    const { attestPrimusTask } = await import('../src/primus/task.js');

    await expect(attestPrimusTask(primus, submit, request)).rejects.toThrow(
      'attestation_salt_missing',
    );
  });
});

describe('verifyPrimusTask', () => {
  it('polls with persisted ids and returns both commitments', async () => {
    const primus = buildPrimusMock();
    const { verifyPrimusTask } = await import('../src/primus/task.js');

    const result = await verifyPrimusTask(primus, submit, attest);

    expect(primus.verifyAndPollTaskResult).toHaveBeenCalledTimes(1);
    const call = primus.verifyAndPollTaskResult.mock.calls[0]?.[0] as {
      taskId: string;
      reportTxHash: string;
    };
    expect(call.taskId).toBe(submit.taskId);
    expect(call.reportTxHash).toBe(attest.reportTxHash);
    expect(result).toEqual({ fillsCommitment: '0xdeadbeef', addressCommitment: '0xaddr' });
  });

  it('throws when the poll returns an empty list', async () => {
    const primus = buildPrimusMock({
      verifyAndPollTaskResult: vi.fn().mockResolvedValue([]),
    });
    const { verifyPrimusTask } = await import('../src/primus/task.js');

    await expect(verifyPrimusTask(primus, submit, attest)).rejects.toThrow(
      'verified_result_missing',
    );
  });
});
