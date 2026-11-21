import { describe, expect, test } from 'bun:test';
import { kitGear, monsterSheet, SHEET_LABELS, sheetOf } from '../src/core/hunter/derive.ts';
import { KIT_SHARE, piece } from '../src/core/registry/items.ts';
import type { Archetype, SheetBasis, GearPiece, MonsterKind, Sheet, SheetNumber } from '../src/core/hunter/derive.ts';
import { RANKS, RULES } from '../src/core/rules.ts';
import { explain, hunterSheet, SOURCES } from '../src/core/hunter/sheet.ts';
import type { SheetCondition, SheetHunter, SheetItem, SheetPath, SheetRules, SheetSource } from '../src/core/hunter/sheet.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import type { StatKey, Stats } from '../src/core/stats.ts';
import type { TimelineRules } from '../src/core/combat/timeline.ts';
import type { SpaceRules } from '../src/core/combat/space.ts';

// Every expected number below is typed in from the tables `bun scripts/rw-paper.ts` prints for design section 2 (2.1,
// 2.3.E, 2.3.C, 2.3.S, 2.4, 2.5 and 2.6), or from a bound the design states in words.

type Shown = 'E' | 'C' | 'S';
type BuildId = 'speed' | 'tank' | 'cannon' | 'bruiser' | 'support';
const LEVEL: Record<Shown, number> = { E: 1, C: 20, S: 70 };
// Table 2.5.
const LIGHT: GearPiece = { weight: 8, armor: 10, resist: 15 };
const MEDIUM: GearPiece = { weight: 18, armor: 30, resist: 5 };
const HEAVY: GearPiece = { weight: 32, armor: 60, resist: 20 };

const stats = (o: Partial<Stats> = {}): Stats => ({ str: 10, agi: 10, vit: 10, ins: 10, dis: 10, pre: 10, pow: 10, ctl: 10, ...o });
// Table 2.1: creation 12 and 3 a level split 2:1, every perk on the main stat.
const MAIN: Record<Shown, [number, number]> = { E: [20, 14], C: [63, 33], S: [174, 83] };
const SHAPE: Record<BuildId, [StatKey, StatKey, GearPiece]> = {
  speed: ['agi', 'str', LIGHT], tank: ['vit', 'str', HEAVY], cannon: ['pow', 'ctl', LIGHT], bruiser: ['str', 'vit', MEDIUM], support: ['pre', 'dis', LIGHT],
};
const build = (id: BuildId, rank: Shown): SheetBasis => {
  const [main, second, kit] = SHAPE[id], [m, s] = MAIN[rank];
  return { stats: stats({ [main]: m, [second]: s }), level: LEVEL[rank], gear: [kit], perks: {} };
};
const BUILDS = Object.keys(SHAPE) as BuildId[];
const SHOWN = ['E', 'C', 'S'] as const;

// The tables print two decimals, so a number matches when it is within half a hundredth.
const near = (actual: number, printed: number): boolean => Math.abs(actual - printed) <= 0.005 + 1e-9;
const KEYS = Object.keys(SHEET_LABELS) as SheetNumber[];

