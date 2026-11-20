// ci-plan.ts: which of the CI's passes a push needs, from the files it changes. Pure; scripts/ci.ts runs the plan and
// .githooks/pre-push gives it the files. A pass is skipped only where no changed file can change its result; anything
// this file does not know runs everything.

/** What a push runs: the typecheck always; the unit tests or not; the browser tests all, some files, or none; the lag test or not. */
export type CiPlan = {
  readonly unit: boolean;
  readonly browser: 'all' | 'none' | readonly string[];
  readonly lag: boolean;
  /** One sentence for the push's log: what is skipped and why. Empty when everything runs. */
  readonly why: string;
};

export const FULL: CiPlan = { unit: true, browser: 'all', lag: true, why: '' };

/**
 * The lead's notes: nothing is built from them, and no test opens one (the lint "no test opens a file under
 * docs/agent-handoff/" holds that), so a push of notes alone cannot change a unit test's result. A `.ts` file there
 * is typechecked (tsconfig.json), so the typecheck still runs.
 */
const isNotes = (f: string): boolean => f.startsWith('docs/agent-handoff/');
/**
 * Files only the typecheck and the unit tests read: a unit test and its models, the charts' scripts and the two docs a
 * unit test compares against them, the guide, and the CI's own scripts. No browser test imports any of them (the
 * browser tests import `src/` and `tests/e2e/helpers.ts`, and read `tests/fixtures/`, which is not in this list).
 */
const isUnitOnly = (f: string): boolean =>
  /^tests\/[^/]+\.test\.ts$/.test(f) || f.startsWith('tests/models/') || f.startsWith('scripts/charts/')
  || ['scripts/statecharts.ts', 'scripts/deps.ts', 'scripts/ci.ts', 'scripts/ci-plan.ts', 'docs/state-machines.md', 'docs/dependency-map.md', 'AGENTS.md', 'README.md'].includes(f)
  || f.startsWith('.githooks/')
  // the guide's area files: read by coding agents and by the lint that checks AGENTS.md names them, never served or read by a browser test
  || f.startsWith('docs/guide/')
  // an audit's findings: read by people and coding agents, never served or read by a test
  || f.startsWith('docs/audit/')
  // the CI mirror's workflow and the script that sends it a snapshot: neither is served nor read by a test
  || f.startsWith('.github/') || f === 'scripts/ci-public.sh'
  // what makes the public copy, and the private words it takes out: neither is served nor read by a test
  || f === 'scripts/publish-clean.ts' || f.startsWith('.private/')
  // Claude Code's own settings, skills and agents: the typecheck and the tests leave `.claude/` out (tsconfig.json, bunfig.toml)
  || f.startsWith('.claude/');
/** One browser test file (not the helpers every file imports). */
const isBrowserTest = (f: string): boolean => /^tests\/e2e\/[^/]+\.e2e\.ts$/.test(f);
const LAG_TEST = 'tests/e2e/feel.e2e.ts';

/**
 * The plan for a push that changes `files` (paths from the repo's root), or everything when the files are not known
 * (`null`: a new branch, a range git could not read). The app's code, its static files, the server, the build, the
 * browser tests' helpers and fixtures, the Playwright config and the package all run everything: each can change what
 * any browser test sees.
 */
export function planOf(files: readonly string[] | null): CiPlan {
  if (files === null) return FULL;
  const named = files.filter(f => f !== '');
  const rest = named.filter(f => !isNotes(f));
  // A push that changes no file at all is not a push of notes: it keeps its unit tests.
  if (named.length > 0 && rest.length === 0) {
    return { unit: false, browser: 'none', lag: false, why: 'Only docs/agent-handoff/ changed: no test reads it, so the typecheck runs alone.' };
  }
  if (rest.every(isUnitOnly)) {
    return { unit: true, browser: 'none', lag: false, why: 'Only unit tests, charts, guides or the CI\'s own scripts changed: no browser test reads them.' };
  }
  if (rest.every(f => isUnitOnly(f) || isBrowserTest(f))) {
    const changed = rest.filter(isBrowserTest);
    return { unit: true, browser: changed.filter(f => f !== LAG_TEST), lag: changed.includes(LAG_TEST), why: 'Only these browser test files changed, and the app did not: the others would test what the last push tested.' };
  }
  return FULL;
}

