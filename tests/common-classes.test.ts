import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, BONUS_KEYS, RULES } from '../src/core/rules.ts';
import type { BonusKey, Perk, Rank } from '../src/core/rules.ts';
import { SCHEMA, newHunter, parseSaveValue } from '../src/core/save.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { fightId, parseClassNodeId, parseSaveId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, ItemId } from '../src/core/ids.ts';
import { parseClasses } from '../src/core/hunter/class-locker.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { LandOp, Op, StatusDef } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { rangeWith } from '../src/core/combat/standing.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
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
import { JOB_NAMES } from '../src/core/registry/jobs.ts';
import type { CommonClassName } from '../src/core/registry/jobs.ts';
import {
  CLASS_ACTIVES_MAX,
  CLASS_TREES,
  TREE_SHAPE,
  canBuyNode,
  capstoneUnlocked,
  repairNodes,
  validateTree,
} from '../src/core/registry/class-trees.ts';
import type { ClassTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import type { ClassSignature } from '../src/core/registry/class-powers.ts';
import { FIGHTER_SIGNATURE, FIGHTER_TREE } from '../src/core/registry/class-fighter.ts';
import { ASSASSIN_SIGNATURE, ASSASSIN_TREE } from '../src/core/registry/class-assassin.ts';
import { MAGE_SIGNATURE, MAGE_TREE } from '../src/core/registry/class-mage.ts';
import { TANKER_SIGNATURE, TANKER_TREE } from '../src/core/registry/class-tanker.ts';
import { HEALER_SIGNATURE, HEALER_TREE } from '../src/core/registry/class-healer.ts';
import { RANGER_SIGNATURE, RANGER_TREE } from '../src/core/registry/class-ranger.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';

const ROOT = import.meta.dir + '/..';
const AT = '2026-11-26T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

type CommonSpec = {
  readonly name: CommonClassName;
  readonly prefix: string;
  readonly sig: ClassSignature;
  readonly tree: ClassTree;
  readonly file: string;
  readonly stats: { readonly [K in (typeof STAT_KEYS)[number]]?: number };
  readonly hasScaler: boolean;
  readonly statusKeys: readonly string[];
  readonly activeId: string;
};

const COMMON_SPECS: readonly CommonSpec[] = [
  {
    name: 'Fighter',
    prefix: 'ftr',
    sig: FIGHTER_SIGNATURE,
    tree: FIGHTER_TREE,
    file: 'src/core/registry/class-fighter.ts',
    stats: { str: 36, vit: 23 },
    hasScaler: true,
    statusKeys: [
      'ftr-battle-grit',
      'ftr-battle-grit-ii',
      'ftr-battle-stand',
      'ftr-battle-stand-ii',
      'ftr-sundered-guard',
    ],
    activeId: 'ftr-iron-cleave',
  },
  {
    name: 'Assassin',
    prefix: 'asn',
    sig: ASSASSIN_SIGNATURE,
    tree: ASSASSIN_TREE,
    file: 'src/core/registry/class-assassin.ts',
    stats: { agi: 36, ins: 23 },
    hasScaler: true,
    statusKeys: [
      'asn-footwork',
      'asn-footwork-ii',
      'asn-shadow-edge',
      'asn-viper-venom',
      'asn-viper-venom-ii',
    ],
    activeId: 'asn-viper-fang',
  },
  {
    name: 'Mage',
    prefix: 'mag',
    sig: MAGE_SIGNATURE,
    tree: MAGE_TREE,
    file: 'src/core/registry/class-mage.ts',
    stats: { pow: 36, ctl: 23 },
    hasScaler: false,
    statusKeys: [
      'mag-spellflow',
      'mag-spellflow-ii',
      'mag-shattered-ward',
      'mag-shattered-ward-ii',
    ],
    activeId: 'mag-arcane-nova',
  },
  {
    name: 'Tanker',
    prefix: 'tnk',
    sig: TANKER_SIGNATURE,
    tree: TANKER_TREE,
    file: 'src/core/registry/class-tanker.ts',
    stats: { vit: 36, dis: 23 },
    hasScaler: false,
    statusKeys: [
      'tnk-iron-guard',
      'tnk-iron-guard-ii',
      'tnk-aegis-taunt',
    ],
    activeId: 'tnk-aegis-bash',
  },
  {
    name: 'Healer',
    prefix: 'hlr',
    sig: HEALER_SIGNATURE,
    tree: HEALER_TREE,
    file: 'src/core/registry/class-healer.ts',
    stats: { pre: 36, dis: 23 },
    hasScaler: false,
    statusKeys: [
      'hlr-sanctuary',
      'hlr-sanctuary-ii',
      'hlr-mending-pulse',
      'hlr-mending-pulse-ii',
    ],
    activeId: 'hlr-mending-pulse',
  },
  {
    name: 'Ranger',
    prefix: 'rng',
    sig: RANGER_SIGNATURE,
    tree: RANGER_TREE,
    file: 'src/core/registry/class-ranger.ts',
    stats: { agi: 36, ctl: 23 },
    hasScaler: false,
    statusKeys: [
      'rng-hunters-snare',
      'rng-hunters-snare-ii',
      'rng-tangled',
      'rng-snare-root',
    ],
    activeId: 'rng-pinning-shot',
  },
];

function allNodesOf(tree: ClassTree): readonly ClassNodeId[] {
  return tree.nodes.map(n => n.id);
}

function makeCommonHunter(spec: CommonSpec, nodes: readonly ClassNodeId[] = [], rank: Rank = 'D') {
  const base = newHunter(RULES);
  const level = RULES.rankLevels[rank];
  const earned = earnClass(
    { ...base, name: spec.name, rank, level, stats: { ...base.stats, ...spec.stats } },
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

describe('Wave 2 PR 7: Common trees, gold pricing, and D-rank budget compliance', () => {
  test('all six Common starters are registered in CLASS_SIGNATURES and CLASS_TREES', () => {
    expect(COMMON_SPECS.map(s => s.name)).toEqual([...JOB_NAMES]);
    for (const spec of COMMON_SPECS) {
      expect(CLASS_SIGNATURES[spec.name]).toBe(spec.sig);
      expect(CLASS_TREES[spec.name]).toBe(spec.tree);
    }
  });

  for (const spec of COMMON_SPECS) {
    test(`${spec.name} matches TREE_SHAPE.common (1, 2, 4, 4, 1; 0 forks), unlocks capstone from any D4 node, and sums to 208,125 gold at S (~900 g at D)`, () => {
      expect(validateTree(spec.tree)).toEqual([]);
      expect(spec.tree.nodes.length).toBe(TREE_SHAPE.common.total);
      expect(spec.tree.nodes.every(n => !n.forkGroup)).toBe(true);

      const depthCounts = [1, 2, 3, 4, 5].map(d => spec.tree.nodes.filter(n => n.depth === d).length);
      expect(depthCounts).toEqual([1, 2, 4, 4, 1]);

      const nodes = allNodesOf(spec.tree);
      expect(nodes.length).toBe(TREE_SHAPE.common.buyable);
      expect(repairNodes(spec.tree, nodes)).toEqual([...nodes]);

      const bought: ClassNodeId[] = [];
      let totalS = 0;
      let totalD = 0;
      for (const id of nodes) {
        expect(canBuyNode(spec.tree, bought, id).ok, `${spec.name} node ${id} should be buyable`).toBe(true);
        const pS = nodeCost({ rank: 'S' }, spec.name, id, 'player', RULES);
        const pD = nodeCost({ rank: 'D' }, spec.name, id, 'player', RULES);
        if (isRefused(pS) || isRefused(pD)) throw new Error(`nodeCost refused for ${id}`);
        totalS += pS.cost;
        totalD += pD.cost;
        bought.push(id);
      }
      expect(totalS).toBe(208_125);
      expect(totalD).toBe(904);

      // Early capstone unlock from any single Depth 4 path
      const rush = [`${spec.prefix}-root`, `${spec.prefix}-a2`, `${spec.prefix}-a3x`, `${spec.prefix}-a4x`].map(nid);
      expect(capstoneUnlocked(spec.tree, rush)).toBe(true);
      expect(canBuyNode(spec.tree, rush, nid(`${spec.prefix}-cap`)).ok).toBe(true);
    });

    test(`${spec.name} signature fits the ~6 to 8 pt D-rank root budget and its base active fits worth.ts SA budgets`, () => {
      const rootSpend = titleSpend(
        { bonus: spec.sig.bonus ?? {}, band: 'D', ...(spec.sig.worn ? { worn: spec.sig.worn.def } : {}) },
        RULES,
      );
      expect(rootSpend.points, `${spec.name} D-rank root spend ${rootSpend.points.toFixed(2)}`).toBeGreaterThan(0);
      expect(rootSpend.points, `${spec.name} D-rank root spend ${rootSpend.points.toFixed(2)}`).toBeLessThanOrEqual(8.0);

      expect(spec.sig.actives?.length).toBe(1);
      for (const a of spec.sig.actives ?? []) {
        const wD = abilityWorth(a, RULES, { rank: 'D' });
        expect(wD.over, `${spec.name} ${a.name} D worth ${wD.worth.toFixed(2)} vs budget ${wD.budget.toFixed(2)}`).toBe(false);
        const wC = abilityWorth(a, RULES, { rank: 'C' });
        expect(wC.over, `${spec.name} ${a.name} C worth ${wC.worth.toFixed(2)} vs budget ${wC.budget.toFixed(2)}`).toBe(false);
      }
    });

    test(`${spec.name} folds cleanly, matches out-of-combat sheet parity, respects FORMULA_PARTS and MAX_ABILITIES, and round-trips through parsers and fightWire`, () => {
      const nodes = allNodesOf(spec.tree);
      const h = makeCommonHunter(spec, nodes, 'D');
      const cp = classPowers(h, RULES);
      expect(cp.actives.length).toBe(1);
      expect(cp.actives.length).toBeLessThanOrEqual(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBe(spec.hasScaler ? 1 : 0);
      expect(cp.scalers.length).toBeLessThanOrEqual(RULES.fight.kit.scalers);

      // Out-of-combat hunterSheet matches combat modified sheet
      const ooc = hunterSheet(h, RULES).sheet;
      const plainRow = hunterRow(h, combatantId('h1-sheet'), RULES);
      const combatSheet = modified(plainRow.origin, plainRow.statuses, RULES).sheet;
      expect(ooc.hpMax).toBe(combatSheet.hpMax);
      expect(ooc.armor).toBeCloseTo(combatSheet.armor, 4);
      expect(ooc.resist).toBeCloseTo(combatSheet.resist, 4);
      expect(ooc.resistPen).toBeCloseTo(combatSheet.resistPen, 4);
      expect(ooc.armorPen).toBeCloseTo(combatSheet.armorPen, 4);
      expect(ooc.speed).toBe(combatSheet.speed);

      // Active priority ahead of 12 bag consumables, and scaler wrapping never leaks onto consumables
      const bombs = Array.from({ length: 12 }, (_, idx) => ({
        id: parseSaveId<'i'>(`i${400 + idx}`) as ItemId,
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
      const bagRow = hunterRow({ ...h, items: [...h.items, ...bombs] }, combatantId('h-bag'), KEYSTONES_ON);
      const activeWornId = wornAbilityId(abilityId(spec.activeId));
      expect(bagRow.abilities.map(a => a.id)).toContain(activeWornId);

      const ab = bagRow.abilities.find(a => a.id === activeWornId)!;
      const form = formulaOf(ab, KEYSTONES_ON);
      if (form) {
        expect(partsOf(form)).toBeLessThanOrEqual(FORMULA_PARTS);
        if (spec.hasScaler) expect(scalersOf(form, KEYSTONES_ON)?.scalers.length).toBe(1);
      }
      const bombAb = bagRow.abilities.find(a => a.name === 'Bomb 0');
      if (bombAb) {
        const bombForm = formulaOf(bombAb, KEYSTONES_ON);
        expect(bombForm && scalersOf(bombForm, KEYSTONES_ON)).toBeNull();
      }

      // Parser round-trip for base and upgraded actives
      const abilities: Ability[] = [...(spec.sig.actives ?? [])];
      for (const n of spec.tree.nodes) {
        for (const g of n.gifts) if (g.kind === 'replace-active') abilities.push(g.active);
      }
      expect(abilities.length).toBe(2);
      for (const a of abilities) {
        expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `parseAbility(${a.name})`).toEqual(a);
      }

      // Status registry lookup & parser round-trip
      for (const k of spec.statusKeys) {
        const def = classStatusDef(k);
        expect(def, `classStatusDef(${k})`).not.toBeNull();
        expect(shippedStatusDef(statusKey(k))).toEqual(def);
        expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k), `parseStatusDef(${k})`).toEqual(def);
      }

      // fightDoc -> fightWire -> DOCS.fight at 0 wire bytes
      const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
      const foe = monsterRows({ name: 'Dummy', rank: 'D', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
      let f: Fight | null = reduce(null, { type: 'add', fightId: fightId(`f-common-${spec.prefix}`), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
      const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error('expected active FightDoc');
      const wire = fightWire(doc);
      expect(wire.defs, `${spec.name} wire.defs should be undefined`).toBeUndefined();
      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
      const wornKey = classPowers(h, KEYSTONES_ON).worn!.key;
      const onRow = parsed.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === wornKey);
      expect(onRow?.def).toEqual(classStatusDef(wornKey)!);
    });
  }
});

describe('Legacy upgrades save compatibility, status uniqueness, copy, voice, and name collisions', () => {
  test('legacy saves with `upgrades` on a Common class parse via parseClasses and parseSave as `nodes: []`', () => {
    const res = parseClasses(
      {
        Fighter: { unlockedAt: AT, upgrades: ['old-grit-1', 'old-cleave-2'] },
        Mage: { unlockedAt: AT, upgrades: ['old-pierce'] },
      },
      { job: 'Fighter', fallbackAt: AT },
    );
    expect(res.job).toBe('Fighter');
    expect(res.jobDone).toBe('Fighter');
    expect(res.classes.Fighter).toEqual({ unlockedAt: AT, nodes: [] });
    expect(res.classes.Mage).toEqual({ unlockedAt: AT, nodes: [] });

    // Full save load via parseSaveValue also preserves earned class with empty nodes and drops legacy upgrades field
    const h = newHunter(RULES);
    const rawSave = {
      schema: SCHEMA,
      hunters: [{
        ...h,
        job: 'Fighter',
        jobDone: 'Fighter',
        classes: { Fighter: { unlockedAt: AT, upgrades: ['legacy-u1', 'legacy-u2'] } },
      }],
    };
    const loaded = parseSaveValue(rawSave, {
      now: new Date(AT),
      newDeviceId: () => dev('d-test'),
      newDeviceToken: () => 'tok-0123456789abcdef0123456789ab',
    });
    expect(loaded.kind).toBe('save');
    if (loaded.kind !== 'save') throw new Error('expected save');
    const loadedH = loaded.save.hunters[0]!;
    expect(loadedH.job).toBe('Fighter');
    expect(loadedH.jobDone).toBe('Fighter');
    expect(loadedH.classes.Fighter).toEqual({ unlockedAt: AT, nodes: [] });
    expect('upgrades' in (loadedH.classes.Fighter as Record<string, unknown>)).toBe(false);
  });

  test('every status key across all shipped CLASS_SIGNATURES and CLASS_TREES maps to one unique JSON StatusDef', () => {
    const seen = new Map<string, string>();
    const checkOps = (ops: readonly (Op | LandOp)[]): void => {
      for (const op of ops) if (op.op === 'applyStatus') check(op.key, op.def);
    };
    const check = (key: string, def: StatusDef): void => {
      const json = JSON.stringify(def);
      const prev = seen.get(key);
      if (prev !== undefined) expect(json, `status key "${key}" has conflicting StatusDefs`).toBe(prev);
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
      for (const n of tree.nodes) {
        for (const g of n.gifts) {
          if (g.kind === 'replace-worn') check(g.worn.key, g.worn.def);
          else if (g.kind === 'replace-active') checkOps(g.active.ops);
          else if (g.kind === 'upgrade-status') check(g.key, g.def);
        }
      }
    }
  });

  test('zero name collisions against keystones, built-in items, built-in skills, built-in statuses, and banned names', () => {
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
    for (const banned of ['spellblade', 'warlord', 'sovereign', 'guardian', 'deadeye', 'bulwark']) reserved.add(banned);

    for (const spec of COMMON_SPECS) {
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
        expect(reserved.has(name.toLowerCase()), `${spec.name} name "${name}" collides with reserved name`).toBe(false);
      }
    }
  });

  test('every Common node desc matches its bonus/scaler numbers (anti-drift), follows voice.md, and files hold no gold literals', async () => {
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

    const commonHelperSrc = await Bun.file(`${ROOT}/src/core/registry/class-common.ts`).text();
    expect(commonHelperSrc.split('\n').filter(l => !l.trim().startsWith('//') && goldUse.test(l))).toEqual([]);

    for (const spec of COMMON_SPECS) {
      const src = await Bun.file(`${ROOT}/${spec.file}`).text();
      expect(src.split('\n').filter(l => !l.trim().startsWith('//') && goldUse.test(l)), `${spec.file} no gold literals`).toEqual([]);

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
              expect(n.desc, `${spec.name} node ${n.id} desc missing ${k}=${shown}`).toContain(shown);
            }
          } else if (g.kind === 'scaler') {
            expect(n.desc, `${spec.name} node ${n.id} desc missing scaler pct`).toContain(`${Math.round(g.scaler.scale * 100)}%`);
          } else if (g.kind === 'replace-worn') {
            checkVoice(`${spec.name} ${n.id} worn label`, g.worn.def.label);
            checkVoice(`${spec.name} ${n.id} worn desc`, g.worn.def.desc);
          }
        }
      }
    }
  });
});

describe('Common class combat mechanics', () => {
  function startFight(spec: CommonSpec, nodes: readonly ClassNodeId[], hPlace = place(3, 3), mPlace = place(4, 3), opts: { rank?: Rank; foeHpTweak?: number; foeKind?: 'normal' | 'boss' } = {}): Running {
    const rank = opts.rank ?? 'D';
    const h = makeCommonHunter(spec, nodes, rank);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({
      name: 'Target',
      rank,
      archetype: 'brute',
      kind: opts.foeKind ?? 'boss',
      tweak: { hp: opts.foeHpTweak ?? 3 },
      abilities: [],
      statuses: [],
    }, [combatantId('m1')], RULES)[0]!;
    let f = reduce(null, { type: 'add', fightId: fightId(`f-cm-${spec.prefix}`), rows: [{ ...hRow, place: hPlace }, { ...foe, place: mPlace }], openings: [] }, { rules: RULES }).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');
    return f;
  }

  test('Fighter: Iron Cleave sunders armor, Last Stand desperate scaler boosts low-HP strikes, and Battle Grit heals on kill & shields below 30% HP', () => {
    const spec = COMMON_SPECS[0]!;
    const cleaveId = wornAbilityId(abilityId('ftr-iron-cleave'));

    // Base Iron Cleave deals damage and applies Sundered Guard (-8 armor)
    const f0 = startFight(spec, [nid('ftr-root'), nid('ftr-a2'), nid('ftr-a3y')]);
    const foeArmor0 = f0.rows.find(x => x.id === combatantId('m1'))!.sheet.armor;
    const foeHpFull = rowHp(f0.rows.find(x => x.id === combatantId('m1'))!);
    const rHigh = reduce(f0, { type: 'act', by: combatantId('h1'), ability: cleaveId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(rHigh.effects.filter(e => e.type === 'refused')).toEqual([]);
    const fHigh = rHigh.fight as Running;
    const foeAfterHigh = fHigh.rows.find(x => x.id === combatantId('m1'))!;
    const dmgFullHp = foeHpFull - rowHp(foeAfterHigh);
    expect(foeAfterHigh.statuses.some(s => s.key === statusKey('ftr-sundered-guard'))).toBe(true);
    expect(foeAfterHigh.sheet.armor).toBe(foeArmor0 - 8);

    // Desperate scaler: at 10% HP, Fighter deals strictly more damage with identical dice
    const lowH = f0.rows.find(x => x.id === combatantId('h1'))!;
    const lowFight: Running = {
      ...f0,
      rows: f0.rows.map(x => (x.id === combatantId('h1') ? { ...x, life: { at: 'up' as const, hp: Math.max(1, Math.round(lowH.sheet.hpMax * 0.1)) } } : x)),
    };
    const rLow = reduce(lowFight, { type: 'act', by: combatantId('h1'), ability: cleaveId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    const dmgLowHp = foeHpFull - rowHp((rLow.fight as Running).rows.find(x => x.id === combatantId('m1'))!);
    expect(dmgLowHp).toBeGreaterThan(dmgFullHp);

    // Battle Grit: killing a low-HP foe heals Fighter
    const hurtHp = Math.round(lowH.sheet.hpMax * 0.6);
    const killFight: Running = {
      ...f0,
      rows: f0.rows.map(x => (
        x.id === combatantId('h1') ? { ...x, life: { at: 'up' as const, hp: hurtHp } }
          : { ...x, life: { at: 'up' as const, hp: 1 } }
      )),
    };
    const rKill = reduce(killFight, { type: 'act', by: combatantId('h1'), ability: cleaveId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(rowHp((rKill.fight as Running).rows.find(x => x.id === combatantId('h1'))!)).toBeGreaterThan(hurtHp);

    // Battle Grit lowHp trigger: dropping Fighter below 30% HP grants shield + Battle Stand
    const fHit = startFight(spec, [], place(3, 3), place(4, 3), { foeKind: 'normal', foeHpTweak: 1 });
    const hRow = fHit.rows.find(x => x.id === combatantId('h1'))!;
    const justAboveLow = Math.ceil(hRow.sheet.hpMax * RULES.fight.kit.lowHpAt) + 2;
    const hitSetup: Running = {
      ...fHit,
      rows: fHit.rows.map(x => (x.id === combatantId('h1') ? { ...x, life: { at: 'up' as const, hp: justAboveLow }, at: tick(fHit.now + 200) } : x)),
    };
    const rDrop = reduce(hitSetup, { type: 'act', by: combatantId('m1'), ability: hitSetup.rows[1]!.abilities[0]!.id, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [1] }, react: { [combatantId('h1')]: 1 } }, force: true }, { rules: RULES });
    const hDropped = (rDrop.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    expect(hDropped.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(hDropped.statuses.some(s => s.key === statusKey('ftr-battle-stand'))).toBe(true);
  });

  test('Assassin: Viper Fang applies Viper Venom, First Blood opener boosts high-HP targets, and Shadow Footwork counters on avoid', () => {
    const spec = COMMON_SPECS[1]!;
    const fangId = wornAbilityId(abilityId('asn-viper-fang'));

    // Viper Fang + opener scaler (First Blood): deals more damage against a full-HP foe than a 20% HP foe
    const f0 = startFight(spec, [nid('asn-root'), nid('asn-b2'), nid('asn-b3x')]);
    const foe0 = f0.rows.find(x => x.id === combatantId('m1'))!;
    const rFull = reduce(f0, { type: 'act', by: combatantId('h1'), ability: fangId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    const fFull = rFull.fight as Running;
    const foeAfterFull = fFull.rows.find(x => x.id === combatantId('m1'))!;
    const dmgOnFull = rowHp(foe0) - rowHp(foeAfterFull);
    expect(foeAfterFull.statuses.some(s => s.key === statusKey('asn-viper-venom'))).toBe(true);

    const lowTargetHp = Math.max(1, Math.round(foe0.sheet.hpMax * 0.2));
    const fLowTarget: Running = {
      ...f0,
      rows: f0.rows.map(x => (x.id === combatantId('m1') ? { ...x, life: { at: 'up' as const, hp: lowTargetHp } } : x)),
    };
    const rLow = reduce(fLowTarget, { type: 'act', by: combatantId('h1'), ability: fangId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    const dmgOnLow = lowTargetHp - rowHp((rLow.fight as Running).rows.find(x => x.id === combatantId('m1'))!);
    expect(dmgOnFull).toBeGreaterThan(dmgOnLow);

    // Shadow Footwork: when Assassin dodges a telegraphed strike (windup 500), Assassin counters and gains Shadow Edge
    const fDodge = startFight(spec, [], place(3, 3), place(4, 3));
    const mRow = fDodge.rows.find(x => x.id === combatantId('m1'))!;
    const mHp0 = rowHp(mRow);
    const heavySwing: Ability = {
      ...mRow.abilities[0]!,
      delivery: { kind: 'travel', windup: tick(500), speed: 'instant' },
    };
    const dodgeReady: Running = {
      ...fDodge,
      rows: fDodge.rows.map(x => (
        x.id === combatantId('h1') ? { ...x, at: tick(fDodge.now + 200) }
          : { ...x, abilities: [heavySwing] }
      )),
    };
    let rAvoid = reduce(dodgeReady, {
      type: 'act',
      by: combatantId('m1'),
      ability: heavySwing.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [4] }, react: { [combatantId('h1')]: 20 } },
      force: true,
    }, { rules: RULES });
    expect(rAvoid.effects.some(e => e.type === 'dodgeAsked')).toBe(true);
    rAvoid = reduce(rAvoid.fight, {
      type: 'dodge',
      id: combatantId('h1'),
      to: place(2, 3),
    }, { rules: RULES });
    expect(rAvoid.effects.filter(e => e.type === 'refused')).toEqual([]);
    const fAvoid = rAvoid.fight as Running;
    expect(rowHp(fAvoid.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(mHp0);
    expect(fAvoid.rows.find(x => x.id === combatantId('h1'))!.statuses.some(s => s.key === statusKey('asn-shadow-edge'))).toBe(true);
  });

  test('Mage: Arcane Nova hits radius-2 foes and shreds magic resist; Spellflow adds pen/costCut and refunds turn on spell kill', () => {
    const spec = COMMON_SPECS[2]!;
    const novaId = wornAbilityId(abilityId('mag-arcane-nova'));

    const h = makeCommonHunter(spec, [], 'D');
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const casterFoe = monsterRows({ name: 'Caster', rank: 'D', archetype: 'caster', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let f0 = reduce(null, { type: 'add', fightId: fightId('f-cm-mag-nova'), rows: [{ ...hRow, place: place(3, 3) }, { ...casterFoe, place: place(5, 3) }], openings: [] }, { rules: RULES }).fight!;
    f0 = reduce(f0, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    if (f0.phase !== 'running') throw new Error('expected running fight');
    const h0 = f0.rows.find(x => x.id === combatantId('h1'))!;
    const m0 = f0.rows.find(x => x.id === combatantId('m1'))!;
    expect(h0.sheet.resistPen).toBeGreaterThanOrEqual(4);
    expect(h0.sheet.costCut).toBeGreaterThanOrEqual(0.01);

    // Arcane Nova hits m1 at distance 2 and applies Shattered Ward (-10 resist)
    const r = reduce(f0, { type: 'act', by: combatantId('h1'), ability: novaId, aim: place(3, 3), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const fAfter = r.fight as Running;
    const mAfter = fAfter.rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(mAfter)).toBeLessThan(rowHp(m0));
    expect(mAfter.statuses.some(s => s.key === statusKey('mag-shattered-ward'))).toBe(true);
    expect(mAfter.sheet.resist).toBe(Math.max(0, m0.sheet.resist - 10));

    // Master of Spellflow: killing a 1-HP foe with Arcane Nova refunds turn time and restores 2 mana
    const fCap = startFight(spec, allNodesOf(spec.tree), place(3, 3), place(5, 3));
    const killSetup: Running = {
      ...fCap,
      rows: fCap.rows.map(x => (x.id === combatantId('m1') ? { ...x, life: { at: 'up' as const, hp: 1 } } : x)),
    };
    const hBefore = killSetup.rows.find(x => x.id === combatantId('h1'))!;
    const noKillR = reduce(fCap, { type: 'act', by: combatantId('h1'), ability: novaId, aim: place(3, 3), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    const killR = reduce(killSetup, { type: 'act', by: combatantId('h1'), ability: novaId, aim: place(3, 3), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    const hNoKill = (noKillR.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    const hKill = (killR.fight as Running).rows.find(x => x.id === combatantId('h1'))!;
    expect(hKill.at).toBeLessThan(hNoKill.at);
    expect(hKill.mana).toBe(Math.min(hBefore.sheet.manaMax, hNoKill.mana + 2));
  });

  test('Tanker: Iron Guard adds armor and per-round shield; Aegis Bash taunts and fills boss stagger bar', () => {
    const spec = COMMON_SPECS[3]!;
    const bashId = wornAbilityId(abilityId('tnk-aegis-bash'));

    const f0 = startFight(spec, []);
    const h0 = f0.rows.find(x => x.id === combatantId('h1'))!;
    // TurnStart trigger on start gives Tanker a per-round shield (4% max HP)
    expect(h0.shield?.amount ?? 0).toBeGreaterThan(0);

    // Aegis Bash damages, applies Aegis Taunt, and fills 15% of boss stagger bar
    const m0 = f0.rows.find(x => x.id === combatantId('m1'))!;
    expect(m0.kind === 'monster' && m0.stagger !== null).toBe(true);
    const r = reduce(f0, { type: 'act', by: combatantId('h1'), ability: bashId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const mAfter = (r.fight as Running).rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(mAfter)).toBeLessThan(rowHp(m0));
    expect(mAfter.statuses.some(s => s.key === statusKey('tnk-aegis-taunt'))).toBe(true);
    expect(mAfter.kind === 'monster' && (mAfter.stagger?.fill ?? 0) > 0).toBe(true);
  });

  test('Healer: Sanctuary Aura buffs nearby ally Discipline; Mending Pulse heals and cleanses allies within 2 tiles while never healing or cleansing foes', () => {
    const spec = COMMON_SPECS[4]!;
    const pulseId = wornAbilityId(abilityId('hlr-mending-pulse'));

    const healer = makeCommonHunter(spec, [], 'D');
    const allyBase = newHunter(RULES);
    const ally = { ...allyBase, id: parseSaveId<'h'>('h2')!, name: 'Ally', rank: 'D' as const, level: RULES.rankLevels.D };
    const hRow = hunterRow(healer, combatantId('h1'), RULES);
    const aRow = hunterRow(ally, combatantId('h2'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'D', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    const bareAllyDis = hunterSheet(ally, RULES).stats.dis;
    const burn = statusOn(BUILT_IN_STATUSES.burning, { key: statusKey('burning'), source: { id: combatantId('m1'), tier: 1 }, until: tick(3000), since: tick(0), settledAt: tick(0) });
    const hurtAlly = { ...aRow, place: place(4, 3), life: { at: 'up' as const, hp: 10 }, statuses: [...aRow.statuses, burn] };
    const hurtFoe = { ...foe, place: place(3, 4), life: { at: 'up' as const, hp: 20 }, statuses: [burn] };

    let f = reduce(null, { type: 'add', fightId: fightId('f-hlr-aoe'), rows: [{ ...hRow, place: place(3, 3) }, hurtAlly, hurtFoe], openings: [] }, { rules: RULES }).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    // Sanctuary Aura grants +4 Discipline to ally standing 1 tile away (never to foe)
    const allyInAura = f.rows.find(x => x.id === combatantId('h2'))!;
    expect(allyInAura.stats.dis).toBe(bareAllyDis + 4);

    // Mending Pulse heals and cleanses Burning off Ally (1 tile away), and leaves Foe (1 tile away) unhealed and still Burning
    const r = reduce(f, { type: 'act', by: combatantId('h1'), ability: pulseId, aim: combatantId('h1'), rolls: { dice: { [combatantId('h1')]: [4], [combatantId('h2')]: [4] }, react: {} }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const fAfter = r.fight as Running;
    const allyAfter = fAfter.rows.find(x => x.id === combatantId('h2'))!;
    const foeAfter = fAfter.rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(allyAfter)).toBeGreaterThan(10);
    expect(allyAfter.statuses.some(s => s.key === statusKey('burning'))).toBe(false);
    expect(rowHp(foeAfter)).toBe(20);
    expect(foeAfter.statuses.some(s => s.key === statusKey('burning'))).toBe(true);
  });

  test('Ranger: Hunter\'s Snare adds +1 range and roots at 2 Tangled stacks; Pinning Shot delays target turn and completes the root', () => {
    const spec = COMMON_SPECS[5]!;
    const pinId = wornAbilityId(abilityId('rng-pinning-shot'));

    const f0 = startFight(spec, [], place(2, 3), place(8, 3));
    const h0 = f0.rows.find(x => x.id === combatantId('h1'))!;
    const m0 = f0.rows.find(x => x.id === combatantId('m1'))!;
    expect(rangeWith(12, h0, RULES)).toBe(13);

    // Pinning Shot hits: applies 1 Tangled + Hunter's Snare shot trigger applies 2nd Tangled -> threshold spends stacks and roots foe + delays turn!
    const mAt0 = m0.at;
    const r = reduce(f0, { type: 'act', by: combatantId('h1'), ability: pinId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 1 } }, force: true }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const mAfter = (r.fight as Running).rows.find(x => x.id === combatantId('m1'))!;
    expect(rowHp(mAfter)).toBeLessThan(rowHp(m0));
    expect(mAfter.at).toBeGreaterThan(mAt0);
    expect(mAfter.sheet.move).toBe(0);
    expect(mAfter.statuses.some(s => s.key === statusKey('rng-snare-root'))).toBe(true);

    // Explain reports class contribution on sheet
    const exp = explain(makeCommonHunter(spec, [nid('rng-root')], 'D'), 'aim', RULES);
    expect(exp.parts.find(p => p.from === 'class')?.amount ?? 0).toBeGreaterThan(0);
  });
});
