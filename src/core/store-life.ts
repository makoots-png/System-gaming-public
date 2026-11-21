// store-life.ts: the store's life, one machine (docs/state-machines.md, "The store"). What a save is and how one is read
// is save.ts; this is whether this tab may change the save and whether storage holds what the tab shows.
//
// A tab opens `ready` when storage works and the stored save is this app's, `readOnly` when a newer app wrote it, and
// `noStorage` when the browser gives no storage at all (the tab plays in memory and says so). While ready, its write is
// `clean` (storage holds what the tab shows), `dirty` (a change waits for its write, a frame later), `failing` (the last
// write failed: storage is full or blocked, and the tab holds a change storage does not) or `retrying` (failing, with a
// write of a newer change coming). Another tab's save is taken only while this tab is clean; otherwise this tab is
// `keeping` its own in the backups, then turns read-only: showing the other tab's save when the backup was kept, or
// still its own when storage was too full to keep it (`mineUnkept`, so the player can export it). So neither tab undoes
// the other without a word. A load whose stored text could not be kept in the backups before the first write would
// overwrite it opens read-only: `loadUnkept` when the save did not open, `fightUnkept` when it opened without its running
// fight. A read-only tab refuses every change a player makes (`mayChange`). A
// restore, an import or a reset makes the tab ready again.
// Pure: src/edge/store.ts raises the events (its own writes, the frame's timer, the page hidden, the `storage` event)
// and carries out the effects. What the player is told is `noticesOf`, read from the state; the store owns the words.
import { dayKey } from './day.ts';
import type { LoadNotice } from './save.ts';

export const STORE_STATES = ['ready', 'keeping', 'readOnly', 'noStorage'] as const;
export type StoreState = (typeof STORE_STATES)[number];
export const WRITES = ['clean', 'dirty', 'failing', 'retrying'] as const;
export type Write = (typeof WRITES)[number];
/**
 * Why a tab may not change its save: a newer app wrote it; another tab saved while this one had not (this tab's save
 * is in the backups); the same, with storage too full to keep this tab's save, which the tab still shows
 * (`mineUnkept`); or the stored text could not be opened nor kept in the backups, so the tab will not write over it
 * (`loadUnkept`), or the same for a save that opened but for its running fight (`fightUnkept`).
 */
export type ReadOnlyWhy = 'newer' | 'otherTab' | 'mineUnkept' | 'loadUnkept' | 'fightUnkept';

/** What another tab stored, as save.ts reads it: a save of this app, a newer app's, or a text no app of this build reads. */
export type Theirs = 'save' | 'newer' | 'unreadable';

/**
 * `keeping`: another tab stored `theirs` while this one could not take it; this tab's save is going to the backups
 * (`keepMine`), and the answer (`kept`, `keepFailed`) comes in the same task, before any other event.
 */
export type StoreLife =
  | { at: 'ready'; write: Write }
  | { at: 'keeping'; theirs: Theirs }
  | { at: 'readOnly'; why: ReadOnlyWhy }
  | { at: 'noStorage' };

export type StoreEvent =
  /** The save in memory changed (`store.apply`, `store.update`). */
  | { type: 'changed' }
  /** The frame after a change came: the time for its write. */
  | { type: 'due' }
  /** The page is hidden or left: storage must catch up now. */
  | { type: 'leaving' }
  /** Storage took the write. */
  | { type: 'wrote' }
  /** Storage refused the write (full or blocked). */
  | { type: 'writeFailed' }
  /** Another tab of this app stored the save. */
  | { type: 'otherTab'; theirs: Theirs }
  /** A restore, an import or a reset swapped in another save (the store backs up the one it replaces first). */
  | { type: 'replaced' }
  /** The backups took this tab's save (`keepMine`). */
  | { type: 'kept' }
  /** Storage was too full to keep this tab's save in the backups. */
  | { type: 'keepFailed' };
export type StoreEventType = StoreEvent['type'];

/**
 * `schedule`: ask for `due` after the next frame. `write`: write the save now, then raise `wrote` or `writeFailed`.
 * `take`: show the other tab's save. `keepMine`: put this tab's save in the backups before it is lost from view.
 */
export type StoreEffect = 'schedule' | 'write' | 'take' | 'keepMine';
export type StoreStep = { life: StoreLife; effects: readonly StoreEffect[] };

/**
 * What load found: whether storage could be read, whether a newer app wrote the stored save, and the backup of a stored
 * text the app does not open whole (save.ts `loadSave`): none needed, kept, or `unkept` because storage is full, with
 * what the load could not open (its `LoadNotice`: the save, or only its running fight).
 */
export type Opened = { storage: 'ok' | 'blocked'; newer: boolean; backup: 'none' | 'kept' | { unkept: LoadNotice } };
/**
 * The life a tab opens in. A ready tab writes at once: the stored text becomes the save as this build repaired it (an
 * old or unreadable one went to the backups first). When that backup failed, the first write would destroy the only
 * copy of the text, so the tab opens read-only and says why.
 */
