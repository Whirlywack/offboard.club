import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

// For tests only: a new folder in /tmp, short enough for a run of pnpm check or pnpm guards inside it, which refuses a
// temporary folder too long for the Unix sockets opened in it (scripts/check.mjs); TMPDIR is too deep for that when
// the tests themselves run inside such a run. It is named for this process, so that one a cancelled test left behind
// is removed by the next test that asks for a folder, once the process that made it has gone.
export function shortFolder(): string {
  for (const name of readdirSync("/tmp")) {
    const pid = Number(/^offboard-test-(\d+)-/.exec(name)?.[1]);
    if (pid && gone(pid)) rmSync(join("/tmp", name), { recursive: true, force: true });
  }
  return realpathSync(mkdtempSync(`/tmp/offboard-test-${process.pid}-`));
}

// Whether no process `pid` is running: only the system's "no such process" says so, and anything else, such as a
// number too large to be a process's, keeps the folder.
function gone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
