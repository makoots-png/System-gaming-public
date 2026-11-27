// dawnbringer-solo-sim.test.ts: Dawnbringer (Mythic, dis+pre) solo simulation checks against all 4 scripted Mythic
// bosses, fixture legality, and per-boss fight-observed tallies (Ascension 3 rate, Hook H2 overheal smites, and
// Last Light lethal reaction rate in wins) via soloRow.
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
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { tripKey } from '../src/core/combat/triggers.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Running } from '../src/core/combat/fight-types.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { CAP_ROUNDS, playBegin, playOver, playStep } from '../src/core/combat/play.ts';
import { answering, runSoloMythic, scripted } from './models/fight-sim.ts';
import type { SimRow } from './models/fight-sim.ts';
import { SOLO_RUNS, soloRow } from './models/mythic-row.ts';
import type { TallyCheck } from './models/mythic-row.ts';
import { beginFight, recordFightStep, simTest, workBudget } from './models/sim-budget.ts';
import { SOLO_MYTHIC_RULES, buildMythicSoloHunter, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';
import {
  DAWNBRINGER_LAST_LIGHT_ID,
  DAWNBRINGER_SOLO_SPEC,
  KEY_DAWN_ASCENSION,
} from './fixtures/dawnbringer-solo.ts';

const SOLO_BUDGET = workBudget(260);
const TALLY_SEEDS = 30;
const SMITE_TRIP_KEY = tripKey(statusKey('dawn-avatar'), 3);
const SMITE_FIGHT_FLOOR = 0.8;

/** Exact recorded solo win baselines for Dawnbringer on the Wave 5 integrated tree. */
const DAWNBRINGER_BASELINES: Readonly<Record<MythicScriptId, number>> = {
  plain: 184,
  'angel-of-the-last-trumpet': 184,
  'zaratan-the-island-that-wakes': 171,
  'the-fourth-rider': 169,
};

/**
 * Plays `TALLY_SEEDS` fights on the real reducer loop, asserts no row retains the transient `overhealed` field
 * after any step, counts Hook H2 overheal smites strictly from `trips['dawn-avatar#3']`, and returns per-boss
 * `soloRow` tallies for Ascension 3 rate, smite mean and per-fight floor, and Last Light rate in wins.
 */
function tallyDawnbringerH2(player: SimRow, mythicId: MythicScriptId): readonly TallyCheck[] {
  const limits = { capRounds: CAP_ROUNDS, endAtRounds: null };
  const boss = scripted(mythicId, SOLO_MYTHIC_RULES);
  const policies = new Map<string, typeof player.policy>([
    [player.row.id as string, player.policy],
    [boss.row.id as string, boss.policy],
  ]);
  const policyOf = (_me: Body) => (f: Running, row: Body, R: typeof SOLO_MYTHIC_RULES) =>
    policies.get(row.id)!(f, row, { channel: 'none' }, R);

  let asc3Fights = 0;
  let overhealSmites = 0;
  let fightsWithSmite = 0;
  let wins = 0;
  let lastLightWins = 0;

  for (let s = 1; s <= TALLY_SEEDS; s++) {
    const made = reduce(
      null,
      { type: 'add', fightId: fightId(`dawn-tally-${mythicId}-${s}`), rows: [player.row, boss.row], openings: [] },
      { rules: SOLO_MYTHIC_RULES },
    ).fight;
    if (made?.phase !== 'setup') throw new Error(`seed ${s}: setup failed`);
    let play = playBegin(made, s, SOLO_MYTHIC_RULES).play;
    beginFight();
    let maxAsc = 0;
    let lastLightFired = false;
    let fightSmites = 0;

    while (!playOver(play)) {
      const step = playStep(play as typeof play & { readonly fight: Running }, policyOf, limits, SOLO_MYTHIC_RULES);
      play = step.play;
      recordFightStep();

      // Pin: no row retains the transient `overhealed` field after any step completes
      for (const r of step.play.fight.rows) {
        expect(r.overhealed, `${mythicId} seed ${s}: row ${r.id} retained overhealed after step`).toBeUndefined();
      }

      const heroAfter = step.play.fight.rows.find(r => r.id === player.row.id);
      const heroBefore = step.before.rows.find(r => r.id === player.row.id);

      const asc = heroAfter?.statuses.find(st => st.key === KEY_DAWN_ASCENSION)?.stacks ?? 0;
      if (asc > maxAsc) maxAsc = asc;

      // Detect Last Light lethal reaction firing from hero's cooldown / warded state transition
      if (heroBefore && heroAfter && !lastLightFired) {
        const cdBefore = heroBefore.readyAt[DAWNBRINGER_LAST_LIGHT_ID];
        const cdAfter = heroAfter.readyAt[DAWNBRINGER_LAST_LIGHT_ID];
        if (cdAfter !== cdBefore || (!heroBefore.warded?.includes('invulnerable') && heroAfter.warded?.includes('invulnerable'))) {
          lastLightFired = true;
        }
      }

      // Count Hook H2 overheal smites strictly from trips['dawn-avatar#3'] changing
      const tripBefore = heroBefore?.trips?.[SMITE_TRIP_KEY];
      const tripAfter = heroAfter?.trips?.[SMITE_TRIP_KEY];
      if (tripAfter?.at === 'tripped' && (tripBefore?.at !== 'tripped' || tripBefore.round !== tripAfter.round)) {
        fightSmites++;
      }
    }

    overhealSmites += fightSmites;
    if (fightSmites >= 1) fightsWithSmite++;
    if (maxAsc >= 3) asc3Fights++;
    const won = play.fight.rows.some(r => r.id === player.row.id && rowHp(r) > 0)
      && !play.fight.rows.some(r => r.side === 'foe' && rowHp(r) > 0);
    if (won) {
      wins++;
      if (lastLightFired) lastLightWins++;
    }
  }

  const asc3Rate = asc3Fights / TALLY_SEEDS;
  const smiteFightRate = fightsWithSmite / TALLY_SEEDS;
  const smitesPerFight = overhealSmites / TALLY_SEEDS;
  const lastLightRate = wins > 0 ? lastLightWins / wins : 0;
  console.log(
    `[solo-mythic:dawn] Dawnbringer vs ${mythicId} (${TALLY_SEEDS} fights): Ascension 3 ${asc3Fights}/${TALLY_SEEDS} (${(asc3Rate * 100).toFixed(0)}%), overheal smites ${overhealSmites} (${smitesPerFight.toFixed(2)}/fight, ${fightsWithSmite}/${TALLY_SEEDS} fights), Last Light ${lastLightWins}/${wins} wins (${(lastLightRate * 100).toFixed(0)}%)`,
  );
  return [
    { name: 'Ascension 3 rate (>=50%)', actual: asc3Rate, min: 0.5 },
    { name: 'fights with overheal smite (>=80%)', actual: smiteFightRate, min: SMITE_FIGHT_FLOOR },
    { name: 'overheal smites per fight (>=1.0)', actual: smitesPerFight, min: 1.0 },
    { name: 'tally wins', actual: wins, min: 1 },
    { name: 'Last Light wins (<50% of wins)', actual: lastLightWins, min: 0, max: Math.ceil(wins * 0.5) - 1 },
  ];
}

describe('Dawnbringer solo-sim fixture legality', () => {
  simTest('Dawnbringer fixture passes tree legality, S-band title, Mythic middle-grade gear, armed Last Light, and Oathkeeper wiring', () => {
    const spec = DAWNBRINGER_SOLO_SPEC;
    const tree = classTreeOf(spec.className);
    expect(tree).not.toBeNull();
    expect(validateTree(tree!)).toEqual([]);
    expect(spec.nodes.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(tree!, spec.nodes)).toEqual([...spec.nodes]);

    const bought: ClassNodeId[] = [];
    for (const id of spec.nodes) {
      const check = canBuyNode(tree!, bought, id);
      expect(check.ok, `Dawnbringer node ${id} refused`).toBe(true);
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
    expect(h.job).toBe('Dawnbringer');
    expect(h.jobDone).toBe('Dawnbringer');
    expect(cp.worn).not.toBeNull();
    expect(sim.row.statuses.some(s => s.worn && s.key === cp.worn!.key)).toBe(true);
    expect(sim.row.armed?.ability).toBe(DAWNBRINGER_LAST_LIGHT_ID);
    expect(ks.some(k => k.keystone.name === 'Oathkeeper' && k.awakened !== null)).toBe(true);
    expect(ks.length).toBeGreaterThanOrEqual(4);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    for (const a of cp.actives) {
      expect(sim.row.abilities.some(x => x.id === wornAbilityId(a.id)), `Dawnbringer missing active ${a.name}`).toBe(true);
    }
  }, workBudget(0));
});

describe('Dawnbringer solo vs Mythic bosses (200 runs each + Hook H2 / Ascension / Last Light tallies via soloRow)', () => {
  const hero = buildMythicSoloRow(DAWNBRINGER_SOLO_SPEC, SOLO_MYTHIC_RULES);
  const player = answering(hero);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Dawnbringer solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const tallies = tallyDawnbringerH2(player, mythicId);
      soloRow({
        className: 'Dawnbringer',
        boss: mythicId,
        res,
        baseline: DAWNBRINGER_BASELINES[mythicId],
        tallies,
      });
    }, SOLO_BUDGET);
  }
});
