// table-weight.ts: the GM's hidden weight on a hunter's dice outside a fight (docs/agent-handoff/features/notes-8-fudge.md
// section 2, ruling 5). Its shape is `TableWeight`, held in the GM's save (`Save.tableWeight`); `weightStep` is its one
// writer, called through `weighed` by the GM's Party board (src/views/gm.js) for a tap and for a player's d20 roll
// reaching the Table feed. It has no states, so no machine: each event sets a value. It is not the fight's weight
// (combat/fudge.ts): a fight starts at 0 whatever this holds. Each player's hunter hears its own `weightOf` in a `weigh`
// room message sealed to its phone (protocol.ts): at each change (`weighsFor`) and when its phone joins the room
// (`weightsJoined`). The player's phone keeps what it heard (`HeldWeights`, `weightHeard`), draws its rolls with it
// (`drawnWith`) and spends a force there (`weightSpent`). The GM's phone owns the force: it spends it on a roll that
// shows the forced face (`showsForced`) and sends that spend like any change, so the two phones end on the same force.
// This file names no other word for it, since a player's phone holds it.
import type { ForcedFace } from './combat/fight-types.ts';
import { FORCED_FACES } from './combat/fight-types.ts';
import type { Weight } from './draws.ts';
import { diceOf, parseFormula } from './formula.ts';
import { parseRoomCode, parseSaveId, parseSheetKey } from './ids.ts';
import type { HunterId, RoomCode, SheetKey } from './ids.ts';
import { oneOf } from './one-of.ts';
import { RULES } from './rules.ts';
import type { Save } from './save.ts';
import { atSync, isRefused } from './save-step.ts';
import type { Step } from './save-step.ts';

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
 * d20 roll (null takes it off); or hunter `key` rolled `expr`, which showed the faces `rolls`, and the roll reached the
 * GM's Table feed, which spends its force when the roll shows the forced face (`showsForced`).
 */
export type WeightEvent =
  | { readonly kind: 'hunters'; readonly n: number }
  | { readonly kind: 'own'; readonly key: SheetKey; readonly n: number }
  | { readonly kind: 'force'; readonly key: SheetKey; readonly face: ForcedFace | null }
  | { readonly kind: 'rolled'; readonly key: SheetKey; readonly expr: string; readonly rolls: readonly number[] };

const within = (n: number): number => Math.max(-WEIGHT_MAX, Math.min(WEIGHT_MAX, Math.trunc(n)));
const without = <V>(rec: Readonly<Record<SheetKey, V>>, key: SheetKey): Record<SheetKey, V> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key)) as Record<SheetKey, V>;

/** Whether a roll of `expr` (a formula as the dice tray logs it) throws a d20. A formula that does not read throws none. */
export function rollsD20(expr: string): boolean {
  const p = parseFormula(expr, RULES);
  return p.ok && diceOf(p.formula).some(d => d.sides === 20);
}

/**
 * Whether a roll of `expr` that showed `rolls` (every face, in the order the dice tray logs them) can be one a force of
 * `face` drew: it throws a d20, and every face reads `face` when all its dice are d20s (a plain, advantage or
 * disadvantage roll, whose logged formula is the one before its edge), else `face` is among its faces. Every roll a force
 * drew answers true. A roll drawn before the force reached the player's phone answers true only when it fell on that
 * face anyway (1 in 20 for one d20): it shows the face the GM asked for, so the GM's phone takes it as the force's roll
 * and sends the spend, which takes the force off the player's phone too.
 */
