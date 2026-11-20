// solo-run.ts: where this phone's solo run stands, from the tap on Enter alone until the window of its outcome closes
// (audit SM-gates-1). A run plays the hunter as it stands and stores nothing until its one write (`soloRan`), so a second
// run started meanwhile would play the same hunter again: a phone has at most one run in flight. A small machine: idle;
// asking (the odds read, then the question); playing (one play of the engine, with the round and moves it has reached);
// told (written, its window open). src/views/gates.js keeps one value and moves it only through `runPhaseStep`; the solo
// panel draws from it, every Enter alone disabled while a run is in flight (`mayEnter`) and the round and moves on the
// run's own card (`playingOn`), so a redraw of the panel in the middle of a run draws it again as it stands. The value is
// page memory, never the save: a reload in the middle of a run starts idle, and nothing of the run was written.
// docs/state-machines.md draws it ("A solo run on this phone").
import type { HunterId } from '../ids.ts';
import type { SoloGate } from './solo.ts';

/** This phone's solo run: none, or one in flight on `gate` for hunter `hid`. */
export type RunPhase =
  | { readonly at: 'idle' }
  | { readonly at: 'asking'; readonly gate: SoloGate; readonly hid: HunterId }
  | { readonly at: 'playing'; readonly gate: SoloGate; readonly hid: HunterId; readonly round: number; readonly moves: number }
  | { readonly at: 'told'; readonly gate: SoloGate; readonly hid: HunterId };
export const RUN_PHASES = ['idle', 'asking', 'playing', 'told'] as const satisfies readonly RunPhase['at'][];
/** No run: a phone starts so when the app opens. */
export const NO_RUN: RunPhase = { at: 'idle' };

/**
 * What moves it: `enter` a tap on Enter alone; `go` the question answered Enter alone, with the hunter still ready;
 * `played` the engine reached a round and a count of moves; `wrote` the run's one write was taken; `done` the run is
 * over, whatever happened: refused, declined, not ended, or its outcome's window closed.
 */
export type RunPhaseEvent =
  | { readonly type: 'enter'; readonly gate: SoloGate; readonly hid: HunterId }
  | { readonly type: 'go' }
  | { readonly type: 'played'; readonly round: number; readonly moves: number }
  | { readonly type: 'wrote' }
  | { readonly type: 'done' };
export const RUN_PHASE_EVENTS = ['enter', 'go', 'played', 'wrote', 'done'] as const satisfies readonly RunPhaseEvent['type'][];

type Cell<S extends RunPhase['at'], E extends RunPhaseEvent['type']> = (s: Extract<RunPhase, { at: S }>, e: Extract<RunPhaseEvent, { type: E }>) => RunPhase;
const stay = <S extends RunPhase>(s: S): S => s;
const over = (): RunPhase => NO_RUN;
/**
 * What each event does from each state. A cell that answers its state unchanged is a move that changes nothing: a tap on
 * Enter alone while a run is in flight is one, so it starts no second run.
 */
const TABLE: { readonly [S in RunPhase['at']]: { readonly [E in RunPhaseEvent['type']]: Cell<S, E> } } = {
  idle: { enter: (_, e) => ({ at: 'asking', gate: e.gate, hid: e.hid }), go: stay, played: stay, wrote: stay, done: stay },
  asking: { enter: stay, go: s => ({ at: 'playing', gate: s.gate, hid: s.hid, round: 0, moves: 0 }), played: stay, wrote: stay, done: over },
  playing: {
    enter: stay, go: stay,
    played: (s, e) => (s.round === e.round && s.moves === e.moves ? s : { ...s, round: e.round, moves: e.moves }),
    wrote: s => ({ at: 'told', gate: s.gate, hid: s.hid }), done: over,
  },
  told: { enter: stay, go: stay, played: stay, wrote: stay, done: over },
};

/** The run after `e`; the same value when `e` changes nothing, so a caller draws only a change. */
export function runPhaseStep(s: RunPhase, e: RunPhaseEvent): RunPhase {
  // The table's type pairs each state with its own cells, and each cell with its own event, so the cell for `s.at` and `e.type` takes them.
  const row = TABLE[s.at] as { readonly [E in RunPhaseEvent['type']]: (s: RunPhase, e: RunPhaseEvent) => RunPhase };
  return row[e.type](s, e);
}

/** Whether Enter alone may start a run: only while none is in flight on this phone. */
export const mayEnter = (s: RunPhase): boolean => s.at === 'idle';
/** The round and moves to draw on the card of `gate` for hunter `hid`: the run playing there, else null. */
export const playingOn = (s: RunPhase, gate: SoloGate, hid: HunterId): { readonly round: number; readonly moves: number } | null =>
  s.at === 'playing' && s.hid === hid && s.gate.kind === gate.kind && s.gate.id === gate.id ? { round: s.round, moves: s.moves } : null;
