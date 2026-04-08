import Task from '../../db/task.js';
import logger from '../../shared/logger.js';
import { Master } from '../Master.js';
import type { ZkTLSJobData } from '../types.js';
import { zkTLSQueue } from './worker.js';

export class ZkTLSMaster extends Master<ZkTLSJobData> {
  protected async handleTask(): Promise<void> {
    try {
      const pendingTasks = await Task.find({
        type: 'zkTLS',
        status: 'PENDING',
      }).limit(20);

      if (pendingTasks.length === 0) {
        await this.sleep(1000);
        return;
      }

      for (const task of pendingTasks) {
        await zkTLSQueue.add(
          'zkTLS-job',
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

        logger.info(
          { taskId: task._id.toString() },
          `[zkTLS master] queued task ${task._id.toString()}`,
        );
      }
    } catch (error) {
      logger.error({ error }, '[zkTLS master] error');
      await this.sleep(1000);
    }
  }
}
