import { execFile } from 'child_process';
import { constants as fsConstants, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { Noir, type InputMap } from '@noir-lang/noir_js';

import { env } from '../../env.js';
import logger from '../../shared/logger.js';

const execFileAsync = promisify(execFile);

type CompiledProgram = ConstructorParameters<typeof Noir>[0];

interface SharedNoirRuntime {
  program: CompiledProgram;
  artifactPath: string;
  vk: Uint8Array;
  numPublicInputs: number;
}

interface NoirRuntimeSlot {
  slotId: number;
  noir: Noir;
}

let sharedRuntimePromise: Promise<SharedNoirRuntime> | null = null;
let sharedRuntimeReadyAt: number | null = null;
const slotRuntimePromises: (Promise<NoirRuntimeSlot> | null)[] = Array.from(
  { length: env.NOIR_PROVING_SLOT_COUNT },
  () => null,
);
const slotRuntimeReadyAt: (number | null)[] = Array.from(
  { length: env.NOIR_PROVING_SLOT_COUNT },
  () => null,
);

function getParallelismMetadata(): { totalThreads: number; slotConcurrencyHint: number } {
  const totalThreads = Math.max(1, os.availableParallelism());
  const slotConcurrencyHint = Math.max(1, Math.floor(totalThreads / env.NOIR_PROVING_SLOT_COUNT));
  return { totalThreads, slotConcurrencyHint };
}

function normalizeSlotId(workerId: number): number {
  return ((workerId % env.NOIR_PROVING_SLOT_COUNT) + env.NOIR_PROVING_SLOT_COUNT) % env.NOIR_PROVING_SLOT_COUNT;
}

async function ensureExecutable(filePath: string): Promise<void> {
  try {
    await fs.access(filePath, fsConstants.X_OK);
  } catch (error) {
    throw new Error(`[noir runtime] bb binary is missing or not executable at "${filePath}"`, {
      cause: error,
    });
  }
}

function formatExecFileError(command: string, args: string[], error: unknown): Error {
  if (error instanceof Error) {
    const commandString = [command, ...args].join(' ');
    const execError = error as Error & {
      code?: number | string;
      stderr?: string;
      stdout?: string;
    };
    const stderr = execError.stderr?.trim();
    const stdout = execError.stdout?.trim();
    const details = [
      `[noir runtime] command failed: ${commandString}`,
      execError.code !== undefined ? `exit_code=${String(execError.code)}` : undefined,
      stderr ? `stderr=${stderr}` : undefined,
      stdout ? `stdout=${stdout}` : undefined,
    ]
      .filter((value): value is string => value !== undefined)
      .join(' | ');

    return new Error(details, { cause: error });
  }

  return new Error(`[noir runtime] command failed: ${command} ${args.join(' ')}`, { cause: error });
}

async function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, options);
    return {
      stdout: String(result.stdout),
      stderr: String(result.stderr),
    };
  } catch (error) {
    throw formatExecFileError(command, args, error);
  }
}

async function readJsonStringArray(filePath: string, label: string): Promise<string[]> {
  const rawValue = await fs.readFile(filePath, 'utf8');
  const parsedValue = JSON.parse(rawValue) as unknown;

  if (!Array.isArray(parsedValue) || !parsedValue.every((value) => typeof value === 'string')) {
    throw new Error(`[noir runtime] invalid ${label}: expected a JSON string array`);
  }

  return parsedValue;
}

function parseFieldString(value: string, label: string): bigint {
  if (value.startsWith('0x') || value.startsWith('0X')) {
    return BigInt(value);
  }

  try {
    return BigInt(value);
  } catch (error) {
    throw new Error(`[noir runtime] invalid ${label}: "${value}"`, { cause: error });
  }
}

function parseNumPublicInputs(vkFields: string[]): number {
  const rawValue = vkFields[1];
  if (rawValue === undefined) {
    throw new Error('[noir runtime] invalid vk_fields.json: missing num public inputs entry');
  }

  const value = parseFieldString(rawValue, 'vk public input count');
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `[noir runtime] invalid public input count parsed from vk_fields.json: ${value}`,
    );
  }

  return parsedValue;
}

async function cleanupDirectory(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
}

