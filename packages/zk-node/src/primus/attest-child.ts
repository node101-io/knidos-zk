// Entry point of the attestation child process. attest-runner.ts forks
// this file, sends one AttestChildRequest, and waits for one
// AttestChildResponse. Everything the Primus native addon can do to a
// process (block, hang, exit) happens here, not in the daemon.
//
// Keep this module thin: env and the Primus client are the only imports
// that touch the outside world. No Mongo, no Redis, no queues.

import { serializeError } from '../utils/error.js';
import type { AttestChildRequest, AttestChildResponse } from './attest-protocol.js';
import { primusClient } from './client.js';
import { attestPrimusTask } from './task.js';

async function attest(message: AttestChildRequest): Promise<AttestChildResponse> {
  try {
    const primus = await primusClient.sdk();
    const result = await attestPrimusTask(primus, message.submit, message.request);
    return { ok: true, attest: result };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

if (typeof process.send !== 'function') {
  console.error('attest-child must be started with an IPC channel (child_process.fork)');
  process.exit(2);
}

process.once('message', (message) => {
  void attest(message as AttestChildRequest).then((response) => {
    process.send?.(response, () => process.exit(0));
  });
});
