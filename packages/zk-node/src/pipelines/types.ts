export const PROOF_TYPE = 'hyperliquid-fills';

export type ProofType = typeof PROOF_TYPE;

export interface PipelineJobData {
  pipelineRunId: string;
  proofType: ProofType;
  walletAddress: string;
  timeWindowStart: string;
  timeWindowEnd: string;
}

export type ZkTlsJobName = 'zktls-process';
export type NoirJobName = 'noir-process';
export type ZkVerifyJobName = 'zkverify-process';

// Hyperliquid's userFillsByTime returns every coin the account traded in the
// window in one response, and the proof commits to that whole body - so a
// window is exactly one task and there is no per-symbol fan-out.
export interface ZkTLSJobInput {
  startTime: Date;
  endTime: Date;
  proofType?: ProofType;
  baseBalance: number;
  threshold: number;
}
export interface ZkTLSJobData {
  taskId: string;
  input: ZkTLSJobInput;
}

// Both commitments are salted (see primus/task.ts): the address one keeps the
// account private, and the fills one keeps a publicly reproducible response
// body from being matched back to the address.
export interface NoirCircuitInput {
  addressCommitment: string[];
  fillsCommitment: string[];
  address: number[];
  addressSalt: number[];
  fillsSalt: number[];
  rawFills: number[];
  rawFillsLength: number;
  startTime: number;
  endTime: number;
  baseBalance: number;
  threshold: number;
}

export interface NoirJobInput {
  zkTLSTaskId: string;
  startTime: Date;
  endTime: Date;
  circuitInput: NoirCircuitInput;
}

export interface NoirJobData {
  taskId: string;
  input: NoirJobInput;
}

export interface ZkVerifyJobInput {
  noirTaskId: string;
  startTime: Date;
  endTime: Date;
}

export interface ZkVerifyJobData {
  taskId: string;
  input: ZkVerifyJobInput;
}
