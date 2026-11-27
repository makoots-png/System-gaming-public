// Unit tests for src/core/gates/party-scale.ts, src/core/party.ts defaultParty, and reducer start sizing in fight.ts:
// weighted headcount table, pinned 3-hunter 1/1 anchor, fractional interpolation, separate boss vs pack curves,
// defaultParty filtering, reducer sizing at start with locked sizedFor, parseFight round-trip, and plain copy.
import { describe, expect, test } from 'bun:test';
import { RANKS, RULES, rulesOf } from '../src/core/rules.ts';
import { freshSave, makeHunter } from '../src/core/save.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { hunterRow, monsterRows, npcRows, remoteRow, shadowRow, summonRow } from '../src/core/combat/rows.ts';
import { reduce } from '../src/core/combat/fight.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { newNpc, npcTierPreset, parseNpc } from '../src/core/registry/npcs.ts';
import { difficultyFactor, scaleRowMonster, withDifficulty } from '../src/core/gates/difficulty.ts';
import {
  PARTY_SCALE_WORDS,
  combineScales,
  gateFoeScale,
  gateNpcHeadcountRows,
  partyHeadcount,
  partyScaleFactor,
  scaleMonsterForParty,
  scaleNpcForParty,
} from '../src/core/gates/party-scale.ts';
import type { HeadcountRow } from '../src/core/gates/party-scale.ts';
import { RECENT_POLL_MS, defaultParty, serverNowMs } from '../src/core/party.ts';
import { gainXp } from '../src/core/hunter/progress.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { fightId, parseSheetKey, seedId } from '../src/core/ids.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-27T10:00:00.000Z';
const ENV = {
  now: new Date(AT),
  newDeviceToken: () => 'test-device-token-0123456789abcd',
  newDeviceId: () => dev('d-ps'),
};

function realRows() {
  const s = freshSave(ENV, { onboarded: true });
  const h1 = makeHunter({ seq: 1, settings: s.settings }, 'Mira', RULES, new Date(AT)).hunter;
  const h2 = makeHunter({ seq: 2, settings: s.settings }, 'Kade', RULES, new Date(AT)).hunter;
  const local = hunterRow(h1, combatantId('h-local'), RULES);
  const remoteKey = parseSheetKey(`${dev('d-rem')}:${h2.id}`)!;
  const remote = remoteRow({ ...h2, name: 'Remote Kai' }, remoteKey, combatantId('h-rem'), RULES);
  const supportTpl = newNpc({ name: 'Support Guide', rank: 'E', archetype: 'brute', ...npcTierPreset('support', RULES), defaultSide: 'party', skill: 3 }, RULES);
  const standardTpl = parseNpc({ name: 'Standard Guide', rank: 'E', archetype: 'brute', tier: 'normal', defaultSide: 'party', skill: 3 })!;
  const eliteTpl = newNpc({ name: 'Elite Guide', rank: 'E', archetype: 'brute', ...npcTierPreset('elite', RULES), defaultSide: 'party', skill: 3 }, RULES);
  const bossTpl = newNpc({ name: 'Boss Guide', rank: 'E', archetype: 'brute', ...npcTierPreset('boss', RULES), defaultSide: 'party', skill: 3 }, RULES);
  const foeTpl = parseNpc({ name: 'Rival Raider', rank: 'E', archetype: 'skirmisher', tier: 'normal', defaultSide: 'foe', skill: 3 })!;
  const supportAlly = npcRows(supportTpl, [combatantId('npc-sup')], RULES)[0]!;
  const standardAlly = npcRows(standardTpl, [combatantId('npc-std')], RULES)[0]!;
  const eliteAlly = npcRows(eliteTpl, [combatantId('npc-elt')], RULES)[0]!;
  const bossAlly = npcRows(bossTpl, [combatantId('npc-bss')], RULES)[0]!;
  const foeNpc = npcRows(foeTpl, [combatantId('npc-foe')], RULES)[0]!;
  const goblin = seedMonsters(RULES).find(m => m.id === seedId<'m'>('goblin'))!;
  const foeMon = monsterRows(goblin, [combatantId('m-1')], RULES)[0]!;
  const partyShadow = shadowRow({ id: 'sh-1', name: 'Igris', rank: 'E', archetype: 'brute', grade: 'Normal', hp: 20 }, h1.id, local.id, combatantId('sh-row'), RULES);
  const partySummon = summonRow({ id: local.id, side: 'party', tier: 0 }, { name: 'Wolf', archetype: 'skirmisher', rounds: 3, statuses: [] }, combatantId('sum-row'), tick(0), RULES);
  const foeSummon = summonRow({ id: foeMon.id, side: 'foe', tier: 0 }, { name: 'Imp', archetype: 'caster', rounds: 3, statuses: [] }, combatantId('sum-foe'), tick(0), RULES);
  return { local, remote, supportAlly, standardAlly, eliteAlly, bossAlly, foeNpc, foeMon, partyShadow, partySummon, foeSummon };
}

