// `pnpm telegram-chats` (scripts/telegram-chats.ts) as the Organiser runs it, the token piped to it, against the fake
// Telegram (lib/fixtures/fake-telegram.ts) served on a local port: what it prints for each kind of chat, that it
// confirms nothing on Telegram, and that the token never shows.
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";

const TOKEN = "1:a-pretend-bot-token";
const telegram = createFakeTelegram({ token: TOKEN, chats: [] });
let server: Server;
let address: string;

// The script's run, with `input` on its standard input: what it printed, and how it exited.
function run(input: string, args: string[] = [], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn("node_modules/.bin/tsx", ["scripts/telegram-chats.ts", ...args], { env: { ...process.env, TELEGRAM_URL: address, ...env } });
    let [out, err] = ["", ""];
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

beforeAll(async () => {
  server = createServer(async (request, reply) => {
    const response = await telegram.handle(new Request(new URL(request.url ?? "/", address), { method: request.method }));
    reply.writeHead(response.status, Object.fromEntries(response.headers));
    reply.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  telegram.calls.length = 0;
  telegram.webhook = false;
  telegram.updates = [
    { update_id: 10, my_chat_member: { chat: { id: -1001234567890, type: "supergroup", title: "Offboard \u001b[31mChess" }, from: { id: 42 } } },
    { update_id: 11, message: { message_id: 1, chat: { id: 42, type: "private", first_name: "Rasa", last_name: "Arbiter" }, text: "/start" } },
    { update_id: 12, message: { message_id: 2, chat: { id: -4001, type: "group", title: "Old group" }, migrate_to_chat_id: -1004001 } },
    { update_id: 13, channel_post: { message_id: 3, chat: { id: -1009999, type: "channel", title: `A channel ${"with a long name ".repeat(9)}` } } },
  ];
});

describe("pnpm telegram-chats", () => {
  it("prints each chat the bot knows of with its id and the setting it belongs in, twice the same, confirming nothing", async () => {
    for (let time = 0; time < 2; time++) {
      const { code, out, err } = await run(`${TOKEN}\n`);
      expect([code, err]).toEqual([0, ""]);
      expect(out.split("\n")).toEqual([
        `Asking the fake Telegram at ${address}.`,
        "The chats the bot has heard from in the last 24 hours:",
        // The title's terminal escape is not passed on.
        '  -1001234567890  supergroup "Offboard  [31mChess": this is TELEGRAM_GROUP_ID',
        "  42  private chat with Rasa Arbiter: if that's you, this is TELEGRAM_ORGANISER_CHAT_ID",
        '  -4001  group "Old group", which became a supergroup with the id -1004001: use that one',
        // At most 64 characters of a name.
        '  -1009999  channel "A channel with a long name with a long name with a long name wit": for neither setting',
        "Set each in Vercel's Production environment variables, then redeploy.",
        "",
      ]);
      expect(out).not.toContain(TOKEN);
    }
    // Asked with no offset, which would confirm, and with no allowed_updates, which would change what the bot gets.
    expect(telegram.calls.map((call) => [call.method, call.params])).toEqual([
      ["getUpdates", {}],
      ["getUpdates", {}],
    ]);
  }, 30_000);

  it("says what to do when Telegram has nothing for the bot", async () => {
    telegram.updates = [];
    const { code, out } = await run(`${TOKEN}\n`);
    expect(code).toBe(0);
    expect(out).toContain("Telegram has nothing for the bot from the last 24 hours, the longest it keeps anything. In Telegram, open the bot and send it /start; for the group, remove the bot from it and add it back. Then run this again.");
  }, 30_000);

  it("never shows the token, even when Telegram refuses it or a webhook is set", async () => {
    const wrong = "2:not-the-bot-token";
    let result = await run(`${wrong}\n`);
    expect([result.code, result.err]).toEqual([1, "Telegram refused: Unauthorized.\n"]);
    expect(result.out + result.err).not.toContain(wrong);
    telegram.webhook = true;
    result = await run(`${TOKEN}\n`);
    expect(result.err).toBe("Telegram refused: Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first.\n");
    expect(result.out + result.err).not.toContain(TOKEN);
  }, 30_000);

  it("takes the token only when asked, never as an argument, and only in a token's form, asking Telegram nothing otherwise", async () => {
    let result = await run("", [TOKEN]);
    expect([result.code, result.out, result.err]).toEqual([1, "", "Usage: pnpm telegram-chats, with no arguments: it asks for the bot's token, which is never an argument.\n"]);
    result = await run("not/a token\n");
    expect([result.code, result.err]).toEqual([1, "That isn't a bot's token: copy it again from @BotFather, the whole of it.\n"]);
    expect(result.out + result.err).not.toContain("not/a token");
    expect(telegram.calls).toEqual([]);
  }, 30_000);
});
