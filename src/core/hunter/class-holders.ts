// class-holders.ts: sole writer of `Save.classHolders` (besides save.ts default and repair).
// Enforces the one-holder-per-campaign uniqueness rule for all 18 Epic and Mythic classes (with no GM bypass),
// atomic reassignment, level-triggered `DOCS.holders` reconciliation (`registryId` + `grantId`), mid-fight guards
// for both local and remote holders, and pure `releaseNoticeStep` for player `sync.ts` `release()`. Pure.
import { sheetKeyOf } from '../ids.ts';
import type { HunterId, MonsterId, RoomCode, SheetKey } from '../ids.ts';
import type { Rules } from '../rules.ts';
import type { Save } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { newEvent } from '../protocol.ts';
import type { EventStamp, HoldersDoc, HoldersDocEntry } from '../protocol.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { told } from '../session-log.ts';
import { isUniqueClass } from '../registry/jobs.ts';
import type { UniqueClassName } from '../registry/jobs.ts';
import { CLASS_LOCKER_CAP } from '../registry/class-trees.ts';
import { dropClass, earnClass, parkClass } from './classes.ts';
import type { ClassHolder, ClassHolders } from './class-locker.ts';
import { released } from './noticed.ts';

export type { ClassHolder, ClassHolders };

/** Target passed to `claimUniqueClass` and `reassignUniqueClass`. */
export type HolderTarget =
  | { readonly kind: 'local'; readonly hunterId: HunterId }
  | { readonly kind: 'remote'; readonly sheetKey: SheetKey; readonly name: string }
  | { readonly kind: 'npc'; readonly name: string; readonly monsterId?: MonsterId };

/** Context for GM uniqueness mutations (`claimUniqueClass`, `releaseUniqueClass`, `reassignUniqueClass`). */
export type HolderStepCtx = {
  readonly at: string;
  readonly room: RoomCode | null;
  readonly stamp: EventStamp | null;
  readonly R: Rules;
  /** Required: whether a local hunter is currently held by a fight (refuses local claim, release, or reassign while held). */
  readonly heldLocal: (hid: HunterId) => boolean;
  /** Required: whether a remote hunter is currently held by this GM's fight (refuses remote claim, release, or reassign while held). */
  readonly heldRemote: (key: SheetKey) => boolean;
};

/** Outcome of level-triggered reconciliation on a player phone against the GM's `DOCS.holders`. */
export type ReconcileResult = {
  readonly save: Save;
  readonly granted: readonly UniqueClassName[];
  readonly reset: readonly UniqueClassName[];
  readonly revoked: readonly UniqueClassName[];
  readonly parked: readonly UniqueClassName[];
  readonly restored: readonly UniqueClassName[];
  readonly blockedForeign: readonly UniqueClassName[];
};

const HOLDER_NAME_MAX = 60;
const cleanHolderName = (v: unknown): string =>
  (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, HOLDER_NAME_MAX) : '');

const stamp36 = (at: string): string => {
  const t = Date.parse(at);
  return Number.isFinite(t) && t >= 0 ? Math.trunc(t).toString(36) : '0';
};
const makeGrantId = (seq: number, at: string): string => `cg${seq}-${stamp36(at)}`;

const isTargetHeld = (target: HolderTarget | ClassHolder, ctx: HolderStepCtx): boolean =>
  (target.kind === 'local' && ctx.heldLocal(target.hunterId))
  || (target.kind === 'remote' && ctx.heldRemote(target.sheetKey));

/** Returns the current holder of `cls`, or null if unclaimed or not unique. */
export function holderOf(save: Pick<Save, 'classHolders'>, cls: string): ClassHolder | null {
  return isUniqueClass(cls) ? (save.classHolders.held[cls] ?? null) : null;
}

