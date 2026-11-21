// sight-levels.ts: the levels a body's sight and a hidden body's stealth are read at
// (docs/agent-handoff/features/notes-7-stealth.md section 2). Plain data about levels, importing nothing: rules.ts and
// derive.ts read them, and standing.ts, which reads formula.ts and so sits above derive.ts, does too. Kept apart so that
// none of those three has to import another to know what a level is.

/**
 * The levels of sight and stealth, one per rank E to S, so a level can follow its source's rank as every tiered number
 * does. Not a hunter's level (hunter/level.ts). A level past 5 cannot be written.
 */
export const LEVELS = [0, 1, 2, 3, 4, 5] as const;
/** A sight or stealth level, 0 to 5 (`LEVELS`). */
export type Level = (typeof LEVELS)[number];
/**
 * A level a hidden op may hold, 1 to 5. Not 0: a body's sight starts at `fight.stealth.sightBase` (0) and a body is hidden
 * only from a lower sight (the owner's ruling 1), so a hide at 0 would hide from nobody.
 */
export type HideLevel = Exclude<Level, 0>;
/** The levels a hidden op may hold, lowest first: every level but 0. */
export const HIDE_LEVELS: readonly HideLevel[] = LEVELS.filter((l): l is HideLevel => l !== 0);
/** A number read into a level: rounded down, under 0 is 0, past 5 is 5, not a number is 0. */
export const asLevel = (n: number): Level => LEVELS[Math.min(LEVELS.length - 1, Math.max(0, Math.floor(n)))] ?? LEVELS[0];