/** The changed files as the hook hands them over (one path a line in `CI_CHANGED`), or null when it handed none. */
export const changedFrom = (text: string | undefined): readonly string[] | null => (text === undefined ? null : text.split('\n').map(l => l.trim()).filter(Boolean));

/**
 * The verdict on the public repository's run for a tree (.github/workflows/ci.yml runs there, on the clean copy
 * scripts/ci-public.sh sends). Trusted only when the run has finished, ended `success`, and every job the workflow
 * defines is in it and succeeded. Otherwise the sentence says why in plain words, and the passes run here.
 */
export type RemoteVerdict = { readonly trusted: true; readonly run: number } | { readonly trusted: false; readonly why: string };

/** A run of the public repository's Actions, the fields the verdict reads (`runsFrom` parses GitHub's answer). */
export type PublicRun = { readonly id: number; readonly message: string; readonly workflow: string; readonly status: string; readonly conclusion: string | null };
/** One job of a run (`jobsFrom` parses GitHub's answer). */
export type PublicJob = { readonly name: string; readonly status: string; readonly conclusion: string | null };

const record = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${what} is not an object`);
  return v as Record<string, unknown>;
};
const list = (v: unknown, what: string): unknown[] => {
  if (!Array.isArray(v)) throw new Error(`${what} is not a list`);
  return v;
};
const text = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`${what} is not a string`);
  return v;
};
const conclusionOf = (v: unknown, what: string): string | null => (v === null ? null : text(v, what));

/** GitHub's answer to `GET /repos/<owner>/<name>/actions/runs` as runs. Throws, naming the field, on any other shape. */
export function runsFrom(json: unknown): PublicRun[] {
  return list(record(json, 'the runs answer').workflow_runs, 'workflow_runs').map((r, i) => {
    const run = record(r, `run ${i}`);
    if (typeof run.id !== 'number') throw new Error(`run ${i}'s id is not a number`);
    return {
      id: run.id,
      message: text(record(run.head_commit, `run ${run.id}'s head_commit`).message, `run ${run.id}'s message`),
      workflow: text(run.path, `run ${run.id}'s path`),
      status: text(run.status, `run ${run.id}'s status`),
      conclusion: conclusionOf(run.conclusion, `run ${run.id}'s conclusion`),
    };
  });
}

/** GitHub's answer to `GET .../actions/runs/<id>/jobs` (the latest attempt's jobs) as jobs. Throws on any other shape. */
export function jobsFrom(json: unknown): PublicJob[] {
  return list(record(json, 'the jobs answer').jobs, 'jobs').map((j, i) => {
    const job = record(j, `job ${i}`);
    const name = text(job.name, `job ${i}'s name`);
    return { name, status: text(job.status, `job ${name}'s status`), conclusion: conclusionOf(job.conclusion, `job ${name}'s conclusion`) };
  });
}

/**
 * The names GitHub gives the jobs of a workflow file: each job's key, and for a job with a one-key matrix written as
 * a list on one line (`shard: [1, 2, 3]`) one job a value, `browser (1)`. Null for any form this does not read (a job's
 * own `name:`, a matrix of several keys or written over several lines): the hook then trusts no run, rather than guess.
 */
