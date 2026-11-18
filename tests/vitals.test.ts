import { describe, expect, test } from 'bun:test';
import {
  LIFE_STATES, LIFE_EVENT_TYPES, can, changeFatigue, changeMana, fatiguePast, vitalChipsOf, fitMaxima, hit, hpOf, lifeAfter, manaOf, newVitals, parseUsed,
  refill, rest, setFatigue, setMana, usedOf, SAVES_TO_END, fatigueNews, lifeNews, spendMana,
} from '../src/core/hunter/vitals.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { Life, LifeEvent, LifeEventType, LifeState, Vitals } from '../src/core/hunter/vitals.ts';
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
    expect(changeMana(v({ mana: 4 }), 3, M).mana).toBe(7);
    expect(changeMana(v({ mana: 4 }), -9, M).mana).toBe(0);
    expect(changeMana(v({ mana: 4 }), 50, M).mana).toBe(10);
    expect(setMana(v({ mana: 4 }), 99, M).mana).toBe(10);
    expect(manaOf({ mana: 30 }, M)).toBe(10);
  });
  test('fatigue reaching the capacity of 100 collapses the hunter; lowering it keeps the collapse', () => {
    const tired = changeFatigue(v({ fatigue: 90 }), 10, M, R);
    expect(tired).toMatchObject({ fatigue: 100, collapsed: true });
    expect(changeFatigue(tired, -30, M, R)).toMatchObject({ fatigue: 70, collapsed: true });
    expect(setFatigue(tired, 0, M, R)).toMatchObject({ fatigue: 0, collapsed: true });
    expect(changeFatigue(v({ fatigue: 90 }), 9, M, R)).toMatchObject({ fatigue: 99, collapsed: false });
  });
  test('fatigue stays within 0 and the capacity', () => {
    expect(changeFatigue(v({ fatigue: 90 }), 50, M, R).fatigue).toBe(100);
    expect(changeFatigue(v({ fatigue: 10 }), -50, M, R).fatigue).toBe(0);
  });
  test('the thresholds are shares of the capacity: with 120, collapse comes at 120 and the penalty at 60', () => {
    // collapseAt 100% of 120 is 120; penaltyAt 50% of 120 is 60; disAt 80% of 120 is 96.
    expect(changeFatigue(v({ fatigue: 90 }), 20, BIG, R)).toMatchObject({ fatigue: 110, collapsed: false });
    expect(changeFatigue(v({ fatigue: 110 }), 10, BIG, R)).toMatchObject({ fatigue: 120, collapsed: true });
    expect(changeFatigue(v({ fatigue: 110 }), 50, BIG, R).fatigue).toBe(120);
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
  test('the level-up and daily refill fills HP and mana, but does not raise the dead', () => {
    expect(refill(v({ life: up(3), mana: 1 }), M)).toMatchObject({ life: up(20), mana: 10 });
    expect(refill(v({ life: STABLE, mana: 1 }), M)).toMatchObject({ life: up(20), mana: 10 });
    expect(refill(v({ life: DEAD, mana: 1 }), M)).toMatchObject({ life: DEAD, mana: 10 });
  });
  test('a lower maximum brings HP, mana and fatigue down to it', () => {
    expect(fitMaxima(v({ life: up(20), mana: 10, fatigue: 90 }), { hpMax: 15, manaMax: 6, fatigueMax: 80 })).toMatchObject({ life: up(15), mana: 6, fatigue: 80 });
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
    for (const after of [hit(v, { type: 'damage', amount: 3 }, M), changeMana(v, -2, M), setFatigue(v, 40, M, R), refill(v, M), fitMaxima(v, M)]) {
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

describe('mana paid as a price (spendMana)', () => {
  const base = newVitals(M);
  test('the price is taken whole, or refused with nothing taken', () => {
    const v = setMana(base, 4, M);
    expect(manaOf(spendMana(v, 3, M) as Vitals, M)).toBe(1);
    expect(spendMana(v, 5, M)).toEqual({ ok: false, why: 'mana' });
    expect(manaOf(spendMana(v, 4, M) as Vitals, M), 'all of it may be paid').toBe(0);
  });
});

describe('the way back from dead, named the same everywhere', () => {
  test('the words name the GM\'s Revive and the shop\'s item that revives, by its own name; the Dead chip says them', async () => {
    const { WAYS_BACK } = await import('../src/core/hunter/vitals.ts');
    const { SHOP_ITEMS } = await import('../src/core/registry/items.ts');
    const { STATE_CHIP_DEFS } = await import('../src/core/registry/statuses.ts');
    const crystal = SHOP_ITEMS.find(d => d.type === 'consumable' && d.revive);
    expect(crystal?.name).toBe('Resurrection Crystal');
    expect(WAYS_BACK).toBe(`The GM's Revive or a ${crystal!.name}`);
    expect(STATE_CHIP_DEFS.dead.desc).toBe(`Three failed death saves. ${WAYS_BACK} brings the hunter back.`);
  });
});
