import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir, type InputMap } from '@noir-lang/noir_js';

import logger from '../../shared/logger.js';

const execFileAsync = promisify(execFile);

const KECCAK_PROOF_OPTIONS = { keccak: true } as const;

export const NOIR_PROVING_SLOT_COUNT = 2;

type CompiledProgram = ConstructorParameters<typeof Noir>[0];

interface SharedNoirRuntime {
  program: CompiledProgram;
  vk: Uint8Array;
  totalThreads: number;
  slotThreads: number;
}

interface NoirRuntimeSlot {
  slotId: number;
  noir: Noir;
  backend: UltraHonkBackend;
}

let sharedRuntimePromise: Promise<SharedNoirRuntime> | null = null;
let sharedRuntimeReadyAt: number | null = null;
const slotRuntimePromises: (Promise<NoirRuntimeSlot> | null)[] = Array.from(
  { length: NOIR_PROVING_SLOT_COUNT },
  () => null,
);
const slotRuntimeReadyAt: (number | null)[] = Array.from(
  { length: NOIR_PROVING_SLOT_COUNT },
  () => null,
);

function getBackendThreadsPerSlot(): { totalThreads: number; slotThreads: number } {
  const totalThreads = Math.max(1, os.availableParallelism());
  const slotThreads = Math.max(1, Math.floor(totalThreads / NOIR_PROVING_SLOT_COUNT));
  return { totalThreads, slotThreads };
}

function normalizeSlotId(workerId: number): number {
  return ((workerId % NOIR_PROVING_SLOT_COUNT) + NOIR_PROVING_SLOT_COUNT) % NOIR_PROVING_SLOT_COUNT;
}

async function initSharedNoirRuntime(): Promise<SharedNoirRuntime> {
  const startedAt = Date.now();
  const baseCircuitDir = path.resolve('circuit');
  const { totalThreads, slotThreads } = getBackendThreadsPerSlot();

  logger.info(
    { baseCircuitDir, slotCount: NOIR_PROVING_SLOT_COUNT, totalThreads, slotThreads },
    '[noir runtime] warmup: compiling circuit',
  );

  const compileStartedAt = Date.now();
  await execFileAsync('nargo', ['compile'], { cwd: baseCircuitDir });
  const artifactPath = path.join(baseCircuitDir, 'target', 'circuit.json');
  const program = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as CompiledProgram;
  const compileMs = Date.now() - compileStartedAt;

  const vkBackend = new UltraHonkBackend(program.bytecode, { threads: slotThreads });
  const vkStartedAt = Date.now();

  try {
    const vk = await vkBackend.getVerificationKey(KECCAK_PROOF_OPTIONS);
    const vkMs = Date.now() - vkStartedAt;
    const totalMs = Date.now() - startedAt;

    logger.info(
      {
        compileMs,
        slotCount: NOIR_PROVING_SLOT_COUNT,
        slotThreads,
        totalMs,
        totalThreads,
        vkBytes: vk.length,
        vkMs,
      },
      '[noir runtime] warmup: shared compile + vk ready',
    );

    return { program, vk, totalThreads, slotThreads };
  } finally {
    try {
      await vkBackend.destroy();
    } catch (error) {
      logger.warn({ error }, '[noir runtime] warmup: failed to destroy shared vk backend');
    }
  }
}

export function getSharedNoirRuntime(): Promise<SharedNoirRuntime> {
  sharedRuntimePromise ??= initSharedNoirRuntime()
    .then((runtime) => {
      sharedRuntimeReadyAt = Date.now();
      return runtime;
    })
    .catch((error: unknown) => {
      sharedRuntimePromise = null;
      sharedRuntimeReadyAt = null;
      throw error;
    });

  return sharedRuntimePromise;
}

async function initNoirRuntimeSlot(slotId: number): Promise<NoirRuntimeSlot> {
  const startedAt = Date.now();
  const sharedRuntime = await getSharedNoirRuntime();
  const noir = new Noir(sharedRuntime.program);
  const backend = new UltraHonkBackend(sharedRuntime.program.bytecode, {
    threads: sharedRuntime.slotThreads,
  });

  try {
    await Promise.all([noir.init(), backend.instantiate()]);
    const initMs = Date.now() - startedAt;

    logger.info(
      { initMs, slotId, slotThreads: sharedRuntime.slotThreads },
      '[noir runtime] slot ready',
    );

    return { slotId, noir, backend };
  } catch (error) {
    try {
      await backend.destroy();
    } catch (destroyError) {
      logger.warn(
        { destroyError, slotId },
        '[noir runtime] failed to destroy slot backend after init error',
      );
    }

    throw error;
  }
}

