import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, BONUS_KEYS, RULES } from '../src/core/rules.ts';
import type { BonusKey, Perk } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { fightId, parseClassNodeId, parseSaveId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, ItemId } from '../src/core/ids.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { LandOp, Op, StatusDef } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { cleansed, landEnd } from '../src/core/combat/land.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { damageShare, exposedOf, heldDieId, rangeWith } from '../src/core/combat/standing.ts';
import { radiusAt } from '../src/core/combat/zones.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { cost, interval, tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { ATTACK_ID, SKILL_ABILITIES, wornAbilityId } from '../src/core/registry/abilities.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { LOOT_ITEMS, SHOP_ITEMS, STARTER_GEAR } from '../src/core/registry/items.ts';
import { KEYSTONES, keystoneOf } from '../src/core/registry/keystones.ts';
import { STAT_PAIRS } from '../src/core/hunter/keystones.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import { titleSpend } from '../src/core/registry/item-budget.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, canFlipFork, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import type { ClassTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import type { ClassSignature } from '../src/core/registry/class-powers.ts';
import { BRAMBLEGUARD_SIGNATURE, BRAMBLEGUARD_TREE } from '../src/core/registry/class-brambleguard.ts';
import { PYROMANCER_SIGNATURE, PYROMANCER_TREE } from '../src/core/registry/class-pyromancer.ts';
import { SNIPER_SIGNATURE, SNIPER_TREE } from '../src/core/registry/class-sniper.ts';
import { BERSERKER_SIGNATURE, BERSERKER_TREE } from '../src/core/registry/class-berserker.ts';
import { CLERIC_SIGNATURE, CLERIC_TREE } from '../src/core/registry/class-cleric.ts';
import { NIGHTBLADE_SIGNATURE, NIGHTBLADE_TREE } from '../src/core/registry/class-nightblade.ts';
import { BASTION_SIGNATURE, BASTION_TREE } from '../src/core/registry/class-bastion.ts';
import { RUNEKNIGHT_SIGNATURE, RUNEKNIGHT_TREE } from '../src/core/registry/class-runeknight.ts';
import { DUELIST_SIGNATURE, DUELIST_TREE } from '../src/core/registry/class-duelist.ts';
import { ARTIFICER_SIGNATURE, ARTIFICER_TREE } from '../src/core/registry/class-artificer.ts';
import { ORACLE_SIGNATURE, ORACLE_TREE } from '../src/core/registry/class-oracle.ts';
import { STRIDER_SIGNATURE, STRIDER_TREE } from '../src/core/registry/class-strider.ts';
import { chainStepsOf } from '../src/core/registry/jobs.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';
import { onCooldown, payCost } from '../src/core/combat/charge.ts';
import { inRange } from '../src/core/combat/resolve.ts';
import { playFight } from './models/fight-sim.ts';

const ROOT = import.meta.dir + '/..';
const AT = '2026-11-25T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

type RareSpec = {
  readonly name: 'Brambleguard' | 'Pyromancer' | 'Sniper' | 'Berserker' | 'Cleric' | 'Nightblade' | 'Bastion' | 'Runeknight' | 'Duelist' | 'Artificer' | 'Oracle' | 'Strider';
  readonly sig: ClassSignature;
  readonly tree: ClassTree;
  readonly file: string;
  readonly stats: { readonly [K in (typeof STAT_KEYS)[number]]?: number };
  readonly forks: readonly [readonly [string, string], readonly [string, string]];
  readonly scalerForks: readonly [string, string];
  readonly statusKeys: readonly string[];
  readonly activeIds: readonly string[];
};

const RARE_SPECS: readonly RareSpec[] = [
  {
    name: 'Brambleguard',
    sig: BRAMBLEGUARD_SIGNATURE,
    tree: BRAMBLEGUARD_TREE,
    file: 'src/core/registry/class-brambleguard.ts',
    stats: { vit: 56, dis: 33 },
    forks: [['bramble-a5-l', 'bramble-a5-r'], ['bramble-b5-l', 'bramble-b5-r']],
    scalerForks: ['bramble-a5-r', 'bramble-b5-l'],
    statusKeys: [
      'bramble-thornhide',
      'bramble-thornhide-ii',
      'bramble-snare',
      'bramble-snare-ii',
      'bramble-taunt',
      'bramble-thornbark',
      'bramble-thornbark-ii',
      'bramble-patch-bark',
    ],
    activeIds: ['bramble-vine-lash', 'bramble-shell'],
  },
  {
    name: 'Pyromancer',
    sig: PYROMANCER_SIGNATURE,
    tree: PYROMANCER_TREE,
    file: 'src/core/registry/class-pyromancer.ts',
    stats: { pow: 56, ctl: 33 },
    forks: [['pyro-a5-l', 'pyro-a5-r'], ['pyro-b5-l', 'pyro-b5-r']],
    scalerForks: ['pyro-a5-l', 'pyro-b5-r'],
    statusKeys: [
      'pyro-cinder-wake',
      'pyro-cinder-wake-ii',
      'pyro-cinder',
      'pyro-cinder-ii',
      'pyro-wildfire',
      'pyro-ember-mark',
      'pyro-ember-mark-ii',
    ],
    activeIds: ['pyro-magma-floor', 'pyro-ignition-lance'],
  },
  {
    name: 'Sniper',
    sig: SNIPER_SIGNATURE,
    tree: SNIPER_TREE,
    file: 'src/core/registry/class-sniper.ts',
    stats: { agi: 56, ctl: 33 },
    forks: [['sniper-a5-l', 'sniper-a5-r'], ['sniper-b5-l', 'sniper-b5-r']],
    scalerForks: ['sniper-a5-r', 'sniper-b5-l'],
    statusKeys: [
      'sniper-perch',
      'sniper-perch-ii',
      'sniper-sighted',
      'sniper-pinned',
      'sniper-steady-aim',
      'sniper-steady-aim-ii',
      'sniper-braced-perch',
    ],
    activeIds: ['sniper-longshot', 'sniper-sightline'],
  },
  {
    name: 'Berserker',
    sig: BERSERKER_SIGNATURE,
    tree: BERSERKER_TREE,
    file: 'src/core/registry/class-berserker.ts',
    stats: { str: 56, vit: 33 },
    forks: [['zerk-a5-l', 'zerk-a5-r'], ['zerk-b5-l', 'zerk-b5-r']],
    scalerForks: ['zerk-a5-r', 'zerk-b5-l'],
    statusKeys: [
      'zerk-undying-fury',
      'zerk-crimson-berserk',
      'zerk-bloodrage',
      'zerk-bloodrage-ii',
      'zerk-rending-wound',
      'zerk-unstoppable',
      'zerk-roar-rush',
      'zerk-frenzy-rush',
    ],
    activeIds: ['zerk-reckless-cleave', 'zerk-blood-roar'],
  },
  {
    name: 'Cleric',
    sig: CLERIC_SIGNATURE,
    tree: CLERIC_TREE,
    file: 'src/core/registry/class-cleric.ts',
    stats: { dis: 56, pre: 33 },
    forks: [['cleric-a5-l', 'cleric-a5-r'], ['cleric-b5-l', 'cleric-b5-r']],
    scalerForks: ['cleric-a5-l', 'cleric-b5-r'],
    statusKeys: [
      'cleric-devoted-light',
      'cleric-high-votive',
      'cleric-consecrated',
      'cleric-consecrated-ii',
      'cleric-aegis-prayer',
      'cleric-humbled',
      'cleric-humbled-ii',
      'cleric-searing-censure',
    ],
    activeIds: ['cleric-votive-ward', 'cleric-radiant-censure'],
  },
  {
    name: 'Nightblade',
    sig: NIGHTBLADE_SIGNATURE,
    tree: NIGHTBLADE_TREE,
    file: 'src/core/registry/class-nightblade.ts',
    stats: { agi: 56, ins: 33 },
    forks: [['night-a5-l', 'night-a5-r'], ['night-b5-l', 'night-b5-r']],
    scalerForks: ['night-a5-l', 'night-b5-r'],
    statusKeys: [
      'night-shadow-craft',
      'night-master-of-dusk',
      'night-step',
      'night-shrouded',
      'night-ghost-shroud',
      'night-dusk-bleed',
    ],
    activeIds: ['night-umbral-cloak', 'night-dusk-strike'],
  },
  {
    name: 'Bastion',
    sig: BASTION_SIGNATURE,
    tree: BASTION_TREE,
    file: 'src/core/registry/class-bastion.ts',
    stats: { vit: 56, str: 33 },
    forks: [['bastion-a5-l', 'bastion-a5-r'], ['bastion-b5-l', 'bastion-b5-r']],
    scalerForks: ['bastion-a5-l', 'bastion-b5-l'],
    statusKeys: [
      'bastion-phalanx-oath',
      'bastion-unbroken-phalanx',
      'bastion-phalanx-lock',
      'bastion-phalanx-ward',
    ],
    activeIds: ['bastion-phalanx-guard', 'bastion-vanguard-slam'],
  },
  {
    name: 'Runeknight',
    sig: RUNEKNIGHT_SIGNATURE,
    tree: RUNEKNIGHT_TREE,
    file: 'src/core/registry/class-runeknight.ts',
    stats: { str: 56, pow: 33 },
    forks: [['rune-a5-l', 'rune-a5-r'], ['rune-b5-l', 'rune-b5-r']],
    scalerForks: ['rune-a5-l', 'rune-b5-l'],
    statusKeys: [
      'rune-edge',
      'rune-master',
      'rune-mark',
      'rune-mark-ii',
      'rune-frost',
    ],
    activeIds: ['rune-sigil-bolt', 'rune-runeblade-slash'],
  },
  {
    name: 'Duelist',
    sig: DUELIST_SIGNATURE,
    tree: DUELIST_TREE,
    file: 'src/core/registry/class-duelist.ts',
    stats: { agi: 56, str: 33 },
    forks: [['duel-a5-l', 'duel-a5-r'], ['duel-b5-l', 'duel-b5-r']],
    scalerForks: ['duel-a5-r', 'duel-b5-l'],
    statusKeys: [
      'duel-step',
      'duel-grand-fencer',
      'duel-poised',
      'duel-poised-ii',
      'duel-off-balance',
      'duel-reprisal',
    ],
    activeIds: ['duel-lunge-thrust', 'duel-counterguard'],
  },
  {
    name: 'Artificer',
    sig: ARTIFICER_SIGNATURE,
    tree: ARTIFICER_TREE,
    file: 'src/core/registry/class-artificer.ts',
    stats: { ctl: 56, ins: 33 },
    forks: [['art-a5-l', 'art-a5-r'], ['art-b5-l', 'art-b5-r']],
    scalerForks: ['art-a5-r', 'art-b5-l'],
    statusKeys: [
      'art-craft',
      'art-grand-craft',
      'art-jolted',
      'art-shrapnel-jolt',
    ],
    activeIds: ['art-shock-mine', 'art-arc-turret'],
  },
  {
    name: 'Oracle',
    sig: ORACLE_SIGNATURE,
    tree: ORACLE_TREE,
    file: 'src/core/registry/class-oracle.ts',
    stats: { pre: 56, ins: 33 },
    forks: [['oracle-a5-l', 'oracle-a5-r'], ['oracle-b5-l', 'oracle-b5-r']],
    scalerForks: ['oracle-a5-l', 'oracle-b5-l'],
    statusKeys: [
      'oracle-sight',
      'oracle-seer',
      'oracle-glimpse',
      'oracle-favor',
      'oracle-foreseen',
      'oracle-twin-augury',
      'oracle-clouded',
      'oracle-doom',
      'oracle-doom-ii',
      'oracle-doom-shattered',
    ],
    activeIds: ['oracle-foretell', 'oracle-fated-bolt'],
  },
  {
    name: 'Strider',
    sig: STRIDER_SIGNATURE,
    tree: STRIDER_TREE,
    file: 'src/core/registry/class-strider.ts',
    stats: { agi: 56, vit: 33 },
    forks: [['strider-a5-l', 'strider-a5-r'], ['strider-b5-l', 'strider-b5-r']],
    scalerForks: ['strider-a5-l', 'strider-b5-l'],
    statusKeys: [
      'strider-trailworn',
      'strider-apex',
      'strider-fleet',
      'strider-fleet-ii',
      'strider-windstride',
      'strider-windward',
      'strider-hamstrung',
    ],
    activeIds: ['strider-skirmish-shot', 'strider-bounding-leap'],
  },
];

function fullNodesFor(tree: ClassTree, chosenForks: readonly string[]): readonly ClassNodeId[] {
  return tree.nodes.filter(n => !n.forkGroup || chosenForks.includes(n.id)).map(n => n.id);
}

function makeRareHunter(spec: RareSpec, nodes: readonly ClassNodeId[] = [], rank: 'C' | 'S' = 'C') {
  const base = newHunter(RULES);
  const level = RULES.rankLevels[rank];
  const earned = earnClass(
    { ...base, rank, level, stats: { ...base.stats, ...spec.stats } },
    spec.name,
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      [spec.name]: { ...earned.classes[spec.name]!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Wave 1 Rare trees, gold pricing, and budget compliance', () => {
  for (const spec of RARE_SPECS) {
    test(`${spec.name} tree matches TREE_SHAPE.rare, all 4 fork builds are legal, and max S-rank total is 813,750 gold`, () => {
      expect(CLASS_SIGNATURES[spec.name]).toBe(spec.sig);
      expect(CLASS_TREES[spec.name]).toBe(spec.tree);
      expect(validateTree(spec.tree)).toEqual([]);
      expect(spec.tree.nodes.length).toBe(TREE_SHAPE.rare.total);

      const [fA, fB] = spec.forks;
      const combos: readonly [string, string][] = [
        [fA[0], fB[0]],
        [fA[0], fB[1]],
        [fA[1], fB[0]],
        [fA[1], fB[1]],
      ];

      for (const pick of combos) {
        const nodes = fullNodesFor(spec.tree, pick);
        expect(nodes.length).toBe(TREE_SHAPE.rare.buyable);
        expect(repairNodes(spec.tree, nodes)).toEqual([...nodes]);

        const bought: ClassNodeId[] = [];
        let totalS = 0;
        let totalC = 0;
        for (const id of nodes) {
          const check = canBuyNode(spec.tree, bought, id);
          expect(check.ok, `${spec.name} node ${id} should be buyable`).toBe(true);
          const pS = nodeCost({ rank: 'S' }, spec.name, id, 'player', RULES);
          const pC = nodeCost({ rank: 'C' }, spec.name, id, 'player', RULES);
          if (isRefused(pS) || isRefused(pC)) throw new Error(`nodeCost refused for ${id}`);
          totalS += pS.cost;
          totalC += pC.cost;
          bought.push(id);
        }
        // 10.85x priceBase.S (75,000) = 813,750 gold (settled.md)
        expect(totalS).toBe(813_750);
        // 10.85x priceBase.C (1,250) = 13,562.5 (rounded per node)
        expect(totalC).toBeGreaterThanOrEqual(13_560);
        expect(totalC).toBeLessThanOrEqual(13_570);

        // Verify fork flip works cleanly on both D5 fork pairs
        expect(canFlipFork(spec.tree, nodes, nid(pick[0]), nid(pick[0] === fA[0] ? fA[1] : fA[0])).ok).toBe(true);
        expect(canFlipFork(spec.tree, nodes, nid(pick[1]), nid(pick[1] === fB[0] ? fB[1] : fB[0])).ok).toBe(true);

        // Final PR 2 contract: at most kit.scalers (2) scalers on any legal path, at most 4 actives, and compact formulas
        const h = makeRareHunter(spec, nodes, 'C');
        const cp = classPowers(h, RULES);
        expect(cp.actives.length).toBeLessThanOrEqual(CLASS_ACTIVES_MAX);
        expect(cp.scalers.length).toBeLessThanOrEqual(RULES.fight.kit.scalers);
        const row = hunterRow(h, combatantId('h1'), RULES);
        for (const a of row.abilities) {
          if (a.effect && a.effect.by === 'hand') {
            expect(partsOf(a.effect.formula), `${spec.name} ${a.name} formula parts`).toBeLessThanOrEqual(FORMULA_PARTS);
          }
        }
      }
    });

    test(`${spec.name} unspecialized root stays within the ~12-point Rare budget at rank C and all base and fork actives fit worth.ts SA budgets`, () => {
      const rootSpend = titleSpend(
        { bonus: spec.sig.bonus ?? {}, band: 'C', ...(spec.sig.worn ? { worn: spec.sig.worn.def } : {}) },
        RULES,
      );
      // settled.md: Rare stays inside a budget of about 12 points at the unspecialized root (at rank C, level 20).
      expect(rootSpend.points, `${spec.name} root spend ${rootSpend.points.toFixed(2)}`).toBeGreaterThan(0);
      expect(rootSpend.points, `${spec.name} root spend ${rootSpend.points.toFixed(2)}`).toBeLessThanOrEqual(12.0);

      const allActives = [
        ...(spec.sig.actives ?? []),
        ...spec.tree.nodes.flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))),
      ];
      for (const a of allActives) {
        const w = abilityWorth(a, RULES, { rank: 'C' });
        expect(w.over, `${spec.name} active ${a.name} worth ${w.worth.toFixed(2)} vs budget ${w.budget.toFixed(2)}`).toBe(false);
        expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `${spec.name} parseAbility(${a.name})`).toEqual(a);
      }
    });

    test(`${spec.name} matches final PR 2 wiring: out-of-combat worn sheet parity, scalersOf round-trip, and active priority ahead of bag consumables`, () => {
      const nodes = fullNodesFor(spec.tree, spec.scalerForks);
      const h = makeRareHunter(spec, nodes, 'C');
      const cp = classPowers(h, KEYSTONES_ON);
      expect(cp.scalers.length).toBe(1);

      // Out-of-combat hunterSheet matches combat modified sheet (worn passive ops included in sheet.ts; keystones off, matching hemomancer.test.ts)
      const outSheet = hunterSheet(h, RULES).sheet;
      const plainRow = hunterRow(h, combatantId('h1-sheet'), RULES);
      const combatSheet = modified(plainRow.origin, plainRow.statuses, RULES).sheet;
      expect(outSheet.hpMax).toBe(combatSheet.hpMax);
      expect(outSheet.armor).toBeCloseTo(combatSheet.armor, 4);
      expect(outSheet.resistPen).toBeCloseTo(combatSheet.resistPen, 4);
      expect(outSheet.armorPen).toBeCloseTo(combatSheet.armorPen, 4);
      expect(outSheet.critFaces).toBe(combatSheet.critFaces);

      // Damaging class actives round-trip scalersOf cleanly
      const row = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
      const dmgActives = row.abilities.filter(a => spec.activeIds.some(id => a.id === wornAbilityId(abilityId(id))) && a.effect?.type && a.effect.type !== 'shield' && a.effect.type !== 'heal');
      expect(dmgActives.length).toBeGreaterThan(0);
      for (const ab of dmgActives) {
        const form = formulaOf(ab, KEYSTONES_ON)!;
        expect(partsOf(form)).toBeLessThanOrEqual(FORMULA_PARTS);
        expect(scalersOf(form, KEYSTONES_ON)?.scalers.length).toBe(1);
      }

      // Class actives stay ahead of 12 bag consumables at MAX_ABILITIES (12), and consumables are not wrapped with class scalers
      const bombs = Array.from({ length: 12 }, (_, idx) => ({
        id: parseSaveId<'i'>(`i${200 + idx}`) as ItemId,
        name: `Bomb ${idx}`,
        rar: 'common' as const,
        type: 'consumable' as const,
        slot: null,
        qty: 1,
        dice: '',
        bonus: {},
        desc: '',
        armor: 0,
        resist: 0,
        target: 'other' as const,
        effects: [{ op: 'damage' as const, type: 'arcane' as const, amount: { kind: 'number' as const, value: 10 } }],
      })).map(({ id, qty, ...item }): HeldItem => ({ kind: 'adhoc', id, qty, item }));
      const bagRow = hunterRow({ ...h, items: [...h.items, ...bombs] }, combatantId('h-bag'), KEYSTONES_ON);
      for (const id of spec.activeIds) {
        expect(bagRow.abilities.map(a => a.id)).toContain(wornAbilityId(abilityId(id)));
      }
      const bombAb = bagRow.abilities.find(a => a.name === 'Bomb 0');
      if (bombAb) {
        const bombForm = formulaOf(bombAb, KEYSTONES_ON);
        expect(bombForm && scalersOf(bombForm, KEYSTONES_ON)).toBeNull();
      }
    });
  }

  test('Sniper stays honestly within the ~12-point Rare root budget even at full 3 stationary Sighted stacks', () => {
    // Root bonus { agi: 1, ctl: 1 } + 3 stacks of Sighted (+0.06 critSize, +6% armorPen)
    const stackedSpend = titleSpend(
      { bonus: { agi: 1, ctl: 1, critSize: 6, armorPen: 6 }, band: 'C' },
      RULES,
    );
    expect(stackedSpend.points, `Sniper 3-stack stationary spend ${stackedSpend.points.toFixed(2)}`).toBeLessThanOrEqual(12.0);
  });
});

