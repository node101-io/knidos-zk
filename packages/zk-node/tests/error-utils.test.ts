import { describe, expect, it } from 'vitest';

import { collectErrorStrings, serializeError } from '../src/utils/error.js';

describe('error utils', () => {
  it('serializes nested Error causes', () => {
    const err = new Error('Undefined error.', {
      cause: new Error('verifyAndPollTaskResult timed out after 60000ms'),
    });

    expect(serializeError(err)).toEqual(
      expect.objectContaining({
        message: 'Undefined error.',
        cause: expect.objectContaining({
          message: 'verifyAndPollTaskResult timed out after 60000ms',
        }),
      }),
    );
  });

  it('collects nested JSON and Error cause strings for classification', () => {
    const err = new Error('Undefined error.', {
      cause: {
        body: JSON.stringify({
          error: {
            message: 'gateway timeout',
          },
        }),
      },
    });

    expect(collectErrorStrings(err)).toEqual(
      expect.arrayContaining(['Undefined error.', 'gateway timeout']),
    );
  });
});
