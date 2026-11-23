import { describe, expect, test } from 'bun:test';
import { buildAward, choosePath, perkText, pickPerk, respec, respecBlock, respecCost, buildRuleSet, buildRulesReset, withBuildRule, withoutBuildRules, withRoomRules, roomRulesOf, buildsOn, mayPick } from '../src/core/hunter/build.ts';
import { fits, loadoutCap, overwriteLoadout, removeLoadout, renameLoadout, saveLoadout, swapLoadout } from '../src/core/hunter/loadouts.ts';
import { LIMITS, newHunter, newSave } from '../src/core/save.ts';
import type { Hunter, Item, Save } from '../src/core/save.ts';
import { RULES, rulesOf } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { parseItem, priceOf, valueOf, RARITIES } from '../src/core/registry/items.ts';
import { sellPrice } from '../src/core/hunter/inventory.ts';
import { DOCS, WIRES } from '../src/core/protocol.ts';
import type { RoomRules } from '../src/core/protocol.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { dev, iid, loid } from './fixtures/ids.ts';

const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const R = RULES as Rules;
/** Rules with the GM's build switches as given. */
const switches = (b: Partial<{ enabled: boolean; playerPick: boolean; respecGold: number }>): Rules => ({ ...R, build: { ...R.build, ...b } }) as Rules;
/** A C-rank hunter at level 3 with 100 gold: Vanguard's first three tiers are open (E, D, C). */
const hunter = (o: Partial<Hunter> = {}): Hunter => ({ ...newHunter(R), rank: 'C', level: 3, gold: 100, ...o });

describe('a build path', () => {
  test('a path chosen has no perks; a second path needs the GM\'s force', () => {
    const h = ok(choosePath(hunter(), 'vanguard', R));
    expect(h.build).toEqual({ path: 'vanguard', picks: [] });
    expect(choosePath(h, 'striker', R)).toEqual({ ok: false, why: 'has-path' });
    expect(ok(choosePath(h, 'striker', R, true)).build).toEqual({ path: 'striker', picks: [] });
    expect(choosePath(hunter(), 'nowhere', R)).toEqual({ ok: false, why: 'no-path' });
  });
  test('perks are picked in order, only up to the tiers the rank opens', () => {
    let h = ok(choosePath(hunter(), 'vanguard', R));
    expect(pickPerk(h, 1, 0, R, 'player')).toEqual({ ok: false, why: 'not-next' });
    h = ok(pickPerk(h, 0, 1, R, 'player'));
    h = ok(pickPerk(h, 1, 0, R, 'player'));
    h = ok(pickPerk(h, 2, 0, R, 'player'));
    expect(h.build.picks).toEqual([1, 0, 0]);
    expect(pickPerk(h, 3, 0, R, 'player')).toEqual({ ok: false, why: 'locked' });
    expect(pickPerk(h, 3, 2, R, 'player')).toEqual({ ok: false, why: 'not-next' });
  });
  test('a rank A hunter at level 1 (a rank the GM set by hand, SMX-rules-7.2) picks every tier rank A opens: the rank, not the level, opens tiers', () => {
    let h = ok(choosePath(hunter({ rank: 'A', level: 1 }), 'vanguard', R));
    for (let t = 0; t < 5; t++) h = ok(pickPerk(h, t, 0, R, 'player'));
    expect(h.build.picks).toHaveLength(5);
    expect(pickPerk(h, 5, 0, R, 'player')).toEqual({ ok: false, why: 'locked' });
  });
  test('with players-pick off only the GM picks; with builds off nobody does', () => {
    const h = ok(choosePath(hunter(), 'vanguard', R)), gmPicks = switches({ playerPick: false });
    expect(pickPerk(h, 0, 0, gmPicks, 'player')).toEqual({ ok: false, why: 'gm-picks' });
    expect(ok(pickPerk(h, 0, 0, gmPicks, 'gm')).build.picks).toEqual([0]);
    expect(pickPerk(h, 0, 0, switches({ enabled: false }), 'gm')).toEqual({ ok: false, why: 'off' });
  });
});

