// Balance simulation rows for gate party-size scaling (src/core/gates/party-scale.ts, t205u).
// Plays the real combat reducer through tests/models/fight-sim.ts with seeded dice across ranks E, C, A, S and
// party headcounts 1 through 6, plus ally NPC weighting rows ("1h + ally", "3h + ally") and real solo runs through
// `soloReady` -> `soloFight`. Every row uses simTest with a deterministic work budget (tests/models/sim-budget.ts).
//
// Chosen curve (RULES.fight.partyScale): 3-hunter anchor pinned to exact 1 / 1 so difficulty words ("about 75%" at
// level 5) hold; boss curve (`hp`/`dealt`) keeps every (rank, 1..6p) cell in 75-98% with 6p >= 1p and 4-6p losing
// substantially less HP than solo; separate pack curve (`packHp`/`packDealt`) keeps solo 3-normal packs non-trivial.
import { describe, expect } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { npcRows } from '../src/core/combat/rows.ts';
import { newNpc, npcTierPreset } from '../src/core/registry/npcs.ts';
import type { NpcTierPreset } from '../src/core/registry/npcs.ts';
import { sensible } from '../src/core/combat/policy.ts';
import { DEFAULT_DIFFICULTY } from '../src/core/gates/difficulty.ts';
import { gateFoeScale, gateNpcHeadcountRows, partyHeadcount, scaleNpcForParty } from '../src/core/gates/party-scale.ts';
import { newGate } from '../src/core/gates/gate.ts';
import { soloFight, soloReady } from '../src/core/gates/solo.ts';
import { freshSave, makeHunter } from '../src/core/save.ts';
import type { Hunter } from '../src/core/save.ts';
import { confirm, gainXp, raiseMany } from '../src/core/hunter/progress.ts';
import { equip, putItem } from '../src/core/hunter/inventory.ts';
import { refill } from '../src/core/hunter/vitals.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { learnSkill } from '../src/core/hunter/skills-held.ts';
import { pointsAt, split } from '../src/core/hunter/derive.ts';
import { itemDefDataOf } from '../src/core/registry/item-book.ts';
import { RARITIES, parseItem } from '../src/core/registry/items.ts';
import type { ArmorSlot, Rarity } from '../src/core/registry/items.ts';
import { middleBudget } from '../src/core/registry/item-budget.ts';
import { SKILL_SEEDS, skillOf } from '../src/core/registry/skills.ts';
import { statBlock } from '../src/core/registry/monsters.ts';
import { isRefused } from '../src/core/save-step.ts';
import { IDLE, oddsStep } from '../src/core/combat/odds.ts';
import { RANKS } from '../src/core/rules.ts';
import { saveId } from '../src/core/ids.ts';
import { dev } from './fixtures/ids.ts';
import { geared, monster, playFight } from './models/fight-sim.ts';
import type { Archetype, SimRow } from './models/fight-sim.ts';
import { simTest, workBudget } from './models/sim-budget.ts';

const ROSTER: readonly Archetype[] = ['bruiser', 'cannon', 'tank', 'speed', 'status', 'bruiser'];
const TEST_RANKS: readonly Rank[] = ['E', 'C', 'A', 'S'];
const HEADCOUNTS = [1, 2, 3, 4, 5, 6] as const;
const RUNS_PER_CELL = 300;
const SOLO_RUNS = 100;

function partyFor(rank: Rank, n: number): SimRow[] {
  return ROSTER.slice(0, n).map((a, i) => geared(a, rank, `${a}-${i + 1}`, RULES));
}

type CellResult = {
  readonly winRate: number;
  readonly deathRate: number;
  readonly hpLostPct: number;
  readonly meanRounds: number;
  readonly capped: number;
};

function runBossCell(rank: Rank, n: number, runs: number, extraAllies: readonly SimRow[] = []): CellResult {
  const party = partyFor(rank, n);
  const head = partyHeadcount([...party.map(p => p.row), ...extraAllies.map(a => a.row)], RULES);
  const scale = gateFoeScale('boss', rank, 5, head, RULES, 'brute');
  const boss = monster(rank, 'brute', 'boss', 'boss', RULES, [], scale);
  const rows: SimRow[] = [...party, ...extraAllies, boss];
  const partyIds = party.map(p => p.row.id as string);

  let wins = 0;
  let deaths = 0;
  let hpLostSum = 0;
  let roundsSum = 0;
  let capped = 0;
  for (let s = 1; s <= runs; s++) {
    const rec = playFight({ rows, tallyDamage: false }, s);
    if (rec.winner === 'party') wins++;
    if (rec.capped) capped++;
    if (rec.dead.some(d => partyIds.includes(d))) deaths++;
    roundsSum += rec.rounds;
    let maxHp = 0;
    let leftHp = 0;
    for (const id of partyIds) {
      maxHp += rec.tally[id]?.hpMax ?? 0;
      leftHp += rec.end[id]?.hp ?? 0;
    }
    hpLostSum += maxHp > 0 ? (maxHp - leftHp) / maxHp : 0;
  }
  return {
    winRate: wins / runs,
    deathRate: deaths / runs,
    hpLostPct: (hpLostSum / runs) * 100,
    meanRounds: roundsSum / runs,
    capped,
  };
}

