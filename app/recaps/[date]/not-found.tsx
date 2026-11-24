import Link from "next/link";

// For an address that is not the date of an ingested Matchday.
export default function NoRecap() {
  return (
    <main>
      <h1>No Recap here</h1>
      <p>There is no Recap at this address: no Matchday of that date has been played and collected.</p>
      <p>
        <Link href="/recaps">All Recaps</Link>
      </p>
    </main>
  );
}
