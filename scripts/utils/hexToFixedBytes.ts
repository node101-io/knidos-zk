export function hexToFixedBytes(hex: string, expectedLen: number): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (clean.length !== expectedLen * 2) {
    throw new Error("bad_request");
  }

  return new Uint8Array(Buffer.from(clean, "hex"));
}