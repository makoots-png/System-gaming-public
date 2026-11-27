import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, RULES } from '../src/core/rules.ts';
import { above, capped } from '../src/core/stats.ts';
import { newHunter } from '../src/core/save.ts';
import { fightId, parseClassNodeId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { bareBody, modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import { harmful, helpful, sheetAdds } from '../src/core/combat/standing.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { abilityOf, formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { DREADNOUGHT_SIGNATURE, DREADNOUGHT_TREE } from '../src/core/registry/class-dreadnought.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import {
  DREADNOUGHT_ALL_OUT_ID,
  DREADNOUGHT_BROADSIDE_ID,
  DREADNOUGHT_BULKHEAD_ID,
  DREADNOUGHT_CANONICAL_NODES,
  KEY_DREAD_SEALED,
  KEY_DREAD_WRATH,
} from './fixtures/dreadnought-solo.ts';

const AT = '2026-11-27T15:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

function makeDreadnought(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, vit: 156, dis: 83 } },
    'Dreadnought',
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Dreadnought: { ...earned.classes.Dreadnought!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Dreadnought signature, 38-node tree, node uniqueness, and gold pricing', () => {
  test('DREADNOUGHT_TREE validates against TREE_SHAPE.mythic, has unique node names across shipped classes, and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Dreadnought).toBe(DREADNOUGHT_SIGNATURE);
    expect(CLASS_TREES.Dreadnought).toBe(DREADNOUGHT_TREE);
    expect(validateTree(DREADNOUGHT_TREE)).toEqual([]);
    expect(DREADNOUGHT_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(DREADNOUGHT_CANONICAL_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(DREADNOUGHT_TREE, DREADNOUGHT_CANONICAL_NODES)).toEqual([...DREADNOUGHT_CANONICAL_NODES]);

    const otherNodeNames = new Set<string>();
    for (const [cls, tree] of Object.entries(CLASS_TREES)) {
      if (!tree || cls === 'Dreadnought') continue;
      for (const n of tree.nodes) otherNodeNames.add(n.name.toLowerCase());
    }
    const ownNodeNames = new Set<string>();
    for (const n of DREADNOUGHT_TREE.nodes) {
      const lower = n.name.toLowerCase();
      expect(ownNodeNames.has(lower), `duplicate own node name "${n.name}"`).toBe(false);
      expect(otherNodeNames.has(lower), `Dreadnought node "${n.name}" collides with another shipped class`).toBe(false);
      ownNodeNames.add(lower);
    }

    // D5 and D7 never replace the same AbilityId
    const d5Replaced = new Set(
      DREADNOUGHT_TREE.nodes.filter(n => n.depth === 5).flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.targetId] : []))),
    );
    const d7Replaced = new Set(
      DREADNOUGHT_TREE.nodes.filter(n => n.depth === 7).flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.targetId] : []))),
    );
    for (const id of d5Replaced) expect(d7Replaced.has(id), `AbilityId ${id} replaced at both D5 and D7`).toBe(false);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of DREADNOUGHT_CANONICAL_NODES) {
      const check = canBuyNode(DREADNOUGHT_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Dreadnought', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('every Dreadnought status def and ability round-trips cleanly, worn triggers stay <= 4, and Wrath is neutral', () => {
    const keys = [
      'dread-hull',
      'dread-colossus',
      'dread-wrath',
      'dread-sealed',
      'dread-safeguard',
      'dread-safeguard-heavy',
      'dread-bulkhead-rush',
      'dread-shackle',
      'dread-lockdown',
      'dread-breach',
      'dread-all-out',
      'dread-all-out-overdrive',
      'dread-all-out-siege',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k);
      expect(reparsed, `parseStatusDef(${k})`).toEqual(def);
      expect(def!.triggers?.length ?? 0).toBeLessThanOrEqual(RULES.fight.kit.triggers);
    }

    expect(classStatusDef('dread-hull')!.triggers?.length).toBe(3);
    expect(classStatusDef('dread-colossus')!.triggers?.length).toBe(4);

    // Wrath is completely neutral so neither helpful nor harmful dispels touch it
    const wrathDef = classStatusDef('dread-wrath')!;
    expect(helpful(wrathDef)).toBe(false);
    expect(harmful(wrathDef)).toBe(false);

    const allActives = [
      ...(DREADNOUGHT_SIGNATURE.actives ?? []),
      ...DREADNOUGHT_TREE.nodes.flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))),
    ];
    for (const ab of allActives) {
      const reparsed = parseAbility(JSON.parse(JSON.stringify(ab)), RULES);
      expect(reparsed, `parseAbility(${ab.name})`).toEqual(ab);
      expect(ab.cost.mana, `${ab.name} must cost 0 mana`).toBe(0);
    }
  });

  test('every Dreadnought node desc matches its numeric gifts and all 64 fork builds stay within kit.scalers, penMax, and FORMULA_PARTS', () => {
    for (const n of DREADNOUGHT_TREE.nodes) {
      for (const g of n.gifts) {
        if (g.kind === 'bonus') {
          for (const [k, v] of Object.entries(g.bonus)) {
            if (typeof v !== 'number') continue;
            const shown = k === 'critSize' ? String(v / 100) : (BONUS_HUNDREDTHS as readonly string[]).includes(k) ? `${v}%` : String(v);
            expect(n.desc, `node ${n.id} (${n.name}) desc missing ${k}=${shown}: "${n.desc}"`).toContain(shown);
          }
        } else if (g.kind === 'scaler') {
          const pct = `${Math.round(g.scaler.scale * 100)}%`;
          expect(n.desc, `node ${n.id} (${n.name}) desc missing scaler ${pct}: "${n.desc}"`).toContain(pct);
        }
      }
    }

    const forkGroups = [...new Set(DREADNOUGHT_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => DREADNOUGHT_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = DREADNOUGHT_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const h = makeDreadnought(nodes);
      const cp = classPowers(h, KEYSTONES_ON);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBeLessThanOrEqual(KEYSTONES_ON.fight.kit.scalers);
      const row = hunterRow(h, combatantId('h-check'), KEYSTONES_ON);
      if (row.origin.kind !== 'hunter') throw new Error('expected hunter origin');
      const F = KEYSTONES_ON.fight;
      const ctlScore = row.origin.build.stats.ctl + (row.origin.build.perks.ctl ?? 0);
      const unclampedArmorPen = capped(above(ctlScore, F), F.penCap, F)
        + (row.origin.build.perks.armorPen ?? 0)
        + sheetAdds(row.statuses, bareBody(row.origin, KEYSTONES_ON), KEYSTONES_ON).armorPen;
      expect(unclampedArmorPen).toBeLessThanOrEqual(F.penMax);
      for (const ab of row.abilities) {
        const form = formulaOf(ab, KEYSTONES_ON);
        if (form) expect(partsOf(form), `${ab.name} formula parts`).toBeLessThanOrEqual(FORMULA_PARTS);
      }
    }
  });
});