function makeAllySim(rank: Rank, preset: NpcTierPreset, id = 'ally-1'): SimRow {
  const tpl = newNpc({
    name: `${preset} Ally`,
    rank,
    archetype: 'brute',
    ...npcTierPreset(preset, RULES),
    defaultSide: 'party',
    skill: 3,
  }, RULES);
  const row = npcRows(tpl, [combatantId(id)], RULES, { side: 'party' })[0]!;
  return { row, policy: (f, me) => sensible(f, me, RULES) };
}

const ARMOR_SLOTS: readonly ArmorSlot[] = ['chest', 'legs', 'head', 'feet', 'offhand'];

function makeGearedSoloHunter(rank: Rank, settings: ReturnType<typeof freshSave>['settings'], at: string): Hunter {
  let seq = 10;
  let h = makeHunter({ seq: ++seq, settings }, `Solo ${rank}`, RULES, new Date(at)).hunter;
  const targetLv = RULES.rankLevels[rank];
  while (h.level < targetLv) {
    const step = gainXp(h, RULES.xpPerLevel * h.level, RULES);
    h = { ...h, ...step.progress };
  }
  const alloc = split('str', 'vit', pointsAt(targetLv, RULES), RULES);
  const delta: Record<string, number> = {};
  for (const [k, v] of Object.entries(alloc)) {
    const add = v - h.stats[k as keyof typeof h.stats];
    if (add > 0) delta[k] = add;
  }
  const raised = raiseMany(h, delta, RULES);
  if (isRefused(raised)) throw new Error(`raiseMany refused: ${raised.why}`);
  h = confirm(raised);
  h = learnSkill(h, { ...skillOf(SKILL_SEEDS.find(s => s.name === 'Mutilation')!, RULES), label: 'Lv.1' }, saveId('s', ++seq));
  const rar: Rarity = RARITIES[RANKS.indexOf(rank)]!;
  const bSlot = Math.floor(middleBudget(RULES, rank));
  const strSlot = Math.round((bSlot * 2) / 3);
  const vitSlot = bSlot - strSlot;
  const wep = parseItem({ name: `${rank} Blade`, type: 'weapon', slot: 'weapon', rar, attack: 'strike', dice: '1d8', bonus: { str: strSlot, vit: vitSlot } })!;
  const wepId = saveId('i', ++seq);
  h = putItem(h, { kind: 'adhoc', item: itemDefDataOf(wep), qty: 1 }, wepId, RULES);
  const eqWep = equip(h, wepId, wepId, false, RULES);
  if (isRefused(eqWep)) throw new Error(`equip weapon refused: ${eqWep.why}`);
  h = eqWep;
  for (const slot of ARMOR_SLOTS) {
    const arm = parseItem({ name: `${rank} ${slot}`, type: 'armor', slot, rar, kit: 'medium', bonus: { str: strSlot, vit: vitSlot } })!;
    const aid = saveId('i', ++seq);
    h = putItem(h, { kind: 'adhoc', item: itemDefDataOf(arm), qty: 1 }, aid, RULES);
    const eq = equip(h, aid, aid, false, RULES);
    if (isRefused(eq)) throw new Error(`equip ${slot} refused: ${eq.why}`);
    h = eq;
  }
  return { ...h, ...refill(h, hunterSheet(h, RULES).sheet) };
}

