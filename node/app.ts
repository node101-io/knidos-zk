import { connectMongoDB } from "./config/mongoDB";
import { startScheduler } from "./services/scheduler";
import { startZkTLSMaster } from "./masters/zkTLS";
import { startZkTLSWorker } from "./workers/zkTLS";

async function bootstrap() {
  await connectMongoDB();

  startScheduler();
  startZkTLSMaster();
  startZkTLSWorker();

  console.log("[app] zkTLS pipeline started");
}

bootstrap().catch((err) => {
  console.error("[app] fatal error", err);
  process.exit(1);
});