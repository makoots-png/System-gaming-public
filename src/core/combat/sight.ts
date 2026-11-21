// sight.ts: who perceives whom in a fight, one rule for every reader (docs/agent-handoff/features/notes-7-stealth.md
// sections 2 and 3, with the owner's rulings 1 and 8 at its end). A viewer's `Eyes`, a body seen as a `Figure`, and how
// far the fight lets eyes look (`SightRange`): the rule `perceives` compares them. A reader turns its bodies into eyes
// and figures with `eyesOf` and `figureOf`, and its fight into a range with `rangeOf` or the whole map. Pure. The
// geometry is space.ts `inSight`, the levels standing.ts `LEVELS`; a body's sight level is its sheet's (derive.ts,
// raised by its sight ops in standing.ts `withSheetOps`). Each case is in tests/sight.test.ts.
import { inSight } from './space.ts';
import type { Grid, Place, Side, Tiles } from './space.ts';
import { holds, LEVELS } from './standing.ts';
import type { Level } from './standing.ts';
import { isUp } from './row-hp.ts';
import type { Body } from './effect-ops.ts';
import type { Fight } from './fight-types.ts';

/** A body that looks: where it stands, its side, whether it is up (a body that is down perceives no foe), and its sight level. */
export type Eyes = { readonly place: Place; readonly side: Side; readonly up: boolean; readonly sight: Level };
/** A body as eyes see it: where it stands, its side, and the level it hides at, or null when it is not hidden. */
export type Figure = { readonly place: Place; readonly side: Side; readonly stealth: Level | null };
/** How far eyes look: the whole map (a picked target, whose own reach and line decide), or `n` tiles on a clear line (the fog's sight). */
export type SightRange = { readonly kind: 'whole' } | { readonly kind: 'tiles'; readonly n: Tiles };

/**
 * Whether eyes `e` perceive figure `f`: its own side always; else `e` is up, `f` is in its range, and its sight is at
 * `f`'s stealth level or above. A body is hidden only from sight of a lower level (the owner's ruling 1).
 */
export function perceives(e: Eyes, f: Figure, grid: Grid, range: SightRange): boolean {
  if (e.side === f.side) return true;
  if (!e.up) return false;
  if (range.kind === 'tiles' && !inSight(e.place, f.place, grid, range.n)) return false;
  return f.stealth === null || e.sight >= f.stealth;
}

/** A fight body's eyes: its place, its side, whether it is up, and its sheet's sight level (after its sight ops). */
export const eyesOf = (b: Body): Eyes => ({ place: b.place, side: b.side, up: isUp(b), sight: b.sheet.sight });

/**
 * A fight body as eyes see it: its place, its side, and its stealth. The hidden op carries no level yet, so a body
 * holding one hides at the lowest level, the one notes-7-stealth.md section 2 gives a hidden op with none written.
 */
export const figureOf = (b: Body): Figure => ({ place: b.place, side: b.side, stealth: holds(b, 'hidden') ? LEVELS[0] : null });

/** How far a fight lets its bodies look: its fog's sight, or the whole map when it keeps no fog. */
export const rangeOf = (f: Pick<Fight, 'fog'>): SightRange => (f.fog ? { kind: 'tiles', n: f.fog.sight } : { kind: 'whole' });
