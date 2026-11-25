// Private alerts to the Organiser (#17): direct messages from the Club's bot to the Organiser's own Telegram chat, never
// to the group, so that a silent failure does not cost a Sunday. Vercel runs this job every hour (vercel.json,
// app/api/jobs/alert-organiser). A run queues what is due in "telegramPost" under ALERT (lib/telegram.ts), from where
// each alert is sent once and never twice, then sends what is waiting:
// - A scheduled job whose last run failed, by the sentence the Organiser page shows for it (lib/jobs.ts). The same
//   failure is the same job failing with the same sentence: it is alerted once, and again a day later while it still
//   fails, as an alert is worth sending for a day and is forgotten then. Another sentence is another failure, alerted
//   at once. A job that failed and recovered between two runs, such as Collecting results while Lichess was slow for a
//   few minutes, is not alerted: there is nothing left to do. This job's own failures are failures to send an alert, so
//   the Organiser page shows them and no alert is made of them.
// - No backup having been made for two days, while backups are set up: once a day until one is.
// - The Organiser's Lichess permission: 30 days before it ends, 7 days before, and on the day it ends. One revoked on
//   Lichess shows when Creating Matchdays next uses it, as that job's failure.
// Without the bot's token or the Organiser's chat id nothing is queued or sent, and the Organiser page says which is
// missing. A bot cannot message a person before they have pressed Start in a chat with it; .env.example has the steps.

import { createHash } from "node:crypto";
import { backupProblem, JOB as BACKUP } from "./backup";
import { JOB as COLLECT } from "./collect-results";
import { JOB as CREATE } from "./create-matchdays";
import { done, doneSince, failed, failingJobs, runJob, sentence, skipped, type JobRun } from "./jobs";
import { organiserPermission, type OrganiserPermission } from "./organiser-lichess";
import { JOB as POST } from "./post-to-telegram";
import { ZONE } from "./schedule";
import { ALERT, botSetUp, deliverAlerts, forgetPastPosts, groupId, queuePost, sendMessage, type Delivery } from "./telegram";

export const JOB = "alert-organiser";

// Each scheduled job by its name on the Organiser page, and in its alerts.
export const JOB_TITLES: Record<string, string> = {
  [CREATE]: "Creating Matchdays",
  [COLLECT]: "Collecting results",
  [POST]: "Posting to Telegram",
  [BACKUP]: "Backing up",
  [JOB]: "Alerting you",
};

const DAY = 86_400_000;
const WARN_DAYS = [30, 7];

// The Organiser's own chat, set in TELEGRAM_ORGANISER_CHAT_ID: a person's chat id is a positive number, at most 52 bits
// (core.telegram.org/bots/api, Chat), and a group's is negative, so no alert can go to a group.
const CHAT = /^[1-9]\d{0,15}$/;
const organiserChat = () => {
  const value = process.env.TELEGRAM_ORGANISER_CHAT_ID;
  return value && CHAT.test(value) ? value : null;
};

// Why no alert is sent, as a sentence for the Organiser page, or null when alerts are set up.
export function alertsProblem(): string | null {
  const missing = [!botSetUp() && "TELEGRAM_BOT_TOKEN", !organiserChat() && "TELEGRAM_ORGANISER_CHAT_ID"].filter((name) => name !== false);
  if (missing.length === 0) return null;
  return `Alerts are off: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing or not in the form .env.example gives, so the bot can't message you.`;
}

const MAX_TEXT = 1000;

// The settings that are secrets by their names, and the database's address and its parts, longest first. A job's
// sentence may hold an error's own message, which can name the database's host; an alert is kept by Telegram.
function secrets(): string[] {
  const named = Object.entries(process.env).filter(([name]) => /(SECRET|TOKEN|KEY|PASSWORD)$|^DATABASE_URL$/.test(name));
  const address = URL.parse(process.env.DATABASE_URL ?? "");
  const decoded = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  const parts = address ? [address.host, address.hostname, address.username, decoded(address.username), address.password, decoded(address.password)] : [];
  return [...named.map(([, value]) => value), ...parts].filter((value): value is string => !!value && value.length >= 4).sort((a, b) => b.length - a.length);
}

// An alert's words: none of those secrets, and at most 1,000 characters, well within Telegram's 4,096.
function privately(text: string) {
  const hidden = [...secrets().reduce((words, secret) => words.replaceAll(secret, "[hidden]"), text)];
  return hidden.length > MAX_TEXT ? `${hidden.slice(0, MAX_TEXT - 1).join("")}…` : hidden.join("");
}

// Queues an alert once by its words, worth sending until `until`, and forgotten then (forgetPastPosts).
async function queueAlert(text: string, until: Date) {
  const words = privately(text);
  await queuePost({ key: `${ALERT}${createHash("sha256").update(words).digest("hex").slice(0, 32)}`, text: words, until });
}

const day = (at: Date) => at.toLocaleDateString("en-GB", { timeZone: ZONE, day: "numeric", month: "long", year: "numeric" });

