import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, RULES } from '../src/core/rules.ts';
import type { BonusKey } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { fightId, parseSaveId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, ItemId } from '../src/core/ids.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, hunterSheet } from '../src/core/hunter/sheet.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { combatantId, abilityId } from '../src/core/combat/ability-types.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place } from '../src/core/combat/space.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { mythicMove } from '../src/core/registry/mythic-moves.ts';
import { movesOf, MYTHICS } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { BLADEFIEND_SIGNATURE, BLADEFIEND_TREE } from '../src/core/registry/class-bladefiend.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';

const AT = '2026-11-25T12:00:00.000Z';
const HUNDREDTHS = new Set<BonusKey>(BONUS_HUNDREDTHS);

const CANONICAL_BF_FORKS = ['bf-a5-l', 'bf-b5-l', 'bf-c5-l', 'bf-a7-l', 'bf-b7-l', 'bf-c7-l'];
const FULL_BF_NODES: readonly ClassNodeId[] = BLADEFIEND_TREE.nodes
  .filter(n => !n.forkGroup || CANONICAL_BF_FORKS.includes(n.id))
  .map(n => n.id);

function makeBfHunter(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass({ ...base, rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, str: 156, agi: 83 } }, 'Bladefiend', { at: AT, R: RULES });
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Bladefiend: { ...earned.classes.Bladefiend!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Bladefiend signature, 38-node tree, and gold pricing', () => {
  test('BLADEFIEND_TREE validates against TREE_SHAPE.mythic and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Bladefiend).toBe(BLADEFIEND_SIGNATURE);
    expect(CLASS_TREES.Bladefiend).toBe(BLADEFIEND_TREE);
    expect(validateTree(BLADEFIEND_TREE)).toEqual([]);
    expect(BLADEFIEND_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(FULL_BF_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(BLADEFIEND_TREE, FULL_BF_NODES)).toEqual([...FULL_BF_NODES]);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of FULL_BF_NODES) {
      const check = canBuyNode(BLADEFIEND_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Bladefiend', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('every Bladefiend status def and active ability round-trips cleanly and has strictly unique status keys', () => {
    const keys = [
      'bf-blade-flow',
      'bf-blade-flow-saint',
      'bf-parry-edge',
      'bf-parry-edge-ii',
      'bf-tempest',
      'bf-tempest-ii',
      'bf-wind-exposed',
      'bf-wind-exposed-ii',
      'bf-gale-slow',
      'bf-cuts-bleed',
      'bf-cuts-bleed-ii',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k);
      expect(reparsed, `parseStatusDef(${k})`).not.toBeNull();
    }

    // Verify no status key maps to two distinct JSON StatusDefs across Bladefiend signature + tree
    const seen = new Map<string, string>();
    const checkDef = (key: string, def: unknown): void => {
      const json = JSON.stringify(def);
      const prev = seen.get(key);
      if (prev !== undefined) expect(json, `status key ${key} has conflicting defs`).toBe(prev);
      else seen.set(key, json);
    };
    const walkDef = (key: string, def: { readonly triggers?: readonly { readonly ops: readonly { readonly op: string; readonly key?: string; readonly def?: unknown }[] }[]; readonly stack?: { readonly threshold?: { readonly ops: readonly { readonly op: string; readonly key?: string; readonly def?: unknown }[] } | null }; readonly end?: { readonly ops: readonly { readonly op: string; readonly key?: string; readonly def?: unknown }[] } }): void => {
      checkDef(key, def);
      for (const tr of def.triggers ?? []) for (const o of tr.ops) if (o.op === 'applyStatus' && o.key && o.def) walkDef(o.key, o.def as never);
      for (const o of def.stack?.threshold?.ops ?? []) if (o.op === 'applyStatus' && o.key && o.def) walkDef(o.key, o.def as never);
      for (const o of def.end?.ops ?? []) if (o.op === 'applyStatus' && o.key && o.def) walkDef(o.key, o.def as never);
    };
    if (BLADEFIEND_SIGNATURE.worn) walkDef(BLADEFIEND_SIGNATURE.worn.key, BLADEFIEND_SIGNATURE.worn.def);
    for (const a of BLADEFIEND_SIGNATURE.actives ?? []) {
      expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `parseAbility(${a.name})`).not.toBeNull();
      for (const o of a.ops) if (o.op === 'applyStatus') walkDef(o.key, o.def);
    }
    for (const n of BLADEFIEND_TREE.nodes) {
      for (const g of n.gifts) {
        if (g.kind === 'replace-worn') walkDef(g.worn.key, g.worn.def);
        if (g.kind === 'replace-active') {
          expect(parseAbility(JSON.parse(JSON.stringify(g.active)), RULES), `parseAbility(${g.active.name})`).not.toBeNull();
          for (const o of g.active.ops) if (o.op === 'applyStatus') walkDef(o.key, o.def);
        }
      }
    }
  });

  test('all 64 legal fork paths respect kit.scalers <= 2, scalersOf round-trips, class actives beat consumables, and node descriptions match gifts', () => {
    // Exhaustive 64-mask fork check (PR 2 pattern)
    const forkGroups = [...new Set(BLADEFIEND_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => BLADEFIEND_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = BLADEFIEND_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const cp = classPowers(makeBfHunter(nodes), RULES);
      expect(cp.scalers.length, `fork mask ${mask} exceeded kit.scalers`).toBeLessThanOrEqual(RULES.fight.kit.scalers);
    }

    const maxH = makeBfHunter(FULL_BF_NODES);
    const cp = classPowers(maxH, KEYSTONES_ON);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    expect(cp.scalers.length).toBe(2);
    // Bladefiend carries zero lifesteal/shieldDrain (Hemomancer's survival texture)
    expect(cp.bonus.drain ?? 0).toBe(0);
    expect(cp.bonus.shieldDrain ?? 0).toBe(0);

    const row = hunterRow(maxH, combatantId('bf-max'), KEYSTONES_ON);
    for (const id of ['bf-keen-slash', 'bf-rending-gale', 'bf-hundred-cuts']) {
      const ab = row.abilities.find(a => a.id === wornAbilityId(abilityId(id)))!;
      const form = formulaOf(ab, KEYSTONES_ON)!;
      expect(partsOf(form), `${ab.name} exceeds FORMULA_PARTS`).toBeLessThanOrEqual(FORMULA_PARTS);
      expect(scalersOf(form, KEYSTONES_ON)?.scalers.length, `${ab.name} scalersOf`).toBe(2);
    }

    // Class actives stay ahead of bag consumables at MAX_ABILITIES (12), and consumables are not wrapped with class scalers
    const bombs = Array.from({ length: 12 }, (_, idx) => ({
      id: parseSaveId<'i'>(`i${100 + idx}`) as ItemId,
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
    const fullBagRow = hunterRow({ ...maxH, items: [...maxH.items, ...bombs] }, combatantId('bf-bag'), KEYSTONES_ON);
    for (const id of ['bf-keen-slash', 'bf-deflecting-edge', 'bf-rending-gale', 'bf-hundred-cuts']) {
      expect(fullBagRow.abilities.map(a => a.id)).toContain(wornAbilityId(abilityId(id)));
    }
    const bombAb = fullBagRow.abilities.find(a => a.name === 'Bomb 0');
    if (bombAb) {
      const bombForm = formulaOf(bombAb, KEYSTONES_ON);
      expect(bombForm && scalersOf(bombForm, KEYSTONES_ON)).toBeNull();
    }

    // Anti-drift: every bonus node's desc includes every numeric value in its bonus gifts
    for (const n of BLADEFIEND_TREE.nodes) {
      for (const g of n.gifts) {
        if (g.kind === 'bonus') {
          for (const [k, v] of Object.entries(g.bonus) as [BonusKey, number][]) {
            const shown = k === 'critSize' ? String(v / 100) : HUNDREDTHS.has(k) ? `${v}%` : String(v);
            expect(n.desc, `${n.id} desc missing ${k}=${shown}`).toContain(shown);
          }
        } else if (g.kind === 'scaler') {
          const pct = `${Math.round(g.scaler.scale * 100)}%`;
          expect(n.desc, `${n.id} desc missing scaler ${pct}`).toContain(pct);
        }
      }
    }
  });
});

describe('Bladefiend combat mechanics and wire round-trip', () => {
  test('sheet, rows, fight-doc, and protocol round-trip Bladefiend worn status at 0 wire bytes', () => {
    const h = makeBfHunter(FULL_BF_NODES);
    const exp = explain(h, 'speed', RULES);
    expect(exp.parts.find(p => p.from === 'class')?.amount).toBeGreaterThan(15);

    const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
    expect(hRow.statuses.some(s => s.key === statusKey('bf-blade-flow-saint') && s.worn)).toBe(true);
    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-bf'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    const row = parsed.rows.find(r => r.id === combatantId('h1'))!;
    expect(row.statuses.find(s => s.key === statusKey('bf-blade-flow-saint'))?.def).toEqual(classStatusDef('bf-blade-flow-saint')!);
  });

  test('Deflecting Edge negates sure Mythic omens for Bladefiend ONLY (not party allies), granting Parry Edge and counter-slashing the boss', () => {
    const h = makeBfHunter(FULL_BF_NODES);
    const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
    const allyBase = newHunter(RULES);
    const allySheet = hunterSheet({ ...allyBase, rank: 'S', level: RULES.rankLevels.S }, RULES).sheet;
    const allyH = { ...allyBase, name: 'Ally', rank: 'S' as const, level: RULES.rankLevels.S, life: lifeAfter(allyBase.life, { type: 'heal', amount: 100_000 }, 100_000), mana: allySheet.manaMax };
    const allyRow = hunterRow(allyH, combatantId('h2'), KEYSTONES_ON);

    const parryId = wornAbilityId(abilityId('bf-deflecting-edge'));
    const [noteKey, noteMove] = movesOf(MYTHICS['angel-of-the-last-trumpet']).find(([k]) => (k as string) === 'final-note')!;
    const finalNote = mythicMove(noteKey, noteMove, { rank: 'S', archetype: 'caster', kind: 'mythic', tweak: { hp: 1, dealt: 1, stats: {}, traits: [] } }, KEYSTONES_ON);
    const foeBase = monsterRows({ name: 'Angel', rank: 'S', archetype: 'caster', kind: 'mythic', tweak: {}, abilities: [finalNote], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;

    const ctx = { rules: KEYSTONES_ON };
    let f = reduce(null, {
      type: 'add',
      fightId: fightId('f-parry'),
      rows: [{ ...hRow, place: place(3, 3) }, { ...allyRow, place: place(5, 3) }, { ...foeBase, place: place(4, 3) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 1, tie: 1 }, { id: combatantId('h2'), d20: 1, tie: 1 }, { id: combatantId('m1'), d20: 20, tie: 2 }] }, ctx).fight!;
    f = reduce(f, { type: 'arm', by: combatantId('h1'), ability: parryId }, ctx).fight!;
    const bfHp0 = rowHp(f.rows.find(r => r.id === combatantId('h1'))!);
    const allyHp0 = rowHp(f.rows.find(r => r.id === combatantId('h2'))!);
    const bossHp0 = rowHp(f.rows.find(r => r.id === combatantId('m1'))!);

    // Angel fires area sure omen The Final Note catching both Bladefiend and Ally
    const res = reduce(f as Running, {
      type: 'act',
      by: combatantId('m1'),
      ability: finalNote.id,
      aim: place(4, 3),
      rolls: { dice: { [combatantId('h1')]: [10, 10], [combatantId('h2')]: [10, 10] }, react: {} },
      force: true,
    }, ctx);
    expect(res.effects.some(e => e.type === 'refused')).toBe(false);
    const after = res.fight as Running;
    const bf = after.rows.find(r => r.id === combatantId('h1'))!;
    const ally = after.rows.find(r => r.id === combatantId('h2'))!;
    const boss = after.rows.find(r => r.id === combatantId('m1'))!;

    // Bladefiend parried cleanly (0 damage, Parry Edge active, counter-slashed boss); Ally still took the omen!
    expect(rowHp(bf)).toBe(bfHp0);
    expect(bf.statuses.some(s => s.key === statusKey('bf-parry-edge-ii'))).toBe(true);
    expect(rowHp(boss)).toBeLessThan(bossHp0);
    expect(rowHp(ally)).toBeLessThan(allyHp0);
  });

  test('Tempest Flow builds on crits and shatters to 0 when Bladefiend is struck', () => {
    const h = makeBfHunter(FULL_BF_NODES);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-flow'), rows: [{ ...hRow, place: place(3, 3) }, { ...foe, place: place(4, 3) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const slashId = wornAbilityId(abilityId('bf-keen-slash'));
    const bossAtk = foe.abilities[0]!;

    // Bladefiend lands a crit (react d20 = 1) -> gains 1 stack of Tempest Flow
    let r = reduce(f as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: slashId,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } },
      force: true,
    }, ctx);
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    let run = r.fight as Running;
    expect(run.rows.find(x => x.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('bf-tempest-ii'))?.stacks).toBe(1);

    // Boss hits Bladefiend (no parry armed, low defense roll) -> Tempest Flow shatters back to 0!
    r = reduce(run, {
      type: 'act',
      by: combatantId('m1'),
      ability: bossAtk.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [10] }, react: { [combatantId('h1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    run = r.fight as Running;
    expect(run.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('bf-tempest-ii'))).toBe(false);
  });
});
