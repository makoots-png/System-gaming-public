// charge.ts: what any use must meet and pay before it is aimed (docs/agent-handoff/rw/design.md section 3.1, rules 3 to
// 4): off its cooldown, its gates holding at the aim and a use left, its cost and its kit prices paid. Pure. Every use
// asks it the same way, whatever sets it off: a use and a channel's begin through `ready` (resolve.ts), an armed reaction
// as it fires (fight-react.ts), so a reaction is refused and charged as a use is. It imports neither of them. A new
// condition or price of a use is a function here, called in `charged`, with a test in tests/resolve.test.ts.

import type { Place } from './space.ts';
import { roundsOf, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import type { Ability, AbilityGate, Price } from './ability-types.ts';
import { rowHp } from './row-hp.ts';
import { rowLifeAfter } from './row-life.ts';
import { removeStatus, stackOf, withStatuses } from './effect-ops.ts';
import type { Body, OpRules, StatusKey } from './effect-ops.ts';
import { countOn, stacked } from './op-amount.ts';
import { alive, live } from './land.ts';
import { insideZone } from './triggers.ts';
import { stackStep } from './stacks.ts';
import { usesOf } from './uses.ts';

/**
 * Why rules 3 to 4 refuse a use. `tooLow`: a rank-capped consumable whose tier is below the user's rank (`Ability.maxTier`);
 * `gated`: a gate of rule 3b does not hold; `noUses`: its uses a fight or a gate are
 * spent (table 2.3); `hp`: an HP price would take the user to 0 or less; `stacks`: the user holds fewer stacks than a
 * price asks (kits design 1.4).
 */
export type ChargeRefusal = 'tooLow' | 'cooldown' | 'gated' | 'noUses' | 'mana' | 'hp' | 'stacks';

/** Structured reason why a use cannot be paid right now, with exact numbers for player- and GM-facing messages. */
export type ChargeFailure =
  | { readonly reason: 'tooLow' }
  | { readonly reason: 'cooldown'; readonly left: number }
  | { readonly reason: 'noUses'; readonly max: number; readonly per: 'fight' | 'gate' }
  | { readonly reason: 'gated'; readonly gate: 'holds'; readonly key: StatusKey; readonly label: string; readonly on: 'self' | 'target'; readonly need: number; readonly have: number }
  | { readonly reason: 'gated'; readonly gate: 'inside'; readonly zone: string }
  | { readonly reason: 'mana'; readonly need: number; readonly have: number }
  | { readonly reason: 'hp'; readonly cost: number; readonly need: number; readonly have: number }
  | { readonly reason: 'stacks'; readonly key: StatusKey; readonly label: string; readonly need: number; readonly have: number }
  | { readonly reason: 'zone'; readonly name: string | null };

/** One status entry as affordability checks read it, from either a fight `Body` or a room doc row. */
export type ChargeStatus = {
  readonly key: StatusKey;
  readonly label?: string;
  readonly stacks?: number;
  readonly zone?: unknown;
  readonly owed?: true;
};

/** What an affordability check reads of the user, from either a full fight `Body` or a player's doc row + sheet. */
export type ChargeActor = {
  readonly hp: number;
  readonly hpMax: number;
  readonly mana: number;
  readonly costCut: number;
  readonly tier: number;
  readonly readyAt: Readonly<Record<string, Tick>>;
  readonly used?: Readonly<Record<string, number>>;
  readonly left?: Readonly<Record<string, number>>;
  readonly statuses: readonly ChargeStatus[];
  readonly inside?: (zone: string) => boolean;
};

/** Optional target and field context for an affordability check when the aim or zones are known. */
export type ChargeContext = {
  readonly targetStatuses?: readonly ChargeStatus[] | null;
  readonly hasZone?: (price: Extract<Price, { kind: 'zone' }>) => boolean;
  readonly statusLabel?: (key: StatusKey) => string;
};

const samePlace = (a: Place, b: Place): boolean => a.x === b.x && a.y === b.y;
const statusCount = (list: readonly ChargeStatus[], key: StatusKey): number => {
  const s = list.find(x => x.key === key && !x.owed);
  return s ? (s.stacks ?? 1) : 0;
};
const fallbackLabel = (key: StatusKey, list: readonly ChargeStatus[], lookup?: (k: StatusKey) => string): string =>
  list.find(x => x.key === key)?.label ?? lookup?.(key) ?? key.replace(/-/g, ' ');

// Rule 3.
export const onCooldown = (a: Ability, user: Body, now: Tick): boolean => now < (user.readyAt[a.id] ?? 0);
/**
 * Rule 19's cooldown with ability haste, League of Legends' formula (the owner, Nov 21: "make haste work like it does in
 * LoL"): `base * 100 / (100 + haste)`, in ticks. `haste` is whole points, 0 or more (the sheet's `haste`): each point
 * gives the same extra uses over time, so 100 halves a cooldown and 200 makes it a third, and no haste reaches 0. The
 * result is rounded up to a whole tick, so a cooldown above 0 stays at least 1 tick and only a cooldown of 0 is none.
 */
export const cooldownOf = (base: number, haste: number): number => Math.ceil(base * 100 / (100 + haste));
/** A user that has just used `a` at `now`, with `a` ready again once its hasted cooldown (`cooldownOf`) has passed: the one place a cooldown is set. */
export const cooled = (a: Ability, user: Body, now: Tick): Body =>
  ({ ...user, readyAt: { ...user.readyAt, [a.id]: tick(now + cooldownOf(a.cost.cooldown, user.sheet.haste)) } });

/** The stacks of `key` a body holds: its count for a stacking status, 1 for a plain one, 0 for none. */
export const stacksOn = (b: Body, key: StatusKey): number => { const s = live(b).find(x => x.key === key); return s ? countOn(s) : 0; };
// Rule 3b (kits design 1.4): every `holds` gate holds: the user, or the body at the aim, has at least `atLeast` stacks of
// the status (1 for a plain one: a mode); and an ability limited to n uses a fight or a gate has one left on the user's
// row (uses.ts, table 2.3).
export function gated(a: Ability, user: Body, bodies: readonly Body[], at: Place): 'gated' | 'noUses' | null {
  const target = bodies.find(b => alive(b) && samePlace(b.place, at));
  const held = (g: Extract<AbilityGate, { kind: 'holds' }>): number => (g.on === 'self' ? stacksOn(user, g.key) : target ? stacksOn(target, g.key) : 0);
  if ((a.gates ?? []).some(g => g.kind === 'holds' && held(g) < g.atLeast)) return 'gated';
  if ((a.gates ?? []).some(g => g.kind === 'inside' && !insideZone(user, g.zone))) return 'gated';
  return usesOf(a, user)?.at === 'spent' ? 'noUses' : null;
}

/** An HP price's HP for a body of `hpMax`: a flat number, or its share of max HP rounded up. */
export const hpPrice = (p: Extract<Price, { kind: 'hp' }>, hpMax: number): number => (p.amount.kind === 'flat' ? p.amount.n : Math.ceil(p.amount.share * hpMax));
/** Total HP spent by all HP prices on `a` for a body of `hpMax`, 0 when none. */
export const hpPriceTotal = (a: Pick<Ability, 'prices'>, hpMax: number): number =>
  (a.prices ?? []).reduce((n, p) => (p.kind === 'hp' ? n + hpPrice(p, hpMax) : n), 0);

/**
 * Checks whether `actor` can afford every cost, cooldown, use limit, gate, and price of `a` right now, before anything
 * commits. Returns null when affordable, or the first structured `ChargeFailure` with exact needed and held counts.
 */
export function affordCheck(
  a: Ability,
  actor: ChargeActor,
  now: Tick,
  R: { readonly fight: { readonly round: number } },
  ctx: ChargeContext = {},
): ChargeFailure | null {
  if (a.maxTier !== undefined && actor.tier > a.maxTier) return { reason: 'tooLow' };
  const readyAt = Object.hasOwn(actor.readyAt, a.id) ? actor.readyAt[a.id]! : 0;
  if (now < readyAt) return { reason: 'cooldown', left: Math.ceil((readyAt - now) / R.fight.round) };
  for (const g of a.gates ?? []) {
    if (g.kind === 'holds') {
      if (g.on === 'self') {
        const have = statusCount(actor.statuses, g.key);
        if (have < g.atLeast) return { reason: 'gated', gate: 'holds', key: g.key, label: fallbackLabel(g.key, actor.statuses, ctx.statusLabel), on: 'self', need: g.atLeast, have };
      } else if (ctx.targetStatuses !== undefined) {
        const list = ctx.targetStatuses ?? [];
        const have = statusCount(list, g.key);
        if (have < g.atLeast) return { reason: 'gated', gate: 'holds', key: g.key, label: fallbackLabel(g.key, list, ctx.statusLabel), on: 'target', need: g.atLeast, have };
      }
    } else if (g.kind === 'inside' && actor.inside && !actor.inside(g.zone)) {
      return { reason: 'gated', gate: 'inside', zone: g.zone };
    } else if (g.kind === 'uses') {
      const left = actor.left && Object.hasOwn(actor.left, a.id) ? actor.left[a.id]! : g.n - (actor.used?.[a.id] ?? 0);
      if (left <= 0) return { reason: 'noUses', max: g.n, per: g.per };
    }
  }
  const { mana } = costOf(a, actor.costCut);
  if (mana > actor.mana) return { reason: 'mana', need: mana, have: actor.mana };
  const totalHp = hpPriceTotal(a, actor.hpMax);
  if (totalHp > 0 && actor.hp <= totalHp) return { reason: 'hp', cost: totalHp, need: totalHp + 1, have: actor.hp };
  const stackNeed = new Map<StatusKey, number>();
  for (const p of a.prices ?? []) {
    if (p.kind !== 'stacks' || p.from !== 'self') continue;
    const held = statusCount(actor.statuses, p.key);
    const take = p.take.kind === 'all' ? Math.max(1, held) : Math.max(1, p.take.n);
    const need = (stackNeed.get(p.key) ?? 0) + take;
    if (held < need) return { reason: 'stacks', key: p.key, label: fallbackLabel(p.key, actor.statuses, ctx.statusLabel), need, have: held };
    stackNeed.set(p.key, need);
  }
  if (ctx.hasZone) {
    for (const p of a.prices ?? []) {
      if (p.kind === 'zone' && !ctx.hasZone(p)) return { reason: 'zone', name: p.name };
    }
  }
  return null;
}

/**
 * Rule 4's kit prices (kits design 1.4), paid with the mana: an HP price, refused at the HP it would take (never the
 * killing blow), past the shield; a price in the user's own stacks, refused when it holds fewer than `n` (or none for
 * `all`), whose count is the formula's `spent`. A zone price is the zones unit's (design 5.3 unit 9). Checks the whole
 * price before deducting anything so a refused use never mutates or partially pays.
 */
export function payPrices(a: Ability, user: Body, now: Tick, R: OpRules): { user: Body; spent: number } | ChargeRefusal {
  const totalHp = hpPriceTotal(a, user.sheet.hpMax);
  if (totalHp > 0 && rowHp(user) <= totalHp) return 'hp';
  const stackNeed = new Map<StatusKey, number>();
  for (const p of a.prices ?? []) {
    if (p.kind !== 'stacks' || p.from !== 'self') continue;
    const held = stacksOn(user, p.key);
    const take = p.take.kind === 'all' ? Math.max(1, held) : Math.max(1, p.take.n);
    const need = (stackNeed.get(p.key) ?? 0) + take;
    if (held < need) return 'stacks';
    stackNeed.set(p.key, need);
  }
  let u = user, spent = 0;
  for (const p of a.prices ?? []) {
    if (p.kind === 'hp') {
      const hp = hpPrice(p, u.sheet.hpMax);
      u = rowLifeAfter(u, { type: 'damage', amount: hp });
    } else if (p.kind === 'stacks' && p.from === 'self') {
      const held = stacksOn(u, p.key), take = p.take.kind === 'all' ? held : p.take.n;
      u = withStatuses(u, taken(u, p.key, take), now, R);
      spent += take;
    }
  }
  return { user: u, spent };
}
/** A body's statuses with `m` stacks of `key` taken by a price (table 2.1): a plain status goes whole; spent is not ended. */
export function taken(b: Body, key: StatusKey, m: number) {
  const s = live(b).find(x => x.key === key);
  if (!s || !stacked(s)) return removeStatus(b.statuses, key);
  const after = stackStep(stackOf(s), { type: 'price', m }, { rule: s.def.stack, at: null }).stack;
  return after.at === 'held' ? b.statuses.map(x => x.key === key ? { ...s, stacks: after.n } : x) : removeStatus(b.statuses, key);
}

// Rule 4: what a use costs its user, its fatigue and mana each cut by the user's `costCut`.
export const costOf = (a: Pick<Ability, 'cost'>, costCut: number): { readonly fatigue: number; readonly mana: number } =>
  ({ fatigue: Math.ceil(a.cost.fatigue * (1 - costCut)), mana: Math.ceil(a.cost.mana * (1 - costCut)) });
// Rule 4: paid before anything can miss. Mana must be on hand; fatigue rises to the capacity at most.
export function payCost(a: Ability, user: Body): Body | null {
  const { fatigue, mana } = costOf(a, user.sheet.costCut);
  if (mana > user.mana) return null;
  return { ...user, mana: user.mana - mana, fatigue: Math.min(user.sheet.fatigueMax, user.fatigue + fatigue) };
}

/**
 * Rules 3, 3b and 4 for a user, whatever it aims at: off its cooldown, its gates holding at `at` and a use left, its cost
 * and its kit prices paid. A use asks it after rule 2; an armed reaction asks it to fire (fight-react.ts), so a reaction
 * is refused and charged as a use is.
 */
export function charged(a: Ability, user: Body, bodies: readonly Body[], at: Place, now: Tick, R: OpRules): { user: Body; spent: number } | ChargeRefusal {
  if (a.maxTier !== undefined && user.tier > a.maxTier) return 'tooLow';
  if (onCooldown(a, user, now)) return 'cooldown';
  const gate = gated(a, user, bodies, at);
  if (gate) return gate;
  const cost = payCost(a, user);
  return cost === null ? 'mana' : payPrices(a, cost, now, R);
}

