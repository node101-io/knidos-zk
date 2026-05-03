import mongoose from 'mongoose';

import { env } from './env.js';
import { warmupNoirRuntime } from './pipelines/noir/runtime.js';
import { NoirMaster } from './pipelines/noir/master.js';
import { noirQueue, processNoirJob } from './pipelines/noir/worker.js';
import { ZkTLSMaster } from './pipelines/zk-tls/master.js';
import { zkTLSQueue, processZkTLSJob } from './pipelines/zk-tls/worker.js';
import { ZkVerifyMaster } from './pipelines/zk-verify/master.js';
import { zkVerifyQueue, processZkVerifyJob } from './pipelines/zk-verify/worker.js';
import { runCleanupOnce } from './services/cleanup.js';
import { startScheduler } from './services/scheduler.js';
import logger from './shared/logger.js';
import { redis } from './shared/redis.js';
import { resetPipelineQueues } from './utils/reset-pipeline-queues.js';

const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 5000;
const ZKTLS_RETRY_ATTEMPTS = 1;

try {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await warmupNoirRuntime();
  await resetPipelineQueues();
  await runCleanupOnce();
  await startScheduler();

  const zkTLSMaster = new ZkTLSMaster({
    queueName: zkTLSQueue.name,
    workerLabel: 'zkTLS',
    connection: redis,
    workerCount: 1,
    retryAttempts: ZKTLS_RETRY_ATTEMPTS,
    retryBackoffMs: RETRY_BACKOFF_MS,
    lockDurationMs: 2 * 60 * 1000, // 2 minutes
    stalledIntervalMs: 60 * 1000, // check every 1 min
    processJob: processZkTLSJob,
  });

  const noirMaster = new NoirMaster({
    queueName: noirQueue.name,
    workerLabel: 'noir',
    connection: redis,
    workerCount: env.NOIR_PROVING_SLOT_COUNT,
    retryAttempts: RETRY_ATTEMPTS,
    retryBackoffMs: RETRY_BACKOFF_MS,
    lockDurationMs: 5 * 60 * 1000, // 5 minutes
    stalledIntervalMs: 60 * 1000, // check every 1 min
    processJob: processNoirJob,
  });

  const zkVerifyMaster = new ZkVerifyMaster({
    queueName: zkVerifyQueue.name,
    workerLabel: 'zkVerify',
    connection: redis,
    workerCount: 1, // we can only have 1 tx in a block (~8sec) with one address
    retryAttempts: RETRY_ATTEMPTS,
    retryBackoffMs: RETRY_BACKOFF_MS,
    lockDurationMs: 2 * 60 * 1000, // 2 minutes
    stalledIntervalMs: 1 * 60 * 1000, // check every 1 min
    processJob: processZkVerifyJob,
  });

  logger.info('[app] pipelines started');

  await Promise.all([zkTLSMaster.run(), noirMaster.run(), zkVerifyMaster.run()]);
} catch (error) {
  logger.error({ error }, '[app] fatal error');
  process.exit(1);
}
