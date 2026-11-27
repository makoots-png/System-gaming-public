import { describe, expect, test } from 'bun:test';
import { BORROW_WORDS, BUY_REFUSALS, BUY_WORDS, GEAR_WORDS, SHOP_CLOSED, WEAR_EVENTS, WEAR_STATES, addGold, bagOf, borrowConfirm, buy, buyPlan, buyWords, detachItem, editItem, equip, handLockedBy, putItem, removeItem, removeShopItem, sell, sellPrice, sellable, setGold, shopCreditLine, shopOpen, takeItems, unequip, wearMove, wearOf, wearPlan, wearSet, withShop, wornCount, wornOf, writeShopItem } from '../src/core/hunter/inventory.ts';
import type { WearEvent, WearState, WearWhy } from '../src/core/hunter/inventory.ts';
import { LOADOUT_WORDS, saveLoadout, swapLoadout } from '../src/core/hunter/loadouts.ts';
import { borrowCap } from '../src/core/hunter/revive-standing.ts';
import { parseSheetHunter } from '../src/core/hunter/hunter.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { heldPowers, hunterAbilities, hunterRow } from '../src/core/combat/rows.ts';
import { GEAR, IN_BAG, SHIELD, reparsedWorn, wearBy } from './models/gear-events.ts';
import { adhocGrant, itemDefDataOf, refGrant } from '../src/core/registry/item-book.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';
import type { ItemDefId } from '../src/core/ids.ts';
import { FOREIGN_CHARM_DEF, FOREIGN_CHARM_ID, GM_CATALOG_ID, adhocOf, customId, defOf, rulesWith } from './fixtures/items.ts';
import { SHOP_ITEMS, SLOTS, STARTER_GEAR, WEAR_LIMIT, itemOf, parseItem, priceOf } from '../src/core/registry/items.ts';
import type { ItemTemplate, Slot } from '../src/core/registry/items.ts';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { newHunter, newSave, parseSave } from '../src/core/save.ts';
import type { Hunter } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { cid, dev, iid, loid } from './fixtures/ids.ts';
import { WAYS_BACK } from '../src/core/hunter/vitals.ts';

const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const shield = itemOf(RULES, STARTER_GEAR.towerShield);
const potion = itemOf(RULES, STARTER_GEAR.manaPotion);
const SHIELD_ID = STARTER_GEAR.towerShield.defId, POTION_ID = STARTER_GEAR.manaPotion.defId;
/** A thing given by value, as the hunter's own (ad hoc) item: it stacks only with its exact copy, and its Bag edit changes it in place. */
const own = adhocOf;
/** A bag line as a save holds it: a reference to `defId`, or the hunter's own copy of template `t`. */
const refLine = (defId: ItemDefId, id: string, qty = 1): HeldItem => ({ kind: 'ref', id: iid(id), defId, qty });
const ownLine = (t: ItemTemplate, id: string, qty = 1): HeldItem => ({ kind: 'adhoc', id: iid(id), qty, item: itemDefDataOf(t) });
/** The names in `h`'s bag as it reads under `R`. */
const names = (h: Pick<Hunter, 'items'>, R: Rules = RULES): string[] => bagOf(h, R).map(i => i.name);
const ring = (name: string): ItemTemplate => ({ ...shield, name, type: 'accessory', slot: 'ring1', weight: 0, armor: 0, resist: 0, bonus: { str: 1 } });
const hunter = (gold = 100): Hunter => ({ ...newHunter(RULES), gold });
/** What the Association pays for one of a thing priced `price`: `saleShare` of it, rounded down, at least 1 (economy design 3). */
const sale = (price: number, R: Pick<Rules, 'saleShare'> = RULES): number => (price > 0 ? Math.max(1, Math.floor(price * R.saleShare)) : 0);

