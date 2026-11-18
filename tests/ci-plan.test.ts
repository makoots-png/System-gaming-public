// What a push's CI runs, by the files the push changes (scripts/ci-plan.ts).
import { describe, expect, test } from 'bun:test';
import { planOf, changedFrom, FULL } from '../scripts/ci-plan.ts';

describe('which passes a push needs', () => {
  test('a push whose files are not known runs everything', () => {
    expect(planOf(null)).toEqual(FULL);
    expect(planOf(changedFrom(undefined))).toEqual(FULL);
  });
  test('the lead\'s notes alone run no browser test', () => {
    const p = planOf(['docs/agent-handoff/handoff.md', 'docs/agent-handoff/decisions.tsv']);
    expect([p.browser, p.lag]).toEqual(['none', false]);
  });
  test('a unit test, a model, a chart script, a generated doc, the guide or the CI\'s own scripts run no browser test', () => {
    for (const f of ['tests/solo.test.ts', 'tests/models/room-world.ts', 'scripts/charts/solo.ts', 'scripts/statecharts.ts', 'docs/state-machines.md', 'docs/dependency-map.md', 'AGENTS.md', '.githooks/pre-push', 'scripts/ci.ts', 'scripts/ci-plan.ts', '.claude/settings.json', '.claude/agents/writer.md', '.github/workflows/ci.yml', 'scripts/ci-remote.sh', 'scripts/publish-clean.ts', '.private/scrub-terms.tsv']) {
      const p = planOf([f, 'docs/agent-handoff/handoff.md']);
      expect([f, p.browser, p.lag]).toEqual([f, 'none', false]);
    }
  });
  test('browser test files alone run only themselves, and the lag test only when it is one of them', () => {
    expect(planOf(['tests/e2e/maps.e2e.ts', 'tests/e2e/solo.e2e.ts', 'tests/solo.test.ts'])).toMatchObject({ browser: ['tests/e2e/maps.e2e.ts', 'tests/e2e/solo.e2e.ts'], lag: false });
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
    expect(planOf(changedFrom(''))).toMatchObject({ browser: 'none', lag: false });
  });
});