export function jobsOfWorkflow(yaml: string): string[] | null {
  const lines = yaml.split('\n').filter(l => l.trim() !== '' && !l.trim().startsWith('#'));
  const at = lines.indexOf('jobs:');
  if (at < 0) return null;
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith(' ')) break;
    body.push(l);
  }
  const names: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const key = /^ {2}([\w-]+):\s*$/.exec(body[i]!);
    if (!key) continue;
    let end = i + 1;
    while (end < body.length && body[end]!.startsWith('   ')) end++;
    const job = body.slice(i + 1, end);
    if (job.some(l => /^ {4}name:/.test(l))) return null;
    const m = job.findIndex(l => /^ {6}matrix:\s*$/.test(l));
    if (m < 0) { names.push(key[1]!); continue; }
    const dims: string[] = [];
    for (let k = m + 1; k < job.length && job[k]!.startsWith('        '); k++) dims.push(job[k]!);
    const one = dims.length === 1 ? /^ {8}[\w-]+:\s*\[([^\]]*)\]\s*$/.exec(dims[0]!) : null;
    if (!one) return null;
    for (const v of one[1]!.split(',')) names.push(`${key[1]} (${v.trim()})`);
  }
  return names.length > 0 ? names : null;
}

/** The newest run of `workflow` whose commit is the copy of `tree` (its message's first line is `Copy of <tree>`), or null. */
export function runOfTree(runs: readonly PublicRun[], tree: string, workflow: string): PublicRun | null {
  const mine = runs.filter(r => r.workflow === workflow && r.message.split('\n')[0]!.trim() === `Copy of ${tree}`);
  return mine.reduce<PublicRun | null>((newest, r) => (newest === null || r.id > newest.id ? r : newest), null);
}

/** Whether `run` stands for this push: finished, ended `success`, and each job of `expected` in it, with every job succeeded. */
export function judgeRun(run: PublicRun, jobs: readonly PublicJob[], expected: readonly string[]): RemoteVerdict {
  const named = `Public run ${run.id}`;
  if (run.status !== 'completed') return { trusted: false, why: `${named} has not finished (${run.status}).` };
  const failed = jobs.filter(j => j.status !== 'completed' || j.conclusion !== 'success');
  if (failed.length > 0) return { trusted: false, why: `${named} did not pass: ${failed.map(j => `${j.name} ${j.conclusion ?? j.status}`).join(', ')}.` };
  const missing = expected.filter(e => !jobs.some(j => j.name === e));
  if (missing.length > 0) return { trusted: false, why: `${named} lacks jobs the workflow defines: ${missing.join(', ')}.` };
  if (run.conclusion !== 'success') return { trusted: false, why: `${named} ended ${run.conclusion ?? 'with no conclusion'}.` };
  return { trusted: true, run: run.id };
}

/**
 * The plan after the verdict on the public run for this tree. A trusted run takes the unit and browser passes the plan
 * would run as run, and the sentence names the run and the tree; an untrusted one adds its reason and runs them here.
 * Only a pass the plan would run is taken or explained. The typecheck and the lag test (whose bounds are this box's)
 * always run here.
 */
export function trustRemote(plan: CiPlan, verdict: RemoteVerdict, tree: string): CiPlan {
  const takes = plan.unit || plan.browser !== 'none';
  if (!takes) return plan;
  const said = [plan.unit && 'The unit tests', plan.browser !== 'none' && 'the browser tests'].filter(Boolean).join(' and ').replace(/^t/, 'T');
  const why = verdict.trusted
    ? `${said} passed on the public repository for this commit's tree (${tree.slice(0, 12)}), run ${verdict.run}.`
    : `${verdict.why} ${said} run here.`;
  const after = verdict.trusted ? { unit: false, browser: 'none' as const } : {};
  return { ...plan, ...after, why: plan.why ? `${plan.why} ${why}` : why };
}

/**
 * The tree whose green run may be trusted: the tree of the commit a push carries (the hook names it in CI_PUSHED),
 * not of the checkout the hook runs in, so a push by id is right from any checkout. Run by hand there is no push and
 * the checkout's HEAD is the commit, but only when the checkout holds nothing uncommitted (`dirty`): a public run of
 * HEAD's tree did not test those changes. A push of several different commits (the hook says 'many') trusts no tree.
 * `treeOf` maps a commit id or ref to its tree id.
 */
export function testedTree(pushed: string | undefined, treeOf: (ref: string) => string, dirty: boolean): string {
  if (pushed === 'many') return '';
  if (!pushed && dirty) return '';
  return treeOf(pushed || 'HEAD');
}
