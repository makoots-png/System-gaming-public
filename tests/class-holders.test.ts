import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { freshSave, parseSave } from '../src/core/save.ts';
import { parseClassNodeId, parseSheetKey, sheetKeyOf } from '../src/core/ids.ts';
import type { ClassNodeId, SheetKey } from '../src/core/ids.ts';
import { isRefused } from '../src/core/save-step.ts';
import { CLASS_LOCKER_CAP } from '../src/core/registry/class-trees.ts';
import { removeHunter } from '../src/core/party.ts';
import { earnClass, swapClass } from '../src/core/hunter/classes.ts';
import {
  claimUniqueClass,
  classesHeldBy,
  holderOf,
  holdersDocOf,
  reassignUniqueClass,
  reconcileLocalUniqueClasses,
  releaseUniqueClass,
} from '../src/core/hunter/class-holders.ts';
import { dev, hid, mid, qid, room } from './fixtures/ids.ts';

const skey = (s: string): SheetKey => {
  const k = parseSheetKey(s);
  if (!k) throw new Error(`bad key: ${s}`);
  return k;
};

const AT = '2026-11-25T12:00:00.000Z';
const AT_LATER = '2026-11-25T12:05:00.000Z';
const env = { now: new Date(AT), newDeviceToken: () => 'tok-0123456789abcdef0123456789ab', newDeviceId: () => dev('d-gm') };
const STAMP = { device: 'd-gm', now: Date.parse(AT), rand: 0.31 };
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;
const NOT_HELD = { heldLocal: () => false, heldRemote: () => false };

function twoHunterSave(mode: 'gm' | 'player' = 'gm') {
  const s = freshSave(env, { onboarded: true });
  const h1 = s.hunters[0]!;
  const h2 = { ...h1, id: hid('h2'), name: 'Sera' };
  return { ...s, settings: { ...s.settings, mode }, hunters: [h1, h2] };
}

