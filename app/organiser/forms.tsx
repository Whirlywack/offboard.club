"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import profile from "../profile/profile.module.css";
import ui from "../ui.module.css";
import { changeSunday, setStart, testTelegram } from "./actions";
import styles from "./organiser.module.css";
import type { Said } from "@/lib/reschedule";

// What the form's last press did, or that it is being done: an alert when it needs the Organiser, quiet otherwise.
function Outcome({ said, pending }: { said: Said | null; pending: boolean }) {
  if (pending) return <p className={styles.notice}>Saving…</p>;
  if (!said) return null;
  return (
    <p role={said.problem ? "alert" : "status"} className={said.problem ? ui.alert : styles.notice}>
      {said.text}
    </p>
  );
}

// One Sunday on the Organiser page, written out by the page in Vilnius time: its Matchday ("Season 3, Matchday 4"), if
// it has one, and whether it is skipped.
type SundayRow = { date: string; day: string; matchday: string | null; skipped: boolean };

// The next Sundays, a Matchday with a button to skip it, a skipped Sunday with one to undo that. One form, so that every
// button waits while one press is being sent.
export function Sundays({ sundays }: { sundays: SundayRow[] }) {
  const [said, action, pending] = useActionState(changeSunday, null);
  return (
    <form action={action} className={styles.part}>
      <h3>Upcoming Sundays</h3>
      <Outcome said={said} pending={pending} />
      <ul className={styles.list}>
        {sundays.map(({ date, day, matchday, skipped }) => (
          <li key={date} className={styles.row}>
            <span>
              <time dateTime={date} className={styles.when}>
                {day}
              </time>{" "}
              {skipped ? "Skipped" : (matchday ?? "No Matchday")}
            </span>
            {matchday && (
              <button className={ui.quiet} name="skip" value={date} disabled={pending}>
                Skip<span className="visually-hidden"> {day}</span>
              </button>
            )}
            {skipped && (
              <button className={ui.quiet} name="unskip" value={date} disabled={pending}>
                Undo<span className="visually-hidden"> skipping {day}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </form>
  );
}

// A Season whose first Matchday is still to come, as the page offers it: "Season 4, now from Sunday 17 January".
type SeasonChoice = { number: number; label: string };

// A Season's start set by hand. `first` is the first Sunday it can be, which the date picker starts from.
export function SeasonStart({ seasons, first }: { seasons: SeasonChoice[]; first: string }) {
  const [said, action, pending] = useActionState(setStart, null);
  return (
    <form action={action} className={styles.part}>
      <h3>Season start</h3>
      <p className={styles.detail}>Later Seasons whose start isn&apos;t set move with it.</p>
      <Outcome said={said} pending={pending} />
      <div className={profile.field}>
        <label htmlFor="season">Season</label>
        <select id="season" name="season">
          {seasons.map(({ number, label }) => (
            <option key={number} value={number}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className={profile.field}>
        <label htmlFor="start">First Matchday</label>
        <input id="start" name="start" type="date" required min={first} step={7} />
      </div>
      <div className={ui.actions}>
        <button disabled={pending}>Set start</button>
      </div>
    </form>
  );
}

// The two test messages, which check the Telegram settings no one can read back on Vercel: one press, one message.
export function TestMessages() {
  const [said, action, pending] = useActionState(testTelegram, null);
  return (
    <form action={action} className={styles.part}>
      <p className={styles.detail}>Everyone in the group sees the test message sent to it.</p>
      {pending ? <p className={styles.notice}>Sending…</p> : <Outcome said={said} pending={false} />}
      <div className={ui.actions}>
        <button className={ui.quiet} name="to" value="me" disabled={pending}>
          Send a test message to me
        </button>
        <button className={ui.quiet} name="to" value="group" disabled={pending}>
          Send a test message to the group
        </button>
      </div>
    </form>
  );
}

// The confirmation step's two choices, as where a Member deletes their own account (app/profile/leave): keeping them
// first and filled, removing outlined in the error colour; from the press until it is done, removing says it is working
// and keeping is no longer offered.
export function RemoveActions({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <div className={`${ui.actions} ${profile.formActions}`}>
      <Link className={ui.button} href="/organiser" aria-disabled={pending || undefined} tabIndex={pending ? -1 : undefined}>
        Keep them
      </Link>
      <button className={profile.delete} disabled={pending}>
        {pending ? "Removing…" : `Remove ${name}`}
      </button>
    </div>
  );
}
