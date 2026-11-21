import { describe, expect, test } from 'bun:test';
import {
  LIFE_STATES, LIFE_EVENT_TYPES, FATIGUE_STATES, VITAL_EVENT_TYPES, VITAL_TABLE, can, fatiguePast, fatigueState, vitalChipsOf, hpOf, lifeAfter, manaOf, newVitals, parseUsed,
  refill, rest, usedOf, SAVES_TO_END, fatigueNews, lifeNews, vitalStep,
} from '../src/core/hunter/vitals.ts';
import { isRefused } from '../src/core/save-step.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { FatigueState, Life, LifeEvent, LifeEventType, LifeState, Maxima, VitalEvent, Vitals } from '../src/core/hunter/vitals.ts';
import { RULES } from '../src/core/rules.ts';
import { WALK_EVENTS, maxAfter } from './models/life-events.ts';
import type { Rules } from '../src/core/rules.ts';

/**
 * The rules these tests are worked out with, pinned here so a change to the shipped numbers does not move them:
 * fatigue collapses at 100% of the capacity, its penalty starts at 50% and disadvantage at 80%; a short rest gives back
 * 25% of max HP, 50% of max mana and takes 25% of the capacity off; a long rest gives back 100% of all three.
 */
const R: Rules = {
  ...RULES,
  fatigue: { penaltyAt: 50, penalty: 2, disAt: 80, collapseAt: 100 },
  rest: { short: { hpPct: 25, mpPct: 50, fatigue: 25 }, long: { hpPct: 100, mpPct: 100, fatigue: 100 } },
};
/** The hunter in these tests has 20 max HP, 10 max mana and a fatigue capacity of 100; `BIG` is the same with a capacity of 120. */
const MAX = 20;
const M = { hpMax: MAX, manaMax: 10, fatigueMax: 100 };
const BIG = { ...M, fatigueMax: 120 };
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** The vitals after `e` (`vitalStep`), for a test whose event the state takes. */
const step = (v: Vitals, e: VitalEvent, m: Maxima = M): Vitals => { const x = vitalStep(v, e, m, R); if (isRefused(x)) throw new Error(`${e.type} refused: ${x.why}`); return x; };
const mana = (v: Vitals, delta: number, m: Maxima = M) => step(v, { type: 'mana', delta }, m);
const fatigue = (v: Vitals, delta: number, m: Maxima = M) => step(v, { type: 'fatigue', delta }, m);

const up = (hp: number): Life => ({ at: 'up', hp });
const dying = (successes: 0 | 1 | 2, failures: 0 | 1 | 2): Life => ({ at: 'dying', successes, failures });
const STABLE: Life = { at: 'stable' }, DEAD: Life = { at: 'dead' };
/** One hunter in each state: up at 12 of 20 HP, dying with one success and one failure, stable, dead. */
const SAMPLE: Record<LifeState, Life> = { up: up(12), dying: dying(1, 1), stable: STABLE, dead: DEAD };

