// How to reach the Organiser, from ORGANISER_CONTACT_EMAIL. Until it is set, the site shows no contact route and its
// copy promises none.

// A plain address: a local part without spaces, quotes, angle brackets or anything a mailto link would read as a
// header ("?", "&"), then a domain of letters, digits and hyphens with at least one dot.
const ADDRESS = /^[A-Za-z0-9.!#$%'*+/=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

// The address, or null when it is unset or not a plain email address. Never anything else, so it is safe in a link.
export function organiserEmail(value: string | undefined = process.env.ORGANISER_CONTACT_EMAIL): string | null {
  const email = value?.trim() ?? "";
  return email.length <= 254 && ADDRESS.test(email) ? email : null;
}
