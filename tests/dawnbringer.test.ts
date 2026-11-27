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
import { bareBody, modified, statusKey } from '../src/core/combat/effect-ops.ts';
import { afterDefence } from '../src/core/combat/land.ts';
import { damageShare, harmful, helpful, sheetAdds } from '../src/core/combat/standing.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { FORMULA_PARTS, average, partsOf } from '../src/core/formula.ts';
import { abilityOf, formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { DAWNBRINGER_SIGNATURE, DAWNBRINGER_TREE } from '../src/core/registry/class-dawnbringer.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import { DAWNBRINGER_CANONICAL_NODES } from './fixtures/dawnbringer-solo.ts';

const AT = '2026-11-27T16:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

function makeDawnbringer(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, dis: 156, pre: 83 } },
    'Dawnbringer',
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Dawnbringer: { ...earned.classes.Dawnbringer!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Dawnbringer signature, 38-node tree, uniqueness, and gold pricing', () => {
  test('DAWNBRINGER_TREE validates against TREE_SHAPE.mythic, has unique node names across all shipped classes, and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Dawnbringer).toBe(DAWNBRINGER_SIGNATURE);
    expect(CLASS_TREES.Dawnbringer).toBe(DAWNBRINGER_TREE);
    expect(validateTree(DAWNBRINGER_TREE)).toEqual([]);
    expect(DAWNBRINGER_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(DAWNBRINGER_CANONICAL_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(DAWNBRINGER_TREE, DAWNBRINGER_CANONICAL_NODES)).toEqual([...DAWNBRINGER_CANONICAL_NODES]);

    // Every Dawnbringer node name is unique within Dawnbringer and against every other shipped class
    const otherNodeNames = new Map<string, string>();
    for (const [cls, tree] of Object.entries(CLASS_TREES)) {
      if (!tree || cls === 'Dawnbringer') continue;
      for (const n of tree.nodes) otherNodeNames.set(n.name.toLowerCase(), `${cls}.${n.id}`);
    }
    const ownNames = new Set<string>();
    for (const n of DAWNBRINGER_TREE.nodes) {
      const low = n.name.toLowerCase();
      expect(ownNames.has(low), `duplicate Dawnbringer node name "${n.name}"`).toBe(false);
      ownNames.add(low);
      expect(otherNodeNames.has(low), `Dawnbringer node "${n.name}" collides with ${otherNodeNames.get(low)}`).toBe(false);
    }

    // No AbilityId is replaced at both Depth 5 and Depth 7
    const d5Replaced = new Set(
      DAWNBRINGER_TREE.nodes
        .filter(n => n.depth === 5)
        .flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.targetId] : []))),
    );
    const d7Replaced = new Set(
      DAWNBRINGER_TREE.nodes
        .filter(n => n.depth === 7)
        .flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.targetId] : []))),
    );
    for (const id of d5Replaced) expect(d7Replaced.has(id), `${id} replaced at both D5 and D7`).toBe(false);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of DAWNBRINGER_CANONICAL_NODES) {
      const check = canBuyNode(DAWNBRINGER_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Dawnbringer', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('every Dawnbringer status def and active round-trips cleanly, worn statuses stay at <= 4 triggers, Zeal is neutral, and wards last 1 round', () => {
    const keys = [
      'dawn-rising',
      'dawn-avatar',
      'dawn-zeal',
      'dawn-ascension',
      'dawn-sunblind',
      'dawn-judgment-hold',
      'dawn-safeguard',
      'dawn-last-ward',
      'dawn-radiant-hymn',
      'dawn-sunlit-aegis',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k);
      expect(reparsed, `parseStatusDef(${k})`).toEqual(def);
      expect(def!.triggers?.length ?? 0).toBeLessThanOrEqual(RULES.fight.kit.triggers);
    }

    // Strictly <= 4 triggers on base and capstone worn
    expect(classStatusDef('dawn-rising')!.triggers?.length).toBe(4);
    expect(classStatusDef('dawn-avatar')!.triggers?.length).toBe(4);

    // Neutral counter and pulse statuses
    for (const neutralKey of ['dawn-zeal', 'dawn-radiant-hymn', 'dawn-sunlit-aegis']) {
      const def = classStatusDef(neutralKey)!;
      expect(harmful(def), `${neutralKey} should not be harmful`).toBe(false);
      expect(helpful(def), `${neutralKey} should not be helpful`).toBe(false);
    }

    // Base actives and every replace-active gift round-trip cleanly; every safeguard/invulnerable duration matches wardRounds (1 round)
    const allActives = [
      ...(DAWNBRINGER_SIGNATURE.actives ?? []),
      ...DAWNBRINGER_TREE.nodes.flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))),
    ];
    for (const ab of allActives) {
      const reparsed = parseAbility(JSON.parse(JSON.stringify(ab)), RULES);
      expect(reparsed, `parseAbility(${ab.name})`).toEqual(ab);
      for (const op of ab.ops) {
        if (op.op === 'applyStatus' && op.def.ops.some(x => x.op === 'safeguard' || x.op === 'invulnerable')) {
          expect(op.duration, `${ab.name} ward ${op.key} duration`).toBe(tick(RULES.fight.kit.wardRounds * RULES.fight.round));
        }
      }
    }

    // Blazing Lance scales higher than base Sunlance, and Overflowing Grace heals higher than base Benediction
    const hSample = hunterRow(makeDawnbringer([]), combatantId('h-avg'), RULES);
    const sampleBody = { ...hSample, ...modified(hSample.origin, hSample.statuses, RULES) };
    const baseLance = DAWNBRINGER_SIGNATURE.actives!.find(a => a.id === abilityId('dawn-sunlance'))!;
    const blazingLance = DAWNBRINGER_TREE.nodes.find(n => n.id === nid('dawn-a5-l'))!.gifts.find(g => g.kind === 'replace-active')!.active;
    expect(average(formulaOf(blazingLance, RULES)!, { user: sampleBody, target: sampleBody, charge: 0 }))
      .toBeGreaterThan(average(formulaOf(baseLance, RULES)!, { user: sampleBody, target: sampleBody, charge: 0 }));

    const baseBene = DAWNBRINGER_SIGNATURE.actives!.find(a => a.id === abilityId('dawn-benediction'))!;
    const graceBene = DAWNBRINGER_TREE.nodes.find(n => n.id === nid('dawn-b5-l'))!.gifts.find(g => g.kind === 'replace-active')!.active;
    expect(average(formulaOf(graceBene, RULES)!, { user: sampleBody, target: sampleBody, charge: 0 }))
      .toBeGreaterThan(average(formulaOf(baseBene, RULES)!, { user: sampleBody, target: sampleBody, charge: 0 }));
  });

  test('every Dawnbringer node desc matches its numeric gifts and all 64 fork combinations stay within kit.scalers, FORMULA_PARTS, and penMax', () => {
    for (const n of DAWNBRINGER_TREE.nodes) {
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

    const forkGroups = [...new Set(DAWNBRINGER_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => DAWNBRINGER_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = DAWNBRINGER_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const h = makeDawnbringer(nodes);
      const cp = classPowers(h, KEYSTONES_ON);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBeLessThanOrEqual(KEYSTONES_ON.fight.kit.scalers);
      const row = hunterRow(h, combatantId('h-check'), KEYSTONES_ON);
      if (row.origin.kind !== 'hunter') throw new Error('expected hunter origin');
      const F = KEYSTONES_ON.fight;
      const ctlScore = row.origin.build.stats.ctl + (row.origin.build.perks.ctl ?? 0);
      const unclampedResistPen = capped(above(ctlScore, F), F.penCap, F)
        + (row.origin.build.perks.resistPen ?? 0)
        + sheetAdds(row.statuses, bareBody(row.origin, KEYSTONES_ON), KEYSTONES_ON).resistPen;
      expect(unclampedResistPen).toBeLessThanOrEqual(F.penMax);
      for (const ab of row.abilities) {
        const form = formulaOf(ab, KEYSTONES_ON);
        if (form) expect(partsOf(form), `${ab.name} formula parts`).toBeLessThanOrEqual(FORMULA_PARTS);
      }
    }
  });
});