export function opened(o: Opened): StoreStep {
  if (o.storage === 'blocked') return { life: { at: 'noStorage' }, effects: [] };
  if (o.newer) return { life: { at: 'readOnly', why: 'newer' }, effects: [] };
  if (typeof o.backup === 'object') return { life: { at: 'readOnly', why: o.backup.unkept === 'fight' ? 'fightUnkept' : 'loadUnkept' }, effects: [] };
  return { life: { at: 'ready', write: 'dirty' }, effects: ['write'] };
}

const same = (life: StoreLife): StoreStep => ({ life, effects: [] });
const ready = (write: Write, ...effects: StoreEffect[]): StoreStep => ({ life: { at: 'ready', write }, effects });
/** Behind: storage does not hold the latest change. */
const behind = (w: Write): boolean => w !== 'clean';

type Ready = Extract<StoreLife, { at: 'ready' }>;
/** Another tab saved. Clean: show theirs (read-only when theirs is a newer app's). Behind, or theirs unreadable: keep mine first. */
function otherTab(l: Ready, theirs: Theirs): StoreStep {
  if (!behind(l.write) && theirs === 'save') return ready('clean', 'take');
  if (!behind(l.write) && theirs === 'newer') return { life: { at: 'readOnly', why: 'newer' }, effects: ['take'] };
  return { life: { at: 'keeping', theirs }, effects: ['keepMine'] };
}

type Cell<S extends StoreState, E extends StoreEventType> = (l: Extract<StoreLife, { at: S }>, e: Extract<StoreEvent, { type: E }>) => StoreStep;
/** Each state's answer to each event. The typecheck asks for every cell. */
export const TABLE: { readonly [S in StoreState]: { readonly [E in StoreEventType]: Cell<S, E> } } = {
  ready: {
    changed: l => (l.write === 'clean' ? ready('dirty', 'schedule') : l.write === 'failing' ? ready('retrying', 'schedule') : same(l)),
    due: l => (l.write === 'dirty' || l.write === 'retrying' ? ready(l.write, 'write') : same(l)),
    leaving: l => (behind(l.write) ? ready(l.write, 'write') : same(l)),
    wrote: l => (behind(l.write) ? ready('clean') : same(l)),
    writeFailed: l => (behind(l.write) ? ready('failing') : same(l)),
    otherTab: (l, e) => otherTab(l, e.theirs),
    replaced: l => ready(l.write === 'failing' || l.write === 'retrying' ? 'retrying' : 'dirty', 'write'),
    kept: same, keepFailed: same,
  },
  // the answer to `keepMine` comes before any other event; another one changes nothing until it does
  keeping: {
    changed: same, due: same, leaving: same, wrote: same, writeFailed: same, otherTab: same, replaced: same,
    kept: l => ({ life: { at: 'readOnly', why: 'otherTab' }, effects: l.theirs === 'unreadable' ? [] : ['take'] }),
    keepFailed: () => ({ life: { at: 'readOnly', why: 'mineUnkept' }, effects: [] }),
  },
  readOnly: {
    changed: same, due: same, leaving: same, wrote: same, writeFailed: same, otherTab: same, kept: same, keepFailed: same,
    replaced: () => ready('dirty', 'write'),
  },
  noStorage: { changed: same, due: same, leaving: same, wrote: same, writeFailed: same, otherTab: same, replaced: same, kept: same, keepFailed: same },
};

/** The next life and what to do. A cell that changes nothing answers the same state object. */
export function storeStep(l: StoreLife, e: StoreEvent): StoreStep {
  const cell = TABLE[l.at][e.type] as (l: StoreLife, e: StoreEvent) => StoreStep;
  return cell(l, e);
}

/** Whether a player's change is taken: a read-only tab refuses it, so the screen never shows what the next load drops. */
export const mayChange = (l: StoreLife): boolean => l.at === 'ready' || l.at === 'noStorage';
/** The refusal `store.apply` answers in a read-only tab. */
export const READ_ONLY = 'read-only';

/** Whether this phone's own memory (prefs, device memory) was kept at its last write. */
export type DeviceLife = 'kept' | 'failing';

/** A lasting notice the store's life gives. The store words each one. */
export type LifeNotice = ReadOnlyWhy | 'noStorage' | 'saveFailed' | 'deviceFailed';
/** What the player is told while the store is in `l` and the device memory in `d`. */
export function noticesOf(l: StoreLife, d: DeviceLife): LifeNotice[] {
  const out: LifeNotice[] = [];
  if (l.at === 'readOnly') out.push(l.why);
  if (l.at === 'noStorage') out.push('noStorage');
  if (l.at === 'ready' && (l.write === 'failing' || l.write === 'retrying')) out.push('saveFailed');
  if (d === 'failing' && l.at !== 'noStorage') out.push('deviceFailed');
  return out;
}

/**
 * Whether the save is backed up as the app opens: on the first load of a local calendar day, unless the newest backup
 * (`newestAt`, null for none) is from that day already.
 */
export function dailyBackupDue(newestAt: string | null, now: Date): boolean {
  const t = newestAt === null ? Number.NaN : Date.parse(newestAt);
  return !Number.isFinite(t) || dayKey(new Date(t), 0) !== dayKey(now, 0);
}
