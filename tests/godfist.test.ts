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
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { damageShare, harmful, helpful } from '../src/core/combat/standing.ts';
import { afterDefence } from '../src/core/combat/land.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { dist, place, tiles } from '../src/core/combat/space.ts';
import { interval, tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { abilityOf, formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { GODFIST_SIGNATURE, GODFIST_TREE } from '../src/core/registry/class-godfist.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import { GODFIST_CANONICAL_NODES } from './fixtures/godfist-solo.ts';

const AT = '2026-11-27T15:45:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

function makeGodfist(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, str: 156, dis: 83 } },
    'Godfist',
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Godfist: { ...earned.classes.Godfist!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Godfist signature, 38-node tree, Grit def, parser round-trips, and gold pricing', () => {
  test('GODFIST_TREE validates against TREE_SHAPE.mythic and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Godfist).toBe(GODFIST_SIGNATURE);
    expect(CLASS_TREES.Godfist).toBe(GODFIST_TREE);
    expect(validateTree(GODFIST_TREE)).toEqual([]);
    expect(GODFIST_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(GODFIST_CANONICAL_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(GODFIST_TREE, GODFIST_CANONICAL_NODES)).toEqual([...GODFIST_CANONICAL_NODES]);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of GODFIST_CANONICAL_NODES) {
      const check = canBuyNode(GODFIST_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Godfist', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('every Godfist status and active round-trips identically through parseStatusDef/parseAbility, keeps <= 4 triggers, and shares a single neutral god-grit def', () => {
    const gritDef = classStatusDef('god-grit');
    expect(gritDef).not.toBeNull();
    expect(helpful(gritDef!)).toBe(false);
    expect(harmful(gritDef!)).toBe(false);

    expect(GODFIST_SIGNATURE.worn!.def.triggers?.length ?? 0).toBe(3);
    const capWorn = GODFIST_TREE.nodes.find(n => n.capstone)!.gifts.find(g => g.kind === 'replace-worn')!;
    expect(capWorn.kind === 'replace-worn' && (capWorn.worn.def.triggers?.length ?? 0)).toBe(4);

    const keys = [
      'god-spirit',
      'god-shattering-fist',
      'god-grit',
      'god-crushed-stance',
      'god-pinned-grip',
      'god-chi-brace',
      'god-counter-stance',
      'god-shatter-exposed',
      'god-flurry-exposed',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, k);
      expect(reparsed, `parseStatusDef(${k})`).toEqual(def);
      expect(def!.triggers?.length ?? 0).toBeLessThanOrEqual(RULES.fight.kit.triggers);
    }

    const allActives = [
      ...(GODFIST_SIGNATURE.actives ?? []),
      ...GODFIST_TREE.nodes.flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))),
    ];
    for (const ab of allActives) {
      const reparsed = parseAbility(JSON.parse(JSON.stringify(ab)), RULES);
      expect(reparsed, `parseAbility(${ab.name})`).toEqual(ab);
      expect(ab.cost.mana, `${ab.name} mana cost`).toBe(0);
    }

    // Both base and capstone worn statuses carry stacksBy on god-grit and share identical GRIT def
    const seenGrit: StatusDef[] = [];
    for (const worn of [GODFIST_SIGNATURE.worn!, capWorn.kind === 'replace-worn' ? capWorn.worn : null]) {
      if (!worn) continue;
      for (const tr of worn.def.triggers ?? []) {
        for (const op of tr.ops) {
          if (op.op === 'applyStatus' && op.key === statusKey('god-grit')) {
            expect(op.stacksBy, `${worn.key} grit trigger must use stacksBy`).toBeDefined();
            seenGrit.push(op.def);
          }
        }
      }
    }
    expect(seenGrit.length).toBe(2);
    for (const d of seenGrit) expect(d).toEqual(gritDef!);
  });

  test('every Godfist node desc matches its numeric gifts, node names are unique across all shipped classes, and all 64 fork builds stay within caps', () => {
    for (const n of GODFIST_TREE.nodes) {
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

    // Node names must be unique against every other shipped class
    const otherNodeNames = new Set<string>();
    for (const [cls, tree] of Object.entries(CLASS_TREES)) {
      if (!tree || cls === 'Godfist') continue;
      for (const n of tree.nodes) otherNodeNames.add(n.name.toLowerCase());
    }
    const localNames = new Set<string>();
    for (const n of GODFIST_TREE.nodes) {
      const low = n.name.toLowerCase();
      expect(localNames.has(low), `duplicate local Godfist node name "${n.name}"`).toBe(false);
      localNames.add(low);
      expect(otherNodeNames.has(low), `Godfist node "${n.name}" collides with another shipped class`).toBe(false);
    }

    // All 64 fork builds stay within CLASS_ACTIVES_MAX, kit.scalers, FORMULA_PARTS, and penMax
    const forkGroups = [...new Set(GODFIST_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => GODFIST_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = GODFIST_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const h = makeGodfist(nodes);
      const cp = classPowers(h, KEYSTONES_ON);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBeLessThanOrEqual(KEYSTONES_ON.fight.kit.scalers);
      const row = hunterRow(h, combatantId('h-check'), KEYSTONES_ON);
      const sheet = modified(row.origin, row.statuses, KEYSTONES_ON).sheet;
      expect(sheet.armorPen).toBeLessThanOrEqual(KEYSTONES_ON.fight.penMax);
      for (const ab of row.abilities) {
        const form = formulaOf(ab, KEYSTONES_ON);
        if (form) expect(partsOf(form), `${ab.name} formula parts`).toBeLessThanOrEqual(FORMULA_PARTS);
      }
    }
  });
});

