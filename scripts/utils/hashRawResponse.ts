import { createHash } from "crypto";
import type { RawFills } from "../types.ts";

export function sha256Raw(rawResponse: RawFills): string {
  return createHash("sha256")
    .update(rawResponse)
    .digest("hex");
}
