import { describe, expect, it } from "vitest";
import { MAX_SEASONS, matchdaysOfSeason, setSeasonStart, skipSunday, unskipSunday, upcomingMatchday, type Store, type StoredSeason } from "./seasons";

// An in-memory database. `added` counts attempts to store a Season automatically.
function fake(init: { seasons?: StoredSeason[]; skipped?: string[]; signUps?: Date[]; ingested?: string[] } = {}) {
  const db = {
    seasons: [...(init.seasons ?? [])],
    skipped: new Set(init.skipped),
    signUps: [...(init.signUps ?? [])],
    ingested: [...(init.ingested ?? [])],
    added: 0,
  };
  const store: Store = {
    seasons: async () => db.seasons.map((s) => ({ ...s })),
    skippedSundays: async () => [...db.skipped],
    signUpTimes: async () => [...db.signUps],
    addSeason: async (season) => {
      db.added++;
      if (!db.seasons.some((s) => s.number === season.number)) db.seasons.push({ ...season });
    },
    setStart: async (season) => {
      db.seasons = [...db.seasons.filter((s) => s.number !== season.number), { ...season }];
    },
    setSkipped: async (date, skipped) => void (skipped ? db.skipped.add(date) : db.skipped.delete(date)),
    ingestedDates: async () => [...db.ingested],
  };
  return { store, db };
}

const at = (iso: string) => new Date(iso);

// Fifteen sign-ups in November 2026, then the sixteenth on Wednesday 2 December: Season 1 starts Sunday 13 December.
const fifteen = Array.from({ length: 15 }, (_, i) => at(`2026-11-${String(i + 1).padStart(2, "0")}T12:00:00Z`));
const sixteenth = at("2026-12-02T12:00:00Z");
const seasonOne = (start = "2026-12-13"): StoredSeason[] => [{ number: 1, start }];
const beforeSeasonOne = at("2026-12-08T12:00:00Z");

describe("Season 1 from the sixteenth sign-up", () => {
  it("is not scheduled before the sixteenth sign-up", async () => {
    const { store, db } = fake({ signUps: fifteen });
    expect(await upcomingMatchday(beforeSeasonOne, store)).toBeNull();
    expect(await matchdaysOfSeason(1, beforeSeasonOne, store)).toBeNull();
    expect(db.seasons).toEqual([]);
  });

  it("is stored once the sixteenth sign-up arrives", async () => {
    const { store, db } = fake({ signUps: fifteen });
    await upcomingMatchday(beforeSeasonOne, store);
    db.signUps.push(sixteenth);
    expect(await upcomingMatchday(beforeSeasonOne, store)).toEqual({
      season: 1,
      number: 1,
      date: "2026-12-13",
      start: at("2026-12-13T18:00:00Z"),
    });
    expect(db.seasons).toEqual(seasonOne());
  });

  it("does not move when a seventeenth arrives or someone leaves", async () => {
    const { store, db } = fake({ signUps: [...fifteen, sixteenth] });
    await upcomingMatchday(beforeSeasonOne, store);
    db.signUps.push(at("2026-12-07T12:00:00Z"));
    expect((await upcomingMatchday(beforeSeasonOne, store))?.date).toBe("2026-12-13");
    // Worked out afresh, the sixteenth sign-up would now be on 7 December and Season 1 would start on the 20th.
    db.signUps.splice(db.signUps.indexOf(sixteenth), 1);
    expect((await upcomingMatchday(beforeSeasonOne, store))?.date).toBe("2026-12-13");
    // Fewer than sixteen left: still scheduled.
    db.signUps.splice(0, 5);
    expect((await upcomingMatchday(beforeSeasonOne, store))?.date).toBe("2026-12-13");
    expect(db.seasons).toEqual(seasonOne());
    expect(db.added).toBe(1);
  });

  it("is stored once when two requests notice the sixteenth sign-up at the same time", async () => {
    const { store, db } = fake({ signUps: [...fifteen, sixteenth] });
    const [first, second] = await Promise.all([upcomingMatchday(beforeSeasonOne, store), upcomingMatchday(beforeSeasonOne, store)]);
    expect(db.added).toBe(2); // both saw no Season 1 and tried to store it
    expect(db.seasons).toEqual(seasonOne());
    expect(first).toEqual(second);
  });

  it("starts a week after it is noticed if it is noticed too late for its Sunday", async () => {
    // Sixteen sign-ups on 1-16 October would mean Sunday 25 October, but nothing read the schedule until Tuesday 24 November.
    const october = Array.from({ length: 16 }, (_, i) => at(`2026-10-${String(i + 1).padStart(2, "0")}T12:00:00Z`));
    const { store, db } = fake({ signUps: october });
    const now = at("2026-11-24T12:00:00Z");
    expect(await upcomingMatchday(now, store)).toMatchObject({ season: 1, number: 1, date: "2026-12-06" });
    expect(db.seasons).toEqual(seasonOne("2026-12-06"));
    // Nothing has been played, so the Organiser can still move it.
    expect(await setSeasonStart(1, "2026-12-13", now, store)).toBeNull();
  });

  it("uses the Season 1 another request stored in the meantime", async () => {
    const { store, db } = fake({ signUps: [...fifteen, sixteenth] });
    const signUpTimes = store.signUpTimes;
    // The Organiser sets Season 1's start while this request is working out the automatic one.
    store.signUpTimes = async () => {
      db.seasons.push(...seasonOne("2026-12-20"));
      return signUpTimes();
    };
    expect((await upcomingMatchday(beforeSeasonOne, store))?.date).toBe("2026-12-20");
    expect(db.seasons).toEqual(seasonOne("2026-12-20"));
  });
});