describe('Godfist real wire pin (stacksBy), Grit + Hook H1, Heavenly Suplex throw, and Counter Palm', () => {
  test('real wire pin: both base Fighting Spirit and capstone Shattering Fist (with stacksBy) leave fightWire(doc).defs undefined', () => {
    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;

    for (const [label, nodes, expectedKey] of [
      ['base', [] as readonly ClassNodeId[], statusKey('god-spirit')],
      ['capstone', GODFIST_CANONICAL_NODES, statusKey('god-shattering-fist')],
    ] as const) {
      const h = makeGodfist(nodes);
      const row = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
      expect(row.statuses.some(s => s.key === expectedKey && s.worn), `${label} worn present`).toBe(true);

      let f: Fight | null = reduce(null, {
        type: 'add',
        fightId: fightId(`f-god-${label}`),
        rows: [{ ...row, place: place(2, 2) }, { ...foe, place: place(4, 2) }],
        openings: [],
      }, { rules: KEYSTONES_ON }).fight;
      f = reduce(f, {
        type: 'start',
        openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }],
      }, { rules: KEYSTONES_ON }).fight;

      const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error(`expected active FightDoc for ${label}`);
      const wire = fightWire(doc);
      expect(wire.defs, `${label} worn with stacksBy must omit wire.defs (0 wire bytes)`).toBeUndefined();
      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error(`expected parsed FightDoc for ${label}`);
      const docRow = parsed.rows.find(r => r.id === combatantId('h1'))!;
      expect(docRow.statuses.find(s => s.key === expectedKey)?.def).toEqual(classStatusDef(expectedKey)!);
    }

    const bare = makeGodfist([]);
    const maxed = makeGodfist(GODFIST_CANONICAL_NODES);
    expect(classPowers(bare, RULES).bonus.speed).toBe(10);
    expect(classPowers(maxed, RULES).bonus.speed).toBe(56);
    expect(explain(maxed, 'speed', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(56);
    const maxRow = hunterRow(maxed, combatantId('h1'), KEYSTONES_ON);
    const ws = maxRow.abilities.find(a => a.id === wornAbilityId(abilityId('god-worldsplitter')))!;
    expect(scalersOf(formulaOf(ws, KEYSTONES_ON)!, KEYSTONES_ON)?.scalers.length).toBe(1);
  });

  test('Grit builds from lost HP past shield via Hook H1 (6% -> 2 base, 3 capstone), skips when fully shielded, survives helpful and harmful dispels while strippable statuses go, and Worldsplitter converts it to shield and clears it', () => {
    const ctx = { rules: RULES };
    const wsId = wornAbilityId(abilityId('god-worldsplitter'));
    const helpfulDef: StatusDef = { label: 'Swiftness', desc: 'Speed +20%.', ops: [{ op: 'speed', pct: 20 }] };
    const harmfulDef: StatusDef = { label: 'Bogged', desc: 'Speed -20%.', ops: [{ op: 'speed', pct: -20 }] };
    expect(helpful(helpfulDef)).toBe(true);
    expect(harmful(harmfulDef)).toBe(true);

    for (const [label, nodes, expectedStacks, shieldPerStack] of [
      ['base Fighting Spirit', [] as readonly ClassNodeId[], 2, 0.015],
      ['capstone Shattering Fist', GODFIST_CANONICAL_NODES, 3, 0.02],
    ] as const) {
      const hero = hunterRow(makeGodfist(nodes), combatantId('h1'), RULES);
      const hpMax = modified(hero.origin, hero.statuses, RULES).sheet.hpMax;
      // Direct 6% true-damage hit: floor(0.06 / 0.025) = 2 at base, floor(0.06 / 0.02) = 3 at capstone (pins both divisors!)
      const sixPctHit = abilityOf('strike', {
        id: abilityId(`foe-six-${label}`), name: 'Six Percent Hit',
        range: tiles(2), shape: { kind: 'touch', reach: tiles(2) },
        effect: { type: 'true', by: 'hand', formula: { kind: 'number', value: Math.ceil(hpMax * 0.06) } },
      }, RULES);
      const lightHit = abilityOf('strike', {
        id: abilityId(`foe-light-${label}`), name: 'Light Hit',
        range: tiles(2), shape: { kind: 'touch', reach: tiles(2) },
        effect: { type: 'true', by: 'hand', formula: { kind: 'number', value: 10 } },
      }, RULES);
      const purgeBoth = abilityOf('curse', {
        id: abilityId(`foe-purge-${label}`), name: 'Purge All',
        aim: 'foe', range: tiles(4), shape: { kind: 'touch', reach: tiles(4) },
        delivery: { kind: 'sure' }, effect: null,
        ops: [{ op: 'dispel', which: 'all', kind: 'helpful' }, { op: 'dispel', which: 'all', kind: 'harmful' }],
      }, RULES);
      const foe = monsterRows({
        name: 'Sparring Boss', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 },
        abilities: [sixPctHit, lightHit, purgeBoth], statuses: [],
      }, [combatantId('m1')], RULES)[0]!;

      const shieldedHero = { ...hero, shield: { amount: 50, until: tick(5000) } };
      let f = reduce(null, {
        type: 'add', fightId: fightId(`f-grit-${label}`),
        rows: [{ ...shieldedHero, place: place(4, 5) }, { ...foe, place: place(5, 5) }],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, {
        type: 'start',
        openings: [{ id: combatantId('h1'), d20: 10, tie: 1 }, { id: combatantId('m1'), d20: 20, tie: 2 }],
      }, ctx).fight!;

      // 1. Light 10 true hit fully absorbed by 50 shield -> lost === 0 -> 0 Grit added
      const rShielded = reduce(f, {
        type: 'act', by: combatantId('m1'), ability: lightHit.id, aim: combatantId('h1'),
        rolls: { dice: { [combatantId('h1')]: [] }, react: { [combatantId('h1')]: 1 } }, force: true,
      }, ctx);
      const f1 = rShielded.fight as Running;
      expect(f1.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('god-grit'))).toBeUndefined();

      // 2. Remove shield, take non-crit 6% true hit -> 2 stacks at base (floor(6/2.5)), 3 stacks at capstone (floor(6/2.0))
      const unshielded: Running = {
        ...f1,
        rows: f1.rows.map(r => (r.id === combatantId('h1') ? { ...r, shield: null } : r)),
      };
      const rSix = reduce(unshielded, {
        type: 'act', by: combatantId('m1'), ability: sixPctHit.id, aim: combatantId('h1'),
        rolls: { dice: { [combatantId('h1')]: [] }, react: { [combatantId('h1')]: 10 } }, force: true,
      }, ctx);
      expect(rSix.effects.some(e => e.type === 'refused')).toBe(false);
      const f2 = rSix.fight as Running;
      expect(f2.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === statusKey('god-grit'))?.stacks, `${label} 6% hit stacks`).toBe(expectedStacks);

      // 3. Seed one helpful and one harmful status -> both are stripped by purgeBoth while neutral god-grit stays intact
      const keyGood = statusKey('test-good-buff');
      const keyBad = statusKey('test-bad-debuff');
      const withBoth: Running = {
        ...f2,
        rows: f2.rows.map(r => (r.id === combatantId('h1')
          ? {
            ...r,
            statuses: [
              ...r.statuses,
              statusOn(helpfulDef, { key: keyGood, source: { id: combatantId('h1'), tier: 5 }, until: tick(5000), since: f2.now, settledAt: f2.now }),
              statusOn(harmfulDef, { key: keyBad, source: { id: combatantId('m1'), tier: 5 }, until: tick(5000), since: f2.now, settledAt: f2.now }),
            ],
          }
          : r)),
      };
      const rPurge = reduce(withBoth, {
        type: 'act', by: combatantId('m1'), ability: purgeBoth.id, aim: combatantId('h1'),
        rolls: { dice: { [combatantId('h1')]: [] }, react: { [combatantId('h1')]: 1 } }, force: true,
      }, ctx);
      expect(rPurge.effects.some(e => e.type === 'refused'), `${label} purge must not be refused`).toBe(false);
      const f3 = rPurge.fight as Running;
      const heroAfterPurge = f3.rows.find(r => r.id === combatantId('h1'))!;
      expect(heroAfterPurge.statuses.some(s => s.key === keyGood), `${label} helpful status must be dispelled`).toBe(false);
      expect(heroAfterPurge.statuses.some(s => s.key === keyBad), `${label} harmful status must be dispelled`).toBe(false);
      expect(heroAfterPurge.statuses.find(s => s.key === statusKey('god-grit'))?.stacks, `${label} neutral Grit must survive`).toBe(expectedStacks);

      // 4. Worldsplitter hits -> converts held Grit stacks into exact shield and clears god-grit
      const f3Turn: Running = { ...f3, currentId: combatantId('h1') };
      const rWs = reduce(f3Turn, {
        type: 'act', by: combatantId('h1'), ability: wsId, aim: combatantId('m1'),
        rolls: { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 1 } }, force: true,
      }, ctx);
      expect(rWs.effects.some(e => e.type === 'refused')).toBe(false);
      const heroAfterWs = (rWs.fight as Running).rows.find(r => r.id === combatantId('h1'))!;
      expect(heroAfterWs.statuses.find(s => s.key === statusKey('god-grit'))).toBeUndefined();
      expect(heroAfterWs.shield?.amount, `${label} Worldsplitter shield`).toBe(Math.round(shieldPerStack * hpMax * expectedStacks));
    }
  });

  test('Heavenly Suplex (base, Mountain Drop, Pinning Suplex) moves target >= 2 tiles via swap + shove without rooting, and capstone Grandmaster Echo shields + refunds 50%', () => {
    const ctx = { rules: RULES };
    const suplexId = wornAbilityId(abilityId('god-heavenly-suplex'));

    const runSuplex = (nodes: readonly ClassNodeId[]) => {
      const hero = hunterRow(makeGodfist(nodes), combatantId('h1'), RULES);
      const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 10 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
      let f = reduce(null, {
        type: 'add', fightId: fightId('f-suplex'),
        rows: [{ ...hero, place: place(6, 5) }, { ...foe, place: place(7, 5) }],
        openings: [],
      }, ctx).fight!;
      f = reduce(f, {
        type: 'start',
        openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }],
      }, ctx).fight! as Running;
      const beforeHero = f.rows.find(r => r.id === combatantId('h1'))!;
      const suplexAb = beforeHero.abilities.find(a => a.id === suplexId)!;
      const res = reduce(f, {
        type: 'act', by: combatantId('h1'), ability: suplexId, aim: combatantId('m1'),
        rolls: { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 1 } }, force: true,
      }, ctx);
      expect(res.effects.some(e => e.type === 'refused')).toBe(false);
      const after = res.fight as Running;
      return {
        before: f,
        after,
        suplexAb,
        heroAfter: after.rows.find(r => r.id === combatantId('h1'))!,
        foeAfter: after.rows.find(r => r.id === combatantId('m1'))!,
      };
    };

    // Base Suplex: hero (6,5) -> (7,5), target (7,5) -> (4,5) (3 tiles moved = swap 1 + shove 2)
    const base = runSuplex([]);
    expect(base.heroAfter.place).toEqual(place(7, 5));
    expect(base.foeAfter.place).toEqual(place(4, 5));
    expect(dist(place(7, 5), base.foeAfter.place)).toBe(tiles(3));
    expect(base.foeAfter.statuses.some(s => s.key === statusKey('god-crushed-stance'))).toBe(true);

    // Mountain Drop + Capstone: hero (6,5) -> (7,5), target (7,5) -> (3,5) (4 tiles moved = swap 1 + shove 3), shield 4% + 50% refund
    const mountain = runSuplex(GODFIST_CANONICAL_NODES);
    expect(mountain.heroAfter.place).toEqual(place(7, 5));
    expect(mountain.foeAfter.place).toEqual(place(3, 5));
    expect(dist(place(7, 5), mountain.foeAfter.place)).toBe(tiles(4));
    expect(mountain.heroAfter.shield?.amount).toBe(Math.round(0.04 * mountain.heroAfter.sheet.hpMax));
    const fullSpent = interval(mountain.before.rows.find(r => r.id === combatantId('h1'))!.speed, mountain.suplexAb.cost.time, RULES.fight);
    const expectedAt = tick(mountain.before.now + fullSpent - Math.round(fullSpent * 50 / 100));
    expect(mountain.heroAfter.at).toBe(expectedAt);

    // Pinning Suplex (adds 1r hold, no root): still swaps and shoves target to (4,5) AND applies god-pinned-grip
    const pinNodes = GODFIST_CANONICAL_NODES.map(id => (id === nid('god-c5-l') ? nid('god-c5-r') : id));
    const pinned = runSuplex(pinNodes);
    expect(pinned.heroAfter.place).toEqual(place(7, 5));
    expect(pinned.foeAfter.place).toEqual(place(4, 5));
    expect(pinned.foeAfter.statuses.some(s => s.key === statusKey('god-pinned-grip'))).toBe(true);
    expect(pinned.foeAfter.statuses.some(s => s.def.ops.some(o => o.op === 'root'))).toBe(false);
  });

  test('Counter Palm is self-only (reach 0), applies 1-round Chi Brace (safeguard) + Counter Stance, and retaliates with 0.9 * phys on struck', () => {
    const hero = hunterRow(makeGodfist(GODFIST_CANONICAL_NODES), combatantId('h1'), RULES);
    const qiId = wornAbilityId(abilityId('god-qi-guard'));
    const qiAb = hero.abilities.find(a => a.id === qiId)!;
    expect(qiAb.react).toEqual({ when: 'before', reach: tiles(0) });

    const allyBase = newHunter(RULES);
    const allyRaw = { ...allyBase, rank: 'S' as const, level: RULES.rankLevels.S, stats: { ...allyBase.stats, str: 100, vit: 80 } };
    const ally = hunterRow(
      { ...allyRaw, life: lifeAfter(allyRaw.life, { type: 'heal', amount: 100_000 }, 100_000) },
      combatantId('h2'),
      RULES,
    );
    const foeSwing = abilityOf('strike', {
      id: abilityId('foe-swing'), name: 'Foe Swing',
      range: tiles(2), shape: { kind: 'touch', reach: tiles(2) },
      effect: { type: 'physical', by: 'hand', formula: { kind: 'number', value: 120 } },
    }, RULES);
    const foe = monsterRows({
      name: 'Attacker', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 },
      abilities: [foeSwing], statuses: [],
    }, [combatantId('m1')], RULES)[0]!;

    const ctx = { rules: RULES };
    let f = reduce(null, {
      type: 'add', fightId: fightId('f-counter-palm'),
      rows: [{ ...hero, place: place(4, 5) }, { ...ally, place: place(4, 6) }, { ...foe, place: place(5, 5) }],
      openings: [],
    }, ctx).fight!;
    f = reduce(f, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 15, tie: 1 },
        { id: combatantId('h2'), d20: 10, tie: 1 },
        { id: combatantId('m1'), d20: 20, tie: 2 },
      ],
    }, ctx).fight!;
    f = reduce(f, { type: 'arm', by: combatantId('h1'), ability: qiId }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    // Attack on adjacent ally does NOT trigger Counter Palm (reach 0)
    const allyRes = reduce(f, {
      type: 'act', by: combatantId('m1'), ability: foeSwing.id, aim: combatantId('h2'),
      rolls: { dice: { [combatantId('h2')]: [] }, react: { [combatantId('h2')]: 1 } }, force: true,
    }, ctx);
    expect((allyRes.fight as Running).rows.find(r => r.id === combatantId('h2'))!.statuses.some(s => s.key === statusKey('god-counter-stance'))).toBe(false);
    expect((allyRes.fight as Running).rows.find(r => r.id === combatantId('h1'))!.armed?.spent).toBe(false);

    // Attack on Godfist fires Counter Palm -> puts 1r Chi Brace + 1r Counter Stance on Godfist, then struck trigger deals physical counter to attacker
    const foeBefore = f.rows.find(r => r.id === combatantId('m1'))!;
    const foeHpBefore = rowHp(foeBefore);
    const res = reduce(f, {
      type: 'act', by: combatantId('m1'), ability: foeSwing.id, aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: { [combatantId('h1')]: 1 } }, force: true,
    }, ctx);
    expect(res.effects.some(e => e.type === 'refused')).toBe(false);
    const after = res.fight as Running;
    const heroAfter = after.rows.find(r => r.id === combatantId('h1'))!;
    const foeAfter = after.rows.find(r => r.id === combatantId('m1'))!;

    const brace = heroAfter.statuses.find(s => s.key === statusKey('god-chi-brace'));
    const counter = heroAfter.statuses.find(s => s.key === statusKey('god-counter-stance'));
    expect(brace?.until).toBe(tick(f.now + RULES.fight.round));
    expect(counter?.until).toBe(tick(f.now + RULES.fight.round));
    const expectedCounter = afterDefence(
      0.9 * heroAfter.sheet.phys * damageShare(heroAfter, foeBefore, RULES),
      'physical',
      heroAfter.sheet,
      foeBefore.sheet,
      RULES,
    );
    expect(expectedCounter).toBeGreaterThan(0);
    expect(foeHpBefore - rowHp(foeAfter), 'Counter Stance must retaliate for exact 0.9 * phys').toBe(expectedCounter);

    // Second strike in the same round draws no second counter (limit: ROUND)
    const foeHpAfter1 = rowHp(foeAfter);
    const res2 = reduce(after, {
      type: 'act', by: combatantId('m1'), ability: foeSwing.id, aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: { [combatantId('h1')]: 1 } }, force: true,
    }, ctx);
    expect(res2.effects.some(e => e.type === 'refused')).toBe(false);
    const foeAfter2 = (res2.fight as Running).rows.find(r => r.id === combatantId('m1'))!;
    expect(rowHp(foeAfter2), 'Counter Stance must not fire twice in the same round').toBe(foeHpAfter1);
  });
});
