// The relationships the numbers in src/core/rules.ts must keep. No number is pinned here: a rank, rarity or slot added
// in one table and forgotten in another fails, and so does a column that stops rising with rank.
import { describe, expect, test } from 'bun:test';
import { parseOverrides } from '../src/core/overrides.ts';
import { canExtract, rewardJobs, BONUS_HUNDREDTHS, BONUS_KEYS, BONUS_LABELS, RANKS, RULES, rulesOf, TIERS, featsSwitched, resetRuleNumbers, tradeRuleSet, resetTable, saveRuleNumbers, writeTable } from '../src/core/rules.ts';
import { RANKS as SAVE_RANKS, RARITIES, SLOTS } from '../src/core/save.ts';
import { JOB_NAMES } from '../src/core/registry/jobs.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import { SHEET_LABELS } from '../src/core/hunter/derive.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';

const rising = (xs: number[]): boolean => xs.every((x, i) => i === 0 || x > xs[i - 1]!);
const falling = (xs: number[]): boolean => xs.every((x, i) => i === 0 || x < xs[i - 1]!);
const keys = (o: object): string[] => Object.keys(o).sort();

test('the rules and the save name the same ranks, rarities and slots, in the same order', () => {
  expect([...RANKS]).toEqual([...SAVE_RANKS]);
  expect(TIERS).toEqual([...RARITIES]);
  expect([...RULES.slots]).toEqual([...SLOTS]);
});

test('every table by rank has a row for every rank', () => {
  const byRank = { rankLevels: RULES.rankLevels, rankBonus: RULES.rankBonus, rankColors: RULES.rankColors, rankTable: RULES.rankTable, loot: RULES.loot, summonMp: RULES.shadow.summonMp, spawnWeight: RULES.gateSpawn.rank };
  for (const [name, table] of Object.entries(byRank)) expect([name, keys(table)]).toEqual([name, [...RANKS].sort()]);
});

test('a higher rank needs a higher level, starting at level 1, and gives a larger proficiency bonus', () => {
  expect(RULES.rankLevels.E).toBe(1);
  expect(rising(RANKS.map(r => RULES.rankLevels[r]))).toBe(true);
  expect(rising(RANKS.map(r => RULES.rankBonus[r]))).toBe(true);
});

test('a higher rank has harder checks and more XP, and its gate breaks sooner', () => {
  const rows = RANKS.map(r => RULES.rankTable[r]);
  expect(rising(rows.map(x => x.xp))).toBe(true);
  for (const i of [0, 1, 2]) expect(['dc', i, rising(rows.map(x => x.dc[i]!))]).toEqual(['dc', i, true]);
  for (const x of rows) expect(rising(x.dc)).toBe(true); // easy, medium, hard
  expect(falling(rows.map(x => x.breakDays))).toBe(true);
  expect(rows.at(-1)!.breakDays).toBeGreaterThanOrEqual(1);
});

test('an elite is worth more XP than a normal monster of its rank, a boss more than an elite, as the old factors gave', () => {
  const k = RULES.fight.kinds;
  expect([k.normal.xp, k.elite.xp, k.boss.xp]).toEqual([1, 1.5, 3]);
});

test('a bonus adds to a stat or to a sheet number derive adds it to, never to weight, armor, resist, sight, stride, shadows or a power (the owner, Nov 21), and every key has its words', () => {
  const sheetKeys = Object.keys(SHEET_LABELS);
  expect(BONUS_KEYS.slice(0, STAT_KEYS.length)).toEqual([...STAT_KEYS]);
  expect(BONUS_KEYS.slice(STAT_KEYS.length).filter(k => !sheetKeys.includes(k))).toEqual([]);
  expect(sheetKeys.filter(k => !(BONUS_KEYS as readonly string[]).includes(k)).sort()).toEqual(['armor', 'mag', 'phys', 'resist', 'shadows', 'sight', 'stride', 'sup', 'weight']);
  expect(Object.keys(BONUS_LABELS).sort()).toEqual([...BONUS_KEYS].sort());
  expect([BONUS_LABELS.armorPenFlat, BONUS_LABELS.resistPenFlat]).toEqual(['Flat armor penetration', 'Flat magic penetration']);
  expect([BONUS_LABELS.healPower, BONUS_LABELS.shieldDrain]).toEqual(['% Heal and shield power', '% Damage to shield']);
  expect([...BONUS_HUNDREDTHS].sort()).toEqual(['costCut', 'critSize', 'drain', 'healPower', 'hold', 'shieldDrain', 'threat']);
  for (const t of RULES.titles) for (const k of Object.keys(t.bonus)) expect([t.name, (BONUS_KEYS as readonly string[]).includes(k)]).toEqual([t.name, true]);
});

