export default function Home() {
  return (
    <>
      <header>
        <h1>Offboard</h1>
        <p>A free chess Club for people working in tech in and around Vilnius.</p>
      </header>

      <main>
        <section aria-labelledby="why">
          <h2 id="why">Why</h2>
          <p>
            Chess is the recurring reason to show up; meeting people is the point. There is no fee, no team to put
            together and no company budget to ask for. Whether you play casually, work at a ten-person startup or are
            new to the city, you can join on your own.
          </p>
        </section>

        <section aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol>
            <li>Sign in with LinkedIn and connect your Lichess account. That makes you a Member.</li>
            <li>
              Every Sunday at 20:00 Vilnius time there is a Matchday: five quick Games on Lichess against other
              Members.
            </li>
            <li>
              After each Matchday a Recap shows that night&apos;s Leaderboard and three Awards that a beginner can win
              as easily as a strong player.
            </li>
            <li>
              Six Matchdays make a Season, scored on your best four, so missing two Sundays costs you nothing.
            </li>
          </ol>
        </section>

        <section aria-labelledby="people">
          <h2 id="people">Meeting people</h2>
          <p>
            Members talk in one Telegram group. Profiles show who people are, where they work and what they are open
            to, so the chess leads to conversations.
          </p>
        </section>
      </main>
    </>
  );
}
