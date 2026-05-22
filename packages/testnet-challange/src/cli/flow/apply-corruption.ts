import { createHash } from 'node:crypto';

import type { CorruptionState, PresentedRecord } from '../../types.js';

// Deterministic decoy txhash: hash the real txhash, hex-encode 32 bytes,
// prepend 0x. Looks real but points to a tx that doesn't exist.
function decoyTxHash(real: string): string {
  const h = createHash('sha256').update(real).digest('hex');
  return `0x${h}`;
}

export function applyCorruption(
  records: PresentedRecord[],
  mask: CorruptionState[],
): PresentedRecord[] {
  return records.map((r, i) => {
    const state = mask[i] ?? 'valid';
    switch (state) {
      case 'valid':
        return { ...r };
      case 'inputs': {
        const ps = [...r.publicSignals];
        if (ps.length >= 4) {
          const tmp = ps[2] as string;
          ps[2] = ps[3] as string;
          ps[3] = tmp;
        }
        return { ...r, publicSignals: ps };
      }
      case 'tx':
        return { ...r, txHash: decoyTxHash(r.txHash) };
    }
  });
}