describe("later Seasons", () => {
  it("start two weeks after the previous Season's last Matchday", async () => {
    const { store } = fake({ seasons: seasonOne() });
    expect(await matchdaysOfSeason(1, beforeSeasonOne, store)).toEqual(["2026-12-13", "2026-12-20", "2026-12-27", "2027-01-03", "2027-01-10", "2027-01-17"]);
    // Sunday 24 January is the week off.
    expect(await matchdaysOfSeason(2, beforeSeasonOne, store)).toEqual(["2027-01-31", "2027-02-07", "2027-02-14", "2027-02-21", "2027-02-28", "2027-03-07"]);
    expect((await matchdaysOfSeason(3, beforeSeasonOne, store))?.[0]).toBe("2027-03-21");
  });

  it("has no Season 0 or Season 1.5", async () => {
    const { store } = fake({ seasons: seasonOne() });
    expect(await matchdaysOfSeason(0, beforeSeasonOne, store)).toBeNull();
    expect(await matchdaysOfSeason(1.5, beforeSeasonOne, store)).toBeNull();
  });

  it("stop after Season 200, over twenty years in", async () => {
    const { store } = fake({ seasons: seasonOne() });
    expect(MAX_SEASONS).toBe(200);
    expect(await matchdaysOfSeason(200, beforeSeasonOne, store)).toHaveLength(6);
    expect(await matchdaysOfSeason(201, beforeSeasonOne, store)).toBeNull();
    expect(await matchdaysOfSeason(3e6, beforeSeasonOne, store)).toBeNull();
    expect(await upcomingMatchday(at("2100-01-01T12:00:00Z"), store)).toBeNull();
  });
});

