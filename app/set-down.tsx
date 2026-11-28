"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./home.module.css";

// Whether a new Member's pawn has been set down since this page was loaded. Next.js can build the home page again from
// what it fetched for `/?joined`, as on coming Back to it a few pages later, and it must not play again.
let setDownHere = false;

// Once no part of the movement is running (the pawn is set down before it steps): it is dropped, so that coming back
// to the page does not play it again, and `joined` leaves the address, so that a reload does not. Next.js follows the
// address changed here (its docs: window.history.replaceState).
function land(block: HTMLElement, setMoving: (moving: boolean) => void) {
  if (block.getAnimations({ subtree: true }).length > 0) return;
  setDownHere = true;
  setMoving(false);
  const address = new URL(window.location.href);
  if (!address.searchParams.has("joined")) return;
  address.searchParams.delete("joined");
  window.history.replaceState(null, "", address.href);
}

// The Season block wherever the address says `joined` (app/page.tsx): `moving` while a new Member's pawn is set down
// (home.module.css). It lands when the movement ends, or at once where nothing is moving: nothing to set down, reduced
// motion, or a movement over before this script ran. The movement is CSS alone, but with scripts off Next.js shows no
// streamed part of a page, this block included.
export function SetDown({ moving: play, children }: { moving: boolean; children: ReactNode }) {
  const [moving, setMoving] = useState(play && !setDownHere);
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => land(block.current!, setMoving), []);
  return (
    <div
      ref={block}
      className={moving ? `${styles.setDown} ${styles.moving}` : styles.setDown}
      onAnimationEnd={(event) => land(event.currentTarget, setMoving)}
    >
      {children}
    </div>
  );
}
