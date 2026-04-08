import Task from '../../db/task.js';
import logger from '../../shared/logger.js';
import { Master } from '../master.js';
import type { ZkVerifyJobData } from '../types.js';
import { zkVerifyQueue } from './worker.js';

export class ZkVerifyMaster extends Master<ZkVerifyJobData> {
  protected async handleTask(): Promise<void> {
    try {
      const pendingTasks = await Task.find({
        type: 'zkVerify',
        status: 'PENDING',
      }).limit(20);

      if (pendingTasks.length === 0) {
        await this.sleep(1000);
        return;
      }

      for (const task of pendingTasks) {
        await zkVerifyQueue.add(
          'zkverify-process',
          {
            taskId: task._id.toString(),
            input: task.input,
          },
          {
            jobId: task._id.toString(),
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );

        await Task.markTaskQueued(task._id.toString());

        logger.info({ taskId: task._id.toString() }, '[zkVerify master] queued task');
      }
    } catch (error) {
      logger.error({ error }, '[zkVerify master] error');
      await this.sleep(1000);
    }
  }
}
