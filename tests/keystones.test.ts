// Keystones (docs/agent-handoff/features/notes-11-keystones.md, design A): a mark at rank D for a stat holding 30% of
// the points spent, a confluence at rank C for the two highest stats at 25% each (the job's pair first), an apex at
// rank B for a stat over 55%. A build is written as the points it put above the base of 10, so each expected keystone
// is read off its shares by hand.
import { describe, expect, test } from 'bun:test';
import { STAT_PAIRS, keystoneBasis, keystoneConfirmDiff, keystoneDiff, keystoneReach, keystonesOf, nearestKeystone, pairOf, statsOfPair } from '../src/core/hunter/keystones.ts';
import type { KeystoneBasis, KeystoneHunter, KeystoneKey, StatPair } from '../src/core/hunter/keystones.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import type { SheetCondition, SheetHunter } from '../src/core/hunter/sheet.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { stepQuest } from '../src/core/hunter/job-chain.ts';
import { chained, deleteQuest } from '../src/core/hunter/quests.ts';
import { isRefused } from '../src/core/save-step.ts';
import { freshSave, newHunter, parseSave } from '../src/core/save.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Running } from '../src/core/combat/fight.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { place } from '../src/core/combat/space.ts';
import { fightId } from '../src/core/ids.ts';
import type { ItemId } from '../src/core/ids.ts';
import { keystoneAwakenedLine } from '../src/core/rules-text.ts';
import { printFormula } from '../src/core/formula.ts';
import { BUILT_IN_JOBS, JOB_NAMES } from '../src/core/registry/jobs.ts';
import { BONUS_KEYS, RULES, rulesOf } from '../src/core/rules.ts';
import type { BonusKey, Rank } from '../src/core/rules.ts';
import { KEYSTONES, keystoneOf } from '../src/core/registry/keystones.ts';
import type { Keystone } from '../src/core/registry/keystones.ts';
import { parsePowers } from '../src/core/registry/powers.ts';
import type { Powers } from '../src/core/registry/powers.ts';
import { itemSpend } from '../src/core/registry/item-budget.ts';
import { SLOTS } from '../src/core/registry/items.ts';
import type { Rarity, Slot } from '../src/core/registry/items.ts';
import { parseItemDef } from '../src/core/registry/item-book.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';
import type { Bonus } from '../src/core/hunter/derive.ts';
import { STAT_KEYS, statsBy } from '../src/core/stats.ts';
import type { StatKey, Stats } from '../src/core/stats.ts';
import { dev, iid, jcid, qid } from './fixtures/ids.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';

const F = KEYSTONES_ON.fight;
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
  const reach = keystoneReach(body({ str: 60, agi: 40 }, 'S'), off);
  expect(reach.stats.every(r => r.next === null)).toBe(true);
  expect(reach.confluence).toBeNull();
  expect(nearestKeystone(reach, off)).toBeNull();
});

test('a stat edited under the base spent no points', () => {
  expect(held({ str: 30, agi: 70, pow: -9 }, 'D')).toEqual([mark('str'), mark('agi')]);
});

test('the sheet\'s reach names each stat\'s share and the next keystone it lacks, with the share and rank it asks', () => {
  const reach = keystoneReach(body({ str: 60, agi: 27, vit: 13 }, 'C'), F);
  expect(reach.totalSpent).toBe(100);
  expect(reach.stats.map(r => r.stat)).toEqual([...STAT_KEYS]);
  expect(reach.stats[0]).toEqual({ stat: 'str', share: 0.6, next: { key: apex('str'), share: 0.55, rank: 'B', shareMet: true, rankMet: false } });
  expect(reach.stats[1]).toEqual({ stat: 'agi', share: 0.27, next: { key: mark('agi'), share: 0.3, rank: 'D', shareMet: false, rankMet: true } });
  expect(reach.stats[7]).toEqual({ stat: 'ctl', share: 0, next: { key: mark('ctl'), share: 0.3, rank: 'D', shareMet: false, rankMet: true } });
  expect(reach.confluence).toBeNull();
  expect(keystoneReach(body({ str: 100 }, 'S'), F).stats[0]).toEqual({ stat: 'str', share: 1, next: null });
});

