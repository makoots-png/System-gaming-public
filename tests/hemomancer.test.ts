import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { fightId, parseClassNodeId, parseSaveId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, ItemId } from '../src/core/ids.ts';
import { BONUS_HUNDREDTHS } from '../src/core/rules.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { combatantId, abilityId } from '../src/core/combat/ability-types.ts';
import type { CombatantId } from '../src/core/combat/ability-types.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { landEnd, landOps } from '../src/core/combat/land.ts';
import { resolve } from '../src/core/combat/resolve.ts';
import { fire, raised } from '../src/core/combat/triggers.ts';
import { MAX_STATUSES, reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { abilityOf, formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { choose, EVERYTHING, fightBodies, mapScene, NO_CHOICE } from '../src/core/combat/map-view.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { HEMOMANCER_SIGNATURE, HEMOMANCER_TREE } from '../src/core/registry/class-hemomancer.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev, skid } from './fixtures/ids.ts';

const AT = '2026-11-25T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

const CANONICAL_HEMO_FORKS = ['hemo-a5-l', 'hemo-b5-l', 'hemo-c5-l', 'hemo-a7-l', 'hemo-b7-l', 'hemo-c7-l'];
const FULL_HEMO_NODES: readonly ClassNodeId[] = HEMOMANCER_TREE.nodes
  .filter(n => !n.forkGroup || CANONICAL_HEMO_FORKS.includes(n.id))
  .map(n => n.id);

function makeHemoHunter(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass({ ...base, rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, pow: 156, vit: 83 } }, 'Hemomancer', { at: AT, R: RULES });
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Hemomancer: { ...earned.classes.Hemomancer!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Hemomancer signature, 38-node tree, and gold pricing', () => {
  test('HEMOMANCER_TREE validates against TREE_SHAPE.mythic and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Hemomancer).toBe(HEMOMANCER_SIGNATURE);
    expect(CLASS_TREES.Hemomancer).toBe(HEMOMANCER_TREE);
    expect(validateTree(HEMOMANCER_TREE)).toEqual([]);
    expect(HEMOMANCER_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(FULL_HEMO_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(HEMOMANCER_TREE, FULL_HEMO_NODES)).toEqual([...FULL_HEMO_NODES]);

    // Step-by-step purchase legality + exact S-rank gold sum via nodeCost
    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of FULL_HEMO_NODES) {
      const check = canBuyNode(HEMOMANCER_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Hemomancer', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('every Hemomancer status def round-trips cleanly through parseStatusDef and classStatusDef', () => {
    const keys = [
      'hemo-crimson-pact',
      'hemo-crimson-pact-lord',
      'hemo-crimson-rush',
      'hemo-crimson-frenzy',
      'hemo-pool-ward',
      'hemo-pool-tide',
      'hemo-pool-tide-ii',
      'hemo-pool-slow',
      'hemo-tides-slow',
      'hemo-hemoplague',
      'hemo-hemoplague-ii',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES);
      expect(reparsed, `parseStatusDef(${k})`).not.toBeNull();
    }
  });
});

