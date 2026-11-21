// The item budget (economy design 2.3 to 2.5, unit 3): what an item of a tier and a grade may hold, what an item spends
// of it, the built-in items against it, and the item maker's spend line. Every expected number is worked from the rule:
// the middle budget is `itemBudget.share` of the points a hunter of the rank has at its first level, over the slots; the
// spans tile on a log scale; a spend's conversions are block [2.3]'s.
import { describe as group, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { kitGear, pointsAt, sheetOf, split } from '../src/core/hunter/derive.ts';
import { LOOT_ITEMS, RARITIES, SAMPLE_WEARER, SHOP_ITEMS, STARTER_GEAR, itemOf, piece, valueOf } from '../src/core/registry/items.ts';
import type { Grade, ItemDef, ItemTemplate, Rarity } from '../src/core/registry/items.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { gradeBand, gradeOfSpend, itemSpend, middleBudget, spendLine, tierSpan } from '../src/core/registry/item-budget.ts';

const ALL: readonly ItemDef[] = [...SHOP_ITEMS, ...LOOT_ITEMS, ...Object.values(STARTER_GEAR)];
const def = (name: string): ItemDef => ALL.find(d => d.name === name)!;
const spendOf = (name: string): number => itemSpend(itemOf(RULES, def(name)), RULES)!.points;
/** A worn item of `rar` with nothing on it but what `rest` sets. */
const gear = (rar: Rarity, rest: Partial<ItemTemplate>): ItemTemplate =>
  ({ name: 'Test piece', rar, type: 'accessory', slot: 'ring1', qty: 1, dice: '', bonus: {}, desc: '', armor: 0, resist: 0, ...rest });
const weapon = (rar: Rarity, dice: string, rest: Partial<ItemTemplate> = {}): ItemTemplate =>
  gear(rar, { type: 'weapon', slot: 'weapon', dice, attack: 'strike', ...rest });

/** Each rank's middle budget by the rule: 0.5 of the points at the rank's first level (12 + 3 a level after the first), over 10 slots. */
const MIDDLE = { E: 0.5 * 12 / 10, D: 0.5 * 39 / 10, C: 0.5 * 69 / 10, B: 0.5 * 114 / 10, A: 0.5 * 159 / 10, S: 0.5 * 219 / 10 } as const;

group('the budget of a tier and a grade (economy design 2.4)', () => {
  test('the middle budget is share times the points a hunter of the rank has at its first level, over the slots: E 0.6, D 1.95, C 3.45, B 5.7, A 7.95, S 10.95', () => {
    for (const [rank, b] of Object.entries(MIDDLE) as [keyof typeof MIDDLE, number][]) expect(middleBudget(RULES, rank)).toBeCloseTo(b, 9);
  });

  test('a tier runs from halfway to the tier below to halfway to the tier above on a log scale, cut in three equal steps: rare is 2.59 to 4.43', () => {
    const low = Math.sqrt(MIDDLE.D * MIDDLE.C), top = Math.sqrt(MIDDLE.C * MIDDLE.B), k = Math.cbrt(top / low);
    const s = tierSpan(RULES, 'C');
    expect(s.low).toBeCloseTo(low, 9);
    expect(s.tops[-1]).toBeCloseTo(low * k, 9);
    expect(s.tops[0]).toBeCloseTo(low * k * k, 9);
    expect(s.tops[1]).toBeCloseTo(top, 9);
  });

  test('E\'s low edge and S\'s top are mirrored: as far below E\'s middle as D\'s span starts above it, and the same for S over A', () => {
    expect(tierSpan(RULES, 'E').low).toBeCloseTo(MIDDLE.E * Math.sqrt(MIDDLE.E / MIDDLE.D), 9);
    expect(tierSpan(RULES, 'S').tops[1]).toBeCloseTo(MIDDLE.S * Math.sqrt(MIDDLE.S / MIDDLE.A), 9);
  });

  test('the spans tile: each tier\'s plus ends where the next tier\'s span begins', () => {
    const ranks = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
    for (let i = 0; i + 1 < ranks.length; i++) expect(tierSpan(RULES, ranks[i]!).tops[1]).toBeCloseTo(tierSpan(RULES, ranks[i + 1]!).low, 9);
  });

  test('block [2.4] to one decimal: the top of each grade, minus, middle and plus, at each rank', () => {
    const tops = (['E', 'D', 'C', 'B', 'A', 'S'] as const).map(r => { const t = tierSpan(RULES, r).tops; return [t[-1], t[0], t[1]].map(n => n.toFixed(1)); });
    expect(tops).toEqual([['0.5', '0.7', '1.1'], ['1.4', '1.9', '2.6'], ['3.1', '3.7', '4.4'], ['5.1', '5.9', '6.7'], ['7.5', '8.4', '9.3'], ['10.4', '11.6', '12.9']]);
  });

  test('a rarity\'s budget is its rank\'s: rare reads C, and a GM who ranks rare as B moves its bands with it', () => {
    expect(gradeBand(RULES, 'rare', 0)).toEqual({ grade: 0, low: tierSpan(RULES, 'C').tops[-1], high: tierSpan(RULES, 'C').tops[0] });
    const asB: Rules = { ...RULES, rarities: { ...RULES.rarities, rare: { ...RULES.rarities.rare, rank: 'B' } } };
    expect(gradeBand(asB, 'rare', 1).high).toBeCloseTo(tierSpan(RULES, 'B').tops[1], 9);
  });

  test('the minus is open below and the plus ends at the tier\'s top: Rare− holds up to 3.1, Rare 3.1 to 3.7, Rare+ 3.7 to 4.4', () => {
    const t = tierSpan(RULES, 'C').tops;
    expect(gradeBand(RULES, 'rare', -1)).toEqual({ grade: -1, low: null, high: t[-1] });
    expect(gradeBand(RULES, 'rare', 0)).toEqual({ grade: 0, low: t[-1], high: t[0] });
    expect(gradeBand(RULES, 'rare', 1)).toEqual({ grade: 1, low: t[0], high: t[1] });
  });

  test('a spend reads as the lowest grade whose top it does not pass; a spend far under the tier is its minus; past the plus\'s top no grade holds it', () => {
    const t = tierSpan(RULES, 'C').tops;
    expect(gradeOfSpend(RULES, 'rare', -6.2)).toBe(-1);
    expect(gradeOfSpend(RULES, 'rare', t[-1])).toBe(-1);
    expect(gradeOfSpend(RULES, 'rare', t[-1] + 0.01)).toBe(0);
    expect(gradeOfSpend(RULES, 'rare', t[0] + 0.01)).toBe(1);
    expect(gradeOfSpend(RULES, 'rare', t[1])).toBe(1);
    expect(gradeOfSpend(RULES, 'rare', t[1] + 0.01)).toBeNull();
  });
});

group('what an item spends, in points on the sample wearer (economy design 2.3)', () => {
  test('a point on any of the eight stats spends one point', () => {
    expect(itemSpend(gear('rare', { bonus: { str: 1, agi: 1, vit: 1, pow: 1, ins: 1, pre: 1, ctl: 1, dis: 1 } }), RULES)!.points).toBeCloseTo(8, 9);
  });

  test('max mana costs 2 points each (a Power point gives 0.5 of it at every rank): three on a rare ring spend 6.0', () => {
    for (const rar of RARITIES) expect(itemSpend(gear(rar, { bonus: { manaMax: 3 } }), RULES)!.points).toBeCloseTo(6, 1);
  });

  test('max HP costs what the Vitality that gives it would: 100 on a mythic piece spend 40 (S: 2.5 HP a point), 10 on a common one 16.7 (E: 0.6)', () => {
    expect(itemSpend(gear('mythic', { bonus: { hpMax: 100 } }), RULES)!.points).toBeCloseTo(100 / 2.5, 1);
    expect(itemSpend(gear('common', { bonus: { hpMax: 10 } }), RULES)!.points).toBeCloseTo(10 / 0.6, 1);
  });

  test('a plain weapon with its tier\'s free die spends 0: 1d8 at common, then weaponStep (1) mean damage more a tier, up to 1d18 at mythic', () => {
    const free: Readonly<Record<Rarity, string>> = { common: '1d8', uncommon: '1d10', rare: '1d12', epic: '3d4', legendary: '1d16', mythic: '1d18' };
    for (const rar of RARITIES) expect(itemSpend(weapon(rar, free[rar]), RULES)!.points, rar).toBeCloseTo(0, 9);
  });

  test('mean damage off the free die costs what the Strength that gives it would: a common 1d4 is 2 short, −4.7; a rare 1d12 + 2 is 2 over, +5.4', () => {
    expect(itemSpend(weapon('common', '1d4'), RULES)!.points).toBeCloseTo(-2 * 2.36, 1);
    expect(itemSpend(weapon('rare', '1d12 + 2'), RULES)!.points).toBeCloseTo(2 * 2.72, 1);
  });

  test('a die the rules refuse is weighed as the strike\'s own 1d8, the die the fight would roll', () => {
    expect(itemSpend(weapon('common', 'not dice'), RULES)!.points).toBeCloseTo(0, 9);
  });

  test('armor and resist at the piece the item\'s weight carries spend nothing: Hunter\'s Leather, the Reinforced Hunter Vest, the Dented Tower Shield', () => {
    for (const name of ["Hunter's Leather", 'Reinforced Hunter Vest', 'Dented Tower Shield']) expect(spendOf(name), name).toBeCloseTo(0, 9);
  });

  test('armor or resist above that piece costs what the Vitality that gives the armor would, a point of either the same', () => {
    const level = RULES.rankLevels.E, stats = split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, RULES), RULES);
    const armor = (vit: number) => sheetOf({ stats, level, gear: kitGear(SAMPLE_WEARER.kit, RULES), perks: { vit } }, RULES).armor;
    const perPoint = 1 / ((armor(10) - armor(0)) / 10);
    const leather = { slot: 'chest' as const, type: 'armor' as const, ...piece('light', 'chest', 'common', RULES) };
    expect(itemSpend(gear('common', { ...leather, armor: leather.armor + 2 }), RULES)!.points).toBeCloseTo(2 * perPoint, 9);
    expect(itemSpend(gear('common', { ...leather, resist: leather.resist + 2 }), RULES)!.points).toBeCloseTo(2 * perPoint, 9);
    expect(itemSpend(gear('common', { ...leather, armor: leather.armor - 2 }), RULES)!.points, 'armor under the piece refunds nothing').toBeCloseTo(0, 9);
  });

  test('weight is free and is what buys a kit\'s armor: a chest of the medium piece\'s weight holds its armor for nothing, the same armor with no weight spends it all', () => {
    const vest = piece('medium', 'chest', 'common', RULES);
    expect(itemSpend(gear('common', { type: 'armor', slot: 'chest', ...vest }), RULES)!.points).toBeCloseTo(0, 9);
    const weightless = itemSpend(gear('common', { type: 'armor', slot: 'chest', ...vest, weight: 0 }), RULES)!.points;
    const onePoint = itemSpend(gear('common', { type: 'armor', slot: 'chest', weight: 0, armor: 1, resist: 0 }), RULES)!.points;
    expect(weightless).toBeCloseTo((vest.armor + vest.resist) * onePoint, 9);
  });

  test('a worn status spends its worth in standard actions at the strike\'s damage, over what a Strength point gives: 2 damage on each hit dealt spends what 2 mean damage of a die would at that rank', () => {
    const sting: StatusDef = { label: 'Sting', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'physical', amount: { kind: 'number', value: 2 }, when: 'use' }] }] };
    const s = itemSpend(gear('rare', { worn: sting }), RULES)!;
    expect(s.points).toBeCloseTo(2 * 2.72, 1);
    expect(s.points).toBeCloseTo(itemSpend(weapon('rare', '1d12 + 2'), RULES)!.points, 9);
    expect(s.unweighed).toEqual([]);
  });

  test('armor ignored and a worn status\'s standing ops are named as not weighed, never counted: the Knight Killer spends −0.7 without its 5 armor ignored', () => {
    const kk = itemSpend(itemOf(RULES, def('Knight Killer')), RULES)!;
    expect(kk.points).toBeCloseTo(-1 * 2.72 + 2, 1);
    expect(kk.unweighed).toEqual(['penFlat']);
    const guarded: StatusDef = { label: 'Guarded', desc: '', ops: [{ op: 'stat', key: 'vit', amount: 2 }] };
    expect(itemSpend(gear('rare', { worn: guarded }), RULES)!.unweighed).toEqual(['worn']);
  });

  test('an item nobody wears has no budget: a consumable, a material, a key spend nothing at all, not 0', () => {
    for (const type of ['consumable', 'material', 'key', 'misc'] as const) expect(itemSpend(gear('epic', { type, slot: null, bonus: { str: 3 } }), RULES)).toBeNull();
  });
});

