"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import ui from "./ui.module.css";

// Shown in place of a page that failed while rendering, such as when the database cannot be reached. The details
// stay in the server's logs; error.digest matches the two up.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;
  return (
    <main id="main" className={ui.page}>
      <div className={ui.intro}>
        <h1>This page didn&apos;t load</h1>
        <p className={ui.lede}>Something broke on our side. Try again now or in a few minutes.</p>
      </div>
      <div className={ui.actions}>
        <button onClick={() => retry()}>Try again</button>
        <Link className={ui.quiet} href="/">
          Home
        </Link>
      </div>
      {digest && <p className={`${ui.small} ${ui.muted}`}>Error reference: {digest}</p>}
    </main>
  );
}
