import { connectMongoDB } from "./config/mongoDB.js";
import { startScheduler } from "./services/scheduler.js";
import { connection } from "./config/redis.js";
import { QUEUE_NAMES } from "./config/queueNames.js";
import { ZkTLSMaster } from "./masters/zkTLS";
import { processZkTLSJob } from "./workers/zkTLS";
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

  logger.info("[app] zkTLS pipeline started");

  await zkTLSMaster.run();
}

bootstrap().catch((err) => {
  logger.error({ err }, "[app] fatal error");
  process.exit(1);
});