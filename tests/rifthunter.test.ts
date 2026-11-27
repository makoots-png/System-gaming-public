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
import { place, tiles } from '../src/core/combat/space.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { RIFTHUNTER_SIGNATURE, RIFTHUNTER_TREE } from '../src/core/registry/class-rifthunter.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';

const AT = '2026-11-25T12:00:00.000Z';
const HUNDREDTHS = new Set<BonusKey>(BONUS_HUNDREDTHS);

const CANONICAL_RH_FORKS = ['rh-a5-l', 'rh-b5-l', 'rh-c5-l', 'rh-a7-l', 'rh-b7-l', 'rh-c7-l'];
const FULL_RH_NODES: readonly ClassNodeId[] = RIFTHUNTER_TREE.nodes
  .filter(n => !n.forkGroup || CANONICAL_RH_FORKS.includes(n.id))
  .map(n => n.id);

function makeRhHunter(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass({ ...base, rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, ins: 156, ctl: 83 } }, 'Rifthunter', { at: AT, R: RULES });
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Rifthunter: { ...earned.classes.Rifthunter!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Rifthunter signature, 38-node tree, and gold pricing', () => {
  test('RIFTHUNTER_TREE validates against TREE_SHAPE.mythic and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Rifthunter).toBe(RIFTHUNTER_SIGNATURE);
    expect(CLASS_TREES.Rifthunter).toBe(RIFTHUNTER_TREE);
    expect(validateTree(RIFTHUNTER_TREE)).toEqual([]);
    expect(RIFTHUNTER_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(FULL_RH_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(RIFTHUNTER_TREE, FULL_RH_NODES)).toEqual([...FULL_RH_NODES]);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of FULL_RH_NODES) {
      const check = canBuyNode(RIFTHUNTER_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Rifthunter', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('every Rifthunter status def and active ability round-trips cleanly and has strictly unique status keys', () => {
    const keys = [
      'rh-cadence-worn',
      'rh-cadence-monarch',
      'rh-cadence',
      'rh-fourth-crit',
      'rh-fourth-echo',
      'rh-rift-stride',
      'rh-rift-stride-ii',
      'rh-step-edge',
      'rh-step-edge-ii',
      'rh-tethered',
      'rh-tethered-ii',
      'rh-verdict-mark',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k);
      expect(reparsed, `parseStatusDef(${k})`).not.toBeNull();
    }

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
    if (RIFTHUNTER_SIGNATURE.worn) walkDef(RIFTHUNTER_SIGNATURE.worn.key, RIFTHUNTER_SIGNATURE.worn.def);
    for (const a of RIFTHUNTER_SIGNATURE.actives ?? []) {
      expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `parseAbility(${a.name})`).not.toBeNull();
      for (const o of a.ops) if (o.op === 'applyStatus') walkDef(o.key, o.def);
    }
    for (const n of RIFTHUNTER_TREE.nodes) {
      for (const g of n.gifts) {
        if (g.kind === 'replace-worn') walkDef(g.worn.key, g.worn.def);
        if (g.kind === 'replace-active') {
          expect(parseAbility(JSON.parse(JSON.stringify(g.active)), RULES), `parseAbility(${g.active.name})`).not.toBeNull();
          for (const o of g.active.ops) if (o.op === 'applyStatus') walkDef(o.key, o.def);
        }
      }
    }
  });

  test('all 64 legal fork paths respect kit.scalers <= 2, scalersOf round-trips, zero wasted critFaces/drain, class actives beat consumables, and node descriptions match gifts', () => {
    const forkGroups = [...new Set(RIFTHUNTER_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => RIFTHUNTER_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = RIFTHUNTER_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const cp = classPowers(makeRhHunter(nodes), RULES);
      expect(cp.scalers.length, `fork mask ${mask} exceeded kit.scalers`).toBeLessThanOrEqual(RULES.fight.kit.scalers);
    }

    const maxH = makeRhHunter(FULL_RH_NODES);
    const cp = classPowers(maxH, KEYSTONES_ON);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    expect(cp.scalers.length).toBe(2);
    // Rifthunter carries zero drain/shieldDrain and zero redundant critFaces (ins already approaches cap 6)
    expect(cp.bonus.drain ?? 0).toBe(0);
    expect(cp.bonus.shieldDrain ?? 0).toBe(0);
    expect(cp.bonus.critFaces ?? 0).toBe(0);

    const row = hunterRow(maxH, combatantId('rh-max'), KEYSTONES_ON);
    for (const id of ['rh-rift-bolt', 'rh-rift-tether', 'rh-fourth-verdict']) {
      const ab = row.abilities.find(a => a.id === wornAbilityId(abilityId(id)))!;
      const form = formulaOf(ab, KEYSTONES_ON)!;
      expect(partsOf(form), `${ab.name} exceeds FORMULA_PARTS`).toBeLessThanOrEqual(FORMULA_PARTS);
      expect(scalersOf(form, KEYSTONES_ON)?.scalers.length, `${ab.name} scalersOf`).toBe(2);
    }

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
    const fullBagRow = hunterRow({ ...maxH, items: [...maxH.items, ...bombs] }, combatantId('rh-bag'), KEYSTONES_ON);
    for (const id of ['rh-rift-bolt', 'rh-rift-step', 'rh-rift-tether', 'rh-fourth-verdict']) {
      expect(fullBagRow.abilities.map(a => a.id)).toContain(wornAbilityId(abilityId(id)));
    }
    const bombAb = fullBagRow.abilities.find(a => a.name === 'Bomb 0');
    if (bombAb) {
      const bombForm = formulaOf(bombAb, KEYSTONES_ON);
      expect(bombForm && scalersOf(bombForm, KEYSTONES_ON)).toBeNull();
    }

    for (const n of RIFTHUNTER_TREE.nodes) {
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

describe('Rifthunter combat mechanics and wire round-trip', () => {
  function startDuel(nodes: readonly ClassNodeId[] = [], hpMult = 10): Running {
    const h = makeRhHunter(nodes);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: hpMult }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let f = reduce(null, { type: 'add', fightId: fightId('f-rh'), rows: [{ ...hRow, place: place(2, 3) }, { ...foe, place: place(7, 3) }], openings: [] }, { rules: RULES }).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');
    return f;
  }

  test('sheet, rows, fight-doc, and protocol round-trip Rifthunter worn status at 0 wire bytes', () => {
    const h = makeRhHunter(FULL_RH_NODES);
    const exp = explain(h, 'armorPen', RULES);
    expect(exp.parts.find(p => p.from === 'class')?.amount).toBeGreaterThan(10);

    const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
    expect(hRow.statuses.some(s => s.key === statusKey('rh-cadence-monarch') && s.worn)).toBe(true);
    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-rh-wire'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(6, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    const row = parsed.rows.find(r => r.id === combatantId('h1'))!;
    expect(row.statuses.find(s => s.key === statusKey('rh-cadence-monarch'))?.def).toEqual(classStatusDef('rh-cadence-monarch')!);
  });

  test('Four-Beat Cadence executes an exact 1-2-3-FOUR cycle with guaranteed crit (even on d20=20), Instinct-capped true % max HP burst, and clean reset to 0', () => {
    const boltId = wornAbilityId(abilityId('rh-rift-bolt'));
    const ctx = { rules: RULES };
    // High-HP boss so the Instinct cap (`14 * (ins / 10)^0.8`) is visibly enforced instead of raw uncapped 5% hpMax!
    let f = startDuel([], 25);
    const bossMaxHp = f.rows.find(r => r.id === combatantId('m1'))!.sheet.hpMax;
    const ins = f.rows.find(r => r.id === combatantId('h1'))!.stats.ins;
    const expectedCap = Math.round(14 * (ins / 10) ** 0.8);

    const shoot = (cur: Running) => {
      const r = reduce(cur, {
        type: 'act',
        by: combatantId('h1'),
        ability: boltId,
        aim: combatantId('m1'),
        // Target rolls natural 20 defense d20 every shot! Only the 4th shot's boost face:20 forces a crit.
        rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 20 } },
        force: true,
      }, ctx);
      expect(r.effects.some(e => e.type === 'refused')).toBe(false);
      return { fight: r.fight as Running, effects: r.effects };
    };

    // Shot 1: Cadence 0 -> 1, no crit
    let res = shoot(f);
    f = res.fight;
    expect(res.effects.some(e => e.type === 'crit')).toBe(false);
    expect(f.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('rh-cadence'))?.stacks).toBe(1);

    // Shot 2: Cadence 1 -> 2, no crit
    res = shoot(f);
    f = res.fight;
    expect(res.effects.some(e => e.type === 'crit')).toBe(false);
    expect(f.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('rh-cadence'))?.stacks).toBe(2);

    // Shot 3: Cadence 2 -> 3 -> threshold spends 3 and arms Fourth Chamber + Fourth Echo
    const hpBefore3 = rowHp(f.rows.find(r => r.id === combatantId('m1'))!);
    res = shoot(f);
    f = res.fight;
    const dmgNormal = hpBefore3 - rowHp(f.rows.find(r => r.id === combatantId('m1'))!);
    const rh3 = f.rows.find(r => r.id === combatantId('h1'))!;
    expect(rh3.statuses.some(s => s.key === statusKey('rh-cadence'))).toBe(false);
    expect(rh3.statuses.some(s => s.key === statusKey('rh-fourth-crit'))).toBe(true);
    expect(rh3.statuses.some(s => s.key === statusKey('rh-fourth-echo'))).toBe(true);

    // Shot 4: GUARANTEED CRIT even on natural 20 + Instinct-capped true damage + clean reset to 0!
    const hpBefore4 = rowHp(f.rows.find(r => r.id === combatantId('m1'))!);
    res = shoot(f);
    f = res.fight;
    const dmgFourth = hpBefore4 - rowHp(f.rows.find(r => r.id === combatantId('m1'))!);
    const rh4 = f.rows.find(r => r.id === combatantId('h1'))!;
    expect(res.effects.some(e => e.type === 'crit')).toBe(true);
    expect(dmgFourth).toBeGreaterThan(dmgNormal + Math.round(expectedCap * 0.8));
    // Verify the Instinct cap strictly bounded the proc below uncapped 5% of huge boss HP
    expect(dmgFourth).toBeLessThan(Math.round(dmgNormal * 2.5) + expectedCap + 10);
    expect(Math.round(bossMaxHp * 0.05)).toBeGreaterThan(expectedCap + 50);
    expect(rh4.statuses.some(s => s.key === statusKey('rh-fourth-crit'))).toBe(false);
    expect(rh4.statuses.some(s => s.key === statusKey('rh-fourth-echo'))).toBe(false);
    expect(rh4.statuses.some(s => s.key === statusKey('rh-cadence'))).toBe(false);

    // Shot 5: fresh cycle starts at Cadence = 1
    res = shoot(f);
    f = res.fight;
    expect(f.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('rh-cadence'))?.stacks).toBe(1);
  });

  test('Rift Step blinks to an open tile up to 5 away, spends mana, grants Phase Edge without untargetable, and Rift Tether roots for 1 round', () => {
    const stepId = wornAbilityId(abilityId('rh-rift-step'));
    const tetherId = wornAbilityId(abilityId('rh-rift-tether'));
    const ctx = { rules: RULES };
    let f = startDuel();
    const mana0 = f.rows.find(x => x.id === combatantId('h1'))!.mana;

    // Rift Step blinks from (2,3) -> (0,3), spends 3 mana, grants Phase Edge, NO untargetable ward and NO shield
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: stepId, aim: place(0, 3), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    const rh = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(rh.place).toEqual(place(0, 3));
    expect(rh.mana).toBe(mana0 - 3);
    expect(rh.statuses.some(s => s.key === statusKey('rh-step-edge'))).toBe(true);
    expect(rh.warded ?? []).not.toContain('untargetable');
    expect(rh.shield).toBeNull();

    // Rift Tether hits boss at (7,3) (distance 7 <= 8), spends 4 mana, applies root + exposed + taken amp
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: tetherId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 10 }, second: { [combatantId('m1')]: 12 } }, force: true }, ctx);
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    const boss = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(f.rows.find(x => x.id === combatantId('h1'))!.mana).toBe(mana0 - 7);
    expect(boss.statuses.some(s => s.key === statusKey('rh-tethered'))).toBe(true);
    expect(boss.sheet.stride).toBe(tiles(0));
  });
});
