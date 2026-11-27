// A hunter with one shield in the bag, and the events of what the shield's wear goes through. Shared by
// tests/inventory.test.ts and the state chart (scripts/charts/gear.ts), so both walk the same events.
import { WEAR_EVENTS, editItem, equip, putItem, removeItem, slotOf, unequip, wornOf } from '../../src/core/hunter/inventory.ts';
import type { BagRules, WearEvent } from '../../src/core/hunter/inventory.ts';
import { adhocGrant, itemDefDataOf } from '../../src/core/registry/item-book.ts';
import type { ItemDefData } from '../../src/core/registry/item-book.ts';
import { STARTER_GEAR, itemOf } from '../../src/core/registry/items.ts';
import { RULES } from '../../src/core/rules.ts';
import { newHunter } from '../../src/core/save.ts';
import type { Hunter } from '../../src/core/save.ts';
import type { Refused } from '../../src/core/save-step.ts';
import { iid } from '../fixtures/ids.ts';

/** The shield the walk follows, and the id a split of it would take (never used: the shield is a single one). */
export const GEAR = iid('i1');
const SPLIT = iid('i900');
/**
 * The shield: the starter tower shield as the hunter's own (ad hoc) item, so the Bag's Edit changes it in place. A
 * reference to the built-in would be refused `not-yours` (its def is edited in the library, for every copy).
 */
export const SHIELD: ItemDefData = itemDefDataOf(itemOf(RULES, STARTER_GEAR.towerShield));

/** A new hunter with the shield in the bag, not worn. */
export const IN_BAG = (): Hunter => putItem(newHunter(RULES), adhocGrant(SHIELD), GEAR, RULES);

/**
 * Event `e` done to the shield by the step a tap makes: Equip, Unequip in the slot it is worn in (its own when it is in
 * the bag), the item maker's edit of its description (`edit`) or of its slot (`reslot`), and Remove (`remove`).
 */
export function wearBy(h: Hunter, e: WearEvent, inFight: boolean): Hunter | Refused {
  const line = h.items.find(i => i.id === GEAR);
  const it: ItemDefData = line?.kind === 'adhoc' ? line.item : SHIELD;
  switch (e) {
    case 'equip': return equip(h, GEAR, SPLIT, inFight, RULES);
    case 'unequip': return unequip(h, slotOf(h, GEAR, RULES) ?? 'offhand', inFight, RULES);
    case 'edit': return editItem(h, GEAR, { ...it, desc: `${it.desc ?? ''} Notched.` }, inFight, RULES);
    case 'reslot': return editItem(h, GEAR, { ...it, slot: it.slot === 'chest' ? 'offhand' : 'chest' }, inFight, RULES);
    case 'remove': return removeItem(h, GEAR, inFight, RULES);
  }
}

/** The walk's events: every event of the shield's wear, and the hunter's fight starting and ending. */
export const WALK_EVENTS: readonly (WearEvent | 'fight starts' | 'fight ends')[] = [...WEAR_EVENTS, 'fight starts', 'fight ends'];

/**
 * The worn invariant as a fixed-point check: re-reading `h.equipped` against the bag as it resolves under `R`
 * (inventory.ts `wornOf`: held, single, fits its slot, unique, the two-handed lock, at most `WEAR_LIMIT`) yields the exact
 * same map. Every step that changes what a hunter wears (`equip`, `unequip`, `editItem`, `removeItem`, `sell`,
 * `wearSet`, `swapLoadout`) must answer a hunter for which `reparsedWorn(h)` equals `h.equipped`.
 */
export const reparsedWorn = (h: Pick<Hunter, 'items' | 'equipped'>, R: BagRules = RULES): Hunter['equipped'] => wornOf(h, R);
