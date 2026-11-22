// Keystones (docs/agent-handoff/features/notes-11-keystones.md, design A): a mark at rank D for a stat holding 30% of
// the points spent, a confluence at rank C for the two highest stats at 25% each (the job's pair first), an apex at
// rank B for a stat over 55%. A build is written as the points it put above the base of 10, so each expected keystone
// is read off its shares by hand.
import { describe, expect, test } from 'bun:test';
import { STAT_PAIRS, keystoneBasis, keystoneReach, keystonesOf, pairOf, statsOfPair } from '../src/core/hunter/keystones.ts';
import type { KeystoneBasis, KeystoneHunter, KeystoneKey, StatPair } from '../src/core/hunter/keystones.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import type { SheetCondition, SheetHunter } from '../src/core/hunter/sheet.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { stepQuest } from '../src/core/hunter/job-chain.ts';
import { BUILT_IN_JOBS, JOB_NAMES } from '../src/core/registry/jobs.ts';
import { RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { STAT_KEYS, statsBy } from '../src/core/stats.ts';
import type { StatKey, Stats } from '../src/core/stats.ts';
import { jcid, qid } from './fixtures/ids.ts';

const F = RULES.fight;
/** The stats of a body that put `points` above the base. */
const built = (points: Partial<Record<StatKey, number>>): Stats => statsBy(k => F.statBase + (points[k] ?? 0));
const body = (points: Partial<Record<StatKey, number>>, rank: Rank, pair: StatPair | null = null): KeystoneBasis =>
  ({ stats: built(points), rank, pair, awakened: false });
const held = (points: Partial<Record<StatKey, number>>, rank: Rank, pair: StatPair | null = null): readonly KeystoneKey[] =>
  keystonesOf(body(points, rank, pair), F);
const mark = (stat: StatKey): KeystoneKey => ({ tier: 'mark', stat });
const apex = (stat: StatKey): KeystoneKey => ({ tier: 'apex', stat });
const confluence = (a: StatKey, b: StatKey): KeystoneKey => ({ tier: 'confluence', pair: pairOf(a, b) });

test('a stat holding 30% of a rank D hunter\'s points earns its mark', () => {
  expect(held({ str: 30, agi: 25, vit: 25, ins: 20 }, 'D')).toEqual([mark('str')]);
  expect(held({ str: 29, agi: 25, vit: 25, ins: 21 }, 'D')).toEqual([]);
  expect(held({ str: 30, agi: 25, vit: 25, ins: 20 }, 'E')).toEqual([]);
});

test('an even spread earns none', () => {
  expect(held(Object.fromEntries(STAT_KEYS.map(k => [k, 10])), 'S')).toEqual([]);
  expect(held({}, 'S')).toEqual([]);
});

test('no body holds two apexes', () => {
  expect(held({ str: 50, agi: 50 }, 'S')).toEqual([mark('str'), mark('agi'), confluence('str', 'agi')]);
  expect(held({ str: 55, agi: 45 }, 'S')).toEqual([mark('str'), mark('agi'), confluence('str', 'agi')]);
  expect(held({ str: 56, agi: 44 }, 'S')).toEqual([mark('str'), mark('agi'), confluence('str', 'agi'), apex('str')]);
  for (let a = 0; a <= 100; a++) for (let b = 0; a + b <= 100; b += 5) {
    const apexes = held({ str: a, agi: b, pow: 100 - a - b }, 'S').filter(k => k.tier === 'apex');
    expect([a, b, apexes.length <= 1]).toEqual([a, b, true]);
  }
});

test('the confluence is the two highest stats', () => {
  expect(held({ str: 40, dis: 35, agi: 25 }, 'C')).toEqual([mark('str'), mark('dis'), confluence('str', 'dis')]);
  expect(held({ str: 34, agi: 33, vit: 33 }, 'C')).toEqual([mark('str'), mark('agi'), mark('vit'), confluence('str', 'agi')]);
  expect(held({ str: 40, dis: 35, agi: 25 }, 'D')).toEqual([mark('str'), mark('dis')]);
  expect(held({ str: 76, dis: 24 }, 'S')).toEqual([mark('str'), apex('str')]);
});

test('the job\'s pair is the confluence when it qualifies', () => {
  expect(held({ str: 40, dis: 35, agi: 25 }, 'C', 'agi+dis')).toEqual([mark('str'), mark('dis'), confluence('agi', 'dis')]);
  expect(held({ str: 40, dis: 35, agi: 25 }, 'C', 'str+vit')).toEqual([mark('str'), mark('dis'), confluence('str', 'dis')]);
  expect(held({ str: 40, dis: 35, agi: 25 }, 'D', 'agi+dis')).toEqual([mark('str'), mark('dis')]);
});

describe('design A.2\'s table of builds, at rank B', () => {
  const rows: readonly [string, Partial<Record<StatKey, number>>, readonly KeystoneKey[]][] = [
    ['even over 8 (12.5% each): none', Object.fromEntries(STAT_KEYS.map(k => [k, 10])), []],
    ['even over 4 (25% each): the top two\'s confluence', { str: 25, agi: 25, vit: 25, ins: 25 }, [confluence('str', 'agi')]],
    ['three stats (34/33/33): three marks and the top two\'s confluence', { str: 34, agi: 33, vit: 33 }, [mark('str'), mark('agi'), mark('vit'), confluence('str', 'agi')]],
    ['two stats (60/40): two marks, the pair and the apex', { str: 60, agi: 40 }, [mark('str'), mark('agi'), confluence('str', 'agi'), apex('str')]],
    ['one stat (100): its mark and its apex', { str: 100 }, [mark('str'), apex('str')]],
  ];
  for (const [name, points, keys] of rows) test(name, () => expect(held(points, 'B')).toEqual(keys));

  test('a monster\'s 2:1 split (A.5) holds both marks, its pair and its main stat\'s apex', () => {
    expect(held({ vit: 20, str: 10 }, 'B')).toEqual([mark('str'), mark('vit'), confluence('str', 'vit'), apex('vit')]);
  });
});

test('each tier waits for its rank: marks at D, the confluence at C, the apex at B', () => {
  const two = { str: 60, agi: 40 };
  expect(held(two, 'E')).toEqual([]);
  expect(held(two, 'D')).toEqual([mark('str'), mark('agi')]);
  expect(held(two, 'C')).toEqual([mark('str'), mark('agi'), confluence('str', 'agi')]);
  expect(held(two, 'S')).toEqual([mark('str'), mark('agi'), confluence('str', 'agi'), apex('str')]);
});

test('with the room\'s switch off no body holds a keystone', () => {
  const off = { ...F, keystone: { ...F.keystone, on: false } };
  expect(keystonesOf(body({ str: 60, agi: 40 }, 'S'), off)).toEqual([]);
  expect(keystoneReach(body({ str: 60, agi: 40 }, 'S'), off).every(r => r.next === null)).toBe(true);
});

test('a stat edited under the base spent no points', () => {
  expect(held({ str: 30, agi: 70, pow: -9 }, 'D')).toEqual([mark('str'), mark('agi')]);
});

test('the sheet\'s reach names each stat\'s share and the next keystone it lacks, with the share and rank it asks', () => {
  const reach = keystoneReach(body({ str: 60, agi: 27, vit: 13 }, 'C'), F);
  expect(reach.map(r => r.stat)).toEqual([...STAT_KEYS]);
  expect(reach[0]).toEqual({ stat: 'str', share: 0.6, next: { key: apex('str'), share: 0.55, rank: 'B', shareMet: true, rankMet: false } });
  expect(reach[1]).toEqual({ stat: 'agi', share: 0.27, next: { key: mark('agi'), share: 0.3, rank: 'D', shareMet: false, rankMet: true } });
  expect(reach[7]).toEqual({ stat: 'ctl', share: 0, next: { key: mark('ctl'), share: 0.3, rank: 'D', shareMet: false, rankMet: true } });
  expect(keystoneReach(body({ str: 100 }, 'S'), F)[0]).toEqual({ stat: 'str', share: 1, next: null });
});

describe('the pairs of stats', () => {
  test('there are 28, each two different stats in STAT_KEYS order, whichever order they are named', () => {
    expect(STAT_PAIRS).toHaveLength(28);
    expect(new Set(STAT_PAIRS).size).toBe(28);
    expect(STAT_PAIRS[0]).toBe('str+agi');
    expect(STAT_PAIRS[27]).toBe('pow+ctl');
    for (const p of STAT_PAIRS) {
      const [a, b] = statsOfPair(p);
      expect([p, STAT_KEYS.indexOf(a) < STAT_KEYS.indexOf(b)]).toEqual([p, true]);
      expect(pairOf(b, a)).toBe(p);
    }
  });

  test('every job leans to a pair of two different stats', () => {
    for (const job of JOB_NAMES) expect([job, STAT_PAIRS.includes(BUILT_IN_JOBS[job].pair)]).toEqual([job, true]);
  });
});

// ── a hunter's basis: its points, rank and job, never its gear, titles or statuses ──
const AT = '2026-11-22T12:00:00.000Z';
type Hunter = SheetHunter & KeystoneHunter;
const hunter = (o: Partial<Hunter> = {}): Hunter => ({
  stats: built({}), level: 10, rank: 'D', fatigue: 0, penalty: null, hpAdj: 0, manaAdj: 0, titleId: null, titles: [],
  items: [], equipped: {}, build: { path: null, picks: [] }, skills: [], conditions: [], job: null, quests: [], ...o,
});
const keys = (h: Hunter): readonly KeystoneKey[] => keystonesOf(keystoneBasis(h), F);

test('gear and titles never earn a keystone', () => {
  const short = hunter({ stats: built({ str: 29, agi: 25, vit: 25, ins: 21 }) });
  const geared = {
    ...short, titleId: 'wolf', titles: [{ id: 'wolf', bonus: { str: 10 } }],
    items: [{ id: 'knife', weight: 1, bonus: { str: 10 } }], equipped: { weapon: 'knife' },
  };
  expect(hunterSheet(geared, RULES).stats.str).toBe(hunterSheet(short, RULES).stats.str + 20);
  expect(keys(geared)).toEqual([]);
});

test('a point waiting for Confirm counts toward a keystone', () => {
  expect(keys(hunter({ stats: built({ str: 29, agi: 25, vit: 25, ins: 20 }), pending: { str: 1 } }))).toEqual([mark('str')]);
});

test('a fight status never changes one', () => {
  const weakened: SheetCondition = {
    key: statusKey('weakened'), source: { id: null, tier: 0 },
    def: { label: 'Weakened', desc: '', ops: [{ op: 'stat', key: 'str', amount: { kind: 'number', value: -15 } }] },
  };
  const marked = hunter({ stats: built({ str: 30, agi: 25, vit: 25, ins: 20 }) }), struck = { ...marked, conditions: [weakened] };
  expect(hunterSheet(struck, RULES).stats.str).toBe(hunterSheet(marked, RULES).stats.str - 15);
  expect(keys(struck)).toEqual([mark('str')]);
});

test('a hunter\'s job gives its pair, and a finished Job Change awakens it', () => {
  const lastStep = { ...stepQuest('Mage', 3, { chainId: jcid('jc1'), questId: qid('q3'), at: AT, level: 10 }), status: 'done' as const, doneAt: AT, told: true };
  const mage = hunter({ job: 'Mage', rank: 'C' });
  expect(keystoneBasis(mage)).toMatchObject({ pair: 'pow+ctl', awakened: false });
  expect(keystoneBasis({ ...mage, quests: [{ ...lastStep, status: 'active' }] }).awakened).toBe(false);
  expect(keystoneBasis({ ...mage, quests: [lastStep] }).awakened).toBe(true);
  expect(keystoneBasis({ ...mage, job: 'Fighter', quests: [lastStep] })).toMatchObject({ pair: 'str+vit', awakened: false });
  expect(keystoneBasis({ ...mage, job: 'Shadow Monarch' })).toMatchObject({ pair: null, awakened: false });
});