describe('a respec', () => {
  const withPath = () => ok(pickPerk(ok(choosePath(hunter(), 'vanguard', R)), 0, 0, R, 'player'));
  test('a player pays respecGold times level squared and the path and perks are cleared, in one step', () => {
    expect(respecCost(hunter(), R)).toBe(R.build.respecGold * 9);
    const h = ok(respec(withPath(), R, 'player', false));
    expect(h.build).toEqual({ path: null, picks: [] });
    expect(h.gold).toBe(100 - R.build.respecGold * 9);
  });
  test('a player is refused short of gold, in a fight, with no path; the GM pays nothing and is never refused', () => {
    expect(respec(withPath(), switches({ respecGold: 50 }), 'player', false)).toEqual({ ok: false, why: 'short' });
    expect(respec(withPath(), R, 'player', true)).toEqual({ ok: false, why: 'in-fight' });
    expect(respec(hunter(), R, 'player', false)).toEqual({ ok: false, why: 'no-path' });
    expect(respecBlock(withPath(), R, false)).toBeNull();
    const gm = ok(respec(withPath(), switches({ respecGold: 50 }), 'gm', true));
    expect(gm).toMatchObject({ gold: 100, build: { path: null, picks: [] } });
  });
  test('a path chosen then the GM\'s respec is the hunter it was; a player\'s respec costs its stated gold', () => {
    const h = hunter(), chosen = ok(choosePath(h, 'vanguard', R));
    expect(ok(respec(chosen, R, 'gm', false))).toEqual(h);
    expect(ok(respec(chosen, R, 'player', false))).toEqual({ ...h, gold: h.gold - respecCost(h, R) });
  });
  test('an unreadable respec price is 5 gold a level squared', () => {
    expect(respecCost(hunter(), switches({ respecGold: -1 }))).toBe(45);
  });
});

describe('a reward\'s build part', () => {
  test('the next tier\'s perk is picked for the player even with players-pick off; a repeat changes nothing', () => {
    const h = ok(choosePath(hunter(), 'vanguard', R)), off = switches({ playerPick: false });
    const r = buildAward(h, { tier: 0, pick: 1 }, off);
    expect(r).toEqual({ build: { path: 'vanguard', picks: [1] }, line: 'Perk: HP +20' });
    expect(buildAward({ ...h, build: r.build }, { tier: 0, pick: 1 }, off)).toEqual({ build: r.build, line: '' });
  });
  test('a path set, and a respec', () => {
    expect(buildAward(hunter(), { path: 'striker' }, R)).toEqual({ build: { path: 'striker', picks: [] }, line: 'Path assigned: Striker' });
    expect(buildAward(hunter(), { path: 'nowhere' }, R).line).toBe('');
    expect(buildAward(hunter(), 'respec', R).build).toEqual({ path: null, picks: [] });
  });
  test('a perk\'s words', () => {
    expect(perkText({ str: 1, vit: 1 })).toBe('STR +1, VIT +1');
    expect(perkText({})).toBe('—');
  });
});

