// sight.ts: who perceives whom in a fight, one rule for every reader (docs/agent-handoff/features/notes-7-stealth.md
// sections 2 and 3, with the owner's rulings 1, 7 and 8 at its end). A viewer's `Eyes`, a body seen as a `Figure`, and how
// far the fight lets eyes look (`SightRange`): the rule `perceives` compares them. A reader turns its bodies into eyes
// and figures with `eyesOf` and `figureOf`, and its fight into a range with `rangeOf` or the whole map; whether a side
// perceives a body (`perceivedBy`) decides whom a use may pick, and `watched` where a hide may start. Pure. The
// geometry is space.ts `inSight`, the levels standing.ts `LEVELS`; a body's sight level is its sheet's (derive.ts,
// raised by its sight ops in standing.ts `withSheetOps`). Each case is in tests/sight.test.ts.
import { inSight, tiles } from './space.ts';
import type { Grid, Place, Side, Tiles } from './space.ts';
import { stealthLevel, stealthOf } from './standing.ts';
import type { Level } from './standing.ts';
import { isUp } from './row-hp.ts';
import type { Body } from './effect-ops.ts';
import type { Fight } from './fight-types.ts';
import type { Rules } from '../rules.ts';

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
 * A fight body as eyes see it: its place, its side, and its stealth: the level the stealth machine says it hides at
 * (standing.ts `stealthOf`), or null when it is seen (notes-7-stealth.md section 2, a body's stealth).
 */
export const figureOf = (b: Body): Figure => ({ place: b.place, side: b.side, stealth: stealthLevel(stealthOf(b)) });

/** How far a fight lets its bodies look: its fog's sight, or the whole map when it keeps no fog. */
export const rangeOf = (f: Pick<Fight, 'fog'>): SightRange => (f.fog ? { kind: 'tiles', n: f.fog.sight } : { kind: 'whole' });
/** What a question of sight reads of a fight: its bodies (the eyes), its map (the walls) and its fog (how far eyes look). */
export type Lookout = Pick<Fight, 'rows' | 'grid' | 'fog'>;
/**
 * Whether side `side` perceives `b`: some body of it does, by its own eyes, within the fight's range (`rangeOf`). One body
 * must both reach `b` and see its stealth level: a body with line of sight and a low sight beside one with a high sight
 * and no line does not bring `b` in. The one answer to whom a use may pick (resolve.ts `ready`, rule 2), whom a played
 * row chooses among (policy.ts): a body picks a target it cannot itself see when an ally sees it (the owner's ruling 7),
 * and which rows the party's doc holds (fight-doc.ts `fightDoc`).
 */
export const perceivedBy = (side: Side, b: Body, f: Lookout): boolean => {
  const fig = figureOf(b), range = rangeOf(f);
  return f.rows.some(o => o.side === side && perceives(eyesOf(o), fig, f.grid, range));
};
/**
 * Whether a foe that is up has `b`'s tile in its sight: the fog's, or `fight.sight` tiles with no fog kept, on a line a
 * wall does not stop (section 3's hide row: the body is seen as if not hidden). A hide that starts `unseen` lands only
 * when none does (standing.ts `stealthStep`).
 */
export const watched = (b: Body, f: Lookout, R: Pick<Rules, 'fight'>): boolean =>
  f.rows.some(o => o.side !== b.side && perceives(eyesOf(o), { ...figureOf(b), stealth: null }, f.grid, { kind: 'tiles', n: f.fog?.sight ?? tiles(R.fight.sight) }));
