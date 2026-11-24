// The Lichess client's manners: one request at a time, a User-Agent naming the site, and a minute's wait then one
// retry after a rate-limit response. Only fetch is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("./lichess");
let lichess: Client;

// A fetch whose answers the test hands out one at a time, recording what was asked for.
function controlledFetch() {
  const asked: { url: string; init: RequestInit; answer: (response: Response) => void }[] = [];
  const fetch = vi.fn(
    (url: URL, init: RequestInit) =>
      new Promise<Response>((resolve) => asked.push({ url: String(url), init, answer: resolve })),
  );
  return { fetch, asked };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubEnv("LICHESS_URL", "https://fake.lichess.test");
  vi.resetModules(); // a fresh queue for each test
  lichess = await import("./lichess");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("every request", () => {
  it("names offboard.club in its User-Agent, asks for JSON and carries the token only in a header", async () => {
    const { fetch, asked } = controlledFetch();
    vi.stubGlobal("fetch", fetch);
    const account = lichess.getAccount("lio_secret");
    await flush();
    asked[0].answer(Response.json({ id: "bobby", username: "Bobby" }));
    await account;

    const headers = asked[0].init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/offboard\.club/);
    expect(headers.Accept).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer lio_secret");
    expect(asked[0].url).toBe("https://fake.lichess.test/api/account");
    expect(asked[0].url).not.toContain("lio_secret");
  });

  it("goes to lichess.org in production, whatever LICHESS_URL says", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(lichess.lichessUrl("/api/account").toString()).toBe("https://lichess.org/api/account");
  });
});

describe("one request at a time", () => {
  it("sends the next request only once the previous one, body included, has been read", async () => {
    const { fetch, asked } = controlledFetch();
    vi.stubGlobal("fetch", fetch);
    let finishReading!: () => void;
    const first = lichess.lichessRequest("/first", {}, () => new Promise<void>((done) => (finishReading = done)));
    const second = lichess.lichessRequest("/second", {}, (response) => response.status);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    asked[0].answer(new Response("{}"));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1); // the first is still being read

    finishReading();
    await first;
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(asked[1].url).toBe("https://fake.lichess.test/second");
    asked[1].answer(new Response(null, { status: 204 }));
    expect(await second).toBe(204);
  });

  it("carries on with the next request after one fails", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const first = lichess.lichessRequest("/first", {}, () => "read");
    const second = lichess.lichessRequest("/second", {}, () => "read");
    await expect(first).rejects.toThrow("fetch failed");
    await expect(second).resolves.toBe("read");
  });
});

describe("giving up", () => {
  // A fetch that never answers, but stops when its signal aborts, as fetch does.
  const silent = () =>
    vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );

  it("gives up on an attempt that gets no answer within 30 s", async () => {
    vi.stubGlobal("fetch", silent());
    const result = lichess.lichessRequest("/api/account", {}, () => "read");
    const settled = expect(result).rejects.toThrow(/within 30 s/);
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
  });

  it("stops when the caller's signal aborts, also while waiting after a 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429 })));
    const caller = new AbortController();
    const result = lichess.lichessRequest("/api/account", { signal: caller.signal }, () => "read");
    const settled = expect(result).rejects.toThrow("given up");
    await vi.advanceTimersByTimeAsync(10_000);
    caller.abort(new Error("given up"));
    await settled;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lets a request given up while waiting its turn go, without the next one overtaking the one in flight", async () => {
    const { fetch, asked } = controlledFetch();
    vi.stubGlobal("fetch", fetch);
    const caller = new AbortController();
    const first = lichess.lichessRequest("/first", {}, (response) => response.status);
    const abandoned = lichess.lichessRequest("/abandoned", { signal: caller.signal }, (response) => response.status);
    const third = lichess.lichessRequest("/third", {}, (response) => response.status);
    caller.abort(new Error("given up"));
    await expect(abandoned).rejects.toThrow("given up");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1); // /third still waits for /first

    asked[0].answer(new Response(null, { status: 200 }));
    expect(await first).toBe(200);
    await flush();
    expect(asked.map((a) => new URL(a.url).pathname)).toEqual(["/first", "/third"]);
    asked[1].answer(new Response(null, { status: 204 }));
    expect(await third).toBe(204);
  });
});