// Tables 2.3.E, 2.3.C and 2.3.S: one column per build, the rows in the order of SHEET_LABELS. The tables print one
// penetration, a share; the sheet holds it as two percents (armor and magic, both from Control: the share times 100,
// 40 * x(ctl) / (x(ctl) + 40)) and two flat numbers (Lethality and Unravel, from bonuses only, 0 on a plain build;
// balance plan section 9). Lifesteal and ability haste, after the cost cut, are no table's either: bonuses alone give
// them, 0 on a plain build (balance plan section 10). The last, the sight level, is no table's: every body sees at the rules' `fight.stealth.sightBase`, 0, until a status raises it (notes-7-stealth.md).
const TABLE_2_3: Record<Shown, Record<BuildId, readonly number[]>> = {
  E: {
    speed: [45, 10, 100, 24, 8, 114, 6.84, 4, 10, 15, 0, 0, 0, 0, 7.85, 6, 6, 17.41, 10, 10, 1, 1.50, 0, 2.09, 0, 1, 0.15, 0, 0, 0, 2, 0],
    tank: [51, 10, 108, 24, 32, 65, 3.90, 2, 65, 20, 0, 0, 0, 0, 7.85, 6, 6, 10, 10, 10, 1, 1.50, 0, 2.09, 0, 1, 0.15, 0, 0, 0, 2, 0],
    cannon: [45, 15, 100, 20, 8, 100, 6, 3, 10, 15, 2.87, 2.87, 0, 0, 6, 10.45, 6, 10, 13.09, 10, 1, 1.54, 0, 0, 3.58, 1, 0.15, 0.02, 0, 0, 2, 0],
    bruiser: [48, 10, 104, 28, 18, 90, 5.40, 3, 32, 5, 0, 0, 0, 0, 10.45, 6, 6, 10, 10, 10, 1, 1.50, 0, 4.44, 0, 1, 0.15, 0, 0, 0, 2, 0],
    support: [45, 10, 100, 20, 8, 100, 6, 3, 10, 18, 0, 0, 0, 0, 6, 6, 10.45, 10, 10, 13.09, 1, 1.50, 0, 2.09, 0, 1.16, 0.17, 0, 0, 0, 3, 0],
  },
  C: {
    speed: [81, 10, 100, 34, 8, 141, 8.46, 5, 10, 15, 0, 0, 0, 0, 15.59, 6, 6, 43.60, 10, 10, 1, 1.50, 0, 7.96, 0, 1, 0.15, 0, 0, 0, 2, 0],
    tank: [114, 10, 123, 34, 32, 70, 4.20, 3, 74, 20, 0, 0, 0, 0, 15.59, 6, 6, 10, 10, 10, 1, 1.50, 0, 7.96, 0, 1, 0.15, 0, 0, 0, 2, 0],
    cannon: [81, 24, 100, 20, 8, 100, 6, 3, 10, 15, 11.42, 11.42, 0, 0, 6, 26.16, 6, 10, 25.99, 10, 1, 1.64, 0, 0, 14.28, 1, 0.15, 0.07, 0, 0, 2, 0],
    bruiser: [101, 10, 114, 43, 18, 100, 6, 3, 39, 5, 0, 0, 0, 0, 26.16, 6, 6, 10, 10, 10, 1, 1.50, 0, 12.83, 0, 1, 0.15, 0, 0, 0, 2, 0],
    support: [81, 10, 100, 20, 8, 100, 6, 3, 10, 26, 0, 0, 0, 0, 6, 6, 26.16, 10, 10, 25.99, 1, 1.50, 0, 7.96, 0, 1.46, 0.22, 0, 0, 0, 8, 0],
  },
  S: {
    speed: [174, 10, 100, 46, 8, 162, 9.72, 5, 10, 15, 0, 0, 0, 0, 32.61, 6, 6, 98.27, 10, 10, 1, 1.50, 0, 14.98, 0, 1, 0.15, 0, 0, 0, 2, 0],
    tank: [282, 10, 134, 46, 32, 70, 4.2, 3, 81, 20, 0, 0, 0, 0, 32.61, 6, 6, 10, 10, 10, 1, 1.50, 0, 14.98, 0, 1, 0.15, 0, 0, 0, 2, 0],
    cannon: [174, 31, 100, 20, 8, 100, 6, 3, 10, 15, 21.03, 21.03, 0, 0, 6, 58.96, 6, 10, 54.36, 10, 1, 1.76, 0, 0, 26.29, 1, 0.15, 0.13, 0, 0, 2, 0],
    bruiser: [257, 10, 126, 54, 18, 100, 6, 3, 46, 5, 0, 0, 0, 0, 58.96, 6, 6, 10, 10, 10, 1, 1.50, 0, 20.88, 0, 1, 0.15, 0, 0, 0, 2, 0],
    support: [174, 10, 100, 20, 8, 100, 6, 3, 10, 36, 0, 0, 0, 0, 6, 6, 58.96, 10, 10, 54.36, 1, 1.50, 0, 14.98, 0, 1.69, 0.28, 0, 0, 0, 19, 0],
  },
};
// Table 2.6 with the body of balance plan section 1: a monster wears its archetype's kit (`kitGear`; a rarer piece holds
// no more armor or resist, so the kit is the same at every rank), and its armor and resist (the kit's and its stat's
// share, Vitality's 2, 9 and 16 for a brute at E, C and S, none for the others) are times its kind's factor, 1, 1.25 and
// 1.5. Max HP is its kind's factor on the body (normal 0.6, elite 1.5, boss 2.8): a boss is 2.8 / 3.2 of the paper's
// (the C brute boss 324 to 284); power is as the paper prints it.
const TABLE_2_6: readonly (readonly [Shown, Archetype, MonsterKind, number, number, number, number, number])[] = [
  ['E', 'brute', 'normal', 29, 87, 32, 5, 6.72],
  ['E', 'brute', 'elite', 72, 87, 40, 6, 9.60],
  ['E', 'brute', 'boss', 134, 87, 48, 8, 11.52],
  ['E', 'skirmisher', 'normal', 27, 112, 10, 15, 5.50],
  ['E', 'skirmisher', 'elite', 68, 112, 13, 19, 7.85],
  ['E', 'skirmisher', 'boss', 126, 112, 15, 23, 9.42],
  ['E', 'caster', 'normal', 27, 100, 10, 15, 6.72],
  ['E', 'caster', 'elite', 68, 100, 13, 19, 9.60],
  ['E', 'caster', 'boss', 126, 100, 15, 23, 11.52],
  ['C', 'brute', 'normal', 61, 100, 39, 5, 16.66],
  ['C', 'brute', 'elite', 152, 100, 48, 6, 23.81],
  ['C', 'brute', 'boss', 284, 100, 58, 8, 28.57],
  ['C', 'skirmisher', 'normal', 48, 138, 10, 15, 10.92],
  ['C', 'skirmisher', 'elite', 121, 138, 13, 19, 15.59],
  ['C', 'skirmisher', 'boss', 226, 138, 15, 23, 18.71],
  ['C', 'caster', 'normal', 48, 100, 10, 15, 16.66],
  ['C', 'caster', 'elite', 121, 100, 13, 19, 23.81],
  ['C', 'caster', 'boss', 226, 100, 15, 23, 28.57],
  ['S', 'brute', 'normal', 154, 100, 46, 5, 37.82],
  ['S', 'brute', 'elite', 385, 100, 57, 6, 54.03],
  ['S', 'brute', 'boss', 719, 100, 69, 8, 64.84],
  ['S', 'skirmisher', 'normal', 105, 160, 10, 15, 22.83],
  ['S', 'skirmisher', 'elite', 262, 160, 13, 19, 32.61],
  ['S', 'skirmisher', 'boss', 488, 160, 15, 23, 39.14],
  ['S', 'caster', 'normal', 105, 100, 10, 15, 37.82],
  ['S', 'caster', 'elite', 262, 100, 13, 19, 54.03],
  ['S', 'caster', 'boss', 488, 100, 15, 23, 64.84],
];

