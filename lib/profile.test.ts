import { describe, expect, it } from "vitest";
import { linkedInProfileUrl, OPEN_TO_MAX, POSITION_MAX, readProfileForm } from "./profile";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe("linkedInProfileUrl", () => {
  it.each([
    ["https://www.linkedin.com/in/some-handle", "https://www.linkedin.com/in/some-handle"],
    ["https://www.linkedin.com/in/some-handle/", "https://www.linkedin.com/in/some-handle"],
    ["https://www.linkedin.com/in/some-handle?trk=public_profile&utm_source=share", "https://www.linkedin.com/in/some-handle"],
    ["https://www.linkedin.com/in/some-handle/#experience", "https://www.linkedin.com/in/some-handle"],
    ["https://lt.linkedin.com/in/some-handle", "https://www.linkedin.com/in/some-handle"],
    ["https://linkedin.com/in/some-handle", "https://www.linkedin.com/in/some-handle"],
    ["HTTPS://WWW.LINKEDIN.COM/in/Some-Handle", "https://www.linkedin.com/in/Some-Handle"],
    ["  https://www.linkedin.com/in/some-handle  ", "https://www.linkedin.com/in/some-handle"],
    ["https://www.linkedin.com:443/in/some-handle", "https://www.linkedin.com/in/some-handle"],
    ["https://www.linkedin.com/in/some-handle/details/experience/", "https://www.linkedin.com/in/some-handle"],
    ["https://www.linkedin.com/in/jonas_petraitis-1a2b3c", "https://www.linkedin.com/in/jonas_petraitis-1a2b3c"],
  ])("accepts %j as %j", (input, normalised) => {
    expect(linkedInProfileUrl(input)).toBe(normalised);
  });

  it.each([
    ["www.linkedin.com/in/some-handle", "https://www.linkedin.com/in/some-handle"],
    ["linkedin.com/in/some-handle", "https://www.linkedin.com/in/some-handle"],
    ["lt.linkedin.com/in/some-handle/", "https://www.linkedin.com/in/some-handle"],
  ])("adds https to %j, which has no scheme", (input, normalised) => {
    expect(linkedInProfileUrl(input)).toBe(normalised);
  });

  it("keeps a handle with letters beyond ASCII, percent-encoded or not, in one form", () => {
    const stored = "https://www.linkedin.com/in/%C5%BEygimantas-%C4%8Dep%C4%97";
    expect(linkedInProfileUrl("https://www.linkedin.com/in/žygimantas-čepė")).toBe(stored);
    expect(linkedInProfileUrl(stored)).toBe(stored);
    expect(linkedInProfileUrl("https://www.linkedin.com/in/%c5%bEygimantas-%c4%8dep%c4%97")).toBe(stored);
  });

  it("refuses http: the address must be https", () => {
    expect(linkedInProfileUrl("http://www.linkedin.com/in/some-handle")).toBeNull();
  });

  it.each([
    "https://www.linkedin.com/company/x",
    "https://www.linkedin.com/school/x",
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/pub/dir/x",
    "https://www.linkedin.com/x/in/some-handle",
    "https://www.linkedin.com/IN/some-handle",
  ])("refuses %j, which is not a profile", (input) => {
    expect(linkedInProfileUrl(input)).toBeNull();
  });

  it.each([
    "https://www.linkedin.com",
    "https://www.linkedin.com/",
    "https://www.linkedin.com/in",
    "https://www.linkedin.com/in/",
    "https://www.linkedin.com/in//",
    "linkedin.com",
  ])("refuses %j, which has no handle", (input) => {
    expect(linkedInProfileUrl(input)).toBeNull();
  });

  it.each([
    "https://linkedin.com.evil.com/in/some-handle",
    "https://evil.com/in/some-handle",
    "evil.com/in/some-handle",
    "https://notlinkedin.com/in/some-handle",
    "https://linkedin.co/in/some-handle",
    "https://www.linkedin.com.evil.com/in/some-handle",
    "https://www.linkedin.com./in/some-handle",
    "https://www.linkedın.com/in/some-handle",
    "//evil.com/in/some-handle",
    "https://evil.com\\@www.linkedin.com/in/some-handle",
    "https://evil.com/https://www.linkedin.com/in/some-handle",
  ])("refuses %j, which is not on linkedin.com", (input) => {
    expect(linkedInProfileUrl(input)).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "javascript://www.linkedin.com/in/some-handle%0Aalert(1)",
    "JavaScript:alert(document.cookie)//www.linkedin.com/in/x",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "ftp://www.linkedin.com/in/some-handle",
    "mailto:someone@linkedin.com",
  ])("refuses %j, which is not https", (input) => {
    expect(linkedInProfileUrl(input)).toBeNull();
  });

  it.each([
    "https://www.linkedin.com@evil.com/in/some-handle",
    "https://user:password@www.linkedin.com/in/some-handle",
    "https://user@www.linkedin.com/in/some-handle",
    "https://www.linkedin.com:password@evil.com/in/some-handle",
  ])("refuses %j, which carries a user name or password", (input) => {
    expect(linkedInProfileUrl(input)).toBeNull();
  });

  it("refuses a port other than https's own", () => {
    expect(linkedInProfileUrl("https://www.linkedin.com:8443/in/some-handle")).toBeNull();
  });

  it.each([
    "https://www.linkedin.com/in/some.handle",
    "https://www.linkedin.com/in/some%2Fhandle",
    "https://www.linkedin.com/in/<script>",
    "https://www.linkedin.com/in/%22onmouseover=%22alert(1)",
    "https://www.linkedin.com/in/some handle",
    "https://www.linkedin.com/in/%E0%A4%A",
    "https://www.linkedin.com/in/..",
  ])("refuses %j, whose handle is not one LinkedIn gives out", (input) => {
    expect(linkedInProfileUrl(input)).toBeNull();
  });

  it("accepts a handle up to LinkedIn's 100 characters and refuses a longer one", () => {
    expect(linkedInProfileUrl(`https://www.linkedin.com/in/${"a".repeat(100)}`)).not.toBeNull();
    expect(linkedInProfileUrl(`https://www.linkedin.com/in/${"a".repeat(101)}`)).toBeNull();
  });

  it("refuses over-long input before looking at it", () => {
    expect(linkedInProfileUrl(`https://www.linkedin.com/in/some-handle?${"x".repeat(1000)}`)).toBeNull();
    expect(linkedInProfileUrl("x".repeat(100_000))).toBeNull();
  });

  it("refuses empty input", () => {
    expect(linkedInProfileUrl("")).toBeNull();
    expect(linkedInProfileUrl("   ")).toBeNull();
  });
});

