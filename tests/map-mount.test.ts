import { describe, expect, test } from 'bun:test';
import { BLANK, MAP_MOUNT_EVENTS, MAP_MOUNT_STATES, mapMount } from '../src/core/combat/map-mount.ts';
import type { MapMount, MapMountEvent } from '../src/core/combat/map-mount.ts';
import type { FightId } from '../src/core/combat/fight-types.ts';
import { MOUNT_FIGHTS, MOUNT_WALK } from './models/map-mount-events.ts';

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