describe('Dawnbringer sheet, fight-doc wire (0 bytes), Ascension, Hook H2 overheal smite, and wards', () => {
  test('hunterSheet, hunterRow, scalersOf, and fightWire.defs (0 bytes) work cleanly for both base and capstone worn', () => {
    const bare = makeDawnbringer([]);
    const maxed = makeDawnbringer(DAWNBRINGER_CANONICAL_NODES);

    expect(classPowers(bare, RULES).bonus.manaMax).toBe(35);
    expect(classPowers(maxed, RULES).bonus.manaMax).toBe(80);
    expect(explain(bare, 'manaMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(35);
    expect(explain(maxed, 'manaMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(80);

    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;

    for (const [label, hunter, expectedKey] of [
      ['base', bare, 'dawn-rising'],
      ['capstone', maxed, 'dawn-avatar'],
    ] as const) {
      const row = hunterRow(hunter, combatantId('h1'), KEYSTONES_ON);
      expect(row.statuses.some(s => s.key === statusKey(expectedKey) && s.worn), `${label} worn present`).toBe(true);
      let f: Fight | null = reduce(null, { type: 'add', fightId: fightId(`f-dawn-${label}`), rows: [{ ...row, place: place(2, 2) }, { ...foe, place: place(5, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
      const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error(`expected active FightDoc for ${label}`);
      const wire = fightWire(doc);
      expect(wire.defs, `${label} wire.defs should be undefined (0 bytes)`).toBeUndefined();
      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error(`expected parsed FightDoc for ${label}`);
      const docRow = parsed.rows.find(r => r.id === combatantId('h1'))!;
      expect(docRow.statuses.find(s => s.key === statusKey(expectedKey))?.def).toEqual(classStatusDef(expectedKey)!);

      // Negative control: drifting a worn def off the shipped registry must cause fightWire to emit wire.defs
      const driftedRow = {
        ...row,
        statuses: row.statuses.map(s => (s.key !== statusKey(expectedKey) || s.stacks !== undefined ? s : { ...s, def: { ...s.def, desc: 'drifted' } })),
      };
      let fDrift: Fight | null = reduce(null, { type: 'add', fightId: fightId(`f-dawn-drift-${label}`), rows: [{ ...driftedRow, place: place(2, 2) }, { ...foe, place: place(5, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
      fDrift = reduce(fDrift, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
      const docDrift = fightDoc(fDrift, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!docDrift || docDrift.ended) throw new Error(`expected drifted FightDoc for ${label}`);
      expect(Object.keys(fightWire(docDrift).defs ?? {}), `${label} drifted def must appear in wire.defs`).toContain(expectedKey);
    }

    const row = hunterRow(maxed, combatantId('h1'), KEYSTONES_ON);
    const lance = row.abilities.find(a => a.id === wornAbilityId(abilityId('dawn-sunlance')))!;
    expect(lance.name).toBe('Sunlance: Blazing Lance');
    expect(scalersOf(formulaOf(lance, KEYSTONES_ON)!, KEYSTONES_ON)?.scalers.length).toBe(1);
  });

  test('Zeal converts 2 stacks into Ascension up to 3 stacks, expanding Sunlance reach from 4 to 7 tiles and adding Ascension solar damage', () => {
    const h = makeDawnbringer([]);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 10 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-asc'), rows: [{ ...hRow, place: place(1, 5) }, { ...foe, place: place(5, 5) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    const lanceId = wornAbilityId(abilityId('dawn-sunlance'));
    const beneId = wornAbilityId(abilityId('dawn-benediction'));
    const hitRolls = { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 5 } };
    const healRolls = { dice: { [combatantId('h1')]: [6] }, react: {} };

    // At Ascension 0, a target 7 tiles away is out of Sunlance's base range 4 (refused with 'range')
    const farFight: Running = {
      ...f,
      rows: f.rows.map(r => (r.id === combatantId('m1') ? { ...r, place: place(8, 5) } : r)),
    };
    const tooFar = reduce(farFight, { type: 'act', by: combatantId('h1'), ability: lanceId, aim: combatantId('m1'), rolls: hitRolls, force: true }, ctx);
    expect(tooFar.effects.some(e => e.type === 'refused' && e.reason === 'range')).toBe(true);

    // Build 3 Ascension stacks across 3 distinct rounds (each round: Sunlance hit = 1 Zeal, Benediction support = 2nd Zeal -> +1 Ascension)
    let cur: Running = f;
    for (let round = 0; round < 3; round++) {
      const nextRound = round === 0 ? 0 : Math.floor(cur.now / RULES.fight.round) + 1;
      const t = tick(nextRound * RULES.fight.round);
      cur = { ...cur, now: t, rows: cur.rows.map(r => (r.id === combatantId('h1') ? { ...r, readyAt: {}, mana: r.sheet.manaMax, fatigue: 0 } : r)) };
      const rHit = reduce(cur, { type: 'act', by: combatantId('h1'), ability: lanceId, aim: combatantId('m1'), rolls: hitRolls, force: true }, ctx);
      expect(rHit.effects.some(e => e.type === 'refused')).toBe(false);
      cur = rHit.fight as Running;
      expect(cur.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('dawn-zeal'))?.stacks).toBe(1);

      // Keep same round as rHit even if rHit staggered m1 and advanced the clock
      cur = { ...cur, now: t };
      const rBene = reduce(cur, { type: 'act', by: combatantId('h1'), ability: beneId, aim: combatantId('h1'), rolls: healRolls, force: true }, ctx);
      expect(rBene.effects.some(e => e.type === 'refused')).toBe(false);
      cur = rBene.fight as Running;
      expect(cur.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('dawn-zeal'))).toBeUndefined();
      expect(cur.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('dawn-ascension'))?.stacks).toBe(round + 1);
    }

    // At Ascension 3 (+3 range tiles), Sunlance now reaches 7 tiles away and triggers the Ascension bonus solar hit
    const farAsc: Running = {
      ...cur,
      now: tick((Math.floor(cur.now / RULES.fight.round) + 2) * RULES.fight.round),
      rows: cur.rows.map(r => (
        r.id === combatantId('m1') ? { ...r, place: place(8, 5) } : { ...r, readyAt: {}, mana: r.sheet.manaMax, fatigue: 0 }
      )),
    };
    const hpBefore = rowHp(farAsc.rows.find(r => r.id === combatantId('m1'))!);
    const farHit = reduce(farAsc, { type: 'act', by: combatantId('h1'), ability: lanceId, aim: combatantId('m1'), rolls: hitRolls, force: true }, ctx);
    expect(farHit.effects.some(e => e.type === 'refused')).toBe(false);
    const afterFar = farHit.fight as Running;
    expect(rowHp(afterFar.rows.find(r => r.id === combatantId('m1'))!)).toBeLessThan(hpBefore);
    expect(afterFar.log.some(l => l.text.includes("Hunter's Rising Dawn") || l.text.includes("Dawnbringer's Rising Dawn"))).toBe(true);
  });

  test('Hook H2 overheal smite hits the highest-HP foe within 6 tiles for exact over damage (base 75%, capstone 100% arcane) and skips when no overheal occurs', () => {
    const ctx = { rules: RULES };
    const beneId = wornAbilityId(abilityId('dawn-benediction'));
    const healRolls = { dice: { [combatantId('h1')]: [5] }, react: {} };

    for (const [label, nodes, coeff] of [
      ['base Rising Dawn', [] as readonly ClassNodeId[], 0.75],
      ['capstone Avatar of Dawn', DAWNBRINGER_CANONICAL_NODES, 1.0],
    ] as const) {
      const h = makeDawnbringer(nodes);
      const hRow = hunterRow(h, combatantId('h1'), RULES);
      const lowFoe = monsterRows({ name: 'LowFoe', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m-low')], RULES)[0]!;
      const highFoe = monsterRows({ name: 'HighFoe', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m-high')], RULES)[0]!;
      const farFoe = monsterRows({ name: 'FarFoe', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m-far')], RULES)[0]!;

      let f = reduce(null, {
        type: 'add',
        fightId: fightId(`f-over-${label.slice(0, 4)}`),
        rows: [
          { ...hRow, place: place(1, 5) },
          { ...lowFoe, place: place(3, 5) },   // dist 2, lower HP
          { ...highFoe, place: place(7, 5) },  // dist 6, highest HP in radius 6
          { ...farFoe, place: place(8, 5) },   // dist 7, outside radius 6
        ],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, {
        type: 'start',
        openings: [
          { id: combatantId('h1'), d20: 20, tie: 4 },
          { id: combatantId('m-low'), d20: 3, tie: 3 },
          { id: combatantId('m-high'), d20: 2, tie: 2 },
          { id: combatantId('m-far'), d20: 1, tie: 1 },
        ],
      }, ctx).fight!;
      if (f.phase !== 'running') throw new Error('expected running fight');

      // Cast Benediction at FULL HP -> entire heal is `over` -> smites HighFoe (dist 6), leaves LowFoe and FarFoe untouched
      const heroBefore = f.rows.find(r => r.id === combatantId('h1'))!;
      const highBefore = f.rows.find(r => r.id === combatantId('m-high'))!;
      const lowBefore = f.rows.find(r => r.id === combatantId('m-low'))!;
      const farBefore = f.rows.find(r => r.id === combatantId('m-far'))!;

      const res = reduce(f, { type: 'act', by: combatantId('h1'), ability: beneId, aim: combatantId('h1'), rolls: healRolls, force: true }, ctx);
      expect(res.effects.some(e => e.type === 'refused')).toBe(false);
      const after = res.fight as Running;

      const healAmount = Math.max(0, Math.round(
        (5 + (nodes.length ? 0.82 * heroBefore.sheet.sup + 0.36 * heroBefore.sheet.will : 0.72 * heroBefore.sheet.sup + 0.30 * heroBefore.sheet.will))
        * (1 + heroBefore.sheet.healPower),
      ));
      const expectedSmite = afterDefence(
        coeff * healAmount * damageShare(heroBefore, highBefore, RULES),
        'arcane',
        heroBefore.sheet,
        highBefore.sheet,
        RULES,
      );

      expect(rowHp(highBefore) - rowHp(after.rows.find(r => r.id === combatantId('m-high'))!), `${label} smite on HighFoe`).toBe(expectedSmite);
      expect(rowHp(after.rows.find(r => r.id === combatantId('m-low'))!), `${label} LowFoe untouched`).toBe(rowHp(lowBefore));
      expect(rowHp(after.rows.find(r => r.id === combatantId('m-far'))!), `${label} FarFoe untouched`).toBe(rowHp(farBefore));

      // When injured far below max HP (so Benediction does NOT overheal), zero smite lands
      const hurtFight: Running = {
        ...f,
        rows: f.rows.map(r => (r.id === combatantId('h1') ? { ...r, life: lifeAfter(r.life, { type: 'damage', amount: r.sheet.hpMax - 1 }, r.sheet.hpMax) } : r)),
      };
      const noOver = reduce(hurtFight, { type: 'act', by: combatantId('h1'), ability: beneId, aim: combatantId('h1'), rolls: healRolls, force: true }, ctx).fight as Running;
      expect(rowHp(noOver.rows.find(r => r.id === combatantId('m-high'))!), `${label} no overheal -> 0 smite`).toBe(rowHp(highBefore));
    }
  });

  test('Daybreak Ward grants 1-round Dawn Safeguard blocking foe harmful statuses, Solstice Ward hastens another ally, and Last Light saves from lethal damage once', () => {
    const ctx = { rules: RULES };
    const h = makeDawnbringer(DAWNBRINGER_CANONICAL_NODES);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const ally = hunterRow(makeDawnbringer([]), combatantId('h2'), RULES);
    const curse = abilityOf('curse', {
      id: abilityId('test-curse'),
      name: 'Hex',
      aim: 'foe',
      range: tiles(6),
      shape: { kind: 'touch', reach: tiles(6) },
      delivery: { kind: 'sure' },
      foesOnly: true,
      effect: { type: 'arcane', by: 'hand', formula: { kind: 'number', value: 10 } },
      ops: [{ op: 'applyStatus', key: statusKey('stunned'), def: RULES.conditions.stunned, duration: tick(RULES.fight.round) }],
    }, RULES);
    const nuke = abilityOf('strike', {
      id: abilityId('test-nuke'),
      name: 'Execution Blow',
      aim: 'foe',
      range: tiles(4),
      shape: { kind: 'touch', reach: tiles(4) },
      delivery: { kind: 'sure' },
      foesOnly: true,
      effect: { type: 'true', by: 'hand', formula: { kind: 'number', value: 5000 } },
      ops: [],
    }, RULES);
    const foeBase = monsterRows({ name: 'Boss', rank: 'S', archetype: 'brute', kind: 'boss', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const foe = { ...foeBase, abilities: [curse, nuke] };

    let f = reduce(null, {
      type: 'add',
      fightId: fightId('f-wards'),
      rows: [
        { ...hRow, place: place(2, 5), armed: { ability: wornAbilityId(abilityId('dawn-last-light')), on: null, spent: false } },
        { ...ally, place: place(4, 5) },
        { ...foe, place: place(5, 5) },
      ],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 20, tie: 3 },
        { id: combatantId('h2'), d20: 10, tie: 2 },
        { id: combatantId('m1'), d20: 5, tie: 1 },
      ],
    }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    // 1. Solstice Ward on ally h2 shields h2, grants 1-round Dawn Safeguard, and hastens h2's next turn
    const wardId = wornAbilityId(abilityId('dawn-daybreak-ward'));
    const h2Before = f.rows.find(r => r.id === combatantId('h2'))!;
    const rWard = reduce(f, { type: 'act', by: combatantId('h1'), ability: wardId, aim: combatantId('h2'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(rWard.effects.some(e => e.type === 'refused')).toBe(false);
    const f1 = rWard.fight as Running;
    const h2After = f1.rows.find(r => r.id === combatantId('h2'))!;
    expect(h2After.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(h2After.at).toBeLessThan(h2Before.at);
    const sg = h2After.statuses.find(s => s.key === statusKey('dawn-safeguard'))!;
    expect(sg).toBeDefined();
    expect(sg.until).toBe(tick(f.now + RULES.fight.round));

    // Foe's harmful stun is blocked by Dawn Safeguard on h2
    const rHex = reduce(f1, { type: 'act', by: combatantId('m1'), ability: curse.id, aim: combatantId('h2'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    const f2 = rHex.fight as Running;
    expect(f2.rows.find(r => r.id === combatantId('h2'))!.statuses.some(s => s.key === statusKey('stunned'))).toBe(false);

    // 2. Lethal blow against armed h1 fires Phoenix Rebuke (Last Light), keeping h1 alive with Last Light Ward, mana restore, and invulnerable recorded on warded
    const f2LowMana: Running = {
      ...f2,
      rows: f2.rows.map(r => (r.id === combatantId('h1') ? { ...r, mana: 30 } : r)),
    };
    const rNuke = reduce(f2LowMana, { type: 'act', by: combatantId('m1'), ability: nuke.id, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    const f3 = rNuke.fight as Running;
    const h1Saved = f3.rows.find(r => r.id === combatantId('h1'))!;
    expect(rowHp(h1Saved)).toBeGreaterThanOrEqual(1);
    expect(h1Saved.mana).toBeGreaterThan(30);
    expect(h1Saved.statuses.some(s => s.key === statusKey('dawn-last-ward'))).toBe(true);
    expect(h1Saved.warded).toContain('invulnerable');
    expect(h1Saved.armed?.spent).toBe(true);
  });

  test('Radiant Hymn and Sunlit Aegis affect allies within 2 tiles, spare foes, and Radiant Hymn feeds Hook H2 overheal smite', () => {
    const ctx = { rules: RULES };
    const hymnNodes = DAWNBRINGER_CANONICAL_NODES.map(id => (
      id === nid('dawn-b5-l') ? nid('dawn-b5-r') : id === nid('dawn-c5-l') ? nid('dawn-c5-r') : id
    ));
    const h = makeDawnbringer(hymnNodes);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const allyHunter = makeDawnbringer([]);
    const allyHpMax = hunterSheet(allyHunter, RULES).sheet.hpMax;
    const ally = hunterRow(allyHunter, combatantId('h2'), RULES);
    const foe = monsterRows({ name: 'Foe', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    let f = reduce(null, {
      type: 'add',
      fightId: fightId('f-aoe'),
      rows: [
        { ...hRow, place: place(3, 5) },
        { ...ally, place: place(5, 5), life: lifeAfter(ally.life, { type: 'damage', amount: 80 }, allyHpMax) },
        { ...foe, place: place(4, 5) }, // dist 1 from h1: inside radius 2, must be SPARED from heal/shield and SMITTEN by overheal!
      ],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 20, tie: 3 },
        { id: combatantId('h2'), d20: 10, tie: 2 },
        { id: combatantId('m1'), d20: 5, tie: 1 },
      ],
    }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    const beneId = wornAbilityId(abilityId('dawn-benediction'));
    const wardId = wornAbilityId(abilityId('dawn-daybreak-ward'));
    const allyHp0 = rowHp(f.rows.find(r => r.id === combatantId('h2'))!);
    const foeHp0 = rowHp(f.rows.find(r => r.id === combatantId('m1'))!);

    // Radiant Hymn heals ally h2, spares foe m1 from heal, and h1's overheal smites m1 at trigger depth 2!
    const rHymn = reduce(f, { type: 'act', by: combatantId('h1'), ability: beneId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(rHymn.effects.some(e => e.type === 'refused')).toBe(false);
    const f1 = rHymn.fight as Running;
    expect(rowHp(f1.rows.find(r => r.id === combatantId('h2'))!)).toBeGreaterThan(allyHp0);
    expect(rowHp(f1.rows.find(r => r.id === combatantId('m1'))!)).toBeLessThan(foeHp0);

    // Sunlit Aegis shields and safeguards h1 and h2, while sparing foe m1
    const rAegis = reduce(f1, { type: 'act', by: combatantId('h1'), ability: wardId, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    expect(rAegis.effects.some(e => e.type === 'refused')).toBe(false);
    const f2 = rAegis.fight as Running;
    expect(f2.rows.find(r => r.id === combatantId('h1'))!.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(f2.rows.find(r => r.id === combatantId('h2'))!.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(f2.rows.find(r => r.id === combatantId('h2'))!.statuses.some(s => s.key === statusKey('dawn-safeguard'))).toBe(true);
    expect(f2.rows.find(r => r.id === combatantId('m1'))!.shield).toBeNull();
    expect(f2.rows.find(r => r.id === combatantId('m1'))!.statuses.some(s => s.key === statusKey('dawn-safeguard'))).toBe(false);
  });
});
