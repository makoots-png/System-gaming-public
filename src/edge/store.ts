// store.ts: the one module that touches the browser's storage (a lint test names the two others: sync.ts's invite and
// upgrade.ts's note). It keeps the save, the backups ring, the device prefs and the views' device memory, the notices
// and the subscribers, the one wait for the save's next write (`flushTimer`), this tab's unsaved snapshot kept for
// Export backup while read-only (`unsavedBackup`), and runs the store's life
// (src/core/store-life.ts): whether this tab may change the save and whether storage holds it. What a save is, how one is repaired and what an old one becomes is src/core/save.ts.
import { ITEM_STAMP_CHARS, ITEM_STAMP_LEN, customItemDefId, parseCatalogKey } from '../core/ids.ts';
import type { CatalogId, CatalogKey, ItemDefId } from '../core/ids.ts';
import { importRekey, withCatalog } from '../core/item-refs.ts';
import { ACCENTS, TEXT_SCALES, bindSave, rules } from './rules.ts';
import { featsFor } from '../core/hunter/feats.ts';
import type { FeatDef } from '../core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../core/registry/feats.ts';
import { stepTime } from '../core/day.ts';
import type { Change } from '../core/events.ts';
import { oneOf } from '../core/one-of.ts';
import { PINS } from '../core/combat/map-view.ts';
import { exportedSave, fileKind, keepPhone, loadSave, parseSave, repairSave, rulesOf, freshSave } from '../core/save.ts';
import type { Hunter, LoadNotice, ParseEnv, Save } from '../core/save.ts';
import { CLASS_TREES } from '../core/registry/class-trees.ts';
import type { ClassTreeMap } from '../core/registry/class-trees.ts';
import { isRefused, refuse, writeInto } from '../core/save-step.ts';
import { READ_ONLY, canTakeOver, dailyBackupDue, mayChange, noticesOf, opened, storeStep } from '../core/store-life.ts';
import type { DeviceLife, LifeNotice, Opened, ReadOnlyWhy, StoreEvent, StoreLife, StoreStep, Theirs } from '../core/store-life.ts';
import type { Applied, Step } from '../core/save-step.ts';
import { saveId } from '../core/ids.ts';
import type { DeviceId, HunterId, IdOf } from '../core/ids.ts';
import { noticed } from '../core/hunter/noticed.ts';
import { lettersKept } from '../core/trade/offer.ts';
import { asksKept } from '../core/trade/stash.ts';
import type { NoticeCtx } from '../core/hunter/noticed.ts';
import { rewardSeatOf } from '../core/hunter/pending.ts';
import { fightHold } from '../core/combat/fight-save.ts';
import { NO_TABLE } from '../core/sync/fight-heard.ts';
import { NO_TOLD, parseTold, toldStep } from '../core/told.ts';
import type { ToldEvent, ToldMemory } from '../core/told.ts';

/** The save under the current schema key. */
const SAVE_KEY = 'hunter-system-v5';
const BACKUPS_KEY = 'hunter-system-backups';
/** Device only: never exported, backed up or sent to a room. */
const PREFS_KEY = 'hunter-system-prefs';
/** Written when a tab explicitly clicks Take over here, so other open tabs become read-only immediately. */
const TAKEOVER_KEY = 'hunter-system-takeover';

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const randId = (): DeviceId => ('d-' + Math.random().toString(36).slice(2, 8)) as DeviceId;
/** 32 characters of base 36 from 24 random bytes. */
function randToken(): string {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
}
/** A custom item's stamp: 16 of `ITEM_STAMP_CHARS` from the browser's random source (Fable C1: knowing an id is the right to read its def). */
function randStamp(): string {
  const a = new Uint8Array(ITEM_STAMP_LEN); crypto.getRandomValues(a);
  return Array.from(a, b => ITEM_STAMP_CHARS[b % ITEM_STAMP_CHARS.length]).join('');
}
/** A new catalog key: the secret that owns this campaign's custom items (item-refs.ts `withCatalog`, `importRekey`). */
const randCatalogKey = (): CatalogKey => parseCatalogKey(`ck_${randToken()}`)!;
/** Active class trees: production `CLASS_TREES` always takes precedence over Playwright test fixtures. */
export const activeClassTrees = (): ClassTreeMap => {
  const injected = (globalThis as { __e2eClassTrees?: ClassTreeMap }).__e2eClassTrees;
  return injected ? { ...injected, ...CLASS_TREES } : CLASS_TREES;
};
const env = (): ParseEnv => {
  const classTrees = activeClassTrees();
  return { now: new Date(), newDeviceId: randId, newDeviceToken: randToken, ...(classTrees !== CLASS_TREES ? { classTrees } : {}) };
};

