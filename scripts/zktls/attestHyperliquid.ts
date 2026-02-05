import { PrimusNetwork } from "@primuslabs/network-core-sdk";
import { ethers } from "ethers";

import { requireEnv } from "../utils/requireEnv.ts";

import type { VerifiedHyperliquidAttestation } from "../types.ts"

export async function attestHyperliquidUserFills(): Promise<VerifiedHyperliquidAttestation> {
  const PRIMUS_PRIVATE_KEY = requireEnv("PRIMUS_PRIVATE_KEY");
  const PRIMUS_USER_ADDRESS = requireEnv("PRIMUS_USER_ADDRESS");
  const HYPERLIQUID_USER_ADDRESS = requireEnv("HYPERLIQUID_USER_ADDRESS");
  const HYPERLIQUID_API_URL = requireEnv("HYPERLIQUID_API_URL");

  const CHAIN_ID = Number(process.env.CHAIN_ID ?? "84532");
  const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIMUS_PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, CHAIN_ID);

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

  const reportTxHash = attestResult[0].reportTxHash;

  const verifiedResultraw = await primus.verifyAndPollTaskResult({
    taskId,
    reportTxHash,
  });

  const verified = verifiedResultraw[0];
  const attestation = verified.attestation;
  const attData = JSON.parse(attestation.data);

  const verifiedHyperliquidAttestationResult = {
    taskId,
    reportTxHash,
    attestor: verified.attestor,
    recipient: attestation.recipient,
    chainId: CHAIN_ID,

    addressCommitment: attData["user_commitment"],
    fillsCommitment: attData["SHA256($)"],

    verifiedResult: JSON.stringify(verifiedResultraw, null),
  }

  return verifiedHyperliquidAttestationResult;
}
