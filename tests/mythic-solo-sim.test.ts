// mythic-solo-sim.test.ts: Mythic-class solo simulation checks against all 4 scripted Mythic bosses (MYTHIC_IDS).
// Each Mythic class fixture is built as a real S-rank level 70 Hunter (2:1 stats, 32-node legal tree, S-band title,
// 6-slot Mythic middle-grade gear, awakened Confluence + Marks + Apex) through `hunterRow`. Target solo win rate:
// 75% to 98% (hard floor 75%, aiming near 85%; >98% reported as diagnostic).
import { describe, expect } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, TREE_SHAPE, canBuyNode, classTreeOf, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { classPowers } from '../src/core/registry/class-powers.ts';
import { classDefOf } from '../src/core/registry/jobs.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { heldKeystones } from '../src/core/hunter/sheet.ts';
import { gradeOfSpend, itemSpend, titleSpend } from '../src/core/registry/item-budget.ts';
import { WEAR_LIMIT } from '../src/core/registry/items.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { runSoloMythic, scriptsOn } from './models/fight-sim.ts';
import { simTest, workBudget } from './models/sim-budget.ts';
import {
  HEMOMANCER_SOLO_SPEC,
  HEMO_VESSELS_18,
  HEMO_VESSELS_24,
  MYTHIC_SOLO_SPECS,
  SOLO_MYTHIC_RULES,
  buildMythicSoloHunter,
  buildMythicSoloRow,
} from './fixtures/mythic-hunters.ts';

const SOLO_RUNS = 200;
const DIAG_RUNS = 100;
const HARD_FLOOR = 0.75;
const HIGH_DIAGNOSTIC = 0.98;
const SOLO_BUDGET = workBudget(250);

/**
 * Recorded BEFORE baseline (branch extract-c at c65aef59, 0 Crimson Vessels) and pre-rescale PR C (24-power scale)
 * vs AFTER rank-driven rescale (120-power scale: 84/120 = +9/+9/+9 for 3 S-normals, 120/120 = +12/+12/+12 for 3 S-bosses):
 *   - plain:                         0/120 93.5% (187/200, 6.3r) | PR C 18/24 93.5%, 24/24 93.5% -> AFTER 84/120 93.5% (6.0r), 120/120 93.5% (5.9r)
 *   - angel-of-the-last-trumpet:     0/120 79.0% (158/200, 11.2r)| PR C 18/24 80.0%, 24/24 80.0% -> AFTER 84/120 80.0% (11.0r), 120/120 80.0% (11.0r)
 *   - zaratan-the-island-that-wakes: 0/120 85.5% (171/200, 15.9r)| PR C 18/24 91.0%, 24/24 90.5% -> AFTER 84/120 91.0% (15.5r), 120/120 89.0% (15.2r)
 *   - the-fourth-rider:              0/120 91.0% (182/200, 9.0r) | PR C 18/24 91.0%, 24/24 91.0% -> AFTER 84/120 91.0% (8.9r), 120/120 91.0% (8.9r)
 */
const HEMO_BEFORE_BASELINE: Readonly<Record<MythicScriptId, { readonly wins: number; readonly meanRounds: number }>> = {
  plain: { wins: 187, meanRounds: 6.3 },
  'angel-of-the-last-trumpet': { wins: 158, meanRounds: 11.2 },
  'zaratan-the-island-that-wakes': { wins: 171, meanRounds: 15.9 },
  'the-fourth-rider': { wins: 182, meanRounds: 9.0 },
};

describe('Mythic solo-sim hunter fixtures are 100% legal under shipped rules', () => {
  for (const spec of MYTHIC_SOLO_SPECS) {
    simTest(`${spec.className} fixture passes tree legality, S-band title, Mythic middle-grade gear, and keystone wiring`, () => {
      const tree = classTreeOf(spec.className);
      expect(tree).not.toBeNull();
      expect(validateTree(tree!)).toEqual([]);
      expect(spec.nodes.length).toBe(TREE_SHAPE.mythic.buyable);
      expect(repairNodes(tree!, spec.nodes)).toEqual([...spec.nodes]);

      const bought: ClassNodeId[] = [];
      for (const id of spec.nodes) {
        const check = canBuyNode(tree!, bought, id);
        expect(check.ok, `${spec.className} node ${id} refused`).toBe(true);
        bought.push(id);
      }

      // Title fits S-band budget
      const tSpend = titleSpend({ ...spec.title, band: 'S' }, SOLO_MYTHIC_RULES);
      expect(tSpend.points).toBeLessThanOrEqual(SOLO_MYTHIC_RULES.titleBudget.S);

      // 6-slot Mythic middle-grade gear
      const gear = spec.gear(SOLO_MYTHIC_RULES);
      expect(gear.length).toBe(WEAR_LIMIT);
      for (const item of gear) {
        expect(item.rar).toBe('mythic');
        const spend = itemSpend(item, SOLO_MYTHIC_RULES);
        expect(spend).not.toBeNull();
        expect(gradeOfSpend(SOLO_MYTHIC_RULES, 'mythic', spend!.points), `${item.name} spend ${spend!.points.toFixed(2)} not Mythic middle grade`).toBe(0);
      }

      // Real Hunter -> hunterRow loads awakened Confluence, Apex, capstone worn, and 4 class actives
      const h = buildMythicSoloHunter(spec, SOLO_MYTHIC_RULES);
      const sim = buildMythicSoloRow(spec, SOLO_MYTHIC_RULES);
      const cp = classPowers(h, SOLO_MYTHIC_RULES);
      const ks = heldKeystones(h, SOLO_MYTHIC_RULES);
      expect(h.job).toBe(spec.className);
      expect(h.jobDone).toBe(spec.className);
      expect(cp.worn).not.toBeNull();
      expect(sim.row.statuses.some(s => s.worn && s.key === cp.worn!.key)).toBe(true);
      const pair = classDefOf(spec.className)!.pair;
      const confluence = keystoneOf({ tier: 'confluence', pair }, SOLO_MYTHIC_RULES);
      expect(ks.some(k => k.keystone.name === confluence.name)).toBe(true);
      if (confluence.awakened !== null) expect(ks.some(k => k.awakened !== null)).toBe(true);
      expect(ks.length).toBeGreaterThanOrEqual(4);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      for (const a of cp.actives) {
        expect(sim.row.abilities.some(x => x.id === wornAbilityId(a.id)), `${spec.className} missing active ${a.name}`).toBe(true);
      }
    }, workBudget(0));
  }
});

