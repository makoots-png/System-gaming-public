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
import type { Opening } from './combat/fight-types.ts';
import type { Random } from './gates/spawn.ts';

/** One die of `sides` faces: 1 to `sides`. */
export const faceOf = (sides: number, random: Random): number => 1 + Math.floor(random() * sides);

/**
 * One dice term rolled: faces drawn from `random` as `rollOf` asks for them, until it has what it needs. A plain term
 * asks once for `count` faces; an exploding or rerolling one asks again for each die not yet standing. It ends: each ask
 * adds a face and a term reads at most count × (EXPLODE_MAX + 1) × (REROLL_MAX + 1) of them.
 */
export function drawTerm(d: Dice, random: Random): TermRoll {
  const faces: number[] = [];
  for (;;) {
    const r = rollOf(d, faces);
    if (!('more' in r)) return r;
    for (let i = 0; i < r.more; i++) faces.push(faceOf(d.sides, random));
  }
}

/** Every die a use needs: one total per dice term for each target, a d20 for each reaction, a d20 for a refund with a chance. */
export function drawNeeds(needs: Needs, random: Random): Rolls {
  const dice: Record<CombatantId, number[]> = {};
  for (const [id, terms] of Object.entries(needs.dice)) dice[combatantId(id)] = terms.map(d => drawTerm(d, random).total);
  const react: Record<CombatantId, number> = {};
  for (const id of needs.react) react[id] = faceOf(20, random);
  const base: Rolls = needs.refund ? { dice, react, refund: faceOf(20, random) } : { dice, react };
  // rule 7b (kits design 8.2): a second d20 for a die with an edge, and each held die by its id (`heldDieId`: bearer, status and op)
  const second = needs.second?.length ? Object.fromEntries(needs.second.map(id => [id, faceOf(20, random)])) : null;
  const boost = needs.boost?.length ? Object.fromEntries(needs.boost.map(b => [b.id, faceOf(b.sides, random)])) : null;
  return { ...base, ...(second ? { second } : {}), ...(boost ? { boost } : {}) };
}

/** The opening of each row: a d20 and a d1000 for the tie. */
export const drawOpenings = (ids: readonly CombatantId[], random: Random): Opening[] =>
  ids.map(id => ({ id, d20: faceOf(20, random), tie: faceOf(1000, random) }));

/** The dice a `settle` asks for: one total per term, in order. */
export const drawSettle = (dice: readonly Dice[], random: Random): number[] => dice.map(d => drawTerm(d, random).total);

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
