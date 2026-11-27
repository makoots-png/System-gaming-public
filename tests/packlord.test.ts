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
import { hunterRow, monsterRows, summonRow } from '../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { sensible } from '../src/core/combat/policy.ts';
import { BUILT_IN_CLASSES, jobAlloc } from '../src/core/registry/jobs.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { titleSpend } from '../src/core/registry/item-budget.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { statusOn } from '../src/core/combat/effect-ops.ts';
import {
  CLASS_ACTIVES_MAX,
  CLASS_TREES,
  TREE_SHAPE,
  canBuyNode,
  canFlipFork,
  capstoneUnlocked,
  repairNodes,
  validateTree,
} from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { PACKLORD_SIGNATURE, PACKLORD_TREE } from '../src/core/registry/class-packlord.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-26T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

const CANONICAL_FORKS = ['pack-a5-l', 'pack-b5-l', 'pack-c5-l'] as const;
const BRANCH_A_RUSH = ['pack-root', 'pack-a2', 'pack-a3x', 'pack-a3y', 'pack-a4x', 'pack-a4y', 'pack-a5-l', 'pack-a6'] as const;

function canonicalNodes(): ClassNodeId[] {
  return PACKLORD_TREE.nodes
    .filter(n => !n.forkGroup || (CANONICAL_FORKS as readonly string[]).includes(n.id))
    .map(n => n.id);
}

