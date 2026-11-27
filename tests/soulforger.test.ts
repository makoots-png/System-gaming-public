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
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import { harmful, helpful, holds } from '../src/core/combat/standing.ts';
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
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { titleSpend } from '../src/core/registry/item-budget.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { BUILT_IN_CLASSES } from '../src/core/registry/jobs.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, canFlipFork, capstoneUnlocked, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { SOULFORGER_SIGNATURE, SOULFORGER_TREE } from '../src/core/registry/class-soulforger.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-27T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

const CANONICAL_FORKS = ['soul-a5-l', 'soul-b5-l', 'soul-c5-l'] as const;
const BRANCH_A_RUSH = ['soul-root', 'soul-a2', 'soul-a3x', 'soul-a3y', 'soul-a4x', 'soul-a4y', 'soul-a5-l', 'soul-a6'] as const;

function canonicalNodes(): ClassNodeId[] {
  return SOULFORGER_TREE.nodes
    .filter(n => !n.forkGroup || (CANONICAL_FORKS as readonly string[]).includes(n.id))
    .map(n => n.id);
}

function allForkBuilds(): ClassNodeId[][] {
  const forks = [
    ['soul-a5-l', 'soul-a5-r'],
    ['soul-b5-l', 'soul-b5-r'],
    ['soul-c5-l', 'soul-c5-r'],
  ] as const;
  const picks: string[][] = [[]];
  for (const [l, r] of forks) {
    const next: string[][] = [];
    for (const p of picks) next.push([...p, l], [...p, r]);
    picks.length = 0;
    picks.push(...next);
  }
  return picks.map(chosen => SOULFORGER_TREE.nodes.filter(n => !n.forkGroup || chosen.includes(n.id)).map(n => n.id));
}

