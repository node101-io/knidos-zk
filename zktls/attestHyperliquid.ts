import { PrimusNetwork } from "@primuslabs/network-core-sdk";
import { ethers } from "ethers";

import { requireEnv } from "../scripts/utils/requireEnv.js";

import type { VerifiedHyperliquidAttestation } from "../scripts/types.js"

export async function attestHyperliquidUserFills(primus: PrimusNetwork, CHAIN_ID: number): Promise<VerifiedHyperliquidAttestation> {
  // const PRIMUS_PRIVATE_KEY = requireEnv("PRIMUS_PRIVATE_KEY");
  const PRIMUS_USER_ADDRESS = requireEnv("PRIMUS_USER_ADDRESS");
  const HYPERLIQUID_USER_ADDRESS = requireEnv("HYPERLIQUID_USER_ADDRESS");
  const HYPERLIQUID_API_URL = requireEnv("HYPERLIQUID_API_URL");

  const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  // const wallet = new ethers.Wallet(PRIMUS_PRIVATE_KEY, provider);

  // const primus = new PrimusNetwork();
  // await primus.init(wallet, CHAIN_ID);

  const requests = [
    {
      url: HYPERLIQUID_API_URL,
      method: "POST",
      header: {
        "Content-Type": "application/json",
      },
      body: {
        type: "userFills",
        user: HYPERLIQUID_USER_ADDRESS,
      },
    },
  ];

  const responseResolves = [
    [
      {
        keyName: "fills_commitment",
        parseType: "json",
        parsePath: "$",
        op: "SHA256",
      },
      {
        keyName: "user_commitment",
        parseType: "json",
        parsePath: "^.user",
        op: "SHA256_WITH_SALT",
      },
    ],
  ];

  const submitTaskResult = await primus.submitTask({
    address: PRIMUS_USER_ADDRESS,
  });

  const {
    taskId,
    taskTxHash,
    taskAttestors,
  } = submitTaskResult as {
    taskId: string;
    taskTxHash: string;
    taskAttestors: string[];
  }
  const attestResult = await primus.attest({
    address: PRIMUS_USER_ADDRESS,
    taskId,
    taskTxHash,
    taskAttestors,
    requests,
    responseResolves,
    extendedParams: JSON.stringify({ attUrlOptimization: true }),
    getAllJsonResponse: "true",
    attMode: {
      algorithmType: "proxytls",
      resultType: "plain",
    },
  });

  const firstAttestResult = attestResult[0];
  if (!firstAttestResult?.reportTxHash) {
    throw new Error("attestation_report_missing");
  }
  const reportTxHash = firstAttestResult.reportTxHash;

  const verifiedResultraw = await primus.verifyAndPollTaskResult({
    taskId,
    reportTxHash,
  });

  const verified = verifiedResultraw[0];
  if (!verified) {
    throw new Error("verified_result_missing");
  }

  const attestation = verified.attestation;
  if (!attestation || typeof attestation.data !== "string") {
    throw new Error("invalid_attestation_payload");
  }

  const attData = JSON.parse(attestation.data) as Record<string, unknown>;
  const addressCommitment = attData["user_commitment"];
  const fillsCommitment = attData["SHA256($)"];

  if (typeof addressCommitment !== "string" || typeof fillsCommitment !== "string") {
    throw new Error("invalid_attestation_commitments");
  }

  const verifiedHyperliquidAttestationResult = {
    taskId,
    reportTxHash,
    attestor: verified.attestor,
    recipient: attestation.recipient,
    chainId: CHAIN_ID,

    addressCommitment,
    fillsCommitment,

    verifiedResult: JSON.stringify(verifiedResultraw, null),
  }

  return verifiedHyperliquidAttestationResult;
}
