import { noirQueue } from '../pipelines/noir/worker.js';
import { zkTLSQueue } from '../pipelines/zk-tls/worker.js';
import { zkVerifyQueue } from '../pipelines/zk-verify/worker.js';

export async function resetPipelineQueues(): Promise<void> {
  await Promise.all([
    zkTLSQueue.obliterate({ force: true }),
    noirQueue.obliterate({ force: true }),
    zkVerifyQueue.obliterate({ force: true }),
  ]);
}
