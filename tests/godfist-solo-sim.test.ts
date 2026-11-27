// godfist-solo-sim.test.ts: Godfist (Mythic, str+dis) solo simulation checks against all 4 scripted Mythic bosses,
// fixture legality, and per-boss fight-observed tallies (Heavenly Suplex displacement >= 2 tiles and Worldsplitter Grit spend).
import { describe, expect } from 'bun:test';
import type { ClassNodeId } from '../src/core/ids.ts';
import { fightId } from '../src/core/ids.ts';
import type { Rules } from '../src/core/rules.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, TREE_SHAPE, canBuyNode, classTreeOf, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { classPowers } from '../src/core/registry/class-powers.ts';
import { heldKeystones } from '../src/core/hunter/sheet.ts';
import { gradeOfSpend, itemSpend, titleSpend } from '../src/core/registry/item-budget.ts';
import { WEAR_LIMIT } from '../src/core/registry/items.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Running } from '../src/core/combat/fight-types.ts';
import { CAP_ROUNDS, playBegin, playOver, playStep } from '../src/core/combat/play.ts';
import type { Play } from '../src/core/combat/play.ts';
import type { Policy as TurnPolicy } from '../src/core/combat/policy.ts';
import { dist } from '../src/core/combat/space.ts';
import { answering, runSoloMythic, scripted } from './models/fight-sim.ts';
import type { SimRow } from './models/fight-sim.ts';
import { beginFight, recordFightStep, simTest, workBudget } from './models/sim-budget.ts';
import { SOLO_MYTHIC_RULES, buildMythicSoloHunter, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';
import {
  GODFIST_GRIT_KEY,
  GODFIST_SOLO_SPEC,
  GODFIST_SUPLEX_ID,
  GODFIST_WORLDSPLITTER_ID,
} from './fixtures/godfist-solo.ts';

const SOLO_RUNS = 200;
const HARD_FLOOR = 0.75;
const HARD_CEILING = 0.98;
const SOLO_BUDGET = workBudget(250);
const TALLY_SEEDS = 30;

type GodfistTally = {
  readonly suplexCaught: number;
  readonly suplexMoved2: number;
  readonly worldsplitterHits: number;
  readonly worldsplitterSpentGrit: number;
};

/**
 * Plays `seeds` fights on the real reducer loop (`playBegin`/`playStep`/`playOver`) and tallies:
 * - Caught Heavenly Suplex casts (`used` effect on `GODFIST_SUPLEX_ID` that landed) and how many displaced the target
 *   by >= 2 tiles (measured from `before.rows` vs `after.rows`, never `e.type === 'moved'`).
 * - Caught Worldsplitter hits (`used` effect on `GODFIST_WORLDSPLITTER_ID` that landed) and how many spent Grit
 *   (`stacks > 0` before hit, `0` after).
 */
function tallyGodfistLoop(player: SimRow, boss: SimRow, R: Rules, seeds: number): GodfistTally {
  const ctx = { rules: R };
  const limits = { capRounds: CAP_ROUNDS, endAtRounds: null };
  const plan = { channel: 'none' as const };
  const policies = new Map<string, SimRow['policy']>([
    [player.row.id, player.policy],
    [boss.row.id, boss.policy],
  ]);
  const policyOf = (me: Body): TurnPolicy => (f, m, rules) => policies.get(me.id)!(f, m, plan, rules);

  let suplexCaught = 0;
  let suplexMoved2 = 0;
  let worldsplitterHits = 0;
  let worldsplitterSpentGrit = 0;

  for (let s = 1; s <= seeds; s++) {
    const made = reduce(null, { type: 'add', fightId: fightId(`gf-tally-${s}`), rows: [player.row, boss.row], openings: [] }, ctx).fight;
    if (made?.phase !== 'setup') throw new Error(`seed ${s}: rows did not make a fight`);
    let p: Play = playBegin(made, s, R).play;
    beginFight();
    while (!playOver(p)) {
      const step = playStep(p as Play & { readonly fight: Running }, policyOf, limits, R);
      p = step.play;
      recordFightStep();

      const used = step.effects.find(e => e.type === 'used' && e.by === player.row.id);
      if (!used || used.type !== 'used') continue;
      // Caught single-target strikes do not say "dodged", "missed", "avoided", "resisted", or "no target" in the fight's own used line.
      const notCaught = /\b(?:dodged|missed|avoided|resisted|no target)\b/i.exec(used.line) !== null;
      if (notCaught) continue;

      if (used.ability === GODFIST_SUPLEX_ID) {
        const bBefore = step.before.rows.find(r => r.id === boss.row.id);
        const bAfter = step.play.fight.rows.find(r => r.id === boss.row.id);
        if (bBefore && bAfter) {
          suplexCaught++;
          if (dist(bBefore.place, bAfter.place) >= 2) suplexMoved2++;
        }
      } else if (used.ability === GODFIST_WORLDSPLITTER_ID) {
        const hBefore = step.before.rows.find(r => r.id === player.row.id);
        const hAfter = step.play.fight.rows.find(r => r.id === player.row.id);
        if (hBefore && hAfter) {
          worldsplitterHits++;
          const gritBefore = hBefore.statuses.find(st => st.key === GODFIST_GRIT_KEY)?.stacks ?? 0;
          const gritAfter = hAfter.statuses.find(st => st.key === GODFIST_GRIT_KEY)?.stacks ?? 0;
          if (gritBefore > 0 && gritAfter === 0) worldsplitterSpentGrit++;
        }
      }
    }
  }

  return { suplexCaught, suplexMoved2, worldsplitterHits, worldsplitterSpentGrit };
}

describe('Godfist solo-sim fixture legality and per-boss Suplex / Grit tallies', () => {
  simTest('Godfist fixture passes tree legality, S-band title, Mythic middle-grade gear, armed Qi Guard, and keystone wiring', () => {
    const spec = GODFIST_SOLO_SPEC;
    const tree = classTreeOf(spec.className);
    expect(tree).not.toBeNull();
    expect(validateTree(tree!)).toEqual([]);
    expect(spec.nodes.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(tree!, spec.nodes)).toEqual([...spec.nodes]);

    const bought: ClassNodeId[] = [];
    for (const id of spec.nodes) {
      const check = canBuyNode(tree!, bought, id);
      expect(check.ok, `Godfist node ${id} refused`).toBe(true);
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
    expect(h.job).toBe('Godfist');
    expect(h.jobDone).toBe('Godfist');
    expect(cp.worn).not.toBeNull();
    expect(sim.row.statuses.some(s => s.worn && s.key === cp.worn!.key)).toBe(true);
    expect(sim.row.armed?.ability).toBe(spec.armedReactionId);
    expect(ks.length).toBeGreaterThanOrEqual(4);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    for (const a of cp.actives) {
      expect(sim.row.abilities.some(x => x.id === wornAbilityId(a.id)), `Godfist missing active ${a.name}`).toBe(true);
    }
  }, workBudget(0));

  for (const mythicId of MYTHIC_IDS) {
    simTest(`seeded fight tally vs ${mythicId} confirms >= 50% of caught Heavenly Suplex casts move target >= 2 tiles and >= 50% of Worldsplitter hits spend Grit`, () => {
      const player = answering(buildMythicSoloRow(GODFIST_SOLO_SPEC, SOLO_MYTHIC_RULES));
      const boss = scripted(mythicId, SOLO_MYTHIC_RULES);
      const t = tallyGodfistLoop(player, boss, SOLO_MYTHIC_RULES, TALLY_SEEDS);
      console.log(
        `[solo-mythic:godfist-tally] vs ${mythicId} (${TALLY_SEEDS} fights): Suplex moved>=2 ${t.suplexMoved2}/${t.suplexCaught}, Worldsplitter spent Grit ${t.worldsplitterSpentGrit}/${t.worldsplitterHits}`,
      );
      expect(t.suplexCaught, `Godfist never landed Heavenly Suplex vs ${mythicId}`).toBeGreaterThan(0);
      expect(t.suplexMoved2 * 2, `Suplex displaced >= 2 tiles on < 50% of caught casts vs ${mythicId}`).toBeGreaterThanOrEqual(t.suplexCaught);
      expect(t.worldsplitterHits, `Godfist never landed Worldsplitter vs ${mythicId}`).toBeGreaterThan(0);
      expect(t.worldsplitterSpentGrit * 2, `Worldsplitter spent Grit on < 50% of hits vs ${mythicId}`).toBeGreaterThanOrEqual(t.worldsplitterHits);
    }, workBudget(60));
  }
});

describe('Godfist solo vs Mythic bosses (200 runs each, fail both ways: capped === 0, 75% <= win <= 98%)', () => {
  const hero = buildMythicSoloRow(GODFIST_SOLO_SPEC, SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Godfist solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      console.log(`[solo-mythic] Godfist vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped)`);
      expect(res.capped, `Godfist vs ${mythicId} had ${res.capped} capped fights`).toBe(0);
      expect(res.winRate, `Godfist vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
      expect(res.winRate, `Godfist vs ${mythicId} win rate ${pct}% above 98% ceiling`).toBeLessThanOrEqual(HARD_CEILING);
    }, SOLO_BUDGET);
  }
});