describe('the bag', () => {
  const differing: [string, Partial<ItemTemplate>][] = [['description', { desc: 'a second telling' }], ['attack', { attack: 'shot' }], ['grade', { grade: 1 }], ['icon', { icon: 'crystal' }], ['rankCap', { rankCap: true }]];
  for (const [what, change] of differing) {
    test(`two slotless things of two defs that differ only in their ${what} stay two stacks`, () => {
      const R = rulesWith({ ...defOf('potion-a', potion), ...defOf('potion-b', { ...potion, ...change }) });
      const h = putItem(putItem(hunter(), refGrant(customId('potion-a')), iid('i1'), R), refGrant(customId('potion-b')), iid('i2'), R);
      expect(h.items.map(i => i.id)).toEqual(['i1', 'i2']);
      expect(bagOf(h, R)[1]).toMatchObject(change);
    });
  }

  test('a thing without a slot joins the stack of its def; gear makes its own entry', () => {
    const h = putItem(putItem(hunter(), refGrant(POTION_ID), iid('i1'), RULES), refGrant(POTION_ID), iid('i2'), RULES);
    expect(h.items).toEqual([{ kind: 'ref', id: iid('i1'), defId: POTION_ID, qty: 2 }]);
    const g = putItem(putItem(hunter(), refGrant(SHIELD_ID), iid('i1'), RULES), refGrant(SHIELD_ID), iid('i2'), RULES);
    expect(g.items.map(i => i.id)).toEqual(['i1', 'i2']);
  });

  test('stackOf reads wornOf(h, R): a worn item whose def lost its slot stacks with a new copy instead of splitting', () => {
    const id = customId('charm'), charm = parseItem({ name: 'Lucky Charm', type: 'accessory', slot: 'ring1' })!;
    const R1 = rulesWith(defOf('charm', charm));
    const worn = ok(equip(putItem(hunter(), refGrant(id), iid('i1'), R1), 'i1', iid('i90'), false, R1));
    expect(worn.equipped.ring1).toBe(iid('i1'));
    const R2 = rulesWith({ [id]: { ...itemDefDataOf(charm), slot: null, type: 'misc' } });
    const stacked = putItem(worn, refGrant(id), iid('i2'), R2);
    expect(stacked.items).toEqual([{ kind: 'ref', id: iid('i1'), defId: id, qty: 2 }]);
  });

  test('a hunter\'s own thing stacks with its exact copy (a refused offer joins the stack it left), never with another def or a reference', () => {
    const h = putItem(putItem(hunter(), own(potion), iid('i1'), RULES), own(potion), iid('i2'), RULES);
    expect(h.items.map(i => [i.id, i.qty])).toEqual([['i1', 2]]);
    const other = putItem(h, own({ ...potion, desc: 'Brewed by Mira.' }), iid('i3'), RULES);
    expect(other.items.map(i => [i.id, i.qty]), 'a copy that differs in one field is its own line').toEqual([['i1', 2], ['i3', 1]]);
    const ref = putItem(other, refGrant(POTION_ID), iid('i4'), RULES);
    expect(ref.items.map(i => [i.id, i.qty]), 'the built-in by reference is its own line').toEqual([['i1', 2], ['i3', 1], ['i4', 1]]);
    const worn = putItem(hunter(), own(shield), iid('i1'), RULES);
    expect(putItem(worn, own(shield), iid('i2'), RULES).items.map(i => i.id), 'gear never stacks').toEqual(['i1', 'i2']);
  });

  test('an Epic+ and an Epic of one name are two defs and two stacks, two Epic+ are one, and an Epic read with grade 0 is the Epic', () => {
    const idol = parseItem({ name: 'Idol', rar: 'epic', type: 'material' })!, plus = parseItem({ name: 'Idol', rar: 'epic', type: 'material', grade: 1 })!;
    const R = rulesWith({ ...defOf('idol', idol), ...defOf('idol-plus', plus) });
    const grants = [customId('idol-plus'), customId('idol'), customId('idol-plus'), customId('idol')].map(id => refGrant(id));
    const h = grants.reduce((x, g, n) => putItem(x, g, iid(`i${n + 1}`), R), hunter());
    expect(bagOf(h, R).map(i => [i.id, i.grade ?? 0, i.qty])).toEqual([['i1', 1, 2], ['i2', 0, 2]]);
    expect(parseItem({ name: 'Idol', rar: 'epic', type: 'material', grade: 0 })).toEqual(idol);
  });

  test('round trip: an item put in the bag and removed leaves the hunter as it was', () => {
    const h = hunter();
    expect(ok(removeItem(putItem(h, refGrant(SHIELD_ID), iid('i1'), RULES), 'i1', false, RULES))).toEqual(h);
  });

  test('taking the last one of a worn item takes it out of its slot too', () => {
    const worn = ok(equip(putItem(hunter(), refGrant(SHIELD_ID), iid('i1'), RULES), 'i1', iid('i900'), false, RULES));
    const gone = ok(takeItems(worn, 'i1', 1));
    expect(gone.items).toEqual([]);
    expect(gone.equipped.offhand).toBeNull();
    expect(takeItems(gone, 'i1', 1)).toEqual({ ok: false, why: 'no-item' });
  });

  test('an edit of the hunter\'s own item keeps the id; gear edited into a thing without a slot is taken off', () => {
    const worn = ok(equip(putItem(hunter(), own(shield), iid('i1'), RULES), 'i1', iid('i900'), false, RULES));
    const edited = ok(editItem(worn, 'i1', { ...SHIELD, name: 'Plank', slot: null, type: 'misc' }, false, RULES));
    expect(bagOf(edited, RULES)[0]).toMatchObject({ id: 'i1', name: 'Plank' });
    expect(edited.equipped.offhand).toBeNull();
  });

  test('the Bag\'s edit of a reference is refused, and the refusal has words: its def is changed for every copy, not one bag line', () => {
    const h = putItem(hunter(), refGrant(SHIELD_ID), iid('i1'), RULES);
    expect(editItem(h, 'i1', { ...SHIELD, name: 'Plank' }, false, RULES)).toEqual({ ok: false, why: 'not-yours' });
    expect(GEAR_WORDS['not-yours']).toBe('Only the GM can change this item.');
  });

  test('"Make a separate item" outside a room points a worn reference at a new def, keeping its id and count; a def that does not fit its slot takes it off', () => {
    const R = rulesWith(defOf('plank', { ...shield, name: 'Plank', slot: null, type: 'misc' }));
    const worn = ok(equip(putItem(hunter(), refGrant(SHIELD_ID), iid('i1'), R), 'i1', iid('i900'), false, R));
    const apart = ok(detachItem(worn, 'i1', customId('plank'), false, R, 'alone', GM_CATALOG_ID));
    expect(apart.items).toEqual([{ kind: 'ref', id: iid('i1'), defId: customId('plank'), qty: 1 }]);
    expect(names(apart, R)).toEqual(['Plank']);
    expect(apart.equipped.offhand).toBeNull();
    expect(detachItem(worn, 'i1', customId('plank'), true, R, 'alone', GM_CATALOG_ID), 'nothing worn changes in a fight').toEqual({ ok: false, why: 'in-fight' });
  });

  test('"Make a separate item" is refused where the phone does not own the def: a player in a room, or a GM on another table\'s custom item', () => {
    const R = rulesWith({ ...defOf('plank', { ...shield, name: 'Plank', slot: null, type: 'misc' }), [FOREIGN_CHARM_ID]: FOREIGN_CHARM_DEF });
    const h = putItem(hunter(), refGrant(SHIELD_ID), iid('i1'), R);
    expect(detachItem(h, 'i1', customId('plank'), false, R, 'player', GM_CATALOG_ID)).toEqual({ ok: false, why: 'not-yours' });
    // In PR 4, built-in overrides sync via the GM catalog, so a GM in a room owns built-ins too
    expect(ok(detachItem(h, 'i1', customId('plank'), false, R, 'gm', GM_CATALOG_ID)).items).toEqual([{ kind: 'ref', id: iid('i1'), defId: customId('plank'), qty: 1 }]);
    const foreign = putItem(hunter(), refGrant(FOREIGN_CHARM_ID), iid('i3'), R);
    expect(detachItem(foreign, 'i3', customId('plank'), false, R, 'gm', GM_CATALOG_ID)).toEqual({ ok: false, why: 'not-yours' });
    const own = putItem(hunter(), adhocGrant(SHIELD), iid('i2'), R);
    expect(detachItem(own, 'i2', customId('plank'), false, R, 'alone', GM_CATALOG_ID), 'a hunter\'s own item is edited in place, not split off').toEqual({ ok: false, why: 'not-yours' });
  });
});

describe('what is worn', () => {
  test('round trip: equip then unequip leaves the hunter as it was', () => {
    const h = putItem(hunter(), refGrant(SHIELD_ID), iid('i1'), RULES);
    expect(ok(unequip(ok(equip(h, 'i1', iid('i900'), false, RULES)), 'offhand', false, RULES))).toEqual(h);
  });

  test('a ring goes to the first free ring slot; a third swaps out the one in its own slot', () => {
    let h = putItem(putItem(putItem(hunter(), own(ring('A')), iid('r1'), RULES), own(ring('B')), iid('r2'), RULES), own(ring('C')), iid('r3'), RULES);
    h = ok(equip(h, 'r1', iid('i901'), false, RULES)); h = ok(equip(h, 'r2', iid('i901'), false, RULES));
    expect([h.equipped.ring1, h.equipped.ring2]).toEqual(['r1', 'r2']);
    h = ok(equip(h, 'r3', iid('i901'), false, RULES));
    expect([h.equipped.ring1, h.equipped.ring2]).toEqual(['r3', 'r2']);
  });

  test('one of a stack of gear is split off and worn', () => {
    const two = { ...hunter(), items: [refLine(SHIELD_ID, 'i1', 2)] };
    const h = ok(equip(two, 'i1', iid('i9'), false, RULES));
    expect(h.items.map(i => [i.id, i.qty])).toEqual([['i1', 1], ['i9', 1]]);
    expect(h.items.every(i => i.kind === 'ref' && i.defId === SHIELD_ID), 'the split one reads the same def').toBe(true);
    expect(h.equipped.offhand).toBe(iid('i9'));
  });

  test('a thing without a slot, an item not held and a word that is not a slot are refused', () => {
    expect(equip(putItem(hunter(), refGrant(POTION_ID), iid('i1'), RULES), 'i1', iid('i901'), false, RULES)).toEqual({ ok: false, why: 'not-gear' });
    expect(equip(hunter(), 'nope', iid('i901'), false, RULES)).toEqual({ ok: false, why: 'no-item' });
    expect(unequip(hunter(), 'tail', false, RULES)).toEqual({ ok: false, why: 'no-slot' });
  });
});

