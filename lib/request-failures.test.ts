// Requests that fail on the server (#60): through the hook Next.js calls (onRequestError in instrumentation.ts, given
// what a production build of the site gave it), the hourly alerts (alertOrganiser, and the endpoint Vercel calls) and
// what the Organiser is sent. Faked: the database (lib/fake-db.ts), Telegram (lib/fixtures/fake-telegram.ts, standing
// in for fetch), Vercel's request context, which holds waitUntil, and the clock. The errors are real ones: the site's
// own pool's (lib/db.ts) and pg's, against a port nothing listens on and one that never answers, Node's at an upload
// cut off part-way, and Next.js's own redirect() and notFound().
import http from "node:http";
import net from "node:net";
import { parseAndValidateFlightRouterState } from "next/dist/server/app-render/parse-and-validate-flight-router-state";
import { notFound, redirect } from "next/navigation";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "@/instrumentation";
import { GET as alertsRequest } from "@/app/api/jobs/alert-organiser/route";
import { db, fromDatabase, requestFailures, resetDb, telegramPosts } from "@/lib/fake-db";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";
import { alertOrganiser } from "./alerts";

vi.mock("@/lib/db", () => import("@/lib/fake-db"));

const TOKEN = "a-pretend-telegram-token";
const CHAT = "123456789";
const SECRET = "a-cron-secret-of-forty-characters-123456";
const HOUR = 3_600_000;
const SUNDAY = new Date("2026-11-29T18:00:00Z");
// The database's address, as an error from it may say it.
const DATABASE = "ep-pretend-123456-pooler.eu-central-1.aws.neon.tech";

let telegram: ReturnType<typeof createFakeTelegram>;
let kept: Promise<unknown>[];
let refused: Error; // the site's pool's, from a port nothing listens on
let socketRefused: Error; // a bare pg client's from the same port, which is not the pool's, so carries no mark
let timedOut: Error; // pg's pool's, from a server that never answers, marked as the site's pool marks it
let fetchFailed: Error; // fetch's, from a port nothing listens on
let cutOff: Error[]; // Node's, at an upload whose sender closed, and one whose sender reset, part-way through
const silent = net.createServer(() => {});

// What a server's request says when its sender leaves part-way through the body, by closing or by resetting.
async function cutOffUploads() {
  const errors: Error[] = [];
  for (const leave of ["destroy", "resetAndDestroy"] as const)
    errors.push(
      await new Promise<Error>((said) => {
        const server = http.createServer((request) => {
          request.on("error", (error) => {
            said(error);
            server.close();
          });
          request.resume();
        });
        server.listen(0, "127.0.0.1", () => {
          const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1", () => {
            socket.write("POST /profile HTTP/1.1\r\nHost: offboard.test\r\nContent-Type: multipart/form-data; boundary=zz\r\nContent-Length: 100000\r\n\r\n--zz\r\n");
            setTimeout(() => socket[leave](), 50);
          });
          socket.on("error", () => {});
        });
      }),
    );
  return errors;
}

const dms = () => telegram.posts.filter((post) => post.chatId === CHAT).map((post) => post.text);
// As the sign-in library threw it from a page when the database could not be reached, in a production build.
const sessionFailed = () => Object.assign(new Error("Failed to get session", { cause: refused }), { name: "APIError", status: "INTERNAL_SERVER_ERROR" });

// A request that failed with `error`, as Next.js hands it to the hook: `path` is the address asked for and `routePath`
// the route's shape. Then whatever the hook gave waitUntil.
async function fail(error: unknown, routePath = "/profile", routeType: Route = "render", path = routePath, method = "GET") {
  await onRequestError(error, { path, method, headers: { cookie: "better-auth.session_token=pretend" } }, context(routePath, routeType));
  await Promise.all(kept.splice(0));
}
type Route = "render" | "route" | "action" | "proxy";
const context = (routePath: string, routeType: Route) =>
  ({ routerKind: "App Router", routePath, routeType, renderSource: "react-server-components", revalidateReason: undefined }) as const;

async function alertAt(now: Date) {
  vi.setSystemTime(now);
  return alertOrganiser(now);
}

const vercelRuns = (now: Date) => {
  vi.setSystemTime(now);
  return alertsRequest(new Request("https://offboard.test/api/jobs/alert-organiser", { headers: { authorization: `Bearer ${SECRET}` } }));
};

const rows = () => [...requestFailures.values()].map(({ route, kind, reason }) => ({ route, kind, reason }));

