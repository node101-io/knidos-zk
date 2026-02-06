export function addressStringToBytes42(addr: string): Uint8Array {
  if (!addr.startsWith("0x") || addr.length !== 42) {
    throw new Error("bad_request");
  }
  return new Uint8Array(Buffer.from(addr, "utf8"));
}