describe('the five builds (tables 2.3.E, 2.3.C and 2.3.S)', () => {
  for (const rank of SHOWN) for (const id of BUILDS) {
    test(`the ${id} build at ${rank} has every number its table prints`, () => {
      const sheet = sheetOf(build(id, rank), RULES);
      const wrong = KEYS.map((k, i) => [k, sheet[k], TABLE_2_3[rank][id][i]!] as const).filter(([, a, p]) => !near(a, p));
      expect(wrong).toEqual([]);
    });
  }

  test('the sheet has the 27 numbers the tables print, the penetration as four, in their order, lifesteal and ability haste, and the sight level after them', () => {
    expect(KEYS).toHaveLength(32);
    expect(KEYS.at(-1)).toBe('sight');
    expect(Object.keys(sheetOf(build('tank', 'C'), RULES))).toEqual(KEYS);
  });

  test('the speed build at C acts 1.41 times as often as the bruiser, with 60% of its physical power (design 2.2)', () => {
    const speed = sheetOf(build('speed', 'C'), RULES), bruiser = sheetOf(build('bruiser', 'C'), RULES);
    expect(speed.speed / bruiser.speed).toBeCloseTo(1.41, 2);
    expect(speed.phys / bruiser.phys).toBeCloseTo(0.6, 2);
  });

  test('Reaction counts the effective points of Instinct and of Agility above the base once each (design 2.2)', () => {
    // eff(20) = 10 * 2 ^ 0.8 = 17.41, so each stat at 20 adds 7.41 to the base 10.
    const react = (o: Partial<Stats>): number => sheetOf({ stats: stats(o), level: 1, gear: [LIGHT], perks: {} }, RULES).react;
    expect([react({}), react({ ins: 20 }), react({ agi: 20 }), react({ ins: 20, agi: 20 })].map(n => Math.round(n * 100) / 100)).toEqual([10, 17.41, 17.41, 24.82]);
  });
});

describe('monsters (table 2.6)', () => {
  for (const [rank, archetype, kind, hpMax, speed, armor, resist, power] of TABLE_2_6) {
    test(`a ${rank} ${archetype} (${kind}) has ${hpMax} HP, speed ${speed}, armor ${armor}, resist ${resist} and main power ${power}`, () => {
      const m = monsterSheet(rank, archetype, kind, RULES);
      expect([m.hpMax, m.speed, m.armor, m.resist]).toEqual([hpMax, speed, armor, resist]);
      expect(near(Math.max(m.phys, m.mag), power)).toBe(true);
    });
  }

  test('a kind scales max HP, power, armor and resist and nothing else', () => {
    const normal = monsterSheet('C', 'caster', 'normal', RULES), boss = monsterSheet('C', 'caster', 'boss', RULES);
    const scaled: SheetNumber[] = ['hpMax', 'phys', 'mag', 'sup', 'armor', 'resist'];
    expect(KEYS.filter(k => !scaled.includes(k) && boss[k] !== normal[k])).toEqual([]);
    expect(boss.mag / normal.mag).toBeCloseTo(1.2 / 0.7, 10);
  });

  test('a boss is tougher by its kind\'s armor and resist (the owner, Nov 21): the C brute boss holds 1.5 times the normal\'s, rounded', () => {
    // A C brute's body before its kind: the medium kit (armor 30, resist 5) and Vitality 33's share of armor.
    const bare = sheetOf({ stats: stats({ str: 56, vit: 33 }), level: 20, gear: [], perks: {} }, RULES);
    const set = { armor: 30, resist: 5 }, F = RULES.fight.kinds;
    for (const kind of ['normal', 'elite', 'boss'] as const) {
      const m = monsterSheet('C', 'brute', kind, RULES);
      expect(Math.abs(m.armor - F[kind].armor * (set.armor + bare.armor)), kind).toBeLessThanOrEqual(1);
      expect(m.resist, kind).toBe(Math.round(F[kind].resist * set.resist));
    }
    expect([F.normal.armor, F.elite.armor, F.boss.armor, F.normal.resist, F.elite.resist, F.boss.resist]).toEqual([1, 1.25, 1.5, 1, 1.25, 1.5]);
  });

  test('a seed\'s HP factor multiplies max HP on top of its kind\'s and changes nothing else: half of the C brute boss\'s 284 is 142 (2.4)', () => {
    const plain = monsterSheet('C', 'brute', 'boss', RULES), half = monsterSheet('C', 'brute', 'boss', RULES, [], { hp: 0.5, dealt: 1, stats: {}, traits: [] });
    expect(half.hpMax).toBe(142);
    expect(KEYS.filter(k => k !== 'hpMax' && half[k] !== plain[k])).toEqual([]);
  });

  test('a seed\'s stat tweak adds points before the curve, as a hunter\'s spent points do (2.4)', () => {
    // A C brute has 12 + 3 * 19 = 69 points split 2:1: Strength 10 + 46 = 56 and Vitality 10 + 23 = 33, in the medium kit.
    const keen = monsterSheet('C', 'brute', 'normal', RULES, [], { hp: 1, dealt: 1, stats: { ins: 8 }, traits: [] });
    const same = sheetOf({ stats: stats({ str: 56, vit: 33, ins: 18 }), level: 20, gear: kitGear('medium', RULES), perks: {} }, RULES);
    const unscaled: SheetNumber[] = ['speed', 'armor', 'resist', 'react', 'opening', 'critFaces'];
    expect(unscaled.map(k => keen[k])).toEqual(unscaled.map(k => same[k]));
    expect(keen.opening).toBeGreaterThan(monsterSheet('C', 'brute', 'normal', RULES).opening);
  });
});

