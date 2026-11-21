import { describe, expect, test } from 'bun:test';
import { BLANK, BUILD_DRAWER_STATES, MAP_MOUNT_EVENTS, MAP_MOUNT_STATES, MAP_SLOT_EVENTS, MAP_SLOT_STATES, SCREEN, buildDrawer, mapMount, mapSlot } from '../src/core/combat/map-mount.ts';
import type { BuildDrawer, BuildDrawerEvent, MapMount, MapMountEvent, MapSlot, MapSlotFx } from '../src/core/combat/map-mount.ts';
import type { FightId } from '../src/core/combat/fight-types.ts';
import { DRAWER_WALK, MOUNT_FIGHTS, MOUNT_WALK } from './models/map-mount-events.ts';

const [F1, F2] = MOUNT_FIGHTS;
const show = (fight: FightId | null): MapMountEvent => ({ kind: 'show', fight });
const drawn = (o: Partial<{ tokens: boolean; over: string; lost: boolean }> = {}): MapMountEvent => ({ kind: 'drawn', tokens: true, over: '', lost: false, ...o });
/** The view's answer to `measure`: the frame read with a size or hidden, and the words of the draw that asked. */
const sized = (shown: boolean, over = ''): MapMountEvent => ({ kind: 'sized', shown, over });
/** Runs `events` from `s`: the state at the end and every effect, in order. */
function run(s: MapMount, ...events: MapMountEvent[]): { mount: MapMount; fx: string[] } {
  const fx: string[] = [];
  for (const e of events) { const r = mapMount(s, e); s = r.mount; fx.push(...r.fx.map(f => f.kind)); }
  return { mount: s, fx };
}
const framed = (fight: FightId) => run(BLANK, show(fight), drawn(), sized(true)).mount;

describe('the battle map on the page', () => {
  test('a fight shown is framed once, at its first draw with a token that finds the frame with a size', () => {
    expect(run(BLANK, show(F1), drawn({ tokens: false }))).toEqual({ mount: { at: 'opening', fight: F1 }, fx: [] });
    expect(run(BLANK, show(F1), drawn(), sized(false))).toEqual({ mount: { at: 'opening', fight: F1 }, fx: ['measure'] });
    expect(run(BLANK, show(F1), drawn(), sized(true), show(F1), drawn())).toEqual({ mount: { at: 'framed', fight: F1, over: '' }, fx: ['measure', 'frame'] });
  });

  test('the next fight on the same map forgets the last and is framed again, as a fight is that the map opens', () => {
    const one = framed(F1);
    expect(run(one, show(F2), drawn(), sized(true))).toEqual({ mount: { at: 'framed', fight: F2, over: '' }, fx: ['forget', 'measure', 'frame'] });
    expect(run(one, show(null), show(F2), drawn(), sized(true))).toEqual({ mount: { at: 'framed', fight: F2, over: '' }, fx: ['forget', 'measure', 'frame'] });
  });

  test('no fight to show leaves the map blank, and a blank map has nothing to forget', () => {
    expect(run(BLANK, show(null), drawn(), sized(true), { kind: 'resized', shown: true })).toEqual({ mount: BLANK, fx: [] });
    expect(run(run(BLANK, show(F1)).mount, show(null))).toEqual({ mount: BLANK, fx: ['forget'] });
  });

  test('a draw of a framed fight with the same words over it asks nothing of the page and changes nothing', () => {
    const one = framed(F1);
    expect(mapMount(one, drawn())).toEqual({ mount: one, fx: [] });
    expect(mapMount(one, drawn()).mount).toBe(one);
    expect(run(one, drawn({ tokens: false, over: 'your turn', lost: true }))).toEqual({ mount: one, fx: [] });
  });

  test('new words over the frame work its height out again once the frame is shown; a turn out of sight frames again', () => {
    const one = framed(F1);
    expect(run(one, show(F1), drawn({ over: 'your turn' }), sized(true, 'your turn'))).toEqual({ mount: { at: 'framed', fight: F1, over: 'your turn' }, fx: ['measure', 'reheight'] });
    expect(run(one, drawn({ over: 'your turn' }), sized(false, 'your turn'))).toEqual({ mount: one, fx: ['measure'] });
    expect(run(one, drawn({ over: 'your turn' }), sized(false, 'your turn'), drawn({ over: 'your turn' }), sized(true, 'your turn'))).toEqual({ mount: { at: 'framed', fight: F1, over: 'your turn' }, fx: ['measure', 'measure', 'reheight'] });
    expect(run(one, show(F1), drawn({ lost: true }))).toEqual({ mount: one, fx: ['refit'] });
  });

  test('a resize frames a shown map again; one while its frame is hidden frames it when it next shows', () => {
    const one = framed(F1);
    expect(run(one, { kind: 'resized', shown: true })).toEqual({ mount: one, fx: ['frame'] });
    expect(run(one, { kind: 'resized', shown: false }, drawn(), sized(false), drawn(), sized(true))).toEqual({ mount: one, fx: ['measure', 'measure', 'frame'] });
  });

  test('a map taken off the page stops listening once, then nothing moves it', () => {
    for (const s of [BLANK, run(BLANK, show(F1)).mount, framed(F1)]) {
      expect(run(s, { kind: 'gone' })).toEqual({ mount: { at: 'gone' }, fx: ['stop'] });
      expect(run(s, { kind: 'gone' }, ...MOUNT_WALK)).toEqual({ mount: { at: 'gone' }, fx: ['stop'] });
    }
  });

  test('the walk\'s events are every kind, and every state answers each of them with a state', () => {
    expect([...new Set(MOUNT_WALK.map(e => e.kind))].sort()).toEqual([...MAP_MOUNT_EVENTS].sort());
    const states: MapMount[] = [BLANK, { at: 'opening', fight: F1 }, { at: 'framed', fight: F2, over: '' }, { at: 'gone' }];
    for (const s of states) for (const e of MOUNT_WALK) expect(MAP_MOUNT_STATES).toContain(mapMount(s, e).mount.at);
  });
});

