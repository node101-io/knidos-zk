import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { BigNumber, Contract } from 'ethers';

import { env } from '../env.js';
import { TOKEN_SYMBOL_ETH } from './constants.js';
import {
  getMaxUnsettledTaskCount,
  getPrimus,
  getTaskContract,
} from './primus-client.js';

export interface SettlementResult {
  settled: string[];
  toWithdrawWei: string;
}

export async function settleExpiredPrimusTasks(
  primus: PrimusNetwork,
  taskContract: Contract,
  maxWithdrawLimit: number,
): Promise<SettlementResult> {
  const balance = await taskContract.queryBalance(env.PRIMUS_USER_ADDRESS, TOKEN_SYMBOL_ETH);
  const pending = (balance.toWithdrawTaskCount as BigNumber).toNumber();
  const toWithdrawWei = (balance.toWithdraw as BigNumber).toString();

  if (pending === 0) {
    return { settled: [], toWithdrawWei };
  }

  const settled = (await primus.withdrawBalance(TOKEN_SYMBOL_ETH, maxWithdrawLimit)) as string[];
  return { settled, toWithdrawWei };
}

export async function settleExpiredPrimusTasksAuto(): Promise<SettlementResult> {
  const [primus, maxWithdrawLimit] = await Promise.all([
    getPrimus(),
    getMaxUnsettledTaskCount(),
  ]);
  return settleExpiredPrimusTasks(primus, getTaskContract(), maxWithdrawLimit);
}