describe('the life of a hunter: every state and event', () => {
  // The death save numbers are today's (src/views/hunter.js before this model, and the rules reference: "d20, 10 or
  // higher succeeds; three successes stabilize, three failures are fatal"): a 20 brings the hunter up at 1 HP, 10 to 19
  // is a success, 2 to 9 a failure, a 1 counts as two failures. 'no change' means the event does not apply there.
  const rows: [LifeState, string, LifeEvent, Life | 'no change'][] = [
    ['up', 'damage 5: 12 - 5 = 7', { type: 'damage', amount: 5 }, up(7)],
    ['up', 'damage 12: 12 - 12 = 0, dying with no saves yet', { type: 'damage', amount: 12 }, dying(0, 0)],
    ['up', 'damage 50: well past 0, still just dying', { type: 'damage', amount: 50 }, dying(0, 0)],
    ['up', 'heal 5: 12 + 5 = 17', { type: 'heal', amount: 5 }, up(17)],
    ['up', 'heal 50: capped at the max of 20', { type: 'heal', amount: 50 }, up(20)],
    ['up', 'setHp 3', { type: 'setHp', hp: 3 }, up(3)],
    ['up', 'setHp 0: dying', { type: 'setHp', hp: 0 }, dying(0, 0)],
    ['up', 'setHp 99: capped at 20', { type: 'setHp', hp: 99 }, up(20)],
    ['up', 'deathSave', { type: 'deathSave', roll: 15 }, 'no change'],
    ['up', 'stabilize', { type: 'stabilize' }, 'no change'],
    ['up', 'revive', { type: 'revive' }, 'no change'],
    ['up', 'maxChanged to 20 with 12 HP', { type: 'maxChanged' }, 'no change'],
    ['dying', 'damage', { type: 'damage', amount: 5 }, 'no change'],
    ['dying', 'heal 5: up from 0 at 5', { type: 'heal', amount: 5 }, up(5)],
    ['dying', 'heal 50: up at the max of 20', { type: 'heal', amount: 50 }, up(20)],
    ['dying', 'setHp 4', { type: 'setHp', hp: 4 }, up(4)],
    ['dying', 'setHp 0', { type: 'setHp', hp: 0 }, 'no change'],
    ['dying', 'deathSave 20: up at 1 HP', { type: 'deathSave', roll: 20 }, up(1)],
    ['dying', 'deathSave 19: a second success', { type: 'deathSave', roll: 19 }, dying(2, 1)],
    ['dying', 'deathSave 10: a second success', { type: 'deathSave', roll: 10 }, dying(2, 1)],
    ['dying', 'deathSave 9: a second failure', { type: 'deathSave', roll: 9 }, dying(1, 2)],
    ['dying', 'deathSave 2: a second failure', { type: 'deathSave', roll: 2 }, dying(1, 2)],
    ['dying', 'deathSave 1: two failures on top of one is three: dead', { type: 'deathSave', roll: 1 }, DEAD],
    ['dying', 'stabilize', { type: 'stabilize' }, STABLE],
    ['dying', 'revive', { type: 'revive' }, 'no change'],
    ['dying', 'maxChanged', { type: 'maxChanged' }, 'no change'],
    ['stable', 'damage', { type: 'damage', amount: 5 }, 'no change'],
    ['stable', 'heal 5', { type: 'heal', amount: 5 }, up(5)],
    ['stable', 'setHp 4', { type: 'setHp', hp: 4 }, up(4)],
    ['stable', 'setHp 0', { type: 'setHp', hp: 0 }, 'no change'],
    ['stable', 'deathSave', { type: 'deathSave', roll: 20 }, 'no change'],
    ['stable', 'stabilize', { type: 'stabilize' }, 'no change'],
    ['stable', 'revive', { type: 'revive' }, 'no change'],
    ['stable', 'maxChanged', { type: 'maxChanged' }, 'no change'],
    ['dead', 'damage', { type: 'damage', amount: 5 }, 'no change'],
    ['dead', 'heal 50', { type: 'heal', amount: 50 }, 'no change'],
    ['dead', 'setHp 20', { type: 'setHp', hp: 20 }, 'no change'],
    ['dead', 'deathSave 20', { type: 'deathSave', roll: 20 }, 'no change'],
    ['dead', 'stabilize', { type: 'stabilize' }, 'no change'],
    ['dead', 'revive: up at 1 HP', { type: 'revive' }, up(1)],
    ['dead', 'maxChanged', { type: 'maxChanged' }, 'no change'],
  ];
  for (const [from, label, event, to] of rows) {
    test(`${from} + ${label}`, () => {
      const life = SAMPLE[from], before = copy(life);
      expect(lifeAfter(life, event, MAX)).toEqual(to === 'no change' ? life : to);
      expect(life, 'the input is not changed').toEqual(before);
    });
  }

  test('the table above has a row for every state and event', () => {
    const seen = new Set(rows.map(([from, , e]) => `${from} ${e.type}`));
    for (const s of LIFE_STATES) for (const t of LIFE_EVENT_TYPES) expect(seen.has(`${s} ${t}`), `${s} ${t}`).toBe(true);
  });

  test('can() says which events apply in each state: what the sheet and the GM board ask before they show a button', () => {
    expect(can(DEAD, 'revive')).toBe(true);
    expect(can(DEAD, 'heal')).toBe(false);
    expect(can(dying(0, 0), 'deathSave')).toBe(true);
    expect(can(dying(0, 0), 'stabilize')).toBe(true);
    expect(can(STABLE, 'deathSave')).toBe(false);
    expect(can(STABLE, 'stabilize')).toBe(false);
    expect(can(up(5), 'deathSave')).toBe(false);
    expect(can(up(5), 'revive')).toBe(false);
  });
});

