import { connectMongoDB } from "./config/mongoDB.js";
import { startScheduler } from "./services/scheduler.js";
import { connection } from "./config/redis.js";
import { QUEUE_NAMES } from "./config/queueNames.js";
import { ZkTLSMaster } from "./masters/zkTLS";
import { NoirMaster } from "./masters/noir.js";
import { processZkTLSJob } from "./workers/zkTLS";
import { processNoirJob } from "./workers/noir.js";
import logger from "./logger.js";

async function bootstrap() {
  await connectMongoDB();

  startScheduler();

  const zkTLSMaster = new ZkTLSMaster({
    queueName: QUEUE_NAMES.ZKTLS,
    workerLabel: "zkTLS",
    connection,
    workerCount: 5,
    lockDurationMs: 30000,
    stalledIntervalMs: 30000,
    processJob: processZkTLSJob,
    // onJobFailed ekle
  });
  const noirMaster = new NoirMaster({
    queueName: QUEUE_NAMES.NOIR,
    workerLabel: "noir",
    connection,
    workerCount: 5,
    lockDurationMs: 30000,
    stalledIntervalMs: 30000,
    processJob: processNoirJob,
});

  logger.info("[app] zkTLS pipeline started");

  await Promise.all([
    zkTLSMaster.run(),
    noirMaster.run(),
  ]);
}

bootstrap().catch((err) => {
  logger.error({ err }, "[app] fatal error");
  process.exit(1);
});