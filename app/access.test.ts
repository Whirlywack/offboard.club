// Who may open and change Profiles. Only the session and the database are faked; the rest is the app's own code.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProfile } from "@/lib/auth";
import { saveProfile } from "./actions";
import ProfilePage from "./profiles/[id]/page";

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
const person = (id: string, welcomed: boolean) => ({
  id,
  name: `Person ${id}`,
  email: `${id}@example.com`,
  image: null,
  position: "CTO",
  linkedInUrl: null,
  openTo: null,
  publicDisplayConsentAt: welcomed ? at : null,
  houseRulesAcceptedAt: welcomed ? at : null,
});
const table: Record<string, unknown>[] = [person("welcomed", true), person("unwelcomed", false)];

// Answers a select on "user" as Postgres would: the row with id $1, if every "is not null" condition holds, with only
// the columns selected. Any other statement changes nothing here; the tests read its arguments instead.
async function fakeQuery(sql: string, [id]: unknown[]) {
  if (!sql.startsWith("select")) return { rows: [] };
  const columns = sql.match(/select ([\s\S]*?) from/)![1].split(",").map((c) => c.trim().replaceAll('"', ""));
  const conditions = [...sql.matchAll(/"(\w+)" is not null/g)].map((m) => m[1]);
  const rows = table
    .filter((row) => row.id === id && conditions.every((c) => row[c] != null))
    .map((row) => (columns.includes("*") ? row : Object.fromEntries(columns.map((c) => [c, row[c]]))));
  return { rows };
}

const signedInAs = (id: string, welcomed = true) =>
  getSession.mockResolvedValue({
    user: { id, publicDisplayConsentAt: welcomed ? at : null, houseRulesAcceptedAt: welcomed ? at : null },
  });

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
    signedInAs("unwelcomed", false);
    await expect(saveProfile(null, form({ position: "CTO" }))).rejects.toThrow(/^redirect \/welcome$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("writes only the caller's own row, whatever id the form carries", async () => {
    signedInAs("welcomed");
    const attempt = form({ position: "Hijacked", id: "unwelcomed", userId: "unwelcomed", user: "unwelcomed" });
    await expect(saveProfile(null, attempt)).rejects.toThrow(/^redirect \/profiles\/welcomed$/);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/^update "user" set .* where id = \$1$/);
    expect(params).toEqual(["welcomed", "Hijacked", null, null]);
  });
});

describe("getProfile", () => {
  it("returns a welcomed person's Profile, without their email", async () => {
    expect(await getProfile("welcomed")).toEqual({
      id: "welcomed",
      name: "Person welcomed",
      image: null,
      position: "CTO",
      linkedInUrl: null,
      openTo: null,
    });
  });

  it("returns nothing for someone who has not finished the welcome step", async () => {
    expect(await getProfile("unwelcomed")).toBeNull();
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
    await expect(open("welcomed")).rejects.toThrow(/^redirect \/$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("sends a viewer who has not finished the welcome step there before looking anyone up", async () => {
    signedInAs("unwelcomed", false);
    await expect(open("welcomed")).rejects.toThrow(/^redirect \/welcome$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("shows a welcomed person to a signed-up viewer, and nobody else", async () => {
    signedInAs("viewer");
    await expect(open("welcomed")).resolves.toBeTruthy();
    await expect(open("unwelcomed")).rejects.toThrow("not found");
    await expect(open("nobody")).rejects.toThrow("not found");
  });
});