// The warning due about the permission at `now`, worth sending until the next is due; null if none is. The two before
// it ends say the same, and each is queued once, as the first is forgotten when the second is due.
function permissionAlert(permission: OrganiserPermission | null, now: Date): { text: string; until: Date } | null {
  if (!permission) return null;
  const ends = permission.expiresAt.getTime();
  const reconnect = "Connect Lichess again on the Organiser page";
  if (now.getTime() >= ends)
    return now.getTime() < ends + DAY
      ? { text: `Your Lichess permission ended on ${day(permission.expiresAt)}, so Matchdays aren't being created. ${reconnect}.`, until: new Date(ends + DAY) }
      : null;
  const stage = WARN_DAYS.findLastIndex((days) => now.getTime() >= ends - days * DAY);
  if (stage < 0) return null;
  const next = WARN_DAYS[stage + 1];
  return {
    text: `Your Lichess permission ends on ${day(permission.expiresAt)}. ${reconnect} before then.`,
    until: new Date(next === undefined ? ends : ends - next * DAY),
  };
}

// One run of the job at `now`: what it did and why. Throws only if the database cannot record the run.
export const alertOrganiser = (now: Date) => runJob(JOB, () => alert(now));

async function alert(now: Date): Promise<JobRun> {
  // First, so that an alert a day old is forgotten, and can be queued again if its failure stands.
  await forgetPastPosts(now);
  const chat = organiserChat();
  if (!botSetUp() || !chat) return skipped(alertsProblem()!);
  const aDay = new Date(now.getTime() + DAY);
  for (const { job, detail } of await failingJobs()) if (job !== JOB) await queueAlert(`${JOB_TITLES[job] ?? job}: ${detail}`, aDay);
  const since = await doneSince(BACKUP);
  if (!backupProblem() && since && now.getTime() - since.getTime() > 2 * DAY)
    await queueAlert(`Backing up: no backup of the database has been made since ${day(since)}.`, aDay);
  const warning = permissionAlert(await organiserPermission(), now);
  if (warning) await queueAlert(warning.text, warning.until);
  return outcome(await deliverAlerts(chat, now));
}

// --- A test message, from the Organiser page ---

// The bot's token and the chats' ids are kept on Vercel as secrets, which nobody can read back, so the Organiser checks
// them by sending a message: to their own chat, or to the group, where everyone sees it. One try, sent at once, neither
// queued nor tried again. What happened, as a sentence for the page: Telegram's own reason when it refused, which is
// never the token (lib/telegram.ts), and what is likely wrong when that reason says (Telegram answers 401 "Unauthorized"
// to a token it does not know, and 400 "chat not found" or 403 "Forbidden: ..." to a chat the bot has no way into).
export async function sendTestMessage(to: "me" | "group"): Promise<{ text: string; problem: boolean }> {
  const chat = to === "me" ? organiserChat() : groupId();
  const needs = [!botSetUp() && "TELEGRAM_BOT_TOKEN", !chat && (to === "me" ? "TELEGRAM_ORGANISER_CHAT_ID" : "TELEGRAM_GROUP_ID")].filter((name) => name !== false);
  if (!chat || needs.length > 0)
    return { text: `${needs.join(" and ")} ${needs.length === 1 ? "is" : "are"} missing or not in the form .env.example gives, so nothing was sent.`, problem: true };
  const sent = await sendMessage(chat, to === "me" ? "A test message from Offboard: the bot's alerts reach you here." : "A test message from Offboard's bot: its posts reach this group.");
  if (sent.posted === true) return { text: `Telegram took it: check ${to === "me" ? "your chat with the bot" : "the group"}.`, problem: false };
  const hint = /Unauthorized|Not Found/.test(sent.problem)
    ? " Check TELEGRAM_BOT_TOKEN: it is the whole token @BotFather gave."
    : /chat not found|Forbidden/.test(sent.problem)
      ? to === "me"
        ? " Open the bot in Telegram and press Start, then check TELEGRAM_ORGANISER_CHAT_ID."
        : " Check TELEGRAM_GROUP_ID, and that the bot is in the group."
      : "";
  return { text: `${sent.posted === "perhaps" ? "It isn't known whether Telegram took it" : "Nothing was sent"}: ${sentence(sent.problem)}.${hint}`, problem: true };
}

// What a run says of a delivery. An alert Telegram refused, or never got, waits for the next run; one it may have sent
// is not sent again.
function outcome({ posted, failed: problem }: Delivery): JobRun {
  if (problem?.perhaps)
    return failed(`It isn't known whether Telegram sent you "${problem.text.split("\n")[0]}" (${sentence(problem.problem)}), so it won't be sent again.`);
  if (problem) return failed(`Couldn't send you an alert: ${sentence(problem.problem)}. The next run tries again.`);
  if (posted > 0) return done(`Sent you ${posted === 1 ? "an alert" : `${posted} alerts`}.`);
  return skipped("Nothing to tell you.");
}
