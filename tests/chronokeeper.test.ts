import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, BONUS_KEYS, RULES } from '../src/core/rules.ts';
import type { BonusKey, Rank } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { fightId, parseClassNodeId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, heldKeystones, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { combatantId, abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import { exposedOf } from '../src/core/combat/standing.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { titleSpend } from '../src/core/registry/item-budget.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { BUILT_IN_CLASSES } from '../src/core/registry/jobs.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, canFlipFork, capstoneUnlocked, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { CHRONOKEEPER_SIGNATURE, CHRONOKEEPER_TREE } from '../src/core/registry/class-chronokeeper.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import { onCooldown, payCost } from '../src/core/combat/charge.ts';
import { inRange } from '../src/core/combat/resolve.ts';
import { playFight } from './models/fight-sim.ts';

const AT = '2026-11-27T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

const CANONICAL_FORKS = ['chrono-a5-l', 'chrono-b5-l', 'chrono-c5-l'] as const;
const BRANCH_A_RUSH = ['chrono-root', 'chrono-a2', 'chrono-a3x', 'chrono-a3y', 'chrono-a4x', 'chrono-a4y', 'chrono-a5-l', 'chrono-a6'] as const;

function canonicalNodes(): ClassNodeId[] {
  return CHRONOKEEPER_TREE.nodes
    .filter(n => !n.forkGroup || (CANONICAL_FORKS as readonly string[]).includes(n.id))
    .map(n => n.id);
}

function makeChronokeeper(
  nodes: readonly ClassNodeId[] = [],
  opts: { rank?: Rank; stats?: Partial<Record<'ctl' | 'dis' | 'pow' | 'vit', number>>; rules?: typeof RULES } = {},
) {
  const rank = opts.rank ?? 'A';
  const R = opts.rules ?? RULES;
  const base = newHunter(R);
  const stats = { ...base.stats, ctl: 106, dis: 58, ...opts.stats };
  const earned = earnClass(
    { ...base, name: 'Chronokeeper', rank, level: R.rankLevels[rank], stats },
    'Chronokeeper',
    { at: AT, R },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Chronokeeper: { ...earned.classes.Chronokeeper!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, R);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Wave 3 U5: Chronokeeper metadata, tree, budgets, and round-trip integrity', () => {
  test('Chronokeeper uses dis+ctl (ctl:2, dis:1), awakens Inquisitor, Lockdown, Unbroken Focus, and Puppeteer, and sums to 2,295,000 gold at S rank', () => {
    expect(BUILT_IN_CLASSES.Chronokeeper).toEqual({
      rarity: 'epic',
      unique: true,
      recRank: 'A',
      pair: 'dis+ctl',
      alloc: { ctl: 2, dis: 1 },
    });
    expect(CLASS_SIGNATURES.Chronokeeper).toBe(CHRONOKEEPER_SIGNATURE);
    expect(CLASS_TREES.Chronokeeper).toBe(CHRONOKEEPER_TREE);
    expect(validateTree(CHRONOKEEPER_TREE)).toEqual([]);
    expect(CHRONOKEEPER_TREE.nodes.length).toBe(TREE_SHAPE.epic.total);

    const h = makeChronokeeper([], { rules: KEYSTONES_ON });
    const names = heldKeystones(h, KEYSTONES_ON).map(k => k.keystone.name);
    expect(names).toContain('Inquisitor');
    expect(names).toContain('Lockdown');
    expect(names).toContain('Unbroken Focus');
    expect(names).toContain('Puppeteer');

    const full = canonicalNodes();
    expect(full.length).toBe(TREE_SHAPE.epic.buyable);
    expect(repairNodes(CHRONOKEEPER_TREE, full)).toEqual(full);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of full) {
      expect(canBuyNode(CHRONOKEEPER_TREE, bought, id).ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Chronokeeper', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(2_295_000);

    const rush = BRANCH_A_RUSH.map(nid);
    expect(capstoneUnlocked(CHRONOKEEPER_TREE, rush)).toBe(true);
    expect(canBuyNode(CHRONOKEEPER_TREE, rush, nid('chrono-cap')).ok).toBe(true);
    expect(canFlipFork(CHRONOKEEPER_TREE, full, nid('chrono-a5-l'), nid('chrono-a5-r')).ok).toBe(true);
    expect(canFlipFork(CHRONOKEEPER_TREE, full, nid('chrono-b5-l'), nid('chrono-b5-r')).ok).toBe(true);
    expect(canFlipFork(CHRONOKEEPER_TREE, full, nid('chrono-c5-l'), nid('chrono-c5-r')).ok).toBe(true);
  });

  test('base signature passes Epic titleSpend and abilityWorth bounds, reports haste under class, and round-trips wire.defs at 0 bytes', () => {
    const rootB = titleSpend({ bonus: CHRONOKEEPER_SIGNATURE.bonus ?? {}, worn: CHRONOKEEPER_SIGNATURE.worn!.def, band: 'B' }, RULES);
    const rootA = titleSpend({ bonus: CHRONOKEEPER_SIGNATURE.bonus ?? {}, worn: CHRONOKEEPER_SIGNATURE.worn!.def, band: 'A' }, RULES);
    expect(rootB.points).toBeGreaterThan(15);
    expect(rootB.points).toBeLessThan(40);
    expect(rootA.points).toBeGreaterThan(15);
    expect(rootA.points).toBeLessThan(45);

    for (const a of CHRONOKEEPER_SIGNATURE.actives ?? []) {
      const w = abilityWorth(a, RULES, { rank: 'A', on: 'best' });
      expect(w.worth, `${a.name} worth > 0`).toBeGreaterThan(0);
      expect(w.worth, `${a.name} worth <= 2.2`).toBeLessThanOrEqual(2.2);
    }

    const baseH = makeChronokeeper([]);
    expect(explain(baseH, 'haste', RULES).parts.find(p => p.from === 'class')?.amount).toBe(6);

    const abilities: Ability[] = [...(CHRONOKEEPER_SIGNATURE.actives ?? [])];
    for (const n of CHRONOKEEPER_TREE.nodes) {
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
    expect(abilities.length).toBe(10);
    for (const a of abilities) {
      expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `parseAbility(${a.name})`).toEqual(a);
      const form = formulaOf(a, RULES);
      if (form) expect(partsOf(form)).toBeLessThanOrEqual(FORMULA_PARTS);
    }

    for (const key of [
      'chrono-hourglass',
      'chrono-hourglass-master',
      'chrono-drag',
      'chrono-drag-entropy',
      'chrono-quicksilver',
      'chrono-overclock',
      'chrono-twin-tempo',
      'chrono-frozen',
      'chrono-edge',
    ]) {
      const def = classStatusDef(key);
      expect(def, `classStatusDef(${key})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(key))).toEqual(def);
      expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, key)).toEqual(def);
    }

    const capH = makeChronokeeper(canonicalNodes(), { rules: KEYSTONES_ON });
    const cp = classPowers(capH, RULES);
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    expect(cp.worn?.key).toBe(statusKey('chrono-hourglass-master'));

    const hRow = hunterRow(capH, combatantId('h1'), KEYSTONES_ON);
    const foe = monsterRows({ name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-chrono-wire'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    expect(parsed.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('chrono-hourglass-master'))?.def).toEqual(classStatusDef('chrono-hourglass-master')!);
  });
});

describe('Chronokeeper combat mechanics', () => {
  const BOLT_ID = wornAbilityId(abilityId('chrono-bolt'));
  const ACCEL_ID = wornAbilityId(abilityId('chrono-accelerate'));
  const STASIS_ID = wornAbilityId(abilityId('chrono-stasis'));
  const SLIP_ID = wornAbilityId(abilityId('chrono-time-slip'));

  test('Chrono Bolt fires Hourglass Pulse (20% refund + 4 mana), Inquisitor self-cleanse, Lockdown extra delay, and Puppeteer echo onto a nearby foe', () => {
    const ctx = { rules: KEYSTONES_ON };
    const chrono = makeChronokeeper([], { rules: KEYSTONES_ON });
    const cRow0 = hunterRow(chrono, combatantId('h1'), KEYSTONES_ON);
    // Give Chronokeeper a harmful burn and reduced mana to observe Inquisitor cleanse + Hourglass mana refund
    const burn = statusOn(BUILT_IN_STATUSES.burning, { key: statusKey('burning'), source: { id: combatantId('m1'), tier: 4 }, until: tick(4000), since: tick(0), settledAt: tick(0) });
    const cRow = { ...cRow0, mana: Math.max(4, cRow0.mana - 10), statuses: [...cRow0.statuses, burn] };
    const [m1, m2] = monsterRows({ name: 'Sentinel', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1'), combatantId('m2')], KEYSTONES_ON);

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-chrono-synergy'),
      rows: [
        { ...cRow, place: place(2, 2) },
        { ...m1!, place: place(7, 2) },
        { ...m2!, place: place(9, 2) }, // 2 tiles from m1 -> inside Puppeteer echo radius 2
      ],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 20, tie: 3 },
        { id: combatantId('m1'), d20: 10, tie: 2 },
        { id: combatantId('m2'), d20: 5, tie: 1 },
      ],
    }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    const startNow = f.now;
    const hStart = f.rows.find(x => x.id === combatantId('h1'))!;
    const manaBefore = hStart.mana;
    const m1AtBefore = f.rows.find(x => x.id === combatantId('m1'))!.at;
    const stdInterval = Math.round(RULES.fight.round * (RULES.fight.cost.standard / 100) * (RULES.fight.speedBase / hStart.sheet.speed));

    const r = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: BOLT_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const after = r.fight as Running;
    const hAfter = after.rows.find(x => x.id === combatantId('h1'))!;
    const m1After = after.rows.find(x => x.id === combatantId('m1'))!;
    const m2After = after.rows.find(x => x.id === combatantId('m2'))!;

    // Chrono Drag landed on m1 AND echoed onto m2 via Puppeteer!
    expect(m1After.statuses.some(s => s.key === statusKey('chrono-drag'))).toBe(true);
    expect(m2After.statuses.some(s => s.key === statusKey('chrono-drag'))).toBe(true);

    // m1 delayed by Chrono Bolt (200) + Lockdown (200) = 400 ticks!
    expect(m1After.at - m1AtBefore).toBeGreaterThanOrEqual(400);

    // Inquisitor self-cleansed the burning status!
    expect(hAfter.statuses.some(s => s.key === statusKey('burning'))).toBe(false);

    // Hourglass Pulse refunded 20% of the turn AND restored 4 mana (offsetting the 4-mana cost)!
    expect(hAfter.mana).toBeGreaterThanOrEqual(manaBefore);
    expect(hAfter.at - startNow).toBeLessThan(stdInterval);
  });

  test('Time Slip turn reaction jumps Chronokeeper directly before the named foe turn with shield and Temporal Edge', () => {
    const ctx = { rules: RULES };
    const chrono = makeChronokeeper([]);
    const cRow = hunterRow(chrono, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Lancer', rank: 'A', archetype: 'skirmisher', kind: 'elite', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-chrono-slip'),
      rows: [{ ...cRow, place: place(2, 2) }, { ...foe, place: place(9, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 15, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');

    // Arm Time Slip targeting m1's turn
    let r = reduce(f, { type: 'arm', by: combatantId('h1'), ability: SLIP_ID, on: combatantId('m1') }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight as Running;
    expect(f.rows.find(x => x.id === combatantId('h1'))!.armed?.on).toBe(combatantId('m1'));

    // End Chronokeeper's turn so m1 would normally act next -> Time Slip fires and jumps Chronokeeper right before m1!
    const m1At = f.rows.find(x => x.id === combatantId('m1'))!.at;
    r = reduce(f, { type: 'endTurn', by: combatantId('h1') }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const jumped = r.fight as Running;
    expect(jumped.currentId).toBe(combatantId('h1'));
    const hJumped = jumped.rows.find(x => x.id === combatantId('h1'))!;
    expect(hJumped.at).toBeLessThan(m1At);
    expect(hJumped.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(hJumped.statuses.some(s => s.key === statusKey('chrono-edge'))).toBe(true);
  });

  test('Accelerate forks (Twin Tempo ally-area vs Overclock) and Stasis Field forks (Frozen Second vs Tidal Clock) and Entropy Sand scaler work cleanly', () => {
    const ctx = { rules: RULES };

    // 1. Twin Tempo hastens aimed ally and nearby ally within 2 tiles while sparing nearby foe
    const twinNodes = ['chrono-root', 'chrono-b2', 'chrono-b3x', 'chrono-b3y', 'chrono-b4x', 'chrono-b4y', 'chrono-b5-l'].map(nid);
    const cTwin = makeChronokeeper(twinNodes);
    const ally1 = { ...newHunter(RULES), id: 'h-a1', name: 'A1', rank: 'A' as const, level: 50 };
    const ally2 = { ...newHunter(RULES), id: 'h-a2', name: 'A2', rank: 'A' as const, level: 50 };
    const foe = monsterRows({ name: 'Imp', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let fTwin: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-chrono-twin'),
      rows: [
        { ...hunterRow(cTwin, combatantId('h1'), RULES), place: place(2, 2) },
        { ...hunterRow(ally1, combatantId('h2'), RULES), place: place(6, 2) },
        { ...hunterRow(ally2, combatantId('h3'), RULES), place: place(8, 2) }, // 2 tiles from h2
        { ...foe, place: place(7, 2) }, // 1 tile from h2 -> must NOT receive Quicksilver
      ],
      openings: [],
    }, ctx).fight!;
    fTwin = reduce(fTwin, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 20, tie: 4 },
        { id: combatantId('h2'), d20: 5, tie: 3 },
        { id: combatantId('h3'), d20: 4, tie: 2 },
        { id: combatantId('m1'), d20: 1, tie: 1 },
      ],
    }, ctx).fight!;
    const a1At0 = (fTwin as Running).rows.find(x => x.id === combatantId('h2'))!.at;
    const a2At0 = (fTwin as Running).rows.find(x => x.id === combatantId('h3'))!.at;
    const rTwin = reduce(fTwin as Running, { type: 'act', by: combatantId('h1'), ability: ACCEL_ID, aim: combatantId('h2'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(rTwin.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterTwin = rTwin.fight as Running;
    const h2After = afterTwin.rows.find(x => x.id === combatantId('h2'))!;
    const h3After = afterTwin.rows.find(x => x.id === combatantId('h3'))!;
    // Aimed ally h2 is genuinely hastened (far beyond Quicksilver's +20% speed rescale), gets Quicksilver, and has no lingering blank Twin Tempo carrier
    expect(h2After.at).toBeLessThan(Math.round(a1At0 * 100 / 120) - 100);
    expect(h2After.statuses.some(s => s.key === statusKey('chrono-quicksilver'))).toBe(true);
    expect(h2After.statuses.some(s => s.key === statusKey('chrono-twin-tempo'))).toBe(false);
    expect(h3After.statuses.some(s => s.key === statusKey('chrono-quicksilver'))).toBe(true);
    expect(h3After.at).toBeLessThan(a2At0);
    expect(afterTwin.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('chrono-quicksilver'))).toBe(false);

    // 2. Stasis Field: Frozen Second holds caught foes and lays Time Warp zone; Tidal Clock extends Time Warp to 3 rounds
    const frozenNodes = ['chrono-root', 'chrono-c2', 'chrono-c3x', 'chrono-c3y', 'chrono-c4x', 'chrono-c4y', 'chrono-c5-l'].map(nid);
    const cFrozen = makeChronokeeper(frozenNodes);
    const elite = monsterRows({ name: 'Ogre', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let fStasis: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-chrono-stasis'),
      rows: [{ ...hunterRow(cFrozen, combatantId('h1'), RULES), place: place(2, 2) }, { ...elite, place: place(6, 2) }],
      openings: [],
    }, ctx).fight!;
    fStasis = reduce(fStasis, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const rStasis = reduce(fStasis as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: STASIS_ID,
      aim: place(6, 2),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } },
      force: true,
    }, ctx);
    expect(rStasis.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterStasis = rStasis.fight as Running;
    expect(afterStasis.rows.find(x => x.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('chrono-frozen'))).toBe(true);
    expect(afterStasis.zones.find(z => z.name === 'Time Warp')?.spares).toBe('party');

    // 3. Entropy Sand fork exposes target (+1 crit face) and attaches opener scaler (0.15)
    const entNodes = ['chrono-root', 'chrono-a2', 'chrono-a3x', 'chrono-a3y', 'chrono-a4x', 'chrono-a4y', 'chrono-a5-r'].map(nid);
    const cEnt = makeChronokeeper(entNodes);
    const entRow = hunterRow(cEnt, combatantId('h1'), RULES);
    const boltAb = entRow.abilities.find(a => a.id === BOLT_ID)!;
    expect(scalersOf(formulaOf(boltAb, RULES)!, RULES)?.scalers).toEqual([{ measure: 'target', dir: 'over', start: 0.5, scale: 0.15 }]);
    let fEnt: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-chrono-ent'),
      rows: [{ ...entRow, place: place(2, 2) }, { ...elite, place: place(6, 2) }],
      openings: [],
    }, ctx).fight!;
    fEnt = reduce(fEnt, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const rEnt = reduce(fEnt as Running, {
      type: 'act',
      by: combatantId('h1'),
      ability: BOLT_ID,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(rEnt.effects.filter(e => e.type === 'refused')).toEqual([]);
    expect(exposedOf((rEnt.fight as Running).rows.find(x => x.id === combatantId('m1'))!)).toBe(1);
  });

  test('Master of Hours capstone raises speed bonus to 15% and restores 3 mana at turn start', () => {
    const ctx = { rules: RULES };
    const baseC = makeChronokeeper([]);
    const capC = makeChronokeeper(canonicalNodes());
    const baseRow = hunterRow(baseC, combatantId('h1'), RULES);
    const capRow0 = hunterRow(capC, combatantId('h1'), RULES);
    expect(modified(capRow0.origin, capRow0.statuses, RULES).sheet.speed).toBeGreaterThan(modified(baseRow.origin, baseRow.statuses, RULES).sheet.speed);

    const capRow = { ...capRow0, mana: 5 };
    const foe = monsterRows({ name: 'Dummy', rank: 'A', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    let f: Fight = reduce(null, {
      type: 'add',
      fightId: fightId('f-chrono-cap'),
      rows: [{ ...capRow, place: place(2, 2) }, { ...foe, place: place(6, 2) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running');
    // First turn start already triggered Master of Hours (+3 mana from 5 -> 8)
    expect(f.rows.find(x => x.id === combatantId('h1'))!.mana).toBe(8);
  });

  test('Rewind Strike at capstone speed cannot delay-lock an A-rank brute boss to 0 turns over 10 rounds', () => {
    const capC = makeChronokeeper(canonicalNodes(), { rules: KEYSTONES_ON });
    const heroRow = { ...hunterRow(capC, combatantId('h1'), KEYSTONES_ON), place: place(2, 2) };
    let totalFoeTurns = 0;
    const runs = 10;
    for (let seed = 1; seed <= runs; seed++) {
      let foeTurns = 0;
      const foe = monsterRows({ name: 'Brute', rank: 'A', archetype: 'brute', kind: 'boss', tweak: { hp: 30 }, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
      playFight({
        rows: [
          {
            row: heroRow,
            policy: (fl: Running, me) => {
              const ab = me.abilities.find(a => a.id === BOLT_ID);
              const t = fl.rows.find(r => r.id === combatantId('m1'));
              if (ab && t && !onCooldown(ab, me, fl.now) && payCost(ab, me) && inRange(ab, me, t.place)) {
                return { type: 'act' as const, ability: ab, aim: t.id };
              }
              return { type: 'pass' as const };
            },
          },
          {
            row: { ...foe, place: place(7, 2) },
            policy: () => { foeTurns++; return { type: 'pass' as const }; },
          },
        ],
        rules: KEYSTONES_ON,
        tallyDamage: false,
        endAtRounds: 10,
      }, seed);
      expect(foeTurns, `seed ${seed}: boss must not be delay-locked to 0 turns`).toBeGreaterThan(0);
      totalFoeTurns += foeTurns;
    }
    expect(totalFoeTurns / runs).toBeGreaterThanOrEqual(1.5);
  });
});
