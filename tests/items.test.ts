// Every built-in item in src/core/registry/items.ts must pass these. A new item is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { BONUS_KEYS, RANKS, RULES, rulesOf } from '../src/core/rules.ts';
import type { Rank, Rules } from '../src/core/rules.ts';
import { FULL_HEAL, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Op } from '../src/core/combat/effect-ops.ts';
import { parseFormula } from '../src/core/formula.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { describeItem, effectsOf, gmSource, gradeLabel, itemOps, itemSource } from '../src/core/effects.ts';
import { GRADES, ITEM_TYPES, KIT_SHARE, LOOT_ITEMS, RARITIES, RECIPE_ITEMS, SHOP_ITEMS, STARTER_GEAR, itemOf, parseItem, ITEM_BOUNDS, piece, priceOf, wornSpeed, defaultShop, builtInItems, lootPool, valueOf, weightOf, weaponWeight } from '../src/core/registry/items.ts';
import type { Grade, ItemDef, ItemTemplate, Rarity } from '../src/core/registry/items.ts';
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import { tiles } from '../src/core/combat/space.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { gradeBand, gradeOfSpend, itemSpend } from '../src/core/registry/item-budget.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const LISTS: [string, readonly ItemDef[]][] = [['shop', SHOP_ITEMS], ['loot', LOOT_ITEMS], ['starter', Object.values(STARTER_GEAR)]];
const ALL: ItemDef[] = LISTS.flatMap(([, defs]) => defs);
const of = (name: string): ItemTemplate => itemOf(RULES, ALL.find(d => d.name === name)!);
const number = (value: number) => ({ kind: 'number', value }) as const;
/** The rank whose Clear prices each rarity (economy design 0 and 2.2): common is E, uncommon D, rare C, epic B, legendary A, mythic S. */
const RANK_OF: Readonly<Record<Rarity, Rank>> = { common: 'E', uncommon: 'D', rare: 'C', epic: 'B', legendary: 'A', mythic: 'S' };
/** One Clear of `rank` under rules `R`: the middle of that rank's loot gold. */
const clear = (R: Rules, rank: Rank): number => (R.loot[rank].gold[0]! + R.loot[rank].gold[1]!) / 2;
/** The rules with every rank's loot gold times `k`, as a GM's edit of the loot table would leave them. */
const lootTimes = (k: number): Rules => ({ ...RULES, loot: Object.fromEntries(RANKS.map(r => [r, { ...RULES.loot[r], gold: RULES.loot[r].gold.map(g => g * k) }])) as Rules['loot'] });
/** Half up, in whole numbers, so a share of 35 hundredths of 30 is 10.5 and rounds to 11 with no floating point doubt. */

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

      test('a piece of armour is its slot\'s share of its kit to within a point, the same at every rarity (a rarer piece holds no more armor or resist)', () => {
        if (def.type !== 'armor') return;
        const kit = RULES.fight.kits[def.kit], share = KIT_SHARE[def.slot];
        for (const n of ['weight', 'armor', 'resist'] as const) expect(Math.abs((item[n] ?? 0) - kit[n] * share / 100), n).toBeLessThan(1);
        const common = itemOf(RULES, { ...def, rar: 'common' });
        expect([item.weight, item.armor, item.resist]).toEqual([common.weight, common.armor, common.resist]);
      });

      test('a ring or neck piece, and anything not worn, weighs nothing and has no armor or resist', () => {
        if (def.type === 'weapon' || def.type === 'armor') return;
        expect([item.weight, item.armor, item.resist]).toEqual([0, 0, 0]);
      });

      test('its bonus is whole numbers on one of the eight stats, max HP or max mana, none of them zero', () => {
        for (const [k, v] of Object.entries(item.bonus)) {
          expect(BONUS_KEYS as readonly string[]).toContain(k);
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

      test('its price is the one it sets by hand, or the rule\'s: one Clear of its rarity\'s rank times gradeStep to its grade, an item that revives reviveClears of it, another consumable usedUpShare of it, rounded', () => {
        if (def.value !== undefined) {
          expect(Number.isInteger(def.value) && def.value > 0).toBe(true);
          expect(item.value).toBe(def.value);
        } else {
          expect(item.value, 'priced by the rule as it is read, not stored').toBeUndefined();
          const factor = def.type === 'consumable' ? (def.revive ? RULES.reviveClears : RULES.usedUpShare) : 1;
          expect(valueOf(item, RULES)).toBe(Math.round(clear(RULES, RANK_OF[def.rar]) * RULES.gradeStep ** (def.grade ?? 0) * factor));
        }
      });

      test('it carries its grade, a minus or a plus, and a middle one carries none', () => {
        if (def.grade) expect(item.grade).toBe(def.grade);
        else expect(item).not.toHaveProperty('grade');
      });
    });
  }
}

