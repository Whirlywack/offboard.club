// The pages shown when an address has nothing behind it or a page fails, in the words of the reading deck (#74): the
// site's not-found page, a Profile, Recap or Season that is not there, and the two error pages.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PageError from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";
import NoProfile from "./profiles/[id]/not-found";
import NoRecap from "./recaps/[date]/not-found";
import NoSeason from "./seasons/[number]/not-found";

// The address the error page is shown at, which its header depends on.
const at = vi.hoisted(() => ({ path: null as string | null }));
vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), usePathname: () => at.path }));

// The words a reader reads, top to bottom.
const words = (element: ReactElement) =>
  renderToStaticMarkup(element).replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ").trim();

describe("a page that is not there", () => {
  it("is said plainly for any address the site does not have", () => {
    expect(words(NotFound())).toBe("Nothing at this address The address may have a typo in it. Home Recaps");
  });

  it("is said for a Profile, a Recap and a Season in their own words", () => {
    expect(words(NoProfile())).toBe("No Profile at this address The person may still be signing up, or may have left the Club. Recaps Home");
    expect(words(NoRecap())).toBe(
      "No Recap for that Sunday There was no Matchday that day, or its results aren't in yet. All Recaps Home",
    );
    expect(words(NoSeason())).toBe(
      "That Season's dates aren't set yet Season Leaderboard This Season's Leaderboard All-time Leaderboard Home",
    );
  });
});

describe("a page that failed", () => {
  const retry = () => {};

  it("says so, offers to try again, and gives the reference the server's logs have", () => {
    const failed = Object.assign(new Error("a pretend failure"), { digest: "4259457142" });
    expect(words(createElement(PageError, { error: failed, retry }))).toBe(
      "This page didn't load Something broke on our side. Try again now or in a few minutes. Try again Home Error reference: 4259457142",
    );
    expect(words(createElement(PageError, { error: null, retry }))).not.toContain("Error reference");
  });

  it("has the site's header at the home page's address, where the root layout leaves its own out", () => {
    const failed = () => words(createElement(PageError, { error: null, retry }));
    at.path = "/";
    expect(failed()).toMatch(/^Offboard Season All-time Recaps This page didn't load /);
    at.path = "/profiles/ana";
    expect(failed()).toMatch(/^This page didn't load /);
    at.path = null;
  });

  it("says the same when the whole site fails, with the site's name, as it has no header", () => {
    expect(words(createElement(GlobalError, { error: null, retry }))).toBe(
      "Something went wrong | Offboard Offboard This page didn't load Something broke on our side. Try again now or in a few minutes. Try again Home Privacy and terms",
    );
  });
});
