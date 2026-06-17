export interface PresentedRecord {
  publicSignals: string[];
  txHash: string;
  // A real on-chain tx from a previous circuit version (different vkHash) —
  // the explorer link opens to a genuine settled proof, but the proof
  // verifies against a stale VK so anyone double-checking sees a mismatch.
  // Used by the 'tx' corruption state to swap out txHash without producing
  // a dead link.
  decoyTxHash: string;
  // The on-chain publicSignals committed by `decoyTxHash`. Swapped in
  // alongside `decoyTxHash` so the displayed inputs match what the explorer
  // shows — the only mismatch the user should see is the stale VK.
  decoyPublicSignals: string[];
  // A real on-chain tx with the *same* current vkHash, but settled
  // (createdAt) before this record's startTime — i.e. a proof that was
  // committed before the data window it claims to cover even existed.
  // Used by the 'time' corruption state.
  decoyTimeTxHash: string;
}

export type CorruptionState = 'valid' | 'inputs' | 'tx' | 'time';

export const CORRUPTION_STATES: readonly CorruptionState[] = Object.freeze([
  'valid',
  'inputs',
  'tx',
  'time',
]);

// What the user answers per record — just a binary verdict.
export type AnswerVerdict = 'valid' | 'invalid';

export const ANSWER_VERDICTS: readonly AnswerVerdict[] = Object.freeze([
  'valid',
  'invalid',
]);

export const RECORD_COUNT = 5;

// Minimum correct answers for a submission to be recorded — one is enough.
// Knidos hasn't settled on a qualifying threshold yet, so we deliberately
// avoid a "pass" bar here: we store every result with at least one correct
// answer and leave any cut-off decision to whoever reads the leaderboard.
export const RECORD_THRESHOLD = 1;

// Wire types ----------------------------------------------------------------

export interface SubmitRequest {
  message: string;
  signature: string;
  answers: AnswerVerdict[];
}

export interface SubmitResponse {
  score: number;
}

export interface CompletedEntry {
  address: string;
  completed_at: string;
  score: number;
}

export interface CompletedListResponse {
  data: CompletedEntry[];
  next_cursor: string | null;
}