describe("after a rate-limit response", () => {
  it("waits a full minute, then tries once more", async () => {
    const { fetch, asked } = controlledFetch();
    vi.stubGlobal("fetch", fetch);
    const result = lichess.lichessRequest("/api/account", {}, (response) => response.status);
    await flush();
    asked[0].answer(new Response(null, { status: 429 }));

    await vi.advanceTimersByTimeAsync(lichess.RATE_LIMIT_WAIT_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(asked[1].url).toBe(asked[0].url);

    asked[1].answer(new Response(null, { status: 200 }));
    expect(await result).toBe(200);
  });

  it("tries only once more: a second 429 is the answer", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const result = lichess.lichessRequest("/api/account", {}, (response) => response.status);
    await vi.advanceTimersByTimeAsync(10 * lichess.RATE_LIMIT_WAIT_MS);
    expect(await result).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("holds back every other request while it waits", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const first = lichess.lichessRequest("/first", {}, (response) => response.status);
    const second = lichess.lichessRequest("/second", {}, (response) => response.status);

    await vi.advanceTimersByTimeAsync(lichess.RATE_LIMIT_WAIT_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toBe(200);
    expect(await second).toBe(200);
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/first", "/first", "/second"]);
  });

  it("turns a lasting rate limit into an error when a call expects an answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429 })));
    const account = lichess.getAccount("lio_secret");
    const settled = expect(account).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(lichess.RATE_LIMIT_WAIT_MS);
    await settled;
  });
});

describe("reading Lichess's answers", () => {
  const answering = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));

  it("reads the account's id, username and blitz rating", async () => {
    answering({ id: "bobby", username: "Bobby", perfs: { blitz: { games: 674, rating: 1623, rd: 64, prog: 43 } } });
    expect(await lichess.getAccount("t")).toEqual({ id: "bobby", username: "Bobby", blitzRating: 1623 });
    answering({ id: "newbie", username: "Newbie", perfs: {} });
    expect(await lichess.getAccount("t")).toEqual({ id: "newbie", username: "Newbie", blitzRating: null });
  });

  it("reads an account's mark from its public profile, asking without a token", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "cheat", username: "Cheat", tosViolation: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await lichess.isMarked("cheat")).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://fake.lichess.test/api/user/cheat");
    expect(init.headers).not.toHaveProperty("Authorization");
    answering({ id: "bobby", username: "Bobby" });
    expect(await lichess.isMarked("bobby")).toBe(false);
  });

  it("refuses an account it cannot make sense of", async () => {
    answering({ id: "../admin", username: "<b>x</b>" });
    await expect(lichess.getAccount("t")).rejects.toThrow(lichess.LichessError);
  });

  it("reports a refused team join with Lichess's reason, but not the password", async () => {
    answering({ error: "This team requires a password." }, 400);
    const refusal = lichess.joinTeam("t", "offboard", "hunter2");
    await expect(refusal).rejects.toMatchObject({ status: 400, message: expect.stringContaining("requires a password") });
    await expect(refusal).rejects.not.toMatchObject({ message: expect.stringContaining("hunter2") });
  });

  it("asks for accounts 300 at a time, as plain text and without a token, and reads their ratings and marks", async () => {
    const fetch = vi.fn(async (_url: URL, init: RequestInit) =>
      Response.json(
        String(init.body)
          .split(",")
          .map((id) =>
            id === "closed" ? { id, username: id, disabled: true } : { id, username: id, perfs: { blitz: { rating: 1500 } }, ...(id === "cheat" && { tosViolation: true }) },
          ),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const ids = ["cheat", "closed", ...Array.from({ length: 299 }, (_, i) => `player${i}`)];
    const accounts = await lichess.getPublicAccounts(ids);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [[url, init], [, second]] = fetch.mock.calls;
    expect(String(url)).toBe("https://fake.lichess.test/api/users?profile=false");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "text/plain" });
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(String(init.body).split(",")).toHaveLength(300);
    expect(String(second.body)).toBe("player298");
    expect(accounts).toHaveLength(301);
    expect(accounts.slice(0, 3)).toEqual([
      { id: "cheat", blitzRating: 1500, marked: true, closed: false },
      { id: "closed", blitzRating: null, marked: false, closed: true },
      { id: "player0", blitzRating: 1500, marked: false, closed: false },
    ]);
  });

  it("refuses an answer with accounts it did not ask for", async () => {
    answering([{ id: "someone-else", username: "x" }]);
    await expect(lichess.getPublicAccounts(["bobby"])).rejects.toThrow(lichess.LichessError);
  });

  it("tells a Swiss tournament Lichess does not have from one it cannot read", async () => {
    answering({ id: "PF2C2AUC", status: "finished", startsAt: "2026-11-24T13:30:00Z", name: "x" });
    expect(await lichess.getSwiss("PF2C2AUC")).toEqual({ id: "PF2C2AUC", status: "finished", startsAt: new Date("2026-11-24T13:30:00Z") });
    answering({ error: "Not found" }, 404);
    expect(await lichess.getSwiss("PF2C2AUC")).toBeNull();
    answering({ id: "PF2C2AUC", status: "paused", startsAt: "2026-11-24T13:30:00Z" });
    await expect(lichess.getSwiss("PF2C2AUC")).rejects.toThrow(lichess.LichessError);
    answering({ error: "oops" }, 500);
    await expect(lichess.getSwiss("PF2C2AUC")).rejects.toMatchObject({ status: 500 });
  });

  it("stops reading a team's tournaments, latest first, once past the start of the one it looks for", async () => {
    const swiss = { id: "Target01", status: "finished" as const, startsAt: new Date("2026-11-22T18:00:00Z") };
    // Weekly tournaments from 6 December back to March, one starting at the same moment as the one looked for.
    const listing = Array.from({ length: 40 }, (_, i) => {
      const startsAt = new Date(Date.parse("2026-12-06T18:00:00Z") - i * 7 * 86_400_000).toISOString();
      return { id: i === 2 ? "Other022" : `Swiss${String(i).padStart(3, "0")}`, status: "finished", startsAt };
    });
    // One line at a time, as Lichess streams them, counting how many were sent before reading stopped.
    let sent = 0;
    let cancelled = false;
    const stream = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent === listing.length) return controller.close();
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify(listing[sent++])}\n`));
        },
        cancel: () => void (cancelled = true),
      });
    const fetch = vi.fn(async () => new Response(stream(), { headers: { "content-type": "application/x-ndjson" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await lichess.teamHasSwiss("offboard", swiss)).toBe(false);
    expect(sent).toBeLessThan(listing.length);
    expect(cancelled).toBe(true);
    const [[url, init]] = fetch.mock.calls as unknown as [URL, RequestInit][];
    expect(String(url)).toBe("https://fake.lichess.test/api/team/offboard/swiss?max=300");
    expect(init.headers).toMatchObject({ Accept: "application/x-ndjson" });

    sent = 0;
    listing[2].id = "Target01";
    expect(await lichess.teamHasSwiss("offboard", swiss)).toBe(true);
  });

  it("refuses a token that is not in Lichess's token format", async () => {
    answering({ token_type: "Bearer", access_token: "abc\r\nX-Evil: 1", expires_in: 1 });
    await expect(lichess.exchangeCode({ code: "c", verifier: "v", redirectUri: "r", clientId: "x" })).rejects.toThrow(
      lichess.LichessError,
    );
  });
});