test('keystoneReach reports what a confluence needs, preferring the job\'s pair when closer or tied', () => {
  const waitingRank = keystoneReach(body({ str: 40, dis: 35, agi: 25 }, 'D'), F);
  expect(waitingRank.confluence).toEqual({
    key: confluence('str', 'dis'), stats: ['str', 'dis'], shares: [0.4, 0.35],
    share: 0.25, rank: 'C', shareMet: true, rankMet: false, fromJob: false,
  });

  const waitingShare = keystoneReach(body({ str: 45, agi: 20, vit: 20, ins: 15 }, 'C'), F);
  expect(waitingShare.confluence).toEqual({
    key: confluence('str', 'agi'), stats: ['str', 'agi'], shares: [0.45, 0.2],
    share: 0.25, rank: 'C', shareMet: false, rankMet: true, fromJob: false,
  });

  const jobPreferred = keystoneReach(body({ str: 45, agi: 20, vit: 20, ins: 15 }, 'C', 'str+vit'), F);
  expect(jobPreferred.confluence).toEqual({
    key: confluence('str', 'vit'), stats: ['str', 'vit'], shares: [0.45, 0.2],
    share: 0.25, rank: 'C', shareMet: false, rankMet: true, fromJob: true,
  });

  expect(keystoneReach(body({}, 'C'), F).confluence).toBeNull();
  expect(keystoneReach(body({}, 'C', 'pow+ctl'), F).confluence).toEqual({
    key: confluence('pow', 'ctl'), stats: ['pow', 'ctl'], shares: [0, 0],
    share: 0.25, rank: 'C', shareMet: false, rankMet: true, fromJob: true,
  });
});

test('nearestKeystone picks a rank-gated keystone before a share-gated one, and returns null when no points are spent', () => {
  expect(nearestKeystone(keystoneReach(body({}, 'D'), F), F)).toBeNull();
  const rankGated = nearestKeystone(keystoneReach(body({ str: 40, dis: 35, agi: 25 }, 'D'), F), F);
  expect(rankGated?.kind).toBe('confluence');
  if (rankGated?.kind === 'confluence') expect(rankGated.reach.key).toEqual(confluence('str', 'dis'));

  const shareMark = nearestKeystone(keystoneReach(body({ str: 27, agi: 20, vit: 20, ins: 20, dis: 13 }, 'D'), F), F);
  expect(shareMark?.kind).toBe('stat');
  if (shareMark?.kind === 'stat') expect(shareMark.next.key).toEqual(mark('str'));

  const shareConfluence = nearestKeystone(keystoneReach(body({ str: 45, agi: 20, vit: 20, ins: 15 }, 'C'), F), F);
  expect(shareConfluence?.kind).toBe('confluence');
  if (shareConfluence?.kind === 'confluence') expect(shareConfluence.reach.key).toEqual(confluence('str', 'agi'));

  const shareApex = nearestKeystone(keystoneReach(body({ str: 52, agi: 48 }, 'B'), F), F);
  expect(shareApex?.kind).toBe('stat');
  if (shareApex?.kind === 'stat') expect(shareApex.next.key).toEqual(apex('str'));
});

