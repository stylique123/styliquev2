// At-app encryption for sensitive DB fields using AES-256-GCM.
// Requires APP_ENCRYPTION_KEY env var (64-char hex = 32 bytes).
// Falls back to plaintext when key absent (dev / not yet migrated).
// Safe to deploy against existing plaintext rows — isEncrypted() guard.
// OI-25: used by shopify-app and worker to encrypt/decrypt Shop.accessToken.
// Default import (not named) so a client bundle pulling the @stylique/core
// barrel doesn't break the browser build (vite browser-external has no named exports).
import nodeCrypto from "node:crypto";
const { createCipheriv, createDecipheriv, randomBytes } = nodeCrypto;

const ALG = "aes-256-gcm";

// Node's Buffer is a Uint8Array at runtime. Newer @types/node versions tighten
// Buffer<ArrayBuffer> vs Uint8Array<ArrayBufferLike> variance which breaks the
// crypto overloads. Cast through unknown to satisfy the type-checker without
// any runtime cost or correctness change.
function toKey(hex: string): Uint8Array {
  return Buffer.from(hex, "hex") as unknown as Uint8Array;
}
function toIv(buf: Buffer): Uint8Array {
  return buf as unknown as Uint8Array;
}

function getKey(): string {
  return process.env.APP_ENCRYPTION_KEY ?? "";
}

export function encryptField(plaintext: string): string {
  const KEY_HEX = getKey();
  if (!KEY_HEX || KEY_HEX.length < 64) return plaintext;
  const key = toKey(KEY_HEX.slice(0, 64));
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, toIv(iv));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()] as unknown as Uint8Array[]);
  const tag = cipher.getAuthTag();
  return "enc:" + Buffer.concat([iv, tag, enc] as unknown as Uint8Array[]).toString("base64");
}

export function decryptField(value: string): string {
  const KEY_HEX = getKey();
  if (!KEY_HEX || KEY_HEX.length < 64 || !value.startsWith("enc:")) return value;
  try {
    const key = toKey(KEY_HEX.slice(0, 64));
    const buf = Buffer.from(value.slice(4), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv(ALG, key, toIv(iv));
    decipher.setAuthTag(tag as unknown as Uint8Array);
    return decipher.update(enc as unknown as Uint8Array).toString("utf8") + decipher.final("utf8");
  } catch { return value; } // decrypt failed = return as-is (wrong key or corrupt)
}
