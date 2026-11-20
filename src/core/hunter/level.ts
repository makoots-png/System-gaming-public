// level.ts: what a hunter's level is, stated once. Pure, and it imports nothing, so the rules (rules.ts) and the
// progress (progress.ts) both read it without loading each other.
//
// The game has no top level (the owner, Nov 20: "Fights work at any level up to 9999" is a bound for tests, not a level
// cap). MAX_LEVEL is the bound outside data is read within, and XP stops there so no hunter holds a level a reader
// refuses. Every reader of a level asks this file: a stored or imported hunter and a player's sheet (`levelOf`, hunter.ts
// `fixHunter`), a fight row (`parseLevel`, fight-parse.ts), a room's face of a hunter (protocol.ts), the GM's edit
// (progress.ts `setLevel`) and a rule that names a level (rules.ts `rankLevels`). A level bound written anywhere else is a
// lint failure (tests/lint.test.ts).

/** The first level, where every hunter starts. */
export const MIN_LEVEL = 1;
/** Bound for junk only. 1e9 XP, the largest award a room accepts, takes a level 1 hunter to level 4472 at 100 XP per level. */
export const MAX_LEVEL = 9999;

/** A level read from outside data, refused when it is not one: a whole number from MIN_LEVEL to MAX_LEVEL, else null. */
export const parseLevel = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= MIN_LEVEL && v <= MAX_LEVEL ? v : null;
/** The level nearest `v`, for a reader that mends rather than refuses: cut to a whole number within the bounds, MIN_LEVEL when `v` is no number. */
export const levelOf = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.trunc(v))) : MIN_LEVEL;
