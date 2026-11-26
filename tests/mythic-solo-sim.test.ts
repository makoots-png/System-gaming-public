// mythic-solo-sim.test.ts: Mythic-class solo simulation checks against all 4 scripted Mythic bosses (MYTHIC_IDS).
// Each Mythic class fixture is built as a real S-rank level 70 Hunter (2:1 stats, 32-node legal tree, S-band title,
// 6-slot Mythic middle-grade gear, awakened Confluence + Marks + Apex) through `hunterRow`. Target solo win rate:
// 75% to 98% (hard floor 75%, aiming near 85%; >98% reported as diagnostic).
import { describe, expect } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, TREE_SHAPE, canBuyNode, classTreeOf, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { classPowers } from '../src/core/registry/class-powers.ts';
import { heldKeystones } from '../src/core/hunter/sheet.ts';
import { gradeOfSpend, itemSpend, titleSpend } from '../src/core/registry/item-budget.ts';
import { WEAR_LIMIT } from '../src/core/registry/items.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { runSoloMythic, scriptsOn } from './models/fight-sim.ts';
import { simTest, workBudget } from './models/sim-budget.ts';
import { HEMOMANCER_SOLO_SPEC, MYTHIC_SOLO_SPECS, SOLO_MYTHIC_RULES, buildMythicSoloHunter, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';

const SOLO_RUNS = 200;
const DIAG_RUNS = 100;
const HARD_FLOOR = 0.75;
const HIGH_DIAGNOSTIC = 0.98;
const SOLO_BUDGET = workBudget(250);

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
      expect(ks.some(k => k.awakened !== null)).toBe(true);
      expect(ks.length).toBeGreaterThanOrEqual(4);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      for (const a of cp.actives) {
        expect(sim.row.abilities.some(x => x.id === wornAbilityId(a.id)), `${spec.className} missing active ${a.name}`).toBe(true);
      }
    }, workBudget(0));
  }
});

describe('Hemomancer solo vs Mythic bosses (200 runs each, target 75% to 98% aiming near 85%)', () => {
  const hero = buildMythicSoloRow(HEMOMANCER_SOLO_SPEC, SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Hemomancer solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      const diag = res.winRate > HIGH_DIAGNOSTIC ? ' [DIAGNOSTIC: >98% hot]' : '';
      console.log(`[solo-mythic] Hemomancer vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped)${diag}`);
      expect(res.winRate, `Hemomancer vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
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
