// Every view and panel the modules register, read from the source as the dependency map reads it (scripts/deps.ts).
// A new view or panel is checked here with no new test. Then the life of a view's part or a panel on the page.
import { expect, test } from 'bun:test';
import { buildMap } from '../scripts/deps.ts';
import { PANEL_SAID, PANEL_STATES, panelDraw, panelDrawn } from '../src/core/panel.ts';
import type { PanelCall, PanelSaid, PanelState } from '../src/core/panel.ts';

const map = await buildMap();
const appJs = await Bun.file(`${import.meta.dir}/../src/app.js`).text();
const dupes = (xs: string[]): string[] => xs.filter((x, i) => xs.indexOf(x) !== i);

test('the modules register views and panels the map can read', () => {
  expect(map.views.length).toBeGreaterThan(0);
  expect(map.panels.length).toBeGreaterThan(0);
  expect(map.unresolved.filter(u => /register(View|Panel)/.test(u.what))).toEqual([]);
});

test('no two views share an id, and no two panels: the nav and the router find each by its id', () => {
  expect(dupes(map.views.map(v => v.id))).toEqual([]);
  expect(dupes(map.panels.map(p => p.id))).toEqual([]);
});

test('every panel names a view that some module registers, or it is never shown', () => {
  const ids = new Set(map.views.map(v => v.id));
  expect(map.panels.filter(p => !ids.has(p.view!)).map(p => `${p.id} -> ${p.view}`)).toEqual([]);
});

test('every module in MODULES is imported in src/app.js, and every module that registers a view or panel is in MODULES', () => {
  const modules = appJs.match(/const MODULES = \{([^}]*)\}/)![1]!.split(',').map(s => s.trim()).filter(Boolean);
  const imported = new Map([...appJs.matchAll(/^import \* as (\w+) from '\.\/([^']+)';$/gm)].map(m => [m[1]!, `src/${m[2]}`]));
  expect(modules.filter(m => !imported.has(m))).toEqual([]);
  const registered = new Set(modules.map(m => imported.get(m)));
  const registering = [...new Set([...map.views, ...map.panels].map(s => s.at.file))];
  expect(registering.filter(f => !registered.has(f))).toEqual([]);
});

// A view's main part or a panel on the page (src/core/panel.ts): its `when` is asked once a draw, and its answer and
// where the part is say which calls run. The expected table is the rule: a part is mounted once, the first time it
// shows; updated each draw it shows after; a `when` or a call that throws fails it, and a failed part runs nothing more.

/** One draw of a part at `at` whose `when` said `said`: the calls made, in order, and where the part is after. `throws` is the call that throws. */
function drawOnce(at: PanelState, said: PanelSaid, throws: PanelCall | null = null): { calls: PanelCall[]; to: PanelState; shown: boolean } {
  const calls: PanelCall[] = [];
  const to = panelDrawn(at, said, c => { calls.push(c); return c !== throws; });
  return { calls, to, shown: panelDraw(at, said).shown };
}

test('every place a part can be, against every answer of its when: the calls it makes, where it is after, and whether it shows', () => {
  const table = Object.fromEntries(PANEL_STATES.map(at => [at, Object.fromEntries(PANEL_SAID.map(said => {
    const d = drawOnce(at, said);
    return [said, `${d.calls.join('+') || 'nothing'} -> ${d.to}${d.shown ? '' : ', hidden'}`];
  }))]));
  expect(table).toEqual({
    asked: { yes: 'mount+update -> live', no: 'nothing -> asked, hidden', threw: 'nothing -> failed' },
    live: { yes: 'update -> live', no: 'nothing -> live, hidden', threw: 'nothing -> failed' },
    failed: { yes: 'nothing -> failed', no: 'nothing -> failed, hidden', threw: 'nothing -> failed' },
  });
});

test('a panel whose when throws before it ever showed is never mounted: it shows failed', () => {
  expect(drawOnce('asked', 'threw')).toEqual({ calls: [], to: 'failed', shown: true });
});

test('a part whose mount throws is not updated, and one whose update throws fails', () => {
  expect(drawOnce('asked', 'yes', 'mount')).toEqual({ calls: ['mount'], to: 'failed', shown: true });
  expect(drawOnce('live', 'yes', 'update')).toEqual({ calls: ['update'], to: 'failed', shown: true });
});
