// What a person adds to their Profile beyond the name and photo from LinkedIn. Every field is optional.

import type { Company } from "./companies";

// Null means not given.
export type ProfileFields = { position: string | null; linkedInUrl: string | null; openTo: string | null };

// The Company is given by its website as typed; saveProfile (app/actions.ts) checks it, with companyDomain
// (lib/company.ts), which this file cannot use, as it is also part of the browser's code.
export type SubmittedProfile = ProfileFields & { companyWebsite: string | null };

// What is wrong with each field of a submitted Profile form that is wrong, to be said beside that field.
export type ProfileProblems = Partial<Record<keyof SubmittedProfile, string>>;

// The blitz rating is null when the Lichess account had none when it was connected.
export type Profile = ProfileFields & {
  id: string;
  name: string;
  image: string | null;
  lichessUsername: string;
  lichessBlitzRating: number | null;
  company: Company | null;
};

export const POSITION_MAX = 80;
export const OPEN_TO_MAX = 140;
// The link as typed may carry tracking and a percent-encoded handle; LinkedIn's own limit for the handle is 100.
const LINK_MAX = 1000;
const handle = /^[\p{L}\p{M}\p{N}_-]{1,100}$/u;

// "lt.linkedin.com/in/jonas-p/?trk=x" -> "https://www.linkedin.com/in/jonas-p". Null if it is not a LinkedIn
// profile address.
export function linkedInProfileUrl(input: string): string | null {
  const text = input.trim();
  if (text.length > LINK_MAX) return null;
  // A link without a scheme is taken as https; any other scheme, http included, is refused.
  const url = URL.parse(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) return null;
  // Only the handle is kept: the subdomain, anything after the handle, the query and the fragment all go.
  const name = decode(url.pathname.match(/^\/in\/([^/]+)/)?.[1] ?? "");
  return name && handle.test(name) ? `https://www.linkedin.com/in/${encodeURIComponent(name)}` : null;
}

const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
};

// Invisible characters and bidirectional controls, which could make a field look empty or show text reversed.
// The zero-width joiner (U+200D) is kept, because emoji such as 👩‍💻 are built with it, except at either end.
const invisible = /[؜​‌‎‏‪-‮⁦-⁩﻿]/gu;
const end = /[\s‍]/u;

// Without invisible characters, trimmed, and with each run of whitespace or control characters (NUL included) made
// one space. Empty means cleared. Also tidies Company names taken from websites (lib/company.ts).
export function tidy(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(invisible, "").replace(/[\s\p{Cc}]+/gu, " ");
  // Trimmed one character at a time: a regular expression anchored at the end would be retried from every position,
  // which a long run of spaces and joiners makes take minutes.
  let from = 0;
  let to = text.length;
  while (from < to && end.test(text[from])) from++;
  while (to > from && end.test(text[to - 1])) to--;
  return text.slice(from, to);
}
const characters = (text: string) => [...text].length;

// The fields of a submitted Profile form, tidied, and what is wrong with each that cannot be saved: every one, so that
// one save can say them all. The Company website is only tidied here.
export function readProfileForm(form: { get(name: string): unknown }): { fields: SubmittedProfile; problems: ProfileProblems } {
  const companyWebsite = tidy(form.get("companyWebsite"));
  const position = tidy(form.get("position"));
  const link = tidy(form.get("linkedInUrl"));
  const openTo = tidy(form.get("openTo"));
  const linkedInUrl = link ? linkedInProfileUrl(link) : null;
  const problems: ProfileProblems = {};
  if (characters(position) > POSITION_MAX)
    problems.position = `Your position is longer than ${POSITION_MAX} characters. Please shorten it.`;
  if (characters(openTo) > OPEN_TO_MAX)
    problems.openTo = `Your “open to” line is longer than ${OPEN_TO_MAX} characters. Please shorten it.`;
  if (link && !linkedInUrl)
    problems.linkedInUrl = "That isn't a LinkedIn profile address. It should look like linkedin.com/in/your-name.";
  const fields = { companyWebsite: companyWebsite || null, position: position || null, linkedInUrl, openTo: openTo || null };
  return { fields, problems };
}
