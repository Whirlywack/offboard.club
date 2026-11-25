// The Club's Telegram bot (#13). It only posts, through the one request below, sendMessage, which can post to any chat:
// to the Club's group, the reminders and Recaps (lib/post-to-telegram.ts) and the notices of the schedule
// (lib/seasons.ts). It reads nothing and sends no message to a Member. Members join the group by its invite link, which
// the site shows to Members only.
//
// Telegram's Bot API (core.telegram.org/bots/api): POST https://api.telegram.org/bot<token>/sendMessage with chat_id and
// text; the answer is JSON whose "ok" says whether the message was posted, with a "description" when it was not. The
// token travels in the path, so no address, request or answer is logged or put in a message.
//
// Every post is queued in "telegramPost" (migrations/008_telegram.sql) and sent from there by deliverPosts, once.

import { db } from "./db";
import { timeLimit } from "./lichess";

// Each described in .env.example. Without the token or the group nothing is posted; without the invite link no Member
// is shown it. Each must be in its form to count as set: the token goes in the request's path, and the link on a page.
const FORMS = {
  TELEGRAM_BOT_TOKEN: /^[A-Za-z0-9_:-]{1,200}$/,
  TELEGRAM_GROUP_ID: /^(-?\d{1,20}|@[A-Za-z0-9_]{1,64})$/, // a chat's id, or a public group's @username
  TELEGRAM_INVITE_LINK: /^https:\/\/t\.me\/[A-Za-z0-9_+/-]{1,200}$/,
};
type Setting = keyof typeof FORMS;

const setting = (name: Setting) => {
  const value = process.env[name];
  return value && FORMS[name].test(value) ? value : null;
};

export const postingSetUp = () => setting("TELEGRAM_BOT_TOKEN") !== null && setting("TELEGRAM_GROUP_ID") !== null;

// The group's invite link, for Members only: never on a page a visitor can open, nor in one built ahead.
export const inviteLink = () => setting("TELEGRAM_INVITE_LINK");

// Why Telegram is not fully set up, as a sentence for the Organiser page, or null when it is.
export function telegramProblem(): string | null {
  const missing = (Object.keys(FORMS) as Setting[]).filter((name) => setting(name) === null);
  if (missing.length === 0) return null;
  const off = [!postingSetUp() && "the bot posts nothing", !inviteLink() && "Members aren't shown the group's invite link"];
  const names = new Intl.ListFormat("en-GB", { type: "conjunction" }).format(missing);
  return `Telegram isn't set up: ${names} ${missing.length === 1 ? "is" : "are"} missing or not in the form .env.example gives, so ${off.filter(Boolean).join(" and ")}.`;
}

// How a post names a Matchday's Sunday: "Sunday 29 November".
export const postDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

// TELEGRAM_URL points development and tests at a fake Telegram; production always talks to api.telegram.org.
export const fakeTelegramUrl = () => (process.env.NODE_ENV !== "production" && process.env.TELEGRAM_URL) || null;

const TIMEOUT_MS = 10_000;

// The errors of a connection that was never made, by Node's codes for them: such a request never reached Telegram.
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

// Whether Telegram posted the message: true; false when it refused it or never got it; "perhaps" when the request went
// out and no answer that says came back.
export type Sent = { posted: true } | { posted: false | "perhaps"; problem: string };

type Answer = { ok?: unknown; description?: unknown; parameters?: { migrate_to_chat_id?: unknown } | null };

// Telegram's own short reason for a refusal, such as "Bad Request: chat not found", never the whole answer. A group that
// became a supergroup has a new id, which Telegram gives.
function refusal(body: Answer) {
  const why = typeof body.description === "string" ? body.description.slice(0, 200) : "no reason given";
  const moved = body.parameters?.migrate_to_chat_id;
  return `Telegram refused it: ${why}${typeof moved === "number" ? `. The group's id is now ${moved}` : ""}`;
}

