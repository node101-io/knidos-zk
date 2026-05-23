// Minimal SIWE (EIP-4361) compose/parse/verify — just the slice we use.
// Replaces the heavyweight `siwe` + `viem` deps (~70 MB) with @noble/*
// (~5 MB) and ~30 lines of glue.
//
// What we cover:
//   - build a SIWE message string from typed fields
//   - parse an existing message to extract address + expirationTime
//   - verify an EIP-191 `personal_sign` signature and recover the signer
//
// Addresses are kept lowercase throughout — we control both sides of the
// message, so the canonical EIP-55 checksum the official `siwe` library
// enforces buys us nothing. The signature still verifies because the
// wallet signs exactly the bytes we hand it.

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface SiweFields {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: '1';
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
}

export function prepareSiweMessage(f: SiweFields): string {
  const lines: string[] = [];
  lines.push(`${f.domain} wants you to sign in with your Ethereum account:`);
  lines.push(f.address);
  lines.push('');
  if (f.statement) {
    lines.push(f.statement);
    lines.push('');
  }
  lines.push(`URI: ${f.uri}`);
  lines.push(`Version: ${f.version}`);
  lines.push(`Chain ID: ${f.chainId}`);
  lines.push(`Nonce: ${f.nonce}`);
  lines.push(`Issued At: ${f.issuedAt}`);
  if (f.expirationTime) lines.push(`Expiration Time: ${f.expirationTime}`);
  return lines.join('\n');
}

export interface ParsedSiwe {
  address: string;
  expirationTime: string | null;
}

export function parseSiweMessage(message: string): ParsedSiwe {
  const lines = message.split('\n');
  const rawAddress = lines[1]?.trim() ?? '';
  if (!ADDRESS_RE.test(rawAddress)) {
    throw new Error('siwe-lite: missing or malformed address line');
  }
  let expirationTime: string | null = null;
  for (const line of lines) {
    if (line.startsWith('Expiration Time: ')) {
      expirationTime = line.slice('Expiration Time: '.length).trim();
    }
  }
  return { address: rawAddress, expirationTime };
}

// EIP-191 personal_sign hash:
//   keccak256("\x19Ethereum Signed Message:\n" + len + message)
function personalSignHash(message: string): Uint8Array {
  const msg = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(
    `\x19Ethereum Signed Message:\n${msg.length}`,
  );
  const buf = new Uint8Array(prefix.length + msg.length);
  buf.set(prefix);
  buf.set(msg, prefix.length);
  return keccak_256(buf);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('siwe-lite: odd-length hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// Recover the signer address from an EIP-191 personal_sign signature.
// Signature is 65 bytes: r (32) || s (32) || v (1). v is 27/28 or 0/1.
export function recoverPersonalSigner(message: string, signatureHex: string): string {
  const sig = hexToBytes(signatureHex);
  if (sig.length !== 65) throw new Error('siwe-lite: signature must be 65 bytes');
  const recoveryByte = sig[64] as number;
  const recovery = recoveryByte >= 27 ? recoveryByte - 27 : recoveryByte;
  if (recovery !== 0 && recovery !== 1) {
    throw new Error('siwe-lite: invalid recovery id');
  }
  const compact = sig.subarray(0, 64);
  const sigObj = secp256k1.Signature.fromCompact(compact).addRecoveryBit(recovery);
  const hash = personalSignHash(message);
  // recoverPublicKey returns a Point; toRawBytes(false) → 65-byte uncompressed
  // form prefixed with 0x04 — drop the prefix, then keccak256(last 32 bytes).
  const pubKey = sigObj.recoverPublicKey(hash).toRawBytes(false).subarray(1);
  const addrBytes = keccak_256(pubKey).subarray(-20);
  return '0x' + bytesToHex(addrBytes);
}

// Convenience: verify that `signatureHex` is a valid personal_sign of
// `message` and that the recovered signer matches the address embedded in
// the message (line 2). Returns the lowercased address on success.
export function verifySiwePersonalSig(message: string, signatureHex: string): string {
  const { address } = parseSiweMessage(message);
  const recovered = recoverPersonalSigner(message, signatureHex);
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error('siwe-lite: signature does not match address in message');
  }
  return address.toLowerCase();
}
