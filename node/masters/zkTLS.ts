import { JOB_NAMES } from "../config/queueNames";
import { zktlsQueue } from "../queues/zkTLS";
import type { PipelineJobData } from "../types";

export class ZkTlsMaster {
  async createTask(data: PipelineJobData): Promise<void> {
    console.log("[zkTLS master] creating task");

    await zktlsQueue.add(JOB_NAMES.ZKTLS_PROCESS, data, {
      jobId: `zktls-${data.pipelineRunId}`,
    });

    console.log("[zkTLS master] task added to zkTLS queue");
  }
}