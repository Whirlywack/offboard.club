import { describe, expect, it } from "vitest";
import { consentProblem, mustWelcome } from "./consent";

const at = new Date("2026-11-24T18:00:00Z");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe("mustWelcome", () => {
  it("sends a person who has given neither to the welcome page", () => {
    expect(mustWelcome({ publicDisplayConsentAt: null, houseRulesAcceptedAt: null })).toBe(true);
  });

  it("sends a person who has given only one of the two", () => {
    expect(mustWelcome({ publicDisplayConsentAt: at, houseRulesAcceptedAt: null })).toBe(true);
    expect(mustWelcome({ publicDisplayConsentAt: null, houseRulesAcceptedAt: at })).toBe(true);
  });

  it("treats fields the session does not carry as not given", () => {
    expect(mustWelcome({})).toBe(true);
  });

  it("lets a returning person who has given both through", () => {
    expect(mustWelcome({ publicDisplayConsentAt: at, houseRulesAcceptedAt: at })).toBe(false);
  });
});

describe("consentProblem", () => {
  it("accepts both boxes ticked", () => {
    expect(consentProblem(form({ publicDisplay: "yes", houseRules: "yes" }))).toBeNull();
  });

  it("rejects a missing public display box", () => {
    expect(consentProblem(form({ houseRules: "yes" }))).toMatch(/appear publicly/);
  });

  it("rejects a missing house rules box", () => {
    expect(consentProblem(form({ publicDisplay: "yes" }))).toMatch(/house rules/);
  });

  it("rejects an empty form", () => {
    expect(consentProblem(form({}))).not.toBeNull();
  });

  it("rejects a value other than the box's own", () => {
    expect(consentProblem(form({ publicDisplay: "no", houseRules: "yes" }))).not.toBeNull();
  });
});
