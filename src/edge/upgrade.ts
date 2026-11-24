// upgrade.ts: carries out the app update (src/core/upgrade.ts). The room server refused this tab because it runs
// another build (426, reason `upgrade`): this file keeps the per-tab note, follows the new service worker (its count,
// its takeover) and reloads once. It is the one writer of the update's state and the one listener to the worker's
// messages; the pill and the blocking takeover window read the state through `updateNow` and `onUpdate`.
//
// State this file owns (the lint rule in tests/lint.test.ts allows these `let`s and no other):
//   update   the app update's state, written only by `send` below
//   quiet    the timer of `UPDATE_QUIET_MS`, restarted by each `wait` effect
// and these containers: `queue` (the events told while a step runs, the running one at its head), `watchers`.

import { NO_UPDATE, STUCK_TEXT, UPDATE_QUIET_MS, countOf, decideUpgrade, updateStep } from '../core/upgrade.ts';
import type { Update, UpdateEffect, UpdateEvent } from '../core/upgrade.ts';

export { STUCK_TEXT };

type Looked = Extract<UpdateEvent, { type: 'looked' }>['worker'];

/** Holds the server build this tab last reloaded for. Per tab, and gone when the tab closes. */
const KEY = 'hunter-system-upgrade';

let update: Update = NO_UPDATE;
let quiet: ReturnType<typeof setTimeout> | undefined;
const watchers = new Set<(u: Update) => void>();
type Told = { event: UpdateEvent; showStuck: (text: string) => void };
/**
 * Each event told, with the `showStuck` of the refusal it came from. The head is the step that runs; an event its
 * effects tell at once (`note`, or `look` where there are no workers) waits behind it, so every effect runs against
 * the state its own step made and none runs after the tab left that state (SMX-sync-6.1).
 */
const queue: Told[] = [];

/** The app update's state now. */
export const updateNow = (): Update => update;
/** Calls `f` after each change of the update's state. */
export function onUpdate(f: (u: Update) => void): void { watchers.add(f); }

function reloadedFor(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; } // storage blocked: as if never reloaded; `noted` then decides
}

/** Notes that this tab reloads for `serverBuild`. False when the tab cannot keep the note. Only the `note` effect calls it. */
function noteReload(serverBuild: string): boolean {
  try { sessionStorage.setItem(KEY, serverBuild); return sessionStorage.getItem(KEY) === serverBuild; } catch { return false; } // storage blocked or full: the decision is stuck
}

function send(event: UpdateEvent, showStuck: (text: string) => void): void {
  queue.push({ event, showStuck });
  if (queue.length > 1) return; // a step runs: it takes this event once its effects are done
  try {
    while (queue.length > 0) {
      const head = queue[0]!;
      const { state, effects } = updateStep(update, head.event);
      if (state !== update) { update = state; for (const f of watchers) f(state); }
      for (const fx of effects) run(fx, state, head.showStuck);
      queue.shift();
    }
  } finally { queue.length = 0; } // an effect that threw: its error goes on to the caller, and the next event starts afresh
}

/** Carries out one effect of the step that made `u`. */
function run(fx: UpdateEffect, u: Update, showStuck: (text: string) => void): void {
  const tell = (e: UpdateEvent) => send(e, showStuck);
  switch (fx) {
    case 'note': if (u.at === 'noting') tell({ type: 'noted', kept: noteReload(u.build) }); return; // only a step into `noting` notes
    case 'look': return look(tell);
    case 'wait': clearTimeout(quiet); quiet = setTimeout(() => tell({ type: 'quiet' }), UPDATE_QUIET_MS); return;
    case 'reload': clearTimeout(quiet); location.reload(); return;
    case 'stuck': showStuck(STUCK_TEXT); return;
  }
}

/** Asks the worker registration for the new build's worker, and follows that worker's count and takeover. */
function look(tell: (e: UpdateEvent) => void): void {
  if (!('serviceWorker' in navigator)) { tell({ type: 'looked', worker: 'none' }); return; }
  const workers = navigator.serviceWorker;
  workers.addEventListener('message', (e: MessageEvent) => { const count = countOf(e.data); if (count) tell({ type: 'caching', count }); });
  workers.addEventListener('controllerchange', () => tell({ type: 'controlled' }));
  workers.getRegistration()
    .then(registration => (registration ? registration.update().then(() => foundIn(registration)) : 'none'))
    .then(worker => tell({ type: 'looked', worker }), () => tell({ type: 'looked', worker: 'none' }));
}

/** The new build's worker the registration holds after its update check: a worker still installing is the newer one. */
function foundIn(registration: ServiceWorkerRegistration): Looked {
  return registration.installing ? 'installing' : registration.waiting ? 'waiting' : 'none';
}

/**
 * Call when a room request came back 426 with reason `upgrade`. Reloads the tab once per server build, after the new
 * worker took over or said nothing for `UPDATE_QUIET_MS`. `showStuck` is called instead when the tab already
 * reloaded for this build and was refused again, or cannot note that it reloads.
 */
export function upgradeRefused(serverBuild: string, showStuck: (text: string) => void): void {
  send({ type: 'refused', decision: decideUpgrade({ serverBuild, reloadedFor: reloadedFor() }) }, showStuck);
}
