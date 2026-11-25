// Lichess tokens as they are kept at rest: sealed with AES-256-GCM, which both hides the token and detects any change to
// what is stored. The key comes from LICHESS_TOKEN_KEY (32 random bytes, base64), which is never in the database, so a
// copy of the database alone gives no usable token.
//
// The key is its own variable rather than derived from BETTER_AUTH_SECRET: rotating the sign-in secret (the usual
// response to a suspected leak of sessions) must not silently make the stored token unreadable and stop Matchdays being
// created, and a key with one purpose can be replaced on its own, by connecting Lichess again.
//
// Each sealed token is bound to what it is for (`context`, such as whose token it is): opening it with another context
// fails as tampering does.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

// The key, or null if LICHESS_TOKEN_KEY is missing or is not 32 bytes.
export function tokenKey(): Buffer | null {
  const key = Buffer.from(process.env.LICHESS_TOKEN_KEY ?? "", "base64");
  return key.length === 32 ? key : null;
}

export function sealToken(token: string, context: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv, ciphertext, cipher.getAuthTag()].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

// The token, or null if it was sealed with another key or context, or has been changed in any way.
export function openToken(sealed: string, context: string, key: Buffer): string | null {
  const [version, iv, ciphertext, tag, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext || !tag || rest.length > 0) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
