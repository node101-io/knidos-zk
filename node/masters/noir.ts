import Task from '../db/task.js';
import logger from '../shared/logger.js';
import { Master } from './Master.js';
import { noirQueue } from '../workers/noir.js';
import type { NoirJobData } from '../shared/types.js';

export class NoirMaster extends Master<NoirJobData> {
  protected async handleTask(): Promise<void> {
    try {
      const pendingTasks = await Task.find({
        type: 'noir',
        status: 'PENDING',
      }).limit(20);

      if (pendingTasks.length === 0) {
        await this.sleep(1000);
        return;
      }

      for (const task of pendingTasks) {
        await noirQueue.add(
          'noir-process',
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

        logger.info({ taskId: task._id.toString() }, '[noir master] queued task');
      }
    } catch (error) {
      logger.error({ error }, '[noir master] error');
      await this.sleep(1000);
    }
  }
}