/** Returns every unique class currently held by `who`. */
export function classesHeldBy(
  save: Pick<Save, 'classHolders'>,
  who: { readonly kind: 'local'; readonly hunterId: HunterId } | { readonly kind: 'remote'; readonly sheetKey: SheetKey },
): UniqueClassName[] {
  const out: UniqueClassName[] = [];
  for (const [cls, holder] of Object.entries(save.classHolders.held) as [UniqueClassName, ClassHolder | undefined][]) {
    if (!holder) continue;
    if (who.kind === 'local' && holder.kind === 'local' && holder.hunterId === who.hunterId) out.push(cls);
    if (who.kind === 'remote' && holder.kind === 'remote' && holder.sheetKey === who.sheetKey) out.push(cls);
  }
  return out;
}

const sameHolder = (a: ClassHolder, b: HolderTarget): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'local' && b.kind === 'local') return a.hunterId === b.hunterId;
  if (a.kind === 'remote' && b.kind === 'remote') return a.sheetKey === b.sheetKey;
  if (a.kind === 'npc' && b.kind === 'npc') return cleanHolderName(a.name) === cleanHolderName(b.name);
  return false;
};

function buildHolder(
  save: Save,
  target: HolderTarget,
  at: string,
  grantId: string,
): ClassHolder | Refused<'no-hunter' | 'bad-target'> {
  if (target.kind === 'local') {
    const h = save.hunters.find(x => x.id === target.hunterId);
    if (!h) return refuse('no-hunter');
    return { kind: 'local', hunterId: h.id, name: h.name, grantId, claimedAt: at };
  }
  if (target.kind === 'remote') {
    const name = cleanHolderName(target.name) || 'Hunter';
    return { kind: 'remote', sheetKey: target.sheetKey, name, grantId, claimedAt: at };
  }
  const name = cleanHolderName(target.name);
  if (!name) return refuse('bad-target');
  return { kind: 'npc', name, ...(target.monsterId ? { monsterId: target.monsterId } : {}), grantId, claimedAt: at };
}

function hasForeignEntry(save: Save, hunterId: HunterId, cls: UniqueClassName): boolean {
  const h = save.hunters.find(x => x.id === hunterId);
  if (!h || !Object.hasOwn(h.classes, cls)) return false;
  const entry = h.classes[cls]!;
  return !!entry.registryId && entry.registryId !== save.classHolders.registryId;
}

function applyGrantToSave(
  save: Save,
  cls: UniqueClassName,
  holder: ClassHolder,
  ctx: HolderStepCtx,
  seqOffset = 0,
): Save | Refused<'no-hunter' | 'locker-full' | 'foreign-class'> {
  if (holder.kind === 'local') {
    const idx = save.hunters.findIndex(h => h.id === holder.hunterId);
    if (idx < 0) return refuse('no-hunter');
    if (hasForeignEntry(save, holder.hunterId, cls)) return refuse('foreign-class');
    const earned = earnClass(save.hunters[idx]!, cls, {
      at: ctx.at,
      activate: true,
      awaken: true,
      registryId: save.classHolders.registryId,
      grantId: holder.grantId,
      resetNodes: true,
      R: ctx.R,
    });
    if (isRefused(earned)) return earned;
    return { ...save, hunters: save.hunters.map((x, i) => (i === idx ? earned : x)) };
  }
  if (holder.kind === 'remote' && ctx.room && ctx.stamp) {
    const stamp = seqOffset ? { ...ctx.stamp, seq: (ctx.stamp.seq ?? 0) + seqOffset } : ctx.stamp;
    const ev = newEvent('classGrant', { to: [holder.sheetKey], className: cls, at: ctx.at }, stamp);
    if (ev) return atOutbox(box => post(box, ctx.room!, { kind: 'event', event: ev }, null).box)(save);
  }
  return save;
}

function applyRevokeToSave(
  save: Save,
  cls: UniqueClassName,
  holder: ClassHolder,
  ctx: HolderStepCtx,
  seqOffset = 0,
): Save {
  if (holder.kind === 'local') {
    const idx = save.hunters.findIndex(h => h.id === holder.hunterId);
    if (idx < 0) return save;
    const dropped = dropClass(save.hunters[idx]!, cls, ctx.R);
    return { ...save, hunters: save.hunters.map((x, i) => (i === idx ? dropped : x)) };
  }
  if (holder.kind === 'remote' && ctx.room && ctx.stamp) {
    const stamp = seqOffset ? { ...ctx.stamp, seq: (ctx.stamp.seq ?? 0) + seqOffset } : ctx.stamp;
    const ev = newEvent('classRevoke', { to: [holder.sheetKey], className: cls, at: ctx.at }, stamp);
    if (ev) return atOutbox(box => post(box, ctx.room!, { kind: 'event', event: ev }, null).box)(save);
  }
  return save;
}

