// Who may open and change Profiles. Only the session and the database are faked; the rest is the app's own code.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProfile } from "@/lib/auth";
import { addPerson, db, people, resetDb } from "@/lib/fake-db";
import { saveProfile } from "./actions";
import ProfilePage from "./profiles/[id]/page";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
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
vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const at = new Date("2026-11-24T18:00:00Z");

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
  resetDb();
  addPerson("welcomed", { position: "CTO" });
  addPerson("unwelcomed", { position: "CTO", publicDisplayConsentAt: null, houseRulesAcceptedAt: null });
  getSession.mockReset().mockResolvedValue(null);
});

describe("saveProfile", () => {
  it("sends a signed-out caller home and writes nothing", async () => {
    await expect(saveProfile(null, form({ position: "CTO" }))).rejects.toThrow(/^redirect \/$/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("sends a caller who has not finished the welcome step there and writes nothing", async () => {
    signedInAs("unwelcomed", false);
    await expect(saveProfile(null, form({ position: "CTO" }))).rejects.toThrow(/^redirect \/welcome$/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("writes only the caller's own row, whatever id the form carries", async () => {
    signedInAs("welcomed");
    const attempt = form({ position: "Hijacked", id: "unwelcomed", userId: "unwelcomed", user: "unwelcomed" });
    await expect(saveProfile(null, attempt)).rejects.toThrow(/^redirect \/profiles\/welcomed$/);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/^update "user" set [\s\S]* where id = \$1$/);
    expect(params).toEqual(["welcomed", null, "Hijacked", null, null]);
    expect(people.get("welcomed")?.position).toBe("Hijacked");
    expect(people.get("unwelcomed")?.position).toBe("CTO");
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
      company: null,
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
    expect(db.query).not.toHaveBeenCalled();
  });

  it("sends a viewer who has not finished the welcome step there before looking anyone up", async () => {
    signedInAs("unwelcomed", false);
    await expect(open("welcomed")).rejects.toThrow(/^redirect \/welcome$/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("shows a welcomed person to a signed-up viewer, and nobody else", async () => {
    signedInAs("viewer");
    await expect(open("welcomed")).resolves.toBeTruthy();
    await expect(open("unwelcomed")).rejects.toThrow("not found");
    await expect(open("nobody")).rejects.toThrow("not found");
  });
});
