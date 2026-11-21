// The item budget (economy design 2.3 to 2.5, unit 3): what an item of a tier and a grade may hold, what an item spends
// of it, the built-in items against it, and the item maker's spend line. Every expected number is worked from the rule:
// the middle budget is `itemBudget.share` of the points a hunter of the rank has at its first level, over the slots; the
// spans tile on a log scale; a spend's conversions are block [2.3]'s.
import { describe as group, expect, test } from 'bun:test';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { BonusKey, Rank, Rules } from '../src/core/rules.ts';
import { kitGear, monsterSheet, pointsAt, sheetOf, split } from '../src/core/hunter/derive.ts';
import type { MonsterKind, Sheet, SheetNumber } from '../src/core/hunter/derive.ts';
import type { StatKey } from '../src/core/stats.ts';
import { KINDS } from '../src/core/registry/ability-kinds.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { referenceBody } from '../src/core/registry/worth.ts';
import type { RefBuild } from '../src/core/registry/worth.ts';
import { parseFormula } from '../src/core/formula.ts';
import type { Formula } from '../src/core/formula.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { cost, tick } from '../src/core/combat/timeline.ts';
import { tiles } from '../src/core/combat/space.ts';
import { LOOT_ITEMS, RARITIES, SAMPLE_WEARER, SHOP_ITEMS, STARTER_GEAR, itemOf, piece, valueOf } from '../src/core/registry/items.ts';
import type { Grade, ItemDef, ItemTemplate, Rarity } from '../src/core/registry/items.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { gradeBand, gradeOfSpend, itemSpend, middleBudget, powersSpend, spendLine, tierSpan } from '../src/core/registry/item-budget.ts';

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
    const leather = { slot: 'chest' as const, type: 'armor' as const, ...piece('light', 'chest', RULES) };
    expect(itemSpend(gear('common', { ...leather, armor: leather.armor + 2 }), RULES)!.points).toBeCloseTo(2 * perPoint, 9);
    expect(itemSpend(gear('common', { ...leather, resist: leather.resist + 2 }), RULES)!.points).toBeCloseTo(2 * perPoint, 9);
    expect(itemSpend(gear('common', { ...leather, armor: leather.armor - 2 }), RULES)!.points, 'armor under the piece refunds nothing').toBeCloseTo(0, 9);
  });

  test('weight is free and is what buys a kit\'s armor: a chest of the medium piece\'s weight holds its armor for nothing, the same armor with no weight spends it all', () => {
    const vest = piece('medium', 'chest', RULES);
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

  test('a worn status\'s standing ops with no rule are named as not weighed, never counted; the Knight Killer\'s 5 Lethality is weighed: −0.7 for its die and Strength, and 5 at its rate', () => {
    const kk = itemSpend(itemOf(RULES, def('Knight Killer')), RULES)!;
    expect(kk.points).toBeCloseTo(-1 * 2.72 + 2 + 5 * penRate('armorPenFlat', 'C'), 1);
    expect(kk.unweighed).toEqual([]);
    const hasted: StatusDef = { label: 'Hasted', desc: '', ops: [{ op: 'speed', pct: 10 }] };
    expect(itemSpend(gear('rare', { worn: hasted }), RULES)).toEqual({ points: 0, unweighed: ['worn'] });
  });

  test('an item nobody wears has no budget: a consumable, a material, a key spend nothing at all, not 0', () => {
    for (const type of ['consumable', 'material', 'key', 'misc'] as const) expect(itemSpend(gear('epic', { type, slot: null, bonus: { str: 3 } }), RULES)).toBeNull();
  });
});