beforeAll(async () => {
  const closed = net.createServer();
  await new Promise<void>((listening) => closed.listen(0, "127.0.0.1", listening));
  const port = (closed.address() as net.AddressInfo).port;
  await new Promise((done) => closed.close(done));
  vi.stubEnv("DATABASE_URL", `postgres://offboard@127.0.0.1:${port}/offboard`);
  const retried = vi.spyOn(console, "error").mockImplementation(() => {});
  const { db: pool } = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  refused = await pool.query("select 1").then(() => new Error("answered"), (error: Error) => error);
  await pool.end();
  retried.mockRestore();
  vi.unstubAllEnvs();
  socketRefused = await new pg.Client({ connectionString: `postgres://offboard@127.0.0.1:${port}/offboard` }).connect().then(() => new Error("connected"), (error: Error) => error);
  fetchFailed = await fetch(`http://127.0.0.1:${port}/`).then(() => new Error("fetched"), (error: Error) => error);
  await new Promise<void>((listening) => silent.listen(0, "127.0.0.1", listening));
  const never = new pg.Pool({ connectionString: `postgres://offboard@127.0.0.1:${(silent.address() as net.AddressInfo).port}/offboard`, connectionTimeoutMillis: 50 });
  timedOut = fromDatabase(await never.query("select 1").then(() => new Error("answered"), (error: Error) => error));
  await never.end();
  cutOff = await cutOffUploads();
});

afterAll(() => void silent.close());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
  vi.stubEnv("TELEGRAM_GROUP_ID", "@pretend_group");
  vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", CHAT);
  vi.stubEnv("TELEGRAM_URL", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("DATABASE_URL", `postgres://neondb_owner:a-pretend-password@${DATABASE}/neondb?sslmode=require`);
  telegram = createFakeTelegram({ token: TOKEN, chats: ["@pretend_group", CHAT] });
  vi.stubGlobal("fetch", telegram.fetch);
  kept = [];
  vi.stubGlobal(Symbol.for("@vercel/request-context"), { get: () => ({ waitUntil: (work: Promise<unknown>) => kept.push(work) }) });
  resetDb();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.query.mockReset(); // back to the fake's own statements
});

