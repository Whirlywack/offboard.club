// Giving a Company by its website on the Profile form, and seeing it on the Profile. The session, the database and the
// fetch of a Company's website are faked; everything else is the app's own code.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfile } from "@/lib/auth";
import { currentCompany, FETCH_ATTEMPTS, NEW_COMPANIES_PER_DAY } from "@/lib/companies";
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
// "member" has finished the welcome step and connected Lichess, "welcomed" has not connected Lichess, "unwelcomed" has
// not finished the welcome step.
type Stage = "member" | "welcomed" | "unwelcomed";
const session = (id: string, how: Stage = "member") => ({
  user: {
    id,
    publicDisplayConsentAt: how === "unwelcomed" ? null : at,
    houseRulesAcceptedAt: how === "unwelcomed" ? null : at,
    lichessId: how === "member" ? `lichess-${id}` : null,
  },
});
const signedInAs = (id: string, how: Stage = "member") => getSession.mockResolvedValue(session(id, how));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const save = (fields: Record<string, string>) => saveProfile(null, form(fields));
const saved = (id: string) => `redirect /profiles/${id}`;
const stored = () => [...companies.values()].map(({ domain, name, logoUrl }) => ({ domain, name, logoUrl }));
const createdToday = (id: string) => people.get(id)?.companiesCreatedThatDay;

const notAWebsite = "That doesn't look like a public website address. Try one like vinted.com.";
const vinted = { name: "Vinted", logoUrl: "https://www.vinted.com/favicon.ico" };
// What fetchCompanyMeta gives for a website that fails, refuses or has no name.
const fallback = async (domain: string) => ({ name: domain, logoUrl: null });

