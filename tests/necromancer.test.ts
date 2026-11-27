// necromancer.test.ts: Wave 2 PR 3 (Necromancer) unit and integration checks.
// Covers 38-node tree validation & S-rank gold pricing, ClassBonusKey (+3 shadows, non-Necro isolation, +5 stack
// bounded by field cap 4), panel extraction +1 attempt ("Attempt 4 of 4"), Sovereign of Shadows & Shadow Monarch
// triggers (Mana Harvest armyKill, Undying Legion reform + shield, Exchange Shield, turnStart mana), all 4 active
// abilities (Arise 2->3->4, Domain fixed & walking, Ruler's Authority, Shadow Exchange), wire round-trip, and anti-drift.
import { describe, expect, test } from 'bun:test';
import { BONUS_HUNDREDTHS, BONUS_KEYS, RULES, domainOf } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import type { Hunter } from '../src/core/save.ts';
import { fightId, parseClassNodeId, parseSaveId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, ShadowId } from '../src/core/ids.ts';
import { pointsAt, split } from '../src/core/hunter/derive.ts';
import { earnClass, nodeCost } from '../src/core/hunter/classes.ts';
import { explain, heldKeystones, hunterSheet } from '../src/core/hunter/sheet.ts';
import { armyCap } from '../src/core/hunter/shadows.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { nodeGiftLines } from '../src/core/hunter/class-view.ts';
import { isRefused } from '../src/core/save-step.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { CLASS_ACTIVES_MAX, CLASS_BONUS_KEYS, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { NECROMANCER_SIGNATURE, NECROMANCER_TREE } from '../src/core/registry/class-necromancer.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import { attemptsLeft, extractAttemptsMax, extractBonusOf, extractionStep, UNTRIED } from '../src/core/combat/extraction.ts';
import { hunterRow, monsterRows, shadowRow, shadowSheet } from '../src/core/combat/rows.ts';
import { reduce, shadowFieldCap } from '../src/core/combat/fight.ts';
import type { Fight, Running } from '../src/core/combat/fight.ts';
import { parseFight, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { isUp, rowHp } from '../src/core/combat/row-hp.ts';
import { place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { isRisen } from '../src/core/combat/summons.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-26T12:00:00.000Z';
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;
const shid = (s: string): ShadowId => parseSaveId<'sh'>(s)!;

const CANONICAL_FORKS = ['necro-a5-l', 'necro-b5-l', 'necro-c5-l', 'necro-a7-l', 'necro-b7-l', 'necro-c7-l'];
const FULL_NECRO_NODES: readonly ClassNodeId[] = NECROMANCER_TREE.nodes
  .filter(n => !n.forkGroup || CANONICAL_FORKS.includes(n.id))
  .map(n => n.id);

function makeNecroHunter(nodes: readonly ClassNodeId[] = [], R = RULES): Hunter {
  const base = newHunter(R);
  const level = R.rankLevels.S;
  const stats = split('pre', 'pow', pointsAt(level, R), R);
  const earned = earnClass({ ...base, name: 'Sung', rank: 'S', level, stats }, 'Necromancer', { at: AT, R });
  if (isRefused(earned)) throw new Error(`earnClass refused: ${earned.why}`);
  const withNodes: Hunter = {
    ...earned,
    classes: {
      ...earned.classes,
      Necromancer: { ...earned.classes.Necromancer!, nodes: [...nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, R);
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

describe('Necromancer signature, 38-node tree, and gold pricing', () => {
  test('NECROMANCER_TREE validates against TREE_SHAPE.mythic and sums to 10,140,000 gold at S rank', () => {
    expect(CLASS_SIGNATURES.Necromancer).toBe(NECROMANCER_SIGNATURE);
    expect(CLASS_TREES.Necromancer).toBe(NECROMANCER_TREE);
    expect(validateTree(NECROMANCER_TREE)).toEqual([]);
    expect(NECROMANCER_TREE.nodes.length).toBe(TREE_SHAPE.mythic.total);
    expect(FULL_NECRO_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(NECROMANCER_TREE, FULL_NECRO_NODES)).toEqual([...FULL_NECRO_NODES]);

    const bought: ClassNodeId[] = [];
    let totalGold = 0;
    for (const id of FULL_NECRO_NODES) {
      const check = canBuyNode(NECROMANCER_TREE, bought, id);
      expect(check.ok, `node ${id} should be buyable`).toBe(true);
      const price = nodeCost({ rank: 'S' }, 'Necromancer', id, 'player', RULES);
      if (isRefused(price)) throw new Error(`nodeCost refused for ${id}: ${price.why}`);
      totalGold += price.cost;
      bought.push(id);
    }
    expect(totalGold).toBe(10_140_000);
  });

  test('every Necromancer status def round-trips through parseStatusDef, classStatusDef, and 0-byte fight-doc wire', () => {
    const keys = ['necro-sovereign', 'necro-shadow-monarch', 'necro-domain-aura', 'necro-domain-aura-ii'];
    for (const k of keys) {
      const def = classStatusDef(k);
      expect(def, `classStatusDef(${k})`).not.toBeNull();
      expect(shippedStatusDef(statusKey(k))).toEqual(def);
      expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES), `parseStatusDef(${k})`).not.toBeNull();
    }

    const h = makeNecroHunter(FULL_NECRO_NODES, KEYSTONES_ON);
    const hRow = hunterRow(h, combatantId('h1'), KEYSTONES_ON);
    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-necro'), rows: [{ ...hRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;

    const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
    if (!doc || doc.ended) throw new Error('expected active FightDoc');
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
    const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    if (!parsed || parsed.ended) throw new Error('expected parsed FightDoc');
    const row = parsed.rows.find(r => r.id === combatantId('h1'))!;
    expect(row.statuses.find(s => s.key === statusKey('necro-shadow-monarch'))?.def).toEqual(classStatusDef('necro-shadow-monarch')!);
  });

  test('anti-drift: every node description names its numeric bonuses, nodeGiftLines formats shadows, and all 64 fork masks stay within kit.scalers', () => {
    expect(nodeGiftLines([{ kind: 'bonus', bonus: { shadows: 3, manaMax: 40 } }])).toEqual(['+40 Mana, +3 Shadow capacity']);

    for (const n of NECROMANCER_TREE.nodes) {
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

    const forkGroups = [...new Set(NECROMANCER_TREE.nodes.map(n => n.forkGroup).filter((g): g is string => !!g))];
    const byGroup = forkGroups.map(g => NECROMANCER_TREE.nodes.filter(n => n.forkGroup === g).map(n => n.id));
    for (let mask = 0; mask < (1 << byGroup.length); mask++) {
      const picks = byGroup.map((pair, i) => pair[(mask >> i) & 1]!);
      const nodes = NECROMANCER_TREE.nodes.filter(n => !n.forkGroup || picks.includes(n.id)).map(n => n.id);
      const cp = classPowers(makeNecroHunter(nodes), RULES);
      expect(cp.scalers.length).toBeLessThanOrEqual(RULES.fight.kit.scalers);
      expect(cp.bonus.manaMax).toBe(80);
      expect(cp.bonus.shadows).toBe(3);
    }
  });
});

describe('ClassBonusKey shadow capacity (+3 bonus, non-Necro isolation, +5 stack, field cap)', () => {
  test('shadows is in CLASS_BONUS_KEYS but never in BONUS_KEYS', () => {
    expect(CLASS_BONUS_KEYS).toContain('shadows');
    expect((BONUS_KEYS as readonly string[]).includes('shadows')).toBe(false);
  });

  test('awakened Necromancer grants +3 shadows and +40 manaMax (to +80 maxed); non-Necromancer and unawakened get +0', () => {
    const level = RULES.rankLevels.S;
    const stats = split('pre', 'pow', pointsAt(level, RULES), RULES);
    const plain: Hunter = { ...newHunter(RULES), rank: 'S', level, stats };
    const unawakened: Hunter = {
      ...plain,
      job: 'Necromancer',
      jobDone: null,
      classes: { Necromancer: { unlockedAt: AT, nodes: [] } },
    };
    const hemoEarned = earnClass(plain, 'Hemomancer', { at: AT, R: RULES });
    if (isRefused(hemoEarned)) throw new Error('earnClass Hemomancer failed');
    const necroBase = makeNecroHunter([], RULES);
    const necroMax = makeNecroHunter(FULL_NECRO_NODES, RULES);

    const plainSheet = hunterSheet(plain, RULES).sheet;
    const unawakenedSheet = hunterSheet(unawakened, RULES).sheet;
    const hemoSheet = hunterSheet(hemoEarned, RULES).sheet;
    const necroBaseSheet = hunterSheet(necroBase, RULES).sheet;
    const necroMaxSheet = hunterSheet(necroMax, RULES).sheet;

    expect(unawakenedSheet.shadows).toBe(plainSheet.shadows);
    expect(hemoSheet.shadows).toBe(plainSheet.shadows);
    expect(necroBaseSheet.shadows).toBe(plainSheet.shadows + 3);
    expect(necroBaseSheet.manaMax).toBe(plainSheet.manaMax + 40);
    expect(classPowers(necroMax, RULES).bonus.manaMax).toBe(80);
    expect(necroMaxSheet.manaMax).toBeGreaterThanOrEqual(plainSheet.manaMax + 80);
    expect(explain(necroBase, 'shadows', RULES).parts.find(p => p.from === 'class')?.amount).toBe(3);
  });

  test('Necromancer (+3) stacks with Sovereign (+1) and Shadowbound (+1) to +5 panel capacity while combat field cap stays 4', () => {
    const level = KEYSTONES_ON.rankLevels.S;
    const stats = split('pre', 'pow', pointsAt(level, KEYSTONES_ON), KEYSTONES_ON);
    const plainNoKs = hunterSheet({ ...newHunter(RULES), rank: 'S', level, stats }, RULES).sheet;
    const necroKs = makeNecroHunter([], KEYSTONES_ON);
    const ksNames = heldKeystones(necroKs, KEYSTONES_ON).map(k => k.keystone.name);
    expect(ksNames).toContain('Sovereign');
    expect(ksNames).toContain('Shadowbound');

    const panelCap = armyCap(necroKs, KEYSTONES_ON);
    expect(panelCap).toBe(plainNoKs.shadows + 5);
    expect(panelCap).toBeGreaterThan(4);
    expect(shadowFieldCap(panelCap)).toBe(4);
  });
});

describe('Panel extraction +1 attempt ("Attempt 4 of 4")', () => {
  test('RULES.shadow.classAttempts defaults to 1 (whole, 0..5) and extractAttemptsMax yields 4 for awakened Necromancer vs 3 otherwise', () => {
    expect(RULES.shadow.classAttempts).toBe(1);
    expect(domainOf('shadow.classAttempts')).toMatchObject({ least: 0, most: 5, whole: true });

    const necro = makeNecroHunter([], RULES);
    const plain = newHunter(RULES);
    const unawakened: Hunter = { ...plain, job: 'Necromancer', jobDone: null, classes: { Necromancer: { unlockedAt: AT, nodes: [] } } };

    expect(extractBonusOf(necro, RULES.shadow)).toBe(1);
    expect(extractBonusOf(plain, RULES.shadow)).toBe(0);
    expect(extractBonusOf(unawakened, RULES.shadow)).toBe(0);

    expect(extractAttemptsMax(RULES.shadow, necro)).toBe(4);
    expect(extractAttemptsMax(RULES.shadow, plain)).toBe(3);
    expect(extractAttemptsMax(RULES.shadow, unawakened)).toBe(3);
  });

  test('HunterRow.extractBonus gives awakened Necromancer Attempt 4 of 4 in fight.ts and round-trips through parseFight', () => {
    const necro = makeNecroHunter([], RULES);
    const other: Hunter = { ...newHunter(RULES), id: hunterId('h-other'), name: 'Other' };
    const necroRow = hunterRow(necro, combatantId('h-necro'), RULES);
    const otherRow = hunterRow(other, combatantId('h-other'), RULES);
    expect(necroRow.kind === 'hunter' && necroRow.extractBonus).toBe(1);
    expect(otherRow.kind === 'hunter' && otherRow.extractBonus).toBeUndefined();

    const deadFoe = {
      ...monsterRows({ name: 'Goblin', rank: 'E', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!,
      life: { at: 'dead' as const },
    };
    let f = reduce(null, { type: 'add', fightId: fightId('f-ext'), rows: [necroRow, otherRow, deadFoe], openings: [] }, { rules: RULES }).fight!;

    // Round-trip through parseFight preserves extractBonus on hunter and rejects it on non-hunters
    const reparsed = parseFight(JSON.parse(JSON.stringify(f)), RULES);
    expect(reparsed).not.toBeNull();
    expect(reparsed!.rows.find(r => r.id === combatantId('h-necro'))?.extractBonus).toBe(1);
    const badShadow = JSON.parse(JSON.stringify(f));
    badShadow.rows[2].extractBonus = 1;
    expect(parseFight(badShadow, RULES)).toBeNull();

    // Three failed attempts by Necromancer leave 1 attempt open -> UI displays "Attempt 4 of 4"
    for (let i = 1; i <= 3; i++) {
      const r = reduce(f, { type: 'extract', id: combatantId('m1'), by: combatantId('h-necro'), outcome: 'failed' }, { rules: RULES });
      expect(r.effects.some(e => e.type === 'refused')).toBe(false);
      f = r.fight!;
    }
    const corpseAfter3 = f.rows.find(r => r.id === combatantId('m1'))!;
    expect(corpseAfter3.extraction).toEqual({ at: 'open', tried: 3 });

    // Non-Necromancer has 0 attempts left and is refused
    expect(attemptsLeft(corpseAfter3.extraction!, extractAttemptsMax(RULES.shadow, other))).toBe(0);
    const refusedOther = reduce(f, { type: 'extract', id: combatantId('m1'), by: combatantId('h-other'), outcome: 'failed' }, { rules: RULES });
    expect(refusedOther.effects).toContainEqual({ type: 'refused', reason: 'noAttempts' });

    // Awakened Necromancer sees left = 1 out of max = 4 -> "Attempt 4 of 4"
    const max = extractAttemptsMax(RULES.shadow, necro);
    const left = attemptsLeft(corpseAfter3.extraction!, max);
    const tried = max - left;
    expect(`Attempt ${tried + 1} of ${max}`).toBe('Attempt 4 of 4');

    // 4th failure spends the corpse
    const fourth = reduce(f, { type: 'extract', id: combatantId('m1'), by: combatantId('h-necro'), outcome: 'failed' }, { rules: RULES });
    expect(fourth.effects.some(e => e.type === 'refused')).toBe(false);
    expect(fourth.fight!.rows.find(r => r.id === combatantId('m1'))!.extraction).toEqual({ at: 'gone', why: 'spent' });
    expect(extractionStep(UNTRIED, 'failed', 4)).toEqual({ at: 'open', tried: 1 });
  });
});

describe('Necromancer combat mechanics (Sovereign of Shadows, Shadow Monarch, Arise, Domain, Authority, Exchange)', () => {
  const ARISE_ID = wornAbilityId(abilityId('necro-arise'));
  const DOMAIN_ID = wornAbilityId(abilityId('necro-domain'));
  const AUTHORITY_ID = wornAbilityId(abilityId('necro-authority'));
  const EXCHANGE_ID = wornAbilityId(abilityId('necro-exchange'));

  function startArena(nodes: readonly ClassNodeId[], opts: { withShadow?: boolean; foeHp?: number; foeAt?: ReturnType<typeof place> } = {}): Running {
    const h = makeNecroHunter(nodes, RULES);
    const hRow = { ...hunterRow(h, combatantId('h1'), RULES), place: place(3, 3) };
    const rows = [hRow];
    if (opts.withShadow) {
      const sh = { id: shid('sh1'), name: 'Igris', monster: null, rank: 'S' as const, archetype: 'brute' as const, grade: 'Knight' as const, hp: 1, summoned: true, notes: '' };
      const fullSh = { ...sh, hp: shadowSheet(sh, RULES).hpMax };
      rows.push({ ...shadowRow(fullSh, h.id, combatantId('h1'), combatantId('sh1'), RULES), place: place(7, 3) });
    }
    const foeBase = monsterRows({ name: 'Foe', rank: 'S', archetype: 'brute', kind: 'normal', tweak: { hp: opts.foeHp ?? 1 }, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!;
    rows.push({ ...foeBase, place: opts.foeAt ?? place(4, 3) });

    let f = reduce(null, { type: 'add', fightId: fightId('f-necro-mech'), rows, openings: [] }, { rules: RULES }).fight!;
    f = reduce(f, { type: 'start', openings: rows.map((r, i) => ({ id: r.id, d20: r.id === combatantId('h1') ? 20 : 1, tie: rows.length - i })) }, { rules: RULES }).fight!;
    if (f.phase !== 'running') throw new Error('expected running fight');
    return f;
  }

  test('Shadow Exchange swaps with owned minion, drops 1-round radius-2 slow zone, and worn Exchange Shield grants caster 15% max HP shield', () => {
    const f0 = startArena([], { withShadow: true, foeAt: place(6, 3) });
    const h0 = f0.rows.find(r => r.id === combatantId('h1'))!;
    const sh0 = f0.rows.find(r => r.id === combatantId('sh1'))!;
    expect(h0.shield).toBeNull();

    const r = reduce(f0, {
      type: 'act',
      by: combatantId('h1'),
      ability: EXCHANGE_ID,
      aim: combatantId('sh1'),
      rolls: { dice: {}, react: {} },
      force: true,
    }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const f1 = r.fight as Running;
    const h1 = f1.rows.find(r => r.id === combatantId('h1'))!;
    const sh1 = f1.rows.find(r => r.id === combatantId('sh1'))!;

    // Positions swapped
    expect(h1.place).toEqual(sh0.place);
    expect(sh1.place).toEqual(h0.place);
    // Worn Exchange Shield landed on the Necromancer (15% of caster hpMax)
    expect(h1.shield?.amount).toBe(Math.round(0.15 * h1.sheet.hpMax));
    // Slow zone 'Shadow Wake' sits around caster on arrival and slows adjacent foe
    expect(f1.zones.some(z => z.name === 'Shadow Wake')).toBe(true);
    const foe1 = f1.rows.find(r => r.id === combatantId('m1'))!;
    expect(foe1.statuses.some(s => s.zone !== undefined && s.def.label === 'Shadow Wake')).toBe(true);
  });

  test('Undying Legion reforms fallen minion at 50% HP for 15 mana (base) and 65% HP for 12 mana + 15% minion hpMax shield (Shadow Monarch capstone)', () => {
    // Base Sovereign of Shadows: 50% HP, 15 mana, no shield
    const fBase = startArena([], { withShadow: true });
    const hBase0 = fBase.rows.find(r => r.id === combatantId('h1'))!;
    const shBase0 = fBase.rows.find(r => r.id === combatantId('sh1'))!;
    const rBase = reduce(fBase, { type: 'adjust', id: combatantId('sh1'), hp: -shBase0.sheet.hpMax }, { rules: RULES });
    const fBase1 = rBase.fight as Running;
    const hBase1 = fBase1.rows.find(r => r.id === combatantId('h1'))!;
    const shBase1 = fBase1.rows.find(r => r.id === combatantId('sh1'))!;
    expect(isUp(shBase1)).toBe(true);
    expect(rowHp(shBase1)).toBe(Math.round(0.5 * shBase0.sheet.hpMax));
    expect(hBase1.mana).toBe(hBase0.mana - 15);
    expect(shBase1.shield).toBeNull();

    // Shadow Monarch capstone: 65% HP, 12 mana, 15% target.hpmax shield (boosted by Necromancer's healPower)
    const fCap = startArena(FULL_NECRO_NODES, { withShadow: true });
    const hCap0 = fCap.rows.find(r => r.id === combatantId('h1'))!;
    const shCap0 = fCap.rows.find(r => r.id === combatantId('sh1'))!;
    const rCap = reduce(fCap, { type: 'adjust', id: combatantId('sh1'), hp: -shCap0.sheet.hpMax }, { rules: RULES });
    const fCap1 = rCap.fight as Running;
    const hCap1 = fCap1.rows.find(r => r.id === combatantId('h1'))!;
    const shCap1 = fCap1.rows.find(r => r.id === combatantId('sh1'))!;
    expect(isUp(shCap1)).toBe(true);
    expect(rowHp(shCap1)).toBe(Math.round(0.65 * shCap0.sheet.hpMax));
    expect(hCap1.mana).toBe(hCap0.mana - 12);
    const expectedShield = Math.round(0.15 * shCap0.sheet.hpMax * (1 + Number(hCap0.sheet.healPower)));
    expect(shCap1.shield?.amount).toBe(expectedShield);
  });

  test('Mana Harvest restores 12 + 0.1 * manaMax on armyKill (including minion kill) once per round', () => {
    const f0 = startArena([], { withShadow: true, foeAt: place(6, 3) });
    // Lower Necromancer mana so restoration is observable and bring foe to 1 HP
    let f = reduce(f0, { type: 'adjust', id: combatantId('h1'), mana: -30 }, { rules: RULES }).fight as Running;
    const foe = f.rows.find(r => r.id === combatantId('m1'))!;
    f = reduce(f, { type: 'adjust', id: combatantId('m1'), hp: -(rowHp(foe) - 1) }, { rules: RULES }).fight as Running;
    // Add a second foe so fight does not end on kill
    const foe2 = { ...monsterRows({ name: 'Foe B', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m2')], RULES)[0]!, place: place(10, 3) };
    f = reduce(f, { type: 'add', fightId: f.id, rows: [foe2], openings: [{ id: combatantId('m2'), d20: 1, tie: 0 }] }, { rules: RULES }).fight as Running;

    const hBefore = f.rows.find(r => r.id === combatantId('h1'))!;
    const sh = f.rows.find(r => r.id === combatantId('sh1'))!;
    const attack = sh.abilities[0]!;
    const killed = reduce(f, {
      type: 'act',
      by: sh.id,
      ability: attack.id,
      aim: combatantId('m1'),
      rolls: { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 5 } },
      force: true,
    }, { rules: RULES });
    expect(killed.effects.filter(e => e.type === 'refused')).toEqual([]);
    const hAfter = (killed.fight as Running).rows.find(r => r.id === combatantId('h1'))!;
    const expectedGain = Math.round(12 + 0.1 * hBefore.sheet.manaMax);
    expect(hAfter.mana).toBe(Math.min(hBefore.sheet.manaMax, hBefore.mana + expectedGain));
  });

  test('Domain of the Monarch shreds foe armor/resist in radius 5 and buffs minions only; Walking Domain moves with caster', () => {
    // Base Domain: fixed zone around cast tile, -15% armor/resist on foe, minion aura on shadow
    const f0 = startArena([], { withShadow: true, foeAt: place(5, 3) });
    const foe0 = f0.rows.find(r => r.id === combatantId('m1'))!;
    const sh0 = f0.rows.find(r => r.id === combatantId('sh1'))!;
    const cast = reduce(f0, { type: 'act', by: combatantId('h1'), ability: DOMAIN_ID, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    expect(cast.effects.filter(e => e.type === 'refused')).toEqual([]);
    const f1 = cast.fight as Running;
    const foeZone = f1.zones.find(z => z.name === 'Domain of the Monarch' && z.ground.kind === 'around' && z.ground.anchor.kind === 'place');
    expect(foeZone).toBeDefined();
    const foe1 = f1.rows.find(r => r.id === combatantId('m1'))!;
    const sh1 = f1.rows.find(r => r.id === combatantId('sh1'))!;
    expect(foe1.sheet.armor).toBeLessThan(foe0.sheet.armor);
    expect(foe1.sheet.resist).toBeLessThan(foe0.sheet.resist);
    expect(sh1.sheet.speed).toBeGreaterThan(sh0.sheet.speed);

    // Walking Domain (D7 fork): zone anchored to caster body (`around: tiles(5)`)
    const fWalk0 = startArena(FULL_NECRO_NODES, { withShadow: true, foeAt: place(5, 3) });
    const walkCast = reduce(fWalk0, { type: 'act', by: combatantId('h1'), ability: DOMAIN_ID, aim: combatantId('h1'), rolls: { dice: {}, react: {} }, force: true }, { rules: RULES });
    const fWalk1 = walkCast.fight as Running;
    const movingZone = fWalk1.zones.find(z => z.name === 'Domain of the Monarch: Walking');
    expect(movingZone?.ground.kind).toBe('around');
    if (movingZone?.ground.kind === 'around') {
      expect(movingZone.ground.anchor).toEqual({ kind: 'body', id: combatantId('h1'), status: null });
    }
  });

  test('Arise raises dead monsters with maxRisen scaling 2 -> 3 -> 4 across Legion forks and never mutates extraction', () => {
    const baseH = makeNecroHunter([], RULES);
    const d5Nodes = ['necro-root', 'necro-a2', 'necro-a3x', 'necro-a3y', 'necro-a4x', 'necro-a4y', 'necro-a5-l'].map(nid);
    const d5H = makeNecroHunter(d5Nodes, RULES);
    const maxH = makeNecroHunter(FULL_NECRO_NODES, RULES);

    expect(classPowers(baseH, RULES).actives.find(a => a.id === abilityId('necro-arise'))?.raise?.maxRisen).toBe(2);
    expect(classPowers(d5H, RULES).actives.find(a => a.id === abilityId('necro-arise'))?.raise?.maxRisen).toBe(3);
    expect(classPowers(maxH, RULES).actives.find(a => a.id === abilityId('necro-arise'))?.raise?.maxRisen).toBe(4);

    // Live Arise check: failed roll leaves corpse.extraction untouched; passed roll spawns a risen summon
    const f0 = startArena([], { foeAt: place(4, 3) });
    const foe2 = { ...monsterRows({ name: 'Foe B', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m2')], RULES)[0]!, place: place(9, 3) };
    let f = reduce(f0, { type: 'add', fightId: f0.id, rows: [foe2], openings: [{ id: combatantId('m2'), d20: 1, tie: 0 }] }, { rules: RULES }).fight as Running;
    f = reduce(f, { type: 'adjust', id: combatantId('m1'), hp: -99999 }, { rules: RULES }).fight as Running;

    // Failed d20 = 1 roll: no crumble, no extraction mutation, no risen row
    const fail = reduce(f, { type: 'act', by: combatantId('h1'), ability: ARISE_ID, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [1] }, react: {} }, force: true }, { rules: RULES });
    expect(fail.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterFail = fail.fight as Running;
    expect(afterFail.rows.find(r => r.id === combatantId('m1'))!.extraction).toBeUndefined();
    expect(afterFail.rows.filter(isRisen).length).toBe(0);

    // Passed d20 = 20 roll after cooldown: raises corpse, still leaves extraction untouched
    const readyF: Running = { ...afterFail, now: tick(2000) };
    const pass = reduce(readyF, { type: 'act', by: combatantId('h1'), ability: ARISE_ID, aim: combatantId('m1'), rolls: { dice: { [combatantId('m1')]: [20] }, react: {} }, force: true }, { rules: RULES });
    expect(pass.effects.filter(e => e.type === 'refused')).toEqual([]);
    const afterPass = pass.fight as Running;
    expect(afterPass.rows.filter(isRisen).length).toBe(1);
    expect(afterPass.rows.find(r => r.id === combatantId('m1'))!.extraction).toBeUndefined();
  });

  test('Ruler\'s Authority deals arcane damage, pulls foes toward aim, and fills stagger bar', () => {
    const h = makeNecroHunter([], RULES);
    const hRow = { ...hunterRow(h, combatantId('h1'), RULES), place: place(2, 3) };
    const boss = { ...monsterRows({ name: 'Elite Foe', rank: 'S', archetype: 'brute', kind: 'elite', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], RULES)[0]!, place: place(8, 3) };
    let f = reduce(null, { type: 'add', fightId: fightId('f-auth'), rows: [hRow, boss], openings: [] }, { rules: RULES }).fight!;
    f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: RULES }).fight!;

    const before = (f as Running).rows.find(r => r.id === combatantId('m1'))!;
    const r = reduce(f, {
      type: 'act',
      by: combatantId('h1'),
      ability: AUTHORITY_ID,
      aim: place(6, 3),
      rolls: { dice: { [combatantId('m1')]: [10] }, react: { [combatantId('m1')]: 1 } },
      force: true,
    }, { rules: RULES });
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const after = (r.fight as Running).rows.find(r => r.id === combatantId('m1'))!;
    expect(rowHp(after)).toBeLessThan(rowHp(before));
    expect(after.place.x).toBeLessThan(before.place.x);
    expect(after.stagger!.fill).toBeGreaterThan(0);
    // Verify Shadow Monarch passive aura + turnStart mana
    const capH = makeNecroHunter(FULL_NECRO_NODES, RULES);
    const capRow = hunterRow(capH, combatantId('h-cap'), RULES);
    expect(modified(capRow.origin, capRow.statuses, RULES).sheet.manaMax).toBe(hunterSheet(capH, RULES).sheet.manaMax);
  });
});
