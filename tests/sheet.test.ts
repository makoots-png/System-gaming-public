import { describe, expect, test } from 'bun:test';
import { autoSpend, buildOf, checkBonus, checksOf, explain, hunterSheet, setMaximum } from '../src/core/hunter/sheet.ts';
import { newHunter } from '../src/core/save.ts';
import type { SheetCondition, SheetHunter, SheetRules } from '../src/core/hunter/sheet.ts';
import { parseItemDef } from '../src/core/registry/item-book.ts';
import type { HeldItem, ItemDefData } from '../src/core/registry/item-book.ts';
import { SLOTS } from '../src/core/registry/items.ts';
import type { Slot } from '../src/core/registry/items.ts';
import type { ItemId } from '../src/core/ids.ts';
import { customId, rulesWith } from './fixtures/items.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { levelPoints } from '../src/core/hunter/progress.ts';
import type { Progress } from '../src/core/hunter/progress.ts';
import { RULES } from '../src/core/rules.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import type { Stats } from '../src/core/stats.ts';
import { iid, qid } from './fixtures/ids.ts';
import { withKeystones } from './fixtures/keystone-rules.ts';

// Curve values are worked by hand from design 2.1: eff(s) = 10 * (s / 10) ^ 0.8, x(s) = eff(s) - 10,
// capped(x, cap) = cap * x / (x + 40). Rule numbers are read from RULES by name.

const stats = (o: Partial<Stats> = {}): Stats => ({ str: 10, agi: 10, vit: 10, ins: 10, dis: 10, pre: 10, pow: 10, ctl: 10, ...o });
const NOTHING_WORN = Object.fromEntries(SLOTS.map(s => [s, null])) as Record<Slot, ItemId | null>;
/** A hunter for the sheet; `equipped` names only the slots that hold something, by item id. */
const hunter = ({ equipped = {}, ...o }: Partial<Omit<SheetHunter, 'equipped'>> & { readonly equipped?: Partial<Record<Slot, string | null>> } = {}): SheetHunter => ({
  stats: stats(), level: 1, rank: 'E', fatigue: 0, penalty: null, hpAdj: 0, manaAdj: 0, titleId: null, titles: [],
  items: [], skills: [], conditions: [], ...o,
  equipped: { ...NOTHING_WORN, ...Object.fromEntries(Object.entries(equipped).map(([k, v]) => [k, v === null || v === undefined ? null : iid(v)])) },
});

const R: SheetRules = RULES;

/** An item def read through the one item parser: gear of `slot` with the numbers given. */
const gearDef = (name: string, slot: Slot, more: Record<string, unknown>): ItemDefData => parseItemDef({
  name, rar: 'common', slot,
  ...(slot === 'weapon' ? { type: 'weapon', dice: '1d4', attack: 'strike' } : slot.startsWith('ring') ? { type: 'accessory' } : { type: 'armor' }),
  ...more,
})!;
/** The hunter's own (ad hoc) copy of `def` under bag id `id`. */
const own = (id: string, def: ItemDefData): HeldItem => ({ kind: 'adhoc', id: iid(id), qty: 1, item: def });
const VEST = own('i1', gearDef('Vest', 'chest', { weight: 6, armor: 12, resist: 3 }));
const KNIFE = own('i2', gearDef('Knife', 'weapon', { weight: 1, bonus: { str: 2, armorPenFlat: 5 } }));
const RING = own('i3', gearDef('Ring', 'ring1', { weight: 0, bonus: { vit: 5 } }));
const PLATE = own('i4', gearDef('Plate', 'chest', { weight: 32, armor: 60, resist: 20, bonus: { pow: 3 } }));

const SLOWED: StatusDef = { label: 'Slowed', desc: '', ops: [{ op: 'speed', pct: [-20, -25, -30, -35, -40, -50] }] };
const FRIGHTENED: StatusDef = { label: 'Frightened', desc: '', ops: [{ op: 'stat', key: 'dis', amount: { kind: 'number', value: -8 } }] };
const RESTRAINED: StatusDef = { label: 'Restrained', desc: '', ops: [{ op: 'root' }] };
const on = (key: string, def: StatusDef, tier = 0): SheetCondition => ({ key: statusKey(key), def, source: { id: null, tier } });