async function initSharedNoirRuntime(): Promise<SharedNoirRuntime> {
  const startedAt = Date.now();
  const baseCircuitDir = path.resolve('circuit');
  const { totalThreads, slotConcurrencyHint } = getParallelismMetadata();

  await ensureExecutable(env.BB_PATH);

  logger.info(
    {
      baseCircuitDir,
      bbPath: env.BB_PATH,
      slotConcurrencyHint,
      slotCount: env.NOIR_PROVING_SLOT_COUNT,
      totalThreads,
    },
    '[noir runtime] warmup: compiling circuit',
  );

  const compileStartedAt = Date.now();
  await runCommand('nargo', ['compile', '--skip-brillig-constraints-check'], {
    cwd: baseCircuitDir,
  });
  const artifactPath = path.join(baseCircuitDir, 'target', 'circuit.json');
  const program = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as CompiledProgram;
  const compileMs = Date.now() - compileStartedAt;

  const vkDir = path.join(baseCircuitDir, 'target');
  const vkPath = path.join(vkDir, 'vk');
  const vkFieldsPath = path.join(vkDir, 'vk_fields.json');
  const vkStartedAt = Date.now();
  // Reuse cached VK unless circuit.json was recompiled (newer mtime)
  const [artifactStat, vkStat] = await Promise.all([
    fs.stat(artifactPath).catch(() => null),
    fs.stat(vkPath).catch(() => null),
  ]);
  const vkCached =
    vkStat !== null && artifactStat !== null && vkStat.mtimeMs >= artifactStat.mtimeMs;

  if (vkCached) {
    logger.info('[noir runtime] warmup: vk cached, skipping write_vk');
  } else {
    await runCommand(env.BB_PATH, [
      'write_vk',
      '-s',
      'ultra_honk',
      '-b',
      artifactPath,
      '--oracle_hash',
      'keccak',
      '--output_format',
      'bytes_and_fields',
      '-o',
      vkDir,
    ]);
  }

  const [vk, vkFields] = await Promise.all([
    fs.readFile(vkPath),
    readJsonStringArray(vkFieldsPath, 'vk fields'),
  ]);
  const numPublicInputs = parseNumPublicInputs(vkFields);
  const vkMs = Date.now() - vkStartedAt;
  const totalMs = Date.now() - startedAt;

  logger.info(
    {
      bbPath: env.BB_PATH,
      compileMs,
      numPublicInputs,
      slotConcurrencyHint,
      slotCount: env.NOIR_PROVING_SLOT_COUNT,
      totalMs,
      totalThreads,
      vkBytes: vk.length,
      vkCached,
      vkMs,
    },
    '[noir runtime] warmup: shared compile + vk ready',
  );

  return {
    program,
    artifactPath,
    vk: new Uint8Array(vk),
    numPublicInputs,
  };
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

  await noir.init();
  const initMs = Date.now() - startedAt;

  logger.info({ initMs, slotId }, '[noir runtime] slot ready');

  return { slotId, noir };
}

export function getNoirRuntimeSlot(workerId: number): Promise<NoirRuntimeSlot> {
  const slotId = normalizeSlotId(workerId);

  const slotRuntimePromise = (slotRuntimePromises[slotId] ??= initNoirRuntimeSlot(slotId)
    .then((slotRuntime) => {
      slotRuntimeReadyAt[slotId] = Date.now();
      return slotRuntime;
    })
    .catch((error: unknown) => {
      slotRuntimePromises[slotId] = null;
      slotRuntimeReadyAt[slotId] = null;
      throw error;
    }));

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

  await slotRuntimePromise.catch(() => null);
  logger.warn({ reason, slotId }, '[noir runtime] slot reset');
}

export async function warmupNoirRuntime(): Promise<void> {
  const startedAt = Date.now();

  await getSharedNoirRuntime();
  await Promise.all(
    Array.from({ length: env.NOIR_PROVING_SLOT_COUNT }, (_, slotId) => getNoirRuntimeSlot(slotId)),
  );

  logger.info(
    { slotCount: env.NOIR_PROVING_SLOT_COUNT, totalMs: Date.now() - startedAt },
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
  const pathType =
    sharedRuntimeReadyAt !== null && slotRuntimeReadyAt[slotId] !== null ? 'warm' : 'cold';

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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-prove-'));

  try {
    const witnessPath = path.join(tmpDir, 'witness.gz');
    await fs.writeFile(witnessPath, witness);

    await runCommand(env.BB_PATH, [
      'prove',
      '-s',
      'ultra_honk',
      '-b',
      sharedRuntime.artifactPath,
      '-w',
      witnessPath,
      '--oracle_hash',
      'keccak',
      '--output_format',
      'bytes_and_fields',
      '-o',
      tmpDir,
    ]);

    const [proof, publicInputs] = await Promise.all([
      fs.readFile(path.join(tmpDir, 'proof')),
      readJsonStringArray(path.join(tmpDir, 'public_inputs_fields.json'), 'public inputs fields'),
    ]);

    if (proof.length === 0) {
      throw new Error('[noir runtime] generated proof is empty');
    }

    if (publicInputs.length === 0) {
      throw new Error('[noir runtime] generated public input list is empty');
    }

    if (publicInputs.length !== sharedRuntime.numPublicInputs) {
      throw new Error(
        `[noir runtime] generated public input count mismatch: expected ${sharedRuntime.numPublicInputs}, got ${publicInputs.length}`,
      );
    }

    const proveMs = Date.now() - proveStartedAt;
    const totalMs = Date.now() - startedAt;

    logger.info(
      {
        path: pathType,
        proveMs,
        publicInputCount: publicInputs.length,
        slotId,
        totalMs,
        vkBytes: sharedRuntime.vk.length,
        witnessMs,
        workerId,
      },
      '[noir runtime] proof completed',
    );

    return {
      proof: new Uint8Array(proof),
      publicInputs,
      vk: sharedRuntime.vk,
    };
  } catch (error) {
    logger.error(
      {
        error,
        path: pathType,
        proveMs: Date.now() - proveStartedAt,
        slotId,
        totalMs: Date.now() - startedAt,
        witnessMs,
        workerId,
      },
      '[noir runtime] native bb prove failed',
    );

    await resetNoirRuntimeSlot(workerId, 'bb prove failed');
    throw error;
  } finally {
    await cleanupDirectory(tmpDir);
  }
}