describe('partyHeadcount table', () => {
  const r = realRows();
  const w = RULES.fight.partyScale.allyWeight;
  const cases: readonly { readonly name: string; readonly rows: readonly HeadcountRow[]; readonly expected: number }[] = [
    { name: 'empty fight', rows: [], expected: 0 },
    { name: 'single local hunter', rows: [r.local], expected: 1 },
    { name: 'single remote room hunter', rows: [r.remote], expected: 1 },
    { name: 'local + remote hunter', rows: [r.local, r.remote], expected: 2 },
    { name: 'Support ally NPC uses allyWeight.support', rows: [r.supportAlly], expected: w.support },
    { name: 'Standard ally NPC uses allyWeight.standard', rows: [r.standardAlly], expected: w.standard },
    { name: 'Elite ally NPC uses allyWeight.elite', rows: [r.eliteAlly], expected: w.elite },
    { name: 'Boss ally NPC uses allyWeight.boss', rows: [r.bossAlly], expected: w.boss },
    { name: 'single foe NPC counts as 0', rows: [r.foeNpc], expected: 0 },
    { name: 'local hunter + Support ally NPC', rows: [r.local, r.supportAlly], expected: 1 + w.support },
    { name: 'local hunter + Boss ally NPC', rows: [r.local, r.bossAlly], expected: 1 + w.boss },
    { name: 'local hunter + foe NPC counts as 1 (never counts foe NPC)', rows: [r.local, r.foeNpc], expected: 1 },
    { name: 'foe monsters do not count', rows: [r.foeMon, r.foeMon], expected: 0 },
    { name: 'party shadow does not count', rows: [r.local, r.partyShadow], expected: 1 },
    { name: 'party summon does not count', rows: [r.local, r.partySummon], expected: 1 },
    { name: 'foe summon does not count', rows: [r.local, r.foeSummon], expected: 1 },
    { name: 'monster flagged party side does not count', rows: [{ kind: 'monster', side: 'party' }], expected: 0 },
    {
      name: 'mixed fight: 1 local + 1 remote + 1 Support + 1 Boss ally + 2 foe NPCs + 3 monsters + shadow + summon',
      rows: [r.local, r.remote, r.supportAlly, r.bossAlly, r.foeNpc, r.foeNpc, r.foeMon, r.foeMon, r.foeMon, r.partyShadow, r.partySummon, r.foeSummon],
      expected: Math.round((2 + w.support + w.boss) * 1000) / 1000,
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      expect(partyHeadcount(c.rows, RULES)).toBe(c.expected);
    });
  }
});

