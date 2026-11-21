import { describe, expect, test } from 'bun:test';
import { kitGear, monsterSheet, SHEET_LABELS, sheetOf } from '../src/core/hunter/derive.ts';
import type { Archetype, SheetBasis, GearPiece, MonsterKind, Sheet, SheetNumber } from '../src/core/hunter/derive.ts';
import { RULES } from '../src/core/rules.ts';
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

// Tables 2.3.E, 2.3.C and 2.3.S: one column per build, the rows in the order of SHEET_LABELS. The last, the sight level,
// is no table's: every body sees at the rules' `fight.stealth.sightBase`, 0, until a status raises it (notes-7-stealth.md).
const TABLE_2_3: Record<Shown, Record<BuildId, readonly number[]>> = {
  E: {
    speed: [45, 10, 100, 24, 8, 114, 6.84, 4, 10, 15, 0, 0, 7.85, 6, 6, 17.41, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    tank: [51, 10, 108, 24, 32, 65, 3.90, 2, 65, 20, 0, 0, 7.85, 6, 6, 10, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    cannon: [45, 15, 100, 20, 8, 100, 6, 3, 10, 15, 0.03, 0, 6, 10.45, 6, 10, 13.09, 10, 1, 1.54, 0, 0, 3.58, 1, 0.15, 0.02, 2, 0],
    bruiser: [48, 10, 104, 28, 18, 90, 5.40, 3, 32, 5, 0, 0, 10.45, 6, 6, 10, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    support: [45, 10, 100, 20, 8, 100, 6, 3, 10, 18, 0, 0, 6, 6, 10.45, 10, 10, 13.09, 1, 1.50, 0, 4.30, 0, 1.16, 0.17, 0, 3, 0],
  },
  C: {
    speed: [81, 10, 100, 34, 8, 141, 8.46, 5, 10, 15, 0, 0, 15.59, 6, 6, 43.60, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    tank: [114, 10, 123, 34, 32, 70, 4.20, 3, 74, 20, 0, 0, 15.59, 6, 6, 10, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    cannon: [81, 24, 100, 20, 8, 100, 6, 3, 10, 15, 0.11, 0, 6, 26.16, 6, 10, 25.99, 10, 1, 1.64, 0, 0, 14.28, 1, 0.15, 0.07, 2, 0],
    bruiser: [101, 10, 114, 43, 18, 100, 6, 3, 39, 5, 0, 0, 26.16, 6, 6, 10, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    support: [81, 10, 100, 20, 8, 100, 6, 3, 10, 26, 0, 0, 6, 6, 26.16, 10, 10, 25.99, 1, 1.50, 0, 17.14, 0, 1.46, 0.22, 0, 8, 0],
  },
  S: {
    speed: [174, 10, 100, 46, 8, 162, 9.72, 5, 10, 15, 0, 0, 32.61, 6, 6, 98.27, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    tank: [282, 10, 134, 46, 32, 70, 4.2, 3, 81, 20, 0, 0, 32.61, 6, 6, 10, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    cannon: [174, 31, 100, 20, 8, 100, 6, 3, 10, 15, 0.21, 0, 6, 58.96, 6, 10, 54.36, 10, 1, 1.76, 0, 0, 26.29, 1, 0.15, 0.13, 2, 0],
    bruiser: [257, 10, 126, 54, 18, 100, 6, 3, 46, 5, 0, 0, 58.96, 6, 6, 10, 10, 10, 1, 1.50, 0, 0, 0, 1, 0.15, 0, 2, 0],
    support: [174, 10, 100, 20, 8, 100, 6, 3, 10, 36, 0, 0, 6, 6, 58.96, 10, 10, 54.36, 1, 1.50, 0, 31.55, 0, 1.69, 0.28, 0, 19, 0],
  },
};
const TABLE_2_6: readonly (readonly [Shown, Archetype, MonsterKind, number, number, number, number, number])[] = [
  ['E', 'brute', 'normal', 29, 87, 32, 5, 6.72],
  ['E', 'brute', 'elite', 72, 87, 32, 5, 9.60],
  ['E', 'brute', 'boss', 153, 87, 32, 5, 11.52],
  ['E', 'skirmisher', 'normal', 27, 112, 10, 15, 5.50],
  ['E', 'skirmisher', 'elite', 68, 112, 10, 15, 7.85],
  ['E', 'skirmisher', 'boss', 144, 112, 10, 15, 9.42],
  ['E', 'caster', 'normal', 27, 100, 10, 15, 6.72],
  ['E', 'caster', 'elite', 68, 100, 10, 15, 9.60],
  ['E', 'caster', 'boss', 144, 100, 10, 15, 11.52],
  ['C', 'brute', 'normal', 61, 100, 39, 5, 16.66],
  ['C', 'brute', 'elite', 152, 100, 39, 5, 23.81],
  ['C', 'brute', 'boss', 324, 100, 39, 5, 28.57],
  ['C', 'skirmisher', 'normal', 48, 138, 10, 15, 10.92],
  ['C', 'skirmisher', 'elite', 121, 138, 10, 15, 15.59],
  ['C', 'skirmisher', 'boss', 258, 138, 10, 15, 18.71],
  ['C', 'caster', 'normal', 48, 100, 10, 15, 16.66],
  ['C', 'caster', 'elite', 121, 100, 10, 15, 23.81],
  ['C', 'caster', 'boss', 258, 100, 10, 15, 28.57],
  ['S', 'brute', 'normal', 154, 100, 46, 5, 37.82],
  ['S', 'brute', 'elite', 385, 100, 46, 5, 54.03],
  ['S', 'brute', 'boss', 822, 100, 46, 5, 64.84],
  ['S', 'skirmisher', 'normal', 105, 160, 10, 15, 22.83],
  ['S', 'skirmisher', 'elite', 262, 160, 10, 15, 32.61],
  ['S', 'skirmisher', 'boss', 558, 160, 10, 15, 39.14],
  ['S', 'caster', 'normal', 105, 100, 10, 15, 37.82],
  ['S', 'caster', 'elite', 262, 100, 10, 15, 54.03],
  ['S', 'caster', 'boss', 558, 100, 10, 15, 64.84],
];

describe('the five builds (tables 2.3.E, 2.3.C and 2.3.S)', () => {
  for (const rank of SHOWN) for (const id of BUILDS) {
    test(`the ${id} build at ${rank} has every number its table prints`, () => {
      const sheet = sheetOf(build(id, rank), RULES);
      const wrong = KEYS.map((k, i) => [k, sheet[k], TABLE_2_3[rank][id][i]!] as const).filter(([, a, p]) => !near(a, p));
      expect(wrong).toEqual([]);
    });
  }

  test('the sheet has the 27 numbers the tables print, in their order, and the sight level after them', () => {
    expect(KEYS).toHaveLength(28);
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

  test('a kind scales max HP and power and nothing else', () => {
    const normal = monsterSheet('C', 'caster', 'normal', RULES), boss = monsterSheet('C', 'caster', 'boss', RULES);
    const scaled: SheetNumber[] = ['hpMax', 'phys', 'mag', 'sup'];
    expect(KEYS.filter(k => !scaled.includes(k) && boss[k] !== normal[k])).toEqual([]);
    expect(boss.mag / normal.mag).toBeCloseTo(1.2 / 0.7, 10);
  });

  test('a seed\'s HP factor multiplies max HP on top of its kind\'s and changes nothing else: half of the C brute boss\'s 324 is 162 (2.4)', () => {
    const plain = monsterSheet('C', 'brute', 'boss', RULES), half = monsterSheet('C', 'brute', 'boss', RULES, [], { hp: 0.5, stats: {} });
    expect(half.hpMax).toBe(162);
    expect(KEYS.filter(k => k !== 'hpMax' && half[k] !== plain[k])).toEqual([]);
  });

  test('a seed\'s stat tweak adds points before the curve, as a hunter\'s spent points do (2.4)', () => {
    // A C brute has 12 + 3 * 19 = 69 points split 2:1: Strength 10 + 46 = 56 and Vitality 10 + 23 = 33, in a medium kit.
    const keen = monsterSheet('C', 'brute', 'normal', RULES, [], { hp: 1, stats: { ins: 8 } });
    const same = sheetOf({ stats: stats({ str: 56, vit: 33, ins: 18 }), level: 20, gear: [MEDIUM], perks: {} }, RULES);
    const unscaled: SheetNumber[] = ['speed', 'armor', 'resist', 'react', 'opening', 'critFaces'];
    expect(unscaled.map(k => keen[k])).toEqual(unscaled.map(k => same[k]));
    expect(keen.opening).toBeGreaterThan(monsterSheet('C', 'brute', 'normal', RULES).opening);
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

  test('flat penetration comes from gear alone and adds up over the pieces (design 2.3)', () => {
    const on = (gear: GearPiece[]): number => sheetOf({ stats: stats({ ctl: 83 }), level: 20, gear, perks: {} }, RULES).penFlat;
    expect([on([LIGHT]), on([{ weight: 2, armor: 0, resist: 0, penFlat: 5 }, { weight: 0, armor: 0, resist: 0, penFlat: 3 }])]).toEqual([0, 8]);
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
      ['manaMax', 40], ['fatigueMax', 150], ['carry', 70], ['armor', 30], ['resist', 40], ['pen', 0.4], ['critSize', 2], ['tenacity', 60],
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
  const FRIGHTENED: StatusDef = { label: 'Frightened', desc: '', ops: [{ op: 'stat', key: 'dis', amount: -8 }] };
  const on = (key: string, def: StatusDef): SheetCondition => ({ key: statusKey(key), def, source: { id: null, tier: 0 } });
  const part = (h: SheetHunter, key: SheetNumber, from: SheetSource): number => explain(h, key, R).parts.find(p => p.from === from)!.amount;
  // every source at once: points spent, a level, worn gear with a bonus, a title, a path pick, a passive, the GM's change, two statuses
  const FULL = hunter({
    stats: stats({ vit: 18, agi: 16, str: 14, pow: 12 }), level: 9, rank: 'D',
    items: [VEST], equipped: { chest: 'vest' }, titleId: 't', titles: [{ id: 't', bonus: { ins: 3, threat: 0.1 } }],
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