// ── device prefs: their own key, so a campaign export, a backup and a sheet never carry them ──
const MOTIONS = ['os', 'reduce', 'full'] as const;
const FIGHT_VIEWS = ['list', 'map'] as const;
/** Pinned hotbar abilities: at most this many keys, each at most `PINS` ability ids (src/core/combat/map-view.ts). */
const PIN_KEYS = 40, PIN_ID_MAX = 40;
/**
 * `usesSeen`: when this phone's GM last opened the log's reward uses (an ISO time, '' for never); the GM view counts the
 * `use` lines after it. `fightView`: the fight screen as the map (the default: the fight as the owner pictures it) or a list. `mapGrid`: the map draws its grid lines.
 * `pins`: the abilities pinned to a map's hotbar, by the key the fight screen names (a hunter, a monster's name).
 */
export type Prefs = {
  accent: string; text: number; motion: (typeof MOTIONS)[number]; haptics: boolean; usesSeen: string;
  fightView: (typeof FIGHT_VIEWS)[number]; mapGrid: boolean; pins: Record<string, string[]>;
};
/** Pinned abilities as stored: string lists of at most `PINS` ids by key, at most `PIN_KEYS` keys; anything else dropped. */
function fixPins(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(isObj(v) ? v : {}).slice(0, PIN_KEYS)) {
    if (k.length <= 120 && Array.isArray(ids)) out[k] = ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= PIN_ID_MAX).slice(0, PINS);
  }
  return out;
}
/** Any value to valid prefs. Keys this build does not know are kept. */
function fixPrefs(value: unknown): Prefs {
  const p = isObj(value) ? value : {};
  return {
    ...p,
    accent: oneOf<string>(p.accent, ACCENTS, 'cyan'),
    text: oneOf<number>(p.text, TEXT_SCALES, 1),
    motion: oneOf(p.motion, MOTIONS, 'os'),
    haptics: p.haptics === true,
    usesSeen: typeof p.usesSeen === 'string' && !Number.isNaN(Date.parse(p.usesSeen)) ? p.usesSeen : '',
    fightView: oneOf(p.fightView, FIGHT_VIEWS, 'map'),
    mapGrid: p.mapGrid === true,
    pins: fixPins(p.pins),
  };
}

// ── storage: every read and write of the browser's storage in the app goes through these (a lint test) ──
type Area = 'phone' | 'tab';
const area = (where: Area): Storage => (where === 'phone' ? localStorage : sessionStorage);
/** The text under `key`, or null for none. Throws when the browser gives no storage. */
const readKey = (key: string, where: Area = 'phone'): string | null => area(where).getItem(key);
/** Whether storage took the text (false: full or blocked). */
function writeKey(key: string, text: string, where: Area = 'phone'): boolean {
  try { area(where).setItem(key, text); return true; } catch { return false; } // full or blocked: the caller's step says so (store-life.ts)
}
/** The JSON under `key`, or null for none, an unreadable text or no storage. */
function readJson(key: string, where: Area = 'phone'): unknown {
  try { return JSON.parse(readKey(key, where) ?? 'null'); } catch { return null; } // a damaged memory reads as none: the view starts it again
}