test('keystoneDiff lists keystones earned and lost by pending points', () => {
  const before = body({ str: 29, agi: 25, vit: 25, ins: 21 }, 'D');
  const after = body({ str: 31, agi: 25, vit: 25, ins: 21 }, 'D');
  expect(keystoneDiff(before, after, F)).toEqual({ earned: [mark('str')], lost: [] });

  const heldStr = body({ str: 30, agi: 70 }, 'D');
  const diluted = body({ str: 30, agi: 80 }, 'D');
  expect(keystoneDiff(heldStr, diluted, F)).toEqual({ earned: [], lost: [mark('str')] });
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
const NOTHING_WORN = Object.fromEntries(SLOTS.map(s => [s, null])) as Record<Slot, ItemId | null>;
type Hunter = SheetHunter & KeystoneHunter;
const hunter = (o: Partial<Hunter> = {}): Hunter => ({
  stats: built({}), level: 10, rank: 'D', fatigue: 0, penalty: null, hpAdj: 0, manaAdj: 0, titleId: null, titles: [],
  items: [], equipped: NOTHING_WORN, skills: [], conditions: [], job: null, jobDone: null, ...o,
});
const keys = (h: Hunter): readonly KeystoneKey[] => keystonesOf(keystoneBasis(h), F);

test('gear and titles never earn a keystone', () => {
  const short = hunter({ stats: built({ str: 29, agi: 25, vit: 25, ins: 21 }) });
  const geared: Hunter = {
    ...short, titleId: 'wolf', titles: [{ id: 'wolf', bonus: { str: 10 } }],
    items: [{ kind: 'adhoc', id: iid('i1'), qty: 1, item: parseItemDef({ name: 'Knife', rar: 'common', type: 'weapon', slot: 'weapon', dice: '1d4', attack: 'strike', weight: 1, bonus: { str: 10 } })! }],
    equipped: { ...NOTHING_WORN, weapon: iid('i1') },
  };
  expect(hunterSheet(geared, RULES).stats.str).toBe(hunterSheet(short, RULES).stats.str + 20);
  expect(keys(geared)).toEqual([]);
});

test('a point waiting for Confirm counts toward a keystone', () => {
  expect(keys(hunter({ stats: built({ str: 29, agi: 25, vit: 25, ins: 20 }), pending: { str: 1 } }))).toEqual([mark('str')]);
});

test('keystoneConfirmDiff previews keystones earned and lost by confirming pending points', () => {
  const earning = hunter({ stats: built({ str: 29, agi: 25, vit: 25, ins: 21 }), pending: { str: 2 }, rank: 'D' });
  expect(keystoneConfirmDiff(earning, F)).toEqual({ earned: [mark('str')], lost: [] });

  const diluting = hunter({ stats: built({ str: 30, agi: 70 }), pending: { agi: 10 }, rank: 'D' });
  expect(keystoneConfirmDiff(diluting, F)).toEqual({ earned: [], lost: [mark('str')] });

  const settled = hunter({ stats: built({ str: 30, agi: 70 }), rank: 'D' });
  expect(keystoneConfirmDiff(settled, F)).toEqual({ earned: [], lost: [] });
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
  const mage = hunter({ job: 'Mage', rank: 'C' });
  expect(keystoneBasis(mage)).toMatchObject({ pair: 'pow+ctl', awakened: false });
  expect(keystoneBasis({ ...mage, jobDone: 'Mage' }).awakened).toBe(true);
  expect(keystoneBasis({ ...mage, jobDone: 'Fighter' }).awakened, 'another job\'s chain').toBe(false);
  expect(keystoneBasis({ ...mage, job: 'Fighter', jobDone: 'Mage' })).toMatchObject({ pair: 'str+vit', awakened: false });
  expect(keystoneBasis({ ...mage, job: 'Shadow Monarch' })).toMatchObject({ pair: null, awakened: false });
});

test('a hunter who finished its Job Change keeps its awakened powers when the quest is deleted', () => {
  const lastStep = { ...stepQuest('Mage', 3, { chainId: jcid('jc1'), questId: qid('q3'), at: AT, level: 10 }), status: 'done' as const, doneAt: AT, told: true };
  const chain = { id: jcid('jc1'), job: 'Mage' as const, step: 3 as const, status: 'active' as const, questId: qid('q3') };
  const running = { ...newHunter(RULES), rank: 'C' as const, quests: [lastStep], jobChain: chain };
  expect(keystoneBasis(running).awakened, 'a chain still running').toBe(false);
  const finished = chained(running, { type: 'stepCompleted', questId: qid('q3'), level: 10, nextQuestId: qid('q4'), at: AT }).hunter;
  expect([finished.job, finished.jobDone, finished.jobChain]).toEqual(['Mage', 'Mage', null]);
  expect(keystoneBasis(finished).awakened).toBe(true);
  const deleted = deleteQuest(finished, 'q3', 'gm');
  if (isRefused(deleted)) throw new Error('the quest was not deleted');
  expect(deleted.hunter.quests).toEqual([]);
  expect(keystoneBasis(deleted.hunter).awakened).toBe(true);
});

// ── the registry (unit K2): what each keystone does ──
/** Every keystone the registry holds, with its key and the rank its tier is earned at (`RULES.fight.keystone`). */
const EVERY: readonly { readonly key: KeystoneKey; readonly rank: Rank; readonly keystone: Keystone }[] = [
  ...STAT_KEYS.map(stat => ({ key: mark(stat), rank: F.keystone.markRank })),
  ...STAT_PAIRS.map(pair => ({ key: { tier: 'confluence', pair } as const, rank: F.keystone.pairRank })),
  ...STAT_KEYS.map(stat => ({ key: apex(stat), rank: F.keystone.apexRank })),
].map(k => ({ ...k, keystone: keystoneOf(k.key, RULES) }));
const powersOf = (p: Powers): Powers => ({ ...(p.worn ? { worn: p.worn } : {}), ...(p.active ? { active: p.active } : {}) });

describe('the registry of keystones (design A.6)', () => {
  test('every keystone parses as Powers', () => {
    expect(EVERY).toHaveLength(44);
    expect(Object.keys(KEYSTONES.confluence)).toEqual([...STAT_PAIRS]);
    for (const { keystone: k } of EVERY) {
      expect([k.name, parsePowers(k)]).toEqual([k.name, powersOf(k)]);
      if (k.awakened) expect([k.name, parsePowers(k.awakened)]).toEqual([k.name, powersOf(k.awakened)]);
    }
  });

  // Design A.8: a keystone is weighed at its tier's rank and held within its budget, 20% either way. A part worth.ts has
  // no rule for is named, never counted, so a keystone with one is held only from above (the sim, unit K5, holds the
  // rest). The bonus is weighed as an item's (item-budget.ts `itemSpend`, an accessory of the rarity of the tier's rank,
  // whose powers it weighs with `powersSpend`); a bonus on a number no item carries (a shadow) is named too.
  const BAND = 0.2;
  const rarityOf = (rank: Rank): Rarity => (Object.keys(RULES.rarities) as Rarity[]).find(r => RULES.rarities[r].rank === rank)!;
  const isBonusKey = (k: string): k is BonusKey => (BONUS_KEYS as readonly string[]).includes(k);
  function spendOf(p: Powers, bonus: Bonus, rank: Rank): { readonly points: number; readonly unweighed: readonly string[] } {
    const carried = Object.fromEntries(Object.entries(bonus).filter(([k]) => isBonusKey(k)));
    const s = itemSpend({ rar: rarityOf(rank), type: 'accessory', slot: null, dice: '', bonus: carried, armor: 0, resist: 0, ...powersOf(p) }, RULES)!;
    return { points: s.points, unweighed: [...s.unweighed, ...Object.keys(bonus).filter(k => !isBonusKey(k))] };
  }

  test('every keystone spends within its tier\'s budget', () => {
    const rows = EVERY.flatMap(({ key, rank, keystone: k }) => {
      const budget = F.keystone.budget[key.tier];
      const own = { name: k.name, budget, ...spendOf(k, k.bonus, rank) };
      // An awakened confluence adds at most a second confluence: its powers are held to the confluence's budget.
      return k.awakened ? [own, { name: `${k.name}, awakened`, budget, ...spendOf(k.awakened, {}, rank) }] : [own];
    });
    expect(rows.filter(r => r.points > r.budget * (1 + BAND)).map(r => [r.name, r.points])).toEqual([]);
    expect(rows.filter(r => !r.unweighed.length && r.points < r.budget * (1 - BAND)).map(r => [r.name, r.points])).toEqual([]);
  });

  test('every pair a job names (plus awakened Mythic confluences) is awakened, and no other keystone is', () => {
    const named = new Set([...JOB_NAMES.map(j => BUILT_IN_JOBS[j].pair), 'pre+pow', 'vit+pow', 'str+agi', 'ins+ctl']);
    for (const { key, keystone: k } of EVERY) {
      const awakens = key.tier === 'confluence' && named.has(key.pair);
      expect([k.name, k.awakened !== null]).toEqual([k.name, awakens]);
    }
  });

  test('Worldbreaker deals physical strike damage alongside its smaller stagger share within the apex budget', () => {
    const wb = keystoneOf(apex('str'), RULES);
    expect(wb.name).toBe('Worldbreaker');
    expect(wb.active?.name).toBe('Shatter');
    expect(wb.active?.effect?.type).toBe('physical');
    expect(wb.active?.ops).toEqual([{ op: 'stagger', share: 0.15 }]);
    expect(wb.active?.cost.cooldown).toBe(tick(6 * RULES.fight.round));
    const spend = spendOf(wb, wb.bonus, F.keystone.apexRank);
    expect(spend.unweighed).toEqual([]);
    expect(spend.points).toBeGreaterThanOrEqual(F.keystone.budget.apex * (1 - BAND));
    expect(spend.points).toBeLessThanOrEqual(F.keystone.budget.apex * (1 + BAND));
  });

  test('Riposte scales off finesse power in both base and awakened triggers', () => {
    const r = keystoneOf(confluence('agi', 'ins'), RULES);
    expect(r.name).toBe('Riposte');
    const baseOp = r.worn?.triggers?.[0]?.ops[0];
    const awakeOp = r.awakened?.worn?.triggers?.[0]?.ops[0];
    expect(baseOp?.op === 'damage' ? printFormula(baseOp.amount as Exclude<typeof baseOp.amount, readonly unknown[]>) : '').toBe('0.4 * finesse');
    expect(awakeOp?.op === 'damage' ? printFormula(awakeOp.amount as Exclude<typeof awakeOp.amount, readonly unknown[]>) : '').toBe('4 * finesse');
    const baseSpend = spendOf(r, r.bonus, F.keystone.pairRank);
    const awakeSpend = spendOf(r.awakened!, {}, F.keystone.pairRank);
    expect(baseSpend.unweighed).toEqual([]);
    expect(awakeSpend.unweighed).toEqual([]);
    expect(baseSpend.points).toBeGreaterThanOrEqual(F.keystone.budget.confluence * (1 - BAND));
    expect(baseSpend.points).toBeLessThanOrEqual(F.keystone.budget.confluence * (1 + BAND));
    expect(awakeSpend.points).toBeGreaterThanOrEqual(F.keystone.budget.confluence * (1 - BAND));
    expect(awakeSpend.points).toBeLessThanOrEqual(F.keystone.budget.confluence * (1 + BAND));
  });

  test('Shadowbound replaces Conduit for pre+pow Necromancers with shadow capacity, mana harvest, and awakened Call Shadow', () => {
    const sb = keystoneOf(confluence('pre', 'pow'), RULES);
    expect(sb.name).toBe('Shadowbound');
    expect(sb.bonus).toEqual({ shadows: 1, manaMax: 5 });
    expect(sb.worn?.triggers?.[0]).toMatchObject({ on: 'kill', to: 'self', limit: { kind: 'round' } });
    expect(sb.awakened?.active?.name).toBe('Call Shadow');
    expect(sb.awakened?.active?.cost.mana).toBe(0);
    expect(sb.awakened?.active?.gates).toEqual([{ kind: 'uses', per: 'fight', n: 1 }]);
    expect(sb.awakened?.active?.summon).toEqual({ name: 'Shadow Soldier', archetype: 'brute', rounds: RULES.fight.kit.summonRounds, statuses: [] });
    expect(keystoneAwakenedLine(sb)).toBe(`Once a fight, you can use Call Shadow to summon a same-rank Shadow Soldier for ${RULES.fight.kit.summonRounds} rounds.`);
    // Follows GM override on fight.kit.summonRounds
    const longer = keystoneOf(confluence('pre', 'pow'), rulesOf({ fight: { kit: { summonRounds: 5 } } }));
    expect(longer.awakened?.active?.summon?.rounds).toBe(5);
    expect(keystoneAwakenedLine(longer)).toContain('for 5 rounds.');
  });

  test('an old save with an active fight holding legacy Conduit worn statuses loads cleanly and fresh fights use Shadowbound', () => {
    const env = { now: new Date(AT), newDeviceToken: () => 'tok-0123456789abcdef0123456789ab', newDeviceId: () => dev('d-old') };
    const base = freshSave(env, { onboarded: true });
    const necro = {
      ...base.hunters[0]!, name: 'Sung', rank: 'C' as const, level: 20, job: 'Necromancer', jobDone: 'Necromancer',
      classes: { Necromancer: { unlockedAt: AT, nodes: [], registryId: base.classHolders.registryId, grantId: 'cg-ks' } },
      stats: built({ pre: 46, pow: 23 }),
    };
    // Build a row holding legacy Conduit worn statuses as an older version would have serialized into Save.fight
    const freshRow = hunterRow(necro, combatantId('h1'), KEYSTONES_ON);
    expect(freshRow.statuses.some(s => s.def.label === 'Shadowbound')).toBe(true);
    expect(freshRow.abilities.some(a => a.name === 'Call Shadow')).toBe(true);
    const legacyRow = {
      ...freshRow,
      statuses: [
        ...freshRow.statuses.filter(s => s.def.label !== 'Shadowbound'),
        { key: statusKey('conduit'), source: { id: combatantId('h1'), tier: 2 }, until: null, since: tick(0), settledAt: tick(0), worn: true as const,
          def: { label: 'Conduit', desc: 'Legacy healer confluence.', ops: [] } },
        { key: statusKey('conduit-awakened'), source: { id: combatantId('h1'), tier: 2 }, until: null, since: tick(0), settledAt: tick(0), worn: true as const,
          def: { label: 'Conduit, awakened', desc: 'Legacy awakened confluence.', ops: [] } },
      ],
    };
    const fight = reduce(null, { type: 'add', fightId: fightId('f-old'), rows: [legacyRow], openings: [] }, { rules: KEYSTONES_ON }).fight!;
    const raw = JSON.stringify({ ...base, hunters: [necro], fight, rulesOverrides: { fight: { keystone: { on: true } } } });
    const loaded = parseSave(raw, env);
    expect(loaded.kind).toBe('save');
    if (loaded.kind !== 'save') throw new Error('expected save to parse');
    const loadedFight = parseFight(loaded.save.fight, KEYSTONES_ON);
    expect(loadedFight?.rows[0]?.statuses.some(s => s.def.label === 'Conduit')).toBe(true);
    expect(loadedFight?.rows[0]?.statuses.some(s => s.def.label === 'Conduit, awakened')).toBe(true);
    // Outside the legacy fight, the sheet and next fight use Shadowbound (+1 shadow, +5 max mana)
    const sheet = hunterSheet(loaded.save.hunters[0]!, KEYSTONES_ON).sheet;
    const withoutKs = hunterSheet(loaded.save.hunters[0]!, RULES).sheet;
    expect(sheet.shadows).toBe(withoutKs.shadows + 1);
    expect(sheet.manaMax).toBe(withoutKs.manaMax + 5);
    expect(Number(sheet.healPower)).toBe(0);
  });

  test('Slip Away actually moves the dodger\'s next turn 33% sooner on an avoided attack', () => {
    const h = { ...newHunter(KEYSTONES_ON), rank: 'D' as const, level: 10, stats: built({ agi: 40, str: 30, vit: 30 }) };
    const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
    expect(hRow.statuses.some(s => s.def.label === 'Slip Away')).toBe(true);
    const foe = monsterRows({ name: 'Brute', rank: 'D', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    const heavySwing: Ability = {
      ...foe.abilities[0]!,
      delivery: { kind: 'travel', windup: tick(500), speed: 'instant' },
    };
    let f = reduce(null, {
      type: 'add',
      fightId: fightId('f-slip-away'),
      rows: [{ ...hRow, place: place(3, 3) }, { ...foe, place: place(4, 3), abilities: [heavySwing] }],
      openings: [],
    }, { rules: KEYSTONES_ON }).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('m1'), d20: 20, tie: 2 }, { id: combatantId('h1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');
    const wait = 600;
    const ready: Running = {
      ...f,
      rows: f.rows.map(x => (x.id === combatantId('h1') ? { ...x, at: tick(f.now + wait) } : x)),
    };
    let r = reduce(ready, {
      type: 'act',
      by: combatantId('m1'),
      ability: heavySwing.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [4] }, react: { [combatantId('h1')]: 20 } },
      force: true,
    }, { rules: KEYSTONES_ON });
    expect(r.effects.some(e => e.type === 'dodgeAsked')).toBe(true);
    r = reduce(r.fight, { type: 'dodge', id: combatantId('h1'), to: place(2, 3) }, { rules: KEYSTONES_ON });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const after = (r.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    expect(after.at).toBe(tick(ready.now + wait - Math.round(wait * 33 / 100)));
    expect(after.at).toBeLessThan(tick(ready.now + wait));
  });
});