describe('a kit\'s six pieces (design 2.3)', () => {
  const sum = (gear: readonly GearPiece[]): GearPiece => gear.reduce((t, g) => ({ weight: t.weight + g.weight, armor: t.armor + g.armor, resist: t.resist + g.resist }), { weight: 0, armor: 0, resist: 0 });
  const SLOTS = Object.keys(KIT_SHARE) as (keyof typeof KIT_SHARE)[];
  test('the six pieces of each kit add up to the kit exactly, and none is off its share by a whole point or more', () => {
    for (const kit of ['light', 'medium', 'heavy'] as const) {
      const k = RULES.fight.kits[kit];
      expect(sum(SLOTS.map(slot => piece(kit, slot, RULES))), kit).toEqual({ weight: k.weight, armor: k.armor, resist: k.resist });
      for (const slot of SLOTS) for (const n of ['weight', 'armor', 'resist'] as const) {
        expect(Math.abs(piece(kit, slot, RULES)[n] - k[n] * KIT_SHARE[slot] / 100), `${kit} ${slot} ${n}`).toBeLessThan(1);
      }
    }
  });

  test('a point the rounding leaves goes to the piece that lost the most to it: the light kit\'s armor 10 is chest 4 (3.5), legs 2, then 1 a piece', () => {
    // 3.5, 2, 1.5, 1, 1, 1 round down to 3, 2, 1, 1, 1, 1 (9); the point left goes to the larger of the two halves, the chest
    expect(SLOTS.map(slot => piece('light', slot, RULES).armor)).toEqual([4, 2, 1, 1, 1, 1]);
    // 1.75, 1, 0.75, 0.5, 0.5, 0.5 round down to 1, 1, 0, 0, 0, 0 (2); the three left go to the chest, the offhand and the head
    expect(SLOTS.map(slot => piece('medium', slot, RULES).resist)).toEqual([2, 1, 1, 1, 0, 0]);
  });

  test('a monster wears its archetype\'s kit at every rank: an S skirmisher\'s armor and resist are the light kit\'s', () => {
    const m = monsterSheet('S', 'skirmisher', 'normal', RULES), k = RULES.fight.kits.light;
    expect([m.armor, m.resist, m.weight]).toEqual([k.armor, k.resist, k.weight]);
  });
});

