// What a person adds to their Profile beyond the name and photo from LinkedIn. Every field is optional.

// Null means not given. The Company (#6) joins these.
export type ProfileFields = { position: string | null; linkedInUrl: string | null; openTo: string | null };

// The blitz rating is null when the Lichess account had none when it was connected.
export type Profile = ProfileFields & {
  id: string;
  name: string;
  image: string | null;
  lichessUsername: string;
  lichessBlitzRating: number | null;
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
const invisible = /[​‌‎‏‪-‮⁦-⁩﻿]/gu;

// Without invisible characters, trimmed, and with each run of whitespace or control characters made one space.
// Empty means cleared.
const tidy = (value: unknown) =>
  typeof value === "string"
    ? value
        .replace(invisible, "")
        .replace(/[\s\p{Cc}]+/gu, " ")
        .replace(/^[\s‍]+|[\s‍]+$/gu, "")
    : "";
const characters = (text: string) => [...text].length;

// The fields of a submitted Profile form, tidied, or a message saying why they cannot be saved.
export function readProfileForm(form: { get(name: string): unknown }): ProfileFields | string {
  const position = tidy(form.get("position"));
  const link = tidy(form.get("linkedInUrl"));
  const openTo = tidy(form.get("openTo"));
  if (characters(position) > POSITION_MAX) return `Please keep your position to ${POSITION_MAX} characters or fewer.`;
  if (characters(openTo) > OPEN_TO_MAX) return `Please keep your “open to” line to ${OPEN_TO_MAX} characters or fewer.`;
  const linkedInUrl = link ? linkedInProfileUrl(link) : null;
  if (link && !linkedInUrl)
    return "The LinkedIn link must be the address of your LinkedIn profile, such as https://www.linkedin.com/in/your-name.";
  return { position: position || null, linkedInUrl, openTo: openTo || null };
}
