// Giving a Company by its website on the Profile form, and seeing it on the Profile. The session, the database and the
// fetch of a Company's website are faked; everything else is the app's own code.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfile } from "@/lib/auth";
import { currentCompany, NEW_COMPANIES_PER_DAY } from "@/lib/companies";
import { fetchCompanyMeta } from "@/lib/company";
import { addCompany, addPerson, companies, db, people, resetDb } from "@/lib/fake-db";
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
vi.mock("@/lib/company", async (original) => ({
  ...(await original<typeof import("@/lib/company")>()),
  fetchCompanyMeta: vi.fn(),
}));

const fetchMeta = vi.mocked(fetchCompanyMeta);
const at = new Date("2026-11-24T18:00:00Z");
const session = (id: string, welcomed = true) => ({
  user: { id, publicDisplayConsentAt: welcomed ? at : null, houseRulesAcceptedAt: welcomed ? at : null },
});
const signedInAs = (id: string, welcomed = true) => getSession.mockResolvedValue(session(id, welcomed));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const save = (fields: Record<string, string>) => saveProfile(null, form(fields));
const saved = (id: string) => `redirect /profiles/${id}`;

const notAWebsite = "The Company website must be the address of a public website, such as vinted.com.";
const vinted = { name: "Vinted", logoUrl: "https://www.vinted.com/favicon.ico" };