describe('what one item is: in the bag, worn or gone (SMX-rules-5)', () => {
  /**
   * The rule, cell by cell. A worn thing is one item in one slot it fits. Out of a fight every event takes it where the
   * tap says; Equip on a worn thing leaves it where it is; an edit to another slot takes it off. In a fight the fight's
   * row holds the sheet it started with, so nothing worn changes and nothing is put on (m2-plan 4.4); the bag still
   * changes. A thing not held is not there to change, and a thing not worn is not taken off.
   */
  const RULE: { readonly [P in 'calm' | 'fight']: { readonly [S in WearState]: { readonly [E in WearEvent]: WearState | WearWhy } } } = {
    calm: {
      bag: { equip: 'worn', unequip: 'not-worn', edit: 'bag', reslot: 'bag', remove: 'gone' },
      worn: { equip: 'worn', unequip: 'bag', edit: 'worn', reslot: 'bag', remove: 'gone' },
      gone: { equip: 'no-item', unequip: 'not-worn', edit: 'no-item', reslot: 'no-item', remove: 'no-item' },
    },
    fight: {
      bag: { equip: 'in-fight', unequip: 'not-worn', edit: 'bag', reslot: 'bag', remove: 'gone' },
      worn: { equip: 'in-fight', unequip: 'in-fight', edit: 'in-fight', reslot: 'in-fight', remove: 'in-fight' },
      gone: { equip: 'no-item', unequip: 'not-worn', edit: 'no-item', reslot: 'no-item', remove: 'no-item' },
    },
  };
  const AT: { readonly [S in WearState]: () => Hunter } = {
    bag: IN_BAG,
    worn: () => ok(equip(IN_BAG(), GEAR, iid('i900'), false, RULES)),
    gone: () => hunter(),
  };
  const states = WEAR_STATES as readonly string[];
  for (const phase of ['calm', 'fight'] as const) {
    for (const state of WEAR_STATES) {
      for (const event of WEAR_EVENTS) {
        const cell = RULE[phase][state][event];
        test(`${phase === 'fight' ? 'in a fight' : 'out of a fight'}, ${event} on a shield ${state === 'gone' ? 'not held' : state === 'bag' ? 'in the bag' : 'worn'}: ${states.includes(cell) ? `it is ${cell === 'bag' ? 'in the bag' : cell}` : `refused (${cell})`}`, () => {
          const h = AT[state](), inFight = phase === 'fight';
          const after = wearBy(h, event, inFight);
          if (states.includes(cell)) {
            expect(wearOf(ok(after), GEAR, RULES)).toBe(cell as WearState);
            expect(wearMove(h, GEAR, event, inFight, RULES)).toBe(cell as WearState);
          } else {
            expect(after).toEqual({ ok: false, why: cell });
            expect(wearMove(h, GEAR, event, inFight, RULES)).toEqual({ ok: false, why: cell });
          }
        });
      }
    }
  }

  const strong = (name: string): ItemTemplate => ({ ...ring(name), bonus: { str: 5 } });
  /** A hunter as a save or another phone holds it, wearing `equipped` over `items`, read as the app reads one. */
  const read = (items: Hunter['items'], equipped: Partial<Hunter['equipped']>): Hunter => {
    const h = hunter(0);
    const back = parseSheetHunter(JSON.parse(JSON.stringify({ ...h, items, equipped: { ...h.equipped, ...equipped } })));
    if (!back) throw new Error('the hunter did not read');
    return back;
  };

  test('a save with one ring in both ring slots reads it in the first only, and the sheet counts its strength once (5.1)', () => {
    const iron = [ownLine(strong('Iron Ring'), 'i1')];
    const twice = read(iron, { ring1: iid('i1'), ring2: iid('i1') }), bare = read(iron, {});
    expect([twice.equipped.ring1, twice.equipped.ring2]).toEqual([iid('i1'), null]);
    expect(hunterSheet(twice, RULES).stats.str - hunterSheet(bare, RULES).stats.str, 'one ring of +5 strength').toBe(5);
  });

  test('a save that wears a stack of three, or a shield on the head, reads that slot empty and keeps the item in the bag (5.1)', () => {
    const h = read([refLine(SHIELD_ID, 'i1', 3), refLine(SHIELD_ID, 'i2')], { offhand: iid('i1'), head: iid('i2') });
    const worn = wornOf(h, RULES);
    expect([worn.offhand, worn.head]).toEqual([null, null]);
    expect(h.items.map(i => [i.id, i.qty])).toEqual([['i1', 3], ['i2', 1]]);
    const fine = read([refLine(SHIELD_ID, 'i1')], { offhand: iid('i1') });
    expect(wornOf(fine, RULES).offhand, 'a single shield in its own slot stays worn').toBe(iid('i1'));
  });

  test('a worn reference whose def is edited to another slot reads as in the bag under the edited rules, and as worn under the old', () => {
    const h = ok(equip(putItem(hunter(), refGrant(SHIELD_ID), iid('i1'), RULES), 'i1', iid('i900'), false, RULES));
    const moved = rulesWith({ [SHIELD_ID]: { ...SHIELD, slot: 'chest' } });
    expect(wornOf(h, RULES).offhand).toBe(iid('i1'));
    expect(wornOf(h, moved).offhand).toBeNull();
    expect(wearOf(h, 'i1', moved)).toBe('bag');
    expect(hunterSheet(h, moved).sheet.armor, 'the sheet counts no armor from a shield not worn').toBe(hunterSheet(hunter(), moved).sheet.armor);
  });

  test('an edit that moves a worn shield to the chest takes it off; an edit of its words leaves it worn (5.2)', () => {
    const worn = AT.worn();
    const h = ok(editItem(worn, GEAR, { ...SHIELD, slot: 'chest' }, false, RULES));
    expect(Object.values(h.equipped)).toEqual(Object.values(hunter().equipped));
    expect(wearOf(h, GEAR, RULES)).toBe('bag');
    expect(ok(editItem(worn, GEAR, { ...SHIELD, desc: 'Notched.' }, false, RULES)).equipped.offhand).toBe(GEAR);
  });

  test('a ring worn in the second ring slot, edited to say the first, still fits and stays where it is', () => {
    let h = putItem(putItem(hunter(), own(ring('A')), iid('r1'), RULES), own(ring('B')), iid('r2'), RULES);
    h = ok(equip(ok(equip(h, 'r1', iid('i901'), false, RULES)), 'r2', iid('i901'), false, RULES));
    expect(ok(editItem(h, 'r2', itemDefDataOf({ ...ring('B'), slot: 'ring1', desc: 'Etched.' }), false, RULES)).equipped).toMatchObject({ ring1: 'r1', ring2: 'r2' });
  });

  test('Equip on a ring worn in the first ring slot leaves it there and the second slot empty (5.3b)', () => {
    const h = ok(equip(putItem(hunter(), own(ring('A')), iid('r1'), RULES), 'r1', iid('i901'), false, RULES));
    expect(ok(equip(h, 'r1', iid('i901'), false, RULES))).toEqual(h);
  });

  test('in a fight a worn shield is not sold, removed or edited; a potion in the bag still sells, and the refusal has words (5.3c)', () => {
    const worn = putItem(AT.worn(), refGrant(POTION_ID), iid('i2'), RULES);
    const R = RULES;
    expect(sell(worn, GEAR, 1, R, true)).toEqual({ ok: false, why: 'in-fight' });
    expect(removeItem(worn, GEAR, true, R)).toEqual({ ok: false, why: 'in-fight' });
    expect(editItem(worn, GEAR, { ...SHIELD, desc: 'Notched.' }, true, R)).toEqual({ ok: false, why: 'in-fight' });
    expect(ok(sell(worn, 'i2', 1, R, true)).items.map(i => i.id)).toEqual([GEAR]);
    expect(GEAR_WORDS['in-fight']).toBe('Gear cannot change during a fight.');
  });
});

