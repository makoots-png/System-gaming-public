// starforger-solo-sim.test.ts: Starforger (Mythic, pow+ctl) solo simulation checks against all 4 scripted Mythic bosses,
// fixture legality, and Hook 1 (Supernova consuming 2+ Star zones) tally.
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
import { pricedZones } from '../src/core/combat/zones.ts';
import { answering, runSoloMythic, scripted } from './models/fight-sim.ts';
import { simTest, workBudget } from './models/sim-budget.ts';
import { SOLO_MYTHIC_RULES, buildMythicSoloHunter, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';
import { STARFORGER_SOLO_SPEC, STARFORGER_SUPERNOVA_ID } from './fixtures/starforger-solo.ts';

const SOLO_RUNS = 200;
const HARD_FLOOR = 0.75;
const HARD_CEILING = 0.98;
const SOLO_BUDGET = workBudget(250);
const TALLY_SEEDS = 15;
const STAR_PRICE = { name: 'Star', take: 'all' } as const;

describe('Starforger solo-sim fixture legality and Hook 1 zone-price tally', () => {
  simTest('Starforger fixture passes tree legality, S-band title, Mythic middle-grade gear, and keystone wiring', () => {
    const spec = STARFORGER_SOLO_SPEC;
    const tree = classTreeOf(spec.className);
    expect(tree).not.toBeNull();
    expect(validateTree(tree!)).toEqual([]);
    expect(spec.nodes.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(tree!, spec.nodes)).toEqual([...spec.nodes]);

    const bought: ClassNodeId[] = [];
    for (const id of spec.nodes) {
      const check = canBuyNode(tree!, bought, id);
      expect(check.ok, `Starforger node ${id} refused`).toBe(true);
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
    expect(h.job).toBe('Starforger');
    expect(h.jobDone).toBe('Starforger');
    expect(cp.worn).not.toBeNull();
    expect(sim.row.statuses.some(s => s.worn && s.key === cp.worn!.key)).toBe(true);
    expect(ks.some(k => k.awakened !== null)).toBe(true);
    expect(ks.length).toBeGreaterThanOrEqual(4);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    for (const a of cp.actives) {
      expect(sim.row.abilities.some(x => x.id === wornAbilityId(a.id)), `Starforger missing active ${a.name}`).toBe(true);
    }
  }, workBudget(0));

  simTest('seeded playStep tally counts landed Supernova casts from fight used effects per boss with a floor (Hook 1)', () => {
    const baseHero = buildMythicSoloRow(STARFORGER_SOLO_SPEC, SOLO_MYTHIC_RULES);
    const player = answering(baseHero);
    const limits = { capRounds: CAP_ROUNDS, endAtRounds: null };

    for (const mythicId of MYTHIC_IDS) {
      const boss = scripted(mythicId, SOLO_MYTHIC_RULES);
      const policies = new Map<string, typeof player.policy>([
        [player.row.id as string, player.policy],
        [boss.row.id as string, boss.policy],
      ]);
      const policyOf = (me: Body) => (f: Running, row: Body, R: typeof SOLO_MYTHIC_RULES) =>
        policies.get(row.id)!(f, row, { channel: 'none' }, R);

      let used = 0;
      let landed = 0;
      let twoPlusLanded = 0;

      for (let s = 1; s <= TALLY_SEEDS; s++) {
        const made = reduce(
          null,
          { type: 'add', fightId: fightId(`star-hook1-${mythicId}-${s}`), rows: [player.row, boss.row], openings: [] },
          { rules: SOLO_MYTHIC_RULES },
        ).fight;
        if (made?.phase !== 'setup') throw new Error(`seed ${s}: setup failed`);
        let play = playBegin(made, s, SOLO_MYTHIC_RULES).play;
        while (!playOver(play)) {
          const step = playStep(play as typeof play & { readonly fight: Running }, policyOf, limits, SOLO_MYTHIC_RULES);
          play = step.play;
          for (const e of step.effects) {
            if (e.type !== 'used' || e.by !== player.row.id || e.ability !== STARFORGER_SUPERNOVA_ID) continue;
            used++;
            const starsBefore = pricedZones(
              step.before.zones,
              player.row.id,
              STAR_PRICE,
              step.before.rows[0]!.place,
              step.before.rows,
              step.before.grid,
              step.before.now,
              SOLO_MYTHIC_RULES,
            ).length;
            const starsAfter = step.play.fight.zones.filter(z => z.owner === player.row.id && z.name === 'Star').length;
            const hit = e.line.includes(' hit');
            if (hit) {
              landed++;
              if (starsBefore >= 2 && starsAfter < starsBefore) twoPlusLanded++;
            }
          }
        }
      }

      const landFloor = Math.ceil(used * 0.5);
      console.log(`[solo-mythic:hook1] Starforger vs ${mythicId} (${TALLY_SEEDS} fights): ${landed}/${used} landed, ${twoPlusLanded}/${used} consumed 2+ Stars and landed`);
      expect(used, `${mythicId}: expected at least ${TALLY_SEEDS} Supernova casts`).toBeGreaterThanOrEqual(TALLY_SEEDS);
      expect(landed, `${mythicId}: landed Supernovas (${landed}/${used}) below 50% floor`).toBeGreaterThanOrEqual(landFloor);
      expect(twoPlusLanded, `${mythicId}: landed 2+-Star Supernovas (${twoPlusLanded}/${used}) below 50% floor`).toBeGreaterThanOrEqual(landFloor);
    }
  }, workBudget(100));
});

describe('Starforger solo vs Mythic bosses (200 runs each, fail both ways: capped === 0, 75% <= win <= 98%)', () => {
  const hero = buildMythicSoloRow(STARFORGER_SOLO_SPEC, SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Starforger solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      console.log(`[solo-mythic] Starforger vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped)`);
      expect(res.capped, `Starforger vs ${mythicId} had ${res.capped} capped fights`).toBe(0);
      expect(res.winRate, `Starforger vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
      expect(res.winRate, `Starforger vs ${mythicId} win rate ${pct}% above 98% ceiling`).toBeLessThanOrEqual(HARD_CEILING);
    }, SOLO_BUDGET);
  }
});