function makeSoulforger(
  nodes: readonly ClassNodeId[] = [],
  opts: { rank?: Rank; stats?: Partial<Record<'pow' | 'dis' | 'vit' | 'ctl', number>>; rules?: typeof RULES } = {},
) {
  const rank = opts.rank ?? 'A';
  const R = opts.rules ?? RULES;
  const base = newHunter(R);
  const stats = { ...base.stats, pow: 106, dis: 58, ...opts.stats };
  const earned = earnClass(
    { ...base, name: 'Soulforger', rank, level: R.rankLevels[rank], stats },
    'Soulforger',
    { at: AT, R },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Soulforger: { ...earned.classes.Soulforger!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, R);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Wave 4 A4: Soulforger metadata, tree, budgets, and round-trip integrity', () => {
  test('Soulforger uses dis+pow (pow: 2, dis: 1), has a valid 26-node / 23-buyable Epic tree summing to 2,295,000 gold at S rank, and all 8 fork builds are legal', () => {
    expect(BUILT_IN_CLASSES.Soulforger).toEqual({
      rarity: 'epic',
      unique: true,
      recRank: 'A',
      pair: 'dis+pow',
      alloc: { pow: 2, dis: 1 },
    });
    expect(CLASS_SIGNATURES.Soulforger).toBe(SOULFORGER_SIGNATURE);
    expect(CLASS_TREES.Soulforger).toBe(SOULFORGER_TREE);
    expect(validateTree(SOULFORGER_TREE)).toEqual([]);
    expect(SOULFORGER_TREE.nodes.length).toBe(TREE_SHAPE.epic.total);

    const full = canonicalNodes();
    expect(full.length).toBe(TREE_SHAPE.epic.buyable);
    expect(repairNodes(SOULFORGER_TREE, full)).toEqual(full);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of full) {
      expect(canBuyNode(SOULFORGER_TREE, bought, id).ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Soulforger', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(2_295_000);

    const rush = BRANCH_A_RUSH.map(nid);
    expect(capstoneUnlocked(SOULFORGER_TREE, rush)).toBe(true);
    expect(canBuyNode(SOULFORGER_TREE, rush, nid('soul-cap')).ok).toBe(true);
    expect(canFlipFork(SOULFORGER_TREE, full, nid('soul-a5-l'), nid('soul-a5-r')).ok).toBe(true);
    expect(canFlipFork(SOULFORGER_TREE, full, nid('soul-b5-l'), nid('soul-b5-r')).ok).toBe(true);
    expect(canFlipFork(SOULFORGER_TREE, full, nid('soul-c5-l'), nid('soul-c5-r')).ok).toBe(true);

    const builds = allForkBuilds();
    expect(builds.length).toBe(8);
    for (const nodes of builds) {
      expect(nodes.length).toBe(TREE_SHAPE.epic.buyable);
      expect(repairNodes(SOULFORGER_TREE, nodes)).toEqual(nodes);
      const h = makeSoulforger(nodes);
      const cp = classPowers(h, RULES);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBeLessThanOrEqual(RULES.fight.kit.scalers);
      expect(cp.worn?.key).toBe(statusKey('soul-forge-grand'));
      const row = hunterRow(h, combatantId('h1'), RULES);
      const hammer = row.abilities.find(a => a.id === wornAbilityId(abilityId('soul-hammerfall')))!;
      const form = formulaOf(hammer, RULES)!;
      expect(partsOf(form)).toBeLessThanOrEqual(FORMULA_PARTS);
      if (nodes.includes(nid('soul-c5-r'))) {
        expect(scalersOf(form, RULES)?.scalers).toEqual([{ measure: 'user', dir: 'over', start: 0.5, scale: 0.18 }]);
      } else {
        expect(scalersOf(form, RULES)).toBeNull();
      }
    }
  });

  test('base signature passes Epic titleSpend and abilityWorth bounds (including Soulbound Blade > 0), reports haste and resist under class, and round-trips wire.defs at 0 bytes', () => {
    const rootB = titleSpend({ bonus: SOULFORGER_SIGNATURE.bonus ?? {}, worn: SOULFORGER_SIGNATURE.worn!.def, band: 'B' }, RULES);
    const rootA = titleSpend({ bonus: SOULFORGER_SIGNATURE.bonus ?? {}, worn: SOULFORGER_SIGNATURE.worn!.def, band: 'A' }, RULES);
    expect(rootB.points).toBeGreaterThan(15);
    expect(rootB.points).toBeLessThan(40);
    expect(rootA.points).toBeGreaterThan(15);
    expect(rootA.points).toBeLessThan(45);

    for (const a of SOULFORGER_SIGNATURE.actives ?? []) {
      const w = abilityWorth(a, RULES, { rank: 'A', on: 'best' });
      expect(w.worth, `${a.name} worth > 0`).toBeGreaterThan(0);
      expect(w.worth, `${a.name} worth <= 2.2`).toBeLessThanOrEqual(2.2);
    }

    const baseH = makeSoulforger([]);
    expect(explain(baseH, 'haste', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(4);
    expect(explain(baseH, 'resist', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(4);

    // Out-of-combat vs combat sheet parity
    for (const nodes of [[], canonicalNodes()]) {
      const h = makeSoulforger(nodes);
      const ooc = hunterSheet(h, RULES).sheet;
      const row = hunterRow(h, combatantId('h1'), RULES);
      const combat = modified(row.origin, row.statuses, RULES).sheet;
      expect(ooc.hpMax).toBe(combat.hpMax);
      expect(ooc.armor).toBe(combat.armor);
      expect(ooc.resist).toBe(combat.resist);
      expect(ooc.mag).toBeCloseTo(combat.mag, 4);
    }

    // Voice, anti-drift, and parser round-trip on all actives and statuses
    const abilities: Ability[] = [...(SOULFORGER_SIGNATURE.actives ?? [])];
    for (const n of SOULFORGER_TREE.nodes) {
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
      'soul-forge',
      'soul-forge-grand',
      'soul-ember',
      'soul-fray',
      'soul-tempered',
      'soul-safeguard',
      'soul-aegis-pulse',
      'soul-sentinel-ward',
    ]) {
      const def = classStatusDef(key);
      expect(def, `classStatusDef(${key})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(key))).toEqual(def);
      expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, key)).toEqual(def);
    }

    // Soul Ember is neutral to both harmful and helpful dispels; Tempered is helpful
    expect(harmful(classStatusDef('soul-ember')!)).toBe(false);
    expect(helpful(classStatusDef('soul-ember')!)).toBe(false);
    expect(harmful(classStatusDef('soul-tempered')!)).toBe(false);
    expect(helpful(classStatusDef('soul-tempered')!)).toBe(true);

    // 0-byte fightWire round-trip at Capstone
    const capH = makeSoulforger(canonicalNodes(), { rules: KEYSTONES_ON });
    const hRow = hunterRow(capH, combatantId('h1'), KEYSTONES_ON);
    const foe = monsterRows({ name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-soul-wire'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    expect(parsed.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('soul-forge-grand'))?.def).toEqual(classStatusDef('soul-forge-grand')!);
  });
});

describe('Soulforger combat mechanics', () => {
  const HAMMER_ID = wornAbilityId(abilityId('soul-hammerfall'));
  const TEMPER_ID = wornAbilityId(abilityId('soul-temper'));
  const ANVIL_ID = wornAbilityId(abilityId('soul-anvil'));
  const BLADE_ID = wornAbilityId(abilityId('soul-blade'));

  test('Channeler protects Hammerfall from heavy hits (which break an unprotected channel); releasing Hammerfall deals charged arcane damage, staggers, applies Soul Fray, grants Soul Ember + shield + mana, and Shatter Fall scales higher at equal charge', () => {
    const startAndTakeHeavyHit = (nodes: readonly ClassNodeId[], id: string, R: typeof RULES) => {
      const ctx = { rules: R };
      const sf = makeSoulforger(nodes, { rules: R });
      const sRow = hunterRow(sf, combatantId('h1'), R);
      const boss = monsterRows({ name: 'Golem', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], R)[0]!;

      let f: Fight = reduce(null, {
        type: 'add',
        fightId: fightId(id),
        rows: [{ ...sRow, place: place(2, 2) }, { ...boss, place: place(3, 2) }],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 10, tie: 1 }] }, ctx).fight!;
      let cur = f as Running;

      // 1. Begin channeling Hammerfall
      let r = reduce(cur, { type: 'act', by: combatantId('h1'), ability: HAMMER_ID, aim: place(3, 2), rolls: { dice: {}, react: {} }, force: true }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      cur = r.fight as Running;
      expect(cur.rows.find(x => x.id === combatantId('h1'))!.channel?.state).toBe('holding');

      // 2. Boss hits Soulforger hard while channeling
      const swing = boss.abilities[0]!.id;
      r = reduce(cur, {
        type: 'act',
        by: combatantId('m1'),
        ability: swing,
        aim: combatantId('h1'),
        rolls: { dice: { [combatantId('h1')]: [10] }, react: { [combatantId('h1')]: 1 } },
        force: true,
      }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      return r.fight as Running;
    };

    // Fail-capable control: the exact same heavy hit with keystones off breaks the unprotected Hammerfall channel!
    const unprotected = startAndTakeHeavyHit([], 'f-soul-chan-unprotected', RULES);
    expect(unprotected.rows.find(x => x.id === combatantId('h1'))!.channel?.state).toBe('broken');

    const ctx = { rules: KEYSTONES_ON };
    const runChannel = (nodes: readonly ClassNodeId[], id: string) => {
      let cur = startAndTakeHeavyHit(nodes, id, KEYSTONES_ON);
      const sfUnderFire = cur.rows.find(x => x.id === combatantId('h1'))!;
      expect(sfUnderFire.channel?.state).toBe('holding');

      // 3. Advance to Soulforger's next turn, spend some mana first to confirm +4 mana recovery, then release
      const nextAt = tick(cur.now + 1000);
      cur = {
        ...cur,
        currentId: combatantId('m1'),
        rows: cur.rows.map(b => (b.id === combatantId('h1') ? { ...b, at: nextAt, mana: Math.max(0, b.mana - 10) } : { ...b, at: tick(cur.now + 1500) })),
      };
      let r = reduce(cur, { type: 'endTurn', by: combatantId('m1') }, ctx);
      cur = r.fight as Running;
      expect(cur.currentId).toBe(combatantId('h1'));
      expect(cur.rows.find(x => x.id === combatantId('h1'))!.channel?.charge).toBe(2);

      const manaBefore = cur.rows.find(x => x.id === combatantId('h1'))!.mana;
      const bossHpBefore = rowHp(cur.rows.find(x => x.id === combatantId('m1'))!);
      const bossResBefore = cur.rows.find(x => x.id === combatantId('m1'))!.sheet.resist;

      r = reduce(cur, {
        type: 'release',
        by: combatantId('h1'),
        rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      const after = r.fight as Running;
      const sfAfter = after.rows.find(x => x.id === combatantId('h1'))!;
      const bossAfter = after.rows.find(x => x.id === combatantId('m1'))!;
      return { sfAfter, bossAfter, manaGain: sfAfter.mana - manaBefore, dealt: bossHpBefore - rowHp(bossAfter), bossResBefore };
    };

    const base = runChannel([], 'f-soul-chan-base');
    expect(base.dealt).toBeGreaterThan(0);
    expect(base.bossAfter.stagger?.fill ?? 0).toBeGreaterThan(0);
    expect(base.bossAfter.statuses.some(s => s.key === statusKey('soul-fray'))).toBe(true);
    expect(base.bossAfter.sheet.resist).toBe(Math.max(0, base.bossResBefore - 12));
    expect(base.sfAfter.statuses.find(s => s.key === statusKey('soul-ember'))?.stacks).toBe(1);
    expect(base.sfAfter.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(base.manaGain).toBe(4);
    expect(base.sfAfter.statuses.some(s => s.key === statusKey('keystone-gathered'))).toBe(true);

    // Shatter Fall (soul-a5-r) scales at 1 + 0.65 * charge vs base 1 + 0.5 * charge
    const shatterNodes = ['soul-root', 'soul-a2', 'soul-a3x', 'soul-a3y', 'soul-a4x', 'soul-a4y', 'soul-a5-r'].map(nid);
    const shatter = runChannel(shatterNodes, 'f-soul-chan-shatter');
    expect(shatter.dealt).toBeGreaterThan(base.dealt);

    // Crucible Fall (soul-a5-l) widens Hammerfall to radius 3 and 0.35 stagger
    const crucNodes = ['soul-root', 'soul-a2', 'soul-a3x', 'soul-a3y', 'soul-a4x', 'soul-a4y', 'soul-a5-l'].map(nid);
    const crucAb = hunterRow(makeSoulforger(crucNodes), combatantId('h1'), RULES).abilities.find(a => a.id === HAMMER_ID)!;
    expect(crucAb.shape.kind === 'radius' && crucAb.shape.radius).toBe(tiles(3));
    expect(crucAb.ops.some(o => o.op === 'stagger' && o.share === 0.35)).toBe(true);
  });

  test('Soulbound Blade gates on 3 neutral Soul Embers (fed by kills + channels), spends 3 stacks to shield and summon a skirmisher, and Runic Sentinel summons a taunting brute', () => {
    const ctx = { rules: RULES };
    const sf = makeSoulforger([]);
    const sRow = hunterRow(sf, combatantId('h1'), RULES);
    const [m1, m2] = monsterRows({ name: 'Scout', rank: 'A', archetype: 'skirmisher', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1'), combatantId('m2')], RULES);
    const foeAlive = monsterRows({ name: 'Ogre', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m3')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-soul-blade-live'),
      rows: [
        { ...sRow, place: place(2, 2) },
        { ...m1!, life: { at: 'up', hp: 1 }, place: place(4, 2) },
        { ...m2!, life: { at: 'up', hp: 1 }, place: place(6, 2) },
        { ...foeAlive, place: place(10, 2) },
      ],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 20, tie: 4 },
        { id: combatantId('m1'), d20: 3, tie: 3 },
        { id: combatantId('m2'), d20: 2, tie: 2 },
        { id: combatantId('m3'), d20: 1, tie: 1 },
      ],
    }, ctx).fight!;
    let cur = f as Running;

    // 1. At 0 Embers, Soulbound Blade is refused by its holds gate
    let r = reduce(cur, { type: 'act', by: combatantId('h1'), ability: BLADE_ID, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.some(e => e.type === 'refused')).toBe(true);

    // 2. Kill two foes with Soul Anvil (rad2 centered at (5, 2) hits both (4, 2) and (6, 2)) -> +4 Embers (2 per kill) while Ogre keeps the fight running
    r = reduce(cur, {
      type: 'act',
      by: combatantId('h1'),
      ability: ANVIL_ID,
      aim: place(5, 2),
      rolls: { dice: { [combatantId('m1')]: [5], [combatantId('m2')]: [5] }, react: { [combatantId('m1')]: 2, [combatantId('m2')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cur = r.fight as Running;
    expect(cur.rows.find(x => x.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('soul-ember'))?.stacks).toBe(4);

    // Neutral Soul Embers survive both a helpful purge and a harmful dispel in live combat
    const purge = abilityOf('curse', {
      id: abilityId('test-purge-embers'),
      name: 'Purge Test',
      aim: 'foe',
      delivery: { kind: 'sure' },
      effect: null,
      ops: [
        { op: 'dispel', which: 'all', kind: 'helpful' },
        { op: 'dispel', which: 'all' },
      ],
    }, RULES);
    const withPurge: Running = {
      ...cur,
      rows: cur.rows.map(b => (b.id === combatantId('m3') ? { ...b, abilities: [...b.abilities, purge] } : b)),
    };
    r = reduce(withPurge, { type: 'act', by: combatantId('m3'), ability: purge.id, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cur = r.fight as Running;
    expect(cur.rows.find(x => x.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('soul-ember'))?.stacks).toBe(4);

    // 3. Cast Soulbound Blade: spends 3 Embers (leaving 1), grants 12% max HP shield, summons skirmisher Soulbound Blade
    r = reduce(cur, { type: 'act', by: combatantId('h1'), ability: BLADE_ID, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterBlade = r.fight as Running;
    const sfAfter = afterBlade.rows.find(x => x.id === combatantId('h1'))!;
    expect(sfAfter.statuses.find(s => s.key === statusKey('soul-ember'))?.stacks).toBe(1);
    expect(sfAfter.shield?.amount ?? 0).toBeGreaterThan(0);
    const blade = afterBlade.rows.find(x => x.kind === 'summon' && x.name === 'Soulbound Blade')!;
    expect(blade).toBeDefined();
    expect(blade.side).toBe('party');
    expect(blade.origin.kind === 'monster' && blade.origin.archetype).toBe('skirmisher');

    // 4. Runic Sentinel fork (soul-c5-l): summons a brute with 2-tile foe taunt aura forcing nearby foe to target it
    const sentNodes = ['soul-root', 'soul-c2', 'soul-c3x', 'soul-c3y', 'soul-c4x', 'soul-c4y', 'soul-c5-l'].map(nid);
    const sfSent = hunterRow(makeSoulforger(sentNodes), combatantId('h1'), RULES);
    const seededEmber = statusOn(classStatusDef('soul-ember')!, { key: statusKey('soul-ember'), source: { id: combatantId('h1'), tier: 4 }, until: null, since: tick(0), settledAt: tick(0) }, 3);
    const foeNear = monsterRows({ name: 'Raider', rank: 'A', archetype: 'brute', kind: 'elite', tweak: {}, abilities: [], statuses: [] }, [combatantId('m4')], RULES)[0]!;
    let fSent: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-soul-sentinel'),
      rows: [{ ...sfSent, statuses: [...sfSent.statuses, seededEmber], place: place(3, 3) }, { ...foeNear, place: place(3, 2) }],
      openings: [],
    }, ctx).fight!;
    fSent = reduce(fSent, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m4'), d20: 1, tie: 1 }] }, ctx).fight!;
    r = reduce(fSent as Running, { type: 'act', by: combatantId('h1'), ability: BLADE_ID, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const withSent = r.fight as Running;
    const sent = withSent.rows.find(x => x.kind === 'summon' && x.name === 'Runic Sentinel')!;
    expect(sent).toBeDefined();
    expect(sent.origin.kind === 'monster' && sent.origin.archetype).toBe('brute');
    expect(sent.statuses.some(s => s.key === statusKey('soul-sentinel-ward'))).toBe(true);
    // Foe at (3, 2) is adjacent to both Soulforger (3, 3) and Runic Sentinel (2, 2) and holds its taunt zone hold -> aiming at Soulforger is refused!
    const foeTaunted = withSent.rows.find(x => x.id === combatantId('m4'))!;
    expect(foeTaunted.statuses.some(s => s.def.ops.some(o => o.op === 'taunt'))).toBe(true);
    const swingAtSf = reduce(withSent, {
      type: 'act',
      by: combatantId('m4'),
      ability: foeNear.abilities[0]!.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [5] }, react: { [combatantId('h1')]: 1 } },
      force: true,
    }, ctx);
    expect(swingAtSf.effects.some(e => e.type === 'refused' && e.reason === 'taunted')).toBe(true);
  });

  test('Aegis Temper keeps 2-round Tempered via separate 1-round soul-safeguard across nearby allies (sparing foes), and Quench Temper dispels + restores 8 mana', () => {
    const ctx = { rules: RULES };
    const ally0 = hunterRow({ ...newHunter(RULES), id: 'h-ally', name: 'Mira', rank: 'A', level: 50 }, combatantId('h2'), RULES);
    const foe0 = monsterRows({ name: 'Imp', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    // 1. Aegis Temper (soul-b5-l): aimed ally at (4, 3), Soulforger at (2, 3) [2 tiles away], foe at (5, 3) [1 tile away]
    const aegisNodes = ['soul-root', 'soul-b2', 'soul-b3x', 'soul-b3y', 'soul-b4x', 'soul-b4y', 'soul-b5-l'].map(nid);
    const sfAegis = hunterRow(makeSoulforger(aegisNodes), combatantId('h1'), RULES);
    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-soul-aegis'),
      rows: [{ ...sfAegis, place: place(2, 3) }, { ...ally0, place: place(4, 3) }, { ...foe0, place: place(5, 3) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const castNow = (f as Running).now;
    let r = reduce(f as Running, { type: 'act', by: combatantId('h1'), ability: TEMPER_ID, aim: combatantId('h2'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterAegis = r.fight as Running;

    for (const id of [combatantId('h1'), combatantId('h2')]) {
      const b = afterAegis.rows.find(x => x.id === id)!;
      expect(b.shield?.amount ?? 0).toBeGreaterThan(0);
      const tempered = b.statuses.find(s => s.key === statusKey('soul-tempered'))!;
      const ward = b.statuses.find(s => s.key === statusKey('soul-safeguard'))!;
      expect(tempered, `${id} holds Tempered`).toBeDefined();
      expect(ward, `${id} holds soul-safeguard`).toBeDefined();
      // Tempered keeps its full 2 rounds (never clamped to 1 round by safeguard!)
      expect(tempered.until).toBe(tick(castNow + 2 * RULES.fight.round));
      expect(ward.until).toBe(tick(castNow + RULES.fight.round));
      expect(holds(b, 'safeguard')).toBe(true);
      expect(b.statuses.some(s => s.key === statusKey('soul-aegis-pulse'))).toBe(false);
    }
    // Foe within 1 tile of aimed ally is completely spared
    const foeAfter = afterAegis.rows.find(x => x.id === combatantId('m1'))!;
    expect(foeAfter.shield).toBeNull();
    expect(foeAfter.statuses.some(s => s.key === statusKey('soul-tempered'))).toBe(false);
    expect(foeAfter.statuses.some(s => s.key === statusKey('soul-safeguard'))).toBe(false);

    // 2. Quench Temper (soul-b5-r): dispels oldest harmful status and restores 8 mana
    const quenchNodes = ['soul-root', 'soul-b2', 'soul-b3x', 'soul-b3y', 'soul-b4x', 'soul-b4y', 'soul-b5-r'].map(nid);
    const sfQuench = hunterRow(makeSoulforger(quenchNodes), combatantId('h1'), RULES);
    const burn = statusOn(BUILT_IN_STATUSES.burning, { key: statusKey('burning'), source: { id: combatantId('m1'), tier: 4 }, until: tick(4000), since: tick(0), settledAt: tick(0) });
    const hurtAlly = { ...ally0, mana: 2, statuses: [...ally0.statuses, burn] };
    let fq: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-soul-quench'),
      rows: [{ ...sfQuench, place: place(2, 3) }, { ...hurtAlly, place: place(4, 3) }, { ...foe0, place: place(7, 3) }],
      openings: [],
    }, ctx).fight!;
    fq = reduce(fq, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    r = reduce(fq as Running, { type: 'act', by: combatantId('h1'), ability: TEMPER_ID, aim: combatantId('h2'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const allyQuenched = (r.fight as Running).rows.find(x => x.id === combatantId('h2'))!;
    expect(allyQuenched.statuses.some(s => s.key === statusKey('burning'))).toBe(false);
    expect(allyQuenched.statuses.some(s => s.key === statusKey('soul-tempered'))).toBe(true);
    expect(allyQuenched.mana).toBe(Math.min(allyQuenched.sheet.manaMax, 10));
  });

  test('Soul Anvil leaves a party-sparing 3-round burn zone, and Capstone Grand Soulsmith grants 2 Embers, 10% shield, 8 mana, and 20% turn refund on channel release', () => {
    const ctx = { rules: RULES };
    const capH = makeSoulforger(canonicalNodes());
    const sRow = hunterRow(capH, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Warden', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-soul-cap'),
      rows: [{ ...sRow, place: place(2, 2) }, { ...foe, place: place(5, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    let cur = f as Running;

    // 1. Cast Soul Anvil at (5, 2) -> lays 3-round party-sparing Soul Anvil zone
    const anvilNow = cur.now;
    let r = reduce(cur, {
      type: 'act',
      by: combatantId('h1'),
      ability: ANVIL_ID,
      aim: place(5, 2),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cur = r.fight as Running;
    const zone = cur.zones.find(z => z.name === 'Soul Anvil')!;
    expect(zone).toBeDefined();
    expect(zone.spares).toBe('party');
    expect(zone.until).toBe(tick(anvilNow + 3 * RULES.fight.round));

    // 2. Channel and release Hammerfall under Grand Soulsmith -> +2 Embers, 10% shield, +8 mana, 20% turn refund
    cur = {
      ...cur,
      currentId: combatantId('h1'),
      rows: cur.rows.map(b => (b.id === combatantId('h1') ? { ...b, at: cur.now, mana: Math.max(0, b.mana - 12), shield: null } : b)),
    };
    r = reduce(cur, { type: 'act', by: combatantId('h1'), ability: HAMMER_ID, aim: place(5, 2), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    cur = r.fight as Running;

    const relNow = tick(cur.now + 1000);
    cur = {
      ...cur,
      currentId: combatantId('h1'),
      now: relNow,
      rows: cur.rows.map(b => (b.id === combatantId('h1') ? { ...b, at: relNow, mana: Math.max(0, b.mana - 10) } : b)),
    };
    const sfBeforeRel = cur.rows.find(x => x.id === combatantId('h1'))!;
    const manaBefore = sfBeforeRel.mana;
    const stdInterval = interval(sfBeforeRel.speed, cost(RULES.fight.cost.standard), RULES.fight);

    r = reduce(cur, {
      type: 'release',
      by: combatantId('h1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterRel = r.fight as Running;
    const sfAfter = afterRel.rows.find(x => x.id === combatantId('h1'))!;
    expect(sfAfter.statuses.find(s => s.key === statusKey('soul-ember'))?.stacks).toBe(2);
    expect(sfAfter.shield?.amount ?? 0).toBeGreaterThanOrEqual(Math.round(sfBeforeRel.sheet.hpMax * 0.1));
    expect(sfAfter.mana - manaBefore).toBe(8);
    expect(sfAfter.at - relNow).toBe(stdInterval - Math.round(stdInterval * 20 / 100));
  });
});