describe('combat/sheet wiring for classPowers and classStatusDef', () => {
  test('sheet.ts folds class bonuses into hunterSheet and reports them under the class source in explain', () => {
    const plain = newHunter(RULES);
    const bare = makeHemoHunter([]);
    const maxed = makeHemoHunter(FULL_HEMO_NODES);

    const bareSheet = hunterSheet(bare, RULES).sheet;
    const maxedSheet = hunterSheet(maxed, RULES).sheet;
    expect(bareSheet.drain).toBeCloseTo(0.10, 5);
    expect(Number(bareSheet.shieldDrain)).toBeCloseTo(0.04, 5);
    expect(maxedSheet.drain).toBeGreaterThan(bareSheet.drain + 0.15);

    const exp = explain(bare, 'drain', RULES);
    const clsPart = exp.parts.find(p => p.from === 'class');
    expect(clsPart?.amount).toBeCloseTo(0.10, 5);
    expect(explain(plain, 'drain', RULES).parts.find(p => p.from === 'class')?.amount).toBe(0);

    // Out-of-combat hunterSheet includes Crimson Pact worn conversions so hpMax and mag match combat
    const bareRow = hunterRow(bare, combatantId('h-sheet'), RULES);
    const combatBare = modified(bareRow.origin, bareRow.statuses, RULES).sheet;
    expect(bareSheet.hpMax).toBe(combatBare.hpMax);
    expect(bareSheet.mag).toBeCloseTo(combatBare.mag, 4);
    expect(explain(bare, 'hpMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThan(0);
    expect(explain(bare, 'mag', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThan(0);
  });

  test('rows.ts loads Hemomancer worn status (with Crimson Pact bare-sheet conversion), 4 class actives, and scalersOf-readable tree scalers', () => {
    const baseH = makeHemoHunter([]);
    const baseRow = hunterRow(baseH, combatantId('h1'), KEYSTONES_ON);
    expect(baseRow.statuses.some(s => s.key === statusKey('hemo-crimson-pact') && s.worn)).toBe(true);
    const baseIds = baseRow.abilities.map(a => a.id);
    for (const id of ['hemo-transfusion', 'hemo-sanguine-pool', 'hemo-tides-of-blood', 'hemo-hemoplague']) {
      expect(baseIds).toContain(wornAbilityId(abilityId(id)));
    }

    // Verify Crimson Pact bare-sheet conversion raises both mag and hpMax in one pass without looping
    const bareOrigin = baseRow.origin;
    const withoutPact = modified(bareOrigin, [], KEYSTONES_ON).sheet;
    const withPact = modified(bareOrigin, baseRow.statuses, KEYSTONES_ON).sheet;
    expect(withPact.mag).toBeGreaterThan(withoutPact.mag);
    expect(withPact.hpMax).toBeGreaterThan(withoutPact.hpMax);
    const expectedMag = withoutPact.mag + 0.04 * withoutPact.hpMax + 0.4 * withoutPact.drain * withoutPact.mag;
    const expectedHp = Math.round(withoutPact.hpMax + 0.3 * withoutPact.mag);
    expect(withPact.mag).toBeCloseTo(expectedMag, 2);
    expect(withPact.hpMax).toBe(expectedHp);

    // Full tree swaps worn to Lord of Blood, upgrades actives, respects kit.scalers <= 2, and round-trips scalersOf within FORMULA_PARTS
    const maxH = makeHemoHunter(FULL_HEMO_NODES);
    const cp = classPowers(maxH, KEYSTONES_ON);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    expect(cp.scalers.length).toBe(2);
    expect(cp.scalers.length).toBeLessThanOrEqual(KEYSTONES_ON.fight.kit.scalers);
    expect(cp.worn?.key).toBe(statusKey('hemo-crimson-pact-lord'));
    const maxRow = hunterRow(maxH, combatantId('h2'), KEYSTONES_ON);
    expect(maxRow.statuses.some(s => s.key === statusKey('hemo-crimson-pact-lord') && s.worn)).toBe(true);
    const trans = maxRow.abilities.find(a => a.id === wornAbilityId(abilityId('hemo-transfusion')))!;
    const tides = maxRow.abilities.find(a => a.id === wornAbilityId(abilityId('hemo-tides-of-blood')))!;
    expect(trans.name).toBe('Transfusion: Exsanguinate');
    for (const ab of [trans, tides]) {
      const form = formulaOf(ab, KEYSTONES_ON)!;
      expect(partsOf(form)).toBeLessThanOrEqual(FORMULA_PARTS);
      expect(scalersOf(form, KEYSTONES_ON)?.scalers.length).toBe(2);
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
    }));
    const fullBagRow = hunterRow({ ...maxH, items: [...maxH.items, ...bombs] }, combatantId('h-bag'), KEYSTONES_ON);
    for (const id of ['hemo-transfusion', 'hemo-sanguine-pool', 'hemo-tides-of-blood', 'hemo-hemoplague']) {
      expect(fullBagRow.abilities.map(a => a.id)).toContain(wornAbilityId(abilityId(id)));
    }
    const bombAb = fullBagRow.abilities.find(a => a.name === 'Bomb 0');
    if (bombAb) {
      const bombForm = formulaOf(bombAb, KEYSTONES_ON);
      expect(bombForm && scalersOf(bombForm, KEYSTONES_ON)).toBeNull();
    }
  });

  test('fight-doc.ts and protocol.ts round-trip Hemomancer worn statuses at 0 bytes in wire.defs', () => {
    const h = makeHemoHunter(FULL_HEMO_NODES);
    const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-hemo'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    // Shipped keystone + class worn statuses omit wire.defs completely
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    const row = parsed.rows.find(r => r.id === combatantId('h1'))!;
    const lord = row.statuses.find(s => s.key === statusKey('hemo-crimson-pact-lord'));
    expect(lord?.def).toEqual(classStatusDef('hemo-crimson-pact-lord')!);
  });
});

describe('Hemomancer combat mechanics', () => {
  function startDuel(nodes: readonly ClassNodeId[] = []): Running {
    const h = makeHemoHunter(nodes);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let f = reduce(null, { type: 'add', fightId: fightId('f-mech'), rows: [{ ...hRow, place: place(3, 3) }, { ...foe, place: place(4, 3) }], openings: [] }, { rules: RULES }).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');
    return f;
  }

  test('Transfusion builds Crimson Rush (0 -> 1 -> Frenzy) without premature cure and empowers the next Transfusion', () => {
    const transId = wornAbilityId(abilityId('hemo-transfusion'));
    const ctx = { rules: RULES };
    let f = startDuel([nid('hemo-root'), nid('hemo-a2'), nid('hemo-a3x'), nid('hemo-a3y'), nid('hemo-a4x'), nid('hemo-a4y'), nid('hemo-a5-l')]);

    // Hurt hunter slightly so we can observe healing
    const castTrans = (cur: Running) => {
      const r = reduce(cur, {
        type: 'act',
        by: combatantId('h1'),
        ability: transId,
        aim: combatantId('m1'),
        rolls: { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 5 } },
        force: true,
      }, ctx);
      expect(r.effects.some(e => e.type === 'refused')).toBe(false);
      return r.fight as Running;
    };

    // Cast 1 (round 0): Rush 0 -> 1, no Frenzy yet
    f = castTrans(f);
    let h = f.rows.find(r => r.id === combatantId('h1'))!;
    expect(h.statuses.find(s => s.key === statusKey('hemo-crimson-rush'))?.stacks).toBe(1);
    expect(h.statuses.some(s => s.key === statusKey('hemo-crimson-frenzy'))).toBe(false);

    // Advance fight time past 1 round (so once-per-round Crimson Rush can fire again and 1-round CD clears)
    f = { ...f, now: tick(1200) };
    const foeHpBeforeCast2 = rowHp(f.rows.find(r => r.id === combatantId('m1'))!);

    // Cast 2 (round 1): Rush 1 -> 2 -> threshold spends Rush and grants Frenzy (NOT cured on this cast!)
    f = castTrans(f);
    const dmgNormal = foeHpBeforeCast2 - rowHp(f.rows.find(r => r.id === combatantId('m1'))!);
    h = f.rows.find(r => r.id === combatantId('h1'))!;
    expect(h.statuses.some(s => s.key === statusKey('hemo-crimson-rush'))).toBe(false);
    expect(h.statuses.some(s => s.key === statusKey('hemo-crimson-frenzy'))).toBe(true);

    // Advance to round 2: Cast 3 consumes Frenzy and deals ~1.85x damage (upgraded Exsanguinate)
    f = { ...f, now: tick(2400) };
    const foeHpBeforeCast3 = rowHp(f.rows.find(r => r.id === combatantId('m1'))!);
    f = castTrans(f);
    const dmgEmpowered = foeHpBeforeCast3 - rowHp(f.rows.find(r => r.id === combatantId('m1'))!);
    h = f.rows.find(r => r.id === combatantId('h1'))!;
    expect(dmgEmpowered).toBeGreaterThan(Math.round(dmgNormal * 1.7));
    expect(h.statuses.some(s => s.key === statusKey('hemo-crimson-frenzy'))).toBe(false);
    expect(h.statuses.find(s => s.key === statusKey('hemo-crimson-rush'))?.stacks).toBe(1);
  });

  test('Sanguine Pool applies untargetable + tide + aura on cast 1, and still applies tide + aura on cast 2 after ward is spent', () => {
    const poolId = wornAbilityId(abilityId('hemo-sanguine-pool'));
    const ctx = { rules: RULES };
    let f = startDuel();
    const foeHp0 = rowHp(f.rows.find(r => r.id === combatantId('m1'))!);

    // Cast 1: pays 20% HP, gains untargetable ward + Sanguine Tide + moving aura zone, damages & slows adjacent foe
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: poolId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    let h = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(h.statuses.some(s => s.key === statusKey('hemo-pool-ward'))).toBe(true);
    expect(h.statuses.some(s => s.key === statusKey('hemo-pool-tide'))).toBe(true);
    expect(h.warded).toContain('untargetable');
    expect(f.zones.some(z => z.name === 'Sanguine Pool')).toBe(true);
    expect(rowHp(f.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(foeHp0);

    // Cast 2 (after cooldown): untargetable ward stays spent (no invincibility leak), but Sanguine Tide + zone + aura damage still land!
    f = { ...f, now: tick(6000), rows: f.rows.map(b => (b.id === combatantId('h1') ? { ...b, statuses: b.statuses.filter(s => s.key !== statusKey('hemo-pool-ward') && s.key !== statusKey('hemo-pool-tide')) } : b)) };
    const foeHp1 = rowHp(f.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(f, { type: 'act', by: combatantId('h1'), ability: poolId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.some(e => e.type === 'refused')).toBe(false);
    f = r.fight as Running;
    h = f.rows.find(x => x.id === combatantId('h1'))!;
    expect(h.statuses.some(s => s.key === statusKey('hemo-pool-ward'))).toBe(false);
    expect(h.statuses.some(s => s.key === statusKey('hemo-pool-tide'))).toBe(true);
    expect(rowHp(f.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(foeHp1);
  });

  test('End.sourceHealShare heals the living caster for 40% of Hemoplague pop damage, respects Grievous Wounds, and skips dead casters', () => {
    const f = startDuel();
    const h = f.rows.find(r => r.id === combatantId('h1'))!;
    const m = f.rows.find(r => r.id === combatantId('m1'))!;
    const plagueDef = classStatusDef('hemo-hemoplague')!;
    const plagueStatus = statusOn(plagueDef, { key: statusKey('hemo-hemoplague'), source: { id: h.id, tier: h.tier }, until: tick(2000), since: tick(0), settledAt: tick(0) });

    // Living hurt caster heals 40% of pop dealt
    const hurtH = { ...h, life: { at: 'up' as const, hp: 100 } };
    const rows = new Map([[h.id, hurtH], [m.id, m]]);
    const res = landEnd(rows, m.id, plagueStatus, tick(2000), RULES);
    expect(res.dealt).toBeGreaterThan(50);
    expect(rowHp(rows.get(h.id)!)).toBe(Math.min(hurtH.sheet.hpMax, 100 + Math.round(res.dealt * 0.4)));

    // Grievous Wounds on caster cuts the source heal
    const gw = statusOn(BUILT_IN_STATUSES.grievous, { key: statusKey('grievous'), source: { id: m.id, tier: 5 }, until: tick(5000), since: tick(0), settledAt: tick(0) });
    const gwH = { ...hurtH, statuses: [...hurtH.statuses, gw] };
    const rowsGw = new Map([[h.id, gwH], [m.id, m]]);
    const resGw = landEnd(rowsGw, m.id, plagueStatus, tick(2000), RULES);
    expect(rowHp(rowsGw.get(h.id)!)).toBe(100 + Math.round(resGw.dealt * 0.4 * 0.6));

    // Dead caster is never revived by end pop
    const deadH = { ...h, life: { at: 'dead' as const } };
    const rowsDead = new Map([[h.id, deadH], [m.id, m]]);
    const resDead = landEnd(rowsDead, m.id, plagueStatus, tick(2000), RULES);
    expect(rowsDead.get(h.id)!.life.at).toBe('dead');
    expect(resDead.sourceHealed).toBeUndefined();

    // Living caster detonation logs the source heal in fight-turn.ts when the victim's turn arrives at expiry
    expect(res.sourceHealed).toBe(Math.round(res.dealt * 0.4));
    const plagueApplied = {
      ...f,
      rows: f.rows.map(r => (r.id === h.id
        ? { ...r, at: tick(1500), life: { at: 'up' as const, hp: 100 } }
        : { ...r, at: tick(2000), statuses: [...r.statuses, plagueStatus] })),
      now: tick(1500),
      currentId: h.id,
    };
    const afterPass = reduce(plagueApplied, { type: 'endTurn', by: h.id }, { rules: RULES });
    const logTexts = (afterPass.fight as Running).log.map(l => l.text).join('\n');
    expect(logTexts).toContain(`heals ${res.sourceHealed}`);
  });

  test('cure/dispel detonation carries sourceHealed and source id in resolve bursts, fight log, landOps Landed, and trigger logs', () => {
    const f = startDuel();
    const h = f.rows.find(r => r.id === combatantId('h1'))!;
    const m = f.rows.find(r => r.id === combatantId('m1'))!;
    const plagueDef = classStatusDef('hemo-hemoplague')!;
    const detonateDef = { ...plagueDef, end: { ...plagueDef.end!, cleanse: 'land' as const } };
    const plagueStatus = statusOn(detonateDef, { key: statusKey('hemo-hemoplague'), source: { id: h.id, tier: h.tier }, until: tick(2000), since: tick(0), settledAt: tick(0) });
    const purge = abilityOf('support', { id: abilityId('test-purge'), name: 'Purge', effect: null, ops: [{ op: 'dispel', which: 'all' }] }, RULES);

    // 1. resolve.ts:681 carries sourceHealed + source id in burst.landed
    const hurtH = { ...h, life: { at: 'up' as const, hp: 100 } };
    const plaguedM = { ...m, statuses: [...m.statuses, plagueStatus], abilities: [...m.abilities, purge] };
    const resolved = resolve(purge, plaguedM, [hurtH, plaguedM], plaguedM.id, f.grid, { dice: {}, react: {} }, tick(500), RULES);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.bursts.length).toBe(1);
    const [victimEntry, healEntry] = resolved.bursts[0]!.landed;
    const expectedHeal = Math.round(victimEntry!.dealt * 0.4);
    expect(victimEntry!.target).toBe(m.id);
    expect(victimEntry!.dealt).toBeGreaterThan(50);
    expect(healEntry).toEqual({ target: h.id, dealt: 0, healed: expectedHeal });
    expect(rowHp(resolved.bodies.find(b => b.id === h.id)!)).toBe(100 + expectedHeal);

    // 2. fight.ts logs the detonation heal line and tags caster in `rows`, matching fight-turn.ts:482
    const fighting: Running = { ...f, rows: [hurtH, plaguedM], currentId: m.id, now: tick(500) };
    const acted = reduce(fighting, { type: 'act', by: m.id, ability: purge.id, aim: m.id, rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    const purgeLog = (acted.fight as Running).log.find(l => l.text.includes('Purge'))!;
    expect(purgeLog).toBeDefined();
    expect(purgeLog.text).toContain(`${h.name} heals ${expectedHeal}`);
    expect(purgeLog.rows).toContain(h.id);

    // 3. Dead caster on dispel detonation adds no heal entry and no "heals" text
    const deadH = { ...h, life: { at: 'dead' as const } };
    const resolvedDead = resolve(purge, plaguedM, [deadH, plaguedM], plaguedM.id, f.grid, { dice: {}, react: {} }, tick(500), RULES);
    expect(resolvedDead.ok).toBe(true);
    if (resolvedDead.ok) expect(resolvedDead.bursts[0]!.landed).toEqual([{ target: m.id, dealt: victimEntry!.dealt }]);

    // 4. land.ts:288 (`landOps`) carries sourceHealed + source id in `Landed`, and triggers.ts logs it
    const rows = new Map<CombatantId, Body>([[h.id, hurtH], [m.id, plaguedM]]);
    const land = landOps(rows, [{ op: 'dispel', which: 'all' }], plaguedM, [m.id], { id: m.id, tier: m.tier }, tick(500), RULES);
    expect(land.landed).toContainEqual({ target: h.id, dealt: 0, healed: expectedHeal, down: false, gained: [], cured: [] });
    expect(rowHp(rows.get(h.id)!)).toBe(100 + expectedHeal);

    const cleanseTrig = statusOn({
      label: 'Self Purge', desc: '', ops: [],
      triggers: [{ on: 'turnStart', to: 'self', limit: { kind: 'each' }, ops: [{ op: 'dispel', which: 'all' }] }],
    }, { key: statusKey('self-purge'), source: { id: m.id, tier: m.tier }, until: null, since: tick(0), settledAt: tick(0) });
    const trigOut = fire([hurtH, { ...plaguedM, statuses: [...plaguedM.statuses, cleanseTrig] }], [raised(m.id, 'turnStart')], tick(500), RULES);
    expect(trigOut.said.join('\n')).toContain(`${h.name} heals ${expectedHeal}`);
    expect(trigOut.about).toContain(h.id);
  });

  test('wornStatuses places class worn status first so MAX_STATUSES never slices it off', () => {
    const base = makeHemoHunter(FULL_HEMO_NODES);
    const passives = Array.from({ length: MAX_STATUSES }, (_, i) => ({
      id: skid(`s${i + 1}`),
      name: `Passive ${i + 1}`,
      type: 'passive' as const,
      level: 1,
      label: null,
      desc: '',
      bonus: {},
      worn: { label: `Extra Worn ${i + 1}`, desc: '', ops: [] },
    }));
    const row = hunterRow({ ...base, skills: passives }, combatantId('h1'), RULES);
    expect(row.statuses.length).toBe(MAX_STATUSES);
    expect(row.statuses[0]!.key).toBe(statusKey('hemo-crimson-pact-lord'));
    expect(row.statuses[0]!.worn).toBe(true);
  });

  test('Fable review guards: unique status keys, sourceHealShare pricing, node anti-drift, and self-centered map aiming for Tides of Blood', () => {
    // 1. Duplicate class status key with conflicting def throws
    expect(() => classStatusDef('dup-key', {
      Hemomancer: {
        className: 'Hemomancer',
        bonus: {},
        worn: { key: statusKey('dup-key'), def: { label: 'A', desc: 'A', ops: [] } },
        actives: [],
      },
      Bladefiend: {
        className: 'Bladefiend',
        bonus: {},
        worn: { key: statusKey('dup-key'), def: { label: 'B', desc: 'B', ops: [] } },
        actives: [],
      },
    }, {})).toThrow(/Duplicate class status key/);

    // 2. End.sourceHealShare is priced in worth.ts (strictly raises worth above zero-share end)
    const plagueAb = (HEMOMANCER_SIGNATURE.actives ?? []).find(a => a.id === abilityId('hemo-hemoplague'))!;
    const noHealAb = {
      ...plagueAb,
      ops: plagueAb.ops.map(o => (o.op === 'applyStatus' && o.def.end
        ? { ...o, def: { ...o.def, end: { ops: o.def.end.ops, cleanse: o.def.end.cleanse } } }
        : o)),
    };
    const wWith = abilityWorth(plagueAb, RULES, { rank: 'S' });
    const wWithout = abilityWorth(noHealAb, RULES, { rank: 'S' });
    expect(wWith.worth).toBeGreaterThan(wWithout.worth);

    // 3. Anti-drift: every Hemomancer node's description names every numeric bonus and scaler percentage in its gifts
    for (const n of HEMOMANCER_TREE.nodes) {
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

    // 4. Every legal Hemomancer fork combination stays within RULES.fight.kit.scalers (2)
    const forkGroups = [...new Set(HEMOMANCER_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => HEMOMANCER_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = HEMOMANCER_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const cp = classPowers(makeHemoHunter(nodes), RULES);
      expect(cp.scalers.length, `fork mask ${mask} exceeded kit.scalers`).toBeLessThanOrEqual(RULES.fight.kit.scalers);
    }

    // 5. map-view.ts pre-aims Tides of Blood (aim: 'place', range: 0) at caster's tile and confirms in one tap
    const f = startDuel();
    const tidesId = wornAbilityId(abilityId('hemo-tides-of-blood'));
    const h = f.rows.find(r => r.id === combatantId('h1'))!;
    const tides = h.abilities.find(a => a.id === tidesId)!;
    const bodies = fightBodies(f, RULES, b => b.id === h.id, EVERYTHING);
    const input = { bodies, grid: f.grid, actor: h.id, currentId: h.id, zones: [], sight: null, dodge: null };
    const idleScene = mapScene(input, { kind: 'none' }, RULES);
    const picked = choose(NO_CHOICE, { kind: 'pick', ability: tides, scene: idleScene });
    const focusedScene = mapScene(input, picked.choice.now, RULES);
    expect(focusedScene.focus.kind).toBe('aim');
    if (focusedScene.focus.kind === 'aim') {
      expect(focusedScene.focus.aim?.ok).toBe(true);
      expect(focusedScene.focus.aim?.at).toEqual(h.place);
      expect(focusedScene.focus.aim?.hit).toContain(combatantId('m1'));
    }
    const confirmed = choose(picked.choice, { kind: 'go', scene: focusedScene });
    const useFx = confirmed.fx.find(x => x.kind === 'use');
    expect(useFx).toBeDefined();
    if (useFx && useFx.kind === 'use') {
      expect(useFx.ability.id).toBe(tidesId);
      expect(useFx.aim).toEqual(h.place);
    }
  });
});