/**
 * Claims unique class `cls` for `target` in one atomic save step.
 * Enforces the one-holder-per-campaign rule with `Refused<'class-taken'>` and no GM bypass (the owner t132u).
 * Refuses `'held'` when claiming onto a local or remote hunter currently in the GM's fight, and refuses
 * `'foreign-class'` if a local target already holds parked tree progress for `cls` from another campaign.
 */
export function claimUniqueClass(
  save: Save,
  cls: string,
  target: HolderTarget,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly holder: ClassHolder } | Refused<'not-unique' | 'class-taken' | 'no-hunter' | 'locker-full' | 'bad-target' | 'held' | 'foreign-class'> {
  if (!isUniqueClass(cls)) return refuse('not-unique');
  if (save.classHolders.held[cls]) return refuse('class-taken');
  if (isTargetHeld(target, ctx)) return refuse('held');

  const nextSeq = save.seq + 1;
  const grantId = makeGrantId(nextSeq, ctx.at);
  const holder = buildHolder(save, target, ctx.at, grantId);
  if (isRefused(holder)) return holder;

  const granted = applyGrantToSave({ ...save, seq: nextSeq }, cls, holder, ctx);
  if (isRefused(granted)) return granted;

  const nextHolders: ClassHolders = {
    registryId: granted.classHolders.registryId,
    held: { ...granted.classHolders.held, [cls]: holder },
  };
  const s = told(
    { ...granted, classHolders: nextHolders },
    { at: ctx.at, cap: ctx.R.logCap },
    { kind: 'system', hunterId: holder.kind === 'local' ? holder.hunterId : null, title: 'Unique class claimed', text: `${holder.name} claimed ${cls}.` },
  );
  return { save: s, holder };
}

/**
 * Releases unique class `cls` from its current holder in one atomic save step (no refund).
 * Refuses `'held'` when the current holder (local or remote) is in this GM's fight, preventing two hunters
 * from holding the same unique class during one fight.
 */
export function releaseUniqueClass(
  save: Save,
  cls: string,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly released: ClassHolder } | Refused<'not-unique' | 'not-held' | 'held'> {
  if (!isUniqueClass(cls)) return refuse('not-unique');
  const old = save.classHolders.held[cls];
  if (!old) return refuse('not-held');
  if (isTargetHeld(old, ctx)) return refuse('held');

  const nextHeld: Partial<Record<UniqueClassName, ClassHolder>> = { ...save.classHolders.held };
  delete nextHeld[cls];
  const nextHolders: ClassHolders = { registryId: save.classHolders.registryId, held: nextHeld };

  const afterRevoke = applyRevokeToSave({ ...save, classHolders: nextHolders }, cls, old, ctx);
  const s = told(
    afterRevoke,
    { at: ctx.at, cap: ctx.R.logCap },
    { kind: 'system', hunterId: old.kind === 'local' ? old.hunterId : null, title: 'Unique class released', text: `${cls} was released from ${old.name}.` },
  );
  return { save: s, released: old };
}

/**
 * Reassigns unique class `cls` from its current holder to `nextTarget` in ONE atomic save step.
 * Validates both sides before mutating anything and refuses `'held'` if either affected local or remote hunter
 * is in this GM's fight, or `'foreign-class'` if a local target holds parked progress from another campaign.
 */
