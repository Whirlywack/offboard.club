# Coding standards

Read at review, with the diff in hand. What a machine can check is checked by CI (`.github/workflows/ci.yml`) and ESLint and is left out.

## Every guard goes red

A **guard** is any line that refuses: a sign-in or Member check, a consent or marked-account condition in SQL, a cap, a validation, a privacy condition in a page. For each guard the change adds or touches, delete it and run the tests. One must go **red**. A guard whose removal leaves the suite green is untested, whatever the test is called.

- A stand-in refuses what the real thing refuses. `lib/fake-db.ts` and `lib/fixtures/fake-lichess.ts` are worth what their fidelity is worth: where the diff leans on how Postgres or Lichess behaves, check the stand-in against a `*.postgres.test.ts` suite or against Lichess's own source.
- New SQL has a `*.postgres.test.ts` case that goes red when a condition in the query is wrong. A case that only shows the query returns rows does not count.
- A lock is a guard too. A statement right only because of a lock (an advisory lock, `for update`, a unique constraint deciding a race) has a `*.postgres.test.ts` case that runs two requests at once, each on a connection of its own, and goes red without the lock: one connection inside a rolled-back transaction cannot race. Two changes to the schedule at once could put a Sunday in two Seasons. `lib/telegram.postgres.test.ts` has two cases of this shape.

## The public sees names; Members see each other

`docs/adr/0002-the-public-sees-names-members-see-each-other.md` is the rule. On any page a signed-out visitor can open, a Member is their name and their Company. Everything that identifies them elsewhere (photo, Profile, Lichess username, a link to Lichess, a Game replayed on Lichess's board) is behind `requireSignedUp` or `viewerIsMember`. In a Profile's Games, someone who has left the Club appears as "a former member", with no link, and an Award won against them shows its Game to nobody. A marked or closed Lichess account is left out of Leaderboards and Awards.

Check each new piece of a page against that, and check the same for anything the page lets a browser fetch from a third party on a Member's behalf.

## Whatever comes from outside is bounded

Outside means a person's input, a fetched web page and a Lichess response. Each such value has a length or range cap, enforced on the server, and is parsed in time linear in its length: one pass, no pattern with two unbounded runs. Each fetch has a deadline and a fixed number of tries, and a fetch of a page the Club does not control has a size cap as well. Count length the same way in the browser and on the server.

## A run keeps to one deadline

A scheduled job, or any request that waits on Lichess, Telegram or the Blob store, reckons one deadline inside its `maxDuration`, as a time, on its handler's first line, before anything is awaited: reading the session or reaching the database can take 20 s (`lib/db.ts`). Each of those waits after it, retries included, gets what is left of that deadline, and is not started once nothing is left. Jobs whose waits each had an allowance of their own ran past their `maxDuration` and were killed mid-work. Leaving the Club is the pattern: `leaveClub` in `app/actions.ts`, then `removeMember` in `lib/leaving.ts`.

## Work killed halfway is finished or reported once

Where work writes to the database and calls Lichess, Telegram or the Blob store, the run can be killed between the two. The write that claims the work carries its time, and a later run that finds a claim older than any run lasts finishes the work, or reports it once, counted from that time. For each place the diff does both, stop the run between them and follow what the next run does. A Telegram post claimed and then lost was reported every hour without end. `stuckPosts` in `lib/telegram.ts` and `recordFailure` in `lib/jobs.ts` are the pattern.

## An address that cannot exist answers 404

With Partial Prerender a dynamic page has sent a 200 before it reads anything, so `notFound()` gives the not-found page under a 200. Where the address alone shows a page cannot exist, `proxy.ts` refuses it with a real 404: such a route gets its own check in `proxy()` and its own `matcher` entry, both in that file. A matcher entry with no check of its own falls through to the Recap-date check and 404s every address. A route that needs data to know, such as a Profile, stays out of the matcher. A page for one person, such as the Organiser's, answers everyone else as if it were not there.

## The ticket is the spec

Where the build differs from the issue's words (a number, a name, a rule, a label), the pull request says where and why, and the issue is edited or a `ready-for-human` issue asks the question. Reader-facing copy promises only what the site does today. Names of things are the glossary's (`GLOSSARY.md`), in copy and in code.

## A migration leaves the deployed code working

The live database is migrated by the production deploy before the new code goes live, so the code already deployed runs for a moment on the new schema. A migration adds; a rename or a drop is a later migration, once nothing deployed reads the old shape.

## Nothing unused ships

The project is deliberately minimal. A column, parameter, export, guard or style that nothing reads is a finding. So is a query that selects more than its caller uses, and an abstraction with one use.
