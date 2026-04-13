import { describe, expect, it } from 'vitest';

import {
  parseNoirJobInput,
  parseZkTLSJobInput,
  parseZkVerifyJobInput,
} from '../src/pipelines/validation.js';

describe('pipeline validation', () => {
  it('accepts zktls numeric timestamps and normalizes them to Date', () => {
    const parsed = parseZkTLSJobInput({
      startTime: 1,
      endTime: 2,
      symbol: 'BTCUSDT',
      proofType: 'binance-fills-1h',
      baseBalance: 100,
      threshold: 50,
    });

    expect(parsed.startTime).toBeInstanceOf(Date);
    expect(parsed.endTime).toBeInstanceOf(Date);
    expect(parsed.startTime.getTime()).toBe(1);
    expect(parsed.endTime.getTime()).toBe(2);
  });

  it('accepts noir job input with Date time values', () => {
    const parsed = parseNoirJobInput({
      zkTLSTaskId: 'task-1',
      symbol: 'BTCUSDT',
      startTime: new Date(1),
      endTime: new Date(2),
      circuitInput: {
        fillsCommitment: ['1', '2'],
        rawFills: Array(8192).fill(0),
        rawFillsLength: 0,
        startTime: 1,
        endTime: 2,
        baseBalance: 100,
        threshold: 50,
      },
    });

    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.startTime).toBeInstanceOf(Date);
    expect(parsed.endTime).toBeInstanceOf(Date);
    expect(parsed.startTime.getTime()).toBe(1);
    expect(parsed.endTime.getTime()).toBe(2);
  });

  it('accepts zkVerify job input with ISO string time values', () => {
    const parsed = parseZkVerifyJobInput({
      noirTaskId: 'task-2',
      symbol: 'ETHUSDT',
      startTime: '1970-01-01T00:00:00.010Z',
      endTime: '1970-01-01T00:00:00.020Z',
    });

    expect(parsed.symbol).toBe('ETHUSDT');
    expect(parsed.startTime).toBeInstanceOf(Date);
    expect(parsed.endTime).toBeInstanceOf(Date);
    expect(parsed.startTime.getTime()).toBe(10);
    expect(parsed.endTime.getTime()).toBe(20);
  });

  it('rejects legacy batchId fields on downstream inputs', () => {
    expect(() =>
      parseNoirJobInput({
        zkTLSTaskId: 'task-1',
        batchId: 'legacy-batch',
        symbol: 'BTCUSDT',
        startTime: 1,
        endTime: 2,
        circuitInput: {
          fillsCommitment: ['1', '2'],
          rawFills: Array(8192).fill(0),
          rawFillsLength: 0,
          startTime: 1,
          endTime: 2,
          baseBalance: 100,
          threshold: 50,
        },
      }),
    ).toThrow(/unrecognized key/i);

    expect(() =>
      parseZkVerifyJobInput({
        noirTaskId: 'task-2',
        batchId: 'legacy-batch',
        symbol: 'ETHUSDT',
        startTime: 10,
        endTime: 20,
      }),
    ).toThrow(/unrecognized key/i);
  });
});
