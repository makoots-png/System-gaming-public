// use.ts: a thing used on its own user outside a fight, as one step. Pure. A consumable from the bag (`useItem`) or an
// active skill on oneself (`useOn`) puts its ops on the hunter's sheet: each amount op's formula at the source's tier
// with the dice the edge rolled (`useDice` says which), a status put on, a status cured, a note said. What each op did is
// read from the hunter before and after it, so the lines say what happened, never what was asked. The item leaves the
// bag in the same answer, so a use is written whole by one `store.apply` or not at all (implicit audit 2, N2).
//
// In a fight the fight's row holds the hunter's HP, mana, fatigue and statuses, so a use there is the fight's `act`
// (src/core/registry/abilities.ts `itemAbility`), never this: the caller asks `fightOf` first. An item that revives
// (`Item.revive`, the Resurrection Crystal) has no ability and is refused in a fight (`USE_WORDS.fight`): a dead hunter's
// row stays in the fight until it ends, and the GM's Revive is the way back inside one. A crystal has a rank, its
// rarity's (`rarities.*.rank`), and raises only a hunter of that rank or lower (`revives`; economy design section 5,
// the owner's ruling 4); the raising costs levels wherever it happens (grant.ts `sheetEdit`, ruling 9).
import { amountDice, amountOn } from '../effects.ts';
import { healsFully } from '../combat/effect-ops.ts';
import { liveOp } from '../combat/live-status.ts';
import { atTier } from '../combat/op-amount.ts';
import { roundsOf } from '../combat/timeline.ts';
import type { Op, Source } from '../combat/effect-ops.ts';
import type { Dice } from '../formula.ts';
import { RANKS } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import type { Hunter } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { raisedLine, sheetEdit } from './grant.ts';
import { record } from './chronicle.ts';
import type { SheetEdit } from './grant.ts';
import { heldItem, takeItems } from './inventory.ts';
import type { BagRules } from './inventory.ts';
import type { ResolvedItem } from '../registry/item-book.ts';
import { fitted, hunterSheet } from './sheet.ts';
import { hpOf, manaOf } from './vitals.ts';
import type { Item } from '../registry/items.ts';
import { itemOps, itemSource } from '../effects.ts';

const sign = (n: number): string => (n < 0 ? '−' : '+') + Math.abs(n);

/** The dice a use of `ops` rolls at `tier`: one list per op, in order, empty for an op with no amount. */
export const useDice = (ops: readonly Op[], tier: number): Dice[][] =>
  ops.map(o => (o.op === 'damage' || o.op === 'heal' || o.op === 'mana' || o.op === 'fatigue' ? amountDice(o, tier) : []));

/** What a use did: the hunter after it and one line per op that changed something. */
export type Used = { readonly hunter: Hunter; readonly lines: readonly string[] };

/**
 * One op on `h` with its dice: the hunter after it and its line, or null when it changes nothing (a heal on a dead or
 * full hunter, mana when full, fatigue lowered at 0, a cure of a status not held).
 */
function opOn(h: Hunter, o: Op, tier: number, source: Source, dice: readonly number[], R: Rules): { hunter: Hunter; line: string } | null {
  const edit = (e: SheetEdit): Hunter | null => { const x = sheetEdit(h, e, R); return isRefused(x) ? null : x; };
  const body = hunterSheet(h, R), m = body.sheet;
  switch (o.op) {
    case 'note': return { hunter: h, line: o.text };
    // a damage op on oneself outside a fight is said for the table to rule on: nothing on the sheet changes
    case 'damage': return { hunter: h, line: `Deal ${Math.max(0, amountOn(o, tier, body, dice))} ${o.type} damage` };
    case 'heal': {
      const n = amountOn(o, tier, body, dice), full = healsFully(o.amount, tier), was = hpOf(h.life, m.hpMax);
      const x = edit({ type: 'life', event: { type: 'heal', amount: full ? m.hpMax : Math.max(0, n) } }); if (!x) return null;
      const add = hpOf(x.life, m.hpMax) - was;
      return add > 0 ? { hunter: x, line: full ? `Fully healed (+${add} HP)` : `+${add} HP` } : null;
    }
    case 'mana': {
      const x = edit({ type: 'mana', delta: Math.max(0, amountOn(o, tier, body, dice)) }); if (!x) return null;
      const add = manaOf(x, m) - manaOf(h, m);
      return add > 0 ? { hunter: x, line: `+${add} mana` } : null;
    }
    case 'fatigue': {
      const x = edit({ type: 'fatigue', delta: amountOn(o, tier, body, dice) }); if (!x) return null;
      const d = x.fatigue - h.fatigue;
      return d !== 0 ? { hunter: x, line: `${sign(d)} fatigue` } : null;
    }
    case 'applyStatus': {
      const def = liveOp(o, R.conditions).def;
      const rounds = o.duration === null ? null : roundsOf(atTier(o.duration, tier), R, 'near');
      const x = edit({ type: 'put', status: { key: o.key, def, source, rounds } }); if (!x) return null;
      return { hunter: x, line: `Status applied: ${def.label}${rounds ? ` (${rounds} round${rounds === 1 ? '' : 's'})` : ''}` };
    }
    case 'cureStatus': {
      const held = h.conditions.find(c => c.key === o.key); if (!held) return null;
      const x = edit({ type: 'drop', key: o.key }); if (!x) return null;
      return { hunter: x, line: `Cured: ${held.def.label}` };
    }
    default: return null;
  }
}

