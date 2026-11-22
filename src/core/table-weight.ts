// table-weight.ts: the GM's hidden weight on a hunter's dice outside a fight (docs/agent-handoff/features/notes-8-fudge.md
// section 2, ruling 5). Its shape is `TableWeight`, held in the GM's save (`Save.tableWeight`); `weightStep` is its one
// writer, called through `weighed` by the GM's Party board (src/views/gm.js) for a tap and for a player's d20 roll
// reaching the Table feed. It has no states, so no machine: each event sets a value. It is not the fight's weight
// (combat/fudge.ts): a fight starts at 0 whatever this holds. Each player's hunter hears its own `weightOf` in a `weigh`
// room message sealed to its phone (protocol.ts); this file names no other word for it, since a player's phone holds it.
import type { ForcedFace } from './combat/fight-types.ts';
import { FORCED_FACES } from './combat/fight-types.ts';
import { diceOf, parseFormula } from './formula.ts';
import { parseSheetKey } from './ids.ts';
import type { SheetKey } from './ids.ts';
import { oneOf } from './one-of.ts';
import { RULES } from './rules.ts';
import type { Save } from './save.ts';

/**
 * The largest weight that changes a face: one less than the sides of the largest die a formula may name (the shipped
 * `dice.maxSides`, which no GM's rules raise). Past it every die reads its top or bottom face, so a weight is kept within
 * it, which is no bound on what a die shows (ruling 6).
 */
export const WEIGHT_MAX = RULES.dice.maxSides - 1;

/**
 * The table weight: a whole number of faces for every hunter (`hunters`) and one of each hunter's own by its sheet key
 * (no entry: 0), the two added; plus means the dice fall the hunter's way. `forced`: a hunter's next d20 roll, set to 20
 * or 1 for that one roll. It stays as the GM set it until the GM sets it back.
 */
export type TableWeight = {
  readonly hunters: number;
  readonly own: Readonly<Record<SheetKey, number>>;
  readonly forced: Readonly<Record<SheetKey, ForcedFace>>;
};
/** No weight on anyone: the GM's save starts with it. */
export const NO_TABLE_WEIGHT: TableWeight = { hunters: 0, own: {}, forced: {} };

/** One hunter's weight: its total in faces (the hunters' plus its own) and its forced next d20 roll, or none. */
export type HunterWeight = { readonly total: number; readonly force: ForcedFace | null };

/**
 * What changes the table weight: the GM sets the hunters' weight or one hunter's own to `n`, or forces a hunter's next
 * d20 roll (null takes it off); or hunter `key` rolled `expr` and the roll reached the GM's Table feed, which spends its
 * force when `expr` has a d20.
 */
export type WeightEvent =
  | { readonly kind: 'hunters'; readonly n: number }
  | { readonly kind: 'own'; readonly key: SheetKey; readonly n: number }
  | { readonly kind: 'force'; readonly key: SheetKey; readonly face: ForcedFace | null }
  | { readonly kind: 'rolled'; readonly key: SheetKey; readonly expr: string };

const within = (n: number): number => Math.max(-WEIGHT_MAX, Math.min(WEIGHT_MAX, Math.trunc(n)));
const without = <V>(rec: Readonly<Record<SheetKey, V>>, key: SheetKey): Record<SheetKey, V> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key)) as Record<SheetKey, V>;

/** Whether a roll of `expr` (a formula as the dice tray logs it) throws a d20. A formula that does not read throws none. */
export function rollsD20(expr: string): boolean {
  const p = parseFormula(expr, RULES);
  return p.ok && diceOf(p.formula).some(d => d.sides === 20);
}

/**
 * The table weight after `e`. A weight or a force is set, never added; a hunter's own weight of 0 or a force of null
 * leaves no entry. What is set already answers `tw` itself, so a caller can tell nothing changed.
 */
export function weightStep(tw: TableWeight, e: WeightEvent): TableWeight {
  switch (e.kind) {
    case 'hunters': { const n = within(e.n); return tw.hunters === n ? tw : { ...tw, hunters: n }; }
    case 'own': {
      const n = within(e.n);
      if ((tw.own[e.key] ?? 0) === n) return tw;
      return { ...tw, own: n === 0 ? without(tw.own, e.key) : { ...tw.own, [e.key]: n } };
    }
    case 'force':
      if ((tw.forced[e.key] ?? null) === e.face) return tw;
      return { ...tw, forced: e.face === null ? without(tw.forced, e.key) : { ...tw.forced, [e.key]: e.face } };
    case 'rolled':
      return e.key in tw.forced && rollsD20(e.expr) ? { ...tw, forced: without(tw.forced, e.key) } : tw;
  }
}

/** The GM's save after `e` on its table weight: the step a view hands to `store.apply`. */
export const weighed = (save: Save, e: WeightEvent): Save => {
  const tw = weightStep(save.tableWeight, e);
  return tw === save.tableWeight ? save : { ...save, tableWeight: tw };
};

/** Hunter `key`'s weight: the hunters' plus its own, and its forced next roll. */
export const weightOf = (tw: TableWeight, key: SheetKey): HunterWeight => ({ total: tw.hunters + (tw.own[key] ?? 0), force: tw.forced[key] ?? null });

/** Whether any of the hunters `keys` (the ones at the table) has a weight or a forced roll: the GM's gold dot. */
export const weightOn = (tw: TableWeight, keys: readonly SheetKey[]): boolean =>
  keys.some(k => { const w = weightOf(tw, k); return w.total !== 0 || w.force !== null; });

/** A `weigh` message's body: one hunter's weight, for that hunter's phone. */
export type Weigh = { readonly to: [SheetKey] } & HunterWeight;
/**
 * What the GM's change from `before` to `after` sends: a `weigh` for each hunter of `keys` (the players' hunters in the
 * room) whose weight it changed, with that hunter's weight after. A weight is a total, so a copy sets the same value.
 */
export const weighsFor = (before: TableWeight, after: TableWeight, keys: readonly SheetKey[]): Weigh[] =>
  keys.flatMap(k => {
    const was = weightOf(before, k), now = weightOf(after, k);
    return was.total === now.total && was.force === now.force ? [] : [{ to: [k] as [SheetKey], ...now }];
  });

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
/**
 * A stored table weight, repaired: a weight that is not a whole number reads 0, one past `WEIGHT_MAX` is kept within it;
 * an entry under a key that is not a sheet key, a hunter's own 0, or a force but 1 or 20 is dropped.
 */
export function parseTableWeight(v: unknown): TableWeight {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return NO_TABLE_WEIGHT;
  const o = v as Record<string, unknown>, rec = (x: unknown): [string, unknown][] => (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.entries(x) : []);
  const own: Record<SheetKey, number> = {}, forced: Record<SheetKey, ForcedFace> = {};
  for (const [k, n] of rec(o.own)) { const key = parseSheetKey(k); if (key && isWhole(n) && n !== 0) own[key] = within(n); }
  for (const [k, f] of rec(o.forced)) { const key = parseSheetKey(k), face = oneOf(f, FORCED_FACES, null); if (key && face !== null) forced[key] = face; }
  return { hunters: isWhole(o.hunters) ? within(o.hunters) : 0, own, forced };
}
