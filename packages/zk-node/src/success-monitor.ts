import mongoose from 'mongoose';
import pino from 'pino';

import { sendAppriseNotification } from './services/apprise.js';
import { getQueueStatus } from './services/queue-status.js';
import { getSuccessMonitorPolicy } from './services/success-monitor-policy.js';
import { successMonitorEnv } from './success-monitor-env.js';

const PIPELINES = ['zkTLS', 'noir', 'zkVerify'] as const;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const policy = getSuccessMonitorPolicy(
  successMonitorEnv.ZKTLS_WINDOW_MINUTES,
  successMonitorEnv.BINANCE_SYMBOLS.length,
);

const logger = pino({
  base: { service: 'knidos-success-monitor', env: successMonitorEnv.NODE_ENV },
  serializers: { error: pino.stdSerializers.err },
});

async function checkSuccessCounts(): Promise<void> {
  const status = await getQueueStatus(policy.lookbackMs);
  const counts = {
    zkTLS: status.zkTLS?.SUCCESS ?? 0,
    noir: status.noir?.SUCCESS ?? 0,
    zkVerify: status.zkVerify?.SUCCESS ?? 0,
  };
  const unhealthy = PIPELINES.filter((pipeline) => counts[pipeline] < policy.minimumSuccess);

  if (unhealthy.length === 0) {
    logger.info({ counts }, '[success-monitor] daily check healthy');
    return;
  }

  await sendAppriseNotification(
    successMonitorEnv.APPRISE_NOTIFY_URL,
    {
      title: 'Knidos pipeline alert',
      body: [
        `The following pipelines had fewer than ${policy.minimumSuccess} successes in the last ${policy.lookbackMinutes} minutes:`,
        ...unhealthy.map((pipeline) => `- ${pipeline}: ${counts[pipeline]}`),
        '',
        `Checked at: ${new Date().toISOString()}`,
      ].join('\n'),
      type: 'failure',
    },
    {
      username: successMonitorEnv.APPRISE_USERNAME,
      password: successMonitorEnv.APPRISE_PASSWORD,
    },
  );
  logger.info({ counts, unhealthy }, '[success-monitor] daily alert sent');
}

let checkInProgress = false;

async function runCheck(): Promise<void> {
  if (checkInProgress) return;
  checkInProgress = true;
  try {
    await checkSuccessCounts();
  } catch (error) {
    logger.error({ error }, '[success-monitor] daily check failed');
  } finally {
    checkInProgress = false;
  }
}

try {
  await mongoose.connect(successMonitorEnv.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await runCheck();
  const interval = setInterval(() => void runCheck(), CHECK_INTERVAL_MS);
  logger.info(
    {
      checkIntervalHours: 24,
      successLookbackMinutes: policy.lookbackMinutes,
      minimumSuccess: policy.minimumSuccess,
      symbolCount: successMonitorEnv.BINANCE_SYMBOLS.length,
      windowMinutes: successMonitorEnv.ZKTLS_WINDOW_MINUTES,
    },
    '[success-monitor] started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, '[success-monitor] shutting down');
    clearInterval(interval);
    await mongoose.disconnect();
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
} catch (error) {
  logger.error({ error }, '[success-monitor] fatal error');
  await mongoose.disconnect();
  process.exitCode = 1;
}