describe('10 gear slots, 6 active worn limit, and two-handed weapons (V2)', () => {
  const gear = (name: string, slot: Slot, extra: Partial<ItemTemplate> = {}): ItemTemplate =>
    parseItem({
      name,
      rar: 'rare',
      type: slot === 'weapon' ? 'weapon' : slot === 'neck' || slot === 'orb' || slot.startsWith('ring') ? 'accessory' : 'armor',
      slot,
      ...(slot === 'weapon' ? { dice: '1d8', attack: 'strike' } : {}),
      bonus: { str: 1 },
      ...extra,
    })!;
  /** Gear given by value goes in as the hunter's own item (gear never stacks, so a reference would read the same). */
  const put = (h: Hunter, t: ItemTemplate, id: ReturnType<typeof iid>): Hunter => putItem(h, own(t), id, RULES);
  const bow2h = (name = 'Longbow'): ItemTemplate => gear(name, 'weapon', { dice: '1d8', attack: 'shot', twoHanded: true });

  const sixWorn = (): Hunter => {
    let h = hunter();
    const picks: [string, Slot][] = [['Sword', 'weapon'], ['Shield', 'offhand'], ['Helm', 'head'], ['Mail', 'chest'], ['Charm', 'neck'], ['Greaves', 'legs']];
    picks.forEach(([nm, sl], idx) => {
      const id = iid(`i${idx + 1}`);
      h = ok(equip(put(h, gear(nm, sl), id), id, iid('i999'), false, RULES));
    });
    return h;
  };

  test('wearing 6 items blocks a 7th empty slot with wear-limit, while swapping an occupied slot still works', () => {
    let h = put(put(sixWorn(), gear('Boots', 'feet'), iid('i7')), gear('Crown', 'head'), iid('i8'));
    expect(wornCount(h, RULES)).toBe(WEAR_LIMIT);
    expect(wearPlan(h, 'i7', false, RULES)).toEqual({ ok: false, why: 'wear-limit' });
    expect(equip(h, 'i7', iid('i999'), false, RULES)).toEqual({ ok: false, why: 'wear-limit' });
    expect(GEAR_WORDS['wear-limit']).toBe('You are already wearing 6 of 6 items. Unequip an item first.');
    expect(wearPlan(h, 'i8', false, RULES)).toEqual({ ok: true, slot: 'head', replaces: [iid('i3')] });
    h = ok(equip(h, 'i8', iid('i999'), false, RULES));
    expect(h.equipped.head).toBe(iid('i8'));
    expect(wornCount(h, RULES)).toBe(WEAR_LIMIT);
    expect(h.equipped).toEqual(reparsedWorn(h));
  });

  test('in-fight wins over wear-limit when trying to equip a 7th item during a fight', () => {
    const h = put(sixWorn(), gear('Boots', 'feet'), iid('i7'));
    expect(wearPlan(h, 'i7', true, RULES)).toEqual({ ok: false, why: 'in-fight' });
    expect(equip(h, 'i7', iid('i999'), true, RULES)).toEqual({ ok: false, why: 'in-fight' });
  });

  test('ring at the cap: empty ring slots refuse at 6/6, one worn ring swaps that ring slot, two worn rings swap its own slot', () => {
    let h = put(sixWorn(), ring('A'), iid('r1'));
    expect(wearPlan(h, 'r1', false, RULES), 'neither ring worn at 6/6 refuses').toEqual({ ok: false, why: 'wear-limit' });
    h = ok(unequip(h, 'legs', false, RULES));
    h = ok(equip(h, 'r1', iid('i999'), false, RULES)); // now 6/6 with r1 in ring1, ring2 empty
    expect(h.equipped.ring1).toBe(iid('r1'));
    expect(h.equipped.ring2).toBeNull();
    h = put(h, { ...ring('B'), slot: 'ring2' }, iid('r2'));
    // ring2 is empty (would be 7th), so wearPlan falls through to occupied ring1 and swaps it
    expect(wearPlan(h, 'r2', false, RULES)).toEqual({ ok: true, slot: 'ring1', replaces: [iid('r1')] });
    h = ok(equip(h, 'r2', iid('i999'), false, RULES));
    expect([h.equipped.ring1, h.equipped.ring2, wornCount(h, RULES)]).toEqual([iid('r2'), null, WEAR_LIMIT]);
    // with both ring slots worn at 6/6, a ring marked ring2 swaps ring2
    h = ok(unequip(h, 'neck', false, RULES));
    h = ok(equip(put(h, ring('C'), iid('r3')), 'r3', iid('i999'), false, RULES)); // r2 in ring1, r3 in ring2, total 6
    h = put(h, { ...ring('D'), slot: 'ring2' }, iid('r4'));
    expect(wearPlan(h, 'r4', false, RULES)).toEqual({ ok: true, slot: 'ring2', replaces: [iid('r3')] });
  });

  test('two-handed weapon counts as 1 of 6, locks offhand, swaps out both hands atomically, and yields to an offhand equip', () => {
    let h = put(sixWorn(), bow2h('Frost Bow'), iid('b1'));
    expect(wearPlan(h, 'b1', false, RULES)).toEqual({ ok: true, slot: 'weapon', replaces: [iid('i1'), iid('i2')] });
    h = ok(equip(h, 'b1', iid('i999'), false, RULES));
    expect([h.equipped.weapon, h.equipped.offhand, wornCount(h, RULES)]).toEqual([iid('b1'), null, 5]);
    expect(handLockedBy(h, RULES)?.id).toBe(iid('b1'));
    // now equip a 6th item in orb -> 6 of 6 while wearing a 2H weapon
    h = ok(equip(put(h, gear('Relic Orb', 'orb'), iid('o1')), 'o1', iid('i999'), false, RULES));
    expect(wornCount(h, RULES)).toBe(WEAR_LIMIT);
    // equipping offhand at 6/6 swaps out the 2H weapon (net 0 -> allowed)
    expect(wearPlan(h, 'i2', false, RULES)).toEqual({ ok: true, slot: 'offhand', replaces: [iid('b1')] });
    h = ok(equip(h, 'i2', iid('i999'), false, RULES));
    expect([h.equipped.weapon, h.equipped.offhand, wornCount(h, RULES), handLockedBy(h, RULES)]).toEqual([null, iid('i2'), WEAR_LIMIT, null]);
    expect(h.equipped).toEqual(reparsedWorn(h));
  });

  test('editing a worn one-handed weapon to two-handed clears offhand', () => {
    let h = ok(equip(put(hunter(), gear('Sword', 'weapon'), iid('w1')), 'w1', iid('i999'), false, RULES));
    h = ok(equip(put(h, gear('Shield', 'offhand'), iid('s1')), 's1', iid('i999'), false, RULES));
    const edited = ok(editItem(h, 'w1', itemDefDataOf(bow2h('Greatsword')), false, RULES));
    expect([edited.equipped.weapon, edited.equipped.offhand]).toEqual([iid('w1'), null]);
    expect(edited.equipped).toEqual(reparsedWorn(edited));
  });

  test('a save read keeps at most 6 stored slots in SLOTS order, the worn read skips offhand under a 2H weapon, and an unknown old hands slot is dropped to the bag', () => {
    const allItems = SLOTS.map((sl, idx) => ownLine(gear(`Item ${sl}`, sl, sl === 'weapon' ? { twoHanded: true } : {}), `i${idx + 1}`));
    const gloves = parseItem({ name: 'Old Gloves', type: 'armor', slot: 'hands' })!;
    expect(gloves.slot).toBeNull();
    const rawEquipped = { ...Object.fromEntries(SLOTS.map((sl, idx) => [sl, iid(`i${idx + 1}`)])), hands: iid('i99') };
    const parsed = parseSheetHunter(JSON.parse(JSON.stringify({ ...hunter(0), items: [...allItems, ownLine(gloves, 'i99')], equipped: rawEquipped })))!;
    const filled = (eq: Hunter['equipped']): string[] => Object.entries(eq).filter(([, v]) => v !== null).map(([k]) => k);
    expect(filled(parsed.equipped), 'the save keeps the first 6 stored slots (hunter.ts parseWorn knows no fit)').toEqual(['weapon', 'offhand', 'head', 'chest', 'neck', 'legs']);
    const worn = wornOf(parsed, RULES);
    expect(filled(worn), 'of those, weapon (2H) is worn and offhand is not').toEqual(['weapon', 'head', 'chest', 'neck', 'legs']);
    expect(wornCount(parsed, RULES)).toBe(WEAR_LIMIT - 1);
    expect(Object.values(worn)).not.toContain(iid('i99'));
    expect(parsed.items.map(i => i.id)).toContain(iid('i99'));
  });

  test('SLOTS order drives heldPowers order, a row built before a load and the loaded hunter both read 6 of 8 stored worn items, and hunterAbilities reflects trimmed gear', () => {
    const withPower = (name: string, slot: Slot): ItemTemplate => gear(name, slot, {
      worn: { label: `${name} Aura`, desc: '', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 1 } }] },
    });
    const slots = SLOTS.slice(0, 8);
    const items = slots.map((sl, idx) => ownLine(withPower(`P-${sl}`, sl), `i${idx + 1}`));
    const rawEq = Object.fromEntries(slots.map((sl, idx) => [sl, iid(`i${idx + 1}`)]));
    const base = newSave(dev('d-00000001'));
    const h: Hunter = { ...newHunter(RULES), items, equipped: { ...newHunter(RULES).equipped, ...rawEq } };
    // row snapshotted before load (e.g. mid-session reload with running fight)
    const beforeRow = hunterRow(h, cid('c1'), RULES);
    const parsed = parseSave(JSON.stringify({ ...base, hunters: [h] }), { now: new Date(1), newDeviceId: () => dev('d-00000001'), newDeviceToken: () => 't'.repeat(32) });
    if (parsed.kind !== 'save') throw new Error('expected save');
    const afterH = parsed.save.hunters[0]!;
    expect(wornCount(afterH, RULES)).toBe(WEAR_LIMIT);
    expect(heldPowers(afterH, RULES).map(p => p.powers.worn?.label)).toEqual(SLOTS.slice(0, 6).map(sl => `P-${sl} Aura`));
    expect(beforeRow.statuses.length, 'a row reads what is worn by the rules (wornOf), so even before a load it holds 6, not the 8 stored').toBe(WEAR_LIMIT);
    expect(hunterAbilities(afterH, RULES).length).toBeGreaterThanOrEqual(1);
  });

  test('wearSet and swapLoadout enforce in-fight, 2H offhand clearance even on skipped slots, and WEAR_LIMIT, naming left items', () => {
    let h = sixWorn();
    h = put(put(h, bow2h('Greatbow'), iid('b1')), gear('Boots', 'feet'), iid('f1'));
    const s = { ...newSave(dev('d-00000001')), hunters: [{ ...h, loadouts: [
      { id: loid('lo1'), name: 'BowSet', slots: { weapon: iid('b1'), offhand: iid('i999'), head: iid('i3'), chest: iid('i4'), neck: iid('i5'), legs: iid('i6'), feet: iid('f1') } },
    ] }] };
    expect(swapLoadout(s, h.id, 'lo1', RULES, true)).toEqual({ ok: false, why: 'in-fight' });
    expect(LOADOUT_WORDS['in-fight']).toBe('You cannot change gear during a fight.');
    const swapped = ok(swapLoadout(s, h.id, 'lo1', RULES, false));
    const after = swapped.save.hunters[0]!;
    expect(swapped.skipped).toEqual(['offhand']);
    expect(after.equipped.weapon).toBe(iid('b1'));
    expect(after.equipped.offhand).toBeNull();
    expect(wornCount(after, RULES)).toBe(WEAR_LIMIT);
    expect(swapped.left).toContain('Shield');
    expect(after.equipped).toEqual(reparsedWorn(after));
    // saving a loadout captures only the 6 worn slots
    const saved = ok(saveLoadout(after, loid('lo2'), 'Clean', RULES));
    expect(Object.keys(saved.loadouts.at(-1)!.slots).length).toBe(WEAR_LIMIT);
  });

  test('property: every wear step answer is a fixed point of the worn read (wornOf)', () => {
    let h = hunter();
    const ids: ReturnType<typeof iid>[] = [];
    const defs: ItemTemplate[] = [
      gear('Dagger', 'weapon'),
      bow2h('Greatbow'),
      gear('Shield', 'offhand'),
      gear('Helm', 'head'),
      gear('Plate', 'chest'),
      gear('Amulet', 'neck'),
      gear('Greaves', 'legs'),
      gear('Boots', 'feet'),
      gear('Orb', 'orb'),
      ring('Band 1'),
      { ...ring('Band 2'), slot: 'ring2' },
    ];
    defs.forEach((d, idx) => { const id = iid(`i${idx + 1}`); ids.push(id); h = put(h, d, id); });
    const check = (next: Hunter | Refused<string>): Hunter => {
      if (isRefused(next)) return h;
      expect(next.equipped).toEqual(reparsedWorn(next));
      expect(wornCount(next, RULES)).toBeLessThanOrEqual(WEAR_LIMIT);
      if (handLockedBy(next, RULES)) expect(next.equipped.offhand).toBeNull();
      return next;
    };
    let seq = 500;
    const ops: (() => Hunter | Refused<string>)[] = [
      () => equip(h, ids[0]!, iid(`i${++seq}`), false, RULES),
      () => equip(h, ids[2]!, iid(`i${++seq}`), false, RULES),
      () => equip(h, ids[3]!, iid(`i${++seq}`), false, RULES),
      () => equip(h, ids[4]!, iid(`i${++seq}`), false, RULES),
      () => equip(h, ids[5]!, iid(`i${++seq}`), false, RULES),
      () => equip(h, ids[6]!, iid(`i${++seq}`), false, RULES),
      () => equip(h, ids[7]!, iid(`i${++seq}`), false, RULES), // refused wear-limit
      () => equip(h, ids[1]!, iid(`i${++seq}`), false, RULES), // 2H swaps out weapon + offhand
      () => equip(h, ids[8]!, iid(`i${++seq}`), false, RULES), // orb fills 6th
      () => equip(h, ids[9]!, iid(`i${++seq}`), false, RULES), // ring refused at 6/6
      () => equip(h, ids[2]!, iid(`i${++seq}`), false, RULES), // offhand swaps out 2H at 6/6
      () => unequip(h, 'legs', false, RULES),
      () => equip(h, ids[9]!, iid(`i${++seq}`), false, RULES),
      () => equip(h, ids[10]!, iid(`i${++seq}`), false, RULES), // ring2 swaps ring1 at 6/6
      () => editItem(h, ids[0]!, itemDefDataOf(bow2h('Edited 2H')), false, RULES),
      () => equip(h, ids[0]!, iid(`i${++seq}`), false, RULES),
      () => {
        const r = wearSet(h, { weapon: ids[1]!, offhand: ids[2]!, head: ids[3]!, chest: ids[4]!, neck: ids[5]!, legs: ids[6]!, feet: ids[7]!, orb: ids[8]! }, () => iid(`i${++seq}`), false, RULES);
        return isRefused(r) ? r : r.h;
      },
      () => removeItem(h, ids[1]!, false, RULES),
      () => sell(h, ids[3]!, 1, RULES, false),
    ];
    for (const op of ops) h = check(op());
  });
});

