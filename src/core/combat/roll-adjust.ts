// roll-adjust.ts: visible GM roll adjustment on extraction and Arise rolls (PR A). Pure.
// Separate from hidden Fight.fudge: stored per monster corpse (`MonsterRow.adjust`, absent when 0, within
// ±RULES.shadow.adjustMax), added to the roll total (never shifting the die face), cleared after one roll, and logged
// in both Fight.log and the dice roll log. Natural 20 still succeeds and natural 1 still fails.
import type { MonsterRow } from './effect-ops.ts';
import type { ExtractionOutcome } from './extraction.ts';

const NAT_FAIL = 1;
const NAT_SUCCESS = 20;

/** Upper bound of `RULES.shadow.adjustMax`'s domain (rules.ts): what fight-parse.ts accepts on stored rows. */
export const ADJUST_BOUND = 20;

/** Helper text shown beside the GM's Adjust roll controls on corpse cards and extraction modals. */
export const ADJUST_HINT = 'Adds to the total of the next extraction or Arise roll on this corpse. Applies to one roll. Players see it in the fight log. A natural 20 still succeeds and a natural 1 still fails.';

/** Raw extraction roll passed to the `extract` command: the natural d20 face, the hunter's check bonus, and the DC. */
export type ExtractRoll = {
  readonly natural: number;
  readonly bonus: number;
  readonly dc: number;
};

/** Extraction aspect kinds accepted by the fight's `extract` command and dice log labels. */
export const EXTRACT_KINDS = ['shadow', 'blood'] as const;
export type ExtractKind = (typeof EXTRACT_KINDS)[number];

/** Evaluated shadow extraction check with the applied GM adjustment, final total, and outcome. */
export type ExtractChecked = {
  readonly natural: number;
  readonly bonus: number;
  readonly adjust: number;
  readonly total: number;
  readonly dc: number;
  readonly outcome: ExtractionOutcome;
};

/** Evaluated blood extraction check with the applied GM adjustment, final total, and pass/fail result. */
export type BloodExtractChecked = {
  readonly natural: number;
  readonly bonus: number;
  readonly adjust: number;
  readonly total: number;
  readonly dc: number;
  readonly passed: boolean;
};

/** Whether `n` is a legal whole-number GM roll adjustment within `±max`. */
export const validRollAdjust = (n: number, max: number): boolean =>
  Number.isInteger(n) && Math.abs(n) <= max;

/** Whether `roll` carries a valid natural d20 face and whole-number bonus and DC. */
export const validExtractRoll = (roll: ExtractRoll): boolean =>
  Number.isInteger(roll.natural) && roll.natural >= NAT_FAIL && roll.natural <= NAT_SUCCESS
  && Number.isSafeInteger(roll.bonus) && Number.isSafeInteger(roll.dc);

/** Clamps a stored corpse adjustment inside `±max` in case the GM lowered `RULES.shadow.adjustMax` after setting it. */
export const clampedAdjust = (adjust: number | undefined, max: number): number => {
  const n = adjust ?? 0;
  return n === 0 ? 0 : Math.max(-max, Math.min(max, n));
};

/**
 * The one writer of `MonsterRow.adjust`: sets the visible signed adjustment for the next extraction or Arise roll on
 * `row`, or removes the field when `n === 0`. Returns `row` unchanged when already at `n`, or null when `n` is out of
 * range or not a whole number.
 */
export function adjustRollStep(row: MonsterRow, n: number, max: number): MonsterRow | null {
  if (!validRollAdjust(n, max)) return null;
  if ((row.adjust ?? 0) === n) return row;
  if (n === 0) return clearRollAdjust(row);
  return { ...row, adjust: n };
}

/** Removes any standing GM roll adjustment from `row` once one extraction or Arise roll consumes it. */
export function clearRollAdjust(row: MonsterRow): MonsterRow {
  if (row.adjust === undefined) return row;
  const { adjust: _drop, ...rest } = row;
  return rest;
}

/**
 * Evaluates one shadow extraction roll with `adjust` added to the total (never shifting the natural die face):
 * natural 1 crumbles the corpse, natural 20 or `natural + bonus + adjust >= dc` raises the shadow, else it fails.
 */
export function extractionCheck(roll: ExtractRoll, adjust = 0): ExtractChecked {
  const total = roll.natural + roll.bonus + adjust;
  const outcome: ExtractionOutcome = roll.natural === NAT_FAIL ? 'crumbled'
    : roll.natural === NAT_SUCCESS || total >= roll.dc ? 'risen'
      : 'failed';
  return { natural: roll.natural, bonus: roll.bonus, adjust, total, dc: roll.dc, outcome };
}

/**
 * Evaluates one blood extraction roll with `adjust` added to the total (never shifting the natural die face):
 * natural 1 always fails (never crumbling the corpse for Necromancer), natural 20 or `natural + bonus + adjust >= dc` passes.
 */
export function bloodExtractionCheck(roll: ExtractRoll, adjust = 0): BloodExtractChecked {
  const total = roll.natural + roll.bonus + adjust;
  const passed = roll.natural === NAT_FAIL ? false : roll.natural === NAT_SUCCESS || total >= roll.dc;
  return { natural: roll.natural, bonus: roll.bonus, adjust, total, dc: roll.dc, passed };
}

/** Breakdown text for Fight.log and extraction failure notices, e.g. `9 + 6 + 2 GM = 17 vs DC 15`. */
export function rollCheckText(natural: number, bonus: number, adjust: number, dc: number): string {
  const b = bonus >= 0 ? ` + ${bonus}` : ` - ${-bonus}`;
  const g = adjust === 0 ? '' : adjust > 0 ? ` + ${adjust} GM` : ` - ${-adjust} GM`;
  const total = natural + bonus + adjust;
  return `${natural}${b}${g} = ${total} vs DC ${dc}`;
}

/** Dice expression passed to `dice.roll` so the roll log's `[face] = total` matches its expression cleanly. */
export function extractDiceExpr(bonus: number, adjust: number): string {
  const b = `${bonus >= 0 ? '+' : '-'}${Math.abs(bonus)}`;
  const a = adjust === 0 ? '' : `${adjust > 0 ? '+' : '-'}${Math.abs(adjust)}`;
  return `1d20${b}${a}`;
}

/** Dice roll log label for an extraction roll, noting `(GM +n)` / `(GM -n)` only when non-zero. */
export function extractDiceLabel(kind: ExtractKind, name: string, adjust: number): string {
  const tag = adjust === 0 ? '' : ` (GM ${adjust > 0 ? `+${adjust}` : `-${-adjust}`})`;
  return `Extract ${kind}: ${name}${tag}`;
}
