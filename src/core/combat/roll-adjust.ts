// roll-adjust.ts: hidden GM roll adjustment and forced natural 20/1 on extraction and Arise rolls. Pure.
// Separate from Fight.fudge: stored per monster corpse (`MonsterRow.adjust`, any whole number, absent when 0;
// `MonsterRow.force`, 20 or 1, absent when not forcing), cleared after one roll, and hidden from players in every
// projection, wire payload, dice log, and outcome text. Only the GM view shows it.
import type { MonsterRow } from './effect-ops.ts';
import type { ExtractionOutcome } from './extraction.ts';
import type { ForcedFace } from './fight-types.ts';

const NAT_FAIL = 1;
const NAT_SUCCESS = 20;

/** Helper text shown beside the GM's Adjust roll controls on corpse cards and extraction modals. */
export const ADJUST_HINT = 'Applies to the next extraction or Arise roll on this corpse, then clears. Only you see this.';

/** Raw extraction roll passed to the `extract` command: the natural d20 face, the hunter's check bonus, and the DC. */
export type ExtractRoll = {
  readonly natural: number;
  readonly bonus: number;
  readonly dc: number;
};

/** Extraction aspect kinds accepted by the fight's `extract` command and dice log labels. */
export const EXTRACT_KINDS = ['shadow', 'blood'] as const;
export type ExtractKind = (typeof EXTRACT_KINDS)[number];

/** Evaluated shadow extraction check with the applied GM adjustment or forced natural, final total, and outcome. */
export type ExtractChecked = {
  readonly natural: number;
  readonly bonus: number;
  readonly adjust: number;
  readonly forced: ForcedFace | null;
  readonly total: number;
  readonly dc: number;
  readonly outcome: ExtractionOutcome;
};

/** Evaluated blood extraction check with the applied GM adjustment or forced natural, final total, and pass/fail result. */
export type BloodExtractChecked = {
  readonly natural: number;
  readonly bonus: number;
  readonly adjust: number;
  readonly forced: ForcedFace | null;
  readonly total: number;
  readonly dc: number;
  readonly passed: boolean;
};

/** Whether `n` is a legal whole-number GM roll adjustment (any safe integer, uncapped). */
export const validRollAdjust = (n: number): boolean => Number.isSafeInteger(n);

/** Whether `face` is a legal forced natural d20 face (1 or 20). */
export const validForcedFace = (face: unknown): face is ForcedFace => face === NAT_FAIL || face === NAT_SUCCESS;

/** Whether `roll` carries a valid natural d20 face and whole-number bonus and DC. */
export const validExtractRoll = (roll: ExtractRoll): boolean =>
  Number.isInteger(roll.natural) && roll.natural >= NAT_FAIL && roll.natural <= NAT_SUCCESS
  && Number.isSafeInteger(roll.bonus) && Number.isSafeInteger(roll.dc);

/**
 * The one writer of `MonsterRow.adjust` and `MonsterRow.force`: sets either a hidden signed adjustment (any whole
 * number; 0 clears) or a forced natural d20 (20 or 1; null clears) for the next extraction or Arise roll on `row`.
 * Setting a forced natural clears any standing adjustment; setting an adjustment clears any standing force.
 * Returns `row` unchanged when already at the requested state, or null when the input is invalid.
 */
export function adjustRollStep(row: MonsterRow, change: { readonly n?: number; readonly force?: ForcedFace | null }): MonsterRow | null {
  if (change.n === undefined && change.force === undefined) return null;
  if (change.n !== undefined && !validRollAdjust(change.n)) return null;
  if (change.force !== undefined && change.force !== null && !validForcedFace(change.force)) return null;

  let nextAdjust: number | undefined;
  let nextForce: ForcedFace | undefined;
  if (change.force === NAT_SUCCESS || change.force === NAT_FAIL) {
    nextForce = change.force;
    nextAdjust = undefined;
  } else {
    nextForce = undefined;
    nextAdjust = change.n !== undefined ? (change.n === 0 ? undefined : change.n) : row.adjust;
  }

  if (row.adjust === nextAdjust && row.force === nextForce) return row;
  const base = clearRollAdjust(row);
  return {
    ...base,
    ...(nextAdjust !== undefined ? { adjust: nextAdjust } : {}),
    ...(nextForce !== undefined ? { force: nextForce } : {}),
  };
}

