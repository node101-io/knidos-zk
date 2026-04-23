import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { BigNumber, Contract, ethers, providers } from 'ethers';

import { env } from '../env.js';
import { TASK_CONTRACT_ABI, getTaskContractAddress } from './contract.js';
import { PrimaryFallbackJsonRpcProvider } from './rpc-provider.js';

export { TOKEN_SYMBOL_ETH } from './contract.js';

// Base Sepolia's eth_gasPrice returns 1.505 gwei unconditionally, but
// the actual basefee observed via eth_feeHistory is ~0.005 gwei.
// ethers v5's default fee data pulls from eth_gasPrice, causing a
// ~300x overpay on every tx (drained 0.132 ETH over 330 submits on
// 2026-04-20). We pin our own caps: maxFeePerGas gives ~10x headroom
// over observed basefee; priority is within the range eth_feeHistory
// reports as typical reward (1-4 Mwei).
export const MAX_FEE_PER_GAS_WEI = 50_000_000; // 0.05 gwei
export const MAX_PRIORITY_FEE_PER_GAS_WEI = 2_000_000; // 0.002 gwei

// ---- Client ------------------------------------------------------------
//
// ethers tracks nonce internally on the wallet+provider pair. Submit /
// reclaim / attest must share the same wallet so a submit and a reclaim
// don't race on pending nonces. One factory, one wallet, one contract.
//
// `contract()` is signer-connected so both view and state-changing calls
// work through it. View calls don't need a signer but attaching one is
// free, and it keeps the surface single-method.

export interface PrimusClient {
  readonly provider: providers.JsonRpcProvider;
  readonly userAddress: string;
  sdk(): Promise<PrimusNetwork>;
  contract(): Contract;
  maxUnsettledTaskCount(): Promise<number>;
  taskTimeoutMs(): Promise<number>;
}

export function createPrimusClient(cfg: {
  chainId: number;
  privateKey: string;
  rpcUrl: string;
  fallbackUrls?: readonly string[];
  userAddress: string;
}): PrimusClient {
  const contractAddress = getTaskContractAddress(cfg.chainId);

  const provider = new PrimaryFallbackJsonRpcProvider(
    cfg.rpcUrl,
    cfg.chainId,
    cfg.fallbackUrls ?? [],
  );

  let walletInstance: ethers.Wallet | null = null;
  let contractInstance: Contract | null = null;
  let maxTasksCache: number | null = null;
  let timeoutMsCache: number | null = null;

  function wallet(): ethers.Wallet {
    if (!walletInstance) walletInstance = new ethers.Wallet(cfg.privateKey, provider);
    return walletInstance;
  }

  async function sdk(): Promise<PrimusNetwork> {
    const instance = new PrimusNetwork();
    await instance.init(wallet(), cfg.chainId);
    return instance;
  }

  function contract(): Contract {
    if (!contractInstance) {
      contractInstance = new Contract(contractAddress, TASK_CONTRACT_ABI, wallet());
    }
    return contractInstance;
  }

  async function maxUnsettledTaskCount(): Promise<number> {
    if (maxTasksCache !== null) return maxTasksCache;
    const value = (await contract().maxUnsettledTaskCount()) as BigNumber;
    maxTasksCache = value.toNumber();
    return maxTasksCache;
  }

  async function taskTimeoutMs(): Promise<number> {
    if (timeoutMsCache !== null) return timeoutMsCache;
    const value = (await contract().taskTimeout()) as BigNumber;
    timeoutMsCache = value.toNumber() * 1000;
    return timeoutMsCache;
  }

  return {
    provider,
    userAddress: cfg.userAddress,
    sdk,
    contract,
    maxUnsettledTaskCount,
    taskTimeoutMs,
  };
}

export const primusClient = createPrimusClient({
  chainId: env.PRIMUS_CHAIN_ID,
  privateKey: env.PRIMUS_PRIVATE_KEY,
  rpcUrl: env.RPC_URL,
  fallbackUrls: env.RPC_FALLBACK_URLS,
  userAddress: env.PRIMUS_USER_ADDRESS,
});
