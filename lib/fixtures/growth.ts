// For tests only: how much longer `run` takes on an input eight times as long (`make(8 * size)` against `make(size)`),
// measured on this machine at this moment, so that neither a slow machine nor a busy one moves it: about 8 for a pass
// linear in the length, about 64 for one that goes back over the text for each character, so that a test can ask for
// less than 24 and leave room for noise both ways. Time is this process's own time on the processor, which other
// processes do not lengthen as they do the clock's. Both sizes run once first, as V8 compiles a regular expression anew
// once it has run on a long text; then each is timed five times, in turn with the other, each time repeating `run`
// until the smaller takes 20 ms, and the shortest of each is taken.
export async function growth(run: (input: string) => unknown, make: (size: number) => string, size: number): Promise<number> {
  const [small, large] = [make(size), make(8 * size)];
  const time = async (input: string, times: number) => {
    const start = process.cpuUsage();
    for (let i = 0; i < times; i++) await run(input);
    const { user, system } = process.cpuUsage(start);
    return (user + system) / 1000;
  };
  await time(small, 1);
  await time(large, 1);
  let times = 1;
  while ((await time(small, times)) < 20 && times < 4096) times *= 2;
  let [shortSmall, shortLarge] = [Infinity, Infinity];
  for (let i = 0; i < 5; i++) {
    shortSmall = Math.min(shortSmall, await time(small, times));
    shortLarge = Math.min(shortLarge, await time(large, times));
  }
  return shortLarge / shortSmall;
}