test('the built-in titles add to the stat the old one mapped to', () => {
  // The stat map of plan section 3: dex Agility, int Power, cha Presence.
  const bonus = (name: string) => RULES.titles.find(t => t.name === name)!.bonus;
  expect([bonus('Wolf Slayer'), bonus('Demon Hunter'), bonus('The One Who Hunts Alone'), bonus('King of Shadows')])
    .toEqual([{ str: 2 }, { pre: 2 }, { agi: 2 }, { pow: 5 }]);
});

test('a rarer item is worth more: each rarity is priced by a higher rank than the one before it', () => {
  expect(rising(RARITIES.map(r => RANKS.indexOf(RULES.rarities[r].rank)))).toBe(true);
});

test('loot names only rarities that exist, and a higher rank drops more gold', () => {
  for (const r of RANKS) {
    for (const rar of Object.keys(RULES.loot[r].weights)) expect([r, TIERS.includes(rar)]).toEqual([r, true]);
    const [lo, hi] = RULES.loot[r].gold;
    expect(lo!).toBeLessThan(hi!);
  }
  expect(rising(RANKS.map(r => RULES.loot[r].gold[0]!))).toBe(true);
  expect(rising(RANKS.map(r => RULES.loot[r].gold[1]!))).toBe(true);
});

test('fatigue gives its penalty, then disadvantage, then collapse, and a rest from a collapse leaves fatigue under the collapse share', () => {
  const f = RULES.fatigue;
  expect(0 < f.penaltyAt && f.penaltyAt < f.disAt && f.disAt < f.collapseAt).toBe(true);
  // "exhausted will largely clear" (the owner, Nov 22): fatigue at the collapse share, less the rest's share of it, is under the share
  expect(f.collapseAt * (1 - RULES.rest.fatigue)).toBeLessThan(f.collapseAt);
});

test('a higher-ranked shadow costs more MP to summon', () => {
  expect(rising(RANKS.map(r => RULES.shadow.summonMp[r]))).toBe(true);
});

test('the jobs the rules list are the jobs a Job Change chain can grant', () => {
  expect([...RULES.jobs].sort()).toEqual([...JOB_NAMES].sort());
});

test('a hunter can extract shadows exactly while their job is one the rules name, a GM-added job included', () => {
  expect(canExtract(RULES, 'Necromancer')).toBe(true);
  expect(canExtract(RULES, 'Fighter')).toBe(false);
  expect(canExtract(rulesOf({ extractJobs: ['Necromancer', 'Shadow Monarch', 'Fighter'] }), 'Fighter')).toBe(true);
});

test('an override of one rank\'s bonus keeps every other rank\'s, so no reader needs a default of its own (implicit audit 3, H7)', () => {
  const R = rulesOf({ rankBonus: { E: 9 } });
  expect(RANKS.map(r => R.rankBonus[r])).toEqual(RANKS.map(r => (r === 'E' ? 9 : RULES.rankBonus[r])));
});

test('a reward may name every job a hunter can hold: the rules\' jobs, then an extract job they lack, each once, a GM\'s too (implicit audit 3, R2)', () => {
  expect(rewardJobs(RULES)).toEqual([...RULES.jobs, 'Shadow Monarch']);
  expect(rewardJobs(rulesOf({ extractJobs: ['Necromancer', 'Lich King'] }))).toEqual([...RULES.jobs, 'Lich King']);
});

