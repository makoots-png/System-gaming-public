// What a push's CI runs, by the files the push changes (scripts/ci-plan.ts).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { planOf, changedFrom, trustRemote, testedTree, FULL, runsFrom, jobsFrom, jobsOfWorkflow, runOfTree, judgeRun, type RemoteVerdict } from '../scripts/ci-plan.ts';

describe('which passes a push needs', () => {
  test('a push whose files are not known runs everything', () => {
    expect(planOf(null)).toEqual(FULL);
    expect(planOf(changedFrom(undefined))).toEqual(FULL);
  });
  test('the lead\'s notes alone run the typecheck and no test, unit or browser', () => {
    const p = planOf(['docs/agent-handoff/handoff.md', 'docs/agent-handoff/decisions.tsv', 'docs/agent-handoff/features/enemies/check.ts']);
    expect([p.unit, p.browser, p.lag]).toEqual([false, 'none', false]);
  });
  test('notes beside any other file keep the unit tests', () => {
    for (const f of ['tests/solo.test.ts', 'AGENTS.md', 'docs/guide/combat.md', 'tests/e2e/maps.e2e.ts', 'src/app.js', 'docs/agent-handoff-old.md']) {
      expect([f, planOf([f, 'docs/agent-handoff/handoff.md']).unit]).toEqual([f, true]);
    }
  });
  test('a unit test, a model, a chart script, a generated doc, the guide or the CI\'s own scripts run no browser test', () => {
    for (const f of ['tests/solo.test.ts', 'tests/models/room-world.ts', 'scripts/charts/solo.ts', 'scripts/statecharts.ts', 'docs/state-machines.md', 'docs/dependency-map.md', 'docs/agent-handoff/questionable-decisions.md', 'AGENTS.md', 'docs/guide/combat.md', 'docs/audit/2026-11-19-neon-audit.md', '.githooks/pre-push', 'scripts/ci.ts', 'scripts/ci-plan.ts', '.claude/settings.json', '.claude/agents/writer.md', '.github/workflows/ci.yml', 'scripts/ci-public.sh', 'scripts/publish-clean.ts', '.private/scrub-terms.tsv']) {
      const p = planOf([f, 'docs/agent-handoff/handoff.md']);
      expect([f, p.unit, p.browser, p.lag]).toEqual([f, true, 'none', false]);
    }
  });
  test('browser test files alone run only themselves, and the lag test only when it is one of them', () => {
    expect(planOf(['tests/e2e/maps.e2e.ts', 'tests/e2e/solo.e2e.ts', 'tests/solo.test.ts'])).toMatchObject({ unit: true, browser: ['tests/e2e/maps.e2e.ts', 'tests/e2e/solo.e2e.ts'], lag: false });
    expect(planOf(['tests/e2e/feel.e2e.ts'])).toMatchObject({ browser: [], lag: true });
    expect(planOf(['tests/e2e/feel.e2e.ts', 'tests/e2e/maps.e2e.ts'])).toMatchObject({ browser: ['tests/e2e/maps.e2e.ts'], lag: true });
  });
  test('anything a browser test can see runs everything', () => {
    for (const f of ['src/app.js', 'src/core/rules.ts', 'src/views/map.js', 'src/sw.js', 'public/app.css', 'server.ts', 'scripts/build.ts', 'tests/e2e/helpers.ts', 'tests/fixtures/saves/main.json', 'playwright.config.ts', 'package.json', 'bun.lock', 'tsconfig.json', 'types/bun.d.ts', 'a-file-nobody-listed.txt']) {
      expect([f, planOf([f, 'tests/e2e/maps.e2e.ts', 'docs/agent-handoff/handoff.md'])]).toEqual([f, FULL]);
    }
  });
  test('the hook\'s list is one path a line; an empty list is a push that changes nothing', () => {
    expect(changedFrom('src/app.js\n\n tests/e2e/maps.e2e.ts \n')).toEqual(['src/app.js', 'tests/e2e/maps.e2e.ts']);
    expect(planOf(changedFrom(''))).toMatchObject({ unit: true, browser: 'none', lag: false });
  });
});

