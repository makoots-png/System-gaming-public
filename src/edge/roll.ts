// roll.ts: the dice a fight asks for, the dice tray's die, the coin's true flip and a roll table's line (`pick`). The only place a draw
// is made; core never draws (docs/agent-handoff/rw/m2-plan.md 4.2 P6): src/core/draws.ts turns a source into dice, and this
// module gives it the browser's, or gives the odds engine a seed (`oddsSeed`). A view calls `rollNeeds` with what `needs` (resolve.ts) answered and sends the result as `Rolls`;
// `rollOpenings` gives `start` and `add` their `Opening`s; `rollSettle` gives `settle` its dice. Each takes a random
// source (a number in [0, 1)) so a test can pass a seeded one; the default reads `crypto.getRandomValues`. A dice term
// with Roll20's modifiers (src/core/formula.ts) is rolled face by face by `rollTerm`, which core reads; `rollFormula`
// rolls a whole formula with its faces, for a view that shows them.

import { diceOf, rolled } from '../core/formula.ts';
import { drawNeeds, drawOpenings, drawSettle, drawTerm, faceOf as face } from '../core/draws.ts';
import type { Dice, Formula, Rolled, Scope, TermRoll } from '../core/formula.ts';
import type { CombatantId } from '../core/combat/ability-types.ts';
import type { Needs, Rolls } from '../core/combat/resolve.ts';
import type { Opening } from '../core/combat/fight-types.ts';
import { sideOf } from '../core/coin.ts';
import type { CoinSide } from '../core/coin.ts';
import type { Random } from '../core/gates/spawn.ts';

/** A number in [0, 1): src/core/gates/spawn.ts. */
export type { Random };

const buffer = new Uint32Array(1);
/** The default source: 32 random bits from the browser's generator. */
export const cryptoRandom: Random = () => { crypto.getRandomValues(buffer); return buffer[0]! / 4294967296; };
/** A seed for the odds engine (src/core/combat/odds.ts): 32 random bits. */
export const oddsSeed = (random: Random = cryptoRandom): number => Math.floor(random() * 4294967296) >>> 0;

/**
 * One die of `sides` faces, for the dice tray (src/views/dice.js). Its source is the page's `Math.random` read at each
 * roll, as the tray's has always been, so the browser tests seed a check by replacing it.
 */
export const rollDie = (sides: number, random: Random = () => Math.random()): number => face(sides, random);
/** The dice tray's source for a whole typed roll (`rollFormula`): the page's `Math.random` read at each die, as `rollDie`'s. */
export const trayRandom: Random = () => Math.random();

/** One entry of `list`, each as likely, drawn from `random`: a line of the GM's roll tables. Undefined for an empty list. */
export const pick = <T>(list: readonly T[], random: Random = cryptoRandom): T | undefined => list[Math.floor(random() * list.length)];

/** A true flip of the coin (src/core/coin.ts): what a phone alone, or the GM's "Let the coin decide", lands on. */
export const flip = (random: Random = cryptoRandom): CoinSide => sideOf(random());

/** One dice term rolled: its faces drawn from `random` (src/core/draws.ts `drawTerm`). */
export const rollTerm = (d: Dice, random: Random = cryptoRandom): TermRoll => drawTerm(d, random);

/** The total of one dice term: the sum of `d.count` dice of `d.sides` faces, or what its modifiers make of them. */
export const rollDice = (d: Dice, random: Random = cryptoRandom): number => rollTerm(d, random).total;

/** A formula rolled: each dice term's faces and the total (the Dice view's typed formula, a check). */
export const rollFormula = (formula: Formula, scope: Scope, random: Random = cryptoRandom): Rolled =>
  rolled(formula, scope, diceOf(formula).map(d => rollTerm(d, random)));

/** Every die a use needs: one total per dice term for each target, a d20 for each reaction, a d20 for a refund with a chance. */
export const rollNeeds = (needs: Needs, random: Random = cryptoRandom): Rolls => drawNeeds(needs, random);

/** The opening of each row: a d20 and a d1000 for the tie. */
export const rollOpenings = (ids: readonly CombatantId[], random: Random = cryptoRandom): Opening[] => drawOpenings(ids, random);

/** The dice a `rollSettle` effect asks for: one total per term, in order. */
export const rollSettle = (dice: readonly Dice[], random: Random = cryptoRandom): number[] => drawSettle(dice, random);
