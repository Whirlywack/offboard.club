// A fake Telegram Bot API for tests and local runs (scripts/fake-telegram.ts): sendMessage, as core.telegram.org/bots/api
// describes it. A request is /bot<token>/<method>, the method's name in any case, its parameters in the query string or
// a form or JSON body; the answer is JSON with "ok", and on a refusal "error_code" and "description":
// - a token the bot does not have is 401 "Unauthorized", a method Telegram does not have 404 "Not Found";
// - a chat the bot is not in is 400 "Bad Request: chat not found";
// - a text that is empty, or longer than 4096 characters, is 400 "Bad Request: message text is empty" or "message is
//   too long";
// - a posted message comes back as the Message, with its id, chat and text.
//
// Every request is recorded in `calls`, and each posted message in `posts`. `override` stands in for Telegram's answer:
// a Response; "unreachable", a connection that is never made; "silent", a request that is never answered; "lost", a
// message posted whose answer never arrives. Use `fetch` in place of the global one for these.

export type FakeTelegramCall = { method: string; token: string; params: Record<string, unknown> };
export type FakeTelegramPost = { chatId: string; text: string };
type Override = Response | "unreachable" | "silent" | "lost" | undefined;

export const MAX_TEXT = 4096;

const answer = (status: number, description: string) => Response.json({ ok: false, error_code: status, description }, { status });

async function paramsOf(request: Request, url: URL): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (request.method !== "POST") return params;
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("application/json")) return { ...params, ...(await request.json()) };
  return { ...params, ...Object.fromEntries(new URLSearchParams(await request.text())) };
}

export function createFakeTelegram(options: { token: string; chats: string[] }) {
  let lastMessageId = 0;
  const fake = {
    calls: [] as FakeTelegramCall[],
    posts: [] as FakeTelegramPost[],
    override: undefined as ((call: FakeTelegramCall) => Override) | undefined,

    async handle(request: Request): Promise<Response> {
      const { response } = await fake.receive(request);
      return response ?? answer(500, "Internal Server Error");
    },

    // The call as Telegram read it, and its answer, which is null when no answer comes.
    async receive(request: Request): Promise<{ call: FakeTelegramCall | null; response: Response | null; override: Override }> {
      const url = new URL(request.url);
      const path = /^\/bot([^/]*)\/([^/]+)$/.exec(url.pathname);
      if (!path) return { call: null, response: answer(404, "Not Found"), override: undefined };
      const call = { method: path[2], token: decodeURIComponent(path[1]), params: await paramsOf(request, url) };
      fake.calls.push(call);
      const override = fake.override?.(call);
      if (override instanceof Response) return { call, response: override, override };
      if (override === "unreachable" || override === "silent") return { call, response: null, override };
      if (call.token !== options.token) return { call, response: answer(401, "Unauthorized"), override };
      if (call.method.toLowerCase() !== "sendmessage") return { call, response: answer(404, "Not Found"), override };
      const chatId = String(call.params.chat_id ?? "");
      const text = typeof call.params.text === "string" ? call.params.text : "";
      if (!options.chats.includes(chatId)) return { call, response: answer(400, "Bad Request: chat not found"), override };
      if (!text) return { call, response: answer(400, "Bad Request: message text is empty"), override };
      if (text.length > MAX_TEXT) return { call, response: answer(400, "Bad Request: message is too long"), override };
      fake.posts.push({ chatId, text });
      const message = { message_id: ++lastMessageId, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "supergroup" }, text };
      return { call, response: override === "lost" ? null : Response.json({ ok: true, result: message }), override };
    },

    // As the global fetch does: a connection never made rejects at once, as Node's does ("fetch failed", with the
    // system's error as its cause); an answer that never comes waits for the request's signal.
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const { response, override } = await fake.receive(new Request(input, init));
      if (override === "unreachable")
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
      if (response) return response;
      const signal = init?.signal;
      return new Promise((_, reject) => {
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  };
  return fake;
}