/**
 * Hunter `h` after `ops` on itself from `source`, with `rolls[i]` the dice `useDice` asked for op `i`. Refused
 * (`nothing`) when no op changes anything, so a use that does nothing costs nothing.
 */
export function useOn(h: Hunter, ops: readonly Op[], source: Source, rolls: readonly (readonly number[])[], R: Rules): Used | Refused<'nothing'> {
  let x = h;
  const lines: string[] = [];
  ops.forEach((o, i) => {
    const r = opOn(x, o, source.tier, source, rolls[i] ?? [], R);
    if (r) { x = r.hunter; lines.push(r.line); }
  });
  return lines.length ? { hunter: x, lines } : refuse('nothing');
}

// ── rank-capped consumables (Resurrection Crystals and rank-tiered potions) ──
/** The rank a crystal or rank-capped consumable reaches up to: its rarity's rank (`rarities.*.rank`, GM-editable). */
export const reachOf = (item: Pick<Item, 'rar'>, R: Pick<Rules, 'rarities'>): Rank => R.rarities[item.rar].rank;
/**
 * Whether `item` can be used on a hunter of `rank`: uncapped items always can; a crystal (`revive`) or rank-capped
 * consumable (`rankCap`) only works for hunters of its rarity's rank or lower.
 */
export const usableAtRank = (item: Pick<Item, 'rar'> & Partial<Pick<Item, 'revive' | 'rankCap'>>, rank: Rank, R: Pick<Rules, 'rarities'>): boolean =>
  (!item.revive && !item.rankCap) || RANKS.indexOf(rank) <= RANKS.indexOf(reachOf(item, R));
/**
 * Whether `item` raises a dead hunter of `rank`: it revives, and `rank` is at or below the rank of its rarity (economy
 * design 5: the crystal's rank is its rarity's, so no crystal can say one rank and cost another).
 */
export const revives = (item: Pick<Item, 'rar' | 'revive'>, rank: Rank, R: Pick<Rules, 'rarities'>): boolean =>
  item.revive === true && usableAtRank(item, rank, R);

/** A consumable too low for a hunter, for the words of its refusal: the rank it reaches up to, the hunter's name and rank, and whether it revives. */
export type TooLow = { readonly upTo: Rank; readonly name: string; readonly rank: Rank; readonly revive?: boolean };
/** `item` too low for `h`, as `USE_WORDS['too-low']` says it. */
export const tooLowOf = (item: Pick<Item, 'rar' | 'revive'>, h: Pick<Hunter, 'name' | 'rank'>, R: Pick<Rules, 'rarities'>): TooLow =>
  ({ upTo: reachOf(item, R), name: h.name, rank: h.rank, revive: item.revive === true });
/**
 * What the giver of `item` reads when it goes to `to` and cannot affect them (`revives` / `usableAtRank` false).
 * Null when it can, or when it is not rank-capped. A hand-over or an offer says it and is never refused by it.
 */
export const tooLowLine = (item: Pick<Item, 'name' | 'rar' | 'revive' | 'rankCap'>, to: Pick<Hunter, 'name' | 'rank'>, R: Pick<Rules, 'rarities'>): string | null => {
  if (item.revive && !revives(item, to.rank, R)) return `${item.name} cannot bring back ${to.name} (rank ${to.rank}).`;
  if (item.rankCap && !usableAtRank(item, to.rank, R)) return `${item.name} is rank ${reachOf(item, R)} and has no effect on ${to.name} (rank ${to.rank}).`;
  return null;
};

/**
 * Why a use outside a fight is refused: the consumable is not held, nothing would change, it revives and the user is not
 * dead, the user's rank is above its cap (`usableAtRank`), or a fight holds the user (the caller's).
 */