export function reassignUniqueClass(
  save: Save,
  cls: string,
  nextTarget: HolderTarget,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly from: ClassHolder; readonly to: ClassHolder } | Refused<'not-unique' | 'not-held' | 'same-holder' | 'no-hunter' | 'locker-full' | 'bad-target' | 'held' | 'foreign-class'> {
  if (!isUniqueClass(cls)) return refuse('not-unique');
  const old = save.classHolders.held[cls];
  if (!old) return refuse('not-held');
  if (sameHolder(old, nextTarget)) return refuse('same-holder');
  if (isTargetHeld(old, ctx) || isTargetHeld(nextTarget, ctx)) return refuse('held');

  const nextSeq = save.seq + 1;
  const grantId = makeGrantId(nextSeq, ctx.at);
  const nextHolder = buildHolder(save, nextTarget, ctx.at, grantId);
  if (isRefused(nextHolder)) return nextHolder;

  if (nextHolder.kind === 'local') {
    const h = save.hunters.find(x => x.id === nextHolder.hunterId);
    if (!h) return refuse('no-hunter');
    if (hasForeignEntry(save, nextHolder.hunterId, cls)) return refuse('foreign-class');
    if (!Object.hasOwn(h.classes, cls) && Object.keys(h.classes).length >= CLASS_LOCKER_CAP) {
      return refuse('locker-full');
    }
  }

  const nextHolders: ClassHolders = {
    registryId: save.classHolders.registryId,
    held: { ...save.classHolders.held, [cls]: nextHolder },
  };
  const afterRevoke = applyRevokeToSave({ ...save, seq: nextSeq, classHolders: nextHolders }, cls, old, ctx, 0);
  const afterGrant = applyGrantToSave(afterRevoke, cls, nextHolder, ctx, 1);
  if (isRefused(afterGrant)) return afterGrant;

  const s = told(
    afterGrant,
    { at: ctx.at, cap: ctx.R.logCap },
    {
      kind: 'system',
      hunterId: nextHolder.kind === 'local' ? nextHolder.hunterId : null,
      title: 'Unique class reassigned',
      text: `${cls} was reassigned from ${old.name} to ${nextHolder.name}.`,
    },
  );
  return { save: s, from: old, to: nextHolder };
}

/** Builds the GM's authoritative `holders` room document from `save.classHolders`. */
export function holdersDocOf(save: Pick<Save, 'classHolders'>, at: string): HoldersDoc {
  const held: Partial<Record<UniqueClassName, HoldersDocEntry>> = {};
  for (const [cls, holder] of Object.entries(save.classHolders.held) as [UniqueClassName, ClassHolder | undefined][]) {
    if (!holder) continue;
    held[cls] = {
      who: holder.kind === 'remote' ? holder.sheetKey : 'gm',
      grantId: holder.grantId,
    };
  }
  return { registryId: save.classHolders.registryId, at, held };
}

/**
 * Level-triggered reconciliation of a player phone's local hunters against the GM's filtered `DOCS.holders`.
 * - Skips any hunter held by a fight (`isHeld`, unified on `fightHold`) for both grants and revokes, returning the
 *   unchanged `save` reference so idle/mid-fight polls perform zero writes.
 * - Pass 1 revokes unbacked same-registry entries (no refund) and parks foreign-registry entries (nodes preserved).
 * - Pass 2 reactivates a previously parked same-registry entry for free when `!h.job` (`restored`), skips granting
 *   over a foreign-campaign entry (`blockedForeign`, protecting parked nodes), resets nodes on a fresh same-registry
 *   `grantId` (`reset`), and grants missing entries (`granted`).
 */
