# Coding standards

Read at review, with the diff in hand. Each rule here was found by review more than once before it was written down. What a machine can check is checked by CI (`.github/workflows/ci.yml`) and ESLint and is left out.

## Every guard goes red

A **guard** is any line that refuses: a sign-in or Member check, a consent or marked-account condition in SQL, a cap, a validation, a privacy condition in a page. For each guard the change adds or touches, delete it and run the tests. One must go **red**. A guard whose removal leaves the suite green is untested, whatever the test is called.

- A stand-in refuses what the real thing refuses. `lib/fake-db.ts` and `lib/fixtures/fake-lichess.ts` are worth what their fidelity is worth: where the diff leans on how Postgres or Lichess behaves, check the stand-in against a `*.postgres.test.ts` suite or against Lichess's own source.
- New SQL has a `*.postgres.test.ts` case that goes red when a condition in the query is wrong. A case that only shows the query returns rows does not count.

## The public sees names; Members see each other

`docs/adr/0002-the-public-sees-names-members-see-each-other.md` is the rule. On any page a signed-out visitor can open, a Member is their name and their Company. Everything that identifies them elsewhere (photo, Profile, Lichess username, a link to Lichess, a Game replayed on Lichess's board) is behind `requireSignedUp` or `viewerIsMember`. A former member appears as "a former member", with no link. A marked or closed Lichess account is left out of Leaderboards and Awards.

Check each new piece of a page against that, and check the same for anything the page lets a browser fetch from a third party on a Member's behalf.

## Whatever comes from outside is bounded

Outside means a person's input, a fetched web page and a Lichess response. Each such value has a length or range cap, enforced on the server, and is parsed in time linear in its length: one pass, no pattern with two unbounded runs. Each fetch has a size cap, a deadline and a fixed number of tries. Count length the same way in the browser and on the server.

## An address that cannot exist answers 404

With Partial Prerender a dynamic page has sent a 200 before it reads anything, so `notFound()` gives the not-found page under a 200. An address whose shape alone shows it cannot exist is refused in `proxy.ts` with a real 404: a new dynamic route joins its `matcher`. A page for one person, such as the Organiser's, answers everyone else as if it were not there.

## The ticket is the spec

Where the build differs from the issue's words (a number, a name, a rule, a label), the pull request says where and why, and the issue is edited or a `ready-for-human` issue asks the question. Reader-facing copy promises only what the site does today. Names of things are the glossary's (`GLOSSARY.md`), in copy and in code.

## A migration leaves the deployed code working

The live database is migrated by the production deploy before the new code goes live, so the code already deployed runs for a moment on the new schema. A migration adds; a rename or a drop is a later migration, once nothing deployed reads the old shape. A merged migration is never edited (CI refuses it): a change is a new file.

## Nothing unused ships

The project is deliberately minimal. A column, parameter, export, guard or style that nothing reads is a finding. So is a query that selects more than its caller uses, and an abstraction with one use.
