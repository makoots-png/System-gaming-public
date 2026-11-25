import { describe, expect, test } from 'bun:test';
import { keystoneSwitched, withRoomRules, roomRulesOf } from '../src/core/hunter/build.ts';
import { fits, loadoutCap, overwriteLoadout, removeLoadout, renameLoadout, saveLoadout, swapLoadout } from '../src/core/hunter/loadouts.ts';
import { LIMITS, newHunter, newSave } from '../src/core/save.ts';
import type { Hunter, Item, Save } from '../src/core/save.ts';
import { RULES, rulesOf } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { parseItem, priceOf, valueOf, RARITIES } from '../src/core/registry/items.ts';
import { FULL_HEAL } from '../src/core/combat/effect-ops.ts';
import { sellPrice } from '../src/core/hunter/inventory.ts';
import { DOCS, WIRES } from '../src/core/protocol.ts';
import type { RoomRules } from '../src/core/protocol.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { dev, iid, loid } from './fixtures/ids.ts';

const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const R = RULES as Rules;
/** A C-rank hunter at level 3 with 100 gold. */
const hunter = (o: Partial<Hunter> = {}): Hunter => ({ ...newHunter(R), rank: 'C', level: 3, gold: 100, ...o });

describe('the GM\'s room switches', () => {
  test('keystoneSwitched flips only fight.keystone.on and keeps other overrides', () => {
    const save = { rulesOverrides: { logCap: 50, fight: { armorK: 55 } }, other: 1 };
    const on = keystoneSwitched(save, true);
    expect(on).toEqual({ rulesOverrides: { logCap: 50, fight: { armorK: 55, keystone: { on: true } } }, other: 1 });
    expect(keystoneSwitched(on, false)).toEqual({ rulesOverrides: { logCap: 50, fight: { armorK: 55, keystone: { on: false } } }, other: 1 });
  });
  test('in a room a player\'s personal gates follow the room\'s switch and hours, and the rest of its own solo rules', () => {
    const own = rulesOf({ solo: { hours: 12, held: 5 } });
    const inRoom = withRoomRules(own, { ...roomRulesOf(own), solo: { ...roomRulesOf(own).solo, personal: false, hours: 4 } });
    expect(inRoom.solo).toEqual({ ...own.solo, personal: false, hours: 4 });
    expect(withRoomRules(own, null), 'out of the room: the player\'s own rules, the same object').toBe(own);
    expect(roomRulesOf(rulesOf({ solo: { hours: 6 } }))).toMatchObject({ solo: { personal: true, hours: 6 }, feats: { on: true } });
  });
  test('in a room a player\'s feats follow the GM\'s switch', () => {
    const own = rulesOf({});
    expect(roomRulesOf(rulesOf({ feats: { on: false } })).feats).toEqual({ on: false });
    expect(withRoomRules(own, { ...roomRulesOf(own), feats: { on: false } }).feats.on).toBe(false);
  });
  test('in a room a player\'s trading follows the GM\'s switch, whatever its own', () => {
    expect(roomRulesOf(rulesOf({ trade: { on: false } })).trade).toEqual({ on: false });
    expect(withRoomRules(rulesOf({}), { ...roomRulesOf(rulesOf({})), trade: { on: false } }).trade.on, 'the GM turned it off').toBe(false);
    const own = rulesOf({ trade: { on: false } });
    expect(withRoomRules(own, roomRulesOf(rulesOf({}))).trade.on, 'the GM\'s on over a player\'s own off').toBe(true);
    expect(withRoomRules(own, null).trade.on, 'out of the room: the player\'s own').toBe(false);
  });
});

