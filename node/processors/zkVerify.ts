import "dotenv/config";
import fs from "fs";
import path from "path";
import * as zkv from "zkverifyjs";
const { zkVerifySession, ZkVerifyEvents, UltrahonkVariant } = zkv;
type UltrahonkVariant = zkv.UltrahonkVariant;
import { requireEnv } from "../../scripts/utils/requireEnv.js";
import type { ZkVerifyJobData } from "../types.js";

const SEED_PHRASE = requireEnv("ZKVERIFY_SEED_PHRASE");

function firstNonEmptyLine(s: string): string | null {
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (t.length) return t;
  }
  return null;
}

function stripWrappingTicks(s: string): string {
  return s.trim().replace(/^`+/, "").replace(/`+$/, "").trim();
}

function normalize0x(hex: string): string {
  const t = hex.trim();
  return t.startsWith("0x") ? t : `0x${t}`;
}

function bufferTo0xHex(buf: Buffer): string {
  return `0x${buf.toString("hex")}`;
}

function chunkBufferToBytes32List(buf: Buffer): string[] {
  if (buf.length % 32 !== 0) {
    throw new Error(
      `public_inputs binary length (${buf.length}) is not a multiple of 32 bytes`,
    );
  }

  const out: string[] = [];
  for (let i = 0; i < buf.length; i += 32) {
    out.push(bufferTo0xHex(buf.subarray(i, i + 32)));
  }
  return out;
}

function loadPublicSignals(pubsPath: string): string[] {
  const raw = fs.readFileSync(pubsPath);

  const asText = raw.toString("utf8").trim();
  const first = firstNonEmptyLine(asText);

  if (
    first &&
    (first.startsWith("[") || first.startsWith('"') || first.startsWith("0x"))
  ) {
    if (first.startsWith("[")) {
      const arr = JSON.parse(stripWrappingTicks(asText));
      if (!Array.isArray(arr)) {
        throw new Error("public signals JSON is not an array");
      }
      return arr.map((x) => normalize0x(String(x)));
    }

    const lines = asText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length);

    if (lines.length === 1) {
      const onlyLine = lines[0]!;
      const h = normalize0x(stripWrappingTicks(onlyLine));
      const body = h.slice(2);

      if (body.length % 64 !== 0) {
        throw new Error(
          `Invalid public inputs hex length ${body.length}; expected multiple of 64 (bytes32 list)`,
        );
      }

      const out: string[] = [];
      for (let i = 0; i < body.length; i += 64) {
        out.push(`0x${body.slice(i, i + 64)}`);
      }
      return out;
    }

    const out: string[] = [];
    for (const line of lines) {
      const h = normalize0x(stripWrappingTicks(line));
      const body = h.slice(2);

      if (body.length === 64) {
        out.push(h);
      } else {
        if (body.length % 64 !== 0) {
          throw new Error(
            `Invalid public input line hex length ${body.length}; expected 64 or multiple of 64`,
          );
        }

        for (let i = 0; i < body.length; i += 64) {
          out.push(`0x${body.slice(i, i + 64)}`);
        }
      }
    }

    return out;
  }

  return chunkBufferToBytes32List(raw);
}

function loadVk(vkPath: string): string {
  const raw = fs.readFileSync(vkPath);
  const asText = raw.toString("utf8").trim();
  const first = firstNonEmptyLine(asText);

  if (first && /^[`"]?0x[0-9a-fA-F]+[`"]?$/.test(first)) {
    return normalize0x(stripWrappingTicks(first).replace(/^"|"$/g, ""));
  }

  return bufferTo0xHex(raw);
}

function loadProof(proofPath: string, variant: UltrahonkVariant): string {
  const raw = fs.readFileSync(proofPath);
  const asText = raw.toString("utf8").trim();
  const first = firstNonEmptyLine(asText);

  if (first) {
    const cleaned = stripWrappingTicks(asText);

    if (cleaned.startsWith("{")) {
      const obj = JSON.parse(cleaned) as Record<string, unknown>;

      const wantKeys =
        variant === UltrahonkVariant.ZK
          ? ["ZK", "zk", "ZK:", "zk:"]
          : ["Plain", "plain", "Plain:", "plain:"];

      for (const key of wantKeys) {
        if (obj[key] != null) {
          return normalize0x(String(obj[key]));
        }
      }

      const firstValue = Object.values(obj)[0];
      if (firstValue == null) {
        throw new Error("proof JSON object is empty");
      }

      return normalize0x(String(firstValue));
    }

    if (/^["`]?0x[0-9a-fA-F]+["`]?$/.test(first)) {
      return normalize0x(stripWrappingTicks(first).replace(/^"|"$/g, ""));
    }
  }

  return bufferTo0xHex(raw);
}

export type ZkVerifyProcessorResult = {
  targetDir: string;
  vkPath: string;
  proofPath: string;
  publicInputsPath: string;
  variant: UltrahonkVariant;
  vk: string;
  proof: string;
  publicSignals: string[];
  includedInBlock?: unknown;
  statement?: unknown;
  aggregationId?: number;
};

export async function runZkVerifyProcessor(
  input: ZkVerifyJobData["input"],
): Promise<ZkVerifyProcessorResult> {
  const targetDir = path.resolve(input.targetDir);

  const vkPath = path.join(targetDir, "vk");
  const proofPath = path.join(targetDir, "proof");
  const publicInputsPath = path.join(targetDir, "public_inputs");

  if (!fs.existsSync(vkPath)) {
    throw new Error(`VK not found: ${vkPath}`);
  }
  if (!fs.existsSync(proofPath)) {
    throw new Error(`Proof not found: ${proofPath}`);
  }
  if (!fs.existsSync(publicInputsPath)) {
    throw new Error(`Public inputs not found: ${publicInputsPath}`);
  }

  const variant = UltrahonkVariant.Plain;

  const vk = loadVk(vkPath);
  const proof = loadProof(proofPath, variant);
  const publicSignals = loadPublicSignals(publicInputsPath);

  const session = await zkVerifySession
    .start()
    .Volta()
    .withAccount(SEED_PHRASE);

  let includedInBlock: unknown;
  let statement: unknown;
  let aggregationId: number | undefined;

  const { events } = await session
    .verify()
    .ultrahonk({ variant })
    .execute({
      proofData: { vk, proof, publicSignals },
      domainId: 0,
    });

  await new Promise<void>((resolve) => {
    events.on(ZkVerifyEvents.IncludedInBlock, (eventData: any) => {
      includedInBlock = eventData;
      statement = eventData.statement;
      aggregationId = eventData.aggregationId;
      resolve();
    });
  });

  return {
    targetDir,
    vkPath,
    proofPath,
    publicInputsPath,
    variant,
    vk,
    proof,
    publicSignals,
    ...(includedInBlock !== undefined ? { includedInBlock } : {}),
    ...(statement !== undefined ? { statement } : {}),
    ...(aggregationId !== undefined ? { aggregationId } : {}),
  };
}