// usurper-solo-sim.test.ts: Usurper (Mythic, agi+pow) solo simulation checks against all 4 scripted Mythic bosses,
// fixture legality, and Hook H3 (Hijack proactive ability copy) fight-observed tallies via soloRow.
import { describe, expect } from 'bun:test';
import type { ClassNodeId } from '../src/core/ids.ts';
import { fightId } from '../src/core/ids.ts';
import type { Rules } from '../src/core/rules.ts';
import { MYTHICS, MYTHIC_IDS } from '../src/core/registry/mythics.ts';
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
import { USURPER_HIJACK_ID, USURPER_SOLO_SPEC } from './fixtures/usurper-solo.ts';

const SOLO_BUDGET = workBudget(300);
const TALLY_SEEDS = 50;

/** Exact recorded solo win baselines for Usurper on the Wave 5 integrated tree. */
const USURPER_BASELINES: Readonly<Record<MythicScriptId, number>> = {
  plain: 191,
  'angel-of-the-last-trumpet': 191,
  'zaratan-the-island-that-wakes': 158,
  'the-fourth-rider': 188,
};

const TALLY_FLOORS: Readonly<Record<MythicScriptId, { readonly minDamagingShare: number; readonly minOmenShare: number }>> = {
  plain: { minDamagingShare: 0.5, minOmenShare: 0 },
  'angel-of-the-last-trumpet': { minDamagingShare: 0.5, minOmenShare: 1 / 3 },
  'zaratan-the-island-that-wakes': { minDamagingShare: 0.5, minOmenShare: 1 / 3 },
  'the-fourth-rider': { minDamagingShare: 0.5, minOmenShare: 1 / 3 },
};

/**
 * Plays `seeds` fights on the real reducer loop (`playBegin`/`playStep`/`playOver`) and tallies Hijack casts from the
 * fight's own `used` effects, damaging copies from the fight's own usurp log lines, and omen copies against the boss's
 * standing omen moves.
 */
function tallyFightUsurps(
  player: SimRow,
  boss: SimRow,
  mythicId: MythicScriptId,
  R: Rules,
  seeds: number,
): { casts: number; damagingCopies: number; omenCopies: number } {
  const ctx = { rules: R };
  const limits = { capRounds: CAP_ROUNDS, endAtRounds: null };
  const plan = { channel: 'none' as const };
  const policies = new Map<string, SimRow['policy']>([
    [player.row.id, player.policy],
    [boss.row.id, boss.policy],
  ]);
  const policyOf = (me: Body): TurnPolicy => (f, m, rules) => policies.get(me.id)!(f, m, plan, rules);
  const omenMoveNames = new Set(Object.values(MYTHICS[mythicId].moves).map(m => m.name));
  const usurpRe = new RegExp(`^R\\d+: ${player.row.name} usurps (.+) \\(.+ (\\d+)\\)\\.$`);

  let casts = 0;
  let damagingCopies = 0;
  let omenCopies = 0;
  for (let s = 1; s <= seeds; s++) {
    const made = reduce(null, { type: 'add', fightId: fightId(`usurp-tally-${mythicId}-${s}`), rows: [player.row, boss.row], openings: [] }, ctx).fight;
    if (made?.phase !== 'setup') throw new Error(`seed ${s}: rows did not make a fight`);
    let p: Play = playBegin(made, s, R).play;
    beginFight();
    while (!playOver(p)) {
      const step = playStep(p as Play & { readonly fight: Running }, policyOf, limits, R);
      p = step.play;
      recordFightStep();
      const usedHijack = step.effects.some(e => e.type === 'used' && e.by === player.row.id && e.ability === USURPER_HIJACK_ID);
      if (!usedHijack) continue;
      casts++;
      const bossBefore = step.before.rows.find(r => r.id === boss.row.id);
      const standingOmen = !!bossBefore?.mythic && bossBefore.mythic.at !== 'calm';
      const prevTop = step.before.log[0];
      const added: LogLine[] = [];
      for (const entry of step.play.fight.log) {
        if (entry === prevTop) break;
        added.push(entry);
      }
      for (const entry of added) {
        const m = usurpRe.exec(entry.text);
        if (!m) continue;
        const moveName = m[1]!;
        const dealt = Number(m[2]!);
        if (dealt > 0) {
          damagingCopies++;
          if (standingOmen && omenMoveNames.has(moveName)) omenCopies++;
        }
      }
    }
  }
  return { casts, damagingCopies, omenCopies };
}

describe('Usurper solo-sim fixture legality', () => {
  simTest('Usurper fixture passes tree legality, S-band title, Mythic middle-grade gear, and keystone wiring', () => {
    const spec = USURPER_SOLO_SPEC;
    const tree = classTreeOf(spec.className);
    expect(tree).not.toBeNull();
    expect(validateTree(tree!)).toEqual([]);
    expect(spec.nodes.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(tree!, spec.nodes)).toEqual([...spec.nodes]);

    const bought: ClassNodeId[] = [];
    for (const id of spec.nodes) {
      const check = canBuyNode(tree!, bought, id);
      expect(check.ok, `Usurper node ${id} refused`).toBe(true);
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
    expect(h.job).toBe('Usurper');
    expect(h.jobDone).toBe('Usurper');
    expect(cp.worn).not.toBeNull();
    expect(sim.row.statuses.some(s => s.worn && s.key === cp.worn!.key)).toBe(true);
    expect(ks.length).toBeGreaterThanOrEqual(4);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    for (const a of cp.actives) {
      expect(sim.row.abilities.some(x => x.id === wornAbilityId(a.id)), `Usurper missing active ${a.name}`).toBe(true);
    }
  }, workBudget(0));
});

describe('Usurper solo vs Mythic bosses (200 runs each + Hook H3 Hijack tallies via soloRow)', () => {
  const hero = buildMythicSoloRow(USURPER_SOLO_SPEC, SOLO_MYTHIC_RULES);
  const player = answering(hero);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Usurper solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const boss = scripted(mythicId, SOLO_MYTHIC_RULES);
      const { minDamagingShare, minOmenShare } = TALLY_FLOORS[mythicId];
      const { casts, damagingCopies, omenCopies } = tallyFightUsurps(player, boss, mythicId, SOLO_MYTHIC_RULES, TALLY_SEEDS);
      const dmgShare = casts > 0 ? damagingCopies / casts : 0;
      const omenShare = damagingCopies > 0 ? omenCopies / damagingCopies : 0;
      console.log(
        `[solo-mythic:hookH3] Usurper Hijack vs ${mythicId} (${TALLY_SEEDS} fights): ${damagingCopies}/${casts} damaging (${(dmgShare * 100).toFixed(1)}%), ${omenCopies}/${damagingCopies} omen copies (${(omenShare * 100).toFixed(1)}%, floor ${(minOmenShare * 100).toFixed(1)}%)`,
      );
      const tallies: readonly TallyCheck[] = [
        { name: 'Hijack casts', actual: casts, min: 1 },
        { name: 'damaging copy share (>=50%)', actual: dmgShare, min: minDamagingShare },
        minOmenShare > 0
          ? { name: 'omen copy share (>=33.3%)', actual: omenShare, min: minOmenShare }
          : { name: 'omen copies (plain: 0 declared)', actual: omenCopies, min: 0, max: 0 },
      ];
      soloRow({
        className: 'Usurper',
        boss: mythicId,
        res,
        baseline: USURPER_BASELINES[mythicId],
        tallies,
      });
    }, SOLO_BUDGET);
  }
});
