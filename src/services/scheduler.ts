import cron from 'node-cron';
import mongoose from 'mongoose';

import Task from '../db/task.js';
import { env } from '../env.js';
import { parseZkTLSJobInput } from '../pipelines/validation.js';
import { PROOF_TYPE } from '../pipelines/types.js';
import type { SupportedBinanceSymbol } from '../shared/binance-symbols.js';
import { normalizeDateInput } from '../shared/date-utils.js';
import logger from '../shared/logger.js';
import { runCleanupOnce } from './cleanup.js';
import { getHourlyWindowBounds, getMissingSymbols, getWindowsToEnsure } from './scheduler-utils.js';

const CLEANUP_CRON = '* * * * *';
const ZKTLS_SCHEDULE_CRON = '0 * * * *';
const DEFAULT_BASE_BALANCE = 100000000;
const DEFAULT_THRESHOLD = 50000000;

async function ensureZkTLSTask(
  startTime: Date,
  endTime: Date,
  symbol: SupportedBinanceSymbol,
): Promise<boolean> {
  const input = parseZkTLSJobInput({
    startTime,
    endTime,
    symbol,
    proofType: PROOF_TYPE,
    baseBalance: DEFAULT_BASE_BALANCE,
    threshold: DEFAULT_THRESHOLD,
  });
  const identityQuery = {
    type: 'zkTLS',
    'input.startTime': input.startTime,
    'input.endTime': input.endTime,
    'input.symbol': input.symbol,
  } as const;
  const updateResult = await Task.updateOne(
    identityQuery,
    {
      $setOnInsert: {
        type: 'zkTLS',
        pipelineId: new mongoose.Types.ObjectId(),
        input,
        maxAttempt: 3,
      },
    },
    { upsert: true },
  );

  if (updateResult.upsertedCount > 0) {
    return true;
  }

  return false;
}

async function ensureWindowTasks(startTime: Date, endTime: Date): Promise<number> {
  const existingTasks = await Task.find(
    {
      type: 'zkTLS',
      'input.startTime': startTime,
      'input.endTime': endTime,
    },
    {
      input: 1,
    },
  ).lean();

  const existingSymbols = existingTasks.flatMap((task) => {
    const input = task.input as { symbol?: unknown };
    return typeof input.symbol === 'string' ? [input.symbol] : [];
  });
  const missingSymbols = getMissingSymbols(existingSymbols, env.BINANCE_SYMBOLS);

  let createdTasks = 0;

  for (const symbol of missingSymbols) {
    if (await ensureZkTLSTask(startTime, endTime, symbol)) {
      createdTasks++;
    }
  }

  return createdTasks;
}

async function catchUpMissedSlots(): Promise<void> {
  const { endTime: currentWindowEnd } = getHourlyWindowBounds(Date.now());
  const latestTask = await Task.findOne({ type: 'zkTLS' })
    .sort({ 'input.endTime': -1, _id: -1 })
    .lean();
  const latestEndTimeValue = (latestTask?.input as { endTime?: unknown } | undefined)?.endTime;
  const latestEndTime = latestEndTimeValue ? normalizeDateInput(latestEndTimeValue) : null;
  if (latestEndTimeValue !== undefined && latestEndTime === null) {
    throw new Error('[scheduler] latest zkTLS task is missing valid input.endTime');
  }

  const windowsToEnsure = getWindowsToEnsure(latestEndTime, currentWindowEnd);
  let createdTasks = 0;

  for (const { startTime, endTime } of windowsToEnsure) {
    createdTasks += await ensureWindowTasks(startTime, endTime);
  }

  logger.info(
    {
      createdTasks,
      from: latestEndTime,
      to: currentWindowEnd,
    },
    '[scheduler] catch-up completed',
  );
}

export async function startScheduler(): Promise<void> {
  await catchUpMissedSlots();

  cron.schedule(CLEANUP_CRON, async () => {
    try {
      await runCleanupOnce();
    } catch (error) {
      logger.error({ error }, '[scheduler] periodic cleanup failed');
    }
  });

  cron.schedule(ZKTLS_SCHEDULE_CRON, async () => {
    const { startTime, endTime } = getHourlyWindowBounds(Date.now());

    try {
      const createdTasks = await ensureWindowTasks(startTime, endTime);
      logger.info(
        {
          startTime,
          endTime,
          createdTasks,
        },
        '[scheduler] hourly window ensured',
      );
    } catch (error) {
      logger.error({ error, windowEnd: endTime }, '[scheduler] failed to ensure hourly window');
    }
  });

  logger.info(
    { cleanupCron: CLEANUP_CRON, zkTLSCron: ZKTLS_SCHEDULE_CRON, proofType: PROOF_TYPE },
    '[scheduler] cron jobs registered',
  );
}
