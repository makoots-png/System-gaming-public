import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, RULES } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { fightId, parseClassNodeId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { explain, hunterSheet } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { lasting, modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Status } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseFight, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { interval, tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { mythicStep } from '../src/core/combat/mythic.ts';
import type { OmenKey } from '../src/core/combat/mythic-types.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { abilityOf, formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { USURPER_SIGNATURE, USURPER_TREE } from '../src/core/registry/class-usurper.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import { USURPER_CANONICAL_NODES } from './fixtures/usurper-solo.ts';

const AT = '2026-11-27T16:30:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

function makeUsurper(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, name: 'Usurper', rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, agi: 156, pow: 83 } },
    'Usurper',
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Usurper: { ...earned.classes.Usurper!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Usurper signature, 38-node tree, uniqueness, round-trip, and gold pricing', () => {
  test('USURPER_TREE validates against TREE_SHAPE.mythic, sums to 10,140,000 gold at S rank, and never replaces one active at both D5 and D7', () => {
    expect(CLASS_SIGNATURES.Usurper).toBe(USURPER_SIGNATURE);
    expect(CLASS_TREES.Usurper).toBe(USURPER_TREE);
    expect(validateTree(USURPER_TREE)).toEqual([]);
    expect(USURPER_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(USURPER_CANONICAL_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(USURPER_TREE, USURPER_CANONICAL_NODES)).toEqual([...USURPER_CANONICAL_NODES]);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of USURPER_CANONICAL_NODES) {
      const check = canBuyNode(USURPER_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Usurper', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);

    // No AbilityId replaced at both D5 and D7.
    const d5Targets = new Set(
      USURPER_TREE.nodes.filter(n => n.depth === 5).flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.targetId] : []))),
    );
    const d7Targets = new Set(
      USURPER_TREE.nodes.filter(n => n.depth === 7).flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.targetId] : []))),
    );
    for (const id of d5Targets) expect(d7Targets.has(id), `AbilityId ${id} replaced at both D5 and D7`).toBe(false);
    expect(d5Targets.size).toBe(3);
    expect(d7Targets.size).toBe(1);
  });

  test('every Usurper node name is unique against every shipped class in CLASS_TREES', () => {
    const otherNodeNames = new Map<string, string>();
    for (const [cls, tree] of Object.entries(CLASS_TREES)) {
      if (!tree || cls === 'Usurper') continue;
      for (const n of tree.nodes) otherNodeNames.set(n.name.toLowerCase(), `${cls}.${n.id}`);
    }
    const ownNames = new Set<string>();
    for (const n of USURPER_TREE.nodes) {
      const low = n.name.toLowerCase();
      expect(ownNames.has(low), `duplicate Usurper node name "${n.name}"`).toBe(false);
      ownNames.add(low);
      expect(otherNodeNames.has(low), `Usurper node "${n.name}" collides with ${otherNodeNames.get(low)}`).toBe(false);
    }
  });

  test('all usurp-* statuses and actives round-trip identically, keep <= 4 triggers on base and capstone worn, and keep 1-round ward durations', () => {
    const keys = [
      'usurp-crown',
      'usurp-sovereign-crown',
      'usurp-stolen-arcana',
      'usurp-usurped',
      'usurp-phantom-usurped',
      'usurp-broken-crown',
      'usurp-safeguard',
      'usurp-false-throne',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k);
      expect(reparsed, `parseStatusDef(${k})`).toEqual(def);
      expect(def!.triggers?.length ?? 0).toBeLessThanOrEqual(RULES.fight.kit.triggers);
    }

    expect(USURPER_SIGNATURE.worn!.def.triggers?.length ?? 0).toBeLessThanOrEqual(4);
    const capGift = USURPER_TREE.nodes.find(n => n.capstone)!.gifts.find(g => g.kind === 'replace-worn')!;
    expect(capGift.kind === 'replace-worn' && (capGift.worn.def.triggers?.length ?? 0)).toBeLessThanOrEqual(4);

    // Every base and fork active round-trips through parseAbility with toEqual, has no self-hasten, and ward statuses are 1 round.
    const allActives = [
      ...(USURPER_SIGNATURE.actives ?? []),
      ...USURPER_TREE.nodes.flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))),
    ];
    for (const ab of allActives) {
      const reparsed = parseAbility(JSON.parse(JSON.stringify(ab)), RULES);
      expect(reparsed, `parseAbility(${ab.name})`).toEqual(ab);
      expect(ab.ops.some(o => o.op === 'hasten'), `${ab.name} must not self-hasten`).toBe(false);
      for (const o of ab.ops) {
        if (o.op === 'applyStatus' && (o.key === statusKey('usurp-safeguard') || o.key === statusKey('usurp-false-throne'))) {
          expect(o.duration).toBe(tick(RULES.fight.kit.wardRounds * RULES.fight.round));
        }
      }
    }
  });

  test('every Usurper node desc matches its numeric gifts and all 64 fork combinations stay within kit.scalers, FORMULA_PARTS, and penMax', () => {
    for (const n of USURPER_TREE.nodes) {
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

    const forkGroups = [...new Set(USURPER_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => USURPER_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = USURPER_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const h = makeUsurper(nodes);
      const cp = classPowers(h, KEYSTONES_ON);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBeLessThanOrEqual(KEYSTONES_ON.fight.kit.scalers);
      const row = hunterRow(h, combatantId('h-check'), KEYSTONES_ON);
      const wornResistPen = row.statuses.reduce(
        (sum, s) => sum + s.def.ops.reduce(
          (acc, o) => (o.op === 'sheet' && o.key === 'resistPen' && typeof o.amount === 'number' ? acc + o.amount : acc),
          0,
        ),
        0,
      );
      const unclampedResistPen = (cp.bonus.resistPen ?? 0) + wornResistPen;
      expect(unclampedResistPen).toBe(36);
      expect(unclampedResistPen).toBeLessThanOrEqual(KEYSTONES_ON.fight.penMax);
      for (const ab of row.abilities) {
        const form = formulaOf(ab, KEYSTONES_ON);
        if (form) expect(partsOf(form), `${ab.name} formula parts`).toBeLessThanOrEqual(FORMULA_PARTS);
      }
    }
  });
});