export type ItemUseRefusal = 'no-item' | 'nothing' | 'not-dead' | 'too-low' | 'fight';
/**
 * What a refused use says, with the item's name (copy-tasks.md: why, and the way out). A capped consumable too low
 * names its rank and the hunter's from `low` (`tooLowOf`).
 */
export const USE_WORDS: { readonly [W in ItemUseRefusal]: (name: string, low?: TooLow) => string } = {
  'no-item': name => `${name} is no longer in the bag.`,
  nothing: name => `${name} would have no effect right now. You still have it.`,
  'not-dead': name => `${name} only brings back a dead hunter. You still have it.`,
  'too-low': (name, low) => {
    if (low && low.revive === false) {
      return `${name} is a rank ${low.upTo} consumable. ${low.name} is rank ${low.rank}, so it has no effect. You still have it. Use a rank ${low.rank} or higher consumable.`;
    }
    return low
      ? `${name} only revives hunters of rank ${low.upTo} or lower, and ${low.name} is rank ${low.rank}. You still have it. Use a rank ${low.rank} or higher crystal, or ask the GM to revive ${low.name}.`
      : `${name} is too low rank for this hunter. You still have it. Use a crystal of their rank or higher, or ask the GM to revive them.`;
  },
  fight: name => `You cannot use ${name} during a fight. Use it after the fight ends.`,
};
/** `USE_WORDS` said of `name` (and `low`, a crystal too low): the words of a refused use for `ui.wrote`. */
export const useWords = (name: string, low?: TooLow): Readonly<Record<ItemUseRefusal, string>> => ({
  'no-item': USE_WORDS['no-item'](name), nothing: USE_WORDS.nothing(name), 'not-dead': USE_WORDS['not-dead'](name),
  'too-low': USE_WORDS['too-low'](name, low), fight: USE_WORDS.fight(name),
});

/** A consumable `h` holds, resolved under `R` (inventory.ts `heldItem`), that does something when used (not `no-item`). */
export const usable = (h: Pick<Hunter, 'items'>, itemId: string, R: BagRules): ResolvedItem | null => {
  const it = heldItem(h, itemId, R);
  return it && it.type === 'consumable' && it.qty > 0 ? it : null;
};

/**
 * One of consumable `itemId` leaves `h`'s bag, used up: the last one leaves any slot it was in, and the maxima are fitted
 * (a worn thing used up lowers them). Refused when `h` holds no such consumable (`no-item`).
 */
export function spendItem(h: Hunter, itemId: string, R: Rules): Hunter | Refused<'no-item'> {
  if (!usable(h, itemId, R)) return refuse('no-item');
  const taken = takeItems(h, itemId, 1);
  return isRefused(taken) ? taken : fitted(taken, R);
}

/**
 * Consumable `itemId` used by `h` on itself, with the dice `useDice(itemOps(item, 'use'), itemSource(item).tier)` asked
 * for: an item that revives first brings `h` back through the life machine's `revive` (`sheetEdit`, as the GM's Revive
 * does, with the levels a raising costs), then its ops (`useOn`), and one of it spent (`spendItem`). Refused when `h`
 * holds no such consumable (`no-item`), when it revives and `h` is not dead (`not-dead`: the life table takes `revive`
 * only from dead), when it revives and `h`'s rank is above its own (`too-low`, `revives`), or when nothing would change
 * (`nothing`). A refused use spends nothing.
 */
export function useItem(h: Hunter, itemId: string, rolls: readonly (readonly number[])[], R: Rules): (Used & { readonly item: ResolvedItem }) | Refused<'no-item' | 'nothing' | 'not-dead' | 'too-low'> {
  const item = usable(h, itemId, R); if (!item) return refuse('no-item');
  let from = h;
  const lines: string[] = [];
  if (item.revive) {
    const up = sheetEdit(h, { type: 'life', event: { type: 'revive' }, by: 'item' }, R);
    if (isRefused(up)) return refuse('not-dead');
    if (!revives(item, h.rank, R)) return refuse('too-low');
    from = up; lines.push(raisedLine(h.level, up.level));
  } else if (!usableAtRank(item, h.rank, R)) {
    return refuse('too-low');
  }
  const u = useOn(from, itemOps(item, 'use'), itemSource(item), rolls, R);
  if (isRefused(u) && !lines.length) return u;
  const used = isRefused(u) ? { hunter: from, lines } : { hunter: u.hunter, lines: [...lines, ...u.lines] };
  const spent = spendItem(used.hunter, itemId, R); if (isRefused(spent)) return spent;
  // a consumable used up is a fact of the chronicle (chronicle.ts)
  return { hunter: record(spent, { kind: 'used', item: item.name, rar: item.rar }), lines: used.lines, item };
}
