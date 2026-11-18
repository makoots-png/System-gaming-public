// session-log.ts: the session log, the save's `log`, newest first, at most the rules' `logCap` lines; and the dice log,
// the save's `rolls`, newest first, at most `rollCap`. Pure.
// A view writes a line with `store.apply(reason, logged(line, R))`, or chains it after the change it records with
// `both(change, logged(line, R))`, so the change and its line land in one write. The id and the time are arguments:
// the store reserves the id (`store.id('l')`) and the view reads the clock.
// A core step that writes its own lines (a day that breaks several gates, a coin that lands) uses `told`, which takes
// each line's id from the save's `seq` as `store.id('l')` would, so the step needs no ids from outside.
import type { LogEntry, LogKind, RollEntry, Save } from './save.ts';
import type { Step } from './save-step.ts';
import { saveId } from './ids.ts';
import type { HunterId, LogId } from './ids.ts';
import type { QuestUpdatePayload } from './protocol.ts';
import { record } from './hunter/chronicle.ts';

/** How long a line's title and text may be (the save's repair cuts them the same). */
export const LOG_TITLE_MAX = 120, LOG_TEXT_MAX = 500;

/** A line of the log. `hunterId` null for a line about the campaign. */
export const logLine = (id: LogId, at: string, kind: LogKind, hunterId: HunterId | null, title: string, text: string): LogEntry =>
  ({ id, at, kind, hunterId, title, text });

/** The log with `lines` on top (the first given first) and what falls past `cap` dropped. */
const capped = (lines: readonly LogEntry[], log: readonly LogEntry[], cap: number): LogEntry[] => [...lines, ...log].slice(0, Math.max(1, Math.trunc(cap) || 1));

/** A step that puts `line` at the top of the log and drops what falls past the cap. */
export const logged = (line: LogEntry, R: { logCap: number }): Step<Save> => save => ({ ...save, log: capped([line], save.log, R.logCap) });

/**
 * A step that puts a roll at the top of the dice log and drops what falls past the cap. A check's natural 1 or 20 by a
 * hunter of this phone is a fact of its chronicle (chronicle.ts), recorded with it.
 */
export const rolled = (roll: RollEntry, R: { rollCap: number }): Step<Save> => save => {
  const rolls = [roll, ...save.rolls].slice(0, Math.max(1, R.rollCap)), natural = roll.natural;
  if (roll.hid === null || roll.kind !== 'check' || (natural !== 1 && natural !== 20)) return { ...save, rolls };
  return { ...save, rolls, hunters: save.hunters.map(h => (h.id === roll.hid ? record(h, { kind: 'roll', natural }) : h)) };
};
/** The dice log emptied. */
export const clearRolls: Step<Save> = save => ({ ...save, rolls: [] });

/** What a line says, for `told`: its kind, the hunter it is about, its words. */
export type Said = { kind: LogKind; hunterId: HunterId | null; title: string; text: string };
/** When `told` writes its lines, and how many lines the log keeps (the rules' `logCap`). */
export type Stamp = { at: string; cap: number };

/** The save with each of `lines` put on top in turn (the last given is the newest), each with the save's next `seq` as its id. */
export function told<S extends Pick<Save, 'log' | 'seq'>>(save: S, stamp: Stamp, ...lines: Said[]): S {
  if (!lines.length) return save;
  let seq = save.seq;
  const fresh = lines.map(l => logLine(saveId('l', ++seq), stamp.at, l.kind, l.hunterId, l.title.slice(0, LOG_TITLE_MAX), l.text.slice(0, LOG_TEXT_MAX))).reverse();
  return { ...save, seq, log: capped(fresh, save.log, stamp.cap) };
}

/** A quest's progress over all its objectives, as "3/5". */
export const objectivesSum = (os: readonly { readonly progress: number; readonly target: number }[]): string =>
  `${os.reduce((n, o) => n + o.progress, 0)}/${os.reduce((n, o) => n + o.target, 0)}`;

/**
 * The GM's log line for a player's quest progress (the room's `questUpdate`): who, which quest and how far, as done,
 * failed or the objectives' sum. It is about a hunter of another phone, so it names no hunter of this one (implicit
 * audit 2, N14: it was written under the GM's own active hunter).
 */
export function questUpdateSaid(p: Pick<QuestUpdatePayload, 'name' | 'title' | 'status' | 'objectives'>): Said {
  const name = p.name || 'Hunter', title = p.title || 'Quest';
  const text = p.status === 'done' ? `${name} COMPLETED ${title}` : p.status === 'failed' ? `${name} FAILED ${title}` : `${name} · ${title}${p.objectives.length ? ` ${objectivesSum(p.objectives)}` : ''}`;
  return { kind: 'quest', hunterId: null, title: p.status === 'done' ? 'Quest completed' : p.status === 'failed' ? 'Quest failed' : 'Quest progress', text };
}