describe('death saves', () => {
  test('three successes from fresh make the hunter stable', () => {
    let life: Life = dying(0, 0);
    for (const roll of [10, 12, 19]) life = lifeAfter(life, { type: 'deathSave', roll }, MAX);
    expect(life).toEqual(STABLE);
  });
  test('three failures from fresh make the hunter dead, and nothing but a revive brings them back', () => {
    let life: Life = dying(0, 0);
    for (const roll of [2, 5, 9]) life = lifeAfter(life, { type: 'deathSave', roll }, MAX);
    expect(life).toEqual(DEAD);
    for (const e of [{ type: 'heal', amount: MAX }, { type: 'setHp', hp: MAX }, { type: 'deathSave', roll: 20 }, { type: 'stabilize' }] as LifeEvent[]) {
      expect(lifeAfter(life, e, MAX), e.type).toEqual(DEAD);
    }
    expect(lifeAfter(life, { type: 'revive' }, MAX)).toEqual(up(1));
  });
  test('a 1 counts as two failures: a 1 then any failure is dead', () => {
    const once = lifeAfter(dying(0, 0), { type: 'deathSave', roll: 1 }, MAX);
    expect(once).toEqual(dying(0, 2));
    expect(lifeAfter(once, { type: 'deathSave', roll: 9 }, MAX)).toEqual(DEAD);
  });
  test('a roll that is not a whole number from 1 to 20 changes nothing', () => {
    for (const roll of [0, 21, 3.5, Number.NaN]) expect(lifeAfter(dying(1, 1), { type: 'deathSave', roll }, MAX)).toEqual(dying(1, 1));
  });
  test('falling again after getting up starts the saves from nothing', () => {
    const back = lifeAfter(dying(2, 2), { type: 'heal', amount: 3 }, MAX);
    expect(lifeAfter(back, { type: 'damage', amount: 3 }, MAX)).toEqual(dying(0, 0));
  });
});

describe('HP and the maximum', () => {
  test('hpOf reads HP up to the maximum, and 0 for a hunter who is down', () => {
    expect(hpOf(up(12), MAX)).toBe(12);
    expect(hpOf(up(30), MAX)).toBe(20);
    for (const life of [dying(0, 0), STABLE, DEAD]) expect(hpOf(life, MAX)).toBe(0);
  });
  test('a lower maximum brings HP down to it; a higher one does not raise HP', () => {
    expect(lifeAfter(up(18), { type: 'maxChanged' }, 15)).toEqual(up(15));
    expect(lifeAfter(up(18), { type: 'maxChanged' }, 40)).toEqual(up(18));
  });
  test('damage counts from the HP shown: 30 stored over a max of 20, 5 damage leaves 15', () => {
    expect(lifeAfter(up(30), { type: 'damage', amount: 5 }, MAX)).toEqual(up(15));
  });
  test('an amount below 1 or not a number changes nothing', () => {
    for (const amount of [0, -4, Number.NaN]) {
      expect(lifeAfter(up(12), { type: 'damage', amount }, MAX)).toEqual(up(12));
      expect(lifeAfter(up(12), { type: 'heal', amount }, MAX)).toEqual(up(12));
    }
  });
});

