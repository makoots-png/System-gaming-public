// A rest and the rests a gate (src/core/hunter/rests.ts, vitals.ts `rest` and `cleared`, grant.ts `sheetEdit`). The owner,
// Nov 22: "rests will give 25% of mana back, and 25% health back. exhausted will largely clear. They should get 2x per
// dungeon, and after a dungeon clear they should get everything back." Nov 21: "Youre dead. You need to be ressed."
// Every expected number is worked from his words: a quarter of 100 HP or mana is 25, two rests a gate; "exhausted will
// largely clear" is the lead's 75% of the fatigue held, so 80 rests to 20.
import { describe, expect, test } from 'bun:test';
import { REST_EVENT_TYPES, REST_STATES, restRefusalWords, restState, restStep } from '../src/core/hunter/rests.ts';
import type { RestEventType, RestState } from '../src/core/hunter/rests.ts';
import { sheetEdit } from '../src/core/hunter/grant.ts';
import { addShadow, newShadowOf, setShadowHp } from '../src/core/hunter/shadows.ts';
import { hunterSheet, setMaximum } from '../src/core/hunter/sheet.ts';
import { WAYS_BACK } from '../src/core/hunter/vitals.ts';
import { restLines } from '../src/core/rules-text.ts';
import { settleClear } from '../src/core/gates/pay.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { newRewards } from '../src/core/rewards.ts';
import { newEvent, parseSheetKey } from '../src/core/protocol.ts';
import type { RoomCode } from '../src/core/protocol.ts';
import { landAll } from '../src/edge/room-events.ts';
import type { ApplyDeps } from '../src/edge/room-events.ts';
import { TOLD, isRefused, refuse } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { den } from './models/gate-events.ts';
import { day, dev, shid } from './fixtures/ids.ts';

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
    expect(restRefusalWords(RULES).spent).toBe(`No rests left. A hunter can rest ${N} times per gate. Clearing the gate restores everything.`);
  });

  test('a dead hunter\'s rest is refused and changes nothing', () => {
    const dead = hunter(10, 10, 0, { life: { at: 'dead' } }), before = JSON.stringify(dead);
    expect(rest(dead)).toEqual({ ok: false, why: 'cannot' });
    expect(JSON.stringify(dead)).toBe(before);
    expect(restRefusalWords(RULES).cannot).toBe(`A dead hunter cannot rest. ${WAYS_BACK} brings you back.`);
  });
});

