export type ProofType = "hyperliquid-fills-hourly";

export type PipelineJobData = {
  pipelineRunId: string;
  proofType: ProofType;
  walletAddress: string;
  timeWindowStart: string;
  timeWindowEnd: string;
};

export type ZkTlsJobName = "zktls-process";
export type NoirJobName = "noir-process";
export type ZkVerifyJobName = "zkverify-process";

export type ZkTLSJobInput = {
  startTime: number;
  endTime: number;
  proofType?: string;
  baseBalance?: number;
  threshold?: number;
  fillCount?: number;
};
export type ZkTLSJobData = {
  taskId: string;
  input: ZkTLSJobInput;
};

export type NoirJobInput = {
  zkTLSTaskId: string;
  circuitInput: string;
  noirCircuitDir: string;
};


export type NoirJobData = {
  taskId: string;
  input: NoirJobInput;
};

export type ZkVerifyJobInput = {
  noirTaskId: string;
  targetDir: string;
};

export type ZkVerifyJobData = {
  taskId: string;
  input: ZkVerifyJobInput;
};