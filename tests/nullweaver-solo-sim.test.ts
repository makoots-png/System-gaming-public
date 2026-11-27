// nullweaver-solo-sim.test.ts: Nullweaver (Mythic, ins+pow) solo simulation checks against all 4 scripted Mythic bosses,
// fixture legality, and Hook 3 (Erase Field removing boss zones) fight-observed tallies via soloRow.
import { describe, expect } from 'bun:test';
import type { ClassNodeId } from '../src/core/ids.ts';
import { fightId } from '../src/core/ids.ts';
import type { Rules } from '../src/core/rules.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, TREE_SHAPE, canBuyNode, classTreeOf, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { classPowers } from '../src/core/registry/class-powers.ts';
import { heldKeystones } from '../src/core/hunter/sheet.ts';
import { gradeOfSpend, itemSpend, titleSpend } from '../src/core/registry/item-budget.ts';
import { WEAR_LIMIT } from '../src/core/registry/items.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { LogLine, Running } from '../src/core/combat/fight-types.ts';
import { CAP_ROUNDS, playBegin, playOver, playStep } from '../src/core/combat/play.ts';
import type { Play } from '../src/core/combat/play.ts';
import type { Policy as TurnPolicy } from '../src/core/combat/policy.ts';
import { answering, runSoloMythic, scripted } from './models/fight-sim.ts';
import type { SimRow } from './models/fight-sim.ts';
import { SOLO_RUNS, soloRow } from './models/mythic-row.ts';
import type { TallyCheck } from './models/mythic-row.ts';
import { beginFight, recordFightStep, simTest, workBudget } from './models/sim-budget.ts';
import { SOLO_MYTHIC_RULES, buildMythicSoloHunter, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';
import { NULLWEAVER_ERASE_ID, NULLWEAVER_SOLO_SPEC } from './fixtures/nullweaver-solo.ts';

const SOLO_BUDGET = workBudget(300);
const TALLY_SEEDS = 50;
const ANGEL_NON_STEPPING_FLOOR = 2;

/** Exact recorded solo win baselines for Nullweaver. */
const NULLWEAVER_BASELINES: Readonly<Record<MythicScriptId, number>> = {
  plain: 180,
  'angel-of-the-last-trumpet': 177,
  'zaratan-the-island-that-wakes': 175,
  'the-fourth-rider': 189,
};

/** Per-boss Erase Field zone-erasure floors on full-answering gating runs (0 declared on plain and gated Angel). */
const NULLWEAVER_ZONE_FLOORS: Readonly<Record<MythicScriptId, number>> = {
  plain: 0,
  'angel-of-the-last-trumpet': 0,
  'zaratan-the-island-that-wakes': 25,
  'the-fourth-rider': 5,
};

/**
 * Plays `seeds` fights on the real reducer loop (`playBegin`/`playStep`/`playOver`) and counts boss zones
 * actually erased by `fight.ts` (`"... erased."` log lines whose zone ids existed before the step and are absent after).
 */
function tallyFightErasures(player: SimRow, boss: SimRow, R: Rules, seeds: number): { casts: number; erased: number } {
  const ctx = { rules: R };
  const limits = { capRounds: CAP_ROUNDS, endAtRounds: null };
  const plan = { channel: 'none' as const };
  const policies = new Map<string, SimRow['policy']>([
    [player.row.id, player.policy],
    [boss.row.id, boss.policy],
  ]);
  const policyOf = (me: Body): TurnPolicy => (f, m, rules) => policies.get(me.id)!(f, m, plan, rules);

  let casts = 0;
  let erased = 0;
  for (let s = 1; s <= seeds; s++) {
    const made = reduce(null, { type: 'add', fightId: fightId(`tally-${s}`), rows: [player.row, boss.row], openings: [] }, ctx).fight;
    if (made?.phase !== 'setup') throw new Error(`seed ${s}: rows did not make a fight`);
    let p: Play = playBegin(made, s, R).play;
    beginFight();
    while (!playOver(p)) {
      const step = playStep(p as Play & { readonly fight: Running }, policyOf, limits, R);
      p = step.play;
      recordFightStep();
      if (step.choice?.type === 'act' && step.choice.ability.id === NULLWEAVER_ERASE_ID) {
        casts++;
        const prevTop = step.before.log[0];
        const added: LogLine[] = [];
        for (const entry of step.play.fight.log) {
          if (entry === prevTop) break;
          added.push(entry);
        }
        for (const entry of added) {
          if (!entry.text.endsWith(' erased.')) continue;
          for (const zid of entry.zones) {
            expect(step.before.zones.some(z => z.id === zid), `erased zone ${zid} not in before.zones`).toBe(true);
            expect(step.play.fight.zones.some(z => z.id === zid), `erased zone ${zid} still in after.zones`).toBe(false);
            erased++;
          }
        }
      }
    }
  }
  return { casts, erased };
}

describe('Nullweaver solo-sim fixture legality and non-stepping Angel Hook 3 tally', () => {
  simTest('Nullweaver fixture passes tree legality, S-band title, Mythic middle-grade gear, armed reaction, and keystone wiring', () => {
    const spec = NULLWEAVER_SOLO_SPEC;
    const tree = classTreeOf(spec.className);
    expect(tree).not.toBeNull();
    expect(validateTree(tree!)).toEqual([]);
    expect(spec.nodes.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(tree!, spec.nodes)).toEqual([...spec.nodes]);

    const bought: ClassNodeId[] = [];
    for (const id of spec.nodes) {
      const check = canBuyNode(tree!, bought, id);
      expect(check.ok, `Nullweaver node ${id} refused`).toBe(true);
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
    expect(h.job).toBe('Nullweaver');
    expect(h.jobDone).toBe('Nullweaver');
    expect(cp.worn).not.toBeNull();
    expect(sim.row.statuses.some(s => s.worn && s.key === cp.worn!.key)).toBe(true);
    expect(sim.row.armed?.ability).toBe(spec.armedReactionId);
    expect(ks.length).toBeGreaterThanOrEqual(4);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    for (const a of cp.actives) {
      expect(sim.row.abilities.some(x => x.id === wornAbilityId(a.id)), `Nullweaver missing active ${a.name}`).toBe(true);
    }
  }, workBudget(0));

  simTest('seeded fight tally confirms Erase Field erases Fallen stars against Angel for a hunter who does not step out of Stars Fall (Hook 3)', () => {
    const baseHero = buildMythicSoloRow(NULLWEAVER_SOLO_SPEC, SOLO_MYTHIC_RULES);
    // With full answering, stepping cancels Stars Fall so Fallen stars never lands; omit 'step' to represent a hunter who does not step.
    const nonSteppingPlayer = answering(baseHero, ['interrupt', 'stagger', 'burst', 'shield']);
    const boss = scripted('angel-of-the-last-trumpet', SOLO_MYTHIC_RULES);
    const { casts, erased } = tallyFightErasures(nonSteppingPlayer, boss, SOLO_MYTHIC_RULES, TALLY_SEEDS);
    console.log(`[solo-mythic:hook3] Nullweaver (no step) Erase Field vs angel-of-the-last-trumpet (${TALLY_SEEDS} fights): ${erased} Fallen stars erased across ${casts} casts (floor ${ANGEL_NON_STEPPING_FLOOR})`);
    expect(casts, 'Nullweaver never cast Erase Field vs angel-of-the-last-trumpet').toBeGreaterThan(0);
    expect(erased, `Nullweaver (no step) erased ${erased} < ${ANGEL_NON_STEPPING_FLOOR} Fallen stars vs angel`).toBeGreaterThanOrEqual(ANGEL_NON_STEPPING_FLOOR);
  }, workBudget(80));
});

describe('Nullweaver solo vs Mythic bosses (200 runs each + Hook 3 tallies via soloRow)', () => {
  const hero = buildMythicSoloRow(NULLWEAVER_SOLO_SPEC, SOLO_MYTHIC_RULES);
  const player = answering(hero);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Nullweaver solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const minErased = NULLWEAVER_ZONE_FLOORS[mythicId];
      let tallies: readonly TallyCheck[];
      if (minErased > 0) {
        const boss = scripted(mythicId, SOLO_MYTHIC_RULES);
        const { casts, erased } = tallyFightErasures(player, boss, SOLO_MYTHIC_RULES, TALLY_SEEDS);
        console.log(`[solo-mythic:hook3] Nullweaver Erase Field vs ${mythicId} (${TALLY_SEEDS} gating fights): ${erased} boss zones erased across ${casts} casts (floor ${minErased})`);
        tallies = [
          { name: 'Erase Field casts', actual: casts, min: 1 },
          { name: 'boss zones erased', actual: erased, min: minErased },
        ];
      } else {
        tallies = [{ name: 'boss zones erased (no gating hazards)', actual: 0, min: 0 }];
      }
      soloRow({
        className: 'Nullweaver',
        boss: mythicId,
        res,
        baseline: NULLWEAVER_BASELINES[mythicId],
        tallies,
      });
    }, SOLO_BUDGET);
  }
});