group('the price ladder (economy design 2.2, review E-1)', () => {
  test('each rarity names the rank whose Clear prices it: common E up to mythic S', () => {
    expect(RARITIES.map(r => RULES.rarities[r].rank)).toEqual(RARITIES.map(r => RANK_OF[r]));
  });

  test('an unpriced item costs one Clear of its rarity\'s rank, the middle of that rank\'s loot gold: a common 100, a mythic 75,000', () => {
    expect(RARITIES.map(r => priceOf(RULES, r))).toEqual(RARITIES.map(r => clear(RULES, RANK_OF[r])));
    expect([priceOf(RULES, 'common'), priceOf(RULES, 'mythic')], 'the shipped E gold is 50 to 150, S 30,000 to 120,000').toEqual([100, 75000]);
  });

  test('a GM\'s edit of the C-rank loot gold moves the rare price with it and no other', () => {
    const R = rulesOf({ loot: { C: { gold: [1000, 3000] } } });
    expect(priceOf(R, 'rare')).toBe(2000);
    expect(RARITIES.filter(r => r !== 'rare').map(r => priceOf(R, r))).toEqual(RARITIES.filter(r => r !== 'rare').map(r => priceOf(RULES, r)));
  });

  test('an unpriced consumable costs usedUpShare of its rank\'s Clear, rounded: a common potion 50, an uncommon one 163, an epic one 2,500', () => {
    const potion = (rar: Rarity) => parseItem({ name: 'Draught', rar, type: 'consumable' })!;
    for (const rar of RARITIES) expect([rar, valueOf(potion(rar), RULES)]).toEqual([rar, Math.round(clear(RULES, RANK_OF[rar]) * RULES.usedUpShare)]);
    expect(valueOf(potion('common'), { ...RULES, usedUpShare: 0.2 }), 'it follows a GM\'s share').toBe(Math.round(clear(RULES, 'E') * 0.2));
    expect(valueOf(parseItem({ name: 'Draught', rar: 'common', type: 'material' })!, RULES), 'a thing that is not used up costs the whole Clear').toBe(clear(RULES, 'E'));
  });

  test('every built-in item is priced by the rule, the Resurrection Crystals too: none keeps a price set by hand', () => {
    expect(ALL.filter(d => d.value !== undefined).map(d => d.name)).toEqual([]);
  });

  test('every rarity\'s price is above the one below it', () => {
    const prices = RARITIES.map(r => priceOf(RULES, r));
    expect(prices.every((p, i) => i === 0 || p > prices[i - 1]!)).toBe(true);
  });
});

group('the Resurrection Crystal, tiered (economy design 5, the owner\'s ruling 4)', () => {
  const crystal = (rar: Rarity) => parseItem({ name: 'Crystal', rar, type: 'consumable', revive: true })!;

  test('an unpriced reviving item costs reviveClears of its rank\'s Clear: E 1,000, D 3,250, C 12,500, B 50,000, A 190,000, S 750,000 (block [5])', () => {
    expect(RULES.reviveClears).toBe(10);
    for (const rar of RARITIES) expect([rar, valueOf(crystal(rar), RULES)]).toEqual([rar, RULES.reviveClears * clear(RULES, RANK_OF[rar])]);
    expect(RARITIES.map(rar => valueOf(crystal(rar), RULES))).toEqual([1000, 3250, 12500, 50000, 190000, 750000]);
  });

  test('it follows a GM\'s reviveClears and the loot gold of its rank; a price typed by hand still wins', () => {
    expect(valueOf(crystal('rare'), { ...RULES, reviveClears: 20 })).toBe(25000);
    expect(valueOf(crystal('rare'), rulesOf({ loot: { C: { gold: [1000, 3000] } } }))).toBe(20000);
    expect(valueOf({ ...crystal('rare'), value: 9000 }, RULES)).toBe(9000);
  });

  test('the shop stocks one crystal of each rank, named by its rank, each of the rarity whose rank it reaches, with no grade and no price by hand', () => {
    const crystals = SHOP_ITEMS.filter(d => d.type === 'consumable' && d.revive);
    expect(crystals.map(d => [d.name, d.rar])).toEqual(RARITIES.map(rar => [`Resurrection Crystal (${RANK_OF[rar]})`, rar]));
    for (const d of crystals) expect([d.name, d.grade, d.value]).toEqual([d.name, undefined, undefined]);
  });

  test('the shop\'s C crystal costs 12,500, its S crystal 750,000', () => {
    expect([valueOf(of('Resurrection Crystal (C)'), RULES), valueOf(of('Resurrection Crystal (S)'), RULES)]).toEqual([12500, 750000]);
  });
});

