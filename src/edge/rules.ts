// rules.ts: the rules a view sees. src/core/rules.ts holds the numbers and the pure helpers (they take the rules as an
// argument); this file reads the GM's overrides from the save and binds the helpers to them, so a view calls
// `xpToNext(level)` or `rules().fight`. On a player's phone in a room the room's rules (the GM's `rules` doc: the build
// and personal gates' switches) are laid over the save's (`withRoomRules` in src/core/hunter/build.ts); nothing of the
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

let cacheKey = '', cacheVal: Rules = RULES;
/**
 * The rules now in force: the shipped rules with the save's overrides and the GM's statuses merged in, and the room's
 * rules (its build and personal gates' switches) over them while in a room as a player. The same object until one of those changes, so a caller may
 * compare two answers to learn whether the rules moved.
 */
export function rules(): Rules {
  const s = sourceOf();
  if (!s) return RULES;
  const room = roomRulesOf(), key = JSON.stringify([s.rulesOverrides, s.library.statuses, room]);
  if (key !== cacheKey) { cacheKey = key; cacheVal = withRoomRules(rulesOf(s.rulesOverrides, s.library.statuses), room); }
  return cacheVal;
}

export const xpToNext = (level: number): number => xpToNextOf(rules(), level);
export const rankForLevel = (level: number): Rank => rankForLevelOf(rules(), level);
