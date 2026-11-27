// mythic-solo-sim.test.ts: Mythic-class solo simulation checks against all 4 scripted Mythic bosses (MYTHIC_IDS),
// shared legality checks, and soloRow negative self-tests.
// Each Mythic class fixture is built as a real S-rank level 70 Hunter (2:1 stats, 32-node legal tree, S-band title,
// 6-slot Mythic middle-grade gear, awakened Confluence + Marks + Apex) through `hunterRow`. Target solo win rate:
// 75% to 98% (hard floor 75%, aiming near 85%; exact baseline ratchet via `soloRow`).
import { readFileSync } from 'node:fs';
import { describe, expect } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, TREE_SHAPE, canBuyNode, classTreeOf, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { classPowers } from '../src/core/registry/class-powers.ts';
import { CLASS_NAMES, classDefOf } from '../src/core/registry/jobs.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { heldKeystones } from '../src/core/hunter/sheet.ts';
import { gradeOfSpend, itemSpend, titleSpend } from '../src/core/registry/item-budget.ts';
import { WEAR_LIMIT } from '../src/core/registry/items.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { runSoloMythic, scriptsOn } from './models/fight-sim.ts';
import type { SoloMythicResult } from './models/fight-sim.ts';
import { SOLO_PRESSURE_MIN_FLOOR, SOLO_RUNS, soloRow } from './models/mythic-row.ts';
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

const DIAG_RUNS = 100;
const SOLO_BUDGET = workBudget(250);

/** Exact recorded solo win baselines for Hemomancer across 0/120, 84/120, and 120/120 Crimson Vessels. */
const HEMO_BEFORE_BASELINE: Readonly<Record<MythicScriptId, number>> = {
  plain: 187,
  'angel-of-the-last-trumpet': 158,
  'zaratan-the-island-that-wakes': 171,
  'the-fourth-rider': 182,
};

const HEMO_VESSELS_84_BASELINE: Readonly<Record<MythicScriptId, number>> = {
  plain: 187,
  'angel-of-the-last-trumpet': 160,
  'zaratan-the-island-that-wakes': 182,
  'the-fourth-rider': 182,
};

const HEMO_VESSELS_120_BASELINE: Readonly<Record<MythicScriptId, number>> = {
  plain: 187,
  'angel-of-the-last-trumpet': 160,
  'zaratan-the-island-that-wakes': 178,
  'the-fourth-rider': 182,
};