describe("skipping a Sunday", () => {
  it("extends its Season by a week and moves the next Season back", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    expect(await skipSunday("2026-12-27", beforeSeasonOne, store)).toBeNull();
    expect(db.skipped).toEqual(new Set(["2026-12-27"]));
    expect(await matchdaysOfSeason(1, beforeSeasonOne, store)).toEqual(["2026-12-13", "2026-12-20", "2027-01-03", "2027-01-10", "2027-01-17", "2027-01-24"]);
    expect((await matchdaysOfSeason(2, beforeSeasonOne, store))?.[0]).toBe("2027-02-07");
    expect(await upcomingMatchday(at("2026-12-20T19:00:00Z"), store)).toMatchObject({ date: "2027-01-03", number: 3 });
  });

  it("can be undone", async () => {
    const { store } = fake({ seasons: seasonOne() });
    await skipSunday("2026-12-27", beforeSeasonOne, store);
    expect(await unskipSunday("2026-12-27", beforeSeasonOne, store)).toBeNull();
    expect((await matchdaysOfSeason(1, beforeSeasonOne, store))?.at(-1)).toBe("2027-01-17");
  });

  it("can be done before Season 1 is scheduled", async () => {
    const { store, db } = fake({ signUps: [...fifteen] });
    expect(await skipSunday("2026-12-13", beforeSeasonOne, store)).toBeNull();
    db.signUps.push(sixteenth);
    expect((await upcomingMatchday(beforeSeasonOne, store))?.date).toBe("2026-12-20");
  });

  it("is refused for a day that is not a Sunday", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    expect(await skipSunday("2026-12-16", beforeSeasonOne, store)).toBe("2026-12-16 is not a Sunday.");
    expect(await skipSunday("2026-02-29", beforeSeasonOne, store)).toMatch(/not a Sunday/); // 1 March 2026 is a Sunday
    expect(await skipSunday("13 December", beforeSeasonOne, store)).toMatch(/not a Sunday/);
    expect(db.skipped.size).toBe(0);
  });

  it("is refused for a Sunday whose Matchday time has passed", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    expect(await skipSunday("2026-12-13", at("2026-12-13T18:00:00Z"), store)).toBe("It is too late to change 2026-12-13.");
    expect(await skipSunday("2026-12-06", beforeSeasonOne, store)).toBe("It is too late to change 2026-12-06.");
    expect(db.skipped.size).toBe(0);
    // Earlier the same evening is still in time.
    expect(await skipSunday("2026-12-13", at("2026-12-13T17:59:00Z"), store)).toBeNull();
  });

  it("cannot be undone once the Sunday has passed", async () => {
    const { store, db } = fake({ seasons: seasonOne(), skipped: ["2026-12-20"] });
    expect(await unskipSunday("2026-12-20", at("2026-12-21T12:00:00Z"), store)).toMatch(/too late/);
    expect(db.skipped).toEqual(new Set(["2026-12-20"]));
  });

  it("may use up the week off before a Season whose start was set by hand", async () => {
    // Season 2 set to where it would have started anyway; the skip makes Season 1 end the Sunday before it.
    const { store } = fake({ seasons: [...seasonOne(), { number: 2, start: "2027-01-31" }] });
    expect(await skipSunday("2026-12-27", beforeSeasonOne, store)).toBeNull();
    expect((await matchdaysOfSeason(1, beforeSeasonOne, store))?.at(-1)).toBe("2027-01-24");
    expect((await matchdaysOfSeason(2, beforeSeasonOne, store))?.[0]).toBe("2027-01-31");
  });

  it("is refused for a Sunday more than two years ahead", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    expect(await skipSunday("2028-12-10", beforeSeasonOne, store)).toBe("2028-12-10 is more than two years ahead.");
    expect(await unskipSunday("2028-12-10", beforeSeasonOne, store)).toMatch(/two years/);
    expect(db.skipped.size).toBe(0);
    expect(await skipSunday("2028-12-03", beforeSeasonOne, store)).toBeNull();
  });

  it("is refused if its Season would run into a Season whose start was set by hand", async () => {
    // Season 2 set to start the Sunday after Season 1's last Matchday, with no week off.
    const { store, db } = fake({ seasons: [...seasonOne(), { number: 2, start: "2027-01-24" }] });
    expect(await skipSunday("2026-12-27", beforeSeasonOne, store)).toBe("Season 2 would start before Season 1 has finished.");
    expect(db.skipped.size).toBe(0);
  });
});