describe("readProfileForm", () => {
  it("trims each field and normalises the link", () => {
    expect(
      readProfileForm(
        form({
          companyWebsite: " https://www.Vinted.com/careers ",
          position: "  Backend engineer ",
          linkedInUrl: " lt.linkedin.com/in/jonas/ ",
          openTo: " coffee chats ",
        }),
      ),
    ).toEqual({
      // The website is only tidied here; lib/companies.ts turns it into a Company.
      companyWebsite: "https://www.Vinted.com/careers",
      position: "Backend engineer",
      linkedInUrl: "https://www.linkedin.com/in/jonas",
      openTo: "coffee chats",
    });
  });

  it("treats empty and whitespace-only fields as cleared", () => {
    expect(readProfileForm(form({ companyWebsite: " ", position: "", linkedInUrl: "  ", openTo: "\n\t" }))).toEqual({
      companyWebsite: null,
      position: null,
      linkedInUrl: null,
      openTo: null,
    });
  });

  it("treats missing fields as cleared", () => {
    expect(readProfileForm(form({}))).toEqual({ companyWebsite: null, position: null, linkedInUrl: null, openTo: null });
  });

  it("makes each run of whitespace or control characters inside a field one space", () => {
    expect(readProfileForm(form({ position: "Data\n\n  engineer\u0000at\tnight" }))).toMatchObject({
      position: "Data engineer at night",
    });
  });

  it("keeps text as typed, markup included, for the page to show as text", () => {
    expect(readProfileForm(form({ openTo: "<b>pairing</b> & \"talks\"" }))).toMatchObject({
      openTo: "<b>pairing</b> & \"talks\"",
    });
  });

  it(`accepts a position of ${POSITION_MAX} characters and refuses one more`, () => {
    expect(readProfileForm(form({ position: "p".repeat(POSITION_MAX) }))).toMatchObject({ position: "p".repeat(80) });
    expect(readProfileForm(form({ position: "p".repeat(POSITION_MAX + 1) }))).toMatch(/80 characters/);
  });

  it(`accepts an "open to" line of ${OPEN_TO_MAX} characters and refuses one more`, () => {
    expect(readProfileForm(form({ openTo: "o".repeat(OPEN_TO_MAX) }))).toMatchObject({ openTo: "o".repeat(140) });
    expect(readProfileForm(form({ openTo: "o".repeat(OPEN_TO_MAX + 1) }))).toMatch(/140 characters/);
  });

  it("counts characters, not UTF-16 units, so letters such as ž and emoji count as one", () => {
    expect(readProfileForm(form({ position: "ž".repeat(POSITION_MAX) }))).not.toBeTypeOf("string");
    expect(readProfileForm(form({ position: "🙂".repeat(POSITION_MAX) }))).not.toBeTypeOf("string");
    expect(readProfileForm(form({ openTo: "🙂".repeat(OPEN_TO_MAX + 1) }))).toBeTypeOf("string");
  });

  it("measures length after trimming", () => {
    expect(readProfileForm(form({ position: ` ${"p".repeat(POSITION_MAX)} ` }))).not.toBeTypeOf("string");
  });

  it("refuses a link that is not a LinkedIn profile address with a plain message", () => {
    expect(readProfileForm(form({ linkedInUrl: "https://evil.com/in/x" }))).toMatch(
      /^That isn't a LinkedIn profile address\./,
    );
    expect(readProfileForm(form({ linkedInUrl: "javascript:alert(1)" }))).toBeTypeOf("string");
  });

  it.each(["200B", "200C", "200E", "200F", "202A", "202B", "202C", "202D", "202E", "2066", "2067", "2068", "2069", "FEFF"])(
    "removes the invisible character U+%s",
    (hex) => {
      const char = String.fromCodePoint(parseInt(hex, 16));
      expect(readProfileForm(form({ position: `Back${char}end ${char}engineer${char}` }))).toMatchObject({
        position: "Backend engineer",
      });
    },
  );

  it("treats a field of nothing but invisible characters as cleared", () => {
    expect(readProfileForm(form({ companyWebsite: "​", position: "​​​", openTo: "‍﻿ ‍" }))).toEqual({
      companyWebsite: null,
      position: null,
      linkedInUrl: null,
      openTo: null,
    });
  });

  it("stops a right-to-left override from showing text reversed", () => {
    expect(readProfileForm(form({ openTo: "jobs ‮serif on‬ please" }))).toMatchObject({
      openTo: "jobs serif on please",
    });
  });

  it("removes the Arabic letter mark, a bidirectional control", () => {
    expect(readProfileForm(form({ position: "؜CTO؜" }))).toMatchObject({ position: "CTO" });
  });

  // A pass linear in the length takes a tenth of a second here; one that went back over the text for each character
  // would take hours. 5 s tells them apart however busy the machine is.
  it("tidies a megabyte of spaces and joiners in turn in one pass", () => {
    const position = "x" + " ‍".repeat(500_000) + "y";
    const start = performance.now();
    expect(readProfileForm(form({ position }))).toMatch(/80 characters/);
    expect(readProfileForm(form({ position: "CTO" + " ‍".repeat(500_000) }))).toMatchObject({ position: "CTO" });
    expect(performance.now() - start).toBeLessThan(5_000);
  });

  it("keeps the zero-width joiner inside emoji", () => {
    expect(readProfileForm(form({ position: "‍👩‍💻 engineer, 🏳️‍🌈‍" }))).toMatchObject({
      position: "👩‍💻 engineer, 🏳️‍🌈",
    });
  });
});