// ── each bonus key's cost (balance plan sections 9 and 10), worked from the rule ──
/** The sample wearer at the first level of `rank`, in its kit, with `perks` on it (block [2.3]). */
const wearer = (rank: Rank, perks: Partial<Record<StatKey | SheetNumber, number>> = {}): Sheet => {
  const level = RULES.rankLevels[rank];
  return sheetOf({ stats: split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, RULES), RULES), level, gear: kitGear(SAMPLE_WEARER.kit, RULES), perks }, RULES);
};
/** The rarity whose tier is `rank`'s. */
const rarityOf = (rank: Rank): Rarity => RARITIES.find(r => RULES.rarities[r].rank === rank)!;
/** What one point of `key` on a ring of `rank`'s tier spends. */
const onePoint = (key: BonusKey, rank: Rank): number => itemSpend(gear(rarityOf(rank), { bonus: { [key]: 1 } }), RULES)!.points;
/**
 * Section 10: a key a stat feeds costs the points of that stat that make the same change on the sample wearer. A point
 * of the key adds 1 to its number, a hundredth for a share or a multiplier (critSize, threat, hold, costCut); a point of
 * the stat adds what ten of them add, over ten. The stat of each is the one its formula in derive reads (design 2.2);
 * tenacity reads Strength and Discipline as one score, so its points go half to each.
 */
const FED: readonly (readonly [Exclude<BonusKey, StatKey | 'armorPen' | 'resistPen' | 'armorPenFlat' | 'resistPenFlat' | 'drain' | 'haste'>, Partial<Record<StatKey, number>>, number])[] = [
  ['hpMax', { vit: 10 }, 1], ['manaMax', { pow: 10 }, 1], ['fatigueMax', { vit: 10 }, 1], ['carry', { str: 10 }, 1], ['speed', { agi: 10 }, 1],
  ['move', { agi: 10 }, 1], ['react', { ins: 10 }, 1],
  ['aim', { ctl: 10 }, 1], ['will', { dis: 10 }, 1], ['critFaces', { ins: 10 }, 1], ['critSize', { ctl: 10 }, 0.01], ['opening', { ins: 10 }, 1],
  ['tenacity', { str: 5, dis: 5 }, 1], ['potency', { ctl: 10 }, 1], ['threat', { pre: 10 }, 0.01], ['hold', { dis: 10 }, 0.01], ['costCut', { ctl: 10 }, 0.01],
];
const fedRate = (key: (typeof FED)[number][0], stats: Partial<Record<StatKey, number>>, unit: number, rank: Rank): number =>
  unit / ((wearer(rank, stats)[key] - wearer(rank)[key]) / 10);
/**
 * Section 9: a penetration costs the points of the power stat (Strength for the armor pair, Power for the resist pair)
 * that add as much damage to the tier's standard action (the strike: 1d8's 4.5 plus its power times the bruiser's
 * physical power) on a same-rank elite (`itemBudget.penFoe`: a brute's armor, a caster's resist) as a point of the key,
 * read over ten points of the key, before rule 12 rounds. Rule 12: left = max(0, def * (1 - pct / 100) - flat), dealt =
 * max(0, raw - armorFlat * left) * armorK / (armorK + left).
 */
function penRate(key: 'armorPen' | 'resistPen' | 'armorPenFlat' | 'resistPenFlat', rank: Rank, kind: MonsterKind = 'elite'): number {
  const F = RULES.fight, armorPair = key === 'armorPen' || key === 'armorPenFlat';
  const foe = monsterSheet(rank, armorPair ? 'brute' : 'caster', kind, RULES), def = armorPair ? foe.armor : foe.resist;
  const hit = 4.5 + KINDS.strike.power * referenceBody('bruiser', rank, RULES).sheet.phys;
  const dealt = (raw: number, pct: number, flat: number): number => { const left = Math.max(0, def * (1 - pct / 100) - flat); return Math.max(0, raw - F.armorFlat * left) * F.armorK / (F.armorK + left); };
  const own = armorPair ? wearer(rank).armorPen : wearer(rank).resistPen;
  const percent = key === 'armorPen' || key === 'resistPen';
  const perKey = (dealt(hit, own + (percent ? 10 : 0), percent ? 0 : 10) - dealt(hit, own, 0)) / 10;
  const power = armorPair ? (wearer(rank, { str: 10 }).phys - wearer(rank).phys) / 10 : (wearer(rank, { pow: 10 }).mag - wearer(rank).mag) / 10;
  return perKey / (dealt(hit + power, own, 0) - dealt(hit, own, 0));
}