describe('partyScaleFactor and gateFoeScale', () => {
  test('pins headcount 3 to exact { hp: 1, dealt: 1 } for every kind and rank so difficulty words hold', () => {
    expect(RULES.fight.partyScale.hp[2]).toBe(1);
    expect(RULES.fight.partyScale.dealt[2]).toBe(1);
    expect(RULES.fight.partyScale.packHp[2]).toBe(1);
    expect(RULES.fight.partyScale.packDealt[2]).toBe(1);
    for (const kind of ['normal', 'elite', 'boss', 'mythic'] as const) {
      for (const rank of RANKS) {
        expect(partyScaleFactor(3, kind, rank, RULES), `${kind} ${rank} at 3p`).toEqual({ hp: 1, dealt: 1 });
        expect(gateFoeScale(kind, rank, 5, 3, RULES, 'brute')).toEqual(difficultyFactor(kind, rank, 5, RULES, 'brute'));
      }
    }
  });

  test('clamps invalid or <= 1 headcounts to 1, and linearly interpolates fractional headcounts', () => {
    const one = partyScaleFactor(1, 'boss', 'C', RULES);
    expect(partyScaleFactor(0, 'boss', 'C', RULES)).toEqual(one);
    expect(partyScaleFactor(-3, 'boss', 'C', RULES)).toEqual(one);
    expect(partyScaleFactor(Number.NaN, 'boss', 'C', RULES)).toEqual(one);
    expect(partyScaleFactor(Number.POSITIVE_INFINITY, 'boss', 'C', RULES)).toEqual(one);
    expect(partyScaleFactor(0.4, 'boss', 'C', RULES)).toEqual(one);

    // Linear interpolation between 1 and 2 at 1.25 (Rank C has rankScale = 1.00)
    const cfg = RULES.fight.partyScale;
    const at125Boss = partyScaleFactor(1.25, 'boss', 'C', RULES);
    expect(at125Boss.hp).toBeCloseTo(cfg.hp[0]! + 0.25 * (cfg.hp[1]! - cfg.hp[0]!), 8);
    expect(at125Boss.dealt).toBeCloseTo(cfg.dealt[0]! + 0.25 * (cfg.dealt[1]! - cfg.dealt[0]!), 8);

    const at12Pack = partyScaleFactor(1.2, 'normal', 'E', RULES);
    expect(at12Pack.hp).toBeCloseTo(cfg.packHp[0]! + 0.2 * (cfg.packHp[1]! - cfg.packHp[0]!), 8);
    expect(at12Pack.dealt).toBeCloseTo(cfg.packDealt[0]! + 0.2 * (cfg.packDealt[1]! - cfg.packDealt[0]!), 8);
  });

  test('uses packHp/packDealt for non-bosses and hp/dealt for bosses', () => {
    const cfg = RULES.fight.partyScale;
    for (let n = 1; n <= 6; n++) {
      const f = partyScaleFactor(n, 'normal', 'E', RULES);
      expect(f.hp).toBeCloseTo(cfg.packHp[n - 1]!, 8);
      expect(f.dealt).toBeCloseTo(cfg.packDealt[n - 1]!, 8);
    }
    for (let n = 1; n <= 6; n++) {
      const fc = partyScaleFactor(n, 'boss', 'C', RULES);
      expect(fc.hp).toBeCloseTo(cfg.hp[n - 1]!, 8);
      expect(fc.dealt).toBeCloseTo(cfg.dealt[n - 1]!, 8);
    }
  });

  test('grows monotonically with headcount from 1 to 10 (including fractional steps) across every rank and kind', () => {
    const steps = [1, 1.2, 1.4, 2, 2.5, 3, 3.2, 4, 5, 6, 7.5, 10];
    for (const kind of ['normal', 'elite', 'boss'] as const) {
      for (const rank of RANKS) {
        let prev = partyScaleFactor(steps[0]!, kind, rank, RULES);
        for (const h of steps.slice(1)) {
          const cur = partyScaleFactor(h, kind, rank, RULES);
          expect(cur.hp, `${kind} ${rank} hp ${h}`).toBeGreaterThan(prev.hp);
          expect(cur.dealt, `${kind} ${rank} dealt ${h}`).toBeGreaterThan(prev.dealt);
          prev = cur;
        }
      }
    }
  });

  test('extends linearly past 6 people using hpStep/dealtStep (boss) and packHpStep/packDealtStep (pack)', () => {
    const cfg = RULES.fight.partyScale;
    const at6 = partyScaleFactor(6, 'boss', 'C', RULES);
    const at8 = partyScaleFactor(8, 'boss', 'C', RULES);
    expect(at8.hp).toBeCloseTo(at6.hp + 2 * cfg.hpStep, 8);
    expect(at8.dealt).toBeCloseTo(at6.dealt + 2 * cfg.dealtStep, 8);

    const p6 = partyScaleFactor(6, 'normal', 'C', RULES);
    const p75 = partyScaleFactor(7.5, 'normal', 'C', RULES);
    expect(p75.hp).toBeCloseTo(p6.hp + 1.5 * cfg.packHpStep, 8);
    expect(p75.dealt).toBeCloseTo(p6.dealt + 1.5 * cfg.packDealtStep, 8);
  });

  test('unwinds 3-hunter boss rankScale away from n = 3 so solo, duo, and 4-6p bosses stay aligned across ranks E..S', () => {
    const rsE = RULES.fight.difficulty.rankScale.E;
    const hpExp = RULES.fight.difficulty.hpExponent;
    const p1E = partyScaleFactor(1, 'boss', 'E', RULES);
    expect(p1E.hp).toBeCloseTo(RULES.fight.partyScale.hp[0]! * Math.pow(Math.pow(rsE, -0.85), hpExp), 8);
    expect(p1E.dealt).toBeCloseTo(RULES.fight.partyScale.dealt[0]! * Math.pow(Math.pow(rsE, -0.85), 1 - hpExp), 8);

    const p2E = partyScaleFactor(2, 'boss', 'E', RULES);
    expect(p2E.hp).toBeCloseTo(RULES.fight.partyScale.hp[1]! * Math.pow(Math.pow(rsE, -0.85), hpExp), 8);
    expect(p2E.dealt).toBeCloseTo(RULES.fight.partyScale.dealt[1]! * Math.pow(Math.pow(rsE, -0.85), 1 - hpExp), 8);

    const p25E = partyScaleFactor(2.5, 'boss', 'E', RULES);
    const hp25 = (RULES.fight.partyScale.hp[1]! + RULES.fight.partyScale.hp[2]!) / 2;
    const dealt25 = (RULES.fight.partyScale.dealt[1]! + RULES.fight.partyScale.dealt[2]!) / 2;
    expect(p25E.hp).toBeCloseTo(hp25 * Math.pow(Math.pow(rsE, -0.425), hpExp), 8);
    expect(p25E.dealt).toBeCloseTo(dealt25 * Math.pow(Math.pow(rsE, -0.425), 1 - hpExp), 8);

    const p6E = partyScaleFactor(6, 'boss', 'E', RULES);
    expect(p6E.hp).toBeCloseTo(RULES.fight.partyScale.hp[5]! * Math.pow(Math.pow(rsE, -0.45), hpExp), 8);
    expect(p6E.dealt).toBeCloseTo(RULES.fight.partyScale.dealt[5]! * Math.pow(Math.pow(rsE, -0.45), 1 - hpExp), 8);
  });

  test('gateFoeScale equals combineScales(difficultyFactor, partyScaleFactor)', () => {
    const d = difficultyFactor('boss', 'C', 8, RULES, 'brute');
    const p = partyScaleFactor(4, 'boss', 'C', RULES);
    expect(gateFoeScale('boss', 'C', 8, 4, RULES, 'brute')).toEqual(combineScales(d, p));
  });

  test('scaleMonsterForParty multiplies existing monster tweak with gate difficulty and party headcount', () => {
    const kasaka = seedMonsters(RULES).find(m => m.id === seedId<'m'>('kasaka'))!;
    const gate = withDifficulty({ difficulty: { gate: { at: 'default' as const }, boss: { at: 'follows' as const } } }, [{ type: 'setGate', level: 8 }]);
    const solo = scaleMonsterForParty(kasaka, gate, 'boss', 1, RULES);
    const party4 = scaleMonsterForParty(kasaka, gate, 'boss', 4, RULES);
    const s1 = gateFoeScale('boss', kasaka.rank, 8, 1, RULES, kasaka.archetype);
    const s4 = gateFoeScale('boss', kasaka.rank, 8, 4, RULES, kasaka.archetype);
    expect(solo.tweak.hp).toBeCloseTo((kasaka.tweak.hp ?? 1) * s1.hp, 6);
    expect(party4.tweak.hp).toBeCloseTo((kasaka.tweak.hp ?? 1) * s4.hp, 6);
    expect(party4.tweak.hp!).toBeGreaterThan(solo.tweak.hp!);
  });

  test('honors GM rule overrides through rulesOf', () => {
    const custom = rulesOf({
      fight: {
        partyScale: {
          hp: [0.4, 0.8, 1.0, 1.6, 2.2, 3.0],
          dealt: [0.4, 0.7, 1.0, 1.05, 1.12, 1.2],
          hpStep: 0.9,
          dealtStep: 0.08,
          packHp: [0.7, 0.85, 1.0, 1.3, 1.6, 1.9],
          packDealt: [0.7, 0.85, 1.0, 1.04, 1.08, 1.12],
          packHpStep: 0.35,
          packDealtStep: 0.04,
          allyWeight: { support: 0.15, standard: 0.3, elite: 0.5, boss: 0.7 },
        },
      },
    });
    expect(partyScaleFactor(4, 'boss', 'C', custom)).toEqual({ hp: 1.6, dealt: 1.05 });
    expect(partyScaleFactor(7, 'boss', 'C', custom)).toEqual({ hp: 3.9, dealt: 1.28 });
    expect(partyScaleFactor(1, 'normal', 'C', custom)).toEqual({ hp: 0.7, dealt: 0.7 });
    expect(partyHeadcount([{ kind: 'hunter', side: 'party' }, ...gateNpcHeadcountRows([{ side: 'party', count: 1, preset: 'boss' }], custom)], custom)).toBe(1.7);
  });

  test('gateNpcHeadcountRows feeds weighted gate roster NPCs into partyHeadcount (allies weighted by preset, foes never count)', () => {
    const sup = npcTierPreset('support', RULES);
    const bss = npcTierPreset('boss', RULES);
    const roster = gateNpcHeadcountRows([
      { side: 'party', count: 1, tier: sup.tier, tweak: sup.tweak },
      { side: 'party', count: 1, tier: bss.tier, tweak: bss.tweak },
      { side: 'foe', count: 3, tier: 'boss', tweak: bss.tweak },
    ], RULES);
    const w = RULES.fight.partyScale.allyWeight;
    expect(partyHeadcount([{ kind: 'hunter', side: 'party' }, ...roster], RULES)).toBe(Math.round((1 + w.support + w.boss) * 1000) / 1000);
    expect(partyHeadcount(roster, RULES)).toBe(Math.round((w.support + w.boss) * 1000) / 1000);
  });

  test('scaleNpcForParty scales foe NPCs by gate difficulty and headcount on the pack curve, leaving ally NPCs untouched', () => {
    const ally = parseNpc({ name: 'Ally Guard', rank: 'C', archetype: 'brute', tier: 'normal', defaultSide: 'party', skill: 3 })!;
    const foe = parseNpc({ name: 'Rival Captain', rank: 'C', archetype: 'skirmisher', tier: 'boss', tweak: { hp: 1.2, dealt: 0.9, stats: { agi: 4 }, traits: ['fast'] }, defaultSide: 'foe', skill: 3 })!;
    const gate = withDifficulty({ difficulty: { gate: { at: 'set' as const, level: 7 as const }, boss: { at: 'own' as const, level: 10 as const } } }, []);

    expect(scaleNpcForParty(ally, 'party', gate, 1, RULES)).toBe(ally);
    expect(scaleNpcForParty(ally, 'party', gate, 6, RULES)).toBe(ally);

    const foe1 = scaleNpcForParty(foe, 'foe', gate, 1, RULES);
    const foe5 = scaleNpcForParty(foe, 'foe', gate, 5, RULES);
    const s1 = gateFoeScale('normal', 'C', 7, 1, RULES, 'skirmisher');
    const s5 = gateFoeScale('normal', 'C', 7, 5, RULES, 'skirmisher');
    expect(foe1.tweak.hp).toBeCloseTo(1.2 * s1.hp, 6);
    expect(foe1.tweak.dealt).toBeCloseTo(0.9 * s1.dealt, 6);
    expect(foe5.tweak.hp).toBeCloseTo(1.2 * s5.hp, 6);
    expect(foe5.tweak.dealt).toBeCloseTo(0.9 * s5.dealt, 6);
    expect(foe5.tweak.hp).toBeGreaterThan(foe1.tweak.hp);
    expect(foe5.tweak.stats).toEqual({ agi: 4 });
    expect(foe5.tweak.traits).toEqual(['fast']);
  });

  test('PARTY_SCALE_WORDS formats whole and fractional headcounts with plain singular and plural phrasing', () => {
    expect(PARTY_SCALE_WORDS.cardSize(1)).toBe('Sized for 1 person (hunters and ally NPCs). Scales to who joins when you start the fight.');
    expect(PARTY_SCALE_WORDS.cardSize(1.2)).toBe('Sized for 1.2 people (hunters and ally NPCs). Scales to who joins when you start the fight.');
    expect(PARTY_SCALE_WORDS.cardLocked(3)).toBe('Fight sized for 3 people. Late joins do not resize it.');
    expect(PARTY_SCALE_WORDS.dialogSize(1)).toBe('Gate monsters scale for 1 person when the fight starts.');
    expect(PARTY_SCALE_WORDS.dialogSize(3.25)).toBe('Gate monsters scale for 3.25 people when the fight starts.');
    expect(PARTY_SCALE_WORDS.dialogLocked(2)).toBe('Fight stays sized for 2 people. Joining now will not resize it.');
    expect(PARTY_SCALE_WORDS.alliesLegend).toBe('Ally NPCs');
  });
});

