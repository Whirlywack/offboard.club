// The tests' fake Telegram (lib/fixtures/fake-telegram.ts) as a server at TELEGRAM_URL, so that the bot's posts can be
// read without Telegram: each message the site posts is printed here as the group would show it. It posts them, as
// Telegram would, only to the chats TELEGRAM_GROUP_ID and TELEGRAM_ORGANISER_CHAT_ID name, the second the Organiser's
// own, which gets the private alerts, for the bot TELEGRAM_BOT_TOKEN names. `pnpm fake-telegram`,
// in the foreground beside `pnpm dev:local`, with the block from `pnpm db:start` in .env.local; it listens on 127.0.0.1
// alone. Then `pnpm post-to-telegram <time>` posts what is due at that time, and `pnpm collect-results` the Recap of
// the Matchday it collects.
import { createServer } from "node:http";
import { record } from "./local-db.mjs";
import { createFakeTelegram } from "@/lib/fixtures/fake-telegram";

if (process.argv.length > 2) {
  console.error("Usage: pnpm fake-telegram, with no arguments.");
  process.exit(1);
}
const address = URL.parse(process.env.TELEGRAM_URL ?? "");
if (address?.hostname !== "127.0.0.1") {
  console.error("Refusing to start the fake Telegram: TELEGRAM_URL is not http://127.0.0.1:<port>. Put the block from pnpm db:start in .env.local.");
  process.exit(1);
}

const telegram = createFakeTelegram({
  token: process.env.TELEGRAM_BOT_TOKEN ?? "",
  chats: [process.env.TELEGRAM_GROUP_ID ?? "", process.env.TELEGRAM_ORGANISER_CHAT_ID ?? ""],
});

createServer(async (request, reply) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const url = new URL(request.url ?? "/", address);
  const headers = Object.entries(request.headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : []));
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const before = telegram.posts.length;
  const response = await telegram
    .handle(new Request(url, { method: request.method, headers: headers as [string, string][], body }))
    .catch((error: Error) => Response.json({ ok: false, error_code: 400, description: `Bad Request: ${error.message}` }, { status: 400 }));
  // The method and status only: the path holds the bot's token.
  console.log(`${request.method} ${telegram.calls.at(-1)?.method ?? "?"} ${response.status}`);
  for (const post of telegram.posts.slice(before)) console.log(`\n--- Posted to ${post.chatId} ---\n${post.text}\n---\n`);
  reply.writeHead(response.status, Object.fromEntries(response.headers));
  reply.end(Buffer.from(await response.arrayBuffer()));
})
  .once("error", (error) => {
    console.error(`The fake Telegram could not listen at ${address.origin}: ${error.message}`);
    process.exit(1);
  })
  .listen(Number(address.port), "127.0.0.1", () => {
    record("fake Telegram", Number(address.port)); // for pnpm local:list and pnpm local:stop
    console.log(`The fake Telegram is at ${address.origin}.`);
  });
