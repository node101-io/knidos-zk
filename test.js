import { LeanIMT } from "@zk-kit/lean-imt"
import { BarretenbergSync, Fr } from "@aztec/bb.js"

const bb = await BarretenbergSync.initSingleton()

const frToBigInt = (fr) => BigInt(fr.toString())
const hash = (a, b) => frToBigInt(bb.poseidon2Hash([new Fr(a), new Fr(b)]))

const leaves = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]
const tree = new LeanIMT(hash, leaves)

const toHex = (n) => `0x${n.toString(16)}`
const toDec = (n) => n.toString(10)

console.log("Merkle root (dec):", tree.root.toString())
console.log("Merkle root (hex):", toHex(tree.root))

for (let i = 0; i < leaves.length; i++) {
  const proof = tree.generateProof(i)
  console.log(`\nProof for index ${i}:`)
  console.log("- root (dec):", toDec(proof.root))
  console.log("- leaf (dec):", toDec(proof.leaf))
  console.log("- siblings (dec):", proof.siblings.map(toDec))
  console.log("- verifies:", tree.verifyProof(proof))
}
