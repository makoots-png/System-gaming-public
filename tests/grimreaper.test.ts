import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, BONUS_KEYS, RULES } from '../src/core/rules.ts';
import type { BonusKey, Rank } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { fightId, parseClassNodeId, parseSaveId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, ItemId } from '../src/core/ids.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, heldKeystones, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { combatantId, abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import { damageShare, exposedOf, holds } from '../src/core/combat/standing.ts';
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
import { titleSpend } from '../src/core/registry/item-budget.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { BUILT_IN_CLASSES } from '../src/core/registry/jobs.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, canFlipFork, capstoneUnlocked, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { GRIMREAPER_SIGNATURE, GRIMREAPER_TREE } from '../src/core/registry/class-grimreaper.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-26T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

const CANONICAL_FORKS = ['reaper-a5-l', 'reaper-b5-l', 'reaper-c5-l'] as const;
const BRANCH_A_RUSH = ['reaper-root', 'reaper-a2', 'reaper-a3x', 'reaper-a3y', 'reaper-a4x', 'reaper-a4y', 'reaper-a5-l', 'reaper-a6'] as const;

function canonicalNodes(): ClassNodeId[] {
  return GRIMREAPER_TREE.nodes
    .filter(n => !n.forkGroup || (CANONICAL_FORKS as readonly string[]).includes(n.id))
    .map(n => n.id);
}

function allForkBuilds(): ClassNodeId[][] {
  const groups = new Map<string, ClassNodeId[]>();
  for (const n of GRIMREAPER_TREE.nodes) {
    if (!n.forkGroup) continue;
    const list = groups.get(n.forkGroup) ?? [];
    list.push(n.id);
    groups.set(n.forkGroup, list);
  }
  const picks: ClassNodeId[][] = [[]];
  for (const [a, b] of groups.values()) {
    const next: ClassNodeId[][] = [];
    for (const p of picks) next.push([...p, a!], [...p, b!]);
    picks.length = 0;
    picks.push(...next);
  }
  return picks.map(chosen => GRIMREAPER_TREE.nodes.filter(n => !n.forkGroup || chosen.includes(n.id)).map(n => n.id));
}

