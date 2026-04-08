import { Job, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import logger from '../shared/logger.js';

export interface MasterConfig<JobData> {
  queueName: string;
  workerLabel: string;
  connection: ConnectionOptions;
  workerCount: number;
  lockDurationMs: number;
  stalledIntervalMs: number;
  processJob: (workerId: number, job: Job<JobData, void, string>) => Promise<void>;
  onJobFailed?: (job: Job<JobData, void, string> | undefined) => Promise<void>;
}

export abstract class Master<JobData> {
  protected readonly config: MasterConfig<JobData>;
  protected readonly workers: Worker<JobData, void, string>[] = [];

  constructor(config: MasterConfig<JobData>) {
    this.config = config;
  }

  protected abstract handleTask(): Promise<void>;

  protected createWorker(workerId: number): Worker<JobData, void, string> {
    const {
      queueName,
      workerLabel,
      connection,
      lockDurationMs,
      stalledIntervalMs,
      processJob,
      onJobFailed,
    } = this.config;

    const worker = new Worker<JobData, void, string>(
      queueName,
      async (job) => {
        logger.info({ jobId: job.id }, `${workerLabel} worker ${workerId} started job ${job.id}`);
        await processJob(workerId, job);
        logger.info({ jobId: job.id }, `${workerLabel} worker ${workerId} finished job ${job.id}`);
      },
      {
        connection,
        concurrency: 1,
        lockDuration: lockDurationMs,
        stalledInterval: stalledIntervalMs,
      },
    );

    worker.on('completed', (job) => {
      logger.info({ jobId: job?.id }, `${workerLabel} worker ${workerId} completed job ${job.id}`);
    });

    worker.on('failed', (job, err) => {
      logger.error(
        { error: err, jobId: job?.id }, //data: job?.data
        `${workerLabel} worker ${workerId} failed job ${job?.id}`,
      );
    });

    if (onJobFailed) {
      worker.on('failed', (job) => {
        if (!job) return;

        void onJobFailed(job).catch((error: unknown) => {
          logger.error(
            { error, jobId: job.id },
            `${workerLabel} worker ${workerId} failed to run onJobFailed hook`,
          );
        });
      });
    }

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
    while (true) {
      await this.handleTask();
    }
  }
}
