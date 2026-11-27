import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, BONUS_KEYS, RULES } from '../src/core/rules.ts';
import type { BonusKey, Rank } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { fightId, parseClassNodeId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { combatantId, abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { exposedOf, holds } from '../src/core/combat/standing.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { cost, interval, tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { abilityOf, formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { titleSpend } from '../src/core/registry/item-budget.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { BUILT_IN_CLASSES } from '../src/core/registry/jobs.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, canFlipFork, capstoneUnlocked, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { VOIDSTALKER_SIGNATURE, VOIDSTALKER_TREE } from '../src/core/registry/class-voidstalker.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-27T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

const CANONICAL_FORKS = ['void-a5-l', 'void-b5-l', 'void-c5-l'] as const;
const BRANCH_A_RUSH = ['void-root', 'void-a2', 'void-a3x', 'void-a3y', 'void-a4x', 'void-a4y', 'void-a5-l', 'void-a6'] as const;

function canonicalNodes(): ClassNodeId[] {
  return VOIDSTALKER_TREE.nodes
    .filter(n => !n.forkGroup || (CANONICAL_FORKS as readonly string[]).includes(n.id))
    .map(n => n.id);
}

function makeVoidstalker(
  nodes: readonly ClassNodeId[] = [],
  opts: { rank?: Rank; stats?: Partial<Record<'agi' | 'ins' | 'str' | 'vit', number>>; rules?: typeof RULES } = {},
) {
  const rank = opts.rank ?? 'A';
  const R = opts.rules ?? RULES;
  const base = newHunter(R);
  const stats = { ...base.stats, agi: 106, ins: 58, ...opts.stats };
  const earned = earnClass(
    { ...base, name: 'Voidstalker', rank, level: R.rankLevels[rank], stats },
    'Voidstalker',
    { at: AT, R },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Voidstalker: { ...earned.classes.Voidstalker!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, R);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Wave 3 U5: Voidstalker metadata, tree, budgets, and round-trip integrity', () => {
  test('Voidstalker uses agi+ins (2:1) and has a valid 26-node / 23-buyable Epic tree summing to 2,295,000 gold at S rank', () => {
    expect(BUILT_IN_CLASSES.Voidstalker).toEqual({
      rarity: 'epic',
      unique: true,
      recRank: 'A',
      pair: 'agi+ins',
      alloc: { agi: 2, ins: 1 },
    });
    expect(CLASS_SIGNATURES.Voidstalker).toBe(VOIDSTALKER_SIGNATURE);
    expect(CLASS_TREES.Voidstalker).toBe(VOIDSTALKER_TREE);
    expect(validateTree(VOIDSTALKER_TREE)).toEqual([]);
    expect(VOIDSTALKER_TREE.nodes.length).toBe(TREE_SHAPE.epic.total);

    const full = canonicalNodes();
    expect(full.length).toBe(TREE_SHAPE.epic.buyable);
    expect(repairNodes(VOIDSTALKER_TREE, full)).toEqual(full);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of full) {
      expect(canBuyNode(VOIDSTALKER_TREE, bought, id).ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Voidstalker', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(2_295_000);

    const rush = BRANCH_A_RUSH.map(nid);
    expect(capstoneUnlocked(VOIDSTALKER_TREE, rush)).toBe(true);
    expect(canBuyNode(VOIDSTALKER_TREE, rush, nid('void-cap')).ok).toBe(true);
    expect(canFlipFork(VOIDSTALKER_TREE, full, nid('void-a5-l'), nid('void-a5-r')).ok).toBe(true);
    expect(canFlipFork(VOIDSTALKER_TREE, full, nid('void-b5-l'), nid('void-b5-r')).ok).toBe(true);
    expect(canFlipFork(VOIDSTALKER_TREE, full, nid('void-c5-l'), nid('void-c5-r')).ok).toBe(true);
  });

  test('base signature passes Epic titleSpend and abilityWorth bounds (including Phase Blink at 0.25 SA), reports speed under class, and round-trips wire.defs at 0 bytes', () => {
    const rootB = titleSpend({ bonus: VOIDSTALKER_SIGNATURE.bonus ?? {}, worn: VOIDSTALKER_SIGNATURE.worn!.def, band: 'B' }, RULES);
    const rootA = titleSpend({ bonus: VOIDSTALKER_SIGNATURE.bonus ?? {}, worn: VOIDSTALKER_SIGNATURE.worn!.def, band: 'A' }, RULES);
    expect(rootB.points).toBeGreaterThan(15);
    expect(rootB.points).toBeLessThan(40);
    expect(rootA.points).toBeGreaterThan(15);
    expect(rootA.points).toBeLessThan(45);

    for (const a of VOIDSTALKER_SIGNATURE.actives ?? []) {
      const w = abilityWorth(a, RULES, { rank: 'A', on: 'best' });
      expect(w.worth, `${a.name} worth > 0`).toBeGreaterThan(0);
      expect(w.worth, `${a.name} worth <= 2.2`).toBeLessThanOrEqual(2.2);
      if (a.name === 'Phase Blink') expect(w.worth).toBeCloseTo(0.25, 4);
    }

    const baseH = makeVoidstalker([]);
    expect(explain(baseH, 'speed', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(4);

    const abilities: Ability[] = [...(VOIDSTALKER_SIGNATURE.actives ?? [])];
    for (const n of VOIDSTALKER_TREE.nodes) {
      expect(n.desc).not.toMatch(/[—–;!]|\bjust\b/i);
      for (const g of n.gifts) {
        if (g.kind === 'replace-active') abilities.push(g.active);
        if (g.kind === 'bonus') {
          for (const k of BONUS_KEYS) {
            const v = g.bonus[k as BonusKey];
            if (typeof v !== 'number' || v === 0) continue;
            const needle = k === 'critSize'
              ? String(v / 100)
              : (BONUS_HUNDREDTHS as readonly string[]).includes(k) ? `${v}%` : String(v);
            expect(n.desc, `${n.id} desc missing ${k}=${needle}`).toContain(needle);
          }
        } else if (g.kind === 'scaler') {
          expect(n.desc).toContain(`${Math.round(g.scaler.scale * 100)}%`);
        }
      }
    }
    expect(abilities.length).toBe(9);
    for (const a of abilities) {
      expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `parseAbility(${a.name})`).toEqual(a);
      const form = formulaOf(a, RULES);
      if (form) expect(partsOf(form)).toBeLessThanOrEqual(FORMULA_PARTS);
    }

    for (const key of [
      'void-rift-shadow',
      'void-abyssal-phantom',
      'void-veil-slip',
      'void-veil-slip-ii',
      'void-brand',
      'void-brand-implosion',
      'void-brand-echo',
      'void-shroud',
      'void-shroud-ghost',
      'void-umbral-ward',
      'void-rift-gap',
      'void-marked',
      'void-phase-rush',
    ]) {
      const def = classStatusDef(key);
      expect(def, `classStatusDef(${key})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(key))).toEqual(def);
      expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, key)).toEqual(def);
    }

    const capH = makeVoidstalker(canonicalNodes(), { rules: KEYSTONES_ON });
    const cp = classPowers(capH, RULES);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    expect(cp.worn?.key).toBe(statusKey('void-abyssal-phantom'));

    const hRow = hunterRow(capH, combatantId('h1'), KEYSTONES_ON);
    const foe = monsterRows({ name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-void-wire'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    expect(parsed.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('void-abyssal-phantom'))?.def).toEqual(classStatusDef('void-abyssal-phantom')!);
  });
});

describe('Voidstalker combat mechanics', () => {
  const REND_ID = wornAbilityId(abilityId('void-rend'));
  const BLINK_ID = wornAbilityId(abilityId('void-phase-blink'));
  const CUT_ID = wornAbilityId(abilityId('void-phantom-cut'));
  const SWAP_ID = wornAbilityId(abilityId('void-abyssal-swap'));

  test('Void Shroud (ends.dealt: false) enables a Phase Blink -> Phantom Cut -> Void Rend chain-ambush while breaking on reveal or damage taken', () => {
    const ctx = { rules: RULES };
    // Include void-a3y (+5 max mana) so base Phase Blink (6m) + Phantom Cut (6m) + Void Rend (0m) chain cleanly in one round.
    const vs = makeVoidstalker(['void-root', 'void-a2', 'void-a3y'].map(nid));
    const vRow = hunterRow(vs, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Warden', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-void-chain'),
      rows: [{ ...vRow, place: place(2, 2) }, { ...foe, place: place(8, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    // 1. Phase Blink 5 tiles to (7, 2) adjacent to foe -> enters Void Shroud (hidden, ends.dealt: false) and refunds 25% of its quick action time
    const blinkNow = f.now;
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: BLINK_ID, aim: place(7, 2), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    let cur = r.fight as Running;
    const hAfterBlink = cur.rows.find(x => x.id === combatantId('h1'))!;
    const blinkQuick = interval(hAfterBlink.speed, cost(RULES.fight.cost.quick), RULES.fight);
    expect(hAfterBlink.place).toEqual(place(7, 2));
    expect(holds(hAfterBlink, 'hidden')).toBe(true);
    expect(hAfterBlink.statuses.some(s => s.key === statusKey('void-phase-rush'))).toBe(false);
    expect(hAfterBlink.at - blinkNow).toBe(blinkQuick - Math.round(blinkQuick * 25 / 100));
    expect(hAfterBlink.at - blinkNow).toBeLessThan(blinkQuick);

    // 2. Phantom Cut deals physical damage + Rift Gap (exposed +1) while Void Shroud stays active (ends.dealt: false)!
    const hpBeforeCut = rowHp(cur.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(cur, {
      type: 'act',
      by: combatantId('h1'),
      ability: CUT_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cur = r.fight as Running;
    expect(rowHp(cur.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(hpBeforeCut);
    expect(exposedOf(cur.rows.find(x => x.id === combatantId('m1'))!)).toBe(1);
    expect(holds(cur.rows.find(x => x.id === combatantId('h1'))!, 'hidden')).toBe(true);

    // 3. Follow up with Void Rend inside the same 1-round window -> still hidden, still ambushes, applies Void Brand!
    const hpBeforeRend = rowHp(cur.rows.find(x => x.id === combatantId('m1'))!);
    r = reduce(cur, {
      type: 'act',
      by: combatantId('h1'),
      ability: REND_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cur = r.fight as Running;
    expect(rowHp(cur.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(hpBeforeRend);
    expect(cur.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('void-brand'))).toBe(true);
    expect(holds(cur.rows.find(x => x.id === combatantId('h1'))!, 'hidden')).toBe(true);

    // 4. Reveal breaks Void Shroud immediately
    const flare = abilityOf('curse', {
      id: abilityId('test-flare'),
      name: 'Flare',
      aim: 'place',
      range: tiles(6),
      shape: { kind: 'radius', radius: tiles(2), ring: null },
      delivery: { kind: 'sure' },
      foesOnly: false,
      effect: null,
      ops: [{ op: 'reveal' }],
    }, RULES);
    const withFlare: Running = {
      ...cur,
      rows: cur.rows.map(b => (b.id === combatantId('m1') ? { ...b, abilities: [...b.abilities, flare] } : b)),
    };
    r = reduce(withFlare, { type: 'act', by: combatantId('m1'), ability: flare.id, aim: place(7, 2), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    expect(holds((r.fight as Running).rows.find(x => x.id === combatantId('h1'))!, 'hidden')).toBe(false);
  });

  test('Void Brand detonates on natural expiry and on cure (cleanse: land), and Implosion heals Voidstalker for 25% of detonation damage', () => {
    const ctx = { rules: RULES };

    // 1. Base Void Brand detonates on cureStatus (cleanse: 'land') AND on natural expiry
    const vs = makeVoidstalker([]);
    const vRow = hunterRow(vs, combatantId('h1'), RULES);
    const cureAb = abilityOf('support', {
      id: abilityId('test-cure-brand'),
      name: 'Cleanse Brand',
      aim: 'self',
      range: tiles(0),
      shape: { kind: 'self' },
      delivery: { kind: 'sure' },
      foesOnly: false,
      effect: null,
      ops: [{ op: 'cureStatus', key: statusKey('void-brand') }],
    }, RULES);
    const foe0 = monsterRows({ name: 'Brute', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const foe = { ...foe0, abilities: [...foe0.abilities, cureAb] };

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-void-brand-cure'),
      rows: [{ ...vRow, place: place(2, 2) }, { ...foe, place: place(3, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    let r = reduce(f as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: REND_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const branded = r.fight as Running;
    const hpAfterRend = rowHp(branded.rows.find(x => x.id === combatantId('m1'))!);

    // Curing Void Brand sets off its delayed arcane detonation!
    r = reduce(branded, { type: 'act', by: combatantId('m1'), ability: cureAb.id, aim: combatantId('m1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterCure = r.fight as Running;
    expect(afterCure.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('void-brand'))).toBe(false);
    expect(rowHp(afterCure.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(hpAfterRend);

    // 2. Implosion fork: natural expiry after 2 rounds detonates and heals hurt Voidstalker via sourceHealShare (25%)
    const impNodes = ['void-root', 'void-b2', 'void-b3x', 'void-b3y', 'void-b4x', 'void-b4y', 'void-b5-l'].map(nid);
    const vsImp = makeVoidstalker(impNodes);
    const vImp0 = hunterRow(vsImp, combatantId('h1'), RULES);
    const hurtHp = Math.round(rowHp(vImp0) * 0.5);
    const vImp = { ...vImp0, life: { at: 'up' as const, hp: hurtHp } };

    let fImp: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-void-implosion'),
      rows: [{ ...vImp, place: place(2, 2) }, { ...foe0, place: place(3, 2) }],
      openings: [],
    }, ctx).fight!;
    fImp = reduce(fImp, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    r = reduce(fImp as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: REND_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    let curImp = r.fight as Running;
    const mHpBeforeExpire = rowHp(curImp.rows.find(x => x.id === combatantId('m1'))!);
    const vHpBeforeExpire = rowHp(curImp.rows.find(x => x.id === combatantId('h1'))!);

    // Advance past the 2-round mark so Void Implosion expires on m1's turn settle
    curImp = {
      ...curImp,
      currentId: combatantId('h1'),
      now: tick(curImp.now + 2100),
      rows: curImp.rows.map(b => (b.id === combatantId('m1') ? { ...b, at: tick(curImp.now + 2200) } : { ...b, at: tick(curImp.now + 3000) })),
    };
    r = reduce(curImp, { type: 'endTurn', by: combatantId('h1') }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const popped = r.fight as Running;
    const mAfterPop = popped.rows.find(x => x.id === combatantId('m1'))!;
    const vAfterPop = popped.rows.find(x => x.id === combatantId('h1'))!;
    expect(mAfterPop.statuses.some(s => s.key === statusKey('void-brand-implosion'))).toBe(false);
    expect(rowHp(mAfterPop)).toBeLessThan(mHpBeforeExpire);
    expect(rowHp(vAfterPop)).toBeGreaterThan(vHpBeforeExpire);
  });

  test('Abyssal Swap exchanges places with a channeling foe, breaks its channel, and applies Void Marked (exposed +2)', () => {
    const ctx = { rules: RULES };
    const vs = makeVoidstalker([]);
    const vRow = hunterRow(vs, combatantId('h1'), RULES);
    const chanSpell = abilityOf('blast', {
      id: abilityId('test-channel-blast'),
      name: 'Channel Blast',
      aim: 'place',
      range: tiles(8),
      shape: { kind: 'radius', radius: tiles(2), ring: null },
      delivery: { kind: 'travel', windup: tick(400), speed: 'instant' },
      foesOnly: true,
      effect: { type: 'arcane', by: 'hand', formula: { kind: 'number', value: 20 } },
      ops: [],
    }, RULES);
    const channelingAb: Ability = { ...chanSpell, channel: { growth: 'linear', max: 2 } };
    const caster0 = monsterRows({ name: 'Warlock', rank: 'A', archetype: 'caster', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const caster = { ...caster0, abilities: [...caster0.abilities, channelingAb] };

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-void-swap'),
      rows: [{ ...vRow, place: place(2, 2) }, { ...caster, place: place(8, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('m1'), d20: 20, tie: 2 }, { id: combatantId('h1'), d20: 15, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    // Caster begins channeling
    let r = reduce(f, { type: 'act', by: combatantId('m1'), ability: channelingAb.id, aim: place(2, 2), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    let cur = r.fight as Running;
    expect(cur.rows.find(x => x.id === combatantId('m1'))!.channel?.state).toBe('holding');

    // Voidstalker casts Abyssal Swap at range 6 -> swaps places, breaks caster's channel, applies Void Marked (+2 exposed)!
    r = reduce(cur, {
      type: 'act',
      by: combatantId('h1'),
      ability: SWAP_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterSwap = r.fight as Running;
    const vAfter = afterSwap.rows.find(x => x.id === combatantId('h1'))!;
    const mAfter = afterSwap.rows.find(x => x.id === combatantId('m1'))!;
    expect(vAfter.place).toEqual(place(8, 2));
    expect(mAfter.place).toEqual(place(2, 2));
    expect(mAfter.channel?.state).toBe('broken');
    expect(mAfter.statuses.some(s => s.key === statusKey('void-marked'))).toBe(true);
    expect(exposedOf(mAfter)).toBe(2);
  });

  test('Umbral Fade keeps untargetable on arrival once per fight, Shadow Execution attaches opener scaler, and Abyssal Phantom grants Void Shroud + 40% refund on kill', () => {
    const ctx = { rules: RULES };

    // 1. Umbral Fade preserves untargetable on Phase Blink arrival because hides(Phase Blink) === true, once per fight
    const umbNodes = ['void-root', 'void-a2', 'void-a3x', 'void-a3y', 'void-a4x', 'void-a4y', 'void-a5-r'].map(nid);
    const vUmb = hunterRow(makeVoidstalker(umbNodes), combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Guard', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let fUmb: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-void-umbral'),
      rows: [{ ...vUmb, place: place(2, 2) }, { ...foe, place: place(8, 2) }],
      openings: [],
    }, ctx).fight!;
    fUmb = reduce(fUmb, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    let r = reduce(fUmb as Running, { type: 'act', by: combatantId('h1'), ability: BLINK_ID, aim: place(6, 2), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const arrived = (r.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    expect(holds(arrived, 'untargetable')).toBe(true);
    expect(holds(arrived, 'hidden')).toBe(true);
    expect(arrived.warded).toContain('untargetable');

    // Second Phase Blink later does not re-grant untargetable (spent once per fight)
    const later: Running = {
      ...(r.fight as Running),
      now: tick(5000),
      rows: (r.fight as Running).rows.map(b => (b.id === combatantId('h1')
        ? { ...b, statuses: b.statuses.filter(s => s.key !== statusKey('void-umbral-ward') && s.key !== statusKey('void-shroud')), readyAt: {}, at: tick(5000) }
        : b)),
    };
    r = reduce(later, { type: 'act', by: combatantId('h1'), ability: BLINK_ID, aim: place(4, 2), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const arrived2 = (r.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    expect(holds(arrived2, 'untargetable')).toBe(false);
    expect(holds(arrived2, 'hidden')).toBe(true);

    // 2. Shadow Execution attaches opener scaler (0.18)
    const execNodes = ['void-root', 'void-c2', 'void-c3x', 'void-c3y', 'void-c4x', 'void-c4y', 'void-c5-r'].map(nid);
    const vExec = hunterRow(makeVoidstalker(execNodes), combatantId('h1'), RULES);
    const rendAb = vExec.abilities.find(a => a.id === REND_ID)!;
    expect(scalersOf(formulaOf(rendAb, RULES)!, RULES)?.scalers).toEqual([{ measure: 'target', dir: 'over', start: 0.5, scale: 0.18 }]);

    // 3. Abyssal Phantom capstone grants Void Shroud + 40% turn refund on kill
    const capRow = hunterRow(makeVoidstalker(canonicalNodes()), combatantId('h1'), RULES);
    const [m1, m2] = monsterRows({ name: 'Scout', rank: 'A', archetype: 'skirmisher', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1'), combatantId('m2')], RULES);
    let fCap: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-void-cap'),
      rows: [
        { ...capRow, place: place(2, 2) },
        { ...m1!, life: { at: 'up', hp: 1 }, place: place(3, 2) },
        { ...m2!, place: place(8, 2) },
      ],
      openings: [],
    }, ctx).fight!;
    fCap = reduce(fCap, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 20, tie: 3 },
        { id: combatantId('m1'), d20: 2, tie: 2 },
        { id: combatantId('m2'), d20: 1, tie: 1 },
      ],
    }, ctx).fight!;
    const startNow = (fCap as Running).now;
    const h0 = (fCap as Running).rows.find(x => x.id === combatantId('h1'))!;
    const stdInterval = Math.round(RULES.fight.round * (RULES.fight.cost.standard / 100) * (RULES.fight.speedBase / h0.sheet.speed));
    r = reduce(fCap as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: REND_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const hKill = (r.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    expect(holds(hKill, 'hidden')).toBe(true);
    expect(hKill.statuses.some(s => s.key === statusKey('void-shroud'))).toBe(true);
    expect(hKill.at - startNow).toBeLessThan(Math.round(stdInterval * 0.7));
  });
});
