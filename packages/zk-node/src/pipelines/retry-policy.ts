import { UnrecoverableError } from 'bullmq';

import type { TaskStatus } from '../db/task.js';

export interface FailedJobAttempt {
  attemptsMade: number;
  opts: { attempts?: number };
}

// What a task becomes after one of its job attempts fails. bullmq retries
// until `opts.attempts` is spent unless the attempt threw its
// UnrecoverableError, which ends the job on the spot - so a task whose error
// is deterministic must not be parked as QUEUED waiting for a retry that will
// never come.
export function resolveFailedJobStatus(
  job: FailedJobAttempt,
  err: unknown,
): Extract<TaskStatus, 'QUEUED' | 'FAILED'> {
  if (err instanceof UnrecoverableError) return 'FAILED';

  const attempts = typeof job.opts.attempts === 'number' ? Math.max(job.opts.attempts, 1) : 1;
  return job.attemptsMade < attempts ? 'QUEUED' : 'FAILED';
}
