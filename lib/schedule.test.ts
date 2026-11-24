import { describe, expect, it } from "vitest";
import { firstSeasonStart, matchdayStart, nextSeasonStart, seasonMatchdays, signUpsNeeded, vilniusDate } from "./schedule";

describe("signUpsNeeded", () => {
  it("needs all sixteen when nobody has signed up", () => {
    expect(signUpsNeeded(0)).toBe(16);
  });

  it("needs one more at fifteen", () => {
    expect(signUpsNeeded(15)).toBe(1);
  });

  it("needs none at exactly sixteen", () => {
    expect(signUpsNeeded(16)).toBeNull();
  });

  it("needs none past sixteen", () => {
    expect(signUpsNeeded(17)).toBeNull();
  });
});

// Expected instants were checked against Python's zoneinfo for Europe/Vilnius.
describe("matchdayStart", () => {
  it("is 20:00 Vilnius in winter time (UTC+2)", () => {
    expect(matchdayStart("2026-12-06").toISOString()).toBe("2026-12-06T18:00:00.000Z");
  });

  it("is 20:00 Vilnius in summer time (UTC+3)", () => {
    expect(matchdayStart("2027-06-06").toISOString()).toBe("2027-06-06T17:00:00.000Z");
  });

  it("is 20:00 Vilnius on the Sunday the clocks go back", () => {
    // 25 October 2026: 04:00 summer time becomes 03:00 winter time.
    expect(matchdayStart("2026-10-25").toISOString()).toBe("2026-10-25T18:00:00.000Z");
  });

  it("is 20:00 Vilnius on the Sunday the clocks go forward", () => {
    // 28 March 2027: 03:00 winter time becomes 04:00 summer time.
    expect(matchdayStart("2027-03-28").toISOString()).toBe("2027-03-28T17:00:00.000Z");
  });
});

describe("vilniusDate", () => {
  it("is the calendar day in Vilnius, not in UTC", () => {
    expect(vilniusDate(new Date("2026-12-06T22:30:00Z"))).toBe("2026-12-07");
    expect(vilniusDate(new Date("2026-12-06T21:59:00Z"))).toBe("2026-12-06");
  });
});

describe("firstSeasonStart", () => {
  // Fifteen early sign-ups, then the sixteenth at `at`.
  const signUps = (at: string) => [
    ...Array.from({ length: 15 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i, 12))),
    new Date(at),
  ];

  it("waits for sixteen sign-ups", () => {
    expect(firstSeasonStart(signUps("2026-12-02T12:00:00Z").slice(0, 15))).toBeNull();
    expect(firstSeasonStart([])).toBeNull();
  });

  it("is the first Sunday at least seven days after the sixteenth sign-up", () => {
    // Wednesday 2 December: seven days later is Wednesday 9 December.
    expect(firstSeasonStart(signUps("2026-12-02T12:00:00Z"))).toBe("2026-12-13");
  });

  it("uses the sixteenth sign-up in time, not in list order", () => {
    const list = signUps("2026-12-02T12:00:00Z").reverse();
    expect(firstSeasonStart(list)).toBe("2026-12-13");
    // A seventeenth sign-up changes nothing.
    expect(firstSeasonStart([...list, new Date("2026-12-20T12:00:00Z")])).toBe("2026-12-13");
  });

  it("counts a sign-up on a Sunday before 20:00 as a full week before the next Sunday", () => {
    // Sunday 6 December, 19:00 Vilnius: the Matchday on the 13th is seven days and an hour away.
    expect(firstSeasonStart(signUps("2026-12-06T17:00:00Z"))).toBe("2026-12-13");
  });

  it("counts a sign-up exactly at 20:00 on a Sunday as a full week before the next Sunday", () => {
    expect(firstSeasonStart(signUps("2026-12-06T18:00:00Z"))).toBe("2026-12-13");
  });

  it("waits an extra week after a sign-up late on a Sunday evening Vilnius time", () => {
    // Sunday 6 December, 21:30 Vilnius: the Matchday on the 13th is under seven days away.
    expect(firstSeasonStart(signUps("2026-12-06T19:30:00Z"))).toBe("2026-12-20");
    // Summer: Sunday 6 June 2027, 20:30 Vilnius.
    expect(firstSeasonStart(signUps("2027-06-06T17:30:00Z"))).toBe("2027-06-20");
  });

  it("uses the Vilnius day for a sign-up near midnight UTC", () => {
    // Sunday 22:30 UTC is already Monday 00:30 in Vilnius.
    expect(firstSeasonStart(signUps("2026-12-06T22:30:00Z"))).toBe("2026-12-20");
    // Saturday 23:30 UTC is Sunday 01:30 in Vilnius: the next Sunday is a week and 18.5 hours away.
    expect(firstSeasonStart(signUps("2026-12-05T23:30:00Z"))).toBe("2026-12-13");
  });
});

describe("seasonMatchdays", () => {
  it("is six consecutive Sundays", () => {
    expect(seasonMatchdays("2026-12-13")).toEqual(["2026-12-13", "2026-12-20", "2026-12-27", "2027-01-03", "2027-01-10", "2027-01-17"]);
  });

  it("runs a week longer for a skipped Sunday, which is not one of the six", () => {
    expect(seasonMatchdays("2026-12-13", ["2026-12-27"])).toEqual(["2026-12-13", "2026-12-20", "2027-01-03", "2027-01-10", "2027-01-17", "2027-01-24"]);
  });

  it("moves the start when the first Sunday is skipped", () => {
    expect(seasonMatchdays("2026-12-13", ["2026-12-13"])[0]).toBe("2026-12-20");
  });

  it("follows a start date set by the Organiser", () => {
    // An override is just a different start date; a weekday moves to the next Sunday.
    expect(seasonMatchdays("2027-02-07")).toEqual(["2027-02-07", "2027-02-14", "2027-02-21", "2027-02-28", "2027-03-07", "2027-03-14"]);
    expect(seasonMatchdays("2027-02-03")[0]).toBe("2027-02-07");
  });
});

describe("nextSeasonStart", () => {
  it("leaves a one-week break after the previous Season's last Matchday", () => {
    const last = seasonMatchdays("2026-12-13").at(-1)!; // Sunday 17 January
    expect(nextSeasonStart(last)).toBe("2027-01-31");
    // Sunday 24 January has no Matchday.
    expect(seasonMatchdays(nextSeasonStart(last))[0]).toBe("2027-01-31");
  });

  it("starts after the break even when the previous Season ran long", () => {
    const last = seasonMatchdays("2026-12-13", ["2026-12-27"]).at(-1)!; // Sunday 24 January
    expect(nextSeasonStart(last)).toBe("2027-02-07");
  });
});
