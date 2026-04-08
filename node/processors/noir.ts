import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { NoirJobData } from '../shared/types.js';

const execFileAsync = promisify(execFile);

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

interface NoirProcessorResult {
  noirCircuitDir: string;
  proverTomlPath: string;
  targetDir: string;
  vkPath: string;
  proofPath: string;
  publicInputsPath: string;
  compileStdout: string;
  compileStderr: string;
  executeStdout: string;
  executeStderr: string;
  writeVkStdout: string;
  writeVkStderr: string;
  proveStdout: string;
  proveStderr: string;
}

export async function runNoirProcessor(input: NoirJobData['input']): Promise<NoirProcessorResult> {
  const baseCircuitDir = path.resolve('circuit');
  const noirCircuitDir = path.resolve(input.noirCircuitDir);

  const baseNargoTomlPath = path.join(baseCircuitDir, 'Nargo.toml');
  const baseSrcDir = path.join(baseCircuitDir, 'src');

  const targetNargoTomlPath = path.join(noirCircuitDir, 'Nargo.toml');
  const targetSrcDir = path.join(noirCircuitDir, 'src');
  const proverTomlPath = path.join(noirCircuitDir, 'Prover.toml');
  const targetDir = path.join(noirCircuitDir, 'target');

  await ensureDir(noirCircuitDir);

  await fs.copyFile(baseNargoTomlPath, targetNargoTomlPath);
  await copyDirectory(baseSrcDir, targetSrcDir);
  await fs.writeFile(proverTomlPath, input.circuitInput, 'utf8');

  const compileResult = await execFileAsync('nargo', ['compile'], { cwd: noirCircuitDir });

  const executeResult = await execFileAsync(
    'nargo',
    ['execute', '--skip-brillig-constraints-check'],
    { cwd: noirCircuitDir },
  );
  const writeVkResult = await execFileAsync(
    'bb',
    [
      'write_vk',
      '-s',
      'ultra_honk',
      '-b',
      './target/circuit.json',
      '-o',
      './target',
      '--oracle_hash',
      'keccak',
    ],
    { cwd: noirCircuitDir },
  );

  const proveResult = await execFileAsync(
    'bb',
    [
      'prove',
      '-s',
      'ultra_honk',
      '-b',
      './target/circuit.json',
      '-w',
      './target/circuit.gz',
      '-o',
      './target',
      '--oracle_hash',
      'keccak',
    ],
    { cwd: noirCircuitDir },
  );

  return {
    noirCircuitDir,
    proverTomlPath,
    targetDir,
    vkPath: path.join(targetDir, 'vk'),
    proofPath: path.join(targetDir, 'proof'),
    publicInputsPath: path.join(targetDir, 'public_inputs'),
    compileStdout: compileResult.stdout,
    compileStderr: compileResult.stderr,
    executeStdout: executeResult.stdout,
    executeStderr: executeResult.stderr,
    writeVkStdout: writeVkResult.stdout,
    writeVkStderr: writeVkResult.stderr,
    proveStdout: proveResult.stdout,
    proveStderr: proveResult.stderr,
  };
}
