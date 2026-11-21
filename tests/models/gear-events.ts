// A hunter with one shield in the bag, and the events of what the shield's wear goes through. Shared by
// tests/inventory.test.ts and the state chart (scripts/charts/gear.ts), so both walk the same events.
import { WEAR_EVENTS, editItem, equip, putItem, removeItem, slotOf, unequip } from '../../src/core/hunter/inventory.ts';
import type { WearEvent } from '../../src/core/hunter/inventory.ts';
import { STARTER_GEAR, itemOf } from '../../src/core/registry/items.ts';
import { RULES } from '../../src/core/rules.ts';
import { newHunter } from '../../src/core/save.ts';
import type { Hunter } from '../../src/core/save.ts';
import type { Refused } from '../../src/core/save-step.ts';
import { iid } from '../fixtures/ids.ts';

/** The shield the walk follows, and the id a split of it would take (never used: the shield is a single one). */
export const GEAR = iid('i1');
const SPLIT = iid('i900');
export const SHIELD = itemOf(RULES, STARTER_GEAR.towerShield);

/** A new hunter with the shield in the bag, not worn. */
export const IN_BAG = (): Hunter => putItem(newHunter(RULES), SHIELD, GEAR);

/**
 * Event `e` done to the shield by the step a tap makes: Equip, Unequip in the slot it is worn in (its own when it is in
 * the bag), the item maker's edit of its description (`edit`) or of its slot (`reslot`), and Remove (`remove`).
 */
export function wearBy(h: Hunter, e: WearEvent, inFight: boolean): Hunter | Refused {
  const it = h.items.find(i => i.id === GEAR) ?? SHIELD;
  switch (e) {
    case 'equip': return equip(h, GEAR, SPLIT, inFight);
    case 'unequip': return unequip(h, slotOf(h, GEAR) ?? 'offhand', inFight);
    case 'edit': return editItem(h, GEAR, { ...it, desc: `${it.desc ?? ''} Notched.` }, inFight);
    case 'reslot': return editItem(h, GEAR, { ...it, slot: it.slot === 'chest' ? 'offhand' : 'chest' }, inFight);
    case 'remove': return removeItem(h, GEAR, inFight);
  }
}

/** The walk's events: every event of the shield's wear, and the hunter's fight starting and ending. */
export const WALK_EVENTS: readonly (WearEvent | 'fight starts' | 'fight ends')[] = [...WEAR_EVENTS, 'fight starts', 'fight ends'];
