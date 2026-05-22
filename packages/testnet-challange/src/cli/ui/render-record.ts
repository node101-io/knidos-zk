import type { PresentedRecord } from '../../types.js';

import { TX_EXPLORER_BASE } from '../lib/constants.js';

function shortHex(hex: string, head = 14, tail = 6): string {
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function decodeFieldU64(hex: string): bigint | null {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(body) || body.length === 0) return null;
  try {
    return BigInt('0x' + body.slice(-16));
  } catch {
    return null;
  }
}

function formatTimestamp(ms: bigint | null): string {
  if (ms === null) return '<could not decode>';
  const n = Number(ms);
  if (!Number.isFinite(n)) return `<bigint ${ms.toString()}>`;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? `<invalid: ${ms.toString()}>` : d.toISOString();
}

export interface RenderInput {
  index: number;
  total: number;
  record: PresentedRecord;
  compiledVkHash: string;
}

export function renderRecord({ index, total, record, compiledVkHash }: RenderInput): string {
  const lines: string[] = [];
  lines.push(`─── Record ${index + 1}/${total} ─────────────────────────────────────────`);
  lines.push('');
  lines.push(`  Settlement tx:  ${TX_EXPLORER_BASE}/${record.txHash}`);
  lines.push('');
  lines.push('  Public inputs (committed in the proof):');
  if (record.publicSignals.length === 4) {
    const [fc0, fc1, rawStart, rawEnd] = record.publicSignals as [string, string, string, string];
    const start = decodeFieldU64(rawStart);
    const end = decodeFieldU64(rawEnd);
    lines.push(`    fillsCommitment[0]: ${shortHex(fc0)}`);
    lines.push(`    fillsCommitment[1]: ${shortHex(fc1)}`);
    lines.push(`    startTime:          ${start === null ? rawStart : start.toString()}  →  ${formatTimestamp(start)}`);
    lines.push(`    endTime:            ${end === null ? rawEnd : end.toString()}  →  ${formatTimestamp(end)}`);
  } else {
    record.publicSignals.forEach((s, i) => {
      lines.push(`    [${i}]: ${shortHex(s)}`);
    });
  }
  lines.push('');
  lines.push(`  Verification key hash (compiled from circuit): ${compiledVkHash}`);
  return lines.join('\n');
}
