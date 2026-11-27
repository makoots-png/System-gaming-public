// Simulation rows for NPC unit 4 (npc-final.md section 5):
// 1. Skill 5 parity & Boss spread (400 seeds): 3 rank-C NPCs (brute, caster, skirmisher) on plain built-in skills vs diff-5 C boss.
// 2. 3v3 rank-C mirror (400 seeds): plain kits (pure default and built-in skills) with side-swapped default placement;
//    Optimal vs Optimal 40-60%, Optimal vs Sloppy 68-92%, win(1) < win(2) < win(3) < win(5) and win(4) near win(5).
// 3. Act 1 Wave 1 non-trivialization (400 seeds): 4p + Support ally, 1p + Support ally, p + Standard vs p+1 foes (shared Act 1 helpers).
// 4. Foe NPC parity & XP (rank C, 400 seeds): Standard squad within +/-8 pts of monsters; 1 Standard (1x XP), 1 real Elite (1.5x XP),
//    and 1 real Boss (3x XP) party HP loss parity (Elite and Boss foe NPCs carry stagger bars like same-tier monsters).
// Every test uses `simTest` with a deterministic work budget (tests/models/sim-budget.ts).
import { describe, expect } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { newNpc, npcTierPreset } from '../src/core/registry/npcs.ts';
import type { NpcSkill, NpcTierPreset } from '../src/core/registry/npcs.ts';
import { npcRows } from '../src/core/combat/rows.ts';
import { SKILL_ABILITIES } from '../src/core/registry/abilities.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { tiles } from '../src/core/combat/space.ts';
import { paceCost, tick } from '../src/core/combat/timeline.ts';
import { parseFormula } from '../src/core/formula.ts';
import { sensible } from '../src/core/combat/policy.ts';
import { difficultyFactor } from '../src/core/gates/difficulty.ts';
import { xpOf } from '../src/core/registry/monsters.ts';
import type { NewRow } from '../src/core/combat/fight-types.ts';
import { act1BareParty, act1SampleParty, act1WaveFoes } from './fixtures/act1.ts';
import { hunter, monster, playFight } from './models/fight-sim.ts';
import type { Policy, SimRow } from './models/fight-sim.ts';
import { simTest, workBudget } from './models/sim-budget.ts';

const RUNS = 400;
const sensiblePolicy: Policy = (f, me, _plan, R) => sensible(f, me, R);
const pf = (src: string) => {
  const r = parseFormula(src, RULES);
  if (!r.ok) throw new Error(r.error);
  return r.formula;
};

// Standard healing spell for tactical caster NPCs (within the 4-ability maker cap).
const npcMend = abilityOf('support', {
  id: abilityId('npc-mend'), name: 'Mend', range: tiles(6), shape: { kind: 'touch', reach: tiles(6) },
  cost: { fatigue: 4, mana: 6, time: paceCost('standard', RULES.fight), cooldown: tick(2 * RULES.fight.round) },
  effect: { type: 'heal', by: 'hand', formula: pf('2d8 + mag') },
}, RULES);

/**
 * 3 rank-C NPCs (brute, caster, skirmisher) on plain built-in skills (no decoy attacks) for Row 1.
 * Scaled to geared-hunter parity (`elite` with 0.85x HP/dealt) so a diff-5 C boss lands near the ~70% anchor
 * instead of saturating at 0% (standard) or 99% (full elite).
 */
