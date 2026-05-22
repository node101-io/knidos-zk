import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CIRCUIT_SRC_DIR, NARGO_PATH } from '../lib/constants.js';

interface CompileResult {
  bytecodePath: string;
  elapsedMs: number;
}

// Run `nargo compile` against the bundled Noir source. Output is written to
// circuit/target/circuit.json — same path bb expects.
export async function compileCircuit(): Promise<CompileResult> {
  const start = Date.now();
  await runNargo(['compile']);
  const bytecodePath = path.join(CIRCUIT_SRC_DIR, 'target', 'circuit.json');
  await fs.access(bytecodePath); // throws if missing
  return { bytecodePath, elapsedMs: Date.now() - start };
}

function runNargo(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(NARGO_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: CIRCUIT_SRC_DIR,
    });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`nargo exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}