describe('the room carries the economy', () => {
  /** The GM's rules as a player's phone reads them: the rules doc of `gm` on the wire and back through the room's parser. */
  const fromGM = (gm: Rules): RoomRules => {
    const doc = DOCS.rules(JSON.parse(JSON.stringify(WIRES.rules(roomRulesOf(gm)))));
    if (!doc) throw new Error('the room refused the GM\'s own rules doc');
    return doc;
  };
  const own = rulesOf({});

  test('a player\'s shop prices a rare item by the GM\'s C priceBase, and every other rarity as before', () => {
    const inRoom = withRoomRules(own, fromGM(rulesOf({ priceBase: { C: 2000 } })));
    expect(priceOf(inRoom, 'rare'), 'a rare is ranked C: the GM\'s priceBase.C of 2000').toBe(2000);
    expect(priceOf(own, 'rare'), 'out of the room: the shipped priceBase.C of 1250').toBe(1250);
    for (const rar of RARITIES.filter(r => r !== 'rare')) expect(priceOf(inRoom, rar), rar).toBe(priceOf(own, rar));
    expect(valueOf({ rar: 'rare', type: 'weapon' }, inRoom), 'the shop\'s price of a rare weapon').toBe(2000);
    expect(valueOf({ rar: 'rare', type: 'consumable' }, inRoom), 'a rare consumable: the shipped used-up share, 0.35, of 2000').toBe(700);
    expect(valueOf({ rar: 'rare', type: 'consumable', effects: [{ op: 'heal', amount: FULL_HEAL }] }, inRoom), 'a rare full-heal consumable: elixirPrices (1.0) of 2000').toBe(2000);
  });

  test('a player\'s sale pays the GM\'s sale share', () => {
    const inRoom = withRoomRules(own, fromGM(rulesOf({ saleShare: 0.5 })));
    expect(sellPrice({ rar: 'rare', type: 'weapon' }, inRoom), 'half of the shipped rare price, 1250').toBe(625);
    expect(sellPrice({ rar: 'rare', type: 'weapon' }, own), 'out of the room: the shipped quarter of 1250, rounded down').toBe(312);
  });

  // Each economy rule the GM may edit, the GM's edit, and where the player's rules hold it.
  const EDITS: ReadonlyArray<readonly [string, Record<string, unknown>, (R: Rules) => unknown, unknown]> = [
    ['a rarity\'s rank', { rarities: { rare: { rank: 'B' } } }, R => R.rarities.rare.rank, 'B'],
    ['a rank\'s base price', { priceBase: { C: 2000 } }, R => R.priceBase.C, 2000],
    ['the grade step', { gradeStep: 1.2 }, R => R.gradeStep, 1.2],
    ['the sale share', { saleShare: 0.5 }, R => R.saleShare, 0.5],
    ['a used-up item\'s share', { usedUpShare: 0.3 }, R => R.usedUpShare, 0.3],
    ['the base-price multiple a full-heal consumable costs', { elixirPrices: 1.5 }, R => R.elixirPrices, 1.5],
    ['the base-price multiple a reviving item costs', { revivePrices: 20 }, R => R.revivePrices, 20],
    ['the base-price multiple a full point respec costs', { respecPrices: 1.5 }, R => R.respecPrices, 1.5],
    ['a rank\'s System raise on debt multiple', { reviveDebtPrices: { C: 8 } }, R => R.reviveDebtPrices.C, 8],
    ['the share of gate clear gold paid toward debt', { reviveDebtShare: 0.25 }, R => R.reviveDebtShare, 0.25],
    ['the share of gate clear gold lost to debt costs', { reviveDebtBurn: 0.1 }, R => R.reviveDebtBurn, 0.1],
    ['the XP multiplier while in debt', { reviveDebtXpRate: 0.5 }, R => R.reviveDebtXpRate, 0.5],
    ['the shop borrow limit multiple', { borrowCapPrices: 2.5 }, R => R.borrowCapPrices, 2.5],
    ['the share of the level a raising takes', { reviveLevelShare: 0.1 }, R => R.reviveLevelShare, 0.1],
    ['a personal gate\'s share of the loot', { solo: { lootShare: 0.5 } }, R => R.solo.lootShare, 0.5],
    ['the party a world gate is made for', { gateParty: 6 }, R => R.gateParty, 6],
    ['a rank\'s loot gold', { loot: { C: { gold: [1000, 3000] } } }, R => R.loot.C.gold, [1000, 3000]],
    ['a rank\'s loot weights', { loot: { E: { weights: { rare: 50 } } } }, R => R.loot.E.weights.rare, 50],
    ['a rank\'s shadow summon mana cost', { shadow: { summonMp: { S: 15 } } }, R => R.shadow.summonMp.S, 15],
  ];
  for (const [rule, edit, at, want] of EDITS) {
    test(`the GM's edit of ${rule} reaches a player's rules in the room, and leaves them once out of it`, () => {
      expect(at(own), 'the edit is not the shipped value').not.toEqual(want);
      expect(at(withRoomRules(own, fromGM(rulesOf(edit))))).toEqual(want);
      expect(at(withRoomRules(own, null))).toEqual(at(own));
    });
  }

  test('a rarity keeps the player\'s own color under the room\'s rank, and the room carries only the six an item can carry', () => {
    const mine = rulesOf({ rarities: { rare: { color: '#123456' } } });
    const gm = rulesOf({ rarities: { rare: { rank: 'B', color: '#000000' }, cursed: { color: '#330000', rank: 'S' } } });
    expect(Object.keys(roomRulesOf(gm).rarities).sort()).toEqual([...RARITIES].sort());
    expect(withRoomRules(mine, fromGM(gm)).rarities.rare).toEqual({ color: '#123456', rank: 'B' });
  });

  test('a room rules doc without shadow defaults summonMp to the shipped table', () => {
    const legacy = { ...roomRulesOf(RULES) } as Record<string, unknown>;
    delete legacy.shadow;
    const parsed = DOCS.rules(legacy);
    expect(parsed).not.toBeNull();
    expect(withRoomRules(own, parsed).shadow.summonMp).toEqual(RULES.shadow.summonMp);
  });
});

