import { describe, expect, it } from 'vitest';

import { classifyError, decideZkTLSError } from '../src/primus/errors.js';
import { PermanentTaskError } from '../src/utils/error.js';

describe('decideZkTLSError', () => {
  it('classifies Primus attestor websocket transport failures separately from RPC failures', () => {
    const error = {
      code: '10003',
      message: 'Unstable internet connection. Please try again.',
      data: {
        retcode: '2',
        retdesc:
          '10003:run_client do_offline exception: [PrimusServerNetworkError]recv websocket header error',
      },
    };

    const decision = decideZkTLSError(error, {
      currentDeferCount: 0,
      now: () => Date.parse('2026-04-23T00:00:00.000Z'),
    });

    expect(classifyError(error)).toBe('primus_attestor_transient');
    expect(decision).toEqual({
      action: 'defer',
      reason: 'primus_attestor_transient',
      deferUntil: new Date('2026-04-23T00:01:00.000Z'),
      sourceError: error,
    });
  });

  it('defers direct upstream 502 responses as RPC transient', () => {
    const error = {
      name: 'Error',
      message: 'bad response',
      code: 'SERVER_ERROR',
      status: 502,
      body: 'error code: 502',
      url: 'https://sepolia.base.org',
    };

    const decision = decideZkTLSError(error, {
      currentDeferCount: 0,
      now: () => Date.parse('2026-04-23T00:00:00.000Z'),
    });

    expect(classifyError(error)).toBe('primus_rpc_transient');
    expect(decision).toEqual({
      action: 'defer',
      reason: 'primus_rpc_transient',
      deferUntil: new Date('2026-04-23T00:01:00.000Z'),
      sourceError: error,
    });
  });

  it('defers nested CALL_EXCEPTION wrappers when the inner error is a transient 502', () => {
    const error = {
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
    };

    const decision = decideZkTLSError(error, {
      currentDeferCount: 0,
      now: () => Date.parse('2026-04-23T00:00:00.000Z'),
    });

    expect(classifyError(error)).toBe('primus_rpc_transient');
    expect(decision).toEqual({
      action: 'defer',
      reason: 'primus_rpc_transient',
      deferUntil: new Date('2026-04-23T00:01:00.000Z'),
      sourceError: error,
    });
  });

  it('classifies the Primus gateway "Too many requests" response as rate-limited', () => {
    const error = {
      code: '00000',
      message: 'Too many requests. Please try again later.',
      data: '',
    };

    const decision = decideZkTLSError(error, {
      currentDeferCount: 0,
      now: () => Date.parse('2026-04-23T00:00:00.000Z'),
    });

    expect(classifyError(error)).toBe('primus_rate_limited');
    expect(decision).toEqual({
      action: 'defer',
      reason: 'primus_rate_limited',
      deferUntil: new Date('2026-04-23T00:00:30.000Z'),
      sourceError: error,
    });
  });

  it('keeps insufficient-funds failures terminal', () => {
    const error = {
      code: 'INSUFFICIENT_FUNDS',
      reason: 'insufficient funds for intrinsic transaction cost',
    };

    expect(classifyError(error)).toBe('permanent');
    expect(decideZkTLSError(error, { currentDeferCount: 0 })).toEqual({ action: 'fail' });
  });

  it('keeps nonce failures terminal', () => {
    const error = {
      code: 'NONCE_EXPIRED',
      reason: 'nonce too low',
    };

    expect(classifyError(error)).toBe('permanent');
    expect(decideZkTLSError(error, { currentDeferCount: 0 })).toEqual({ action: 'fail' });
  });

  it('caps unbounded defer cycles by failing the task', () => {
    const error = {
      code: '10003',
      message: 'Unstable internet connection. Please try again.',
      data: {
        retdesc:
          '10003:run_client do_offline exception: [PrimusServerNetworkError]recv websocket header error',
      },
    };

    expect(decideZkTLSError(error, { currentDeferCount: 50 })).toEqual({ action: 'fail' });
    expect(decideZkTLSError(error, { currentDeferCount: 49 })).toMatchObject({
      action: 'defer',
      reason: 'primus_attestor_transient',
    });
  });

  it('routes permanent failures to fail even when the defer cap would also trigger', () => {
    const error = {
      code: 'INSUFFICIENT_FUNDS',
      reason: 'insufficient funds for intrinsic transaction cost',
    };

    expect(decideZkTLSError(error, { currentDeferCount: 999 })).toEqual({ action: 'fail' });
    expect(classifyError(error)).toBe('permanent');
  });
});

describe('decideZkTLSError with PermanentTaskError', () => {
  it('fails immediately instead of deferring', () => {
    expect(
      decideZkTLSError(new PermanentTaskError('window exceeds circuit capacity'), {
        currentDeferCount: 0,
      }),
    ).toEqual({ action: 'fail' });
  });
});
