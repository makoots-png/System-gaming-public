// The state charts in docs/state-machines.md are what the real reducers do today. scripts/statecharts.ts walks each
// machine and draws it; this test fails when a chart is stale, a state of a machine's union has no box, or a box cannot
// be reached.
import { describe, expect, test } from 'bun:test';
import { DOC, build, render } from '../scripts/statecharts.ts';

const built = build();

describe('the state charts', () => {
  test('docs/state-machines.md is what the code gives (run bun run charts after a change to a machine or a view)', async () => {
    expect(await Bun.file(DOC).text()).toBe(render(built));
  }, 30_000);

  for (const { machine, walk, charts } of built) {
    test(`${machine.name}: every state of its union is reached by the walk and drawn in each chart`, () => {
      const reached = new Set(walk.states.flatMap(s => machine.kindsOf(s)));
      expect(machine.kinds.filter(k => !reached.has(k))).toEqual([]);
      for (const c of charts) {
        for (const kind of machine.kinds) {
          const s = walk.states.find(x => machine.kindsOf(x).includes(kind));
          const view = machine.views.find(v => v.title === c.title)!;
          const shape = view.state(s);
          const paths = typeof shape === 'string' ? [[shape]] : Array.isArray(shape) ? [shape] : Object.values(shape).map(v => (typeof v === 'string' ? [v] : v));
          for (const p of paths) expect(c.regions.some(g => g.nodes.some(n => n.join('/') === p.join('/')))).toBe(true);
        }
      }
    });

    test(`${machine.name}: each chart state is reached by arrows from a start and keeps an arrow out when it can move`, () => {
      expect(charts.flatMap(c => c.problems)).toEqual([]);
    });
  }
});