/**
 * Section 10: a key no stat feeds costs its worth a round in standard actions times the tier's strike over a Strength
 * point's physical power, the rate a worn status pays. A percent of lifesteal heals a hundredth of the HP one strike a
 * round takes from a same-rank normal brute (rule 12 with the wearer's own armor percent), each HP worth 1 / (1.5 *
 * sup) of a standard action by a same-rank support (an HP's worth, worth.ts). A point of ability haste is League of
 * Legends' formula, cooldown = base * 100 / (100 + haste): on an ability that comes back every
 * `itemBudget.cooldownRounds` rounds it adds the uses a round one more point gives, the same at any haste, each use a
 * whole standard action.
 */
function unfedRate(key: 'drain' | 'haste', rank: Rank): number {
  const F = RULES.fight, hit = 4.5 + KINDS.strike.power * referenceBody('bruiser', rank, RULES).sheet.phys;
  const power = (wearer(rank, { str: 10 }).phys - wearer(rank).phys) / 10;
  if (key === 'haste') return (usesARound(1) - usesARound(0)) * hit / power;
  const left = monsterSheet(rank, 'brute', 'normal', RULES).armor * (1 - wearer(rank).armorPen / 100);
  const taken = Math.max(0, hit - F.armorFlat * left) * F.armorK / (F.armorK + left);
  const hpWorth = 1 / (1.5 * referenceBody('support', rank, RULES).sheet.sup);
  return 0.01 * taken * hpWorth * hit / power;
}

/** The uses a round of an ability that comes back every `itemBudget.cooldownRounds` rounds, at `haste`, by League of Legends' formula. */
const usesARound = (haste: number): number => 1 / (RULES.itemBudget.cooldownRounds * 100 / (100 + haste));

