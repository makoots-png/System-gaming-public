// row-life.ts: life updates, overheal tracking (Hook H2), and strict reference identity for rows not watching overhealed.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { HunterRow, MonsterRow, Origin, StackDef, Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { rowLifeAfter, watchesOverheal } from '../src/core/combat/row-life.ts';

const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const origin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
const hpMax = modified(origin, [], RULES).sheet.hpMax;

const overhealDef: StatusDef = {
  label: 'Rising Dawn',
  desc: '',
  ops: [],
  triggers: [{ on: 'overhealed', to: 'self', limit: { kind: 'round' }, ops: [{ op: 'shield', amount: f('0.5 * over') }] }],
};
const otherTriggerDef: StatusDef = {
  label: 'Thorns',
  desc: '',
  ops: [],
  triggers: [{ on: 'struck', tag: null, to: 'other', limit: { kind: 'round' }, ops: [{ op: 'damage', type: 'arcane', amount: f('5'), when: 'use' }] }],
};
const leaveOverhealDef: StackDef = {
  label: 'Brittle Grace',
  desc: '',
  ops: [],
  stack: { cap: 5, leave: { kind: 'event', event: 'overhealed' }, keep: 'fight', threshold: null },
};
const leaveStruckDef: StackDef = {
  label: 'Poise',
  desc: '',
  ops: [],
  stack: { cap: 5, leave: { kind: 'event', event: 'struck' }, keep: 'fight', threshold: null },
};
const statusOf = (key: string, def: StatusDef, owed?: true): Status => ({
  key: statusKey(key), def, source: { id: null, tier: 0 }, until: owed ? tick(0) : null, since: tick(0), settledAt: tick(0), ...(owed ? { owed } : {}),
  ...('stack' in def && def.stack ? { stacks: 2 } : {}),
} as Status);

function hunterRow(hp: number | 'dead', statuses: Status[] = []): HunterRow {
  const { stats, sheet } = modified(origin, statuses, RULES);
  return {
    id: combatantId('H'), name: 'Aria', side: 'party', kind: 'hunter',
    life: hp === 'dead' ? { at: 'dead' } : { at: 'up', hp },
    origin, tier: 0, stats, sheet, speed: sheet.speed, at: tick(0), tie: 0, place: place(0, 0),
    mana: 20, fatigue: 0, shield: null, channel: null, statuses, readyAt: {}, abilities: [],
    holder: null, threat: null, stagger: null, intent: null, xp: 0, mythic: null,
  };
}

function monsterRow(hp: number | 'dead', statuses: Status[] = []): MonsterRow {
  const { stats, sheet } = modified(origin, statuses, RULES);
  return {
    id: combatantId('M'), name: 'Goblin', side: 'foe', kind: 'monster',
    life: hp === 'dead' ? { at: 'dead' } : { at: 'up', hp },
    origin, tier: 0, stats, sheet, speed: sheet.speed, at: tick(0), tie: 0, place: place(1, 0),
    mana: 20, fatigue: 0, shield: null, channel: null, statuses, readyAt: {}, abilities: [],
    holder: null, threat: {}, stagger: null, intent: null, xp: 0, mythic: null,
  };
}

