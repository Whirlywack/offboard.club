// Who may open and change Profiles, and who counts as a Member. Only the session and the database are faked; the
// rest is the app's own code.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProfile } from "@/lib/auth";
import { countSignUps } from "@/lib/signups";
import { saveProfile } from "./actions";
import ProfilePage from "./profiles/[id]/page";
import ConnectStep from "./welcome/lichess/page";

const { getSession, query } = vi.hoisted(() => ({ getSession: vi.fn(), query: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession } }) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/db", () => ({ db: { query } }));

const at = new Date("2026-11-24T18:00:00Z");
// How far through signing up: "member" has done it all, "welcomed" has not connected Lichess, "unwelcomed" has not
// finished the welcome step.
type Stage = "member" | "welcomed" | "unwelcomed";
const stage = (id: string, how: Stage) => ({
  publicDisplayConsentAt: how === "unwelcomed" ? null : at,
  houseRulesAcceptedAt: how === "unwelcomed" ? null : at,
  lichessId: how === "member" ? `lichess-${id}` : null,
});
const person = (id: string, how: Stage) => ({
  id,
  name: `Person ${id}`,
  email: `${id}@example.com`,
  image: null,
  position: "CTO",
  linkedInUrl: null,
  openTo: null,
  lichessUsername: how === "member" ? `Lichess-${id}` : null,
  lichessBlitzRating: how === "member" ? 1500 : null,
  ...stage(id, how),
});
const table: Record<string, unknown>[] = [
  person("member", "member"),
  person("welcomed", "welcomed"),
  person("unwelcomed", "unwelcomed"),
  person("another", "member"),
];

// Answers a select on "user" as Postgres would: the rows (with id $1, if the query names one) for which every
// "is not null" condition holds, with only the columns selected, or their count. Any other statement changes nothing
// here; the tests read its arguments instead.
async function fakeQuery(sql: string, [id]: unknown[] = []) {
  if (!sql.startsWith("select")) return { rows: [] };
  const conditions = [...sql.matchAll(/"(\w+)" is not null/g)].map((m) => m[1]);
  const matching = table.filter(
    (row) => (!/where id = \$1/.test(sql) || row.id === id) && conditions.every((c) => row[c] != null),
  );
  if (/^select count\(\*\)::int as n from/.test(sql)) return { rows: [{ n: matching.length }] };
  const columns = sql.match(/select ([\s\S]*?) from/)![1].split(",").map((c) => c.trim().replaceAll('"', ""));
  return { rows: matching.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]]))) };
}

const signedInAs = (id: string, how: Stage = "member") => getSession.mockResolvedValue({ user: { id, ...stage(id, how) } });

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(null);
  query.mockReset().mockImplementation(fakeQuery);
});

describe("saveProfile", () => {
  it("sends a signed-out caller home and writes nothing", async () => {
    await expect(saveProfile(null, form({ position: "CTO" }))).rejects.toThrow(/^redirect \/$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("sends a caller who has not finished the welcome step there and writes nothing", async () => {
    signedInAs("unwelcomed", "unwelcomed");
    await expect(saveProfile(null, form({ position: "CTO" }))).rejects.toThrow(/^redirect \/welcome$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("sends a caller who has not connected Lichess to the connect step and writes nothing", async () => {
    signedInAs("welcomed", "welcomed");
    await expect(saveProfile(null, form({ position: "CTO" }))).rejects.toThrow(/^redirect \/welcome\/lichess$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("writes only the caller's own row, whatever id the form carries", async () => {
    signedInAs("member");
    const attempt = form({ position: "Hijacked", id: "another", userId: "another", user: "another" });
    await expect(saveProfile(null, attempt)).rejects.toThrow(/^redirect \/profiles\/member$/);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/^update "user" set .* where id = \$1$/);
    expect(params).toEqual(["member", "Hijacked", null, null]);
  });
});

describe("getProfile", () => {
  it("returns a Member's Profile with their Lichess name and blitz rating, without their email", async () => {
    expect(await getProfile("member")).toEqual({
      id: "member",
      name: "Person member",
      image: null,
      position: "CTO",
      linkedInUrl: null,
      openTo: null,
      lichessUsername: "Lichess-member",
      lichessBlitzRating: 1500,
    });
  });

  it("returns nothing for someone who has not finished the welcome step", async () => {
    expect(await getProfile("unwelcomed")).toBeNull();
  });

  it("returns nothing for someone who has not connected Lichess", async () => {
    expect(await getProfile("welcomed")).toBeNull();
  });

  it("returns nothing for an unknown id", async () => {
    expect(await getProfile("nobody")).toBeNull();
  });
});

describe("the Profile page", () => {
  // The page itself is a static shell; what reads the session and the database is the element inside <Suspense>.
  async function open(id: string) {
    const page = ProfilePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    const inner = page.props.children[0].props.children;
    return inner.type(inner.props);
  }

  it("sends a signed-out visitor home before looking anyone up", async () => {
    await expect(open("member")).rejects.toThrow(/^redirect \/$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("sends a viewer who has not finished the welcome step there before looking anyone up", async () => {
    signedInAs("unwelcomed", "unwelcomed");
    await expect(open("member")).rejects.toThrow(/^redirect \/welcome$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("sends a viewer who has not connected Lichess to the connect step before looking anyone up", async () => {
    signedInAs("welcomed", "welcomed");
    await expect(open("member")).rejects.toThrow(/^redirect \/welcome\/lichess$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("shows a Member to a Member, and nobody else", async () => {
    signedInAs("another");
    await expect(open("member")).resolves.toBeTruthy();
    await expect(open("welcomed")).rejects.toThrow("not found");
    await expect(open("unwelcomed")).rejects.toThrow("not found");
    await expect(open("nobody")).rejects.toThrow("not found");
  });
});

describe("the sign-up countdown", () => {
  it("counts Members only, not people part-way through signing up", async () => {
    expect(await countSignUps()).toBe(2);
  });
});

describe("the connect step", () => {
  // As for the Profile page, what reads the session is the element inside <Suspense>, last in <main>.
  async function open(searchParams: Record<string, string> = {}) {
    const page = ConnectStep({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });
    const inner = page.props.children.at(-1).props.children;
    return renderToStaticMarkup((await inner.type(inner.props)) as ReactElement);
  }

  it("sends a signed-out visitor home", async () => {
    await expect(open()).rejects.toThrow(/^redirect \/$/);
  });

  it("sends someone who has not finished the welcome step there", async () => {
    signedInAs("unwelcomed", "unwelcomed");
    await expect(open()).rejects.toThrow(/^redirect \/welcome$/);
  });

  it("sends a Member home, since they swap accounts from the Profile edit page", async () => {
    signedInAs("member");
    await expect(open()).rejects.toThrow(/^redirect \/$/);
  });

  it("offers to connect, and points someone without a Lichess account to Lichess's sign-up page", async () => {
    signedInAs("welcomed", "welcomed");
    const html = await open();
    expect(html).toContain("<button>Connect Lichess</button>");
    expect(html).toContain('href="https://lichess.org/signup"');
    expect(html).not.toContain('role="alert"');
  });

  it("says plainly why the last attempt failed, and ignores anything else in the address", async () => {
    signedInAs("welcomed", "welcomed");
    expect(await open({ lichess: "taken" })).toContain("already connected to another Member");
    expect(await open({ lichess: "<script>alert(1)</script>" })).not.toContain('role="alert"');
    expect(await open({ lichess: "toString" })).not.toContain('role="alert"');
  });
});