// ── notices and subscribers ──
export type Notice = { id: string; text: string };
const LOAD_TEXT: { readonly [N in LoadNotice]: string } = {
  unreadable: 'Your save could not be read. It is kept in Backups, and a new hunter was made.',
  fight: 'The running fight in your save could not be read, so it was dropped. Everything else opened, and the save as it was is kept in Backups.',
};
const LIFE_TEXT: { readonly [N in LifeNotice]: string } = {
  newer: 'This save comes from a newer version of the app. You cannot change it in this tab. Reload to update the app.',
  otherTab: 'This campaign is open in another tab. You cannot save changes here while the other tab is active. Reload to continue.',
  noStorage: 'Browser storage is unavailable. Progress will not be saved.',
  mineUnkept: 'This campaign is open in another tab, and browser storage is too full to back up your unsaved changes here. Export a backup before you reload.',
  loadUnkept: 'Browser storage is too full to back up your stored save before opening it, so you cannot save changes here. Export a backup, free storage, and reload.',
  fightUnkept: 'The running fight could not be read, and browser storage is too full to back up your stored save. Export a backup, free storage, and reload.',
  saveFailed: 'Saving failed (storage full or blocked). Export your data from the Data tab to avoid losing progress.',
  deviceFailed: 'Could not save device settings, such as pinned abilities and the fight view. Storage is full or blocked.',
};
/** What load and `notify` raised: each stays until the page is left. */
const raised: Notice[] = [];
const subs = new Set<(change: Change) => void>();
function emit(change: Change): void {
  subs.forEach(fn => { try { fn(change); } catch (e) { console.warn('store subscriber failed', e); } });
}

// ── this phone's own memory: the prefs and the views' device memory (`store.device`). Kept or failing, one value ──
let prefs = fixPrefs(readJson(PREFS_KEY));
let device: DeviceLife = 'kept';
/** Writes one key of this phone's memory; a failure is told as a lasting notice until a later write is kept. */
function keepDevice(key: string, value: unknown, where: Area): void {
  const was = device;
  device = writeKey(key, JSON.stringify(value), where) ? 'kept' : 'failing';
  if (device !== was) emit({ reason: 'notice' });
}
/** A view's memory on this phone or in this tab: never in the save, a backup or a room. */
export type Memory = { read(): unknown; write(value: unknown): void };

// ── the campaign's told memory (src/core/told.ts): what this phone told its player, one record, a new one each campaign ──
const TOLD_KEY = 'hunter-system-told';
/** The record as stored; with none kept (storage blocked or full), the record of no campaign, which tells nothing. */
const readTold = (): ToldMemory => parseTold(readJson(TOLD_KEY)) ?? NO_TOLD;
/** The record after `event`, kept when the step changed it. Its one writer. */
function tellStep(event: ToldEvent): void {
  const was = readTold(), next = toldStep(was, event);
  if (next !== was) keepDevice(TOLD_KEY, next, 'phone');
}
/**
 * A campaign opened or replaced: a new record under a token no window asked before can answer into, with what the
 * campaign's hunters hold told (src/core/told.ts).
 */
const newCampaignTold = (save: Save): void => tellStep({ type: 'replaced', campaign: randToken(), hunters: save.hunters });

// ── backups: a ring of save texts, newest first ──
type Backup = { at?: unknown; reason?: unknown; data: string };
function readBackups(): Backup[] {
  const ring = readJson(BACKUPS_KEY);
  return Array.isArray(ring) ? ring.filter((e): e is Backup => isObj(e) && typeof e.data === 'string') : [];
}
/** Puts a text at the front of the ring. When storage is tight the ring shrinks from the old end, so the newest entry is kept as long as possible. */
function pushBackup(reason: string, data: string, cap: number): boolean {
  let ring: Backup[] = [{ at: new Date().toISOString(), reason, data }, ...readBackups()].slice(0, cap);
  for (;;) {
    if (writeKey(BACKUPS_KEY, JSON.stringify(ring))) return true;
    if (ring.length <= 1) return false;
    ring = ring.slice(0, -1);
  }
}
/** How many backups the rules stored in this save keep. */
const backupCap = (save: Save): number => rulesOf(save.rulesOverrides).backupCap;

