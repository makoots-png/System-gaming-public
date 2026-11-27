import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { parseFormula } from '../src/core/formula.ts';
import { fightId, parseClassNodeId, parseSaveId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, ItemId } from '../src/core/ids.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';
import { newHunter } from '../src/core/save.ts';
import { earnClass } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { isRefused } from '../src/core/save-step.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { describeStatus, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Body, Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { afterDefence } from '../src/core/combat/land.ts';
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { tripKey } from '../src/core/combat/triggers.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { IRONCLAD_SIGNATURE, IRONCLAD_TREE } from '../src/core/registry/class-ironclad.ts';
import { classStatusDef } from '../src/core/registry/class-powers.ts';
import { titleSpend } from '../src/core/registry/item-budget.ts';
import { dev } from './fixtures/ids.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';

const AT = '2026-11-27T12:00:00.000Z';
const CTX = { rules: RULES };
const H1 = combatantId('h1');
const M1 = combatantId('m1');
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;
const f = (text: string) => {
  const p = parseFormula(text, RULES);
  if (!p.ok) throw new Error(`Invalid formula: ${text}`);
  return p.formula;
};

const CANONICAL_FORKS = ['iron-a5-l', 'iron-b5-l', 'iron-c5-l'];
const FULL_NODES: readonly ClassNodeId[] = IRONCLAD_TREE.nodes
  .filter(n => !n.forkGroup || CANONICAL_FORKS.includes(n.id))
  .map(n => n.id);

const TEST_PLATE: HeldItem = {
  kind: 'adhoc',
  id: parseSaveId<'i'>('i900') as ItemId,
  qty: 1,
  item: {
    name: 'Test Plate',
    rar: 'epic',
    type: 'armor',
    slot: 'chest',
    dice: '',
    bonus: { hpMax: 400 },
    desc: '',
    armor: 40,
    resist: 20,
    target: 'other',
    effects: [],
  },
};

function makeIronclad(nodes: readonly ClassNodeId[] = [], rank: Rank = 'A', withPlate = false) {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, name: 'Ironclad', rank, level: RULES.rankLevels[rank], stats: { ...base.stats, vit: 106, dis: 58 } },
    'Ironclad',
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    items: withPlate ? [...earned.items, TEST_PLATE] : earned.items,
    equipped: withPlate ? { ...earned.equipped, chest: TEST_PLATE.id } : earned.equipped,
    classes: { ...earned.classes, Ironclad: { ...earned.classes.Ironclad!, nodes: [...nodes] } },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return {
    ...withNodes,
    life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000),
    mana: sheet.manaMax,
  };
}

function makeFixedStrike(id: string, name: string, type: 'physical' | 'true', amount: string): Ability {
  const base = abilityOf('strike', {
    id: abilityId(id),
    name,
    aim: 'foe',
    range: tiles(2),
    shape: { kind: 'touch', reach: tiles(2) },
    delivery: { kind: 'travel', windup: tick(100), speed: 'instant' },
    foesOnly: true,
    effect: { type, by: 'hand', formula: f(amount) },
  }, RULES);
  return { ...base, cost: { ...base.cost, mana: 0, fatigue: 0, cooldown: tick(0) } };
}

const PHYS_200 = makeFixedStrike('test-phys-200', 'Heavy Blow', 'physical', '200');
const TRUE_100 = makeFixedStrike('test-true-100', 'True Lance', 'true', '100');

function startDuel(
  id: string,
  nodes: readonly ClassNodeId[] = [],
  opts: { ironShield?: number; foeStatuses?: readonly Status[] } = {},
): Running {
  const iron = makeIronclad(nodes, 'A', true);
  const iRow0 = hunterRow(iron, H1, RULES);
  const iRow = {
    ...iRow0,
    place: place(3, 3),
    abilities: [...iRow0.abilities, PHYS_200],
    ...(opts.ironShield ? { shield: { amount: opts.ironShield, until: tick(10_000) } } : {}),
  };
  const foe0 = monsterRows(
    { name: 'Colossus', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] },
    [M1],
    RULES,
  )[0]!;
  const foe = {
    ...foe0,
    place: place(4, 3),
    abilities: [PHYS_200, TRUE_100, ...foe0.abilities],
    statuses: [...foe0.statuses, ...(opts.foeStatuses ?? [])],
  };

  let fight: Fight = reduce(null, {
    type: 'add',
    fightId: fightId(id),
    rows: [iRow, foe],
    openings: [],
  }, CTX).fight!;
  fight = reduce(fight, {
    type: 'start',
    openings: [{ id: H1, d20: 20, tie: 2 }, { id: M1, d20: 1, tie: 1 }],
  }, CTX).fight!;
  if (fight.phase !== 'running') throw new Error('expected running fight');
  return fight;
}

