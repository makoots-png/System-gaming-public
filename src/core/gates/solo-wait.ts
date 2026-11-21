// solo-wait.ts: a player's won run of a room's solo gate, until the GM's phone answers it (notes-2-solo.md section 5).
// Pure; the save holds the list (`settings.sync.runs`). The gate is the GM's phone's alone: this phone keeps only its
// claim, by the run's event id, so it never shows the room's gate cleared on its own word and never takes a reward twice.
//
// Delivery is the outbox's (src/core/sync/outbox.ts): the run's message is a letter there until the room takes it. What
// the outbox cannot show is stored here: that the room took it (`taken`, heard by sync.ts in the write that steps the
// letter `sent`, before the letter leaves the box), and that the room is gone (`gone`). A posted run whose letter the box no longer holds on its way (let
// go, or refused) reads as lost, from the box itself: the evidence stays true wherever a write stopped (a letter leaves
// the box as sent only in the write that marks the run taken).
//
// One run's life is a machine over what the player sees (`shownOf`): posted, taken, lost, and the end (answered or
// dismissed: out of the list). Its `TABLE` has every cell; docs/state-machines.md draws it ("A solo run waiting").
// A run the room took may be put away too: a GM's phone that missed it (a read-only tab, a gate cleared by hand) never
// answers it, and the run would hold its gate for good (audit SMX-gates-2.4). An answer after that pays nothing.

import type { Save } from '../save.ts';
import type { Outbox } from '../sync/outbox.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { parseEventId, parseRoomCode, parseSaveId } from '../ids.ts';
import type { EventId, GateId, HunterId, RoomCode } from '../ids.ts';
import { parseGateId } from './gate.ts';
import { timeOf } from '../day.ts';

/** What is stored of a waiting run: posted (its letter in the outbox or let go), taken (the room has it), gone (the room is gone). */
export const WAIT_STORED = ['posted', 'taken', 'gone'] as const;
export type WaitStored = (typeof WAIT_STORED)[number];
/** A player's won run of a room's solo gate, until the GM's phone answers it. */
export type WaitingRun = {
  readonly run: EventId; readonly room: RoomCode; readonly hid: HunterId; readonly gate: GateId; readonly name: string; readonly at: string; readonly state: WaitStored;
};
/** What the player sees of a waiting run. */
export const WAIT_STATES = ['posted', 'taken', 'lost'] as const;
export type WaitState = (typeof WAIT_STATES)[number];
/** Why a lost run is lost: the room refused its message, the outbox let it go, or the room is gone. */
export type LostWhy = 'refused' | 'dropped' | 'gone';
export const WAIT_EVENTS = ['taken', 'answered', 'roomGone', 'dismiss'] as const;
/**
 * What happens to a waiting run: the room took its message (sync.ts, with the outbox's `sent`); the GM's answer landed
 * (either verdict); the room no longer exists (the link's `gone`); the player put a lost or taken run away.
 */
export type WaitEvent = { readonly type: (typeof WAIT_EVENTS)[number] };
/** A run's next stored state, or `end` when it leaves the list; null where the event does not apply. */
type Cell = WaitStored | 'end' | null;

/**
 * Each shown state's answer to each event (notes-2-solo.md section 5: 3 states by 4 events, every cell). A posted run
 * cannot be put away: its letter is still queued or on its way, and the outbox makes it taken or lost.
 */
export const TABLE: { readonly [S in WaitState]: { readonly [E in WaitEvent['type']]: Cell } } = {
  posted: { taken: 'taken', answered: 'end', roomGone: 'gone', dismiss: null },
  taken: { taken: null, answered: 'end', roomGone: 'gone', dismiss: 'end' },
  lost: { taken: null, answered: null, roomGone: null, dismiss: 'end' },
};

/** What the player sees of `w` with the outbox `box`: a posted run whose letter is no longer queued or on its way is lost. */
export function shownOf(w: WaitingRun, box: Outbox): { readonly state: WaitState; readonly why: LostWhy | null } {
  if (w.state === 'gone') return { state: 'lost', why: 'gone' };
  if (w.state === 'taken') return { state: 'taken', why: null };
  const letter = box.find(e => e.id === w.run);
  if (letter && (letter.at === 'queued' || letter.at === 'sending')) return { state: 'posted', why: null };
  return { state: 'lost', why: letter ? 'refused' : 'dropped' };
}

/** `w` after `e`: the next run, `end` when it leaves the list, or `w` itself where the event does not apply. */
export function waitStep(w: WaitingRun, box: Outbox, e: WaitEvent): WaitingRun | 'end' {
  const to = TABLE[shownOf(w, box).state][e.type];
  return to === null ? w : to === 'end' ? 'end' : to === w.state ? w : { ...w, state: to };
}

/** At most this many runs wait at once: far past the gates a player can see (`WORLD_GATES`, 40, of which it wins each once). */
export const RUNS_MAX = 20;
const runsOf = (s: Pick<Save, 'settings'>): readonly WaitingRun[] => s.settings.sync.runs ?? [];
const withRuns = <S extends Pick<Save, 'settings'>>(s: S, runs: readonly WaitingRun[]): S =>
  ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, runs: [...runs] } } });

