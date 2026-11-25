// op-amount.ts: how much of an op a status carries on a body. The op's number at its source's tier (`atTier`), times
// the status's count (`countOn`: its stacks, or 1 for a plain status), and the sheet numbers a `sheet` op may change
// (`SHEET_OP_KEYS`: the numbers it adds to and the levels it raises; `SHEET_FORMULA_KEYS`: those whose amount is a
// formula). Pure. effect-ops.ts (a status's def and how it lands) and standing.ts (what a body's statuses say of it) both
// read these, and effect-ops.ts `modified` calls standing.ts, so they live here, where neither loads the other
// (tests/deps.test.ts refuses a cycle of value imports).
// The types stay in effect-ops.ts.

import { average } from '../formula.ts';
import type { Formula, FormulaBody } from '../formula.ts';
import type { Op, SheetFormulaOp, StackDef, StackStatus, Status, StatusDef, Tiered, Tiers } from './effect-ops.ts';

/**
 * The sheet numbers whose `sheet` op takes a formula (item-stats.md 6.2): `withSheetOps` (standing.ts) reads each on its
 * bearer's bare body, the sheet `derive` made before any status, so `armor: 0.1 * hpmax` grows with its bearer.
 */
export const SHEET_FORMULA_KEYS = ['armor', 'resist', 'armorPen', 'resistPen', 'armorPenFlat', 'resistPenFlat', 'critFaces', 'critSize', 'costCut', 'mag', 'hpMax', 'drain', 'shieldDrain'] as const;
/**
 * The sheet numbers a `sheet` op adds to that stay plain numbers: each is read inside a use from the statuses alone, with
 * no bare body at hand (`exposedOf` reads a target's statuses for an attacker's crit faces, `rangeWith` a user's for its
 * range), so a formula there would have nothing to read.
 */
export const SHEET_USE_KEYS = ['exposed', 'range'] as const;
/** The sheet numbers a `sheet` op adds to: ops of one key add, as `stat` ops do (kits table 8.1). */
export const SHEET_ADD_KEYS = [...SHEET_FORMULA_KEYS, ...SHEET_USE_KEYS] as const;
/**
 * The sheet levels a `sheet` op raises: ops of one key do not add, the highest of them and the body's own is the level
 * (the owner's ruling 8 on sight, docs/agent-handoff/features/notes-7-stealth.md).
 */
export const SHEET_LEVEL_KEYS = ['sight'] as const;
/**
 * The sheet numbers a `sheet` op may change, each read one of the two ways above. A level stays a plain number, as the
 * use keys do: it is one of `LEVELS` (sight-levels.ts), the highest source is the level, and no amount grows into it.
 */
export const SHEET_OP_KEYS = [...SHEET_ADD_KEYS, ...SHEET_LEVEL_KEYS] as const;
/** Whether sheet op key `k` is a level, which ops raise to their highest, not a number they add to. */
export const isLevelKey = (k: (typeof SHEET_OP_KEYS)[number]): k is (typeof SHEET_LEVEL_KEYS)[number] => (SHEET_LEVEL_KEYS as readonly string[]).includes(k);
/** Whether sheet op key `k` takes a formula (`SHEET_FORMULA_KEYS`); every other key holds a plain number. */
export const isFormulaKey = (k: (typeof SHEET_OP_KEYS)[number]): k is (typeof SHEET_FORMULA_KEYS)[number] => (SHEET_FORMULA_KEYS as readonly string[]).includes(k);
/** Whether a `sheet` op's amount is a formula (its key is of `SHEET_FORMULA_KEYS`); when not, it is a plain number. */
export const isFormulaSheetOp = (o: Extract<Op, { readonly op: 'sheet' }>): o is SheetFormulaOp => isFormulaKey(o.key);

/** Whether a `Tiered` number holds one value per tier. */
export const isTiers = <T>(v: Tiered<T>): v is Tiers<T> => Array.isArray(v);
/** The value of a `Tiered` number at `tier` (0 to 5, its last value). */
export const atTier = <T>(v: Tiered<T>, tier: number): T => isTiers(v) ? v[Math.max(0, Math.min(v.length - 1, tier))]! : v;

export const isStacking = (def: StatusDef): def is StackDef => def.stack !== undefined;
/** Whether a status is of a stacking def, so it holds a count. */
export const stacked = (s: Status): s is StackStatus => isStacking(s.def);
/** What a status's per-stack numbers are multiplied by: its stacks, or 1 for a plain status (kits design 1.1 rule 4). */
export const countOn = (s: Status): number => (stacked(s) ? s.stacks : 1);

/**
 * A lasting change's amount at `tier` (a `stat` op's, or a `sheet` op's of `SHEET_FORMULA_KEYS`, item-stats.md 6.2): its
 * formula's average on its bearer's bare body (effect-ops.ts `bareBody`) as user and target, a die at its mean. The parser
 * lets such a formula read nothing else (fight-parse.ts `bareFormulaOf`): no target, no charge, none of the kits' names.
 */
export const bareAmount = (amount: Tiered<Formula>, tier: number, bare: FormulaBody): number =>
  average(atTier(amount, tier), { user: bare, target: bare, charge: 0 });
