// This phone's solo run (src/core/gates/solo-run.ts): one run at a time, from the tap on Enter alone until its window closes.
import { describe, expect, test } from 'bun:test';
import { NO_RUN, RUN_PHASE_EVENTS, RUN_PHASES, mayEnter, playingOn, runPhaseStep } from '../src/core/gates/solo-run.ts';
import type { RunPhase } from '../src/core/gates/solo-run.ts';
import { MIRA, PERSONAL, RUN_PHASE_WALK, WORLD } from './models/solo-run-events.ts';

const asking: RunPhase = { at: 'asking', gate: PERSONAL, hid: MIRA };
const playing: RunPhase = { at: 'playing', gate: PERSONAL, hid: MIRA, round: 2, moves: 5 };
const told: RunPhase = { at: 'told', gate: PERSONAL, hid: MIRA };

describe('a solo run on this phone', () => {
  test('a tap on Enter alone asks, the question answered plays, a round is counted, the write tells, and its window closing ends it', () => {
    const a = runPhaseStep(NO_RUN, { type: 'enter', gate: PERSONAL, hid: MIRA });
    expect(a).toEqual(asking);
    const p = runPhaseStep(a, { type: 'go' });
    expect(p).toEqual({ at: 'playing', gate: PERSONAL, hid: MIRA, round: 0, moves: 0 });
    const r = runPhaseStep(p, { type: 'played', round: 2, moves: 5 });
    expect(r).toEqual(playing);
    const t = runPhaseStep(r, { type: 'wrote' });
    expect(t).toEqual(told);
    expect(runPhaseStep(t, { type: 'done' })).toEqual(NO_RUN);
  });

  test('while a run is in flight, a tap on Enter alone of any gate changes nothing, so no second run starts', () => {
    for (const s of [asking, playing, told]) {
      expect(mayEnter(s)).toBe(false);
      for (const gate of [PERSONAL, WORLD]) expect(runPhaseStep(s, { type: 'enter', gate, hid: MIRA })).toBe(s);
    }
    expect(mayEnter(NO_RUN)).toBe(true);
  });

  test('a run that is refused, declined, or ends without its write is over: Enter alone may be tapped again', () => {
    expect(runPhaseStep(asking, { type: 'done' })).toEqual(NO_RUN);
    expect(runPhaseStep(playing, { type: 'done' })).toEqual(NO_RUN);
  });

  test('the round and moves are drawn on the run\'s own card only, and only while it plays', () => {
    expect(playingOn(playing, PERSONAL, MIRA)).toEqual({ round: 2, moves: 5 });
    expect(playingOn(playing, WORLD, MIRA)).toBeNull();
    expect(playingOn(playing, PERSONAL, 'h2' as typeof MIRA)).toBeNull();
    for (const s of [NO_RUN, asking, told]) expect(playingOn(s, PERSONAL, MIRA)).toBeNull();
  });

  test('the same round and moves again answer the same value, so nothing is painted twice', () => {
    expect(runPhaseStep(playing, { type: 'played', round: 2, moves: 5 })).toBe(playing);
  });

  test('the walk\'s events are every kind, and every state answers each of them with a state', () => {
    expect([...new Set(RUN_PHASE_WALK.map(e => e.type))].sort()).toEqual([...RUN_PHASE_EVENTS].sort());
    for (const s of [NO_RUN, asking, playing, told]) for (const e of RUN_PHASE_WALK) expect(RUN_PHASES).toContain(runPhaseStep(s, e).at);
  });
});
