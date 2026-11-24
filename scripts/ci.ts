// Local CI. `bun run ci` runs everything a push must pass, and .githooks/pre-push runs it before each push.

import { changedFrom, jobsFrom, jobsOfWorkflow, judgeRun, planOf, runOfTree, runsFrom, testedTree, trustRemote, type RemoteVerdict } from './ci-plan.ts';

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
// The unit tests and the browser tests may have run on the public repository (scripts/ci-public.sh sends it the clean
// copy of a commit, and .github/workflows/ci.yml runs there). The hook looks up the newest run for the tree of the commit
// the push carries (CI_PUSHED, set by .githooks/pre-push; run by hand, HEAD's) and takes those passes as run only when
// that run finished and every job the workflow defines succeeded (judgeRun, scripts/ci-plan.ts). No variable can say a
// run passed: a red, cancelled or unfinished run, no run, or no network, and the passes run here, with the reason in
// the log. The typecheck and the lag test (whose bounds are this box's) always run here.
const PUBLIC_RUNS = 'https://api.github.com/repos/the-owner/System-gaming-public/actions/runs';
const WORKFLOW = '.github/workflows/ci.yml';
const git = (...args: string[]): string => Bun.spawnSync(['git', ...args]).stdout.toString().trim();
const dirty = git('status', '--porcelain') !== '';
const snapshot = testedTree(process.env.CI_PUSHED, ref => git('rev-parse', `${ref}^{tree}`), dirty);
for (const old of ['CI_BROWSER_REMOTE', 'CI_UNIT_REMOTE']) {
  if (process.env[old]) console.log(`\n== ${old} is no longer read: the hook looks up the public run for this tree itself.`);
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function publicVerdict(tree: string): Promise<RemoteVerdict> {
  if (!tree) return { trusted: false, why: 'No one committed tree stands for this run (a push of several commits, or uncommitted changes here), so no public run is looked up.' };
  const expected = jobsOfWorkflow(git('show', `${tree}:${WORKFLOW}`));
  if (!expected) return { trusted: false, why: `The job names of ${WORKFLOW} could not be read (jobsOfWorkflow, scripts/ci-plan.ts), so no public run is trusted.` };
  try {
    const run = runOfTree(runsFrom(await getJson(`${PUBLIC_RUNS}?per_page=100`)), tree, WORKFLOW);
    if (!run) return { trusted: false, why: `The public repository has no run for this commit's tree (${tree.slice(0, 12)}).` };
    return judgeRun(run, jobsFrom(await getJson(`${PUBLIC_RUNS}/${run.id}/jobs?per_page=100`)), expected);
  } catch (e) {
    return { trusted: false, why: `The public repository's runs could not be read (${e instanceof Error ? e.message : String(e)}).` };
  }
}

const needsRemote = planned.unit || planned.browser !== 'none';
const plan = needsRemote ? trustRemote(planned, await publicVerdict(snapshot), snapshot) : planned;
if (plan.why) console.log(`\n== ${plan.why}`);
const browserFiles = plan.browser === 'all' || plan.browser === 'none' ? [] : plan.browser;

const ALL_STEPS: (Step & { run: boolean })[] = [
  { run: true, name: 'typecheck', cmd: ['bunx', 'tsc', '--noEmit'], retry: ['bunx', 'tsc', '--noEmit'] },
  { run: true, name: 'typecheck of the views', cmd: ['bunx', 'tsc', '-p', 'tsconfig.views.json', '--noEmit'], retry: ['bunx', 'tsc', '-p', 'tsconfig.views.json', '--noEmit'] },
  { run: true, name: 'strict null check of opted-in views', cmd: ['bunx', 'tsc', '-p', 'tsconfig.views.strict.json', '--noEmit'], retry: ['bunx', 'tsc', '-p', 'tsconfig.views.strict.json', '--noEmit'] },
  { run: plan.unit, name: 'unit tests and lint checks', cmd: UNIT, retry: UNIT },
  { run: plan.browser === 'all' || browserFiles.length > 0, name: plan.browser === 'all' ? 'browser tests' : 'the browser test files this push changes',
    cmd: ['bunx', 'playwright', 'test', ...browserFiles], retry: ['bunx', 'playwright', 'test', ...browserFiles, '--last-failed'], env: { CI: '1', E2E_PORT, E2E_FEEL: 'skip' } },
  // The lag test alone, one worker. Its bounds are this box's, so it runs here whatever ran on the public repository. Beside
  // four busy loops neither of its checks moved (docs/agent-handoff/audit/notes-lag-measure.md, part 3); beside a second
  // browser worker it is not measured, so it does not share the machine with the browser pass.
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
