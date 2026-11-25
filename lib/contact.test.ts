import { describe, expect, it } from "vitest";
import { organiserEmail } from "./contact";

describe("the Organiser's contact address", () => {
  it("is a plain email address, trimmed", () => {
    expect(organiserEmail("organiser@offboard.club")).toBe("organiser@offboard.club");
    expect(organiserEmail("  first.last+club@mail.example.lt \n")).toBe("first.last+club@mail.example.lt");
  });

  it("is absent when unset or empty", () => {
    expect(organiserEmail(undefined)).toBeNull();
    expect(organiserEmail("")).toBeNull();
    expect(organiserEmail("   ")).toBeNull();
  });

  it.each([
    ["no @", "organiser.offboard.club"],
    ["no domain dot", "organiser@localhost"],
    ["a space", "the organiser@offboard.club"],
    ["two addresses", "a@offboard.club,b@offboard.club"],
    ["a mailto header", "organiser@offboard.club?subject=hi"],
    ["a second header", "organiser@offboard.club&bcc=x@y.z"],
    ["markup", "<script>@offboard.club"],
    ["a scheme", "mailto:organiser@offboard.club"],
    ["a script", "javascript:alert(1)//@x.y"],
    ["a quote", 'a"@offboard.club'],
    ["a domain starting with a hyphen", "a@-offboard.club"],
    ["too long", `${"a".repeat(250)}@x.yz`],
  ])("is never rendered with %s", (_, value) => {
    expect(organiserEmail(value)).toBeNull();
  });
});