// ── the save and the store's life (src/core/store-life.ts) ──
/**
 * Reads the save key and lets core decide what the app opens with. Then does what core cannot: the backup and the
 * notice. A backup that failed reaches the store's life (`opened`), whose banner says so instead of the load's notice.
 */
function load(): { save: Save; fresh: boolean; opened: Opened } {
  let blocked = false;
  const read = (key: string): string | null => {
    try { return readKey(key); } catch { blocked = true; return null; } // no storage: the life opens noStorage and its banner says so
  };
  const loaded = loadSave(read(SAVE_KEY), env());
  const backup: Opened['backup'] = !loaded.backup ? 'none' : pushBackup(loaded.backup.reason, loaded.backup.data, backupCap(loaded.save)) ? 'kept' : { unkept: loaded.notice ?? 'unreadable' };
  if (loaded.notice && backup === 'kept') raised.push({ id: loaded.notice, text: LOAD_TEXT[loaded.notice] });
  return { save: loaded.save, fresh: loaded.fresh, opened: { storage: blocked ? 'blocked' : 'ok', newer: loaded.readOnly, backup } };
}
const loaded = load();
let state: Save = loaded.save;
let life: StoreLife = { at: 'noStorage' };
let unsavedBackup: string | null = null;
bindSave(() => state);

/** Where the notice step learns a fact's session and whether a fight holds a hunter, as the save after a step answers. */
type NoticeAt = Pick<NoticeCtx, 'session' | 'held'>;
/** A player's room: its session and fight doc, and the GM's feats from the room's feats doc (laid over the built-ins). */
type RoomNotice = NoticeAt & { readonly library: Readonly<Record<string, FeatDef>> };
/** Alone or the GM: the save's own session count and its own fight (`fightHold`). */
const savedNotice = (save: Save): NoticeAt => ({
  session: save.world.session,
  held: (s: Save, hid: HunterId) => fightHold(s.fight, { hid }, { seat: 'alone', key: null, ...NO_TABLE }) !== null,
});
/** A player's room's answer (its session, its fight doc), or null for the save's own: bound by sync.ts (`bindNotice`). */
let noticeOf: (save: Save) => RoomNotice | null = () => null;
/** sync.ts calls this once: the room's session and fight doc while this phone is a player in a room, else null. */
export function bindNotice(of: (save: Save) => RoomNotice | null): void { noticeOf = of; }

/**
 * The text a backup of the current save holds: what storage holds while this tab may not write (a newer app's save,
 * the other tab's, the text a load could not open), else this tab's save, which is also what a tab shows whose own save
 * storage was too full to keep (`mineUnkept`).
 */
function currentText(): string {
  if (life.at === 'readOnly' && life.why !== 'mineUnkept') {
    try { const t = readKey(SAVE_KEY); if (t !== null) return t; } catch { /* no storage to read: this tab's save is all there is */ }
  }
  return JSON.stringify(state);
}
function writeSave(): boolean {
  state.savedAt = new Date().toISOString();
  return writeKey(SAVE_KEY, JSON.stringify(state));
}
/**
 * The one wait for the save's next write (`due`): none; the next frame, with a second's `fallback` for a page that draws
 * no frames (a hidden one); or the task after that frame, the fallback still set. A write ends it, whatever raised the
 * write (`due`, the page left, a replace), so nothing armed for an earlier change can write a later one before its frame.
 */
type FlushTimer =
  | { at: 'idle' }
  | { at: 'frame'; frame: number; fallback: ReturnType<typeof setTimeout> }
  | { at: 'task'; task: ReturnType<typeof setTimeout>; fallback: ReturnType<typeof setTimeout> };
