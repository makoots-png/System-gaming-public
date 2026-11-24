// upgrade.ts: the app update, one machine (docs/state-machines.md, "The app update"). A tab runs its build (`none`)
// until the room server refuses it for running another (a 426 `upgrade`). Then `decideUpgrade` says whether it may
// reload; if so it notes that it reloads for that build (`noting`), looks for the new build's service worker, follows
// that worker's count of the files it caches (`installing`), waits for it to take over once every file is cached
// (`ready`) and reloads (`reloading`). A tab that already reloaded for that build, or cannot keep the note, is `stuck`:
// it says so and never reloads, so it cannot loop. The note is the machine's own effect, written only on the way out
// of `none`, so a later refusal writes nothing. The worker (src/sw.js) counts its files with `counted` and `installOf`
// below, the same rule the tab reads.
// Pure: src/edge/upgrade.ts reads the inputs, sends the events and carries out the effects, one step at a time.
import type { ReadOnlyWhy } from './store-life.ts';

// ── the decision a refusal brings ──
export type UpgradeInput = {
  /** The build the server says it runs. */
  serverBuild: string;
  /** The server build this tab last reloaded for, or null when it has not reloaded for any. */
  reloadedFor: string | null;
};
export type Decision = { to: 'reload'; build: string } | { to: 'stuck' };

/**
 * `reload` at most once per server build: a tab that reloaded for it and was refused again is `stuck`. (A tab that
 * cannot note the reload is stuck too, at its `noted` event.) The tab's own build id is not an input: the server refused
 * it, whatever it believes it runs (a proxy that drops the header gives a refusal with equal ids).
 */
export function decideUpgrade(input: UpgradeInput): Decision {
  return input.reloadedFor === input.serverBuild ? { to: 'stuck' } : { to: 'reload', build: input.serverBuild };
}

// ── the worker's count ──
/** What the new build's worker has answered of the files the app needs: cached, failed, and how many there are. */
export type Count = { readonly done: number; readonly failed: number; readonly of: number };
/** `counting` while files are still out; `cached` when every file is; `failed` from the first file that failed. */
export type Install = 'counting' | 'cached' | 'failed';

export const firstCount = (of: number): Count => ({ done: 0, failed: 0, of });
/** The count after one more file answered. */
export const counted = (c: Count, ok: boolean): Count => (ok ? { ...c, done: c.done + 1 } : { ...c, failed: c.failed + 1 });
/** A worker with a file it could not cache must not take over: the app would open offline without that file. */
export const installOf = (c: Count): Install => (c.failed > 0 ? 'failed' : c.done === c.of ? 'cached' : 'counting');

/** The worker's message, `{ type: 'caching', done, failed, of }`, read at the boundary; null for anything else. */
export function countOf(data: unknown): Count | null {
  if (!data || typeof data !== 'object') return null;
  const { type, done, failed, of } = data as Record<string, unknown>;
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (type !== 'caching' || !whole(done) || !whole(failed) || !whole(of) || of === 0 || done + failed > of) return null;
  return { done, failed, of };
}

// ── the machine ──
export const UPDATE_STATES = ['none', 'noting', 'installing', 'ready', 'reloading', 'stuck'] as const;
export type UpdateState = (typeof UPDATE_STATES)[number];
export type Update =
  /** The tab runs its build; no server refused it. A worker installing in the background changes nothing here. */
  | { at: 'none' }
  /** Refused for `build`: the tab notes that it reloads for it (the `note` effect), so it never reloads twice for one build. */
  | { at: 'noting'; build: string }
  /** Noted; the tab looks for the new build's worker and follows its count (null until the worker's first word). */
  | { at: 'installing'; build: string; count: Count | null }
  /** The new worker cached every file; the tab reloads when it takes over. */
  | { at: 'ready'; build: string }
  /** The tab reloads into `build`. Nothing moves it after. */
  | { at: 'reloading'; build: string }
  /** Refused again for the build it reloaded for, or it cannot note the reload: it says so and never reloads. */
  | { at: 'stuck' };

export type UpdateEvent =
  /** A room request was refused for another build: the decision above. */
  | { type: 'refused'; decision: Decision }
  /** The note of `noting` is kept, or the tab cannot keep it (its storage is blocked or full), so a reload could repeat without end. */
  | { type: 'noted'; kept: boolean }
  /**
   * The worker registration's update check answered with the new build's worker: `installing` (its count follows),
   * `waiting` (installed with every file cached, about to take over), or `none` (no worker, workers blocked, the same
   * build, the new one already took over, or the check failed). A worker installing is newer than one waiting, so it wins.
   */
  | { type: 'looked'; worker: 'installing' | 'waiting' | 'none' }
  /** The new worker's count. */
  | { type: 'caching'; count: Count }
  /** A new worker took control of this page. */
  | { type: 'controlled' }
  /** No word from the worker for `UPDATE_QUIET_MS`. */
  | { type: 'quiet' };