describe("a request that fails on the server", () => {
  it("is recorded once a kind, by its address's shape, its kind and why, with nothing the request or the error said", async () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'name') for ana@pretend.invalid");
    for (let i = 0; i < 3; i++) await fail(error, "/profiles/[id]", "render", "/profiles/u_PretendId12345?from=mail&email=ana%40pretend.invalid");
    // Some of Next.js's paths name a page's file, and the root's is /page.
    await fail(error, "/recaps/[date]/page", "render", "/recaps/2026-11-22");
    await fail(error, "/page", "render", "/");
    await fail(error, "/api/auth/[...all]", "route", "/api/auth/callback/linkedin?code=pretend-code&state=pretend");
    await fail(sessionFailed(), "/profile", "action", "/profile", "POST");
    expect(rows()).toEqual([
      { route: "/profiles/[id]", kind: "page", reason: "the code threw TypeError" },
      { route: "/recaps/[date]", kind: "page", reason: "the code threw TypeError" },
      { route: "/", kind: "page", reason: "the code threw TypeError" },
      { route: "/api/auth/[...all]", kind: "route", reason: "the code threw TypeError" },
      { route: "/profile", kind: "server action", reason: "the database couldn't be reached" },
    ]);
    const stored = JSON.stringify([...requestFailures.values()]);
    for (const said of ["ana", "PretendId", "mail", "2026-11-22", "pretend-code", "session_token", "name"]) expect(stored).not.toContain(said);
    // A request tells the Organiser nothing itself.
    expect(telegram.calls).toEqual([]);
  });

  it("is said to have failed for a reason from a fixed list, found through what caused it, never in the error's words", async () => {
    const quoting = () => Object.assign(new pg.DatabaseError('invalid input syntax for type uuid: "ana@pretend.invalid"', 0, "error"), { severity: "ERROR", code: "22P02" });
    const cases: [unknown, string][] = [
      [sessionFailed(), "the database couldn't be reached"],
      [refused, "the database couldn't be reached"],
      [timedOut, "the database couldn't be reached"],
      [fromDatabase(quoting()), "the database refused it (error 22P02)"],
      // The same, but not from the site's pool: anyone's socket can be refused, and any object can say "severity".
      [socketRefused, "the code threw Error"],
      [quoting(), "the code threw an error"],
      // Node's, five letters long like Postgres's codes.
      [fromDatabase(Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" })), "the code threw Error"],
      // A connection the pool could not open, whatever Node's code for it, as when a machine runs out of sockets.
      [fromDatabase(Object.assign(new Error("connect EINVAL"), { code: "EINVAL" }), "connect"), "the database couldn't be reached"],
      [fromDatabase(Object.assign(new Error("connect EINVAL"), { code: "EINVAL" })), "the code threw Error"],
      // With a severity, but a code not in SQLSTATE's form.
      [fromDatabase(Object.assign(new pg.DatabaseError("A message", 0, "error"), { severity: "ERROR", code: "ana@pretend.invalid" })), "the code threw an error"],
      [Object.assign(new Error("Lichess said no"), { cause: fetchFailed }), "another site couldn't be reached"],
      [Object.assign(new Error("A name no reason should carry"), { name: "Error for ana@pretend.invalid" }), "the code threw an error"],
      ["a thrown string about ana@pretend.invalid", "the code threw an error"],
    ];
    for (const [i, [error]] of cases.entries()) await fail(error, `/case-${i}`);
    expect(rows().map((row) => row.reason)).toEqual(cases.map(([, reason]) => reason));
    expect(JSON.stringify([...requestFailures.values()])).not.toContain("ana");
  });

  it("is kept by its address only as a route's shape: anything else is an unknown address", async () => {
    for (const routePath of ["/profiles/ana?x=1", `/${"a".repeat(201)}`, "profile", "/profiles/ana@pretend.invalid"]) await fail(new Error("Oops"), routePath);
    expect(rows()).toEqual([{ route: "an unknown address", kind: "page", reason: "the code threw Error" }]);
  });

  it("is not a visitor sent home, or to the not-found page, by Next.js's own signals", async () => {
    for (const send of [() => redirect("/"), () => notFound()]) {
      const signal = (() => {
        try {
          send();
        } catch (thrown) {
          return thrown;
        }
      })();
      await fail(signal, "/welcome");
      // Wrapped, as the sign-in library might.
      await fail(new Error("Failed", { cause: signal }), "/welcome");
    }
    expect(requestFailures.size).toBe(0);
  });

  it("is recorded though it is its own cause, or two errors cause each other, on which Next.js's own test overflows", async () => {
    const looped = new RangeError("Oops");
    looped.cause = looped;
    const [one, other] = [new TypeError("One"), new SyntaxError("Other")];
    one.cause = other;
    other.cause = one;
    await fail(looped, "/looped");
    await fail(one, "/each-other");
    expect(rows()).toEqual([
      { route: "/looped", kind: "page", reason: "the code threw RangeError" },
      { route: "/each-other", kind: "page", reason: "the code threw TypeError" },
    ]);
  });

  it("is left alone on the Edge runtime, which has no database", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await fail(new Error("Oops"));
    expect(kept).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("holds no response: the hook hands its work to Vercel's waitUntil and returns", async () => {
    db.query.mockImplementationOnce(() => new Promise(() => {})); // a database that never answers
    await onRequestError(new Error("Oops"), { path: "/never-answered", method: "GET", headers: {} }, context("/never-answered", "route"));
    expect(kept).toHaveLength(1);
  });

  it("is recorded one at a time a kind in each process: while the database is slow, many cost one statement and one line", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = db.query.getMockImplementation()!;
    const held: ((error: unknown) => void)[] = [];
    db.query.mockImplementation((sql: string, params?: unknown[]) =>
      sql.includes(`"requestFailure"`) ? new Promise((_, fail) => held.push(fail)) : real(sql, params),
    );
    // 200 home page views at once, each handing over its four failures, and one of another kind.
    const request = { path: "/", method: "GET", headers: {} };
    for (let view = 0; view < 200; view++)
      for (let part = 0; part < 4; part++) await onRequestError(sessionFailed(), request, context("/", "render"));
    await onRequestError(sessionFailed(), request, context("/recaps", "render"));
    expect(held).toHaveLength(2);
    for (const fail of held.splice(0)) fail(refused);
    await Promise.all(kept.splice(0));
    expect(logged.mock.calls.map(([said]) => said)).toEqual([
      "A page failed at /: the database couldn't be reached. It couldn't be recorded: the database couldn't be reached.",
      "A page failed at /recaps: the database couldn't be reached. It couldn't be recorded: the database couldn't be reached.",
    ]);
    // Once that statement has ended, the next failure of the kind is recorded again.
    db.query.mockImplementation(real);
    await fail(sessionFailed(), "/");
    expect(rows()).toEqual([{ route: "/", kind: "page", reason: "the database couldn't be reached" }]);
  });

  it("is logged in the same words when the database can't record it, with nothing the error said, and sends nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.query.mockRejectedValueOnce(refused);
    await fail(sessionFailed());
    expect(logged.mock.calls).toEqual([["A page failed at /profile: the database couldn't be reached. It couldn't be recorded: the database couldn't be reached."]]);
    expect(requestFailures.size).toBe(0);
    expect(telegram.calls).toEqual([]);
  });
});