/** Run `w` waiting: added last; past `RUNS_MAX` the oldest lost one goes, else the oldest. One per run id. */
export function runPosted<S extends Pick<Save, 'settings'>>(s: S, w: WaitingRun): S {
  const runs = runsOf(s), box = s.settings.sync.outbox ?? [];
  if (runs.some(x => x.run === w.run)) return s;
  let next = [...runs, w];
  while (next.length > RUNS_MAX) { const i = next.findIndex(x => shownOf(x, box).state === 'lost'); next = next.filter((_, j) => j !== (i >= 0 ? i : 0)); }
  return withRuns(s, next);
}
/** Each run `pick` holds after `e`; refused (`no-run`) when none was there to take it. */
function stepRuns<S extends Pick<Save, 'settings'>>(s: S, pick: (w: WaitingRun) => boolean, e: WaitEvent): S | Refused<'no-run'> {
  const runs = runsOf(s), box = s.settings.sync.outbox ?? [];
  let hit = false;
  const next = runs.flatMap(w => {
    if (!pick(w)) return [w];
    const out = waitStep(w, box, e);
    if (out !== w) hit = true;
    return out === 'end' ? [] : [out];
  });
  return hit ? withRuns(s, next) : refuse('no-run');
}
/** The room took run `run`'s message (sync.ts, in the write that steps its letter `sent`). A message that is no run changes nothing. */
export const runTaken = <S extends Pick<Save, 'settings'>>(s: S, run: string): S => { const r = stepRuns(s, w => w.run === run, { type: 'taken' }); return 'ok' in r ? s : r; };
/** Room `room` is gone: each of its runs is lost. */
export const runsGone = <S extends Pick<Save, 'settings'>>(s: S, room: RoomCode): S => { const r = stepRuns(s, w => w.room === room, { type: 'roomGone' }); return 'ok' in r ? s : r; };
/**
 * The GM's answer to run `run` landed: it leaves the list. Refused (`no-run`) when no run of that id waits to be
 * answered, so a second answer (a second GM phone, a replay) pays nothing: the run's id is the player's guard.
 */
export const runAnswered = <S extends Pick<Save, 'settings'>>(s: S, run: string): S | Refused<'no-run'> => stepRuns(s, w => w.run === run, { type: 'answered' });
/**
 * The player put run `run` away: a lost one, or a taken one it stops waiting for (`mayDismiss`). Refused (`no-run`) for
 * a run still posted.
 */
export const runDismissed = <S extends Pick<Save, 'settings'>>(s: S, run: string): S | Refused<'no-run'> => stepRuns(s, w => w.run === run, { type: 'dismiss' });
/** Whether the player may put `w` away now (the table's `dismiss` cell): its card's Dismiss. */
export const mayDismiss = (w: WaitingRun, box: Outbox): boolean => TABLE[shownOf(w, box).state].dismiss !== null;
/** The gates hunter `hid` has a run of waiting in room `room` (soloReady's `waiting`: no second run of one gate before its answer). */
export const waitingGates = (s: Pick<Save, 'settings'>, room: RoomCode, hid: string): GateId[] => {
  const box = s.settings.sync.outbox ?? [];
  return runsOf(s).filter(w => w.room === room && w.hid === hid && shownOf(w, box).state !== 'lost').map(w => w.gate);
};

/** What a waiting run says on its gate's card. */
export const WAIT_WORDS: { readonly [S in WaitState]: string } & { readonly lost: string; readonly gone: string } = {
  posted: 'Cleared. Waiting for the room.',
  taken: 'Cleared. Waiting for the GM\'s phone to pay it.',
  lost: 'The room did not take this run, so it paid nothing. Its cost stays.',
  gone: 'The room is gone, so the run paid nothing. Its cost stays.',
};
/** The question before a taken run is put away: it gives up the pay. */
export const STOP_WAITING = {
  title: 'Stop waiting?',
  body: 'If the GM\'s phone pays this run later, it pays you nothing. Its cost stays, and you can enter the gate again.',
  confirm: 'Stop waiting',
} as const;
/** The words of `w` as the player sees it. */
export const waitWords = (w: WaitingRun, box: Outbox): string => { const s = shownOf(w, box); return s.why === 'gone' ? WAIT_WORDS.gone : WAIT_WORDS[s.state]; };

/** The stored runs, each read whole or dropped; at most `RUNS_MAX`, the newest. */
export function parseRuns(v: unknown): WaitingRun[] {
  const out: WaitingRun[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const run = parseEventId(o.run), room = parseRoomCode(o.room), hid = parseSaveId<'h'>(o.hid), gate = parseGateId(o.gate), at = timeOf(o.at);
    const state = WAIT_STORED.find(x => x === o.state);
    if (!run || !room || !hid || !gate || !at || !state || out.some(w => w.run === run)) continue;
    out.push({ run, room, hid, gate, name: typeof o.name === 'string' ? o.name.slice(0, 60) : '', at, state });
  }
  return out.slice(-RUNS_MAX);
}