export function getNoirRuntimeSlot(workerId: number): Promise<NoirRuntimeSlot> {
  const slotId = normalizeSlotId(workerId);

  const slotRuntimePromise =
    slotRuntimePromises[slotId] ??=
      initNoirRuntimeSlot(slotId)
    .then((slotRuntime) => {
      slotRuntimeReadyAt[slotId] = Date.now();
      return slotRuntime;
    })
    .catch((error: unknown) => {
      slotRuntimePromises[slotId] = null;
      slotRuntimeReadyAt[slotId] = null;
      throw error;
    });

  return slotRuntimePromise;
}

async function resetNoirRuntimeSlot(workerId: number, reason: string): Promise<void> {
  const slotId = normalizeSlotId(workerId);
  const slotRuntimePromise = slotRuntimePromises[slotId];

  slotRuntimePromises[slotId] = null;
  slotRuntimeReadyAt[slotId] = null;

  if (!slotRuntimePromise) {
    return;
  }

  const slotRuntime = await slotRuntimePromise.catch(() => null);
  if (!slotRuntime) {
    return;
  }

  try {
    await slotRuntime.backend.destroy();
    logger.warn({ reason, slotId }, '[noir runtime] slot reset');
  } catch (error) {
    logger.warn(
      { error, reason, slotId },
      '[noir runtime] slot reset failed during backend destroy',
    );
  }
}

export async function warmupNoirRuntime(): Promise<void> {
  const startedAt = Date.now();

  await getSharedNoirRuntime();
  await Promise.all(
    Array.from({ length: NOIR_PROVING_SLOT_COUNT }, (_, slotId) => getNoirRuntimeSlot(slotId)),
  );

  logger.info(
    { slotCount: NOIR_PROVING_SLOT_COUNT, totalMs: Date.now() - startedAt },
    '[noir runtime] warmup completed',
  );
}

export interface ProofPipelineResult {
  proof: Uint8Array;
  publicInputs: string[];
  vk: Uint8Array;
}

export async function runProofPipeline(
  workerId: number,
  inputs: InputMap,
): Promise<ProofPipelineResult> {
  const slotId = normalizeSlotId(workerId);
  const startedAt = Date.now();
  const path = sharedRuntimeReadyAt !== null && slotRuntimeReadyAt[slotId] !== null ? 'warm' : 'cold';

  const sharedRuntime = await getSharedNoirRuntime();
  const slotRuntime = await getNoirRuntimeSlot(workerId);

  const witnessStartedAt = Date.now();
  let witness: Uint8Array;

  try {
    ({ witness } = await slotRuntime.noir.execute(inputs));
  } catch (error) {
    logger.error(
      { error, slotId, totalMs: Date.now() - startedAt, witnessMs: Date.now() - witnessStartedAt },
      '[noir runtime] witness generation failed',
    );
    throw error;
  }

  const witnessMs = Date.now() - witnessStartedAt;
  const proveStartedAt = Date.now();

  try {
    const { proof, publicInputs } = await slotRuntime.backend.generateProof(
      witness,
      KECCAK_PROOF_OPTIONS,
    );
    const proveMs = Date.now() - proveStartedAt;
    const totalMs = Date.now() - startedAt;

    logger.info(
      {
        path,
        proveMs,
        slotId,
        totalMs,
        vkBytes: sharedRuntime.vk.length,
        witnessMs,
        workerId,
      },
      '[noir runtime] proof completed',
    );

    return { proof, publicInputs, vk: sharedRuntime.vk };
  } catch (error) {
    logger.error(
      {
        error,
        path,
        proveMs: Date.now() - proveStartedAt,
        slotId,
        totalMs: Date.now() - startedAt,
        witnessMs,
        workerId,
      },
      '[noir runtime] backend prove failed',
    );

    await resetNoirRuntimeSlot(workerId, 'generateProof failed');
    throw error;
  }
}