describe('buildOf', () => {
  test('a new hunter is its spent stats and its level, with no gear and no perks', () => {
    const h = hunter({ level: 4 });
    expect(buildOf(h, R)).toEqual({ stats: h.stats, level: 4, gear: [], perks: {} });
  });

  test('only worn items are gear; an item in the bag adds nothing', () => {
    const h = hunter({ items: [VEST, KNIFE, PLATE], equipped: { chest: 'i1', weapon: 'i2', offhand: null } });
    const b = buildOf(h, R);
    expect(b.gear, 'worn gear in slot order: the knife (weapon), then the vest (chest)').toEqual([{ weight: 1, armor: 0, resist: 0 }, { weight: 6, armor: 12, resist: 3 }]);
    expect(b.perks).toEqual({ str: 2, armorPenFlat: 5 });
  });

  test('the active title, worn gear, passive skills and the GM\'s adjustments all add up', () => {
    const h = hunter({
      titleId: 'wolf', titles: [{ id: 'wolf', bonus: { str: 2 } }],
      items: [KNIFE, RING], equipped: { weapon: 'i2', ring1: 'i3' },
      skills: [{ type: 'passive', bonus: { str: 1, hpMax: 10 } }, { type: 'active' }],
      hpAdj: 7, manaAdj: -3,
    });
    expect(buildOf(h, R).perks).toEqual({ str: 5, vit: 5, hpMax: 17, manaMax: -3, armorPenFlat: 5 });
  });

  test('only the active title counts', () => {
    const titles = [{ id: 'wolf', bonus: { str: 2 } }, { id: 'king', bonus: { pow: 5 } }];
    expect(buildOf(hunter({ titles, titleId: 'king' }), R).perks).toEqual({ pow: 5 });
    expect(buildOf(hunter({ titles, titleId: null }), R).perks).toEqual({});
  });
});

describe('hunterSheet', () => {
  test('a new hunter at E has the base numbers of design 2.2', () => {
    const { stats: s, sheet } = hunterSheet(hunter(), R);
    expect(s).toEqual(stats());
    // HP 45 * (1 + 0), mana 10, fatigue 100, carry 20, speed 100, a stride of half of 6 tiles, no armor or resist.
    expect([sheet.hpMax, sheet.manaMax, sheet.fatigueMax, sheet.carry, sheet.speed, sheet.stride, sheet.armor, sheet.resist])
      .toEqual([45, 10, 100, 20, 100, 3, 0, 0]);
  });

  test('worn gear\'s weight, armor, resist and its bonus\'s Lethality reach the sheet', () => {
    const { sheet } = hunterSheet(hunter({ items: [VEST, KNIFE], equipped: { chest: 'i1', weapon: 'i2' } }), R);
    expect([sheet.weight, sheet.armor, sheet.resist, sheet.armorPenFlat]).toEqual([7, 12, 3, 5]);
  });

  test('a worn reference reads its def from the rules: an edit of the def changes the sheet, and a def no phone has adds nothing', () => {
    const id = customId('vest');
    const h = hunter({ items: [{ kind: 'ref', id: iid('i1'), defId: id, qty: 1 }], equipped: { chest: 'i1' } });
    const armorUnder = (def: ItemDefData | null): number => hunterSheet(h, def ? rulesWith({ [id]: def }) : R).sheet.armor;
    expect(armorUnder(gearDef('Vest', 'chest', { armor: 12 }))).toBe(12);
    expect(armorUnder(gearDef('Vest', 'chest', { armor: 20 }))).toBe(20);
    expect(armorUnder(null)).toBe(0);
  });

  test('a stat bonus raises the stat and the numbers it feeds', () => {
    const { stats: s, sheet } = hunterSheet(hunter({ items: [RING], equipped: { ring1: 'i3' } }), R);
    expect(s.vit).toBe(15);
    // x(15) = 3.83; HP 45 * (1 + 0.9 * 3.83 / 43.83) = 48.54, rounded 49.
    expect(sheet.hpMax).toBe(49);
  });

  test('hpAdj and manaAdj move max HP and max mana', () => {
    const { sheet } = hunterSheet(hunter({ hpAdj: 7, manaAdj: -3 }), R);
    expect([sheet.hpMax, sheet.manaMax]).toEqual([52, 7]);
  });

  test('a condition changes the stats and the sheet, read at its source\'s tier', () => {
    expect(hunterSheet(hunter({ conditions: [on('slowed', SLOWED, 1)] }), R).sheet.speed).toBe(75);
    expect(hunterSheet(hunter({ conditions: [on('frightened', FRIGHTENED)] }), R).stats.dis).toBe(2);
  });

  test('a rooting condition leaves no move and no stride', () => {
    const { sheet } = hunterSheet(hunter({ conditions: [on('restrained', RESTRAINED)] }), R);
    expect([sheet.move, sheet.stride]).toEqual([0, 0]);
  });
});

