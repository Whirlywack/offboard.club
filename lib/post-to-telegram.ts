// The scheduled job that posts to the Club's Telegram group (#13), run by Vercel on Sundays at 07:00, 08:00, 16:00 and
// 17:00 UTC, and every hour at :07 (vercel.json, app/api/jobs/post-to-telegram). Each run deletes the posts that are out
// of date, queues what is due and sends what is waiting (lib/telegram.ts, deliverPosts):
// - The Matchday's two reminders: at 10:00 Vilnius time, and an hour before the start, at 19:00. The schedule is in UTC
//   and Vilnius is UTC+2 in winter time and UTC+3 in summer time, so of the runs at 07:00 and 08:00 UTC it is the one at
//   10:00 in Vilnius that posts the first, and of 16:00 and 17:00 the one at 19:00 the second; the other finds nothing
//   due, or the reminder posted. Vilnius changes its clocks at 03:00 and 04:00, so on every Sunday, both of those
//   included, 10:00 and 19:00 are ten hours and one hour before 20:00.
// - The Recap of the latest Matchday, with its top three and its Awards, until the next Matchday starts. Collecting
//   results and pnpm ingest post it as they store its results (postRecap); a run here posts one they could not, written
//   afresh each time until it is sent, so that it names nobody who has left or been marked since.
// - Whatever is still waiting: a notice of the schedule (lib/seasons.ts), or a post Telegram refused, which the hourly
//   run tries again. The hourly run shares its minute with the other jobs', so that they wake the database together.
// A post that may have gone out without Telegram saying so is never sent again. It is one failure of this job, from the
// run that sent it, or from the first run to find it 15 minutes on or later when it went out from elsewhere or its run
// died, and one alert in the day after it was sent (lib/alerts.ts), so that the Organiser looks at the group once
// (lib/telegram.ts, stuckPosts). Each run records only what it did itself.
//
// The group is only as private as its invite link, and holds people who have left: posts say less than the public
// Recap, only names and Awards (docs/adr/0002). The reminders send Members to the site, whose home page links a
// signed-in Member to the tournament on Lichess; Lichess's standings there, read beside a Recap's names, would give
// away Members' Lichess usernames.

import { AWARD_TITLES, timeLeft, type RecapAward } from "./awards";
import { done, failed, recordFailure, runJob, sentence, skipped, type JobRun } from "./jobs";
import { matchdayOn } from "./matchdays";
import { getRecap, type Recap } from "./recaps";
import { addDays, latestSunday, matchdayStart, START_HOUR } from "./schedule";
import { upcomingMatchday } from "./seasons";
import { deliverPosts, forgetPastPosts, forgetReminders, postDay, postingSetUp, queuePost, stuckPosts, type Delivery, type Post } from "./telegram";

export const JOB = "post-to-telegram";

const HOUR = 3_600_000;

// The Vilnius hours of a Matchday's reminders. Each is worth posting until the next is due, the last until the start.
export const REMINDER_HOURS = [10, START_HOUR - 1];

// The site's own address, as people type it: https://offboard.club.
const site = () => new URL(process.env.BETTER_AUTH_URL ?? "").origin;

const reminderText = (hour: number) =>
  `${hour === START_HOUR - 1 ? "Matchday starts in an hour, at 20:00." : "Matchday tonight at 20:00: five Games of 5+3 on Lichess."} The link to join is on ${site()} once you're signed in.`;

// One run of the job at `now`: what it did and why. Throws only if the database cannot record the run.
export const postToTelegram = (now: Date) => runJob(JOB, () => post(now));

async function post(now: Date): Promise<JobRun> {
  // First, so that nothing is kept longer while Telegram is switched off.
  await forgetPastPosts(now);
  if (!postingSetUp()) return skipped("Telegram isn't set up, so nothing is posted.");
  const note = await reminders(now);
  await queueRecap(latestSunday(now));
  const run = outcome(await deliverPosts(now), note);
  // However long ago each was sent, so that a run after a gap still finds it: once since its claim, it is one failure.
  for (const { text, claimedAt } of await stuckPosts(now, null)) await recordFailure(JOB, lostPost(text), claimedAt);
  return run;
}

// The reminders, decided on what is true as they are sent, just after this: each waiting is taken back unless it is the
// next Matchday's and that Matchday is on Lichess, as a skipped Sunday, a Season's new start or a tournament cleared
// from its Sunday (lib/reschedule.ts) may have made it untrue since it was queued. Then the reminder due at `now` is
// queued, once; or the run says why it cannot be posted. Nothing before 10:00 on a Matchday, and nothing for one
// whose tournament is not on Lichess, as the home page would have no link to it.
async function reminders(now: Date): Promise<string | null> {
  const next = await upcomingMatchday(now);
  const onLichess = next !== null && !!(await matchdayOn(next.date))?.lichessTournamentId;
  await forgetReminders(onLichess ? `reminder:${next.date}:` : null);
  if (!next) return null;
  const times = REMINDER_HOURS.map((hour) => new Date(next.start.getTime() - (START_HOUR - hour) * HOUR));
  const due = times.filter((at) => at <= now).length - 1;
  if (due < 0) return null;
  const hour = REMINDER_HOURS[due];
  if (!onLichess) return `The Matchday of ${postDay(next.date)} isn't on Lichess, so its ${hour}:00 reminder wasn't posted.`;
  await queuePost({ key: `reminder:${next.date}:${hour}`, text: reminderText(hour), until: times[due + 1] ?? next.start });
  return null;
}

