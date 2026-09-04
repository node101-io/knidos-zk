import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { resolveFailedJobStatus } from '../src/pipelines/retry-policy.js';

describe('resolveFailedJobStatus', () => {
  it('re-queues while bullmq still has attempts left', () => {
    expect(resolveFailedJobStatus({ attemptsMade: 1, opts: { attempts: 3 } }, new Error('x'))).toBe(
      'QUEUED',
    );
  });

  it('fails once the last attempt is spent', () => {
    expect(resolveFailedJobStatus({ attemptsMade: 3, opts: { attempts: 3 } }, new Error('x'))).toBe(
      'FAILED',
    );
  });

  it('treats a missing attempts option as a single attempt', () => {
    expect(resolveFailedJobStatus({ attemptsMade: 1, opts: {} }, new Error('x'))).toBe('FAILED');
  });

  it('fails immediately on an unrecoverable error even with attempts left', () => {
    // bullmq stops retrying on UnrecoverableError; parking the task as QUEUED
    // would leave it waiting for a retry that never comes.
    expect(
      resolveFailedJobStatus(
        { attemptsMade: 1, opts: { attempts: 3 } },
        new UnrecoverableError('circuit rejected inputs'),
      ),
    ).toBe('FAILED');
  });
});
