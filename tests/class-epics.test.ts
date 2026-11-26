import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, BONUS_KEYS, RULES } from '../src/core/rules.ts';
import type { BonusKey, Rank } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { fightId, parseClassNodeId, parseSaveId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, ItemId } from '../src/core/ids.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { combatantId, abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { LandOp, Op, StatusDef } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { titleSpend } from '../src/core/registry/item-budget.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, canFlipFork, capstoneUnlocked, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import type { ClassTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import type { ClassSignature } from '../src/core/registry/class-powers.ts';
import { SERAPH_SIGNATURE, SERAPH_TREE } from '../src/core/registry/class-seraph.ts';
import { IRONCLAD_SIGNATURE, IRONCLAD_TREE } from '../src/core/registry/class-ironclad.ts';
import { STORMCALLER_SIGNATURE, STORMCALLER_TREE } from '../src/core/registry/class-stormcaller.ts';
import type { ClassName } from '../src/core/registry/jobs.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-25T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

type EpicSpec = {
  readonly className: ClassName;
  readonly sig: ClassSignature;
  readonly tree: ClassTree;
  readonly stats: Partial<Record<'str' | 'agi' | 'vit' | 'ins' | 'dis' | 'pre' | 'pow' | 'ctl', number>>;
  readonly canonicalForks: readonly string[];
  readonly scalerForkNode: string;
  readonly capstoneWornKey: string;
  readonly branchARush: readonly string[];
  readonly activeIds: readonly string[];
  readonly damagingActiveId: string;
};

const EPICS: readonly EpicSpec[] = [
  {
    className: 'Seraph',
    sig: SERAPH_SIGNATURE,
    tree: SERAPH_TREE,
    stats: { dis: 106, pre: 58 },
    canonicalForks: ['seraph-a5-l', 'seraph-b5-l', 'seraph-c5-l'],
    scalerForkNode: 'seraph-c5-r',
    capstoneWornKey: 'seraph-grace-archangel',
    branchARush: ['seraph-root', 'seraph-a2', 'seraph-a3x', 'seraph-a3y', 'seraph-a4x', 'seraph-a4y', 'seraph-a5-l', 'seraph-a6'],
    activeIds: ['seraph-mend', 'seraph-halo', 'seraph-judgment', 'seraph-sanctuary'],
    damagingActiveId: 'seraph-judgment',
  },
  {
    className: 'Ironclad',
    sig: IRONCLAD_SIGNATURE,
    tree: IRONCLAD_TREE,
    stats: { vit: 106, dis: 58 },
    canonicalForks: ['iron-a5-l', 'iron-b5-l', 'iron-c5-l'],
    scalerForkNode: 'iron-c5-r',
    capstoneWornKey: 'iron-bastion-living',
    branchARush: ['iron-root', 'iron-a2', 'iron-a3x', 'iron-a3y', 'iron-a4x', 'iron-a4y', 'iron-a5-l', 'iron-a6'],
    activeIds: ['iron-shield-slam', 'iron-intercept', 'iron-cage'],
    damagingActiveId: 'iron-shield-slam',
  },
  {
    className: 'Stormcaller',
    sig: STORMCALLER_SIGNATURE,
    tree: STORMCALLER_TREE,
    stats: { pow: 106, agi: 58 },
    canonicalForks: ['storm-a5-l', 'storm-b5-l', 'storm-c5-l'],
    scalerForkNode: 'storm-a5-r',
    capstoneWornKey: 'storm-coil-eye',
    branchARush: ['storm-root', 'storm-a2', 'storm-a3x', 'storm-a3y', 'storm-a4x', 'storm-a4y', 'storm-a5-l', 'storm-a6'],
    activeIds: ['storm-chain-bolt', 'storm-volt-blink', 'storm-pylon'],
    damagingActiveId: 'storm-chain-bolt',
  },
];

function canonicalNodes(spec: EpicSpec): ClassNodeId[] {
  return spec.tree.nodes
    .filter(n => !n.forkGroup || spec.canonicalForks.includes(n.id))
    .map(n => n.id);
}

/** Enumerates all 2^3 = 8 legal full-tree fork combinations for an Epic tree. */
function allForkBuilds(tree: ClassTree): ClassNodeId[][] {
  const groups = new Map<string, ClassNodeId[]>();
  for (const n of tree.nodes) {
    if (!n.forkGroup) continue;
    const list = groups.get(n.forkGroup) ?? [];
    list.push(n.id);
    groups.set(n.forkGroup, list);
  }
  const pairs = [...groups.values()];
  const picks: ClassNodeId[][] = [[]];
  for (const [a, b] of pairs) {
    const next: ClassNodeId[][] = [];
    for (const p of picks) next.push([...p, a!], [...p, b!]);
    picks.length = 0;
    picks.push(...next);
  }
  return picks.map(chosen => tree.nodes.filter(n => !n.forkGroup || chosen.includes(n.id)).map(n => n.id));
}

function makeEpicHunter(spec: EpicSpec, nodes: readonly ClassNodeId[] = [], rank: Rank = 'A') {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, name: spec.className, rank, level: RULES.rankLevels[rank], stats: { ...base.stats, ...spec.stats } },
    spec.className,
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      [spec.className]: { ...earned.classes[spec.className]!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

/** Recursively collects every (key, StatusDef) reachable from signatures and trees, throwing on divergent duplicates. */
function collectAllClassStatuses(): Map<string, StatusDef> {
  const seen = new Map<string, { def: StatusDef; json: string }>();
  const walkOps = (ops: readonly (Op | LandOp)[]) => {
    for (const op of ops) if (op.op === 'applyStatus') walk(op.key, op.def);
  };
  const walk = (key: string, def: StatusDef) => {
    const json = JSON.stringify(def);
    const prev = seen.get(key);
    if (prev && prev.json !== json) {
      throw new Error(`Duplicate class StatusKey "${key}" maps to two distinct StatusDefs`);
    }
    if (!prev) seen.set(key, { def, json });
    for (const tr of def.triggers ?? []) walkOps(tr.ops);
    if ('stack' in def && def.stack?.threshold) walkOps(def.stack.threshold.ops);
    if (def.end) walkOps(def.end.ops);
  };
  for (const sig of Object.values(CLASS_SIGNATURES)) {
    if (!sig) continue;
    if (sig.worn) walk(sig.worn.key, sig.worn.def);
    for (const a of sig.actives ?? []) walkOps(a.ops);
  }
  for (const tree of Object.values(CLASS_TREES)) {
    if (!tree) continue;
    for (const n of tree.nodes) {
      for (const g of n.gifts) {
        if (g.kind === 'replace-worn') walk(g.worn.key, g.worn.def);
        else if (g.kind === 'replace-active') walkOps(g.active.ops);
      }
    }
  }
  return new Map([...seen.entries()].map(([k, v]) => [k, v.def]));
}

describe('Wave 1 Epics: Seraph, Ironclad, and Stormcaller trees, pricing, and integrity', () => {
  test('all three Epic trees validate against TREE_SHAPE.epic, support fork flips and early capstone unlock, and sum to 2,295,000 gold at S rank', () => {
    for (const spec of EPICS) {
      expect(CLASS_SIGNATURES[spec.className]).toBe(spec.sig);
      expect(CLASS_TREES[spec.className]).toBe(spec.tree);
      expect(validateTree(spec.tree), `${spec.className} validateTree`).toEqual([]);
      expect(spec.tree.nodes.length).toBe(TREE_SHAPE.epic.total);

      const full = canonicalNodes(spec);
      expect(full.length).toBe(TREE_SHAPE.epic.buyable);
      expect(repairNodes(spec.tree, full)).toEqual(full);

      // Step-by-step purchase legality + exact S-rank gold sum via nodeCost
      const bought: ClassNodeId[] = [];
      let totalGold = 0;
      for (const id of full) {
        const check = canBuyNode(spec.tree, bought, id);
        expect(check.ok, `${spec.className} node ${id} should be buyable`).toBe(true);
        const price = nodeCost({ rank: 'S' }, spec.className, id, 'player', RULES);
        if (isRefused(price)) throw new Error(`nodeCost refused for ${spec.className}.${id}: ${price.why}`);
        totalGold += price.cost;
        bought.push(id);
      }
      expect(totalGold, `${spec.className} S-rank tree gold`).toBe(2_295_000);

      // Early capstone unlock by finishing Branch A alone
      const rush = spec.branchARush.map(nid);
      expect(capstoneUnlocked(spec.tree, rush)).toBe(true);
      const cap = spec.tree.nodes.find(n => n.capstone)!;
      expect(canBuyNode(spec.tree, rush, cap.id).ok).toBe(true);

      // Fork flip legality on Branch A Depth 5
      const fLeft = nid(spec.canonicalForks[0]!);
      const fRight = spec.tree.nodes.find(n => n.forkGroup === spec.tree.nodes.find(x => x.id === fLeft)!.forkGroup && n.id !== fLeft)!.id;
      expect(canFlipFork(spec.tree, full, fLeft, fRight).ok).toBe(true);
    }
  });

  test('all 8 legal fork builds per Epic respect CLASS_ACTIVES_MAX, kit.scalers <= 2, scalersOf read-back, FORMULA_PARTS, and MAX_ABILITIES priority', () => {
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

    for (const spec of EPICS) {
      const builds = allForkBuilds(spec.tree);
      expect(builds.length).toBe(8);
      for (const nodes of builds) {
        expect(nodes.length).toBe(TREE_SHAPE.epic.buyable);
        expect(repairNodes(spec.tree, nodes)).toEqual(nodes);
        const h = makeEpicHunter(spec, nodes);
        const cp = classPowers(h, RULES);
        expect(cp.actives.length).toBeLessThanOrEqual(CLASS_ACTIVES_MAX);
        expect(cp.scalers.length, `${spec.className} scalers <= kit.scalers`).toBeLessThanOrEqual(RULES.fight.kit.scalers);
        expect(cp.worn?.key).toBe(statusKey(spec.capstoneWornKey));

        const row = hunterRow({ ...h, items: [...h.items, ...bombs] }, combatantId('h1'), RULES);
        // Every class active survives MAX_ABILITIES (12) ahead of bag consumables
        for (const aid of spec.activeIds) {
          expect(row.abilities.map(a => a.id), `${spec.className} missing ${aid}`).toContain(wornAbilityId(abilityId(aid)));
        }
        // Damaging class active reads back scalers via scalersOf when the scaler fork is chosen, and stays within FORMULA_PARTS
        const dmgAb = row.abilities.find(a => a.id === wornAbilityId(abilityId(spec.damagingActiveId)))!;
        const dmgForm = formulaOf(dmgAb, RULES)!;
        expect(partsOf(dmgForm), `${spec.className}.${dmgAb.name} FORMULA_PARTS`).toBeLessThanOrEqual(FORMULA_PARTS);
        const hasScaler = nodes.includes(nid(spec.scalerForkNode));
        if (hasScaler) {
          expect(scalersOf(dmgForm, RULES)?.scalers.length, `${spec.className} scalersOf on ${dmgAb.name}`).toBe(1);
        } else {
          expect(scalersOf(dmgForm, RULES), `${spec.className} no scaler on ${dmgAb.name}`).toBeNull();
        }
        // Bag consumables are never wrapped with class scalers
        const bombAb = row.abilities.find(a => a.name === 'Bomb 0');
        if (bombAb) {
          const bombForm = formulaOf(bombAb, RULES);
          expect(bombForm && scalersOf(bombForm, RULES)).toBeNull();
        }
        for (const a of row.abilities) {
          const form = formulaOf(a, RULES);
          if (form) expect(partsOf(form), `${spec.className} ${a.name} FORMULA_PARTS`).toBeLessThanOrEqual(FORMULA_PARTS);
        }
      }
    }
  });

  test('out-of-combat hunterSheet matches combat modified sheet and reports class worn/bonus sources under class in explain', () => {
    for (const spec of EPICS) {
      for (const nodes of [[], canonicalNodes(spec)]) {
        const h = makeEpicHunter(spec, nodes);
        const ooc = hunterSheet(h, RULES).sheet;
        const row = hunterRow(h, combatantId('h1'), RULES);
        const combat = modified(row.origin, row.statuses, RULES).sheet;
        expect(ooc.hpMax, `${spec.className} hpMax`).toBe(combat.hpMax);
        expect(ooc.armor, `${spec.className} armor`).toBe(combat.armor);
        expect(ooc.resist, `${spec.className} resist`).toBe(combat.resist);
        expect(ooc.mag, `${spec.className} mag`).toBeCloseTo(combat.mag, 4);
      }
    }
    // Ironclad's worn Iron Bulwark (+4 armor / +3 resist) and Living Fortress (+10 armor / +8 resist) appear out of combat under 'class'
    const ironBase = makeEpicHunter(EPICS[1]!, []);
    const ironCap = makeEpicHunter(EPICS[1]!, canonicalNodes(EPICS[1]!));
    expect(explain(ironBase, 'armor', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(4);
    expect(explain(ironBase, 'resist', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(3);
    expect(explain(ironCap, 'armor', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(10);
    expect(explain(ironCap, 'resist', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(8);
  });

  test('every shipped class status key is globally unique across all classes and round-trips through parseStatusDef, classStatusDef, and shippedStatusDef', () => {
    const all = collectAllClassStatuses();
    expect(all.size).toBeGreaterThan(25);
    for (const [key, def] of all) {
      expect(classStatusDef(key), `classStatusDef(${key})`).toEqual(def);
      expect(shippedStatusDef(statusKey(key)), `shippedStatusDef(${key})`).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, key);
      expect(reparsed, `parseStatusDef(${key})`).toEqual(def);
    }
  });

  test('every base and upgraded Epic active ability round-trips identically through parseAbility with zero clamping', () => {
    for (const spec of EPICS) {
      const abilities: Ability[] = [...(spec.sig.actives ?? [])];
      for (const n of spec.tree.nodes) {
        for (const g of n.gifts) if (g.kind === 'replace-active') abilities.push(g.active);
      }
      expect(abilities.length).toBeGreaterThanOrEqual(7);
      for (const a of abilities) {
        const reparsed = parseAbility(JSON.parse(JSON.stringify(a)), RULES);
        expect(reparsed, `${spec.className} parseAbility(${a.name})`).toEqual(a);
      }
    }
  });

  test('fightDoc and fightWire round-trip all three Epic Capstone worn statuses at 0 bytes in wire.defs', () => {
    for (const spec of EPICS) {
      const h = makeEpicHunter(spec, canonicalNodes(spec));
      const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
      const foe = monsterRows({ name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
      let f: Fight | null = reduce(null, { type: 'add', fightId: fightId(`f-${spec.className}`), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

      const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error('expected active FightDoc');
      const wire = fightWire(doc);
      expect(wire.defs, `${spec.className} wire.defs should be omitted`).toBeUndefined();
      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
      const row = parsed.rows.find(r => r.id === combatantId('h1'))!;
      const worn = row.statuses.find(s => s.key === statusKey(spec.capstoneWornKey));
      expect(worn?.def).toEqual(classStatusDef(spec.capstoneWornKey)!);
    }
  });

  test('every Epic tree node description matches its bonus and scaler gift numbers (anti-drift check)', () => {
    for (const spec of EPICS) {
      for (const n of spec.tree.nodes) {
        for (const g of n.gifts) {
          if (g.kind === 'bonus') {
            for (const k of BONUS_KEYS) {
              const v = g.bonus[k as BonusKey];
              if (typeof v !== 'number' || v === 0) continue;
              const needle = k === 'critSize'
                ? String(v / 100)
                : (BONUS_HUNDREDTHS as readonly string[]).includes(k) ? `${v}%` : String(v);
              expect(n.desc, `${spec.className}.${n.id} desc missing ${k}=${needle}: "${n.desc}"`).toContain(needle);
            }
          } else if (g.kind === 'scaler') {
            const pct = `${Math.round(g.scaler.scale * 100)}%`;
            expect(n.desc, `${spec.className}.${n.id} desc missing scaler ${pct}: "${n.desc}"`).toContain(pct);
          }
        }
      }
    }
  });

  test('Epic base signatures price cleanly through item-budget and worth tables (28-point Epic diagnostic at rank B)', () => {
    const explainKeys: Record<string, 'healPower' | 'threat' | 'haste'> = {
      Seraph: 'healPower',
      Ironclad: 'threat',
      Stormcaller: 'haste',
    };
    for (const spec of EPICS) {
      const wornPart = spec.sig.worn ? { worn: spec.sig.worn.def } : {};
      const rootA = titleSpend({ bonus: spec.sig.bonus ?? {}, ...wornPart, band: 'A' }, RULES);
      const rootB = titleSpend({ bonus: spec.sig.bonus ?? {}, ...wornPart, band: 'B' }, RULES);
      // Diagnostic band (settled.md: ~28-point Epic diagnostic at rank B, not a hard clip)
      expect(rootB.points, `${spec.className} root passive at B (${rootB.points.toFixed(1)} pts)`).toBeGreaterThan(15);
      expect(rootB.points, `${spec.className} root passive at B (${rootB.points.toFixed(1)} pts)`).toBeLessThan(40);
      expect(rootA.points, `${spec.className} root passive at A (${rootA.points.toFixed(1)} pts)`).toBeGreaterThan(15);
      expect(rootA.points, `${spec.className} root passive at A (${rootA.points.toFixed(1)} pts)`).toBeLessThan(45);

      for (const a of spec.sig.actives ?? []) {
        const w = abilityWorth(a, RULES, { rank: 'A', on: 'best' });
        expect(Number.isFinite(w.worth), `${spec.className}.${a.name} worth finite`).toBe(true);
        expect(w.worth, `${spec.className}.${a.name} worth > 0`).toBeGreaterThan(0);
        expect(w.worth, `${spec.className}.${a.name} worth <= 2.2 SA`).toBeLessThanOrEqual(2.2);
      }

      // Sheet source breakdown reports class bonuses under 'class'
      const h = makeEpicHunter(spec, []);
      const key = explainKeys[spec.className]!;
      const exp = explain(h, key, RULES);
      expect(exp.parts.find(p => p.from === 'class')?.amount ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('Seraph combat mechanics', () => {
  test('Deathless Halo lethal reaction saves an ally within 4 tiles, and repeat saves still heal and safeguard while invulnerable stays spent', () => {
    const ctx = { rules: RULES };
    const seraph = makeEpicHunter(EPICS[0]!, []);
    const ally = { ...newHunter(RULES), id: 'h-ally', name: 'Mira', rank: 'A' as const, level: 50, life: lifeAfter(newHunter(RULES).life, { type: 'setHp', hp: 10 }, 500) };
    const sRow = hunterRow(seraph, combatantId('h1'), RULES);
    const aRow0 = hunterRow(ally, combatantId('h2'), RULES);
    const aRow = { ...aRow0, life: { at: 'up' as const, hp: 5 } };
    const boss = monsterRows({ name: 'Ogre', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-seraph-halo'),
      rows: [{ ...sRow, place: place(2, 2) }, { ...aRow, place: place(5, 2) }, { ...boss, place: place(6, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('m1'), d20: 15, tie: 2 }, { id: combatantId('h2'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    // Arm Deathless Halo on Seraph
    const haloId = wornAbilityId(abilityId('seraph-halo'));
    let r = reduce(f, { type: 'arm', by: combatantId('h1'), ability: haloId }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;

    // Boss hits 5-HP ally for lethal damage: Deathless Halo triggers, heals ally, applies invulnerable + safeguard, ally survives
    const swing = boss.abilities[0]!.id;
    r = reduce(f, {
      type: 'act',
      by: combatantId('m1'),
      ability: swing,
      aim: combatantId('h2'),
      rolls: { dice: { [combatantId('h2')]: [8] }, react: { [combatantId('h2')]: 1 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const saved = f.rows.find(x => x.id === combatantId('h2'))!;
    expect(saved.life.at).toBe('up');
    expect(rowHp(saved)).toBeGreaterThanOrEqual(1);
    expect(saved.statuses.some(s => s.key === statusKey('seraph-halo-ward'))).toBe(true);
    expect(saved.statuses.some(s => s.key === statusKey('seraph-halo-safe'))).toBe(true);
    expect(saved.warded).toContain('invulnerable');
  });

  test('Sanctuary Choir shields, hastens, leaves an ally-only Sanctuary zone, and heals nearby allies on Seraph turnStart scaled off Seraph sup', () => {
    const ctx = { rules: RULES };
    const seraph = makeEpicHunter(EPICS[0]!, []);
    const ally = { ...newHunter(RULES), id: 'h-ally', name: 'Mira', rank: 'A' as const, level: 50 };
    const sRow = hunterRow(seraph, combatantId('h1'), RULES);
    const aRow0 = hunterRow(ally, combatantId('h2'), RULES);
    const aRow = { ...aRow0, life: { at: 'up' as const, hp: 50 } };
    const foe = monsterRows({ name: 'Imp', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-seraph-sanc'),
      rows: [{ ...sRow, place: place(3, 3) }, { ...aRow, place: place(5, 3) }, { ...foe, place: place(4, 3) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    const allyAt0 = f.rows.find(x => x.id === combatantId('h2'))!.at;
    const sancId = wornAbilityId(abilityId('seraph-sanctuary'));
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: sancId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    let after = r.fight as Running;
    const sAfter = after.rows.find(x => x.id === combatantId('h1'))!;
    const aAfter = after.rows.find(x => x.id === combatantId('h2'))!;
    const mAfter = after.rows.find(x => x.id === combatantId('m1'))!;

    expect(sAfter.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(aAfter.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(aAfter.at).toBeLessThan(allyAt0);
    expect(mAfter.shield).toBeNull();
    expect(sAfter.statuses.some(s => s.key === statusKey('seraph-choir'))).toBe(true);
    const zone = after.zones.find(z => z.name === 'Sanctuary')!;
    expect(zone).toBeDefined();
    expect(zone.spares).toBe('foe');

    // Cycle turns back to Seraph's next turnStart: seraph-choir heals the hurt ally scaled off Seraph's own sup (not ally's low sup)
    const allyHpBefore = rowHp(aAfter);
    const seraphSup = sAfter.sheet.sup;
    const allySup = aAfter.sheet.sup;
    expect(seraphSup).toBeGreaterThan(allySup * 2);
    // Advance directly to Seraph's next turn
    after = {
      ...after,
      currentId: combatantId('m1'),
      rows: after.rows.map(b => (b.id === combatantId('h1') ? { ...b, at: tick(1100) } : b.id === combatantId('m1') ? { ...b, at: tick(1050) } : { ...b, at: tick(2000) })),
      now: tick(1050),
    };
    r = reduce(after, { type: 'endTurn', by: combatantId('m1') }, ctx);
    const nextFight = r.fight as Running;
    expect(nextFight.currentId).toBe(combatantId('h1'));
    const allyHealed = rowHp(nextFight.rows.find(x => x.id === combatantId('h2'))!) - allyHpBefore;
    // Expected heal is at least 0.25 * seraphSup (well above 0.25 * allySup)
    expect(allyHealed).toBeGreaterThan(Math.floor(0.25 * seraphSup));
  });

  test('Radiant Mend fork: Hallowed Mend dispels all negative statuses and shields, while Aegis of Dawn converts it into a preventive shield + hasten', () => {
    const ctx = { rules: RULES };
    const mendId = wornAbilityId(abilityId('seraph-mend'));
    const runMend = (forkNode: string) => {
      const nodes = ['seraph-root', 'seraph-a2', 'seraph-a3x', 'seraph-a3y', 'seraph-a4x', 'seraph-a4y', forkNode].map(nid);
      const seraph = makeEpicHunter(EPICS[0]!, nodes);
      const ally = { ...newHunter(RULES), id: 'h-ally', name: 'Mira', rank: 'A' as const, level: 50 };
      const sRow = hunterRow(seraph, combatantId('h1'), RULES);
      const aRow0 = hunterRow(ally, combatantId('h2'), RULES);
      const burn = statusOn(BUILT_IN_STATUSES.burning, { key: statusKey('burning'), source: { id: combatantId('m1'), tier: 4 }, until: tick(4000), since: tick(0), settledAt: tick(0) });
      const poison = statusOn(BUILT_IN_STATUSES.poisoned, { key: statusKey('poisoned'), source: { id: combatantId('m1'), tier: 4 }, until: tick(4000), since: tick(0), settledAt: tick(0) });
      const aRow = { ...aRow0, life: { at: 'up' as const, hp: 50 }, statuses: [...aRow0.statuses, burn, poison] };
      const foe = monsterRows({ name: 'Imp', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

      let f: Fight = reduce(null, {
        type: 'add',
        fightId: fightId(`f-${forkNode}`),
        rows: [{ ...sRow, place: place(3, 3) }, { ...aRow, place: place(5, 3) }, { ...foe, place: place(7, 3) }],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
      const allyAt0 = (f as Running).rows.find(x => x.id === combatantId('h2'))!.at;
      const r = reduce(f as Running, { type: 'act', by: combatantId('h1'), ability: mendId, aim: combatantId('h2'), rolls: { dice: { [combatantId('h2')]: [6] }, react: {} }, force: true }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      return { after: (r.fight as Running).rows.find(x => x.id === combatantId('h2'))!, allyAt0 };
    };

    // Hallowed Mend (left): heals, adds shield + -15% ward, and strips BOTH burning and poisoned (dispel: 'all')
    const left = runMend('seraph-a5-l');
    expect(rowHp(left.after)).toBeGreaterThan(50);
    expect(left.after.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(left.after.statuses.some(s => s.key === statusKey('burning'))).toBe(false);
    expect(left.after.statuses.some(s => s.key === statusKey('poisoned'))).toBe(false);
    expect(left.after.statuses.some(s => s.key === statusKey('seraph-light-ii'))).toBe(true);

    // Aegis of Dawn (right): huge preventive shield (larger than Hallowed Mend's), hastens ally, dispels first negative status
    const right = runMend('seraph-a5-r');
    expect(right.after.shield?.amount ?? 0).toBeGreaterThan((left.after.shield?.amount ?? 0) * 2);
    expect(right.after.at).toBeLessThan(right.allyAt0);
  });
});

describe('Ironclad combat mechanics', () => {
  test('Iron Cage pulls foes inward, taunts them, and roots them for 2 rounds on a 4-round CD in both base and fork upgrades (never permanent root)', () => {
    const ctx = { rules: RULES };
    const iron = makeEpicHunter(EPICS[1]!, []);
    const iRow = hunterRow(iron, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Wolf', rank: 'A', archetype: 'skirmisher', kind: 'elite', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-iron-cage'),
      rows: [{ ...iRow, place: place(3, 3) }, { ...foe, place: place(7, 3) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    // Verify Iron Bulwark worn armor (+4) / resist (+3) applied
    const iStart = f.rows.find(x => x.id === combatantId('h1'))!;
    const bareSheet = modified(iStart.origin, [], RULES).sheet;
    expect(iStart.sheet.armor).toBe(bareSheet.armor + 4);
    expect(iStart.sheet.resist).toBe(bareSheet.resist + 3);

    // Cast Iron Cage centered at (5, 3): catches foe at (7, 3), shoves toward (5, 3), taunts, lays 2-round rooting zone
    const cageId = wornAbilityId(abilityId('iron-cage'));
    const r = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: cageId,
      aim: place(5, 3),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const after = r.fight as Running;
    const foeAfter = after.rows.find(x => x.id === combatantId('m1'))!;
    expect(foeAfter.place.x).toBeLessThan(7);
    expect(foeAfter.statuses.some(s => s.key === statusKey('iron-caged-taunt'))).toBe(true);
    expect(foeAfter.sheet.stride).toBe(tiles(0));
    const zone = after.zones.find(z => z.name === 'Iron Cage')!;
    expect(zone).toBeDefined();
    expect(zone.spares).toBe('party');

    // Neither Colossus Cage nor Crushing Cage extends zone duration past 2 rounds or drops cooldown below 4 rounds
    for (const forkId of ['iron-a5-l', 'iron-a5-r']) {
      const node = IRONCLAD_TREE.nodes.find(n => n.id === nid(forkId))!;
      const rep = node.gifts.find(g => g.kind === 'replace-active')!;
      if (rep.kind !== 'replace-active') throw new Error('expected replace-active');
      expect(rep.active.cost.cooldown).toBeGreaterThanOrEqual(4 * RULES.fight.round);
      expect(rep.active.zone?.duration).toBeLessThanOrEqual(2 * RULES.fight.round);
    }
  });

  test('Iron Bulwark stacks Siege Charge when struck (raising armor), Shield Slam scales off stacks and consumes them, and Bulwark Intercept guards incoming hits', () => {
    const ctx = { rules: RULES };
    const iron = makeEpicHunter(EPICS[1]!, []);
    const iRow = hunterRow(iron, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Brute', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    const startFight = (id: string): Running => {
      let f: Fight = reduce(null, {
        type: 'add',
        fightId: fightId(id),
        rows: [{ ...iRow, place: place(3, 3) }, { ...foe, place: place(4, 3) }],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
      return f as Running;
    };

    const slamId = wornAbilityId(abilityId('iron-shield-slam'));
    const guardId = wornAbilityId(abilityId('iron-intercept'));
    const swing = foe.abilities[0]!.id;

    // 1. Baseline Shield Slam at 0 Siege Charge stacks
    const f0 = startFight('f-iron-slam-0');
    const foeHpBase = rowHp(f0.rows.find(x => x.id === combatantId('m1'))!);
    const r0 = reduce(f0, {
      type: 'act',
      by: combatantId('h1'),
      ability: slamId,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r0.effects.filter(e => e.type === 'refused')).toEqual([]);
    const dmg0 = foeHpBase - rowHp((r0.fight as Running).rows.find(x => x.id === combatantId('m1'))!);

    // 2. Arm Bulwark Intercept, absorb 3 strikes (building 3 Siege Charge stacks and raising armor by +6), then unleash Shield Slam
    let f = startFight('f-iron-charge');
    const armor0 = f.rows.find(x => x.id === combatantId('h1'))!.sheet.armor;
    let r = reduce(f, { type: 'arm', by: combatantId('h1'), ability: guardId }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;

    for (let i = 0; i < 3; i++) {
      r = reduce(f, {
        type: 'act',
        by: combatantId('m1'),
        ability: swing,
        aim: combatantId('h1'),
        rolls: { dice: { [combatantId('h1')]: [6] }, react: { [combatantId('h1')]: 1 } },
        force: true,
      }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      f = r.fight as Running;
      if (i === 0) {
        const guarded = f.rows.find(x => x.id === combatantId('h1'))!;
        expect(guarded.statuses.some(s => s.key === statusKey('iron-safeguard'))).toBe(true);
      }
    }

    const chargedIron = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(chargedIron.statuses.find(s => s.key === statusKey('iron-charge'))?.stacks).toBe(3);
    expect(chargedIron.sheet.armor).toBe(armor0 + 6);

    const foeHpBeforeCharged = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: slamId,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterSlam = r.fight as Running;
    const dmg3 = foeHpBeforeCharged - rowHp(afterSlam.rows.find(x => x.id === combatantId('m1'))!);
    // 3 stacks -> +54% multiplier + higher armor; strictly greater than 0-stack Slam, and consumes all Siege Charge!
    expect(dmg3).toBeGreaterThan(Math.round(dmg0 * 1.4));
    expect(afterSlam.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('iron-charge'))).toBe(false);
  });
});

describe('Stormcaller combat mechanics', () => {
  test('Chain Bolt stacks Static Charge, echoes harmful status to nearby foe, and 3-stack discharge blasts all foes within 3 tiles from range 7', () => {
    const ctx = { rules: RULES };
    const storm = makeEpicHunter(EPICS[2]!, []);
    const sRow = hunterRow(storm, combatantId('h1'), RULES);
    const [m1, m2] = monsterRows({ name: 'Golem', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 4 }, abilities: [], statuses: [] }, [combatantId('m1'), combatantId('m2')], RULES);

    // Stormcaller at (2, 3), targets at (9, 3) [range 7] and (11, 3) [2 tiles from m1]
    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-storm-charge'),
      rows: [{ ...sRow, place: place(2, 3) }, { ...m1!, place: place(9, 3) }, { ...m2!, place: place(11, 3) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('m1'), d20: 2, tie: 2 }, { id: combatantId('m2'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    const boltId = wornAbilityId(abilityId('storm-chain-bolt'));
    const castBolt = (cur: Running) => {
      const r = reduce(cur, {
        type: 'act',
        by: combatantId('h1'),
        ability: boltId,
        aim: combatantId('m1'),
        rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
        force: true,
      }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      return r.fight as Running;
    };

    // Cast 1: m1 gains Conductive (echoed to m2!) and 1 stack of Static Charge
    f = castBolt(f);
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.find(s => s.key === statusKey('storm-charge'))?.stacks).toBe(1);
    expect(f.rows.find(x => x.id === combatantId('m2'))!.statuses.some(s => s.key === statusKey('storm-conductive'))).toBe(true);

    // Cast 2: m1 reaches 2 stacks of Static Charge
    f = { ...f, now: tick(1200) };
    f = castBolt(f);
    expect(f.rows.find(x => x.id === combatantId('m1'))!.statuses.find(s => s.key === statusKey('storm-charge'))?.stacks).toBe(2);

    // Cast 3: m1 crosses 3 stacks -> spends Static Charge, blasts BOTH m1 AND m2 (2 tiles away) and adds stagger to m2!
    const m2HpBefore = rowHp(f.rows.find(x => x.id === combatantId('m2'))!);
    const m2StagBefore = f.rows.find(x => x.id === combatantId('m2'))!.stagger?.fill ?? 0;
    f = { ...f, now: tick(2400) };
    f = castBolt(f);
    const m1After = f.rows.find(x => x.id === combatantId('m1'))!;
    const m2After = f.rows.find(x => x.id === combatantId('m2'))!;
    expect(m1After.statuses.some(s => s.key === statusKey('storm-charge'))).toBe(false);
    expect(rowHp(m2After)).toBeLessThan(m2HpBefore);
    expect(m2After.stagger?.fill ?? 0).toBeGreaterThan(m2StagBefore);
  });

  test('Volt Blink teleports Stormcaller, jolts foes near arrival, and grants Flash Surge at Capstone; Storm Pylon lays Storm Field', () => {
    const ctx = { rules: RULES };
    const storm = makeEpicHunter(EPICS[2]!, canonicalNodes(EPICS[2]!));
    const sRow = hunterRow(storm, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'A', archetype: 'brute', kind: 'elite', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-storm-blink'),
      rows: [{ ...sRow, place: place(2, 3) }, { ...foe, place: place(9, 3) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    const foeHp0 = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    const blinkId = wornAbilityId(abilityId('storm-volt-blink'));
    // Blink 6 tiles to (8, 3), adjacent to foe at (9, 3)
    let r = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: blinkId,
      aim: place(8, 3),
      rolls: { dice: { [combatantId('m1')]: [4, 4] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    let after = r.fight as Running;
    const sAfter = after.rows.find(x => x.id === combatantId('h1'))!;
    const mAfter = after.rows.find(x => x.id === combatantId('m1'))!;
    expect(sAfter.place).toEqual(place(8, 3));
    expect(sAfter.statuses.some(s => s.key === statusKey('storm-surge-ii'))).toBe(true);
    expect(rowHp(mAfter)).toBeLessThan(foeHp0);
    // Flash Step applies 2 stacks of Static Charge + Eye of the Storm hitDealt adds 1 = 3 stacks -> immediate detonation!
    expect(mAfter.statuses.some(s => s.key === statusKey('storm-charge'))).toBe(false);

    // Storm Pylon lays a party-sparing Storm Field zone (no burn DoT; slows and increases damage taken)
    const pylonId = wornAbilityId(abilityId('storm-pylon'));
    r = reduce(after, {
      type: 'act',
      by: combatantId('h1'),
      ability: pylonId,
      aim: place(9, 3),
      rolls: { dice: { [combatantId('m1')]: [4, 4] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    after = r.fight as Running;
    const field = after.zones.find(z => z.name === 'Storm Field')!;
    expect(field).toBeDefined();
    expect(field.spares).toBe('party');
    expect(field.ops.some(o => o.op === 'damage')).toBe(false);
  });
});
