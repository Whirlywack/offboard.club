"use client"; // Error boundaries must be Client Components

import Image from "next/image";
import Link from "next/link";
import styles from "./fallback.module.css";
import queenKing from "./photos/queen-king.webp";
import ui from "./ui.module.css";

// Shown in place of a page that failed while rendering, such as when the database cannot be reached. The details
// stay in the server's logs; error.digest matches the two up. Its picture is the queen over the fallen king.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;
  return (
    <main id="main" className={`${styles.plate} ${ui.grain}`}>
      <div className={styles.text}>
        <h1 className={`${styles.title} ${ui.display}`}>
          <em>This</em> page didn&apos;t load
        </h1>
        <p className={styles.lede}>Something broke on our side. Try again now or in a few minutes.</p>
        <div className={styles.actions}>
          <button onClick={() => retry()}>Try again</button>
          <Link className={ui.quiet} href="/">
            Home
          </Link>
        </div>
        {digest && <p className={styles.reference}>Error reference: {digest}</p>}
      </div>
      <Image className={styles.fallen} src={queenKing} alt="" sizes="(min-width: 900px) 40vw, 360px" />
    </main>
  );
}
