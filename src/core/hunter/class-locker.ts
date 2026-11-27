// class-locker.ts: leaf types, 3-state active pointer reader, and parsers for `Hunter.classes` and `Save.classHolders`.
// Sits below `hunter.ts`, `save.ts`, and `protocol.ts` so `save.ts` never pulls `protocol.ts`, `outbox.ts`, `classes.ts`,
// or `sheet.ts` underneath it, and `registry/class-trees.ts` stays pure static tables. Pure.
import { timeOf } from '../day.ts';
import { parseClassNodeId, parseRoomCode, parseSaveId, parseSheetKey } from '../ids.ts';
import type { ClassNodeId, HunterId, MonsterId, RoomCode, SheetKey } from '../ids.ts';
import { isObj } from '../repair.ts';
import { canonicalUniqueClass, isUniqueClass } from '../registry/jobs.ts';
import type { UniqueClassName } from '../registry/jobs.ts';
import { CLASS_LOCKER_CAP, CLASS_TREES, classTreeOf, repairNodes } from '../registry/class-trees.ts';
import type { ClassTreeMap } from '../registry/class-trees.ts';
import { parseBloodVessels } from './blood-vessels.ts';
import type { BloodVessel } from './blood-vessels.ts';

/** Shared maximum length of a class or job name across locker parsing, `jobOf`, and wire events. */
export const CLASS_NAME_MAX = 60;
const HOLDER_NAME_MAX = 60;
const TOKEN_ID_RE = /^[\w-]{1,40}$/;

/** Validates a campaign registry id (1 to 40 word/hyphen characters). */
export const parseRegistryId = (v: unknown): string | null =>
  (typeof v === 'string' && TOKEN_ID_RE.test(v) ? v : null);

/** Validates a per-claim unique-class grant id (1 to 40 word/hyphen characters). */
export const parseGrantId = (v: unknown): string | null =>
  (typeof v === 'string' && TOKEN_ID_RE.test(v) ? v : null);

/** One earned class entry stored on `Hunter.classes`. */
export type ClassEntry = {
  readonly unlockedAt: string;
  /** Bought node ids in purchase order. */
  readonly nodes: readonly ClassNodeId[];
  /** Campaign registry id that granted this unique class, if any (used to park foreign-campaign uniques). */
  readonly registryId?: string;
  /** Unique id of this grant, so release plus re-grant to the same hunter resets tree nodes cleanly. */
  readonly grantId?: string;
  /** Extracted Crimson Vessels stored on this class entry (at most `VESSEL_CAP` = 3). Absent when empty. */
  readonly vessels?: readonly BloodVessel[];
};

/** A hunter's locker of every earned class, keyed by class name. */
export type ClassLocker = Readonly<Record<string, ClassEntry>>;

/** Canonical 3-state view of a hunter's active class pointer (`job`, `jobDone`, and `classes`). */
export type ActiveClass =
  | { readonly kind: 'none' }
  | { readonly kind: 'label'; readonly name: string }
  | { readonly kind: 'earned'; readonly name: string; readonly entry: ClassEntry };

/**
 * The single reader of a hunter's active class state:
 * - `none`: no active job (`job === null`).
 * - `earned`: `job` names an earned entry in `classes` with `jobDone === job`.
 * - `label`: pre-chain starter or custom GM text label outside `classes` (`jobDone === null`).
 */
export function activeClass(h: { readonly job: string | null; readonly jobDone: string | null; readonly classes: ClassLocker }): ActiveClass {
  if (!h.job) return { kind: 'none' };
  if (h.jobDone === h.job && Object.hasOwn(h.classes, h.job)) {
    return { kind: 'earned', name: h.job, entry: h.classes[h.job]! };
  }
  return { kind: 'label', name: h.job };
}

/**
 * Parses and repairs `Hunter.classes` together with the active `job` and `jobDone` pointers.
 * - Caps the locker at `CLASS_LOCKER_CAP` (48).
 * - Never auto-claims a unique built-in class when absent from `raw`, clearing any un-held unique `job` / `jobDone` to `null`.
 * - Repairs `jobDone` to `job && Object.hasOwn(classes, job) ? job : null`.
 */
