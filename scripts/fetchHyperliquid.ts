import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

type UserFill = {
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

type NormalizedFill = {
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

function requireEnv(name: string): string {
  const envVariable = process.env[name];
  if (!envVariable) throw new Error("document_not_found");
  return envVariable;
}

function normalizeFill(x: UserFill): NormalizedFill {
  return {
    coin: x.coin,
    px: x.px,
    sz: x.sz,
    side: x.side,
    time: x.time,
    hash: x.hash,
    oid: x.oid,
    tid: x.tid,
    fee: x.fee ?? "0.0",
    feeToken: x.feeToken ?? "",
    dir: x.dir ?? "",
    closedPnl: x.closedPnl ?? "0.0",
  };
}

// Deterministic sorting
function stableSort(fills: NormalizedFill[]): NormalizedFill[] {
  return fills.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    if (a.tid !== b.tid) return a.tid - b.tid;
    // final tie-breaker
    return a.oid - b.oid;
  });
}

async function main() {
  const apiUrl = process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info";
  const user = requireEnv("USER_ADDRESS");
  const outDir = process.env.OUTPUT_DIR ?? "proofs";

  const body = {
    type: "userFills",
    user
  };

  const res = await axios.post(apiUrl, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
  });

  if (!Array.isArray(res.data)) {
    throw new Error("bad_request");
  }

  const raw: UserFill[] = res.data;

  fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, "hyperliquid_userfills_raw.json");
  fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2), "utf-8");

  const normalized = stableSort(raw.map(normalizeFill));

  const normPath = path.join(outDir, "hyperliquid_userfills_normalized.json");
  fs.writeFileSync(normPath, JSON.stringify(normalized, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
