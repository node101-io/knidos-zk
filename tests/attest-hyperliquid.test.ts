import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  primusAttest,
  primusSubmit,
  primusVerify,
  type PrimusAttest,
  type PrimusSubmit,
} from '../src/zk-tls/attest-hyperliquid.js';

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

describe('primusSubmit', () => {
  it('calls submitTask and stamps submittedAt', async () => {
    const primus = buildPrimusMock();
    const before = Date.now();

    const result = await primusSubmit(primus);

    expect(primus.submitTask).toHaveBeenCalledTimes(1);
    expect(result.taskId).toBe('0xtask');
    expect(result.taskTxHash).toBe('0xsubmit-tx');
    expect(result.taskAttestors).toEqual(['0xattestor']);
    expect(result.submittedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('primusAttest', () => {
  it('passes persisted submit identifiers to the SDK and returns reportTxHash', async () => {
    const primus = buildPrimusMock();

    const result = await primusAttest(primus, submit, 'BTCUSDT', 1, 2);

    expect(primus.attest).toHaveBeenCalledTimes(1);
    const call = primus.attest.mock.calls[0]?.[0] as {
      taskId: string;
      taskTxHash: string;
      taskAttestors: string[];
    };
    expect(call.taskId).toBe(submit.taskId);
    expect(call.taskTxHash).toBe(submit.taskTxHash);
    expect(call.taskAttestors).toEqual(submit.taskAttestors);
    expect(result.reportTxHash).toBe('0xreport-tx');
  });

  it('throws when the SDK returns no reportTxHash', async () => {
    const primus = buildPrimusMock({
      attest: vi.fn().mockResolvedValue([{}]),
    });

    await expect(primusAttest(primus, submit, 'BTCUSDT', 1, 2)).rejects.toThrow(
      'attestation_report_missing',
    );
  });
});

describe('primusVerify', () => {
  it('polls with persisted ids and returns a fully populated attestation', async () => {
    const primus = buildPrimusMock();

    const result = await primusVerify(primus, submit, attest, 84532);

    expect(primus.verifyAndPollTaskResult).toHaveBeenCalledTimes(1);
    const call = primus.verifyAndPollTaskResult.mock.calls[0]?.[0] as {
      taskId: string;
      reportTxHash: string;
    };
    expect(call.taskId).toBe(submit.taskId);
    expect(call.reportTxHash).toBe(attest.reportTxHash);

    expect(result).toEqual({
      taskId: submit.taskId,
      reportTxHash: attest.reportTxHash,
      attestor: '0xwinning-attestor',
      recipient: '0xrecipient',
      chainId: 84532,
      fillsCommitment: '0xdeadbeef',
      verifiedResult: expect.any(String),
    });
  });

  it('throws when the poll returns an empty list', async () => {
    const primus = buildPrimusMock({
      verifyAndPollTaskResult: vi.fn().mockResolvedValue([]),
    });

    await expect(primusVerify(primus, submit, attest, 84532)).rejects.toThrow(
      'verified_result_missing',
    );
  });
});
