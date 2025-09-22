import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BarretenbergSync, Fr } from "@aztec/bb.js";
import pkg from 'js-sha3';
const { keccak_256 } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toDec(n) {
  return n.toString(10);
}

// BN254 scalar field modulus used by Noir Field
const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function toBytes32BE(value) {
  let v = BigInt(value);
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concatBytes(a, b) {
  return Buffer.concat([a, b]);
}

function keccak256Buf(bytes) {
  const hasher = keccak_256.create();
  hasher.update(bytes);
  const ab = hasher.arrayBuffer();
  return Buffer.from(ab);
}

function bytesToFieldBE(buf) {
  let res = 0n;
  for (const byte of buf) {
    res = (res * 256n + BigInt(byte)) % FR_MODULUS;
  }
  return res;
}

async function main() {
  const bb = await BarretenbergSync.initSingleton();

  const hasher = (a, b) => {
    const res = bb.poseidon2Hash([new Fr(a), new Fr(b)]);
    return BigInt(res.toString());
  };

  const hashTxData = (data) => {
    const left = keccak256Buf(
      concatBytes(toBytes32BE(data.chain_id), toBytes32BE(data.sender))
    );
    const right1 = keccak256Buf(
      concatBytes(toBytes32BE(data.time), toBytes32BE(data.amount))
    );
    const right = keccak256Buf(
      concatBytes(right1, toBytes32BE(data.token_id))
    );
    const finalHash = keccak256Buf(concatBytes(left, right));
    return bytesToFieldBE(finalHash);
  };

  // Sample dataset aligned with the Noir #[test]
  const txDatas = Array.from({ length: 8 }, (_, i) => ({
    chain_id: 1n,
    sender: BigInt(11 + i),
    time: BigInt(1000 + i),
    amount: BigInt(i),
    token_id: 100n,
  }));

  const allowedTokens = [100n, 200n, 300n];

  const leaves = txDatas.map(hashTxData);

  // Build levels
  const level1 = [
    hasher(leaves[0], leaves[1]),
    hasher(leaves[2], leaves[3]),
    hasher(leaves[4], leaves[5]),
    hasher(leaves[6], leaves[7]),
  ];
  const level2 = [
    hasher(level1[0], level1[1]),
    hasher(level1[2], level1[3]),
  ];
  const root = hasher(level2[0], level2[1]);

  // Siblings for each index (height 3 tree)
  const siblings = [
    [leaves[1], level1[1], level2[1]], // 0
    [leaves[0], level1[1], level2[1]], // 1
    [leaves[3], level1[0], level2[1]], // 2
    [leaves[2], level1[0], level2[1]], // 3
    [leaves[5], level1[3], level2[0]], // 4
    [leaves[4], level1[3], level2[0]], // 5
    [leaves[7], level1[2], level2[0]], // 6
    [leaves[6], level1[2], level2[0]], // 7
  ];

  // Build TOML content
  let toml = "";
  toml += `# public inputs\n`;
  toml += `merkle_root = "${toDec(root)}"\n\n`;
  toml += `allowed_tokens = [\n`;
  toml += `  "${toDec(allowedTokens[0])}",\n`;
  toml += `  "${toDec(allowedTokens[1])}",\n`;
  toml += `  "${toDec(allowedTokens[2])}",\n`;
  toml += `]\n\n`;
  toml += `# private inputs\n`;
  for (let i = 0; i < 8; i++) {
    const d = txDatas[i];
    const leaf = leaves[i];
    const sibs = siblings[i];
    toml += `[[txs]]\n`;
    toml += `[txs.tx_data]\n`;
    toml += `chain_id = "${toDec(d.chain_id)}"\n`;
    toml += `sender = "${toDec(d.sender)}"\n`;
    toml += `time = "${toDec(d.time)}"\n`;
    toml += `amount = "${toDec(d.amount)}"\n`;
    toml += `token_id = "${toDec(d.token_id)}"\n`;
    toml += `[txs.merkle_witness]\n`;
    toml += `leaf = "${toDec(leaf)}"\n`;
    toml += `index = "${i}"\n`;
    toml += `siblings = [\n`;
    toml += `  "${toDec(sibs[0])}",\n`;
    toml += `  "${toDec(sibs[1])}",\n`;
    toml += `  "${toDec(sibs[2])}",\n`;
    toml += `]\n\n`;
  }

  const outPath = path.resolve(__dirname, "../Prover.toml");
  fs.writeFileSync(outPath, toml);
  console.log("Wrote Prover.toml to", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


