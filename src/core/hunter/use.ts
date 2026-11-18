// use.ts: a thing used on its own user outside a fight, as one step. Pure. A consumable from the bag (`useItem`) or an
// active skill on oneself (`useOn`) puts its ops on the hunter's sheet: each amount op's formula at the source's tier
// with the dice the edge rolled (`useDice` says which), a status put on, a status cured, a note said. What each op did is
// read from the hunter before and after it, so the lines say what happened, never what was asked. The item leaves the
// bag in the same answer, so a use is written whole by one `store.apply` or not at all (implicit audit 2, N2).
//
// In a fight the fight's row holds the hunter's HP, mana, fatigue and statuses, so a use there is the fight's `act`
// (src/core/registry/abilities.ts `itemAbility`), never this: the caller asks `fightOf` first. An item that revives
// (`Item.revive`, the Resurrection Crystal) has no ability and is refused in a fight (`USE_WORDS.fight`): a dead hunter's
// row stays in the fight until it ends, and the GM's Revive is the way back inside one.
import { amountDice, amountOn } from '../effects.ts';
import { atTier, healsFully } from '../combat/effect-ops.ts';
import { roundsOf } from '../combat/timeline.ts';
import type { Op, Source } from '../combat/effect-ops.ts';
import type { Dice } from '../formula.ts';
import type { Rules } from '../rules.ts';
import type { Hunter } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { sheetEdit } from './grant.ts';
import { record } from './chronicle.ts';
import type { SheetEdit } from './grant.ts';
import { takeItems } from './inventory.ts';
import { fitted, hunterSheet } from './sheet.ts';
import { REVIVE_HP, hpOf, manaOf } from './vitals.ts';
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
      const rounds = o.duration === null ? null : roundsOf(atTier(o.duration, tier), R, 'near');
      const x = edit({ type: 'put', status: { key: o.key, def: o.def, source, rounds } }); if (!x) return null;
      return { hunter: x, line: `Status applied: ${o.def.label}${rounds ? ` (${rounds} round${rounds === 1 ? '' : 's'})` : ''}` };
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

/** Why a use outside a fight is refused: the consumable is not held, nothing would change, it revives and the user is not dead, or a fight holds the user (the caller's). */
export type ItemUseRefusal = 'no-item' | 'nothing' | 'not-dead' | 'fight';
/** What a refused use says, with the item's name (copy-tasks.md: why, and the way out). */
export const USE_WORDS: { readonly [W in ItemUseRefusal]: (name: string) => string } = {
  'no-item': name => `${name} is no longer in the bag.`,
  nothing: name => `${name}: nothing to restore.`,
  'not-dead': name => `${name} only brings back a dead hunter. You still have it.`,
  fight: name => `Use ${name} after the fight.`,
};
/** The line of a use that brought its dead user back (the life machine's `revive`). */
export const REVIVED_LINE = `Up at ${REVIVE_HP} HP`;

/** A consumable `h` holds that does something when used (not `no-item`). */
export const usable = (h: Pick<Hunter, 'items'>, itemId: string): Item | null =>
  h.items.find(i => i.id === itemId && i.type === 'consumable' && i.qty > 0) ?? null;

/**
 * One of consumable `itemId` leaves `h`'s bag, used up: the last one leaves any slot it was in, and the maxima are fitted
 * (a worn thing used up lowers them). Refused when `h` holds no such consumable (`no-item`).
 */
export function spendItem(h: Hunter, itemId: string, R: Rules): Hunter | Refused<'no-item'> {
  if (!usable(h, itemId)) return refuse('no-item');
  const taken = takeItems(h, itemId, 1);
  return isRefused(taken) ? taken : fitted(taken, R);
}

/**
 * Consumable `itemId` used by `h` on itself, with the dice `useDice(itemOps(item, 'use'), itemSource(item).tier)` asked
 * for: an item that revives first brings `h` back through the life machine's `revive` (`sheetEdit`, as the GM's Revive
 * does), then its ops (`useOn`), and one of it spent (`spendItem`). Refused when `h` holds no such consumable
 * (`no-item`), when it revives and `h` is not dead (`not-dead`: the life table takes `revive` only from dead), or when
 * nothing would change (`nothing`). A refused use spends nothing.
 */
export function useItem(h: Hunter, itemId: string, rolls: readonly (readonly number[])[], R: Rules): (Used & { readonly item: Item }) | Refused<'no-item' | 'nothing' | 'not-dead'> {
  const item = usable(h, itemId); if (!item) return refuse('no-item');
  let from = h;
  const lines: string[] = [];
  if (item.revive) {
    const up = sheetEdit(h, { type: 'life', event: { type: 'revive' }, by: 'item' }, R);
    if (isRefused(up)) return refuse('not-dead');
    from = up; lines.push(REVIVED_LINE);
  }
  const u = useOn(from, itemOps(item, 'use'), itemSource(item), rolls, R);
  if (isRefused(u) && !lines.length) return u;
  const used = isRefused(u) ? { hunter: from, lines } : { hunter: u.hunter, lines: [...lines, ...u.lines] };
  const spent = spendItem(used.hunter, itemId, R); if (isRefused(spent)) return spent;
  // a consumable used up is a fact of the chronicle (chronicle.ts)
  return { hunter: record(spent, { kind: 'used', item: item.name, rar: item.rar }), lines: used.lines, item };
}