export function parseClasses(
  raw: unknown,
  opts: {
    readonly job: string | null;
    readonly fallbackAt: string;
    readonly trees?: ClassTreeMap;
  },
): { readonly classes: ClassLocker; readonly job: string | null; readonly jobDone: string | null } {
  const trees = opts.trees ?? CLASS_TREES;
  const out: Record<string, ClassEntry> = {};

  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (Object.keys(out).length >= CLASS_LOCKER_CAP) break;
      const name = k.trim().slice(0, CLASS_NAME_MAX);
      if (!name || name === '__proto__' || name === 'constructor' || name === 'prototype') continue;
      if (!isObj(v)) continue;
      const unlockedAt = timeOf(v.unlockedAt) ?? opts.fallbackAt;
      const tree = classTreeOf(name, trees);
      let nodes: ClassNodeId[] = [];
      if (Array.isArray(v.nodes)) {
        const parsed: ClassNodeId[] = [];
        for (const item of v.nodes) {
          const nid = parseClassNodeId(item);
          if (nid) parsed.push(nid);
        }
        nodes = repairNodes(tree, parsed);
      }
      const registryId = parseRegistryId(v.registryId);
      const grantId = parseGrantId(v.grantId);
      const vessels = parseBloodVessels(v.vessels, unlockedAt);
      out[name] = {
        unlockedAt,
        nodes,
        ...(registryId ? { registryId } : {}),
        ...(grantId ? { grantId } : {}),
        ...(vessels ? { vessels } : {}),
      };
    }
  }

  let job = opts.job;

  // Unique class strings never auto-claim into `classes` when un-held.
  if (job && canonicalUniqueClass(job) !== null) {
    const canon = canonicalUniqueClass(job)!;
    job = Object.hasOwn(out, canon) ? canon : null;
  }

  // Repair invariant: `jobDone` is `job` iff `job` names an earned locker entry; else `null`.
  const jobDone = job && Object.hasOwn(out, job) ? job : null;

  return { classes: out, job, jobDone };
}

/** Who holds one unique Epic or Mythic class in a campaign save. */
export type ClassHolder =
  | { readonly kind: 'local'; readonly hunterId: HunterId; readonly name: string; readonly grantId: string; readonly claimedAt: string }
  | { readonly kind: 'remote'; readonly sheetKey: SheetKey; readonly name: string; readonly grantId: string; readonly claimedAt: string }
  | { readonly kind: 'npc'; readonly name: string; readonly monsterId?: MonsterId; readonly grantId: string; readonly claimedAt: string };

/** Campaign registry of claimed unique classes, scoped by `registryId` so foreign-campaign uniques are parked, not wiped. */
export type ClassHolders = {
  readonly registryId: string;
  readonly held: Readonly<Partial<Record<UniqueClassName, ClassHolder>>>;
};

export const newClassHolders = (registryId: string): ClassHolders => ({ registryId, held: {} });

const cleanHolderName = (v: unknown): string =>
  (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, HOLDER_NAME_MAX) : '');

/** Parses and repairs `Save.classHolders` from stored JSON. */
export function parseClassHolders(raw: unknown, fallbackAt: string, fallbackRegistryId: string): ClassHolders {
  const safeReg = parseRegistryId(fallbackRegistryId) ?? 'reg-default';
  if (!isObj(raw)) return newClassHolders(safeReg);
  const registryId = parseRegistryId(raw.registryId) ?? safeReg;
  if (!isObj(raw.held)) return newClassHolders(registryId);
  const held: Partial<Record<UniqueClassName, ClassHolder>> = {};
  for (const [k, v] of Object.entries(raw.held)) {
    if (!isUniqueClass(k) || !isObj(v)) continue;
    const claimedAt = timeOf(v.claimedAt) ?? fallbackAt;
    const grantId = parseGrantId(v.grantId) ?? `g-${k.toLowerCase()}`;
    if (v.kind === 'local') {
      const hunterId = parseSaveId<'h'>(v.hunterId);
      const name = cleanHolderName(v.name) || 'Hunter';
      if (hunterId) held[k] = { kind: 'local', hunterId, name, grantId, claimedAt };
    } else if (v.kind === 'remote') {
      const sheetKey = parseSheetKey(v.sheetKey);
      const name = cleanHolderName(v.name) || 'Hunter';
      if (sheetKey) held[k] = { kind: 'remote', sheetKey, name, grantId, claimedAt };
    } else if (v.kind === 'npc') {
      const name = cleanHolderName(v.name);
      const monsterId = v.monsterId === undefined ? null : parseSaveId<'m'>(v.monsterId);
      if (name) held[k] = { kind: 'npc', name, ...(monsterId ? { monsterId } : {}), grantId, claimedAt };
    }
  }
  return { registryId, held };
}