describe('what a green run on the public repository stands in for', () => {
  const tree = '0123456789abcdef0123456789abcdef01234567';
  const green: RemoteVerdict = { trusted: true, run: 44757307967 };
  const red: RemoteVerdict = { trusted: false, why: 'Public run 1 did not pass: browser (6) failure.' };
  test('an untrusted run leaves the passes to run here and says why', () => {
    const p = trustRemote(FULL, red, tree);
    expect([p.unit, p.browser, p.lag]).toEqual([true, 'all', true]);
    expect(p.why).toBe('Public run 1 did not pass: browser (6) failure. The unit tests and the browser tests run here.');
  });
  test('a trusted run skips the unit and browser passes and keeps the lag test, and the sentence names the tree and the run', () => {
    const p = trustRemote(FULL, green, tree);
    expect([p.unit, p.browser, p.lag]).toEqual([false, 'none', true]);
    expect(p.why).toBe('The unit tests and the browser tests passed on the public repository for this commit\'s tree (0123456789ab), run 44757307967.');
  });
  test('a pass the plan already skips is neither claimed nor explained', () => {
    const notes = planOf(['docs/agent-handoff/handoff.md']);
    expect(trustRemote(notes, green, tree)).toEqual(notes);
    expect(trustRemote(notes, red, tree)).toEqual(notes);
    const unitOnly = planOf(['tests/solo.test.ts']);
    expect(trustRemote(unitOnly, green, tree).why).toContain('The unit tests passed on the public repository');
    expect(trustRemote(unitOnly, green, tree).why).not.toContain('browser tests passed');
  });
  test('the plan\'s own sentence stays before the trusted one', () => {
    const p = trustRemote(planOf(['tests/solo.test.ts']), green, tree);
    expect(p.why.startsWith('Only unit tests')).toBe(true);
    expect(p.why.endsWith('run 44757307967.')).toBe(true);
  });
});

