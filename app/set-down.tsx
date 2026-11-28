"use client";

import { useState, type AnimationEvent, type ReactNode } from "react";
import styles from "./home.module.css";

// The Season block while a new Member's pawn is set down (app/page.tsx, home.module.css). Once it has landed, `joined`
// leaves the address, so that a reload shows the pawn standing, and the movement is dropped, so that coming back to the
// page, which Next.js keeps hidden in the meantime, does not play it again. Without scripts the movement plays all the
// same; with reduced motion there is none, and the pawn stands from the start.
export function SetDown({ children }: { children: ReactNode }) {
  const [moving, setMoving] = useState(true);
  // The pawn is set down before it steps, so the movement is over only once no part of it is still running. Next.js
  // follows the address changed here (its docs: window.history.replaceState).
  const landed = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.currentTarget.getAnimations({ subtree: true }).length > 0) return;
    setMoving(false);
    const address = new URL(window.location.href);
    address.searchParams.delete("joined");
    window.history.replaceState(null, "", address.href);
  };
  return (
    <div className={moving ? `${styles.setDown} ${styles.moving}` : styles.setDown} onAnimationEnd={landed}>
      {children}
    </div>
  );
}
