"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./awards.module.css";

// An Award's Game, closed until asked for. Lichess's board (`board`) is put into the page only when it is first opened,
// so reading a Recap without opening one makes no request to Lichess: an iframe inside a closed <details> loads all the
// same, loading="lazy" or not, as browsers load hidden iframes at once. Closed again, the board stays where it got to.
// `children` follow the board, and are there from the start. `label` tells screen readers which Game this is, after the
// words everyone sees: "Replay the Game of the biggest upset".
export function Replay({ label, board, children }: { label: string; board: ReactNode; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const [opened, setOpened] = useState(false);
  // The server's <details> works before React does, and an opening then fires no toggle that React hears: a Member on
  // a slow connection who opened it early still gets the board once React starts. The "open" they added is expected,
  // so React is told not to warn that the server did not send it.
  useEffect(() => {
    if (details.current?.open) setOpened(true);
  }, []);
  return (
    <details
      ref={details}
      className={styles.replay}
      onToggle={(event) => event.currentTarget.open && setOpened(true)}
      suppressHydrationWarning
    >
      <summary>
        <svg className={styles.chevron} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Replay the Game<span className="visually-hidden"> {label}</span>
      </summary>
      {opened && board}
      {children}
    </details>
  );
}