test('the GM\'s statuses lie over the built-ins: a custom key adds a status, a built-in key replaces that built-in whole', () => {
  const ember: StatusDef = { label: 'Ember Mark', desc: 'Marked by embers.', ops: [{ op: 'damage', type: 'magical', amount: { kind: 'dice', count: 1, sides: 6 } }] };
  const venom: StatusDef = { label: 'Venom', desc: 'Stings.', ops: [] };
  const R = rulesOf({}, { 'ember-mark': ember, poisoned: venom });
  expect(R.conditions['ember-mark' as keyof typeof R.conditions]).toEqual(ember);
  expect(R.conditions.poisoned).toEqual(venom);
  expect(R.conditions.burning).toEqual(RULES.conditions.burning);
  expect(keys(R.conditions)).toEqual(keys({ ...RULES.conditions, 'ember-mark': ember }));
});

test('with no statuses of the GM\'s the built-ins are the conditions, and rule numbers still merge', () => {
  expect(rulesOf({}, {}).conditions).toEqual(RULES.conditions);
  const R = rulesOf({ xpPerLevel: 200 }, { 'ember-mark': { label: 'Ember Mark', desc: '', ops: [] } });
  expect(R.xpPerLevel).toBe(200);
  expect(R.fatigue).toEqual(RULES.fatigue);
});

test('a valid override survives parseOverrides as written, nested ones included', () => {
  const ov = { xpPerLevel: 200, fatigue: { penaltyAt: 40 }, levelUpRestore: false, jobs: ['Fighter', 'Bard'], rarities: { common: { color: '#ffffff' } } };
  expect(parseOverrides(ov)).toEqual({ overrides: ov, refused: [] });
});

test('XP split is no rule now (a world gate\'s XP is shared by its party): a GM\'s old override of it is refused as unknown', () => {
  expect(parseOverrides({ xpSplit: true, xpPerLevel: 200 })).toEqual({ overrides: { xpPerLevel: 200 }, refused: [{ path: 'xpSplit', reason: 'unknown' }] });
});

test('an unknown rule is refused and left out, and the rest is kept', () => {
  expect(parseOverrides({ xpPerLevel: 200, luck: 7, fatigue: { perWis: 2, disAt: 70 } })).toEqual({
    overrides: { xpPerLevel: 200, fatigue: { disAt: 70 } },
    refused: [{ path: 'luck', reason: 'unknown' }, { path: 'fatigue.perWis', reason: 'unknown' }],
  });
});

test('a value of another type than its rule is refused: a number, a list, an object, true or false, text', () => {
  const { overrides, refused } = parseOverrides({ xpPerLevel: '200', jobs: 'Fighter', fatigue: 4, levelUpRestore: 'yes', dailyTemplate: { title: 5 }, logCap: Infinity });
  expect(overrides).toEqual({ dailyTemplate: {} });
  expect(refused).toEqual([
    { path: 'xpPerLevel', reason: 'number' }, { path: 'jobs', reason: 'list' }, { path: 'fatigue', reason: 'object' },
    { path: 'levelUpRestore', reason: 'boolean' }, { path: 'dailyTemplate.title', reason: 'text' }, { path: 'logCap', reason: 'number' },
  ]);
});

test('a rule the new fight removed is refused at load and left out: a monster\'s HP, AC, attack, damage and initiative by rank, the boss and elite factors, the shadow capacity stat, the old max HP and MP formulas', () => {
  const { overrides, refused } = parseOverrides({
    rankTable: { E: { hp: 30, ac: 14, atk: 5, dmg: '1d8', init: 2, xp: 30 } }, boss: { hp: 4 }, elite: { xp: 2 }, shadow: { capacityStat: 'cha', maxAttempts: 4 },
    hp: { base: 6 }, mp: { perInt: 2 },
  });
  expect(overrides).toEqual({ rankTable: { E: { xp: 30 } }, shadow: { maxAttempts: 4 } });
  expect(refused).toEqual([
    { path: 'rankTable.E.hp', reason: 'unknown' }, { path: 'rankTable.E.ac', reason: 'unknown' }, { path: 'rankTable.E.atk', reason: 'unknown' },
    { path: 'rankTable.E.dmg', reason: 'unknown' }, { path: 'rankTable.E.init', reason: 'unknown' }, { path: 'boss', reason: 'unknown' },
    { path: 'elite', reason: 'unknown' }, { path: 'shadow.capacityStat', reason: 'unknown' }, { path: 'hp', reason: 'unknown' },
    { path: 'mp', reason: 'unknown' },
  ]);
});