describe('checkBonus', () => {
  test('at the base a check is the rank\'s bonus', () => {
    expect(checkBonus(hunter(), 'str', RULES)).toBe(RULES.rankBonus.E);
    expect(checkBonus(hunter({ rank: 'C', level: 20 }), 'ins', R)).toBe(RULES.rankBonus.C);
  });

  test('a stat adds half its effective points above the base, rounded down', () => {
    // x(14) = 3.09, half 1; x(20) = 7.41, half 3; x(22) = 8.79, half 4.
    expect(checkBonus(hunter({ stats: stats({ agi: 14 }) }), 'agi', R)).toBe(1 + RULES.rankBonus.E);
    expect(checkBonus(hunter({ stats: stats({ agi: 20 }) }), 'agi', R)).toBe(3 + RULES.rankBonus.E);
    expect(checkBonus(hunter({ stats: stats({ agi: 22 }) }), 'agi', R)).toBe(4 + RULES.rankBonus.E);
  });

  test('perks and conditions count toward the stat', () => {
    // A title's 2 on Strength 18 is Strength 20: half of 7.41 is 3.
    const titled = hunter({ stats: stats({ str: 18 }), titleId: 'wolf', titles: [{ id: 'wolf', bonus: { str: 2 } }] });
    expect(checkBonus(titled, 'str', R)).toBe(3 + RULES.rankBonus.E);
    // Frightened leaves Discipline 2: x(2) = -7.24, half -3.62, rounded down -4.
    expect(checkBonus(hunter({ conditions: [on('frightened', FRIGHTENED)] }), 'dis', R)).toBe(-4 + RULES.rankBonus.E);
  });

  test('fatigue costs the rules\' penalty from its share of the fatigue capacity on', () => {
    const tired = (vit: number, fatigue: number): number => checkBonus(hunter({ stats: stats({ vit }), fatigue }), 'str', R);
    const base = RULES.rankBonus.E, cost = RULES.fatigue.penalty;
    // Vitality 10: capacity 100, the penalty from 50 (penaltyAt 50 percent).
    expect([tired(10, 49), tired(10, 50)]).toEqual([base, base - cost]);
    // Vitality 20: capacity 100 + 50 * 7.41 / 47.41 = 107.8, rounded 108; the penalty from 54.
    expect([tired(20, 53), tired(20, 54)]).toEqual([base, base - cost]);
  });

  test('a missed daily\'s penalty takes the rules\' penalty check off', () => {
    const h = hunter({ penalty: { since: '2026-11-01', days: 1, questId: qid('q1') } });
    expect(checkBonus(h, 'str', R)).toBe(RULES.rankBonus.E - RULES.penaltyCheck);
  });
});

describe('checksOf', () => {
  const checks = (o: Partial<SheetHunter>) => { const h = hunter(o); return checksOf(h, hunterSheet(h, R), R); };

  test('fatigue gives every check disadvantage from the rules\' share of the fatigue capacity on', () => {
    // Vitality 10: capacity 100, disadvantage from 80 (disAt 80 percent).
    expect([checks({ fatigue: 79 }).dis, checks({ fatigue: 80 }).dis]).toEqual([false, true]);
    // Vitality 20: capacity 108 (see the fatigue penalty case), disadvantage from 80 percent of it, 86.4.
    expect([checks({ stats: stats({ vit: 20 }), fatigue: 86 }).dis, checks({ stats: stats({ vit: 20 }), fatigue: 87 }).dis]).toEqual([false, true]);
  });

  test('says what it took off every check: the fatigue penalty and a missed daily\'s penalty', () => {
    const c = checks({ fatigue: 50, penalty: { since: '2026-11-01', days: 1, questId: qid('q1') } });
    expect({ tired: c.tired, penalty: c.penalty }).toEqual({ tired: RULES.fatigue.penalty, penalty: RULES.penaltyCheck });
    expect(c.bonus.ctl).toBe(RULES.rankBonus.E - RULES.fatigue.penalty - RULES.penaltyCheck);
  });

  test('gives a bonus for each of the eight stats', () => {
    // Agility 14: x = 3.09, half 1.
    const e = RULES.rankBonus.E;
    expect(checks({ stats: stats({ agi: 14 }) }).bonus).toEqual({ str: e, agi: 1 + e, vit: e, ins: e, dis: e, pre: e, pow: e, ctl: e });
  });
});