describe('the fight screen\'s map box', () => {
  test('every state against every draw: a box that shows the fight on the map holds a map, one that hides it holds none', () => {
    const cells = MAP_SLOT_STATES.flatMap(s => MAP_SLOT_EVENTS.map(e => [s, e, mapSlot(s, e)] as const));
    expect(cells).toEqual([
      ['empty', 'shows', { slot: 'mounted', fx: ['mount', 'draw'] }],
      ['empty', 'hides', { slot: 'empty', fx: [] }],
      ['mounted', 'shows', { slot: 'mounted', fx: ['draw'] }],
      ['mounted', 'hides', { slot: 'empty', fx: ['destroy'] }],
    ]);
  });

  test('the GM\'s switch from Map to List, or to the Player seat, takes the hidden map down, and the switch back mounts a new one', () => {
    let slot: MapSlot = 'empty';
    const fx: MapSlotFx[] = [];
    for (const e of ['shows', 'shows', 'hides', 'hides', 'shows'] as const) { const r = mapSlot(slot, e); slot = r.slot; fx.push(...r.fx); }
    expect({ slot, fx }).toEqual({ slot: 'mounted', fx: ['mount', 'draw', 'draw', 'destroy', 'mount', 'draw'] });
  });
});

describe('who opens the Build drawer', () => {
  const toggled = (open: boolean, wanted: boolean, fight: FightId | null): BuildDrawerEvent => ({ kind: 'toggled', open, wanted, fight });
  const drawnIn = (fight: FightId | null): BuildDrawerEvent => ({ kind: 'drawn', fight });
  const hand = (fight: FightId | null): BuildDrawer => ({ at: 'hand', fight });

  test('every state against every event: the screen keeps the drawer until the GM moves it against the screen, and the GM keeps it for that fight only', () => {
    const states: BuildDrawer[] = [SCREEN, hand(F1), hand(null)];
    const events = [toggled(true, false, F1), toggled(false, true, F1), toggled(true, true, F1), toggled(false, true, null), drawnIn(F1), drawnIn(F2), drawnIn(null)];
    expect(states.map(s => events.map(e => buildDrawer(s, e)))).toEqual([
      [hand(F1), hand(F1), SCREEN, hand(null), SCREEN, SCREEN, SCREEN],
      [hand(F1), hand(F1), hand(F1), hand(null), hand(F1), SCREEN, SCREEN],
      [hand(F1), hand(F1), hand(F1), hand(null), SCREEN, SCREEN, hand(null)],
    ]);
    expect(BUILD_DRAWER_STATES).toEqual(['screen', 'hand']);
  });

  test('the drawer the GM opened by hand in one fight is the screen\'s again once that fight ends, and in the next fight', () => {
    const opened = buildDrawer(SCREEN, toggled(true, false, F1));
    expect(opened).toEqual(hand(F1));
    expect(buildDrawer(opened, drawnIn(F1))).toBe(opened);
    expect(buildDrawer(opened, drawnIn(null))).toEqual(SCREEN);
    expect(buildDrawer(opened, drawnIn(F2))).toEqual(SCREEN);
  });

  test('the walk\'s events are every kind, and every state answers each of them with a state', () => {
    expect([...new Set(DRAWER_WALK.map(e => e.kind))].sort()).toEqual(['drawn', 'toggled']);
    for (const s of [SCREEN, hand(F1), hand(null)]) for (const e of DRAWER_WALK) expect(BUILD_DRAWER_STATES).toContain(buildDrawer(s, e).at);
  });
});
