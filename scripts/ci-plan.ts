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

/** Which passes the public repository ran green for this commit's tree: each is true only when the variable that names it holds this tree's id. */
export type Trusted = { readonly browser: boolean; readonly unit: boolean };

/**
 * The plan after the passes that ran on the public repository are taken as run (`CI_BROWSER_REMOTE`, `CI_UNIT_REMOTE`).
 * Only a pass the plan would run is taken, and the sentence says which and for what tree, so the log shows what ran
 * here and what ran there. The typecheck and the lag test are never taken: they run here whatever is trusted.
 */
export function trustRemote(plan: CiPlan, trusted: Trusted, tree: string): CiPlan {
  const browser = trusted.browser && plan.browser !== 'none';
  const unit = trusted.unit && plan.unit;
  if (!browser && !unit) return plan;
  const where = `on the public repository for this commit's tree (${tree.slice(0, 12)})`;
  const said = [unit && 'The unit tests', browser && 'the browser tests'].filter(Boolean).join(' and ').replace(/^t/, 'T');
  const why = `${said} passed ${where}.`;
  return { ...plan, unit: unit ? false : plan.unit, browser: browser ? 'none' : plan.browser, why: plan.why ? `${plan.why} ${why}` : why };
}

/**
 * The tree whose green run may be trusted: the tree of the commit a push carries (the hook names it in CI_PUSHED),
 * not of the checkout the hook runs in, so a push by id is right from any checkout. Run by hand there is no push and
 * the checkout's HEAD is the commit. A push of several different commits (the hook says 'many') trusts no tree.
 * `treeOf` maps a commit id or ref to its tree id.
 */
export function testedTree(pushed: string | undefined, treeOf: (ref: string) => string): string {
  if (pushed === 'many') return '';
  return treeOf(pushed || 'HEAD');
}
