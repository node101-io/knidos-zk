import { Cron } from 'croner';

import { Task } from '../db/task.js';
import { type SupportedBinanceSymbol } from '../shared/binance-symbols.js';

import { env } from '../env.js';
import { parseZkTLSJobInput } from '../pipelines/validation.js';
import { PROOF_TYPE } from '../pipelines/types.js';
import { normalizeDateInput } from '../shared/date-utils.js';
import logger from '../shared/logger.js';
import { getWindowBounds, getMissingSymbols, getWindowsToEnsure } from './scheduler-utils.js';

const DEFAULT_BASE_BALANCE = 100000000;
const DEFAULT_THRESHOLD = 50000000;

// Wait this long after the trading window closes before the master is
// allowed to pick up the task. Binance's userTrades endpoint reads from
// eventually-consistent replicas around the cutoff; without the settle
// window, the zk-node fetch and the Primus attestor fetch can land on
// out-of-sync replicas and produce different response bodies — which
// breaks the noir circuit's sha256(rawFills) == fillsCommitment check.
const WINDOW_SETTLE_WAIT_MS = 5 * 60 * 1000;

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
  const deferUntil = new Date(endTime.getTime() + WINDOW_SETTLE_WAIT_MS);
  const updateResult = await Task.updateOne(
    identityQuery,
    {
      // Tasks land in DEFERRED so the master only grabs them once the
      // settle window has elapsed. Catch-up runs for past windows get a
      // deferUntil that's already in the past — the master picks those
      // up immediately, no special-case needed.
      $setOnInsert: {
        type: 'zkTLS',
        input,
        status: 'DEFERRED',
        deferUntil,
        deferReason: 'await_window_settle',
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
      windowsEnsured: windowsToEnsure.length,
    },
    '[scheduler] catch-up completed',
  );
}

export async function startScheduler(): Promise<void> {
  await catchUpMissedSlots();

  const cronExpr = `*/${env.ZKTLS_WINDOW_MINUTES} * * * *`;

  const schedulerCron = new Cron(cronExpr, {
    protect: () => {
      logger.warn('[scheduler] previous window ensure still running, skipping tick');
    },
  });

  schedulerCron.schedule(async () => {
    try {
      await catchUpMissedSlots();
    } catch (error) {
      logger.error({ error }, '[scheduler] failed to catch up windows');
    }
  });

  logger.info(
    {
      zkTLSCron: cronExpr,
      windowMinutes: env.ZKTLS_WINDOW_MINUTES,
      proofType: PROOF_TYPE,
    },
    '[scheduler] cron jobs registered',
  );
}