function makeGrimreaper(
  nodes: readonly ClassNodeId[] = [],
  opts: { rank?: Rank; stats?: Partial<Record<'str' | 'ins' | 'vit' | 'agi', number>>; rules?: typeof RULES } = {},
) {
  const rank = opts.rank ?? 'A';
  const R = opts.rules ?? RULES;
  const base = newHunter(R);
  const stats = { ...base.stats, str: 106, ins: 58, ...opts.stats };
  const earned = earnClass(
    { ...base, name: 'Grimreaper', rank, level: R.rankLevels[rank], stats },
    'Grimreaper',
    { at: AT, R },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Grimreaper: { ...earned.classes.Grimreaper!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, R);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Wave 2 PR 5: Grimreaper metadata, tree, pricing, and round-trip integrity', () => {
  test('Grimreaper uses str+ins (2:1) and awakens Executioner, with a valid 26-node / 23-buyable Epic tree summing to 2,295,000 gold at S rank', () => {
    expect(BUILT_IN_CLASSES.Grimreaper).toEqual({
      rarity: 'epic',
      unique: true,
      recRank: 'A',
      pair: 'str+ins',
      alloc: { str: 2, ins: 1 },
    });
    expect(CLASS_SIGNATURES.Grimreaper).toBe(GRIMREAPER_SIGNATURE);
    expect(CLASS_TREES.Grimreaper).toBe(GRIMREAPER_TREE);
    expect(validateTree(GRIMREAPER_TREE)).toEqual([]);
    expect(GRIMREAPER_TREE.nodes.length).toBe(TREE_SHAPE.epic.total);

    const h = makeGrimreaper([], { rules: KEYSTONES_ON });
    const keys = heldKeystones(h, KEYSTONES_ON);
    const exec = keys.find(k => k.keystone.name === 'Executioner');
    expect(exec).toBeDefined();

    const full = canonicalNodes();
    expect(full.length).toBe(TREE_SHAPE.epic.buyable);
    expect(repairNodes(GRIMREAPER_TREE, full)).toEqual(full);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of full) {
      expect(canBuyNode(GRIMREAPER_TREE, bought, id).ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Grimreaper', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(2_295_000);

    // Early capstone unlock by finishing Branch A alone
    const rush = BRANCH_A_RUSH.map(nid);
    expect(capstoneUnlocked(GRIMREAPER_TREE, rush)).toBe(true);
    expect(canBuyNode(GRIMREAPER_TREE, rush, nid('reaper-cap')).ok).toBe(true);

    // Fork flip legality on all three D5 forks
    expect(canFlipFork(GRIMREAPER_TREE, full, nid('reaper-a5-l'), nid('reaper-a5-r')).ok).toBe(true);
    expect(canFlipFork(GRIMREAPER_TREE, full, nid('reaper-b5-l'), nid('reaper-b5-r')).ok).toBe(true);
    expect(canFlipFork(GRIMREAPER_TREE, full, nid('reaper-c5-l'), nid('reaper-c5-r')).ok).toBe(true);
  });

  test('all 8 legal fork builds respect CLASS_ACTIVES_MAX, kit.scalers <= 2, scalersOf read-back, FORMULA_PARTS, and MAX_ABILITIES priority', () => {
    const bombs = Array.from({ length: 12 }, (_, idx) => ({
      id: parseSaveId<'i'>(`i${300 + idx}`) as ItemId,
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

    const builds = allForkBuilds();
    expect(builds.length).toBe(8);
    for (const nodes of builds) {
      expect(nodes.length).toBe(TREE_SHAPE.epic.buyable);
      expect(repairNodes(GRIMREAPER_TREE, nodes)).toEqual(nodes);
      const h = makeGrimreaper(nodes);
      const cp = classPowers(h, RULES);
      expect(cp.actives.length).toBeLessThanOrEqual(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBeLessThanOrEqual(RULES.fight.kit.scalers);
      expect(cp.worn?.key).toBe(statusKey('reaper-ledger-apex'));

      const row = hunterRow({ ...h, items: [...h.items, ...bombs] }, combatantId('h1'), RULES);
      for (const aid of ['reaper-reap', 'reaper-scythe-sweep', 'reaper-shadowstep', 'reaper-guillotine']) {
        expect(row.abilities.map(a => a.id)).toContain(wornAbilityId(abilityId(aid)));
      }
      const reapAb = row.abilities.find(a => a.id === wornAbilityId(abilityId('reaper-reap')))!;
      const reapForm = formulaOf(reapAb, RULES)!;
      const hasScaler = nodes.includes(nid('reaper-c5-r'));
      if (hasScaler) {
        expect(scalersOf(reapForm, RULES)?.scalers.length).toBe(1);
      } else {
        expect(scalersOf(reapForm, RULES)).toBeNull();
      }
      const bombAb = row.abilities.find(a => a.name === 'Bomb 0');
      if (bombAb) {
        const bombForm = formulaOf(bombAb, RULES);
        expect(bombForm && scalersOf(bombForm, RULES)).toBeNull();
      }
      for (const a of row.abilities) {
        const form = formulaOf(a, RULES);
        if (form) expect(partsOf(form), `${a.name} FORMULA_PARTS`).toBeLessThanOrEqual(FORMULA_PARTS);
      }
    }
  });

  test('all base and upgraded abilities and statuses round-trip identically through parsers, classStatusDef, shippedStatusDef, and fightWire (0 bytes in wire.defs)', () => {
    const abilities: Ability[] = [...(GRIMREAPER_SIGNATURE.actives ?? [])];
    for (const n of GRIMREAPER_TREE.nodes) {
      for (const g of n.gifts) if (g.kind === 'replace-active') abilities.push(g.active);
    }
    expect(abilities.length).toBe(9);
    for (const a of abilities) {
      expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `parseAbility(${a.name})`).toEqual(a);
    }

    for (const key of [
      'reaper-ledger',
      'reaper-ledger-apex',
      'reaper-mark',
      'reaper-harvest',
      'reaper-harvest-apex',
      'reaper-phantom',
      'reaper-phantom-shroud',
      'reaper-phantom-veil',
      'reaper-shroud-ward',
      'reaper-veil',
    ]) {
      const def = classStatusDef(key);
      expect(def, `classStatusDef(${key})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(key))).toEqual(def);
      expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, key)).toEqual(def);
    }

    const h = makeGrimreaper(canonicalNodes(), { rules: KEYSTONES_ON });
    const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
    const foe = monsterRows({ name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-reaper-wire'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    const worn = parsed.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('reaper-ledger-apex'));
    expect(worn?.def).toEqual(classStatusDef('reaper-ledger-apex')!);
  });

  test('out-of-combat hunterSheet matches combat modified sheet, tree node copy matches numbers and voice.md, and pricing is finite', () => {
    for (const nodes of [[], canonicalNodes()]) {
      const h = makeGrimreaper(nodes);
      const ooc = hunterSheet(h, RULES).sheet;
      const row = hunterRow(h, combatantId('h1'), RULES);
      const combat = modified(row.origin, row.statuses, RULES).sheet;
      expect(ooc.hpMax).toBe(combat.hpMax);
      expect(ooc.phys).toBeCloseTo(combat.phys, 4);
      expect(ooc.speed).toBe(combat.speed);
    }
    const baseH = makeGrimreaper([]);
    expect(explain(baseH, 'phys', RULES).parts.find(p => p.from === 'class')?.amount ?? 0).toBeGreaterThan(0);
    expect(explain(baseH, 'react', RULES).parts.find(p => p.from === 'class')?.amount ?? 0).toBeGreaterThan(0);

    for (const n of GRIMREAPER_TREE.nodes) {
      expect(n.desc).not.toMatch(/[—–;!]|\bjust\b/i);
      for (const g of n.gifts) {
        if (g.kind === 'bonus') {
          for (const k of BONUS_KEYS) {
            const v = g.bonus[k as BonusKey];
            if (typeof v !== 'number' || v === 0) continue;
            const needle = k === 'critSize'
              ? String(v / 100)
              : (BONUS_HUNDREDTHS as readonly string[]).includes(k) ? `${v}%` : String(v);
            expect(n.desc, `${n.id} desc missing ${k}=${needle}: "${n.desc}"`).toContain(needle);
          }
        } else if (g.kind === 'scaler') {
          const pct = `${Math.round(g.scaler.scale * 100)}%`;
          expect(n.desc, `${n.id} desc missing scaler ${pct}: "${n.desc}"`).toContain(pct);
        }
      }
    }

    const rootB = titleSpend({ bonus: GRIMREAPER_SIGNATURE.bonus ?? {}, worn: GRIMREAPER_SIGNATURE.worn!.def, band: 'B' }, RULES);
    expect(Number.isFinite(rootB.points)).toBe(true);
    expect(rootB.points).toBeGreaterThan(0);
    for (const a of GRIMREAPER_SIGNATURE.actives ?? []) {
      const w = abilityWorth(a, RULES, { rank: 'A', on: 'best' });
      expect(Number.isFinite(w.worth), `${a.name} worth finite`).toBe(true);
      if (a.effect) {
        expect(w.worth, `${a.name} worth > 0`).toBeGreaterThan(0);
      } else {
        expect(w.worth, `${a.name} utility worth >= 0`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('Grimreaper combat mechanics', () => {
  const REAP_ID = wornAbilityId(abilityId('reaper-reap'));
  const SWEEP_ID = wornAbilityId(abilityId('reaper-scythe-sweep'));
  const STEP_ID = wornAbilityId(abilityId('reaper-shadowstep'));
  const GUILLOTINE_ID = wornAbilityId(abilityId('reaper-guillotine'));
  const MARK_KEY = statusKey('reaper-mark');

  test('Executioner fires on both Reap and Guillotine strikes and deals extra physical damage scaling below 50% target HP', () => {
    const ctx = { rules: KEYSTONES_ON };
    const reaper = makeGrimreaper([], { rules: KEYSTONES_ON });
    const rRow = hunterRow(reaper, combatantId('h1'), KEYSTONES_ON);
    expect(rRow.statuses.some(s => s.def.label === 'Executioner')).toBe(true);

    const foeFull = monsterRows({ name: 'Golem', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    const runReap = (startHp: number) => {
      const target = { ...foeFull, life: { at: 'up' as const, hp: startHp }, place: place(3, 2) };
      let f: Fight = reduce(null, {
        type: 'add',
        fightId: fightId(`f-exec-${startHp}`),
        rows: [{ ...rRow, place: place(2, 2) }, target],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
      const r = reduce(f as Running, {
        type: 'act',
        by: combatantId('h1'),
        ability: REAP_ID,
        aim: combatantId('m1'),
        rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 10 } },
        force: true,
      }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      const after = r.fight as Running;
      return {
        dealt: startHp - rowHp(after.rows.find(x => x.id === combatantId('m1'))!),
        log: after.log.map(l => l.text).join('\n'),
        after,
      };
    };

    const fullHp = rowHp(foeFull);
    const high = runReap(fullHp);
    const low = runReap(Math.floor(fullHp * 0.2));
    expect(high.log).toContain('Executioner');
    expect(low.log).toContain('Executioner');
    // Executioner scales from 0.2*phys above 50% HP up toward 0.4*phys near 0 HP.
    expect(low.dealt).toBeGreaterThan(high.dealt);

    // Guillotine (true damage strike) also fires Executioner on hitDealt with KIND_TAG.strike
    const rG = reduce({ ...low.after, now: tick(1200) }, {
      type: 'act',
      by: combatantId('h1'),
      ability: GUILLOTINE_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(rG.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterG = rG.fight as Running;
    // Fight log is newest-first; slice the newly prepended entries
    const gLog = afterG.log.slice(0, afterG.log.length - low.after.log.length).map(l => l.text).join('\n');
    expect(gLog).toContain('Executioner');
  });

  test('Guillotine requires Reaper\'s Mark, spends all stacks for bonus true damage, stays capped at 15% target max HP on bosses, and finishes <30% HP foes', () => {
    const ctx = { rules: RULES };
    const reaper = makeGrimreaper([]);
    const rRow = hunterRow(reaper, combatantId('h1'), RULES);
    const markDef = classStatusDef('reaper-mark')!;

    // 1. Refused without Reaper's Mark
    const dummy = monsterRows({ name: 'Brute', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let f0: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-guillotine-gate'),
      rows: [{ ...rRow, place: place(2, 2) }, { ...dummy, place: place(3, 2) }],
      openings: [],
    }, ctx).fight!;
    f0 = reduce(f0, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const gatedRes = reduce(f0 as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: GUILLOTINE_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(gatedRes.effects.some(e => e.type === 'refused')).toBe(true);

    // 2. Reaper's Mark exposes +0.5/stack (2 stacks = +1 crit face) and slows 5%/stack
    const markedRow = (stacks: number, hpShare: number, hpMult: number) => {
      const m = monsterRows({ name: 'Boss', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: hpMult }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
      const mark = statusOn(markDef, { key: MARK_KEY, source: { id: combatantId('h1'), tier: 4 }, until: tick(3000), since: tick(0), settledAt: tick(0) }, stacks);
      const hpMax = rowHp(m);
      const hp = Math.max(1, Math.round(hpMax * hpShare));
      return { ...m, life: { at: 'up' as const, hp }, statuses: [...m.statuses, mark], place: place(3, 2) };
    };
    expect(exposedOf(markedRow(1, 0.8, 5))).toBe(0);
    expect(exposedOf(markedRow(2, 0.8, 5))).toBe(1);
    expect(exposedOf(markedRow(3, 0.8, 5))).toBe(1);

    // 3. Spending 3 stacks deals strictly more true damage than 1 stack when under the 15% cap, and consumes all marks
    const swingGuillotine = (stacks: number, hpShare: number, hpMult: number, reactRoll = 10) => {
      const m = markedRow(stacks, hpShare, hpMult);
      const before = rowHp(m);
      let f: Fight = reduce(null, {
        type: 'add',
        fightId: fightId(`f-g-${stacks}-${hpShare}-${hpMult}-${reactRoll}`),
        rows: [{ ...rRow, place: place(2, 2) }, m],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
      const hpMax = (f as Running).rows.find(x => x.id === combatantId('m1'))!.sheet.hpMax;
      const r = reduce(f as Running, {
        type: 'act',
        by: combatantId('h1'),
        ability: GUILLOTINE_ID,
        aim: combatantId('m1'),
        rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: reactRoll } },
        force: true,
      }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      const afterRow = (r.fight as Running).rows.find(x => x.id === combatantId('m1'))!;
      return { dealt: before - rowHp(afterRow), afterRow, hpMax };
    };

    // High HP boss (hpMult 10 -> 15% cap is well above raw damage at 80% HP): 3 stacks strictly beats 1 stack
    const s1 = swingGuillotine(1, 0.8, 10);
    const s3 = swingGuillotine(3, 0.8, 10);
    expect(s3.dealt).toBeGreaterThan(s1.dealt);
    expect(s3.afterRow.statuses.some(s => s.key === MARK_KEY)).toBe(false);

    // Cap check: on a boss at 25% HP (missing = 0.75, execute multiplier active), non-crit raw is capped at 0.15 * hpMax
    const bossCapped = swingGuillotine(3, 0.25, 1);
    const expectedCap = Math.round(0.15 * bossCapped.hpMax);
    expect(bossCapped.dealt).toBeLessThanOrEqual(expectedCap + 1);

    // Even on a crit (reactRoll = 1), capped Guillotine stays safely below one-shotting the boss (<= 0.15 * critSize * hpMax)
    const rCritSize = modified(rRow.origin, rRow.statuses, RULES).sheet.critSize;
    const bossCrit = swingGuillotine(3, 0.8, 1, 1);
    expect(bossCrit.dealt).toBeLessThanOrEqual(Math.ceil(0.15 * bossCrit.hpMax * rCritSize) + 1);
    expect(bossCrit.afterRow.life.at).toBe('up');

    // Works cleanly on a normal foe already under 30% HP (14% HP) and kills it
    const normalFoe = monsterRows({ name: 'Goblin', rank: 'A', archetype: 'skirmisher', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const lowHp = Math.max(1, Math.round(rowHp(normalFoe) * 0.14));
    const lowMark = statusOn(markDef, { key: MARK_KEY, source: { id: combatantId('h1'), tier: 4 }, until: tick(3000), since: tick(0), settledAt: tick(0) }, 2);
    let fLow: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-g-low30'),
      rows: [
        { ...rRow, place: place(2, 2) },
        { ...normalFoe, life: { at: 'up', hp: lowHp }, statuses: [...normalFoe.statuses, lowMark], place: place(3, 2) },
      ],
      openings: [],
    }, ctx).fight!;
    fLow = reduce(fLow, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const rLow = reduce(fLow as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: GUILLOTINE_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [8] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(rLow.effects.filter(e => e.type === 'refused')).toEqual([]);
    const fallen = rLow.fight!.rows.find(x => x.id === combatantId('m1'))!;
    expect(fallen.life.at).toBe('dead');
  });

  test("Death's Ledger heals 12% max HP, refunds 100% turn, grants Harvest once/round, splashes Reaper's Mark within 2 tiles on every kill, and enables Guillotine chaining", () => {
    const ctx = { rules: RULES };
    const reaper = makeGrimreaper([]);
    const rRow0 = hunterRow(reaper, combatantId('h1'), RULES);
    const rHpMax = modified(rRow0.origin, rRow0.statuses, RULES).sheet.hpMax;
    const hurtHp = Math.round(rHpMax * 0.5);
    const rRow = { ...rRow0, life: { at: 'up' as const, hp: hurtHp } };

    const [m1, m2, m3] = monsterRows({ name: 'Cultist', rank: 'A', archetype: 'skirmisher', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1'), combatantId('m2'), combatantId('m3')], RULES);
    // m1 adjacent (3,2) at 1 HP; m2 within 2 tiles (4,2) at 1 HP; m3 far away (8,2)
    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-ledger-chain'),
      rows: [
        { ...rRow, place: place(2, 2) },
        { ...m1!, life: { at: 'up', hp: 1 }, place: place(3, 2) },
        { ...m2!, life: { at: 'up', hp: 1 }, place: place(4, 2) },
        { ...m3!, place: place(8, 2) },
      ],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 20, tie: 4 },
        { id: combatantId('m1'), d20: 5, tie: 3 },
        { id: combatantId('m2'), d20: 4, tie: 2 },
        { id: combatantId('m3'), d20: 1, tie: 1 },
      ],
    }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    const startNow = f.now;
    const r1 = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: REAP_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(r1.effects.filter(e => e.type === 'refused')).toEqual([]);
    const after1 = r1.fight as Running;
    const hAfter1 = after1.rows.find(x => x.id === combatantId('h1'))!;
    const m2After1 = after1.rows.find(x => x.id === combatantId('m2'))!;
    const m3After1 = after1.rows.find(x => x.id === combatantId('m3'))!;

    // Kill heal (12% max HP), 100% turn refund (refunded to startNow + 1, still Grimreaper's turn), +1 Harvest stack
    const healed = rowHp(hAfter1) - hurtHp;
    expect(healed).toBe(Math.round(0.12 * rHpMax));
    expect(hAfter1.at).toBe(tick(startNow + 1));
    expect(after1.currentId).toBe(combatantId('h1'));
    expect(hAfter1.statuses.find(s => s.key === statusKey('reaper-harvest'))?.stacks).toBe(1);

    // Mark splash reached m2 (2 tiles away) and skipped m3 (6 tiles away)
    expect(m2After1.statuses.find(s => s.key === MARK_KEY)?.stacks).toBe(1);
    expect(m3After1.statuses.some(s => s.key === MARK_KEY)).toBe(false);

    // Move next to m2 and immediately chain Guillotine on the splashed mark in the same round!
    const movedForChain: Running = {
      ...after1,
      rows: after1.rows.map(b => (b.id === combatantId('h1') ? { ...b, place: place(3, 2) } : b.id === combatantId('m3') ? { ...b, place: place(5, 2) } : b)),
    };
    const hpBeforeSecondKill = rowHp(movedForChain.rows.find(x => x.id === combatantId('h1'))!);
    const r2 = reduce(movedForChain, {
      type: 'act',
      by: combatantId('h1'),
      ability: GUILLOTINE_ID,
      aim: combatantId('m2'),
      rolls: { dice: { [combatantId('m2')]: [6] }, react: { [combatantId('m2')]: 10 } },
      force: true,
    }, ctx);
    expect(r2.effects.filter(e => e.type === 'refused')).toEqual([]);
    const after2 = r2.fight as Running;
    const hAfter2 = after2.rows.find(x => x.id === combatantId('h1'))!;
    const m3After2 = after2.rows.find(x => x.id === combatantId('m3'))!;

    // Second kill in same round: self heal/refund/harvest capped by limit: ROUND, but mark splash (limit: EACH) hits m3!
    expect(rowHp(hAfter2)).toBe(hpBeforeSecondKill);
    expect(hAfter2.statuses.find(s => s.key === statusKey('reaper-harvest'))?.stacks).toBe(1);
    expect(hAfter2.at).toBeGreaterThan(startNow + 100);
    expect(m3After2.statuses.find(s => s.key === MARK_KEY)?.stacks).toBe(1);
  });

  test('Scythe Sweep marks all foes in radius 2 while sparing allies, and Shadowstep blinks with Phantom Stride and D5 Death Shroud vs Phantom Veil', () => {
    const ctx = { rules: RULES };
    const reaper = makeGrimreaper([]);
    const ally = { ...newHunter(RULES), id: 'h-ally', name: 'Mira', rank: 'A' as const, level: 50 };
    const rRow = hunterRow(reaper, combatantId('h1'), RULES);
    const aRow = hunterRow(ally, combatantId('h2'), RULES);
    const [m1, m2] = monsterRows({ name: 'Scout', rank: 'A', archetype: 'skirmisher', kind: 'elite', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1'), combatantId('m2')], RULES);

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-sweep-step'),
      rows: [
        { ...rRow, place: place(4, 4) },
        { ...aRow, place: place(5, 4) },
        { ...m1!, place: place(6, 4) },
        { ...m2!, place: place(4, 6) },
      ],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 20, tie: 4 },
        { id: combatantId('h2'), d20: 10, tie: 3 },
        { id: combatantId('m1'), d20: 2, tie: 2 },
        { id: combatantId('m2'), d20: 1, tie: 1 },
      ],
    }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    const allyHp0 = rowHp(f.rows.find(x => x.id === combatantId('h2'))!);
    const rSweep = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: SWEEP_ID,
      aim: place(4, 4),
      rolls: { dice: { [combatantId('m1')]: [6], [combatantId('m2')]: [6] }, react: { [combatantId('m1')]: 2, [combatantId('m2')]: 2 } },
      force: true,
    }, ctx);
    expect(rSweep.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterSweep = rSweep.fight as Running;
    expect(rowHp(afterSweep.rows.find(x => x.id === combatantId('h2'))!)).toBe(allyHp0);
    expect(afterSweep.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === MARK_KEY)).toBe(true);
    expect(afterSweep.rows.find(x => x.id === combatantId('m2'))!.statuses.some(s => s.key === MARK_KEY)).toBe(true);

    // Base Shadowstep blinks 5 tiles and applies Phantom Stride (+20% speed, defend edge better)
    const speedBefore = afterSweep.rows.find(x => x.id === combatantId('h1'))!.sheet.speed;
    const rStep = reduce(afterSweep, {
      type: 'act',
      by: combatantId('h1'),
      ability: STEP_ID,
      aim: place(9, 4),
      rolls: { dice: {}, react: {} },
      force: true,
    }, ctx);
    expect(rStep.effects.filter(e => e.type === 'refused')).toEqual([]);
    const stepped = (rStep.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    expect(stepped.place).toEqual(place(9, 4));
    expect(stepped.statuses.some(s => s.key === statusKey('reaper-phantom'))).toBe(true);
    expect(stepped.sheet.speed).toBeGreaterThan(speedBefore);

    // D5 fork: Death Shroud grants once-per-fight untargetable; Phantom Veil grants hidden (anywhere) in plain sight
    const runStepFork = (forkNode: 'reaper-b5-l' | 'reaper-b5-r') => {
      const nodes = ['reaper-root', 'reaper-b2', 'reaper-b3x', 'reaper-b3y', 'reaper-b4x', 'reaper-b4y', forkNode].map(nid);
      const h = makeGrimreaper(nodes);
      const hr = hunterRow(h, combatantId('h1'), RULES);
      const foe = monsterRows({ name: 'Guard', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
      let ff: Fight = reduce(null, {
        type: 'add',
        fightId: fightId(`f-${forkNode}`),
        rows: [{ ...hr, place: place(2, 2) }, { ...foe, place: place(4, 2) }],
        openings: [],
      }, ctx).fight!;
      ff = reduce(ff, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
      const res = reduce(ff as Running, {
        type: 'act',
        by: combatantId('h1'),
        ability: STEP_ID,
        aim: place(8, 2),
        rolls: { dice: {}, react: {} },
        force: true,
      }, ctx);
      expect(res.effects.filter(e => e.type === 'refused')).toEqual([]);
      return { fight: res.fight as Running, row: (res.fight as Running).rows.find(x => x.id === combatantId('h1'))! };
    };

    const shroudRun = runStepFork('reaper-b5-l');
    const shroudRow = shroudRun.row;
    expect(shroudRow.place).toEqual(place(8, 2));
    expect(holds(shroudRow, 'untargetable')).toBe(true);
    expect(shroudRow.warded).toContain('untargetable');
    expect(shroudRow.statuses.some(s => s.key === statusKey('reaper-phantom-shroud'))).toBe(true);

    // Second Shadowstep cast later in the same fight still lands Phantom Stride II, while Death Shroud stays spent (once per fight)
    const laterShroud: Running = {
      ...shroudRun.fight,
      now: tick(5000),
      rows: shroudRun.fight.rows.map(b => (b.id === combatantId('h1')
        ? { ...b, statuses: b.statuses.filter(s => s.key !== statusKey('reaper-shroud-ward') && s.key !== statusKey('reaper-phantom-shroud')), readyAt: {}, at: tick(5000) }
        : b)),
    };
    const rStep2 = reduce(laterShroud, {
      type: 'act',
      by: combatantId('h1'),
      ability: STEP_ID,
      aim: place(6, 2),
      rolls: { dice: {}, react: {} },
      force: true,
    }, ctx);
    expect(rStep2.effects.filter(e => e.type === 'refused')).toEqual([]);
    const shroudRow2 = (rStep2.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    expect(holds(shroudRow2, 'untargetable')).toBe(false);
    expect(shroudRow2.statuses.some(s => s.key === statusKey('reaper-phantom-shroud'))).toBe(true);

    const veilRow = runStepFork('reaper-b5-r').row;
    expect(veilRow.place).toEqual(place(8, 2));
    expect(holds(veilRow, 'hidden')).toBe(true);
    expect(veilRow.statuses.some(s => s.key === statusKey('reaper-phantom-veil'))).toBe(true);
  });

  test('Apex Reaper capstone stacks Harvest 5x10% (+50% exact shareCap) and +3% speed/stack, heals 18% max HP, and splashes Reaper\'s Mark at radius 3', () => {
    const ctx = { rules: RULES };
    const apex = makeGrimreaper(canonicalNodes());
    const rRow0 = hunterRow(apex, combatantId('h1'), RULES);
    const rSheet = modified(rRow0.origin, rRow0.statuses, RULES).sheet;
    const hurtHp = Math.round(rSheet.hpMax * 0.4);
    const rRow = { ...rRow0, life: { at: 'up' as const, hp: hurtHp } };

    // Verify 5 stacks of Apex Harvest hit exact +50% shareCap (1.50) and +15% speed
    const apexHarvestDef = classStatusDef('reaper-harvest-apex')!;
    const fiveStacks = statusOn(apexHarvestDef, { key: statusKey('reaper-harvest-apex'), source: { id: combatantId('h1'), tier: 4 }, until: null, since: tick(0), settledAt: tick(0) }, 5);
    const withFive = { ...rRow, statuses: [...rRow.statuses, fiveStacks] };
    const dummyTarget = monsterRows({ name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m9')], RULES)[0]!;
    expect(damageShare(withFive, dummyTarget, RULES)).toBeCloseTo(1 + RULES.fight.kit.shareCap, 6);
    const baseSpeed = modified(rRow.origin, rRow.statuses, RULES).sheet.speed;
    const boostedSpeed = modified(rRow.origin, withFive.statuses, RULES).sheet.speed;
    expect(boostedSpeed).toBe(Math.round(baseSpeed * 1.15));

    // Verify kill heal (18% max HP) and radius-3 Reaper's Mark splash
    const [m1, m2, m3] = monsterRows({ name: 'Raider', rank: 'A', archetype: 'skirmisher', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1'), combatantId('m2'), combatantId('m3')], RULES);
    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-apex-reaper'),
      rows: [
        { ...rRow, place: place(2, 2) },
        { ...m1!, life: { at: 'up', hp: 1 }, place: place(3, 2) },
        // 3 tiles away from Grimreaper at (2,2): outside base radius 2, inside Apex radius 3
        { ...m2!, place: place(5, 2) },
        // 4 tiles away: outside radius 3
        { ...m3!, place: place(6, 2) },
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

    const rKill = reduce(f as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: REAP_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    expect(rKill.effects.filter(e => e.type === 'refused')).toEqual([]);
    const after = rKill.fight as Running;
    const hAfter = after.rows.find(x => x.id === combatantId('h1'))!;
    // healPower from tree (+19%) amplifies the 18% max HP kill heal via `given()`
    const expectedHeal = Math.round(0.18 * rSheet.hpMax * (1 + rSheet.healPower));
    expect(rowHp(hAfter) - hurtHp).toBe(expectedHeal);
    expect(hAfter.statuses.find(s => s.key === statusKey('reaper-harvest-apex'))?.stacks).toBe(1);
    expect(after.rows.find(x => x.id === combatantId('m2'))!.statuses.find(s => s.key === MARK_KEY)?.stacks).toBe(1);
    expect(after.rows.find(x => x.id === combatantId('m3'))!.statuses.some(s => s.key === MARK_KEY)).toBe(false);
  });
});