describe('kits and weight (table 2.5)', () => {
  test('each kit on a base body weighs and protects what table 2.5 says', () => {
    const on = (kit: 'light' | 'medium' | 'heavy'): number[] => { const s = sheetOf({ stats: stats(), level: 1, gear: kitGear(kit, RULES), perks: {} }, RULES); return [s.weight, s.armor, s.resist]; };
    expect([on('light'), on('medium'), on('heavy')]).toEqual([[8, 10, 15], [18, 30, 5], [32, 60, 60]]);
  });

  test('a kit is the sum of its pieces', () => {
    const s = sheetOf({ stats: stats(), level: 1, gear: [{ weight: 5, armor: 20, resist: 0 }, { weight: 3, armor: 4, resist: 7 }, { weight: 0, armor: 0, resist: 0 }], perks: {} }, RULES);
    expect([s.weight, s.armor, s.resist]).toEqual([8, 24, 7]);
  });


  test('the speed factor of each kit on Strength 10, 33 and 83', () => {
    const factor = (kit: GearPiece, str: number): number => sheetOf({ stats: stats({ str }), level: 1, gear: [kit], perks: {} }, RULES).speed / 100;
    expect([LIGHT, MEDIUM, HEAVY].map(kit => [10, 33, 83].map(str => factor(kit, str)))).toEqual([[1, 1, 1], [0.72, 0.98, 1], [0.65, 0.7, 0.7]]);
  });

  test('Strength lifts weight but not bulk: weight over 20 slows any wearer 2.5% a point, at most 35%', () => {
    const at = (str: number, weight: number): number => sheetOf({ stats: stats({ str }), level: 1, gear: [{ weight, armor: 0, resist: 0 }], perks: {} }, RULES).speed;
    // Plate (32) is 12 over a base body's carry of 20: 30% slower however strong; the medium kit (18) has no bulk.
    expect([at(400, 32), at(400, 18), at(400, 20), at(400, 24), at(400, 60)]).toEqual([70, 100, 100, 90, 65]);
  });

  test('up to half the carry never slows, and full carry or more is 35% slower', () => {
    const at = (weight: number): number => sheetOf({ stats: stats(), level: 1, gear: [{ weight, armor: 0, resist: 0 }], perks: {} }, RULES).speed;
    expect([at(0), at(10), at(15), at(20), at(60)]).toEqual([100, 100, 83, 65, 65]);
  });
});

describe('the bounds the design states for the curves', () => {
  test('the fastest S build acts at most 2.5 times as often as the slowest, and as the worst body (table 2.4)', () => {
    const speeds = BUILDS.map(id => sheetOf(build(id, 'S'), RULES).speed);
    const worst = sheetOf({ stats: stats({ vit: 174, dis: 83 }), level: 70, gear: [HEAVY], perks: {} }, RULES).speed;
    expect([Math.max(...speeds), Math.min(...speeds), worst]).toEqual([162, 70, 65]);
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeLessThanOrEqual(2.5);
    expect(Math.max(...speeds) / worst).toBeLessThanOrEqual(2.5);
  });

  test('raising any stat never lowers a number of the sheet', () => {
    const lowered: string[] = [];
    for (const gear of [[LIGHT], [HEAVY]]) for (const level of [1, 70]) for (const k of STAT_KEYS) {
      let prev = sheetOf({ stats: stats({ [k]: 0 }), level, gear, perks: {} }, RULES);
      for (let s = 1; s <= 400; s++) {
        const next = sheetOf({ stats: stats({ [k]: s }), level, gear, perks: {} }, RULES);
        for (const key of KEYS) if (next[key] < prev[key] - 1e-12) lowered.push(`${k} ${s - 1} to ${s}: ${key}`);
        prev = next;
      }
    }
    expect(lowered).toEqual([]);
  });

  test('every stat feeds at least two numbers', () => {
    const base = sheetOf({ stats: stats(), level: 20, gear: [HEAVY], perks: {} }, RULES);
    const fed = STAT_KEYS.map(k => {
      const raised = sheetOf({ stats: stats({ [k]: 60 }), level: 20, gear: [HEAVY], perks: {} }, RULES);
      return [k, KEYS.filter(key => raised[key] !== base[key]).length >= 2];
    });
    expect(fed).toEqual(STAT_KEYS.map(k => [k, true]));
  });

  test('no share, chance, rate or count reaches its cap for any stat from 0 to 1000', () => {
    // Design 2.2: each number's cap as the design gives it, and its floor where it has one. A count that is rounded may
    // reach its top (6 crit faces, an opening bonus of 6); the clamp holds speed inside 40 to 250.
    const below: [SheetNumber, number][] = [
      ['manaMax', 40], ['fatigueMax', 150], ['carry', 70], ['armor', 30], ['resist', 40], ['armorPen', 40], ['resistPen', 40], ['critSize', 2], ['tenacity', 60],
      ['potency', 50], ['threat', 2], ['hold', 0.4], ['costCut', 0.25],
    ];
    const within: [SheetNumber, number, number][] = [['critFaces', 1, 6], ['opening', 0, 6], ['speed', 40, 250], ['critSize', 1.5, 2], ['costCut', 0, 1]];
    const outside: string[] = [];
    for (let s = 0; s <= 1000; s++) {
      const sheet = sheetOf({ stats: stats({ str: s, agi: s, vit: s, ins: s, dis: s, pre: s, pow: s, ctl: s }), level: 70, gear: [], perks: {} }, RULES);
      for (const [key, cap] of below) if (sheet[key] >= cap) outside.push(`${key} at ${s}: ${sheet[key]}`);
      for (const [key, lo, hi] of within) if (sheet[key] < lo || sheet[key] > hi) outside.push(`${key} at ${s}: ${sheet[key]}`);
    }
    expect(outside).toEqual([]);
  });

  test('a capped number is at half its cap at 40 effective points, and a stat lowered below 10 hurts at least as much as raising it helps', () => {
    const potency = (ctl: number): number => sheetOf({ stats: stats({ ctl }), level: 1, gear: [], perks: {} }, RULES).potency;
    // eff(s) = 50, 40 points above the base, needs s = 10 * 5 ^ (1 / 0.8).
    expect(potency(10 * Math.pow(5, 1.25))).toBeCloseTo(25, 10);
    for (const d of [1, 3, 5, 9]) expect([d, -potency(10 - d) >= potency(10 + d)]).toEqual([d, true]);
  });

  test('speed stays between 40 and 250 whatever slows or hastes it', () => {
    const tank = build('tank', 'E'), speedS = build('speed', 'S');
    expect(sheetOf(tank, RULES, [{ op: 'speed', pct: -90 }]).speed).toBe(40);
    expect(sheetOf(speedS, RULES, [{ op: 'speed', pct: 500 }]).speed).toBe(250);
  });
});

