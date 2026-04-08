import mongoose from 'mongoose';
import { env } from './config/env.js';
import { NoirMaster } from './pipelines/noir/master.js';
import { noirQueue, processNoirJob } from './pipelines/noir/worker.js';
import { ZkTLSMaster } from './pipelines/zkTLS/master.js';
import { zkTLSQueue, processZkTLSJob } from './pipelines/zkTLS/worker.js';
import { ZkVerifyMaster } from './pipelines/zkVerify/master.js';
import { zkVerifyQueue, processZkVerifyJob } from './pipelines/zkVerify/worker.js';
import { startScheduler } from './services/scheduler.js';
import { startCleanup } from './services/cleanup.js';
import { redis } from './shared/redis.js';
import logger from './shared/logger.js';

export async function bootstrap() {
  try {
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  } catch (error) {
    logger.error({ error }, '[app] failed to connect to MongoDB');
    process.exit(1); // TODO: Ask necip
  }

  try {
    startScheduler();
  } catch (error) {
    logger.error({ error }, '[app] failed to start scheduler');
    process.exit(1); // TODO: Ask necip
  }

  void startCleanup().catch((error) => {
    logger.error({ error }, '[app] cleanup loop crashed');
    process.exit(1); // TODO: Ask necip
  });

  const zkTLSMaster = new ZkTLSMaster({
    queueName: zkTLSQueue.name,
    workerLabel: 'zkTLS',
    connection: redis,
    workerCount: 2,
    lockDurationMs: 2 * 60 * 1000, // 2 minutes
    stalledIntervalMs: 60 * 1000, // check every 1 min
    processJob: processZkTLSJob,
    // onJobFailed ekle
  });

  const noirMaster = new NoirMaster({
    queueName: noirQueue.name,
    workerLabel: 'noir',
    connection: redis,
    workerCount: 4,
    lockDurationMs: 5 * 60 * 1000, // 5 minutes
    stalledIntervalMs: 60 * 1000, // check every 1 min
    processJob: processNoirJob,
  });

  const zkVerifyMaster = new ZkVerifyMaster({
    queueName: zkVerifyQueue.name,
    workerLabel: 'zkVerify',
    connection: redis,
    workerCount: 1, // we can only have 1 tx in a block (~8sec) with one address
    lockDurationMs: 2 * 60 * 1000, // 2 minutes
    stalledIntervalMs: 1 * 60 * 1000, // check every 1 min
    processJob: processZkVerifyJob,
  });

  logger.info('[app] zkTLS pipeline started');

  await Promise.all([zkTLSMaster.run(), noirMaster.run(), zkVerifyMaster.run()]);
}