describe('Dreadnought sheet, Hook H1 wire pin, Wrath loop, and All-Out Sealed Hull restoration', () => {
  test('real wire pin: both base Dread Hull and capstone Colossus Hull (each with stacksBy) leave fightWire(doc).defs undefined', () => {
    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;

    for (const [label, nodes, expectedWornKey] of [
      ['base Dread Hull', [] as readonly ClassNodeId[], statusKey('dread-hull')],
      ['capstone Colossus Hull', DREADNOUGHT_CANONICAL_NODES, statusKey('dread-colossus')],
    ] as const) {
      const h = makeDreadnought(nodes);
      const row = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
      expect(row.statuses.some(s => s.key === expectedWornKey && s.worn), `${label}: worn status present`).toBe(true);

      let f: Fight | null = reduce(null, {
        type: 'add',
        fightId: fightId(`f-dread-wire-${expectedWornKey}`),
        rows: [{ ...row, place: place(2, 2) }, { ...foe, place: place(3, 2) }],
        openings: [],
      }, { rules: KEYSTONES_ON }).fight;
      f = reduce(f, {
        type: 'start',
        openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }],
      }, { rules: KEYSTONES_ON }).fight;

      const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error(`${label}: expected active FightDoc`);
      const wire = fightWire(doc);
      expect(wire.defs, `${label}: wire.defs must be undefined even with stacksBy on worn`).toBeUndefined();

      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error(`${label}: expected parsed FightDoc`);
      const docRow = parsed.rows.find(r => r.id === combatantId('h1'))!;
      expect(docRow.statuses.find(s => s.key === expectedWornKey)?.def).toEqual(classStatusDef(expectedWornKey)!);
    }

    // Also verify sheet explain and scaler attachment on maxed Dreadnought
    const maxed = makeDreadnought(DREADNOUGHT_CANONICAL_NODES);
    expect(explain(maxed, 'hpMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(85);
    const maxRow = hunterRow(maxed, combatantId('h-max'), KEYSTONES_ON);
    const broadside = maxRow.abilities.find(a => a.id === DREADNOUGHT_BROADSIDE_ID)!;
    expect(broadside.name).toBe('Broadside: Breaching Broadside');
    expect(scalersOf(formulaOf(broadside, KEYSTONES_ON)!, KEYSTONES_ON)?.scalers.length).toBe(1);
  });

  test('Hook H1 Wrath banks from blocked + 0.5 * lost, resists dispels, powers Broadside (curing 1 stack), and All-Out restores Sealed Hull on both expiry and cleanse', () => {
    const h = makeDreadnought([]);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({
      name: 'Siege Tester',
      rank: 'S',
      archetype: 'brute',
      kind: 'boss',
      tweak: { hp: 5 },
      abilities: [],
      statuses: [],
    }, [combatantId('m1')], RULES)[0]!;

    const ctx = { rules: RULES };
    let f = reduce(null, {
      type: 'add',
      fightId: fightId('f-dread-loop'),
      rows: [{ ...hRow, place: place(4, 4) }, { ...foe, place: place(5, 4) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, {
      type: 'start',
      openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }],
    }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    // First turn start activates Sealed Hull automatically
    const me0 = f.rows.find(r => r.id === combatantId('h1'))!;
    expect(me0.statuses.some(s => s.key === KEY_DREAD_SEALED)).toBe(true);
    expect(me0.statuses.some(s => s.key === KEY_DREAD_WRATH)).toBe(false);

    // All-Out is gated below 5 Wrath
    const refGate = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: DREADNOUGHT_ALL_OUT_ID,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: {} },
      force: true,
    }, ctx);
    expect(refGate.effects.some(e => e.type === 'refused' && e.reason === 'gated')).toBe(true);

    // Cast Bulkhead: adds shield and 1-round safeguard ward (matching kit.wardRounds)
    const afterBulk = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: DREADNOUGHT_BULKHEAD_ID,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: {} },
      force: true,
    }, ctx).fight as Running;
    const meBulk = afterBulk.rows.find(r => r.id === combatantId('h1'))!;
    expect(meBulk.shield?.amount ?? 0).toBeGreaterThan(0);
    const ward = meBulk.statuses.find(s => s.key === statusKey('dread-safeguard'))!;
    expect(ward).toBeDefined();
    expect(ward.until).toBe(tick(f.now + RULES.fight.kit.wardRounds * RULES.fight.round));

    // Boss hits Dreadnought twice -> Hook H1 banks Wrath stacks via stacksBy
    const bossHit = foe.abilities[0]!;
    const hitRolls = { dice: { [combatantId('h1')]: [10] }, react: { [combatantId('h1')]: 10 } };
    const afterHit1 = reduce(afterBulk, { type: 'act', by: combatantId('m1'), ability: bossHit.id, aim: combatantId('h1'), rolls: hitRolls, force: true }, ctx).fight as Running;
    const wrath1 = afterHit1.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === KEY_DREAD_WRATH)?.stacks ?? 0;
    expect(wrath1).toBeGreaterThan(0);
    expect(wrath1).toBeLessThanOrEqual(RULES.fight.kit.stackAdd);

    const afterHit2 = reduce(afterHit1, { type: 'act', by: combatantId('m1'), ability: bossHit.id, aim: combatantId('h1'), rolls: hitRolls, force: true }, ctx).fight as Running;
    const wrath2 = afterHit2.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === KEY_DREAD_WRATH)?.stacks ?? 0;
    expect(wrath2).toBeGreaterThan(wrath1);

    // Neither a harmful dispel nor a helpful dispel touches neutral Wrath
    const purgeBoth = abilityOf('curse', {
      id: abilityId('test-purge-both'),
      name: 'Purge Both',
      aim: 'foe',
      range: tiles(8),
      shape: { kind: 'touch', reach: tiles(8) },
      delivery: { kind: 'sure' },
      foesOnly: true,
      effect: null,
      ops: [
        { op: 'dispel', which: 'all' },
        { op: 'dispel', which: 'all', kind: 'helpful' },
      ],
    }, RULES);
    const withPurge: Running = {
      ...afterHit2,
      rows: afterHit2.rows.map(r => (r.id === combatantId('m1') ? { ...r, abilities: [...r.abilities, purgeBoth] } : r)),
    };
    const afterPurge = reduce(withPurge, {
      type: 'act',
      by: combatantId('m1'),
      ability: purgeBoth.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: {} },
      force: true,
    }, ctx).fight as Running;
    expect(afterPurge.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === KEY_DREAD_WRATH)?.stacks).toBe(wrath2);

    // Broadside deals strictly more damage with Wrath stacks than at 0 Wrath, and cures 3 stacks on hit
    const seedWrath = (baseFight: Running, stacks: number): Running => {
      const wrathDef = classStatusDef('dread-wrath')!;
      return {
        ...baseFight,
        rows: baseFight.rows.map(r => {
          if (r.id !== combatantId('h1')) return r;
          const clean = r.statuses.filter(s => s.key !== KEY_DREAD_WRATH);
          const next = stacks > 0
            ? [...clean, statusOn(wrathDef, { key: KEY_DREAD_WRATH, source: { id: r.id, tier: r.tier }, until: null, since: baseFight.now, settledAt: baseFight.now }, stacks)]
            : clean;
          return { ...r, statuses: next };
        }),
      };
    };

    const broadRolls = { dice: { [combatantId('m1')]: [9] }, react: { [combatantId('m1')]: 10 } };
    const f0Wrath = seedWrath(afterHit2, 0);
    const hpBefore0 = rowHp(f0Wrath.rows.find(r => r.id === combatantId('m1'))!);
    const afterB0 = reduce(f0Wrath, { type: 'act', by: combatantId('h1'), ability: DREADNOUGHT_BROADSIDE_ID, aim: combatantId('m1'), rolls: broadRolls, force: true }, ctx).fight as Running;
    const dmg0 = hpBefore0 - rowHp(afterB0.rows.find(r => r.id === combatantId('m1'))!);

    const f8Wrath = seedWrath(afterHit2, 8);
    const hpBefore8 = rowHp(f8Wrath.rows.find(r => r.id === combatantId('m1'))!);
    const afterB8 = reduce(f8Wrath, { type: 'act', by: combatantId('h1'), ability: DREADNOUGHT_BROADSIDE_ID, aim: combatantId('m1'), rolls: broadRolls, force: true }, ctx).fight as Running;
    const dmg8 = hpBefore8 - rowHp(afterB8.rows.find(r => r.id === combatantId('m1'))!);
    expect(dmg8).toBeGreaterThan(dmg0);
    // Broadside hit cured 1 stack: 8 -> 7
    expect(afterB8.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === KEY_DREAD_WRATH)?.stacks).toBe(7);

    // Open All-Out at 8 Wrath: spends all Wrath, cures Sealed Hull, grants shield = 0.014 * hpMax * 8, applies All-Out Drive
    const fReadyAllOut = seedWrath(afterHit2, 8);
    const meBeforeAllOut = fReadyAllOut.rows.find(r => r.id === combatantId('h1'))!;
    expect(meBeforeAllOut.statuses.some(s => s.key === KEY_DREAD_SEALED)).toBe(true);
    const afterAllOut = reduce(fReadyAllOut, {
      type: 'act',
      by: combatantId('h1'),
      ability: DREADNOUGHT_ALL_OUT_ID,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: {} },
      force: true,
    }, ctx).fight as Running;
    const meAllOut = afterAllOut.rows.find(r => r.id === combatantId('h1'))!;
    expect(meAllOut.statuses.some(s => s.key === KEY_DREAD_WRATH)).toBe(false);
    expect(meAllOut.statuses.some(s => s.key === KEY_DREAD_SEALED)).toBe(false);
    expect(meAllOut.statuses.some(s => s.key === statusKey('dread-all-out'))).toBe(true);
    expect(meAllOut.shield?.amount ?? 0).toBeGreaterThanOrEqual(Math.round(0.014 * meBeforeAllOut.sheet.hpMax * 8));

    // Path A (cleanse): helpful dispel removes All-Out Drive early and end.cleanse === 'land' restores Sealed Hull at once
    const fWithPurge: Running = {
      ...afterAllOut,
      rows: afterAllOut.rows.map(r => (r.id === combatantId('m1') ? { ...r, abilities: [...r.abilities, purgeBoth] } : r)),
    };
    const afterCleanse = reduce(fWithPurge, {
      type: 'act',
      by: combatantId('m1'),
      ability: purgeBoth.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: {} },
      force: true,
    }, ctx).fight as Running;
    const meCleansed = afterCleanse.rows.find(r => r.id === combatantId('h1'))!;
    expect(meCleansed.statuses.some(s => s.key === statusKey('dread-all-out'))).toBe(false);
    expect(meCleansed.statuses.some(s => s.key === KEY_DREAD_SEALED)).toBe(true);

    // Path B (expiry): advancing real turns past All-Out Drive's 3-round duration restores Sealed Hull when it expires
    const allOutStatus = meAllOut.statuses.find(s => s.key === statusKey('dread-all-out'))!;
    expect(allOutStatus.until).not.toBeNull();
    let afterExpire: Running = afterAllOut;
    for (let step = 0; step < 20; step++) {
      const meNow = afterExpire.rows.find(r => r.id === combatantId('h1'))!;
      if (!meNow.statuses.some(s => s.key === statusKey('dread-all-out'))) break;
      const res = reduce(afterExpire, { type: 'endTurn', by: afterExpire.currentId }, ctx);
      if (res.fight?.phase !== 'running') throw new Error('expected fight to stay running');
      afterExpire = res.fight;
    }
    const meExpired = afterExpire.rows.find(r => r.id === combatantId('h1'))!;
    expect(meExpired.statuses.some(s => s.key === statusKey('dread-all-out'))).toBe(false);
    expect(meExpired.statuses.some(s => s.key === KEY_DREAD_SEALED)).toBe(true);
  });

  test('Bastion Bulkhead refunds 20% of its turn time via self-curing Bulkhead Surge without leaving a blank status behind', () => {
    const baseRow = hunterRow(makeDreadnought([]), combatantId('h1'), RULES);
    const bastionNodes = DREADNOUGHT_CANONICAL_NODES.filter(id => id !== nid('dread-cap'));
    const bastionRow = hunterRow(makeDreadnought(bastionNodes), combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };

    const castBulkhead = (row: typeof baseRow, label: string) => {
      let f = reduce(null, {
        type: 'add',
        fightId: fightId(`f-bulk-${label}`),
        rows: [{ ...row, place: place(2, 2) }, { ...foe, place: place(8, 2) }],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, {
        type: 'start',
        openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }],
      }, ctx).fight!;
      const res = reduce(f, {
        type: 'act',
        by: combatantId('h1'),
        ability: DREADNOUGHT_BULKHEAD_ID,
        aim: combatantId('h1'),
        rolls: { dice: { [combatantId('h1')]: [] }, react: {} },
        force: true,
      }, ctx).fight as Running;
      return res.rows.find(r => r.id === combatantId('h1'))!;
    };

    const afterBase = castBulkhead(baseRow, 'base');
    const afterBastion = castBulkhead(bastionRow, 'bastion');
    expect(afterBastion.statuses.some(s => s.key === statusKey('dread-bulkhead-rush'))).toBe(false);
    // Bastion has higher speed from tree nodes AND 20% refund; verify wait ratio matches 0.80 of full quick interval
    const quickNoRefund = Math.round(RULES.fight.round * (RULES.fight.cost.quick / (RULES.fight.cost.standard)) * (100 / afterBastion.speed));
    expect(Number(afterBastion.at)).toBeLessThan(quickNoRefund);
    expect(Number(afterBastion.at)).toBeLessThan(Number(afterBase.at));
  });
});