test('statuses are refused in the overrides: they are made in the Status dialog and kept in the library', () => {
  expect(parseOverrides({ conditions: { poisoned: { label: 'Venom' } } })).toEqual({ overrides: {}, refused: [{ path: 'conditions', reason: 'statuses' }] });
});

test('what is not an object is refused whole, and a __proto__ key is an unknown rule', () => {
  for (const v of [null, 5, 'x', [1]]) expect(parseOverrides(v)).toEqual({ overrides: {}, refused: [{ path: '', reason: 'object' }] });
  const { overrides, refused } = parseOverrides(JSON.parse('{"__proto__": {"xpPerLevel": 1}, "fatigue": {"__proto__": {"disAt": 1}}}'));
  expect(Object.getPrototypeOf(overrides)).toBe(Object.prototype);
  expect(refused.map(r => r.path)).toEqual(['__proto__', 'fatigue.__proto__']);
});

test('every override the roll tables and the Build panel write passes unchanged, and rulesOf reads it', () => {
  const ov = {
    gateNames: ['Ash Pit', 'Bone Hall'],
    gmTables: { whisper: ['A cold wind.'], urgent: ['Save the miners'], encounter: { E: ['2 goblins'], S: ['A dragon'] } },
    build: { enabled: false, playerPick: false, respecGold: 9 },
    paths: { vanguard: { name: 'Bulwark', tiers: [[{ str: 3 }, { vit: 3 }]] } },
  };
  expect(parseOverrides(ov)).toEqual({ overrides: ov, refused: [] });
  const R = rulesOf(parseOverrides(ov).overrides);
  expect(R.gateNames).toEqual(['Ash Pit', 'Bone Hall']);
  expect(R.build).toEqual({ enabled: false, playerPick: false, respecGold: 9 });
  expect(R.paths.vanguard.name).toBe('Bulwark');
});

test('a GM\'s override of a fight number passes, a wrong one is refused, and the rest of the fight keeps its numbers', () => {
  const { overrides, refused } = parseOverrides({ fight: { hpBase: 60, kinds: { boss: { hp: 5 } }, luck: 3, round: '1000' } });
  expect(overrides).toEqual({ fight: { hpBase: 60, kinds: { boss: { hp: 5 } } } });
  expect(refused).toEqual([{ path: 'fight.luck', reason: 'unknown' }, { path: 'fight.round', reason: 'number' }]);
  const R = rulesOf(overrides);
  expect([R.fight.hpBase, R.fight.kinds.boss, R.fight.round]).toEqual([60, { ...RULES.fight.kinds.boss, hp: 5 }, 1000]);
});

