import cron from 'node-cron';
import mongoose from 'mongoose';

import Task from '../db/task.js';
import { env } from '../env.js';
import { parseZkTLSJobInput } from '../pipelines/validation.js';
import { PROOF_TYPE } from '../pipelines/types.js';
import type { SupportedBinanceSymbol } from '../shared/binance-symbols.js';
import { normalizeDateInput } from '../shared/date-utils.js';
import logger from '../shared/logger.js';
import { getWindowBounds, getMissingSymbols, getWindowsToEnsure } from './scheduler-utils.js';

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
  const { endTime: currentWindowEnd } = getWindowBounds(Date.now());
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

  const cronExpr = `*/${env.ZKTLS_WINDOW_MINUTES} * * * *`;

  cron.schedule(cronExpr, async () => {
    const { startTime, endTime } = getWindowBounds(Date.now());

    try {
      const createdTasks = await ensureWindowTasks(startTime, endTime);
      logger.info(
        {
          startTime,
          endTime,
          createdTasks,
        },
        '[scheduler] window ensured',
      );
    } catch (error) {
      logger.error({ error, windowEnd: endTime }, '[scheduler] failed to ensure window');
    }
  });

  logger.info(
    { zkTLSCron: cronExpr, windowMinutes: env.ZKTLS_WINDOW_MINUTES, proofType: PROOF_TYPE },
    '[scheduler] cron job registered',
  );
}
