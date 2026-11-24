// Sealing a Lichess token for storage: unreadable without the key, bound to whose it is, and any change detected.
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openToken, sealToken, tokenKey } from "./token-box";

const TOKEN = "a-pretend-lichess-token";
const key = randomBytes(32);
const context = "offboard organiser lichess token\norganiser\nbobby";

afterEach(() => vi.unstubAllEnvs());

describe("the key", () => {
  it("is LICHESS_TOKEN_KEY's 32 bytes, given in base64", () => {
    vi.stubEnv("LICHESS_TOKEN_KEY", key.toString("base64"));
    expect(tokenKey()?.equals(key)).toBe(true);
  });

  it.each([
    ["unset", ""],
    ["too short", randomBytes(16).toString("base64")],
    ["too long", randomBytes(48).toString("base64")],
    ["not base64 of 32 bytes", "correct horse battery staple"],
  ])("is missing when %s", (_, value) => {
    vi.stubEnv("LICHESS_TOKEN_KEY", value);
    expect(tokenKey()).toBeNull();
  });
});

describe("a sealed token", () => {
  it("opens with the same key and context", () => {
    expect(openToken(sealToken(TOKEN, context, key), context, key)).toBe(TOKEN);
  });

  it("shows nothing of the token, and is different every time", () => {
    const sealed = sealToken(TOKEN, context, key);
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain(Buffer.from(TOKEN).toString("base64url"));
    expect(sealed).not.toContain(Buffer.from(TOKEN).toString("base64"));
    expect(sealToken(TOKEN, context, key)).not.toBe(sealed);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("cannot be opened without the key it was sealed with", () => {
    expect(openToken(sealToken(TOKEN, context, key), context, randomBytes(32))).toBeNull();
  });

  it("cannot be opened as someone else's", () => {
    const sealed = sealToken(TOKEN, context, key);
    expect(openToken(sealed, "offboard organiser lichess token\nsomeone\nbobby", key)).toBeNull();
    expect(openToken(sealed, "offboard organiser lichess token\norganiser\nalice", key)).toBeNull();
  });

  it("is refused when any part of it has been changed", () => {
    const sealed = sealToken(TOKEN, context, key);
    const parts = sealed.split(".");
    for (let i = 1; i < parts.length; i++) {
      const bytes = Buffer.from(parts[i], "base64url");
      bytes[0] ^= 1;
      const changed = parts.map((part, j) => (j === i ? bytes.toString("base64url") : part)).join(".");
      expect(openToken(changed, context, key)).toBeNull();
    }
    expect(openToken(sealed.replace(/^v1/, "v2"), context, key)).toBeNull();
    expect(openToken(`${sealed}.extra`, context, key)).toBeNull();
    expect(openToken(parts.slice(0, 3).join("."), context, key)).toBeNull();
    expect(openToken(`${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].slice(0, 8)}`, context, key)).toBeNull();
    expect(openToken("", context, key)).toBeNull();
  });
});
