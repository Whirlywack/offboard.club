import styles from "./welcome.module.css";

const STEPS = ["Agree", "Connect Lichess", "Your Profile"] as const;

// Where the person is in signing up. The third step is optional; after the second they are a Member.
export function SignUpSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className={styles.steps} aria-label="Signing up">
      {STEPS.map((step, i) => (
        <li key={step} aria-current={i + 1 === current ? "step" : undefined} data-done={i + 1 < current || undefined}>
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