function runSoloGateSim(rank: Rank, bossGate: boolean, runs: number): { winRate: number; meanRounds: number; capped: number } {
  const at = '2026-11-27T12:00:00.000Z';
  const env = { now: new Date(at), newDeviceToken: () => 'tok-solo-sim-0123456789', newDeviceId: () => dev('d-solo-sim') };
  const base = freshSave(env, { onboarded: true });
  const h = makeGearedSoloHunter(rank, base.settings, at);
  const customNormal = { ...statBlock(RULES, rank, { name: `${rank} Brute`, archetype: 'brute', kind: 'normal' }), id: saveId('m', 1) };
  const customBoss = { ...statBlock(RULES, rank, { name: `${rank} Gate Boss`, archetype: 'brute', kind: 'boss' }), id: saveId('m', 2) };
  const g = {
    ...newGate(),
    id: saveId('g', 1),
    name: `${rank} Solo Test`,
    rank,
    solo: true,
    monsters: bossGate ? [] : [{ monsterId: customNormal.id, count: 3 }],
    bossId: bossGate ? customBoss.id : null,
  };
  const save = { ...base, hunters: [h], gates: [g], monsters: [customNormal, customBoss] };
  const ready = soloReady(save, h.id, { kind: 'world', id: g.id }, { R: RULES, route: 'local', held: false, nowMs: Date.parse(at) });
  if (isRefused(ready)) throw new Error(`soloReady refused: ${ready.why}`);
  const made = soloFight(ready.h, ready.target, RULES);
  if (!made) throw new Error('soloFight returned null');

  let run = oddsStep(IDLE, { type: 'ask', fight: made.fight, seed: 1, of: runs }, made.R);
  while (run.state === 'running') run = oddsStep(run, { type: 'step', commands: 500 }, made.R);
  if (run.state !== 'done') throw new Error('solo odds did not finish');
  const ends = run.odds.ends;
  const wins = ends.filter(e => e.outcome === 'won').length;
  const capped = ends.filter(e => e.outcome === 'stalled').length;
  const meanRounds = ends.reduce((sum, e) => sum + e.rounds, 0) / ends.length;
  return { winRate: wins / runs, meanRounds, capped };
}