export type UpdateEventType = UpdateEvent['type'];

/**
 * `note`: note that this tab reloads for the `noting` state's build, and send `noted`. `look`: ask the worker
 * registration to update. `wait`: (re)start the quiet timer. `reload`: stop the timer and reload the tab. `stuck`: say
 * the app could not update.
 */
export type UpdateEffect = 'note' | 'look' | 'wait' | 'reload' | 'stuck';
export type UpdateStep = { state: Update; effects: readonly UpdateEffect[] };

/**
 * How long the tab waits for any word from the worker (an answer to its look, a count, a takeover) before it reloads
 * anyway. Each word starts it again, so a slow phone that is still counting is never reloaded mid-count; where workers
 * are blocked the registration may never answer, and the reload then fetches the app from the network.
 */
export const UPDATE_QUIET_MS = 4000;

export const NO_UPDATE: Update = { at: 'none' };

const same = (u: Update): UpdateStep => ({ state: u, effects: [] });
const reload = (build: string): UpdateStep => ({ state: { at: 'reloading', build }, effects: ['reload'] });
const stuck: UpdateStep = { state: { at: 'stuck' }, effects: ['stuck'] };
/** Where a count leads: the reload when a file failed (the reload fetches the app from the network, and the browser tries the worker again), `ready` when every file is cached. */
const afterCount = (build: string, count: Count): UpdateStep => {
  const install = installOf(count);
  return install === 'failed' ? reload(build)
    : { state: install === 'cached' ? { at: 'ready', build } : { at: 'installing', build, count }, effects: ['wait'] };
};

type Cell<S extends UpdateState, E extends UpdateEventType> = (u: Extract<Update, { at: S }>, e: Extract<UpdateEvent, { type: E }>) => UpdateStep;
/** Each state's answer to each event. The typecheck asks for every cell. */
export const TABLE: { readonly [S in UpdateState]: { readonly [E in UpdateEventType]: Cell<S, E> } } = {
  none: {
    refused: (_, e) => (e.decision.to === 'reload' ? { state: { at: 'noting', build: e.decision.build }, effects: ['note'] } : stuck),
    noted: same, looked: same, caching: same, controlled: same, quiet: same,
  },
  /** A refusal while the tab notes, or later, is for the update already under way: it writes no second note. */
  noting: {
    refused: same,
    noted: (u, e) => (e.kept ? { state: { at: 'installing', build: u.build, count: null }, effects: ['look', 'wait'] } : stuck),
    looked: same, caching: same, controlled: same, quiet: same,
  },
  installing: {
    refused: same, noted: same,
    looked: (u, e) => (e.worker === 'installing' ? { state: u, effects: ['wait'] } : e.worker === 'waiting' ? { state: { at: 'ready', build: u.build }, effects: ['wait'] } : reload(u.build)),
    caching: (u, e) => afterCount(u.build, e.count),
    controlled: u => reload(u.build),
    quiet: u => reload(u.build),
  },
  ready: {
    refused: same, noted: same, looked: same, caching: same,
    controlled: u => reload(u.build),
    quiet: u => reload(u.build),
  },
  reloading: { refused: same, noted: same, looked: same, caching: same, controlled: same, quiet: same },
  stuck: { refused: same, noted: same, looked: same, caching: same, controlled: same, quiet: same },
};

/** The next state and what to do. A cell that changes nothing answers the same state object. */
export function updateStep(u: Update, e: UpdateEvent): UpdateStep {
  const cell = TABLE[u.at][e.type] as (u: Update, e: UpdateEvent) => UpdateStep;
  return cell(u, e);
}

// ── blocking takeover when the update is stuck ──
/** Why the blocking Variant 1 takeover window (src/views/takeover.js) is shown: a read-only store cause or a stuck update. */
export type TakeoverCause = ReadOnlyWhy | 'upgradeStuck';

/**
 * The active takeover cause, or null when the tab may run normally.
 * A stuck update takes priority over read-only causes: an out-of-date build must never offer Take over here.
 */
export const takeoverCause = (readOnlyWhy: ReadOnlyWhy | null, update: Update): TakeoverCause | null =>
  (update.at === 'stuck' ? 'upgradeStuck' : readOnlyWhy);

/** Plain summary shown when the app update is stuck (re-exported by src/edge/upgrade.ts). */
export const STUCK_TEXT = 'A newer version of The Hunter System is live, and the update did not finish. Close every tab with this app open, then open it again.';

/** Copy for the stuck-update Variant 1 blocking takeover window (src/views/takeover.js). */
export const UPGRADE_TAKEOVER_WORDS = {
  tag: 'Update required',
  heading: 'The update did not finish',
  body: [STUCK_TEXT, 'Tap Reload app to try loading the latest version here.'],
  exportNote: 'Tap Export backup first to download your data from this tab, including any unsaved changes.',
  reload: 'Reload app',
} as const;