/** Removes any standing GM roll adjustment or forced natural from `row` once one extraction or Arise roll consumes it. */
export function clearRollAdjust(row: MonsterRow): MonsterRow {
  if (row.adjust === undefined && row.force === undefined) return row;
  const { adjust: _dropAdjust, force: _dropForce, ...rest } = row;
  return rest;
}

/**
 * Evaluates one shadow extraction roll with optional GM `adjust` or `force`:
 * when `force` is 20 or 1, it plays exactly as that natural face with 0 adjustment; otherwise `adjust` adds to the
 * total without shifting the natural die face. Natural 1 crumbles the corpse, natural 20 or total >= DC raises it.
 */
export function extractionCheck(roll: ExtractRoll, adjust = 0, force: ForcedFace | null = null): ExtractChecked {
  const natural = force ?? roll.natural;
  const effAdjust = force !== null ? 0 : adjust;
  const total = natural + roll.bonus + effAdjust;
  const outcome: ExtractionOutcome = natural === NAT_FAIL ? 'crumbled'
    : natural === NAT_SUCCESS || total >= roll.dc ? 'risen'
      : 'failed';
  return { natural, bonus: roll.bonus, adjust: effAdjust, forced: force, total, dc: roll.dc, outcome };
}

/**
 * Evaluates one blood extraction roll with optional GM `adjust` or `force`:
 * when `force` is 20 or 1, it plays exactly as that natural face with 0 adjustment; otherwise `adjust` adds to the
 * total without shifting the natural die face. Natural 1 always fails (never crumbling), natural 20 or total >= DC passes.
 */
export function bloodExtractionCheck(roll: ExtractRoll, adjust = 0, force: ForcedFace | null = null): BloodExtractChecked {
  const natural = force ?? roll.natural;
  const effAdjust = force !== null ? 0 : adjust;
  const total = natural + roll.bonus + effAdjust;
  const passed = natural === NAT_FAIL ? false : natural === NAT_SUCCESS || total >= roll.dc;
  return { natural, bonus: roll.bonus, adjust: effAdjust, forced: force, total, dc: roll.dc, passed };
}

/** Plain player-safe roll breakdown text (never carries GM adjustment or forced note), e.g. `20 + 6 = 26 vs DC 15`. */
export function plainRollCheckText(natural: number, bonus: number, dc: number): string {
  const b = bonus >= 0 ? ` + ${bonus}` : ` - ${-bonus}`;
  return `${natural}${b} = ${natural + bonus} vs DC ${dc}`;
}

/** GM-only breakdown text for Fight.log and GM failure notices, noting `GM` adjustment or `GM forced` when active. */
export function rollCheckText(natural: number, bonus: number, adjust: number, dc: number, forced: ForcedFace | null = null): string {
  if (forced !== null) return `${plainRollCheckText(natural, bonus, dc)}, GM forced ${forced}`;
  const b = bonus >= 0 ? ` + ${bonus}` : ` - ${-bonus}`;
  const g = adjust === 0 ? '' : adjust > 0 ? ` + ${adjust} GM` : ` - ${-adjust} GM`;
  const total = natural + bonus + adjust;
  return `${natural}${b}${g} = ${total} vs DC ${dc}`;
}

/** Plain dice expression passed to `dice.roll` (never includes GM adjustment so dice logs stay clean). */
export function extractDiceExpr(bonus: number): string {
  const b = `${bonus >= 0 ? '+' : '-'}${Math.abs(bonus)}`;
  return `1d20${b}`;
}

/** Plain dice roll log label for an extraction roll (never includes GM adjustment or forcing). */
export function extractDiceLabel(kind: ExtractKind, name: string): string {
  return `Extract ${kind}: ${name}`;
}
