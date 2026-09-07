import { fork } from 'node:child_process';

import type { AttestChildRequest, AttestChildResponse } from './attest-protocol.js';
import { AttestationChildError } from './errors.js';
import type { PrimusAttest } from './task.js';

// Runs one Primus attestation in a forked child process.
//
// Why not in-process: the SDK's attest() drives a native addon that is a
// process-wide singleton with one attestation slot. Observed on
// 2026-09-05 against a half-dead attestor: an MPC session hung for 23
// minutes, the slot never freed, every later getAttestation() returned
// "busy" (surfaced as code 00000) for 27 hours, and on a socket error the
// addon exited the daemon outright with code 0 and no JS-side log. None
// of that can be caught or cancelled from JavaScript in the same process.
// A child gives us a kill switch: a wedged attestation costs one attempt,
// a crashing addon costs one child, and every attempt starts with a
// fresh slot.
//
// The parent's event loop never runs addon code, so bullmq lock renewal
// keeps working and a slow attestation no longer stalls the job.
//
// Only the zkTLS worker calls this, and it runs one job at a time, so
// there is never more than one child.

// The SDK's own attest() ceiling is 2 min (getAttestationResult polling).
// The margin lets a healthy-but-slow run surface the SDK's timeout, which
// names the attestor phase, rather than ours; only a run the SDK itself
// has lost track of gets killed.
export const ATTEST_CHILD_TIMEOUT_MS = 150_000;

// Same extension as this module so `tsx` (dev) and compiled `dist`
// (prod) both resolve; fork inherits execArgv, which carries tsx's loader.
const CHILD_ENTRY = new URL(
  import.meta.url.endsWith('.ts') ? './attest-child.ts' : './attest-child.js',
  import.meta.url,
);

export interface AttestRunnerOptions {
  entry?: URL;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

// Resolves with the attestation, or rejects with one of:
//   - AttestationChildError('timeout' | 'crash'): the child never
//     reported; errors.ts turns this into a checkpoint-preserving wait.
//   - the SDK's own error, as the child serialized it: the same plain
//     object attest() used to throw in-process, so the existing
//     classification in errors.ts applies unchanged.
export function runAttestationInChild(
  request: AttestChildRequest,
  options: AttestRunnerOptions = {},
): Promise<PrimusAttest> {
  const timeoutMs = options.timeoutMs ?? ATTEST_CHILD_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = fork(options.entry ?? CHILD_ENTRY, [], {
      serialization: 'json',
      // stdout/stderr flow into the daemon's log stream like before, so
      // the SDK's console output and the addon's |ERROR| lines stay visible.
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: options.env ?? process.env,
    });

    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(() =>
        reject(
          new AttestationChildError(
            'timeout',
            `attestation child exceeded ${timeoutMs}ms and was killed`,
          ),
        ),
      );
    }, timeoutMs);

    child.once('message', (message) => {
      const response = message as AttestChildResponse;
      settle(() => (response.ok ? resolve(response.attest) : reject(response.error)));
    });

    child.once('exit', (code, signal) => {
      settle(() =>
        reject(
          new AttestationChildError(
            'crash',
            `attestation child exited without reporting (code=${code}, signal=${signal})`,
          ),
        ),
      );
    });

    child.once('error', (error) => {
      settle(() =>
        reject(
          new AttestationChildError('crash', 'attestation child could not be started', {
            cause: error,
          }),
        ),
      );
    });

    try {
      child.send(request);
    } catch (error) {
      child.kill('SIGKILL');
      settle(() =>
        reject(
          new AttestationChildError('crash', 'attestation child did not accept the request', {
            cause: error,
          }),
        ),
      );
    }
  });
}
