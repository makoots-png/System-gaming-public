import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { freshSave } from '../src/core/save.ts';
import { parseEvent } from '../src/core/protocol.ts';
import { sheetKeyOf } from '../src/core/ids.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import { CLASS_SIGNATURES } from '../src/core/registry/class-powers.ts';
import { CLASS_TREES } from '../src/core/registry/class-trees.ts';
import { landAll } from '../src/edge/room-events.ts';
import type { ApplyDeps } from '../src/edge/room-events.ts';
import { reconcileLocalUniqueClasses, releaseNoticeStep } from '../src/core/hunter/class-holders.ts';
import { record } from '../src/core/hunter/chronicle.ts';
import { TOLD, isRefused, refuse } from '../src/core/save-step.ts';
import { day, dev } from './fixtures/ids.ts';

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