describe('the kits\' rules (kits design 1.11, 3 and 8.0)', () => {
  const K = RULES.fight.kit;

  test('the caps keep the relations their reasons give: a field reads three bodies at the cap, an op adds less than a cap, an HP price is a share under a whole life', () => {
    expect(K.fieldStacks).toBe(3 * K.stackCap);
    expect(K.stackAdd).toBeLessThan(K.stackCap);
    expect(0 < K.hpShareMin && K.hpShareMin < K.hpShare && K.hpShare < 1).toBe(true);
    expect(K.triggerOps).toBeLessThanOrEqual(12); // an item's effects list, of which a trigger is half
    expect(K.fires).toBe(K.triggers * K.triggers); // every trigger of a user's four statuses, once
    for (const n of [K.stackCap, K.stackAdd, K.triggers, K.triggerOps, K.depth, K.fires, K.fightUses, K.prices, K.gates, K.tags, K.zonesPerOwner, K.summons, K.summonRounds, K.kills, K.held, K.hits]) {
      expect(Number.isInteger(n) && n >= 1).toBe(true);
    }
  });

  test('a scaler at its cap doubles a hit, as a crit at its largest does, and its suggested start lies strictly inside a share\'s and a pair\'s ends', () => {
    expect(1 + K.scaleCap).toBe(RULES.fight.critSizeBase + RULES.fight.critSizeCap);
    const pairLow = 1 / (1 + K.pairFull), pairHigh = K.pairFull / (1 + K.pairFull);
    expect(0 < K.scalerStart && K.scalerStart < 1).toBe(true);
    expect(pairLow < K.scalerStart && K.scalerStart < pairHigh).toBe(true);
    expect(K.scalerStep > 0 && K.scaleCap / K.scalerStep === Math.round(K.scaleCap / K.scalerStep)).toBe(true);
  });

  test('the reference dungeon: at E, C and S a boss takes longer than a pack, outweighs its user more than a normal brute does, and a pair is whole past a boss at E and C', () => {
    expect(Object.keys(K.reference)).toEqual(['E', 'C', 'S']);
    for (const [rank, r] of Object.entries(K.reference)) {
      expect([rank, r.boss > r.pack]).toEqual([rank, true]);
      for (const body of [r.medium, r.light]) expect([rank, body.normal < 1, body.boss > body.normal]).toEqual([rank, true, true]);
    }
    for (const r of [K.reference.E, K.reference.C]) expect(Math.max(r.medium.boss, r.light.boss)).toBeLessThanOrEqual(K.pairFull);
  });

  test('the maker\'s tolerance is under the triangle\'s closest margin on paper, 1.081 at C (kits-paper table 3.1)', () => {
    expect(K.tolerance).toBeGreaterThan(0);
    expect(1 + K.tolerance).toBeLessThan(1.081);
  });

  test('wave 2\'s caps keep their reasons (kits table 8.1): a ward a round, a shove half a walk, a crit at most double and 6 faces', () => {
    const F = RULES.fight;
    expect(K.wardRounds).toBe(1);
    expect(K.shoveMax).toBe(Math.round(100 / F.moveCost / 2));
    expect(K.critSizeMax).toBe(F.critSizeBase + F.critSizeCap);
    expect(K.critFacesMax).toBe(6);
    expect(K.costCutMax).toBe(F.costCutCap);
    expect(K.blinkMax).toBe(F.abilityKinds.curse.range);
    expect(K.rangeAdd + F.abilityKinds.curse.range).toBeLessThan(F.abilityKinds.shot.range);
    expect(1 - K.shareCap > 0 && 1 + K.shareCap <= 1.5).toBe(true);
    expect(K.zoneGrow).toBeLessThanOrEqual(F.fieldRadiusMax);
    expect(K.parry > 0 && K.parry < 0.5).toBe(true);
    expect(K.doArmed).toBe(12);
    for (const n of [K.boostSides, K.shoveMax, K.blinkMax, K.reactionsPerUse, K.zoneMove, K.zoneGrow, K.extraPerRound, K.surprise]) expect(Number.isInteger(n) && n >= 1).toBe(true);
  });

  test('damage to shield holds at most a fifth of max HP: on a C bruiser (101 HP, table 2.3.C) 20, under one of its swings on a C skirmisher, 29 (design 3.A)', () => {
    expect(K.shieldDrainMax).toBe(1 / 5);
    expect(Math.round(K.shieldDrainMax * 101)).toBe(20);
    expect(Math.round(K.shieldDrainMax * 101)).toBeLessThanOrEqual(29);
  });

  test('a GM\'s override of a kit number passes and the fight reads it; a kit rule that does not exist is refused', () => {
    const { overrides, refused } = parseOverrides({ fight: { kit: { zonesPerOwner: 5, tolerance: 0.15, luck: 1 } } });
    expect(overrides).toEqual({ fight: { kit: { zonesPerOwner: 5, tolerance: 0.15 } } });
    expect(refused).toEqual([{ path: 'fight.kit.luck', reason: 'unknown' }]);
    const R = rulesOf(overrides);
    expect([R.fight.kit.zonesPerOwner, R.fight.kit.tolerance, R.fight.kit.stackCap]).toEqual([5, 0.15, RULES.fight.kit.stackCap]);
  });
});