describe('defaultParty (Finding 4)', () => {
  const nowMs = Date.parse(AT);
  const s = freshSave(ENV, { onboarded: true });
  const fresh = makeHunter({ seq: 1, settings: s.settings }, 'Placeholder', RULES, new Date(AT)).hunter;
  const playedBase = makeHunter({ seq: 2, settings: s.settings }, 'Mira', RULES, new Date(AT)).hunter;
  const played = { ...playedBase, ...gainXp(playedBase, 50, RULES).progress };
  const activeKey = parseSheetKey(`${dev('d-r1')}:h1`)!;
  const staleKey = parseSheetKey(`${dev('d-r2')}:h2`)!;
  const nullKey = parseSheetKey(`${dev('d-r3')}:h3`)!;
  const remotes = [
    { key: activeKey, polledAt: new Date(nowMs - 60_000).toISOString() },
    { key: staleKey, polledAt: new Date(nowMs - RECENT_POLL_MS - 60_000).toISOString() },
    { key: nullKey, polledAt: null },
  ];

  test('in a room, skips untouched local placeholders and stale or never-polled remote sheets', () => {
    const res = defaultParty([fresh, played], remotes, { inRoom: true, nowMs, R: RULES });
    expect(res.hunters.map(h => h.id)).toEqual([played.id]);
    expect(res.remotes.map(r => r.key)).toEqual([activeKey]);
  });

  test('outside a room, keeps all local hunters including untouched ones', () => {
    const res = defaultParty([fresh, played], [], { inRoom: false, nowMs, R: RULES });
    expect(res.hunters.map(h => h.id)).toEqual([fresh.id, played.id]);
    expect(res.remotes).toEqual([]);
  });

  test('with a GM clock 10 minutes fast, serverNowMs skew correction keeps a recently polled room player in defaultParty', () => {
    const gmClockMs = nowMs + 10 * 60_000;
    const skewMs = nowMs - gmClockMs; // -600_000 ms (server minus local, matching sync.ts srvSkew)
    // Without skew correction, a player who polled 1 min ago on server time looks 11 min stale and gets dropped.
    const raw = defaultParty([fresh, played], remotes, { inRoom: true, nowMs: gmClockMs, R: RULES });
    expect(raw.remotes).toEqual([]);
    // With serverNowMs(gmClockMs, skewMs), the same player is 1 min fresh and stays checked; the truly stale one stays out.
    const corrected = defaultParty([fresh, played], remotes, { inRoom: true, nowMs: serverNowMs(gmClockMs, skewMs), R: RULES });
    expect(corrected.remotes.map(r => r.key)).toEqual([activeKey]);
  });
});

