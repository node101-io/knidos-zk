import { describe, expect, it } from 'vitest';

import { classifyError, decideZkTLSError } from '../src/primus/errors.js';

describe('decideZkTLSError', () => {
  it('defers Primus websocket transport failures', () => {
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

    expect(classifyError(error)).toBe('primus_transient_rpc');
    expect(decision).toEqual({
      action: 'defer',
      reason: 'primus_transient_rpc',
      deferUntil: new Date('2026-04-23T00:01:00.000Z'),
      sourceError: error,
    });
  });

  it('defers direct upstream 502 responses', () => {
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

    expect(classifyError(error)).toBe('primus_transient_rpc');
    expect(decision).toEqual({
      action: 'defer',
      reason: 'primus_transient_rpc',
      deferUntil: new Date('2026-04-23T00:01:00.000Z'),
      sourceError: error,
    });
  });

  it('defers nested CALL_EXCEPTION wrappers when the inner error is a transient 502', () => {
    const error = {
      name: 'Error',
      message: 'missing revert data in call exception; Transaction reverted without a reason string',
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

    expect(classifyError(error)).toBe('primus_transient_rpc');
    expect(decision).toEqual({
      action: 'defer',
      reason: 'primus_transient_rpc',
      deferUntil: new Date('2026-04-23T00:01:00.000Z'),
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
});