describe('tenacity, from Strength and Discipline together (design 2.2, the owner, Nov 21)', () => {
  const tenacity = (o: Partial<Stats>, perks: SheetBasis['perks'] = {}): number => sheetOf({ stats: stats(o), level: 20, gear: [], perks }, RULES).tenacity;
  // Design 2.2: a capped number is 60 x / (x + 40) of the effective points x = 10 (s / 10) ^ 0.8 - 10 of the score it reads,
  // 60 x / 40 below the base; tenacity reads the geometric mean of Strength and Discipline, sqrt(str * dis).
  const curve = (s: number): number => { const x = 10 * Math.pow(s / 10, 0.8) - 10; return x >= 0 ? 60 * x / (x + 40) : 60 * x / 40; };

  test('equal Strength and Discipline give the tenacity that much Discipline gave alone before the blend', () => {
    for (const s of [10, 14, 33, 83, 200]) expect(tenacity({ str: s, dis: s }) - curve(s)).toBeCloseTo(0, 10);
  });

  test('Discipline alone gives less, the tenacity of the score sqrt(10 * dis): 7.96 at the C support\'s 33, not 17.14', () => {
    expect(tenacity({ dis: 33 })).toBeCloseTo(curve(Math.sqrt(330)), 10);
    expect(tenacity({ dis: 33 })).toBeCloseTo(7.96, 2);
    for (const s of [14, 33, 83]) expect([s, tenacity({ dis: s }) < curve(s)]).toEqual([s, true]);
  });

  test('Strength alone gives the same tenacity as Discipline alone', () => {
    for (const s of [14, 33, 83, 200]) expect([s, tenacity({ str: s })]).toEqual([s, tenacity({ dis: s })]);
  });

  test('tenacity stays under its cap of 60 with both stats at 1000, and a score lowered past 0 counts as 1', () => {
    expect(tenacity({ str: 1000, dis: 1000 })).toBeLessThan(60);
    expect(tenacity({ str: 1000, dis: 1000 })).toBeCloseTo(curve(1000), 10);
    expect(tenacity({ str: -20, dis: 40 })).toBeCloseTo(curve(Math.sqrt(40)), 10);
  });

  test('a perk on tenacity still adds to the blend, as a monster\'s or a fixture\'s bonus does', () => {
    expect(tenacity({ str: 33, dis: 33 }, { tenacity: 10 })).toBeCloseTo(curve(33) + 10, 10);
  });
});

describe('statuses and perks on a sheet', () => {
  test('a speed status is a percent of the speed, and move follows it', () => {
    const s = sheetOf(build('cannon', 'C'), RULES, [{ op: 'speed', pct: -30 }]);
    expect([s.speed, s.move, s.stride]).toEqual([70, 4.2, 3]);
  });

  test('two speed statuses add their percents', () => {
    expect(sheetOf(build('cannon', 'C'), RULES, [{ op: 'speed', pct: -30 }, { op: 'speed', pct: 10 }]).speed).toBe(80);
  });

  test('a stat status counts as that many points of the stat', () => {
    const lowered = sheetOf(build('cannon', 'C'), RULES, [{ op: 'stat', key: 'pow', amount: -30 }]);
    expect(lowered.manaMax).toBe(sheetOf({ ...build('cannon', 'C'), stats: stats({ pow: 33, ctl: 33 }) }, RULES).manaMax);
    // eff(33) = 25.99 (table 2.2), so mana is 10 + 30 * 15.99 / 55.99 = 18.57.
    expect(lowered.manaMax).toBe(19);
  });

  test('a perk on a stat counts as points of the stat, and a perk on a sheet number adds to that number', () => {
    const plain = sheetOf(build('tank', 'C'), RULES);
    const perked = sheetOf({ ...build('tank', 'C'), perks: { hpMax: 20, str: 50 } }, RULES);
    expect(perked.hpMax).toBe(plain.hpMax + 20);
    expect(perked.phys).toBe(sheetOf({ ...build('tank', 'C'), stats: stats({ vit: 63, str: 83 }) }, RULES).phys);
  });

  test('however far perks and the GM\'s adjustment lower them, a body keeps 1 max HP, 1 fatigue capacity and no less than 0 max mana', () => {
    const low = sheetOf({ ...build('tank', 'E'), perks: { hpMax: -5000, fatigueMax: -5000, manaMax: -5000 } }, RULES);
    expect([low.hpMax, low.fatigueMax, low.manaMax]).toEqual([1, 1, 0]);
  });

  test('a perk on carry is read before the load, so it lifts the speed of a heavy kit', () => {
    const plain = sheetOf(build('tank', 'E'), RULES), strong = sheetOf({ ...build('tank', 'E'), perks: { carry: 40 } }, RULES);
    expect([plain.speed, strong.speed]).toEqual([65, 70]);
  });

  test('every body sees at sight level 0, the rules\' base: a hunter of any build and rank, and a monster of any kind', () => {
    expect(SHOWN.flatMap(rank => BUILDS.map(id => sheetOf(build(id, rank), RULES).sight))).toEqual(Array(15).fill(0));
    expect(TABLE_2_6.map(([rank, archetype, kind]) => monsterSheet(rank, archetype, kind, RULES).sight)).toEqual(Array(TABLE_2_6.length).fill(0));
    expect(SHEET_LABELS.sight).toBe('Sight level');
  });

  test('a perk on sight does not add to the base: the higher of the two is the level, at most 5 (ruling 8)', () => {
    const sight = (perk: number): number => sheetOf({ ...build('tank', 'C'), perks: { sight: perk } }, RULES).sight;
    expect([sight(2), sight(9), sight(-3)]).toEqual([2, 5, 0]);
  });
});