describe('reducer party-size scaling at start and locked sizedFor (Architecture ruling + Finding 3)', () => {
  const s = freshSave(ENV, { onboarded: true });
  const h1 = makeHunter({ seq: 1, settings: s.settings }, 'Mira', RULES, new Date(AT)).hunter;
  const h2 = makeHunter({ seq: 2, settings: s.settings }, 'Kade', RULES, new Date(AT)).hunter;
  const h3 = makeHunter({ seq: 3, settings: s.settings }, 'Juno', RULES, new Date(AT)).hunter;
  const cerberus = seedMonsters(RULES).find(m => m.id === seedId<'m'>('cerberus'))!;
  const goblin = seedMonsters(RULES).find(m => m.id === seedId<'m'>('goblin'))!;
  const supAlly = newNpc({ name: 'Guide', rank: 'C', archetype: 'brute', ...npcTierPreset('support', RULES), defaultSide: 'party', skill: 3 }, RULES);
  const ctx = { rules: RULES };

  test('keeps base tweak in setup, sizes at start from rows actually present, and survives setup edits without checkbox freeze', () => {
    // Add 3 hunters + 1 boss (base difficulty-5 tweak, unscaled for party size) with partyScaled: true
    const diff5Boss = scaleRowMonster(cerberus, difficultyFactor('boss', 'C', 5, RULES, cerberus.archetype));
    const bossRow = monsterRows(diff5Boss, [combatantId('b1')], RULES)[0]!;
    const r1 = hunterRow(h1, combatantId('h1'), RULES);
    const r2 = hunterRow(h2, combatantId('h2'), RULES);
    const r3 = hunterRow(h3, combatantId('h3'), RULES);

    const created = reduce(null, { type: 'add', fightId: fightId('f-ps'), rows: [bossRow, r1, r2, r3], openings: [], partyScaled: true }, ctx);
    expect(created.fight?.phase).toBe('setup');
    const setup = created.fight!;
    if (setup.phase !== 'setup') throw new Error('expected setup');
    expect(setup.partyScaled).toBe(true);
    // In setup, boss keeps its base (difficulty-5) HP before party scaling.
    const baseHp = setup.rows.find(r => r.id === 'b1')!.sheet.hpMax;
    expect(parseFight(JSON.parse(JSON.stringify(setup)), RULES)).toEqual(setup);

    // Remove 2 no-shows during setup, add a Support ally NPC -> effective headcount = 1.2
    const rm1 = reduce(setup, { type: 'remove', id: combatantId('h2') }, ctx).fight!;
    const rm2 = reduce(rm1, { type: 'remove', id: combatantId('h3') }, ctx).fight!;
    const allyRow = npcRows(supAlly, [combatantId('a1')], RULES, { side: 'party' })[0]!;
    const withAlly = reduce(rm2, { type: 'add', fightId: setup.id, rows: [allyRow], openings: [] }, ctx).fight!;

    const openings = withAlly.rows.map((r, i) => ({ id: r.id, d20: 10, tie: i + 1 }));
    const started = reduce(withAlly, { type: 'start', openings }, ctx).fight!;
    if (started.phase !== 'running') throw new Error('expected running');
    expect(started.sizedFor).toBe(1.2);
    expect('partyScaled' in started).toBe(false);
    expect(parseFight(JSON.parse(JSON.stringify(started)), RULES)).toEqual(started);

    const bossRunning = started.rows.find(r => r.id === 'b1')!;
    const expectedScale = partyScaleFactor(1.2, 'boss', 'C', RULES);
    expect(bossRunning.origin.kind === 'monster' && bossRunning.origin.tweak.hp).toBeCloseTo((diff5Boss.tweak.hp ?? 1) * expectedScale.hp, 6);
    expect(bossRunning.sheet.hpMax).toBeLessThan(baseHp);
    expect(bossRunning.life.at === 'up' && bossRunning.life.hp).toBe(bossRunning.sheet.hpMax);
    // Ally NPC stays unscaled.
    const allyRunning = started.rows.find(r => r.id === 'a1')!;
    expect(allyRunning.origin.kind === 'monster' && allyRunning.origin.tweak.hp).toBe(supAlly.tweak.hp);

    // Mid-fight join (late hunter) does NOT resize sizedFor or existing boss HP!
    const lateJoin = reduce(started, { type: 'add', fightId: started.id, rows: [r2], openings: [{ id: r2.id, d20: 10, tie: 50 }] }, ctx).fight!;
    if (lateJoin.phase !== 'running') throw new Error('expected running');
    expect(lateJoin.sizedFor).toBe(1.2);
    expect(lateJoin.rows.find(r => r.id === 'b1')!.sheet.hpMax).toBe(bossRunning.sheet.hpMax);

    // Mid-fight Wave 2 join (`partyScaled: true`) scales ONLY the newly joined Wave 2 foe to locked sizedFor (1.2), never resizing Wave 1 or sizedFor!
    const wave2Gob = monsterRows(goblin, [combatantId('g2')], RULES)[0]!;
    const joinedWave = reduce(lateJoin, { type: 'add', fightId: started.id, rows: [wave2Gob], openings: [{ id: wave2Gob.id, d20: 10, tie: 60 }], partyScaled: true }, ctx).fight!;
    if (joinedWave.phase !== 'running') throw new Error('expected running');
    expect(joinedWave.sizedFor).toBe(1.2);
    expect(joinedWave.rows.find(r => r.id === 'b1')!.sheet.hpMax).toBe(bossRunning.sheet.hpMax);
    const gobRow = joinedWave.rows.find(r => r.id === 'g2')!;
    const packScale12 = partyScaleFactor(1.2, 'normal', 'E', RULES);
    expect(gobRow.origin.kind === 'monster' && gobRow.origin.tweak.hp).toBeCloseTo(packScale12.hp, 6);
    expect(gobRow.life.at === 'up' && gobRow.life.hp).toBe(gobRow.sheet.hpMax);

    // End fight preserves sizedFor on Ended and round-trips through parseFight.
    const over = reduce(joinedWave, { type: 'end' }, ctx).fight!;
    if (over.phase !== 'ended') throw new Error('expected ended');
    expect(over.sizedFor).toBe(1.2);
    expect(parseFight(JSON.parse(JSON.stringify(over)), RULES)).toEqual(over);
    // Out-of-bounds sizedFor is rejected by parseFight.
    expect(parseFight({ ...JSON.parse(JSON.stringify(over)), sizedFor: 0 }, RULES)).toBeNull();
    expect(parseFight({ ...JSON.parse(JSON.stringify(over)), sizedFor: 500 }, RULES)).toBeNull();
  });

  test('gate foes added to a running fight with no sizedFor lock sizedFor once and scale only the newly added gate foes', () => {
    // Start a plain non-gate fight (no partyScaled -> running fight has sizedFor === undefined).
    const plainGob = monsterRows(goblin, [combatantId('g1')], RULES)[0]!;
    const r1 = hunterRow(h1, combatantId('h1'), RULES);
    const setup = reduce(null, { type: 'add', fightId: fightId('f-plain'), rows: [plainGob, r1], openings: [] }, ctx).fight!;
    if (setup.phase !== 'setup') throw new Error('expected setup');
    const started = reduce(setup, { type: 'start', openings: setup.rows.map((r, i) => ({ id: r.id, d20: 10, tie: i + 1 })) }, ctx).fight!;
    if (started.phase !== 'running') throw new Error('expected running');
    expect(started.sizedFor).toBeUndefined();
    const origGobHp = started.rows.find(r => r.id === 'g1')!.sheet.hpMax;

    // Join gate foes (partyScaled: true) along with a second hunter -> locks sizedFor = 2, scales new gate boss to 2p, leaves existing Goblin untouched.
    const diff5Boss = scaleRowMonster(cerberus, difficultyFactor('boss', 'C', 5, RULES, cerberus.archetype));
    const bossRow = monsterRows(diff5Boss, [combatantId('b2')], RULES)[0]!;
    const r2 = hunterRow(h2, combatantId('h2'), RULES);
    const joined = reduce(started, {
      type: 'add',
      fightId: started.id,
      rows: [r2, bossRow],
      openings: [{ id: r2.id, d20: 10, tie: 20 }, { id: bossRow.id, d20: 10, tie: 21 }],
      partyScaled: true,
    }, ctx).fight!;
    if (joined.phase !== 'running') throw new Error('expected running');
    expect(joined.sizedFor).toBe(2);
    expect(joined.rows.find(r => r.id === 'g1')!.sheet.hpMax).toBe(origGobHp);
    const bossJoined = joined.rows.find(r => r.id === 'b2')!;
    const scale2 = partyScaleFactor(2, 'boss', 'C', RULES);
    expect(bossJoined.origin.kind === 'monster' && bossJoined.origin.tweak.hp).toBeCloseTo((diff5Boss.tweak.hp ?? 1) * scale2.hp, 6);
  });
});
