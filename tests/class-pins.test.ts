import { readdir } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import { DOCS, parseEvent } from '../src/core/protocol.ts';
import { fightId, grantRefusalIdOf, parseSheetKey, sheetKeyOf } from '../src/core/ids.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import { STAT_PAIRS } from '../src/core/hunter/keystones.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import { BUILT_IN_CLASSES, isClassName } from '../src/core/registry/jobs.ts';
import type { ClassName } from '../src/core/registry/jobs.ts';
import { CLASS_SIGNATURES, classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, TREE_SHAPE, canBuyNode, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { SKILL_ABILITIES } from '../src/core/registry/abilities.ts';
import { LOOT_ITEMS, SHOP_ITEMS, STARTER_GEAR } from '../src/core/registry/items.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { isMythicStatusKey } from '../src/core/combat/mythic-types.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { LandOp, Op, StatusDef } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { fightDoc, fightWire, shippedStatusDef } from '../src/core/combat/fight-doc.ts';
import { reduce } from '../src/core/combat/fight.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { place } from '../src/core/combat/space.ts';
import { landAll } from '../src/edge/room-events.ts';
import type { ApplyDeps } from '../src/edge/room-events.ts';
import { reconcileLocalUniqueClasses } from '../src/core/hunter/class-holders.ts';
import { WAVE1_OFFER_POOL } from '../src/core/hunter/class-locker.ts';
import { earnClass } from '../src/core/hunter/classes.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { releaseNoticeStep } from '../src/core/hunter/noticed.ts';
import { record } from '../src/core/hunter/chronicle.ts';
import { TOLD, isRefused, refuse } from '../src/core/save-step.ts';
import { day, dev, room } from './fixtures/ids.ts';
import { KEYSTONES_ON } from './fixtures/keystone-rules.ts';
import { MYTHIC_SOLO_SPECS } from './fixtures/mythic-hunters.ts';

const ROOT = import.meta.dir + '/..';
const AT = '2026-11-25T12:00:00.000Z';

describe('M1 and B1 balance row pins (settled.md, t137u)', () => {
  test('tests/fight-sim.test.ts keeps the M1 party-vs-mythic rows and B1 scripted-mythic rows with their 5 to 10% bounds', async () => {
    const src = await Bun.file(`${ROOT}/tests/fight-sim.test.ts`).text();

    // Pin M1: mixed party of 3 at S wins 5 to 10% against each monster archetype mythic.
    expect(src).toContain('name: `three hunters at S win 5 to 10% of fights against a same-rank ${a} mythic`');
    expect(src).toContain('measure: () => wins(`mixed v ${a} mythic S`, vsMythic(a), RUNS.mythic), low: 0.05, high: 0.1');
    expect(Object.keys(RULES.fight.archetypes).sort()).toEqual(['brute', 'caster', 'skirmisher']);

    // Pin B1: mixed party of 3 at S wins 5 to 10% against each scripted mythic boss in MYTHIC_IDS.
    expect(src).toContain('name: `B1 three hunters at S win 5 to 10% of fights against ${nameOf(id)}`');
    expect(src).toContain('measure: () => wins(B1_KEY(id), vsScript(id), RUNS.mythic), low: 0.05, high: 0.1');
    expect([...MYTHIC_IDS]).toEqual(['plain', 'angel-of-the-last-trumpet', 'zaratan-the-island-that-wakes', 'the-fourth-rider']);
  });
});

describe('level-triggered unique class convergence and releaseNoticeStep (Blocker 1, Finding 10)', () => {
  const env = { now: new Date(AT), newDeviceToken: () => 'tok-0123456789abcdef0123456789ab', newDeviceId: () => dev('d-pl1') };

  function makeDeps(inFight: boolean, toasts: string[]): ApplyDeps {
    const s = freshSave(env, { onboarded: true });
    return {
      store: { get: () => s },
      once: () => true,
      rules: () => RULES,
      now: () => AT,
      today: () => day('2026-11-25'),
      toast: (tag, text) => { toasts.push(`${tag}: ${text}`); },
      system: () => {},
      warn: () => {},
      hunter: {
        fightOf: () => (inFight ? { at: 'gm' } : null),
        granted: () => ({ lines: [], levelup: null, popup: null }),
        gmHolds: () => refuse(TOLD),
      },
      stepsDone: () => {},
      coinRuled: () => {},
    };
  }

  test('classGrant and classRevoke events alone do not mutate local state; convergence happens level-triggered from DOCS.holders after fight close', () => {
    const s0 = freshSave(env, { onboarded: true });
    const h0 = s0.hunters[0]!;
    const key = sheetKeyOf(s0.settings.deviceId, h0.id);

    // 1. Outbox events landing before DOCS.holders are no-ops on the player phone (eliminating outbox-vs-publishWait race)
    const grantEv = parseEvent('classGrant', { eid: 'd-gm-cg1', to: [key], className: 'Hemomancer', at: AT })!;
    const revokeEv = parseEvent('classRevoke', { eid: 'd-gm-cr1', to: [key], className: 'Hemomancer', at: AT })!;
    const toasts: string[] = [];
    const landed = landAll(s0, [], [grantEv, revokeEv], makeDeps(false, toasts));
    for (const t of landed.tells) t();
    expect(landed.save.hunters[0]!.classes).toEqual({});
    expect(toasts).toEqual([]);

    // 2. DOCS.holders arrives while hunter is held in a fight: skipped until fight closes
    const grantDoc = { registryId: 'reg-1', at: AT, held: { Hemomancer: { who: key, grantId: 'cg1' } } };
    const midFight = reconcileLocalUniqueClasses(s0, grantDoc, { isHeld: () => true, R: RULES });
    expect(midFight.save).toBe(s0);

    // 3. Fight closes: grant converges cleanly
    const afterGrant = reconcileLocalUniqueClasses(s0, grantDoc, { isHeld: () => false, R: RULES });
    expect(afterGrant.granted).toEqual(['Hemomancer']);
    expect(afterGrant.save.hunters[0]!.job).toBe('Hemomancer');
    expect(afterGrant.save.hunters[0]!.jobDone).toBe('Hemomancer');

    // 4. GM revokes while hunter is in a new fight: skipped until fight closes, then dropped cleanly
    const revokeDoc = { registryId: 'reg-1', at: AT, held: {} };
    const heldRevoke = reconcileLocalUniqueClasses(afterGrant.save, revokeDoc, { isHeld: () => true, R: RULES });
    expect(heldRevoke.save).toBe(afterGrant.save);

    const afterRevoke = reconcileLocalUniqueClasses(afterGrant.save, revokeDoc, { isHeld: () => false, R: RULES });
    expect(afterRevoke.revoked).toEqual(['Hemomancer']);
    expect(afterRevoke.save.hunters[0]!.classes.Hemomancer).toBeUndefined();
    expect(afterRevoke.save.hunters[0]!.job).toBeNull();
  });

  test('releaseNoticeStep passes refused unchanged through while held (zero writes mid-fight), then flushes inbox and reconciles on fight close', () => {
    const s0 = freshSave(env, { onboarded: true });
    const h0 = record(s0.hunters[0]!, { kind: 'level', level: 2 });
    const withInbox = { ...s0, hunters: [h0] };
    expect(withInbox.hunters[0]!.chronicle.inbox.length).toBeGreaterThan(0);

    const key = sheetKeyOf(withInbox.settings.deviceId, h0.id);
    const grantDoc = { registryId: 'reg-1', at: AT, held: { Hemomancer: { who: key, grantId: 'cg1' } } };

    // While held: released() refuses 'unchanged' AND reconcile skips -> refused-in, refused-out (zero writes mid-fight!)
    const heldOut = releaseNoticeStep(withInbox, grantDoc, true, () => true, RULES);
    expect(heldOut).toEqual({ ok: false, why: 'unchanged' });

    // Even with no holders doc, held inbox still refuses 'unchanged'
    expect(releaseNoticeStep(withInbox, null, true, () => true, RULES)).toEqual({ ok: false, why: 'unchanged' });

    // Fight closes with no holders doc: returns ok save so store.apply's post-step `noticed()` flushes the waiting inbox
    const inboxOnly = releaseNoticeStep(withInbox, null, true, () => false, RULES);
    expect(isRefused(inboxOnly)).toBe(false);
    if (!isRefused(inboxOnly)) expect(inboxOnly.diff).toBeNull();

    // Fight closes with holders doc: returns reconciled save so store.apply flushes inbox and grants Hemomancer in one write
    const releasedOut = releaseNoticeStep(withInbox, grantDoc, true, () => false, RULES);
    if (isRefused(releasedOut)) throw new Error(`unexpected refusal: ${releasedOut.why}`);
    expect(releasedOut.save.hunters[0]!.job).toBe('Hemomancer');
    expect(releasedOut.diff?.granted).toEqual(['Hemomancer']);

    // Next idle poll (inbox drained, class converged) refuses 'unchanged' (zero writes at rest)
    const drained = { ...releasedOut.save, hunters: [{ ...releasedOut.save.hunters[0]!, chronicle: { ...releasedOut.save.hunters[0]!.chronicle, inbox: [] } }] };
    expect(releaseNoticeStep(drained, grantDoc, false, () => false, RULES)).toEqual({ ok: false, why: 'unchanged' });
  });
});

describe('a phone reports a grant it could not take once (statechart rule 4)', () => {
  const env = { now: new Date(AT), newDeviceToken: () => 'tok-0123456789abcdef0123456789ab', newDeviceId: () => dev('d-pl1') };
  const ROOM = room('ABCD23');
  function parked() {
    const s0 = freshSave(env, { onboarded: true });
    const h = s0.hunters[0]!;
    const foreign = earnClass(h, 'Hemomancer', { at: AT, activate: false, awaken: true, registryId: 'reg-old', grantId: 'cg9', resetNodes: true, R: RULES });
    if (isRefused(foreign)) throw new Error(foreign.why);
    const s = { ...s0, hunters: [foreign] };
    const key = sheetKeyOf(s.settings.deviceId, h.id);
    return { s, key, doc: { registryId: 'reg-1', at: AT, held: { Hemomancer: { who: key, grantId: 'cg1-abc' } } } };
  }
  const reports = (s: ReturnType<typeof parked>['s']) => (s.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' && e.letter.event.type === 'classGrantRefused' ? [e.letter.event] : []));

  test('the report is queued once under the grant\'s id, and the next poll answers unchanged', () => {
    const { s, key, doc } = parked();
    const first = releaseNoticeStep(s, doc, false, () => false, RULES, ROOM);
    if (isRefused(first)) throw new Error(first.why);
    expect(first.reported).toEqual([{ hid: s.hunters[0]!.id, className: 'Hemomancer', grantId: 'cg1-abc', why: 'foreign-class' }]);
    expect(reports(first.save).map(e => e.payload)).toEqual([{ eid: grantRefusalIdOf('cg1-abc'), by: key, name: s.hunters[0]!.name, className: 'Hemomancer', grantId: 'cg1-abc', why: 'foreign-class' }]);
    expect(first.save.hunters[0]!.classes.Hemomancer).toEqual(s.hunters[0]!.classes.Hemomancer);
    expect(releaseNoticeStep(first.save, doc, false, () => false, RULES, ROOM)).toEqual({ ok: false, why: 'unchanged' });
  });

  test('nothing is queued without a room, and nothing while the fight holds the hunter', () => {
    const { s, doc } = parked();
    expect(releaseNoticeStep(s, doc, false, () => false, RULES, null)).toEqual({ ok: false, why: 'unchanged' });
    expect(releaseNoticeStep(s, doc, false, () => true, RULES, ROOM)).toEqual({ ok: false, why: 'unchanged' });
  });
});

const IMPORTS_CLASS_POWERS = /import\s+(?!type\b)[^;]*\bclassPowers\b[^;]*from\s+['"][^'"]*class-powers\.ts['"]/;
const IMPORTS_CLASS_STATUS_DEF = /import\s+(?!type\b)[^;]*\bclassStatusDef\b[^;]*from\s+['"][^'"]*class-powers\.ts['"]/;

/**
 * Seam tripwire (Q5, Nit 2): PR 1 leaves `CLASS_SIGNATURES` and `CLASS_TREES` empty so `sheet.ts`, `rows.ts`, and
 * `fight-doc.ts` stay untouched until PR 2 adds real class kits. Once either table is non-empty, all three
 * combat/sheet callers must have real runtime imports of `classPowers` / `classStatusDef` from `class-powers.ts`
 * (comments do not satisfy the tripwire).
 */
function checkSeamWiring(
  sigKeys: readonly string[],
  treeKeys: readonly string[],
  sheetSrc: string,
  rowsSrc: string,
  fightDocSrc: string,
): string[] {
  if (sigKeys.length === 0 && treeKeys.length === 0) return [];
  const missing: string[] = [];
  if (!IMPORTS_CLASS_POWERS.test(sheetSrc)) missing.push('src/core/hunter/sheet.ts must import classPowers from class-powers.ts');
  if (!IMPORTS_CLASS_POWERS.test(rowsSrc)) missing.push('src/core/combat/rows.ts must import classPowers from class-powers.ts');
  if (!IMPORTS_CLASS_STATUS_DEF.test(fightDocSrc)) missing.push('src/core/combat/fight-doc.ts must import classStatusDef from class-powers.ts');
  return missing;
}

describe('PR 2 combat/sheet seam tripwire', () => {
  test('verifies live sheet.ts, rows.ts, and fight-doc.ts wire classPowers/classStatusDef once kits ship, catches unwired callers, and is not fooled by comments', async () => {
    const [sheetSrc, rowsSrc, fightDocSrc] = await Promise.all([
      Bun.file(`${ROOT}/src/core/hunter/sheet.ts`).text(),
      Bun.file(`${ROOT}/src/core/combat/rows.ts`).text(),
      Bun.file(`${ROOT}/src/core/combat/fight-doc.ts`).text(),
    ]);

    // PR 2 populates Hemomancer in both tables and wires all three callers
    expect(Object.keys(CLASS_SIGNATURES)).toContain('Hemomancer');
    expect(Object.keys(CLASS_TREES)).toContain('Hemomancer');
    expect(
      checkSeamWiring(Object.keys(CLASS_SIGNATURES), Object.keys(CLASS_TREES), sheetSrc, rowsSrc, fightDocSrc),
    ).toEqual([]);

    // Self-test: synthetic non-empty table against unwired sources fails loudly on all three callers
    expect(checkSeamWiring(['Hemomancer'], [], 'export const x = 1;', 'export const y = 2;', 'export const z = 3;')).toEqual([
      'src/core/hunter/sheet.ts must import classPowers from class-powers.ts',
      'src/core/combat/rows.ts must import classPowers from class-powers.ts',
      'src/core/combat/fight-doc.ts must import classStatusDef from class-powers.ts',
    ]);

    // Self-test: comments or type-only imports do NOT satisfy the tripwire
    expect(
      checkSeamWiring(
        ['Hemomancer'],
        [],
        '// TODO: wire classPowers from class-powers.ts',
        "import type { classPowers } from '../registry/class-powers.ts';",
        '// classStatusDef',
      ),
    ).toHaveLength(3);

    // Real runtime imports satisfy the tripwire
    expect(
      checkSeamWiring(
        [],
        ['Fighter'],
        "import { classPowers } from '../registry/class-powers.ts';",
        "import { classPowers } from '../registry/class-powers.ts';",
        "import { classStatusDef } from '../registry/class-powers.ts';",
      ),
    ).toEqual([]);
  });
});

describe('Wave 3 U8: Roster Lock — wired class signatures, trees, status keys, and name collisions', () => {
  const WIRED_CLASSES: readonly ClassName[] = [
    // Common (6)
    'Assassin', 'Fighter', 'Healer', 'Mage', 'Ranger', 'Tanker',
    // Rare (7)
    'Bastion', 'Berserker', 'Brambleguard', 'Cleric', 'Nightblade', 'Pyromancer', 'Sniper',
    // Epic (7)
    'Chronokeeper', 'Grimreaper', 'Ironclad', 'Packlord', 'Seraph', 'Stormcaller', 'Voidstalker',
    // Mythic (6)
    'Bladefiend', 'Hemomancer', 'Necromancer', 'Nullweaver', 'Rifthunter', 'Starforger',
  ];

  test('every wired class has a paired signature and tree, matches registry class files, folds cleanly, and wires at 0 bytes', async () => {
    const sigNames = (Object.keys(CLASS_SIGNATURES) as ClassName[]).sort();
    const treeNames = (Object.keys(CLASS_TREES) as ClassName[]).sort();
    expect(sigNames).toEqual(treeNames);
    expect(sigNames).toEqual([...WIRED_CLASSES].sort());
    expect(sigNames).toHaveLength(26);

    const byRarity = {
      common: sigNames.filter(c => BUILT_IN_CLASSES[c].rarity === 'common'),
      rare: sigNames.filter(c => BUILT_IN_CLASSES[c].rarity === 'rare'),
      epic: sigNames.filter(c => BUILT_IN_CLASSES[c].rarity === 'epic'),
      mythic: sigNames.filter(c => BUILT_IN_CLASSES[c].rarity === 'mythic'),
    };
    expect(byRarity.common).toHaveLength(6);
    expect(byRarity.rare).toHaveLength(7);
    expect(byRarity.epic).toHaveLength(7);
    expect(byRarity.mythic).toHaveLength(6);

    // Every src/core/registry/class-*.ts class module is wired in both tables
    const registryFiles = (await readdir(`${ROOT}/src/core/registry`))
      .filter(f => f.startsWith('class-') && f.endsWith('.ts') && !['class-common.ts', 'class-powers.ts', 'class-trees.ts'].includes(f))
      .sort();
    const expectedFiles = sigNames.map(c => `class-${c.toLowerCase()}.ts`).sort();
    expect(registryFiles).toEqual(expectedFiles);

    // Every wired Mythic is registered in MYTHIC_SOLO_SPECS for the legality loop in mythic-solo-sim.test.ts
    expect(MYTHIC_SOLO_SPECS.map(s => s.className).sort()).toEqual(byRarity.mythic);

    // Fork 2 pin: Wave 1 Act 1 offer pool remains its 6 Wave 1 classes (no Wave 2/3 pool edits)
    expect([...WAVE1_OFFER_POOL]).toEqual(['Hemomancer', 'Bladefiend', 'Rifthunter', 'Seraph', 'Ironclad', 'Stormcaller']);

    const foe = monsterRows({ name: 'Dummy', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('m1')], KEYSTONES_ON)[0]!;

    for (const cls of sigNames) {
      expect(isClassName(cls)).toBe(true);
      const sig = CLASS_SIGNATURES[cls]!;
      const tree = CLASS_TREES[cls]!;
      expect(sig.className).toBe(cls);
      expect(tree.className).toBe(cls);
      expect(tree.rarity).toBe(BUILT_IN_CLASSES[cls].rarity);
      expect(validateTree(tree), `${cls} validateTree`).toEqual([]);
      expect(sig.worn, `${cls} base worn`).toBeDefined();
      expect((sig.actives ?? []).length, `${cls} base actives <= ${CLASS_ACTIVES_MAX}`).toBeLessThanOrEqual(CLASS_ACTIVES_MAX);

      // Canonical full build (left fork of each forkGroup) buys legally step-by-step and repairs unchanged
      const seenFork = new Set<string>();
      const fullNodes = tree.nodes
        .filter(n => {
          if (!n.forkGroup) return true;
          if (seenFork.has(n.forkGroup)) return false;
          seenFork.add(n.forkGroup);
          return true;
        })
        .map(n => n.id);
      expect(fullNodes).toHaveLength(TREE_SHAPE[tree.rarity].buyable);
      expect(repairNodes(tree, fullNodes)).toEqual(fullNodes);
      const bought: typeof fullNodes = [];
      for (const id of fullNodes) {
        expect(canBuyNode(tree, bought, id).ok, `${cls} node ${id} refused`).toBe(true);
        bought.push(id);
      }

      // Folded powers, out-of-combat vs combat sheet parity, and 0-byte fightWire round-trip
      const earned = earnClass({ ...newHunter(RULES), name: cls, rank: 'S', level: RULES.rankLevels.S }, cls, { at: AT, R: RULES });
      if (isRefused(earned)) throw new Error(`earnClass(${cls}) refused: ${earned.why}`);
      const fullHunter = {
        ...earned,
        classes: { ...earned.classes, [cls]: { ...earned.classes[cls]!, nodes: fullNodes } },
      };
      const cp = classPowers(fullHunter, RULES);
      expect(cp.worn, `${cls} folded worn`).not.toBeNull();
      expect(cp.actives.length, `${cls} folded actives <= ${CLASS_ACTIVES_MAX}`).toBeLessThanOrEqual(CLASS_ACTIVES_MAX);
      expect(cp.scalers.length, `${cls} folded scalers <= kit.scalers`).toBeLessThanOrEqual(RULES.fight.kit.scalers);

      const ooc = hunterSheet(fullHunter, RULES).sheet;
      const plainRow = hunterRow(fullHunter, combatantId('h1'), RULES);
      const combat = modified(plainRow.origin, plainRow.statuses, RULES).sheet;
      expect(ooc.hpMax, `${cls} hpMax parity`).toBe(combat.hpMax);
      expect(ooc.armor, `${cls} armor parity`).toBeCloseTo(combat.armor, 4);
      expect(ooc.resist, `${cls} resist parity`).toBeCloseTo(combat.resist, 4);

      const kRow = hunterRow(fullHunter, combatantId('h1'), KEYSTONES_ON);
      let f = reduce(null, { type: 'add', fightId: fightId(`f-pin-${cls.toLowerCase()}`), rows: [{ ...kRow, place: place(2, 2) }, { ...foe, place: place(4, 2) }], openings: [] }, { rules: KEYSTONES_ON }).fight;
      f = reduce(f, { type: 'start', openings: [{ id: combatantId('h1'), d20: 20, tie: 2 }, { id: combatantId('m1'), d20: 1, tie: 1 }] }, { rules: KEYSTONES_ON }).fight;
      const doc = fightDoc(f, KEYSTONES_ON, { by: dev('d-gm'), at: AT, was: null, keyOf: () => parseSheetKey('d-gm:h1')! });
      if (!doc || doc.ended) throw new Error(`${cls}: expected active FightDoc`);
      const wire = fightWire(doc);
      expect(wire.defs, `${cls} wire.defs should be omitted (0 wire bytes)`).toBeUndefined();
      const parsed = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      if (!parsed || parsed.ended) throw new Error(`${cls}: expected parsed FightDoc`);
      const onRow = parsed.rows.find(r => r.id === combatantId('h1'))!.statuses.find(s => s.key === cp.worn!.key);
      expect(onRow?.def, `${cls} worn status restored from registry`).toEqual(classStatusDef(cp.worn!.key)!);
    }
  });

  test('zero orphan status keys, zero divergent definitions, valid gift targets, and full status/ability parser round-trip across all wired classes', () => {
    const sigNames = (Object.keys(CLASS_SIGNATURES) as ClassName[]).sort();
    const statusOwners = new Map<string, { cls: ClassName; def: StatusDef }>();

    const walkFormulaRefs = (obj: unknown, referencedKeys: Set<string>): void => {
      const json = JSON.stringify(obj);
      for (const m of json.matchAll(/"ref":"stacks","key":"([^"]+)"/g)) referencedKeys.add(m[1]!);
      for (const m of json.matchAll(/"status":"([^"]+)"/g)) referencedKeys.add(m[1]!);
    };

    const walkOps = (cls: ClassName, ops: readonly (Op | LandOp)[], referencedKeys: Set<string>): void => {
      for (const op of ops) {
        if (op.op === 'applyStatus') recordStatus(cls, op.key, op.def, referencedKeys);
        else if (op.op === 'cureStatus') referencedKeys.add(op.key);
      }
    };

    const recordStatus = (cls: ClassName, key: string, def: StatusDef, referencedKeys: Set<string>): void => {
      expect(key in BUILT_IN_STATUSES, `${cls}: status key "${key}" collides with BUILT_IN_STATUSES`).toBe(false);
      expect(isMythicStatusKey(statusKey(key)), `${cls}: status key "${key}" must not use boss mythic- prefix`).toBe(false);
      const prev = statusOwners.get(key);
      if (prev) {
        expect(prev.cls, `status key "${key}" shared by ${prev.cls} and ${cls}`).toBe(cls);
        expect(def, `status key "${key}" has divergent StatusDef in ${cls}`).toEqual(prev.def);
        return;
      }
      statusOwners.set(key, { cls, def });
      expect(classStatusDef(key), `${cls}: classStatusDef("${key}")`).toEqual(def);
      expect(shippedStatusDef(statusKey(key)), `${cls}: shippedStatusDef("${key}")`).toEqual(def);
      expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES, key), `${cls}: parseStatusDef("${key}")`).toEqual(def);
      for (const tr of def.triggers ?? []) walkOps(cls, tr.ops, referencedKeys);
      if ('stack' in def && def.stack?.threshold) walkOps(cls, def.stack.threshold.ops, referencedKeys);
      if (def.end) walkOps(cls, def.end.ops, referencedKeys);
    };

    const walkAbility = (cls: ClassName, a: Ability, referencedKeys: Set<string>, activeAppliedKeys: Set<string>): void => {
      for (const op of a.ops) if (op.op === 'applyStatus') activeAppliedKeys.add(op.key);
      walkOps(cls, a.ops, referencedKeys);
      if (a.zone) {
        walkOps(cls, a.zone.ops, referencedKeys);
        if (a.zone.end) walkOps(cls, a.zone.end, referencedKeys);
      }
      for (const p of a.prices ?? []) {
        if (p.kind === 'stacks') referencedKeys.add(p.key);
      }
      for (const st of a.summon?.statuses ?? []) {
        referencedKeys.add(st.key);
      }
      walkFormulaRefs(a, referencedKeys);
      expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES), `${cls}: parseAbility("${a.name}")`).toEqual(a);
    };

    for (const cls of sigNames) {
      const sig = CLASS_SIGNATURES[cls]!;
      const tree = CLASS_TREES[cls]!;
      const referencedKeys = new Set<string>();
      const activeAppliedKeys = new Set<string>();
      const baseActiveIds = new Set<string>();

      if (sig.worn) {
        recordStatus(cls, sig.worn.key, sig.worn.def, referencedKeys);
        walkFormulaRefs(sig.worn, referencedKeys);
      }
      for (const st of sig.statuses ?? []) {
        recordStatus(cls, st.key, st.def, referencedKeys);
        walkFormulaRefs(st, referencedKeys);
      }
      for (const a of sig.actives ?? []) {
        baseActiveIds.add(a.id);
        walkAbility(cls, a, referencedKeys, activeAppliedKeys);
      }
      for (const n of tree.nodes) {
        for (const g of n.gifts) {
          if (g.kind === 'replace-worn') {
            expect(sig.worn?.key, `${cls}.${n.id}: replace-worn targetKey`).toBe(g.targetKey);
            recordStatus(cls, g.worn.key, g.worn.def, referencedKeys);
            walkFormulaRefs(g.worn, referencedKeys);
          } else if (g.kind === 'replace-active') {
            expect(baseActiveIds.has(g.targetId), `${cls}.${n.id}: replace-active targetId "${g.targetId}" exists`).toBe(true);
            expect(g.active.id, `${cls}.${n.id}: replace-active active.id matches targetId`).toBe(g.targetId);
            walkAbility(cls, g.active, referencedKeys, activeAppliedKeys);
          } else if (g.kind === 'upgrade-status') {
            referencedKeys.add(g.targetKey);
            recordStatus(cls, g.key, g.def, referencedKeys);
            walkFormulaRefs(g.def, referencedKeys);
          }
        }
      }
      // Every upgrade-status target must be applied by at least one active of this class
      for (const n of tree.nodes) {
        for (const g of n.gifts) {
          if (g.kind === 'upgrade-status') {
            expect(activeAppliedKeys.has(g.targetKey), `${cls}.${n.id}: upgrade-status targetKey "${g.targetKey}" is orphaned`).toBe(true);
          }
        }
      }
      // Every referenced status key resolves to either a built-in status or a shipped class status (zero orphan references)
      for (const rk of referencedKeys) {
        const known = rk in BUILT_IN_STATUSES || classStatusDef(rk) !== null;
        expect(known, `${cls}: orphan status key reference "${rk}"`).toBe(true);
      }
      // Every extra sig.statuses entry is actually referenced in its class (zero unused status defs)
      for (const st of sig.statuses ?? []) {
        expect(referencedKeys.has(st.key), `${cls}: unused sig.statuses entry "${st.key}"`).toBe(true);
      }
    }

    expect(statusOwners.size).toBeGreaterThanOrEqual(190);
  });

  test('zero node ID, ability ID, active name, worn label, or reserved-registry name collisions across all wired classes', () => {
    const sigNames = (Object.keys(CLASS_SIGNATURES) as ClassName[]).sort();
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
    for (const st of Object.values(BUILT_IN_STATUSES)) reserved.add(st.label.toLowerCase());
    const skillNames = new Set(Object.keys(SKILL_ABILITIES).map(s => s.toLowerCase()));
    const necroCanonicalSkills = new Set(['arise', "ruler's authority", 'shadow exchange']);

    const nodeIds = new Map<string, ClassName>();
    const abilityIds = new Map<string, ClassName>();
    const activeNames = new Map<string, string>();
    const wornLabels = new Map<string, string>();

    for (const cls of sigNames) {
      const sig = CLASS_SIGNATURES[cls]!;
      const tree = CLASS_TREES[cls]!;
      expect(reserved.has(cls.toLowerCase()), `class name "${cls}" collides with reserved`).toBe(false);

      if (sig.worn) {
        const lk = sig.worn.def.label.toLowerCase();
        expect(wornLabels.has(lk), `duplicate worn label "${sig.worn.def.label}" (${wornLabels.get(lk)} vs ${cls})`).toBe(false);
        wornLabels.set(lk, cls);
        expect(reserved.has(lk), `${cls} worn "${sig.worn.def.label}" collides with reserved`).toBe(false);
      }
      for (const a of sig.actives ?? []) {
        expect(abilityIds.has(a.id), `duplicate AbilityId "${a.id}" (${abilityIds.get(a.id)} vs ${cls})`).toBe(false);
        abilityIds.set(a.id, cls);
        const ak = a.name.toLowerCase();
        expect(activeNames.has(ak), `duplicate active name "${a.name}" (${activeNames.get(ak)} vs ${cls})`).toBe(false);
        activeNames.set(ak, cls);
        expect(reserved.has(ak), `${cls} active "${a.name}" collides with reserved`).toBe(false);
        if (skillNames.has(ak)) {
          expect(cls === 'Necromancer' && necroCanonicalSkills.has(ak), `${cls} active "${a.name}" collides with SKILL_ABILITIES`).toBe(true);
        }
      }
      for (const n of tree.nodes) {
        expect(nodeIds.has(n.id), `duplicate ClassNodeId "${n.id}" (${nodeIds.get(n.id)} vs ${cls})`).toBe(false);
        nodeIds.set(n.id, cls);
        expect(reserved.has(n.name.toLowerCase()), `${cls}.${n.id} node "${n.name}" collides with reserved`).toBe(false);
        for (const g of n.gifts) {
          if (g.kind === 'replace-worn') {
            const lk = g.worn.def.label.toLowerCase();
            expect(wornLabels.has(lk), `duplicate worn label "${g.worn.def.label}" (${wornLabels.get(lk)} vs ${cls}.${n.id})`).toBe(false);
            wornLabels.set(lk, `${cls}.${n.id}`);
            expect(reserved.has(lk), `${cls}.${n.id} worn "${g.worn.def.label}" collides with reserved`).toBe(false);
          } else if (g.kind === 'replace-active') {
            const ak = g.active.name.toLowerCase();
            expect(activeNames.has(ak), `duplicate active name "${g.active.name}" (${activeNames.get(ak)} vs ${cls}.${n.id})`).toBe(false);
            activeNames.set(ak, `${cls}.${n.id}`);
            expect(reserved.has(ak), `${cls}.${n.id} active "${g.active.name}" collides with reserved`).toBe(false);
            expect(skillNames.has(ak), `${cls}.${n.id} active "${g.active.name}" collides with SKILL_ABILITIES`).toBe(false);
          }
        }
      }
    }
  });
});