beforeEach(() => {
  resetDb();
  getSession.mockReset().mockResolvedValue(null);
  fetchMeta.mockReset().mockImplementation(fallback);
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
    expect(stored()).toEqual([{ domain: "vinted.com", ...vinted }]);
    expect(companies.get("vinted.com")?.fetchedAt).not.toBeNull();
    expect(people.get("ana")).toMatchObject({ companyDomain: "vinted.com", companiesCreatedThatDay: 1 });
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
    expect(stored()).toEqual([{ domain: "vinted.com", ...vinted }]);
    expect(people.get("ben")?.companyDomain).toBe("vinted.com");
    // Joining a Company that exists does not count towards the day's new Companies.
    expect(createdToday("ben")).toBe(0);
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
        problems: { companyWebsite: notAWebsite },
        typed: { companyWebsite: website, position: "Engineer", linkedInUrl: "", openTo: "" },
      });
      expect(db.query).not.toHaveBeenCalled();
      expect(fetchMeta).not.toHaveBeenCalled();
      expect(people.get("ana")).toMatchObject({ companyDomain: "vinted.com", position: "CTO" });
    },
  );

  it("creates no Company and fetches nothing when another field is refused, and says nothing of the website", async () => {
    addPerson("ana");
    signedInAs("ana");
    await expect(save({ companyWebsite: "vinted.com", position: "p".repeat(81) })).resolves.toEqual({
      problems: { position: expect.stringMatching(/80 characters/) },
      typed: { companyWebsite: "vinted.com", position: "p".repeat(81), linkedInUrl: "", openTo: "" },
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
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    expect(await currentCompany("ana")).toEqual({ domain: "vinted.com", name: "vinted.com" });
    expect(companies.get("vinted.com")?.fetchedAt).toBeNull();
  });

  it("still saves if the fetch throws", async () => {
    addPerson("ana");
    signedInAs("ana");
    fetchMeta.mockRejectedValue(new Error("unexpected"));
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    expect(stored()).toEqual([{ domain: "vinted.com", name: "vinted.com", logoUrl: null }]);
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

  it("is tried again by the next person to give it a minute later, which costs them no new Company", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
    addPerson("ana");
    addPerson("ben");
    signedInAs("ana");
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    expect(fetchMeta).toHaveBeenCalledTimes(1);

    // Within the minute, joining does not fetch again.
    signedInAs("ben");
    vi.setSystemTime(new Date("2026-11-24T12:00:59Z"));
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ben"));
    expect(fetchMeta).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-24T12:01:01Z"));
    fetchMeta.mockResolvedValue(vinted);
    await expect(save({ companyWebsite: "www.vinted.com" })).rejects.toThrow(saved("ben"));
    expect(fetchMeta).toHaveBeenCalledTimes(2);
    expect(stored()).toEqual([{ domain: "vinted.com", ...vinted }]);
    expect(createdToday("ben")).toBe(0);

    // Once fetched, the Company is never fetched again, however long after.
    vi.setSystemTime(new Date("2026-12-24T12:00:00Z"));
    fetchMeta.mockResolvedValue({ name: "Not Vinted", logoUrl: null });
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ben"));
    expect(fetchMeta).toHaveBeenCalledTimes(2);
    expect(stored()).toEqual([{ domain: "vinted.com", ...vinted }]);
  });

  it("is retried by only one of several people joining it at once, after a save that never finished naming it", async () => {
    // As left by a server that stopped between creating the Company and naming it.
    addCompany("vinted.com", "vinted.com", null, { fetchedAt: null, fetchTriedAt: new Date(Date.now() - 120_000) });
    for (const id of ["ana", "ben", "cy"]) addPerson(id);
    for (const id of ["ana", "ben", "cy"]) getSession.mockResolvedValueOnce(session(id));
    fetchMeta.mockResolvedValue(vinted);
    await Promise.all(
      ["ana", "ben", "cy"].map((id) => expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved(id))),
    );
    expect(fetchMeta).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([{ domain: "vinted.com", ...vinted }]);
    expect(companies.get("vinted.com")?.fetchAttempts).toBe(2);
  });

  it(`is fetched ${FETCH_ATTEMPTS} times in all, a minute or more apart, and then keeps its domain as its name`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
    addPerson("ana");
    signedInAs("ana");
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    for (const time of ["12:00:30", "12:01:01", "12:01:59", "12:02:02", "12:03:03", "12:10:00"]) {
      vi.setSystemTime(new Date(`2026-11-24T${time}Z`));
      await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    }
    // At 12:00 when created, 12:01:01 and 12:02:02; never at 12:00:30 or 12:01:59, too soon, nor after the third.
    expect(fetchMeta).toHaveBeenCalledTimes(FETCH_ATTEMPTS);
    vi.setSystemTime(new Date("2027-11-24T12:00:00Z"));
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    expect(fetchMeta).toHaveBeenCalledTimes(FETCH_ATTEMPTS);
    expect(companies.get("vinted.com")).toMatchObject({ name: "vinted.com", fetchedAt: null, fetchAttempts: FETCH_ATTEMPTS });
  });

  it("is not fetched again once an attempt has named it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
    addPerson("ana");
    signedInAs("ana");
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    fetchMeta.mockResolvedValue(vinted);
    vi.setSystemTime(new Date("2026-11-24T12:01:01Z"));
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    for (const time of ["12:02:02", "12:03:03", "13:00:00"]) {
      vi.setSystemTime(new Date(`2026-11-24T${time}Z`));
      await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    }
    expect(fetchMeta).toHaveBeenCalledTimes(2);
    expect(companies.get("vinted.com")).toMatchObject({ ...vinted, fetchAttempts: 2 });
  });
});

