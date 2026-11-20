// What a push's CI runs, by the files the push changes (scripts/ci-plan.ts).
import { describe, expect, test } from 'bun:test';
import { planOf, changedFrom, trustRemote, testedTree, FULL } from '../scripts/ci-plan.ts';

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
    for (const f of ['tests/solo.test.ts', 'tests/models/room-world.ts', 'scripts/charts/solo.ts', 'scripts/statecharts.ts', 'docs/state-machines.md', 'docs/dependency-map.md', 'AGENTS.md', 'docs/guide/combat.md', 'docs/audit/2026-11-19-neon-audit.md', '.githooks/pre-push', 'scripts/ci.ts', 'scripts/ci-plan.ts', '.claude/settings.json', '.claude/agents/writer.md', '.github/workflows/ci.yml', 'scripts/ci-public.sh', 'scripts/publish-clean.ts', '.private/scrub-terms.tsv']) {
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
  test('trusting nothing leaves the plan as it is', () => {
    expect(trustRemote(FULL, { browser: false, unit: false }, tree)).toEqual(FULL);
  });
  test('a trusted unit run and browser run skip both passes and keep the lag test, and the sentence names both and the tree', () => {
    const p = trustRemote(FULL, { browser: true, unit: true }, tree);
    expect([p.unit, p.browser, p.lag]).toEqual([false, 'none', true]);
    expect(p.why).toBe('The unit tests and the browser tests passed on the public repository for this commit\'s tree (0123456789ab).');
  });
  test('only the trusted pass is skipped', () => {
    expect(trustRemote(FULL, { browser: false, unit: true }, tree)).toMatchObject({ unit: false, browser: 'all', lag: true });
    expect(trustRemote(FULL, { browser: true, unit: false }, tree)).toMatchObject({ unit: true, browser: 'none', lag: true });
  });
  test('a pass the plan already skips is not claimed as trusted', () => {
    const notes = planOf(['docs/agent-handoff/handoff.md']);
    expect(trustRemote(notes, { browser: true, unit: true }, tree)).toEqual(notes);
    const unitOnly = planOf(['tests/solo.test.ts']);
    expect(trustRemote(unitOnly, { browser: true, unit: false }, tree)).toEqual(unitOnly);
    expect(trustRemote(unitOnly, { browser: true, unit: true }, tree).why).toContain('The unit tests passed on the public repository');
  });
  test('the plan\'s own sentence stays before the trusted one', () => {
    const p = trustRemote(planOf(['tests/solo.test.ts']), { browser: false, unit: true }, tree);
    expect(p.why.startsWith('Only unit tests')).toBe(true);
    expect(p.why.endsWith('(0123456789ab).')).toBe(true);
  });
});

describe('which tree a push is judged by', () => {
  const trees: Record<string, string> = { HEAD: 'tree-of-the-checkout', abc123: 'tree-of-the-pushed-commit' };
  const treeOf = (ref: string): string => trees[ref] ?? '';
  test('a push by id is judged by the pushed commit\'s tree, whatever the checkout holds', () => {
    expect(testedTree('abc123', treeOf)).toBe('tree-of-the-pushed-commit');
  });
  test('run by hand, with no push, the checkout\'s commit is the one', () => {
    expect(testedTree(undefined, treeOf)).toBe('tree-of-the-checkout');
    expect(testedTree('', treeOf)).toBe('tree-of-the-checkout');
  });
  test('a push of several different commits trusts no tree', () => {
    expect(testedTree('many', treeOf)).toBe('');
  });
});