/** Ruling 6 (the owner, Nov 20: "Keep them."): the six built-ins past every grade of their tier, kept as they are and priced as its plus. By name, a built-in item's only key. */
const KEPT: readonly string[] = ['Mage Circlet', "Baruka's Mana Ring", "Kamish's Wrath", 'Orb of Avarice', "Monarch's Scepter", 'Armor of the Absolute Being'];
/**
 * What breaks the budget among `defs`: an item spending past its grade's top that is not one of the six of ruling 6 (or
 * is one of them but not graded plus), and one claiming a grade above its spend with no block the budget cannot weigh.
 */
function breaches(defs: readonly ItemDef[], R: Rules): string[] {
  return defs.flatMap(d => {
    const s = itemSpend(itemOf(R, d), R);
    if (!s) return [];
    const grade: Grade = d.grade ?? 0, fit = gradeOfSpend(R, d.rar, s.points), top = gradeBand(R, d.rar, grade).high;
    if (fit === null) return KEPT.includes(d.name) && grade === 1 ? [] : [`${d.name} spends ${s.points.toFixed(1)}, past its tier's top`];
    if (fit > grade) return [`${d.name} spends ${s.points.toFixed(1)}, past its grade's top ${top.toFixed(1)}`];
    if (fit < grade && !s.unweighed.length) return [`${d.name} claims a grade above its spend ${s.points.toFixed(1)} with nothing the budget cannot weigh`];
    return [];
  });
}

