// The scheduled job that posts to the Club's Telegram group (#13), run by Vercel on Sundays at 07:00, 08:00, 16:00 and
// 17:00 UTC, and every hour at :07 (vercel.json, app/api/jobs/post-to-telegram). Each run queues what is due and sends
// what is waiting (lib/telegram.ts, deliverPosts):
// - The Matchday's two reminders, each with the link to its tournament on Lichess: at 10:00 Vilnius time, and an hour
//   before the start, at 19:00. The schedule is in UTC and Vilnius is UTC+2 in winter time and UTC+3 in summer time, so
//   of the runs at 07:00 and 08:00 UTC it is the one at 10:00 in Vilnius that posts the first, and of 16:00 and 17:00
//   the one at 19:00 the second; the other finds nothing due, or the reminder posted. Vilnius changes its clocks at
//   03:00 and 04:00, so on every Sunday, both of those included, 10:00 and 19:00 are ten hours and one hour before 20:00.
// - The Recap of the latest Matchday, with its top three and its Awards, until the next Matchday starts. Collecting
//   results and pnpm ingest post it as they store its results (postRecap); a run here posts one they could not.
// - Whatever is still waiting: a notice of the schedule (lib/seasons.ts), or a post Telegram refused, which the hourly
//   run tries again. The hourly run shares its minute with the other jobs', so that they wake the database together.
//
// Posts go to a group whose invite link the site shows to Members only. They say what the public Recap says, names,
// Companies and Awards; the reminders also link to the Matchday's tournament, which the site shows Members only.

import { AWARD_TITLES, timeLeft, type RecapAward } from "./awards";
import { companyLabel } from "./companies";
import { done, failed, runJob, sentence, skipped, type JobRun } from "./jobs";
import { lichessSwissUrl } from "./lichess";
import { matchdayOn } from "./matchdays";
import { getRecap, type Recap } from "./recaps";
import { addDays, latestSunday, matchdayStart, START_HOUR } from "./schedule";
import { upcomingMatchday } from "./seasons";
import { deliverPosts, postDay, postingSetUp, queued, queuePost, type Delivery, type Post } from "./telegram";

export const JOB = "post-to-telegram";

const HOUR = 3_600_000;

// The Vilnius hours of a Matchday's reminders. Each is worth posting until the next is due, the last until the start.
export const REMINDER_HOURS = [10, START_HOUR - 1];

const reminderText = (hour: number, link: string) =>
  hour === START_HOUR - 1
    ? `Matchday starts in an hour, at 20:00. Join here: ${link}`
    : `Matchday tonight at 20:00: five Games of 5+3 on Lichess. Join here: ${link}`;

// One run of the job at `now`: what it did and why. Throws only if the database cannot record the run.
export const postToTelegram = (now: Date) => runJob(JOB, () => post(now));

async function post(now: Date): Promise<JobRun> {
  if (!postingSetUp()) return skipped("Telegram isn't set up, so nothing is posted.");
  const note = await queueReminder(now);
  await queueRecap(latestSunday(now), now);
  return outcome(await deliverPosts(now), note);
}

// The reminder due at `now`, queued once; or why the one due cannot be posted. Nothing before 10:00 on a Matchday.
async function queueReminder(now: Date): Promise<string | null> {
  const next = await upcomingMatchday(now);
  if (!next) return null;
  const times = REMINDER_HOURS.map((hour) => new Date(next.start.getTime() - (START_HOUR - hour) * HOUR));
  const due = times.filter((at) => at <= now).length - 1;
  if (due < 0) return null;
  const tournament = (await matchdayOn(next.date))?.lichessTournamentId;
  if (!tournament) return `The Matchday of ${postDay(next.date)} isn't on Lichess, so its ${REMINDER_HOURS[due]}:00 reminder wasn't posted.`;
  const hour = REMINDER_HOURS[due];
  await queuePost({ key: `reminder:${next.date}:${hour}`, text: reminderText(hour, lichessSwissUrl(tournament)), until: times[due + 1] ?? next.start });
  return null;
}

// Queues the Recap of the Matchday of `date` once its results are in, until the next Matchday starts.
async function queueRecap(date: string, now: Date) {
  const until = matchdayStart(addDays(date, 7));
  const key = `recap:${date}`;
  if (now >= until || (await queued(key))) return;
  const recap = await getRecap(date);
  if (recap) await queuePost(recapPost(recap, key, until));
}

// For Collecting results and pnpm ingest, once they have stored the results of the Matchday of `date`: posts its Recap
// now, and says how that went. Never throws: a failure to post leaves the results as they are, and the post, once
// queued, waiting for the next run.
export async function postRecap(date: string, now: Date): Promise<string> {
  if (!postingSetUp()) return "Telegram isn't set up, so the Recap wasn't posted.";
  try {
    await queueRecap(date, now);
    return outcome(await deliverPosts(now), null).detail;
  } catch (error) {
    const why = error instanceof Error ? error.message : "unknown error";
    console.error("Posting the Recap failed:", why);
    return `Couldn't post the Recap to the Telegram group: ${sentence(why)}.`;
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// What a run says of a delivery. A post Telegram refused, or never got, waits for the next run; one it may have posted
// is not tried again, so the Organiser is asked to look.
function outcome({ posted, failed: problem }: Delivery, note: string | null): JobRun {
  if (problem?.perhaps)
    return failed(
      `It isn't known whether Telegram posted "${problem.text.split("\n")[0]}" (${sentence(problem.problem)}), so it won't be posted again. Check the group.`,
    );
  if (problem) return failed(`Couldn't post to the Telegram group: ${sentence(problem.problem)}. The next run tries again.`);
  const why = note ? ` ${note}` : "";
  if (posted > 0) return done(`Posted ${count(posted, "message", "messages")} to the Telegram group.${why}`);
  return skipped(note ?? "Nothing to post.");
}

// --- The Recap's post ---

// Telegram's longest message, in characters.
const MAX_TEXT = 4096;

const feat = ({ kind, value }: RecapAward) => {
  if (kind === "leastTimeLeft") {
    const { n, unit } = timeLeft(value);
    return `won with ${n}${unit} left on the clock`;
  }
  if (kind === "biggestUpset") return `beat someone rated ${count(value, "point", "points")} higher`;
  return `checkmated their opponent in ${count(value, "move", "moves")}`;
};

// The Recap's link, the top three of its Leaderboard with their Companies, and its Awards.
function recapPost(recap: Recap, key: string, until: Date): Post {
  const link = new URL(`/recaps/${recap.date}`, process.env.BETTER_AUTH_URL).toString();
  const top = recap.leaderboard
    .slice(0, 3)
    .map((row) => `${row.rank}. ${row.name}${row.company ? `, ${companyLabel(row.company)}` : ""}: ${count(row.points, "point", "points")}`);
  const awards = recap.awards.map((award) => `${AWARD_TITLES[award.kind]}: ${award.name} ${feat(award)}.`);
  const text = [`The Recap of ${postDay(recap.date)} is up: ${link}`, top.join("\n"), awards.join("\n")].filter(Boolean).join("\n\n");
  return { key, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text, until };
}