describe('Hemomancer solo vs Mythic bosses (200 runs each, before 0/120 baseline and after 84/120 & 120/120 Crimson Vessels)', () => {
  const hero0 = buildMythicSoloRow(HEMOMANCER_SOLO_SPEC, SOLO_MYTHIC_RULES);
  const hero84 = buildMythicSoloRow(HEMOMANCER_SOLO_SPEC, SOLO_MYTHIC_RULES, { vessels: HEMO_VESSELS_18 });
  const hero120 = buildMythicSoloRow(HEMOMANCER_SOLO_SPEC, SOLO_MYTHIC_RULES, { vessels: HEMO_VESSELS_24 });

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Hemomancer solo (before / 0/120 vessels) vs ${mythicId}`, () => {
      const res = runSoloMythic(hero0, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      const base = HEMO_BEFORE_BASELINE[mythicId];
      console.log(`[solo-mythic:before 0/120] Hemomancer vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped) [baseline ${base.wins}/${SOLO_RUNS}]`);
      expect(res.capped).toBe(0);
      expect(res.wins, `Hemomancer 0/120 vs ${mythicId} drifted from baseline ${base.wins}/${SOLO_RUNS}`).toBe(base.wins);
      expect(res.winRate, `Hemomancer 0/120 vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
      expect(res.winRate, `Hemomancer 0/120 vs ${mythicId} win rate ${pct}% above 98% ceiling`).toBeLessThanOrEqual(HIGH_DIAGNOSTIC);
    }, SOLO_BUDGET);
  }

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Hemomancer solo (after / 84/120 vessels, 3 S-normals) vs ${mythicId}`, () => {
      const res = runSoloMythic(hero84, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      const base = HEMO_BEFORE_BASELINE[mythicId];
      const delta = ((res.wins - base.wins) / SOLO_RUNS * 100).toFixed(1);
      console.log(`[solo-mythic:after 84/120] Hemomancer vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped, delta ${Number(delta) >= 0 ? '+' : ''}${delta} pp vs before ${base.wins}/${SOLO_RUNS})`);
      expect(res.capped).toBe(0);
      expect(res.winRate, `Hemomancer 84/120 vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
      expect(res.winRate, `Hemomancer 84/120 vs ${mythicId} win rate ${pct}% above 98% hard ceiling`).toBeLessThanOrEqual(HIGH_DIAGNOSTIC);
    }, SOLO_BUDGET);
  }

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Hemomancer solo (after / 120/120 vessels, 3 S-bosses) vs ${mythicId}`, () => {
      const res = runSoloMythic(hero120, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      const base = HEMO_BEFORE_BASELINE[mythicId];
      const delta = ((res.wins - base.wins) / SOLO_RUNS * 100).toFixed(1);
      console.log(`[solo-mythic:after 120/120] Hemomancer vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped, delta ${Number(delta) >= 0 ? '+' : ''}${delta} pp vs before ${base.wins}/${SOLO_RUNS})`);
      expect(res.capped).toBe(0);
      expect(res.winRate, `Hemomancer 120/120 vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
      expect(res.winRate, `Hemomancer 120/120 vs ${mythicId} win rate ${pct}% above 98% hard ceiling`).toBeLessThanOrEqual(HIGH_DIAGNOSTIC);
    }, SOLO_BUDGET);
  }

  simTest('Hemomancer solo keystones-off diagnostic (shipped RULES.fight.keystone.on = false)', () => {
    const shipped = scriptsOn(RULES);
    const noKsHero = buildMythicSoloRow(HEMOMANCER_SOLO_SPEC, shipped);
    for (const id of ['plain', 'angel-of-the-last-trumpet'] as const) {
      const res = runSoloMythic(noKsHero, id, DIAG_RUNS, shipped);
      console.log(`[solo-mythic:keystones-off] Hemomancer vs ${id}: ${(res.winRate * 100).toFixed(1)}% (${res.wins}/${res.runs}, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped)`);
      expect(res.capped).toBe(0);
    }
  }, SOLO_BUDGET);
});
