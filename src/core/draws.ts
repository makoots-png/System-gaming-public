// draws.ts: how a source of random numbers becomes a fight's dice, and the one seeded source core may hold. Core never
// draws on its own: every function here takes its source as an argument. The edge passes the browser's generator
// (src/edge/roll.ts `cryptoRandom`, whose `rollNeeds`, `rollOpenings`, `rollSettle` and `rollDice` are these with that
// default); the odds engine (src/core/combat/play.ts) passes `seededSource` over a seed the edge drew, so a played fight
// is the same fight for the same seed.
import { rollOf } from './formula.ts';
import type { Dice, TermRoll } from './formula.ts';
import { combatantId } from './combat/ability-types.ts';
import type { CombatantId } from './combat/ability-types.ts';
import type { Needs, Rolls } from './combat/resolve.ts';
import type { ForcedFace, Opening } from './combat/fight-types.ts';
import type { Random } from './gates/spawn.ts';

/** One die of `sides` faces: 1 to `sides`. */
export const faceOf = (sides: number, random: Random): number => 1 + Math.floor(random() * sides);

/**
 * The GM's weight on one draw (docs/agent-handoff/features/notes-8-fudge.md section 2): a whole number of faces each die
 * moves by (0 leaves it as it fell), or a face every d20 of the draw is set to (`forced`, one roll's 1 or 20).
 */
export type Weight = number | { readonly forced: ForcedFace };

/**
 * A face as `w` leaves it: moved `w` faces and kept on its die, `clamp(face + w, 1, sides)`; a d20 under a force shows the
 * forced face, and any other die under a force the face it fell on (a force touches d20s only).
 */
export function weighFace(face: number, sides: number, w: Weight): number {
  if (typeof w !== 'number') return sides === 20 ? w.forced : face;
  return Math.min(sides, Math.max(1, face + w));
}

/**
 * One dice term rolled: faces drawn from `random` as `rollOf` asks for them, until it has what it needs. A plain term
 * asks once for `count` faces; an exploding or rerolling one asks again for each die not yet standing. It ends: each ask
 * adds a face and a term reads at most count × (EXPLODE_MAX + 1) × (REROLL_MAX + 1) of them. Each face is weighed by
 * `weight` as it is drawn, so rerolls, explosions, keep and drop, and successes read the weighed face as a rolled one.
 * A die draws one number from `random` whether it is weighed or not, so a weight moves faces and never which numbers fall.
 */
export function drawTerm(d: Dice, random: Random, weight: Weight = 0): TermRoll {
  const faces: number[] = [];
  for (;;) {
    const r = rollOf(d, faces);
    if (!('more' in r)) return r;
    for (let i = 0; i < r.more; i++) faces.push(weighFace(faceOf(d.sides, random), d.sides, weight));
  }
}

/**
 * The GM's weight on each die of one use (src/core/combat/fudge.ts `weightsFor`): each target's dice by the target, each
 * target's reaction d20 and its second by the target, and the refund's d20. A missing entry is 0; a held die is never weighed.
 */
export type NeedWeights = {
  readonly dice: Readonly<Record<CombatantId, number>>; readonly react: Readonly<Record<CombatantId, Weight>>; readonly refund: Weight;
};
/** No weight on any die of a use: what a fight at `NO_FUDGE` gives, and what a draw with none is given. */
export const NO_WEIGHTS: NeedWeights = { dice: {}, react: {}, refund: 0 };

/** One d20 weighed by `w`, as a die of a term is (`weighFace`). */
const d20 = (random: Random, w: Weight): number => weighFace(faceOf(20, random), 20, w);

/**
 * Every die a use needs: one total per dice term for each target, a d20 for each reaction, a d20 for a refund with a
 * chance, each weighed by `w`. The numbers drawn from `random`, and their order, are the same whatever the weights.
 */
export function drawNeeds(needs: Needs, random: Random, w: NeedWeights = NO_WEIGHTS): Rolls {
  const dice: Record<CombatantId, number[]> = {};
  for (const [id, terms] of Object.entries(needs.dice)) dice[combatantId(id)] = terms.map(d => drawTerm(d, random, w.dice[combatantId(id)] ?? 0).total);
  const react: Record<CombatantId, number> = {};
  for (const id of needs.react) react[id] = d20(random, w.react[id] ?? 0);
  const base: Rolls = needs.refund ? { dice, react, refund: d20(random, w.refund) } : { dice, react };
  // rule 7b (kits design 8.2): a second d20 for a die with an edge, weighed as the first, and each held die by its id
  // (`heldDieId`: bearer, status and op), never weighed: it moves a face that already is
  const second = needs.second?.length ? Object.fromEntries(needs.second.map(id => [id, d20(random, w.react[id] ?? 0)])) : null;
  const boost = needs.boost?.length ? Object.fromEntries(needs.boost.map(b => [b.id, faceOf(b.sides, random)])) : null;
  return { ...base, ...(second ? { second } : {}), ...(boost ? { boost } : {}) };
}

/** The opening of each row: a d20 weighed by the row's entry in `w` (fudge.ts `openingWeights`) and a d1000 for the tie, never weighed. */
export const drawOpenings = (ids: readonly CombatantId[], random: Random, w: Readonly<Record<CombatantId, Weight>> = {}): Opening[] =>
  ids.map(id => ({ id, d20: d20(random, w[id] ?? 0), tie: faceOf(1000, random) }));

/** The dice a `settle` asks for: one total per term, in order, each term weighed by its entry in `w` (fudge.ts `settleWeights`). */
export const drawSettle = (dice: readonly Dice[], random: Random, w: readonly Weight[] = []): number[] =>
  dice.map((d, i) => drawTerm(d, random, w[i] ?? 0).total);

/**
 * A seeded source (mulberry32) whose whole state is one 32-bit number, so a caller that plays in steps keeps the state
 * in its own data: `seededSource(state)` answers the source and `state()`, the number to carry to the next step.
 */
export function seededSource(seed: number): { readonly random: Random; readonly state: () => number } {
  let a = seed >>> 0;
  const random = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { random, state: () => a };
}
