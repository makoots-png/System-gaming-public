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
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { interval, tick } from '../src/core/combat/timeline.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { zoneId } from '../src/core/combat/zones.ts';
import type { Zone } from '../src/core/combat/zones.ts';
import { FORMULA_PARTS, partsOf } from '../src/core/formula.ts';
import { abilityOf, formulaOf } from '../src/core/registry/ability-kinds.ts';
import { scalersOf } from '../src/core/registry/scalers.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { NULLWEAVER_SIGNATURE, NULLWEAVER_TREE } from '../src/core/registry/class-nullweaver.ts';
import { isRefused } from '../src/core/save-step.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';
import { NULLWEAVER_CANONICAL_NODES } from './fixtures/nullweaver-solo.ts';

const AT = '2026-11-27T06:30:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

function makeNullweaver(nodes: readonly ClassNodeId[] = []) {
  const base = newHunter(RULES);
  const earned = earnClass(
    { ...base, rank: 'S', level: RULES.rankLevels.S, stats: { ...base.stats, ins: 156, pow: 83 } },
    'Nullweaver',
    { at: AT, R: RULES },
  );
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes = {
    ...earned,
    classes: {
      ...earned.classes,
      Nullweaver: { ...earned.classes.Nullweaver!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, RULES);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Nullweaver signature, 38-node tree, single Unraveled def, and gold pricing', () => {
  test('NULLWEAVER_TREE validates against TREE_SHAPE.mythic and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Nullweaver).toBe(NULLWEAVER_SIGNATURE);
    expect(CLASS_TREES.Nullweaver).toBe(NULLWEAVER_TREE);
    expect(validateTree(NULLWEAVER_TREE)).toEqual([]);
    expect(NULLWEAVER_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(NULLWEAVER_CANONICAL_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(NULLWEAVER_TREE, NULLWEAVER_CANONICAL_NODES)).toEqual([...NULLWEAVER_CANONICAL_NODES]);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of NULLWEAVER_CANONICAL_NODES) {
      const check = canBuyNode(NULLWEAVER_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Nullweaver', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('single null-unraveled def is shared across all actives, triggers, Counter-Unravel, and capstone (Finding 5)', () => {
    // Zero upgrade-status gifts anywhere in the tree so worn triggers and actives never split defs
    const upgrades = NULLWEAVER_TREE.nodes.flatMap(n => n.gifts.filter(g => g.kind === 'upgrade-status'));
    expect(upgrades).toEqual([]);

    const canonicalUnraveled = classStatusDef('null-unraveled');
    expect(canonicalUnraveled).not.toBeNull();
    expect('stack' in canonicalUnraveled! && canonicalUnraveled.stack?.threshold?.ops.some(o => o.op === 'heal')).toBe(false);

    // Every status def resolves via classStatusDef and shippedStatusDef and round-trips through parseStatusDef
    const keys = [
      'null-thread',
      'null-weaver',
      'null-unraveled',
      'null-silenced-thread',
      'null-spell-lock',
      'null-erase-drag',
      'null-counter-ward',
    ];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      const reparsed = parseStatusDef(JSON.parse(JSON.stringify(def)), RULES);
      expect(reparsed, `parseStatusDef(${k})`).toEqual(def);
      expect(def!.triggers?.length ?? 0).toBeLessThanOrEqual(RULES.fight.kit.triggers);
    }

    // Collect every applyStatus op targeting null-unraveled across actives, forks, worn, capstone, and nested statuses
    const seen: StatusDef[] = [];
    const scanOps = (ops: readonly { readonly op: string; readonly key?: unknown; readonly def?: StatusDef }[]): void => {
      for (const o of ops) {
        if (o.op === 'applyStatus' && o.def) {
          if (o.key === statusKey('null-unraveled')) seen.push(o.def);
          for (const tr of o.def.triggers ?? []) scanOps(tr.ops);
        }
      }
    };
    const allActives = [
      ...(NULLWEAVER_SIGNATURE.actives ?? []),
      ...NULLWEAVER_TREE.nodes.flatMap(n => n.gifts.flatMap(g => (g.kind === 'replace-active' ? [g.active] : []))),
    ];
    for (const ab of allActives) {
      const reparsed = parseAbility(JSON.parse(JSON.stringify(ab)), RULES);
      expect(reparsed, `parseAbility(${ab.name})`).toEqual(ab);
      scanOps(ab.ops);
    }
    for (const tr of NULLWEAVER_SIGNATURE.worn?.def.triggers ?? []) scanOps(tr.ops);
    for (const n of NULLWEAVER_TREE.nodes) {
      for (const g of n.gifts) {
        if (g.kind === 'replace-worn') {
          for (const tr of g.worn.def.triggers ?? []) scanOps(tr.ops);
        }
      }
    }
    // Unravel (3 variants) + Erase Field (3 variants) + Unraveling Ward (1) + base worn (1) + capstone worn (1) = 9
    expect(seen.length).toBe(9);
    for (const d of seen) expect(d).toEqual(canonicalUnraveled!);
  });

  test('every Nullweaver node desc matches its numeric gifts and all 64 fork combinations stay within kit.scalers, FORMULA_PARTS, and penMax', () => {
    for (const n of NULLWEAVER_TREE.nodes) {
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

    const forkGroups = [...new Set(NULLWEAVER_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => NULLWEAVER_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = NULLWEAVER_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const h = makeNullweaver(nodes);
      const cp = classPowers(h, KEYSTONES_ON);
      expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length).toBeLessThanOrEqual(KEYSTONES_ON.fight.kit.scalers);
      const row = hunterRow(h, combatantId('h-check'), KEYSTONES_ON);
      const sheet = modified(row.origin, row.statuses, KEYSTONES_ON).sheet;
      expect(sheet.resistPen).toBeLessThanOrEqual(KEYSTONES_ON.fight.penMax);
      for (const ab of row.abilities) {
        const form = formulaOf(ab, KEYSTONES_ON);
        if (form) expect(partsOf(form), `${ab.name} formula parts`).toBeLessThanOrEqual(FORMULA_PARTS);
      }
    }
  });
});

describe('Nullweaver sheet, fight-doc wire, Hook 2 dispel, Hook 3 zone erase, and Counter-Unravel', () => {
  test('hunterSheet, hunterRow, scalersOf, and fight-doc wire.defs (0 bytes) work cleanly', () => {
    const bare = makeNullweaver([]);
    const maxed = makeNullweaver(NULLWEAVER_CANONICAL_NODES);

    expect(classPowers(bare, RULES).bonus.manaMax).toBe(35);
    expect(classPowers(maxed, RULES).bonus.manaMax).toBe(80);
    expect(explain(bare, 'manaMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(35);
    expect(explain(maxed, 'manaMax', RULES).parts.find(p => p.from === 'class')?.amount).toBeGreaterThanOrEqual(80);

    const row = hunterRow(maxed, combatantId('h1'), KEYSTONES_ON);
    expect(row.statuses.some(s => s.key === statusKey('null-weaver') && s.worn)).toBe(true);
    const erase = row.abilities.find(a => a.id === wornAbilityId(abilityId('null-erase-field')))!;
    expect(erase.name).toBe('Erase Field: Null Horizon');
    expect(erase.zoneAct).toEqual({ act: 'erase', name: null, by: 2 });
    const eraseForm = formulaOf(erase, KEYSTONES_ON)!;
    expect(partsOf(eraseForm)).toBeLessThanOrEqual(FORMULA_PARTS);
    expect(scalersOf(eraseForm, KEYSTONES_ON)?.scalers.length).toBe(1);

    // Rift Collapse fork also stays within FORMULA_PARTS
    const collapseNodes = NULLWEAVER_CANONICAL_NODES.map(id => (id === nid('null-b7-l') ? nid('null-b7-r') : id));
    const collapseRow = hunterRow(makeNullweaver(collapseNodes), combatantId('h-col'), KEYSTONES_ON);
    const collapseErase = collapseRow.abilities.find(a => a.id === wornAbilityId(abilityId('null-erase-field')))!;
    expect(collapseErase.name).toBe('Erase Field: Rift Collapse');
    expect(partsOf(formulaOf(collapseErase, KEYSTONES_ON)!)).toBeLessThanOrEqual(FORMULA_PARTS);

    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-null'), rows: [{ ...row, place: place(2, 2) }, { ...foe, place: place(6, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    const docRow = parsed.rows.find(r => r.id === combatantId('h1'))!;
    expect(docRow.statuses.find(s => s.key === statusKey('null-weaver'))?.def).toEqual(classStatusDef('null-weaver')!);
  });

  test('Sever Magic strips monster start buffs via Hook 2 helpful dispel while sparing shield-only, worn, neutral, and scripted mythic-* statuses', () => {
    const buffA: Status = {
      key: statusKey('test-buff-a'),
      def: { label: 'Battle Fury', desc: 'Deals 20% more damage.', ops: [{ op: 'share', on: 'dealt', pct: 20 }] },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0),
      until: tick(5000),
      settledAt: tick(0),
    };
    const buffB: Status = {
      key: statusKey('test-buff-b'),
      def: { label: 'Arcane Shell', desc: 'Adds 20 magic resist.', ops: [{ op: 'sheet', key: 'resist', amount: { kind: 'number', value: 20 } }] },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0),
      until: tick(5000),
      settledAt: tick(0),
    };
    const buffShield: Status = {
      key: statusKey('test-buff-shield'),
      def: { label: 'Barrier Ward', desc: 'Grants a 40-point shield.', ops: [{ op: 'shield', amount: { kind: 'number', value: 40 } }] },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0),
      until: tick(5000),
      settledAt: tick(0),
    };
    const neutralMark: Status = {
      key: statusKey('test-neutral'),
      def: { label: 'Neutral Mark', desc: 'A neutral tracking note.', ops: [{ op: 'note', text: 'Marked.' }] },
      source: { id: combatantId('h1'), tier: 5 },
      since: tick(0),
      until: tick(5000),
      settledAt: tick(0),
    };
    const wornBuff: Status = {
      key: statusKey('test-worn'),
      def: { label: 'Innate Hide', desc: 'Adds 10 armor.', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 10 } }] },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0),
      until: null,
      settledAt: tick(0),
      worn: true,
    };

    const runSever = (nodes: readonly ClassNodeId[]) => {
      const hRow = hunterRow(makeNullweaver(nodes), combatantId('h1'), RULES);
      // Real scripted mythic boss (Zaratan starts Phase 1 with mythic-even-guard and mythic-shell)
      const baseFoe = monsterRows({
        name: 'Zaratan, the Island That Wakes', rank: 'S', archetype: 'brute', kind: 'mythic',
        script: 'zaratan-the-island-that-wakes', tweak: {}, abilities: [], statuses: [],
      }, [combatantId('m1')], RULES)[0]!;
      expect(baseFoe.mythic).toBeDefined();
      expect(baseFoe.statuses.some(s => s.key === statusKey('mythic-shell'))).toBe(true);
      const foe = { ...baseFoe, statuses: [buffA, buffB, buffShield, neutralMark, wornBuff, ...baseFoe.statuses] };
      const ctx = { rules: RULES };
      let f = reduce(null, { type: 'add', fightId: fightId('f-sever'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(6, 5) }], openings: [] }, ctx).fight!;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
      const severId = wornAbilityId(abilityId('null-sever-magic'));
      const rolls = { dice: { [combatantId('m1')]: [5] }, react: { [combatantId('m1')]: 1 } };
      const res = reduce(f, { type: 'act', by: combatantId('h1'), ability: severId, aim: combatantId('m1'), rolls, force: true }, ctx);
      expect(res.effects.some(e => e.type === 'refused')).toBe(false);
      return (res.fight as Running).rows.find(r => r.id === combatantId('m1'))!.statuses.map(s => s.key);
    };

    // Base Sever Magic removes only the first helpful buff (test-buff-a)
    const baseKeys = runSever([]);
    expect(baseKeys).not.toContain(statusKey('test-buff-a'));
    expect(baseKeys).toContain(statusKey('test-buff-b'));
    expect(baseKeys).toContain(statusKey('test-buff-shield'));
    expect(baseKeys).toContain(statusKey('test-neutral'));
    expect(baseKeys).toContain(statusKey('mythic-shell'));
    expect(baseKeys).toContain(statusKey('test-worn'));
    expect(baseKeys).toContain(statusKey('null-silenced-thread'));

    // Total Purge (canonical D5 Sever fork) removes both helpful buffs while preserving shield-only (neutral since the hooks review: the shield pool stays when the status goes), neutral, mythic-*, and worn
    const purgeKeys = runSever(NULLWEAVER_CANONICAL_NODES);
    expect(purgeKeys).not.toContain(statusKey('test-buff-a'));
    expect(purgeKeys).not.toContain(statusKey('test-buff-b'));
    expect(purgeKeys).toContain(statusKey('test-buff-shield'));
    expect(purgeKeys).toContain(statusKey('test-neutral'));
    expect(purgeKeys).toContain(statusKey('mythic-shell'));
    expect(purgeKeys).toContain(statusKey('test-worn'));
  });

  test('Erase Field erases foe-owned zones without firing zone.end while sparing map zones and status auras (Hook 3)', () => {
    const hRow = hunterRow(makeNullweaver(NULLWEAVER_CANONICAL_NODES), combatantId('h1'), RULES);
    const foeAura: Status = {
      key: statusKey('test-foe-aura'),
      def: {
        label: 'Dread Aura',
        desc: 'Allies within 2 tiles gain 10 armor.',
        ops: [
          { op: 'aura', radius: tiles(2), on: 'allies' },
          { op: 'sheet', key: 'armor', amount: { kind: 'number', value: 10 } },
        ],
      },
      source: { id: combatantId('m1'), tier: 5 },
      since: tick(0),
      until: tick(5000),
      settledAt: tick(0),
    };
    const baseFoe = monsterRows({ name: 'Hazard Boss', rank: 'S', archetype: 'caster', kind: 'boss', tweak: { hp: 3 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const foe = { ...baseFoe, statuses: [foeAura] };
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-erase'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(6, 5) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    const auraZone = f.zones.find(z => z.ground.kind === 'around' && z.ground.anchor.kind === 'body' && z.ground.anchor.status === statusKey('test-foe-aura'));
    expect(auraZone, 'expected foe status aura zone on ground').toBeDefined();

    const foeZone1: Zone = {
      id: zoneId('z-foe-1'), name: 'Fallen stars',
      ground: { kind: 'around', anchor: { kind: 'place', at: place(5, 5) }, radius: tiles(2), grow: null },
      owner: combatantId('m1'), spares: 'foe', tier: 5, until: tick(5000), laid: tick(0), endsWithOwner: false,
      ops: [{ op: 'speed', pct: -20 }],
      end: [{ op: 'damage', type: 'arcane', when: 'use', amount: { kind: 'number', value: 999 } }],
    };
    const foeZone2: Zone = {
      id: zoneId('z-foe-2'), name: 'Rising sea',
      ground: { kind: 'around', anchor: { kind: 'place', at: place(7, 5) }, radius: tiles(2), grow: null },
      owner: combatantId('m1'), spares: 'foe', tier: 5, until: tick(5000), laid: tick(0), endsWithOwner: false,
      ops: [{ op: 'speed', pct: -20 }],
    };
    const mapZone: Zone = {
      id: zoneId('z-map'), name: 'Ancient Crater',
      ground: { kind: 'around', anchor: { kind: 'place', at: place(6, 5) }, radius: tiles(2), grow: null },
      owner: null, spares: null, tier: 0, until: null, endsWithOwner: false,
      ops: [{ op: 'speed', pct: -10 }],
    };
    const withZones: Running = { ...f, now: tick(1500), zones: [...f.zones, foeZone1, foeZone2, mapZone] };
    const hpBefore = rowHp(withZones.rows.find(r => r.id === combatantId('h1'))!);

    const eraseId = wornAbilityId(abilityId('null-erase-field'));
    const rolls = { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 1 } };
    const res = reduce(withZones, { type: 'act', by: combatantId('h1'), ability: eraseId, aim: place(6, 5), rolls, force: true }, ctx);
    expect(res.effects.some(e => e.type === 'refused')).toBe(false);
    const after = res.fight as Running;

    // Null Horizon erases both foe zones, leaves mapZone and foe's status aura intact, and never fires foeZone1's 999-damage end
    expect(after.zones.map(z => z.id)).toEqual([auraZone!.id, zoneId('z-map')]);
    const heroBefore = withZones.rows.find(r => r.id === combatantId('h1'))!;
    const eraseAb = heroBefore.abilities.find(a => a.id === eraseId)!;
    const heroAfter = after.rows.find(r => r.id === combatantId('h1'))!;
    expect(rowHp(heroAfter)).toBe(hpBefore);
    // Null Echo shields for 4% of max HP (strictly above Spellbreak Ward's 3%) and refunds 15% of Erase Field's action time
    const wardShield = Math.round(0.03 * heroBefore.sheet.hpMax);
    const echoShield = Math.round(0.04 * heroBefore.sheet.hpMax);
    expect(echoShield).toBeGreaterThan(wardShield);
    expect(heroAfter.shield?.amount).toBe(echoShield);
    const fullSpent = interval(heroBefore.speed, eraseAb.cost.time, RULES.fight);
    const expectedAt = tick(withZones.now + fullSpent - Math.round(fullSpent * 15 / 100));
    expect(heroAfter.at).toBe(expectedAt);
    expect(heroAfter.at).toBeLessThan(withZones.now + fullSpent);
    // Foe receives 2 Unraveled stacks from Erase Field
    const foeAfter = after.rows.find(r => r.id === combatantId('m1'))!;
    expect(foeAfter.statuses.find(s => s.key === statusKey('null-unraveled'))?.stacks).toBe(2);
  });

  test('Counter-Unravel is self-only (reach 0), never puts Unraveling Ward on an ally, and retaliates when Nullweaver is attacked (Findings 2 & 5)', () => {
    const counterNodes = NULLWEAVER_CANONICAL_NODES.map(id => (id === nid('null-c5-l') ? nid('null-c5-r') : id));
    const baseHero = hunterRow(makeNullweaver(counterNodes), combatantId('h1'), RULES);
    const aegisId = wornAbilityId(abilityId('null-aegis'));
    const counterAb = baseHero.abilities.find(a => a.id === aegisId)!;
    expect(counterAb.react).toEqual({ when: 'before', reach: tiles(0) });
    const hero = { ...baseHero, mana: Math.max(0, baseHero.mana - 20) };
    const allyHunter = newHunter(RULES);
    const allyRaw = { ...allyHunter, rank: 'S' as const, level: RULES.rankLevels.S, stats: { ...allyHunter.stats, str: 120, vit: 80, pow: 40 } };
    const allySheet = hunterSheet(allyRaw, RULES).sheet;
    const ally = hunterRow(
      { ...allyRaw, life: lifeAfter(allyRaw.life, { type: 'heal', amount: 100_000 }, 100_000), mana: Math.max(0, allySheet.manaMax - 20) },
      combatantId('h2'),
      RULES,
    );

    const foeSwing = abilityOf('strike', {
      id: abilityId('foe-swing'), name: 'Foe Swing',
      range: tiles(2), shape: { kind: 'touch', reach: tiles(2) },
      effect: { type: 'physical', by: 'hand', formula: { kind: 'number', value: 80 } },
    }, RULES);
    const baseFoe = monsterRows({ name: 'Attacker', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 5 }, abilities: [foeSwing], statuses: [] }, [combatantId('m1')], RULES)[0]!;

    const ctx = { rules: RULES };
    let f = reduce(null, {
      type: 'add',
      fightId: fightId('f-counter'),
      rows: [{ ...hero, place: place(4, 5) }, { ...ally, place: place(4, 6) }, { ...baseFoe, place: place(5, 5) }],
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
    f = reduce(f, { type: 'arm', by: combatantId('h1'), ability: aegisId }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    // Attack on adjacent ally does NOT trigger Counter-Unravel (reach 0), so Unraveling Ward never lands on an ally
    const allyHit = reduce(f, {
      type: 'act',
      by: combatantId('m1'),
      ability: foeSwing.id,
      aim: combatantId('h2'),
      rolls: { dice: { [combatantId('h2')]: [] }, react: { [combatantId('h2')]: 1 } },
      force: true,
    }, ctx);
    expect(allyHit.effects.some(e => e.type === 'refused')).toBe(false);
    const allyAfter = (allyHit.fight as Running).rows.find(r => r.id === combatantId('h2'))!;
    expect(allyAfter.statuses.some(s => s.key === statusKey('null-counter-ward'))).toBe(false);
    expect((allyHit.fight as Running).rows.find(r => r.id === combatantId('h1'))!.armed?.spent).toBe(false);

    // Attack on Nullweaver itself negates cleanly and retaliates reading Nullweaver's own mag and ins
    const heroHpBefore = rowHp(f.rows.find(r => r.id === combatantId('h1'))!);
    const foeHpBefore = rowHp(f.rows.find(r => r.id === combatantId('m1'))!);

    const res = reduce(f, {
      type: 'act',
      by: combatantId('m1'),
      ability: foeSwing.id,
      aim: combatantId('h1'),
      rolls: { dice: { [combatantId('h1')]: [] }, react: { [combatantId('h1')]: 1 } },
      force: true,
    }, ctx);
    expect(res.effects.some(e => e.type === 'refused')).toBe(false);
    const after = res.fight as Running;

    const heroAfter = after.rows.find(r => r.id === combatantId('h1'))!;
    const foeAfter = after.rows.find(r => r.id === combatantId('m1'))!;
    // Nullweaver took 0 damage (Counter-Unravel never hit self!), gained shield + Unraveling Ward
    expect(rowHp(heroAfter)).toBe(heroHpBefore);
    expect(heroAfter.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(heroAfter.statuses.some(s => s.key === statusKey('null-counter-ward'))).toBe(true);
    // Attacker took retaliation arcane damage (Void Reprisal + Unraveling Ward) and gained 2 stacks of the single null-unraveled def
    expect(rowHp(foeAfter)).toBeLessThan(foeHpBefore);
    const unraveled = foeAfter.statuses.find(s => s.key === statusKey('null-unraveled'));
    expect(unraveled?.stacks).toBe(2);
    expect(unraveled?.def).toEqual(classStatusDef('null-unraveled')!);

    // Sanctuary Negate (reach 6) protects an ally within reach and delivers shield + 12 mana to that protected ally
    const sanctHero = hunterRow(makeNullweaver(NULLWEAVER_CANONICAL_NODES), combatantId('h1'), RULES);
    let sf = reduce(null, {
      type: 'add',
      fightId: fightId('f-sanctuary'),
      rows: [{ ...sanctHero, place: place(2, 5) }, { ...ally, place: place(5, 5) }, { ...baseFoe, place: place(6, 5) }],
      openings: [],
    }, ctx).fight!;
    sf = reduce(sf, {
      type: 'start',
      openings: [
        { id: combatantId('h1'), d20: 19, tie: 2 },
        { id: combatantId('h2'), d20: 1, tie: 1 },
        { id: combatantId('m1'), d20: 20, tie: 3 },
      ],
    }, ctx).fight!;
    sf = reduce(sf, { type: 'arm', by: combatantId('h1'), ability: aegisId }, ctx).fight!;
    if (sf.phase !== 'running') throw new Error('expected running fight');
    const allyBeforeSanct = sf.rows.find(r => r.id === combatantId('h2'))!;
    const sanctRes = reduce(sf, {
      type: 'act',
      by: combatantId('m1'),
      ability: foeSwing.id,
      aim: combatantId('h2'),
      rolls: { dice: { [combatantId('h2')]: [] }, react: { [combatantId('h2')]: 1 } },
      force: true,
    }, ctx);
    expect(sanctRes.effects.some(e => e.type === 'refused')).toBe(false);
    const allyAfterSanct = (sanctRes.fight as Running).rows.find(r => r.id === combatantId('h2'))!;
    expect(rowHp(allyAfterSanct)).toBe(rowHp(allyBeforeSanct));
    expect(allyAfterSanct.shield?.amount ?? 0).toBeGreaterThan(0);
    expect(allyAfterSanct.mana).toBe(allyBeforeSanct.mana + 12);
  });

  test('stacking null-unraveled to 4 via Erase Field and Fraying Weave spends all stacks for arcane burst and stagger with no boss heal', () => {
    const hRow = hunterRow(makeNullweaver(NULLWEAVER_CANONICAL_NODES), combatantId('h1'), RULES);
    const foe = monsterRows({ name: 'Target', rank: 'S', archetype: 'brute', kind: 'boss', tweak: { hp: 10 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    const ctx = { rules: RULES };
    let f = reduce(null, { type: 'add', fightId: fightId('f-thresh'), rows: [{ ...hRow, place: place(2, 5) }, { ...foe, place: place(6, 5) }], openings: [] }, ctx).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, ctx).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');

    const eraseId = wornAbilityId(abilityId('null-erase-field'));
    const unravelId = wornAbilityId(abilityId('null-unravel'));
    const rolls = { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 1 } };

    // Erase Field puts 2 stacks of null-unraveled
    const r1 = reduce(f, { type: 'act', by: combatantId('h1'), ability: eraseId, aim: place(6, 5), rolls, force: true }, ctx);
    const f1 = r1.fight as Running;
    expect(f1.rows.find(r => r.id === combatantId('m1'))!.statuses.find(s => s.key === statusKey('null-unraveled'))?.stacks).toBe(2);

    // Unravel: Fraying Weave adds 2 more stacks -> hits 4-stack threshold, spends all stacks, bursts with arcane damage and stagger (no heal)
    const hpBeforeBurst = rowHp(f1.rows.find(r => r.id === combatantId('m1'))!);
    const staggerBefore = f1.rows.find(r => r.id === combatantId('m1'))!.stagger?.fill ?? 0;
    const r2 = reduce(f1, { type: 'act', by: combatantId('h1'), ability: unravelId, aim: combatantId('m1'), rolls, force: true }, ctx);
    expect(r2.effects.some(e => e.type === 'refused')).toBe(false);
    expect(r2.effects.some(e => e.type === 'burst' && e.id === combatantId('m1'))).toBe(true);
    const usedLine = r2.effects.find(e => e.type === 'used');
    expect(usedLine?.type === 'used' && usedLine.line).toContain("Target's Unraveled goes off");
    expect(usedLine?.type === 'used' && usedLine.line).not.toContain('healed');
    const f2 = r2.fight as Running;
    const m2 = f2.rows.find(r => r.id === combatantId('m1'))!;
    expect(rowHp(m2)).toBeLessThan(hpBeforeBurst);
    expect(m2.stagger?.fill ?? 0).toBeGreaterThan(staggerBefore);
    expect(m2.statuses.some(s => s.key === statusKey('null-unraveled'))).toBe(false);
  });
});
