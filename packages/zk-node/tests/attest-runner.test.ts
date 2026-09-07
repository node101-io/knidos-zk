import { describe, expect, it } from 'vitest';

import { runAttestationInChild } from '../src/primus/attest-runner.js';
import { AttestationChildError, classifyError, isAttestorTransport } from '../src/primus/errors.js';

const FAKE_CHILD = new URL('./fixtures/attest-child-fake.mjs', import.meta.url);

const request = {
  submit: {
    taskId: '0xtask',
    taskTxHash: '0xsubmit-tx',
    taskAttestors: ['0xattestor'],
    submittedAt: 1,
  },
  request: {
    url: 'https://api.hyperliquid.xyz/info',
    method: 'POST' as const,
    header: { 'Content-Type': 'application/json' },
    body: {
      type: 'userFillsByTime' as const,
      user: '0x0000000000000000000000000000000000000001',
      startTime: 1,
      endTime: 2,
    },
  },
};

function run(mode: string, options: { timeoutMs?: number } = {}) {
  return runAttestationInChild(request, {
    entry: FAKE_CHILD,
    timeoutMs: options.timeoutMs ?? 5_000,
    env: {
      ...process.env,
      ATTEST_CHILD_FAKE_MODE: mode,
    },
  });
}

async function rejection(promise: Promise<unknown>): Promise<AttestationChildError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AttestationChildError);
    return error as AttestationChildError;
  }
  throw new Error('expected the attestation to reject');
}

describe('runAttestationInChild', () => {
  it('returns the attestation the child reports', async () => {
    const attest = await run('ok');

    expect(attest.reportTxHash).toBe('0xreport');
    expect(attest.request).toEqual(request.request);
    expect(attest.fillsSalt).toBe('0x01');
    expect(attest.addressSalt).toBe('0x02');
  });

  it('rethrows an SDK failure as the plain serialized error the SDK would have thrown', async () => {
    const error = await run('failed').then(
      () => {
        throw new Error('expected the attestation to reject');
      },
      (reason: unknown) => reason,
    );

    expect(error).toEqual({ code: '10003', message: 'recv websocket header error' });
    // The existing text-based classification still applies: this one is a
    // dead websocket, so the processor re-submits for a new attestor.
    expect(isAttestorTransport(error)).toBe(true);
    expect(classifyError(error)).toBe('primus_attestor_transient');
  });

  it('kills a child that exceeds the timeout and reports the attestor as unresponsive', async () => {
    const startedAt = Date.now();
    const error = await rejection(run('hang', { timeoutMs: 500 }));

    expect(error.kind).toBe('timeout');
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    expect(classifyError(error)).toBe('primus_attestor_unresponsive');
  });

  it('treats a child that exits without reporting as a crash', async () => {
    const error = await rejection(run('exit-silently'));

    expect(error.kind).toBe('crash');
    expect(error.message).toContain('code=0');
    expect(classifyError(error)).toBe('primus_attestor_unresponsive');
  });
});
