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
  baseBalance?: number;
  threshold?: number;
  fillCount?: number;
}
export interface ZkTLSJobData {
  taskId: string;
  input: ZkTLSJobInput;
}

export interface NoirJobInput {
  zkTLSTaskId: string;
  circuitInput: string;
  noirCircuitDir: string;
}

export interface NoirJobData {
  taskId: string;
  input: NoirJobInput;
}

export interface ZkVerifyJobInput {
  noirTaskId: string;
  targetDir: string;
}

export interface ZkVerifyJobData {
  taskId: string;
  input: ZkVerifyJobInput;
}
