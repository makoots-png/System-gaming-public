// live-status.ts: resolves `applyStatus` ops marked `follow: true` against the current `R.conditions`, recursively up to
// the parser's depth cap (`MAX_DEPTH`). Pure, and preserves object identity when nothing changes.
import type { Ability } from './ability-types.ts';
import type { LandOp, Op, StatusDef } from './effect-ops.ts';
import type { Trigger } from './triggers.ts';
import type { ZoneSpec } from './zones.ts';

/** Conditions lookup table passed to live status resolution. */
export type ConditionMap = Readonly<Partial<Record<string, StatusDef>>>;

/** Matches `fight-parse.ts` (`opOf` nesting cap for `applyStatus` defs). */
const MAX_DEPTH = 3;

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

/** Resolves a single `Op` or `LandOp`: `applyStatus` with `follow: true` takes `conditions[key]` when present. */
export function liveOp<O extends Op | LandOp>(o: O, conditions: ConditionMap, depth = 0): O {
  if (o.op !== 'applyStatus') return o;
  const swapped = o.follow && Object.hasOwn(conditions, o.key) ? conditions[o.key] : undefined;
  const base = swapped ?? o.def;
  const def = depth < MAX_DEPTH ? liveStatusDef(base, conditions, depth + 1) : base;
  return def === o.def ? o : ({ ...o, def } as O);
}

/** Resolves a list of ops against `conditions`, preserving the input array when nothing changes. */
export function liveOps<O extends Op | LandOp>(ops: readonly O[], conditions: ConditionMap, depth = 0): readonly O[] {
  return mapSame(ops, o => liveOp(o, conditions, depth));
}

function liveTrigger(t: Trigger, conditions: ConditionMap, depth: number): Trigger {
  const ops = liveOps(t.ops, conditions, depth);
  return ops === t.ops ? t : { ...t, ops };
}

/** Resolves every `follow: true` `applyStatus` op inside a `StatusDef` (ops, triggers, delayed end, and stack threshold). */
export function liveStatusDef(def: StatusDef, conditions: ConditionMap, depth = 0): StatusDef {
  const ops = liveOps(def.ops, conditions, depth);
  const triggers = def.triggers ? mapSame(def.triggers, t => liveTrigger(t, conditions, depth)) : undefined;
  const endOps = def.end ? liveOps(def.end.ops, conditions, depth) : undefined;
  const th = def.stack?.threshold;
  const thOps = th ? liveOps(th.ops, conditions, depth) : undefined;
  if (ops === def.ops && triggers === def.triggers && (!def.end || endOps === def.end.ops) && (!th || thOps === th.ops)) {
    return def;
  }
  const nextEnd = def.end ? (endOps === def.end.ops ? def.end : { ...def.end, ops: endOps! }) : undefined;
  const nextStack = def.stack
    ? (th && thOps !== th.ops ? { ...def.stack, threshold: { ...th, ops: thOps! } } : def.stack)
    : undefined;
  return {
    ...def,
    ops,
    ...(triggers !== undefined ? { triggers } : {}),
    ...(nextEnd !== undefined ? { end: nextEnd } : {}),
    ...(nextStack !== undefined ? { stack: nextStack } : {}),
  } as StatusDef;
}

function liveZone(z: ZoneSpec, conditions: ConditionMap): ZoneSpec {
  const ops = liveOps(z.ops, conditions, 0);
  const end = z.end ? liveOps(z.end, conditions, 0) : undefined;
  const triggers = z.triggers ? mapSame(z.triggers, t => liveTrigger(t, conditions, 0)) : undefined;
  if (ops === z.ops && end === z.end && triggers === z.triggers) return z;
  return { ...z, ops, ...(end !== undefined ? { end } : {}), ...(triggers !== undefined ? { triggers } : {}) };
}

/** Resolves every `follow: true` `applyStatus` op inside an `Ability` (its own ops and any zone it lays). */
export function liveAbility(a: Ability, conditions: ConditionMap): Ability {
  const ops = liveOps(a.ops, conditions, 0);
  const zone = a.zone ? liveZone(a.zone, conditions) : undefined;
  if (ops === a.ops && zone === a.zone) return a;
  return { ...a, ops, ...(zone !== undefined ? { zone } : {}) };
}