describe("setting a Season's start by hand", () => {
  it("moves a Season that has not started, and the Seasons after it", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    expect(await setSeasonStart(1, "2027-01-10", beforeSeasonOne, store)).toBeNull();
    expect(db.seasons).toEqual(seasonOne("2027-01-10"));
    expect((await matchdaysOfSeason(1, beforeSeasonOne, store))?.[0]).toBe("2027-01-10");
    expect((await matchdaysOfSeason(2, beforeSeasonOne, store))?.[0]).toBe("2027-02-28");
  });

  it("moves the next Season while the current one is under way", async () => {
    const { store } = fake({ seasons: seasonOne() });
    expect(await setSeasonStart(2, "2027-02-14", at("2027-01-04T12:00:00Z"), store)).toBeNull();
    expect((await matchdaysOfSeason(2, beforeSeasonOne, store))?.[0]).toBe("2027-02-14");
    expect((await matchdaysOfSeason(3, beforeSeasonOne, store))?.[0]).toBe("2027-04-04");
    // A Season may follow the previous one without a week off.
    expect(await setSeasonStart(2, "2027-01-24", at("2027-01-04T12:00:00Z"), store)).toBeNull();
  });

  it("can schedule Season 1 before the sixteenth sign-up, which then leaves it alone", async () => {
    const { store, db } = fake({ signUps: fifteen });
    expect(await setSeasonStart(1, "2027-01-03", beforeSeasonOne, store)).toBeNull();
    expect((await upcomingMatchday(beforeSeasonOne, store))?.date).toBe("2027-01-03");
    db.signUps.push(sixteenth);
    expect((await upcomingMatchday(beforeSeasonOne, store))?.date).toBe("2027-01-03");
    expect(db.seasons).toEqual(seasonOne("2027-01-03"));
  });

  it("is refused for a day that is not a Sunday", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    expect(await setSeasonStart(1, "2026-12-14", beforeSeasonOne, store)).toBe("2026-12-14 is not a Sunday.");
    expect(db.seasons).toEqual(seasonOne());
  });

  it("is refused once the Season has started", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    // Two Matchdays played.
    expect(await setSeasonStart(1, "2027-01-03", at("2026-12-21T12:00:00Z"), store)).toBe("That would move Matchdays already played.");
    expect(db.seasons).toEqual(seasonOne());
  });

  it("is refused for a Sunday that has passed", async () => {
    const { store, db } = fake({ signUps: fifteen });
    expect(await setSeasonStart(1, "2026-11-22", beforeSeasonOne, store)).toBe("It is too late to change 2026-11-22.");
    expect(db.seasons).toEqual([]);
  });

  it("is refused if the Season would start before the previous one has finished", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    expect(await setSeasonStart(2, "2027-01-17", beforeSeasonOne, store)).toBe("Season 2 would start before Season 1 has finished.");
    // Nor may moving a Season run it into a later one whose start was set by hand.
    await setSeasonStart(2, "2027-01-31", beforeSeasonOne, store);
    expect(await setSeasonStart(1, "2026-12-27", beforeSeasonOne, store)).toBe("Season 2 would start before Season 1 has finished.");
    expect(db.seasons).toEqual([...seasonOne(), { number: 2, start: "2027-01-31" }]);
  });

  it("is refused for a later Season while Season 1 is not scheduled, and for a Season that cannot exist", async () => {
    const { store, db } = fake({ signUps: fifteen });
    expect(await setSeasonStart(2, "2027-03-07", beforeSeasonOne, store)).toBe("Season 1 is not scheduled yet.");
    expect(await setSeasonStart(0, "2027-03-07", beforeSeasonOne, store)).toBe("There is no Season 0.");
    expect(await setSeasonStart(1.5, "2027-03-07", beforeSeasonOne, store)).toBe("There is no Season 1.5.");
    expect(await setSeasonStart(201, "2027-03-07", beforeSeasonOne, store)).toBe("There is no Season 201.");
    expect(await setSeasonStart(200000, "2027-03-07", beforeSeasonOne, store)).toBe("There is no Season 200000.");
    expect(db.seasons).toEqual([]);
  });

  it("is refused for a Sunday more than two years ahead", async () => {
    const { store, db } = fake({ seasons: seasonOne() });
    expect(await setSeasonStart(1, "9999-12-26", beforeSeasonOne, store)).toBe("9999-12-26 is more than two years ahead.");
    expect(await setSeasonStart(1, "2028-12-10", beforeSeasonOne, store)).toMatch(/two years/);
    expect(db.seasons).toEqual(seasonOne());
  });
});

