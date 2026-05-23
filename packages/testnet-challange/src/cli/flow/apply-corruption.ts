import type { CorruptionState, PresentedRecord } from '../../types.js';

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
        // Swap in a real tx from a previous circuit version — the explorer
        // link still works, but the on-chain VkOrHash points at a stale VK
        // that doesn't match what the user just derived.
        return { ...r, txHash: r.decoyTxHash };
    }
  });
}
