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
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { cleansed, landEnd } from '../src/core/combat/land.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { damageShare, rangeWith } from '../src/core/combat/standing.ts';
import { radiusAt } from '../src/core/combat/zones.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { SKILL_ABILITIES, wornAbilityId } from '../src/core/registry/abilities.ts';
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
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';

const ROOT = import.meta.dir + '/..';
const AT = '2026-11-25T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

type RareSpec = {
  readonly name: 'Brambleguard' | 'Pyromancer' | 'Sniper';
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

    test(`${spec.name} unspecialized root stays within the ~12-point Rare budget at rank C and its base actives fit worth.ts SA budgets`, () => {
      const rootSpend = titleSpend(
        { bonus: spec.sig.bonus ?? {}, band: 'C', ...(spec.sig.worn ? { worn: spec.sig.worn.def } : {}) },
        RULES,
      );
      // settled.md: Rare stays inside a budget of about 12 points at the unspecialized root (at rank C, level 20).
      expect(rootSpend.points, `${spec.name} root spend ${rootSpend.points.toFixed(2)}`).toBeGreaterThan(0);
      expect(rootSpend.points, `${spec.name} root spend ${rootSpend.points.toFixed(2)}`).toBeLessThanOrEqual(12.0);

      for (const a of spec.sig.actives ?? []) {
        const w = abilityWorth(a, RULES, { rank: 'C' });
        expect(w.over, `${spec.name} active ${a.name} worth ${w.worth.toFixed(2)} vs budget ${w.budget.toFixed(2)}`).toBe(false);
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
      }));
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
        }
      }
    }

    // Verify every Rare status key resolves via classStatusDef, shippedStatusDef, and parseStatusDef
    for (const spec of RARE_SPECS) {
      for (const k of spec.statusKeys) {
        const def = classStatusDef(k);
        expect(def, `classStatusDef(${k})`).not.toBeNull();
        expect(shippedStatusDef(statusKey(k))).toEqual(def);
        expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES), `parseStatusDef(${k})`).not.toBeNull();
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
});
