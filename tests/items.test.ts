// Every built-in item in src/core/registry/items.ts must pass these. A new item is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { PERK_KEYS, RANKS, RULES } from '../src/core/rules.ts';
import { FULL_HEAL, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Op } from '../src/core/combat/effect-ops.ts';
import { parseFormula } from '../src/core/formula.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { describeItem, effectsOf, gmSource, itemOps, itemSource } from '../src/core/effects.ts';
import { ITEM_TYPES, KIT_SHARE, LOOT_ITEMS, RARITIES, SHOP_ITEMS, STARTER_GEAR, itemOf, parseItem, piece, priceOf, wornSpeed, defaultShop, builtInItems, lootPool, valueOf, weightOf, weaponWeight } from '../src/core/registry/items.ts';
import type { ItemDef, ItemTemplate } from '../src/core/registry/items.ts';
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const LISTS: [string, readonly ItemDef[]][] = [['shop', SHOP_ITEMS], ['loot', LOOT_ITEMS], ['starter', Object.values(STARTER_GEAR)]];
const ALL: ItemDef[] = LISTS.flatMap(([, defs]) => defs);
const of = (name: string): ItemTemplate => itemOf(RULES, ALL.find(d => d.name === name)!);
const number = (value: number) => ({ kind: 'number', value }) as const;
/** Half up, in whole numbers, so a share of 35 hundredths of 30 is 10.5 and rounds to 11 with no floating point doubt. */
const halfUp = (n: number, hundredths: number): number => Math.floor((n * hundredths + 50) / 100);

for (const [list, defs] of LISTS) {
  for (const def of defs) {
    const item = itemOf(RULES, def);
    group(`the ${list} item ${def.name}`, () => {
      test('has a name the inventory keeps whole (60 characters) and a description', () => {
        expect(def.name.trim()).toBe(def.name);
        expect(def.name.length).toBeGreaterThan(0);
        expect(def.name.length).toBeLessThanOrEqual(60);
        expect(def.desc.trim()).not.toBe('');
        expect(def.desc.length).toBeLessThanOrEqual(500);
      });

      test('its type and rarity are ones the save keeps and the rules colour and price', () => {
        expect(ITEM_TYPES).toContain(def.type);
        expect(RARITIES).toContain(def.rar);
        expect(Object.keys(RULES.rarities)).toContain(def.rar);
      });

      test('worn gear names a slot the equipment screen has', () => {
        if (def.type === 'weapon' || def.type === 'armor' || def.type === 'accessory') expect(RULES.slots).toContain(def.slot);
        else expect(item.slot).toBeNull();
      });

      test('a weapon rolls dice the rules allow, shoots when it is a bow and strikes otherwise, and weighs 1, 2 or 4 by its dice', () => {
        if (def.type !== 'weapon') { expect(item).not.toHaveProperty('attack'); return; }
        expect(parseFormula(def.dice, RULES).ok).toBe(true);
        expect(item.attack).toBe(/bow\b/i.test(def.name) ? 'shot' : 'strike');
        const [count, sides] = def.dice.split('d').map(Number) as [number, number];
        expect(weightOf(item)).toBe(count >= 2 ? 4 : sides <= 6 ? 1 : 2);
        expect([item.armor, item.resist]).toEqual([0, 0]);
      });

      test('a piece of armour is its slot\'s share of its kit, half up, with armor and resist raised by the rarity\'s index', () => {
        if (def.type !== 'armor') return;
        const kit = RULES.fight.kits[def.kit], share = KIT_SHARE[def.slot], up = RARITIES.indexOf(def.rar);
        expect([item.weight, item.armor, item.resist]).toEqual([halfUp(kit.weight, share), halfUp(kit.armor, share) + up, halfUp(kit.resist, share) + up]);
      });

      test('a ring or neck piece, and anything not worn, weighs nothing and has no armor or resist', () => {
        if (def.type === 'weapon' || def.type === 'armor') return;
        expect([item.weight, item.armor, item.resist]).toEqual([0, 0, 0]);
      });

      test('its bonus is whole numbers on one of the eight stats, max HP or max mana, none of them zero', () => {
        for (const [k, v] of Object.entries(item.bonus)) {
          expect(PERK_KEYS as readonly string[]).toContain(k);
          expect(Number.isInteger(v) && v !== 0).toBe(true);
        }
      });

      test('a consumable does something when used (an op, or brings a dead user back), and every op of it reads back through the op reader', () => {
        if (def.type === 'consumable') expect(effectsOf(item).length > 0 || item.revive === true).toBe(true);
        expect(parseItem({ name: 'x', effects: copy(item.effects ?? []) })?.effects ?? []).toEqual(item.effects ?? []);
      });

      test('reads back unchanged through parseItem, the reader every save, room message and form uses', () => {
        expect(parseItem(copy(item))).toEqual(item);
      });

      test('its price is the one it sets by hand, or the rule\'s: base value x rarity multiplier x 10', () => {
        if (def.value !== undefined) {
          expect(Number.isInteger(def.value) && def.value > 0).toBe(true);
          expect(item.value).toBe(def.value);
        } else {
          expect(item.value, 'priced by the rule as it is read, not stored').toBeUndefined();
          expect(valueOf(item, RULES)).toBe(RULES.baseValue * RULES.rarities[def.rar].mult * 10);
        }
      });
    });
  }
}