test('the fight\'s rule numbers are the ones the timeline and the map read', () => {
  const timeline: TimelineRules = RULES.fight, space: SpaceRules = RULES.fight;
  expect([timeline.round, timeline.cost, timeline.moveCost, space.tileFeet, space.lineGap]).toEqual([1000, { quick: 70, standard: 100, heavy: 150 }, 100 / 6, 5, 8]);
});

// ── explain: a sheet number as the parts it comes from (the "more info" of a number on the sheet) ──

describe('explain', () => {
  const hunter = (o: Partial<SheetHunter> = {}): SheetHunter => ({
    stats: stats(), level: 1, rank: 'E', fatigue: 0, penalty: null, hpAdj: 0, manaAdj: 0, titleId: null, titles: [],
    items: [], equipped: {}, build: { path: null, picks: [] }, skills: [], conditions: [], ...o,
  });
  const PATH: SheetPath = { alloc: { agi: 1 }, tiers: [[{ agi: 2, armor: 4 }, { hpMax: 20 }]] };
  const R: SheetRules = { ...RULES, paths: { striker: PATH } };
  const VEST: SheetItem = { id: 'vest', weight: 6, armor: 12, resist: 3, bonus: { str: 2 } };
  const SLOWED: StatusDef = { label: 'Slowed', desc: '', ops: [{ op: 'speed', pct: [-20, -25, -30, -35, -40, -50] }] };
  const FRIGHTENED: StatusDef = { label: 'Frightened', desc: '', ops: [{ op: 'stat', key: 'dis', amount: { kind: 'number', value: -8 } }] };
  const on = (key: string, def: StatusDef): SheetCondition => ({ key: statusKey(key), def, source: { id: null, tier: 0 } });
  const part = (h: SheetHunter, key: SheetNumber, from: SheetSource): number => explain(h, key, R).parts.find(p => p.from === from)!.amount;
  // every source at once: points spent, a level, worn gear with a bonus, a title, a path pick, a passive, the GM's change, two statuses
  const FULL = hunter({
    stats: stats({ vit: 18, agi: 16, str: 14, pow: 12 }), level: 9, rank: 'D',
    items: [VEST], equipped: { chest: 'vest' }, titleId: 't', titles: [{ id: 't', bonus: { ins: 3, threat: 10 } }],
    build: { path: 'striker', picks: [0] }, skills: [{ type: 'passive', bonus: { dis: 2, critSize: 0.05 } }],
    hpAdj: 7, manaAdj: -2, conditions: [on('slowed', SLOWED), on('frightened', FRIGHTENED)],
  });

  test('every number of the sheet is the sum of its parts, and the parts end at the sheet\'s number', () => {
    const sheet = hunterSheet(FULL, R).sheet;
    for (const key of KEYS) {
      const { total, parts } = explain(FULL, key, R);
      expect(total, key).toBe(sheet[key]);
      expect(parts.map(p => p.from), key).toEqual([...SOURCES]);
      expect(parts.reduce((n, p) => n + p.amount, 0), key).toBeCloseTo(sheet[key], 9);
    }
  });

  test('worn armor is the gear part of Armor, and nothing worn is a gear part of 0', () => {
    // design 2.2: armor is the gear's armor, plus the capped curve of Vitality above its base (0 at the base), plus bonuses
    const worn = hunter({ items: [{ ...VEST, bonus: {} }], equipped: { chest: 'vest' } });
    expect(explain(worn, 'armor', R).parts.filter(p => p.amount !== 0)).toEqual([{ from: 'gear', amount: 12 }]);
    expect(part(hunter(), 'armor', 'gear')).toBe(0);
  });

  test('a level 1 body at the base stats is all Base: its max HP is the rules\' base HP', () => {
    expect(explain(hunter(), 'hpMax', R).parts).toEqual(SOURCES.map(from => ({ from, amount: from === 'base' ? RULES.fight.hpBase : 0 })));
  });

  test('the GM\'s change to max HP and max mana is a part of its own', () => {
    expect(part(FULL, 'hpMax', 'gm')).toBe(7);
    expect(part(FULL, 'manaMax', 'gm')).toBe(-2);
  });

  test('a path perk on Armor and a title\'s threat are parts of their own', () => {
    expect(part(FULL, 'armor', 'path')).toBe(4);
    expect(part(FULL, 'threat', 'title')).toBeCloseTo(0.1, 9);
  });

  test('a slow is the Statuses part of Speed, and a hunter with no status has none', () => {
    expect(part(FULL, 'speed', 'statuses')).toBeLessThan(0);
    expect(part(hunter(), 'speed', 'statuses')).toBe(0);
  });
});

