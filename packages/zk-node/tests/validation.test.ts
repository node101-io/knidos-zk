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
      proofType: 'hyperliquid-fills',
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
      startTime: new Date(1),
      endTime: new Date(2),
      circuitInput: {
        addressCommitment: ['3', '4'],
        address: Array(42).fill(48),
        addressSalt: Array(16).fill(0),
        fillsSalt: Array(16).fill(1),
        fillsCommitment: ['1', '2'],
        rawFills: Array(8192).fill(0),
        rawFillsLength: 0,
        startTime: 1,
        endTime: 2,
        baseBalance: 100,
        threshold: 50,
      },
    });
    expect(parsed.startTime).toBeInstanceOf(Date);
    expect(parsed.endTime).toBeInstanceOf(Date);
    expect(parsed.startTime.getTime()).toBe(1);
    expect(parsed.endTime.getTime()).toBe(2);
  });

  it('accepts zkVerify job input with ISO string time values', () => {
    const parsed = parseZkVerifyJobInput({
      noirTaskId: 'task-2',
      startTime: '1970-01-01T00:00:00.010Z',
      endTime: '1970-01-01T00:00:00.020Z',
    });
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
        startTime: 1,
        endTime: 2,
        circuitInput: {
          addressCommitment: ['3', '4'],
          address: Array(42).fill(48),
          addressSalt: Array(16).fill(0),
          fillsSalt: Array(16).fill(1),
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
        startTime: 10,
        endTime: 20,
      }),
    ).toThrow(/unrecognized key/i);
  });
});