function allForkBuilds(): ClassNodeId[][] {
  const groups = new Map<string, ClassNodeId[]>();
  for (const n of PACKLORD_TREE.nodes) {
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
  return picks.map(chosen => PACKLORD_TREE.nodes.filter(n => !n.forkGroup || chosen.includes(n.id)).map(n => n.id));
}

function makePacklord(nodes: readonly ClassNodeId[] = [], rank: Rank = 'A') {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, name: 'Packlord', rank, level: RULES.rankLevels[rank], stats: { ...base.stats, pre: 106, ctl: 58 } },
    'Packlord',
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Packlord: { ...earned.classes.Packlord!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Packlord metadata, tree structure, pricing, and integrity', () => {
  test('uses pre+ctl stat pair with 2:1 alloc, validates against TREE_SHAPE.epic, and sums to 2,295,000 gold at S rank', () => {
    expect(BUILT_IN_CLASSES.Packlord.pair).toBe('pre+ctl');
    expect(jobAlloc('Packlord')).toEqual({ pre: 2, ctl: 1 });
    expect(CLASS_SIGNATURES.Packlord).toBe(PACKLORD_SIGNATURE);
    expect(CLASS_TREES.Packlord).toBe(PACKLORD_TREE);
    expect(validateTree(PACKLORD_TREE)).toEqual([]);
    expect(PACKLORD_TREE.nodes.length).toBe(TREE_SHAPE.epic.total);

    const full = canonicalNodes();
    expect(full.length).toBe(TREE_SHAPE.epic.buyable);
    expect(repairNodes(PACKLORD_TREE, full)).toEqual(full);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of full) {
      expect(canBuyNode(PACKLORD_TREE, bought, id).ok, `node ${id} buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Packlord', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(2_295_000);

    // Early capstone unlock via Pack branch alone
    const rush = BRANCH_A_RUSH.map(nid);
    expect(capstoneUnlocked(PACKLORD_TREE, rush)).toBe(true);
    expect(canBuyNode(PACKLORD_TREE, rush, nid('pack-cap')).ok).toBe(true);

    // Fork flip legality
    expect(canFlipFork(PACKLORD_TREE, full, nid('pack-a5-l'), nid('pack-a5-r')).ok).toBe(true);
  });

  test('all 8 legal fork builds respect CLASS_ACTIVES_MAX, kit.scalers, FORMULA_PARTS, and MAX_ABILITIES priority', () => {
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
    }));

    const builds = allForkBuilds();
    expect(builds.length).toBe(8);
    for (const nodes of builds) {
      expect(nodes.length).toBe(TREE_SHAPE.epic.buyable);
      expect(repairNodes(PACKLORD_TREE, nodes)).toEqual(nodes);
      const h = makePacklord(nodes);
      const cp = classPowers(h, RULES);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBeLessThanOrEqual(RULES.fight.kit.scalers);
      expect(cp.worn?.key).toBe(statusKey('pack-bond-apex'));

      const row = hunterRow({ ...h, items: [...h.items, ...bombs] }, combatantId('h1'), RULES);
      for (const aid of ['pack-call', 'pack-mark-prey', 'pack-alpha-howl', 'pack-rally']) {
        expect(row.abilities.map(a => a.id)).toContain(wornAbilityId(abilityId(aid)));
      }
      const markAb = row.abilities.find(a => a.id === wornAbilityId(abilityId('pack-mark-prey')))!;
      const markForm = formulaOf(markAb, RULES)!;
      expect(partsOf(markForm)).toBeLessThanOrEqual(FORMULA_PARTS);
      if (nodes.includes(nid('pack-b5-r'))) {
        expect(scalersOf(markForm, RULES)?.scalers.length).toBe(1);
      } else {
        expect(scalersOf(markForm, RULES)).toBeNull();
      }
    }
  });

  test('every Packlord status and active ability round-trips cleanly through classStatusDef, shippedStatusDef, parseStatusDef, parseAbility, and fightWire at 0 wire bytes', () => {
    const expectedKeys = [
      'pack-bond',
      'pack-bond-apex',
      'pack-vengeance',
      'pack-vengeance-apex',
      'pack-fang',
      'pack-fang-ii',
      'pack-exposed',
      'pack-prey-marked',
      'pack-prey-marked-ii',
      'pack-alpha-howl',
      'pack-alpha-howl-ii',
    ];
    for (const k of expectedKeys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k)).toEqual(def);
    }

    const abilities: Ability[] = [...(PACKLORD_SIGNATURE.actives ?? [])];
    for (const n of PACKLORD_TREE.nodes) {
      for (const g of n.gifts) if (g.kind === 'replace-active') abilities.push(g.active);
    }
    expect(abilities.length).toBe(9);
    for (const a of abilities) {
      expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `parseAbility(${a.name})`).toEqual(a);
    }

    // Fight doc wire round-trip with Capstone worn AND a summoned Spirit Hound carrying pack-fang at 0 wire bytes
    const h = makePacklord(canonicalNodes());
    const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
    const foe = monsterRows({ name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-pack-wire'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(5, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
    const callId = wornAbilityId(abilityId('pack-call'));
    const summoned = reduce(f as Running, { type: 'act', by: combatantId('h1'), ability: callId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: KEYSTONES_ON }).fight as Running;

    const doc = fightDoc(summoned, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    // Neither Packlord's capstone worn nor the hound's pack-fang is copied into wire.defs (only dynamic aura zone holds appear)
    const defKeys = Object.keys(wire.defs ?? {});
    expect(defKeys).not.toContain('pack-bond-apex');
    expect(defKeys).not.toContain('pack-fang');
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    const pRow = parsed.rows.find(r => r.id === combatantId('h1'))!;
    expect(pRow.statuses.find(s => s.key === statusKey('pack-bond-apex'))?.def).toEqual(classStatusDef('pack-bond-apex')!);
    const houndRow = parsed.rows.find(r => r.kind === 'summon')!;
    expect(houndRow.statuses.find(s => s.key === statusKey('pack-fang'))?.def).toEqual(classStatusDef('pack-fang')!);
  });

  test('out-of-combat sheet matches combat modified sheet, potency: 10 reports under class, and signatures price cleanly', () => {
    for (const nodes of [[], canonicalNodes()]) {
      const h = makePacklord(nodes);
      const ooc = hunterSheet(h, RULES).sheet;
      const row = hunterRow(h, combatantId('h1'), RULES);
      const combat = modified(row.origin, row.statuses, RULES).sheet;
      expect(ooc.hpMax).toBe(combat.hpMax);
      expect(ooc.potency).toBe(combat.potency);
      expect(ooc.sup).toBeCloseTo(combat.sup, 4);
    }

    const base = makePacklord([]);
    // Class bonus contributes potency: 10 plus ctl: 2's curve share
    expect(explain(base, 'potency', RULES).parts.find(p => p.from === 'class')?.amount ?? 0).toBeGreaterThanOrEqual(10);

    const spendA = titleSpend({ bonus: PACKLORD_SIGNATURE.bonus ?? {}, worn: PACKLORD_SIGNATURE.worn!.def, band: 'A' }, RULES);
    expect(Number.isFinite(spendA.points)).toBe(true);
    expect(spendA.points).toBeGreaterThan(0);

    for (const a of PACKLORD_SIGNATURE.actives ?? []) {
      const w = abilityWorth(a, RULES, { rank: 'A', on: 'best' });
      expect(Number.isFinite(w.worth), `${a.name} finite`).toBe(true);
      expect(w.worth > 0 || w.unweighed.length > 0, `${a.name} weighed or unweighed`).toBe(true);
    }
  });

  test('every node and status description matches its numbers and follows voice.md rules', () => {
    const texts: string[] = [];
    for (const n of PACKLORD_TREE.nodes) {
      texts.push(n.name, n.desc);
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
    for (const k of ['pack-bond', 'pack-bond-apex', 'pack-vengeance', 'pack-vengeance-apex', 'pack-fang', 'pack-fang-ii', 'pack-exposed', 'pack-prey-marked', 'pack-prey-marked-ii', 'pack-alpha-howl', 'pack-alpha-howl-ii']) {
      const def = classStatusDef(k)!;
      texts.push(def.label, def.desc);
    }
    for (const t of texts) {
      expect(t, `em/en dash in "${t}"`).not.toMatch(/[—–]| -- /);
      expect(t, `semicolon in "${t}"`).not.toContain(';');
      expect(t, `filler "just" in "${t}"`).not.toMatch(/\bjust\b/i);
      expect(t, `exclamation in "${t}"`).not.toContain('!');
      expect(t, `British spelling in "${t}"`).not.toMatch(/\b(armour|defence|centre|colour|cancelled|harbour)\b/i);
    }
  });

  test('summonRow resolves class-defined starting statuses via classStatusDef while letting R.conditions override', () => {
    const spec = { name: 'Spirit Hound', archetype: 'brute' as const, rounds: 5, statuses: [{ key: statusKey('pack-fang'), rounds: 5 }] };
    const row = summonRow({ id: combatantId('h1'), side: 'party', tier: 4 }, spec, combatantId('s1'), tick(1000), RULES);
    expect(row.statuses.map(s => s.key)).toEqual([statusKey('pack-fang')]);
    expect(row.statuses[0]!.def).toEqual(classStatusDef('pack-fang')!);

    // Explicit R.conditions entry takes precedence over classStatusDef
    const overrideDef = { label: 'Custom Fang', desc: 'Override.', ops: [{ op: 'speed' as const, pct: 5 }] };
    const overridden = summonRow({ id: combatantId('h1'), side: 'party', tier: 4 }, spec, combatantId('s2'), tick(1000), { ...RULES, conditions: { 'pack-fang': overrideDef } });
    expect(overridden.statuses[0]!.def).toEqual(overrideDef);
  });
});

describe('Packlord combat mechanics', () => {
  test('Commander (pre+ctl) fires on Mark Prey, and striking Prey Marked tears once with no depth-2 self-recursion', () => {
    const ctx = { rules: KEYSTONES_ON };
    const packlord = makePacklord([], 'A');
    const pRow = hunterRow(packlord, combatantId('h1'), KEYSTONES_ON);
    // Verify Commander keystone is active on the pre+ctl Packlord
    expect(pRow.statuses.some(s => s.def.label === 'Commander')).toBe(true);

    const foe = monsterRows({ name: 'Ogre', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 4 }, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-pack-mark'),
      rows: [{ ...pRow, place: place(2, 2) }, { ...foe, place: place(3, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 18, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    // Cast Mark Prey: applies Prey Marked (-10% speed, +10% taken) AND Commander imposes Marked (+10% taken)
    const markId = wornAbilityId(abilityId('pack-mark-prey'));
    let r = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: markId,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const markedFoe = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(markedFoe.statuses.some(s => s.key === statusKey('pack-prey-marked'))).toBe(true);
    expect(markedFoe.statuses.some(s => s.key === statusKey('keystone-marked') && s.def.label === 'Marked')).toBe(true);

    // Strike the Prey Marked foe once: Prey Marked fires ONCE (never twice at depth 2)
    const logLenBefore = f.log.length;
    const strikeId = pRow.abilities[0]!.id;
    r = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: strikeId,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterStrike = r.fight as Running;
    const newLogs = afterStrike.log.slice(0, afterStrike.log.length - logLenBefore).map(l => l.text);
    const tearMatches = newLogs.join('\n').match(/Prey Marked/g) ?? [];
    expect(tearMatches.length).toBe(1);
    expect(rowHp(afterStrike.rows.find(x => x.id === combatantId('m1'))!)).toBeLessThan(rowHp(markedFoe));
  });

  test('Call the Pack fields twin brute Spirit Hounds with Pack Fang, sensible summons both, Pack Fang deals bonus bite + exposed and fires armyKill on Alpha Apex', () => {
    const ctx = { rules: RULES };
    const packlord = makePacklord(canonicalNodes(), 'A');
    const pRow = hunterRow(packlord, combatantId('h1'), RULES);
    // Also bring a full-HP non-minion ally hunter to verify Alpha Apex's `aura on: 'minions'` skips non-minions
    const allyBase = newHunter(RULES);
    const ally = { ...allyBase, id: 'h-ally', name: 'Mira', rank: 'A' as const, level: RULES.rankLevels.A, life: lifeAfter(allyBase.life, { type: 'heal', amount: 100_000 }, 100_000) };
    const aRow = hunterRow(ally, combatantId('h2'), RULES);
    const foe = monsterRows({ name: 'Goblin', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-pack-hounds'),
      rows: [{ ...pRow, place: place(2, 2) }, { ...aRow, place: place(3, 2) }, { ...foe, place: place(4, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    // Cast Call the Pack twice -> twin brute Spirit Hounds within kit.summons = 2
    const callId = wornAbilityId(abilityId('pack-call'));
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: callId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.filter(x => x.kind === 'summon' && x.owner === combatantId('h1')).length).toBe(1);

    // Verify sensible policy wants to cast Call the Pack a second time (timedCount = 1 < kit.summons = 2) once CD finishes
    const afterCd: Running = { ...f, now: tick(f.now + 2000) };
    const choice = sensible(afterCd, afterCd.rows.find(x => x.id === combatantId('h1'))!, RULES);
    expect(choice.type === 'act' && choice.ability.id === callId).toBe(true);

    r = reduce(afterCd, { type: 'act', by: combatantId('h1'), ability: callId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;

    const hounds = f.rows.filter(x => x.kind === 'summon' && x.owner === combatantId('h1'));
    expect(hounds.length).toBe(2);
    const hound = hounds[0]!;
    expect(hound.origin.kind === 'monster' && hound.origin.archetype).toBe('brute');
    expect(hound.abilities[0]!.kind).toBe('strike');
    expect(hound.statuses.some(s => s.key === statusKey('pack-fang'))).toBe(true);

    // Alpha Apex passive aura (`on: 'minions'`) holds on Spirit Hounds within 4 tiles, NOT on allied hunter Mira
    expect(hound.statuses.some(s => s.zone !== undefined && s.def.label === 'Alpha Apex')).toBe(true);
    const allyNow = f.rows.find(x => x.id === combatantId('h2'))!;
    expect(allyNow.statuses.some(s => s.zone !== undefined && s.def.label === 'Alpha Apex')).toBe(false);

    // Move hound adjacent to foe and strike: Pack Fang fires ONCE (bonus bite + pack-exposed), no recursion
    const adjFight: Running = {
      ...f,
      rows: f.rows.map(x => (x.id === hound.id ? { ...x, place: place(4, 3) } : x)),
    };
    const logBefore = adjFight.log.length;
    r = reduce(adjFight, {
      type: 'act',
      by: hound.id,
      ability: hound.abilities[0]!.id,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const foeAfterBite = f.rows.find(x => x.id === combatantId('m1'))!;
    expect(foeAfterBite.statuses.some(s => s.key === statusKey('pack-exposed'))).toBe(true);
    const fangMentions = f.log.slice(0, f.log.length - logBefore).map(l => l.text).join('\n').match(/Pack Fang/g) ?? [];
    expect(fangMentions.length).toBe(1);

    // Now hurt Packlord and leave monster at low HP so hound's Pack Fang bonus bite (or strike) kills it -> Alpha Apex armyKill heals 10% max HP!
    const hurtPacklordHp = Math.floor(f.rows.find(x => x.id === combatantId('h1'))!.sheet.hpMax * 0.5);
    // Give foe enough HP to survive a 1-roll strike (~bare hit) OR die to strike + Pack Fang bite
    const packlordRow = f.rows.find(x => x.id === combatantId('h1'))!;
    const expectedHeal = Math.round(0.1 * packlordRow.sheet.hpMax * (1 + packlordRow.sheet.healPower));
    const lowFoeFight: Running = {
      ...f,
      rows: f.rows.map(x => {
        if (x.id === combatantId('h1')) return { ...x, life: { at: 'up' as const, hp: hurtPacklordHp } };
        if (x.id === combatantId('m1')) return { ...x, life: { at: 'up' as const, hp: 1 } };
        return x;
      }),
    };
    r = reduce(lowFoeFight, {
      type: 'act',
      by: hound.id,
      ability: hound.abilities[0]!.id,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [4] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    const afterKill = r.fight!;
    const healedPacklord = afterKill.rows.find(x => x.id === combatantId('h1'))!;
    expect(rowHp(healedPacklord)).toBe(hurtPacklordHp + expectedHeal);
  });

  test('Pack Fang bonus bite killing a surviving monster still credits armyKill to the Packlord', () => {
    const ctx = { rules: RULES };
    const packlord = makePacklord(canonicalNodes(), 'A');
    const pRow = hunterRow(packlord, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-pack-fang-kill'),
      rows: [{ ...pRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const callId = wornAbilityId(abilityId('pack-call'));
    f = reduce(f as Running, { type: 'act', by: combatantId('h1'), ability: callId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx).fight as Running;
    const hound = f.rows.find(x => x.kind === 'summon')!;

    // Measure exact strike-only vs strike+Pack Fang damage by probing on a full-HP target first
    const adjBase: Running = {
      ...f,
      rows: f.rows.map(x => (x.id === hound.id ? { ...x, place: place(4, 3) } : x)),
    };
    const probeFoeBefore = rowHp(adjBase.rows.find(x => x.id === combatantId('m1'))!);
    const probeRes = reduce(adjBase, {
      type: 'act',
      by: hound.id,
      ability: hound.abilities[0]!.id,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [1] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    const totalDealt = probeFoeBefore - rowHp((probeRes.fight as Running).rows.find(x => x.id === combatantId('m1'))!);
    // Set monster HP to totalDealt - 1: the main strike alone leaves it alive, and Pack Fang's bonus bite finishes it!
    const hurtHp = Math.floor(adjBase.rows.find(x => x.id === combatantId('h1'))!.sheet.hpMax * 0.5);
    const setup: Running = {
      ...adjBase,
      rows: adjBase.rows.map(x => {
        if (x.id === combatantId('h1')) return { ...x, life: { at: 'up' as const, hp: hurtHp } };
        if (x.id === combatantId('m1')) return { ...x, life: { at: 'up' as const, hp: Math.max(2, totalDealt - 1) } };
        return x;
      }),
    };
    const res = reduce(setup, {
      type: 'act',
      by: hound.id,
      ability: hound.abilities[0]!.id,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [1] }, react: { [combatantId('m1')]: 10 } },
      force: true,
    }, ctx);
    const ended = res.fight!;
    expect(ended.rows.find(x => x.id === combatantId('m1'))!.life.at).toBe('dead');
    expect(rowHp(ended.rows.find(x => x.id === combatantId('h1'))!)).toBeGreaterThan(hurtHp);
  });

  test('Pack Bond grants Vengeance (+20% dealt, +20% speed, 12% max HP shield) on minionDown once a round, upgrading to Apex Vengeance at Capstone', () => {
    const ctx = { rules: RULES };
    const runDown = (nodes: readonly ClassNodeId[]) => {
      const packlord = makePacklord(nodes, 'A');
      const pRow = hunterRow(packlord, combatantId('h1'), RULES);
      const foe = monsterRows({ name: 'Crusher', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
      let f: Fight = reduce(null, {
        type: 'add',
        fightId: fightId(`f-pack-veng-${nodes.length}`),
        rows: [{ ...pRow, place: place(2, 2) }, { ...foe, place: place(5, 2) }],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
      const callId = wornAbilityId(abilityId('pack-call'));
      f = reduce(f as Running, { type: 'act', by: combatantId('h1'), ability: callId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx).fight as Running;
      const hound = f.rows.find(x => x.kind === 'summon')!;
      // Place 1-HP hound adjacent to boss and let boss kill it
      const before = {
        ...f,
        rows: f.rows.map(x => (x.id === hound.id ? { ...x, place: place(4, 2), life: { at: 'up' as const, hp: 1 } } : x)),
      };
      const speedBefore = before.rows.find(x => x.id === combatantId('h1'))!.speed;
      const r = reduce(before, {
        type: 'act',
        by: combatantId('m1'),
        ability: foe.abilities[0]!.id,
        aim: hound.id,
        rolls: { dice: { [hound.id]: [8] }, react: { [hound.id]: 1 } },
        force: true,
      }, ctx);
      expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
      return { after: r.fight as Running, speedBefore };
    };

    const base = runDown([]);
    const pBase = base.after.rows.find(x => x.id === combatantId('h1'))!;
    expect(pBase.statuses.some(s => s.key === statusKey('pack-vengeance'))).toBe(true);
    expect(pBase.speed).toBeGreaterThan(base.speedBefore);
    expect(pBase.shield?.amount).toBe(Math.round(0.12 * pBase.sheet.hpMax));

    const apex = runDown(canonicalNodes());
    const pApex = apex.after.rows.find(x => x.id === combatantId('h1'))!;
    expect(pApex.statuses.some(s => s.key === statusKey('pack-vengeance-apex'))).toBe(true);
    expect(pApex.shield?.amount).toBe(Math.round(0.18 * pApex.sheet.hpMax * (1 + pApex.sheet.healPower)));
  });

  test('Alpha Howl buffs nearby allies and hounds, Pack Rally heals and hastens, and Pack Surge fork dispels', () => {
    const ctx = { rules: RULES };
    const surgeNodes = ['pack-root', 'pack-c2', 'pack-c3x', 'pack-c3y', 'pack-c4x', 'pack-c4y', 'pack-c5-r'].map(nid);
    const packlord = makePacklord(surgeNodes, 'A');
    const ally = { ...newHunter(RULES), id: 'h-ally', name: 'Mira', rank: 'A' as const, level: RULES.rankLevels.A };
    const pRow = hunterRow(packlord, combatantId('h1'), RULES);
    const aRow0 = hunterRow(ally, combatantId('h2'), RULES);
    const slowed = statusOn(BUILT_IN_STATUSES.slowed, { key: statusKey('slowed'), source: { id: combatantId('m1'), tier: 4 }, until: tick(4000), since: tick(0), settledAt: tick(0) });
    const aRow = { ...aRow0, life: { at: 'up' as const, hp: 50 }, statuses: [...aRow0.statuses, slowed] };
    const foe = monsterRows({ name: 'Imp', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-pack-howl-rally'),
      rows: [{ ...pRow, place: place(2, 2) }, { ...aRow, place: place(4, 2) }, { ...foe, place: place(8, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 3 }, { id: combatantId('h2'), d20: 10, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    // Cast Alpha Howl -> ally within 4 tiles gains aura hold (+15% speed, +15% dealt)
    const allySpeed0 = f.rows.find(x => x.id === combatantId('h2'))!.speed;
    const howlId = wornAbilityId(abilityId('pack-alpha-howl'));
    let r = reduce(f, { type: 'act', by: combatantId('h1'), ability: howlId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.find(x => x.id === combatantId('h2'))!.speed).toBeGreaterThan(allySpeed0);

    // Cast Pack Rally: Pack Surge on ally (whose next turn is ahead of now) -> heals, hastens turn, and dispels Slowed
    const runningNow = f as Running;
    const beforeRally: Running = {
      ...runningNow,
      currentId: combatantId('h1'),
      rows: runningNow.rows.map(x => (x.id === combatantId('h2') ? { ...x, at: tick(runningNow.now + 900) } : x)),
    };
    const allyAt0 = beforeRally.rows.find(x => x.id === combatantId('h2'))!.at;
    const rallyId = wornAbilityId(abilityId('pack-rally'));
    r = reduce(beforeRally, { type: 'act', by: combatantId('h1'), ability: rallyId, aim: combatantId('h2'), rolls: { dice: { [combatantId('h2')]: [4, 4] }, react: {} }, force: true }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    const allyAfter = f.rows.find(x => x.id === combatantId('h2'))!;
    expect(rowHp(allyAfter)).toBeGreaterThan(50);
    expect(allyAfter.at).toBeLessThan(allyAt0);
    expect(allyAfter.statuses.some(s => s.key === statusKey('slowed'))).toBe(false);
  });
});
