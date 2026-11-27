// dreadnought-solo-sim.test.ts: Dreadnought (Mythic, vit+dis) solo simulation checks against all 4 scripted Mythic
// bosses, fixture legality, and Hook H1 Wrath / All-Out / Broadside fight-observed tallies via soloRow.
import { describe, expect } from 'bun:test';
import { fightId } from '../src/core/ids.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
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
import type { SimRow } from './models/fight-sim.ts';
import { SOLO_RUNS, soloRow } from './models/mythic-row.ts';
import type { TallyCheck } from './models/mythic-row.ts';
import { beginFight, recordFightStep, simTest, workBudget } from './models/sim-budget.ts';
import { SOLO_MYTHIC_RULES, buildMythicSoloHunter, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';
import {
  DREADNOUGHT_ALL_OUT_ID,
  DREADNOUGHT_BROADSIDE_ID,
  DREADNOUGHT_SOLO_SPEC,
  KEY_DREAD_WRATH,
} from './fixtures/dreadnought-solo.ts';

const SOLO_BUDGET = workBudget(250);
const TALLY_SEEDS = 15;

/** Exact recorded solo win baselines for Dreadnought. */
const DREADNOUGHT_BASELINES: Readonly<Record<MythicScriptId, number>> = {
  plain: 184,
  'angel-of-the-last-trumpet': 195,
  'zaratan-the-island-that-wakes': 167,
  'the-fourth-rider': 151,
};

function tallyDreadnoughtH1(baseHero: SimRow, mythicId: MythicScriptId): readonly TallyCheck[] {
  const player = answering(baseHero);
  const boss = scripted(mythicId, SOLO_MYTHIC_RULES);
  const limits = { capRounds: CAP_ROUNDS, endAtRounds: null };
  const wrathOf = (rows: readonly Body[], id: Body['id']): number =>
    rows.find(r => r.id === id)?.statuses.find(s => s.key === KEY_DREAD_WRATH)?.stacks ?? 0;
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
  return [
    { name: 'fights with Wrath gained', actual: fightsWithWrath, min: TALLY_SEEDS },
    { name: 'All-Out casts', actual: allOutCasts, min: 1 },
    { name: 'All-Out >=8 Wrath (>=50%)', actual: allOutAt8Plus, min: Math.ceil(allOutCasts * 0.5) },
    { name: 'Broadside hits', actual: broadsideHits, min: 1 },
    { name: 'Broadside spent Wrath (>=50%)', actual: broadsideSpentWrath, min: Math.ceil(broadsideHits * 0.5) },
  ];
}

describe('Dreadnought solo-sim fixture legality', () => {
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
});

describe('Dreadnought solo vs Mythic bosses (200 runs each + Hook H1 tallies via soloRow)', () => {
  const hero = buildMythicSoloRow(DREADNOUGHT_SOLO_SPEC, SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Dreadnought solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const tallies = tallyDreadnoughtH1(hero, mythicId);
      soloRow({
        className: 'Dreadnought',
        boss: mythicId,
        res,
        baseline: DREADNOUGHT_BASELINES[mythicId],
        tallies,
      });
    }, SOLO_BUDGET);
  }
});