group('the built-in items against the budget (economy design 2.5, ruling 6)', () => {
  test('no built-in item spends past its grade\'s top, and none claims a grade above its spend without a block the budget cannot weigh', () => {
    expect(breaches(ALL, RULES)).toEqual([]);
  });

  test('the check fails a seventh item past its tier\'s top, even graded plus, and an item graded above its spend with nothing unweighed', () => {
    const seventh: ItemDef = { name: 'Seventh Ring', rar: 'rare', type: 'accessory', slot: 'ring1', bonus: { manaMax: 3 }, grade: 1, desc: 'Past its top.' };
    expect(breaches([...ALL, seventh], RULES)).toEqual(['Seventh Ring spends 6.0, past its tier\'s top']);
    const dagger = { ...def('Iron Dagger'), grade: 1 } as ItemDef;
    expect(breaches([dagger], RULES)).toEqual(['Iron Dagger claims a grade above its spend -4.7 with nothing the budget cannot weigh']);
  });

  test('the six of ruling 6 are each past their tier\'s top, graded plus, and priced as its plus: 1,875 at rare, 28,500 at legendary, 112,500 at mythic', () => {
    const price: Readonly<Partial<Record<Rarity, number>>> = { rare: 1875, legendary: 28500, mythic: 112500 };
    for (const name of KEPT) {
      const d = def(name);
      expect(gradeOfSpend(RULES, d.rar, spendOf(name)), name).toBeNull();
      expect(d.grade, name).toBe(1);
      expect(valueOf(itemOf(RULES, d), RULES), name).toBe(price[d.rar]!);
    }
  });

  test('each built-in item spends what block [2.5] says, to one decimal', () => {
    const SPEND: Readonly<Record<string, number>> = {
      'Iron Dagger': -4.7, 'Goblin Shortbow': -2.4, 'Steel Longsword': 0, 'Hunting Bow': 0, "Hunter's Leather": 0, 'Padded Cap': 0, 'Dented Tower Shield': 0, 'Worn Hunter Boots': 1,
      "Orc Warrior's Cleaver": 1, 'Reinforced Hunter Vest': 0, 'Ironhide Gauntlets': 1, 'Swift Runner Greaves': 1, 'Mana Talisman': 2,
      "Kasaka's Venom Fang": -6.2, "Ice Elf's Cloak": 1, 'Knight Killer': -0.7, 'Mage Circlet': 6, "Baruka's Mana Ring": 6,
      'Ring of Vitality': 5, 'Frost Giant Hammer': 1.5, "Knight's Aegis": 1, 'Cloak of the Shadow Hunter': 2, 'Helm of the Iron Knight': 2,
      'Armor of the Black Knight': 3, 'Boots of Shadow Step': 4, "Kamish's Wrath": 21.3, 'Orb of Avarice': 16,
      'Crown of the Shadow Sovereign': 10, "Ring of the Monarch's Will": 12, "Monarch's Scepter": 53.4, 'Armor of the Absolute Being': 45,
    };
    const worn = ALL.filter(d => d.type === 'weapon' || d.type === 'armor' || d.type === 'accessory');
    expect(worn.map(d => d.name).sort()).toEqual(Object.keys(SPEND).sort());
    for (const d of worn) expect(Number(spendOf(d.name).toFixed(1)), d.name).toBe(SPEND[d.name]!);
  });

  test('each built-in\'s grade is block [2.5]\'s: plain gear its tier\'s minus, the Worn Hunter Boots, the Mana Talisman and the Ring of the Monarch\'s Will plus, the Knight Killer plus by its armor ignored', () => {
    const PLUS = ['Worn Hunter Boots', 'Mana Talisman', 'Knight Killer', "Ring of the Monarch's Will", ...KEPT];
    for (const d of ALL.filter(d => d.type === 'weapon' || d.type === 'armor' || d.type === 'accessory')) expect(d.grade, d.name).toBe(PLUS.includes(d.name) ? 1 : -1);
    for (const d of ALL.filter(d => d.type === 'consumable' || d.type === 'material')) expect(d.grade, `${d.name}: a thing used up or sold has no grade`).toBeUndefined();
  });

  test('the shop after the budget (block [2.2]): Iron Dagger, Hunter\'s Leather and Steel Longsword 67, Knight Killer 1,875, Ring of Vitality 3,333', () => {
    const prices = ['Iron Dagger', "Hunter's Leather", 'Steel Longsword', 'Knight Killer', 'Ring of Vitality'].map(n => valueOf(itemOf(RULES, def(n)), RULES));
    expect(prices).toEqual([67, 67, 67, 1875, 3333]);
  });
});