// Requests no page of the site sends, which a visitor can send at will (#60 review): each failed on a production build
// of the site as below, and the hook was handed what it threw.
describe("what a visitor can make fail at will", () => {
  const thrownBy = (send: () => unknown) => {
    try {
      send();
    } catch (error) {
      return error;
    }
    throw new Error("nothing was thrown");
  };

  it("is not a router state header Next.js cannot read, nor two of them, nor one too large", async () => {
    for (const header of ["not-json", ["[]", "[]"], "a".repeat(40_001)])
      await fail(thrownBy(() => parseAndValidateFlightRouterState(header as string)), "/recaps", "render", "/recaps?_rsc=pretend");
    expect(rows()).toEqual([]);
  });

  it("is not a server action, nor a page sent a POST, that fails but for the database, while a page asked for fails", async () => {
    // From bodies no form of the site sends: JSON that does not parse, arguments that are not a list, and React's own.
    const bodies = [thrownBy(() => JSON.parse("{{")), thrownBy(() => Reflect.apply(() => {}, null, null as unknown as [])), new Error("Connection closed.")];
    for (const error of bodies) {
      await fail(error, "/", "action", "/", "POST");
      await fail(error, "/recaps", "render", "/recaps", "POST");
    }
    expect(rows()).toEqual([]);
    await fail(sessionFailed(), "/", "action", "/", "POST");
    await fail(sessionFailed(), "/recaps", "render", "/recaps", "POST");
    await fail(bodies[1], "/recaps", "render", "/recaps", "GET");
    expect(rows()).toEqual([
      { route: "/", kind: "server action", reason: "the database couldn't be reached" },
      { route: "/recaps", kind: "page", reason: "the database couldn't be reached" },
      { route: "/recaps", kind: "page", reason: "the code threw TypeError" },
    ]);
  });

  it("is not an upload its sender cut off, closing or resetting, which Node says with a code a database's socket can have", async () => {
    expect(cutOff.map((error) => [error.message, (error as { code?: string }).code])).toEqual([
      ["aborted", "ECONNRESET"],
      ["aborted", "ECONNRESET"],
    ]);
    for (const error of cutOff) {
      await fail(error, "/", "action", "/", "POST");
      await fail(error, "/profile", "render", "/profile", "POST");
    }
    expect(rows()).toEqual([]);
    // Thrown on a page asked for, it is the code's, not the database's.
    await fail(cutOff[0], "/recaps");
    expect(rows()).toEqual([{ route: "/recaps", kind: "page", reason: "the code threw Error" }]);
  });
});

describe("the Organiser's alerts of failed requests", () => {
  const A = "A page failed at /profile: the database couldn't be reached.";
  const B = "A page failed at /welcome: the code threw TypeError.";

  it("are one a kind, not one a request, and come again a day later only while it fails", async () => {
    for (let i = 0; i < 500; i++) {
      vi.setSystemTime(new Date(SUNDAY.getTime() + i * 7_000));
      await fail(sessionFailed());
    }
    await fail(new TypeError("Oops"), "/welcome");
    expect(telegram.calls).toEqual([]);
    await alertAt(new Date(SUNDAY.getTime() + HOUR));
    expect(dms().sort()).toEqual([A, B]);
    // /profile goes on failing every hour; /welcome never again.
    for (let hour = 2; hour <= 24; hour++) {
      vi.setSystemTime(new Date(SUNDAY.getTime() + hour * HOUR - 30 * 60_000));
      await fail(sessionFailed());
      await alertAt(new Date(SUNDAY.getTime() + hour * HOUR));
    }
    expect(dms()).toHaveLength(2);
    await alertAt(new Date(SUNDAY.getTime() + 25 * HOUR));
    expect(dms().slice(2)).toEqual([A]);
    // Once it stops failing, nothing more, a day later or ever.
    for (const hours of [26, 49, 50, 24 * 30]) await alertAt(new Date(SUNDAY.getTime() + hours * HOUR));
    expect(dms()).toHaveLength(3);
  });

  it("are one alert for a request that failed once, though it failed just after the alerts' run began", async () => {
    vi.setSystemTime(new Date(SUNDAY.getTime() + 500));
    await fail(sessionFailed());
    expect(await alertOrganiser(SUNDAY)).toMatchObject({ outcome: "done" });
    for (const hours of [1, 23, 24, 25, 48]) await alertAt(new Date(SUNDAY.getTime() + hours * HOUR));
    expect(dms()).toEqual([A]);
    // Its alert is forgotten once it is past.
    expect([...telegramPosts.values()]).toEqual([]);
  });

  it("are off without the bot's settings, while the failure is still recorded for the Organiser page", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await fail(sessionFailed());
    expect(await alertAt(new Date(SUNDAY.getTime() + HOUR))).toMatchObject({ outcome: "skipped", detail: expect.stringMatching(/^Alerts are off/) });
    expect(rows()).toEqual([{ route: "/profile", kind: "page", reason: "the database couldn't be reached" }]);
    expect(telegram.calls).toEqual([]);
    expect([...telegramPosts.keys()]).toEqual([]);
  });
});

