function bytes16ToBigIntBE(b16: Uint8Array): bigint {
  let x = 0n;
  for (const byte of b16) x = (x << 8n) + BigInt(byte);
  return x;
}

export function bytes32ToField2DecStrings(bytes32: Uint8Array): [string, string] {
  if (bytes32.length !== 32) throw new Error('expected 32 bytes');
  const hi = bytes16ToBigIntBE(bytes32.slice(0, 16));
  const lo = bytes16ToBigIntBE(bytes32.slice(16, 32));
  return [hi.toString(10), lo.toString(10)];
}