test('an unpriced common item costs 100 gold and a mythic one 20000: base value 10, multipliers 1 and 200, times 10', () => {
  expect(priceOf(RULES, 'common')).toBe(100);
  expect(priceOf(RULES, 'mythic')).toBe(20000);
});

test('no two shop or loot items share a name: the shop and the loot roll find an item by its name', () => {
  const names = [...SHOP_ITEMS, ...LOOT_ITEMS].map(d => d.name);
  expect(new Set(names).size).toBe(names.length);
});

test('every rarity a rank\'s loot roll can land on has an item in the pool the roll draws from, so the roll drops something', () => {
  const have = new Set(lootPool(RULES).map(d => d.rar));
  for (const rank of RANKS) for (const rar of Object.keys(RULES.loot[rank].weights)) expect([rank, have.has(rar as ItemDef['rar'])]).toEqual([rank, true]);
});

test('the six armour slots\' shares sum to the whole kit, so a full set of one kit is that kit', () => {
  expect(Object.values(KIT_SHARE).reduce((s, v) => s + v, 0)).toBe(100);
});

group('the items as plan section 3.3 restates them', () => {
  test('Hunter\'s Leather, a common light chest, weighs 3 with armor 4 and resist 5: 35% of 8, 10 and 15', () => {
    expect(of("Hunter's Leather")).toMatchObject({ weight: 3, armor: 4, resist: 5 });
  });

  test('the Reinforced Hunter Vest, an uncommon medium chest, weighs 6 with armor 12 and resist 3: 35% of 18, 30 and 5, plus 1', () => {
    expect(of('Reinforced Hunter Vest')).toMatchObject({ weight: 6, armor: 12, resist: 3 });
  });

  test('Ironhide Gauntlets weigh 1 with armor 2, resist 3 and Strength 1', () => {
    expect(of('Ironhide Gauntlets')).toMatchObject({ weight: 1, armor: 2, resist: 3, bonus: { str: 1 } });
  });

  test('the Ring of Vitality weighs nothing and gives Vitality 5', () => {
    expect(of('Ring of Vitality')).toMatchObject({ weight: 0, armor: 0, resist: 0, bonus: { vit: 5 } });
  });

  test('the Dented Tower Shield is a heavy offhand: weight 5, armor 9, resist 9', () => {
    expect(itemOf(RULES, STARTER_GEAR.towerShield)).toMatchObject({ weight: 5, armor: 9, resist: 9 });
  });

  test('the Knight Killer ignores 5 armor beside its Strength 2', () => {
    expect(of('Knight Killer')).toMatchObject({ penFlat: 5, bonus: { str: 2 } });
  });

  test('a Mana Potion of 20 old MP restores 4 mana, the Elixir of Life heals fully and the Stamina Tonic removes 25 fatigue', () => {
    expect(of('Mana Potion').effects).toEqual([{ op: 'mana', amount: number(4), when: 'use' }]);
    expect(of('Elixir of Life').effects).toEqual([{ op: 'heal', amount: FULL_HEAL, when: 'use' }]);
    expect(of('Stamina Tonic').effects).toEqual([{ op: 'fatigue', amount: number(-25), when: 'use' }]);
  });

  test('old MP bonuses are a fifth as max mana: the Mana Talisman\'s 5 is 1, the Monarch\'s Scepter\'s 50 is 10 beside Power 6', () => {
    expect(of('Mana Talisman').bonus).toEqual({ manaMax: 1 });
    expect(of("Monarch's Scepter").bonus).toEqual({ pow: 6, manaMax: 10 });
  });
});