describe('vitals: mana, fatigue, rests and the refill', () => {
  const v = (fields: Partial<Vitals>): Vitals => ({ ...newVitals(M), ...fields });

  test('a new hunter is up at full HP and mana, rested and not collapsed', () => {
    expect(newVitals(M)).toEqual({ life: up(20), mana: 10, fatigue: 0, collapsed: false, used: {} });
  });
  test('mana moves within 0 and the max', () => {
    expect(mana(v({ mana: 4 }), 3).mana).toBe(7);
    expect(mana(v({ mana: 4 }), -9).mana).toBe(0);
    expect(mana(v({ mana: 4 }), 50).mana).toBe(10);
    expect(manaOf({ mana: 30 }, M)).toBe(10);
  });
  test('fatigue reaching the capacity of 100 collapses the hunter; lowering it keeps the collapse', () => {
    const tired = fatigue(v({ fatigue: 90 }), 10);
    expect(tired).toMatchObject({ fatigue: 100, collapsed: true });
    expect(fatigue(tired, -30)).toMatchObject({ fatigue: 70, collapsed: true });
    expect(fatigue(tired, -100)).toMatchObject({ fatigue: 0, collapsed: true });
    expect(fatigue(v({ fatigue: 90 }), 9)).toMatchObject({ fatigue: 99, collapsed: false });
  });
  test('fatigue stays within 0 and the capacity', () => {
    expect(fatigue(v({ fatigue: 90 }), 50).fatigue).toBe(100);
    expect(fatigue(v({ fatigue: 10 }), -50).fatigue).toBe(0);
  });
  test('the thresholds are shares of the capacity: with 120, collapse comes at 120 and the penalty at 60', () => {
    // collapseAt 100% of 120 is 120; penaltyAt 50% of 120 is 60; disAt 80% of 120 is 96.
    expect(fatigue(v({ fatigue: 90 }), 20, BIG)).toMatchObject({ fatigue: 110, collapsed: false });
    expect(fatigue(v({ fatigue: 110 }), 10, BIG)).toMatchObject({ fatigue: 120, collapsed: true });
    expect(fatigue(v({ fatigue: 110 }), 50, BIG).fatigue).toBe(120);
    expect([fatiguePast(59, BIG, R.fatigue.penaltyAt), fatiguePast(60, BIG, R.fatigue.penaltyAt)]).toEqual([false, true]);
    expect([fatiguePast(95, BIG, R.fatigue.disAt), fatiguePast(96, BIG, R.fatigue.disAt)]).toEqual([false, true]);
  });
  test('a short rest: +25% of 20 HP is 5, +50% of 10 mana is 5, -25 fatigue, and a collapse stays', () => {
    const after = rest(v({ life: up(4), mana: 2, fatigue: 100, collapsed: true }), 'short', M, R);
    expect(after).toEqual({ life: up(9), mana: 7, fatigue: 75, collapsed: true, used: {} });
  });
  test('a short rest takes 25% of the capacity off: 30 of 120', () => {
    expect(rest(v({ fatigue: 100 }), 'short', BIG, R).fatigue).toBe(70);
  });
  test('a long rest restores HP and mana, takes all fatigue off and ends a collapse', () => {
    const after = rest(v({ life: up(4), mana: 2, fatigue: 100, collapsed: true }), 'long', M, R);
    expect(after).toEqual({ life: up(20), mana: 10, fatigue: 0, collapsed: false, used: {} });
    expect(rest(v({ fatigue: 120, collapsed: true }), 'long', BIG, R)).toMatchObject({ fatigue: 0, collapsed: false });
  });
  test('a rest brings a dying or stable hunter up, but not a dead one', () => {
    expect(rest(v({ life: dying(1, 2) }), 'short', M, R).life).toEqual(up(5));
    expect(rest(v({ life: STABLE }), 'long', M, R).life).toEqual(up(20));
    expect(rest(v({ life: DEAD }), 'long', M, R).life).toEqual(DEAD);
  });
  test('the level-up refill fills HP and mana, but does not raise the dead', () => {
    expect(refill(v({ life: up(3), mana: 1 }), M)).toMatchObject({ life: up(20), mana: 10 });
    expect(refill(v({ life: STABLE, mana: 1 }), M)).toMatchObject({ life: up(20), mana: 10 });
    expect(refill(v({ life: DEAD, mana: 1 }), M)).toMatchObject({ life: DEAD, mana: 10 });
  });
  test('a lower maximum brings HP, mana and fatigue down to it', () => {
    expect(vitalStep(v({ life: up(20), mana: 10, fatigue: 90 }), { type: 'maxChanged' }, { hpMax: 15, manaMax: 6, fatigueMax: 80 }, R)).toMatchObject({ life: up(15), mana: 6, fatigue: 80 });
  });
  test('the chips drawn from the state: Down while dying or stable, Dead when dead, Exhausted while collapsed', () => {
    expect(vitalChipsOf(v({}))).toEqual([]);
    expect(vitalChipsOf(v({ life: dying(0, 0) }))).toEqual(['down']);
    expect(vitalChipsOf(v({ life: STABLE }))).toEqual(['down']);
    expect(vitalChipsOf(v({ life: DEAD, collapsed: true }))).toEqual(['dead', 'exhausted']);
  });
});

