import { PrimusNetwork } from "@primuslabs/network-core-sdk";
import type { HyperliquidWitness } from "../../scripts/types.ts";

export function getHyperliquidWitness( primus: PrimusNetwork, taskId: string, hyperliquidUserAddress: string): HyperliquidWitness {
  const salt = primus.getPrivateData(taskId, "user_commitment");

  if (typeof salt !== "string") {
    throw new Error("bad_request");
  }

  return {
    userAddress: hyperliquidUserAddress,
    salt,
  };
}