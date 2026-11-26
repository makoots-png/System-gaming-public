// live-status.ts: resolves `applyStatus` ops marked `follow: true` against the current `R.conditions`, recursively up to
// the parser's depth cap (`MAX_DEPTH`). Pure, and preserves object identity when nothing changes.
import type { Ability } from './ability-types.ts';
import type { LandOp, Op, StatusDef } from './effect-ops.ts';
import type { ZoneSpec } from './zones.ts';
import { withinSize } from '../size.ts';

/** Conditions lookup table passed to live status resolution. */
export type ConditionMap = Readonly<Partial<Record<string, StatusDef>>>;

/** Matches `fight-parse.ts` (`opOf` nesting cap for `applyStatus` defs). */
const MAX_DEPTH = 3;
const EMPTY_CONDITIONS: ConditionMap = {};

/** Drops `applyStatus` ops when nesting reaches `MAX_DEPTH` (`fight-parse.ts` refuses them there). */
function stripApplyStatus<O extends Op | LandOp>(ops: readonly O[]): readonly O[] {
  return ops.some(o => o.op === 'applyStatus') ? ops.filter(o => o.op !== 'applyStatus') : ops;
}

/** Maps `list` with `fn`, returning `list` unchanged when every element keeps identity. */
function mapSame<T>(list: readonly T[], fn: (x: T) => T): readonly T[] {
  let out: T[] | null = null;
  for (let i = 0; i < list.length; i++) {
    const cur = list[i]!, next = fn(cur);
    if (next !== cur) {
      if (!out) out = list.slice(0, i);
      out.push(next);
    } else if (out) {
      out.push(cur);
    }
  }
  return out ?? list;
}

/**
 * Resolves a single `Op` or `LandOp`: `applyStatus` with `follow: true` takes `conditions[key]` when present and
 * recurses at `depth + 1`. Falls back to the op's stored `def` (trimmed to `MAX_DEPTH`) if the resolved def exceeds `THING_MAX.status`.
 */
export function liveOp<O extends Op | LandOp>(o: O, conditions: ConditionMap, depth = 0): O {
  if (o.op !== 'applyStatus') return o;
  const swapped = o.follow && Object.hasOwn(conditions, o.key) ? conditions[o.key] : undefined;
  const base = swapped ?? o.def;
  const resolved = liveStatusDef(base, conditions, depth + 1);
  const def = withinSize('status', resolved) ? resolved : liveStatusDef(o.def, EMPTY_CONDITIONS, depth + 1);
  return def === o.def ? o : ({ ...o, def } as O);
}

/** Resolves a list of ops against `conditions`, preserving the input array when nothing changes. */
export function liveOps<O extends Op | LandOp>(ops: readonly O[], conditions: ConditionMap, depth = 0): readonly O[] {
  return mapSame(ops, o => liveOp(o, conditions, depth));
}

/**
 * Resolves every `follow: true` `applyStatus` op inside a `StatusDef` (ops, triggers, delayed end, and stack threshold).
 * At `depth >= MAX_DEPTH`, strips `applyStatus` ops so nested defs never exceed the parser's depth cap.
 * Falls back to `def` (trimmed to `MAX_DEPTH`) when resolved expansions exceed `THING_MAX.status`.
 */
export function liveStatusDef(def: StatusDef, conditions: ConditionMap, depth = 0): StatusDef {
  const atCap = depth >= MAX_DEPTH;
  const step = <O extends Op | LandOp>(list: readonly O[]): readonly O[] => (atCap ? stripApplyStatus(list) : liveOps(list, conditions, depth));
  const ops = step(def.ops);
  const triggers = def.triggers ? mapSame(def.triggers, t => {
    const tOps = step(t.ops);
    return tOps === t.ops ? t : { ...t, ops: tOps };
  }) : undefined;
  const endOps = def.end ? step(def.end.ops) : undefined;
  const th = def.stack?.threshold;
  const thOps = th ? step(th.ops) : undefined;
  if (ops === def.ops && triggers === def.triggers && (!def.end || endOps === def.end.ops) && (!th || thOps === th.ops)) {
    return def;
  }
  const nextEnd = def.end ? (endOps === def.end.ops ? def.end : { ...def.end, ops: endOps! }) : undefined;
  const nextStack = def.stack
    ? (th && thOps !== th.ops ? { ...def.stack, threshold: { ...th, ops: thOps! } } : def.stack)
    : undefined;
  const next = {
    ...def,
    ops,
    ...(triggers !== undefined ? { triggers } : {}),
    ...(nextEnd !== undefined ? { end: nextEnd } : {}),
    ...(nextStack !== undefined ? { stack: nextStack } : {}),
  } as StatusDef;
  if (atCap || conditions === EMPTY_CONDITIONS || withinSize('status', next)) return next;
  // Shrink nested recursion depth before giving up on live updates so small follow ops (like Grievous Wounds) still resolve.
  if (depth + 1 < MAX_DEPTH) {
    const shallower = liveStatusDef(def, conditions, depth + 1);
    if (withinSize('status', shallower)) return shallower;
  }
  return liveStatusDef(def, EMPTY_CONDITIONS, depth);
}

function liveZone(z: ZoneSpec, conditions: ConditionMap): ZoneSpec {
  const ops = liveOps(z.ops, conditions, 0);
  const end = z.end ? liveOps(z.end, conditions, 0) : undefined;
  const triggers = z.triggers ? mapSame(z.triggers, t => {
    const tOps = liveOps(t.ops, conditions, 0);
    return tOps === t.ops ? t : { ...t, ops: tOps };
  }) : undefined;
  if (ops === z.ops && end === z.end && triggers === z.triggers) return z;
  return { ...z, ops, ...(end !== undefined ? { end } : {}), ...(triggers !== undefined ? { triggers } : {}) };
}

/** Resolves every `follow: true` `applyStatus` op inside an `Ability` (its own ops and any zone it lays). */
export function liveAbility(a: Ability, conditions: ConditionMap): Ability {
  const ops = liveOps(a.ops, conditions, 0);
  const zone = a.zone ? liveZone(a.zone, conditions) : undefined;
  if (ops === a.ops && zone === a.zone) return a;
  const next = { ...a, ops, ...(zone !== undefined ? { zone } : {}) };
  return withinSize('ability', next) ? next : a;
}
