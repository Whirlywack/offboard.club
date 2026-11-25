---
status: proposed
---

# The public sees names; Members see each other

Recaps and Leaderboards are public, so that the Club is visible to people deciding whether to join, and on them a Member is their real name and their Company and nothing more. Everything that identifies a Member somewhere else is shown to signed-in Members only: their photo and Profile, their Lichess username and rating, links to a tournament or a Game on Lichess, and an Award's Game replayed on Lichess's board. We chose this because a Member agreed to be listed in a club, not to have their chess account tied to their name and employer for anyone on the internet, and because what has been published cannot be taken back.

This records how the site behaves today. Several of these calls were made during the build without the Organiser, who has yet to confirm them; until then the status stays proposed.

## Considered Options

- **Everything public**: the Recap is more fun with boards and photos, but a search for a Member's name would lead to their Lichess account and every Game they have played there.
- **Nothing public**: no leak at all, but then the Club has no public face and a Recap cannot be shared.

## Consequences

- A visitor sees names on a Leaderboard that link to Profiles they cannot open; the page says so.
- An Award is public as a name, a value and a winner. Its Game is shown to Members only (`AWARD_GAMES_ARE_PUBLIC` in `lib/awards.ts` is the one line that would change that).
- A Game against someone who has left the Club is listed as against "a former member", with no link to Lichess, since the Game there still shows their username.
- A Company's logo is stored but not shown: loading it from the Company's own website would tell that website who is looking at a Profile.
- A Member whose Lichess account is marked or closed is left out of Leaderboards and Awards without being named as such.
