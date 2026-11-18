// ci-plan.ts: which of the CI's passes a push needs, from the files it changes. Pure; scripts/ci.ts runs the plan and
// .githooks/pre-push gives it the files. A pass is skipped only where no changed file can change its result; anything
// this file does not know runs everything.

/** What a push runs: the typecheck and the unit tests always; the browser tests all, some files, or none; the lag test or not. */
export type CiPlan = {
  readonly browser: 'all' | 'none' | readonly string[];
  readonly lag: boolean;
  /** One sentence for the push's log: what is skipped and why. Empty when everything runs. */
  readonly why: string;
};

export const FULL: CiPlan = { browser: 'all', lag: true, why: '' };

/** The lead's notes: no test reads them and nothing is built from them. */
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
  // the CI mirror's workflow and the script that sends it a snapshot: neither is served nor read by a test
  || f.startsWith('.github/') || f === 'scripts/ci-remote.sh'
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
  const rest = files.filter(f => f !== '' && !isNotes(f));
  if (rest.every(isUnitOnly)) {
    return { browser: 'none', lag: false, why: rest.length ? 'Only unit tests, charts, guides or the CI\'s own scripts changed: no browser test reads them.' : 'Only docs/agent-handoff/ changed: no test reads it.' };
  }
  if (rest.every(f => isUnitOnly(f) || isBrowserTest(f))) {
    const changed = rest.filter(isBrowserTest);
    return { browser: changed.filter(f => f !== LAG_TEST), lag: changed.includes(LAG_TEST), why: 'Only these browser test files changed, and the app did not: the others would test what the last push tested.' };
  }
  return FULL;
}

/** The changed files as the hook hands them over (one path a line in `CI_CHANGED`), or null when it handed none. */
export const changedFrom = (text: string | undefined): readonly string[] | null => (text === undefined ? null : text.split('\n').map(l => l.trim()).filter(Boolean));
