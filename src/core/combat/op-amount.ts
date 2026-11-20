// op-amount.ts: how much of an op a status carries on a body. The op's number at its source's tier (`atTier`), times
// the status's count (`countOn`: its stacks, or 1 for a plain status), and the sheet numbers a `sheet` op may change
// (`SHEET_OP_KEYS`). Pure. effect-ops.ts (a status's def and how it lands) and standing.ts (what a body's statuses say
// of it) both read these, and effect-ops.ts `modified` calls standing.ts, so they live here, where neither loads the
// other (tests/deps.test.ts refuses a cycle of value imports). The types stay in effect-ops.ts.

import type { StackDef, StackStatus, Status, StatusDef, Tiered, Tiers } from './effect-ops.ts';

/** The sheet numbers a `sheet` op may change (kits table 8.1). */
export const SHEET_OP_KEYS = ['armor', 'resist', 'pen', 'critFaces', 'exposed', 'critSize', 'costCut', 'range'] as const;

/** Whether a `Tiered` number holds one value per tier. */
export const isTiers = <T>(v: Tiered<T>): v is Tiers<T> => Array.isArray(v);
/** The value of a `Tiered` number at `tier` (0 to 5, its last value). */
export const atTier = <T>(v: Tiered<T>, tier: number): T => isTiers(v) ? v[Math.max(0, Math.min(v.length - 1, tier))]! : v;

export const isStacking = (def: StatusDef): def is StackDef => def.stack !== undefined;
/** Whether a status is of a stacking def, so it holds a count. */
export const stacked = (s: Status): s is StackStatus => isStacking(s.def);
/** What a status's per-stack numbers are multiplied by: its stacks, or 1 for a plain status (kits design 1.1 rule 4). */
export const countOn = (s: Status): number => (stacked(s) ? s.stacks : 1);
