export type RawFills =  Uint8Array;

export interface VerifiedHyperliquidAttestation {
  taskId: string;
  reportTxHash: string;
  attestor: string;
  recipient: string;
  chainId: number;

  addressCommitment: string; // user_commitment
  fillsCommitment: string;   // SHA256($)

  // Raw verified result, right now it is optional
  // TODO: Check this is usefull or not
  verifiedResult: unknown;
}

export interface UserFill {
  coin: string;
  px: string;
  sz: string;
  side: string; // "A" | "B"
  time: number;
  startPosition?: string;
  dir?: string;
  closedPnl?: string;
  hash: string;
  oid: number;
  tid: number;
  crossed?: boolean;
  fee?: string;
  feeToken?: string;
  twapId?: number | null;
};

export interface NormalizedFill  {
  coin: string;
  px: string;   //  Executed price
  sz: string;   //  Executed size/amount
  side: string; //  Buy/Sell side of the fill
  time: number;
  hash: string; //  transaction hash
  oid: number;  //  Order ID
  tid: number;  //  Trade ID
  fee: string;
  feeToken: string;
  dir: string;  //  Direction / action type
  closedPnl: string;  //  Realized profit/loss from closing part of a position on this fill.
};

export interface CallbackFills {
  (err: string | null, fills?: RawFills): void;
};