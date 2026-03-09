import "dotenv/config";
import fs from "fs";
import path from "path";
import { zkVerifySession, ZkVerifyEvents, UltrahonkVariant } from "zkverifyjs";
import { requireEnv } from "../scripts/utils/requireEnv.js";

const SEED_PHRASE = requireEnv("SEED_PHRASE");

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
      `public_inputs binary length (${buf.length}) is not a multiple of 32 bytes`
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
          `Invalid public inputs hex length ${body.length}; expected multiple of 64 (bytes32 list)`
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
            `Invalid public input line hex length ${body.length}; expected 64 or multiple of 64`
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

async function main() {
  const ROOT = process.cwd();
  const CIRCUIT_TARGET = path.resolve(ROOT, "circuit", "target");

  const vkPath = path.resolve(CIRCUIT_TARGET, "vk");
  const proofPath = path.resolve(CIRCUIT_TARGET, "proof");
  const pubsPath = path.resolve(CIRCUIT_TARGET, "public_inputs");

  if (!fs.existsSync(vkPath)) {
    throw new Error(`VK not found: ${vkPath}`);
  }
  if (!fs.existsSync(proofPath)) {
    throw new Error(`Proof not found: ${proofPath}`);
  }
  if (!fs.existsSync(pubsPath)) {
    throw new Error(`Public inputs not found: ${pubsPath}`);
  }

  const variant = UltrahonkVariant.Plain;

  const vk = loadVk(vkPath);
  const proof = loadProof(proofPath, variant);
  const publicSignals = loadPublicSignals(pubsPath);

  console.log("vk bytes (binary):", fs.readFileSync(vkPath).length);
  console.log("publicSignals count:", publicSignals.length);

  const session = await zkVerifySession
    .start()
    .Volta()
    .withAccount(SEED_PHRASE);

  let statement: any;
  let aggregationId: number | undefined;

  session.subscribe([
    {
      event: ZkVerifyEvents.NewAggregationReceipt,
      callback: async (eventData: any) => {
        console.log("New aggregation receipt:", eventData);

        const receiptAggId = parseInt(
          String(eventData.data.aggregationId).replace(/,/g, ""),
          10
        );

        if (aggregationId !== undefined && aggregationId === receiptAggId) {
          const statementPath = await session.getAggregateStatementPath(
            eventData.blockHash,
            parseInt(String(eventData.data.domainId), 10),
            receiptAggId,
            statement
          );

          fs.writeFileSync(
            path.resolve(ROOT, "zkVerify", "aggregation.json"),
            JSON.stringify(
              {
                ...statementPath,
                domainId: parseInt(String(eventData.data.domainId), 10),
                aggregationId: receiptAggId,
              },
              null,
              2
            )
          );

          console.log("Wrote aggregation.json");
        }
      },
      options: { domainId: 0 },
    },
  ]);

  const { events } = await session
    .verify()
    .ultrahonk({ variant })
    .execute({
      proofData: { vk, proof, publicSignals },
      domainId: 0,
    });

  events.on(ZkVerifyEvents.IncludedInBlock, (eventData: any) => {
    console.log("Included in block", eventData);
    statement = eventData.statement;
    aggregationId = eventData.aggregationId;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});