/**
 * Computes GM-mode repair for a local hunter's unique class entries against `holders`:
 * - Entries backed by `holders.held[cls]` (`kind === 'local'` for `h.id`) stay intact.
 * - Unbacked entries with no `registryId` or matching `holders.registryId` are dropped (prevents imported duplicate uniques).
 * - Unbacked entries carrying a different campaign's `registryId` are parked (nodes preserved, active pointer cleared if active).
 */
export function gmBackedClasses(
  h: { readonly id: HunterId; readonly job: string | null; readonly jobDone: string | null; readonly classes: ClassLocker },
  holders: ClassHolders,
): { readonly classes: ClassLocker; readonly job: string | null; readonly jobDone: string | null; readonly changed: boolean } {
  let changed = false;
  let job = h.job;
  let jobDone = h.jobDone;
  const next: Record<string, ClassEntry> = {};

  for (const [cls, entry] of Object.entries(h.classes)) {
    if (!isUniqueClass(cls)) {
      next[cls] = entry;
      continue;
    }
    const holder = holders.held[cls];
    if (holder && holder.kind === 'local' && holder.hunterId === h.id) {
      next[cls] = entry;
      continue;
    }
    // Unbacked on this GM save: drop if same-registry or untagged, park if foreign-registry.
    if (entry.registryId && entry.registryId !== holders.registryId) {
      next[cls] = entry;
      if (job === cls) { job = null; jobDone = null; changed = true; }
    } else {
      changed = true;
      if (job === cls) { job = null; jobDone = null; }
      if (jobDone === cls) jobDone = null;
    }
  }

  return changed ? { classes: next, job, jobDone, changed: true } : { classes: h.classes, job, jobDone, changed: false };
}

// ── first-mission & GM unique-class offer (leaf types & parser) ──

/** Wave 1 Mythic classes listed at the top of the first-mission class offer. */
export const WAVE1_MYTHIC_OFFER = ['Hemomancer', 'Bladefiend', 'Rifthunter'] as const satisfies readonly UniqueClassName[];
/** Wave 1 Epic classes listed below the Mythics for leftover players (4th to 6th) or role picks. */
export const WAVE1_EPIC_OFFER = ['Seraph', 'Ironclad', 'Stormcaller'] as const satisfies readonly UniqueClassName[];
/** Default 6-class Wave 1 offer pool: 3 Mythics first, then 3 Epics. */
export const WAVE1_OFFER_POOL: readonly UniqueClassName[] = [...WAVE1_MYTHIC_OFFER, ...WAVE1_EPIC_OFFER];

export const CLASS_OFFER_MAX_POOL = 18;
export const CLASS_OFFER_MAX_HUNTERS = 24;

/** Active GM unique-class offer stored on `Save.classOffer` (`null` when closed). Claims live solely in `Save.classHolders`. */
export type ClassOffer = {
  readonly id: string;
  readonly at: string;
  /** Room code this offer was opened in (`null` when opened alone). Prevents leaking an offer across rooms. */
  readonly room: RoomCode | null;
  /** Unique classes offered, in display order (Mythics first, then Epics). */
  readonly pool: readonly UniqueClassName[];
  /** Eligible local hunter ids and/or remote sheet keys; empty means every hunter at the table may pick one. */
  readonly hunters: readonly string[];
};

const OFFER_ID_RE = /^[\w-]{1,40}$/;

/** Validates a class offer id (1 to 40 word/hyphen characters). */
export const parseClassOfferId = (v: unknown): string | null =>
  (typeof v === 'string' && OFFER_ID_RE.test(v) ? v : null);

/** Parses and repairs `Save.classOffer` from stored JSON, returning null when absent or invalid. */
export function parseClassOffer(raw: unknown, fallbackAt: string): ClassOffer | null {
  if (!isObj(raw)) return null;
  const id = parseClassOfferId(raw.id);
  if (!id) return null;
  const at = timeOf(raw.at) ?? fallbackAt;
  const room = parseRoomCode(raw.room);
  const pool: UniqueClassName[] = [];
  if (Array.isArray(raw.pool)) {
    for (const item of raw.pool) {
      if (pool.length >= CLASS_OFFER_MAX_POOL) break;
      if (isUniqueClass(item) && !pool.includes(item)) pool.push(item);
    }
  }
  if (!pool.length) return null;
  const hunters: string[] = [];
  if (Array.isArray(raw.hunters)) {
    for (const item of raw.hunters) {
      if (hunters.length >= CLASS_OFFER_MAX_HUNTERS) break;
      if (typeof item !== 'string') continue;
      const ok = parseSaveId<'h'>(item) ?? parseSheetKey(item);
      if (ok && !hunters.includes(ok)) hunters.push(ok);
    }
  }
  return { id, at, room, pool, hunters };
}
