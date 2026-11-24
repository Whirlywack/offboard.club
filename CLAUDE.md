## Next.js

This is Next.js 16, which has breaking changes from older versions: APIs, conventions and file structure may differ from what you know. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code.

## Commands

- `pnpm dev`: run the site locally
- `pnpm test`: run the tests once (vitest)
- `pnpm typecheck`: generate Next.js route types, then run `tsc --noEmit`
- `pnpm lint`: run ESLint
- `pnpm build`: production build

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `Whirlywack/offboard.club` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
