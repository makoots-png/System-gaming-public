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
import type { ClassGrantRefusal, ClassGrantRefusedPayload, EventStamp, HoldersDoc, HoldersDocEntry } from '../protocol.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { told } from '../session-log.ts';
import { isUniqueClass } from '../registry/jobs.ts';
import type { UniqueClassName } from '../registry/jobs.ts';
import { CLASS_LOCKER_CAP } from '../registry/class-trees.ts';
import { dropClass, earnClass, parkClass } from './classes.ts';
import type { ClassHolder, ClassHolders } from './class-locker.ts';

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
  /** The grants of the doc this phone could not take, each with why, for its report to the GM (noticed.ts `releaseNoticeStep`). */
  readonly refused: readonly GrantNotTaken[];
};
/** A grant of the holders doc a hunter of this phone could not take (statechart rule 4). */
export type GrantNotTaken = { readonly hid: HunterId; readonly className: UniqueClassName; readonly grantId: string; readonly why: ClassGrantRefusal };

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
): Save | Refused<'no-hunter' | 'dead' | 'locker-full' | 'foreign-class'> {
  if (holder.kind === 'local') {
    const idx = save.hunters.findIndex(h => h.id === holder.hunterId);
    if (idx < 0) return refuse('no-hunter');
    // a downed hunter's class does not change (statechart rule 2): every local grant comes through here
    if (save.hunters[idx]!.life.at === 'dead') return refuse('dead');
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
 * Refuses `'held'` when claiming onto a local or remote hunter currently in the GM's fight, `'dead'` onto a downed
 * local hunter, and `'foreign-class'` if a local target already holds parked tree progress for `cls` from another campaign.
 */
export function claimUniqueClass(
  save: Save,
  cls: string,
  target: HolderTarget,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly holder: ClassHolder } | Refused<'not-unique' | 'class-taken' | 'no-hunter' | 'dead' | 'locker-full' | 'bad-target' | 'held' | 'foreign-class'> {
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
 * is in this GM's fight, `'dead'` onto a downed local hunter, or `'foreign-class'` if a local target holds parked
 * progress from another campaign. A downed holder may still be released or reassigned away from.
 */
export function reassignUniqueClass(
  save: Save,
  cls: string,
  nextTarget: HolderTarget,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly from: ClassHolder; readonly to: ClassHolder } | Refused<'not-unique' | 'not-held' | 'same-holder' | 'no-hunter' | 'dead' | 'locker-full' | 'bad-target' | 'held' | 'foreign-class'> {
  if (!isUniqueClass(cls)) return refuse('not-unique');
  const old = save.classHolders.held[cls];
  if (!old) return refuse('not-held');
  if (isTargetHeld(old, ctx)) return refuse('held');
  if (sameHolder(old, nextTarget)) return refuse('same-holder');
  if (isTargetHeld(nextTarget, ctx)) return refuse('held');

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

/**
 * Builds the GM's authoritative `holders` room document from `save.classHolders`. A player holder the GM's fight holds
 * (`heldRemote`, sync.ts passes `fightHold`) is marked `wait`, so its phone changes none of that hunter's classes while
 * the fight lasts, whichever of the holders and fight docs reaches it first (statechart rule 6).
 */
export function holdersDocOf(save: Pick<Save, 'classHolders'>, at: string, heldRemote: (key: SheetKey) => boolean = () => false): HoldersDoc {
  const held: Partial<Record<UniqueClassName, HoldersDocEntry>> = {};
  for (const [cls, holder] of Object.entries(save.classHolders.held) as [UniqueClassName, ClassHolder | undefined][]) {
    if (!holder) continue;
    held[cls] = holder.kind === 'remote'
      ? { who: holder.sheetKey, grantId: holder.grantId, ...(heldRemote(holder.sheetKey) ? { wait: true as const } : {}) }
      : { who: 'gm', grantId: holder.grantId };
  }
  return { registryId: save.classHolders.registryId, at, held };
}

/**
 * Level-triggered reconciliation of a player phone's local hunters against the GM's filtered `DOCS.holders`.
 * - Skips any hunter held by a fight (`isHeld`, unified on `fightHold`, or an entry of the doc marked `wait`) for both
 *   grants and revokes, returning the unchanged `save` reference so idle/mid-fight polls perform zero writes.
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
  if (!doc) return { save, granted: [], reset: [], revoked: [], parked: [], restored: [], blockedForeign: [], refused: [] };
  const granted: UniqueClassName[] = [];
  const reset: UniqueClassName[] = [];
  const revoked: UniqueClassName[] = [];
  const parked: UniqueClassName[] = [];
  const restored: UniqueClassName[] = [];
  const blockedForeign: UniqueClassName[] = [];
  const refused: GrantNotTaken[] = [];
  let hunters = save.hunters;
  let changed = false;

  for (let i = 0; i < hunters.length; i++) {
    let h = hunters[i]!;
    if (opts.isHeld(h.id)) continue; // defer both grants and revokes until fight closes

    const key = sheetKeyOf(save.settings.deviceId, h.id);
    // the GM's doc says its fight holds this hunter (`wait`), whatever this phone has heard of the fight yet
    if (Object.values(doc.held).some(e => e?.who === key && e.wait)) continue;
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
    // reset nodes on a fresh same-registry `grantId`, and grant missing entries. A downed hunter takes no class
    // (statechart rule 2): its grants wait for the revive.
    for (const [cls, docEntry] of Object.entries(doc.held) as [UniqueClassName, HoldersDocEntry | undefined][]) {
      if (!docEntry || docEntry.who !== key || h.life.at === 'dead') continue;
      const existing = Object.hasOwn(h.classes, cls) ? h.classes[cls] : undefined;
      if (existing && existing.registryId && existing.registryId !== doc.registryId) {
        // Protect parked foreign-campaign tree progress: never overwrite with another campaign's grant.
        blockedForeign.push(cls);
        refused.push({ hid: h.id, className: cls, grantId: docEntry.grantId, why: 'foreign-class' });
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
      } else if (earned.why === 'locker-full') {
        refused.push({ hid: h.id, className: cls, grantId: docEntry.grantId, why: 'locker-full' });
      }
    }

    if (h !== hunters[i]) {
      hunters = hunters.map((x, idx) => (idx === i ? h : x));
    }
  }

  return { save: changed ? { ...save, hunters } : save, granted, reset, revoked, parked, restored, blockedForeign, refused };
}

/**
 * The GM's phone hears that hunter `p.by` could not take unique class `p.className` of grant `p.grantId`
 * (`classGrantRefused`, statechart rule 4): when the registry still names that hunter under that grant, the hold is
 * removed, a `classRevoke` posted and the log says so, in one step. A report of an older grant or of another hunter
 * is refused (`stale`). No fight check: the phone never took the class, so no fight row has it.
 */
export function grantRefused(
  save: Save,
  p: Pick<ClassGrantRefusedPayload, 'by' | 'className' | 'grantId' | 'why'>,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly released: ClassHolder } | Refused<'stale'> {
  const old = save.classHolders.held[p.className];
  if (!old || old.kind !== 'remote' || old.sheetKey !== p.by || old.grantId !== p.grantId) return refuse('stale');
  const held: Partial<Record<UniqueClassName, ClassHolder>> = { ...save.classHolders.held };
  delete held[p.className];
  const afterRevoke = applyRevokeToSave({ ...save, classHolders: { registryId: save.classHolders.registryId, held } }, p.className, old, ctx);
  const s = told(
    afterRevoke,
    { at: ctx.at, cap: ctx.R.logCap },
    { kind: 'system', hunterId: null, title: 'Unique class not taken', text: grantRefusedLine(old.name, p.className, p.why) },
  );
  return { save: s, released: old };
}

/** Why a hunter could not take a unique class, said to the GM (`grantRefusedLine`) and on the hunter's phone (`grantNotTakenLine`). */
const GRANT_REFUSED_WHY: Readonly<Record<ClassGrantRefusal, { readonly gm: (cls: string) => string; readonly mine: (cls: string) => string }>> = {
  'foreign-class': {
    gm: cls => `They already have parked progress for ${cls} from another campaign.`,
    mine: cls => `${cls} was not replaced because you already have parked progress for it from another campaign.`,
  },
  'locker-full': {
    gm: () => `Their class locker is full (${CLASS_LOCKER_CAP} classes).`,
    mine: cls => `${cls} was not added because your class locker is full (${CLASS_LOCKER_CAP} classes).`,
  },
};
/** The GM's log line and toast when hunter `name` could not take `cls`. */
export const grantRefusedLine = (name: string, cls: string, why: ClassGrantRefusal): string =>
  `${name || 'A hunter'} could not take ${cls}. ${GRANT_REFUSED_WHY[why].gm(cls)} ${cls} is open again.`;
/** The toast on the hunter's own phone when it could not take `cls`. */
export const grantNotTakenLine = (cls: string, why: ClassGrantRefusal): string => GRANT_REFUSED_WHY[why].mine(cls);

/** Plain-English refusal messages for GM unique-class claim, release, and reassign actions (voice.md compliant). */
export const HOLDER_REFUSAL_WORDS = {
  'not-unique': 'That class is not a unique class.',
  'class-taken': 'Another hunter or NPC already holds that unique class. Release or reassign it first.',
  'not-held': 'Nobody holds that unique class.',
  'same-holder': 'That hunter or NPC already holds that unique class.',
  'no-hunter': 'Hunter not found.',
  'locker-full': `That hunter's class locker is full (${CLASS_LOCKER_CAP} classes).`,
  'bad-target': 'Enter an NPC name or select a hunter.',
  held: 'You cannot change a unique class while its hunter is in a fight.',
  dead: 'That hunter is down. Revive them before giving them a unique class.',
  'foreign-class': 'That hunter already has parked progress for this class from another campaign.',
} as const;