group('the grade: a minus, a middle and a plus inside a tier (economy design 2.1, ruling 1)', () => {
  const thing = (rar: Rarity, grade?: unknown, type = 'misc') => parseItem({ name: 'Idol', rar, type, ...(grade === undefined ? {} : { grade }) })!;

  test('there are three grades, minus, middle and plus, and the middle is 0', () => {
    expect([...GRADES]).toEqual([-1, 0, 1]);
  });

  test('a grade multiplies the price by gradeStep to the grade: an Epic− 3,333, an Epic 5,000, an Epic+ 7,500 (block [2.1])', () => {
    for (const rar of RARITIES) for (const g of GRADES) {
      const want = Math.round(clear(RULES, RANK_OF[rar]) * RULES.gradeStep ** g);
      expect([rar, g, priceOf(RULES, rar, g), valueOf(thing(rar, g), RULES)]).toEqual([rar, g, want, want]);
    }
    expect(GRADES.map(g => valueOf(thing('epic', g), RULES))).toEqual([3333, 5000, 7500]);
  });

  test('every tier\'s plus costs less than the next tier\'s minus: 150 < 217, 488 < 833, 1,875 < 3,333, 7,500 < 12,667, 28,500 < 50,000', () => {
    const pairs = RARITIES.slice(1).map((next, i) => [priceOf(RULES, RARITIES[i]!, 1), priceOf(RULES, next, -1)]);
    expect(pairs).toEqual([[150, 217], [488, 833], [1875, 3333], [7500, 12667], [28500, 50000]]);
  });

  test('a graded consumable costs usedUpShare of its graded Clear, rounded once: an Uncommon− potion 108, not 109', () => {
    // 325 / 1.5 × 0.5 is 108.33; rounding the graded price first (217) and then halving it would give 108.5, so 109
    expect(valueOf(thing('uncommon', -1, 'consumable'), RULES)).toBe(Math.round(clear(RULES, 'D') / RULES.gradeStep * RULES.usedUpShare));
    expect(valueOf(thing('uncommon', -1, 'consumable'), RULES)).toBe(108);
    expect(valueOf(thing('common', 1, 'consumable'), RULES)).toBe(75);
  });

  test('a GM\'s gradeStep moves a graded price and leaves the middle where it was', () => {
    const R: Rules = { ...RULES, gradeStep: 1.2 };
    expect(GRADES.map(g => valueOf(thing('epic', g), R))).toEqual([Math.round(5000 / 1.2), 5000, 6000]);
  });

  test('a price typed by hand wins over the grade', () => {
    expect(valueOf(parseItem({ name: 'Idol', rar: 'epic', grade: 1, value: 40 })!, RULES)).toBe(40);
  });

  test('an item with no grade is the middle: priced as one, and read with no grade field', () => {
    expect(thing('epic')).not.toHaveProperty('grade');
    expect(valueOf(thing('epic'), RULES)).toBe(priceOf(RULES, 'epic', 0));
    expect(priceOf(RULES, 'epic')).toBe(priceOf(RULES, 'epic', 0));
  });

  test('parseItem keeps a grade only when it is 1 or -1; 0 and anything else are the middle, left out', () => {
    expect([1, -1].map(g => thing('rare', g).grade)).toEqual([1, -1]);
    for (const g of [0, 2, -2, 0.5, '1', '+', null, true]) expect([g, thing('rare', g)]).toEqual([g, thing('rare')]);
  });

  test('a built-in item with a grade becomes an item of that grade; one set to the middle carries none', () => {
    const sword = SHOP_ITEMS.find(d => d.name === 'Steel Longsword')!;
    const plus = itemOf(RULES, { ...sword, grade: 1 });
    expect(plus.grade).toBe(1);
    expect(valueOf(plus, RULES)).toBe(Math.round(clear(RULES, 'E') * RULES.gradeStep));
    expect(parseItem(copy(plus))).toEqual(plus);
    expect(itemOf(RULES, { ...sword, grade: 0 as Grade })).not.toHaveProperty('grade');
  });

  test('a graded item\'s card begins with its label, Epic+ or Epic−; a middle item\'s card has no label', () => {
    expect(GRADES.map(g => gradeLabel('epic', g))).toEqual(['Epic−', 'Epic', 'Epic+']);
    expect(describeItem(RULES, { rar: 'epic', grade: 1 })).toEqual(['Epic+']);
    expect(describeItem(RULES, { rar: 'common', grade: -1, effects: [{ op: 'heal', amount: number(30), when: 'use' }] })[0]).toBe('Common−');
    expect(describeItem(RULES, { rar: 'epic' })).toEqual([]);
  });
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

  test('the Reinforced Hunter Vest, an uncommon medium chest, weighs 6 with armor 11 and resist 2: 35% of 18, 30 and 5 (6.3, 10.5, 1.75), the chest taking the points the rounding leaves', () => {
    expect(of('Reinforced Hunter Vest')).toMatchObject({ weight: 6, armor: 11, resist: 2 });
  });

  test('Ironhide Gauntlets weigh 1 with armor 1, resist 2 and Strength 1: a tenth of the light kit\'s 8, 10 and 15 (0.8, 1, 1.5)', () => {
    expect(of('Ironhide Gauntlets')).toMatchObject({ weight: 1, armor: 1, resist: 2, bonus: { str: 1 } });
  });

  test('the Ring of Vitality weighs nothing and gives Vitality 5', () => {
    expect(of('Ring of Vitality')).toMatchObject({ weight: 0, armor: 0, resist: 0, bonus: { vit: 5 } });
  });

  test('the Dented Tower Shield is a heavy offhand: weight 5, armor 9, resist 9', () => {
    expect(itemOf(RULES, STARTER_GEAR.towerShield)).toMatchObject({ weight: 5, armor: 9, resist: 9 });
  });

  test('the Knight Killer holds 5 Lethality beside its Strength 2, and no old field of armor ignored', () => {
    expect(of('Knight Killer').bonus).toEqual({ str: 2, armorPenFlat: 5 });
    expect(of('Knight Killer')).not.toHaveProperty('penFlat');
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

  test('a weapon\'s attack is strike or shot, kept only then', () => {
    expect(parseItem(plain({ attack: 'shot' }))!.attack).toBe('shot');
    expect(parseItem(plain({ attack: 'strike' }))!.attack).toBe('strike');
  });

  test('an old item\'s armor ignored, `penFlat`, reads as that much Lethality in its bonus, above 0 and at most the bonus bound, and the old field is gone', () => {
    expect(parseItem(plain({ penFlat: 5, bonus: { str: 2 } }))!.bonus).toEqual({ str: 2, armorPenFlat: 5 });
    expect(parseItem(plain({ penFlat: 5000 }))!.bonus).toEqual({ armorPenFlat: ITEM_BOUNDS.bonus });
    for (const penFlat of [0, -2, '5']) expect(parseItem(plain({ penFlat }))!.bonus).toEqual({});
    expect(parseItem(plain({ penFlat: 5 }))).not.toHaveProperty('penFlat');
  });

  test('an item that holds Lethality keeps its own over an old armor ignored', () => {
    expect(parseItem(plain({ penFlat: 5, bonus: { armorPenFlat: 3 } }))!.bonus).toEqual({ armorPenFlat: 3 });
  });

  test('a bonus keeps every bonus key, each a whole number within the bound: the four penetrations, a share read in hundredths, a stat', () => {
    const bonus = { armorPen: 10, resistPen: 12.7, armorPenFlat: 5, resistPenFlat: -4, costCut: 5, dex: 3, weight: 4, sight: 2, str: 1 };
    expect(parseItem(plain({ bonus }))!.bonus).toEqual({ str: 1, armorPen: 10, resistPen: 12, armorPenFlat: 5, resistPenFlat: -4, costCut: 5 });
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

  test('a weapon, armour or accessory keeps the powers it gives while worn; a consumable and a thing carried keep none (powers.ts)', () => {
    const worn = { label: 'Warded', desc: '', ops: [] };
    const active = abilityOf('support', { id: abilityId('ward'), name: 'Ward', aim: 'self', shape: { kind: 'self' }, range: tiles(0) }, RULES);
    for (const type of ['weapon', 'armor', 'accessory']) expect(parseItem({ name: 'Ward', type, worn, active }), type).toMatchObject({ worn, active });
    for (const type of ['consumable', 'material', 'key', 'misc']) {
      const it = parseItem({ name: 'Ward', type, worn, active, effects: [{ op: 'heal', amount: number(5), when: 'use' }] })!;
      expect([it.effects?.length, 'worn' in it, 'active' in it], type).toEqual([1, false, false]);
    }
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
    const plate = wornSpeed(piece('heavy', 'chest', RULES), RULES);
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
    const orb = parseItem({ name: 'Orb', rar: 'rare' })!, dear = lootTimes(3);
    expect(valueOf(orb, dear)).toBe(3 * priceOf(RULES, 'rare'));
    expect(valueOf(parseItem({ name: 'Orb', value: 0 })!, RULES)).toBe(0);
    expect(valueOf(parseItem({ name: 'Orb', value: '12' })!, RULES), 'not a number: the rule\'s').toBe(priceOf(RULES, 'common'));
  });
});

group('the built-in items, priced at each read (I1)', () => {
  test('a GM\'s price rule reaches the default shop and the loot at once: an item priced by the rule follows it', () => {
    const dear = lootTimes(3);
    const byRule = [...SHOP_ITEMS, ...LOOT_ITEMS].findIndex(d => !d.value);
    expect(byRule, 'a built-in item without a value of its own').toBeGreaterThanOrEqual(0);
    expect(valueOf(builtInItems(dear)[byRule]!, dear)).toBe(valueOf(builtInItems(RULES)[byRule]!, RULES) * 3);
    expect(defaultShop(dear).map(i => i.name)).toEqual(SHOP_ITEMS.map(d => d.name));
  });
});

group('the Resurrection Crystal (notes-2b-crystal.md)', () => {
  const crystal = (R = RULES) => defaultShop(R).find(i => i.revive)!;

  test('the default shop sells the E crystal first, at reviveClears Clears of rank E, and a GM\'s loot gold moves its price (economy unit 4)', () => {
    expect(crystal()).toMatchObject({ name: 'Resurrection Crystal (E)', type: 'consumable', revive: true, tell: true });
    expect(valueOf(crystal(), RULES)).toBe(1000);
    expect(valueOf(crystal(lootTimes(3)), lootTimes(3)), 'the rule\'s price, read each time').toBe(3000);
  });

  test('a reward, a room message or a form keeps its revive; on anything but a consumable, or not exactly true, it is dropped', () => {
    expect(parseItem(copy(crystal()))!.revive).toBe(true);
    expect(parseItem({ name: 'Stone', type: 'misc', revive: true })).not.toHaveProperty('revive');
    expect(parseItem({ name: 'Draught', type: 'consumable', revive: 'yes' })).not.toHaveProperty('revive');
  });

  test('no loot roll can drop it: the GM decides how many exist, while the reward editor still offers it', () => {
    expect(builtInItems(RULES).some(i => i.revive)).toBe(true);
    expect(lootPool(RULES).some(i => i.revive || i.name.startsWith('Resurrection Crystal'))).toBe(false);
    expect(lootPool(RULES).length, 'the six crystals left out').toBe(builtInItems(RULES).length - 6);
  });

  test('its card says what it does', () => {
    expect(describeItem(RULES, crystal())).toEqual(['Brings its dead user back at 1 HP, outside a fight.']);
  });
});

group('an item\'s icon', () => {
  test('a key of the registry is read back, whatever the item (a GM may give any icon to anything)', () => {
    expect(parseItem({ name: 'Idol', icon: 'sword' })!.icon).toBe('sword');
    expect(parseItem({ name: 'Idol', type: 'material', icon: 'wolf' })!.icon).toBe('wolf');
  });
  test('a key the registry lacks, or no string at all, is dropped: the item keeps no icon, so its default shows', () => {
    for (const icon of ['nope', '', 'SWORD', 7, null, {}, 'sword '.repeat(10)]) expect(parseItem({ name: 'Idol', icon })!, String(icon)).not.toHaveProperty('icon');
  });
  test('a worn status keeps the icon it was given, and an unknown one is dropped from the def alone', () => {
    const worn = (icon: unknown) => parseItem({ name: 'Charm', type: 'accessory', slot: 'neck', worn: { label: 'Warded', desc: '', ops: [], icon } })!.worn!;
    expect(worn('ward').icon).toBe('ward');
    expect(worn('nope')).not.toHaveProperty('icon');
  });
});

// The recipes (item-stats units 3 and 10): items built only from shapes that exist, each sized so its spend line sits in
// its own grade. The expected grade is the one the item carries (absent: the middle); `gradeOfSpend` is the rule's reading.
group('the recipe items: each is read back whole and spends inside its grade', () => {
  const holds = (name: string): ItemTemplate => of(name);
  const formulaOf = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
  const spendOf = (name: string) => itemSpend(holds(name), RULES)!;
  test('there are five: a Thornmail, a Spellblade, a healer\'s charm, a Bulwark and a Warden\'s Plate', () => {
    expect(RECIPE_ITEMS.map(d => d.name)).toEqual(['Thornmail', 'Spellblade', "Healer's Charm", 'Bulwark Ring', "Warden's Plate"]);
    for (const d of RECIPE_ITEMS) expect(LOOT_ITEMS, d.name).toContain(d);
  });
  for (const d of RECIPE_ITEMS) {
    test(`${d.name} parses to itself, powers whole, and its spend is inside ${gradeLabel(d.rar, d.grade ?? 0)}`, () => {
      const item = holds(d.name);
      expect(parseItem(copy(item))).toEqual(copy(item));
      expect(item.worn !== undefined || item.active !== undefined, 'it holds a power').toBe(true);
      const s = spendOf(d.name);
      expect(gradeOfSpend(RULES, d.rar, s.points), `spends ${s.points.toFixed(2)} in the tier of ${d.rar}`).toBe(d.grade ?? 0);
      const band = gradeBand(RULES, d.rar, d.grade ?? 0);
      expect(s.points).toBeLessThanOrEqual(band.high + 1e-9);
      if (band.low !== null) expect(s.points).toBeGreaterThan(band.low);
    });
  }
  test('Thornmail strikes back with magic damage of 1 + 1% of the wearer\'s armor and prices whole', () => {
    const t = holds('Thornmail').worn!.triggers![0]!;
    expect([t.on, t.to]).toEqual(['struck', 'other']);
    expect(t.ops.map(o => o.op)).toEqual(['damage']);
    expect(spendOf('Thornmail').unweighed).toEqual([]);
  });
  test('Spellblade readies on an ability tagged "spell" and spends its mark with the next hit it deals', () => {
    const [ready, strike] = holds('Spellblade').worn!.triggers!;
    expect([ready!.on, strike!.on]).toEqual(['used', 'hitDealt']);
    expect(strike!.need).toEqual({ kind: 'holds', key: statusKey('spellblade-ready') });
    const mark = ready!.ops[0]!;
    expect(mark.op === 'applyStatus' && mark.def.stack?.leave).toEqual({ kind: 'event', event: 'hitDealt' });
  });
  test('Healer\'s Charm adds Presence and heals its wearer on a kill by a share of its heal power', () => {
    const c = holds("Healer's Charm");
    expect(c.bonus).toEqual({ pre: 2 });
    expect(c.worn!.triggers![0]).toMatchObject({ on: 'kill', to: 'self' });
  });
  test('Bulwark Ring gives its wearer a shield of 10 + a share of max HP to use on themselves, once in 8 rounds', () => {
    const a = holds('Bulwark Ring').active!;
    expect(a.aim).toBe('self');
    expect(a.effect).toMatchObject({ type: 'shield', formula: formulaOf('10 + 0.05 * hpmax') });
    expect(a.cost.cooldown).toBe(tick(8 * RULES.fight.round));
    expect(spendOf('Bulwark Ring').unweighed).toEqual([]);
  });
  test('Warden\'s Plate adds armor equal to a share of max HP, and is a heavy chest piece', () => {
    const p = holds("Warden's Plate");
    expect(p.slot).toBe('chest');
    expect(p.worn!.ops).toEqual([{ op: 'sheet', key: 'armor', amount: formulaOf('0.015 * hpmax') }]);
    expect([p.armor, p.resist]).toEqual([piece('heavy', 'chest', RULES).armor, piece('heavy', 'chest', RULES).resist]);
    expect(spendOf("Warden's Plate").unweighed).toEqual([]);
  });
});
