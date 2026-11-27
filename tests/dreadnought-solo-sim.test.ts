// dreadnought-solo-sim.test.ts: Dreadnought (Mythic, vit+dis) solo simulation checks against all 4 scripted Mythic
// bosses, fixture legality, and Hook H1 Wrath / All-Out / Broadside fight-observed tallies.
import { describe, expect } from 'bun:test';
import { fightId } from '../src/core/ids.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, TREE_SHAPE, canBuyNode, classTreeOf, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { classPowers } from '../src/core/registry/class-powers.ts';
import { heldKeystones } from '../src/core/hunter/sheet.ts';
import { gradeOfSpend, itemSpend, titleSpend } from '../src/core/registry/item-budget.ts';
import { WEAR_LIMIT } from '../src/core/registry/items.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Running } from '../src/core/combat/fight.ts';
import { CAP_ROUNDS, playBegin, playOver, playStep } from '../src/core/combat/play.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { answering, runSoloMythic, scripted } from './models/fight-sim.ts';
import { beginFight, recordFightStep, simTest, workBudget } from './models/sim-budget.ts';
import { SOLO_MYTHIC_RULES, buildMythicSoloHunter, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';
import {
  DREADNOUGHT_ALL_OUT_ID,
  DREADNOUGHT_BROADSIDE_ID,
  DREADNOUGHT_SOLO_SPEC,
  KEY_DREAD_WRATH,
} from './fixtures/dreadnought-solo.ts';

const SOLO_RUNS = 200;
const HARD_FLOOR = 0.75;
const HARD_CEILING = 0.98;
const SOLO_BUDGET = workBudget(250);
const TALLY_SEEDS = 15;

describe('Dreadnought solo-sim fixture legality and Hook H1 Wrath/All-Out/Broadside tally', () => {
  simTest('Dreadnought fixture passes tree legality, S-band title, Mythic middle-grade heavy gear, and awakened Stonewall wiring', () => {
    const spec = DREADNOUGHT_SOLO_SPEC;
    const tree = classTreeOf(spec.className);
    expect(tree).not.toBeNull();
    expect(validateTree(tree!)).toEqual([]);
    expect(spec.nodes.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(tree!, spec.nodes)).toEqual([...spec.nodes]);

    const bought: ClassNodeId[] = [];
    for (const id of spec.nodes) {
      const check = canBuyNode(tree!, bought, id);
      expect(check.ok, `Dreadnought node ${id} refused`).toBe(true);
      bought.push(id);
    }

    const tSpend = titleSpend({ ...spec.title, band: 'S' }, SOLO_MYTHIC_RULES);
    expect(tSpend.points).toBeLessThanOrEqual(SOLO_MYTHIC_RULES.titleBudget.S);

    const gear = spec.gear(SOLO_MYTHIC_RULES);
    expect(gear.length).toBe(WEAR_LIMIT);
    for (const item of gear) {
      expect(item.rar).toBe('mythic');
      const spend = itemSpend(item, SOLO_MYTHIC_RULES);
      expect(spend).not.toBeNull();
      expect(gradeOfSpend(SOLO_MYTHIC_RULES, 'mythic', spend!.points), `${item.name} spend ${spend!.points.toFixed(2)} not Mythic middle grade`).toBe(0);
    }

    const h = buildMythicSoloHunter(spec, SOLO_MYTHIC_RULES);
    const sim = buildMythicSoloRow(spec, SOLO_MYTHIC_RULES);
    const cp = classPowers(h, SOLO_MYTHIC_RULES);
    const ks = heldKeystones(h, SOLO_MYTHIC_RULES);
    expect(h.job).toBe('Dreadnought');
    expect(h.jobDone).toBe('Dreadnought');
    expect(cp.worn).not.toBeNull();
    expect(sim.row.statuses.some(s => s.worn && s.key === cp.worn!.key)).toBe(true);
    expect(ks.some(k => k.keystone.name === 'Stonewall' && k.awakened !== null)).toBe(true);
    expect(ks.length).toBeGreaterThanOrEqual(4);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    for (const a of cp.actives) {
      expect(sim.row.abilities.some(x => x.id === wornAbilityId(a.id)), `Dreadnought missing active ${a.name}`).toBe(true);
    }
  }, workBudget(0));

  simTest('seeded playStep tally confirms Wrath gained in every fight, >= 50% All-Out casts at >= 8 Wrath, and >= 50% Broadside hits spend Wrath', () => {
    const baseHero = buildMythicSoloRow(DREADNOUGHT_SOLO_SPEC, SOLO_MYTHIC_RULES);
    const player = answering(baseHero);
    const limits = { capRounds: CAP_ROUNDS, endAtRounds: null };
    const wrathOf = (rows: readonly Body[], id: Body['id']): number =>
      rows.find(r => r.id === id)?.statuses.find(s => s.key === KEY_DREAD_WRATH)?.stacks ?? 0;

    for (const mythicId of MYTHIC_IDS) {
      const boss = scripted(mythicId, SOLO_MYTHIC_RULES);
      const policies = new Map<string, typeof player.policy>([
        [player.row.id as string, player.policy],
        [boss.row.id as string, boss.policy],
      ]);
      const policyOf = (me: Body) => (f: Running, row: Body, R: typeof SOLO_MYTHIC_RULES) =>
        policies.get(row.id)!(f, row, { channel: 'none' }, R);

      let fightsWithWrath = 0;
      let allOutCasts = 0;
      let allOutAt8Plus = 0;
      let broadsideHits = 0;
      let broadsideSpentWrath = 0;

      for (let s = 1; s <= TALLY_SEEDS; s++) {
        const made = reduce(
          null,
          { type: 'add', fightId: fightId(`dread-h1-${mythicId}-${s}`), rows: [player.row, boss.row], openings: [] },
          { rules: SOLO_MYTHIC_RULES },
        ).fight;
        if (made?.phase !== 'setup') throw new Error(`seed ${s}: setup failed`);
        let play = playBegin(made, s, SOLO_MYTHIC_RULES).play;
        let sawWrath = false;
        beginFight();
        while (!playOver(play)) {
          const step = playStep(play as typeof play & { readonly fight: Running }, policyOf, limits, SOLO_MYTHIC_RULES);
          play = step.play;
          recordFightStep();
          const beforeW = wrathOf(step.before.rows, player.row.id);
          const afterW = wrathOf(step.play.fight.rows, player.row.id);
          if (afterW > beforeW) sawWrath = true;

          for (const e of step.effects) {
            if (e.type !== 'used' || e.by !== player.row.id) continue;
            if (e.ability === DREADNOUGHT_ALL_OUT_ID) {
              allOutCasts++;
              if (beforeW >= 8) allOutAt8Plus++;
            } else if (e.ability === DREADNOUGHT_BROADSIDE_ID && e.line.includes(' hit')) {
              broadsideHits++;
              if (beforeW > 0 && afterW < beforeW) broadsideSpentWrath++;
            }
          }
        }
        if (sawWrath) fightsWithWrath++;
      }

      console.log(
        `[solo-mythic:h1] Dreadnought vs ${mythicId} (${TALLY_SEEDS} fights): wrath in ${fightsWithWrath}/${TALLY_SEEDS} fights, All-Out >=8 Wrath ${allOutAt8Plus}/${allOutCasts}, Broadside spent Wrath ${broadsideSpentWrath}/${broadsideHits}`,
      );
      expect(fightsWithWrath, `${mythicId}: expected Wrath gained in every fight`).toBe(TALLY_SEEDS);
      expect(allOutCasts, `${mythicId}: expected All-Out casts > 0`).toBeGreaterThan(0);
      expect(allOutAt8Plus, `${mythicId}: All-Out >=8 Wrath (${allOutAt8Plus}/${allOutCasts}) below 50%`).toBeGreaterThanOrEqual(Math.ceil(allOutCasts * 0.5));
      expect(broadsideHits, `${mythicId}: expected Broadside hits > 0`).toBeGreaterThan(0);
      expect(broadsideSpentWrath, `${mythicId}: Broadside Wrath spend (${broadsideSpentWrath}/${broadsideHits}) below 50%`).toBeGreaterThanOrEqual(Math.ceil(broadsideHits * 0.5));
    }
  }, workBudget(100));
});

describe('Dreadnought solo vs Mythic bosses (200 runs each, fail both ways: capped === 0, 75% <= win <= 98%)', () => {
  const hero = buildMythicSoloRow(DREADNOUGHT_SOLO_SPEC, SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Dreadnought solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      console.log(`[solo-mythic] Dreadnought vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped)`);
      expect(res.capped, `Dreadnought vs ${mythicId} had ${res.capped} capped fights`).toBe(0);
      expect(res.winRate, `Dreadnought vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
      expect(res.winRate, `Dreadnought vs ${mythicId} win rate ${pct}% above 98% ceiling`).toBeLessThanOrEqual(HARD_CEILING);
    }, SOLO_BUDGET);
  }
});
