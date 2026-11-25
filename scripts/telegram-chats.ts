// The chats the Club's bot knows of, each with its id, for the two settings that take one: TELEGRAM_GROUP_ID, the
// group's, and TELEGRAM_ORGANISER_CHAT_ID, the Organiser's own chat, for the private alerts (#17). `pnpm telegram-chats`,
// then paste the bot's token when asked: it is read without being shown, and is never an argument, printed, logged or
// written anywhere. .env.example has the steps around it.
//
// It asks Telegram once, by getUpdates (core.telegram.org/bots/api), what has reached the bot: a /start in a private
// chat, the bot being added to a group (a my_chat_member update, which comes whatever the bot's privacy mode), a message
// in the group, a group becoming a supergroup with a new id (migrate_to_chat_id). Without an offset, getUpdates confirms
// nothing, so the next call finds the same; without allowed_updates, it leaves the kinds of update the bot gets as they
// were. Telegram keeps an update 24 hours at most, and refuses getUpdates while a webhook is set, which the site never
// sets. TELEGRAM_URL points it at the fake Telegram outside production, as it does the site.
import { timeLimit } from "@/lib/lichess";
import { fakeTelegramUrl, isBotToken } from "@/lib/telegram";

if (process.argv.length > 2) {
  console.error("Usage: pnpm telegram-chats, with no arguments: it asks for the bot's token, which is never an argument.");
  process.exit(1);
}

// The first line on standard input: typed into a terminal, where nothing typed or pasted is shown, or piped in.
async function readToken(): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    let text = "";
    for await (const chunk of stdin) text += chunk;
    return text.split(/\r?\n/)[0].trim();
  }
  // The terminal stops showing what is typed before it is asked for.
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdout.write("The bot's token, from @BotFather (it isn't shown as you paste it): ");
  return new Promise((resolve, reject) => {
    let typed = "";
    const finish = (then: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      then();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish(() => resolve(typed.trim()));
        if (char === "\u0003" || char === "\u0004") return finish(() => reject(new Error("Stopped: nothing was asked of Telegram.")));
        typed = char === "\u007f" || char === "\b" ? typed.slice(0, -1) : typed + char;
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

// Words as Telegram gave them, such as a chat's title, which anyone in it chose: no control character reaches the
// terminal, and at most `most` characters.
const shown = (text: unknown, most = 64) => [...String(text ?? "").replace(/\p{Cc}/gu, " ")].slice(0, most).join("").trim() || "(no name)";

type Chat = { id?: unknown; type?: unknown; title?: unknown; first_name?: unknown; last_name?: unknown };
type Answer = { ok?: unknown; description?: unknown; result?: unknown };

async function main(): Promise<number> {
  const token = await readToken();
  if (!isBotToken(token)) {
    console.error("That isn't a bot's token: copy it again from @BotFather, the whole of it.");
    return 1;
  }
  const fake = fakeTelegramUrl();
  if (fake) console.log(`Asking the fake Telegram at ${URL.parse(fake)?.origin ?? fake}.`);
  const limit = timeLimit(10_000, "Telegram didn't answer within 10 s");
  let body: Answer | null;
  try {
    // The address holds the token, so neither it nor an error that could hold it is printed.
    const response = await fetch(new URL(`/bot${token}/getUpdates`, fake ?? "https://api.telegram.org"), { redirect: "manual", signal: limit.signal });
    body = (await response.json().catch(() => null)) as Answer | null;
  } catch {
    console.error(limit.signal.aborted ? "Telegram didn't answer within 10 s." : "Couldn't reach Telegram.");
    return 1;
  } finally {
    limit.clear();
  }
  if (body?.ok !== true || !Array.isArray(body.result)) {
    console.error(`Telegram refused: ${shown(typeof body?.description === "string" ? body.description : "no reason given", 200)}.`);
    return 1;
  }

  // Each chat by its id, as the latest update names it, and the id a group moved to when it became a supergroup.
  const chats = new Map<number, { kind: string; name: string; movedTo?: number }>();
  for (const update of body.result)
    for (const part of Object.values((update ?? {}) as Record<string, unknown>)) {
      const { chat, migrate_to_chat_id: movedTo } = (part ?? {}) as { chat?: Chat; migrate_to_chat_id?: unknown };
      if (typeof chat?.id !== "number") continue;
      const name = chat.type === "private" ? [chat.first_name, chat.last_name].filter(Boolean).join(" ") : chat.title;
      chats.set(chat.id, { kind: shown(chat.type), name: shown(name), movedTo: typeof movedTo === "number" ? movedTo : chats.get(chat.id)?.movedTo });
    }
  if (chats.size === 0) {
    console.log(
      "Telegram has nothing for the bot from the last 24 hours, the longest it keeps anything. In Telegram, open the bot and send it /start; for the group, remove the bot from it and add it back. Then run this again.",
    );
    return 0;
  }
  console.log("The chats the bot has heard from in the last 24 hours:");
  for (const [id, { kind, name, movedTo }] of chats) {
    if (kind === "private") console.log(`  ${id}  private chat with ${name}: if that's you, this is TELEGRAM_ORGANISER_CHAT_ID`);
    else if (movedTo !== undefined) console.log(`  ${id}  ${kind} "${name}", which became a supergroup with the id ${movedTo}: use that one`);
    else if (kind === "group" || kind === "supergroup") console.log(`  ${id}  ${kind} "${name}": this is TELEGRAM_GROUP_ID`);
    else console.log(`  ${id}  ${kind} "${name}": for neither setting`);
  }
  console.log("Set each in Vercel's Production environment variables, then redeploy.");
  return 0;
}

main()
  .catch((error: Error) => {
    console.error(error.message);
    return 1;
  })
  .then((code) => process.exit(code));