describe('gold, buying and selling', () => {
  test('round trip: gold given then taken back is what it was, and never goes below 0', () => {
    expect(addGold(addGold(hunter(40), 25), -25)).toEqual(hunter(40));
    expect(addGold(hunter(10), -50).gold).toBe(0);
    expect(setGold(hunter(), -3).gold).toBe(0);
  });

  test('selling pays saleShare of the price, a quarter, rounded down, at least 1 gold; a free item sells for nothing', () => {
    expect(sellPrice({ value: 25, rar: 'common', type: 'misc' }, RULES), 'a quarter of 25').toBe(6);
    expect(sellPrice({ value: 1, rar: 'common', type: 'misc' }, RULES)).toBe(1);
    expect(sellPrice({ rar: 'common', type: 'misc' }, RULES), 'no value: the rule\'s price, the one a shop asks').toBe(sale(priceOf(RULES, 'common')));
    expect(sellPrice({ value: 0, rar: 'common', type: 'misc' }, RULES)).toBe(0);
    expect(sellPrice({ value: 25, rar: 'common', type: 'misc' }, { ...RULES, saleShare: 0.5 }), 'a GM\'s share of a half').toBe(12);
  });

  test('an Epic+ without a price of its own is bought at 7,500 and sold for 1,875, an Epic− at 3,333 and for 833 (block [2.1])', () => {
    const idol = (grade: number) => parseItem({ name: 'Idol', rar: 'epic', type: 'material', grade })!;
    for (const [grade, price] of [[1, 7500], [-1, 3333]] as const) {
      const h = hunter(1e5), bought = ok(buy(h, own(idol(grade)), iid('i1'), RULES));
      expect([grade, h.gold - bought.gold, sellPrice(idol(grade), RULES)]).toEqual([grade, price, sale(price)]);
    }
    expect([sale(7500), sale(3333)]).toEqual([1875, 833]);
  });

  test('an item without a price of its own is bought and sold at the price rule as it is now', () => {
    const dear: Rules = { ...RULES, priceBase: Object.fromEntries(RANKS.map(r => [r, RULES.priceBase[r] * 3])) as Rules['priceBase'] };
    const h = hunter(1e6), { value: _typed, ...byRule } = shield;
    const bought = ok(buy(h, own(byRule), iid('i1'), dear));
    expect(h.gold - bought.gold).toBe(priceOf(dear, shield.rar, shield.grade));
    expect(ok(sell(bought, 'i1', 1, dear)).gold - bought.gold).toBe(sale(priceOf(dear, shield.rar, shield.grade)));
  });

  test('round trip: buy then sell gives back the item and costs the price less what it sells for', () => {
    const h = hunter(500), it = { ...shield, value: 25 };
    const back = ok(sell(ok(buy(h, own(it), iid('i1'), RULES)), 'i1', 1, RULES));
    expect({ ...back, gold: 0, chronicle: h.chronicle }).toEqual({ ...h, gold: 0 });
    expect(h.gold - back.gold).toBe(25 - sale(25));
    // the System remembers both: the purchase at its price, and the sale at its share of it
    expect(back.chronicle.inbox).toEqual([
      { kind: 'shop', act: 'buy', item: it.name, rar: it.rar, price: 25, goldAfter: 475 },
      { kind: 'shop', act: 'sell', item: it.name, rar: it.rar, price: sale(25), goldAfter: 475 + sale(25) },
    ]);
  });

  test('buying over the borrow cap or with borrowing off is refused; selling more than is held sells what is held', () => {
    expect(buy(hunter(3), own({ ...shield, value: 25 }), iid('i1'), { ...RULES, borrowCapPrices: 0 })).toEqual({ ok: false, why: 'borrow-off' });
    expect(buy(hunter(3), own({ ...shield, value: 200 }), iid('i1'), RULES)).toEqual({ ok: false, why: 'over-cap' });
    const three = { ...hunter(0), items: [ownLine({ ...potion, value: 10 }, 'i1', 3)] };
    const sold = ok(sell(three, 'i1', 9, RULES));
    expect(sold.items).toEqual([]);
    expect(sold.gold).toBe(3 * sale(10));
  });
});