let flushTimer: FlushTimer = { at: 'idle' };
/** Ends the wait: nothing of it fires. */
function cancelFlush(): void {
  const t = flushTimer;
  if (t.at === 'frame') { cancelAnimationFrame(t.frame); clearTimeout(t.fallback); }
  if (t.at === 'task') { clearTimeout(t.task); clearTimeout(t.fallback); }
  flushTimer = { at: 'idle' };
}
/** The wait came to its end: `due`. */
function flushDue(): void {
  cancelFlush();
  run({ type: 'due' });
}
/**
 * A change's write waits for the frame that shows it: writing the whole save (its text and the storage call, 3 to 4 ms
 * on a phone at 4x CPU) in the tap's own task would hold that frame back. `due` comes in a task after the next frame, or
 * after a second on a page that draws no frames (a hidden one); the page hidden or left is `leaving`.
 */
function schedule(): void {
  cancelFlush();
  const fallback = setTimeout(flushDue, 1000);
  const frame = requestAnimationFrame(() => {
    if (flushTimer.at === 'frame' && flushTimer.frame === frame) flushTimer = { at: 'task', task: setTimeout(flushDue, 0), fallback };
  });
  flushTimer = { at: 'frame', frame, fallback };
}
/**
 * Carries out a step of the store's life and the steps its effects lead to (a write's answer). `theirs`: the other
 * tab's save, for `take`. Announces the save when it was taken, else the notices when they changed; `quiet` leaves
 * that to the caller, which announces its own change.
 */
function carry(first: StoreStep, theirs: Save | null = null, quiet = false): void {
  const before = JSON.stringify(noticesOf(life, device));
  let took = false;
  const queue: StoreStep[] = [first];
  for (let s = queue.shift(); s; s = queue.shift()) {
    life = s.life;
    for (const fx of s.effects) {
      if (fx === 'schedule') schedule();
      else if (fx === 'write') { cancelFlush(); queue.push(storeStep(life, { type: writeSave() ? 'wrote' : 'writeFailed' })); }
      else if (fx === 'keepMine') {
        unsavedBackup = JSON.stringify(exportedSave(state, false), null, 2);
        queue.push(storeStep(life, { type: pushBackup('before another tab saved', JSON.stringify(state), backupCap(state)) ? 'kept' : 'keepFailed' }));
      }
      else if (theirs) { state = theirs; took = true; }
    }
  }
  if (life.at !== 'readOnly' && life.at !== 'keeping') unsavedBackup = null;
  if (life.at !== 'ready') cancelFlush(); // a tab that does not write waits for no write
  if (quiet) return;
  if (took) emit({ reason: 'storage' }); // sync.ts tells a save of another room by its own rule (`otherRoom`)
  else if (JSON.stringify(noticesOf(life, device)) !== before) emit({ reason: 'notice' });
}
const run = (e: StoreEvent, theirs: Save | null = null): void => carry(storeStep(life, e), theirs);
carry(opened(loaded.opened), null, true);
if (loaded.fresh || !parseTold(readJson(TOLD_KEY))) newCampaignTold(state);
const newest = readBackups()[0];
if (dailyBackupDue(typeof newest?.at === 'string' ? newest.at : null, new Date())) pushBackup('daily', currentText(), backupCap(state));

