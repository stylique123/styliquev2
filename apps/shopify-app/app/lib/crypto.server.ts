// At-app encryption for sensitive DB fields using AES-256-GCM.
//
// Two calling conventions:
//
//   1. Env-backed (default, no key arg):
//        encryptField(plaintext)   — reads APP_ENCRYPTION_KEY from env
//        decryptField(value)       — reads APP_ENCRYPTION_KEY from env
//      Falls back to plaintext when APP_ENCRYPTION_KEY absent (dev / not yet migrated).
//      Safe to deploy against existing plaintext rows — isEncrypted() guard.
//
//   2. Explicit key (for callers that supply the key directly, e.g. tests):
//        encryptField(plaintext, key)
//        decryptField(value,     key)
//      key must be a 64-char hex string (32 bytes).
//
// Requires APP_ENCRYPTION_KEY env var (64-char hex = 32 bytes) for convention 1.
// Used for Shop.accessToken encryption at rest (see OI-25).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_HEX = process.env.APP_ENCRYPTION_KEY ?? "";
const ALG = "aes-256-gcm";

// Node's Buffer is a Uint8Array at runtime. Newer @types/node versions tighten
// Buffer<ArrayBuffer> vs Uint8Array<ArrayBufferLike> variance, causing type
// errors at crypto call sites. Cast through unknown to satisfy the type-checker
// without any runtime cost or correctness change.
const u8 = (b: Buffer | Uint8Array): Uint8Array => b as unknown as Uint8Array;
const u8list = (bs: Buffer[]): Uint8Array[] => bs as unknown as Uint8Array[];

/**
 * Encrypt a string with AES-256-GCM.
 *
 * @param plaintext  The value to encrypt.
 * @param keyHex     Optional 64-char hex key (32 bytes). Defaults to APP_ENCRYPTION_KEY env var.
 *                   When no key is available the plaintext is returned unchanged.
 * @returns          Encrypted string prefixed with "enc:", or the original plaintext.
 */
export function encryptField(plaintext: string, keyHex?: string): string {
  const effectiveKey = keyHex ?? KEY_HEX;
  if (!effectiveKey || effectiveKey.length < 64) return plaintext;
  const key = u8(Buffer.from(effectiveKey.slice(0, 64), "hex"));
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, u8(iv));
  const enc = Buffer.concat(u8list([cipher.update(plaintext, "utf8"), cipher.final()]));
  const tag = cipher.getAuthTag();
  return "enc:" + Buffer.concat(u8list([iv, tag, enc])).toString("base64");
}

/**
 * Decrypt a string produced by encryptField.
 *
 * @param value   The value to decrypt (must start with "enc:").
 * @param keyHex  Optional 64-char hex key (32 bytes). Defaults to APP_ENCRYPTION_KEY env var.
 *                When no key is available, or the value is not encrypted, it is returned as-is.
 * @returns       Decrypted plaintext, or the original value on any error.
 */
export function decryptField(value: string, keyHex?: string): string {
  const effectiveKey = keyHex ?? KEY_HEX;
  if (!effectiveKey || effectiveKey.length < 64 || !value.startsWith("enc:")) return value;
  try {
    const key = u8(Buffer.from(effectiveKey.slice(0, 64), "hex"));
    const buf = Buffer.from(value.slice(4), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv(ALG, key, u8(iv));
    decipher.setAuthTag(u8(tag));
    return decipher.update(u8(enc)).toString("utf8") + decipher.final("utf8");
  } catch { return value; } // decrypt failed = return as-is (wrong key or corrupt)
}