function bossSquad(skill: NpcSkill, stripNpc = false): SimRow[] {
  const { tier } = npcTierPreset('elite', RULES);
  const tweak = { hp: 0.85, dealt: 0.85, stats: {}, traits: [] };
  const tpls = [
    newNpc({ name: 'Brute Ally', rank: 'C', archetype: 'brute', tier, tweak, defaultSide: 'party', skill, abilities: [SKILL_ABILITIES.Mutilation(RULES)!, SKILL_ABILITIES['Shield Wall'](RULES)!] }),
    newNpc({ name: 'Caster Ally', rank: 'C', archetype: 'caster', tier, tweak, defaultSide: 'party', skill, abilities: [SKILL_ABILITIES['Arc Bolt'](RULES)!, npcMend, SKILL_ABILITIES['Shield Wall'](RULES)!] }),
    newNpc({ name: 'Skirmisher Ally', rank: 'C', archetype: 'skirmisher', tier, tweak, defaultSide: 'party', skill, abilities: [SKILL_ABILITIES['Marked Shot'](RULES)!, SKILL_ABILITIES.Stun(RULES)!] }),
  ];
  const ids = [combatantId('nb'), combatantId('nc'), combatantId('ns')];
  return tpls.map((tpl, i) => {
    const raw = npcRows(tpl, [ids[i]!], RULES)[0]!;
    if (!stripNpc) return { row: raw, policy: sensiblePolicy };
    const { npc: _omit, ...plain } = raw as Extract<NewRow, { kind: 'hunter' }>;
    return { row: plain, policy: sensiblePolicy };
  });
}

/**
 * 3 rank-C Standard NPCs (brute, caster, skirmisher) at default placement for Row 2 (3v3 mirror),
 * either on pure default kits (archetype attacks only) or with plain built-in skills.
 */
function mirrorSquad(side: 'party' | 'foe', skill: NpcSkill, prefix: string, withSkills: boolean): SimRow[] {
  const { tier, tweak } = npcTierPreset('standard', RULES);
  const tpls = withSkills ? [
    newNpc({ name: `${prefix} Brute`, rank: 'C', archetype: 'brute', tier, tweak, defaultSide: side, skill, abilities: [SKILL_ABILITIES.Mutilation(RULES)!, SKILL_ABILITIES['Shield Wall'](RULES)!] }),
    newNpc({ name: `${prefix} Caster`, rank: 'C', archetype: 'caster', tier, tweak, defaultSide: side, skill, abilities: [SKILL_ABILITIES['Arc Bolt'](RULES)!, npcMend] }),
    newNpc({ name: `${prefix} Skirmisher`, rank: 'C', archetype: 'skirmisher', tier, tweak, defaultSide: side, skill, abilities: [SKILL_ABILITIES['Marked Shot'](RULES)!] }),
  ] : [
    newNpc({ name: `${prefix} Brute`, rank: 'C', archetype: 'brute', tier, tweak, defaultSide: side, skill }),
    newNpc({ name: `${prefix} Caster`, rank: 'C', archetype: 'caster', tier, tweak, defaultSide: side, skill }),
    newNpc({ name: `${prefix} Skirmisher`, rank: 'C', archetype: 'skirmisher', tier, tweak, defaultSide: side, skill }),
  ];
  return tpls.map((tpl, i) => ({
    row: npcRows(tpl, [combatantId(`${prefix}${i}`)], RULES)[0]!,
    policy: sensiblePolicy,
  }));
}

/**
 * Runs a 400-seed 3v3 mirror on default placement with half the seeds side-swapped.
 * In unswapped default placement (`y=2` vs `y=10`, distance 8 = exact shot/curse range), `reachable`'s `(steps, y, x)`
 * tie-break dodges north (`-y`), stepping the top side to `y=1` (distance 9, out of range) while stepping the bottom
 * side to `y=9` (distance 7, in range), which gives a 30.5% / 69.5% directional split on identical 5v5 squads.
 * Swapping sides across half the seeds cancels that map-orientation asymmetry cleanly.
 */
function runMirror(a: NpcSkill, b: NpcSkill, withSkills: boolean): number {
  const half = RUNS / 2;
  const pA = mirrorSquad('party', a, 'a', withSkills);
  const fB = mirrorSquad('foe', b, 'f', withSkills);
  const pB = mirrorSquad('party', b, 'b', withSkills);
  const fA = mirrorSquad('foe', a, 'g', withSkills);
  let wins = 0;
  for (let seed = 1; seed <= half; seed++) {
    if (playFight({ rows: [...pA, ...fB], tallyDamage: false }, seed).winner === 'party') wins++;
    if (playFight({ rows: [...pB, ...fA], tallyDamage: false }, seed).winner === 'foe') wins++;
  }
  return wins / RUNS;
}