export function showsForced(expr: string, rolls: readonly number[], face: ForcedFace): boolean {
  const p = parseFormula(expr, RULES);
  if (!p.ok) return false;
  const dice = diceOf(p.formula);
  if (!dice.some(d => d.sides === 20)) return false;
  return dice.every(d => d.sides === 20) ? rolls.length > 0 && rolls.every(f => f === face) : rolls.includes(face);
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
    {
      const face = tw.forced[e.key];
      return face !== undefined && showsForced(e.expr, e.rolls, face) ? { ...tw, forced: without(tw.forced, e.key) } : tw;
    }
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

/** The hunters of the room the GM's phone has sent their weight to since each joined: the room and their sheet keys. */
export type WeightsTold = { readonly room: RoomCode; readonly keys: readonly SheetKey[] };
/**
 * What the GM's phone sends as the room's sheets change (`keys`, the players' hunters in room `room`), given the hunters
 * it told before (`told`, its device memory, read here): each hunter that joined since, which is every one when the room
 * is another, hears its whole weight, 0 and no force too, since a phone back in the room may hold one the GM changed
 * while it was away. A hunter that left leaves the list, so its next join is told again.
 */
export function weightsJoined(told: unknown, room: RoomCode, keys: readonly SheetKey[], tw: TableWeight): { readonly told: WeightsTold; readonly weighs: Weigh[] } {
  const o = told !== null && typeof told === 'object' ? (told as Record<string, unknown>) : {};
  const before = o.room === room && Array.isArray(o.keys) ? o.keys : [];
  return { told: { room, keys: [...keys] }, weighs: keys.filter(k => !before.includes(k)).map(k => ({ to: [k] as [SheetKey], ...weightOf(tw, k) })) };
}

// ── on a player's phone: the weights it heard ──

/**
 * What a player's phone keeps of its hunters' weights (`settings.sync.weights`, a field of the phone's, so in no file):
 * the room they were heard in and each hunter's by id, as its last `weigh` set it, less a force a roll spent since.
 */
export type HeldWeights = { readonly room: RoomCode; readonly hunters: Readonly<Record<HunterId, HunterWeight>> };
/** No weight and no force: what a roll reads with none held. */
export const NO_WEIGHT: HunterWeight = { total: 0, force: null };
const withHeld = (save: Save, weights: HeldWeights): Save => atSync(sy => ({ ...sy, weights }))(save);

/** The save after this phone heard hunter `hid`'s weight `w` in room `room`: set, not added; what it held of another room goes. */
export function weightHeard(save: Save, room: RoomCode, hid: HunterId, w: HunterWeight): Save {
  const held = save.settings.sync.weights, kept = held?.room === room ? held.hunters : {};
  return withHeld(save, { room, hunters: { ...kept, [hid]: { total: w.total, force: w.force } } });
}

/** The weight hunter `hid`'s next roll reads on this phone, a player in room `room` (null: not a player in a room, so none). */
export const heldWeight = (held: HeldWeights | undefined, room: RoomCode | null, hid: HunterId): HunterWeight =>
  (room !== null && held?.room === room ? held.hunters[hid] : undefined) ?? NO_WEIGHT;

/**
 * How a roll of `expr` draws under `w` (draws.ts `Weight`): its force when it holds one and `expr` throws a d20, which sets
 * every d20 of the roll and leaves its other dice as they fall; else its total on every die.
 */
export const drawnWith = (w: HunterWeight, expr: string): Weight => (w.force !== null && rollsD20(expr) ? { forced: w.force } : w.total);

/** The save after hunter `hid` rolled `expr` on this phone, a player in room `room`: a roll that throws a d20 spends the force it held. */
export function weightSpent(save: Save, room: RoomCode | null, hid: HunterId, expr: string): Save {
  const held = save.settings.sync.weights, w = heldWeight(held, room, hid);
  if (!held || w.force === null || !rollsD20(expr)) return save;
  return withHeld(save, { ...held, hunters: { ...held.hunters, [hid]: { ...w, force: null } } });
}

/**
 * A roll on this phone as one write: `logged`, the step that logs it (session-log.ts `rolled`), then for hunter `hid` (none
 * for the GM's own roll) on this phone, a player in room `room`, the force it held spent (`weightSpent`).
 */
export const rolledWith = (logged: Step<Save>, room: RoomCode | null, hid: HunterId | null, expr: string): Step<Save> => save => {
  const s = logged(save);
  return isRefused(s) || hid === null ? s : weightSpent(s, room, hid, expr);
};

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

/** A stored `settings.sync.weights`, repaired: none unless it names a room; an entry under no hunter id, or whose weight is not whole, is dropped. */
export function parseHeldWeights(v: unknown): HeldWeights | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>, room = parseRoomCode(o.room);
  if (!room) return undefined;
  const hunters: Record<HunterId, HunterWeight> = {};
  const rec = o.hunters !== null && typeof o.hunters === 'object' && !Array.isArray(o.hunters) ? Object.entries(o.hunters) : [];
  for (const [k, w] of rec) {
    const hid = parseSaveId<'h'>(k), x = w !== null && typeof w === 'object' ? (w as Record<string, unknown>) : {};
    if (hid && isWhole(x.total)) hunters[hid] = { total: within(x.total), force: oneOf(x.force, FORCED_FACES, null) };
  }
  return { room, hunters };
}
