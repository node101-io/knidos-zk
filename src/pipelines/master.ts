import { Job, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

import Task from '../db/task.js';
import { classifyError } from '../primus/errors.js';
import logger from '../shared/logger.js';
import { createTaskEventCtx, type TaskEventCtx } from '../shared/task-event.js';
import { serializeError } from '../utils/error.js';

export interface MasterConfig<JobData extends { taskId: string }> {
  queueName: string;
  workerLabel: string;
  connection: ConnectionOptions;
  workerCount: number;
  retryAttempts: number;
  retryBackoffMs: number;
  lockDurationMs: number;
  stalledIntervalMs: number;
  processJob: (workerId: number, job: Job<JobData, void>, ctx: TaskEventCtx) => Promise<void>;
}

export abstract class Master<JobData extends { taskId: string }> {
  protected readonly config: MasterConfig<JobData>;
  protected readonly workers: Worker<JobData, void>[] = [];

  constructor(config: MasterConfig<JobData>) {
    this.config = config;
  }

  protected abstract handleTask(): Promise<void>;

  protected createWorker(workerId: number): Worker<JobData, void> {
    const { queueName, workerLabel, connection, lockDurationMs, stalledIntervalMs, processJob } =
      this.config;

    const worker = new Worker<JobData, void, string>(
      queueName,
      async (job) => {
        const ctx = createTaskEventCtx({
          event: 'task.attempt',
          taskId: job.data.taskId,
          jobId: job.id,
          queueName,
          workerId,
          workerLabel,
          attempt: job.attemptsMade + 1,
          maxAttempts: typeof job.opts.attempts === 'number' ? job.opts.attempts : 1,
        });
        const stopTimer = ctx.timer('duration');
        let caught: unknown;
        try {
          await processJob(workerId, job, ctx);
        } catch (err) {
          caught = err;
          throw err;
        } finally {
          stopTimer();
          const snap = ctx.snapshot();
          if (!snap.outcome) {
            ctx.set({ outcome: caught ? 'failed' : 'completed' });
          }
          if (caught) {
            ctx.set({
              errorClass: classifyError(caught),
              error: serializeError(caught),
            });
          }
          logger.info(ctx.snapshot(), 'task.attempt');
        }
      },
      {
        connection,
        concurrency: 1,
        lockDuration: lockDurationMs,
        stalledInterval: stalledIntervalMs,
      },
    );

    worker.on('failed', async (job, err) => {
      if (!job) return;

      const attempts = typeof job.opts.attempts === 'number' ? Math.max(job.opts.attempts, 1) : 1;
      const willRetry = job.attemptsMade < attempts;

      try {
        await Task.updateTaskStatus({
          taskId: job.data.taskId,
          status: willRetry ? 'QUEUED' : 'FAILED',
          error: serializeError(err),
        });
      } catch (error: unknown) {
        logger.error(
          { error, jobId: job.id },
          `${workerLabel} worker ${workerId} failed to update task state after job failure`,
        );
      }
    });

    worker.on('error', (err) => {
      logger.error({ error: err }, `${workerLabel} worker ${workerId} error`);
    });

    worker.on('closed', () => {
      logger.warn(`${workerLabel} worker ${workerId} closed, creating replacement`);
      const index = this.workers.indexOf(worker);
      if (index !== -1) this.workers.splice(index, 1);

      try {
        this.createWorker(workerId);
      } catch (error) {
        logger.error(
          { error, workerId },
          `${workerLabel} worker ${workerId} replacement creation failed`,
        );
      }
    });

    this.workers.push(worker);
    return worker;
  }

  protected initializeWorkers(): void {
    const { workerCount, workerLabel } = this.config;
    for (let i = 0; i < workerCount; i++) {
      this.createWorker(i);
    }
    logger.info(`Initialized ${workerCount} workers for ${workerLabel} queue`);
  }

  protected async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async run(): Promise<never> {
    this.initializeWorkers();
    for (;;) {
      await this.handleTask();
    }
  }
}