const rowOf = (fight: Running, id: typeof H1 | typeof M1): Body => fight.rows.find(r => r.id === id)!;

function strike(fight: Running, by: typeof H1 | typeof M1, at: typeof H1 | typeof M1, ab: Ability) {
  const r = reduce(fight, {
    type: 'act',
    by,
    ability: ab.id,
    aim: at,
    rolls: { dice: {}, react: { [at]: 10 } },
    force: true,
  }, CTX);
  expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
  return { fight: r.fight as Running, effects: r.effects };
}

/** Independent calculation of `blocked` for a fixed strike against a defender with `takenShare`, `guardShare`, and `shield`. */
function expectedBlocked(
  amount: number,
  type: 'physical' | 'true',
  attacker: Body,
  defender: Body,
  takenShare: number,
  guardShare = 0,
  shieldBefore = 0,
): { raw: number; dealt: number; absorbed: number; blocked: number } {
  const raw = amount * takenShare;
  const struck = guardShare ? raw * (1 - guardShare) : raw;
  const dealt = afterDefence(struck, type, attacker.sheet, defender.sheet, RULES);
  const absorbed = Math.min(shieldBefore, dealt);
  const blocked = Math.max(0, Math.round(raw) - dealt + absorbed);
  return { raw, dealt, absorbed, blocked };
}