describe('Usurper sheet, 0-byte fightWire pin, Hijack (Hook H3), Coup, Siphon Mandate, and Stolen Vigor', () => {
  test('hunterSheet, hunterRow, scalersOf, and 0-byte fightWire round-trip work for both base and capstone worn (plus mutation check)', () => {
    const bare = makeUsurper([]);
    const maxed = makeUsurper(USURPER_CANONICAL_NODES);

    expect(classPowers(bare, RULES).bonus.manaMax).toBe(30);
    expect(classPowers(bare, RULES).bonus.will).toBe(15);
    expect(classPowers(maxed, RULES).bonus.manaMax).toBe(65);
    expect(classPowers(maxed, RULES).bonus.will).toBe(52);
    expect(explain(bare, 'manaMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(30);
    expect(explain(maxed, 'manaMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(65);

    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;

    // Both base worn (usurp-crown) and capstone worn (usurp-sovereign-crown) leave wire.defs undefined.
    for (const [label, h, expectedKey] of [
      ['base', bare, statusKey('usurp-crown')],
      ['capstone', maxed, statusKey('usurp-sovereign-crown')],
    ] as const) {
      const row = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
      expect(row.statuses.some(s => s.key === expectedKey && s.worn), `${label} worn present`).toBe(true);
      let f: Fight | null = reduce(null, { type: 'add', fightId: fightId(`f-usurp-${label}`), rows: [{ ...row, place: place(2, 2) }, { ...foe, place: place(6, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
      const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error(`${label}: expected active FightDoc`);
      const wire = fightWire(doc);
      expect(wire.defs, `${label} wire.defs should be undefined`).toBeUndefined();
      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error(`${label}: expected parsed FightDoc`);
      const docRow = parsed.rows.find(r => r.id === combatantId('h1'))!;
      expect(docRow.statuses.find(s => s.key === expectedKey)?.def).toEqual(classStatusDef(expectedKey)!);

      // Mutation proof: mutating the worn def off the shipped registry causes wire.defs to appear (pin can fail).
      const mutatedRow = {
        ...row,
        statuses: row.statuses.map((s): Status => (s.key === expectedKey && s.stacks === undefined && !('stack' in s.def)
          ? { ...s, def: { ...s.def, desc: 'Mutated off-registry.' } }
          : s)),
      };
      let mf: Fight | null = reduce(null, { type: 'add', fightId: fightId(`f-mut-${label}`), rows: [{ ...mutatedRow, place: place(2, 2) }, { ...foe, place: place(6, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
      mf = reduce(mf, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
      const mDoc = fightDoc(mf, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!mDoc || mDoc.ended) throw new Error(`${label}: expected mutated FightDoc`);
      expect(fightWire(mDoc).defs, `${label} mutated worn must populate wire.defs`).toBeDefined();
    }

    // Scaler check on Hijack formula (Throne Seizer opener 18%).
    const maxRow = hunterRow(maxed, combatantId('h1'), KEYSTONES_ON);
    const hijack = maxRow.abilities.find(a => a.id === wornAbilityId(abilityId('usurp-hijack')))!;
    expect(hijack.name).toBe('Hijack: Grand Hijack');
    expect(hijack.usurp).toEqual({ amp: 1.5 });
    const hForm = formulaOf(hijack, KEYSTONES_ON)!;
    expect(partsOf(hForm)).toBeLessThanOrEqual(FORMULA_PARTS);
    expect(scalersOf(hForm, KEYSTONES_ON)?.scalers.length).toBe(1);
  });

  test('Hijack copies a standing mythic omen via Hook H3, fires 60% refund and heal, clamps status to 1r, and strips zones/Crescendo', () => {
    const hRow0 = hunterRow(makeUsurper(USURPER_CANONICAL_NODES), combatantId('h1'), RULES);
    const maxHp = modified(hRow0.origin, hRow0.statuses, RULES).sheet.hpMax;
    const woundedHero = { ...hRow0, life: lifeAfter(hRow0.life, { type: 'damage', amount: 80 }, maxHp) };

    const seed = seedMonsters(RULES).find(m => m.script === 'angel-of-the-last-trumpet')!;
    const angelRow = monsterRows(seed, [combatantId('m1')], RULES)[0]!;
    if (angelRow.kind !== 'monster') throw new Error('expected monster row');
    const barAt = angelRow.stagger ? { fill: angelRow.stagger.fill, max: angelRow.stagger.max } : null;
    const ann = mythicStep(angelRow.mythic!, { type: 'announce', omen: 'stars' as OmenKey, aim: place(2, 2), hpAt: 500, barAt });
    if (isRefused(ann)) throw new Error(ann.why);

    const ctx = { rules: RULES };
    let f = reduce(null, {
      type: 'add',
      fightId: fightId('f-usurp-hijack'),
      rows: [{ ...woundedHero, place: place(2, 2) }, { ...angelRow, place: place(6, 2), mythic: ann }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const f0 = f as Running;

    const hijackId = wornAbilityId(abilityId('usurp-hijack'));
    const heroBefore = f0.rows.find(r => r.id === combatantId('h1'))!;
    const hijackAb = heroBefore.abilities.find(a => a.id === hijackId)!;
    const hpBefore = rowHp(heroBefore);
    const angelHpBefore = rowHp(f0.rows.find(r => r.id === combatantId('m1'))!);

    // Roll react=1 so Angel is caught cleanly.
    const actCmd = {
      type: 'act' as const,
      by: combatantId('h1'),
      ability: hijackId,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } },
      force: true,
    };
    const res = reduce(f0, actCmd, ctx);
    expect(res.effects.some(e => e.type === 'refused')).toBe(false);
    expect(res.effects.filter(e => e.type === 'used')).toHaveLength(1);

    const after = res.fight as Running;
    const heroAfter = after.rows.find(r => r.id === combatantId('h1'))!;
    const angelAfter = after.rows.find(r => r.id === combatantId('m1'))!;

    // Copied Stars Fall without laying Fallen stars zone, clamping burning to 1 round.
    expect(after.zones).toEqual([]);
    expect(after.log.some(l => l.text.includes('Usurper usurps Stars Fall'))).toBe(true);
    const burn = angelAfter.statuses.find(s => s.key === statusKey('burning'));
    expect(burn?.until).toBe(tick(f0.now + RULES.fight.kit.wardRounds * RULES.fight.round));

    // Wire pin after Stars Fall omen copy: only the built-in condition (burning) enters wire.defs (fight-doc.ts omits
    // keystone and class defs via isShippedDef, never RULES.conditions); zero usurp-* or mythic-* defs leak onto the wire.
    const copyDoc = fightDoc(after, RULES, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!copyDoc || copyDoc.ended) throw new Error('expected active FightDoc after omen copy');
    const copyWire = fightWire(copyDoc);
    expect(Object.keys((copyWire.defs ?? {}) as Record<string, unknown>)).toEqual(['burning']);
    const parsedCopyDoc = DOCS.fight(JSON.parse(JSON.stringify(copyWire)));
    if (!parsedCopyDoc || parsedCopyDoc.ended) throw new Error('expected parsed FightDoc after omen copy');
    expect(parsedCopyDoc.rows.find(r => r.id === combatantId('m1'))?.statuses.find(s => s.key === statusKey('burning'))).toEqual(
      copyDoc.rows.find(r => r.id === combatantId('m1'))?.statuses.find(s => s.key === statusKey('burning')),
    );

    // Zero-byte wire pin after an omen copy that applies no built-in condition (Fourth Rider: Named in the Book):
    // fightWire(doc).defs is literally undefined.
    const riderSeed = seedMonsters(RULES).find(m => m.script === 'the-fourth-rider')!;
    const riderRow = monsterRows(riderSeed, [combatantId('m1')], RULES)[0]!;
    if (riderRow.kind !== 'monster') throw new Error('expected monster row');
    const annNamed = mythicStep(riderRow.mythic!, { type: 'announce', omen: 'named' as OmenKey, aim: combatantId('h1'), hpAt: 500, barAt: riderRow.stagger });
    if (isRefused(annNamed)) throw new Error(annNamed.why);
    let rf = reduce(null, {
      type: 'add',
      fightId: fightId('f-usurp-rider-wire'),
      rows: [{ ...woundedHero, place: place(2, 2) }, { ...riderRow, place: place(6, 2), mythic: annNamed }],
      openings: [],
    }, ctx).fight!;
    rf = reduce(rf, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const rRes = reduce(rf as Running, actCmd, ctx);
    expect(rRes.effects.some(e => e.type === 'refused')).toBe(false);
    const rAfter = rRes.fight as Running;
    expect(rAfter.log.some(l => l.text.includes('Usurper usurps Named in the Book'))).toBe(true);
    const riderDoc = fightDoc(rAfter, RULES, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!riderDoc || riderDoc.ended) throw new Error('expected active FightDoc after Rider omen copy');
    expect(fightWire(riderDoc).defs, 'wire.defs must be undefined after Named in the Book omen copy').toBeUndefined();

    // Deterministic replay pin: reducing a JSON-round-tripped fight produces the exact same result.
    const parsedF0 = parseFight(JSON.parse(JSON.stringify(f0)), RULES);
    expect(parsedF0).not.toBeNull();
    expect(reduce(parsedF0!, actCmd, ctx)).toEqual(res);

    // Copied hold pin (Weighed and Found Wanting -> paralyzed): B2's hard cap clamps control duration even with Usurper's 24 potency.
    const annWeighed = mythicStep(angelRow.mythic!, { type: 'announce', omen: 'weighed' as OmenKey, aim: combatantId('h1'), hpAt: 500, barAt });
    if (isRefused(annWeighed)) throw new Error(annWeighed.why);
    let wf = reduce(null, {
      type: 'add',
      fightId: fightId('f-usurp-weighed'),
      rows: [{ ...woundedHero, place: place(2, 2) }, { ...angelRow, place: place(6, 2), mythic: annWeighed }],
      openings: [],
    }, ctx).fight!;
    wf = reduce(wf, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const wf0 = wf as Running;
    const wHeroBefore = wf0.rows.find(r => r.id === combatantId('h1'))!;
    const wAngelBefore = wf0.rows.find(r => r.id === combatantId('m1'))!;
    const maxHold = tick(RULES.fight.kit.wardRounds * RULES.fight.round);
    expect(lasting(RULES.conditions.paralyzed, maxHold, wHeroBefore.tier, wHeroBefore.sheet.potency, wAngelBefore.sheet.tenacity)).toBeGreaterThan(maxHold);
    const wRes = reduce(wf0, actCmd, ctx);
    expect(wRes.effects.some(e => e.type === 'refused')).toBe(false);
    const wAngelAfter = (wRes.fight as Running).rows.find(r => r.id === combatantId('m1'))!;
    const para = wAngelAfter.statuses.find(s => s.key === statusKey('paralyzed'));
    expect(para).toBeDefined();
    // With potency 24 vs Angel tenacity 0, scaled base 806 rounds to 999 ticks (807 would round to 1001 > 1000).
    expect(para!.until).toBe(tick(wf0.now + 999));
    expect(para!.until).toBeLessThanOrEqual(tick(wf0.now + maxHold));

    // Crown of Stolen Power refunded 60% of Hijack's action time and healed 2% of max HP (Hijack itself imposes no root).
    const fullSpent = interval(heroBefore.speed, hijackAb.cost.time, RULES.fight);
    const expectedAt = tick(f0.now + fullSpent - Math.round(fullSpent * 60 / 100));
    expect(heroAfter.at).toBe(expectedAt);
    expect(rowHp(heroAfter)).toBe(Math.min(heroBefore.sheet.hpMax, hpBefore + Math.round(0.02 * heroBefore.sheet.hpMax)));
    expect(hijackAb.delivery).toEqual({ kind: 'direct' });
    expect(angelAfter.statuses.some(s => s.def.ops.some(o => o.op === 'root'))).toBe(false);

    // Mutation proof: stripping usurp from Hijack removes the usurp log line and deals strictly less damage.
    const noUsurpAb = { ...hijackAb };
    delete (noUsurpAb as { usurp?: unknown }).usurp;
    const fMut: Running = {
      ...f0,
      rows: f0.rows.map(r => (r.id === combatantId('h1')
        ? { ...r, abilities: r.abilities.map(a => (a.id === hijackId ? noUsurpAb : a)) }
        : r)),
    };
    const mutRes = reduce(fMut, {
      type: 'act',
      by: combatantId('h1'),
      ability: hijackId,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } },
      force: true,
    }, ctx);
    const mutAfter = mutRes.fight as Running;
    expect(mutAfter.log.some(l => l.text.includes('usurps'))).toBe(false);
    const angelMutHp = rowHp(mutAfter.rows.find(r => r.id === combatantId('m1'))!);
    expect(angelHpBefore - rowHp(angelAfter)).toBeGreaterThan(angelHpBefore - angelMutHp);

    // Echo Hijack fork reduces cooldown from 3 rounds to 2 rounds.
    const echoNodes = USURPER_CANONICAL_NODES.map(id => (id === nid('usurp-b5-l') ? nid('usurp-b5-r') : id));
    const echoRow = hunterRow(makeUsurper(echoNodes), combatantId('h-echo'), RULES);
    const echoHijack = echoRow.abilities.find(a => a.id === hijackId)!;
    expect(echoHijack.cost.cooldown).toBe(tick(2 * RULES.fight.round));
    expect(hijackAb.cost.cooldown).toBe(tick(3 * RULES.fight.round));
  });

  test('Coup blinks onto a free adjacent tile, applies Phantom Usurped (+2 exposed), and Flurry Coup takes 15% less action time', () => {
    const hRow = hunterRow(makeUsurper(USURPER_CANONICAL_NODES), combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, {
      type: 'add',
      fightId: fightId('f-coup'),
      rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(7, 5) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const f0 = f as Running;

    const coupId = wornAbilityId(abilityId('usurp-coup'));
    const dest = place(6, 5);
    const res = reduce(f0, {
      type: 'act',
      by: combatantId('h1'),
      ability: coupId,
      aim: dest,
      rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 2 } },
      force: true,
    }, ctx);
    expect(res.effects.some(e => e.type === 'refused')).toBe(false);
    const after = res.fight as Running;
    const heroAfter = after.rows.find(r => r.id === combatantId('h1'))!;
    const foeAfter = after.rows.find(r => r.id === combatantId('m1'))!;
    expect(heroAfter.place).toEqual(dest);
    expect(foeAfter.statuses.some(s => s.key === statusKey('usurp-phantom-usurped'))).toBe(true);
    // Capstone Crown Strip restored mana/fatigue without auto-shielding on imposing Phantom Usurped.
    expect(heroAfter.shield).toBeNull();

    // Flurry Coup has 15% shorter action time than Phantom Coup (60 vs 70).
    const flurryNodes = USURPER_CANONICAL_NODES.map(id => (id === nid('usurp-a5-l') ? nid('usurp-a5-r') : id));
    const flurryRow = hunterRow(makeUsurper(flurryNodes), combatantId('h-flurry'), RULES);
    const flurryAb = flurryRow.abilities.find(a => a.id === coupId)!;
    const phantomAb = hRow.abilities.find(a => a.id === coupId)!;
    expect(flurryAb.cost.time as number).toBe(Math.round(RULES.fight.cost.quick * 0.85));
    expect(flurryAb.cost.time as number).toBeLessThan(phantomAb.cost.time as number);
  });

  test('Siphon Mandate strips helpful buffs via Hook 2 while sparing shield-only, neutral, worn, and mythic-* statuses, and Null Mandate breaks channels', () => {
    const buffA: Status = {
      key: statusKey('test-buff-a'),
      def: { label: 'Battle Fury', desc: 'Deals 20% more damage.', ops: [{ op: 'share', on: 'dealt', pct: 20 }] },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0), until: tick(5000), settledAt: tick(0),
    };
    const buffB: Status = {
      key: statusKey('test-buff-b'),
      def: { label: 'Arcane Shell', desc: 'Adds 20 magic resist.', ops: [{ op: 'sheet', key: 'resist', amount: { kind: 'number', value: 20 } }] },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0), until: tick(5000), settledAt: tick(0),
    };
    const buffShield: Status = {
      key: statusKey('test-buff-shield'),
      def: { label: 'Barrier Ward', desc: 'Grants a 40-point shield.', ops: [{ op: 'shield', amount: { kind: 'number', value: 40 } }] },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0), until: tick(5000), settledAt: tick(0),
    };
    const neutralMark: Status = {
      key: statusKey('test-neutral'),
      def: { label: 'Neutral Mark', desc: 'A neutral tracking note.', ops: [{ op: 'note', text: 'Marked.' }] },
      source: { id: combatantId('h1'), tier: 5 },
      since: tick(0), until: tick(5000), settledAt: tick(0),
    };
    const wornBuff: Status = {
      key: statusKey('test-worn'),
      def: { label: 'Innate Hide', desc: 'Adds 10 armor.', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 10 } }] },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0), until: null, settledAt: tick(0), worn: true,
    };

    const runSiphon = (nodes: readonly ClassNodeId[]) => {
      const hRow = hunterRow(makeUsurper(nodes), combatantId('h1'), RULES);
      const baseFoe = monsterRows({
        name: 'Zaratan, the Island That Wakes', rank: 'S', archetype: 'brute', kind: 'mythic',
        script: 'zaratan-the-island-that-wakes', tweak: {}, abilities: [], statuses: [],
      }, [combatantId('m1')], RULES)[0]!;
      expect(baseFoe.statuses.some(s => s.key === statusKey('mythic-shell'))).toBe(true);
      const foe = { ...baseFoe, statuses: [buffA, buffB, buffShield, neutralMark, wornBuff, ...baseFoe.statuses] };
      const ctx = { rules: RULES };
      let f = reduce(null, { type: 'add', fightId: fightId('f-siphon'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(6, 5) }], openings: [] }, ctx).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
      const siphonId = wornAbilityId(abilityId('usurp-siphon-mandate'));
      const res = reduce(f, { type: 'act', by: combatantId('h1'), ability: siphonId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } }, force: true }, ctx);
      expect(res.effects.some(e => e.type === 'refused')).toBe(false);
      return (res.fight as Running).rows.find(r => r.id === combatantId('m1'))!.statuses.map(s => s.key);
    };

    // Base Siphon Mandate removes only the first helpful buff.
    const baseKeys = runSiphon([]);
    expect(baseKeys).not.toContain(statusKey('test-buff-a'));
    expect(baseKeys).toContain(statusKey('test-buff-b'));
    expect(baseKeys).toContain(statusKey('test-buff-shield'));
    expect(baseKeys).toContain(statusKey('test-neutral'));
    expect(baseKeys).toContain(statusKey('mythic-shell'));
    expect(baseKeys).toContain(statusKey('test-worn'));
    expect(baseKeys).toContain(statusKey('usurp-broken-crown'));

    // Imperial Siphon (canonical D5 Mandate fork) removes both helpful buffs while sparing shield-only, neutral, mythic-*, and worn.
    const impKeys = runSiphon(USURPER_CANONICAL_NODES);
    expect(impKeys).not.toContain(statusKey('test-buff-a'));
    expect(impKeys).not.toContain(statusKey('test-buff-b'));
    expect(impKeys).toContain(statusKey('test-buff-shield'));
    expect(impKeys).toContain(statusKey('test-neutral'));
    expect(impKeys).toContain(statusKey('mythic-shell'));
    expect(impKeys).toContain(statusKey('test-worn'));

    // Null Mandate breaks a holding foe channel.
    const nullNodes = USURPER_CANONICAL_NODES.map(id => (id === nid('usurp-c5-l') ? nid('usurp-c5-r') : id));
    const nullHero = hunterRow(makeUsurper(nullNodes), combatantId('h1'), RULES);
    const chanAb = abilityOf('curse', { id: abilityId('foe-chan'), name: 'Foe Channel', ticks: { channel: 'linear' } }, RULES);
    const chanFoe = monsterRows({ name: 'Channeler', rank: 'S', archetype: 'caster', kind: 'boss', tweak: { hp: 10 }, abilities: [chanAb], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let cf = reduce(null, { type: 'add', fightId: fightId('f-null-mandate'), rows: [{ ...nullHero, place: place(2, 5) }, { ...chanFoe, place: place(6, 5) }], openings: [] }, ctx).fight!;
    cf = reduce(cf, { type: 'start', openings: [{ id: combatantId('h1'), d20: 10, tie: 1 }, { id: combatantId('m1'), d20: 20, tie: 2 }] }, ctx).fight!;
    cf = reduce(cf, { type: 'act', by: combatantId('m1'), ability: chanAb.id, aim: combatantId('h1'), rolls: { dice: {}, react: {} } }, ctx).fight!;
    expect((cf as Running).rows.find(r => r.id === combatantId('m1'))!.channel?.state).toBe('holding');
    const siphonId = wornAbilityId(abilityId('usurp-siphon-mandate'));
    const brk = reduce(cf, { type: 'act', by: combatantId('h1'), ability: siphonId, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [1] }, react: { [combatantId('m1')]: 1 } }, force: true }, ctx);
    expect((brk.fight as Running).rows.find(r => r.id === combatantId('m1'))!.channel?.state).toBe('broken');
  });

  test('Stolen Vigor grants 1-round Usurper Ward safeguard, and False Throne grants once-per-fight 1-round invulnerable', () => {
    const throneNodes = USURPER_CANONICAL_NODES.map(id => (id === nid('usurp-a7-l') ? nid('usurp-a7-r') : id));
    const hRow = hunterRow(makeUsurper(throneNodes), combatantId('h1'), RULES);
    const nuke = abilityOf('curse', {
      id: abilityId('foe-nuke'),
      name: 'Lethal Hex',
      delivery: { kind: 'sure' },
      effect: { type: 'true', by: 'hand', formula: { kind: 'number', value: 9999 } },
      ops: [{ op: 'applyStatus', key: statusKey('burning'), def: RULES.conditions.burning, duration: tick(2 * RULES.fight.round) }],
    }, RULES);
    const foe = monsterRows({ name: 'Executioner', rank: 'S', archetype: 'caster', kind: 'boss', tweak: {}, abilities: [nuke], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-vigor'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(5, 5) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    const f0 = f as Running;

    const vigorId = wornAbilityId(abilityId('usurp-stolen-vigor'));
    const cast = reduce(f0, { type: 'act', by: combatantId('h1'), ability: vigorId, aim: combatantId('h1'), rolls: { dice: {}, react: {} } }, ctx);
    const f1 = cast.fight as Running;
    const u1 = f1.rows.find(r => r.id === combatantId('h1'))!;
    const ward = u1.statuses.find(s => s.key === statusKey('usurp-safeguard'));
    const inv = u1.statuses.find(s => s.key === statusKey('usurp-false-throne'));
    expect(ward?.until).toBe(tick(f0.now + RULES.fight.kit.wardRounds * RULES.fight.round));
    expect(inv?.until).toBe(tick(f0.now + RULES.fight.kit.wardRounds * RULES.fight.round));
    expect(u1.warded).toContain('invulnerable');

    // Lethal 9999 true hit leaves Usurper at 1 HP (False Throne) and blocks burning (Usurper Ward safeguard).
    const hit = reduce(f1, { type: 'act', by: combatantId('m1'), ability: nuke.id, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, ctx);
    const u2 = (hit.fight as Running).rows.find(r => r.id === combatantId('h1'))!;
    expect(rowHp(u2)).toBe(1);
    expect(u2.statuses.some(s => s.key === statusKey('burning'))).toBe(false);
  });

  test('base Stolen Crown avoid triggers deal Phantom Theft to attacker and grant Stolen Arcana to self (never to attacker)', () => {
    const hRow = hunterRow(makeUsurper([]), combatantId('h1'), RULES);
    const foeBolt = abilityOf('curse', {
      id: abilityId('foe-bolt'), name: 'Dark Bolt',
      range: tiles(8), shape: { kind: 'touch', reach: tiles(8) },
      delivery: { kind: 'direct' },
      effect: { type: 'arcane', by: 'hand', formula: { kind: 'number', value: 40 } },
    }, RULES);
    const foe = monsterRows({ name: 'Caster', rank: 'S', archetype: 'caster', kind: 'boss', tweak: { hp: 5 }, abilities: [foeBolt], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-avoid'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(6, 5) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 1, tie: 1 }, { id: combatantId('m1'), d20: 20, tie: 2 }] }, ctx).fight!;
    const f0 = f as Running;
    const foeHpBefore = rowHp(f0.rows.find(r => r.id === combatantId('m1'))!);

    // Usurper rolls natural 20 to resist Dark Bolt -> avoided event fires Phantom Theft on attacker + Stolen Arcana on self.
    const res = reduce(f0, {
      type: 'act',
      by: combatantId('m1'),
      ability: foeBolt.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: { [combatantId('h1')]: 20 } },
    }, ctx);
    const after = res.fight as Running;
    const heroAfter = after.rows.find(r => r.id === combatantId('h1'))!;
    const foeAfter = after.rows.find(r => r.id === combatantId('m1'))!;
    expect(rowHp(foeAfter)).toBeLessThan(foeHpBefore);
    expect(heroAfter.statuses.some(s => s.key === statusKey('usurp-stolen-arcana'))).toBe(true);
    expect(foeAfter.statuses.some(s => s.key === statusKey('usurp-stolen-arcana'))).toBe(false);
  });
});