// Queues the Recap of the Matchday of `date` once its results are in, worth posting until the next Matchday starts:
// once by its key, and written afresh until a delivery claims it.
async function queueRecap(date: string) {
  const recap = await getRecap(date);
  if (recap) await queuePost(recapPost(recap, `recap:${date}`, matchdayStart(addDays(date, 7))));
}

// For Collecting results and pnpm ingest, once they have stored the results of the Matchday of `date`: posts its Recap
// now, and says how that went. Never throws: a failure to post leaves the results as they are, and the post, once
// queued, for the next run, which tries a refused one again and reports one Telegram may have posted.
export async function postRecap(date: string, now: Date): Promise<string> {
  if (!postingSetUp()) return "Telegram isn't set up, so the Recap wasn't posted.";
  try {
    await queueRecap(date);
    return outcome(await deliverPosts(now), null).detail;
  } catch (error) {
    const why = error instanceof Error ? error.message : "unknown error";
    console.error("Posting the Recap failed:", why);
    return `Couldn't post the Recap to the Telegram group: ${sentence(why)}.`;
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A post that may have gone out, by its first line, for the Organiser to look for: in the same words from the run that
// sent it as from one that finds it later, so that it is one failure and one alert.
export const lostPost = (text: string) =>
  `It isn't known whether Telegram posted "${text.split("\n")[0]}", so it won't be posted again. Check the group.`;

// What a run says of a delivery. A post Telegram refused, or never got, waits for the next run; one it may have posted
// is not tried again, so the Organiser is asked to look.
function outcome({ posted, failed: problem }: Delivery, note: string | null): JobRun {
  if (problem?.perhaps) return failed(lostPost(problem.text));
  if (problem) return failed(`Couldn't post to the Telegram group: ${sentence(problem.problem)}. The next run tries again.`);
  const why = note ? ` ${note}` : "";
  if (posted > 0) return done(`Posted ${count(posted, "message", "messages")} to the Telegram group.${why}`);
  return skipped(note ?? "Nothing to post.");
}

// --- The Recap's post ---

const MAX_NAME = 100;

// A name as a post writes it. The post is plain text, in which Telegram makes a link of whatever looks like an address,
// an email, a @username, #hashtag, $cashtag, /command, phone, card number or TON address (MessageEntity,
// core.telegram.org/bots/api: "url", "email", "mention", "hashtag", "cashtag", "bot_command", "phone_number",
// "bank_card_number", "ton_address"), and LinkedIn, where names come from, may let a name hold one. So a name keeps its
// letters, spaces, hyphens and apostrophes, and a full stop only where a space or its end follows, as after an initial:
// everything else, digits included, becomes a space, and so does an unbroken run of 40 or more ASCII characters, as a
// TON address is 48 of them, which may be letters and hyphens alone. At most 100 characters; "a Member" if nothing is
// left but full stops, hyphens and apostrophes.
const postName = (name: string) => {
  const kept = [...name.replace(/\.(?=\S)|[^\p{L}\p{M}\s'’.-]/gu, " ").replace(/[!-~]{40,}/g, " ").replace(/\s+/g, " ").trim()].slice(0, MAX_NAME).join("").trim();
  return /[^\s'’.-]/u.test(kept) ? kept : "a Member";
};

const feat = ({ kind, value }: RecapAward) => {
  if (kind === "leastTimeLeft") {
    const { n, unit } = timeLeft(value);
    return `won with ${n}${unit} left on the clock`;
  }
  if (kind === "biggestUpset") return `beat someone rated ${count(value, "point", "points")} higher`;
  return `checkmated their opponent in ${count(value, "move", "moves")}`;
};

// The Recap's link, the top three of its Leaderboard and its Awards, each by name only. With six names of 100
// characters at most, it stays well within Telegram's 4,096.
function recapPost(recap: Recap, key: string, until: Date): Post {
  const top = recap.leaderboard.slice(0, 3).map((row) => `${row.rank}. ${postName(row.name)}: ${count(row.points, "point", "points")}`);
  const awards = recap.awards.map((award) => `${AWARD_TITLES[award.kind]}: ${postName(award.name)} ${feat(award)}.`);
  const text = [`The Recap of ${postDay(recap.date)} is up: ${site()}/recaps/${recap.date}`, top.join("\n"), awards.join("\n")];
  return { key, text: text.filter(Boolean).join("\n\n"), until };
}
