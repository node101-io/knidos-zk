export type ProofType = 'hyperliquid-fills-hourly';

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

export interface ZkTLSJobInput {
  startTime: number;
  endTime: number;
  proofType?: string;
  baseBalance: number;
  threshold: number;
}
export interface ZkTLSJobData {
  taskId: string;
  input: ZkTLSJobInput;
}

export interface NoirCircuitInput {
  address: number[];
  salt: number[];
  addressCommitment: string[];
  fillsCommitment: string[];
  rawFills: number[];
  rawFillsLength: number;
  addressAndSaltLength: number;
  fillCount: number;
  startTime: number;
  endTime: number;
  baseBalance: number;
  threshold: number;
}

export interface NoirJobInput {
  zkTLSTaskId: string;
  circuitInput: NoirCircuitInput;
}

export interface NoirJobData {
  taskId: string;
  input: NoirJobInput;
}

export interface ZkVerifyJobInput {
  noirTaskId: string;
}

export interface ZkVerifyJobData {
  taskId: string;
  input: ZkVerifyJobInput;
}
