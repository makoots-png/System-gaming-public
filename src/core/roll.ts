// roll.ts: the facts of a logged roll that are set where it is rolled, so nothing works them out again from its words:
// what it was for (`RollKind`) and a check's DC and result (`checkResult`). The roll entry that holds them, with the
// hunter who rolled, is save.ts's `RollEntry`; the dice tray (src/views/dice.js) rolls and logs it. Pure.
import { oneOf } from './one-of.ts';

/**
 * What a roll was for. `check`: a stat check from the Dice view or the sheet. `die`: a roll from the Dice view's buttons
 * or expression. `other`: everything a rule rolls for itself (a shadow extraction, the fight's d20).
 */
export const ROLL_KINDS = ['check', 'die', 'other'] as const;
export type RollKind = (typeof ROLL_KINDS)[number];

/** A check rolled against a DC, and whether it succeeded. A roll with no DC has none. */
export type Check = { readonly dc: number; readonly success: boolean };
/** The highest DC a check is rolled against: bound for junk only (the rules' DCs are below 40). */
export const DC_MAX = 1000;

/** A check's result: a natural 20 succeeds and a natural 1 fails whatever the total; any other roll succeeds when its total meets the DC. */
export function checkResult(natural: number | null, total: number, dc: number): Check {
  return { dc, success: natural === 20 ? true : natural === 1 ? false : total >= dc };
}

/** A stored kind: one of `ROLL_KINDS`, else `other`. */
export const parseRollKind = (v: unknown): RollKind => oneOf(v, ROLL_KINDS, 'other');
/** A stored check: a whole DC from 0 to `DC_MAX` and a yes or no, else none. */
export function parseCheck(v: unknown): Check | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const { dc, success } = v as Record<string, unknown>;
  return Number.isInteger(dc) && (dc as number) >= 0 && (dc as number) <= DC_MAX && typeof success === 'boolean' ? { dc: dc as number, success } : null;
}
