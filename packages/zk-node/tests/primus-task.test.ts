
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
};

function buildPrimusMock(overrides: Partial<PrimusMock> = {}): PrimusMock & PrimusNetwork {
  const base: PrimusMock = {
    attest: vi.fn().mockResolvedValue([{ reportTxHash: '0xreport-tx' }]),
    verifyAndPollTaskResult: vi.fn().mockResolvedValue([
      {
        attestor: '0xwinning-attestor',
        attestation: {
          recipient: '0xrecipient',
          data: JSON.stringify({ 'SHA256($)': '0xdeadbeef' }),
        },
      },
    ]),
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

const attest = {
  reportTxHash: '0xreport-tx',
  url: 'https://test.binance/fapi/v1/userTrades?stub',
  attestedAt: 1,
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
  it('passes the supplied url through to the Primus SDK and echoes it back', async () => {
    const primus = buildPrimusMock();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(3_000));
    try {
      const { attestPrimusTask } = await import('../src/primus/task.js');
      const url = `${env.BINANCE_API_URL}/fapi/v1/userTrades?symbol=BTCUSDT&signature=stub`;
      const result = await attestPrimusTask(primus, submit, url);

      expect(primus.attest).toHaveBeenCalledTimes(1);
      const call = primus.attest.mock.calls[0]?.[0] as {
        taskId: string;
        taskTxHash: string;
        taskAttestors: string[];
        requests: Array<{
          url: string;
          header: Record<string, string>;
          method: string;
          body: string;
        }>;
        responseResolves: unknown;
        extendedParams?: string;
        attMode?: { algorithmType: string; resultType: string };
      };
      expect(call.taskId).toBe(submit.taskId);
      expect(call.taskTxHash).toBe(submit.taskTxHash);
      expect(call.taskAttestors).toEqual(submit.taskAttestors);

      expect(call.requests[0]!.url).toBe(url);
      expect(call.requests[0]!.method).toBe('GET');
      expect(call.requests[0]!.header).toEqual({ 'X-MBX-APIKEY': env.BINANCE_API_KEY });
      expect(call.requests[0]!.body).toBe('');
      expect(call.responseResolves).toEqual([
        [{ keyName: 'fills_commitment', parseType: 'json', parsePath: '$', op: 'SHA256' }],
      ]);
      expect(call.extendedParams).toBe(JSON.stringify({ attUrlOptimization: true }));
      expect(call).not.toHaveProperty('getAllJsonResponse');
      expect(call.attMode).toEqual({ algorithmType: 'mpctls', resultType: 'cipher' });
      expect(result).toEqual({ reportTxHash: '0xreport-tx', url, attestedAt: 3_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when the SDK returns no reportTxHash', async () => {
    const primus = buildPrimusMock({ attest: vi.fn().mockResolvedValue([{}]) });
    const { attestPrimusTask } = await import('../src/primus/task.js');

    await expect(attestPrimusTask(primus, submit, 'https://stub')).rejects.toThrow(
      'attestation_report_missing',
    );
  });
});

describe('verifyPrimusTask', () => {
  it('polls with persisted ids and returns the fills commitment', async () => {
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
    expect(result).toBe('0xdeadbeef');
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