describe('which public run stands for a tree, from GitHub\'s answers', () => {
  // The fields the hook reads from two real runs of Nov 20, 2026 (GET .../actions/runs and .../runs/<id>/jobs).
  // 44760395495 copied tree dc581e1a and ended `failure` on "browser (6)"; the lead pushed 92cc0de on it with the old
  // variables, which the hook trusted. 44757307967 copied tree 27582aee and was green in every job.
  const job = (name: string, conclusion: string) => ({ name, status: 'completed', conclusion });
  const REAL_RUNS = { total_count: 2, workflow_runs: [
    { id: 44760395495, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'failure', head_commit: { message: 'Copy of dc581e1abcc39180cd70992da688f2972959a4b3' } },
    { id: 44757307967, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', head_commit: { message: 'Copy of 27582aee3285200c761215137cb570fbf49ae704' } },
  ] };
  const RED_JOBS = { total_count: 8, jobs: [job('unit-postgres', 'success'), job('unit', 'success'), job('browser (2)', 'success'), job('browser (1)', 'success'), job('browser (3)', 'success'), job('browser (5)', 'success'), job('browser (4)', 'success'), job('browser (6)', 'failure')] };
  const GREEN_JOBS = { total_count: 8, jobs: [job('unit', 'success'), job('browser (1)', 'success'), job('unit-postgres', 'success'), job('browser (5)', 'success'), job('browser (6)', 'success'), job('browser (3)', 'success'), job('browser (4)', 'success'), job('browser (2)', 'success')] };
  const WORKFLOW = '.github/workflows/ci.yml';
  const expected = jobsOfWorkflow(readFileSync(WORKFLOW, 'utf8'))!;

  test('the workflow file names the unit job, the Postgres job and the six browser parts', () => {
    expect(expected).toEqual(['unit', 'unit-postgres', 'browser (1)', 'browser (2)', 'browser (3)', 'browser (4)', 'browser (5)', 'browser (6)']);
  });
  test('the run whose browser (6) failed is not trusted, and the reason names that job', () => {
    const run = runOfTree(runsFrom(REAL_RUNS), 'dc581e1abcc39180cd70992da688f2972959a4b3', WORKFLOW)!;
    expect(run.id).toBe(44760395495);
    expect(judgeRun(run, jobsFrom(RED_JOBS), expected)).toEqual({ trusted: false, why: 'Public run 44760395495 did not pass: browser (6) failure.' });
  });
  test('the run green in every job is trusted', () => {
    const run = runOfTree(runsFrom(REAL_RUNS), '27582aee3285200c761215137cb570fbf49ae704', WORKFLOW)!;
    expect(judgeRun(run, jobsFrom(GREEN_JOBS), expected)).toEqual({ trusted: true, run: 44757307967 });
  });
  test('a tree with no run has none to trust', () => {
    expect(runOfTree(runsFrom(REAL_RUNS), '0123456789abcdef0123456789abcdef01234567', WORKFLOW)).toBeNull();
  });
  test('an unfinished or cancelled run is not trusted, even when its finished jobs are green', () => {
    const run = runsFrom(REAL_RUNS)[1]!;
    expect(judgeRun({ ...run, status: 'in_progress', conclusion: null }, jobsFrom(GREEN_JOBS), expected).trusted).toBe(false);
    expect(judgeRun({ ...run, conclusion: 'cancelled' }, jobsFrom(GREEN_JOBS), expected).trusted).toBe(false);
    const running = { jobs: [...GREEN_JOBS.jobs.slice(1), { name: 'unit', status: 'in_progress', conclusion: null }] };
    expect(judgeRun(run, jobsFrom(running), expected)).toEqual({ trusted: false, why: 'Public run 44757307967 did not pass: unit in_progress.' });
  });
  test('a run missing a job the workflow defines is not trusted, though all it ran passed', () => {
    const run = runsFrom(REAL_RUNS)[1]!;
    const short = { jobs: GREEN_JOBS.jobs.filter(j => j.name !== 'unit-postgres') };
    expect(judgeRun(run, jobsFrom(short), expected)).toEqual({ trusted: false, why: 'Public run 44757307967 lacks jobs the workflow defines: unit-postgres.' });
  });
  test('the newest run of a tree decides: a red rerun after a green one is not trusted', () => {
    const tree27 = '27582aee3285200c761215137cb570fbf49ae704';
    const rerun = { ...REAL_RUNS.workflow_runs[0]!, id: 44770000000, head_commit: { message: `Copy of ${tree27}` } };
    const runs = runsFrom({ workflow_runs: [...REAL_RUNS.workflow_runs, rerun] });
    expect(runOfTree(runs, tree27, WORKFLOW)!.conclusion).toBe('failure');
  });
  test('a run of another workflow is not taken for this one', () => {
    expect(runOfTree(runsFrom(REAL_RUNS), '27582aee3285200c761215137cb570fbf49ae704', '.github/workflows/other.yml')).toBeNull();
  });
  test('an answer of another shape is refused with the field named, not read as no runs', () => {
    expect(() => runsFrom({ message: 'API rate limit exceeded' })).toThrow('workflow_runs is not a list');
    expect(() => jobsFrom({ jobs: [{ name: 'unit', status: 'completed', conclusion: 3 }] })).toThrow("job unit's conclusion is not a string");
  });
  test('a workflow form the reader does not know gives no job list, so no run is trusted', () => {
    expect(jobsOfWorkflow('name: ci\njobs:\n  unit:\n    name: Unit tests\n    runs-on: ubuntu-latest\n')).toBeNull();
    expect(jobsOfWorkflow('jobs:\n  browser:\n    strategy:\n      matrix:\n        shard: [1, 2]\n        os: [a, b]\n')).toBeNull();
    expect(jobsOfWorkflow('jobs:\n  browser:\n    strategy:\n      matrix:\n        shard:\n          - 1\n')).toBeNull();
    expect(jobsOfWorkflow('on: push\n')).toBeNull();
  });
});

describe('which tree a push is judged by', () => {
  const trees: Record<string, string> = { HEAD: 'tree-of-the-checkout', abc123: 'tree-of-the-pushed-commit' };
  const treeOf = (ref: string): string => trees[ref] ?? '';
  test('a push by id is judged by the pushed commit\'s tree, whatever the checkout holds', () => {
    expect(testedTree('abc123', treeOf, false)).toBe('tree-of-the-pushed-commit');
  });
  test('run by hand, with no push, the checkout\'s commit is the one', () => {
    expect(testedTree(undefined, treeOf, false)).toBe('tree-of-the-checkout');
    expect(testedTree('', treeOf, false)).toBe('tree-of-the-checkout');
  });
  test('run by hand with uncommitted changes, no tree stands for what is tested', () => {
    expect(testedTree(undefined, treeOf, true)).toBe('');
  });
  test('a push of several different commits trusts no tree', () => {
    expect(testedTree('many', treeOf, false)).toBe('');
  });
});

describe('the push hook and ci-public.sh', () => {
  test('the pre-push hook refuses a tree id pushed to a branch before running CI', () => {
    const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
    const tree = Bun.spawnSync(['git', 'rev-parse', 'HEAD^{tree}']).stdout.toString().trim();
    const res = Bun.spawnSync(['sh', '.githooks/pre-push', 'origin', 'https://example.invalid/repo.git'], {
      stdin: new TextEncoder().encode(`${tree} ${tree} refs/heads/test-branch ${head}\n`),
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain(`pre-push: ${tree} is a tree, not a commit`);
  });
  test('sh scripts/ci-public.sh tree prints only the bare tree id of HEAD', () => {
    const tree = Bun.spawnSync(['git', 'rev-parse', 'HEAD^{tree}']).stdout.toString().trim();
    const res = Bun.spawnSync(['sh', 'scripts/ci-public.sh', 'tree']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toBe(`${tree}\n`);
  });
});
