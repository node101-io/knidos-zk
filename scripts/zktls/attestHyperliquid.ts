import { PrimusNetwork } from "@primuslabs/network-core-sdk";
import { ethers } from "ethers";

import { requireEnv } from "../utils/requireEnv.ts";

export async function attestHyperliquidUserFills(): Promise<unknown> {
  const PRIVATE_KEY = requireEnv("PRIMUS_PRIVATE_KEY");
  const USER_ADDRESS = requireEnv("USER_ADDRESS");
  const HYPERLIQUID_API_URL = requireEnv("HYPERLIQUID_API_URL");

  const CHAIN_ID = Number(process.env.CHAIN_ID ?? "84532");
  const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, CHAIN_ID);

  const requests = [
    {
      url: HYPERLIQUID_API_URL,
      method: "POST",
      header: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "userFills",
        user: USER_ADDRESS,
      }),
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
    ],
  ];

  const submitTaskResult = await primus.submitTask({
    address: USER_ADDRESS,
  });
  console.log("Submit task result:", submitTaskResult);

  const {
    taskId,
    taskTxHash,
    taskAttestors,
    reportTxHash,
  } = submitTaskResult as {
    taskId: string;
    taskTxHash: string;
    taskAttestors: string[];
    reportTxHash: string;
  }
  const attestResult = await primus.attest({
    address: USER_ADDRESS,
    taskId,
    taskTxHash,
    taskAttestors,
    requests,
    responseResolves,
    attMode: {
      algorithmType: "proxytls",
      resultType: "plain",
    },
  });
  const fullResponse = await primus.getAllJsonResponse(taskId);
  console.log(fullResponse);

  console.log("Attest result:", attestResult);
  return attestResult;
  // const verifiedResult = await primus.verifyAndPollTaskResult({
  //   taskId,
  //   reportTxHash,
  // });
  // console.log("Task result:", verifiedResult);

  // return verifiedResult;
}
