import { connectMongoDB } from "./config/mongoDB.js";
import { startScheduler } from "./services/scheduler.js";
import { connection } from "./config/redis.js";
import { QUEUE_NAMES } from "./config/queueNames.js";
import { ZkTLSMaster } from "./masters/zkTLS";
import { NoirMaster } from "./masters/noir.js";
import { ZkVerifyMaster } from "./masters/zkVerify.js";
import { processZkTLSJob } from "./workers/zkTLS";
import { processNoirJob } from "./workers/noir.js";
import { processZkVerifyJob } from "./workers/zkVerify.js";
import logger from "./logger.js";

async function bootstrap() {
  try {
    await connectMongoDB();
  }
  catch (err){
    process.exit(1); // TODO: Ask necip
  }

  startScheduler();

  const zkTLSMaster = new ZkTLSMaster({
    queueName: QUEUE_NAMES.ZKTLS,
    workerLabel: "zkTLS",
    connection,
    workerCount: 2,
    lockDurationMs: 2 * 60 * 1000,     // 2 minutes
    stalledIntervalMs: 60 * 1000,      // check every 1 min
    processJob: processZkTLSJob,
    // onJobFailed ekle
  });
  const noirMaster = new NoirMaster({
    queueName: QUEUE_NAMES.NOIR,
    workerLabel: "noir",
    connection,
    workerCount: 4,
    lockDurationMs: 5 * 60 * 1000,     // 5 minutes
    stalledIntervalMs: 60 * 1000,      // check every 1 min
    processJob: processNoirJob,
});
  const zkVerifyMaster = new ZkVerifyMaster({
    queueName: QUEUE_NAMES.ZKVERIFY,
    workerLabel: "zkVerify",
    connection,
    workerCount: 1,   // we can only have 1 tx in a block (~8sec) with one address
    lockDurationMs: 2 * 60 * 1000,      // 2 minutes
    stalledIntervalMs: 1 * 60 * 1000,   // check every 1 min
    processJob: processZkVerifyJob,
  });

  logger.info("[app] zkTLS pipeline started");

  await Promise.all([
    zkTLSMaster.run(),
    noirMaster.run(),
    zkVerifyMaster.run(),
  ]);
}

bootstrap().catch((err) => {
  logger.error({ err }, "[app] fatal error");
  process.exit(1);
});