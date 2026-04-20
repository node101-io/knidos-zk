import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { BigNumber, Contract, ethers, providers } from 'ethers';

import { env } from '../env.js';

// ---- Contract surface --------------------------------------------------
//
// Primus Task contract per chain. We pin these rather than reading from
// the SDK because the failure mode of a silently-wrong address is worse
// than the maintenance cost of a two-line table.

const TASK_CONTRACT_ADDRESSES: Record<number, string> = {
  84532: '0xC02234058caEaA9416506eABf6Ef3122fCA939E8', // Base Sepolia
  8453: '0x151cb5eD5D10A42B607bB172B27BDF6F884b9707', // Base Mainnet
};

// Only ETH is supported by the Primus contract at the moment; keep the
// named constant so callers don't scatter magic numbers.
export const TOKEN_SYMBOL_ETH = 0;

// Explicit fragment of the TaskContract ABI. Only the view/write methods
// this codebase actually uses are listed. If the contract is upgraded
// and renames or removes a field, ethers will fail at our boundary
// rather than silently changing behaviour.
const TASK_CONTRACT_ABI = [
  // read
  'function maxUnsettledTaskCount() view returns (uint256)',
  'function taskTimeout() view returns (uint256)',
  'function taskCount() view returns (uint256)',
  'function queryBalance(address user, uint8 tokenSymbol) view returns (tuple(uint8 tokenSymbol, uint256 toWithdraw, uint256 toLock, uint256 toWithdrawTaskCount, uint256 toLockTaskCount) balance)',
  'function queryUnsettledTasks(address user, uint8 tokenSymbol, uint256 offset, uint256 limit) view returns (tuple(string templateId, address submitter, address[] attestors, tuple(address attestor, bytes32 taskId, tuple(address recipient, tuple(string url, string header, string method, string body) request, tuple(tuple(string keyName, string parseType, string parsePath)[] oneUrlResponseResolve)[] responseResolve, string data, string attConditions, uint64 timestamp, string additionParams) attestation, bytes signature)[] taskResults, uint64 submittedAt, uint8 tokenSymbol, address callback, uint8 taskStatus)[] taskInfos, uint256 totalCount)',
  'function queryLatestFeeInfo(uint8 tokenSymbol) view returns (tuple(uint256 primusFee, uint256 attestorFee, uint64 settedAt) feeInfo)',
  // write
  'function submitTask(address sender, string templateId, uint256 attestorCount, uint8 tokenSymbol, address callback) payable returns (bytes32 taskId)',
  'function withdrawBalance(uint8 tokenSymbol, uint256 limit)',
  // events (needed so ethers can decode receipt logs)
  'event SubmitTask(address indexed submitter, bytes32 taskId, string templateId, address[] attestors, uint64 submittedAt)',
  'event WithdrawBalance(address indexed user, uint8 tokenSymbol, uint256 toWithdraw, bytes32[] settledTaskIds, uint8[] taskStatuses)',
];

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
  userAddress: string;
}): PrimusClient {
  const contractAddress: string =
    TASK_CONTRACT_ADDRESSES[cfg.chainId] ??
    (() => {
      throw new Error(`Unknown Primus chainId ${cfg.chainId} (no TaskContract address mapping)`);
    })();

  const provider = new providers.JsonRpcProvider(cfg.rpcUrl);

  let walletInstance: ethers.Wallet | null = null;
  let sdkInstance: PrimusNetwork | null = null;
  let contractInstance: Contract | null = null;
  let maxTasksCache: number | null = null;
  let timeoutMsCache: number | null = null;

  function wallet(): ethers.Wallet {
    if (!walletInstance) walletInstance = new ethers.Wallet(cfg.privateKey, provider);
    return walletInstance;
  }

  async function sdk(): Promise<PrimusNetwork> {
    if (sdkInstance) return sdkInstance;
    const instance = new PrimusNetwork();
    await instance.init(wallet(), cfg.chainId);
    sdkInstance = instance;
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
  userAddress: env.PRIMUS_USER_ADDRESS,
});
