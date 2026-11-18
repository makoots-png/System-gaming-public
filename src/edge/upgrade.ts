// upgrade.ts: carries out the app update (src/core/upgrade.ts). The room server refused this tab because it runs
// another build (426, reason `upgrade`): this file keeps the per-tab note, follows the new service worker (its count,
// its takeover) and reloads once. It is the one writer of the update's state and the one listener to the worker's
// messages; the pill reads the state through `updateNow` and `onUpdate`.
//
// State this file owns (the lint rule in tests/lint.test.ts allows these `let`s and no other):
//   update   the app update's state, written only by `send` below
//   quiet    the timer of `UPDATE_QUIET_MS`, restarted by each `wait` effect

import { NO_UPDATE, UPDATE_QUIET_MS, countOf, decideUpgrade, updateStep } from '../core/upgrade.ts';
import type { Update, UpdateEffect, UpdateEvent } from '../core/upgrade.ts';

/** Holds the server build this tab last reloaded for. Per tab, and gone when the tab closes. */
const KEY = 'hunter-system-upgrade';

export const STUCK_TEXT = 'This app is out of date and could not update itself. Close every tab of it and open it again.';

let update: Update = NO_UPDATE;
let quiet: ReturnType<typeof setTimeout> | undefined;
const watchers = new Set<(u: Update) => void>();

/** The app update's state now. */
export const updateNow = (): Update => update;
/** Calls `f` after each change of the update's state. */
export function onUpdate(f: (u: Update) => void): void { watchers.add(f); }

function reloadedFor(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; } // storage blocked: as if never reloaded; `noted` then decides
}

/** Notes that this tab reloads for `serverBuild`. False when the tab cannot keep the note. */
function noteReload(serverBuild: string): boolean {
  try { sessionStorage.setItem(KEY, serverBuild); return sessionStorage.getItem(KEY) === serverBuild; } catch { return false; } // storage blocked or full: the decision is stuck
}

function send(event: UpdateEvent, showStuck: (text: string) => void): void {
  const { state, effects } = updateStep(update, event);
  if (state !== update) { update = state; for (const f of watchers) f(state); }
  for (const fx of effects) run(fx, showStuck);
}

function run(fx: UpdateEffect, showStuck: (text: string) => void): void {
  const tell = (e: UpdateEvent) => send(e, showStuck);
  switch (fx) {
    case 'look': return look(tell);
    case 'wait': clearTimeout(quiet); quiet = setTimeout(() => tell({ type: 'quiet' }), UPDATE_QUIET_MS); return;
    case 'reload': clearTimeout(quiet); location.reload(); return;
    case 'stuck': showStuck(STUCK_TEXT); return;
  }
}

/** Asks the worker registration for the new build's worker, and follows that worker's count and takeover. */
function look(tell: (e: UpdateEvent) => void): void {
  if (!('serviceWorker' in navigator)) { tell({ type: 'looked', installing: false }); return; }
  const workers = navigator.serviceWorker;
  workers.addEventListener('message', (e: MessageEvent) => { const count = countOf(e.data); if (count) tell({ type: 'caching', count }); });
  workers.addEventListener('controllerchange', () => tell({ type: 'controlled' }));
  workers.getRegistration()
    .then(registration => (registration ? registration.update().then(() => registration.installing !== null) : false))
    .then(installing => tell({ type: 'looked', installing }), () => tell({ type: 'looked', installing: false }));
}

/**
 * Call when a room request came back 426 with reason `upgrade`. Reloads the tab once per server build, after the new
 * worker took over or said nothing for `UPDATE_QUIET_MS`. `showStuck` is called instead when the tab already
 * reloaded for this build and was refused again, or cannot note that it reloads.
 */
export function upgradeRefused(serverBuild: string, showStuck: (text: string) => void): void {
  const before = reloadedFor();
  send({ type: 'refused', decision: decideUpgrade({ serverBuild, reloadedFor: before, noted: noteReload(serverBuild) }) }, showStuck);
}
