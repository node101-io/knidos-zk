import { createHmac } from 'crypto';

import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { BigNumber, ethers } from 'ethers';

import { env } from '../env.js';
import {
  MAX_FEE_PER_GAS_WEI,
  MAX_PRIORITY_FEE_PER_GAS_WEI,
  primusClient,
  TOKEN_SYMBOL_ETH,
} from './client.js';

export interface PrimusSubmit {
  taskId: string;
  taskTxHash: string;
  taskAttestors: string[];
  submittedAt: number;
}

export interface PrimusAttest {
  reportTxHash: string;
}

// What we persist in the task doc between worker runs. `attest` is
// optional because the crash boundary might land between submit and
// attest; `verify` is not checkpointed because it is idempotent and
// cheap — re-running it on resume reads the already-mined on-chain
// result.
export interface PrimusCheckpoint {
  submit: PrimusSubmit;
  attest?: PrimusAttest;
}

// We attach a fixed attestorCount (matches the SDK's hardcoded value)
// and set a gas ceiling tight enough to catch runaway state but loose
// enough to cover contract-side variance. Historical on-chain average
// is ~263k, max ~278k; 500k buys ~2x headroom.
//
// Why an explicit gasLimit at all: some Base Sepolia RPCs return
// "intrinsic gas too high" on eth_estimateGas for txs that execute
// fine (eth_call confirms success with the same calldata). Skipping
// estimation removes our dependency on that code path. Unused gas is
// not charged by the EVM.
const ATTESTOR_COUNT = 1;
const SUBMIT_GAS_LIMIT = 500_000;

export async function submitPrimusTaskRaw(): Promise<PrimusSubmit> {
  const contract = primusClient.contract();
  const fee = (await contract.queryLatestFeeInfo(TOKEN_SYMBOL_ETH)) as {
    primusFee: BigNumber;
    attestorFee: BigNumber;
  };
  const totalFee = fee.primusFee.add(fee.attestorFee).mul(ATTESTOR_COUNT);

  const tx = (await contract.submitTask(
    env.PRIMUS_USER_ADDRESS,
    '', // templateId — the SDK's default; the contract doesn't enforce a value
    ATTESTOR_COUNT,
    TOKEN_SYMBOL_ETH,
    ethers.constants.AddressZero, // no callback
    {
      value: totalFee,
      gasLimit: SUBMIT_GAS_LIMIT,
      maxFeePerGas: MAX_FEE_PER_GAS_WEI,
      maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS_WEI,
    },
  )) as ethers.ContractTransaction;

  const receipt = await tx.wait();
  const event = receipt.events?.find((e) => e.event === 'SubmitTask');
  if (!event?.args) throw new Error('submit_task_event_missing');

  return {
    taskId: event.args.taskId as string,
    taskTxHash: tx.hash,
    taskAttestors: event.args.attestors as string[],
    submittedAt: Date.now(),
  };
}

export async function attestPrimusTask(
  primus: PrimusNetwork,
  submit: PrimusSubmit,
  symbol: string,
  startTimeMs: number,
  endTimeMs: number,
): Promise<PrimusAttest> {
  const queryString = new URLSearchParams({
    symbol,
    startTime: String(startTimeMs),
    endTime: String(endTimeMs),
    recvWindow: '60000',
    timestamp: String(Date.now()),
  }).toString();
  const signature = createHmac('sha256', env.BINANCE_API_SECRET).update(queryString).digest('hex');

  const result = await primus.attest({
    address: env.PRIMUS_USER_ADDRESS,
    taskId: submit.taskId,
    taskTxHash: submit.taskTxHash,
    taskAttestors: submit.taskAttestors,
    requests: [
      {
        url: `${env.BINANCE_API_URL}/fapi/v1/userTrades?${queryString}&signature=${signature}`,
        method: 'GET',
        header: { 'X-MBX-APIKEY': env.BINANCE_API_KEY },
        body: {},
      },
    ],
    responseResolves: [
      [{ keyName: 'fills_commitment', parseType: 'json', parsePath: '$', op: 'SHA256' }],
    ],
    extendedParams: JSON.stringify({ attUrlOptimization: true }),
    attMode: { algorithmType: 'mpctls', resultType: 'cipher' },
  });

  const reportTxHash = result[0]?.reportTxHash;
  if (!reportTxHash) {
    throw new Error('attestation_report_missing');
  }
  return { reportTxHash };
}

// Returns the on-chain-verified fillsCommitment (SHA256 of the Binance
// response body). Everything else the attestor signs about the task is
// already captured in the task contract's on-chain state; we only read
// the one piece Noir needs.
export async function verifyPrimusTask(
  primus: PrimusNetwork,
  submit: PrimusSubmit,
  attest: PrimusAttest,
): Promise<string> {
  const raw = await primus.verifyAndPollTaskResult({
    taskId: submit.taskId,
    reportTxHash: attest.reportTxHash,
  });

  const verified = raw[0];
  if (!verified) throw new Error('verified_result_missing');

  const attestation = verified.attestation;
  if (typeof attestation.data !== 'string') throw new Error('invalid_attestation_payload');

  const attData = JSON.parse(attestation.data) as Record<string, unknown>;
  const fillsCommitment = attData['SHA256($)'];
  if (typeof fillsCommitment !== 'string') throw new Error('invalid_fills_commitment');

  return fillsCommitment;
}