// One try at posting `text` to the chat `chatId`, within 10 s.
export async function sendMessage(chatId: string, text: string): Promise<Sent> {
  const token = setting("TELEGRAM_BOT_TOKEN");
  if (!token) return { posted: false, problem: "TELEGRAM_BOT_TOKEN isn't set" };
  const url = new URL(`/bot${token}/sendMessage`, fakeTelegramUrl() ?? "https://api.telegram.org");
  const limit = timeLimit(TIMEOUT_MS, `Telegram didn't answer within ${TIMEOUT_MS / 1000} s`);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        redirect: "manual",
        signal: limit.signal,
      });
    } catch (error) {
      const code = (error as { cause?: { code?: unknown } }).cause?.code;
      if (!limit.signal.aborted && typeof code === "string" && NEVER_SENT.has(code)) return { posted: false, problem: "Telegram couldn't be reached" };
      return { posted: "perhaps", problem: limit.signal.aborted ? (limit.signal.reason as Error).message : "the connection to Telegram broke" };
    }
    // An answer that is not Telegram's JSON, such as a proxy's error page, does not say whether the message was posted.
    const body = (await response.json().catch(() => null)) as Answer | null;
    if (typeof body?.ok === "boolean") return body.ok ? { posted: true } : { posted: false, problem: refusal(body) };
    return { posted: "perhaps", problem: limit.signal.aborted ? (limit.signal.reason as Error).message : `Telegram answered ${response.status} without saying` };
  } finally {
    limit.clear();
  }
}

export type Post = { key: string; text: string; until: Date };

// Queues a post for the group, unless one with its key is queued already.
export async function queuePost({ key, text, until }: Post) {
  await db.query(`insert into "telegramPost" ("key", "text", "until") values ($1, $2, $3) on conflict ("key") do nothing`, [key, text, until]);
}

// Whether a post with this key has been queued.
export async function queued(key: string): Promise<boolean> {
  const { rowCount } = await db.query(`select 1 from "telegramPost" where "key" = $1`, [key]);
  return rowCount === 1;
}

// How many a delivery sends at most: Telegram lets a bot post 20 messages a minute to a group, and a run has a few
// minutes. The rest wait for the next.
export const MAX_PER_DELIVERY = 10;

// What a delivery did: how many posts went out, and the one that could not be sent, if any, with whether Telegram may
// have posted it all the same.
export type Delivery = { posted: number; failed: { text: string; problem: string; perhaps: boolean } | null };

// Sends the posts that are waiting, oldest first, to the Club's group, until one cannot be sent. Exactly once:
// - Each is claimed before it is sent, by one statement that takes a post nobody has claimed, so of deliveries at the
//   same moment each sends different posts, and a post claimed is sent by its claimer alone.
// - A post Telegram refused, or that never reached it, is given back, and the next delivery tries it again.
// - A post that may have been posted without Telegram saying so stays claimed and is never sent again; so does one
//   whose delivery died while sending it.
// - A post is not sent after its "until", as of `now`.
// Throws if the database fails.
export async function deliverPosts(now: Date): Promise<Delivery> {
  const group = setting("TELEGRAM_GROUP_ID");
  let posted = 0;
  if (!group || !postingSetUp()) return { posted, failed: null };
  while (posted < MAX_PER_DELIVERY) {
    const { rows } = await db.query<{ key: string; text: string }>(
      `update "telegramPost" set "claimedAt" = now()
       where "key" = (select "key" from "telegramPost" where "claimedAt" is null and "until" > $1 order by "createdAt", "key" limit 1 for update skip locked)
       returning "key", "text"`,
      [now],
    );
    const post = rows[0];
    if (!post) break;
    const sent = await sendMessage(group, post.text);
    if (sent.posted === true) {
      await db.query(`update "telegramPost" set "sentAt" = now() where "key" = $1`, [post.key]);
      posted++;
      continue;
    }
    if (sent.posted === false) await db.query(`update "telegramPost" set "claimedAt" = null where "key" = $1 and "sentAt" is null`, [post.key]);
    return { posted, failed: { text: post.text, problem: sent.problem, perhaps: sent.posted === "perhaps" } };
  }
  return { posted, failed: null };
}
