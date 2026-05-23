export interface PresentedRecord {
  publicSignals: string[];
  txHash: string;
  // A real on-chain tx from a previous circuit version (different vkHash) —
  // the explorer link opens to a genuine settled proof, but the proof
  // verifies against a stale VK so anyone double-checking sees a mismatch.
  // Used by the 'tx' corruption state to swap out txHash without producing
  // a dead link.
  decoyTxHash: string;
}

export type CorruptionState = 'valid' | 'inputs' | 'tx';

export const CORRUPTION_STATES: readonly CorruptionState[] = Object.freeze([
  'valid',
  'inputs',
  'tx',
]);

// What the user answers per record — just a binary verdict.
export type AnswerVerdict = 'valid' | 'invalid';

export const ANSWER_VERDICTS: readonly AnswerVerdict[] = Object.freeze([
  'valid',
  'invalid',
]);

export const RECORD_COUNT = 5;

// Wire types ----------------------------------------------------------------

export interface SubmitRequest {
  message: string;
  signature: string;
  answers: AnswerVerdict[];
}

export interface SubmitResponse {
  passed: boolean;
  score: number;
}

export interface CompletedEntry {
  address: string;
  completed_at: string;
}

export interface CompletedListResponse {
  data: CompletedEntry[];
  next_cursor: string | null;
}
