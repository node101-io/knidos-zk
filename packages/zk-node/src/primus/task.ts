import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { BigNumber, ethers } from 'ethers';

import { env } from '../env.js';
import type { UserFillsRequest } from '../utils/fetch-raw-fills.js';
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
  // The exact request the attestor was asked to make + the wall-clock moment
  // we built it. We later replay this same request ourselves so both sides see
  // the same response body.
  request: UserFillsRequest;
  attestedAt: number;
  // Salts behind the two SHA256_WITH_SALT commitments, read off the attesting
  // SDK instance. They must be captured here because a later SDK instance
  // cannot recover them.
  fillsSalt: string;
  addressSalt: string;
}

// Both commitments are salted. The address one keeps the account private; the
// fills one has to be salted as well because Hyperliquid's response body is
// publicly reproducible - an unsalted sha256(body) could be matched against
// candidate addresses to work out whose proof this is.
export interface PrimusCommitments {
  // sha256(body || fillsSalt) over the raw response body.
  fillsCommitment: string;
  // sha256(user || addressSalt) over the request's `user` field.
  addressCommitment: string;
}

// keyNames of the SHA256_WITH_SALT resolvers; Primus exposes each salt (and
// the resulting commitment) under its keyName.
const FILLS_COMMITMENT_KEY = 'fills_commitment';
const ADDRESS_COMMITMENT_KEY = 'user_commitment';

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

// Reads the salt Primus generated for a SHA256_WITH_SALT resolver. It only
// lives on the SDK instance that ran the attestation, so this must be called
// before that instance is discarded.
function readAttestSalt(primus: PrimusNetwork, taskId: string, keyName: string): string {
  const salt: unknown = primus.getPrivateData(taskId, keyName);

  if (typeof salt !== 'string' || salt.length === 0) {
    throw new Error('attestation_salt_missing');
  }

  return salt;
}

export async function attestPrimusTask(
  primus: PrimusNetwork,
  submit: PrimusSubmit,
  request: UserFillsRequest,
): Promise<PrimusAttest> {
  const attestedAt = Date.now();
  const result = await primus.attest({
    address: env.PRIMUS_USER_ADDRESS,
    taskId: submit.taskId,
    taskTxHash: submit.taskTxHash,
    taskAttestors: submit.taskAttestors,
    requests: [request],
    responseResolves: [
      [
        {
          keyName: FILLS_COMMITMENT_KEY,
          parseType: 'json',
          parsePath: '$',
          op: 'SHA256_WITH_SALT',
        },
        {
          keyName: ADDRESS_COMMITMENT_KEY,
          parseType: 'json',
          parsePath: '^.user',
          op: 'SHA256_WITH_SALT',
        },
      ],
    ],
    extendedParams: JSON.stringify({ attUrlOptimization: true }),
    getAllJsonResponse: 'true',
    // mpctls so the attestor never sees the request in the clear: the `user`
    // field is the trading address, and the point of the salted commitments is
    // that nobody but us learns it. proxytls would be cheaper but hands the
    // attestor the plaintext. On chain the request is already stripped by
    // attUrlOptimization (verified: url without query, empty header, empty
    // body), so this only closes the attestor's view.
    attMode: { algorithmType: 'mpctls', resultType: 'cipher' },
  });

  const reportTxHash = result[0]?.reportTxHash;
  if (!reportTxHash) {
    throw new Error('attestation_report_missing');
  }

  return {
    reportTxHash,
    request,
    attestedAt,
    fillsSalt: readAttestSalt(primus, submit.taskId, FILLS_COMMITMENT_KEY),
    addressSalt: readAttestSalt(primus, submit.taskId, ADDRESS_COMMITMENT_KEY),
  };
}

// Returns the on-chain-verified commitments the circuit consumes: the salted
// hashes of the response body and of the request's `user` field.
// Everything else the attestor signs about the task is already captured in
// the task contract's on-chain state.
export async function verifyPrimusTask(
  primus: PrimusNetwork,
  submit: PrimusSubmit,
  attest: PrimusAttest,
): Promise<PrimusCommitments> {
  const raw = await primus.verifyAndPollTaskResult({
    taskId: submit.taskId,
    reportTxHash: attest.reportTxHash,
  });

  const verified = raw[0];
  if (!verified) throw new Error('verified_result_missing');

  const attestation = verified.attestation;
  if (typeof attestation.data !== 'string') throw new Error('invalid_attestation_payload');

  const attData = JSON.parse(attestation.data) as Record<string, unknown>;
  const fillsCommitment = attData[FILLS_COMMITMENT_KEY];
  const addressCommitment = attData[ADDRESS_COMMITMENT_KEY];
  if (typeof fillsCommitment !== 'string') throw new Error('invalid_fills_commitment');
  if (typeof addressCommitment !== 'string') throw new Error('invalid_address_commitment');

  return { fillsCommitment, addressCommitment };
}
