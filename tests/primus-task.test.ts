import { createHmac } from 'crypto';

import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { describe, expect, it, vi, type MockInstance } from 'vitest';

import { env } from '../src/env.js';
import {
  attestPrimusTask,
  submitPrimusTaskRaw,
  verifyPrimusTask,
  type PrimusAttest,
  type PrimusSubmit,
} from '../src/primus/task.js';

type PrimusMock = {
  submitTask: MockInstance;
  attest: MockInstance;
  verifyAndPollTaskResult: MockInstance;
};

function buildPrimusMock(overrides: Partial<PrimusMock> = {}): PrimusMock & PrimusNetwork {
  const base: PrimusMock = {
    submitTask: vi.fn().mockResolvedValue({
      taskId: '0xtask',
      taskTxHash: '0xsubmit-tx',
      taskAttestors: ['0xattestor'],
    }),
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

const submit: PrimusSubmit = {
  taskId: '0xtask',
  taskTxHash: '0xsubmit-tx',
  taskAttestors: ['0xattestor'],
  submittedAt: 1,
};

const attest: PrimusAttest = { reportTxHash: '0xreport-tx' };

describe('submitPrimusTaskRaw', () => {
  it('calls submitTask and stamps submittedAt', async () => {
    const primus = buildPrimusMock();
    const before = Date.now();

    const result = await submitPrimusTaskRaw(primus);

    expect(primus.submitTask).toHaveBeenCalledTimes(1);
    expect(result.taskId).toBe('0xtask');
    expect(result.taskTxHash).toBe('0xsubmit-tx');
    expect(result.taskAttestors).toEqual(['0xattestor']);
    expect(result.submittedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('attestPrimusTask', () => {
  it('builds a signed Binance userTrades request and passes it to the SDK', async () => {
    const primus = buildPrimusMock();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(3_000));
    try {
      const result = await attestPrimusTask(primus, submit, 'BTCUSDT', 1_000, 2_000);

      expect(primus.attest).toHaveBeenCalledTimes(1);
      const call = primus.attest.mock.calls[0]?.[0] as {
        taskId: string;
        taskTxHash: string;
        taskAttestors: string[];
        requests: Array<{ url: string; header: Record<string, string>; method: string }>;
        responseResolves: unknown;
      };
      expect(call.taskId).toBe(submit.taskId);
      expect(call.taskTxHash).toBe(submit.taskTxHash);
      expect(call.taskAttestors).toEqual(submit.taskAttestors);

      const url = call.requests[0]!.url;
      const expectedQuery =
        'symbol=BTCUSDT&startTime=1000&endTime=2000&recvWindow=60000&timestamp=3000';
      const expectedSig = createHmac('sha256', env.BINANCE_API_SECRET)
        .update(expectedQuery)
        .digest('hex');
      expect(url).toBe(
        `${env.BINANCE_API_URL}/fapi/v1/userTrades?${expectedQuery}&signature=${expectedSig}`,
      );
      expect(call.requests[0]!.method).toBe('GET');
      expect(call.requests[0]!.header).toEqual({ 'X-MBX-APIKEY': env.BINANCE_API_KEY });
      expect(call.responseResolves).toEqual([
        [{ keyName: 'fills_commitment', parseType: 'json', parsePath: '$', op: 'SHA256' }],
      ]);
      expect(result.reportTxHash).toBe('0xreport-tx');
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when the SDK returns no reportTxHash', async () => {
    const primus = buildPrimusMock({ attest: vi.fn().mockResolvedValue([{}]) });

    await expect(attestPrimusTask(primus, submit, 'BTCUSDT', 1, 2)).rejects.toThrow(
      'attestation_report_missing',
    );
  });
});

describe('verifyPrimusTask', () => {
  it('polls with persisted ids and returns the fills commitment', async () => {
    const primus = buildPrimusMock();

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

    await expect(verifyPrimusTask(primus, submit, attest)).rejects.toThrow(
      'verified_result_missing',
    );
  });
});