describe('the GM\'s build switches', () => {
  test('set, then the default rules, leaves the overrides as they were; other overrides stay', () => {
    const o = { logCap: 50 }, set = withBuildRule(o, { enabled: false });
    expect(set).toEqual({ logCap: 50, build: { enabled: false } });
    expect(withoutBuildRules(set)).toEqual(o);
  });
  test('as steps of the save: a switch set and the reset write only the overrides (implicit audit 3, I3)', () => {
    const save = { rulesOverrides: { logCap: 50 }, other: 1 };
    const set = buildRuleSet(save, { playerPick: false });
    expect(set).toEqual({ rulesOverrides: { logCap: 50, build: { playerPick: false } }, other: 1 });
    expect(buildRulesReset(set)).toEqual(save);
  });
  test('in a room a player plays by the room\'s switches, and by their own again once out of it', () => {
    const own = rulesOf({ build: { playerPick: false, respecGold: 9 } });
    const inRoom = withRoomRules(own, { ...roomRulesOf(own), build: { enabled: true, playerPick: true } });
    expect([buildsOn(inRoom), mayPick(inRoom, 'player')], 'the room says builds on, players pick').toEqual([true, true]);
    expect(inRoom.build.respecGold, 'the room carries only its two switches').toBe(9);
    expect(withRoomRules(own, null), 'out of the room: the player\'s own rules, the same object').toBe(own);
    expect(mayPick(withRoomRules(own, null), 'player'), 'their own players-pick, off').toBe(false);
    expect(buildsOn(withRoomRules(own, { ...roomRulesOf(own), build: { enabled: false, playerPick: true } })), 'a room with builds off turns them off').toBe(false);
  });
  test('in a room a player\'s personal gates follow the room\'s switch and hours, and the rest of its own solo rules', () => {
    const own = rulesOf({ solo: { hours: 12, held: 5 } });
    const inRoom = withRoomRules(own, { ...roomRulesOf(own), solo: { ...roomRulesOf(own).solo, personal: false, hours: 4 } });
    expect(inRoom.solo).toEqual({ ...own.solo, personal: false, hours: 4 });
    expect(roomRulesOf(rulesOf({ solo: { hours: 6 }, build: { playerPick: false } }))).toMatchObject({ build: { enabled: true, playerPick: false }, solo: { personal: true, hours: 6 }, feats: { on: true } });
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
    expect(valueOf({ rar: 'rare', type: 'consumable' }, inRoom), 'a rare consumable: the shipped used-up share, a half, of 2000').toBe(1000);
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
    ['the base-price multiple a reviving item costs', { revivePrices: 20 }, R => R.revivePrices, 20],
    ['the base-price multiple a System raise on debt owes', { reviveDebtPrices: 5 }, R => R.reviveDebtPrices, 5],
    ['the share of gate clear gold paid toward debt', { reviveDebtShare: 0.25 }, R => R.reviveDebtShare, 0.25],
    ['the share of gate clear gold lost to debt costs', { reviveDebtBurn: 0.1 }, R => R.reviveDebtBurn, 0.1],
    ['the XP multiplier while in debt', { reviveDebtXpRate: 0.5 }, R => R.reviveDebtXpRate, 0.5],
    ['the shop borrow limit multiple', { borrowCapPrices: 2.5 }, R => R.borrowCapPrices, 2.5],
    ['the share of the level a raising takes', { reviveLevelShare: 0.1 }, R => R.reviveLevelShare, 0.1],
    ['a personal gate\'s share of the loot', { solo: { lootShare: 0.5 } }, R => R.solo.lootShare, 0.5],
    ['the party a world gate is made for', { gateParty: 6 }, R => R.gateParty, 6],
    ['a rank\'s loot gold', { loot: { C: { gold: [1000, 3000] } } }, R => R.loot.C.gold, [1000, 3000]],
    ['a rank\'s loot weights', { loot: { E: { weights: { rare: 50 } } } }, R => R.loot.E.weights.rare, 50],
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
  test('an item gone is skipped and its slot left as it is; in a fight the swap is refused', () => {
    const saved = ok(saveLoadout(armed(), loid('lo1'), 'Day', R)), sold = { ...saved, items: [ring('i2')] };
    const r = ok(swapLoadout<Save>({ ...newSave(dev('d')), hunters: [sold] }, sold.id, 'lo1', R, false));
    expect(r.skipped).toEqual(['weapon']);
    expect(r.save.hunters[0]!.equipped.weapon).toBe(iid('i1'));
    expect(swapLoadout<Save>({ ...newSave(dev('d')), hunters: [saved] }, saved.id, 'lo1', R, true)).toEqual({ ok: false, why: 'in-fight' });
  });
});
