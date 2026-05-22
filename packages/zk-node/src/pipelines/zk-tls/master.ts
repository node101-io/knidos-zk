import { Task } from '../../db/task.js';

import { markTaskQueued } from '../../db/task-helpers.js';
import logger from '../../shared/logger.js';
import { Master } from '../master.js';
import type { ZkTLSJobData } from '../types.js';
import { zkTLSQueue } from './worker.js';

export class ZkTLSMaster extends Master<ZkTLSJobData> {
  protected async handleTask(): Promise<void> {
    try {
      const { retryAttempts, retryBackoffMs } = this.config;
      const now = new Date();
      const task = await Task.findOne({
        type: 'zkTLS',
        $or: [{ status: 'PENDING' }, { status: 'DEFERRED', deferUntil: { $lte: now } }],
      })
        .sort({ 'input.endTime': 1, _id: 1 })
        .exec();

      if (!task) {
        await this.sleep(1000);
        return;
      }

      await zkTLSQueue.add(
        'zkTLS-job',
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
          removeOnComplete: true,
          removeOnFail: true,
        },
      );

      await markTaskQueued(task._id.toString());

      logger.info(
        { taskId: task._id.toString() },
        `[zkTLS master] queued task ${task._id.toString()}`,
      );
    } catch (error) {
      logger.error({ error }, '[zkTLS master] error');
      await this.sleep(1000);
    }
  }
}
