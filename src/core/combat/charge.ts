// charge.ts: what any use must meet and pay before it is aimed (docs/agent-handoff/rw/design.md section 3.1, rules 3 to
// 4): off its cooldown, its gates holding at the aim and a use left, its cost and its kit prices paid. Pure. Every use
// asks it the same way, whatever sets it off: a use and a channel's begin through `ready` (resolve.ts), an armed reaction
// as it fires (fight-react.ts), so a reaction is refused and charged as a use is. It imports neither of them. A new
// condition or price of a use is a function here, called in `charged`, with a test in tests/resolve.test.ts.

import type { Place } from './space.ts';
import type { Tick } from './timeline.ts';
import type { Ability, AbilityGate, Price } from './ability-types.ts';
import { removeStatus, stackOf, withStatuses } from './effect-ops.ts';
import type { Body, OpRules, StatusKey } from './effect-ops.ts';
import { countOn, stacked } from './op-amount.ts';
import { alive, live } from './land.ts';
import { insideZone } from './triggers.ts';
import { stackStep } from './stacks.ts';
import { usesOf } from './uses.ts';

/**
 * Why rules 3 to 4 refuse a use. `gated`: a gate of rule 3b does not hold; `noUses`: its uses a fight or a rest are
 * spent (table 2.3); `hp`: an HP price would take the user to 0 or less; `stacks`: the user holds fewer stacks than a
 * price asks (kits design 1.4).
 */
export type ChargeRefusal = 'cooldown' | 'gated' | 'noUses' | 'mana' | 'hp' | 'stacks';

const samePlace = (a: Place, b: Place): boolean => a.x === b.x && a.y === b.y;


// Rule 3.
export const onCooldown = (a: Ability, user: Body, now: Tick): boolean => now < (user.readyAt[a.id] ?? 0);

/** The stacks of `key` a body holds: its count for a stacking status, 1 for a plain one, 0 for none. */
export const stacksOn = (b: Body, key: StatusKey, now: Tick): number => { const s = live(b, now).find(x => x.key === key); return s ? countOn(s) : 0; };
// Rule 3b (kits design 1.4): every `holds` gate holds: the user, or the body at the aim, has at least `atLeast` stacks of
// the status (1 for a plain one: a mode); and an ability limited to n uses a fight or a rest has one left on the user's
// row (uses.ts, table 2.3).
export function gated(a: Ability, user: Body, bodies: readonly Body[], at: Place, now: Tick): 'gated' | 'noUses' | null {
  const target = bodies.find(b => alive(b) && samePlace(b.place, at));
  const held = (g: Extract<AbilityGate, { kind: 'holds' }>): number => (g.on === 'self' ? stacksOn(user, g.key, now) : target ? stacksOn(target, g.key, now) : 0);
  if ((a.gates ?? []).some(g => g.kind === 'holds' && held(g) < g.atLeast)) return 'gated';
  if ((a.gates ?? []).some(g => g.kind === 'inside' && !insideZone(user, g.zone))) return 'gated';
  return usesOf(a, user)?.at === 'spent' ? 'noUses' : null;
}

/** An HP price's HP for a body of `hpMax`: a flat number, or its share of max HP rounded up. */
export const hpPrice = (p: Extract<Price, { kind: 'hp' }>, hpMax: number): number => (p.amount.kind === 'flat' ? p.amount.n : Math.ceil(p.amount.share * hpMax));
/**
 * Rule 4's kit prices (kits design 1.4), paid with the mana: an HP price, refused at the HP it would take (never the
 * killing blow), past the shield; a price in the user's own stacks, refused when it holds fewer than `n` (or none for
 * `all`), whose count is the formula's `spent`. A zone price is the zones unit's (design 5.3 unit 9).
 */
export function payPrices(a: Ability, user: Body, now: Tick, R: OpRules): { user: Body; spent: number } | ChargeRefusal {
  let u = user, spent = 0;
  for (const p of a.prices ?? []) {
    if (p.kind === 'hp') {
      const hp = hpPrice(p, u.sheet.hpMax);
      if (u.hp <= hp) return 'hp';
      u = { ...u, hp: u.hp - hp };
    } else if (p.kind === 'stacks' && p.from === 'self') {
      const held = stacksOn(u, p.key, now), take = p.take.kind === 'all' ? held : p.take.n;
      if (held < Math.max(1, take)) return 'stacks';
      u = withStatuses(u, taken(u, p.key, take, now), now, R);
      spent += take;
    }
  }
  return { user: u, spent };
}
/** A body's statuses with `m` stacks of `key` taken by a price (table 2.1): a plain status goes whole; spent is not ended. */
export function taken(b: Body, key: StatusKey, m: number, now: Tick) {
  const s = live(b, now).find(x => x.key === key);
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
  if (onCooldown(a, user, now)) return 'cooldown';
  const gate = gated(a, user, bodies, at, now);
  if (gate) return gate;
  const cost = payCost(a, user);
  return cost === null ? 'mana' : payPrices(a, cost, now, R);
}