describe('loadouts', () => {
  const sword = (id: string, qty = 1): Item => ({ ...parseItem({ name: 'Sword', type: 'weapon', slot: 'weapon' })!, id, qty } as Item);
  const ring = (id: string): Item => ({ ...parseItem({ name: 'Ring', type: 'accessory', slot: 'ring1' })!, id, qty: 1 } as Item);
  const armed = (): Hunter => { const h = hunter({ items: [sword('i1'), ring('i2')] }); return { ...h, equipped: { ...h.equipped, weapon: iid('i1'), ring2: iid('i2') } }; };
  test('the cap is the rules\', 0 or more, never past the save\'s limit', () => {
    expect(loadoutCap(R)).toBe(R.loadoutCap);
    expect(loadoutCap({ ...R, loadoutCap: -3 } as Rules)).toBe(0);
    expect(loadoutCap({ ...R, loadoutCap: 999 } as Rules)).toBe(LIMITS.loadouts);
  });
  test('saved holds the gear worn; a blank name is "Set n"; past the cap it is refused', () => {
    const h = ok(saveLoadout(armed(), loid('lo1'), '  ', R));
    expect(h.loadouts).toEqual([{ id: 'lo1', name: 'Set 1', slots: { weapon: 'i1', ring2: 'i2' } }]);
    expect(saveLoadout(h, loid('lo2'), 'x', { ...R, loadoutCap: 1 } as Rules)).toEqual({ ok: false, why: 'full' });
  });
  test('saved then deleted, and renamed then renamed back, leave the hunter as it was', () => {
    const h = armed(), saved = ok(saveLoadout(h, loid('lo1'), 'Day', R));
    expect(ok(removeLoadout(saved, 'lo1'))).toEqual(h);
    expect(ok(renameLoadout(ok(renameLoadout(saved, 'lo1', 'Night')), 'lo1', 'Day'))).toEqual(saved);
    expect(renameLoadout(saved, 'lo1', '  ')).toEqual({ ok: false, why: 'no-name' });
  });
  test('overwrite takes the gear worn now', () => {
    const saved = ok(saveLoadout(armed(), loid('lo1'), 'Day', R)), bare = { ...saved, equipped: { ...saved.equipped, weapon: null } };
    expect(ok(overwriteLoadout(bare, 'lo1', R)).loadouts[0]!.slots).toEqual({ ring2: 'i2' });
  });
  test('a ring fits either ring slot', () => {
    expect(fits(ring('x'), 'ring2')).toBe(true);
    expect(fits(sword('x'), 'head')).toBe(false);
  });
  test('a swap puts the set back on; take off, swap, and the gear is as it was', () => {
    const saved = ok(saveLoadout(armed(), loid('lo1'), 'Day', R));
    const bare = { ...saved, equipped: { ...saved.equipped, weapon: null, ring2: null } };
    const r = ok(swapLoadout<Save>({ ...newSave(dev('d')), hunters: [bare] }, bare.id, 'lo1', R, false));
    expect(r.skipped).toEqual([]);
    expect(r.save.hunters[0]!.equipped).toEqual(saved.equipped);
  });
  test('a stack is split: one copy worn under a new id from seq, the set names it from then on', () => {
    const h0 = hunter({ items: [sword('i1', 3)] }), h1 = { ...h0, equipped: { ...h0.equipped, weapon: iid('i1') } };
    const saved = ok(saveLoadout(h1, loid('lo1'), 'Day', R)), bare = { ...saved, equipped: { ...saved.equipped, weapon: null } };
    const r = ok(swapLoadout<Save>({ ...newSave(dev('d')), seq: 40, hunters: [bare] }, bare.id, 'lo1', R, false)), h = r.save.hunters[0]!;
    expect(h.items.map(i => [i.id, i.qty])).toEqual([['i1', 2], ['i41', 1]]);
    expect(h.equipped.weapon).toBe(iid('i41'));
    expect(h.loadouts[0]!.slots.weapon).toBe(iid('i41'));
    expect(r.save.seq).toBe(41);
  });
  test('an item gone is skipped and its slot keeps what is validly worn there; in a fight the swap is refused', () => {
    const saved = ok(saveLoadout(armed(), loid('lo1'), 'Day', R));
    const sold = { ...saved, items: [sword('i3'), ring('i2')], equipped: { ...saved.equipped, weapon: iid('i3') } };
    const r = ok(swapLoadout<Save>({ ...newSave(dev('d')), hunters: [sold] }, sold.id, 'lo1', R, false));
    expect(r.skipped).toEqual(['weapon']);
    expect(r.save.hunters[0]!.equipped.weapon).toBe(iid('i3'));
    expect(swapLoadout<Save>({ ...newSave(dev('d')), hunters: [saved] }, saved.id, 'lo1', R, true)).toEqual({ ok: false, why: 'in-fight' });
  });
});
