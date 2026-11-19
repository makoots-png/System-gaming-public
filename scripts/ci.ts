// Local CI. `bun run ci` runs everything a push must pass, and .githooks/pre-push runs it before each push.

import { changedFrom, planOf } from './ci-plan.ts';

type Step = { name: string; cmd: string[]; retry: string[]; env?: Record<string, string> };

// The browser step starts its own server on this port so it never tests a dev server someone left running on 3217.
const E2E_PORT = '3218';

// The unit tests run their files in four worker processes, the count of this box's cores. Measured Nov 19 on the
// 4-core box under /tmp/box.lock, three whole runs each, 4,237 passes every time, in seconds:
//   one process  369, 357, 326
//   2 workers    208, 194, 195
//   4 workers    146, 133, 126
// Four is the fastest and no test failed under it. More would not help: the run cannot end before its longest file,
// tests/fight-model.test.ts, about 100 s alone. `bun run test` (package.json) carries the same count.
const UNIT = ['bun', 'test', '--parallel=4'];

// What this push needs (scripts/ci-plan.ts): the hook hands over the files the push changes in CI_CHANGED; run by
// hand, `bun run ci` has none and runs everything.
const planned = planOf(changedFrom(process.env.CI_CHANGED));
// The browser tests may have run on the public repository (scripts/ci-public.sh, .github/workflows/ci.yml). The one who
// pushes names the tree whose run was green in CI_BROWSER_REMOTE; when it is this commit's tree, the
// browser pass is not run again here. The typecheck, the unit tests and the lag test (which needs a quiet machine,
// so it stays here) still run.
const snapshot = Bun.spawnSync(['sh', 'scripts/ci-public.sh', 'tree']).stdout.toString().trim();
const remote = !!process.env.CI_BROWSER_REMOTE && process.env.CI_BROWSER_REMOTE === snapshot;
if (process.env.CI_BROWSER_REMOTE && !remote) console.log(`\n== CI_BROWSER_REMOTE names ${process.env.CI_BROWSER_REMOTE}, and this commit's tree is ${snapshot}: the browser tests run here.`);
const plan = remote && planned.browser !== 'none' ? { ...planned, browser: 'none' as const, why: `The browser tests passed on the public repository for this commit's tree (${snapshot.slice(0, 12)}).` } : planned;
if (plan.why) console.log(`\n== ${plan.why}`);
const browserFiles = plan.browser === 'all' || plan.browser === 'none' ? [] : plan.browser;

const ALL_STEPS: (Step & { run: boolean })[] = [
  { run: true, name: 'typecheck', cmd: ['bunx', 'tsc', '--noEmit'], retry: ['bunx', 'tsc', '--noEmit'] },
  { run: true, name: 'typecheck of the views', cmd: ['bunx', 'tsc', '-p', 'tsconfig.views.json', '--noEmit'], retry: ['bunx', 'tsc', '-p', 'tsconfig.views.json', '--noEmit'] },
  { run: plan.unit, name: 'unit tests and lint checks', cmd: UNIT, retry: UNIT },
  { run: plan.browser === 'all' || browserFiles.length > 0, name: plan.browser === 'all' ? 'browser tests' : 'the browser test files this push changes',
    cmd: ['bunx', 'playwright', 'test', ...browserFiles], retry: ['bunx', 'playwright', 'test', ...browserFiles, '--last-failed'], env: { CI: '1', E2E_PORT, E2E_FEEL: 'skip' } },
  // The lag test alone, one worker: it times frames, and a second worker's load would be what it measured.
  { run: plan.lag, name: 'the lag test, alone', cmd: ['bunx', 'playwright', 'test', 'tests/e2e/feel.e2e.ts', '--workers=1'], retry: ['bunx', 'playwright', 'test', 'tests/e2e/feel.e2e.ts', '--workers=1'], env: { CI: '1', E2E_PORT } },
];
const STEPS: Step[] = ALL_STEPS.filter(s => s.run);

// The dev box this runs on is sometimes paused for minutes. A step that fails across a pause proves nothing,
// so it is run again, and only then. A 500 ms tick that arrives over 5 s late is a pause: load alone does not
// hold an idle timer that long, and anything shorter cannot use up a 15 s Playwright wait by itself.
const TICK_MS = 500, FREEZE_MS = 5000, MAX_TRIES = 3;
let pauses: number[] = [], last = Date.now();
setInterval(() => {
  const now = Date.now();
  if (now - last > FREEZE_MS) pauses.push(now - last);
  last = now;
}, TICK_MS);

async function run(step: Step, cmd: string[]): Promise<number> {
  console.log(`\n== ${step.name}: ${cmd.join(' ')}`);
  return Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, ...step.env } }).exited;
}

for (const step of STEPS) {
  let cmd = step.cmd;
  for (let attempt = 1; ; attempt++) {
    pauses = [];
    const code = await run(step, cmd);
    if (code === 0) break;
    await new Promise(resolve => setTimeout(resolve, 2 * TICK_MS));
    if (pauses.length === 0 || attempt === MAX_TRIES) {
      console.error(`\nCI failed at: ${step.name}`);
      process.exit(1);
    }
    console.log(`\n== ${step.name} failed while the machine was paused (${pauses.map(ms => Math.round(ms / 1000) + ' s').join(', ')}). Running it again.`);
    cmd = step.retry;
  }
}
console.log('\nCI passed');
process.exit(0);
