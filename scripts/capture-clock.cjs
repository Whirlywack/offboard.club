// Preloaded by pnpm capture (scripts/capture.ts) into the local site it starts, with NODE_OPTIONS=--require, for a state
// with `minutesIntoLatestMatchday`: moves that site's clock to CAPTURE_NOW, and on from there. A Matchday starts only on
// Sunday at 20:00, so no seed can put one under way at another time; the seed is left as it is, and only the throwaway
// site's clock moves. pnpm dev:local takes it the same way, to show it in a browser (docs/agents/dev-environment.md).
// Nothing in the site loads it.
if (process.env.CAPTURE_NOW) {
  const RealDate = Date;
  const offset = RealDate.parse(process.env.CAPTURE_NOW) - RealDate.now();
  if (Number.isNaN(offset)) throw new Error(`CAPTURE_NOW is not a time: ${process.env.CAPTURE_NOW}`);
  class MovedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  // Own copies of Date's other static methods, for code that copies Date's own properties, as Next.js's does in development.
  for (const name of Object.getOwnPropertyNames(RealDate))
    if (!Object.hasOwn(MovedDate, name)) Object.defineProperty(MovedDate, name, Object.getOwnPropertyDescriptor(RealDate, name));
  globalThis.Date = MovedDate;
}
