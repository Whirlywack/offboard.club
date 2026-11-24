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

  it("refuses a token that is not in Lichess's token format", async () => {
    answering({ token_type: "Bearer", access_token: "abc\r\nX-Evil: 1", expires_in: 1 });
    await expect(lichess.exchangeCode({ code: "c", verifier: "v", redirectUri: "r", clientId: "x" })).rejects.toThrow(
      lichess.LichessError,
    );
  });
});
