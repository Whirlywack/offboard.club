// The Profile form (Edit your Profile, and the sign-up step after connecting Lichess) as it comes back from a refused
// save: the refusal is said beside the field it is about, tied to that field for a screen reader, and what was typed
// is kept. The refusals are the server's own (readProfileForm); what the save hands back is set here, as
// useActionState would hand it to the form.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProfileFormState } from "./actions";
import { ProfileForm } from "./profile/profile-form";
import { OPEN_TO_MAX, POSITION_MAX, readProfileForm } from "@/lib/profile";

const returned = vi.hoisted(() => ({ state: null as ProfileFormState }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: () => [returned.state, () => {}, false],
}));
vi.mock("./actions", () => ({ saveProfile: () => null }));

const typed = { companyWebsite: "example.com", position: "Backend engineer", linkedInUrl: "", openTo: "" };

// The form after a save of `fields` was refused with what the server says of them.
function refused(fields: Partial<typeof typed>, problem?: string) {
  const all = { ...typed, ...fields };
  const said = problem ?? readProfileForm({ get: (name: string) => all[name as keyof typeof all] });
  if (typeof said !== "string") throw new Error("expected a refusal");
  returned.state = { problem: said, typed: all };
  return { html: renderToStaticMarkup(createElement(ProfileForm, { saved: null })), problem: said };
}

// Each field's control, and what comes just before it.
const control = (html: string, id: string) => html.match(new RegExp(`(<p[^>]*>[^<]*</p>)?<(input|textarea)[^>]*id="${id}"[^>]*>`))!;
const text = (html: string) => html.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'");

describe("a refused Profile", () => {
  it.each([
    ["position", { position: "p".repeat(POSITION_MAX + 1) }],
    ["linkedInUrl", { linkedInUrl: "example.com/ana" }],
    ["openTo", { openTo: "o".repeat(OPEN_TO_MAX + 1) }],
  ] as const)("says what is wrong with %s just above it, and marks that field alone", (id, fields) => {
    const { html, problem } = refused(fields);
    const [field, before] = control(html, id);
    expect(before).toMatch(new RegExp(`^<p id="${id}-error" role="alert"`));
    expect(text(before)).toBe(problem);
    expect(field).toContain('aria-invalid="true"');
    expect(field).toMatch(new RegExp(`aria-describedby="[^"]*${id}-error"`));
    for (const other of ["companyWebsite", "position", "linkedInUrl", "openTo"].filter((name) => name !== id))
      expect(control(html, other)[0]).not.toContain("aria-invalid");
    expect(html.match(/role="alert"/g)).toHaveLength(1);
  });

  it("says a refusal only the server can make, of the Company website, above that field", () => {
    const problem = "That doesn't look like a public website address. Try one like vinted.com.";
    const { html } = refused({ companyWebsite: "localhost" }, problem);
    expect(text(control(html, "companyWebsite")[1])).toBe(problem);
    expect(control(html, "companyWebsite")[0]).toContain('aria-invalid="true"');
  });

  it("keeps what was typed, the open-to line in a box of four lines", () => {
    const openTo = `A coffee & "talks" ${"o".repeat(OPEN_TO_MAX)}`;
    const { html } = refused({ openTo });
    expect(html).toMatch(/<textarea[^>]*id="openTo"[^>]*rows="4"[^>]*>A coffee &amp; &quot;talks&quot; o+<\/textarea>/);
    expect(html).toContain('value="Backend engineer"');
  });
});
