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
import { damageShare, rangeWith } from '../src/core/combat/standing.ts';
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
  readonly name: 'Brambleguard' | 'Pyromancer' | 'Sniper' | 'Berserker' | 'Cleric' | 'Nightblade' | 'Bastion';
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
});
