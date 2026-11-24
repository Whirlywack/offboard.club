import Link from "next/link";

// For an address with no Profile behind it, whether nobody has that id or they have not finished signing up.
export default function NoProfile() {
  return (
    <main>
      <h1>No Profile here</h1>
      <p>There is no Profile at this address.</p>
      <p>
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