test('a roll table keeps only its lines of text: 200 lines of 300 characters at most', () => {
  const { overrides } = parseOverrides({ gmTables: { whisper: ['ok', 5, 'x'.repeat(400), ...Array(300).fill('line')], encounter: { E: ['a'], Z: ['b'] } } });
  const t = overrides.gmTables as { whisper: string[]; encounter: Record<string, string[]> };
  expect(t.whisper).toHaveLength(200);
  expect(t.whisper.slice(0, 2)).toEqual(['ok', 'x'.repeat(300)]);
  expect(t.encounter).toEqual({ E: ['a'] });
});

describe('the GM\'s edits of the overrides', () => {
  test('round trip: a roll table written then reset is the overrides it was, and the other tables stay', () => {
    const ov = { gmTables: { loot: ['old'] }, xpPerLevel: 120 };
    for (const [table, rank] of [['gate', 'E'], ['encounter', 'C'], ['names', 'E']] as const) {
      expect(resetTable(writeTable(ov, table, rank, ['a', 'b']), table, rank)).toEqual(table === 'encounter' ? { ...ov, gmTables: { ...ov.gmTables, encounter: {} } } : ov);
    }
    expect(writeTable(ov, 'encounter', 'C', ['x'])).toEqual({ ...ov, gmTables: { loot: ['old'], encounter: { C: ['x'] } } });
    expect(writeTable(ov, 'gate', 'E', ['Gate'])).toEqual({ ...ov, gateNames: ['Gate'] });
  });
  test('saving or resetting the rule numbers keeps the GM\'s roll tables', () => {
    const ov = { gmTables: { loot: ['x'] }, xpPerLevel: 120 };
    expect(saveRuleNumbers(ov, { logCap: 50 })).toEqual({ logCap: 50, gmTables: { loot: ['x'] } });
    expect(resetRuleNumbers(ov)).toEqual({ gmTables: { loot: ['x'] } });
    expect(resetRuleNumbers({ xpPerLevel: 1 })).toEqual({});
  });
  test('the GM\'s switch for feats turns them all off and on, and keeps every other override', () => {
    const ov = { gmTables: { loot: ['x'] }, xpPerLevel: 120 };
    const off = featsSwitched(ov, false);
    expect(off).toEqual({ gmTables: { loot: ['x'] }, xpPerLevel: 120, feats: { on: false } });
    expect(rulesOf(off).feats.on, 'the rules read the switch off').toBe(false);
    expect(rulesOf(featsSwitched(off, true)).feats.on).toBe(true);
    expect(RULES.feats.on, 'feats are on until the GM turns them off').toBe(true);
    expect(parseOverrides(off).refused, 'the rules editor reads what the switch wrote').toEqual([]);
  });
  test('the GM\'s switch for trading turns it off and on, and keeps every other override', () => {
    const save = { rulesOverrides: { gmTables: { loot: ['x'] }, xpPerLevel: 120 }, other: 1 };
    const off = tradeRuleSet(save, false);
    expect(off).toEqual({ rulesOverrides: { gmTables: { loot: ['x'] }, xpPerLevel: 120, trade: { on: false } }, other: 1 });
    expect(rulesOf(off.rulesOverrides).trade.on, 'the rules read the switch off').toBe(false);
    expect(rulesOf(tradeRuleSet(off, true).rulesOverrides).trade.on).toBe(true);
    expect(RULES.trade.on, 'trading is on until the GM turns it off').toBe(true);
    expect(parseOverrides(off.rulesOverrides).refused, 'the rules editor reads what the switch wrote').toEqual([]);
  });
});