describe('every sequence of up to 5 events keeps the invariants', () => {
  // Up: HP from 1 to the max. Dying: each counter 0 to 2. Dead: only a revive leaves it. Every answer is a new object.
  const events = WALK_EVENTS;
  test('the event list covers every event type', () => {
    expect(new Set(events.map(e => e.type))).toEqual(new Set<LifeEventType>(LIFE_EVENT_TYPES));
  });
  test('the walk', () => {
    let checked = 0;
    const bad: string[] = [];
    const broken = (life: Life, max: number): boolean =>
      (life.at === 'up' && !(Number.isInteger(life.hp) && life.hp >= 1 && life.hp <= max))
      || (life.at === 'dying' && ![life.successes, life.failures].every(n => n === 0 || n === 1 || n === 2));
    const walk = (life: Life, max: number, path: string[], depth: number): void => {
      checked++;
      if (broken(life, max)) bad.push(`${path.join(' > ')}: ${JSON.stringify(life)}`);
      if (depth === 5) return;
      for (const e of events) {
        const nextMax = maxAfter(e, max);
        const next = lifeAfter(life, e, nextMax);
        if (life.at === 'dead' && e.type !== 'revive' && next.at !== 'dead') bad.push(`${[...path, e.type].join(' > ')}: the dead got up`);
        walk(next, nextMax, [...path, e.type], depth + 1);
      }
    };
    for (const s of LIFE_STATES) walk(SAMPLE[s], MAX, [s], 0);
    // 4 starts, 12 events, depths 0 to 5: 4 x (1 + 12 + 12^2 + 12^3 + 12^4 + 12^5) = 4 x 271,453
    expect(checked).toBe(4 * 271_453);
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('uses spent this rest (kits design 1.4, table 2.3)', () => {
  const spent = (): Vitals => ({ ...newVitals(M), used: { [abilityId('stormfront')]: 1, [abilityId('celestial-sea')]: 2 } });

  test('a new hunter has spent none, and every change of life, mana or fatigue keeps what was spent', () => {
    expect(newVitals(M).used).toEqual({});
    const v = spent();
    for (const after of [step(v, { type: 'damage', amount: 3 }), mana(v, -2), fatigue(v, 40), refill(v, M), step(v, { type: 'maxChanged' })]) {
      expect(after.used).toEqual(v.used);
    }
  });

  test('a long rest gives every use back; a short rest gives none back', () => {
    expect(rest(spent(), 'long', M, R).used).toEqual({});
    expect(rest(spent(), 'short', M, R).used).toEqual(spent().used);
    expect([usedOf(spent(), abilityId('celestial-sea')), usedOf(spent(), abilityId('dash'))]).toEqual([2, 0]);
  });

  test('a stored count is clamped to 1 to the rules\' uses, and junk or a count of 0 is none spent', () => {
    expect(parseUsed({ a: 3, b: 99, c: 0, d: 'two', e: -1, f: 2.7 }, RULES)).toEqual({ a: 3, b: RULES.fight.kit.fightUses, f: 2 });
    for (const junk of [null, 'x', [1, 2], 7]) expect(parseUsed(junk, RULES)).toEqual({});
  });
});

describe('what a change of life was, as the player reads it (lifeNews)', () => {
  const news = (life: Life, e: LifeEvent) => lifeNews(life, lifeAfter(life, e, MAX));
  test('damage to 0 is a fall; damage that leaves HP is nothing to tell', () => {
    expect(news(up(5), { type: 'damage', amount: 5 })).toEqual({ kind: 'fell' });
    expect(news(up(5), { type: 'damage', amount: 4 })).toBeNull();
  });
  test('a death save of 10 or more is a success and of 9 or less a failure, with the count the table keeps', () => {
    expect(news(dying(0, 0), { type: 'deathSave', roll: 10 })).toEqual({ kind: 'saved', successes: 1 });
    expect(news(dying(0, 0), { type: 'deathSave', roll: 9 })).toEqual({ kind: 'failed', failures: 1 });
    expect(news(dying(0, 0), { type: 'deathSave', roll: 1 }), 'a natural 1 is two failures').toEqual({ kind: 'failed', failures: 2 });
  });
  test('the third success is stable, the third failure dead, a natural 20 up again', () => {
    expect(news(dying(2, 0), { type: 'deathSave', roll: 12 })).toEqual({ kind: 'stable' });
    expect(news(dying(0, 2), { type: 'deathSave', roll: 3 })).toEqual({ kind: 'died' });
    expect(news(dying(1, 1), { type: 'deathSave', roll: 20 })).toEqual({ kind: 'raised' });
  });
  test('a heal from down and the GM\'s revive raise; the GM\'s stabilize is stable', () => {
    expect(news(STABLE, { type: 'heal', amount: 3 })).toEqual({ kind: 'raised' });
    expect(news(DEAD, { type: 'revive' })).toEqual({ kind: 'raised' });
    expect(news(dying(1, 2), { type: 'stabilize' })).toEqual({ kind: 'stable' });
  });
  test('an event the state does not take is nothing to tell: a refused write never says the hunter is dying', () => {
    for (const life of [up(5), dying(1, 1), STABLE, DEAD]) for (const t of LIFE_EVENT_TYPES) {
      if (can(life, t)) continue;
      expect(news(life, { type: t, amount: 3, hp: 3, roll: 15 } as LifeEvent)).toBeNull();
    }
  });
  test(`the dying ends at ${SAVES_TO_END} of either, which the death panel's pips count to`, () => {
    let life: Life = dying(0, 0);
    for (let i = 1; i < SAVES_TO_END; i++) { life = lifeAfter(life, { type: 'deathSave', roll: 15 }, MAX); expect(life.at).toBe('dying'); }
    expect(lifeAfter(life, { type: 'deathSave', roll: 15 }, MAX)).toEqual(STABLE);
  });
});

describe('what a change of fatigue crossed (fatigueNews)', () => {
  const v = (fatigue: number, collapsed = false) => ({ fatigue, collapsed });
  test('rising past 80% of the capacity is high; reaching 100% collapses', () => {
    expect(fatigueNews(v(75), v(80), M, R)).toBe('high');
    expect(fatigueNews(v(90), v(100, true), M, R)).toBe('collapsed');
  });
  test('lowering it, or moving it while already past, crosses nothing', () => {
    expect(fatigueNews(v(95), v(90), M, R)).toBeNull();
    expect(fatigueNews(v(85), v(90), M, R)).toBeNull();
    expect(fatigueNews(v(100, true), v(90, true), M, R)).toBeNull();
  });
  test('the share is of the capacity: at 120, 90 is not yet high', () => {
    expect(fatigueNews(v(80), v(90), BIG, R)).toBeNull();
    expect(fatigueNews(v(90), v(96), BIG, R)).toBe('high');
  });
});

describe('mana paid as a price (the spend event)', () => {
  test('the price is taken whole, or refused with nothing taken', () => {
    const v = { ...newVitals(M), mana: 4 };
    expect(manaOf(step(v, { type: 'spend', mana: 3 }), M)).toBe(1);
    expect(vitalStep(v, { type: 'spend', mana: 5 }, M, R)).toEqual({ ok: false, why: 'mana' });
    expect(manaOf(step(v, { type: 'spend', mana: 4 }), M), 'all of it may be paid').toBe(0);
  });
});

describe('the way back from dead, named the same everywhere', () => {
  test('the words name the GM\'s Revive and the shop\'s items that revive, by the name they share before their rank; the Dead chip says them', async () => {
    const { WAYS_BACK } = await import('../src/core/hunter/vitals.ts');
    const { SHOP_ITEMS } = await import('../src/core/registry/items.ts');
    const { STATE_CHIP_DEFS } = await import('../src/core/registry/statuses.ts');
    const crystals = SHOP_ITEMS.filter(d => d.type === 'consumable' && d.revive);
    expect(crystals.length).toBeGreaterThan(0);
    for (const c of crystals) expect(c.name).toMatch(/^Resurrection Crystal \([EDCBAS]\)$/);
    expect(WAYS_BACK).toBe('The GM\'s Revive or a Resurrection Crystal');
    expect(STATE_CHIP_DEFS.dead.desc).toBe(`Three failed death saves. ${WAYS_BACK} brings the hunter back.`);
  });
});

describe('the vitals machine: every life state against every event (vitalStep)', () => {
  // Each state starts with 4 of 10 mana, fatigue 90 of 100, not collapsed, one use spent. Worked from the rules above:
  // a short rest gives back ceil(25% of 20) = 5 HP, ceil(50% of 10) = 5 mana and takes 25 fatigue off; a long rest
  // gives back all of them and the uses. A heal of the dead and damage to the down are the life table's refusals.
  const USED = { [abilityId('dash')]: 1 };
  const start = (life: Life): Vitals => ({ life, mana: 4, fatigue: 90, collapsed: false, used: USED });
  /** The lower maxima `maxChanged` is played with: 10 HP, 3 mana, a capacity of 80. */
  const LOW: Maxima = { hpMax: 10, manaMax: 3, fatigueMax: 80 };
  const EVENTS: Record<string, VitalEvent> = {
    'damage 5': { type: 'damage', amount: 5 }, 'heal 6': { type: 'heal', amount: 6 }, 'HP set to 9': { type: 'setHp', hp: 9 },
    'a death save of 15': { type: 'deathSave', roll: 15 }, 'stabilize': { type: 'stabilize' },
    'the GM\'s revive': { type: 'revive', by: 'gm' }, 'a crystal\'s revive': { type: 'revive', by: 'item' },
    '+3 mana': { type: 'mana', delta: 3 }, 'a price of 3 mana': { type: 'spend', mana: 3 }, 'a price of 5 mana': { type: 'spend', mana: 5 },
    '+10 fatigue': { type: 'fatigue', delta: 10 }, 'a refill': { type: 'refill' },
    'a short rest': { type: 'rest', kind: 'short' }, 'a long rest': { type: 'rest', kind: 'long' }, 'lower maxima': { type: 'maxChanged' },
    'the fight\'s totals': { type: 'fightTotals', life: up(30), mana: 50, fatigue: 100, used: {} },
  };
  type Out = Vitals | 'cannot' | 'mana';
  const was = (life: Life, o: Partial<Vitals> = {}): Vitals => ({ ...start(life), ...o });
  const L = SAMPLE;
  const TOTALS = (): Vitals => ({ life: up(20), mana: 10, fatigue: 100, collapsed: true, used: {} });
  const EXPECTED: Record<LifeState, Record<string, Out>> = {
    up: {
      'damage 5': was(up(7)), 'heal 6': was(up(18)), 'HP set to 9': was(up(9)), 'a death save of 15': 'cannot', 'stabilize': 'cannot',
      'the GM\'s revive': 'cannot', 'a crystal\'s revive': 'cannot', '+3 mana': was(L.up, { mana: 7 }), 'a price of 3 mana': was(L.up, { mana: 1 }),
      'a price of 5 mana': 'mana', '+10 fatigue': was(L.up, { fatigue: 100, collapsed: true }), 'a refill': was(up(20), { mana: 10 }),
      'a short rest': was(up(17), { mana: 9, fatigue: 65 }), 'a long rest': was(up(20), { mana: 10, fatigue: 0, used: {} }),
      'lower maxima': was(up(10), { mana: 3, fatigue: 80 }), 'the fight\'s totals': TOTALS(),
    },
    dying: {
      'damage 5': 'cannot', 'heal 6': was(up(6)), 'HP set to 9': was(up(9)), 'a death save of 15': was(dying(2, 1)), 'stabilize': was(STABLE),
      'the GM\'s revive': 'cannot', 'a crystal\'s revive': 'cannot', '+3 mana': was(L.dying, { mana: 7 }), 'a price of 3 mana': was(L.dying, { mana: 1 }),
      'a price of 5 mana': 'mana', '+10 fatigue': was(L.dying, { fatigue: 100, collapsed: true }), 'a refill': was(up(20), { mana: 10 }),
      'a short rest': was(up(5), { mana: 9, fatigue: 65 }), 'a long rest': was(up(20), { mana: 10, fatigue: 0, used: {} }),
      'lower maxima': was(L.dying, { mana: 3, fatigue: 80 }), 'the fight\'s totals': TOTALS(),
    },
    stable: {
      'damage 5': 'cannot', 'heal 6': was(up(6)), 'HP set to 9': was(up(9)), 'a death save of 15': 'cannot', 'stabilize': 'cannot',
      'the GM\'s revive': 'cannot', 'a crystal\'s revive': 'cannot', '+3 mana': was(STABLE, { mana: 7 }), 'a price of 3 mana': was(STABLE, { mana: 1 }),
      'a price of 5 mana': 'mana', '+10 fatigue': was(STABLE, { fatigue: 100, collapsed: true }), 'a refill': was(up(20), { mana: 10 }),
      'a short rest': was(up(5), { mana: 9, fatigue: 65 }), 'a long rest': was(up(20), { mana: 10, fatigue: 0, used: {} }),
      'lower maxima': was(STABLE, { mana: 3, fatigue: 80 }), 'the fight\'s totals': TOTALS(),
    },
    // SMX-rules-1.2 waits on the owner: a dead hunter's refill and rests are taken today, the life staying dead.
    dead: {
      'damage 5': 'cannot', 'heal 6': 'cannot', 'HP set to 9': 'cannot', 'a death save of 15': 'cannot', 'stabilize': 'cannot',
      'the GM\'s revive': was(up(1)), 'a crystal\'s revive': was(up(1)), '+3 mana': was(DEAD, { mana: 7 }), 'a price of 3 mana': was(DEAD, { mana: 1 }),
      'a price of 5 mana': 'mana', '+10 fatigue': was(DEAD, { fatigue: 100, collapsed: true }), 'a refill': was(DEAD, { mana: 10 }),
      'a short rest': was(DEAD, { mana: 9, fatigue: 65 }), 'a long rest': was(DEAD, { mana: 10, fatigue: 0, used: {} }),
      'lower maxima': was(DEAD, { mana: 3, fatigue: 80 }), 'the fight\'s totals': TOTALS(),
    },
  };

  test('the events played cover every event type', () => {
    expect(new Set(Object.values(EVENTS).map(e => e.type))).toEqual(new Set(VITAL_EVENT_TYPES));
  });
  for (const s of LIFE_STATES) {
    for (const [name, e] of Object.entries(EVENTS)) {
      test(`${s} × ${name}`, () => {
        const v = start(L[s]), before = copy(v);
        const got = vitalStep(v, e, e.type === 'maxChanged' ? LOW : M, R);
        const want = EXPECTED[s][name]!;
        expect(isRefused(got) ? got.why : got).toEqual(want);
        expect(v, 'the input is not changed').toEqual(before);
      });
    }
  }
  test('a hunter\'s fields beside the vitals stay out of the answer', () => {
    expect(Object.keys(step({ ...start(up(12)), name: 'Jinwoo' } as Vitals, { type: 'mana', delta: 1 })).sort()).toEqual(['collapsed', 'fatigue', 'life', 'mana', 'used']);
  });
  test('every state takes a fitted maximum and the fight\'s totals', () => {
    for (const s of LIFE_STATES) expect([VITAL_TABLE[s].maxChanged, VITAL_TABLE[s].fightTotals]).toEqual([true, true]);
  });
  test('the refill without rules (starter.ts) answers what vitalStep\'s refill does, in every state', () => {
    for (const s of LIFE_STATES) for (const collapsed of [false, true]) {
      const v = { ...start(L[s]), collapsed };
      expect(refill(v, M)).toEqual(step(v, { type: 'refill' }));
    }
  });
});

describe('the collapse: fresh, tired and collapsed against every fatigue move', () => {
  // Tired from 50% of the capacity, collapsed from 100% and until a long rest. Fresh starts at 10, tired at 60, the
  // collapsed hunter at 60 with the latch set. A short rest takes 25 off.
  const START: Record<FatigueState, Vitals> = {
    fresh: { ...newVitals(M), fatigue: 10 }, tired: { ...newVitals(M), fatigue: 60 }, collapsed: { ...newVitals(M), fatigue: 60, collapsed: true },
  };
  const totals = (f: number): VitalEvent => ({ type: 'fightTotals', life: up(MAX), mana: 10, fatigue: f });
  /** The lower capacity fitted: 50. */
  const HALF: Maxima = { ...M, fatigueMax: 50 };
  const MOVES: [string, VitalEvent, Maxima, Record<FatigueState, FatigueState>][] = [
    ['+50 fatigue', { type: 'fatigue', delta: 50 }, M, { fresh: 'tired', tired: 'collapsed', collapsed: 'collapsed' }],
    ['-40 fatigue: lowering it keeps a collapse', { type: 'fatigue', delta: -40 }, M, { fresh: 'fresh', tired: 'fresh', collapsed: 'collapsed' }],
    ['a short rest keeps a collapse', { type: 'rest', kind: 'short' }, M, { fresh: 'fresh', tired: 'fresh', collapsed: 'collapsed' }],
    ['a long rest ends it', { type: 'rest', kind: 'long' }, M, { fresh: 'fresh', tired: 'fresh', collapsed: 'fresh' }],
    // SMX-rules-6.1 waits on the owner: 60 fitted to a capacity of 50 is 50 of 50, past the collapse share, and does not collapse today.
    ['the capacity lowered to 50', { type: 'maxChanged' }, HALF, { fresh: 'fresh', tired: 'tired', collapsed: 'collapsed' }],
    ['the fight\'s totals at 100', totals(100), M, { fresh: 'collapsed', tired: 'collapsed', collapsed: 'collapsed' }],
    // SMX-rules-6.2 waits on the owner: a collapse reached in the fight's totals holds after the fight brings fatigue to 70.
    ['the fight\'s totals at 70', totals(70), M, { fresh: 'tired', tired: 'tired', collapsed: 'collapsed' }],
    ['a refill keeps it', { type: 'refill' }, M, { fresh: 'fresh', tired: 'tired', collapsed: 'collapsed' }],
    ['+3 mana keeps it', { type: 'mana', delta: 3 }, M, { fresh: 'fresh', tired: 'tired', collapsed: 'collapsed' }],
    ['a price of 3 mana keeps it', { type: 'spend', mana: 3 }, M, { fresh: 'fresh', tired: 'tired', collapsed: 'collapsed' }],
    ['damage 5 keeps it', { type: 'damage', amount: 5 }, M, { fresh: 'fresh', tired: 'tired', collapsed: 'collapsed' }],
  ];
  for (const [name, e, m, want] of MOVES) {
    for (const s of FATIGUE_STATES) {
      test(`${s} × ${name}: ${want[s]}`, () => {
        expect(fatigueState(START[s], M, R), 'the start').toBe(s);
        expect(fatigueState(step(START[s], e, m), m, R)).toBe(want[s]);
      });
    }
  }
  test('fatigue at 100 in the fight, brought to 70 before its end, leaves the sheet collapsed (SMX-rules-6.2, today)', () => {
    const mid = step(START.fresh, totals(100));
    expect(step(mid, totals(70))).toMatchObject({ fatigue: 70, collapsed: true });
  });
});
