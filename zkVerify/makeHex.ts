import fs from 'fs';
import path from 'path';

function bufferTo0xHex(buf: Buffer): string {
  return `0x${buf.toString('hex')}`;
}

function chunkToBytes32HexList(buf: Buffer): string[] {
  if (buf.length % 32 !== 0) {
    throw new Error(`public_inputs length ${buf.length} is not multiple of 32`);
  }
  const out: string[] = [];
  for (let i = 0; i < buf.length; i += 32) {
    out.push(bufferTo0xHex(buf.subarray(i, i + 32)));
  }
  return out;
}

function main() {
  const ROOT = process.cwd();
  const target = path.resolve(ROOT, 'circuit', 'target');

  // Your current layout (from screenshot)
  const vkBin = path.resolve(target, 'vk');
  const proofBin = path.resolve(target, 'proof');
  const pubsBin = path.resolve(target, 'public_inputs');

  if (!fs.existsSync(vkBin)) throw new Error(`Missing: ${vkBin}`);
  if (!fs.existsSync(proofBin)) throw new Error(`Missing: ${proofBin}`);
  if (!fs.existsSync(pubsBin)) throw new Error(`Missing: ${pubsBin}`);

  const vkRaw = fs.readFileSync(vkBin);
  const proofRaw = fs.readFileSync(proofBin);
  const pubsRaw = fs.readFileSync(pubsBin);

  console.log('vk bytes:', vkRaw.length);
  console.log('proof bytes:', proofRaw.length);
  console.log('pubs bytes:', pubsRaw.length, '=> count', pubsRaw.length / 32);

  const vkHex = bufferTo0xHex(vkRaw);
  const proofHex = bufferTo0xHex(proofRaw);
  const pubsList = chunkToBytes32HexList(pubsRaw);

  fs.writeFileSync(path.resolve(target, 'zkv_vk.hex'), vkHex + '\n');
  fs.writeFileSync(path.resolve(target, 'zkv_proof.hex'), JSON.stringify({ ZK: proofHex }) + '\n');
  fs.writeFileSync(path.resolve(target, 'zkv_pubs.hex'), JSON.stringify(pubsList) + '\n');

  console.log('Wrote:');
  console.log(' - circuit/target/zkv_vk.hex');
  console.log(' - circuit/target/zkv_proof.hex');
  console.log(' - circuit/target/zkv_pubs.hex');
}

main();
