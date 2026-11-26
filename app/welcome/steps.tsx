import Image from "next/image";
import pawnEmpty from "../photos/pawn-empty.webp";
import pawn from "../photos/pawn.webp";
import styles from "./welcome.module.css";

const STEPS = ["Agree", "Lichess", "Profile (optional)"] as const;

// Where the person is in signing up, with their pawn standing on that step: the outline of a place not yet taken, as on
// the home page, until they are a Member; filled in on the third step, which is optional. The pawn's file is smaller
// than any screen asks for, so it goes without `sizes`.
export function SignUpSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className={styles.steps} role="list" aria-label="Signing up">
      {STEPS.map((step, i) => (
        <li key={step} aria-current={i + 1 === current ? "step" : undefined} data-done={i + 1 < current || undefined}>
          {i + 1 === current && <Image className={styles.pawn} src={current === 3 ? pawn : pawnEmpty} alt="" />}
          <span className={styles.stepNumber} aria-hidden="true">
            {i + 1}
          </span>
          {step}
          {i + 1 < current && <span className="visually-hidden"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}
