import { createHash } from "crypto";

export function sha256Raw(buffer: Buffer | Uint8Array): string {
  return createHash("sha256")
    .update(buffer)
    .digest("hex");
}