export function reconcileLocalUniqueClasses(
  save: Save,
  doc: HoldersDoc | null,
  opts: { readonly isHeld: (hid: HunterId) => boolean; readonly R: Rules },
): ReconcileResult {
  if (!doc) return { save, granted: [], reset: [], revoked: [], parked: [], restored: [], blockedForeign: [] };
  const granted: UniqueClassName[] = [];
  const reset: UniqueClassName[] = [];
  const revoked: UniqueClassName[] = [];
  const parked: UniqueClassName[] = [];
  const restored: UniqueClassName[] = [];
  const blockedForeign: UniqueClassName[] = [];
  let hunters = save.hunters;
  let changed = false;

  for (let i = 0; i < hunters.length; i++) {
    let h = hunters[i]!;
    if (opts.isHeld(h.id)) continue; // defer both grants and revokes until fight closes

    const key = sheetKeyOf(save.settings.deviceId, h.id);
    const localUniques = Object.keys(h.classes).filter(isUniqueClass);

    // 1. Pass 1: revoke unbacked same-registry uniques and park foreign-campaign uniques first,
    // so parking an active foreign class is never masked by a grant/reset in Pass 2.
    for (const cls of localUniques) {
      const entry = h.classes[cls]!;
      const docEntry = doc.held[cls];
      if (docEntry && docEntry.who === key) continue;
      if (!entry.registryId || entry.registryId === doc.registryId) {
        const dropped = dropClass(h, cls, opts.R);
        if (dropped !== h) {
          h = dropped;
          changed = true;
          revoked.push(cls);
        }
      } else {
        const p = parkClass(h, cls, opts.R);
        if (p !== h) {
          h = p;
          changed = true;
          parked.push(cls);
        }
      }
    }

    // 2. Pass 2: restore parked same-registry uniques for free when `!h.job`, skip foreign collisions,
    // reset nodes on a fresh same-registry `grantId`, and grant missing entries.
    for (const [cls, docEntry] of Object.entries(doc.held) as [UniqueClassName, HoldersDocEntry | undefined][]) {
      if (!docEntry || docEntry.who !== key) continue;
      const existing = Object.hasOwn(h.classes, cls) ? h.classes[cls] : undefined;
      if (existing && existing.registryId && existing.registryId !== doc.registryId) {
        // Protect parked foreign-campaign tree progress: never overwrite with another campaign's grant.
        blockedForeign.push(cls);
        continue;
      }
      if (existing && existing.registryId === doc.registryId && existing.grantId === docEntry.grantId) {
        if (!h.job) {
          const back = earnClass(h, cls, {
            at: doc.at,
            activate: true,
            awaken: true,
            registryId: doc.registryId,
            grantId: docEntry.grantId,
            resetNodes: false,
            R: opts.R,
          });
          if (!isRefused(back)) {
            h = back;
            changed = true;
            restored.push(cls);
          }
        }
        continue;
      }
      const isReset = !!existing && existing.registryId === doc.registryId && existing.grantId !== docEntry.grantId;
      const earned = earnClass(h, cls, {
        at: doc.at,
        activate: isReset ? (h.job === cls || !h.job) : true,
        awaken: true,
        registryId: doc.registryId,
        grantId: docEntry.grantId,
        resetNodes: true,
        R: opts.R,
      });
      if (!isRefused(earned)) {
        h = earned;
        changed = true;
        (isReset ? reset : granted).push(cls);
      }
    }

    if (h !== hunters[i]) {
      hunters = hunters.map((x, idx) => (idx === i ? h : x));
    }
  }

  return { save: changed ? { ...save, hunters } : save, granted, reset, revoked, parked, restored, blockedForeign };
}

/**
 * Pure release step for a player phone (`sync.ts` `release()`): flushes waiting chronicle facts (`released`)
 * and reconciles local unique classes against the GM's `DOCS.holders` in one save step.
 * Passes `refuse('unchanged')` through whenever neither part changes `save`, ensuring zero save writes on
 * mid-fight or idle polls (including when a held hunter has a waiting chronicle inbox).
 */
export function releaseNoticeStep(
  save: Save,
  holders: HoldersDoc | null,
  hasInbox: boolean,
  isHeld: (s: Save, hid: HunterId) => boolean,
  R: Rules,
): { readonly save: Save; readonly diff: ReconcileResult | null } | Refused<'unchanged'> {
  const r = hasInbox ? released(save, isHeld) : null;
  const inboxReady = r !== null && !isRefused(r);
  const base: Save = inboxReady ? r : save;
  const recon = holders ? reconcileLocalUniqueClasses(base, holders, { isHeld: hid => isHeld(base, hid), R }) : null;
  const next: Save = recon ? recon.save : base;
  if (!inboxReady && next === save) return refuse('unchanged');
  return { save: next, diff: recon && recon.save !== base ? recon : null };
}