group('an item as the source of a status it applies', () => {
  test('an item is as strong as its rarity: common E, uncommon D, rare C, epic B, legendary A, mythic S', () => {
    expect(RARITIES.map(rar => itemSource({ rar }).tier)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('the source is no combatant', () => {
    expect(itemSource({ rar: 'rare' })).toEqual({ id: null, tier: 2 });
  });

  test('a status put on by hand is no combatant\'s, at the hunter\'s rank: E 0 to S 5', () => {
    expect((['E', 'D', 'C', 'B', 'A', 'S'] as const).map(r => gmSource(r))).toEqual([0, 1, 2, 3, 4, 5].map(tier => ({ id: null, tier })));
  });
});

group('an item card', () => {
  const burning = (rar: ItemTemplate['rar']) => ({ rar, effects: [{ op: 'applyStatus', key: statusKey('burning'), def: BUILT_IN_STATUSES.burning, duration: tick(3 * RULES.fight.round) }] as Op[] });

  test('a rare item that applies Burning shows the C-rank 3d8 it deals; a common one shows 1d6', () => {
    expect(describeItem(RULES, burning('rare'))).toEqual(['Applies Burning (3 rounds): 3d8 magical damage a round']);
    expect(describeItem(RULES, burning('common'))).toEqual(['Applies Burning (3 rounds): 1d6 magical damage a round']);
  });

  test('a worn item does nothing through ops; what it adds is its bonus and gear numbers', () => {
    expect(itemOps(of('Ring of Vitality'), 'equip')).toEqual([]);
    expect(itemOps(of('Health Potion'), 'use')).toEqual([{ op: 'heal', amount: number(30), when: 'use' }]);
  });
});

group('parseItem: an item from a save, a room message, a form or an import', () => {
  const blank: ItemTemplate = { name: 'Orb', rar: 'common', type: 'misc', slot: null, qty: 1, dice: '', bonus: {}, desc: '', armor: 0, resist: 0 };
  const plain = (fields: Record<string, unknown> = {}) => ({ ...blank, ...fields });

  test('a name is all an item needs: the rest takes a new item\'s defaults, and it has no id', () => {
    expect(parseItem({ name: 'Orb' })).toEqual(blank);
  });

  test('what is not an object, or has no name, is not an item', () => {
    for (const v of [null, undefined, 5, 'Orb', [], [{ name: 'Orb' }]]) expect(parseItem(v)).toBeNull();
    for (const name of [undefined, '', '   ', 7, { text: 'Orb' }]) expect(parseItem({ name })).toBeNull();
  });

  test('a field of the wrong type or an unknown value takes its default', () => {
    const item = parseItem({ name: 'Orb', rar: 5, type: 'gun', slot: 'tail', qty: 'two', dice: 7, bonus: 'big', value: '50', desc: {}, weight: 'heavy',
      armor: null, resist: [], attack: 'bite', penFlat: '5', effects: 'shiny' });
    expect(item).toEqual(blank);
  });

  test('keys an item does not have are dropped, and so is its id: the old heal, MP and fatigue fields too', () => {
    const item = parseItem(JSON.parse('{"name":"Orb","id":"i7","glow":true,"equipped":"weapon","heal":30,"restoreMp":20,"fatigue":5,"__proto__":{"qty":5}}'));
    expect(item).toEqual(blank);
  });

  test('a bad effect is dropped and a good one kept; an item with none has no effects', () => {
    const good = { op: 'heal', amount: number(10), when: 'use' };
    const item = parseItem(plain({ type: 'consumable', effects: [{ op: 'explode' }, { op: 'heal', amount: 'lots' }, good, 'x'] }));
    expect(item!.effects).toEqual([good]);
    expect(parseItem(plain({ effects: [{ op: 'explode' }] }))).not.toHaveProperty('effects');
  });

  test('an item does at most 12 things', () => {
    const effects = Array.from({ length: 20 }, () => ({ op: 'note', text: 'x' }));
    expect(parseItem(plain({ effects }))!.effects).toHaveLength(12);
  });

  test('qty is 1 to 9999, a whole number', () => {
    expect([0, -2, 2.7, 9999, 1e12].map(qty => parseItem(plain({ qty }))!.qty)).toEqual([1, 1, 2, 9999, 9999]);
  });

  test('weight is 0 to 50, armor and resist 0 to 999, whole numbers', () => {
    expect([-3, 7.9, 80].map(weight => parseItem(plain({ weight }))!.weight)).toEqual([0, 7, 50]);
    expect([-3, 12, 5000].map(armor => parseItem(plain({ armor }))!.armor)).toEqual([0, 12, 999]);
    expect([-3, 4, 5000].map(resist => parseItem(plain({ resist }))!.resist)).toEqual([0, 4, 999]);
  });

  test('a weapon\'s attack is strike or shot, kept only then; armor ignored is kept only above 0, at most 999', () => {
    expect(parseItem(plain({ attack: 'shot' }))!.attack).toBe('shot');
    expect(parseItem(plain({ attack: 'strike' }))!.attack).toBe('strike');
    expect(parseItem(plain({ penFlat: 5 }))!.penFlat).toBe(5);
    expect(parseItem(plain({ penFlat: 5000 }))!.penFlat).toBe(999);
    for (const penFlat of [0, -2]) expect(parseItem(plain({ penFlat }))).not.toHaveProperty('penFlat');
  });

  test('value is 0 to a billion gold', () => {
    expect([-1, 50, 1e12].map(value => parseItem(plain({ value }))!.value)).toEqual([0, 50, 1e9]);
  });

  test('the bonus keeps the ten gear keys, each a whole number from -999 to 999, and drops a 0 and the old keys', () => {
    const bonus = { str: 2, agi: 5000, vit: -5000, pow: 1.5, ins: 0, pre: '3', hpMax: 20, manaMax: 2, dis: 1, ctl: -1, ac: 1, mpMax: 10, dex: 4, luck: 9 };
    expect(parseItem(plain({ bonus }))!.bonus).toEqual({ str: 2, agi: 999, vit: -999, pow: 1, hpMax: 20, manaMax: 2, dis: 1, ctl: -1 });
  });

  test('text is cut: a name to 60, a description to 500, dice to 30', () => {
    const item = parseItem(plain({ name: 'n'.repeat(100), desc: 'd'.repeat(1000), dice: '1'.repeat(40) }))!;
    expect([item.name.length, item.desc.length, item.dice.length]).toEqual([60, 500, 30]);
  });

  test('an item used on another keeps target other; one used on oneself has no target, whatever else was written', () => {
    expect(parseItem(plain({ target: 'other' }))!.target).toBe('other');
    for (const target of ['self', 'others', 1, null]) expect(parseItem(plain({ target }))).not.toHaveProperty('target');
  });

  test('an item keeps the status it wears into a fight as the status reader reads it, a stacking one with its threshold; a broken one is none', () => {
    const worn = { label: 'Bloodstone', desc: '', ops: [], stack: { cap: 5, leave: { kind: 'round' }, keep: 'fight',
      threshold: { at: { kind: 'count', n: 5 }, to: { kind: 'bearer' }, ops: [{ op: 'heal', amount: number(10), when: 'use' }], then: 'spend' } } };
    const it = parseItem({ name: 'Bloodstone Ring', type: 'accessory', slot: 'ring1', worn: copy(worn) })!;
    expect(it.worn).toEqual(parseStatusDef(worn, RULES)!);
    expect(it.worn).toMatchObject({ stack: { cap: 5, threshold: { then: 'spend' } } });
    expect(parseItem(copy(it))).toEqual(it);
    expect(parseItem({ name: 'Ring', worn: { ops: [] } })).not.toHaveProperty('worn');
  });

  test('an item the GM is told about keeps tell; any other value leaves it out', () => {
    expect(parseItem(plain({ tell: true }))!.tell).toBe(true);
    for (const tell of [false, 'yes', 1, null]) expect(parseItem(plain({ tell }))).not.toHaveProperty('tell');
  });
});

group('the worn speed the item maker shows', () => {
  test('a weightless piece leaves the sample hunter\'s speed alone, and a heavy chest piece slows it', () => {
    const none = wornSpeed({ weight: 0, armor: 5, resist: 5 }, RULES);
    expect(none.worn).toBe(none.bare);
    // the heavy kit's chest is 35% of its weight (KIT_SHARE): on top of a medium kit it passes the free load
    const plate = wornSpeed(piece('heavy', 'chest', 'common', RULES), RULES);
    expect(plate.worn).toBeLessThan(plate.bare);
  });
});

group('a price and a weight by the rule (L1)', () => {
  test('a weapon without a weight of its own weighs what its dice weigh now; a typed weight is kept', () => {
    const sword = parseItem({ name: 'Sword', type: 'weapon', slot: 'weapon', dice: '1d6' })!;
    expect(sword.weight).toBeUndefined();
    expect(weightOf(sword)).toBe(weaponWeight('1d6'));
    expect(weightOf({ ...sword, dice: '2d8' }), 'the GM changed its dice').toBe(weaponWeight('2d8'));
    expect(weightOf(parseItem({ name: 'Sword', type: 'weapon', dice: '2d8', weight: 1 })!)).toBe(1);
    expect(weightOf(parseItem({ name: 'Orb' })!)).toBe(0);
  });

  test('an item without a price of its own is priced by the rule as it is now; a typed price, even 0, is kept', () => {
    const orb = parseItem({ name: 'Orb', rar: 'rare' })!, dear = { ...RULES, baseValue: RULES.baseValue * 3 };
    expect(valueOf(orb, dear)).toBe(priceOf(dear, 'rare'));
    expect(valueOf(parseItem({ name: 'Orb', value: 0 })!, RULES)).toBe(0);
    expect(valueOf(parseItem({ name: 'Orb', value: '12' })!, RULES), 'not a number: the rule\'s').toBe(priceOf(RULES, 'common'));
  });
});

group('the built-in items, priced at each read (I1)', () => {
  test('a GM\'s price rule reaches the default shop and the loot at once: an item priced by the rule follows it', () => {
    const dear = { ...RULES, baseValue: RULES.baseValue * 3 };
    const byRule = [...SHOP_ITEMS, ...LOOT_ITEMS].findIndex(d => !d.value);
    expect(byRule, 'a built-in item without a value of its own').toBeGreaterThanOrEqual(0);
    expect(valueOf(builtInItems(dear)[byRule]!, dear)).toBe(valueOf(builtInItems(RULES)[byRule]!, RULES) * 3);
    expect(defaultShop(dear).map(i => i.name)).toEqual(SHOP_ITEMS.map(d => d.name));
  });
});

group('the Resurrection Crystal (notes-2b-crystal.md)', () => {
  const crystal = (R = RULES) => defaultShop(R).find(i => i.revive)!;

  test('the default shop sells it at 100,000 gold, five times its dearest other item, at any price rule', () => {
    expect(crystal()).toMatchObject({ name: 'Resurrection Crystal', type: 'consumable', revive: true, tell: true });
    expect(valueOf(crystal(), RULES)).toBe(100000);
    const others = defaultShop(RULES).filter(i => !i.revive).map(i => valueOf(i, RULES));
    expect(valueOf(crystal(), RULES)).toBe(5 * Math.max(...others));
    expect(valueOf(crystal({ ...RULES, baseValue: 1 }), { ...RULES, baseValue: 1 }), 'its own price, not the rule\'s').toBe(100000);
  });

  test('a reward, a room message or a form keeps its revive; on anything but a consumable, or not exactly true, it is dropped', () => {
    expect(parseItem(copy(crystal()))!.revive).toBe(true);
    expect(parseItem({ name: 'Stone', type: 'misc', revive: true })).not.toHaveProperty('revive');
    expect(parseItem({ name: 'Draught', type: 'consumable', revive: 'yes' })).not.toHaveProperty('revive');
  });

  test('no loot roll can drop it: the GM decides how many exist, while the reward editor still offers it', () => {
    expect(builtInItems(RULES).some(i => i.revive)).toBe(true);
    expect(lootPool(RULES).some(i => i.revive || i.name === 'Resurrection Crystal')).toBe(false);
    expect(lootPool(RULES).length).toBe(builtInItems(RULES).length - 1);
  });

  test('its card says what it does', () => {
    expect(describeItem(RULES, crystal())).toEqual(['Brings its dead user back at 1 HP, outside a fight.']);
  });
});