// A tournament made by hand can be ingested before its Sunday's 20:00, so the start alone does not say a Matchday has
// been played. Season 1 here runs 13 December to 17 January; 24 January is the week off.
describe("a change to the schedule, once a Matchday is ingested", () => {
  const noon = (date: string) => at(`${date}T10:00:00Z`);

  it("is refused if it would take that day's Matchday out of its Season", async () => {
    const { store, db } = fake({ seasons: seasonOne(), ingested: ["2026-12-13", "2026-12-20"] });
    expect(await skipSunday("2026-12-20", noon("2026-12-20"), store)).toBe(
      "That would change which Season the Matchday of 2026-12-20, already played, belongs to.",
    );
    expect(db.skipped.size).toBe(0);
  });

  it("is refused if it would pull a Matchday played in the week off into the next Season", async () => {
    const { store, db } = fake({ seasons: seasonOne(), ingested: ["2027-01-17", "2027-01-24"] });
    expect(await setSeasonStart(2, "2027-01-24", noon("2027-01-24"), store)).toMatch(/Matchday of 2027-01-24, already played/);
    expect(db.seasons).toEqual(seasonOne());
    // Without that Matchday the same change is allowed.
    const without = fake({ seasons: seasonOne(), ingested: ["2027-01-17"] });
    expect(await setSeasonStart(2, "2027-01-24", noon("2027-01-24"), without.store)).toBeNull();
  });

  it("goes through if every ingested Matchday keeps its Season and place", async () => {
    const { store, db } = fake({ seasons: seasonOne(), ingested: ["2026-12-13", "2026-12-20"] });
    expect(await skipSunday("2027-01-10", noon("2026-12-20"), store)).toBeNull();
    expect(await setSeasonStart(2, "2027-02-14", noon("2026-12-20"), store)).toBeNull();
    expect([...db.skipped]).toEqual(["2027-01-10"]);
  });
});

describe("upcomingMatchday", () => {
  const { store } = fake({ seasons: seasonOne() });
  const upcoming = async (iso: string) => {
    const next = await upcomingMatchday(at(iso), store);
    return next && { ...next, start: next.start.toISOString() };
  };

  it("is that evening's on a Matchday before 20:00 Vilnius time", async () => {
    // 19:59 in Vilnius (UTC+2).
    expect(await upcoming("2026-12-13T17:59:00Z")).toEqual({ season: 1, number: 1, date: "2026-12-13", start: "2026-12-13T18:00:00.000Z" });
  });

  it("is the next Sunday's from 20:00 Vilnius time on a Matchday", async () => {
    expect(await upcoming("2026-12-13T18:00:00Z")).toEqual({ season: 1, number: 2, date: "2026-12-20", start: "2026-12-20T18:00:00.000Z" });
  });

  it("is the next Season's first once the last Matchday of a Season has started", async () => {
    expect(await upcoming("2027-01-17T17:59:00Z")).toMatchObject({ season: 1, number: 6, date: "2027-01-17" });
    expect(await upcoming("2027-01-17T18:00:00Z")).toMatchObject({ season: 2, number: 1, date: "2027-01-31" });
  });

  it("is the next Season's first during the week off", async () => {
    expect(await upcoming("2027-01-24T18:30:00Z")).toMatchObject({ season: 2, number: 1, date: "2027-01-31" });
  });

  it("starts at 20:00 Vilnius time across the change to summer time", async () => {
    const { store } = fake({ seasons: seasonOne("2027-03-14") });
    // Sunday 28 March 2027: from 04:00 Vilnius is UTC+3, so 17:30 UTC is 20:30 and that evening's has started.
    expect(await upcomingMatchday(at("2027-03-21T18:30:00Z"), store)).toMatchObject({ date: "2027-03-28", start: at("2027-03-28T17:00:00Z") });
    expect(await upcomingMatchday(at("2027-03-28T16:59:00Z"), store)).toMatchObject({ date: "2027-03-28" });
    expect(await upcomingMatchday(at("2027-03-28T17:30:00Z"), store)).toMatchObject({ date: "2027-04-04", start: at("2027-04-04T17:00:00Z") });
  });

  it("starts at 20:00 Vilnius time across the change to winter time", async () => {
    const { store } = fake({ seasons: seasonOne("2027-10-17") });
    // Sunday 31 October 2027: from 04:00 Vilnius is back to UTC+2, so 17:30 UTC is 19:30 and that evening's is still to come.
    expect(await upcomingMatchday(at("2027-10-24T17:30:00Z"), store)).toMatchObject({ date: "2027-10-31", start: at("2027-10-31T18:00:00Z") });
    expect(await upcomingMatchday(at("2027-10-31T17:30:00Z"), store)).toMatchObject({ date: "2027-10-31" });
    expect(await upcomingMatchday(at("2027-10-31T18:00:00Z"), store)).toMatchObject({ date: "2027-11-07", start: at("2027-11-07T18:00:00Z") });
  });
});