describe('Status keys, wire round-trip, anti-drift copy, voice, and name collisions', () => {
  test('every status key across all shipped CLASS_SIGNATURES and CLASS_TREES maps to one unique JSON StatusDef (final PR 2 contract)', () => {
    const seen = new Map<string, string>();
    const checkOps = (ops: readonly (Op | LandOp)[]): void => {
      for (const op of ops) if (op.op === 'applyStatus') check(op.key, op.def);
    };
    const check = (key: string, def: StatusDef): void => {
      const json = JSON.stringify(def);
      const prev = seen.get(key);
      if (prev !== undefined) expect(json, `status key "${key}" has two distinct StatusDefs`).toBe(prev);
      else seen.set(key, json);
      for (const tr of def.triggers ?? []) checkOps(tr.ops);
      if ('stack' in def && def.stack?.threshold) checkOps(def.stack.threshold.ops);
      if (def.end) checkOps(def.end.ops);
    };
    for (const sig of Object.values(CLASS_SIGNATURES)) {
      if (!sig) continue;
      if (sig.worn) check(sig.worn.key, sig.worn.def);
      for (const a of sig.actives ?? []) checkOps(a.ops);
    }
    for (const tree of Object.values(CLASS_TREES)) {
      if (!tree) continue;
      for (const node of tree.nodes) {
        for (const g of node.gifts) {
          if (g.kind === 'replace-worn') check(g.worn.key, g.worn.def);
          else if (g.kind === 'replace-active') checkOps(g.active.ops);
          else if (g.kind === 'upgrade-status') check(g.key, g.def);
        }
      }
    }

    // Verify every Rare status key resolves via classStatusDef, shippedStatusDef, and parseStatusDef (toEqual round-trip)
    for (const spec of RARE_SPECS) {
      for (const k of spec.statusKeys) {
        const def = classStatusDef(k);
        expect(def, `classStatusDef(${k})`).not.toBeNull();
        expect(shippedStatusDef(statusKey(k))).toEqual(def);
        expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k), `parseStatusDef(${k})`).toEqual(def);
      }
    }
  });

  test('Rare worn statuses round-trip through fightDoc -> fightWire -> DOCS.fight at 0 wire bytes', () => {
    for (const spec of RARE_SPECS) {
      const nodes = fullNodesFor(spec.tree, [spec.forks[0][0], spec.forks[1][0]]);
      const h = makeRareHunter(spec, nodes, 'C');
      const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
      const foe = monsterRows({ name: 'Dummy', rank: 'C', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
      let f: Fight | null = reduce(null, { type: 'add', fightId: fightId(`f-${spec.name.toLowerCase()}`), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

      const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error('expected active FightDoc');
      const wire = fightWire(doc);
      expect(wire.defs, `${spec.name} wire.defs should be undefined (0 wire bytes)`).toBeUndefined();
      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
      const wornKey = classPowers(h, KEYSTONES_ON).worn!.key;
      const onRow = parsed.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === wornKey);
      expect(onRow?.def).toEqual(classStatusDef(wornKey)!);
    }
  });

  test('zero name collisions against keystones, built-in items, built-in skills, and built-in statuses', () => {
    const reserved = new Set<string>();
    for (const s of STAT_KEYS) {
      reserved.add(keystoneOf({ tier: 'mark', stat: s }, RULES).name.toLowerCase());
      reserved.add(keystoneOf({ tier: 'apex', stat: s }, RULES).name.toLowerCase());
    }
    for (const p of STAT_PAIRS) {
      reserved.add(keystoneOf({ tier: 'confluence', pair: p }, RULES).name.toLowerCase());
    }
    for (const it of [...SHOP_ITEMS, ...LOOT_ITEMS, ...Object.values(STARTER_GEAR)]) {
      reserved.add(it.name.toLowerCase());
    }
    for (const name of Object.keys(SKILL_ABILITIES)) reserved.add(name.toLowerCase());
    for (const st of Object.values(BUILT_IN_STATUSES)) reserved.add(st.label.toLowerCase());
    // Explicit banned names from build-brief.md
    for (const banned of ['spellblade', 'warlord', 'sovereign', 'guardian', 'deadeye']) reserved.add(banned);
    expect(Object.keys(KEYSTONES.confluence).length).toBe(28);

    for (const spec of RARE_SPECS) {
      const used: string[] = [spec.name];
      if (spec.sig.worn) used.push(spec.sig.worn.def.label);
      for (const a of spec.sig.actives ?? []) used.push(a.name);
      for (const n of spec.tree.nodes) {
        used.push(n.name);
        for (const g of n.gifts) {
          if (g.kind === 'replace-worn') used.push(g.worn.def.label);
          if (g.kind === 'replace-active') used.push(g.active.name);
        }
      }
      for (const name of used) {
        expect(reserved.has(name.toLowerCase()), `${spec.name} name "${name}" collides with reserved keystone/item/skill/status`).toBe(false);
      }
    }
  });

  test('every Rare node desc matches its bonus/scaler numbers (anti-drift), follows voice.md, and tree files hold no gold literals', async () => {
    const hundredths = new Set<BonusKey>(BONUS_HUNDREDTHS);
    const british = /\b(colour|centre|defence|armour|harbour|cancelled|grey|judgement)\b/i;
    const goldUse = /\b(gold|priceBase|classSwapPrices|classTreeRarityMult|classTreeDepthMult)\b/;

    const checkVoice = (label: string, text: string) => {
      expect(text, `${label}: no em/en dash`).not.toMatch(/[—–]| -- /);
      expect(text, `${label}: no semicolon`).not.toContain(';');
      expect(text, `${label}: no filler "just"`).not.toMatch(/\bjust\b/i);
      expect(text, `${label}: no exclamation`).not.toContain('!');
      expect(text, `${label}: American spelling`).not.toMatch(british);
    };

    for (const spec of RARE_SPECS) {
      const src = await Bun.file(`${ROOT}/${spec.file}`).text();
      const nonComments = src.split('\n').filter(line => !line.trim().startsWith('//'));
      expect(nonComments.filter(line => goldUse.test(line)), `${spec.file} must have no gold literals`).toEqual([]);

      if (spec.sig.worn) {
        checkVoice(`${spec.name} worn label`, spec.sig.worn.def.label);
        checkVoice(`${spec.name} worn desc`, spec.sig.worn.def.desc);
      }
      for (const n of spec.tree.nodes) {
        checkVoice(`${spec.name} node ${n.id} name`, n.name);
        checkVoice(`${spec.name} node ${n.id} desc`, n.desc);
        for (const g of n.gifts) {
          if (g.kind === 'bonus') {
            for (const k of BONUS_KEYS) {
              const v = (g.bonus as Perk)[k];
              if (!v) continue;
              const shown = k === 'critSize' ? String(Number((v / 100).toFixed(2))) : hundredths.has(k) ? `${v}%` : String(v);
              expect(n.desc, `${spec.name} node ${n.id} desc should mention ${k}=${shown}`).toContain(shown);
            }
          } else if (g.kind === 'scaler') {
            expect(n.desc, `${spec.name} node ${n.id} desc should mention scaler pct`).toContain(`${Math.round(g.scaler.scale * 100)}%`);
          } else if (g.kind === 'replace-worn') {
            checkVoice(`${spec.name} ${n.id} worn desc`, g.worn.def.desc);
          }
        }
      }
    }
  });
});

describe('Rare class combat mechanics', () => {
  function startFight(spec: RareSpec, nodes: readonly ClassNodeId[], hPlace = place(3, 3), mPlace = place(4, 3), rank: 'C' | 'S' = 'C'): Running {
    const h = makeRareHunter(spec, nodes, rank);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank, archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let f = reduce(null, { type: 'add', fightId: fightId(`f-mech-${spec.name.toLowerCase()}`), rows: [{ ...hRow, place: hPlace }, { ...foe, place: mPlace }], openings: [] }, { rules: RULES }).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');
    return f;
  }

  test('Brambleguard: Thornhide reflects armor-scaled arcane damage + snare on struck; Vine Lash taunts & pulls; Bramble Shell and Briar Patch fork both shield self and drop moving aura', () => {
    const spec = RARE_SPECS[0]!;
    // Sheet folding reports Brambleguard stat bonus on sheet and combined vit + hpMax under 'class'
    const baseH = makeRareHunter(spec, [], 'C');
    expect(hunterSheet(baseH, RULES).stats.vit).toBe(57);
    expect(hunterSheet(baseH, RULES).stats.dis).toBe(34);
    const withA2 = makeRareHunter(spec, [nid('bramble-root'), nid('bramble-a2')], 'C');
    const clsHp = explain(withA2, 'hpMax', RULES).parts.find(p => p.from === 'class')?.amount ?? 0;
    expect(clsHp).toBeGreaterThanOrEqual(10);

    // Start target 2 tiles away (5, 3) so Vine Lash (range 2) hits, taunts, and pulls target to (4, 3)
    let f = startFight(spec, [], place(3, 3), place(5, 3), 'C');
    const shellId = wornAbilityId(abilityId('bramble-shell'));
    const lashId = wornAbilityId(abilityId('bramble-vine-lash'));

    // Cast Bramble Shell: gains HP-scaled shield + Thornbark (+20 armor)
    const armorBefore = f.rows.find(r => r.id === combatantId('h1'))!.sheet.armor;
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: shellId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    const hAfterShell = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(hAfterShell.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(hAfterShell.sheet.armor).toBe(armorBefore + 20);

    // Cast Vine Lash at 2 tiles: deals damage, applies Bramble Taunt, and pulls foe 1 tile closer to (4, 3)
    const foeHp0 = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: lashId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    const foeAfterLash = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(foeAfterLash)).toBeLessThan(foeHp0);
    expect(foeAfterLash.place).toEqual(place(4, 3));
    expect(foeAfterLash.statuses.some(s => s.key === statusKey('bramble-taunt'))).toBe(true);

    // Monster strikes Brambleguard (with Brambleguard's next turn due before the 1-round snare expires): Thornhide reflects arcane damage and applies Bramble Snare (-15% speed)
    const foeHpBeforeStrike = rowHp(foeAfterLash);
    const foeSpeedBefore = foeAfterLash.sheet.speed;
    const readyForStrike: Running = {
      ...f,
      rows: f.rows.map(x => (x.id === combatantId('h1') ? { ...x, at: tick(f.now + 200) } : x)),
    };
    r = reduce(readyForStrike, { type: 'act', by: combatantId('m1'), ability: foeAfterLash.abilities[0]!.id, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [8] }, react: { [combatantId('h1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    const foeAfterThorns = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(foeAfterThorns)).toBeLessThan(foeHpBeforeStrike);
    expect(foeAfterThorns.statuses.some(s => s.key === statusKey('bramble-snare'))).toBe(true);
    expect(foeAfterThorns.sheet.speed).toBeLessThan(foeSpeedBefore);

    // D5 Fork B-Right Briar Patch: shields self (16% HP), grants +14 armor, and drops a 2-tile moving aura sparing party
    const patchNodes = fullNodesFor(spec.tree, ['bramble-a5-l', 'bramble-b5-r']);
    let pf = startFight(spec, patchNodes, place(3, 3), place(4, 3), 'C');
    const pArmorBefore = pf.rows.find(x => x.id === combatantId('h1'))!.sheet.armor;
    r = reduce(pf, { type: 'act', by: combatantId('h1'), ability: shellId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    pf = r.fight as Running;
    const ph = pf.rows.find(x => x.id === combatantId('h1'))!;
    expect(ph.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(ph.sheet.armor).toBe(pArmorBefore + 14);
    const aura = pf.zones.find(z => z.name === 'Briar Patch');
    expect(aura).toBeDefined();
    expect(aura?.spares).toBe('party');
    expect(aura?.ground.kind).toBe('around');

    // Capstone Heart of the Bramble raises armor by 3% of max HP via bare-sheet conversion
    const capH = makeRareHunter(spec, fullNodesFor(spec.tree, ['bramble-a5-l', 'bramble-b5-l']), 'C');
    const capRow = hunterRow(capH, combatantId('h2'), RULES);
    const bare = modified(capRow.origin, [], RULES).sheet;
    const withCap = modified(capRow.origin, capRow.statuses, RULES).sheet;
    expect(withCap.armor).toBeCloseTo(bare.armor + 0.03 * bare.hpMax, 2);
  });

  test('Pyromancer: Cinder stacks on every spell hit and flares off mag at 2 stacks; Molten Basin grows; Cinder Pit detonates on end; Kindle Burst triggers instant Cinder flare; Living Furnace blasts 2 tiles', () => {
    const spec = RARE_SPECS[1]!;
    const magmaId = wornAbilityId(abilityId('pyro-magma-floor'));
    const lanceId = wornAbilityId(abilityId('pyro-ignition-lance'));

    // Base Cinder Wake: spell hit 1 applies Cinder stack 1; spell hit 2 reaches 2 stacks, spends them, and flares for 0.12 * mag (no crit needed!)
    let bf = startFight(spec, [], place(2, 2), place(6, 2), 'C');
    // Keep m1's turn after h1's two back-to-back casts so Ember Mark's turn-start DoT roll is not owed between them
    bf = { ...bf, rows: bf.rows.map(x => (x.id === combatantId('m1') ? { ...x, at: tick(5000) } : x)) };
    let r = reduce(bf, { type: 'act', by: combatantId('h1'), ability: lanceId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 10 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    bf = r.fight as Running;
    expect(bf.rows.find(x => x.id === combatantId('m1'))!.statuses.find(s => s.key === statusKey('pyro-cinder'))?.stacks).toBe(1);

    const foeHpBeforeFlare = rowHp(bf.rows.find(x => x.id === combatantId('m1'))!);
    // React roll 5 (non-crit, low enough that the brute stays caught inside Magma Floor's radius-2 blast)
    r = reduce(bf, { type: 'act', by: combatantId('h1'), ability: magmaId, aim: place(6, 2), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 5 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    bf = r.fight as Running;
    const foeAfterFlare = bf.rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(foeAfterFlare)).toBeLessThan(foeHpBeforeFlare);
    // Threshold spent the 2 stacks (proving Cinder Wake's 2-stack threshold fired on a non-crit spell hit!)
    expect(foeAfterFlare.statuses.some(s => s.key === statusKey('pyro-cinder'))).toBe(false);

    // Upgraded Molten Basin + Flash Detonation + Living Furnace (2-tile AoE Cinder II + Wildfire)
    const basinNodes = fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-l']);
    let f = startFight(spec, basinNodes, place(2, 2), place(6, 2), 'C');
    f = { ...f, rows: f.rows.map(x => (x.id === combatantId('m1') ? { ...x, at: tick(5000) } : x)) };
    // Cast Molten Basin -> growing lava zone sparing party + Cinder II stack 1
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: magmaId, aim: place(6, 2), rolls: { dice: { [combatantId('m1')]: [8] }, react: { [combatantId('m1')]: 5 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const zone = f.zones.find(z => z.name === 'Magma Floor: Molten Basin');
    expect(zone).toBeDefined();
    expect(zone?.spares).toBe('party');
    expect(zone?.ground.kind).toBe('around');
    if (zone?.ground.kind === 'around' && zone.ground.grow) {
      expect(radiusAt(zone.ground, zone.ground.grow.from, RULES)).toBe(tiles(2));
      expect(radiusAt(zone.ground, tick(zone.ground.grow.from + RULES.fight.round), RULES)).toBe(tiles(3));
    }
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.find(s => s.key === statusKey('pyro-cinder-ii'))?.stacks).toBe(1);

    // Second spell hit (Flash Detonation, non-crit roll 10) hits stack 2 -> Cinder II threshold detonates + applies Wildfire + Ember Mark II!
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: lanceId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 10 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const foeAfter = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(foeAfter.statuses.some(s => s.key === statusKey('pyro-ember-mark-ii'))).toBe(true);
    expect(foeAfter.statuses.some(s => s.key === statusKey('pyro-wildfire'))).toBe(true);

    // Base Ember Mark cancels detonation on cure; upgraded Ember Mark II (`cleanse: 'land'`) detonates on cure reading Pyromancer's mag!
    const h = f.rows.find(x => x.id === combatantId('h1'))!;
    const baseMark = statusOn(classStatusDef('pyro-ember-mark')!, { key: statusKey('pyro-ember-mark'), source: { id: h.id, tier: h.tier }, until: tick(2000), since: tick(0), settledAt: tick(0) });
    const upMark = statusOn(classStatusDef('pyro-ember-mark-ii')!, { key: statusKey('pyro-ember-mark-ii'), source: { id: h.id, tier: h.tier }, until: tick(2000), since: tick(0), settledAt: tick(0) });
    expect(cleansed({ ...foeAfter, statuses: [baseMark] }, { op: 'cureStatus', key: statusKey('pyro-ember-mark') }, tick(500), RULES).lands).toEqual([]);
    const upCleaned = cleansed({ ...foeAfter, statuses: [upMark] }, { op: 'cureStatus', key: statusKey('pyro-ember-mark-ii') }, tick(500), RULES);
    expect(upCleaned.lands.map(s => s.key)).toEqual([statusKey('pyro-ember-mark-ii')]);
    const rows = new Map([[h.id, h], [foeAfter.id, foeAfter]]);
    const pop = landEnd(rows, foeAfter.id, upMark, tick(500), RULES);
    expect(pop.dealt).toBeGreaterThan(15);

    // D5 Right Forks: Cinder Pit (zone.end mag detonation) + Kindle Burst (instant Cinder 2-stack flare on cast)
    const rightNodes = fullNodesFor(spec.tree, ['pyro-a5-r', 'pyro-b5-r']);
    let rf = startFight(spec, rightNodes, place(2, 2), place(6, 2), 'C');
    rf = { ...rf, rows: rf.rows.map(x => (x.id === combatantId('m1') ? { ...x, at: tick(5000) } : x)) };
    r = reduce(rf, { type: 'act', by: combatantId('h1'), ability: magmaId, aim: place(6, 2), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 5 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    rf = r.fight as Running;
    const pit = rf.zones.find(z => z.name === 'Magma Floor: Cinder Pit');
    expect(pit?.end?.length).toBe(1);
    r = reduce(rf, { type: 'act', by: combatantId('h1'), ability: lanceId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 10 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    expect(r.effects.some(e => e.type === 'burst')).toBe(true);
  });

  test('Pyromancer: Kindle Burst flares base Cinder without the capstone, and Living Furnace turns it into the 2-tile Cinder II blast that ignites Wildfire', () => {
    const spec = RARE_SPECS[1]!;
    const lanceId = wornAbilityId(abilityId('pyro-ignition-lance'));
    const kindleCap = fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-r']);
    const kindleNoCap = kindleCap.filter(id => id !== nid('pyro-cap'));
    const flashCap = fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-l']);
    const lanceOf = (nodes: readonly ClassNodeId[]) =>
      classPowers(makeRareHunter(spec, nodes, 'C'), RULES).actives.find(a => a.id === abilityId('pyro-ignition-lance'))!;
    const cinderKeys = (nodes: readonly ClassNodeId[]) =>
      lanceOf(nodes).ops.flatMap(op => (op.op === 'applyStatus' && op.key.startsWith('pyro-cinder') ? [{ key: op.key, stacks: op.stacks }] : []));

    // Fold: the capstone swaps Kindle Burst's 2 Cinder stacks for 2 Cinder II stacks and leaves the other lances alone
    expect(cinderKeys(kindleNoCap)).toEqual([{ key: statusKey('pyro-cinder'), stacks: 2 }]);
    expect(cinderKeys(kindleCap)).toEqual([{ key: statusKey('pyro-cinder-ii'), stacks: 2 }]);
    expect(lanceOf(kindleCap).name).toBe('Ignition Lance: Kindle Burst');
    expect(lanceOf(flashCap)).toBe(PYROMANCER_TREE.nodes.find(n => n.id === nid('pyro-b5-l'))!.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))[0]!);
    expect(lanceOf(fullNodesFor(spec.tree, []).filter(id => id !== nid('pyro-cap')))).toBe(PYROMANCER_SIGNATURE.actives![1]!);
    // Status lookups still resolve the upgraded key to the one shipped Cinder II def
    const kindleCinder = lanceOf(kindleCap).ops.find(op => op.op === 'applyStatus' && op.key === statusKey('pyro-cinder-ii'));
    expect(kindleCinder?.op === 'applyStatus' ? kindleCinder.def : null).toEqual(classStatusDef('pyro-cinder-ii')!);

    // Combat: m1 is aimed, m2 stands 2 tiles from m1, m3 stands 3 tiles from m1
    const cast = (nodes: readonly ClassNodeId[]) => {
      const h = makeRareHunter(spec, nodes, 'C');
      const hRow = hunterRow(h, combatantId('h1'), RULES);
      const foes = monsterRows({ name: 'Target', rank: 'C', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1'), combatantId('m2'), combatantId('m3')], RULES);
      const at = [place(6, 2), place(8, 2), place(9, 2)];
      let f = reduce(null, { type: 'add', fightId: fightId('f-kindle'), rows: [{ ...hRow, place: place(2, 2) }, ...foes.map((m, i) => ({ ...m, place: at[i]! }))], openings: [] }, { rules: RULES }).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 4 }, { id: combatantId('m1'), d20: 1, tie: 3 }, { id: combatantId('m2'), d20: 1, tie: 2 }, { id: combatantId('m3'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
      if (f.phase !== 'running') throw new Error('expected running fight');
      const hp0 = new Map(f.rows.map(x => [x.id, rowHp(x)]));
      const r = reduce(f, { type: 'act', by: combatantId('h1'), ability: lanceId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 10 } }, force: true }, { rules: RULES });
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      const after = (r.fight as Running).rows;
      const row = (id: string) => after.find(x => x.id === combatantId(id))!;
      const lost = (id: string) => hp0.get(combatantId(id))! - rowHp(row(id));
      const has = (id: string, key: string) => row(id).statuses.some(s => s.key === statusKey(key));
      const stacks = (id: string, key: string) => row(id).statuses.find(s => s.key === statusKey(key))?.stacks ?? 0;
      return { r, lost, has, stacks, mag: f.rows.find(x => x.id === combatantId('h1'))!.sheet.mag };
    };

    // Without the capstone: the 12% Cinder flare hits m1 alone, nobody burns with Wildfire
    const base = cast(kindleNoCap);
    expect(base.r.effects.some(e => e.type === 'burst')).toBe(true);
    // The flare spent both stacks, then Cinder Wake's on-hit trigger put a fresh stack back
    expect(base.stacks('m1', 'pyro-cinder')).toBe(1);
    expect(base.has('m1', 'pyro-wildfire')).toBe(false);
    expect(base.lost('m2')).toBe(0);
    expect(base.has('m2', 'pyro-wildfire')).toBe(false);

    // With Living Furnace: 2 Cinder II stacks detonate at once, blasting m1 and m2 (within 2 tiles) for 45% mag and igniting Wildfire, and m3 (3 tiles) is untouched
    const cap = cast(kindleCap);
    expect(cap.r.effects.some(e => e.type === 'burst')).toBe(true);
    expect(cap.has('m1', 'pyro-wildfire')).toBe(true);
    expect(cap.has('m1', 'pyro-cinder')).toBe(false);
    expect(cap.stacks('m1', 'pyro-cinder-ii')).toBe(1);
    expect(cap.has('m2', 'pyro-wildfire')).toBe(true);
    expect(cap.lost('m2')).toBeGreaterThan(0);
    expect(cap.lost('m2')).toBeLessThanOrEqual(Math.ceil(0.45 * cap.mag));
    expect(cap.lost('m3')).toBe(0);
    expect(cap.has('m3', 'pyro-wildfire')).toBe(false);
    expect(cap.lost('m1')).toBeGreaterThan(base.lost('m1'));
  });

  test('Sniper: Vantage Perch adds +2 range, Sightline grants only 1 Sighted stack, moving clears Sighted to 0, Overwatch Brace reduces damage taken, and Horizon Scope + Eagle Perch stack cleanly', () => {
    const spec = RARE_SPECS[2]!;
    let f = startFight(spec, [], place(2, 2), place(8, 2), 'C');
    const longshotId = wornAbilityId(abilityId('sniper-longshot'));
    const sightlineId = wornAbilityId(abilityId('sniper-sightline'));

    // Vantage Perch extends range 16 -> 18 (+2)
    let h = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(rangeWith(16, h, RULES)).toBe(18);
    expect(h.statuses.some(s => s.key === statusKey('sniper-sighted'))).toBe(false);

    // Sightline grants ONLY 1 stack of Sighted + Steady Aim
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: sightlineId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    h = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(h.statuses.find(s => s.key === statusKey('sniper-sighted'))?.stacks).toBe(1);
    expect(h.statuses.some(s => s.key === statusKey('sniper-steady-aim'))).toBe(true);

    // Firing Longshot uses Steady Aim advantage (needs `second` d20), hits from range, consumes Steady Aim, applies Pinned Shot, and advances Sighted 1 -> 2
    const foeHpBefore = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: longshotId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 4 }, second: { [combatantId('m1')]: 15 } }, force: true }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    h = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(rowHp(f.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(foeHpBefore);
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('sniper-pinned'))).toBe(true);
    expect(h.statuses.some(s => s.key === statusKey('sniper-steady-aim'))).toBe(false);
    expect(h.statuses.find(s => s.key === statusKey('sniper-sighted'))?.stacks).toBe(2);

    // Moving drops Sighted all the way to 0 (and turnEnd does NOT bounce it back to 1!)
    f = { ...f, currentId: combatantId('h1') };
    r = reduce(f, { type: 'move', by: combatantId('h1'), to: place(2, 3) }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    h = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(h.statuses.some(s => s.key === statusKey('sniper-sighted'))).toBe(false);

    // Capstone Horizon Scope + Eagle Perch: range 18 -> 21 (+3), Sightline still grants 1 stack of Sighted (+2% armorPen) + Eagle Eye (+15% armorPen), capped at RULES.fight.penMax
    const eagleNodes = fullNodesFor(spec.tree, ['sniper-a5-l', 'sniper-b5-l']);
    let cf = startFight(spec, eagleNodes, place(2, 2), place(8, 2), 'C');
    let ch = cf.rows.find(x => x.id === combatantId('h1'))!;
    const penBefore = ch.sheet.armorPen;
    expect(rangeWith(18, ch, RULES)).toBe(21);
    r = reduce(cf, { type: 'act', by: combatantId('h1'), ability: sightlineId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    cf = r.fight as Running;
    ch = cf.rows.find(x => x.id === combatantId('h1'))!;
    expect(ch.statuses.find(s => s.key === statusKey('sniper-sighted'))?.stacks).toBe(1);
    expect(ch.sheet.armorPen).toBeCloseTo(Math.min(RULES.fight.penMax, penBefore + 17), 4);

    // D5 Fork B-Right Overwatch Brace: 1 stack Sighted + Steady Aim + Braced Perch (-15% damage taken + defend edge)
    const braceNodes = fullNodesFor(spec.tree, ['sniper-a5-l', 'sniper-b5-r']);
    let bf = startFight(spec, braceNodes, place(2, 2), place(8, 2), 'C');
    const foe = bf.rows.find(x => x.id === combatantId('m1'))!;
    r = reduce(bf, { type: 'act', by: combatantId('h1'), ability: sightlineId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    bf = r.fight as Running;
    const bh = bf.rows.find(x => x.id === combatantId('h1'))!;
    expect(bh.statuses.find(s => s.key === statusKey('sniper-sighted'))?.stacks).toBe(1);
    expect(bh.statuses.some(s => s.key === statusKey('sniper-braced-perch'))).toBe(true);
    expect(damageShare(foe, bh, RULES)).toBeCloseTo(0.85, 4);
  });

  test('Pyromancer: Kindle Burst beats base lance pre-capstone, Flash Detonation leads sustained single-target, and Kindle + Living Furnace leads clustered AoE', () => {
    const spec = RARE_SPECS[1]!;
    const magmaId = wornAbilityId(abilityId('pyro-magma-floor'));
    const lanceId = wornAbilityId(abilityId('pyro-ignition-lance'));
    const dummy = () => ({ type: 'pass' as const });
    const preCapNodes = (forkB: 'none' | 'pyro-b5-l' | 'pyro-b5-r'): readonly ClassNodeId[] => {
      const ids = ['pyro-root', 'pyro-a2', 'pyro-b2', 'pyro-a3x', 'pyro-a3y', 'pyro-b3x', 'pyro-b3y', 'pyro-a4x', 'pyro-a4y', 'pyro-b4x', 'pyro-b4y', 'pyro-a5-l'];
      if (forkB !== 'none') ids.push(forkB);
      return ids.map(nid);
    };

    const measure = (nodes: readonly ClassNodeId[], foeCount: number, useMagma: boolean, startHalfHp: boolean, runs = 40) => {
      const h = makeRareHunter(spec, nodes, 'C');
      const row = hunterRow(h, combatantId('h1'), RULES);
      const hero = {
        row: { ...row, place: place(2, 2) },
        policy: (f: Running, me: Running['rows'][number]) => {
          const foes = f.rows.filter(r => r.side !== me.side && r.life.at !== 'dead');
          const target = foes[0];
          if (!target) return { type: 'pass' as const };
          const tryCast = (id: string, aimPlace: boolean) => {
            const ab = me.abilities.find(a => a.id === id);
            if (!ab || onCooldown(ab, me, f.now) || !payCost(ab, me)) return null;
            if (!inRange(ab, me, target.place)) return null;
            return { type: 'act' as const, ability: ab, aim: aimPlace ? target.place : target.id };
          };
          if (useMagma) {
            const m = tryCast(magmaId, true);
            if (m) return m;
          }
          // Cast Ignition Lance off cooldown (Flash uses its 1-round cooldown; filler is the kit's own weapon/unarmed attack).
          const l = tryCast(lanceId, false);
          if (l) return l;
          return tryCast(ATTACK_ID, false) ?? { type: 'pass' as const };
        },
      };
      let total = 0;
      const spots = useMagma ? [place(6, 2), place(7, 2), place(6, 3)] : [place(3, 2), place(4, 2), place(3, 3)];
      for (let i = 1; i <= runs; i++) {
        const ids = Array.from({ length: foeCount }, (_, k) => combatantId(`m${k + 1}`));
        const foes = monsterRows({ name: 'Target', rank: 'C', archetype: 'brute', kind: 'boss', tweak: { hp: 20 }, abilities: [], statuses: [] }, ids, RULES)
          .map(foe => (startHalfHp ? { ...foe, life: { at: 'up' as const, hp: Math.floor(rowHp(foe) * 0.45) } } : foe));
        const foeHp0 = foes.reduce((s, foe) => s + rowHp(foe), 0);
        const rec = playFight({ rows: [hero, ...foes.map((foe, idx) => ({ row: { ...foe, place: spots[idx]! }, policy: dummy }))], rules: RULES, tallyDamage: false, endAtRounds: 6 }, i);
        total += foeHp0 - ids.reduce((s, id) => s + (rec.end[id]?.hp ?? 0), 0);
      }
      return total / runs;
    };

    // Pre-capstone (Depth 5, no Living Furnace) with kit Strike filler: Kindle beats base lance at all HP levels while Flash leads sustained single-target
    const basePreFull = measure(preCapNodes('none'), 1, false, false);
    const basePreHalf = measure(preCapNodes('none'), 1, false, true);
    const kindlePreFull = measure(preCapNodes('pyro-b5-r'), 1, false, false);
    const kindlePreHalf = measure(preCapNodes('pyro-b5-r'), 1, false, true);
    const flashPreFull = measure(preCapNodes('pyro-b5-l'), 1, false, false);
    expect(kindlePreFull / basePreFull, `PreCap Kindle/Base full = ${(kindlePreFull / basePreFull).toFixed(3)}`).toBeGreaterThan(1.0);
    expect(kindlePreHalf / basePreHalf, `PreCap Kindle/Base <50% = ${(kindlePreHalf / basePreHalf).toFixed(3)}`).toBeGreaterThan(1.0);
    expect(kindlePreFull / flashPreFull, `PreCap Kindle/Flash full = ${(kindlePreFull / flashPreFull).toFixed(3)}`).toBeLessThan(1.0);

    // Post-capstone single target (Lance + kit Strike): Flash stays strictly ahead on sustained damage at both full and <50% HP
    const flashSingleHalf = measure(fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-l']), 1, false, true);
    const kindleSingleHalf = measure(fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-r']), 1, false, true);
    const flashSingleFull = measure(fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-l']), 1, false, false);
    const kindleSingleFull = measure(fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-r']), 1, false, false);
    expect(kindleSingleHalf / flashSingleHalf, `Kindle/Flash 1T<50% = ${(kindleSingleHalf / flashSingleHalf).toFixed(3)}`).toBeLessThan(1.0);
    expect(kindleSingleFull / flashSingleFull, `Kindle/Flash 1T full = ${(kindleSingleFull / flashSingleFull).toFixed(3)}`).toBeLessThan(1.0);

    // Three clustered foes (full rotation with Molten Basin + Living Furnace): Kindle leads AoE burst without runaway dominance
    const flashAoe = measure(fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-l']), 3, true, false);
    const kindleAoe = measure(fullNodesFor(spec.tree, ['pyro-a5-l', 'pyro-b5-r']), 3, true, false);
    expect(kindleAoe / flashAoe, `Kindle/Flash 3T rot = ${(kindleAoe / flashAoe).toFixed(3)}`).toBeGreaterThan(1.0);
    expect(kindleAoe / flashAoe, `Kindle/Flash 3T rot = ${(kindleAoe / flashAoe).toFixed(3)}`).toBeLessThan(1.15);
    // Runs 440 6-round fights across 11 variants (~1.4 s idle, ~3.5 s under parallel load); 30 s avoids default-5 s CI flakes.
  }, 30_000);

  test('Wave 3 Rares carry bespoke level-20 rareSteps job change chains', () => {
    const expected: readonly [RareSpec['name'], string, string][] = [
      ['Berserker', 'Rare Job Change 2/3: The Blood Pit', 'Rare Job Change 3/3: Crimson Ravager'],
      ['Cleric', 'Rare Job Change 2/3: The Shattered Sanctuary', 'Rare Job Change 3/3: Ashen Heretic'],
      ['Nightblade', 'Rare Job Change 2/3: The Moonless Alley', 'Rare Job Change 3/3: Gloom Stalker'],
      ['Bastion', 'Rare Job Change 2/3: The Iron Bridge', 'Rare Job Change 3/3: Rampart Captain'],
    ];
    for (const [name, step2, step3] of expected) {
      const steps = chainStepsOf(name);
      expect(steps[0]).toMatchObject({ goal: 'level', level: 20 });
      expect(steps[1].title).toBe(step2);
      expect(steps[2].title).toBe(step3);
    }
  });

  test('Berserker: Undying Fury stacks Bloodrage on struck without lowering armor, heals on kill; Reckless Cleave & Blood Roar pay HP; Crimson Berserk upgrades Bloodrage to Bloodrage II', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Berserker')!;
    const cleaveId = wornAbilityId(abilityId('zerk-reckless-cleave'));
    const roarId = wornAbilityId(abilityId('zerk-blood-roar'));

    // Base: Blood Roar pays 8% HP, grants 2 stacks Bloodrage (+10% dealt, +8% speed, armor intact) + 12% max HP shield + 25% turn refund
    let f = startFight(spec, [], place(3, 3), place(4, 3), 'C');
    const h0 = f.rows.find(x => x.id === combatantId('h1'))!;
    const hp0 = rowHp(h0);
    const armor0 = h0.sheet.armor;
    const speed0 = h0.sheet.speed;
    const roarNow = f.now;

    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: roarId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const hAfterRoar = f.rows.find(x => x.id === combatantId('h1'))!;
    const baseQuick = interval(hAfterRoar.speed, cost(RULES.fight.cost.quick), RULES.fight);
    expect(rowHp(hAfterRoar)).toBeLessThan(hp0);
    expect(hAfterRoar.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(hAfterRoar.statuses.find(s => s.key === statusKey('zerk-bloodrage'))?.stacks).toBe(2);
    expect(hAfterRoar.statuses.some(s => s.key === statusKey('zerk-roar-rush'))).toBe(false);
    expect(hAfterRoar.sheet.armor).toBe(armor0);
    expect(hAfterRoar.sheet.speed).toBeGreaterThan(speed0);
    expect(hAfterRoar.at - roarNow).toBe(baseQuick - Math.round(baseQuick * 25 / 100));
    expect(hAfterRoar.at - roarNow).toBeLessThan(baseQuick);

    // D5 Fork B-Right Frenzy Rush: Blood Roar refunds 35% of its quick action time and clears carrier status
    const frenzyNodes = fullNodesFor(spec.tree, ['zerk-a5-l', 'zerk-b5-r']).filter(id => id !== nid('zerk-cap'));
    const ff = startFight(spec, frenzyNodes, place(3, 3), place(4, 3), 'C');
    const frenzyNow = ff.now;
    const fr = reduce(ff, { type: 'act', by: combatantId('h1'), ability: roarId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(fr.effects.filter(e => e.type === 'refused')).toEqual([]);
    const hAfterFrenzy = (fr.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    const frenzyQuick = interval(hAfterFrenzy.speed, cost(RULES.fight.cost.quick), RULES.fight);
    expect(hAfterFrenzy.statuses.some(s => s.key === statusKey('zerk-frenzy-rush'))).toBe(false);
    expect(hAfterFrenzy.at - frenzyNow).toBe(frenzyQuick - Math.round(frenzyQuick * 35 / 100));
    expect(hAfterFrenzy.at - frenzyNow).toBeLessThan(frenzyQuick - Math.round(frenzyQuick * 25 / 100));

    // Monster strikes Berserker: Undying Fury adds a 3rd Bloodrage stack
    const m1 = f.rows.find(x => x.id === combatantId('m1'))!;
    r = reduce(f, { type: 'act', by: combatantId('m1'), ability: m1.abilities[0]!.id, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [10] }, react: { [combatantId('h1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.find(x => x.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('zerk-bloodrage'))?.stacks).toBe(3);

    // Reckless Cleave pays 6% HP and kills a 1-HP foe -> Undying Fury heals 7% max HP
    f = {
      ...f,
      rows: f.rows.map(x => (x.id === combatantId('m1') ? { ...x, life: { at: 'up' as const, hp: 1 } } : x)),
    };
    const hpBeforeKill = rowHp(f.rows.find(x => x.id === combatantId('h1'))!);
    const hpCost = Math.round(0.06 * f.rows.find(x => x.id === combatantId('h1'))!.sheet.hpMax);
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: cleaveId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [8] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(rowHp(f.rows.find(x => x.id === combatantId('h1'))!)).toBeGreaterThan(hpBeforeKill - hpCost);

    // Capstone Crimson Berserk + Unstoppable Rage: Blood Roar applies Bloodrage II (cap 5) + Unstoppable safeguard
    const capNodes = fullNodesFor(spec.tree, ['zerk-a5-l', 'zerk-b5-l']);
    let cf = startFight(spec, capNodes, place(3, 3), place(4, 3), 'C');
    r = reduce(cf, { type: 'act', by: combatantId('h1'), ability: roarId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cf = r.fight as Running;
    const ch = cf.rows.find(x => x.id === combatantId('h1'))!;
    expect(ch.statuses.find(s => s.key === statusKey('zerk-bloodrage-ii'))?.stacks).toBe(2);
    expect(ch.statuses.some(s => s.key === statusKey('zerk-bloodrage'))).toBe(false);
    expect(ch.statuses.some(s => s.key === statusKey('zerk-unstoppable'))).toBe(true);
  });

  test('Cleric: Devoted Light restores mana and heals on support use; Votive Ward consecrates; Aegis Prayer shields nearby allies sparing foes; Radiant Censure applies Humbled; High Votive shields party', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Cleric')!;
    const wardId = wornAbilityId(abilityId('cleric-votive-ward'));
    const censureId = wornAbilityId(abilityId('cleric-radiant-censure'));

    // Base Votive Ward on self (partially hurt & full mana): shields, applies Consecrated (+8 armor, +8 resist, safeguard), triggers Devoted Light (+4 mana, +2% HP)
    let f = startFight(spec, [], place(3, 3), place(6, 3), 'C');
    const h0 = f.rows.find(x => x.id === combatantId('h1'))!;
    const startHp = Math.floor(h0.sheet.hpMax * 0.6);
    const startMana = h0.sheet.manaMax;
    const armor0 = h0.sheet.armor;
    const resist0 = h0.sheet.resist;
    f = {
      ...f,
      rows: f.rows.map(x => (x.id === combatantId('h1') ? { ...x, life: { at: 'up' as const, hp: startHp }, mana: startMana } : x)),
    };
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: wardId, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [6] }, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const hAfterWard = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(hAfterWard.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(hAfterWard.statuses.some(s => s.key === statusKey('cleric-consecrated'))).toBe(true);
    expect(hAfterWard.sheet.armor).toBe(armor0 + 8);
    expect(hAfterWard.sheet.resist).toBe(resist0 + 8);
    expect(rowHp(hAfterWard)).toBeGreaterThan(startHp);
    // Paid 7 mana, Devoted Light restored 4 mana -> net -3 (startMana - 3)
    expect(hAfterWard.mana).toBe(startMana - 7 + 4);

    // Radiant Censure deals arcane damage and applies Humbled (-12% dealt, exposed +1)
    const foeHp0 = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: censureId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const foeAfterCensure = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(foeAfterCensure)).toBeLessThan(foeHp0);
    expect(foeAfterCensure.statuses.some(s => s.key === statusKey('cleric-humbled'))).toBe(true);
    expect(damageShare(foeAfterCensure, hAfterWard, RULES)).toBeCloseTo(0.88, 2);

    // D5 Aegis Prayer + Capstone High Votive: shields Cleric and ally within 2 tiles, spares adjacent foe
    const aegisNodes = fullNodesFor(spec.tree, ['cleric-a5-l', 'cleric-b5-l']);
    const clericH = makeRareHunter(spec, aegisNodes, 'C');
    const allyH = makeRareHunter(RARE_SPECS[0]!, [], 'C');
    const clericRow = hunterRow(clericH, combatantId('h1'), RULES);
    const allyRow = hunterRow(allyH, combatantId('h2'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'C', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let af = reduce(null, { type: 'add', fightId: fightId('f-cleric-aegis'), rows: [{ ...clericRow, place: place(3, 3) }, { ...allyRow, place: place(5, 3) }, { ...foe, place: place(4, 3) }], openings: [] }, { rules: RULES }).fight!;
    af = reduce(af, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    r = reduce(af, { type: 'act', by: combatantId('h1'), ability: wardId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    af = r.fight as Running;
    expect(af.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('cleric-consecrated'))).toBe(true);
    expect(af.rows.find(x => x.id === combatantId('h2'))!.statuses.some(s => s.key === statusKey('cleric-consecrated'))).toBe(true);
    expect(af.rows.find(x => x.id === combatantId('h2'))!.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(af.rows.find(x => x.id === combatantId('m1'))!.shield).toBeNull();
    expect(af.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('cleric-consecrated'))).toBe(false);
  });

  test('Nightblade: Umbral Cloak hides with Shrouded (breaking on dealt damage), Dusk Strike applies Dusk Bleed, Smoke Veil slows foes, and Master of Dusk re-shrouds on kill', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Nightblade')!;
    const cloakId = wornAbilityId(abilityId('night-umbral-cloak'));
    const strikeId = wornAbilityId(abilityId('night-dusk-strike'));

    // Base: Shadow Craft adds 4 flat armorPen; Umbral Cloak grants Shrouded (+10% speed, hidden)
    let f = startFight(spec, [], place(3, 3), place(4, 3), 'C');
    const h0 = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(h0.sheet.armorPenFlat).toBe(4);
    const speed0 = h0.sheet.speed;

    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: cloakId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const hShrouded = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(hShrouded.statuses.some(s => s.key === statusKey('night-shrouded'))).toBe(true);
    expect(hShrouded.sheet.speed).toBeGreaterThan(speed0);

    // Dusk Strike lands Dusk Bleed (exposed +1 + physical turn DoT) and breaks Shrouded (`ends.dealt: true`)
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: strikeId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('night-shrouded'))).toBe(false);
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('night-dusk-bleed'))).toBe(true);

    // D5 Smoke Veil + Capstone Master of Dusk: Umbral Cloak drops Smoke Veil zone sparing party; kill grants Shrouded
    const smokeNodes = fullNodesFor(spec.tree, ['night-a5-r', 'night-b5-r']);
    let sf = startFight(spec, smokeNodes, place(3, 3), place(4, 3), 'C');
    r = reduce(sf, { type: 'act', by: combatantId('h1'), ability: cloakId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    sf = r.fight as Running;
    const veil = sf.zones.find(z => z.name === 'Smoke Veil');
    expect(veil).toBeDefined();
    expect(veil?.spares).toBe('party');

    // Kill a 1-HP foe -> Master of Dusk grants 1r Shrouded after breaking the opening Shrouded
    sf = {
      ...sf,
      rows: sf.rows.map(x => (x.id === combatantId('m1') ? { ...x, life: { at: 'up' as const, hp: 1 } } : x)),
    };
    r = reduce(sf, { type: 'act', by: combatantId('h1'), ability: strikeId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    sf = r.fight as Running;
    expect(sf.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('night-shrouded'))).toBe(true);
  });

  test('Bastion: Phalanx Oath shields on struck; Vanguard Slam shoves, staggers, and taunts; Phalanx Guard intercepts ally strikes; Unbroken Phalanx emits armor/mitigation aura', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Bastion')!;
    const guardId = wornAbilityId(abilityId('bastion-phalanx-guard'));
    const slamId = wornAbilityId(abilityId('bastion-vanguard-slam'));

    // Vanguard Slam pushes foe 1 tile away (4,3 -> 5,3), fills stagger bar, and applies Phalanx Lock (taunt)
    let f = startFight(spec, [], place(3, 3), place(4, 3), 'C');
    f = { ...f, rows: f.rows.map(x => (x.id === combatantId('m1') ? { ...x, at: tick(f.now + 200) } : x)) };
    const foeHp0 = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: slamId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const foeAfterSlam = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(foeAfterSlam)).toBeLessThan(foeHp0);
    expect(foeAfterSlam.place).toEqual(place(5, 3));
    expect(foeAfterSlam.statuses.some(s => s.key === statusKey('bastion-phalanx-lock'))).toBe(true);
    expect(foeAfterSlam.stagger?.fill ?? 0).toBeGreaterThan(0);

    // Phalanx Oath shields Bastion (3% max HP) once a round when struck
    let sf = startFight(spec, [], place(3, 3), place(4, 3), 'C');
    const foeForStrike = sf.rows.find(x => x.id === combatantId('m1'))!;
    r = reduce(sf, { type: 'act', by: combatantId('m1'), ability: foeForStrike.abilities[0]!.id, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [6] }, react: { [combatantId('h1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    sf = r.fight as Running;
    expect(sf.rows.find(x => x.id === combatantId('h1'))!.shield?.amount ?? 0).toBeGreaterThan(0);

    // Arm Phalanx Guard reaction (reach 2) and protect an adjacent ally from a foe strike
    const bastionH = makeRareHunter(spec, [], 'C');
    const allyH = makeRareHunter(RARE_SPECS[1]!, [], 'C');
    const bRow = hunterRow(bastionH, combatantId('h1'), RULES);
    const aRow = hunterRow(allyH, combatantId('h2'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'C', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let rf = reduce(null, { type: 'add', fightId: fightId('f-bastion-guard'), rows: [{ ...bRow, place: place(3, 3) }, { ...aRow, place: place(4, 3) }, { ...foe, place: place(5, 3) }], openings: [] }, { rules: RULES }).fight!;
    rf = reduce(rf, { type: 'start', openings: [{ id: combatantId('h2'), d20: 18, tie: 3 }, { id: combatantId('m1'), d20: 20, tie: 2 }, { id: combatantId('h1'), d20: 5, tie: 1 }] }, { rules: RULES }).fight!;
    const allyHp0 = rowHp(rf.rows.find(x => x.id === combatantId('h2'))!);
    const mRow0 = rf.rows.find(x => x.id === combatantId('m1'))!;
    // Compare unguarded vs guarded strike on h2
    const unguarded = reduce(rf as Running, { type: 'act', by: combatantId('m1'), ability: mRow0.abilities[0]!.id, aim: combatantId('h2'), rolls: { dice: { [combatantId('h2')]: [6] }, react: { [combatantId('h2')]: 1 } }, force: true }, { rules: RULES }).fight as Running;
    const unguardedLoss = allyHp0 - rowHp(unguarded.rows.find(x => x.id === combatantId('h2'))!);

    r = reduce(rf, { type: 'arm', by: combatantId('h1'), ability: guardId }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    rf = r.fight as Running;
    const mRow = rf.rows.find(x => x.id === combatantId('m1'))!;
    r = reduce(rf, { type: 'act', by: combatantId('m1'), ability: mRow.abilities[0]!.id, aim: combatantId('h2'), rolls: { dice: { [combatantId('h2')]: [6] }, react: { [combatantId('h2')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    rf = r.fight as Running;
    const guardedLoss = allyHp0 - rowHp(rf.rows.find(x => x.id === combatantId('h2'))!);
    // Phalanx Guard fired (spent) and guarded/shielded the protected ally (h2 goes next, so h1 has not restored yet)
    expect(rf.rows.find(x => x.id === combatantId('h1'))!.armed?.spent).toBe(true);
    expect(rf.log.some(l => l.text.includes('Phalanx Guard'))).toBe(true);
    expect(guardedLoss).toBeLessThan(unguardedLoss);

    // Against a light strike, Phalanx Guard's shield remains visibly intact on the protected ally (h2) with 0 HP lost
    const lightFoe = monsterRows({ name: 'Scout', rank: 'C', archetype: 'brute', kind: 'normal', tweak: { dealt: 0.2 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let lf = reduce(null, { type: 'add', fightId: fightId('f-bastion-guard-shield'), rows: [{ ...bRow, place: place(3, 3) }, { ...aRow, place: place(4, 3) }, { ...lightFoe, place: place(5, 3) }], openings: [] }, { rules: RULES }).fight!;
    lf = reduce(lf, { type: 'start', openings: [{ id: combatantId('h2'), d20: 18, tie: 3 }, { id: combatantId('m1'), d20: 20, tie: 2 }, { id: combatantId('h1'), d20: 5, tie: 1 }] }, { rules: RULES }).fight!;
    const lightAllyHp0 = rowHp(lf.rows.find(x => x.id === combatantId('h2'))!);
    lf = reduce(lf, { type: 'arm', by: combatantId('h1'), ability: guardId }, { rules: RULES }).fight!;
    const lmRow = lf.rows.find(x => x.id === combatantId('m1'))!;
    r = reduce(lf as Running, { type: 'act', by: combatantId('m1'), ability: lmRow.abilities[0]!.id, aim: combatantId('h2'), rolls: { dice: { [combatantId('h2')]: [1] }, react: { [combatantId('h2')]: 10 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const lightAfter = r.fight as Running;
    const protectedAlly = lightAfter.rows.find(x => x.id === combatantId('h2'))!;
    expect(protectedAlly.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(rowHp(protectedAlly)).toBe(lightAllyHp0);

    // D5 Hold the Line + Capstone Unbroken Phalanx: Vanguard Slam builds self shield via shieldDrain, and aura buffs nearby ally
    const capNodes = fullNodesFor(spec.tree, ['bastion-a5-l', 'bastion-b5-r']);
    const capH = makeRareHunter(spec, capNodes, 'C');
    const capRow = hunterRow(capH, combatantId('h1'), RULES);
    let cf = reduce(null, { type: 'add', fightId: fightId('f-bastion-cap'), rows: [{ ...capRow, place: place(3, 3) }, { ...aRow, place: place(5, 3) }, { ...foe, place: place(4, 3) }], openings: [] }, { rules: RULES }).fight!;
    cf = reduce(cf, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    // Unbroken Phalanx aura zone exists and buffs ally within 2 tiles (+12 armor, -10% taken)
    expect(cf.zones.some(z => z.name === 'Unbroken Phalanx')).toBe(true);
    const allyUnderAura = cf.rows.find(x => x.id === combatantId('h2'))!;
    expect(allyUnderAura.sheet.armor).toBe(hunterSheet(allyH, RULES).sheet.armor + 12);
    expect(damageShare(cf.rows.find(x => x.id === combatantId('m1'))!, allyUnderAura, RULES)).toBeCloseTo(0.9, 2);
    // Hold the Line strike builds a self shield on Bastion
    r = reduce(cf, { type: 'act', by: combatantId('h1'), ability: slamId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cf = r.fight as Running;
    expect(cf.rows.find(x => x.id === combatantId('h1'))!.shield?.amount ?? 0).toBeGreaterThan(0);
  });

  test('Wave 4 Rares carry bespoke level-20 rareSteps chains, positive worth on every active, and zero Omen/Parry/Riposte collisions', () => {
    const wave4Names: readonly RareSpec['name'][] = ['Runeknight', 'Duelist', 'Artificer', 'Oracle', 'Strider'];
    const expectedChains: readonly [RareSpec['name'], string, string][] = [
      ['Runeknight', 'Rare Job Change 2/3: The Rune Vault', 'Rare Job Change 3/3: Glyph Warden'],
      ['Duelist', 'Rare Job Change 2/3: The Dueling Ring', 'Rare Job Change 3/3: Blade Arbiter'],
      ['Artificer', 'Rare Job Change 2/3: The Broken Foundry', 'Rare Job Change 3/3: Clockwork Overseer'],
      ['Oracle', 'Rare Job Change 2/3: The Drowned Observatory', 'Rare Job Change 3/3: Blind Seer'],
      ['Strider', 'Rare Job Change 2/3: The Long Road', 'Rare Job Change 3/3: Pathless Hunter'],
    ];
    for (const [name, step2, step3] of expectedChains) {
      const steps = chainStepsOf(name);
      expect(steps[0]).toMatchObject({ goal: 'level', level: 20 });
      expect(steps[1].title).toBe(step2);
      expect(steps[2].title).toBe(step3);
    }

    const bannedWord = /\b(omen|parry|riposte)\b/i;
    for (const name of wave4Names) {
      const spec = RARE_SPECS.find(s => s.name === name)!;
      const allActives = [
        ...(spec.sig.actives ?? []),
        ...spec.tree.nodes.flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))),
      ];
      for (const a of allActives) {
        const w = abilityWorth(a, RULES, { rank: 'C' });
        expect(w.worth, `${name} active ${a.name} worth > 0`).toBeGreaterThan(0);
        expect(w.over, `${name} active ${a.name} over === false`).toBe(false);
        expect(a.name, `${name} active ${a.name} no banned words`).not.toMatch(bannedWord);
      }
      if (spec.sig.worn) {
        expect(spec.sig.worn.def.label).not.toMatch(bannedWord);
        expect(spec.sig.worn.def.desc).not.toMatch(bannedWord);
      }
      for (const n of spec.tree.nodes) {
        expect(n.name, `${name} node ${n.id} name`).not.toMatch(bannedWord);
        expect(n.desc, `${name} node ${n.id} desc`).not.toMatch(bannedWord);
      }
      for (const k of spec.statusKeys) {
        const def = classStatusDef(k)!;
        expect(def.label, `${name} status ${k} label`).not.toMatch(bannedWord);
        expect(def.desc, `${name} status ${k} desc`).not.toMatch(bannedWord);
      }
    }
  });

  test('Runeknight: Runic Edge shields and marks on spells; Runeblade Slash casts at 0 stacks and detonates Runemark; Master Runeblade raises cap to 4 and restores mana', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Runeknight')!;
    const boltId = wornAbilityId(abilityId('rune-sigil-bolt'));
    const slashId = wornAbilityId(abilityId('rune-runeblade-slash'));

    // Base Runeblade Slash carries only the Runemark price (no stray Runemark II line before capstone)
    const baseSlash = classPowers(makeRareHunter(spec, [], 'C'), RULES).actives.find(a => a.id === abilityId('rune-runeblade-slash'))!;
    expect(baseSlash.prices).toEqual([{ kind: 'stacks', from: 'target', key: statusKey('rune-mark'), take: { kind: 'all' } }]);

    // Runeblade Slash casts cleanly at 0 Runemark stacks
    let f0 = startFight(spec, [], place(3, 3), place(4, 3), 'C');
    const foeHpBeforeZero = rowHp(f0.rows.find(x => x.id === combatantId('m1'))!);
    let r = reduce(f0, { type: 'act', by: combatantId('h1'), ability: slashId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const zeroStackDmg = foeHpBeforeZero - rowHp((r.fight as Running).rows.find(x => x.id === combatantId('m1'))!);
    expect(zeroStackDmg).toBeGreaterThan(0);

    // Sigil Bolt shields via Runic Edge and stacks 2 Runemark (1 from bolt + 1 from Runic Edge hitDealt trigger), then Runeblade Slash consumes all stacks for higher damage
    let f = startFight(spec, [], place(3, 3), place(4, 3), 'C');
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: boltId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.find(x => x.id === combatantId('h1'))!.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.find(s => s.key === statusKey('rune-mark'))?.stacks).toBe(2);

    const foeHpBeforeDet = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: slashId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const detDmg = foeHpBeforeDet - rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    expect(detDmg).toBeGreaterThan(zeroStackDmg);
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('rune-mark'))).toBe(false);

    // Capstone Master Runeblade + Frost Sigil: rewrites Runeblade Slash's single price to rune-mark-ii, restores 4 mana, applies Runemark II (cap 4) and Rune Frost, and Runeblade Slash consumes Runemark II
    const capNodes = fullNodesFor(spec.tree, ['rune-a5-r', 'rune-b5-l']);
    const capSlash = classPowers(makeRareHunter(spec, capNodes, 'C'), RULES).actives.find(a => a.id === abilityId('rune-runeblade-slash'))!;
    expect(capSlash.prices).toEqual([{ kind: 'stacks', from: 'target', key: statusKey('rune-mark-ii'), take: { kind: 'all' } }]);
    let cf = startFight(spec, capNodes, place(3, 3), place(4, 3), 'C');
    const mana0 = cf.rows.find(x => x.id === combatantId('h1'))!.mana;
    r = reduce(cf, { type: 'act', by: combatantId('h1'), ability: boltId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cf = r.fight as Running;
    // Net mana after 5 mana cost (with 3% costCut -> 5) and +4 mana refund = mana0 - 1
    expect(cf.rows.find(x => x.id === combatantId('h1'))!.mana).toBe(mana0 - 5 + 4);
    expect(cf.rows.find(x => x.id === combatantId('m1'))!.statuses.find(s => s.key === statusKey('rune-mark-ii'))?.stacks).toBe(2);
    expect(cf.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('rune-frost'))).toBe(true);
    r = reduce(cf, { type: 'act', by: combatantId('h1'), ability: slashId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cf = r.fight as Running;
    expect(cf.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('rune-mark-ii'))).toBe(false);
  });

  test('Duelist: Measured Step grants Poised on move; Lunge Thrust hits at reach 2; Counterguard guards self; Feint Lunge shoves; Reprisal Guard counters when struck', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Duelist')!;
    const lungeId = wornAbilityId(abilityId('duel-lunge-thrust'));
    const guardId = wornAbilityId(abilityId('duel-counterguard'));

    // Move grants Poised (+10% speed, attack advantage), then Lunge Thrust hits at 2 tiles and applies Off-Balance
    let f = startFight(spec, [], place(2, 3), place(5, 3), 'C');
    const speed0 = f.rows.find(x => x.id === combatantId('h1'))!.sheet.speed;
    let r = reduce(f, { type: 'move', by: combatantId('h1'), to: place(3, 3) }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const hPoised = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(hPoised.statuses.some(s => s.key === statusKey('duel-poised'))).toBe(true);
    expect(hPoised.sheet.speed).toBeGreaterThan(speed0);

    // At (3,3) -> (5,3) is distance 2; Poised attack advantage asks for second d20
    const foeHp0 = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: lungeId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 10 }, second: { [combatantId('m1')]: 2 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(rowHp(f.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(foeHp0);
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('duel-off-balance'))).toBe(true);

    // D5 Feint Lunge + Reprisal Guard: Feint Lunge shoves foe 1 tile away; Reprisal Guard counters when struck
    const repNodes = fullNodesFor(spec.tree, ['duel-a5-l', 'duel-b5-l']);
    let rf = startFight(spec, repNodes, place(3, 3), place(4, 3), 'C');
    r = reduce(rf, { type: 'act', by: combatantId('h1'), ability: lungeId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    rf = r.fight as Running;
    expect(rf.rows.find(x => x.id === combatantId('m1'))!.place).toEqual(place(5, 3));

    // Arm Counterguard: Reprisal Guard (reach 0), move foe adjacent, foe strikes Duelist -> guard + shield + Poised Mastery + Reprisal Stance counter hits attacker!
    let gf = startFight(spec, repNodes, place(3, 3), place(4, 3), 'C');
    const gFoe0 = gf.rows.find(x => x.id === combatantId('m1'))!;
    const gFoeHp0 = rowHp(gFoe0);
    const duelistHp0 = rowHp(gf.rows.find(x => x.id === combatantId('h1'))!);
    const unguarded = reduce(gf, { type: 'act', by: combatantId('m1'), ability: gFoe0.abilities[0]!.id, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [8] }, react: { [combatantId('h1')]: 1 } }, force: true }, { rules: RULES }).fight as Running;
    const unguardedLoss = duelistHp0 - rowHp(unguarded.rows.find(x => x.id === combatantId('h1'))!);

    gf = reduce(gf, { type: 'arm', by: combatantId('h1'), ability: guardId }, { rules: RULES }).fight as Running;
    // Counterguard fires before the strike and grants Poised Mastery (defend advantage), so the strike asks for a second d20.
    r = reduce(gf, { type: 'act', by: combatantId('m1'), ability: gFoe0.abilities[0]!.id, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [8] }, react: { [combatantId('h1')]: 1 }, second: { [combatantId('h1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    gf = r.fight as Running;
    expect(duelistHp0 - rowHp(gf.rows.find(x => x.id === combatantId('h1'))!)).toBeLessThan(unguardedLoss);
    expect(gf.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('duel-poised-ii'))).toBe(true);
    expect(gf.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('duel-reprisal'))).toBe(true);
    expect(rowHp(gf.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(gFoeHp0);
  });

  test('Artificer: Clockwork Craft extends range and restores mana on impose; Shock Mine drops zone; Arc Turret summons construct; Cluster Mine composes with Shrapnel Coil', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Artificer')!;
    const mineId = wornAbilityId(abilityId('art-shock-mine'));
    const turretId = wornAbilityId(abilityId('art-arc-turret'));

    let f = startFight(spec, [], place(2, 2), place(6, 2), 'C');
    expect(rangeWith(8, f.rows.find(x => x.id === combatantId('h1'))!, RULES)).toBe(9);
    const mana0 = f.rows.find(x => x.id === combatantId('h1'))!.mana;

    // Shock Mine deals damage, imposes Jolted (-15% speed), triggers Clockwork Craft (+3 mana), and leaves a 3-round zone with end detonation
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: mineId, aim: place(6, 2), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('art-jolted'))).toBe(true);
    expect(f.rows.find(x => x.id === combatantId('h1'))!.mana).toBe(mana0 - 5 + 3);
    const zone = f.zones.find(z => z.name === 'Shock Mine');
    expect(zone?.spares).toBe('party');
    expect(zone?.end?.length).toBe(1);

    // Arc Turret shields self and summons a 4-round caster construct
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: turretId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.find(x => x.id === combatantId('h1'))!.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(f.rows.some(x => x.kind === 'summon' && x.name === 'Arc Turret')).toBe(true);

    // D5 Cluster Mine + Shrapnel Coil + Capstone Grand Artificer: keeps radius 3, adds 25% stagger via Shrapnel Jolt, extends range +2, and shields on impose
    const plainClusterNodes = fullNodesFor(spec.tree, ['art-a5-l', 'art-b5-l']);
    let pf = startFight(spec, plainClusterNodes, place(2, 2), place(8, 2), 'C');
    const staggerMax0 = pf.rows.find(x => x.id === combatantId('m1'))!.stagger!.max;
    r = reduce(pf, { type: 'act', by: combatantId('h1'), ability: mineId, aim: place(6, 2), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 5 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const plainFill = (r.fight as Running).rows.find(x => x.id === combatantId('m1'))!.stagger?.fill ?? 0;

    const comboNodes = fullNodesFor(spec.tree, ['art-a5-l', 'art-b5-r']);
    let cf = startFight(spec, comboNodes, place(2, 2), place(8, 2), 'C');
    expect(rangeWith(8, cf.rows.find(x => x.id === combatantId('h1'))!, RULES)).toBe(10);
    // Aim at (6,2): radius 3 reaches m1 at (8,2) (distance 2 <= 3)
    r = reduce(cf, { type: 'act', by: combatantId('h1'), ability: mineId, aim: place(6, 2), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 5 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cf = r.fight as Running;
    const cm1 = cf.rows.find(x => x.id === combatantId('m1'))!;
    expect(cm1.statuses.some(s => s.key === statusKey('art-shrapnel-jolt'))).toBe(true);
    // Shrapnel Jolt adds 25% of stagger max on top of hit stagger (or breaks the bar if fill crossed max)
    const comboFill = cm1.stagger!.max > staggerMax0 ? staggerMax0 : cm1.stagger!.fill;
    expect(comboFill).toBeGreaterThan(plainFill);
    expect(cf.rows.find(x => x.id === combatantId('h1'))!.shield?.amount ?? 0).toBeGreaterThan(0);
    const clusterZone = cf.zones.find(z => z.name === 'Cluster Mine');
    expect(clusterZone?.ground.kind === 'around' ? clusterZone.ground.radius : 0).toBe(tiles(3));
  });

  test('Oracle: Second Sight grants alert and Glimpse + mana on support; Foretell splits favor from attack advantage; Fated Doom survives foe attacks and pops at expiry; Shattered Doom keeps exposed; Inevitable Doom pops on cure; Twin Augury shields allies', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Oracle')!;
    const foretellId = wornAbilityId(abilityId('oracle-foretell'));
    const boltId = wornAbilityId(abilityId('oracle-fated-bolt'));

    let f = startFight(spec, [], place(3, 3), place(4, 3), 'C');
    const mana0 = f.rows.find(x => x.id === combatantId('h1'))!.mana;
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: foretellId, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [4] }, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const hAfter = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(hAfter.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(hAfter.statuses.some(s => s.key === statusKey('oracle-favor'))).toBe(true);
    expect(hAfter.statuses.some(s => s.key === statusKey('oracle-foreseen'))).toBe(true);
    expect(hAfter.statuses.some(s => s.key === statusKey('oracle-glimpse'))).toBe(true);
    expect(hAfter.mana).toBe(mana0 - 5 + 3);

    // Fated Bolt spends Foreseen Strike (attack advantage) without removing Foretold Favor (d6 defend boost),
    // and puts both Fated Doom and Clouded Fate on the foe.
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: boltId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 1 }, second: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const hAfterBolt = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(hAfterBolt.statuses.some(s => s.key === statusKey('oracle-foreseen'))).toBe(false);
    expect(hAfterBolt.statuses.some(s => s.key === statusKey('oracle-favor'))).toBe(true);
    const foe = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(foe.statuses.some(s => s.key === statusKey('oracle-doom'))).toBe(true);
    expect(foe.statuses.some(s => s.key === statusKey('oracle-clouded'))).toBe(true);

    // Doomed foe attacks Oracle: spends Clouded Fate (attack disadvantage) and Foretold Favor (d6 defend boost),
    // while Fated Doom stays on the foe so its delayed blast still lands in play.
    const favorDie = heldDieId(combatantId('h1'), statusKey('oracle-favor'), 0);
    r = reduce(f, {
      type: 'act',
      by: combatantId('m1'),
      ability: foe.abilities[0]!.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [4] }, react: { [combatantId('h1')]: 8 }, second: { [combatantId('h1')]: 15 }, boost: { [favorDie]: 4 } },
      force: true,
    }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('oracle-favor'))).toBe(false);
    const foeAfterStrike = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(foeAfterStrike.statuses.some(s => s.key === statusKey('oracle-clouded'))).toBe(false);
    expect(foeAfterStrike.statuses.some(s => s.key === statusKey('oracle-doom'))).toBe(true);

    // Advance turns through reduce until Fated Doom expires and pops its delayed damage on the foe.
    const hpBeforePop = rowHp(foeAfterStrike);
    let popped = false;
    for (let step = 0; step < 20; step++) {
      const tr = reduce(f, { type: 'endTurn', by: f.currentId }, { rules: RULES });
      expect(tr.effects.filter(e => e.type === 'refused')).toEqual([]);
      if (!tr.fight || tr.fight.phase !== 'running') break;
      f = tr.fight;
      const mNow = f.rows.find(x => x.id === combatantId('m1'))!;
      if (!mNow.statuses.some(s => s.key === statusKey('oracle-doom'))) {
        popped = true;
        expect(rowHp(mNow)).toBeLessThan(hpBeforePop);
        break;
      }
    }
    expect(popped).toBe(true);

    // Shattered Doom (oracle-b5-r) also survives the doomed foe's attack with exposed +2 intact.
    const shatterNodes = fullNodesFor(spec.tree, ['oracle-a5-l', 'oracle-b5-r']);
    let sf = startFight(spec, shatterNodes, place(3, 3), place(4, 3), 'C');
    const baseExposed = exposedOf(sf.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(sf, { type: 'act', by: combatantId('h1'), ability: boltId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    sf = r.fight as Running;
    const sFoe = sf.rows.find(x => x.id === combatantId('m1'))!;
    expect(sFoe.statuses.some(s => s.key === statusKey('oracle-doom-shattered'))).toBe(true);
    expect(sFoe.statuses.some(s => s.key === statusKey('oracle-clouded'))).toBe(true);
    r = reduce(sf, { type: 'act', by: combatantId('m1'), ability: sFoe.abilities[0]!.id, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [4] }, react: { [combatantId('h1')]: 8 }, second: { [combatantId('h1')]: 15 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    sf = r.fight as Running;
    const sFoeAfter = sf.rows.find(x => x.id === combatantId('m1'))!;
    expect(sFoeAfter.statuses.some(s => s.key === statusKey('oracle-clouded'))).toBe(false);
    expect(sFoeAfter.statuses.some(s => s.key === statusKey('oracle-doom-shattered'))).toBe(true);
    expect(exposedOf(sFoeAfter)).toBe(baseExposed + 2);

    // Fated Doom cancels on cure/dispel, whereas Inevitable Doom detonates on cure/dispel reading Oracle's sup.
    const baseDoom = statusOn(classStatusDef('oracle-doom')!, { key: statusKey('oracle-doom'), source: { id: hAfter.id, tier: hAfter.tier }, until: tick(2000), since: tick(0), settledAt: tick(0) });
    const inevDoom = statusOn(classStatusDef('oracle-doom-ii')!, { key: statusKey('oracle-doom-ii'), source: { id: hAfter.id, tier: hAfter.tier }, until: tick(2000), since: tick(0), settledAt: tick(0) });
    const baseDispel = cleansed({ ...foe, statuses: [baseDoom] }, { op: 'dispel', which: 'first' }, tick(500), RULES);
    expect(baseDispel.gone.map(s => s.key)).toEqual([statusKey('oracle-doom')]);
    expect(baseDispel.lands).toEqual([]);
    expect(cleansed({ ...foe, statuses: [inevDoom] }, { op: 'dispel', which: 'first' }, tick(500), RULES).lands.map(s => s.key)).toEqual([statusKey('oracle-doom-ii')]);
    const pop = landEnd(new Map([[hAfter.id, hAfter], [foe.id, foe]]), foe.id, inevDoom, tick(500), RULES);
    expect(pop.dealt).toBeGreaterThan(10);

    // D5 Twin Augury + Capstone Seer of Fate: shields Oracle and ally within 2 tiles, grants both favor and foreseen, spares adjacent foe
    const twinNodes = fullNodesFor(spec.tree, ['oracle-a5-r', 'oracle-b5-l']);
    const oracleRow = hunterRow(makeRareHunter(spec, twinNodes, 'C'), combatantId('h1'), RULES);
    const allyRow = hunterRow(makeRareHunter(RARE_SPECS[0]!, [], 'C'), combatantId('h2'), RULES);
    const dummy = monsterRows({ name: 'Target', rank: 'C', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let af = reduce(null, { type: 'add', fightId: fightId('f-oracle-twin'), rows: [{ ...oracleRow, place: place(3, 3) }, { ...allyRow, place: place(5, 3) }, { ...dummy, place: place(4, 3) }], openings: [] }, { rules: RULES }).fight!;
    af = reduce(af, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    r = reduce(af, { type: 'act', by: combatantId('h1'), ability: foretellId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    af = r.fight as Running;
    expect(af.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('oracle-favor'))).toBe(true);
    expect(af.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('oracle-foreseen'))).toBe(true);
    expect(af.rows.find(x => x.id === combatantId('h2'))!.statuses.some(s => s.key === statusKey('oracle-favor'))).toBe(true);
    expect(af.rows.find(x => x.id === combatantId('h2'))!.statuses.some(s => s.key === statusKey('oracle-foreseen'))).toBe(true);
    expect(af.rows.find(x => x.id === combatantId('h2'))!.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(af.rows.find(x => x.id === combatantId('m1'))!.shield).toBeNull();
  });

  test('Strider: Trailworn shields and grants Fleet on walk; Skirmish Shot shoves; Bounding Leap blinks and shields without triggering Trailworn and splits Windstride from Windward; Wild Recovery dispels and heals', () => {
    const spec = RARE_SPECS.find(s => s.name === 'Strider')!;
    const shotId = wornAbilityId(abilityId('strider-skirmish-shot'));
    const leapId = wornAbilityId(abilityId('strider-bounding-leap'));

    let f = startFight(spec, [], place(2, 3), place(6, 3), 'C');
    const speed0 = f.rows.find(x => x.id === combatantId('h1'))!.sheet.speed;
    let r = reduce(f, { type: 'move', by: combatantId('h1'), to: place(3, 3) }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const hMoved = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(hMoved.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(hMoved.statuses.some(s => s.key === statusKey('strider-fleet'))).toBe(true);
    expect(hMoved.sheet.speed).toBeGreaterThan(speed0);

    // Skirmish Shot hits from range and shoves target 1 tile away (6,3 -> 7,3)
    const foeHp0 = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: shotId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(rowHp(f.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(foeHp0);
    expect(f.rows.find(x => x.id === combatantId('m1'))!.place).toEqual(place(7, 3));

    // Fresh fight for Bounding Leap: proves exact 12% max HP shield (not Trailworn's), proves blink does not trigger Trailworn,
    // and proves Windward (defend advantage) spends on an incoming hit while Windstride (+15% speed) stays.
    let lf = startFight(spec, [], place(2, 3), place(2, 6), 'C');
    const hLeapStart = lf.rows.find(x => x.id === combatantId('h1'))!;
    expect(hLeapStart.shield).toBeNull();
    r = reduce(lf, { type: 'act', by: combatantId('h1'), ability: leapId, aim: place(2, 5), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    lf = r.fight as Running;
    const hLeapt = lf.rows.find(x => x.id === combatantId('h1'))!;
    expect(hLeapt.place).toEqual(place(2, 5));
    expect(hLeapt.shield?.amount).toBe(Math.round(0.12 * hLeapStart.sheet.hpMax));
    expect(hLeapt.statuses.some(s => s.key === statusKey('strider-fleet'))).toBe(false);
    expect(hLeapt.statuses.some(s => s.key === statusKey('strider-windstride'))).toBe(true);
    expect(hLeapt.statuses.some(s => s.key === statusKey('strider-windward'))).toBe(true);

    const lFoe = lf.rows.find(x => x.id === combatantId('m1'))!;
    r = reduce(lf, { type: 'act', by: combatantId('m1'), ability: lFoe.abilities[0]!.id, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [4] }, react: { [combatantId('h1')]: 10 }, second: { [combatantId('h1')]: 12 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    lf = r.fight as Running;
    const hAfterHit = lf.rows.find(x => x.id === combatantId('h1'))!;
    expect(hAfterHit.statuses.some(s => s.key === statusKey('strider-windward'))).toBe(false);
    expect(hAfterHit.statuses.some(s => s.key === statusKey('strider-windstride'))).toBe(true);
    expect(hAfterHit.sheet.speed).toBeGreaterThan(hLeapStart.sheet.speed);

    // D5 Hamstring Volley + Wild Recovery + Capstone Apex Trailrunner: Hamstring adds stagger + slow, Wild Recovery heals + dispels + shields
    const recNodes = fullNodesFor(spec.tree, ['strider-a5-r', 'strider-b5-r']);
    let rf = startFight(spec, recNodes, place(2, 3), place(6, 3), 'C');
    const hStart = rf.rows.find(x => x.id === combatantId('h1'))!;
    const lowHp = Math.floor(hStart.sheet.hpMax * 0.5);
    const slowDebuff = statusOn(classStatusDef('strider-hamstrung')!, { key: statusKey('strider-hamstrung'), source: { id: combatantId('m1'), tier: 2 }, until: tick(2000), since: tick(0), settledAt: tick(0) });
    rf = {
      ...rf,
      rows: rf.rows.map(x => (x.id === combatantId('h1') ? { ...x, life: { at: 'up' as const, hp: lowHp }, statuses: [...x.statuses, slowDebuff] } : x)),
    };
    r = reduce(rf, { type: 'act', by: combatantId('h1'), ability: leapId, aim: place(2, 6), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    rf = r.fight as Running;
    const hRec = rf.rows.find(x => x.id === combatantId('h1'))!;
    expect(hRec.place).toEqual(place(2, 6));
    expect(rowHp(hRec)).toBeGreaterThan(lowHp);
    expect(hRec.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(hRec.statuses.some(s => s.key === statusKey('strider-hamstrung'))).toBe(false);

    r = reduce(rf, { type: 'act', by: combatantId('h1'), ability: shotId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    rf = r.fight as Running;
    expect(rf.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('strider-hamstrung'))).toBe(true);
    expect(rf.rows.find(x => x.id === combatantId('m1'))!.stagger?.fill ?? 0).toBeGreaterThan(0);
  });
});
