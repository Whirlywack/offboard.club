# Ticket workflow

For the session that takes tickets from issue to merged pull request. An agent given one stage reads only its own definition in `.claude/agents/`.

Tickets cut from the spec are sub-issues of #1; later ones stand alone. The owner merges; nothing else reaches `main`.

## Stages

Each stage is its own agent with a fresh context, on Opus at extra-high effort, and hands over through the branch and a written report. The orchestrating session only orchestrates. A brief is the issue number plus what is special about this ticket; the standing rules live in the agent's definition.

1. **Build**: `ticket-builder`, in its own worktree, on `ticket-<n>-<short-name>` cut from `origin/main`. Give it the migration number to use.
2. **Design**: `page-designer`, in the builder's worktree, when the ticket adds or changes a page. Give it the pages and a folder for screenshots.
3. **Copy**: `page-copywriter`, in the same worktree, when the ticket has reader-facing words.

   **Stages 2 and 3 are paused** (owner's decision, 25 November 2026): the owner will rework the site's design and wording in passes of their own. Until they say otherwise a ticket goes from build straight to review, and the builder is told to write plain, short words and stop its local database when it finishes. The owner's bar for words: say it once, in as few plain words as a person would.
4. **Review**: `ticket-reviewer`, on the finished branch. Send each finding back to the agent whose stage owns it (a message resumes that agent with its context), then have the review repeated on what changed, until it finds nothing material.
5. **Pull request**: opened by this session, to `main`, with the `pr` skill's template. The body ends with `Closes #<n>` and records what review found, what could not be verified, and each place the build differs from the issue's words (from the builder's report), with the issue edited or a `ready-for-human` issue opened for each. CI must be green before the link goes to the owner.

## Running several tickets

- Start every ticket whose blockers are closed, in parallel. Reserve a migration number for each before starting.
- Cut every branch from `origin/main`. Stack one branch on another only when both rewrite the same page, and say so in both pull requests.
- The owner merges by opening links in order. A stacked pull request moves onto `main` only because the repository deletes a merged branch automatically (`gh api repos/{owner}/{repo} --jq .delete_branch_on_merge` must print `true`). Check it before handing over a stack; hand links over bottom of the stack first.
- Before giving the owner a pull request's link: `scripts/pr-ci.sh <number>` (waits for CI on its latest commit; prints the tallies and whether it can merge).
- After each merge: `scripts/after-merge.sh <number>` from the main checkout (fast-forwards it, installs if the lockfile changed, waits for CI on `main` and the production deploy, shows what the deploy did to the live database's migrations, checks the public pages). Then bring every open branch up to date with `main`.

## What only the owner decides

- **Product and privacy questions** raised by a build or a review become an issue labelled `ready-for-human` (here: anything only the owner can do or decide), with the options and what the site does meanwhile. A question that exists only in a conversation is lost when the conversation ends.
- **Anything on a third-party service** (GitHub settings, Vercel, Neon, Lichess, LinkedIn, Telegram): read that service's current documentation first, then tell the owner what the step does, what it puts in their name and whether it can be undone. This covers statements about what a service will do after they click, not only setup steps.
- **The live site and its data.** Agents work on local databases with pretend keys (`docs/agents/dev-environment.md`). Migrations reach the live database through the production deploy.
