## Next.js

This is Next.js 16, which has breaking changes from older versions: APIs, conventions and file structure may differ from what you know. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code.

## Working here

- **Running, testing, databases**, and the traps no config file shows: `docs/agents/dev-environment.md`. Read it before the first command.
- **Taking a ticket from issue to merged pull request** (stages, agents, hand-offs): `docs/agents/ticket-workflow.md`. For the session that orchestrates; an agent given one stage has its own definition in `.claude/agents/`.
- **Reviewing**: `CODING_STANDARDS.md`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `Whirlywack/offboard.club` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
