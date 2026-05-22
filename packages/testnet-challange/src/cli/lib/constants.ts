import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// NODE_ENV switches between dev (localhost backend) and prod (deployed
// backend). The container sets NODE_ENV=production, so `docker run` with
// no flags hits the prod URL.
const PROD_API_URL = 'https://knidos.node101.io/challange';
const DEV_API_URL = 'http://localhost:3000';

export const API_URL =
  process.env.NODE_ENV === 'production' ? PROD_API_URL : DEV_API_URL;

export const TX_EXPLORER_BASE = 'https://zkverify.subscan.io/extrinsic';

// Binaries: in the container they live in /usr/local/bin; on a dev machine
// `bbup` / `noirup` install them under ~/.bb and ~/.nargo respectively.
function detectBinaryPath(containerPath: string, devPath: string): string {
  if (existsSync(containerPath)) return containerPath;
  if (existsSync(devPath)) return devPath;
  return containerPath;
}

export const BB_PATH = detectBinaryPath(
  '/usr/local/bin/bb',
  path.join(os.homedir(), '.bb', 'bb'),
);

export const NARGO_PATH = detectBinaryPath(
  '/usr/local/bin/nargo',
  path.join(os.homedir(), '.nargo', 'bin', 'nargo'),
);

// Noir source directory (contains Nargo.toml). In the container we copy it
// to /app/circuit/. In dev it lives at <repo>/circuit/.
function detectCircuitSrcDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = ['/app/circuit'];
  for (let depth = 1; depth <= 6; depth++) {
    candidates.push(path.normalize(path.join(here, '../'.repeat(depth), 'circuit')));
  }
  for (const p of candidates) {
    if (existsSync(path.join(p, 'Nargo.toml'))) return p;
  }
  return candidates[0] as string;
}

export const CIRCUIT_SRC_DIR = detectCircuitSrcDir();