describe('Wave 4 A5: Ironclad true reflect on blocked damage', () => {
  test('Iron Bulwark and Living Fortress wire reflect triggers within <= 4 triggers while keeping Siege Charge, actives, and 26 tree nodes intact', () => {
    const baseWorn = IRONCLAD_SIGNATURE.worn!;
    expect(baseWorn.key).toBe(statusKey('iron-bastion'));
    expect(baseWorn.def.triggers?.length).toBe(2);
    expect(baseWorn.def.triggers?.length).toBeLessThanOrEqual(RULES.fight.kit.triggers);

    const capNode = IRONCLAD_TREE.nodes.find(n => n.id === nid('iron-cap'))!;
    const capGift = capNode.gifts.find(g => g.kind === 'replace-worn')!;
    if (capGift.kind !== 'replace-worn') throw new Error('expected replace-worn on iron-cap');
    const capWorn = capGift.worn;
    expect(capWorn.key).toBe(statusKey('iron-bastion-living'));
    expect(capWorn.def.triggers?.length).toBe(3);
    expect(capWorn.def.triggers?.length).toBeLessThanOrEqual(RULES.fight.kit.triggers);

    // Base reflect: struck -> other, once a round, 0.25 * blocked physical (instant, not DoT)
    const baseReflect = baseWorn.def.triggers![1]!;
    expect(baseReflect.on).toBe('struck');
    expect(baseReflect.to).toBe('other');
    expect(baseReflect.limit).toEqual({ kind: 'round' });
    expect(baseReflect.ops).toEqual([{ op: 'damage', type: 'physical', when: 'use', amount: f('0.25 * blocked') }]);

    // Capstone reflect: struck -> other, every time, 0.35 * blocked physical (instant, not DoT)
    const capReflect = capWorn.def.triggers![1]!;
    expect(capReflect.on).toBe('struck');
    expect(capReflect.to).toBe('other');
    expect(capReflect.limit).toEqual({ kind: 'each' });
    expect(capReflect.ops).toEqual([{ op: 'damage', type: 'physical', when: 'use', amount: f('0.35 * blocked') }]);

    // describeStatus reads instant reflect ("Deals ..."), never "damage a round"
    const baseLines = describeStatus(baseWorn.def, 0, RULES);
    const capLines = describeStatus(capWorn.def, 0, RULES);
    expect(baseLines.some(l => l.includes('Deals 0.25 * blocked physical damage on the other, once a round.'))).toBe(true);
    expect(capLines.some(l => l.includes('Deals 0.35 * blocked physical damage on the other, every time.'))).toBe(true);
    expect([...baseLines, ...capLines].some(l => l.includes('damage a round'))).toBe(false);

    // Bonus, Siege Charge, all 4 actives, and all 26 tree nodes preserved
    expect(IRONCLAD_SIGNATURE.bonus).toEqual({ vit: 2, dis: 2, threat: 10 });
    expect(IRONCLAD_SIGNATURE.actives?.map(a => a.id)).toEqual([
      abilityId('iron-cage'),
      abilityId('iron-intercept'),
      abilityId('iron-shield-slam'),
      abilityId('iron-unbreakable'),
    ]);
    expect(IRONCLAD_TREE.nodes).toHaveLength(26);
  });

  test('Iron Bulwark reflects exact 0.25 * blocked from armor, Bulwark Intercept guard, and shield, capped once a round', () => {
    // 1. Plain armored hit (no shield, no guard; Iron Bulwark has -10% taken share -> 0.9)
    const f0 = startDuel('f-iron-armor-only');
    const iron0 = rowOf(f0, H1);
    const foe0 = rowOf(f0, M1);
    const foeHp0 = rowHp(foe0);
    const ironHp0 = rowHp(iron0);

    const calc1 = expectedBlocked(200, 'physical', foe0, iron0, 0.9, 0, 0);
    const step1 = strike(f0, M1, H1, PHYS_200);
    const ironAfter1 = rowOf(step1.fight, H1);
    expect(ironHp0 - rowHp(ironAfter1)).toBe(calc1.dealt);
    expect(calc1.blocked).toBeGreaterThan(0);

    // Siege Charge (#0) fires before reflect (#1), raising armor by +2; reflect reads Ironclad's live sheet
    const expectedReflect1 = afterDefence(0.25 * calc1.blocked, 'physical', ironAfter1.sheet, foe0.sheet, RULES);
    expect(expectedReflect1).toBeGreaterThan(0);
    expect(foeHp0 - rowHp(rowOf(step1.fight, M1))).toBe(expectedReflect1);
    expect(ironAfter1.statuses.find(s => s.key === statusKey('iron-charge'))?.stacks).toBe(1);

    // 2. Second strike in the same round: ROUND limit blocks a second reflect, while Siege Charge still stacks
    const foeHpAfter1 = rowHp(rowOf(step1.fight, M1));
    const step2 = strike(step1.fight, M1, H1, PHYS_200);
    expect(foeHpAfter1 - rowHp(rowOf(step2.fight, M1))).toBe(0);
    expect(rowOf(step2.fight, H1).statuses.find(s => s.key === statusKey('iron-charge'))?.stacks).toBe(2);

    // 3. Next round: ROUND limit resets and reflects exact 0.25 * blocked again (now with 2 stacks of Siege Charge = +4 armor)
    const nextRoundFight: Running = { ...step2.fight, now: tick(step2.fight.now + RULES.fight.round) };
    const ironBefore3 = rowOf(nextRoundFight, H1);
    const foeBefore3 = rowOf(nextRoundFight, M1);
    const foeHpBefore3 = rowHp(foeBefore3);
    const calc3 = expectedBlocked(200, 'physical', foeBefore3, ironBefore3, 0.9, 0, 0);
    const step3 = strike(nextRoundFight, M1, H1, PHYS_200);
    const expectedReflect3 = afterDefence(0.25 * calc3.blocked, 'physical', rowOf(step3.fight, H1).sheet, foeBefore3.sheet, RULES);
    expect(foeHpBefore3 - rowHp(rowOf(step3.fight, M1))).toBe(expectedReflect3);

    // 4. Armed Bulwark Intercept (35% guard + 16% max HP shield) + armor boosts blocked and reflects exact 0.25 * blocked
    let fGuard = startDuel('f-iron-intercept-reflect');
    const interceptId = wornAbilityId(abilityId('iron-intercept'));
    const armed = reduce(fGuard, { type: 'arm', by: H1, ability: interceptId }, CTX);
    expect(armed.effects.filter(e => e.type === 'refused')).toEqual([]);
    fGuard = armed.fight as Running;

    const ironGuard0 = rowOf(fGuard, H1);
    const foeGuard0 = rowOf(fGuard, M1);
    const foeHpGuard0 = rowHp(foeGuard0);
    const interceptShield = Math.round(0.16 * ironGuard0.sheet.hpMax);
    const calcGuard = expectedBlocked(200, 'physical', foeGuard0, ironGuard0, 0.9, 0.35, interceptShield);
    expect(calcGuard.absorbed).toBeGreaterThan(0);
    expect(calcGuard.dealt).toBeLessThan(calc1.dealt);
    expect(calcGuard.blocked).toBeGreaterThan(calc1.blocked);

    const guarded = strike(fGuard, M1, H1, PHYS_200);
    const ironGuardAfter = rowOf(guarded.fight, H1);
    expect(rowHp(ironGuard0) - rowHp(ironGuardAfter)).toBe(calcGuard.dealt - calcGuard.absorbed);
    const expectedGuardReflect = afterDefence(0.25 * calcGuard.blocked, 'physical', ironGuardAfter.sheet, foeGuard0.sheet, RULES);
    expect(expectedGuardReflect).toBeGreaterThan(expectedReflect1);
    expect(foeHpGuard0 - rowHp(rowOf(guarded.fight, M1))).toBe(expectedGuardReflect);
    expect(ironGuardAfter.statuses.some(s => s.key === statusKey('iron-safeguard'))).toBe(true);
  });

  test('Living Fortress reflects exact 0.35 * blocked on EACH strike in the same round', () => {
    // Living Fortress has -15% taken share -> 0.85
    const f0 = startDuel('f-iron-living', FULL_NODES);
    const iron0 = rowOf(f0, H1);
    const foe0 = rowOf(f0, M1);
    const foeHp0 = rowHp(foe0);

    const calc1 = expectedBlocked(200, 'physical', foe0, iron0, 0.85, 0, 0);
    const hit1 = strike(f0, M1, H1, PHYS_200);
    const iron1 = rowOf(hit1.fight, H1);
    const expected1 = afterDefence(0.35 * calc1.blocked, 'physical', iron1.sheet, foe0.sheet, RULES);
    expect(expected1).toBeGreaterThan(0);
    expect(foeHp0 - rowHp(rowOf(hit1.fight, M1))).toBe(expected1);
    expect(iron1.statuses.find(s => s.key === statusKey('iron-charge'))?.stacks).toBe(2);

    // Second strike in the exact same round ALSO reflects at 0.35 * blocked (now with +4 armor from 2 Siege Charge)
    const foe1 = rowOf(hit1.fight, M1);
    const foeHp1 = rowHp(foe1);
    const calc2 = expectedBlocked(200, 'physical', foe1, iron1, 0.85, 0, 0);
    const hit2 = strike(hit1.fight, M1, H1, PHYS_200);
    const iron2 = rowOf(hit2.fight, H1);
    const expected2 = afterDefence(0.35 * calc2.blocked, 'physical', iron2.sheet, foe1.sheet, RULES);
    expect(expected2).toBeGreaterThan(0);
    expect(foeHp1 - rowHp(rowOf(hit2.fight, M1))).toBe(expected2);
    expect(iron2.statuses.find(s => s.key === statusKey('iron-charge'))?.stacks).toBe(4);
  });

  test('unshielded true damage reflects 0 without tripping Iron Bulwark, while shielded true damage reflects 0.25 * absorbed (0.35 * absorbed on Living Fortress)', () => {
    // 1. Unshielded true damage: blocked === 0 -> 0 reflect, no trip on reflect trigger (#1), later physical hit in same round still reflects
    const fUnshielded = startDuel('f-iron-true-unshielded');
    const iron0 = rowOf(fUnshielded, H1);
    const foe0 = rowOf(fUnshielded, M1);
    const foeHp0 = rowHp(foe0);

    const trueStep = strike(fUnshielded, M1, H1, TRUE_100);
    const ironAfterTrue = rowOf(trueStep.fight, H1);
    expect(rowHp(iron0) - rowHp(ironAfterTrue)).toBe(90); // 100 * 0.9 taken share, 0 blocked
    expect(foeHp0 - rowHp(rowOf(trueStep.fight, M1))).toBe(0);
    expect(ironAfterTrue.trips?.[tripKey(statusKey('iron-bastion'), 1)]).toBeUndefined();
    // Only Siege Charge fired, no bare reflect entry without damage
    expect(trueStep.fight.log.some(l => l.text.includes("Ironclad's Iron Bulwark (Colossus"))).toBe(false);

    // Same round physical hit still reflects
    const calcPhys = expectedBlocked(200, 'physical', foe0, ironAfterTrue, 0.9, 0, 0);
    const physStep = strike(trueStep.fight, M1, H1, PHYS_200);
    const expectedPhys = afterDefence(0.25 * calcPhys.blocked, 'physical', rowOf(physStep.fight, H1).sheet, foe0.sheet, RULES);
    expect(expectedPhys).toBeGreaterThan(0);
    expect(foeHp0 - rowHp(rowOf(physStep.fight, M1))).toBe(expectedPhys);

    // 2. Shielded true damage on Base Iron Bulwark: absorbed = 40 -> reflects 0.25 * 40
    const fShieldBase = startDuel('f-iron-true-shielded-base', [], { ironShield: 40 });
    const foeHpShieldBase = rowHp(rowOf(fShieldBase, M1));
    const shieldedBase = strike(fShieldBase, M1, H1, TRUE_100);
    expect(rowOf(shieldedBase.fight, H1).shield).toBeNull();
    const expectedShieldBase = afterDefence(0.25 * 40, 'physical', rowOf(shieldedBase.fight, H1).sheet, rowOf(fShieldBase, M1).sheet, RULES);
    expect(expectedShieldBase).toBeGreaterThan(0);
    expect(foeHpShieldBase - rowHp(rowOf(shieldedBase.fight, M1))).toBe(expectedShieldBase);

    // 3. Shielded true damage on Living Fortress: absorbed = 40 -> reflects 0.35 * 40
    const fShieldCap = startDuel('f-iron-true-shielded-cap', FULL_NODES, { ironShield: 40 });
    const foeHpShieldCap = rowHp(rowOf(fShieldCap, M1));
    const shieldedCap = strike(fShieldCap, M1, H1, TRUE_100);
    expect(rowOf(shieldedCap.fight, H1).shield).toBeNull();
    const expectedShieldCap = afterDefence(0.35 * 40, 'physical', rowOf(shieldedCap.fight, H1).sheet, rowOf(fShieldCap, M1).sheet, RULES);
    expect(expectedShieldCap).toBeGreaterThan(expectedShieldBase);
    expect(foeHpShieldCap - rowHp(rowOf(shieldedCap.fight, M1))).toBe(expectedShieldCap);
  });

  test('trigger hits carry blocked = 0: reflect never feeds reflect and thorn hits never waste Iron Bulwark once-a-round reflect', () => {
    const livingDef = classStatusDef('iron-bastion-living')!;
    const foeReflectStatus = statusOn(livingDef, {
      key: statusKey('iron-bastion-living'),
      source: { id: null, tier: 4 },
      until: null,
      since: tick(0),
      settledAt: tick(0),
    });
    const f0 = startDuel('f-iron-mirror', [], { foeStatuses: [foeReflectStatus] });
    const iron0 = rowOf(f0, H1);
    const foe0 = rowOf(f0, M1);
    const ironHp0 = rowHp(iron0);
    const foeHp0 = rowHp(foe0);

    // Ironclad strikes the Living-Fortress foe: foe reflects back, but that trigger hit carries blocked = 0,
    // so Ironclad reflects 0 back onto foe and Ironclad's ROUND reflect stays untripped.
    const swingCalc = expectedBlocked(200, 'physical', iron0, foe0, 0.85, 0, 0);
    const swing = strike(f0, H1, M1, PHYS_200);
    const mAfter = rowOf(swing.fight, M1);
    const hAfter = rowOf(swing.fight, H1);
    expect(foeHp0 - rowHp(mAfter)).toBe(swingCalc.dealt);
    // Foe reflected 0.35 * swingCalc.blocked * 0.9 (Ironclad's -10% taken share) onto Ironclad
    const expectedFoeReflect = afterDefence(0.35 * swingCalc.blocked * 0.9, 'physical', mAfter.sheet, iron0.sheet, RULES);
    expect(ironHp0 - rowHp(hAfter)).toBe(expectedFoeReflect);
    expect(expectedFoeReflect).toBeGreaterThan(0);
    expect(hAfter.trips?.[tripKey(statusKey('iron-bastion'), 1)]).toBeUndefined();

    // Foe then makes a real physical strike in the same round: Ironclad's ROUND reflect fires normally
    const foeHpBeforeRetaliation = rowHp(mAfter);
    const retCalc = expectedBlocked(200, 'physical', mAfter, hAfter, 0.9, 0, 0);
    const retaliation = strike(swing.fight, M1, H1, PHYS_200);
    const hAfterRet = rowOf(retaliation.fight, H1);
    // Foe has Living Fortress (-15% taken share -> 0.85)
    const expectedReflect = afterDefence(0.25 * retCalc.blocked * 0.85, 'physical', hAfterRet.sheet, mAfter.sheet, RULES);
    expect(expectedReflect).toBeGreaterThan(0);
    expect(foeHpBeforeRetaliation - rowHp(rowOf(retaliation.fight, M1))).toBe(expectedReflect);
  });

  test('titleSpend stays B = 24.40, A = 24.40 and registered worn defs round-trip cleanly with 0-byte wire.defs (fail-capable pin)', () => {
    const worn = IRONCLAD_SIGNATURE.worn!.def;
    const spendB = titleSpend({ bonus: IRONCLAD_SIGNATURE.bonus ?? {}, worn, band: 'B' }, RULES);
    const spendA = titleSpend({ bonus: IRONCLAD_SIGNATURE.bonus ?? {}, worn, band: 'A' }, RULES);
    expect(Number(spendB.points.toFixed(2))).toBe(24.4);
    expect(Number(spendA.points.toFixed(2))).toBe(24.4);
    expect(spendB.unweighed).toContain('worn');

    for (const [label, nodes, keyName] of [
      ['base', [] as readonly ClassNodeId[], 'iron-bastion'],
      ['capstone', FULL_NODES, 'iron-bastion-living'],
    ] as const) {
      const key = statusKey(keyName);
      const shipped = classStatusDef(keyName)!;
      expect(shippedStatusDef(key)).toEqual(shipped);
      expect(parseStatusDef(JSON.parse(JSON.stringify(shipped)), RULES, keyName), `${label} parseStatusDef`).toEqual(shipped);

      const h = makeIronclad(nodes);
      const hRow = hunterRow(h, H1, KEYSTONES_ON);
      const foe = monsterRows(
        { name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] },
        [M1],
        KEYSTONES_ON,
      )[0]!;
      let fight: Fight = reduce(null, {
        type: 'add',
        fightId: fightId(`f-iron-wire-${label}`),
        rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }],
        openings: [],
      }, { rules: KEYSTONES_ON }).fight!;
      fight = reduce(fight, {
        type: 'start',
        openings: [{ id: H1, d20: 20, tie: 2 }, { id: M1, d20: 1, tie: 1 }],
      }, { rules: KEYSTONES_ON }).fight!;

      const doc = fightDoc(fight, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error('expected active FightDoc');
      const wire = fightWire(doc);
      expect(wire.defs, `${label} fightWire(doc).defs should be undefined`).toBeUndefined();

      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
      const onRow = parsed.rows.find(r => r.id === H1)!.statuses.find(s => s.key === key);
      expect(onRow?.def, `${label} restored worn def`).toEqual(shipped);

      // Fail-capable negative proof: mutating the reflect trigger def causes fightWire(doc).defs to emit the key
      const mutatedDef: StatusDef = {
        ...shipped,
        triggers: (shipped.triggers ?? []).map((tr, idx) =>
          idx === 1 ? { ...tr, ops: [{ op: 'damage' as const, type: 'physical' as const, when: 'use' as const, amount: f('0.3 * blocked') }] } : tr,
        ),
      };
      const mutatedDoc = {
        ...doc,
        rows: doc.rows.map(r => (r.id === H1
          ? { ...r, statuses: r.statuses.map(s => (s.key === key ? { ...s, def: mutatedDef } : s)) }
          : r)),
      };
      const mutatedWire = fightWire(mutatedDoc);
      expect(mutatedWire.defs, `${label} mutated def must spill into wire.defs`).toBeDefined();
      expect(Object.keys(mutatedWire.defs as Record<string, unknown>)).toContain(keyName);
    }
  });
});