addEventListener('pagehide', () => run({ type: 'leaving' }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') run({ type: 'leaving' }); });

/**
 * Whether a restore, an import or a reset went ahead: `unkept` when storage was too full to back up the current save
 * first, and the caller did not say to go on `anyway` (nothing changed: the view asks the player).
 */
export type Replaced = 'replaced' | 'unkept';
/**
 * Swaps in another save, with this phone's identity kept (save.ts `keepPhone`): the current one goes to the backups
 * first; a read-only tab becomes ready and writes it at once.
 */
function replace(next: Save, backupReason: string, reason: string, anyway: boolean): Replaced {
  if (!pushBackup(backupReason, currentText(), backupCap(state)) && !anyway) return 'unkept';
  // a campaign whose catalog this phone holds no key for gets a catalog of its own at once (item-refs.ts `importRekey`)
  state = importRekey(keepPhone(next, state), randCatalogKey());
  newCampaignTold(state);
  carry(storeStep(life, { type: 'replaced' }), null, true);
  emit({ reason, replaced: true });
  return 'replaced';
}

/** What the Data panel says when a file cannot come in (`read`, and io.js's Add hunters to party). */
export const IMPORT_ERRORS = {
  'not-json': 'File is not valid JSON.',
  'not-an-object': 'Save data must be a JSON object.',
  'not-a-save': 'This does not look like a Hunter System save.',
  newer: 'This save is from a newer version of the app.',
  old: 'This save is from an older version and cannot be imported. Start a fresh campaign or import a current save.',
};
/** A file read as this app reads a save: the save and whether it is one hunter's file, or the words of why it cannot come in. */
export type Read = { ok: true; save: Save; kind: 'hunter' | 'campaign' } | { ok: false; error: string };

export const store = {
  get: (): Save => state,
  /**
   * What `apply` writes with, and a test's setup: every write of the app is an `apply`, which a read-only tab refuses
   * (sync.ts's too: a read-only tab takes no part in a room, src/core/sync/link.ts `readOnly`). `fn` mutates the save,
   * then it is repaired, stored and announced; it does not ask whether the tab may write.
   */
  update<T>(fn: (save: Save) => T, reason = 'update'): T {
    const result = fn(state);
    repairSave(state, env(), 'kept');
    carry(storeStep(life, { type: 'changed' }), null, true);
    emit({ reason });
    return result;
  },
  /**
   * The one form a view writes the save in: `step` (src/core/save-step.ts) is a pure core function from the save to the
   * next save or a refusal. The answer is written into the live save (`writeInto`, so a hunter a view holds stays live),
   * then repaired, stored and announced as `update` does. A refusal changes, stores and announces nothing; a read-only
   * tab refuses every step (`read-only`), so the screen never shows a change the next load would drop. The notice step
   * (src/core/hunter/noticed.ts) runs on the step's answer in the same write, so a fact a step recorded is taken with it;
   * a step that recorded none costs it a length check of each hunter's inbox. Before it, an offer whose letter the step
   * let go before it was ever sent ends with its goods back (src/core/trade/offer.ts `lettersKept`), and so does a stash
   * put waiting for the GM's phone (src/core/trade/stash.ts `asksKept`), whichever step let it go (a full outbox, a
   * rebind, the room gone); a save with no offer records and no asks costs it nothing.
   */
  apply(reason: string, step: Step<Save>): Applied {
    if (!mayChange(life)) return refuse(READ_ONLY);
    const answered = step(state);
    if (isRefused(answered)) return answered;
    const R = rules(), next = asksKept(lettersKept(answered, R), R);
    // a player in a room checks the built-ins with the GM's feats from the room's feats doc over them; alone or the GM, this save's library
    const done = noticed(next, () => {
      const room = noticeOf(next), R = rules();
      const at = room ? { session: room.session, held: room.held } : savedNotice(next);
      // where the phone sits by the save's room fields: in a room a reward earned by itself waits for the GM (ruling 20),
      // and a player reports the end of a quest the GM issued
      return { ...stepTime(next, new Date()), ...at, R, feats: featsFor(R, BUILT_IN_FEATS, room ? room.library : next.library.feats), seat: rewardSeatOf(next) };
    });
    store.update(s => { writeInto(s, done); }, reason);
    return { ok: true };
  },
  /** A new id of the kind `prefix` names (src/core/ids.ts `SaveIds`), from the save's `seq`. */
  id: <P extends string>(prefix: P): IdOf<P> => saveId(prefix, ++state.seq),
  /** A random stamp for a custom item's id (ids.ts `customItemDefId`), for a core step that mints them (pack.ts `mergePack`). */
  stamp: (): string => randStamp(),
  /**
   * This campaign's catalog, minted with a new key at the first custom item (item-refs.ts `withCatalog`, one write);
   * null when the write is refused (a read-only tab).
   */
  catalog(): CatalogId | null {
    if (state.library.catalogId === null) store.apply('catalog', s => withCatalog(s, randCatalogKey()));
    return state.library.catalogId;
  },
  /** A new custom item's id under this campaign's catalog (`catalog`), or null when there is none. */
  itemDefId(): ItemDefId | null {
    const cat = store.catalog();
    return cat ? customItemDefId(cat, randStamp()) : null;
  },
  /** The active hunter. A save holds one: the repair gives a save read with none the starter (save.ts). */
  active: (): Hunter => state.hunters.find(h => h.id === state.settings.activeHunterId) ?? state.hunters[0]!,
  hunter: (id: string): Hunter | null => state.hunters.find(h => h.id === id) ?? null,
  backupNow: (reason = 'manual'): boolean => pushBackup(reason, currentText(), backupCap(state)),
  backups: (): { at: string; reason: string }[] => readBackups().map(({ at, reason }) => ({ at: String(at ?? ''), reason: String(reason ?? '') })),
  /** Swaps in backup `i`: `old` for an older schema, `unreadable` when it is gone or not a current save. */
  restore(i: number, anyway = false): Replaced | 'unreadable' | 'old' {
    const entry = readBackups()[i];
    if (!entry) return 'unreadable';
    const parsed = parseSave(entry.data, env());
    if (parsed.kind === 'invalid' && parsed.reason === 'old') return 'old';
    if (parsed.kind !== 'save') return 'unreadable';
    return replace(parsed.save, 'pre-restore', 'restore', anyway);
  },
  /** A save file's text read as this app reads a save (save.ts `parseSave`), for the import's preview and its Replace. */
  read(text: string): Read {
    const parsed = parseSave(text, env());
    if (parsed.kind === 'invalid') return { ok: false, error: IMPORT_ERRORS[parsed.reason] };
    if (parsed.kind !== 'save') return { ok: false, error: IMPORT_ERRORS[parsed.kind] };
    return { ok: true, save: parsed.save, kind: fileKind(parsed.save) };
  },
  /** Replaces the campaign with a save `read` answered. The current one is kept in the backups first. */
  importSave: (next: Save, anyway = false): Replaced => replace(next, 'pre-import', 'import', anyway),
  reset: (anyway = false): Replaced => replace(freshSave(env(), { onboarded: true }), 'pre-reset', 'reset', anyway),
  subscribe(fn: (change: Change) => void): () => boolean { subs.add(fn); return () => subs.delete(fn); },
  prefs: (): Prefs => prefs,
  setPrefs(patch: Partial<Prefs>): Prefs {
    prefs = fixPrefs({ ...prefs, ...patch });
    keepDevice(PREFS_KEY, prefs, 'phone');
    return prefs;
  },
  /**
   * A view's memory on this phone (`phone`) or in this tab (`tab`), under its own key `hunter-system-<name>`: never in
   * the save, a backup, an export or a room. A write that fails is told as the prefs' is.
   */
  device(name: string, where: Area = 'phone'): Memory {
    const key = `hunter-system-${name}`;
    return { read: () => readJson(key, where), write: value => keepDevice(key, value, where) };
  },
  /** The campaign's told memory (src/core/told.ts): what this phone told its player of this campaign, a new one after a reset, an import or a restore. */
  told: (): ToldMemory => readTold(),
  /** The one writer of the told memory: an event of src/core/told.ts (`looked`, `answered`), kept when it changed the record. */
  tell(event: Exclude<ToldEvent, { type: 'replaced' }>): void { tellStep(event); },
  /** The bytes this app's keys hold in this phone's storage (two a character), or null when storage cannot be read. */
  used(): number | null {
    try {
      let chars = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('hunter-system')) chars += k.length + (readKey(k) ?? '').length;
      }
      return chars * 2;
    } catch { return null; } // no storage to count: the meter says it is unknown
  },
  /** Whether storage holds what this tab shows: false while its last write failed, and in a tab that plays in memory. */
  get saveOk(): boolean { return life.at === 'readOnly' || (life.at === 'ready' && life.write !== 'failing' && life.write !== 'retrying'); },
  get readOnly(): boolean { return life.at === 'readOnly'; },
  /** Why this tab may not write, or null when it may. */
  readOnlyWhy: (): ReadOnlyWhy | null => (life.at === 'readOnly' ? life.why : null),
  /**
   * The JSON text exported by the blocking takeover screen's Export backup button (read-only tab or stuck update):
   * the raw stored text for `newer`, `loadUnkept` and `fightUnkept`, the captured `unsavedBackup` snapshot for
   * `otherTab` and `mineUnkept`, or this tab's current save stripped of phone secrets (and zero storage writes).
   */
  exportReadOnly(): string {
    if (life.at === 'readOnly' && (life.why === 'newer' || life.why === 'loadUnkept' || life.why === 'fightUnkept')) {
      return currentText();
    }
    if (life.at === 'readOnly' && (life.why === 'otherTab' || life.why === 'mineUnkept') && unsavedBackup !== null) {
      return unsavedBackup;
    }
    return JSON.stringify(exportedSave(state, false), null, 2);
  },
  /**
   * Takes over saving in this tab from `otherTab` or `mineUnkept`. Refuses `newer`, `loadUnkept`, `fightUnkept`, or any
   * stored save written by a newer app build. Signals other tabs only when the write succeeds.
   */
  takeOver(): boolean {
    if (life.at !== 'readOnly' || !canTakeOver(life.why)) return false;
    try {
      const raw = readKey(SAVE_KEY);
      if (raw !== null && parseSave(raw, env()).kind === 'newer') return false;
    } catch { /* no storage to inspect: the write step below handles blocked storage */ }
    carry(storeStep(life, { type: 'takeOver' }), null, true);
    const after = store.life();
    if (after.at === 'ready' && after.write === 'clean') writeKey(TAKEOVER_KEY, randToken());
    emit({ reason: 'takeover', replaced: true });
    return true;
  },
  /** The store's life (src/core/store-life.ts), for a test to read. */
  life: (): StoreLife => life,
  /** A lasting banner raised after load, for example by the build handshake. One per id. */
  notify(note: Notice): void {
    if (raised.some(n => n.id === note.id)) return;
    raised.push({ id: note.id, text: note.text });
    emit({ reason: 'notice' });
  },
  /** The lasting banners: what load and `notify` raised, and what the store's life says now. */
  notices: (): Notice[] => [...raised, ...noticesOf(life, device).map(id => ({ id, text: LIFE_TEXT[id] }))],
};

addEventListener('storage', e => {
  if (e.key === PREFS_KEY) { prefs = fixPrefs(readJson(PREFS_KEY)); emit({ reason: 'prefs' }); return; }
  if (e.key === TAKEOVER_KEY) {
    if (e.newValue === null) return;
    let theirs: Save | null = null;
    try {
      const raw = readKey(SAVE_KEY), p = raw !== null ? parseSave(raw, env()) : null;
      if (p && (p.kind === 'save' || p.kind === 'newer')) theirs = p.save;
    } catch { /* no storage to read: takenOver still locks this tab */ }
    run({ type: 'takenOver' }, theirs);
    return;
  }
  if (e.key !== SAVE_KEY || e.newValue === null) return; // a key removed by another tab: this tab's next write puts the save back
  const parsed = parseSave(e.newValue, env());
  const theirs: Theirs = parsed.kind === 'save' ? 'save' : parsed.kind === 'newer' ? 'newer' : 'unreadable';
  run({ type: 'otherTab', theirs }, parsed.kind === 'save' || parsed.kind === 'newer' ? parsed.save : null);
});
