// pnpm guards (scripts/guards.mjs): what a named change does to a file, which changes only the real-Postgres suites can
// judge, what it proposes, and how it reads a run of the tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apply, FAKE_REFUSES, inSql, label, locate, parse, propose, shown, verdict } from "./guards.mjs";

const TEXT = "one\ntwo\nthree\n";
type Edit = { first?: number; last?: number; replace?: string[] };
const at = (text: string, place: Edit) => locate(text, { first: undefined, last: undefined, replace: undefined, ...place });
const edit = (text: string, place: Edit) => {
  const where = at(text, place);
  return "problem" in where ? where.problem : apply(text, [where]);
};

describe("a place named", () => {
  it("is a line or lines, a replacement in them or in a whole file, and + joins two into one change", () => {
    expect(parse(["lib/a.ts:48"])).toEqual({ options: { pg: false, tests: [] }, changes: [[{ file: "lib/a.ts", first: 48, last: 48 }]] });
    const args = ["lib/a.ts:20-24", "lib/b.ts", "--replace", "x", "y", "+", "lib/fake-db.ts:3", "--tests", "app/t.test.ts", "--pg"];
    expect(parse(args)).toEqual({
      options: { pg: true, tests: ["app/t.test.ts"] },
      changes: [
        [{ file: "lib/a.ts", first: 20, last: 24 }],
        [
          { file: "lib/b.ts", first: undefined, last: undefined, replace: ["x", "y"] },
          { file: "lib/fake-db.ts", first: 3, last: 3 },
        ],
      ],
    });
  });

  it("refuses an option it does not know, a + or a --replace with nothing to join, and a second --replace", () => {
    for (const args of [["--bogus"], ["--tests"], ["+", "a.ts:1"], ["a.ts:1", "+"], ["a.ts:1", "+", "+", "b.ts:1"], ["--replace", "a", "b"]])
      expect(() => parse(args), args.join(" ")).toThrow(/^Usage: pnpm guards/);
    expect(() => parse(["a.ts:1", "--replace", "a"])).toThrow(/^Usage/);
    expect(() => parse(["a.ts:1", "--replace", "a", "b", "--replace", "c", "d"])).toThrow(/^Usage/);
  });
});

describe("a change to a file", () => {
  it("deletes the line or lines named, the last one too without its line break", () => {
    expect(edit(TEXT, { first: 2 })).toBe("one\nthree\n");
    expect(edit(TEXT, { first: 2, last: 3 })).toBe("one\n");
    expect(edit("a\nb", { first: 2 })).toBe("a\n");
  });

  it("replaces text that is in the place once, the place a line, lines or the whole file", () => {
    expect(edit(TEXT, { first: 2, replace: ["w", "W"] })).toBe("one\ntWo\nthree\n");
    expect(edit(TEXT, { first: 1, last: 2, replace: ["e\nt", "e t"] })).toBe("one two\nthree\n");
    expect(edit(TEXT, { replace: ["three", "3"] })).toBe("one\ntwo\n3\n");
  });

  it("is not made when the text is not in the place exactly once, the lines are not the file's, or no line is named", () => {
    expect(edit(TEXT, { first: 3, replace: ["e", "E"] })).toBe('"e" is there 2 times, not once');
    expect(edit(TEXT, { first: 2, replace: ["one", "1"] })).toBe('"one" is there 0 times, not once');
    expect(edit(TEXT, { first: 1, replace: ["three", "3"] })).toBe('"three" is there 0 times, not once');
    expect(edit(TEXT, { first: 2, replace: ["", "1"] })).toBe('"" is there 0 times, not once');
    for (const lines of [{ first: 4 }, { first: 0 }, { first: 3, last: 2 }]) expect(edit(TEXT, lines)).toBe("it has 3 lines");
    expect(edit(TEXT, {})).toBe("a whole file is not a guard: name a line, lines or --replace");
  });

  it("makes several edits at once, whatever their order, unless two overlap", () => {
    const edits = [at(TEXT, { first: 3 }), at(TEXT, { first: 1, replace: ["one", "1"] })];
    expect(apply(TEXT, edits as never)).toBe("1\ntwo\n");
    expect(apply(TEXT, [at(TEXT, { first: 1, last: 2 }), at(TEXT, { first: 2 })] as never)).toBeNull();
  });

  it("is shown as the whole lines before and after", () => {
    expect(shown(TEXT, at(TEXT, { first: 2 }) as never)).toBe("         - two");
    expect(shown(TEXT, at(TEXT, { first: 2, replace: ["w", "W"] }) as never)).toBe("         - two\n         + tWo");
  });

  it("is labelled as the command that makes it again", () => {
    const change = [{ file: "lib/a.ts", first: 48, last: 48, replace: ["now, by)", "now)"] }, { file: "lib/b.ts", first: 2, last: 4 }];
    expect(label(change)).toBe("lib/a.ts:48 --replace 'now, by)' 'now)' + lib/b.ts:2-4");
    expect(label([{ file: "app/p.tsx", replace: ["don't", "do"] }])).toBe("app/p.tsx --replace 'don'\\''t' do");
  });
});

