# Games are played on Lichess only

Offboard does not host chess. Every Matchday is a Swiss tournament on a private Lichess team; the site creates it, reads the results and Games back through the Lichess API, and links out to Lichess for anything involving a board. We chose this because Lichess is free, lets a third-party site create team-restricted tournaments and export every Game with clock times, and lets a Member prove they own an account without us registering an app, which makes a one-person, zero-cost club possible.

## Considered Options

- **Chess.com**: more casual players already have accounts there, but its public API is read-only, with no sign-in and no tournament creation found (checked November 2026), so Matchdays could not run themselves.
- **Our own board and pairing**: full control over rules and pairing, at the cost of building and policing a chess server, including fair-play detection, for a club whose point is the people.

## Consequences

- Every Member needs a Lichess account, even if they normally play elsewhere.
- Matchday rules are whatever Lichess Swiss offers: pairing, byes, tiebreaks and late joining are not ours to change.
- Fair play is delegated to Lichess's own account marks.
- The site cannot add anyone to the Lichess team; each Member joins with their own Lichess permission.
- The Organiser's Lichess permission expires about once a year and must be renewed by hand, or Matchdays stop being created.