describe('autoSpend', () => {
  // Free points are what the levels give plus bonus points less what was spent, so spending the level's points leaves
  // exactly the bonus points free.
  const free = (n: number): Progress => ({ level: 1, xp: 0, peakLevel: 1, bonusPoints: n, spent: { str: levelPoints(RULES, 1) }, pending: {} });

  test('places every free point by stat weights, favoring the higher-weighted stat on a tie', () => {
    const weights = { agi: 2, str: 1 };
    expect(autoSpend(free(6), weights, RULES)).toEqual({ agi: 4, str: 2 });
    expect(autoSpend(free(3), weights, RULES)).toEqual({ agi: 2, str: 1 });
    expect(autoSpend(free(1), weights, RULES)).toEqual({ agi: 1 });
    expect(autoSpend(free(1), { pow: 1, str: 1 }, RULES)).toEqual({ str: 1 });
  });

  test('a stat weighted 0 gets no point', () => {
    expect(autoSpend(free(4), { pow: 1, ctl: 0 }, RULES)).toEqual({ pow: 4 });
  });

  test('places nothing when no point is free or weights name no stat', () => {
    expect(autoSpend(free(0), { agi: 2, str: 1 }, RULES)).toEqual({});
    expect(autoSpend(free(5), {}, RULES)).toEqual({});
  });
});

describe('the GM\'s edit of max HP and max mana', () => {
  test('round trip: max HP set to a number and back moves the adjustment there and back; HP above the lower maximum comes down', () => {
    const h = newHunter(RULES), max = hunterSheet(h, RULES).sheet.hpMax;
    const up = setMaximum(h, 'hpMax', max + 15, RULES);
    expect(up.hpAdj).toBe(15);
    expect(hunterSheet(up, RULES).sheet.hpMax).toBe(max + 15);
    const back = setMaximum(up, 'hpMax', max, RULES);
    expect(back).toEqual(h);
    const down = setMaximum(h, 'hpMax', max - 10, RULES);
    expect(down.life).toMatchObject({ hp: max - 10 });
  });
  test('max HP set to 0 is 1, the least the sheet gives; set again it moves nothing, and set back the adjustment is 0 again (SMX-rules-1.3)', () => {
    const h = newHunter(RULES), max = hunterSheet(h, RULES).sheet.hpMax;
    const once = setMaximum(h, 'hpMax', 0, RULES), twice = setMaximum(once, 'hpMax', 0, RULES);
    expect([once.hpAdj, hunterSheet(once, RULES).sheet.hpMax, once.life]).toEqual([1 - max, 1, { at: 'up', hp: 1 }]);
    expect(twice).toEqual(once);
    expect(setMaximum(twice, 'hpMax', max, RULES).hpAdj).toBe(0);
  });
  test('max mana set below 0 is 0; set again it moves nothing', () => {
    const h = newHunter(RULES), max = hunterSheet(h, RULES).sheet.manaMax;
    const once = setMaximum(h, 'manaMax', -5, RULES);
    expect([once.manaAdj, hunterSheet(once, RULES).sheet.manaMax, once.mana]).toEqual([-max, 0, 0]);
    expect(setMaximum(once, 'manaMax', -5, RULES)).toEqual(once);
  });
});

describe('keystones on the sheet (notes-11-keystones.md, design A.3)', () => {
  const focused = hunter({ rank: 'D', level: 12, stats: stats({ dis: 30, vit: 15 }) });
  const mark = keystoneOf({ tier: 'mark', stat: 'dis' }, RULES);
  const on: SheetRules = withKeystones(R);

  test('a keystone\'s bonus is on the sheet', () => {
    expect(mark.bonus.tenacity, 'the registry gives Dis\'s mark a tenacity bonus').toBeGreaterThan(0);
    expect(buildOf(focused, on).perks).toEqual(mark.bonus);
    const gain = hunterSheet(focused, on).sheet.tenacity - hunterSheet(focused, R).sheet.tenacity;
    expect(gain).toBeGreaterThan(0);
    expect(explain(focused, 'tenacity', on).parts.find(p => p.from === 'keystone')!.amount).toBe(gain);
  });

  test('the keystone is earned from points, not from gear: a ring of Discipline adds its bonus and no mark', () => {
    const ringed = hunter({ rank: 'D', level: 12, stats: stats({ vit: 15 }), items: [own('i5', gearDef('Ring of Discipline', 'ring1', { bonus: { dis: 20 } }))], equipped: { ring1: 'i5' } });
    expect(buildOf(ringed, on).perks).toEqual({ dis: 20 });
  });

  test('with the room\'s switch off the sheet holds no keystone bonus', () => {
    expect(buildOf(focused, R).perks).toEqual({});
  });
});
