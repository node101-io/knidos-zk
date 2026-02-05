import { createHash } from "crypto";

export function sha256WithSalt(userAddress: string, saltHex: string): string {
  const userBytes = Buffer.from(userAddress, "utf8");

  const saltBytes = Buffer.from(
    saltHex.replace(/^0x/, ""),
    "hex"
  );

  return createHash("sha256")
    .update(Buffer.concat([userBytes, saltBytes]))
    .digest("hex");
}