describe('Gate party-size scaling simulation (ranks E, C, A, S across 1 to 6 people)', () => {
  for (const rank of TEST_RANKS) {
    simTest(`Rank ${rank} diff-5 boss stays in 75-98% win rate across 1 to 6 people with 3p pinned at 1/1`, () => {
      const results = new Map<number, CellResult>();
      for (const n of HEADCOUNTS) {
        const res = runBossCell(rank, n, RUNS_PER_CELL);
        results.set(n, res);
        console.log(
          `  [party-scale ${rank} ${n}p] win=${(res.winRate * 100).toFixed(1)}%, deaths=${(res.deathRate * 100).toFixed(1)}%, hpLost=${res.hpLostPct.toFixed(1)}%, rounds=${res.meanRounds.toFixed(1)}, capped=${res.capped}`,
        );
        expect(res.capped, `Rank ${rank} ${n}p reached 40-round cap`).toBe(0);
        expect(res.winRate, `Rank ${rank} ${n}p winRate >= 75%`).toBeGreaterThanOrEqual(0.75);
        expect(res.winRate, `Rank ${rank} ${n}p winRate <= 98%`).toBeLessThanOrEqual(0.98);
        expect(res.meanRounds, `Rank ${rank} ${n}p meanRounds >= 4`).toBeGreaterThanOrEqual(4);
        expect(res.meanRounds, `Rank ${rank} ${n}p meanRounds <= 18`).toBeLessThanOrEqual(18);
      }
      // 3p sits in the difficulty-5 anchor band (75-85%), and 1p/2p do not sit meaningfully above 3p (<= +4 pts).
      const solo = results.get(1)!;
      const duo = results.get(2)!;
      const three = results.get(3)!;
      const four = results.get(4)!;
      const five = results.get(5)!;
      const six = results.get(6)!;
      expect(three.winRate, `Rank ${rank} 3p stays near 75% anchor (<= 85%)`).toBeLessThanOrEqual(0.85);
      expect(solo.winRate, `Rank ${rank}: 1p <= 3p + 4 pts`).toBeLessThanOrEqual(three.winRate + 0.04 + 1e-9);
      expect(duo.winRate, `Rank ${rank}: 2p <= 3p + 4 pts`).toBeLessThanOrEqual(three.winRate + 0.04 + 1e-9);
      // Larger groups (4-6p) are never punished: 4p >= 3p, 4-6p stay flat or rising (<= 4pt step), 6p >= 3p & 5p & 1p, and 4-6p lose >= 15 pts less HP than solo.
      expect(four.winRate, `Rank ${rank}: 4p >= 3p`).toBeGreaterThanOrEqual(three.winRate);
      expect(five.winRate, `Rank ${rank}: 5p >= 4p - 4 pts`).toBeGreaterThanOrEqual(four.winRate - 0.04);
      expect(six.winRate, `Rank ${rank}: 6p >= 5p`).toBeGreaterThanOrEqual(five.winRate);
      expect(six.winRate, `Rank ${rank}: 6p >= 3p`).toBeGreaterThanOrEqual(three.winRate);
      expect(six.winRate, `Rank ${rank}: 6p >= 1p`).toBeGreaterThanOrEqual(solo.winRate);
      const groupMeanWin = (four.winRate + five.winRate + six.winRate) / 3;
      const groupMeanHpLost = (four.hpLostPct + five.hpLostPct + six.hpLostPct) / 3;
      expect(groupMeanWin, `Rank ${rank}: 4-6p mean win% >= solo`).toBeGreaterThanOrEqual(solo.winRate);
      expect(groupMeanHpLost, `Rank ${rank}: 4-6p lose at least 15 pts less HP than solo`).toBeLessThanOrEqual(solo.hpLostPct - 15);
    }, workBudget(HEADCOUNTS.length * RUNS_PER_CELL, HEADCOUNTS.length * RUNS_PER_CELL * 180));
  }

  simTest('Finding 1: "1h + ally" and "3h + ally" vs diff-5 boss never fall below the same party without the ally (all 4 presets at C, Support across E/C/A/S)', () => {
    const runs = 200;
    const baseC1 = runBossCell('C', 1, runs);
    const baseC3 = runBossCell('C', 3, runs);
    for (const preset of ['support', 'standard', 'elite', 'boss'] as const) {
      const ally = makeAllySim('C', preset);
      const r1 = runBossCell('C', 1, runs, [ally]);
      const r3 = runBossCell('C', 3, runs, [ally]);
      console.log(`  [ally C ${preset.padEnd(8)}] 1h: ${(baseC1.winRate * 100).toFixed(1)}% -> ${(r1.winRate * 100).toFixed(1)}% (${r1.meanRounds.toFixed(1)}r); 3h: ${(baseC3.winRate * 100).toFixed(1)}% -> ${(r3.winRate * 100).toFixed(1)}% (${r3.meanRounds.toFixed(1)}r)`);
      expect(r1.capped).toBeLessThanOrEqual(1);
      expect(r3.capped).toBeLessThanOrEqual(1);
      expect(r1.winRate, `C 1h + ${preset} >= 1h alone`).toBeGreaterThanOrEqual(baseC1.winRate);
      expect(r3.winRate, `C 3h + ${preset} >= 3h alone`).toBeGreaterThanOrEqual(baseC3.winRate);
      expect(r1.meanRounds).toBeGreaterThanOrEqual(4);
      expect(r1.meanRounds).toBeLessThanOrEqual(16);
      expect(r3.meanRounds).toBeGreaterThanOrEqual(4);
      expect(r3.meanRounds).toBeLessThanOrEqual(16);
    }
    for (const rank of ['E', 'A', 'S'] as const) {
      const b1 = runBossCell(rank, 1, runs);
      const b3 = runBossCell(rank, 3, runs);
      const ally = makeAllySim(rank, 'support');
      const r1 = runBossCell(rank, 1, runs, [ally]);
      const r3 = runBossCell(rank, 3, runs, [ally]);
      console.log(`  [ally ${rank} support ] 1h: ${(b1.winRate * 100).toFixed(1)}% -> ${(r1.winRate * 100).toFixed(1)}% (${r1.meanRounds.toFixed(1)}r); 3h: ${(b3.winRate * 100).toFixed(1)}% -> ${(r3.winRate * 100).toFixed(1)}% (${r3.meanRounds.toFixed(1)}r)`);
      expect(r1.capped).toBeLessThanOrEqual(1);
      expect(r3.capped).toBeLessThanOrEqual(1);
      expect(r1.winRate, `${rank} 1h + support >= 1h alone`).toBeGreaterThanOrEqual(b1.winRate);
      expect(r3.winRate, `${rank} 3h + support >= 3h alone`).toBeGreaterThanOrEqual(b3.winRate);
    }
  }, workBudget(22 * 200, 22 * 200 * 180));

  simTest('Finding 6: per-rank solo runs through soloReady -> soloFight (3-normal pack is non-trivial under pack curve; boss is dangerous under +25% autoHarder)', () => {
    for (const rank of TEST_RANKS) {
      const packRes = runSoloGateSim(rank, false, SOLO_RUNS);
      const bossRes = runSoloGateSim(rank, true, SOLO_RUNS);
      console.log(`  [solo ${rank}] 3-normal pack: win=${(packRes.winRate * 100).toFixed(1)}%, rounds=${packRes.meanRounds.toFixed(1)}, capped=${packRes.capped}; boss: win=${(bossRes.winRate * 100).toFixed(1)}%, rounds=${bossRes.meanRounds.toFixed(1)}, capped=${bossRes.capped}`);
      expect(packRes.capped, `solo ${rank} pack capped`).toBe(0);
      expect(packRes.winRate, `solo ${rank} pack >= 35%`).toBeGreaterThanOrEqual(0.35);
      expect(packRes.winRate, `solo ${rank} pack <= 98% (not trivially 100%)`).toBeLessThanOrEqual(0.98);
      expect(packRes.meanRounds, `solo ${rank} pack rounds`).toBeGreaterThanOrEqual(3);
      expect(packRes.meanRounds, `solo ${rank} pack rounds`).toBeLessThanOrEqual(16);

      expect(bossRes.capped, `solo ${rank} boss capped`).toBe(0);
      expect(bossRes.winRate, `solo ${rank} boss >= 1% (not impossible)`).toBeGreaterThanOrEqual(0.01);
      expect(bossRes.winRate, `solo ${rank} boss <= 40% (dangerous under +25% autoHarder)`).toBeLessThanOrEqual(0.40);
    }
  }, workBudget(TEST_RANKS.length * 2 * SOLO_RUNS, TEST_RANKS.length * 2 * SOLO_RUNS * 200));

  simTest('Foe NPCs in a gate roster scale with party headcount via scaleNpcForParty and never inflate partyHeadcount', () => {
    const runs = 100;
    const defGate = { difficulty: DEFAULT_DIFFICULTY };
    const foeBossTpl = newNpc({
      name: 'Rogue Raid Leader',
      rank: 'C',
      archetype: 'brute',
      ...npcTierPreset('boss'),
      defaultSide: 'foe',
      skill: 3,
    }, RULES);

    const scaled1 = scaleNpcForParty(foeBossTpl, 'foe', defGate, 1, RULES);
    const scaled3 = scaleNpcForParty(foeBossTpl, 'foe', defGate, 3, RULES);
    const scaled4 = scaleNpcForParty(foeBossTpl, 'foe', defGate, 4, RULES);
    expect(scaled3.tweak.hp).toBeGreaterThan(scaled1.tweak.hp);
    expect(scaled4.tweak.hp).toBeGreaterThan(scaled3.tweak.hp);
    expect(scaled4.tweak.dealt).toBeGreaterThan(scaled1.tweak.dealt);

    for (const n of [1, 3, 4] as const) {
      const party = partyFor('C', n);
      const head = partyHeadcount([
        ...party.map(p => p.row),
        ...gateNpcHeadcountRows([{ side: 'foe', count: 1 }], RULES),
      ], RULES);
      expect(head, `foe NPC never inflates ${n}p headcount`).toBe(n);

      const foeNpc = scaleNpcForParty(foeBossTpl, 'foe', defGate, head, RULES);
      const foeRow = npcRows(foeNpc, [combatantId('foe-npc-1')], RULES, { side: 'foe' })[0]!;
      const foeSim: SimRow = { row: foeRow, policy: (f, me) => sensible(f, me, RULES) };
      const monScale = gateFoeScale('normal', 'C', 5, head, RULES, 'brute');
      const mons = n === 1
        ? []
        : [1, 2].map(i => monster('C', 'brute', 'normal', `gm${i}`, RULES, [], monScale));

      let wins = 0;
      let capped = 0;
      let rounds = 0;
      for (let s = 1; s <= runs; s++) {
        const rp = playFight({ rows: [...party, ...mons, foeSim], tallyDamage: false }, s);
        if (rp.winner === 'party') wins++;
        if (rp.capped) capped++;
        rounds += rp.rounds;
      }
      const winRate = wins / runs;
      const meanRounds = rounds / runs;
      console.log(`  [party-scale C ${n}h vs ${mons.length} normals + 1 Boss-tier foe NPC (${n}p)] win=${(winRate * 100).toFixed(1)}%, rounds=${meanRounds.toFixed(1)}, capped=${capped}`);
      expect(capped).toBe(0);
      if (n === 1) {
        expect(winRate, 'C 1h vs scaled Boss-tier foe NPC stays in 45-85%').toBeGreaterThanOrEqual(0.45);
        expect(winRate, 'C 1h vs scaled Boss-tier foe NPC stays in 45-85%').toBeLessThanOrEqual(0.85);
      } else {
        expect(winRate, `C ${n}h vs scaled foe-NPC roster clears >= 75%`).toBeGreaterThanOrEqual(0.75);
      }
      expect(meanRounds, `C ${n}h vs scaled foe-NPC roster lasts >= 3.0 rounds`).toBeGreaterThanOrEqual(3.0);
      expect(meanRounds, `C ${n}h vs scaled foe-NPC roster finishes <= 14 rounds`).toBeLessThanOrEqual(14);
    }
  }, workBudget(300, 300 * 150));
});