beforeEach(() => {
  resetDb();
  getSession.mockReset().mockResolvedValue(null);
  fetchMeta.mockReset().mockImplementation(async (domain) => ({ name: domain, logoUrl: null }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("giving a Company website", () => {
  it("creates a new Company once, with the name and logo from its website, and puts the person in it", async () => {
    addPerson("ana");
    signedInAs("ana");
    fetchMeta.mockResolvedValue(vinted);
    await expect(save({ companyWebsite: "https://www.Vinted.com/careers" })).rejects.toThrow(saved("ana"));
    expect(fetchMeta.mock.calls).toEqual([["vinted.com"]]);
    expect([...companies.values()]).toEqual([{ domain: "vinted.com", ...vinted }]);
    expect(people.get("ana")?.companyDomain).toBe("vinted.com");
    expect((await getProfile("ana"))?.company).toEqual({ domain: "vinted.com", ...vinted });
    expect(await currentCompany("ana")).toEqual({ domain: "vinted.com", name: "Vinted" });
  });

  it("puts a second person in the existing Company without fetching its website again", async () => {
    addCompany("vinted.com", vinted.name, vinted.logoUrl);
    addPerson("ana", { companyDomain: "vinted.com" });
    addPerson("ben");
    signedInAs("ben");
    await expect(save({ companyWebsite: "jobs.VINTED.com/lt" })).rejects.toThrow(saved("ben"));
    expect(fetchMeta).not.toHaveBeenCalled();
    expect([...companies.values()]).toEqual([{ domain: "vinted.com", ...vinted }]);
    expect(people.get("ben")?.companyDomain).toBe("vinted.com");
    // Joining a Company that exists does not count towards the day's new Companies.
    expect(people.get("ben")?.companiesCreatedThatDay).toBe(0);
  });

  it("clears the person's Company when the website is emptied, leaving the Company in place", async () => {
    addCompany("vinted.com", vinted.name, vinted.logoUrl);
    addPerson("ana", { companyDomain: "vinted.com" });
    signedInAs("ana");
    await expect(save({ companyWebsite: " ​ " })).rejects.toThrow(saved("ana"));
    expect(people.get("ana")?.companyDomain).toBeNull();
    expect((await getProfile("ana"))?.company).toBeNull();
    expect(await currentCompany("ana")).toBeNull();
    expect(companies.has("vinted.com")).toBe(true);
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it("moves the person from one Company to another", async () => {
    addCompany("vinted.com", vinted.name, vinted.logoUrl);
    addPerson("ana", { companyDomain: "vinted.com" });
    signedInAs("ana");
    fetchMeta.mockResolvedValue({ name: "Bolt", logoUrl: null });
    await expect(save({ companyWebsite: "bolt.eu" })).rejects.toThrow(saved("ana"));
    expect(await currentCompany("ana")).toEqual({ domain: "bolt.eu", name: "Bolt" });
    expect(companies.has("vinted.com")).toBe(true);
  });

  it.each(["localhost", "http://192.168.1.10/", "intranet", "printer.local", "not a website", "co.uk", "javascript:alert(1)"])(
    "refuses %j with a plain message, keeps what was typed and writes nothing",
    async (website) => {
      addCompany("vinted.com", vinted.name, vinted.logoUrl);
      addPerson("ana", { companyDomain: "vinted.com", position: "CTO" });
      signedInAs("ana");
      await expect(save({ companyWebsite: website, position: "Engineer" })).resolves.toEqual({
        problem: notAWebsite,
        typed: { companyWebsite: website, position: "Engineer", linkedInUrl: "", openTo: "" },
      });
      expect(db.query).not.toHaveBeenCalled();
      expect(fetchMeta).not.toHaveBeenCalled();
      expect(people.get("ana")).toMatchObject({ companyDomain: "vinted.com", position: "CTO" });
    },
  );

  it("creates no Company and fetches nothing when another field is refused", async () => {
    addPerson("ana");
    signedInAs("ana");
    await expect(save({ companyWebsite: "vinted.com", position: "p".repeat(81) })).resolves.toMatchObject({
      problem: expect.stringMatching(/80 characters/),
      typed: { companyWebsite: "vinted.com" },
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(fetchMeta).not.toHaveBeenCalled();
    expect(companies.size).toBe(0);
  });
});

describe("a website that cannot be read", () => {
  it("names the Company after its domain when the fetch falls back, and still puts the person in it", async () => {
    addPerson("ana");
    signedInAs("ana");
    // What fetchCompanyMeta gives for a website that fails, refuses or has no name.
    fetchMeta.mockResolvedValue({ name: "vinted.com", logoUrl: null });
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    expect(await currentCompany("ana")).toEqual({ domain: "vinted.com", name: "vinted.com" });
  });

  it("still saves if the fetch throws", async () => {
    addPerson("ana");
    signedInAs("ana");
    fetchMeta.mockRejectedValue(new Error("unexpected"));
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    expect([...companies.values()]).toEqual([{ domain: "vinted.com", name: "vinted.com", logoUrl: null }]);
    expect(people.get("ana")?.companyDomain).toBe("vinted.com");
  });

  it("does not keep the save waiting on a website that never answers", async () => {
    vi.useFakeTimers();
    addPerson("ana");
    signedInAs("ana");
    fetchMeta.mockReturnValue(new Promise(() => {}));
    const saving = expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    await vi.advanceTimersByTimeAsync(8000);
    await saving;
    expect(await currentCompany("ana")).toEqual({ domain: "vinted.com", name: "vinted.com" });
  });
});

describe("two people giving the same new website at once", () => {
  it("makes one Company, fetched once, with both of them in it", async () => {
    addPerson("ana");
    addPerson("ben");
    getSession.mockResolvedValueOnce(session("ana")).mockResolvedValueOnce(session("ben"));
    fetchMeta.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return vinted;
    });
    await Promise.all([
      expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana")),
      expect(save({ companyWebsite: "https://www.vinted.com/" })).rejects.toThrow(saved("ben")),
    ]);
    // Both found no Company and tried to create it; one insert lost to the other.
    const inserts = db.query.mock.calls.filter(([sql]) => sql.startsWith(`insert into "company"`));
    expect(inserts).toHaveLength(2);
    expect([...companies.values()]).toEqual([{ domain: "vinted.com", ...vinted }]);
    expect(fetchMeta).toHaveBeenCalledTimes(1);
    expect(people.get("ana")?.companyDomain).toBe("vinted.com");
    expect(people.get("ben")?.companyDomain).toBe("vinted.com");
  });
});

describe("the daily limit on new Companies", () => {
  it(`lets one person create ${NEW_COMPANIES_PER_DAY} new Companies a day, and join existing ones beyond that`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T09:00:00Z"));
    addCompany("vinted.com", vinted.name, vinted.logoUrl);
    addPerson("ana");
    signedInAs("ana");
    for (let n = 1; n <= NEW_COMPANIES_PER_DAY; n++)
      await expect(save({ companyWebsite: `company${n}.com` })).rejects.toThrow(saved("ana"));
    expect(fetchMeta).toHaveBeenCalledTimes(NEW_COMPANIES_PER_DAY);

    vi.setSystemTime(new Date("2026-11-24T23:59:59Z"));
    await expect(save({ companyWebsite: "company6.com", position: "CTO" })).resolves.toMatchObject({
      problem: expect.stringMatching(/already added 5 new Companies today/),
    });
    expect(fetchMeta).toHaveBeenCalledTimes(NEW_COMPANIES_PER_DAY);
    expect(companies.has("company6.com")).toBe(false);
    expect(people.get("ana")).toMatchObject({ companyDomain: "company5.com", position: null });

    // Companies that exist are still open to her, and cost nothing.
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    await expect(save({ companyWebsite: "company1.com" })).rejects.toThrow(saved("ana"));
    expect(fetchMeta).toHaveBeenCalledTimes(NEW_COMPANIES_PER_DAY);

    // The next UTC day starts a new count.
    vi.setSystemTime(new Date("2026-11-25T00:00:01Z"));
    await expect(save({ companyWebsite: "company6.com" })).rejects.toThrow(saved("ana"));
    expect(fetchMeta).toHaveBeenCalledTimes(NEW_COMPANIES_PER_DAY + 1);
    expect(people.get("ana")?.companyDomain).toBe("company6.com");
  });

  it("counts each person's new Companies separately", async () => {
    addPerson("ana", { companiesCreatedOn: new Date().toISOString().slice(0, 10), companiesCreatedThatDay: 5 });
    addPerson("ben");
    signedInAs("ben");
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ben"));
  });
});

describe("who can give a Company website", () => {
  it("sends a signed-out caller home without writing or fetching anything", async () => {
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(/^redirect \/$/);
    expect(db.query).not.toHaveBeenCalled();
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it("sends a caller who has not finished signing up to the welcome step without writing or fetching anything", async () => {
    addPerson("una", { publicDisplayConsentAt: null, houseRulesAcceptedAt: null });
    signedInAs("una", false);
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(/^redirect \/welcome$/);
    expect(db.query).not.toHaveBeenCalled();
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it("changes only the caller's own Company, whatever the form says", async () => {
    addCompany("vinted.com", vinted.name, vinted.logoUrl);
    addPerson("ana");
    addPerson("ben", { companyDomain: "vinted.com" });
    signedInAs("ana");
    const attempt = { companyWebsite: "bolt.eu", id: "ben", userId: "ben", personId: "ben", companyDomain: "vinted.com" };
    await expect(save(attempt)).rejects.toThrow(saved("ana"));
    expect(people.get("ana")).toMatchObject({ companyDomain: "bolt.eu", companiesCreatedThatDay: 1 });
    expect(people.get("ben")).toMatchObject({ companyDomain: "vinted.com", companiesCreatedThatDay: 0 });
  });
});

describe("the Company on the Profile page", () => {
  // The page is a static shell; the element inside <Suspense> reads the session and the database.
  async function render(id: string) {
    const page = ProfilePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    const inner = page.props.children[0].props.children;
    return renderToStaticMarkup(await inner.type(inner.props));
  }

  it("shows the name as text beside a lazily loaded logo that is sent no referrer", async () => {
    addCompany("vinted.com", "Vinted <b>&</b> Co", "https://static.vinted.com/logo.svg?v=1&s=32");
    addPerson("ana", { companyDomain: "vinted.com" });
    signedInAs("ben");
    const html = await render("ana");
    expect(html).toContain("<dt>Company</dt>");
    expect(html).toContain("Vinted &lt;b&gt;&amp;&lt;/b&gt; Co");
    const img = html.match(/<dd><img [^>]*>/)?.[0];
    expect(img).toBeDefined();
    for (const attribute of [
      `src="https://static.vinted.com/logo.svg?v=1&amp;s=32"`,
      `alt=""`,
      `width="32"`,
      `height="32"`,
      `loading="lazy"`,
      `referrerPolicy="no-referrer"`,
    ])
      expect(img).toContain(attribute);
  });

  it.each([
    ["over plain http", "http://vinted.com/logo.png"],
    ["on another domain", "https://cdn.example.net/vinted.png"],
    ["on a look-alike domain", "https://vinted.com.evil.example/logo.png"],
    ["with credentials", "https://user:secret@vinted.com/logo.png"],
    ["protocol-relative", "//vinted.com/logo.png"],
    ["as a script", "javascript:alert(1)"],
    ["inline as data", "data:image/png;base64,AAAA"],
  ])("leaves out a stored logo %s and still shows the name", async (_, logoUrl) => {
    addCompany("vinted.com", "Vinted", logoUrl);
    addPerson("ana", { companyDomain: "vinted.com" });
    signedInAs("ben");
    expect((await getProfile("ana"))?.company).toEqual({ domain: "vinted.com", name: "Vinted", logoUrl: null });
    const html = await render("ana");
    expect(html).not.toContain("<img");
    expect(html).toContain("Vinted");
  });

  it("shows no Company for someone who has not given one", async () => {
    addPerson("ana");
    signedInAs("ben");
    expect(await render("ana")).not.toContain("Company");
  });
});