describe('soloRow helper contract and fail-capable negative self-tests', () => {
  const mkRes = (boss: MythicScriptId, wins: number, capped = 0, runs = SOLO_RUNS): SoloMythicResult => {
    const winRate = wins / runs;
    return {
      mythicId: boss,
      runs,
      wins,
      winRate,
      se: Math.sqrt((winRate * (1 - winRate)) / runs),
      meanRounds: 10,
      capped,
    };
  };

  simTest('tests/models/mythic-row.ts contains no built-in class names', () => {
    const src = readFileSync(`${import.meta.dir}/models/mythic-row.ts`, 'utf8');
    const found = CLASS_NAMES.filter(name => new RegExp(`\\b${name}\\b`, 'i').exec(src) !== null);
    expect(found, `mythic-row.ts must not mention class names: ${found.join(', ')}`).toEqual([]);
  }, workBudget(0));

  simTest('soloRow accepts valid rows and fails loudly on every mutated contract violation', () => {
    // Valid standard row passes
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'angel-of-the-last-trumpet',
      res: mkRes('angel-of-the-last-trumpet', 170),
      baseline: 170,
      tallies: [{ name: 'hookless', actual: 0, min: 0 }],
      quiet: true,
    })).not.toThrow();

    // Valid plain row with ceiling 1.0 + passing pressure floor and exact pin passes
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 200),
      baseline: 200,
      ceiling: 1.0,
      pressure: { label: 'hp-drop', minRate: 0.5, actual: 0.52, exact: 0.52 },
      quiet: true,
    })).not.toThrow();

    // 1. Below 75% floor (0.74) fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'zaratan-the-island-that-wakes',
      res: mkRes('zaratan-the-island-that-wakes', 148),
      baseline: 148,
      quiet: true,
    })).toThrow(/below 75% floor/);

    // 2. Above 98% ceiling on scripted boss (0.99) fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'angel-of-the-last-trumpet',
      res: mkRes('angel-of-the-last-trumpet', 198),
      baseline: 198,
      quiet: true,
    })).toThrow(/above 98\.0% ceiling/);

    // 3. Capped fights > 0 fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'the-fourth-rider',
      res: mkRes('the-fourth-rider', 170, 1),
      baseline: 170,
      quiet: true,
    })).toThrow(/had 1 capped fights/);

    // 4. Exact ratchet drift (+1 or -1 win) fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 171),
      baseline: 170,
      quiet: true,
    })).toThrow(/drifted from recorded baseline 170\/200/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 169),
      baseline: 170,
      quiet: true,
    })).toThrow(/drifted from recorded baseline 170\/200/);

    // 5. ceiling 1.0 on scripted boss fails even with passing pressure
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'angel-of-the-last-trumpet',
      res: mkRes('angel-of-the-last-trumpet', 200),
      baseline: 200,
      ceiling: 1.0,
      pressure: { label: 'hp-drop', minRate: 0.5, actual: 0.8 },
      quiet: true,
    })).toThrow(/only allowed on plain/);

    // 6. ceiling 1.0 on plain without pressure fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 200),
      baseline: 200,
      ceiling: 1.0,
      quiet: true,
    })).toThrow(/requires a pressure floor/);

    // 7. ceiling 1.0 on plain with missing pressure.exact, failing pressure, weak minRate (0.01), or drifted exact pressure fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 200),
      baseline: 200,
      ceiling: 1.0,
      pressure: { label: 'hp-drop', minRate: SOLO_PRESSURE_MIN_FLOOR, actual: 0.55 },
      quiet: true,
    })).toThrow(/requires pressure\.exact/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 200),
      baseline: 200,
      ceiling: 1.0,
      pressure: { label: 'hp-drop', minRate: SOLO_PRESSURE_MIN_FLOOR, actual: 0.49, exact: 0.49 },
      quiet: true,
    })).toThrow(/below floor 50\.0%/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 200),
      baseline: 200,
      ceiling: 1.0,
      pressure: { label: 'hp-drop', minRate: 0.01, actual: 1.0, exact: 1.0 },
      quiet: true,
    })).toThrow(/below required floor 0\.5/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 200),
      baseline: 200,
      ceiling: 1.0,
      pressure: { label: 'hp-drop', minRate: SOLO_PRESSURE_MIN_FLOOR, actual: 0.55, exact: 0.525 },
      quiet: true,
    })).toThrow(/drifted from recorded 52\.5%/);

    // 8. Tally below floor or above max fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'zaratan-the-island-that-wakes',
      res: mkRes('zaratan-the-island-that-wakes', 170),
      baseline: 170,
      tallies: [{ name: 'zones erased', actual: 24, min: 25 }],
      quiet: true,
    })).toThrow(/tally "zones erased" \(24\) below floor 25/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'zaratan-the-island-that-wakes',
      res: mkRes('zaratan-the-island-that-wakes', 170),
      baseline: 170,
      tallies: [{ name: 'cheat-death rate', actual: 0.6, min: 0, max: 0.5 }],
      quiet: true,
    })).toThrow(/tally "cheat-death rate" \(0\.6\) above max 0\.5/);

    // 9. Boss mismatch, runs !== SOLO_RUNS, and forged winRate !== wins / runs fail
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('the-fourth-rider', 170),
      baseline: 170,
      quiet: true,
    })).toThrow(/does not match plain/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 85, 0, 100),
      baseline: 85,
      quiet: true,
    })).toThrow(/must equal SOLO_RUNS \(200\)/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: { ...mkRes('plain', 170), winRate: 0.9 },
      baseline: 170,
      quiet: true,
    })).toThrow(/does not match wins\/runs/);
  }, workBudget(0));
});

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
      soloRow({
        className: 'Hemomancer',
        label: '0/120 vessels',
        boss: mythicId,
        res,
        baseline: HEMO_BEFORE_BASELINE[mythicId],
        tallies: [{ name: 'hookless-mythic', actual: 0, min: 0 }],
      });
    }, SOLO_BUDGET);
  }

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Hemomancer solo (after / 84/120 vessels, 3 S-normals) vs ${mythicId}`, () => {
      const res = runSoloMythic(hero84, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      soloRow({
        className: 'Hemomancer',
        label: '84/120 vessels',
        boss: mythicId,
        res,
        baseline: HEMO_VESSELS_84_BASELINE[mythicId],
        tallies: [{ name: 'hookless-mythic', actual: 0, min: 0 }],
      });
    }, SOLO_BUDGET);
  }

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Hemomancer solo (after / 120/120 vessels, 3 S-bosses) vs ${mythicId}`, () => {
      const res = runSoloMythic(hero120, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      soloRow({
        className: 'Hemomancer',
        label: '120/120 vessels',
        boss: mythicId,
        res,
        baseline: HEMO_VESSELS_120_BASELINE[mythicId],
        tallies: [{ name: 'hookless-mythic', actual: 0, min: 0 }],
      });
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