describe('Hook H2: watchesOverheal and rowLifeAfter overheal recording', () => {
  test('watchesOverheal is true for rows holding a live overhealed trigger or a stack whose leave event is overhealed', () => {
    expect(watchesOverheal(hunterRow(hpMax))).toBe(false);
    expect(watchesOverheal(hunterRow(hpMax, [statusOf('thorns', otherTriggerDef)]))).toBe(false);
    expect(watchesOverheal(hunterRow(hpMax, [statusOf('poise', leaveStruckDef)]))).toBe(false);
    expect(watchesOverheal(hunterRow(hpMax, [statusOf('dawn', overhealDef, true)]))).toBe(false);
    expect(watchesOverheal(hunterRow(hpMax, [statusOf('dawn', overhealDef)]))).toBe(true);
    expect(watchesOverheal(monsterRow(hpMax, [statusOf('dawn', overhealDef)]))).toBe(true);
    expect(watchesOverheal(hunterRow(hpMax, [statusOf('grace', leaveOverhealDef)]))).toBe(true);
    expect(watchesOverheal(hunterRow(hpMax, [statusOf('grace', leaveOverhealDef, true)]))).toBe(true);
  });

  test('rows not watching overhealed keep strict reference identity on full-HP heals and never record overhealed', () => {
    const plainHunter = hunterRow(hpMax);
    const healedFull = rowLifeAfter(plainHunter, { type: 'heal', amount: 30 });
    expect(healedFull).toBe(plainHunter);
    expect(healedFull.overhealed).toBeUndefined();

    const otherHunter = hunterRow(hpMax, [statusOf('thorns', otherTriggerDef)]);
    expect(rowLifeAfter(otherHunter, { type: 'heal', amount: 30 })).toBe(otherHunter);

    const otherLeave = hunterRow(hpMax, [statusOf('poise', leaveStruckDef)]);
    expect(rowLifeAfter(otherLeave, { type: 'heal', amount: 30 })).toBe(otherLeave);

    const owedHunter = hunterRow(hpMax, [statusOf('dawn', overhealDef, true)]);
    expect(rowLifeAfter(owedHunter, { type: 'heal', amount: 30 })).toBe(owedHunter);

    const plainMonster = monsterRow(hpMax);
    expect(rowLifeAfter(plainMonster, { type: 'heal', amount: 30 })).toBe(plainMonster);

    const damagedHunter = hunterRow(hpMax - 10);
    const topped = rowLifeAfter(damagedHunter, { type: 'heal', amount: 30 });
    expect(rowHp(topped)).toBe(hpMax);
    expect(topped.overhealed).toBeUndefined();
  });

  test('a row holding only a stack whose leave event is overhealed records exact excess', () => {
    const leaveFull = hunterRow(hpMax, [statusOf('grace', leaveOverhealDef)]);
    const overFull = rowLifeAfter(leaveFull, { type: 'heal', amount: 22 });
    expect(overFull).not.toBe(leaveFull);
    expect(rowHp(overFull)).toBe(hpMax);
    expect(overFull.overhealed).toBe(22);

    const leaveDamaged = hunterRow(hpMax - 10, [statusOf('grace', leaveOverhealDef)]);
    const overPart = rowLifeAfter(leaveDamaged, { type: 'heal', amount: 18 });
    expect(rowHp(overPart)).toBe(hpMax);
    expect(overPart.overhealed).toBe(8);

    const underPart = rowLifeAfter(leaveDamaged, { type: 'heal', amount: 6 });
    expect(rowHp(underPart)).toBe(hpMax - 4);
    expect(underPart.overhealed).toBeUndefined();
  });

  test('watched rows record exact excess healing on partial-to-max and full-HP heals, and accumulate multiple heals', () => {
    const watched = hunterRow(hpMax - 20, [statusOf('dawn', overhealDef)]);

    // Heal below max HP: no excess, no overhealed field
    const under = rowLifeAfter(watched, { type: 'heal', amount: 12 });
    expect(rowHp(under)).toBe(hpMax - 8);
    expect(under.overhealed).toBeUndefined();

    // Heal exactly to max HP: 0 excess, no overhealed field
    const exact = rowLifeAfter(watched, { type: 'heal', amount: 20 });
    expect(rowHp(exact)).toBe(hpMax);
    expect(exact.overhealed).toBeUndefined();

    // Partial heal crossing max HP: gained 20, excess 15
    const crossed = rowLifeAfter(watched, { type: 'heal', amount: 35 });
    expect(rowHp(crossed)).toBe(hpMax);
    expect(crossed.overhealed).toBe(15);

    // Full-HP heal on a watched row returns a new row with exact excess even though life did not change
    const full = hunterRow(hpMax, [statusOf('dawn', overhealDef)]);
    const overFull = rowLifeAfter(full, { type: 'heal', amount: 27 });
    expect(overFull).not.toBe(full);
    expect(rowHp(overFull)).toBe(hpMax);
    expect(overFull.overhealed).toBe(27);

    // Fractional amount truncates like lifeAfter/foeLifeAfter
    const frac = rowLifeAfter(full, { type: 'heal', amount: 12.9 });
    expect(frac.overhealed).toBe(12);

    // Consecutive overheals accumulate before triggers read them
    const twice = rowLifeAfter(crossed, { type: 'heal', amount: 20 });
    expect(twice.overhealed).toBe(35);

    // Foe rows watching overhealed follow the same rule
    const foe = monsterRow(hpMax - 5, [statusOf('dawn', overhealDef)]);
    const foeOver = rowLifeAfter(foe, { type: 'heal', amount: 19 });
    expect(rowHp(foeOver)).toBe(hpMax);
    expect(foeOver.overhealed).toBe(14);
  });

  test('dead watched rows, invalid amounts, and GM setHp never record overhealed', () => {
    const dead = hunterRow('dead', [statusOf('dawn', overhealDef)]);
    expect(rowLifeAfter(dead, { type: 'heal', amount: 30 })).toBe(dead);

    const deadFoe = monsterRow('dead', [statusOf('dawn', overhealDef)]);
    expect(rowLifeAfter(deadFoe, { type: 'heal', amount: 30 })).toBe(deadFoe);

    const full = hunterRow(hpMax, [statusOf('dawn', overhealDef)]);
    for (const amount of [0, -10, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rowLifeAfter(full, { type: 'heal', amount })).toBe(full);
    }

    const damaged = hunterRow(hpMax - 10, [statusOf('dawn', overhealDef)]);
    const gmSet = rowLifeAfter(damaged, { type: 'setHp', hp: hpMax + 50 });
    expect(rowHp(gmSet)).toBe(hpMax);
    expect(gmSet.overhealed).toBeUndefined();
  });
});
