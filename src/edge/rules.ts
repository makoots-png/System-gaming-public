// rules.ts: the rules a view sees. src/core/rules.ts holds the numbers and the pure helpers (they take the rules as an
// argument); this file reads the GM's overrides from the save and binds the helpers to them, so a view calls
// `xpToNext(level)` or `rules().fight`. On a player's phone in a room the room's rules (the GM's `rules` doc: the build
// and personal gates' switches and the economy's rules) are laid over the save's (`withRoomRules` in src/core/hunter/build.ts); nothing of the
// room is written to the save.
// It re-exports the constants of core/rules.ts and the day's clock of core/day.ts, so a view has one import.
import { RULES, rankForLevel as rankForLevelOf, rulesOf, xpToNext as xpToNextOf } from '../core/rules.ts';
import type { Rank, Rules } from '../core/rules.ts';
import type { StatusDef } from '../core/combat/effect-ops.ts';
import type { RoomRules } from '../core/protocol.ts';
import { withRoomRules } from '../core/hunter/build.ts';

export * from '../core/rules.ts';
export * from '../core/overrides.ts';
export * from '../core/day.ts';

/** The parts of the save the rules are made from. */
type RulesSource = { rulesOverrides: unknown; library: { statuses: Record<string, StatusDef> } };
let sourceOf: () => RulesSource | null = () => null;
/** The store calls this once, with a function that returns the current save. */
export function bindSave(getSave: () => RulesSource): void { sourceOf = getSave; }
let roomRulesOf: () => RoomRules | null = () => null;
/** sync.ts calls this once, with a function that answers the room's rules (the GM's `rules` doc) while this phone is a player in a room, else null. */
export function bindRoom(getRules: () => RoomRules | null): void { roomRulesOf = getRules; }

/**
 * What the rules in force were made from, and what they are. The save's overrides and the GM's statuses are compared by
 * reference: the store changes the save only through `store.update`, whose repair (src/core/save.ts) gives both a new
 * object on every write, so a new object is a write and the same object is none (tests/rules-in-force.test.ts holds the
 * repair to it). Turning them to JSON instead cost about 2 ms a read with 200 statuses of 2 KB, and a fight turn reads
 * the rules 13 to 30 times. The room's rules are a few switches, made new on each read, so they are compared as JSON.
 */
let made: { readonly overrides: unknown; readonly statuses: unknown; readonly room: string; readonly R: Rules } | null = null;
/**
 * The rules now in force: the shipped rules with the save's overrides and the GM's statuses merged in, and the room's
 * rules (its build and personal gates' switches) over them while in a room as a player. The same object until the save
 * is written or the room's rules change, so a caller may compare two answers to learn whether the rules may have moved.
 */
export function rules(): Rules {
  const s = sourceOf();
  if (!s) return RULES;
  const roomRules = roomRulesOf(), room = JSON.stringify(roomRules);
  if (!made || made.overrides !== s.rulesOverrides || made.statuses !== s.library.statuses || made.room !== room) {
    made = { overrides: s.rulesOverrides, statuses: s.library.statuses, room, R: withRoomRules(rulesOf(s.rulesOverrides, s.library.statuses), roomRules) };
  }
  return made.R;
}

export const xpToNext = (level: number): number => xpToNextOf(rules(), level);
export const rankForLevel = (level: number): Rank => rankForLevelOf(rules(), level);