describe("a change to SQL", () => {
  const code = 'const n = <p>Don\'t</p>;\nawait db.query(`select "id" from "user" where id = $1`, [id]);\nsay(`Season ${n} is where it was.`);\n';
  const MEMBER = 'export const MEMBER_SQL = `u."consentAt" is not null and u."rulesAt" is not null`;\n';

  it("is one inside a template literal holding a statement or a part of one", () => {
    expect(inSql("app/p.tsx", code, code.indexOf("where id"))).toBe(true);
    expect(inSql("lib/members.ts", MEMBER, MEMBER.indexOf("and"))).toBe(true);
  });

  it("is not one elsewhere: the code around it, or a sentence in a template literal", () => {
    expect(inSql("app/p.tsx", code, code.indexOf("await"))).toBe(false);
    expect(inSql("app/p.tsx", code, code.indexOf("where it"))).toBe(false);
  });

  it("is judged by the real-Postgres suites alone, as lib/fake-db.ts refuses a statement it was not written with in these words", () => {
    expect(readFileSync("lib/fake-db.ts", "utf8")).toContain(`throw new Error(\`${FAKE_REFUSES}: \${statement}\`)`);
  });
});

describe("the changes proposed", () => {
  const text = [
    "export async function act(id: string) {",
    "  await requireOrganiser();",
    '  if (!id) return refusal("no id");',
    '  const { rows } = await db.query(`select "x" from "y" where id = $1`, [id]);',
    "  if (rows.length > 1 ||",
    "      rows.length === 0) {",
    '    throw new Error("none");',
    "  }",
    "  return rows;",
    "}",
    "",
  ].join("\n");

  it("make an if's condition false, delete a sign-in or Member check, and make a where clause true for every row", () => {
    const changes = propose("lib/act.ts", text, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(changes.map(label)).toEqual([
      "lib/act.ts:2",
      "lib/act.ts:3 --replace 'if (!id)' 'if (false)'",
      "lib/act.ts:4 --replace 'where ' 'where true or '",
      "lib/act.ts:5-6 --replace 'if (rows.length > 1 ||\n      rows.length === 0)' 'if (false)'",
    ]);
    const made = changes.map(([change]) => apply(text, [at(text, change) as never]));
    expect(made[3]).toContain("  if (false) {\n    throw");
  });

  it("are only in the lines changed", () => {
    expect(propose("lib/act.ts", text, new Set([3, 9])).map(label)).toEqual(["lib/act.ts:3 --replace 'if (!id)' 'if (false)'"]);
  });
});

describe("a run of the tests", () => {
  type Test = { status: string; fullName?: string; failureMessages?: string[] };
  const report = (files: { name?: string; status?: string; message?: string; tests: Test[] }[]) => ({
    numPassedTests: files.flatMap((file) => file.tests).filter((test) => test.status === "passed").length,
    testResults: files.map((file) => ({
      name: `/tmp/offboard-guards-x/checkout/${file.name ?? "app/a.test.ts"}`,
      status: file.status ?? "passed",
      message: file.message ?? "",
      assertionResults: file.tests.map((test) => ({ fullName: "it works", failureMessages: [], ...test })),
    })),
  });
  const passed = { status: "passed" };
  const failed = { status: "failed", fullName: "refuses a stranger", failureMessages: ["AssertionError: expected 200 to be 403"] };
  const refused = { status: "failed", fullName: "saves", failureMessages: [`Error: ${FAKE_REFUSES}: select 1`] };

  it("is red when a test failed, naming it, even beside files the first failure cancelled", () => {
    const run = report([{ status: "failed", tests: [] }, { name: "app/b.test.ts", status: "failed", tests: [passed, failed] }]);
    expect(verdict(run, 1)).toEqual({ kind: "red", why: "1 failed, first: app/b.test.ts > refuses a stranger" });
    expect(verdict(report([{ tests: [refused, failed] }]), 1).kind).toBe("red");
  });

  it("is red when it failed outside any test, or did not finish", () => {
    expect(verdict(report([{ tests: [passed] }]), 1)).toEqual({ kind: "red", why: "vitest failed the run with an error outside any test" });
    expect(verdict(null, null).kind).toBe("red");
  });

  it("is green when every test passed", () => {
    expect(verdict(report([{ tests: [passed, passed] }]), 0)).toEqual({ kind: "green", why: "no test noticed: 2 passed" });
  });

  it("cannot judge when the only failures are the fake's refusals of a statement, a file no longer loads, or there is no report", () => {
    expect(verdict(report([{ tests: [refused, refused] }]), 1)).toEqual({ kind: "refused" });
    const unloaded = report([{ status: "failed", message: "\x1b[31mTransform failed with 1 error:\x1b[0m\nmore", tests: [] }]);
    expect(verdict(unloaded, 1)).toEqual({ kind: "broken", why: "app/a.test.ts no longer loads: Transform failed with 1 error:" });
    expect(verdict(null, 1)).toEqual({ kind: "broken", why: "vitest wrote no report" });
  });
});
