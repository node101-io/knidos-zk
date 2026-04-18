import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { BigNumber, Contract, ethers, providers } from 'ethers';

import { env } from '../env.js';
import { getTaskContractAddress } from './constants.js';
import { TASK_CONTRACT_ABI } from './task-contract-abi.js';

// Singleton so ethers tracks nonce internally across tasks. Shared by the
// zkTLS processor (for submit/attest/verify transactions) and by settlement
// helpers so they reuse the same wallet+provider and don't fight for nonces.
let primusInstance: PrimusNetwork | null = null;
let providerInstance: providers.JsonRpcProvider | null = null;
let maxUnsettledTaskCountCache: number | null = null;

export function getPrimusProvider(): providers.JsonRpcProvider {
  if (!providerInstance) {
    providerInstance = new providers.JsonRpcProvider(env.RPC_URL);
  }
  return providerInstance;
}

export async function getPrimus(): Promise<PrimusNetwork> {
  if (primusInstance) return primusInstance;

  const provider = getPrimusProvider();
  const wallet = new ethers.Wallet(env.PRIMUS_PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, env.PRIMUS_CHAIN_ID);
  primusInstance = primus;
  return primus;
}

export function getTaskContract(): Contract {
  const address = getTaskContractAddress(env.PRIMUS_CHAIN_ID);
  return new Contract(address, TASK_CONTRACT_ABI, getPrimusProvider());
}

export async function getMaxUnsettledTaskCount(): Promise<number> {
  if (maxUnsettledTaskCountCache !== null) return maxUnsettledTaskCountCache;
  const value = (await getTaskContract().maxUnsettledTaskCount()) as BigNumber;
  maxUnsettledTaskCountCache = value.toNumber();
  return maxUnsettledTaskCountCache;
}
