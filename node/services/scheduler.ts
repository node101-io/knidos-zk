import cron from 'node-cron';
import mongoose from 'mongoose';

import { requireEnv } from "../../scripts/utils/requireEnv.js";

import Task from '../db/models/Task';

export function startScheduler() {
  cron.schedule('*/2 * * * *', async () => { // * * * * * <- for test. TODO: change */15 * * * *
    console.log('[scheduler] creating zkTLS task');

    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

    Task.createTask(
      {
        type: "zkTLS",
        pipelineId: new (mongoose.Types.ObjectId)(), // temporary pipeline id
        input: {
          // walletAddress: '0x1234567890abcdef', // TODO: change this
          startTime: fifteenMinutesAgo.toISOString(),
          endTime: now.toISOString(),
          baseBalance: 100000000, //TODO: fetch these time info dynamically
          threshold: 50000000
        },
      },
      (err, task) => {
        if (err) {
          console.error('[scheduler] failed to create task');
        } else {
          console.log('[scheduler] zkTLS task created', task?._id);
        }
      }
    );
  });
}