function act1AllyNpc(preset: NpcTierPreset): SimRow {
  return {
    row: npcRows(newNpc({ name: 'Guide Ally', rank: 'E', archetype: 'brute', ...npcTierPreset(preset, RULES), defaultSide: 'party', skill: 3 }), [combatantId('npc-ally')], RULES)[0]!,
    policy: sensiblePolicy,
  };
}

describe('NPC simulations (npc-final.md section 5)', () => {
  simTest('Row 1: skill 5 matches no-skill sensible with 0 diff and plain-kit boss spread lands 20 to 35 points above skill 1 (>= 25%) with win(4) near win(5)', () => {
    const bossScale = difficultyFactor('boss', 'C', 5, RULES);
    const boss = () => monster('C', 'brute', 'boss', 'boss', RULES, [], bossScale);
    const plain = bossSquad(5, true);
    const squads = ([1, 2, 3, 4, 5] as const).map(sk => bossSquad(sk));

    let diffs = 0;
    const wins = [0, 0, 0, 0, 0];
    const samePlay = (a: ReturnType<typeof playFight>, b: ReturnType<typeof playFight>): boolean => {
      if (a.winner !== b.winner || a.rounds !== b.rounds || a.ticks !== b.ticks) return false;
      if (JSON.stringify(a.dead) !== JSON.stringify(b.dead)) return false;
      for (const id of Object.keys(a.end)) {
        // End-of-fight `fightRested` skips `r.npc` while recovering fatigue on non-NPC rows, so compare HP, mana, and full turn tallies.
        if (a.end[id]?.hp !== b.end[id]?.hp || a.end[id]?.mana !== b.end[id]?.mana) return false;
        const ta = a.tally[id], tb = b.tally[id];
        if (!ta || !tb || ta.turns !== tb.turns || ta.moves !== tb.moves || ta.passes !== tb.passes || JSON.stringify(ta.acts) !== JSON.stringify(tb.acts)) return false;
      }
      return true;
    };
    for (let seed = 1; seed <= RUNS; seed++) {
      const rPlain = playFight({ rows: [...plain, boss()], tallyDamage: false }, seed);
      const r5 = playFight({ rows: [...squads[4]!, boss()], tallyDamage: false }, seed);
      if (!samePlay(r5, rPlain)) diffs++;
      if (r5.winner === 'party') wins[4]!++;
      for (let i = 0; i < 4; i++) {
        if (playFight({ rows: [...squads[i]!, boss()], tallyDamage: false }, seed).winner === 'party') wins[i]!++;
      }
    }
    const [p1, p2, p3, p4, p5] = wins.map(w => w / RUNS) as [number, number, number, number, number];
    const dropPts = (p5 - p1) * 100;
    console.log(`  [NPC Row 1 Boss] diff(5 vs plain)=${diffs}, sk1=${(p1 * 100).toFixed(1)}%, sk2=${(p2 * 100).toFixed(1)}%, sk3=${(p3 * 100).toFixed(1)}%, sk4=${(p4 * 100).toFixed(1)}%, sk5=${(p5 * 100).toFixed(1)}%, drop=${dropPts.toFixed(1)} pts`);

    expect(diffs, 'skill 5 has 0 diff vs no-skill sensible').toBe(0);
    expect(p5, 'win(5) > win(3)').toBeGreaterThan(p3);
    expect(p3, 'win(3) > win(1)').toBeGreaterThan(p1);
    expect(Math.abs(p5 - p4), 'win(4) sits near win(5)').toBeLessThanOrEqual(0.08);
    expect(dropPts, 'skill 1 lands 20 to 35 points below skill 5').toBeGreaterThanOrEqual(20);
    expect(dropPts, 'skill 1 lands 20 to 35 points below skill 5').toBeLessThanOrEqual(35);
    expect(p1, 'skill 1 stays >= 25%').toBeGreaterThanOrEqual(0.25);
  }, workBudget(6 * RUNS, 6 * RUNS * 250));

  simTest('Row 2a: 3v3 rank-C plain built-in skills mirror holds 40-60% at 5v5, 68-92% at 5v1, win(1) < win(2) < win(3) < win(5), and win(4) near win(5)', () => {
    const w55 = runMirror(5, 5, true);
    const w51 = runMirror(5, 1, true);
    const w54 = runMirror(5, 4, true);
    const w13 = runMirror(1, 3, true);
    const w23 = runMirror(2, 3, true);
    const w33 = runMirror(3, 3, true);
    const w43 = runMirror(4, 3, true);
    const w53 = runMirror(5, 3, true);
    console.log(`  [NPC Row 2a Mirror built-in] 5v5=${(w55 * 100).toFixed(1)}%, 5v1=${(w51 * 100).toFixed(1)}%, 5v4=${(w54 * 100).toFixed(1)}%, vs3: 1=${(w13 * 100).toFixed(1)}% < 2=${(w23 * 100).toFixed(1)}% < 3=${(w33 * 100).toFixed(1)}% < 4=${(w43 * 100).toFixed(1)}% ~ 5=${(w53 * 100).toFixed(1)}%`);

    expect(w55).toBeGreaterThanOrEqual(0.40);
    expect(w55).toBeLessThanOrEqual(0.60);
    expect(w51).toBeGreaterThanOrEqual(0.68);
    expect(w51).toBeLessThanOrEqual(0.92);
    expect(w13, 'win(1) < win(2)').toBeLessThan(w23);
    expect(w23, 'win(2) < win(3)').toBeLessThan(w33);
    expect(w33, 'win(3) < win(5)').toBeLessThan(w53);
    expect(Math.abs(w53 - w43), 'win(4) sits near win(5) vs Steady').toBeLessThanOrEqual(0.08);
    expect(w54, '5 vs 4 stays near even').toBeGreaterThanOrEqual(0.42);
    expect(w54, '5 vs 4 stays near even').toBeLessThanOrEqual(0.58);
  }, workBudget(8 * RUNS, 8 * RUNS * 250));

  simTest('Row 2b: 3v3 rank-C pure default-kit mirror (archetype attacks only) holds 40-60% at 5v5, 68-92% at 5v1, win(1) < win(2) < win(3) < win(5), and win(4) near win(5)', () => {
    const w55 = runMirror(5, 5, false);
    const w51 = runMirror(5, 1, false);
    const w54 = runMirror(5, 4, false);
    const w13 = runMirror(1, 3, false);
    const w23 = runMirror(2, 3, false);
    const w33 = runMirror(3, 3, false);
    const w43 = runMirror(4, 3, false);
    const w53 = runMirror(5, 3, false);
    console.log(`  [NPC Row 2b Mirror default] 5v5=${(w55 * 100).toFixed(1)}%, 5v1=${(w51 * 100).toFixed(1)}%, 5v4=${(w54 * 100).toFixed(1)}%, vs3: 1=${(w13 * 100).toFixed(1)}% < 2=${(w23 * 100).toFixed(1)}% < 3=${(w33 * 100).toFixed(1)}% < 4=${(w43 * 100).toFixed(1)}% ~ 5=${(w53 * 100).toFixed(1)}%`);

    expect(w55).toBeGreaterThanOrEqual(0.40);
    expect(w55).toBeLessThanOrEqual(0.60);
    expect(w51).toBeGreaterThanOrEqual(0.68);
    expect(w51).toBeLessThanOrEqual(0.92);
    expect(w13, 'win(1) < win(2)').toBeLessThan(w23);
    expect(w23, 'win(2) < win(3)').toBeLessThan(w33);
    expect(w33, 'win(3) < win(5)').toBeLessThan(w53);
    expect(Math.abs(w53 - w43), 'win(4) sits near win(5) vs Steady').toBeLessThanOrEqual(0.08);
    expect(w54, '5 vs 4 stays near even').toBeGreaterThanOrEqual(0.42);
    expect(w54, '5 vs 4 stays near even').toBeLessThanOrEqual(0.58);
  }, workBudget(8 * RUNS, 8 * RUNS * 250));

  simTest('Row 3a: Act 1 Wave 1 (4p + Support ally, 1p + Support ally) does not trivialize 4p and lifts 1p to >= 92%', () => {
    const party4 = act1SampleParty(4, 1);
    const party1 = act1BareParty(1, 1);
    const ally = act1AllyNpc('support');
    const supW = RULES.fight.partyScale.allyWeight.support;
    const foes4 = act1WaveFoes(1, 4 + supW);
    const foes1 = act1WaveFoes(1, 1);
    const foes1Ally = act1WaveFoes(1, 1 + supW);

    let rounds4 = 0, playerDmg4 = 0, npcDmg4 = 0, wins4 = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = playFight({ rows: [...party4, ally, ...foes4] }, seed);
      if (r.winner === 'party') wins4++;
      rounds4 += r.rounds;
      for (const p of party4) playerDmg4 += r.tally[p.row.id]?.dealt ?? 0;
      npcDmg4 += r.tally[ally.row.id]?.dealt ?? 0;
    }
    const meanRounds4 = rounds4 / RUNS;
    const playerShare4 = playerDmg4 / Math.max(1, playerDmg4 + npcDmg4);

    let wins1Base = 0, wins1Ally = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      if (playFight({ rows: [...party1, ...foes1], tallyDamage: false }, seed).winner === 'party') wins1Base++;
      if (playFight({ rows: [...party1, ally, ...foes1Ally], tallyDamage: false }, seed).winner === 'party') wins1Ally++;
    }
    const rate1Base = wins1Base / RUNS, rate1Ally = wins1Ally / RUNS;
    console.log(`  [NPC Row 3a Act1] 4p+Support: win=${(wins4 / RUNS * 100).toFixed(1)}%, rounds=${meanRounds4.toFixed(2)}, playerDmg=${(playerShare4 * 100).toFixed(1)}%; 1p: ${(rate1Base * 100).toFixed(1)}% -> ${(rate1Ally * 100).toFixed(1)}%`);

    expect(meanRounds4, '4p + Support ally mean rounds >= 3.0').toBeGreaterThanOrEqual(3.0);
    expect(playerShare4, 'players deal >= 72% of party damage').toBeGreaterThanOrEqual(0.72);
    expect(rate1Ally, '1p + Support ally win rate >= 92%').toBeGreaterThanOrEqual(0.92);
    expect(rate1Ally, '1p + Support ally rises over solo baseline').toBeGreaterThan(rate1Base);
  }, workBudget(3 * RUNS, 3 * RUNS * 250));

  simTest('Row 3b: Act 1 Wave 1 (p players + Standard ally vs p+1 foes) holds Wave 1 bounds and NPC damage share <= 1/(p+1) + 0.15', () => {
    const ally = act1AllyNpc('standard');
    for (const p of [1, 2, 3, 4] as const) {
      const party = act1SampleParty(p, 1);
      const foes = act1WaveFoes(1, p + 1);
      let wins = 0, playerDeaths = 0, rounds = 0, capped = 0, playerDmg = 0, npcDmg = 0;
      for (let seed = 1; seed <= RUNS; seed++) {
        const r = playFight({ rows: [...party, ally, ...foes] }, seed);
        if (r.winner === 'party') wins++;
        if (r.dead.some(d => d !== ally.row.id)) playerDeaths++;
        if (r.capped) capped++;
        rounds += r.rounds;
        for (const h of party) playerDmg += r.tally[h.row.id]?.dealt ?? 0;
        npcDmg += r.tally[ally.row.id]?.dealt ?? 0;
      }
      const winRate = wins / RUNS;
      const deathRate = playerDeaths / RUNS;
      const meanRounds = rounds / RUNS;
      const npcShare = npcDmg / Math.max(1, playerDmg + npcDmg);
      const shareCap = 1 / (p + 1) + 0.15;
      console.log(`  [NPC Row 3b Act1 ${p}p+Std vs W1(${p + 1})] win=${(winRate * 100).toFixed(1)}%, deaths=${(deathRate * 100).toFixed(1)}%, rounds=${meanRounds.toFixed(2)}, npcShare=${(npcShare * 100).toFixed(1)}% (<= ${(shareCap * 100).toFixed(1)}%)`);

      expect(capped).toBe(0);
      expect(meanRounds).toBeGreaterThanOrEqual(1);
      expect(meanRounds).toBeLessThanOrEqual(25);
      expect(winRate, `${p}p + Standard holds Wave 1 win bound`).toBeGreaterThanOrEqual(0.95);
      expect(deathRate, `${p}p + Standard holds Wave 1 death bound`).toBeLessThanOrEqual(0.45);
      if (p + 1 === 4) expect(deathRate, '3p + Standard holds 4p Wave 1 death bound').toBeLessThanOrEqual(0.20);
      expect(npcShare, `${p}p + Standard NPC damage share <= 1/(p+1) + 0.15`).toBeLessThanOrEqual(shareCap);
    }
  }, workBudget(4 * RUNS, 4 * RUNS * 250));

  simTest('Row 4: rank-C foe NPC squad stays within +/-8 pts of standard monsters, and 1 Standard / 1 real Elite / 1 real Boss HP loss matches tier XP (1x / 1.5x / 3x)', () => {
    const party2 = [hunter('bruiser', 'C', 'b'), hunter('cannon', 'C', 'c')];
    const monSquad = [
      { ...monster('C', 'brute', 'normal', 'm1'), policy: sensiblePolicy },
      { ...monster('C', 'skirmisher', 'normal', 'm2'), policy: sensiblePolicy },
      { ...monster('C', 'caster', 'normal', 'm3'), policy: sensiblePolicy },
    ];
    const npcSquad: SimRow[] = (['brute', 'skirmisher', 'caster'] as const).map((arch, i) => ({
      row: npcRows(newNpc({ name: `Foe ${arch}`, rank: 'C', archetype: arch, ...npcTierPreset('standard', RULES), defaultSide: 'foe', skill: 3 }), [combatantId(`fn${i}`)], RULES)[0]!,
      policy: sensiblePolicy,
    }));

    let monWins = 0, npcWins = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      if (playFight({ rows: [...party2, ...monSquad], tallyDamage: false }, seed).winner === 'party') monWins++;
      if (playFight({ rows: [...party2, ...npcSquad], tallyDamage: false }, seed).winner === 'party') npcWins++;
    }
    const squadDiffPts = Math.abs(monWins - npcWins) / RUNS * 100;

    // 1 Standard (1x XP), 1 real Elite (1.5x XP), and 1 real Boss (3x XP) foe NPC vs same-rank monster against reference 4p party.
    const ref4 = [hunter('tank', 'C', 't'), hunter('bruiser', 'C', 'b'), hunter('cannon', 'C', 'c'), hunter('speed', 'C', 's')].map(s => ({ ...s, policy: sensiblePolicy }));
    const lossOf = (rec: ReturnType<typeof playFight>) =>
      ['t', 'b', 'c', 's'].reduce((sum, id) => sum + ((rec.tally[id]?.hpMax ?? 0) - (rec.end[id]?.hp ?? 0)), 0);

    const stdMon = { ...monster('C', 'skirmisher', 'normal', 'ms'), policy: sensiblePolicy };
    const stdNpc: SimRow = {
      row: npcRows(newNpc({ name: 'Std Foe', rank: 'C', archetype: 'skirmisher', ...npcTierPreset('standard', RULES), defaultSide: 'foe', skill: 3 }), [combatantId('ns')], RULES)[0]!,
      policy: sensiblePolicy,
    };
    const eliteMon = { ...monster('C', 'skirmisher', 'elite', 'me'), policy: sensiblePolicy };
    const eliteNpc: SimRow = {
      row: npcRows(newNpc({ name: 'Elite Foe', rank: 'C', archetype: 'skirmisher', ...npcTierPreset('elite', RULES), defaultSide: 'foe', skill: 3 }), [combatantId('ne')], RULES)[0]!,
      policy: sensiblePolicy,
    };
    const bossMon = { ...monster('C', 'skirmisher', 'boss', 'mb'), policy: sensiblePolicy };
    const bossNpc: SimRow = {
      row: npcRows(newNpc({ name: 'Boss Foe', rank: 'C', archetype: 'skirmisher', ...npcTierPreset('boss', RULES), defaultSide: 'foe', skill: 3 }), [combatantId('nb')], RULES)[0]!,
      policy: sensiblePolicy,
    };

    let stdMonLoss = 0, stdNpcLoss = 0, eliteMonLoss = 0, eliteNpcLoss = 0, bossMonLoss = 0, bossNpcLoss = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      stdMonLoss += lossOf(playFight({ rows: [...ref4, stdMon], tallyDamage: false }, seed));
      stdNpcLoss += lossOf(playFight({ rows: [...ref4, stdNpc], tallyDamage: false }, seed));
      eliteMonLoss += lossOf(playFight({ rows: [...ref4, eliteMon], tallyDamage: false }, seed));
      eliteNpcLoss += lossOf(playFight({ rows: [...ref4, eliteNpc], tallyDamage: false }, seed));
      bossMonLoss += lossOf(playFight({ rows: [...ref4, bossMon], tallyDamage: false }, seed));
      bossNpcLoss += lossOf(playFight({ rows: [...ref4, bossNpc], tallyDamage: false }, seed));
    }
    const mStd = stdMonLoss / RUNS, nStd = stdNpcLoss / RUNS;
    const mEl = eliteMonLoss / RUNS, nEl = eliteNpcLoss / RUNS;
    const mBoss = bossMonLoss / RUNS, nBoss = bossNpcLoss / RUNS;
    console.log(`  [NPC Row 4 Foe Parity] squad: mon=${(monWins / RUNS * 100).toFixed(1)}%, npc=${(npcWins / RUNS * 100).toFixed(1)}% (diff=${squadDiffPts.toFixed(1)} pts); 1 Std HP lost: mon=${mStd.toFixed(1)}, npc=${nStd.toFixed(1)}; 1 Elite HP lost: mon=${mEl.toFixed(1)}, npc=${nEl.toFixed(1)}; 1 Boss HP lost: mon=${mBoss.toFixed(1)}, npc=${nBoss.toFixed(1)}`);

    // Squad parity within +/-8 percentage points.
    expect(squadDiffPts, 'Standard foe NPC squad within +/-8 points of standard monsters').toBeLessThanOrEqual(8);
    // Tier XP scales 1x / 1.5x / 3x from RULES.fight.kinds.
    expect(stdNpc.row.xp).toBe(xpOf(RULES, 'C', 'normal'));
    expect(eliteNpc.row.xp).toBe(xpOf(RULES, 'C', 'elite'));
    expect(bossNpc.row.xp).toBe(xpOf(RULES, 'C', 'boss'));
    expect(eliteNpc.row.xp / stdNpc.row.xp).toBeCloseTo(1.5, 2);
    expect(bossNpc.row.xp / stdNpc.row.xp).toBeCloseTo(3.0, 2);
    // 1 Standard, 1 real Elite, and 1 real Boss foe NPC each match their real same-rank monster within 20%.
    expect(Math.abs(nStd - mStd) / Math.max(1, mStd), '1 Standard foe NPC HP loss matches normal monster').toBeLessThanOrEqual(0.20);
    expect(Math.abs(nEl - mEl) / Math.max(1, mEl), '1 Elite foe NPC HP loss matches real elite monster').toBeLessThanOrEqual(0.20);
    expect(Math.abs(nBoss - mBoss) / Math.max(1, mBoss), '1 Boss foe NPC HP loss matches real boss monster').toBeLessThanOrEqual(0.20);
  }, workBudget(8 * RUNS, 8 * RUNS * 200));
});
