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
import { damageShare, sheetAdds } from '../src/core/combat/standing.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { dist, place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { FORMULA_PARTS, average, evaluate, partsOf } from '../src/core/formula.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { STARFORGER_SIGNATURE, STARFORGER_TREE } from '../src/core/registry/class-starforger.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import { STARFORGER_CANONICAL_NODES } from './fixtures/starforger-solo.ts';

const AT = '2026-11-27T05:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

function makeStarforger(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, pow: 156, ctl: 83 } },
    'Starforger',
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Starforger: { ...earned.classes.Starforger!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Starforger signature, 38-node tree, and gold pricing', () => {
  test('STARFORGER_TREE validates against TREE_SHAPE.mythic and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Starforger).toBe(STARFORGER_SIGNATURE);
    expect(CLASS_TREES.Starforger).toBe(STARFORGER_TREE);
    expect(validateTree(STARFORGER_TREE)).toEqual([]);
    expect(STARFORGER_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(STARFORGER_CANONICAL_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(STARFORGER_TREE, STARFORGER_CANONICAL_NODES)).toEqual([...STARFORGER_CANONICAL_NODES]);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of STARFORGER_CANONICAL_NODES) {
      const check = canBuyNode(STARFORGER_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Starforger', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('every Starforger status def and ability round-trips cleanly and every Starforge fork keeps zone.name === "Star"', () => {
    const keys = [
      'star-loom',
      'star-architect',
      'star-gravity-bind',
      'star-starlit',
      'star-starward',
      'star-starward-conduit',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k);
      expect(reparsed, `parseStatusDef(${k})`).toEqual(def);
      expect(def!.triggers?.length ?? 0).toBeLessThanOrEqual(RULES.fight.kit.triggers);
    }

    // Base actives and every replace-active gift round-trip through parseAbility; every Starforge variant keeps zone.name = 'Star'
    const allActives = [
      ...(STARFORGER_SIGNATURE.actives ?? []),
      ...STARFORGER_TREE.nodes.flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))),
    ];
    for (const ab of allActives) {
      const reparsed = parseAbility(JSON.parse(JSON.stringify(ab)), RULES);
      expect(reparsed, `parseAbility(${ab.name})`).toEqual(ab);
      if (ab.id === abilityId('star-starforge')) {
        expect(ab.zone?.name, `${ab.name} must keep zone.name = 'Star'`).toBe('Star');
      }
    }

    // Binary Core has strictly higher impact scaling than base Starforge, matching its node description
    const baseStarforge = STARFORGER_SIGNATURE.actives!.find(a => a.id === abilityId('star-starforge'))!;
    const binaryNode = STARFORGER_TREE.nodes.find(n => n.id === nid('star-a5-l'))!;
    const binaryStarforge = binaryNode.gifts.find(g => g.kind === 'replace-active')!.active;
    const hSample = hunterRow(makeStarforger([]), combatantId('h-avg'), RULES);
    const sampleBody = { ...hSample, ...modified(hSample.origin, hSample.statuses, RULES) };
    const baseAvg = average(formulaOf(baseStarforge, RULES)!, { user: sampleBody, target: sampleBody, charge: 0 });
    const binaryAvg = average(formulaOf(binaryStarforge, RULES)!, { user: sampleBody, target: sampleBody, charge: 0 });
    expect(binaryAvg).toBeGreaterThan(baseAvg);
  });

  test('every Starforger node desc matches its numeric gifts and every fork combination stays within kit.scalers and penMax', () => {
    for (const n of STARFORGER_TREE.nodes) {
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

    // All 64 legal fork combinations stay within kit.scalers, FORMULA_PARTS, and penMax
    const forkGroups = [...new Set(STARFORGER_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => STARFORGER_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = STARFORGER_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const h = makeStarforger(nodes);
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

describe('Starforger sheet, fight-doc wire, and Hook 1 zone-price mechanics', () => {
  test('hunterSheet, hunterRow, scalersOf, and fight-doc wire.defs (0 bytes) work cleanly', () => {
    const bare = makeStarforger([]);
    const maxed = makeStarforger(STARFORGER_CANONICAL_NODES);

    expect(classPowers(bare, RULES).bonus.manaMax).toBe(35);
    expect(classPowers(maxed, RULES).bonus.manaMax).toBe(80);
    expect(explain(bare, 'manaMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(35);
    expect(explain(maxed, 'manaMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(80);

    const row = hunterRow(maxed, combatantId('h1'), KEYSTONES_ON);
    expect(row.statuses.some(s => s.key === statusKey('star-architect') && s.worn)).toBe(true);
    const nova = row.abilities.find(a => a.id === wornAbilityId(abilityId('star-supernova')))!;
    expect(nova.name).toBe('Supernova: Solar Cascade');
    const novaForm = formulaOf(nova, KEYSTONES_ON)!;
    expect(partsOf(novaForm)).toBeLessThanOrEqual(FORMULA_PARTS);
    expect(scalersOf(novaForm, KEYSTONES_ON)?.scalers.length).toBe(1);

    // Singularity fork also replaces Supernova cleanly and stays within FORMULA_PARTS
    const singNodes = STARFORGER_CANONICAL_NODES.map(id => (id === nid('star-a7-r') ? nid('star-a7-l') : id));
    const singRow = hunterRow(makeStarforger(singNodes), combatantId('h-sing'), KEYSTONES_ON);
    const singNova = singRow.abilities.find(a => a.id === wornAbilityId(abilityId('star-supernova')))!;
    expect(singNova.name).toBe('Supernova: Singularity');
    expect(partsOf(formulaOf(singNova, KEYSTONES_ON)!)).toBeLessThanOrEqual(FORMULA_PARTS);

    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-star'), rows: [{ ...row, place: place(2, 2) }, { ...foe, place: place(6, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    const docRow = parsed.rows.find(r => r.id === combatantId('h1'))!;
    expect(docRow.statuses.find(s => s.key === statusKey('star-architect'))?.def).toEqual(classStatusDef('star-architect')!);
  });

  test('Supernova refuses with 0 Stars, consumes all active Star zones for Hook 1 spent scaling, and triggers Corona Ward + Nova Echo', () => {
    const h = makeStarforger(STARFORGER_CANONICAL_NODES);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 10 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-nova'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(6, 5) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    const starforgeId = wornAbilityId(abilityId('star-starforge'));
    const supernovaId = wornAbilityId(abilityId('star-supernova'));
    const aim = place(6, 5);
    const rolls = { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 5 } };

    // 0 Stars held -> Supernova refused with 'zone'
    const ref0 = reduce(f, { type: 'act', by: combatantId('h1'), ability: supernovaId, aim, rolls, force: true }, ctx);
    expect(ref0.effects.some(e => e.type === 'refused' && e.reason === 'zone')).toBe(true);

    // Lay Star #1 at t=0 (also triggers Corona Ward shield)
    const r1 = reduce(f, { type: 'act', by: combatantId('h1'), ability: starforgeId, aim, rolls, force: true }, ctx);
    expect(r1.effects.some(e => e.type === 'refused')).toBe(false);
    const f1 = r1.fight as Running;
    expect(f1.zones.filter(z => z.name === 'Star').length).toBe(1);
    expect(f1.rows.find(r => r.id === combatantId('h1'))!.shield?.amount ?? 0).toBeGreaterThan(0);

    // Helper computing exact expected Supernova damage for a given `spent` count (no zone.end pop)
    const expectedSupernova = (before: Running, spent: number): number => {
      const u = before.rows.find(r => r.id === combatantId('h1'))!;
      const t = before.rows.find(r => r.id === combatantId('m1'))!;
      const ab = u.abilities.find(a => a.id === supernovaId)!;
      const form = formulaOf(ab, RULES)!;
      const raw = evaluate(form, {
        user: { stats: u.stats, sheet: u.sheet },
        target: { stats: t.stats, sheet: t.sheet },
        charge: 0,
        dice: [10],
        kit: {
          stacks: { user: {}, target: {} },
          field: {},
          missing: {
            user: u.sheet.hpMax > 0 ? Math.max(0, Math.min(1, 1 - rowHp(u) / u.sheet.hpMax)) : 0,
            target: t.sheet.hpMax > 0 ? Math.max(0, Math.min(1, 1 - rowHp(t) / t.sheet.hpMax)) : 0,
          },
          held: {},
          hits: 1,
          kills: 0,
          spent,
        },
      });
      return afterDefence(raw * damageShare(u, t, RULES), 'arcane', u.sheet, t.sheet, RULES);
    };

    // 1-Star Supernova at t=200 (Star #1 age < 1 round, so zero zone.end detonation)
    const f1Ready: Running = { ...f1, now: tick(200) };
    const hpBefore1 = rowHp(f1Ready.rows.find(r => r.id === combatantId('m1'))!);
    const nova1 = reduce(f1Ready, { type: 'act', by: combatantId('h1'), ability: supernovaId, aim, rolls, force: true }, ctx);
    expect(nova1.effects.some(e => e.type === 'refused')).toBe(false);
    const fAfterNova1 = nova1.fight as Running;
    expect(fAfterNova1.zones.filter(z => z.name === 'Star').length).toBe(0);
    const dmg1 = hpBefore1 - rowHp(fAfterNova1.rows.find(r => r.id === combatantId('m1'))!);
    expect(dmg1).toBe(expectedSupernova(f1Ready, 1));
    expect(dmg1).toBeGreaterThan(expectedSupernova(f1Ready, 0));

    // Lay Star #2 inside the SAME round (t=100, clearing readyAt on h1) so neither Star reaches zoneAge (1000 ticks)
    const fBeforeStar2: Running = {
      ...f1,
      now: tick(100),
      rows: f1.rows.map(r => (r.id === combatantId('h1') ? { ...r, readyAt: {} } : r)),
    };
    const r2 = reduce(fBeforeStar2, { type: 'act', by: combatantId('h1'), ability: starforgeId, aim, rolls, force: true }, ctx);
    expect(r2.effects.some(e => e.type === 'refused')).toBe(false);
    const f2 = r2.fight as Running;
    const heldStars = f2.zones.filter(z => z.name === 'Star');
    expect(heldStars.length).toBe(2);
    for (const z of heldStars) expect(tick(200) - (z.laid ?? 0)).toBeLessThan(RULES.fight.round);

    // Fire 2-Star Supernova at t=200 (zero zone.end pops: pure Hook 1 `spent = 2` scaling)
    const f2Ready: Running = { ...f2, now: tick(200) };
    const hpBefore2 = rowHp(f2Ready.rows.find(r => r.id === combatantId('m1'))!);
    const manaBefore2 = f2Ready.rows.find(r => r.id === combatantId('h1'))!.mana;
    const nova2 = reduce(f2Ready, { type: 'act', by: combatantId('h1'), ability: supernovaId, aim, rolls, force: true }, ctx);
    expect(nova2.effects.some(e => e.type === 'refused')).toBe(false);
    const fAfterNova2 = nova2.fight as Running;
    expect(fAfterNova2.zones.filter(z => z.name === 'Star').length).toBe(0);
    const dmg2 = hpBefore2 - rowHp(fAfterNova2.rows.find(r => r.id === combatantId('m1'))!);
    expect(dmg2).toBe(expectedSupernova(f2Ready, 2));
    expect(dmg2).toBeGreaterThan(expectedSupernova(f2Ready, 1));
    expect(dmg2).toBeGreaterThan(dmg1);

    // Nova Echo restores 12 mana after paying Supernova's discounted mana cost (net mana loss <= 4)
    const manaAfter2 = fAfterNova2.rows.find(r => r.id === combatantId('h1'))!.mana;
    expect(manaBefore2 - manaAfter2).toBeLessThanOrEqual(4);
  });

  test('Gravity Snare: Orbital Pull pulls the target 2 tiles toward the user without rooting it', () => {
    const h = makeStarforger(STARFORGER_CANONICAL_NODES);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-pull'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(8, 5) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    const snareId = wornAbilityId(abilityId('star-gravity-snare'));
    const rolls = { dice: { [combatantId('m1')]: [6] }, react: { [combatantId('m1')]: 5 } };
    const beforeFoe = f.rows.find(r => r.id === combatantId('m1'))!;
    expect(beforeFoe.place).toEqual(place(8, 5));

    const res = reduce(f, { type: 'act', by: combatantId('h1'), ability: snareId, aim: combatantId('m1'), rolls, force: true }, ctx);
    expect(res.effects.some(e => e.type === 'refused')).toBe(false);
    const after = res.fight as Running;
    const afterFoe = after.rows.find(r => r.id === combatantId('m1'))!;
    expect(afterFoe.place).toEqual(place(6, 5));
    expect(Number(dist(place(2, 5), afterFoe.place))).toBe(Number(dist(place(2, 5), beforeFoe.place)) - 2);
    expect(afterFoe.statuses.some(s => s.key === statusKey('star-starlit'))).toBe(true);
    expect(afterFoe.statuses.some(s => s.key === statusKey('star-gravity-bind'))).toBe(false);
  });

  test('Gravity Snare: Stellar Drift shifts a held Star zone toward the target', () => {
    const driftNodes = STARFORGER_CANONICAL_NODES.map(id => (id === nid('star-b5-l') ? nid('star-b5-r') : id));
    const h = makeStarforger(driftNodes);
    const hRow = hunterRow(h, combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-drift'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(8, 5) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    const starforgeId = wornAbilityId(abilityId('star-starforge'));
    const snareId = wornAbilityId(abilityId('star-gravity-snare'));
    const rolls = { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 5 } };

    // Lay Star at (4, 5), then cast Stellar Drift on foe at (8, 5) -> Star shifts toward (8, 5)
    const r1 = reduce(f, { type: 'act', by: combatantId('h1'), ability: starforgeId, aim: place(4, 5), rolls, force: true }, ctx);
    const f1 = r1.fight as Running;
    const beforeZone = f1.zones.find(z => z.name === 'Star')!;
    expect(beforeZone.ground.kind).toBe('around');
    const beforeCenterX = beforeZone.ground.kind === 'around' && beforeZone.ground.anchor.kind === 'place'
      ? beforeZone.ground.anchor.at.x
      : 0;

    const r2 = reduce(f1, { type: 'act', by: combatantId('h1'), ability: snareId, aim: combatantId('m1'), rolls, force: true }, ctx);
    expect(r2.effects.some(e => e.type === 'refused')).toBe(false);
    const f2 = r2.fight as Running;
    const afterZone = f2.zones.find(z => z.name === 'Star')!;
    const afterCenterX = afterZone.ground.kind === 'around' && afterZone.ground.anchor.kind === 'place'
      ? afterZone.ground.anchor.at.x
      : 0;
    expect(afterCenterX).toBeGreaterThan(beforeCenterX);
  });
});
