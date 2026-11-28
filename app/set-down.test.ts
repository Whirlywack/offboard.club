// The Season block wherever the address says `joined` (#104), as the browser runs it: it moves while a new Member's pawn
// is set down and lands when the movement ends, or at once where nothing moves. Landing drops the movement for the rest
// of the page's life, as Next.js can build the block again from the same arrival, and takes `joined` out of the address,
// so that a reload does not play it either. React's hooks and the browser's window are stood in for, as nothing here
// renders into a page; each case has the component afresh, as a page just loaded does.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import styles from "./home.module.css";

const { setMoving, mounted, block } = vi.hoisted(() => ({
  setMoving: vi.fn(),
  mounted: [] as (() => void)[],
  block: { current: null as unknown },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, setMoving],
  useRef: () => block,
  useEffect: (effect: () => void) => void mounted.push(effect),
}));

const replaceState = vi.fn();
let SetDown: typeof import("./set-down").SetDown;

beforeEach(async () => {
  setMoving.mockReset();
  replaceState.mockReset();
  mounted.length = 0;
  vi.stubGlobal("window", { location: { href: "https://offboard.club/?joined#season" }, history: { replaceState } });
  vi.resetModules();
  ({ SetDown } = await import("./set-down"));
});

type Wrapper = ReactElement<{ className: string; onAnimationEnd: (event: unknown) => void }>;
// The block, rendered and mounted with `running` parts of a movement in it.
function render(moving: boolean, running = moving ? 5 : 0) {
  const element = { getAnimations: (options?: { subtree?: boolean }) => (options?.subtree ? Array(running).fill({}) : []) };
  block.current = element;
  const wrapper = SetDown({ moving, children: null }) as Wrapper;
  for (const effect of mounted.splice(0)) effect();
  return { wrapper, element };
}
// A part of the movement ending, with `running` parts of it still to end.
const ends = (wrapper: Wrapper, running: number) =>
  wrapper.props.onAnimationEnd({ currentTarget: { getAnimations: (options?: { subtree?: boolean }) => (options?.subtree ? Array(running).fill({}) : []) } });

describe("the Season block where the address says joined", () => {
  it("moves while a new Member's pawn is set down, and keeps moving while any part of the movement is running", () => {
    const { wrapper } = render(true);
    expect(wrapper.props.className).toBe(`${styles.setDown} ${styles.moving}`);
    ends(wrapper, 4); // the pawn set down, before its step
    expect(setMoving).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("lands as the movement ends: stops moving and takes `joined` out of the address, keeping the row's anchor", () => {
    const { wrapper } = render(true);
    ends(wrapper, 0);
    expect(setMoving).toHaveBeenCalledWith(false);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://offboard.club/#season");
  });

  it("does not move again when Next.js builds it again from the same arrival, as on coming Back to the page", () => {
    ends(render(true).wrapper, 0);
    expect(render(true).wrapper.props.className).toBe(styles.setDown);
  });

  it("lands at once where there is nothing to set down, taking `joined` out of the address all the same", () => {
    expect(render(false).wrapper.props.className).toBe(styles.setDown);
    expect(setMoving).toHaveBeenCalledWith(false);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://offboard.club/#season");
  });

  it("lands at once where nothing is running: with reduced motion, or a movement over before the script ran", () => {
    render(true, 0);
    expect(setMoving).toHaveBeenCalledWith(false);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://offboard.club/#season");
  });

  it("leaves an address without `joined` as it is", () => {
    vi.stubGlobal("window", { location: { href: "https://offboard.club/#season" }, history: { replaceState } });
    ends(render(true).wrapper, 0);
    expect(setMoving).toHaveBeenCalledWith(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
