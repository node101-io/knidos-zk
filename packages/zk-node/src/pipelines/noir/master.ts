import { Task } from '../../db/task.js';

import { markTaskQueued } from '../../db/task-helpers.js';
import logger from '../../shared/logger.js';
import { Master } from '../master.js';
import type { NoirJobData } from '../types.js';
import { noirQueue } from './worker.js';

export class NoirMaster extends Master<NoirJobData> {
  protected async handleTask(): Promise<void> {
    try {
      const { retryAttempts, retryBackoffMs } = this.config;
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
            attempts: retryAttempts,
            backoff: {
              type: 'fixed',
              delay: retryBackoffMs,
            },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );

        await markTaskQueued(task._id.toString());

        logger.info({ taskId: task._id.toString() }, '[noir master] queued task');
      }
    } catch (error) {
      logger.error({ error }, '[noir master] error');
      await this.sleep(1000);
    }
  }
}