describe('a gate\'s end', () => {
  test('a gate\'s Clear fills HP and mana, gives both rests back, and heals resting shadows without touching summoned ones', () => {
    const fresh = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') }, { onboarded: true });
    const restShade = newShadowOf({ rank: 'D', archetype: 'brute', grade: 'Elite', monster: null, name: 'Igris' }, shid('sh1'), RULES);
    const outShade = newShadowOf({ rank: 'C', archetype: 'skirmisher', grade: 'Normal', monster: null, name: 'Fang' }, shid('sh2'), RULES);
    const h = hunter(10, 0, N, {
      fatigue: 40,
      id: fresh.hunters[0]!.id,
      shadows: [{ ...restShade, hp: 0, summoned: false }, { ...outShade, hp: 5, summoned: true }],
    });
    const s: Save = { ...fresh, hunters: [h], gates: [den('detected')] };
    const out = ok(settleClear(s, 'g-den', { due: 0, xp: 0, gold: 0, items: [], payees: [h.name] }, [{ hid: h.id, rewards: newRewards() }], null, DAY));
    const after = out.save.hunters[0]!;
    expect([after.life, after.mana, after.fatigue, after.restsTaken]).toEqual([{ at: 'up', hp: 100 }, 100, 0, 0]);
    expect(after.shadows.map(x => [x.id, x.hp, x.summoned])).toEqual([['sh1', restShade.hp, false], ['sh2', 5, true]]);
    expect(ok(rest(after)).restsTaken, 'the next gate\'s first rest').toBe(1);
  });

  test('a dead hunter at a gate\'s Clear gets nothing back (resting shadows stay injured); its rests start again for the next gate', () => {
    const restShade = newShadowOf({ rank: 'D', archetype: 'brute', grade: 'Elite', monster: null, name: 'Igris' }, shid('sh1'), RULES);
    const dead = hunter(10, 0, N, { life: { at: 'dead' }, fatigue: 40, shadows: [{ ...restShade, hp: 0, summoned: false }] });
    const after = ok(sheetEdit(dead, { type: 'cleared' }, RULES));
    expect([after.life, after.mana, after.fatigue, after.restsTaken]).toEqual([{ at: 'dead' }, 0, 40, 0]);
    expect(after.shadows[0]!.hp).toBe(0);
  });

  test('a gate left without its Clear and a mid-gate rest do not heal resting shadows', () => {
    const restShade = newShadowOf({ rank: 'D', archetype: 'brute', grade: 'Elite', monster: null, name: 'Igris' }, shid('sh1'), RULES);
    const h = hunter(10, 0, 0, { shadows: [{ ...restShade, hp: 4, summoned: false }] });
    expect(ok(rest(h)).shadows[0]!.hp).toBe(4);
    const left = ok(sheetEdit({ ...h, restsTaken: N }, { type: 'gateLeft' }, RULES));
    expect([left.life, left.mana, left.restsTaken, left.shadows[0]!.hp]).toEqual([h.life, 0, 0, 4]);
  });

  test('a remote player receiving a Gate Clear noted event heals resting shadows on their phone and leaves summoned shadows untouched', () => {
    const pSave0 = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-p1-0123456789', newDeviceId: () => dev('d-p1') }, { onboarded: true });
    const gSave = { ...freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-gm-0123456789', newDeviceId: () => dev('d-gm') }, { onboarded: true }), gates: [den('detected')] };
    const s1 = newShadowOf({ rank: 'D', archetype: 'brute', grade: 'Elite', monster: null, name: 'Igris' }, shid('sh1'), RULES);
    const s2 = newShadowOf({ rank: 'C', archetype: 'skirmisher', grade: 'Normal', monster: null, name: 'Fang' }, shid('sh2'), RULES);
    let h1 = ok(addShadow(pSave0.hunters[0]!, s1, RULES));
    h1 = ok(addShadow(h1, { ...s2, summoned: true, hp: 5 }, RULES));
    h1 = ok(setShadowHp(h1, 'sh1', 0));
    const pSave: Save = { ...pSave0, hunters: [h1] };
    const key = parseSheetKey(`${pSave.settings.deviceId}:${h1.id}`)!;
    const award = newEvent('award', { to: [key], rewards: newRewards() }, { device: 'd-gm', now: 1, rand: 0.2 })!;
    const cleared = ok(settleClear(gSave, 'g-den', { due: 0, xp: 0, gold: 0, crystal: 0, items: [], payees: [h1.name] }, [], {
      code: 'ABCD23' as RoomCode,
      stamp: { device: 'd-gm', now: 2, rand: 0.3 },
      players: [{ key, rank: h1.rank, pays: award }],
    }, DAY));
    const notedEv = (cleared.save.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' && e.letter.event.type === 'noted' ? [e.letter.event] : []))[0]!;
    const deps: ApplyDeps = {
      store: { get: () => pSave },
      once: () => true,
      rules: () => RULES,
      now: () => AT,
      today: () => day('2026-11-22'),
      toast: () => {},
      system: () => {},
      warn: () => {},
      hunter: { fightOf: () => null, gmHolds: () => refuse(TOLD), granted: () => ({ lines: [], levelup: null, popup: Promise.resolve() }) },
      stepsDone: () => {},
      coinRuled: () => {},
    };
    const landed = landAll(pSave, [], [notedEv], deps);
    expect(landed.save.hunters[0]!.shadows.map(x => [x.id, x.hp, x.summoned])).toEqual([['sh1', s1.hp, false], ['sh2', 5, true]]);
  });
});

describe('the Rules page', () => {
  test('says what a rest gives, how many a gate, what a fight\'s end and a Clear give back, and follows fightRest overrides', () => {
    const [rest, perGate, dead] = restLines(RULES);
    expect(rest).toBe(`Resting restores 25% of your max HP and 25% of your max mana, up to your maximum. It also removes 75% of your fatigue. Exhausted ends once your remaining fatigue drops below ${RULES.fatigue.collapseAt}% of your capacity.`);
    expect(perGate).toBe(`You get 2 rests per gate. Clearing a gate restores full HP and mana, clears your fatigue, heals resting shadows to full HP, resets per-gate uses, and resets your rests. Finishing a solo run also resets your rests. After a fight ends, each living hunter recovers ${RULES.fight.fightRest} fatigue (Exhausted still needs a rest or gate clear).`);
    expect(dead).toBe(`A dead hunter cannot rest and gains nothing from clearing a gate. ${WAYS_BACK} brings you back. You cannot rest during a fight.`);
    expect(restLines({ ...RULES, fight: { ...RULES.fight, fightRest: 30 } })[1]).toContain('each living hunter recovers 30 fatigue');
    expect(restLines({ ...RULES, fight: { ...RULES.fight, fightRest: 0 } })[1]).not.toContain('After a fight ends');
  });
});
