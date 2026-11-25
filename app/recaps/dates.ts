// A Matchday's date as people read it: "2026-11-29" is "Sunday, 29 November 2026". Dates are calendar days already,
// so no time zone moves them.
export const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