group('the item maker\'s spend line (economy design 2.4)', () => {
  const line = (it: ItemTemplate, grade: Grade) => spendLine(itemSpend(it, RULES)!, RULES, it.rar, grade);
  const plus4 = gear('rare', { bonus: { ins: 4 } });

  test('a spend inside its grade says the points and what the grade holds: "Spends 4.0 points. Rare+ holds 3.7 to 4.4."', () => {
    expect(line(plus4, 1)).toEqual({ words: 'Spends 4.0 points. Rare+ holds 3.7 to 4.4.', over: false });
    expect(line(gear('rare', { bonus: { ins: 2 } }), -1)).toEqual({ words: 'Spends 2.0 points. Rare− holds up to 3.1.', over: false });
  });

  test('a grade under the spend warns and names the grade that holds it; it never refuses', () => {
    expect(line(plus4, 0)).toEqual({ words: 'Spends 4.0 points, more than Rare holds (3.1 to 3.7): this is Rare+ (3.7 to 4.4).', over: true });
  });

  test('a grade above the spend suggests the grade that holds it, with no warning', () => {
    expect(line(gear('rare', { bonus: { ins: 1 } }), 1)).toEqual({ words: 'Spends 1.0 points. Rare+ holds 3.7 to 4.4; this is Rare− (up to 3.1).', over: false });
  });

  test('a spend past the tier\'s top says so whatever the grade: a GM\'s item is never fitted to the budget', () => {
    expect(line(gear('rare', { bonus: { manaMax: 3 } }), 1)).toEqual({ words: 'Spends 6.0 points, past the top of Rare+ (4.4): stronger than any grade of Rare.', over: true });
  });

  test('what the budget cannot weigh is named, with the words to test it in a fight: the Knight Killer\'s armor ignored', () => {
    expect(line(itemOf(RULES, def('Knight Killer')), 1)).toEqual({
      words: 'Spends −0.7 points. Rare+ holds 3.7 to 4.4; this is Rare− (up to 3.1). Without armor ignored on a hit, which the budget cannot weigh: test it in a fight.',
      over: false,
    });
  });
});