describe("two people giving the same new website at once", () => {
  it("makes one Company, fetched once, with both of them in it, and only its creator charged for it", async () => {
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
    expect(stored()).toEqual([{ domain: "vinted.com", ...vinted }]);
    expect(fetchMeta).toHaveBeenCalledTimes(1);
    expect(people.get("ana")?.companyDomain).toBe("vinted.com");
    expect(people.get("ben")?.companyDomain).toBe("vinted.com");
    expect([createdToday("ana"), createdToday("ben")].sort()).toEqual([0, 1]);
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

    vi.setSystemTime(new Date("2026-11-24T09:00:30Z"));
    await expect(save({ companyWebsite: "company6.com", position: "CTO" })).resolves.toMatchObject({
      problems: { companyWebsite: expect.stringMatching(/already added 5 new Companies today/) },
    });
    expect(fetchMeta).toHaveBeenCalledTimes(NEW_COMPANIES_PER_DAY);
    expect(companies.has("company6.com")).toBe(false);
    expect(people.get("ana")).toMatchObject({ companyDomain: "company5.com", position: null });

    // Companies that exist are still open to her, and cost nothing.
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(saved("ana"));
    await expect(save({ companyWebsite: "company1.com" })).rejects.toThrow(saved("ana"));
    expect(fetchMeta).toHaveBeenCalledTimes(NEW_COMPANIES_PER_DAY);

    // Still refused at the very end of the UTC day; the next day starts a new count.
    vi.setSystemTime(new Date("2026-11-24T23:59:59Z"));
    await expect(save({ companyWebsite: "company6.com" })).resolves.toMatchObject({ problems: { companyWebsite: expect.any(String) } });
    vi.setSystemTime(new Date("2026-11-25T00:00:01Z"));
    await expect(save({ companyWebsite: "company6.com" })).rejects.toThrow(saved("ana"));
    expect(people.get("ana")).toMatchObject({ companyDomain: "company6.com", companiesCreatedThatDay: 1 });
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
    addPerson("una", { publicDisplayConsentAt: null, houseRulesAcceptedAt: null, lichessId: null });
    signedInAs("una", "unwelcomed");
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(/^redirect \/welcome$/);
    expect(db.query).not.toHaveBeenCalled();
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it("sends a caller who has not connected Lichess to the connect step without writing or fetching anything", async () => {
    addPerson("lin", { lichessId: null });
    signedInAs("lin", "welcomed");
    await expect(save({ companyWebsite: "vinted.com" })).rejects.toThrow(/^redirect \/welcome\/lichess$/);
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

  it("shows the name as text with the domain beside it, which a look-alike website cannot borrow, and no logo", async () => {
    addCompany("vinted-careers.com", "Vinted <b>&</b> Co", "https://vinted-careers.com/logo.svg");
    addPerson("ana", { companyDomain: "vinted-careers.com" });
    signedInAs("ben");
    const html = await render("ana");
    expect(html).toContain("<dt>Company</dt><dd>Vinted &lt;b&gt;&amp;&lt;/b&gt; Co (vinted-careers.com)</dd>");
    expect(html).not.toContain("<img");
  });

  it("shows the domain once when it is also the name", async () => {
    addCompany("vinted.com", "vinted.com");
    addPerson("ana", { companyDomain: "vinted.com" });
    signedInAs("ben");
    expect(await render("ana")).toContain("<dd>vinted.com</dd>");
  });

  it("shows no Company for someone who has not given one", async () => {
    addPerson("ana");
    signedInAs("ben");
    expect(await render("ana")).not.toContain("Company");
  });

  it("says that someone has added nothing else, to them and to other Members", async () => {
    addPerson("ana");
    signedInAs("ben");
    expect(await render("ana")).toContain(">Person hasn&#x27;t added anything else yet.</p>");
    signedInAs("ana");
    expect(await render("ana")).toContain(">You haven&#x27;t added anything else yet.</p>");
  });

  it.each([
    ["over plain http", "http://vinted.com/logo.png"],
    ["on another domain", "https://cdn.example.net/vinted.png"],
    ["on a look-alike domain", "https://vinted.com.evil.example/logo.png"],
    ["with credentials", "https://user:secret@vinted.com/logo.png"],
    ["protocol-relative", "//vinted.com/logo.png"],
    ["as a script", "javascript:alert(1)"],
  ])("gives no logo address for a stored logo %s", async (_, logoUrl) => {
    addCompany("vinted.com", "Vinted", logoUrl);
    addPerson("ana", { companyDomain: "vinted.com" });
    expect((await getProfile("ana"))?.company).toEqual({ domain: "vinted.com", name: "Vinted", logoUrl: null });
  });

  it("gives the logo address of one on the Company's own domain", async () => {
    addCompany("vinted.com", "Vinted", "https://static.vinted.com/logo.svg");
    addPerson("ana", { companyDomain: "vinted.com" });
    expect((await getProfile("ana"))?.company?.logoUrl).toBe("https://static.vinted.com/logo.svg");
  });
});
