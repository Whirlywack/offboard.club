// The Season block while a new Member's pawn is set down (#104), as the browser runs it: once the movement is over it is
// dropped and `joined` leaves the address, so that coming back to the page or reloading it does not play it again; and
// not before, as the pawn is set down before it steps. React's state and the browser's window are stood in for, as
// nothing here renders into a page.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import styles from "./home.module.css";
import { SetDown } from "./set-down";

const { setMoving } = vi.hoisted(() => ({ setMoving: vi.fn() }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: (initial: unknown) => [initial, setMoving] }));

const replaceState = vi.fn();

beforeEach(() => {
  setMoving.mockReset();
  replaceState.mockReset();
  vi.stubGlobal("window", { location: { href: "https://offboard.club/?joined#season" }, history: { replaceState } });
});

type Wrapper = ReactElement<{ className: string; onAnimationEnd: (event: unknown) => void }>;
const wrapper = () => SetDown({ children: null }) as Wrapper;
// A part of the movement ending, with `running` parts of it, anywhere in the block, still to end.
const ends = (running: number) =>
  wrapper().props.onAnimationEnd({
    currentTarget: { getAnimations: (options?: { subtree?: boolean }) => (options?.subtree ? Array(running).fill({}) : []) },
  });

describe("the Season block while a new Member's pawn is set down", () => {
  it("moves", () => {
    expect(wrapper().props.className).toBe(`${styles.setDown} ${styles.moving}`);
  });

  it("keeps moving while any part of the movement is still running, such as the step after the pawn is set down", () => {
    ends(4);
    expect(setMoving).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("stops once the pawn has landed, and takes `joined` out of the address, keeping the row's anchor", () => {
    ends(0);
    expect(setMoving).toHaveBeenCalledWith(false);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://offboard.club/#season");
  });
});