describe('claimUniqueClass, releaseUniqueClass, reassignUniqueClass', () => {
  test('enforces one-holder uniqueness with Refused<class-taken> and no GM bypass, stamps registryId and time-qualified grantId, and allows multiple uniques per hunter', () => {
    let s = twoHunterSave();
    const regId = s.classHolders.registryId;
    const ctx = { at: AT, room: room('ABC234'), stamp: STAMP, R: RULES, ...NOT_HELD };

    // Non-unique class refused
    expect(claimUniqueClass(s, 'Fighter', { kind: 'local', hunterId: s.hunters[0]!.id }, ctx)).toEqual({ ok: false, why: 'not-unique' });

    // Local hunter claims Mythic Hemomancer: earned, active, awakened, tagged with registryId and time-qualified grantId
    const c1 = claimUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: s.hunters[0]!.id }, ctx);
    if (isRefused(c1)) throw new Error(c1.why);
    s = c1.save;
    expect(c1.holder.grantId).toMatch(/^cg\d+-[0-9a-z]+$/);
    expect(s.hunters[0]!.job).toBe('Hemomancer');
    expect(s.hunters[0]!.jobDone).toBe('Hemomancer');
    expect(s.hunters[0]!.classes.Hemomancer).toEqual({
      unlockedAt: AT,
      nodes: [],
      registryId: regId,
      grantId: c1.holder.grantId,
    });
    expect(holderOf(s, 'Hemomancer')?.kind).toBe('local');

    // Second claim on Hemomancer is refused class-taken (even for GM direct grant)
    expect(claimUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: s.hunters[1]!.id }, ctx)).toEqual({ ok: false, why: 'class-taken' });
    expect(claimUniqueClass(s, 'Hemomancer', { kind: 'npc', name: 'Blood Lord', monsterId: mid('m1') }, ctx)).toEqual({ ok: false, why: 'class-taken' });

    // Same hunter can also hold an Epic unique class without freeing Hemomancer
    const c2 = claimUniqueClass(s, 'Chronokeeper', { kind: 'local', hunterId: s.hunters[0]!.id }, ctx);
    if (isRefused(c2)) throw new Error(c2.why);
    s = c2.save;
    expect(c2.holder.grantId).not.toBe(c1.holder.grantId);
    expect(classesHeldBy(s, { kind: 'local', hunterId: s.hunters[0]!.id }).sort()).toEqual(['Chronokeeper', 'Hemomancer']);
    expect(Object.keys(s.hunters[0]!.classes).sort()).toEqual(['Chronokeeper', 'Hemomancer']);

    // Swapping away never frees either unique class
    const sw = swapClass(s, s.hunters[0]!.id, 'Hemomancer', { role: 'gm', held: false, at: AT, room: null, stamp: null, activeRegistryId: regId, R: RULES });
    if (isRefused(sw)) throw new Error(sw.why);
    expect(holderOf(sw.save, 'Chronokeeper')?.kind).toBe('local');
    expect(holderOf(sw.save, 'Hemomancer')?.kind).toBe('local');
  });

  test('remote claim posts sealed classGrant, remote release posts sealed classRevoke, and NPC claim stores NPC holder with grantId', () => {
    let s = twoHunterSave();
    const remoteKey = skey('d-pl1:h1');
    const ctx = { at: AT, room: room('ABC234'), stamp: STAMP, R: RULES, ...NOT_HELD };

    const c = claimUniqueClass(s, 'Necromancer', { kind: 'remote', sheetKey: remoteKey, name: 'Jin' }, ctx);
    if (isRefused(c)) throw new Error(c.why);
    s = c.save;
    expect(s.settings.sync.outbox?.some(i => i.letter.kind === 'event' && i.letter.event.type === 'classGrant' && i.letter.event.payload.className === 'Necromancer')).toBe(true);

    const rel = releaseUniqueClass(s, 'Necromancer', { ...ctx, stamp: { ...STAMP, seq: 2 } });
    if (isRefused(rel)) throw new Error(rel.why);
    expect(holderOf(rel.save, 'Necromancer')).toBeNull();
    expect(rel.save.settings.sync.outbox?.some(i => i.letter.kind === 'event' && i.letter.event.type === 'classRevoke' && i.letter.event.payload.className === 'Necromancer')).toBe(true);

    const npc = claimUniqueClass(rel.save, 'Necromancer', { kind: 'npc', name: 'Ashborn' }, ctx);
    if (isRefused(npc)) throw new Error(npc.why);
    expect(holderOf(npc.save, 'Necromancer')).toEqual({ kind: 'npc', name: 'Ashborn', grantId: npc.holder.grantId, claimedAt: AT });
  });

  test('local and remote GM claim, release, and reassign refuse held while an affected hunter is in the fight, and release plus re-grant resets nodes with a fresh grantId', () => {
    let s = twoHunterSave();
    const ctx = { at: AT, room: null, stamp: null, R: RULES, ...NOT_HELD };
    const rk1 = skey('d-pl1:h1'), rk2 = skey('d-pl2:h1');

    // Local claim refused while target is in a fight
    expect(
      claimUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: s.hunters[0]!.id }, { ...ctx, heldLocal: id => id === s.hunters[0]!.id }),
    ).toEqual({ ok: false, why: 'held' });
    // Remote claim refused while remote target is in the GM's fight
    expect(
      claimUniqueClass(s, 'Hemomancer', { kind: 'remote', sheetKey: rk1, name: 'Kai' }, { ...ctx, heldRemote: k => k === rk1 }),
    ).toEqual({ ok: false, why: 'held' });

    const c = claimUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: s.hunters[0]!.id }, ctx);
    if (isRefused(c)) throw new Error(c.why);
    s = {
      ...c.save,
      hunters: [
        { ...c.save.hunters[0]!, classes: { Hemomancer: { ...c.save.hunters[0]!.classes.Hemomancer!, nodes: [nid('root')] } } },
        c.save.hunters[1]!,
      ],
    };

    // Held local hunter: release and reassign refused
    expect(releaseUniqueClass(s, 'Hemomancer', { ...ctx, heldLocal: id => id === s.hunters[0]!.id })).toEqual({ ok: false, why: 'held' });
    expect(
      reassignUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: s.hunters[1]!.id }, { ...ctx, heldLocal: id => id === s.hunters[0]!.id }),
    ).toEqual({ ok: false, why: 'held' });
    expect(
      reassignUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: s.hunters[1]!.id }, { ...ctx, heldLocal: id => id === s.hunters[1]!.id }),
    ).toEqual({ ok: false, why: 'held' });

    // Held remote holder: release and reassign to local or another remote are refused (no duplicate in GM fight)
    const rc = claimUniqueClass(s, 'Necromancer', { kind: 'remote', sheetKey: rk1, name: 'Kai' }, ctx);
    if (isRefused(rc)) throw new Error(rc.why);
    expect(releaseUniqueClass(rc.save, 'Necromancer', { ...ctx, heldRemote: k => k === rk1 })).toEqual({ ok: false, why: 'held' });
    expect(
      reassignUniqueClass(rc.save, 'Necromancer', { kind: 'local', hunterId: s.hunters[1]!.id }, { ...ctx, heldRemote: k => k === rk1 }),
    ).toEqual({ ok: false, why: 'held' });
    expect(
      reassignUniqueClass(rc.save, 'Necromancer', { kind: 'remote', sheetKey: rk2, name: 'Mira' }, { ...ctx, heldRemote: k => k === rk2 }),
    ).toEqual({ ok: false, why: 'held' });

    // Out of fight: release drops class + nodes immediately with no refund
    const rel = releaseUniqueClass(s, 'Hemomancer', ctx);
    if (isRefused(rel)) throw new Error(rel.why);
    expect(holderOf(rel.save, 'Hemomancer')).toBeNull();
    expect(rel.save.hunters[0]!.classes.Hemomancer).toBeUndefined();
    expect(rel.save.hunters[0]!.job).toBeNull();

    // Re-grant (even if seq were reset by backup restore, later timestamp makes grantId distinct) starts with an empty tree
    const regrant = claimUniqueClass({ ...rel.save, seq: s.seq - 1 }, 'Hemomancer', { kind: 'local', hunterId: s.hunters[0]!.id }, { ...ctx, at: AT_LATER });
    if (isRefused(regrant)) throw new Error(regrant.why);
    expect(regrant.holder.grantId).not.toBe(c.holder.grantId);
    expect(regrant.save.hunters[0]!.classes.Hemomancer?.nodes).toEqual([]);
  });

  test('local claim and reassign refuse foreign-class to protect parked foreign-campaign nodes, and release succeeds after removeHunter', () => {
    let s = twoHunterSave();
    const ctx = { at: AT, room: null, stamp: null, R: RULES, ...NOT_HELD };
    // h2 holds parked Hemomancer from another campaign
    const foreign = earnClass(s.hunters[1]!, 'Hemomancer', { at: AT, registryId: 'reg-other', grantId: 'cg-ext', R: RULES });
    if (isRefused(foreign)) throw new Error(foreign.why);
    const foreignWithNode = { ...foreign, classes: { Hemomancer: { ...foreign.classes.Hemomancer!, nodes: [nid('root')] } } };
    s = { ...s, hunters: [s.hunters[0]!, foreignWithNode] };

    expect(claimUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: foreignWithNode.id }, ctx)).toEqual({ ok: false, why: 'foreign-class' });
    // Claim onto h1, then reassign onto h2 -> refused foreign-class without mutating h1 or h2
    const c1 = claimUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: s.hunters[0]!.id }, ctx);
    if (isRefused(c1)) throw new Error(c1.why);
    expect(reassignUniqueClass(c1.save, 'Hemomancer', { kind: 'local', hunterId: foreignWithNode.id }, ctx)).toEqual({ ok: false, why: 'foreign-class' });
    expect(c1.save.hunters[1]!.classes.Hemomancer?.nodes).toEqual([nid('root')]);

    // Deleting h1 keeps Hemomancer held until GM explicitly releases it (t135u), and release succeeds cleanly
    const afterRemove = removeHunter(c1.save, s.hunters[0]!.id, null);
    if (isRefused(afterRemove)) throw new Error(afterRemove.why);
    expect(holderOf(afterRemove, 'Hemomancer')?.kind).toBe('local');
    const rel = releaseUniqueClass(afterRemove, 'Hemomancer', ctx);
    if (isRefused(rel)) throw new Error(rel.why);
    expect(holderOf(rel.save, 'Hemomancer')).toBeNull();
  });

  test('reassignUniqueClass moves ownership in one atomic step and leaves save untouched on refusal', () => {
    let s = twoHunterSave();
    const ctx = { at: AT, room: room('ABC234'), stamp: STAMP, R: RULES, ...NOT_HELD };
    const c = claimUniqueClass(s, 'Starforger', { kind: 'local', hunterId: s.hunters[0]!.id }, ctx);
    if (isRefused(c)) throw new Error(c.why);
    s = c.save;

    // Refuses same-holder
    expect(reassignUniqueClass(s, 'Starforger', { kind: 'local', hunterId: s.hunters[0]!.id }, ctx)).toEqual({ ok: false, why: 'same-holder' });

    // Refuses locker-full on target WITHOUT revoking old holder
    let fullH2 = s.hunters[1]!;
    for (let i = 0; i < CLASS_LOCKER_CAP; i++) {
      const e = earnClass(fullH2, `C${i}`, { at: AT, R: RULES });
      if (isRefused(e)) throw new Error(e.why);
      fullH2 = e;
    }
    const fullSave = { ...s, hunters: [s.hunters[0]!, fullH2] };
    expect(reassignUniqueClass(fullSave, 'Starforger', { kind: 'local', hunterId: fullH2.id }, ctx)).toEqual({ ok: false, why: 'locker-full' });
    expect(holderOf(fullSave, 'Starforger')?.kind).toBe('local');
    expect(fullSave.hunters[0]!.classes.Starforger).toBeDefined();

    // Valid atomic reassign h1 -> h2
    const moved = reassignUniqueClass(s, 'Starforger', { kind: 'local', hunterId: s.hunters[1]!.id }, ctx);
    if (isRefused(moved)) throw new Error(moved.why);
    expect(moved.save.hunters[0]!.classes.Starforger).toBeUndefined();
    expect(moved.save.hunters[0]!.job).toBeNull();
    expect(moved.save.hunters[1]!.classes.Starforger).toBeDefined();
    expect(moved.save.hunters[1]!.job).toBe('Starforger');
    expect(moved.save.hunters[1]!.jobDone).toBe('Starforger');
    expect(holderOf(moved.save, 'Starforger')).toMatchObject({ kind: 'local', hunterId: s.hunters[1]!.id, grantId: moved.to.grantId });
  });

  test('level-triggered reconcileLocalUniqueClasses handles absent doc, mid-fight skip, grant, reset, revoke, foreign park, free restore, and foreign collision protection', () => {
    const playerEnv = { ...env, newDeviceId: () => dev('d-pl1') };
    let ps = freshSave(playerEnv, { onboarded: true });
    let h = ps.hunters[0]!;
    // Seed:
    // - Hemomancer from reg-1 (will be revoked in reg-1)
    // - Chronokeeper from reg-1 grantId cg1 with bought node (will be re-granted with cg9 -> reset!)
    // - Starforger from reg-other with bought node (foreign campaign -> parked, nodes kept!)
    // - Fighter (non-unique, untouched)
    const e1 = earnClass(h, 'Hemomancer', { at: AT, registryId: 'reg-1', grantId: 'cg0', R: RULES });
    if (isRefused(e1)) throw new Error(e1.why);
    const e2 = earnClass(e1, 'Chronokeeper', { at: AT, registryId: 'reg-1', grantId: 'cg1', R: RULES });
    if (isRefused(e2)) throw new Error(e2.why);
    const e3 = earnClass(e2, 'Fighter', { at: AT, R: RULES });
    if (isRefused(e3)) throw new Error(e3.why);
    const e4 = earnClass(e3, 'Starforger', { at: AT, registryId: 'reg-other', grantId: 'cg5', R: RULES });
    if (isRefused(e4)) throw new Error(e4.why);
    h = {
      ...e4,
      classes: {
        ...e4.classes,
        Chronokeeper: { ...e4.classes.Chronokeeper!, nodes: [nid('root')] },
        Starforger: { ...e4.classes.Starforger!, nodes: [nid('root')] },
      },
    };
    ps = { ...ps, hunters: [h] };
    const myKey = sheetKeyOf(ps.settings.deviceId, h.id);

    // 1. Absent doc (unproven viewer poll) leaves everything untouched with identical save reference
    const rNull = reconcileLocalUniqueClasses(ps, null, { isHeld: () => false, R: RULES });
    expect(rNull.save).toBe(ps);

    const doc = {
      registryId: 'reg-1',
      at: AT,
      held: {
        Chronokeeper: { who: myKey, grantId: 'cg9' },
        Necromancer: { who: myKey, grantId: 'cg10' },
        // GM reg-1 also tries to grant Starforger, which hunter already holds from reg-other -> must be blocked to protect nodes!
        Starforger: { who: myKey, grantId: 'cg11' },
      },
    };

    // 2. While held in a fight, skip BOTH grants and revokes (zero writes on mid-fight polls)
    const rHeld = reconcileLocalUniqueClasses(ps, doc, { isHeld: () => true, R: RULES });
    expect(rHeld.save).toBe(ps);
    expect(rHeld.granted).toEqual([]);
    expect(rHeld.reset).toEqual([]);
    expect(rHeld.revoked).toEqual([]);
    expect(rHeld.parked).toEqual([]);

    // 3. When fight closes, converge in one pass
    const r = reconcileLocalUniqueClasses(ps, doc, { isHeld: () => false, R: RULES });
    expect(r.revoked).toEqual(['Hemomancer']);
    expect(r.reset).toEqual(['Chronokeeper']);
    expect(r.blockedForeign).toEqual(['Starforger']);
    expect(r.granted).toEqual(['Necromancer']);
    const after = r.save.hunters[0]!;
    expect(after.classes.Hemomancer).toBeUndefined();
    expect(after.classes.Chronokeeper).toEqual({ unlockedAt: AT, nodes: [], registryId: 'reg-1', grantId: 'cg9' });
    // Starforger's foreign nodes from reg-other were NOT wiped!
    expect(after.classes.Starforger).toEqual({ unlockedAt: AT, nodes: [nid('root')], registryId: 'reg-other', grantId: 'cg5' });
    expect(after.classes.Necromancer).toEqual({ unlockedAt: AT, nodes: [], registryId: 'reg-1', grantId: 'cg10' });
    expect(after.classes.Fighter).toBeDefined();

    // 4. Re-running reconcile on the converged save is a strict no-op (identical save ref -> zero writes on idle polls)
    const rIdle = reconcileLocalUniqueClasses(r.save, doc, { isHeld: () => false, R: RULES });
    expect(rIdle.save).toBe(r.save);

    // 5. Park Starforger when visiting reg-2 (without reg-2 granting Starforger), then return to reg-other -> free restore!
    const homeStar = { ...ps, hunters: [{ ...h, job: 'Starforger', jobDone: 'Starforger', classes: { Starforger: h.classes.Starforger! } }] };
    const parkedInReg2 = reconcileLocalUniqueClasses(homeStar, { registryId: 'reg-2', at: AT, held: {} }, { isHeld: () => false, R: RULES });
    expect(parkedInReg2.parked).toEqual(['Starforger']);
    expect(parkedInReg2.save.hunters[0]!.job).toBeNull();
    expect(parkedInReg2.save.hunters[0]!.classes.Starforger?.nodes).toEqual([nid('root')]);

    // Returning to reg-other reactivates Starforger for free without resetting nodes
    const restored = reconcileLocalUniqueClasses(
      parkedInReg2.save,
      { registryId: 'reg-other', at: AT, held: { Starforger: { who: myKey, grantId: 'cg5' } } },
      { isHeld: () => false, R: RULES },
    );
    expect(restored.restored).toEqual(['Starforger']);
    expect(restored.save.hunters[0]!.job).toBe('Starforger');
    expect(restored.save.hunters[0]!.jobDone).toBe('Starforger');
    expect(restored.save.hunters[0]!.classes.Starforger?.nodes).toEqual([nid('root')]);
    // Subsequent poll is a strict no-op
    expect(
      reconcileLocalUniqueClasses(
        restored.save,
        { registryId: 'reg-other', at: AT, held: { Starforger: { who: myKey, grantId: 'cg5' } } },
        { isHeld: () => false, R: RULES },
      ).save,
    ).toBe(restored.save);
  });

  test('GM-mode parseSave prunes unbacked local uniques, parks foreign uniques, fails orphan chain quests, and player-mode parseSave never prunes uniques', () => {
    const gmSave = twoHunterSave('gm');
    const regId = gmSave.classHolders.registryId;
    const ctx = { at: AT, room: null, stamp: null, R: RULES, ...NOT_HELD };
    const c1 = claimUniqueClass(gmSave, 'Hemomancer', { kind: 'local', hunterId: gmSave.hunters[0]!.id }, ctx);
    if (isRefused(c1)) throw new Error(c1.why);
    // Inject an unbacked same-registry Hemomancer + a foreign-registry Starforger + an orphan active legacy Necromancer chain quest onto h2
    const dup1 = earnClass(c1.save.hunters[1]!, 'Hemomancer', { at: AT, registryId: regId, grantId: 'cg99', R: RULES });
    if (isRefused(dup1)) throw new Error(dup1.why);
    const dup2 = earnClass(dup1, 'Starforger', { at: AT, registryId: 'reg-other', grantId: 'cg1', R: RULES });
    if (isRefused(dup2)) throw new Error(dup2.why);
    const withOrphanQuest = {
      ...dup2,
      jobChain: { id: 'jc1', job: 'Necromancer', step: 1, status: 'active', questId: qid('q888') },
      quests: [
        ...dup2.quests,
        {
          id: qid('q888'),
          kind: 'job',
          title: 'Necromancer Step 1',
          desc: '',
          objectives: [{ label: 'Trial', target: 1, progress: 0 }],
          rewards: { xp: 0, gold: 0, crystal: 0, points: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
          onFail: { xp: 0, gold: 0, crystal: 0, points: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
          status: 'active',
          issuedAt: AT,
          doneAt: null,
          dueAt: null,
          from: 'gm',
          penaltyText: '',
          secret: false,
          chainId: 'jc1',
        },
      ],
    };
    const dirtyGm = { ...c1.save, hunters: [c1.save.hunters[0]!, withOrphanQuest] };

    const parsedGm = parseSave(JSON.stringify(dirtyGm), env);
    expect(parsedGm.kind).toBe('save');
    if (parsedGm.kind === 'save') {
      // h1 keeps its backed Hemomancer
      expect(parsedGm.save.hunters[0]!.classes.Hemomancer).toBeDefined();
      // h2 loses its unbacked Hemomancer, has foreign Starforger parked, and its orphaned legacy Necromancer chain quest is failed
      expect(parsedGm.save.hunters[1]!.classes.Hemomancer).toBeUndefined();
      expect(parsedGm.save.hunters[1]!.classes.Starforger).toBeDefined();
      expect(parsedGm.save.hunters[1]!.job).toBeNull();
      expect(parsedGm.save.hunters[1]!.jobDone).toBeNull();
      expect(parsedGm.save.hunters[1]!.jobChain).toBeNull();
      expect(parsedGm.save.hunters[1]!.quests.find(q => q.id === qid('q888'))?.status).toBe('failed');
    }

    // Player-mode save has empty classHolders.held; parseSave must NEVER wipe the player's uniques on reload
    const plBase = freshSave(env, { onboarded: true });
    const plEarned = earnClass(plBase.hunters[0]!, 'Hemomancer', { at: AT, registryId: 'reg-room', grantId: 'cg3', R: RULES });
    if (isRefused(plEarned)) throw new Error(plEarned.why);
    const plSave = { ...plBase, settings: { ...plBase.settings, mode: 'player' as const }, hunters: [plEarned] };
    const parsedPl = parseSave(JSON.stringify(plSave), env);
    expect(parsedPl.kind).toBe('save');
    if (parsedPl.kind === 'save') {
      expect(parsedPl.save.hunters[0]!.classes.Hemomancer).toBeDefined();
      expect(parsedPl.save.hunters[0]!.job).toBe('Hemomancer');
    }
  });

  test('Save round-trip preserves classHolders with registryId and grantId, and holdersDocOf maps local/NPC to gm', () => {
    const s = twoHunterSave();
    const ctx = { at: AT, room: null, stamp: null, R: RULES, ...NOT_HELD };
    const c1 = claimUniqueClass(s, 'Hemomancer', { kind: 'local', hunterId: s.hunters[0]!.id }, ctx);
    if (isRefused(c1)) throw new Error(c1.why);
    const c2 = claimUniqueClass(c1.save, 'Chronokeeper', { kind: 'remote', sheetKey: skey('d-pl1:h1'), name: 'Kael' }, ctx);
    if (isRefused(c2)) throw new Error(c2.why);
    const c3 = claimUniqueClass(c2.save, 'Starforger', { kind: 'npc', name: 'Aurelion' }, ctx);
    if (isRefused(c3)) throw new Error(c3.why);

    const doc = holdersDocOf(c3.save, AT);
    expect(doc).toEqual({
      registryId: c3.save.classHolders.registryId,
      at: AT,
      held: {
        Hemomancer: { who: 'gm', grantId: c1.holder.grantId },
        Chronokeeper: { who: skey('d-pl1:h1'), grantId: c2.holder.grantId },
        Starforger: { who: 'gm', grantId: c3.holder.grantId },
      },
    });

    const parsed = parseSave(JSON.stringify(c3.save), env);
    expect(parsed.kind).toBe('save');
    if (parsed.kind === 'save') {
      expect(parsed.save.classHolders).toEqual(c3.save.classHolders);
    }
  });
});
