// The Telegram group's invite link (#13), which Members only are given: on the home page, beside their Profile, and on the
// welcome step that follows signing up; never to a visitor or anyone part-way through, nor in the part of the home page
// built ahead of any request. Faked: the session and the database (lib/fake-db.ts). Everything else is the app's own
// code.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, people, resetDb } from "@/lib/fake-db";
import Home, { You } from "./page";
import { Step as AfterSignUp } from "./welcome/profile/page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const INVITE = "https://t.me/+a-pretend-invite";
let signedIn: string | null;

const render = async (component: () => Promise<unknown>) => renderToStaticMarkup((await component()) as ReactElement);

beforeEach(() => {
  vi.stubEnv("TELEGRAM_INVITE_LINK", INVITE);
  resetDb();
  addPerson("member");
  addPerson("unwelcomed", { publicDisplayConsentAt: null, houseRulesAcceptedAt: null, lichessId: null, lichessUsername: null });
  addPerson("unconnected", { lichessId: null, lichessUsername: null });
  signedIn = null;
  getSession.mockReset().mockImplementation(async () => {
    const person = signedIn ? people.get(signedIn) : undefined;
    return person ? { user: { ...person } } : null;
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("the Telegram group's invite link", () => {
  it("is on a Member's home page and on the step after signing up", async () => {
    signedIn = "member";
    const link = `<a href="${INVITE}" target="_blank" rel="noopener noreferrer">`;
    expect(await render(You)).toContain(`${link}Join the Club&#x27;s Telegram group`);
    expect(await render(AfterSignUp)).toContain(`${link}Join the Telegram group`);
  });

  it("comes, after signing up, with what the bot posts there only once the bot is set up", async () => {
    signedIn = "member";
    let html = await render(AfterSignUp);
    expect(html).toContain("Members talk in the Club&#x27;s Telegram group. <a");
    expect(html).not.toContain("bot");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "a-pretend-telegram-token");
    vi.stubEnv("TELEGRAM_GROUP_ID", "@pretend_group");
    html = await render(AfterSignUp);
    expect(html).toContain("Members talk in the Club&#x27;s Telegram group, where the bot also posts the Matchday reminders and Recaps. <a");
  });

  it("is given to nobody else: not a visitor, nor anyone part-way through signing up", async () => {
    for (const who of [null, "unwelcomed", "unconnected"]) {
      signedIn = who;
      expect(await render(You)).not.toContain("t.me");
      await expect(render(AfterSignUp)).rejects.toThrow(/^redirect \//);
    }
  });

  it("is not in the home page as it is built ahead of any request", async () => {
    signedIn = "member";
    const shell = renderToStaticMarkup(Home());
    expect(shell).toContain("Members also talk in a Telegram group.");
    expect(shell).not.toContain("t.me");
  });

  it.each([
    ["unset", ""],
    ["not a t.me link", "javascript:alert(1)"],
  ])("is shown nowhere while TELEGRAM_INVITE_LINK is %s, and the home page says the group is still to come", async (_, value) => {
    vi.stubEnv("TELEGRAM_INVITE_LINK", value);
    signedIn = "member";
    expect(await render(You)).not.toContain("Telegram");
    expect(await render(AfterSignUp)).not.toContain("Telegram");
    expect(renderToStaticMarkup(Home())).toContain("Still to come: a Telegram group for Members.");
  });
});
