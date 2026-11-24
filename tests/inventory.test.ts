import { describe, expect, test } from 'bun:test';
import { BORROW_WORDS, BUY_REFUSALS, BUY_WORDS, GEAR_WORDS, SHOP_CLOSED, WEAR_EVENTS, WEAR_STATES, addGold, borrowConfirm, buy, buyPlan, buyWords, editItem, equip, handLockedBy, parseWorn, putItem, removeItem, removeShopItem, sell, sellPrice, sellable, setGold, shopCreditLine, shopOpen, takeItems, unequip, wearMove, wearOf, wearPlan, wearSet, withShop, wornCount, writeShopItem } from '../src/core/hunter/inventory.ts';
import type { WearEvent, WearState, WearWhy } from '../src/core/hunter/inventory.ts';
import { LOADOUT_WORDS, saveLoadout, swapLoadout } from '../src/core/hunter/loadouts.ts';
import { borrowCap } from '../src/core/hunter/revive-standing.ts';
import { parseSheetHunter } from '../src/core/hunter/hunter.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { heldPowers, hunterAbilities, hunterRow } from '../src/core/combat/rows.ts';
import { GEAR, IN_BAG, reparsedWorn, wearBy } from './models/gear-events.ts';
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
const ring = (name: string): ItemTemplate => ({ ...shield, name, type: 'accessory', slot: 'ring1', weight: 0, armor: 0, resist: 0, bonus: { str: 1 } });
const hunter = (gold = 100): Hunter => ({ ...newHunter(RULES), gold });
/** What the Association pays for one of a thing priced `price`: `saleShare` of it, rounded down, at least 1 (economy design 3). */
const sale = (price: number, R: Pick<Rules, 'saleShare'> = RULES): number => (price > 0 ? Math.max(1, Math.floor(price * R.saleShare)) : 0);

describe('the bag', () => {
  const differing: [string, Partial<ItemTemplate>][] = [['description', { desc: 'a second telling' }], ['attack', { attack: 'shot' }], ['grade', { grade: 1 }], ['icon', { icon: 'crystal' }], ['rankCap', { rankCap: true }]];
  for (const [what, change] of differing) {
    test(`two slotless things that differ only in their ${what} stay two stacks`, () => {
      const h = putItem(putItem(hunter(), potion, iid('i1')), { ...potion, ...change }, iid('i2'));
      expect(h.items.map(i => i.id)).toEqual(['i1', 'i2']);
      expect(h.items[1]).toMatchObject(change);
    });
  }

  test('a thing without a slot joins its stack; gear makes its own entry', () => {
    const h = putItem(putItem(hunter(), potion, iid('i1')), potion, iid('i2'));
    expect(h.items).toEqual([{ ...potion, id: 'i1', qty: 2 }]);
    const g = putItem(putItem(hunter(), shield, iid('i1')), shield, iid('i2'));
    expect(g.items.map(i => i.id)).toEqual(['i1', 'i2']);
  });

  test('an Epic+ and an Epic of one name are two stacks, two Epic+ are one, and an Epic read with no grade joins the Epic', () => {
    const idol = parseItem({ name: 'Idol', rar: 'epic', type: 'material' })!, plus = parseItem({ name: 'Idol', rar: 'epic', type: 'material', grade: 1 })!;
    const h = [plus, idol, plus, parseItem({ name: 'Idol', rar: 'epic', type: 'material', grade: 0 })!].reduce((x, it, n) => putItem(x, it, iid(`i${n + 1}`)), hunter());
    expect(h.items.map(i => [i.id, i.grade ?? 0, i.qty])).toEqual([['i1', 1, 2], ['i2', 0, 2]]);
  });

  test('round trip: an item put in the bag and removed leaves the hunter as it was', () => {
    const h = hunter();
    expect(ok(removeItem(putItem(h, shield, iid('i1')), 'i1', false))).toEqual(h);
  });

  test('taking the last one of a worn item takes it out of its slot too', () => {
    const worn = ok(equip(putItem(hunter(), shield, iid('i1')), 'i1', iid('i900'), false));
    const gone = ok(takeItems(worn, 'i1', 1));
    expect(gone.items).toEqual([]);
    expect(gone.equipped.offhand).toBeNull();
    expect(takeItems(gone, 'i1', 1)).toEqual({ ok: false, why: 'no-item' });
  });

  test('an edit keeps the id; gear edited into a thing without a slot is taken off', () => {
    const worn = ok(equip(putItem(hunter(), shield, iid('i1')), 'i1', iid('i900'), false));
    const edited = ok(editItem(worn, 'i1', { ...shield, name: 'Plank', slot: null, type: 'misc' }, false));
    expect(edited.items[0]).toMatchObject({ id: 'i1', name: 'Plank' });
    expect(edited.equipped.offhand).toBeNull();
  });
});

