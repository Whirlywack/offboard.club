// For tests only: how much longer `run` takes on an input four times as long (`make(4 * size)` against `make(size)`),
// measured on this machine at this moment, so that neither a busy machine nor a slow one moves it: about 4 for a pass
// linear in the length, about 16 for one that goes back over the text for each character. Each size is timed as the
// shortest of three tries, after one to warm up, and each try repeats `run` until the smaller input takes 5 ms, so that
// a quick pass is not lost in the timer's noise.
export async function growth(run: (input: string) => unknown, make: (size: number) => string, size: number): Promise<number> {
  const [small, large] = [make(size), make(4 * size)];
  const time = async (input: string, times: number) => {
    const start = performance.now();
    for (let i = 0; i < times; i++) await run(input);
    return performance.now() - start;
  };
  let times = 1;
  while ((await time(small, times)) < 5 && times < 1024) times *= 2;
  const shortest = async (input: string) => Math.min(await time(input, times), await time(input, times), await time(input, times));
  return (await shortest(large)) / (await shortest(small));
}
