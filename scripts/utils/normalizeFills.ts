import type {
  UserFill,
  NormalizedFill
} from "../types.ts";

export function normalizeFill(fill: UserFill): NormalizedFill {
  if (fill.coin === undefined || fill.px === undefined || fill.sz === undefined || fill.side === undefined || fill.time === undefined || fill.hash === undefined || fill.oid === undefined ||fill.tid === undefined)
    throw new Error("invalid_user_fill")
  return {
    coin: fill.coin,
    px: fill.px,
    sz: fill.sz,
    side: fill.side,
    time: fill.time,
    hash: fill.hash,
    oid: fill.oid,
    tid: fill.tid,
    fee: fill.fee ?? "0.0",
    feeToken: fill.feeToken ?? "",
    dir: fill.dir ?? "",
    closedPnl: fill.closedPnl ?? "0.0",
  };
}