describe("a database that can't be used", () => {
  const SAID =
    "The site can't use its database: the database couldn't be reached. Pages that need it fail, and no alert can be read from it. You'll hear this every hour until it works again.";
  // Every statement fails as pg fails when it cannot connect, naming the database's host as a real one would.
  const unreachable = () => {
    const named = fromDatabase(Object.assign(new Error(`getaddrinfo ENOTFOUND ${DATABASE}`), { code: "ENOTFOUND", hostname: DATABASE }));
    db.query.mockImplementation(async () => Promise.reject(named));
    return vi.spyOn(console, "error").mockImplementation(() => {});
  };

  it("is told to the Organiser by each hourly run, never by the requests that fail, however many", async () => {
    unreachable();
    for (let i = 0; i < 1000; i++) await fail(sessionFailed(), i % 2 ? "/profile" : "/organiser");
    expect(telegram.calls).toEqual([]);
    // Vercel's run of the hour, delivered twice, as it may be, and the next hour's.
    for (const at of [SUNDAY.getTime() + 7 * 60_000, SUNDAY.getTime() + 7 * 60_000 + 500, SUNDAY.getTime() + HOUR + 7 * 60_000]) {
      const response = await vercelRuns(new Date(at));
      expect(response.status).toBe(500);
    }
    expect(dms()).toEqual([SAID, SAID, SAID]);
    for (const text of dms()) expect(text).not.toMatch(/neon|pretend-password|neondb_owner/);
  });

  it("is said by why, looking five causes deep and no further, so an error that is its own cause is said too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const looped = new RangeError("Oops");
    looped.cause = looped;
    const deep = [1, 2, 3, 4, 5].reduce((cause: Error) => new Error("Wrapped", { cause }), refused);
    for (const [i, error] of [looped, deep, deep.cause].entries()) {
      db.query.mockRejectedValueOnce(error);
      await vercelRuns(new Date(SUNDAY.getTime() + i * HOUR));
    }
    expect(dms().map((text) => text.split(". ")[0])).toEqual([
      "The site can't use its database: the code threw RangeError",
      "The site can't use its database: the code threw Error",
      "The site can't use its database: the database couldn't be reached",
    ]);
  });

  it("is told to nobody while alerts are off, which says nothing more, and logged when Telegram doesn't take it", async () => {
    const logged = unreachable();
    for (const [token, chat] of [[TOKEN, ""], ["", CHAT]]) {
      vi.stubEnv("TELEGRAM_BOT_TOKEN", token);
      vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", chat);
      logged.mockClear();
      await vercelRuns(SUNDAY);
      expect(logged.mock.calls).toEqual([["Alerting the Organiser failed:", `getaddrinfo ENOTFOUND ${DATABASE}`]]);
    }
    expect(telegram.calls).toEqual([]);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("TELEGRAM_ORGANISER_CHAT_ID", CHAT);
    telegram.override = () => Response.json({ ok: false, description: "Forbidden: bot was blocked by the user" }, { status: 403 });
    logged.mockClear();
    await vercelRuns(new Date(SUNDAY.getTime() + HOUR));
    expect(logged.mock.calls.at(-1)).toEqual(["Telling the Organiser that the database can't be used failed: Telegram refused it: Forbidden: bot was blocked by the user."]);
    expect(dms()).toEqual([]);
  });
});