group('each bonus key\'s cost (balance plan sections 9 and 10)', () => {
  test('a percent of lifesteal or a point of ability haste costs its worth a round at the rate a worn status pays, at every rank', () => {
    for (const rank of RANKS) for (const key of ['drain', 'haste'] as const) expect(onePoint(key, rank), `${key} at ${rank}`).toBeCloseTo(unfedRate(key, rank), 9);
  });

  test('at C a percent of lifesteal spends 0.45 and a point of ability haste 0.28: a middle rare ring (3.45) holds about 8% of the one or 12 haste', () => {
    expect([Number(onePoint('drain', 'C').toFixed(2)), Number(onePoint('haste', 'C').toFixed(2))]).toEqual([0.45, 0.28]);
  });

  test('ability haste costs the same a point however much there is: each point gives the same uses more, so 20 haste spend 20 times one', () => {
    expect(usesARound(101) - usesARound(100)).toBeCloseTo(usesARound(1) - usesARound(0), 12);
    expect(itemSpend(gear('rare', { bonus: { haste: 20 } }), RULES)!.points).toBeCloseTo(20 * onePoint('haste', 'C'), 9);
  });

  test('a cooldown weighed as longer makes a point of ability haste cheaper: 6 rounds halve what 3 cost', () => {
    const slower: Rules = { ...RULES, itemBudget: { ...RULES.itemBudget, cooldownRounds: 6 } };
    expect(itemSpend(gear('rare', { bonus: { haste: 1 } }), slower)!.points).toBeCloseTo(onePoint('haste', 'C') / 2, 9);
  });

  test('a point on a key a stat feeds costs the points of that stat that make the same change, at every rank', () => {
    for (const rank of RANKS) for (const [key, stats, unit] of FED) expect(onePoint(key, rank), `${key} at ${rank}`).toBeCloseTo(fedRate(key, stats, unit, rank), 9);
  });

  test('a point of penetration costs the power points that add its damage on a same-rank elite, at every rank', () => {
    for (const rank of RANKS) for (const key of ['armorPen', 'resistPen', 'armorPenFlat', 'resistPenFlat'] as const) expect(onePoint(key, rank), `${key} at ${rank}`).toBeCloseTo(penRate(key, rank), 9);
  });

  test('at C a point of Lethality spends 0.66, of Unravel 0.69, a percent of armor penetration 0.31 and of magic penetration 0.12', () => {
    expect(['armorPenFlat', 'resistPenFlat', 'armorPen', 'resistPen'].map(k => Number(onePoint(k as BonusKey, 'C').toFixed(2)))).toEqual([0.66, 0.69, 0.31, 0.12]);
  });

  test('a percent of penetration is worth more the thicker the defence: the armor percent costs more at each rank up, where the brute\'s armor grows', () => {
    const costs = RANKS.map(r => onePoint('armorPen', r));
    expect(costs.every((c, i) => i === 0 || c > costs[i - 1]!)).toBe(true);
  });

  test('the penetrations are weighed against the foe `itemBudget.penFoe` names: named a boss, whose kind thickens its armor past an elite\'s, a point costs what it adds on the boss', () => {
    const asBoss: Rules = { ...RULES, itemBudget: { ...RULES.itemBudget, penFoe: 'boss' } };
    const onBoss = itemSpend(gear('rare', { bonus: { armorPenFlat: 1 } }), asBoss)!.points;
    expect(onBoss).toBeCloseTo(penRate('armorPenFlat', 'C', 'boss'), 9);
    expect(Math.abs(onBoss - onePoint('armorPenFlat', 'C'))).toBeGreaterThan(0.01);
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
      "Kasaka's Venom Fang": -6.2, "Ice Elf's Cloak": 1, 'Knight Killer': 2.6, 'Mage Circlet': 6, "Baruka's Mana Ring": 6,
      'Ring of Vitality': 5, 'Frost Giant Hammer': 1.5, "Knight's Aegis": 1, 'Cloak of the Shadow Hunter': 2, 'Helm of the Iron Knight': 2,
      'Armor of the Black Knight': 3, 'Boots of Shadow Step': 4, "Kamish's Wrath": 21.3, 'Orb of Avarice': 16,
      'Crown of the Shadow Sovereign': 10, "Ring of the Monarch's Will": 12, "Monarch's Scepter": 53.4, 'Armor of the Absolute Being': 45,
    };
    const worn = ALL.filter(d => d.type === 'weapon' || d.type === 'armor' || d.type === 'accessory');
    expect(worn.map(d => d.name).sort()).toEqual(Object.keys(SPEND).sort());
    for (const d of worn) expect(Number(spendOf(d.name).toFixed(1)), d.name).toBe(SPEND[d.name]!);
  });

  test('each built-in\'s grade is block [2.5]\'s: plain gear its tier\'s minus (the Knight Killer too, now its Lethality is weighed), the Worn Hunter Boots, the Mana Talisman and the Ring of the Monarch\'s Will plus', () => {
    const PLUS = ['Worn Hunter Boots', 'Mana Talisman', "Ring of the Monarch's Will", ...KEPT];
    for (const d of ALL.filter(d => d.type === 'weapon' || d.type === 'armor' || d.type === 'accessory')) expect(d.grade, d.name).toBe(PLUS.includes(d.name) ? 1 : -1);
    for (const d of ALL.filter(d => d.type === 'consumable' || d.type === 'material')) expect(d.grade, `${d.name}: a thing used up or sold has no grade`).toBeUndefined();
  });

  test('the shop after the budget (block [2.2]): Iron Dagger, Hunter\'s Leather and Steel Longsword 67, Knight Killer 833 (Rare−), Ring of Vitality 3,333', () => {
    const prices = ['Iron Dagger', "Hunter's Leather", 'Steel Longsword', 'Knight Killer', 'Ring of Vitality'].map(n => valueOf(itemOf(RULES, def(n)), RULES));
    expect(prices).toEqual([67, 67, 67, 833, 3333]);
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

  test('what the budget cannot weigh is named, with the words to test it in a fight: a worn status\'s standing op with no rule', () => {
    const hasted: StatusDef = { label: 'Hasted', desc: '', ops: [{ op: 'speed', pct: 10 }] };
    expect(line(gear('rare', { bonus: { ins: 4 }, worn: hasted }), 1)).toEqual({
      words: 'Spends 4.0 points. Rare+ holds 3.7 to 4.4. Without what its worn status does that its worth line cannot weigh, which the budget cannot weigh: test it in a fight.',
      over: false,
    });
  });
});

// ── what a held thing's powers spend (item-stats 6.5), worked from the rules ──
/** A formula the rules read. */
const f = (text: string): Formula => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
/**
 * The rate any worn worth pays (economy design 2.3): a standard action a round costs the tier's strike (1d8's 4.5 plus its
 * power times the bruiser's physical power) over what a Strength point adds to the sample wearer's physical power.
 */
const perAction = (rank: Rank): number =>
  (4.5 + KINDS.strike.power * referenceBody('bruiser', rank, RULES).sheet.phys) / ((wearer(rank, { str: 10 }).phys - wearer(rank).phys) / 10);
const C = (b: RefBuild) => referenceBody(b, 'C', RULES);
const BUILDS: readonly RefBuild[] = ['speed', 'tank', 'cannon', 'bruiser', 'support'];
/** An active a ring's wearer uses on themselves: a support of `time` and `cooldown` rounds whose shield is `text`. */
const shieldActive = (text: string, o: { readonly rounds?: number; readonly time?: number } = {}): Ability => abilityOf('support', {
  id: abilityId('bulwark'), name: 'Bulwark', aim: 'self', shape: { kind: 'self' }, range: tiles(0), delivery: { kind: 'sure' },
  effect: { type: 'shield', by: 'hand', formula: f(text) },
  cost: { fatigue: 0, mana: 0, time: cost(o.time ?? RULES.fight.cost.standard), cooldown: tick((o.rounds ?? 3) * RULES.fight.round) },
}, RULES);

group('what a held thing\'s powers spend (item-stats 6.5)', () => {
  test('an active spends its worth a use times its uses a round, at the rate a worn worth pays: a Bulwark shield of 10 + 20% of max HP every 3 rounds on a rare ring', () => {
    // its worth a use: the shield on the build with the most max HP, over the support's standard shield, 1.5 * sup (sure: whole)
    const most = Math.max(...BUILDS.map(b => C(b).sheet.hpMax)), worth = (10 + 0.2 * most) / (1.5 * C('support').sheet.sup);
    // its uses a round: its standard time lets the support use it speed / speedBase times a round, its cooldown a third: the fewer
    const uses = Math.min(C('support').sheet.speed / RULES.fight.speedBase, 1 / 3);
    expect(uses).toBe(1 / 3);
    const s = itemSpend(gear('rare', { active: shieldActive('10 + 0.2 * hpmax') }), RULES)!;
    expect(s.points).toBeCloseTo(worth * uses * perAction('C'), 9);
    expect(s.unweighed).toEqual([]);
  });

  test('a GM who raises the Bulwark\'s 20% of max HP to 40% doubles what its scaling part spends', () => {
    const at = (text: string) => itemSpend(gear('rare', { active: shieldActive(text) }), RULES)!.points;
    expect(at('0.4 * hpmax')).toBeCloseTo(2 * at('0.2 * hpmax'), 9);
    expect(at('0.4 * hpmax')).toBeGreaterThan(at('0.2 * hpmax'));
  });

  test('an active with no cooldown is used as often as its time lets the support; a once-a-fight gate holds it to one use in the reference fight', () => {
    const support = C('support').sheet, flat = shieldActive('30', { rounds: 0 }), worth = 30 / (1.5 * support.sup);
    expect(itemSpend(gear('rare', { active: flat }), RULES)!.points).toBeCloseTo(worth * support.speed / RULES.fight.speedBase * perAction('C'), 9);
    for (const per of ['fight', 'rest'] as const) {
      const once = { ...shieldActive('30', { rounds: 2 }), gates: [{ kind: 'uses' as const, per, n: 1 }] };
      expect(itemSpend(gear('rare', { active: once }), RULES)!.points, per).toBeCloseTo(worth / RULES.fight.kit.referenceRounds * perAction('C'), 9);
    }
  });

  test('a quick active with nothing else holding it is used standard over quick times as often as a standard one, so it spends that many times as much', () => {
    const quick = shieldActive('30', { rounds: 0, time: RULES.fight.cost.quick }), standard = shieldActive('30', { rounds: 0 });
    const spend = (a: Ability) => itemSpend(gear('rare', { active: a }), RULES)!.points;
    expect(spend(quick)).toBeCloseTo(spend(standard) * RULES.fight.cost.standard / RULES.fight.cost.quick, 9);
  });

  test('a worn `sheet` op of 4 armor spends what 4 armor above the item\'s piece does: the Vitality whose armor it is', () => {
    const perPoint = 1 / ((wearer('C', { vit: 10 }).armor - wearer('C').armor) / 10);
    const plated: StatusDef = { label: 'Plated', desc: '', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 4 } }] };
    expect(itemSpend(gear('rare', { worn: plated }), RULES)!.points).toBeCloseTo(4 * perPoint, 9);
    expect(itemSpend(gear('rare', { worn: plated }), RULES)!.unweighed).toEqual([]);
    expect(itemSpend(gear('rare', { worn: plated }), RULES)!.points).toBeCloseTo(itemSpend(gear('rare', { armor: 4 }), RULES)!.points, 9);
  });

  test('a worn `stat` op spends as a bonus of its size, and a `sheet` op on a share as that many hundredths of its bonus: 2 Discipline spend 2, crit size 0.1 ten points', () => {
    const steady: StatusDef = { label: 'Steady', desc: '', ops: [{ op: 'stat', key: 'dis', amount: { kind: 'number', value: 2 } }] };
    expect(itemSpend(gear('rare', { worn: steady }), RULES)).toEqual({ points: 2, unweighed: [] });
    const keen: StatusDef = { label: 'Keen', desc: '', ops: [{ op: 'sheet', key: 'critSize', amount: { kind: 'number', value: 0.1 } }] };
    expect(itemSpend(gear('rare', { worn: keen }), RULES)!.points).toBeCloseTo(10 * onePoint('critSize', 'C'), 9);
  });

  test('a `sheet` op with no rule (range) is named as not weighed, and the rest of the status is still weighed', () => {
    const odd: StatusDef = { label: 'Odd', desc: '', ops: [{ op: 'stat', key: 'dis', amount: { kind: 'number', value: 2 } }, { op: 'sheet', key: 'range', amount: 1 }] };
    expect(itemSpend(gear('rare', { worn: odd }), RULES)).toEqual({ points: 2, unweighed: ['worn'] });
  });

  test('a title\'s powers are weighed the same way at a rank: powersSpend at C is what a rare ring\'s active spends', () => {
    const p = { active: shieldActive('10 + 0.2 * hpmax') };
    expect(powersSpend(p, 'C', RULES)).toEqual(itemSpend(gear('rare', p), RULES)!);
  });

  test('the spend line names an active it cannot weigh, with the words to test it in a fight', () => {
    const taunting = abilityOf('support', { id: abilityId('roar'), name: 'Roar', effect: null, ops: [{ op: 'threat', amount: 5 }] }, RULES);
    const s = itemSpend(gear('rare', { active: taunting }), RULES)!;
    expect(s.unweighed).toEqual(['active']);
    expect(spendLine(s, RULES, 'rare', -1)).toEqual({
      words: 'Spends 0.0 points. Rare− holds up to 3.1. Without what its active does that its worth line cannot weigh, which the budget cannot weigh: test it in a fight.',
      over: false,
    });
  });
});
