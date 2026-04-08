import cron from 'node-cron';
import mongoose from 'mongoose';

import Task from '../db/task.js';

const START_TIME = 1769172979000; // For testing
const END_TIME = 1769172996000; // For testing

export function startScheduler() {
  cron.schedule('*/3 * * * *', async () => {
    console.log('[scheduler] creating zkTLS task');

    // const now = new Date();
    // const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

    try {
      const task = await Task.createTask({
        type: 'zkTLS',
        pipelineId: new mongoose.Types.ObjectId(),
        input: {
          startTime: START_TIME, //fifteenMinutesAgo.toISOString()
          endTime: END_TIME, //now.toISOString()
          baseBalance: 100000000, //TODO: fetch these time info dynamically
          threshold: 50000000,
        },
      });
      console.log('[scheduler] zkTLS task created', task._id);
    } catch (err) {
      console.error('[scheduler] failed to create task', err);
    }
  });
}