describe('the bonus keys on a sheet (balance plan sections 9 and 10)', () => {
  const plain = (perks: SheetBasis['perks'] = {}, ctl = 10): Sheet => sheetOf({ stats: stats({ ctl }), level: 20, gear: [MEDIUM], perks }, RULES);

  test('Lethality and Unravel come from bonuses alone: a plain body in any kit holds 0, and a bonus adds its points', () => {
    expect([plain().armorPenFlat, plain().resistPenFlat, plain({}, 83).armorPenFlat]).toEqual([0, 0, 0]);
    expect([plain({ armorPenFlat: 5 }).armorPenFlat, plain({ resistPenFlat: 7 }).resistPenFlat, plain({ armorPenFlat: 5 }).resistPenFlat]).toEqual([5, 7, 0]);
  });

  test('Control gives both percents on its curve, 40 * x(ctl) / (x(ctl) + 40): 11.42 at Control 33', () => {
    const x = 10 * Math.pow(3.3, 0.8) - 10, pct = 40 * x / (x + 40);
    expect(plain({}, 33).armorPen).toBeCloseTo(pct, 9);
    expect(plain({}, 33).resistPen).toBeCloseTo(pct, 9);
  });

  test('a percent bonus adds after Control\'s cap of 40, and the sum stops at penMax, 60', () => {
    expect(plain({ armorPen: 15 }).armorPen).toBe(15);
    expect(plain({ resistPen: 15 }, 33).resistPen).toBeCloseTo(plain({}, 33).resistPen + 15, 9);
    expect([plain({ armorPen: 50 }, 1000).armorPen, plain({ resistPen: 999 }).resistPen]).toEqual([60, 60]);
  });

  test('a bonus on a share or a multiplier adds a hundredth a point: 10 on the cost cut is 0.10, 20 on crit size 0.20, 50 on threat 0.50, 5 on the channel\'s hold 0.05', () => {
    const base = plain(), more = plain({ costCut: 10, critSize: 20, threat: 50, hold: 5 });
    expect(more.costCut - base.costCut).toBeCloseTo(0.1, 9);
    expect(more.critSize - base.critSize).toBeCloseTo(0.2, 9);
    expect(more.threat - base.threat).toBeCloseTo(0.5, 9);
    expect(more.hold - base.hold).toBeCloseTo(0.05, 9);
  });

  test('a bonus never passes a sheet clamp: crit faces stay in 1 to kit.critFacesMax, crit size in 1.5 to kit.critSizeMax, the cost cut in 0 to kit.costCutMax', () => {
    const K = RULES.fight.kit, high = plain({ critFaces: 99, critSize: 999, costCut: 999 }), low = plain({ critFaces: -99, critSize: -999, costCut: -999 });
    expect([high.critFaces, high.critSize, high.costCut]).toEqual([K.critFacesMax, K.critSizeMax, K.costCutMax]);
    expect([low.critFaces, low.critSize, low.costCut]).toEqual([1, RULES.fight.critSizeBase, 0]);
  });

  test('lifesteal comes from bonuses alone, a hundredth a point with no cap: 0 with none (Control 1000 gives none), 12 points 0.12, 150 points 1.5, never under 0', () => {
    expect(plain({}, 1000).drain).toBe(0);
    expect(plain({ drain: 12 }).drain).toBeCloseTo(0.12, 9);
    expect(plain({ drain: 150 }).drain).toBeCloseTo(1.5, 9);
    expect(plain({ drain: -50 }).drain).toBe(0);
  });

  test('ability haste comes from bonuses alone, whole points with no cap: 0 with none (Control 1000 gives none), 12 points 12, 600 points 600, never under 0', () => {
    expect([plain({}, 1000).haste, plain({ haste: 12 }).haste, plain({ haste: 600 }).haste, plain({ haste: -50 }).haste]).toEqual([0, 12, 600, 0]);
  });

  test('a bonus on a stat-fed number adds after the curve\'s cap: 30 on potency over Control 1000\'s near-50', () => {
    expect(plain({ potency: 30 }, 1000).potency).toBeCloseTo(plain({}, 1000).potency + 30, 9);
    expect(plain({}, 1000).potency).toBeLessThan(RULES.fight.potencyCap);
  });
});