describe('what is worn', () => {
  test('round trip: equip then unequip leaves the hunter as it was', () => {
    const h = putItem(hunter(), shield, iid('i1'));
    expect(ok(unequip(ok(equip(h, 'i1', iid('i900'), false)), 'offhand', false))).toEqual(h);
  });

  test('a ring goes to the first free ring slot; a third swaps out the one in its own slot', () => {
    let h = putItem(putItem(putItem(hunter(), ring('A'), iid('r1')), ring('B'), iid('r2')), ring('C'), iid('r3'));
    h = ok(equip(h, 'r1', iid('i901'), false)); h = ok(equip(h, 'r2', iid('i901'), false));
    expect([h.equipped.ring1, h.equipped.ring2]).toEqual(['r1', 'r2']);
    h = ok(equip(h, 'r3', iid('i901'), false));
    expect([h.equipped.ring1, h.equipped.ring2]).toEqual(['r3', 'r2']);
  });

  test('one of a stack of gear is split off and worn', () => {
    const two = { ...putItem(hunter(), shield, iid('i1')), items: [{ ...shield, id: iid('i1'), qty: 2 }] };
    const h = ok(equip(two, 'i1', iid('i9'), false));
    expect(h.items.map(i => [i.id, i.qty])).toEqual([['i1', 1], ['i9', 1]]);
    expect(h.equipped.offhand).toBe(iid('i9'));
  });

  test('a thing without a slot, an item not held and a word that is not a slot are refused', () => {
    expect(equip(putItem(hunter(), potion, iid('i1')), 'i1', iid('i901'), false)).toEqual({ ok: false, why: 'not-gear' });
    expect(equip(hunter(), 'nope', iid('i901'), false)).toEqual({ ok: false, why: 'no-item' });
    expect(unequip(hunter(), 'tail', false)).toEqual({ ok: false, why: 'no-slot' });
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
    worn: () => ok(equip(IN_BAG(), GEAR, iid('i900'), false)),
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
            expect(wearOf(ok(after), GEAR)).toBe(cell as WearState);
            expect(wearMove(h, GEAR, event, inFight)).toBe(cell as WearState);
          } else {
            expect(after).toEqual({ ok: false, why: cell });
            expect(wearMove(h, GEAR, event, inFight)).toEqual({ ok: false, why: cell });
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
    const iron = [{ ...strong('Iron Ring'), id: iid('i1') }];
    const twice = read(iron, { ring1: iid('i1'), ring2: iid('i1') }), bare = read(iron, {});
    expect([twice.equipped.ring1, twice.equipped.ring2]).toEqual([iid('i1'), null]);
    expect(hunterSheet(twice, RULES).stats.str - hunterSheet(bare, RULES).stats.str, 'one ring of +5 strength').toBe(5);
  });

  test('a save that wears a stack of three, or a shield on the head, reads that slot empty and keeps the item in the bag (5.1)', () => {
    const h = read([{ ...shield, id: iid('i1'), qty: 3 }, { ...shield, id: iid('i2') }], { offhand: iid('i1'), head: iid('i2') });
    expect([h.equipped.offhand, h.equipped.head]).toEqual([null, null]);
    expect(h.items.map(i => [i.id, i.qty])).toEqual([['i1', 3], ['i2', 1]]);
    const fine = read([{ ...shield, id: iid('i1') }], { offhand: iid('i1') });
    expect(fine.equipped.offhand, 'a single shield in its own slot stays worn').toBe(iid('i1'));
  });

  test('an edit that moves a worn shield to the chest, or makes it a stack of three, takes it off; an edit of its words leaves it worn (5.2)', () => {
    const worn = AT.worn();
    for (const change of [{ slot: 'chest' }, { qty: 3 }] as const) {
      const h = ok(editItem(worn, GEAR, { ...shield, ...change }, false));
      expect(Object.values(h.equipped), JSON.stringify(change)).toEqual(Object.values(hunter().equipped));
      expect(wearOf(h, GEAR)).toBe('bag');
    }
    expect(ok(editItem(worn, GEAR, { ...shield, desc: 'Notched.' }, false)).equipped.offhand).toBe(GEAR);
  });

  test('a ring worn in the second ring slot, edited to say the first, still fits and stays where it is', () => {
    let h = putItem(putItem(hunter(), ring('A'), iid('r1')), ring('B'), iid('r2'));
    h = ok(equip(ok(equip(h, 'r1', iid('i901'), false)), 'r2', iid('i901'), false));
    expect(ok(editItem(h, 'r2', { ...ring('B'), slot: 'ring1', desc: 'Etched.' }, false)).equipped).toMatchObject({ ring1: 'r1', ring2: 'r2' });
  });

  test('Equip on a ring worn in the first ring slot leaves it there and the second slot empty (5.3b)', () => {
    const h = ok(equip(putItem(hunter(), ring('A'), iid('r1')), 'r1', iid('i901'), false));
    expect(ok(equip(h, 'r1', iid('i901'), false))).toEqual(h);
  });

  test('in a fight a worn shield is not sold, removed or edited; a potion in the bag still sells, and the refusal has words (5.3c)', () => {
    const worn = putItem(AT.worn(), potion, iid('i2'));
    const R = RULES;
    expect(sell(worn, GEAR, 1, R, true)).toEqual({ ok: false, why: 'in-fight' });
    expect(removeItem(worn, GEAR, true)).toEqual({ ok: false, why: 'in-fight' });
    expect(editItem(worn, GEAR, { ...shield, desc: 'Notched.' }, true)).toEqual({ ok: false, why: 'in-fight' });
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
  const bow2h = (name = 'Longbow'): ItemTemplate => gear(name, 'weapon', { dice: '1d8', attack: 'shot', twoHanded: true });

  const sixWorn = (): Hunter => {
    let h = hunter();
    const picks: [string, Slot][] = [['Sword', 'weapon'], ['Shield', 'offhand'], ['Helm', 'head'], ['Mail', 'chest'], ['Charm', 'neck'], ['Greaves', 'legs']];
    picks.forEach(([nm, sl], idx) => {
      const id = iid(`i${idx + 1}`);
      h = ok(equip(putItem(h, gear(nm, sl), id), id, iid('i999'), false));
    });
    return h;
  };

  test('wearing 6 items blocks a 7th empty slot with wear-limit, while swapping an occupied slot still works', () => {
    let h = putItem(putItem(sixWorn(), gear('Boots', 'feet'), iid('i7')), gear('Crown', 'head'), iid('i8'));
    expect(wornCount(h)).toBe(WEAR_LIMIT);
    expect(wearPlan(h, 'i7', false)).toEqual({ ok: false, why: 'wear-limit' });
    expect(equip(h, 'i7', iid('i999'), false)).toEqual({ ok: false, why: 'wear-limit' });
    expect(GEAR_WORDS['wear-limit']).toBe('You are already wearing 6 of 6 items. Unequip an item first.');
    expect(wearPlan(h, 'i8', false)).toEqual({ ok: true, slot: 'head', replaces: [iid('i3')] });
    h = ok(equip(h, 'i8', iid('i999'), false));
    expect(h.equipped.head).toBe(iid('i8'));
    expect(wornCount(h)).toBe(WEAR_LIMIT);
    expect(h.equipped).toEqual(reparsedWorn(h));
  });

  test('in-fight wins over wear-limit when trying to equip a 7th item during a fight', () => {
    const h = putItem(sixWorn(), gear('Boots', 'feet'), iid('i7'));
    expect(wearPlan(h, 'i7', true)).toEqual({ ok: false, why: 'in-fight' });
    expect(equip(h, 'i7', iid('i999'), true)).toEqual({ ok: false, why: 'in-fight' });
  });

  test('ring at the cap: empty ring slots refuse at 6/6, one worn ring swaps that ring slot, two worn rings swap its own slot', () => {
    let h = putItem(sixWorn(), ring('A'), iid('r1'));
    expect(wearPlan(h, 'r1', false), 'neither ring worn at 6/6 refuses').toEqual({ ok: false, why: 'wear-limit' });
    h = ok(unequip(h, 'legs', false));
    h = ok(equip(h, 'r1', iid('i999'), false)); // now 6/6 with r1 in ring1, ring2 empty
    expect(h.equipped.ring1).toBe(iid('r1'));
    expect(h.equipped.ring2).toBeNull();
    h = putItem(h, { ...ring('B'), slot: 'ring2' }, iid('r2'));
    // ring2 is empty (would be 7th), so wearPlan falls through to occupied ring1 and swaps it
    expect(wearPlan(h, 'r2', false)).toEqual({ ok: true, slot: 'ring1', replaces: [iid('r1')] });
    h = ok(equip(h, 'r2', iid('i999'), false));
    expect([h.equipped.ring1, h.equipped.ring2, wornCount(h)]).toEqual([iid('r2'), null, WEAR_LIMIT]);
    // with both ring slots worn at 6/6, a ring marked ring2 swaps ring2
    h = ok(unequip(h, 'neck', false));
    h = ok(equip(putItem(h, ring('C'), iid('r3')), 'r3', iid('i999'), false)); // r2 in ring1, r3 in ring2, total 6
    h = putItem(h, { ...ring('D'), slot: 'ring2' }, iid('r4'));
    expect(wearPlan(h, 'r4', false)).toEqual({ ok: true, slot: 'ring2', replaces: [iid('r3')] });
  });

  test('two-handed weapon counts as 1 of 6, locks offhand, swaps out both hands atomically, and yields to an offhand equip', () => {
    let h = putItem(sixWorn(), bow2h('Frost Bow'), iid('b1'));
    expect(wearPlan(h, 'b1', false)).toEqual({ ok: true, slot: 'weapon', replaces: [iid('i1'), iid('i2')] });
    h = ok(equip(h, 'b1', iid('i999'), false));
    expect([h.equipped.weapon, h.equipped.offhand, wornCount(h)]).toEqual([iid('b1'), null, 5]);
    expect(handLockedBy(h)?.id).toBe(iid('b1'));
    // now equip a 6th item in orb -> 6 of 6 while wearing a 2H weapon
    h = ok(equip(putItem(h, gear('Relic Orb', 'orb'), iid('o1')), 'o1', iid('i999'), false));
    expect(wornCount(h)).toBe(WEAR_LIMIT);
    // equipping offhand at 6/6 swaps out the 2H weapon (net 0 -> allowed)
    expect(wearPlan(h, 'i2', false)).toEqual({ ok: true, slot: 'offhand', replaces: [iid('b1')] });
    h = ok(equip(h, 'i2', iid('i999'), false));
    expect([h.equipped.weapon, h.equipped.offhand, wornCount(h), handLockedBy(h)]).toEqual([null, iid('i2'), WEAR_LIMIT, null]);
    expect(h.equipped).toEqual(reparsedWorn(h));
  });

  test('editing a worn one-handed weapon to two-handed clears offhand via parseWorn', () => {
    let h = ok(equip(putItem(hunter(), gear('Sword', 'weapon'), iid('w1')), 'w1', iid('i999'), false));
    h = ok(equip(putItem(h, gear('Shield', 'offhand'), iid('s1')), 's1', iid('i999'), false));
    const edited = ok(editItem(h, 'w1', bow2h('Greatsword'), false));
    expect([edited.equipped.weapon, edited.equipped.offhand]).toEqual([iid('w1'), null]);
    expect(edited.equipped).toEqual(reparsedWorn(edited));
  });

  test('parseWorn trims >6 worn items in SLOTS order, skips offhand under a 2H weapon, and drops unknown old hands slot to bag', () => {
    const allItems = SLOTS.map((sl, idx) => ({ ...gear(`Item ${sl}`, sl, sl === 'weapon' ? { twoHanded: true } : {}), id: iid(`i${idx + 1}`) }));
    const oldHands = { ...parseItem({ name: 'Old Gloves', type: 'armor', slot: 'hands' })!, id: iid('i99') };
    expect(oldHands.slot).toBeNull();
    const rawEquipped = Object.fromEntries(SLOTS.map((sl, idx) => [sl, iid(`i${idx + 1}`)]));
    const parsed = parseSheetHunter(JSON.parse(JSON.stringify({ ...hunter(0), items: [...allItems, oldHands], equipped: rawEquipped })))!;
    // weapon (2H) kept, offhand skipped, then head, chest, neck, legs, feet kept = 6; orb, ring1, ring2 in bag
    expect(Object.entries(parsed.equipped).filter(([, v]) => v !== null).map(([k]) => k)).toEqual(['weapon', 'head', 'chest', 'neck', 'legs', 'feet']);
    expect(wornCount(parsed)).toBe(WEAR_LIMIT);
    expect(parsed.equipped).toEqual(reparsedWorn(parsed));
  });

  test('SLOTS order drives heldPowers order and a running fight keeps its row sheet on load while hunterAbilities reflects trimmed gear', () => {
    const withPower = (name: string, slot: Slot): ItemTemplate => gear(name, slot, {
      worn: { label: `${name} Aura`, desc: '', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 1 } }] },
    });
    const slots = SLOTS.slice(0, 8);
    const items = slots.map((sl, idx) => ({ ...withPower(`P-${sl}`, sl), id: iid(`i${idx + 1}`) }));
    const rawEq = Object.fromEntries(slots.map((sl, idx) => [sl, iid(`i${idx + 1}`)]));
    const base = newSave(dev('d-00000001'));
    const h: Hunter = { ...newHunter(RULES), items, equipped: { ...newHunter(RULES).equipped, ...rawEq } };
    // row snapshotted before load (e.g. mid-session reload with running fight)
    const beforeRow = hunterRow(h, cid('c1'), RULES);
    const parsed = parseSave(JSON.stringify({ ...base, hunters: [h] }), { now: new Date(1), newDeviceId: () => dev('d-00000001'), newDeviceToken: () => 't'.repeat(32) });
    if (parsed.kind !== 'save') throw new Error('expected save');
    const afterH = parsed.save.hunters[0]!;
    expect(wornCount(afterH)).toBe(WEAR_LIMIT);
    expect(heldPowers(afterH, RULES).map(p => p.powers.worn?.label)).toEqual(SLOTS.slice(0, 6).map(sl => `P-${sl} Aura`));
    expect(beforeRow.statuses.length, 'snapshot row held pre-trim statuses').toBe(8);
    expect(hunterAbilities(afterH, RULES).length).toBeGreaterThanOrEqual(1);
  });

  test('wearSet and swapLoadout enforce in-fight, 2H offhand clearance even on skipped slots, and WEAR_LIMIT, naming left items', () => {
    let h = sixWorn();
    h = putItem(putItem(h, bow2h('Greatbow'), iid('b1')), gear('Boots', 'feet'), iid('f1'));
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
    expect(wornCount(after)).toBe(WEAR_LIMIT);
    expect(swapped.left).toContain('Shield');
    expect(after.equipped).toEqual(reparsedWorn(after));
    // saving a loadout captures only the 6 worn slots
    const saved = ok(saveLoadout(after, loid('lo2'), 'Clean', RULES));
    expect(Object.keys(saved.loadouts.at(-1)!.slots).length).toBe(WEAR_LIMIT);
  });

  test('property: every wear step answer is a fixed point of parseWorn', () => {
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
    defs.forEach((d, idx) => { const id = iid(`i${idx + 1}`); ids.push(id); h = putItem(h, d, id); });
    const check = (next: Hunter | Refused<string>): Hunter => {
      if (isRefused(next)) return h;
      expect(next.equipped).toEqual(reparsedWorn(next));
      expect(wornCount(next)).toBeLessThanOrEqual(WEAR_LIMIT);
      if (handLockedBy(next)) expect(next.equipped.offhand).toBeNull();
      return next;
    };
    let seq = 500;
    const ops: (() => Hunter | Refused<string>)[] = [
      () => equip(h, ids[0]!, iid(`i${++seq}`), false),
      () => equip(h, ids[2]!, iid(`i${++seq}`), false),
      () => equip(h, ids[3]!, iid(`i${++seq}`), false),
      () => equip(h, ids[4]!, iid(`i${++seq}`), false),
      () => equip(h, ids[5]!, iid(`i${++seq}`), false),
      () => equip(h, ids[6]!, iid(`i${++seq}`), false),
      () => equip(h, ids[7]!, iid(`i${++seq}`), false), // refused wear-limit
      () => equip(h, ids[1]!, iid(`i${++seq}`), false), // 2H swaps out weapon + offhand
      () => equip(h, ids[8]!, iid(`i${++seq}`), false), // orb fills 6th
      () => equip(h, ids[9]!, iid(`i${++seq}`), false), // ring refused at 6/6
      () => equip(h, ids[2]!, iid(`i${++seq}`), false), // offhand swaps out 2H at 6/6
      () => unequip(h, 'legs', false),
      () => equip(h, ids[9]!, iid(`i${++seq}`), false),
      () => equip(h, ids[10]!, iid(`i${++seq}`), false), // ring2 swaps ring1 at 6/6
      () => editItem(h, ids[0]!, bow2h('Edited 2H'), false),
      () => equip(h, ids[0]!, iid(`i${++seq}`), false),
      () => {
        const r = wearSet(h, { weapon: ids[1]!, offhand: ids[2]!, head: ids[3]!, chest: ids[4]!, neck: ids[5]!, legs: ids[6]!, feet: ids[7]!, orb: ids[8]! }, () => iid(`i${++seq}`), false);
        return isRefused(r) ? r : r.h;
      },
      () => removeItem(h, ids[1]!, false),
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
      const h = hunter(1e5), bought = ok(buy(h, idol(grade), iid('i1'), RULES));
      expect([grade, h.gold - bought.gold, sellPrice(idol(grade), RULES)]).toEqual([grade, price, sale(price)]);
    }
    expect([sale(7500), sale(3333)]).toEqual([1875, 833]);
  });

  test('an item without a price of its own is bought and sold at the price rule as it is now', () => {
    const dear: Rules = { ...RULES, priceBase: Object.fromEntries(RANKS.map(r => [r, RULES.priceBase[r] * 3])) as Rules['priceBase'] };
    const h = hunter(1e6), { value: _typed, ...byRule } = shield;
    const bought = ok(buy(h, byRule, iid('i1'), dear));
    expect(h.gold - bought.gold).toBe(priceOf(dear, shield.rar, shield.grade));
    expect(ok(sell(bought, 'i1', 1, dear)).gold - bought.gold).toBe(sale(priceOf(dear, shield.rar, shield.grade)));
  });

  test('round trip: buy then sell gives back the item and costs the price less what it sells for', () => {
    const h = hunter(500), it = { ...shield, value: 25 };
    const back = ok(sell(ok(buy(h, it, iid('i1'), RULES)), 'i1', 1, RULES));
    expect({ ...back, gold: 0, chronicle: h.chronicle }).toEqual({ ...h, gold: 0 });
    expect(h.gold - back.gold).toBe(25 - sale(25));
    // the System remembers both: the purchase at its price, and the sale at its share of it
    expect(back.chronicle.inbox).toEqual([
      { kind: 'shop', act: 'buy', item: it.name, rar: it.rar, price: 25, goldAfter: 475 },
      { kind: 'shop', act: 'sell', item: it.name, rar: it.rar, price: sale(25), goldAfter: 475 + sale(25) },
    ]);
  });

  test('buying over the borrow cap or with borrowing off is refused; selling more than is held sells what is held', () => {
    expect(buy(hunter(3), { ...shield, value: 25 }, iid('i1'), { ...RULES, borrowCapPrices: 0 })).toEqual({ ok: false, why: 'borrow-off' });
    expect(buy(hunter(3), { ...shield, value: 200 }, iid('i1'), RULES)).toEqual({ ok: false, why: 'over-cap' });
    const three = { ...hunter(0), items: [{ ...potion, id: iid('i1'), qty: 3, value: 10 }] };
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

    const h1 = ok(buy(h0, item, iid('i1'), RULES));
    expect([h1.gold, h1.debt, h1.items.map(i => i.name)]).toEqual([0, 80, ['Iron Blade']]);
    expect(h1.chronicle.inbox).toEqual([{ kind: 'shop', act: 'buy', item: 'Iron Blade', rar: item.rar, price: 120, goldAfter: 0 }]);

    // second borrow right up to exact cap (80 + 70 = 150) succeeds; 1 gold past cap is refused
    const exact = ok(buy(h1, priced('Health Potion', 70), iid('i2'), RULES));
    expect([exact.gold, exact.debt]).toEqual([0, 150]);
    expect(buy(exact, priced('Rock', 1), iid('i3'), RULES)).toEqual({ ok: false, why: 'over-cap' });
    expect(buy(h1, priced('Over', 71), iid('i3'), RULES)).toEqual({ ok: false, why: 'over-cap' });
  });

  test('a hunter who owes revive debt above the borrow cap cannot borrow, but can still spend cash or take free items', () => {
    const inReviveDebt = ranked('E', 50, 1000);
    expect(buy(inReviveDebt, priced('Potion', 50), iid('i1'), RULES)).toMatchObject({ gold: 0, debt: 1000 });
    expect(buy(inReviveDebt, priced('Free', 0), iid('i2'), RULES)).toMatchObject({ gold: 50, debt: 1000 });
    expect(buy(inReviveDebt, priced('Potion', 51), iid('i3'), RULES)).toEqual({ ok: false, why: 'over-cap' });
  });

  test('borrowing is refused when borrowCapPrices <= 0 or reviveDebtShare <= 0, while cash purchases still work', () => {
    const off = { ...RULES, borrowCapPrices: 0 };
    const noPayoff = { ...RULES, reviveDebtShare: 0 };
    expect(buy(ranked('E', 20, 0), priced('Potion', 50), iid('i1'), off)).toEqual({ ok: false, why: 'borrow-off' });
    expect(buy(ranked('E', 50, 0), priced('Potion', 50), iid('i1'), off)).toMatchObject({ gold: 0, debt: 0 });
    expect(buy(ranked('E', 20, 0), priced('Potion', 50), iid('i1'), noPayoff)).toEqual({ ok: false, why: 'no-payoff' });
    expect(buy(ranked('E', 50, 0), priced('Potion', 50), iid('i1'), noPayoff)).toMatchObject({ gold: 0, debt: 0 });
    // borrowCapPrices === 0 takes precedence over reviveDebtShare === 0
    expect(buy(ranked('E', 0, 0), priced('Potion', 50), iid('i1'), { ...RULES, borrowCapPrices: 0, reviveDebtShare: 0 })).toEqual({ ok: false, why: 'borrow-off' });
  });

  test('Resurrection Crystals follow the same borrow cap with no extra exception', () => {
    const crystalE = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (E)')!); // 1,000 gold
    expect(buy(ranked('E', 0, 0), crystalE, iid('i1'), RULES)).toEqual({ ok: false, why: 'over-cap' });
    expect(buy(ranked('E', 849, 0), crystalE, iid('i1'), RULES)).toEqual({ ok: false, why: 'over-cap' });
    const bridged = ok(buy(ranked('E', 850, 0), crystalE, iid('i1'), RULES));
    expect([bridged.gold, bridged.debt, bridged.items.map(i => i.name)]).toEqual([0, 150, ['Resurrection Crystal (E)']]);
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
  test('an edit replaces the item of that name, a new one goes at the end, a removal takes its place out', () => {
    const shown = [potion, shield];
    expect(writeShopItem(shown, potion.name, { ...potion, value: 99 })[0]!.value).toBe(99);
    expect(writeShopItem(shown, null, ring('A')).map(t => t.name)).toEqual([potion.name, shield.name, 'A']);
    expect(removeShopItem(shown, 0)).toEqual([shield]);
    expect(shown).toEqual([potion, shield]);
  });
});

test('the GM\'s shop list is set as one step, a copy of the list given, and set back to none for the default shop (implicit audit 3, I3)', () => {
  const list = [{ name: 'Rope', rar: 'common', type: 'material', qty: 1 }] as never[];
  const set = withShop<{ shop: never[] | null; other: number }>({ shop: null, other: 1 }, list);
  expect(set).toEqual({ shop: list, other: 1 });
  expect(set.shop).not.toBe(list);
  expect(withShop(set, null)).toEqual({ shop: null, other: 1 });
});

describe('a Resurrection Crystal is not bought back (notes-2b-crystal.md section 3)', () => {
  const crystal = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (S)')!);

  test('a sale is refused and changes nothing; its sell price is 0; any other item still sells for its share', () => {
    const h = putItem(hunter(0), crystal, iid('i1'));
    expect(sellable(crystal)).toBe(false);
    expect(sell(h, 'i1', 1, RULES)).toEqual({ ok: false, why: 'unsellable' });
    expect(sellPrice(crystal, RULES)).toBe(0);
    const { revive: _r, ...plain } = crystal;
    expect(sellPrice({ ...plain, value: 750000 }, RULES), 'the same price without the revive sells for its share').toBe(sale(750000));
  });

  test('bought, it costs its price and joins the bag; a copy that does not revive is its own stack', () => {
    const h = ok(buy(hunter(750000), crystal, iid('i1'), RULES));
    expect([h.gold, h.items.map(i => [i.name, i.qty])]).toEqual([0, [['Resurrection Crystal (S)', 1]]]);
    const { revive: _r, ...plain } = crystal;
    expect(putItem(h, plain, iid('i2')).items.map(i => i.id)).toEqual(['i1', 'i2']);
    expect(putItem(h, crystal, iid('i3')).items.map(i => [i.id, i.qty])).toEqual([['i1', 2]]);
  });
});

describe('the shop is closed to the dead (the owner, Nov 19: "Whole shop should be closed in death")', () => {
  const crystal = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (S)')!);
  const rich = (life: Hunter['life']): Hunter => ({ ...putItem(hunter(200000), potion, iid('i1')), life });

  test('a dead hunter buys nothing, a Resurrection Crystal included, and sells nothing; the hunter is left as it was', () => {
    const dead = rich({ at: 'dead' });
    expect(buy(dead, crystal, iid('i2'), RULES)).toEqual({ ok: false, why: 'dead' });
    expect(buy(dead, potion, iid('i2'), RULES)).toEqual({ ok: false, why: 'dead' });
    expect(sell(dead, 'i1', 1, RULES)).toEqual({ ok: false, why: 'dead' });
    expect(shopOpen(dead)).toBe(false);
  });

  test('a hunter who is up buys and sells at any HP', () => {
    const life = { at: 'up', hp: 1 } as const;
    expect(shopOpen({ life })).toBe(true);
    expect(ok(buy(rich(life), potion, iid('i2'), RULES)).items.find(i => i.id === 'i1')!.qty).toBe(2);
    expect(ok(sell(rich(life), 'i1', 1, RULES)).items).toEqual([]);
  });

  test('a refused purchase says why: borrow-off names price and gold; dead names the ways back and who can give a crystal', () => {
    expect(BUY_WORDS['borrow-off']({ name: 'Health Potion', rank: 'E', price: 50, have: 10, need: 40, debt: 0, cap: 0, available: 0 })).toBe('Health Potion costs 50 gold, and you have 10 gold. Shop borrowing is off.');
    expect(BUY_WORDS.dead({ name: 'Health Potion', rank: 'E', price: 50, have: 10, need: 40, debt: 0, cap: 150, available: 150 })).toBe(SHOP_CLOSED);
    expect(SHOP_CLOSED).toBe(`The shop is closed while you are dead. You cannot buy or sell. ${WAYS_BACK} brings you back. The GM or another hunter can give you a Resurrection Crystal.`);
  });
});
