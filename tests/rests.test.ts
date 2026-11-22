// A rest and the rests a gate (src/core/hunter/rests.ts, vitals.ts `rest` and `cleared`, grant.ts `sheetEdit`). The owner,
// Nov 22: "rests will give 25% of mana back, and 25% health back. exhausted will largely clear. They should get 2x per
// dungeon, and after a dungeon clear they should get everything back." Nov 21: "Youre dead. You need to be ressed."
// Every expected number is worked from his words: a quarter of 100 HP or mana is 25, two rests a gate; "exhausted will
// largely clear" is the lead's 75% of the fatigue held, so 80 rests to 20.
import { describe, expect, test } from 'bun:test';
import { REST_EVENT_TYPES, REST_STATES, restRefusalWords, restState, restStep } from '../src/core/hunter/rests.ts';
import type { RestEventType, RestState } from '../src/core/hunter/rests.ts';
import { sheetEdit } from '../src/core/hunter/grant.ts';
import { hunterSheet, setMaximum } from '../src/core/hunter/sheet.ts';
import { WAYS_BACK } from '../src/core/hunter/vitals.ts';
import { restLines } from '../src/core/rules-text.ts';
import { settleClear } from '../src/core/gates/pay.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { newRewards } from '../src/core/rewards.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { den } from './models/gate-events.ts';
import { day, dev } from './fixtures/ids.ts';

const AT = '2026-11-22T10:00:00.000Z', DAY = { at: AT, today: day('2026-11-22'), R: RULES };
/** "They should get 2x per dungeon." */
const N = 2;
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
/** A hunter of 100 max HP and 100 max mana, at `hp` HP and `mana` mana, with `taken` rests taken in this gate. */
function hunter(hp: number, mana: number, taken = 0, o: Partial<Hunter> = {}): Hunter {
  const h = setMaximum(setMaximum(newHunter(RULES), 'hpMax', 100, RULES), 'manaMax', 100, RULES);
  return { ...h, life: { at: 'up', hp }, mana, restsTaken: taken, ...o };
}
const rest = (h: Hunter) => sheetEdit(h, { type: 'rest' }, RULES);

describe('the rests a gate, as a machine: every state against every event', () => {
  // A count of `left` stands for 0 rests taken, `spent` for all of them. A rest adds one while one is left and is
  // refused after; a gate's end, cleared or left, sets the count to 0.
  const COUNT: Record<RestState, number> = { left: 0, spent: N };
  const EXPECTED: Record<RestState, Record<RestEventType, number | 'spent'>> = {
    left: { rest: 1, cleared: 0, gateLeft: 0 },
    spent: { rest: 'spent', cleared: 0, gateLeft: 0 },
  };
  for (const s of REST_STATES) for (const type of REST_EVENT_TYPES) {
    test(`${s} × ${type}`, () => {
      expect(restState(COUNT[s], RULES)).toBe(s);
      const got = restStep(COUNT[s], { type }, RULES);
      expect(isRefused(got) ? got.why : got).toBe(EXPECTED[s][type]);
    });
  }
});

describe('a rest', () => {
  test('a rest at 10 of 100 HP and 10 of 100 mana gives 35 of each', () => {
    const h = ok(rest(hunter(10, 10)));
    expect(h.life).toEqual({ at: 'up', hp: 35 });
    expect(h.mana).toBe(35);
    expect(h.restsTaken).toBe(1);
  });

  test('a rest never gives past the maximum: 90 of 100 rests to 100', () => {
    const h = ok(rest(hunter(90, 90)));
    expect([h.life, h.mana]).toEqual([{ at: 'up', hp: 100 }, 100]);
  });

  test('a rest at 80 fatigue leaves 20, and an Exhausted hunter is Exhausted no more', () => {
    const cap = hunterSheet(hunter(50, 50), RULES).sheet.fatigueMax;
    expect(cap, 'a fresh hunter\'s capacity holds 80').toBeGreaterThanOrEqual(80);
    const h = ok(rest(hunter(50, 50, 0, { fatigue: 80, collapsed: true })));
    expect([h.fatigue, h.collapsed]).toEqual([20, false]);
  });

  test('a third rest in one gate is refused', () => {
    let h = hunter(10, 10);
    for (let i = 0; i < N; i++) h = ok(rest(h));
    expect(h.restsTaken).toBe(N);
    expect(rest(h)).toEqual({ ok: false, why: 'spent' });
    expect(restRefusalWords(RULES).spent).toBe(`No rest left: a hunter rests ${N} times a gate. Clearing the gate gives everything back.`);
  });

  test('a dead hunter\'s rest is refused and changes nothing', () => {
    const dead = hunter(10, 10, 0, { life: { at: 'dead' } }), before = JSON.stringify(dead);
    expect(rest(dead)).toEqual({ ok: false, why: 'cannot' });
    expect(JSON.stringify(dead)).toBe(before);
    expect(restRefusalWords(RULES).cannot).toBe(`A dead hunter cannot rest. ${WAYS_BACK} brings you back.`);
  });
});

describe('a gate\'s end', () => {
  test('a gate\'s Clear fills HP and mana and gives both rests back', () => {
    const fresh = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') }, { onboarded: true });
    const h = hunter(10, 0, N, { fatigue: 40, id: fresh.hunters[0]!.id });
    const s: Save = { ...fresh, hunters: [h], gates: [den('detected')] };
    const out = ok(settleClear(s, 'g-den', { due: 0, xp: 0, gold: 0, items: [], payees: [h.name] }, [{ hid: h.id, rewards: newRewards() }], null, DAY));
    const after = out.save.hunters[0]!;
    expect([after.life, after.mana, after.fatigue, after.restsTaken]).toEqual([{ at: 'up', hp: 100 }, 100, 0, 0]);
    expect(ok(rest(after)).restsTaken, 'the next gate\'s first rest').toBe(1);
  });

  test('a dead hunter at a gate\'s Clear gets nothing back; its rests start again for the next gate', () => {
    const dead = hunter(10, 0, N, { life: { at: 'dead' }, fatigue: 40 });
    const after = ok(sheetEdit(dead, { type: 'cleared' }, RULES));
    expect([after.life, after.mana, after.fatigue, after.restsTaken]).toEqual([{ at: 'dead' }, 0, 40, 0]);
  });

  test('a gate left without its Clear starts the rests again and gives nothing else back', () => {
    const h = hunter(10, 0, N);
    const left = ok(sheetEdit(h, { type: 'gateLeft' }, RULES));
    expect([left.life, left.mana, left.restsTaken]).toEqual([h.life, 0, 0]);
  });
});

describe('the Rules page', () => {
  test('says what a rest gives, how many a gate, and what a Clear gives back', () => {
    const [rest, perGate, dead] = restLines(RULES);
    expect(rest).toBe(`A rest gives back 25% of your max HP and 25% of your max mana, never past the maximum, and takes 75% of your fatigue off. Exhausted lifts when the fatigue left is under ${RULES.fatigue.collapseAt}% of your capacity.`);
    expect(perGate).toBe('You have 2 rests a gate. Clearing the gate gives everything back: full HP and mana, no fatigue, every use limited a gate, and your rests. A solo run\'s end starts your rests again.');
    expect(dead).toBe(`A dead hunter cannot rest and gets nothing back from a Clear: ${WAYS_BACK} brings you back. No one rests during a fight.`);
  });
});