describe('shop borrowing (cap A: 1.5 times rank base price, shared Hunter.debt)', () => {
  const ranked = (rank: Hunter['rank'], gold = 0, debt = 0): Hunter => ({ ...newHunter(RULES), rank, gold, debt });
  const priced = (name: string, value: number, extra: Partial<ItemTemplate> = {}): ItemTemplate => ({ ...shield, name, value, ...extra });

  test('borrowCap equals Math.round(borrowCapPrices * priceBaseOf(R, rank)) for every rank, matching plus-grade own-rank prices at 1.5', () => {
    expect(RANKS.map(r => [r, borrowCap(r, RULES)])).toEqual([
      ['E', 150], ['D', 488], ['C', 1875], ['B', 7500], ['A', 28500], ['S', 112500],
    ]);
    expect(borrowCap('E', { ...RULES, borrowCapPrices: 0 })).toBe(0);
    expect(borrowCap('D', { ...RULES, borrowCapPrices: 3 })).toBe(975);
  });

  test('buying short of gold spends cash first and adds only the shortfall to Hunter.debt up to the cap', () => {
    const item = priced('Iron Blade', 120);
    const h0 = ranked('E', 40, 0);
    const plan = buyPlan(h0, item, RULES);
    expect(plan).toEqual({ ok: true, price: 120, cash: 40, borrow: 80, debtAfter: 80, cap: 150, available: 150 });

    const h1 = ok(buy(h0, own(item), iid('i1'), RULES));
    expect([h1.gold, h1.debt, names(h1)]).toEqual([0, 80, ['Iron Blade']]);
    expect(h1.chronicle.inbox).toEqual([{ kind: 'shop', act: 'buy', item: 'Iron Blade', rar: item.rar, price: 120, goldAfter: 0 }]);

    // second borrow right up to exact cap (80 + 70 = 150) succeeds; 1 gold past cap is refused
    const exact = ok(buy(h1, own(priced('Health Potion', 70)), iid('i2'), RULES));
    expect([exact.gold, exact.debt]).toEqual([0, 150]);
    expect(buy(exact, own(priced('Rock', 1)), iid('i3'), RULES)).toEqual({ ok: false, why: 'over-cap' });
    expect(buy(h1, own(priced('Over', 71)), iid('i3'), RULES)).toEqual({ ok: false, why: 'over-cap' });
  });

  test('a hunter who owes revive debt above the borrow cap cannot borrow, but can still spend cash or take free items', () => {
    const inReviveDebt = ranked('E', 50, 1000);
    expect(buy(inReviveDebt, own(priced('Potion', 50)), iid('i1'), RULES)).toMatchObject({ gold: 0, debt: 1000 });
    expect(buy(inReviveDebt, own(priced('Free', 0)), iid('i2'), RULES)).toMatchObject({ gold: 50, debt: 1000 });
    expect(buy(inReviveDebt, own(priced('Potion', 51)), iid('i3'), RULES)).toEqual({ ok: false, why: 'over-cap' });
  });

  test('borrowing is refused when borrowCapPrices <= 0 or reviveDebtShare <= 0, while cash purchases still work', () => {
    const off = { ...RULES, borrowCapPrices: 0 };
    const noPayoff = { ...RULES, reviveDebtShare: 0 };
    expect(buy(ranked('E', 20, 0), own(priced('Potion', 50)), iid('i1'), off)).toEqual({ ok: false, why: 'borrow-off' });
    expect(buy(ranked('E', 50, 0), own(priced('Potion', 50)), iid('i1'), off)).toMatchObject({ gold: 0, debt: 0 });
    expect(buy(ranked('E', 20, 0), own(priced('Potion', 50)), iid('i1'), noPayoff)).toEqual({ ok: false, why: 'no-payoff' });
    expect(buy(ranked('E', 50, 0), own(priced('Potion', 50)), iid('i1'), noPayoff)).toMatchObject({ gold: 0, debt: 0 });
    // borrowCapPrices === 0 takes precedence over reviveDebtShare === 0
    expect(buy(ranked('E', 0, 0), own(priced('Potion', 50)), iid('i1'), { ...RULES, borrowCapPrices: 0, reviveDebtShare: 0 })).toEqual({ ok: false, why: 'borrow-off' });
  });

  test('Resurrection Crystals follow the same borrow cap with no extra exception', () => {
    const crystalE = refGrant(SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (E)')!.defId); // 1,000 gold
    expect(buy(ranked('E', 0, 0), crystalE, iid('i1'), RULES)).toEqual({ ok: false, why: 'over-cap' });
    expect(buy(ranked('E', 849, 0), crystalE, iid('i1'), RULES)).toEqual({ ok: false, why: 'over-cap' });
    const bridged = ok(buy(ranked('E', 850, 0), crystalE, iid('i1'), RULES));
    expect([bridged.gold, bridged.debt, names(bridged)]).toEqual([0, 150, ['Resurrection Crystal (E)']]);
  });

  test('borrowConfirm, shopCreditLine, and BUY_WORDS state exact amounts and follow GM rule overrides', () => {
    const item = priced('Steel Longsword', 67);
    const h = ranked('E', 10, 20);
    const plan = ok(buyPlan(h, item, RULES));
    expect(borrowConfirm(item.name, plan, RULES)).toEqual({
      title: 'Buy on debt',
      body: 'You are short 57 gold for Steel Longsword (67 gold).',
      lines: [
        'Pay now: 10 gold.',
        'Added to debt: 57 gold.',
        'New total debt: 77 gold.',
        'While you owe debt, 50% of your gate clear gold goes to your debt, 25% is lost to debt costs, and you get 25%. You also earn 25% XP from every source until your debt is paid off.',
      ],
      confirm: 'Borrow 57 gold',
      cancel: 'Cancel',
    });
    expect(BORROW_WORDS.bought(item.name, plan)).toBe('Purchased Steel Longsword (10 gold paid, 57 gold added to debt).');

    expect(shopCreditLine(ranked('E', 0, 0), RULES)).toBe('Shop credit: you can borrow up to 150 gold (rank E limit).');
    expect(shopCreditLine(ranked('E', 0, 60), RULES)).toBe('Shop credit: you can borrow up to 90 gold more (rank E limit: 150 gold, you owe 60 gold).');
    expect(shopCreditLine(ranked('E', 0, 1000), RULES)).toBe('Shop credit: you can borrow 0 gold (rank E limit: 150 gold, you owe 1,000 gold).');
    expect(shopCreditLine(ranked('E', 0, 0), { ...RULES, borrowCapPrices: 0 })).toBeNull();
    expect(shopCreditLine(ranked('E', 0, 0), { ...RULES, reviveDebtShare: 0 })).toBe(BORROW_WORDS.paused);
    expect(shopCreditLine({ ...ranked('E', 0, 0), life: { at: 'dead' } }, RULES)).toBeNull();

    const words = buyWords(ranked('E', 10, 60), priced('Knight Killer', 833), RULES);
    expect(Object.keys(words).sort()).toEqual([...BUY_REFUSALS].sort());
    expect(words['over-cap']).toBe('You cannot borrow 823 gold for Knight Killer. Your rank E borrow limit is 150 gold, and you can borrow up to 90 gold.');
    expect(words['borrow-off']).toBe('Knight Killer costs 833 gold, and you have 10 gold. Shop borrowing is off.');
    expect(words['no-payoff']).toBe('You cannot borrow for Knight Killer. Debt payments from gate clears are at 0%, so you could not pay the debt off.');
    expect(words.dead).toBe(SHOP_CLOSED);

    const overRevive = buyWords(ranked('E', 10, 1000), priced('Health Potion', 50), RULES);
    expect(overRevive['over-cap']).toBe('You cannot borrow 40 gold for Health Potion. Your rank E borrow limit is 150 gold and you already owe 1,000 gold, so you can borrow 0 gold right now.');
  });
});

describe('the GM\'s shop', () => {
  test('an edit replaces the item it was opened on, a new one goes at the end, a removal takes its place out, and no item is listed twice', () => {
    const shown = [POTION_ID, SHIELD_ID];
    expect(writeShopItem(shown, POTION_ID, customId('dear-potion'))).toEqual([customId('dear-potion'), SHIELD_ID]);
    expect(writeShopItem(shown, null, customId('ring-a'))).toEqual([POTION_ID, SHIELD_ID, customId('ring-a')]);
    expect(writeShopItem(shown, null, SHIELD_ID)).toEqual([POTION_ID, SHIELD_ID]);
    expect(removeShopItem(shown, 0)).toEqual([SHIELD_ID]);
    expect(shown).toEqual([POTION_ID, SHIELD_ID]);
  });
});

test('the GM\'s shop list is set as one step, a copy of the list given, and set back to none for the default shop (implicit audit 3, I3)', () => {
  const list = [POTION_ID, SHIELD_ID];
  const set = withShop<{ shop: ItemDefId[] | null; other: number }>({ shop: null, other: 1 }, list);
  expect(set).toEqual({ shop: list, other: 1 });
  expect(set.shop).not.toBe(list);
  expect(withShop(set, null)).toEqual({ shop: null, other: 1 });
});

describe('a Resurrection Crystal is not bought back (notes-2b-crystal.md section 3)', () => {
  const seed = SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (S)')!;
  const crystal = itemOf(RULES, seed);

  test('a sale is refused and changes nothing; its sell price is 0; any other item still sells for its share', () => {
    const h = putItem(hunter(0), refGrant(seed.defId), iid('i1'), RULES);
    expect(sellable(crystal)).toBe(false);
    expect(sell(h, 'i1', 1, RULES)).toEqual({ ok: false, why: 'unsellable' });
    expect(sellPrice(crystal, RULES)).toBe(0);
    const { revive: _r, ...plain } = crystal;
    expect(sellPrice({ ...plain, value: 750000 }, RULES), 'the same price without the revive sells for its share').toBe(sale(750000));
  });

  test('bought, it costs its price and joins the bag; a copy that does not revive is a def of its own and its own stack', () => {
    const { revive: _r, ...plain } = crystal;
    const R = rulesWith(defOf('plain-crystal', plain));
    const h = ok(buy(hunter(750000), refGrant(seed.defId), iid('i1'), R));
    expect([h.gold, bagOf(h, R).map(i => [i.name, i.qty])]).toEqual([0, [['Resurrection Crystal (S)', 1]]]);
    expect(putItem(h, refGrant(customId('plain-crystal')), iid('i2'), R).items.map(i => i.id)).toEqual(['i1', 'i2']);
    expect(putItem(h, refGrant(seed.defId), iid('i3'), R).items.map(i => [i.id, i.qty])).toEqual([['i1', 2]]);
  });
});

describe('the shop is closed to the dead (the owner, Nov 19: "Whole shop should be closed in death")', () => {
  const crystal = refGrant(SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (S)')!.defId);
  const rich = (life: Hunter['life']): Hunter => ({ ...putItem(hunter(200000), refGrant(POTION_ID), iid('i1'), RULES), life });

  test('a dead hunter buys nothing, a Resurrection Crystal included, and sells nothing; the hunter is left as it was', () => {
    const dead = rich({ at: 'dead' });
    expect(buy(dead, crystal, iid('i2'), RULES)).toEqual({ ok: false, why: 'dead' });
    expect(buy(dead, refGrant(POTION_ID), iid('i2'), RULES)).toEqual({ ok: false, why: 'dead' });
    expect(sell(dead, 'i1', 1, RULES)).toEqual({ ok: false, why: 'dead' });
    expect(shopOpen(dead)).toBe(false);
  });

  test('a hunter who is up buys and sells at any HP', () => {
    const life = { at: 'up', hp: 1 } as const;
    expect(shopOpen({ life })).toBe(true);
    expect(ok(buy(rich(life), refGrant(POTION_ID), iid('i2'), RULES)).items.find(i => i.id === 'i1')!.qty).toBe(2);
    expect(ok(sell(rich(life), 'i1', 1, RULES)).items).toEqual([]);
  });

  test('a refused purchase says why: borrow-off names price and gold; dead names the ways back and who can give a crystal', () => {
    expect(BUY_WORDS['borrow-off']({ name: 'Health Potion', rank: 'E', price: 50, have: 10, need: 40, debt: 0, cap: 0, available: 0 })).toBe('Health Potion costs 50 gold, and you have 10 gold. Shop borrowing is off.');
    expect(BUY_WORDS.dead({ name: 'Health Potion', rank: 'E', price: 50, have: 10, need: 40, debt: 0, cap: 150, available: 150 })).toBe(SHOP_CLOSED);
    expect(SHOP_CLOSED).toBe(`The shop is closed while you are dead. You cannot buy or sell. ${WAYS_BACK} brings you back. The GM or another hunter can give you a Resurrection Crystal.`);
  });
});
