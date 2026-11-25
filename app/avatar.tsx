"use client";

import { useState } from "react";
import styles from "./avatar.module.css";

// "Ana Petraitė" -> "AP"; "Cher" -> "C". By characters, so a name starting with an accented letter keeps it.
export const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const ends = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return ends.map((word) => [...word][0]?.toLocaleUpperCase("lt") ?? "").join("");
};

// A Member's LinkedIn photo in a square frame, or their initials when there is no photo or it does not load (LinkedIn
// photo links expire). Decorative: the name is always written beside it.
export function Avatar({ name, src, size }: { name: string; src: string | null; size: "small" | "large" }) {
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && failed !== src ? src : null;
  return (
    <span className={`${styles.avatar} ${styles[size]}`} aria-hidden="true">
      <span className={styles.initials}>{initials(name)}</span>
      {photo && (
        // LinkedIn serves the photo at a small fixed size already, from its own servers.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.photo}
          src={photo}
          alt=""
          width={size === "large" ? 112 : 48}
          height={size === "large" ? 112 : 48}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(photo)}
          // A photo that failed before the page became interactive sent its error event to nobody: check on arrival.
          ref={(img) => {
            if (img?.complete && img.naturalWidth === 0) setFailed(photo);
          }}
        />
      )}
    </span>
  );
}
