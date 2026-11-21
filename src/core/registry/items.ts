// items.ts: the built-in items, one typed table: the shop's stock, the loot a gate can drop, and the gear the starter
// campaign's hunters begin with. To add an item: add an entry to its list and run `bun run test` (tests/items.test.ts
// checks every entry). The GM's own items live in the save (`library`, `shop`), not here.
// `parseItem` is the one reader of an item from outside data: a save, a room message, a form, an import. The `Item` type
// lives here; save.ts re-exports it. A worn item's grade is the one its spend reads (item-budget.ts, economy design 2.5):
// most built-in gear is plain for its tier, so its minus. Six are past their tier's top and kept as they are at its plus
// (the owner's ruling 6, "Keep them."); tests/item-budget.test.ts names them, so a seventh fails it.
import { FULL_HEAL } from '../combat/effect-ops.ts';
import type { Op, StatusDef } from '../combat/effect-ops.ts';
import { parseOp, parseStatusDef, statusTooLarge } from '../combat/fight-parse.ts';
import { withinSize } from '../size.ts';
import type { Formula } from '../formula.ts';
import { kitGear, pointsAt, sheetOf, split } from '../hunter/derive.ts';
import type { DeriveRules, GearPiece, Kit } from '../hunter/derive.ts';
import { BONUS_KEYS, RULES, clearOf } from '../rules.ts';
import type { BonusKey, Rules } from '../rules.ts';
import { oneOf } from '../one-of.ts';
import { isIconKey } from './icons.ts';
import type { IconKey } from './icons.ts';
import type { ItemId } from '../ids.ts';

// The item enums live here, beside the one parser that reads them; save.ts re-exports them.
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export const ITEM_TYPES = ['weapon', 'armor', 'accessory', 'consumable', 'material', 'key', 'misc'] as const;
export const SLOTS = ['weapon', 'offhand', 'head', 'chest', 'hands', 'legs', 'feet', 'neck', 'ring1', 'ring2'] as const;
/** How a weapon attacks (src/core/registry/abilities.ts `weaponAttack`): a bow shoots, anything else strikes. */
export const ATTACKS = ['strike', 'shot'] as const;
export type Rarity = (typeof RARITIES)[number];
export type ItemType = (typeof ITEM_TYPES)[number];
export type Slot = (typeof SLOTS)[number];
export type Attack = (typeof ATTACKS)[number];
/**
 * Where an item sits inside its tier (economy design 2.1, the owner's ruling 1): minus -1, middle 0, plus 1, shown as
 * Epic−, Epic, Epic+ (`gradeLabel` in effects.ts). A number because the price reads it as an exponent of `gradeStep`;
 * three values because three were named and priced, so the price and the maker's chips are total over them.
 */
export const GRADES = [-1, 0, 1] as const;
export type Grade = (typeof GRADES)[number];

/** What an item adds while worn: points on any bonus key (`BONUS_KEYS`), a stat or a number of the sheet. */
export type ItemBonus = Partial<Record<BonusKey, number>>;

/**
 * An item a hunter holds. Worn, it adds its `bonus` and its gear numbers (`weight`, `armor`, `resist`) to the
 * sheet (src/core/hunter/sheet.ts). A weapon in the weapon slot attacks with its `dice` as its `attack`. Used, it does
 * its `effects` (src/core/effects.ts) to the user, or to another it picks when `target` is `other`.
 */
export type Item = {
  id: ItemId; name: string; rar: Rarity; type: ItemType; slot: Slot | null; qty: number; dice: string; bonus: ItemBonus;
  /** Its price in gold as the GM typed it; absent, the rule's (`valueOf`), so a change of the price rule reaches it. */
  value?: number;
  /** Its place inside its tier, minus or plus; absent, the middle, so an item made before grades reads as one. Never 0. */
  grade?: Grade;
  /** The picture a GM picked, any key of the registry; absent, the default (icon-defaults.ts `itemIcon`), so a change of the table reaches it. */
  icon?: IconKey;
  /** Its weight as typed; absent, the rule's (`weightOf`: a weapon's by its dice), so a change of the dice reaches it. */
  weight?: number;
  desc: string; armor: number; resist: number;
  attack?: Attack; effects?: Op[];
  /** All of its use effects go to another the user picks. Without it they go to the user. */
  target?: 'other';
  /** The GM is told when a player uses it (the room's `used` message, and the session log). */
  tell?: true;
  /** While it is worn (in a slot), this status is on its wearer's row in every fight, at the item's rarity (kits design 1.3.2). */
  worn?: StatusDef;
  /**
   * Used, it brings its dead user back through the life machine's `revive` (src/core/hunter/use.ts `useItem`): refused
   * while the user is not dead, and outside a fight only. It raises a hunter of its rarity's rank or lower (`revives`),
   * and its price is `reviveClears` Clears of that rank (`valueOf`). Only a consumable holds it. The Association does not
   * buy it back (inventory.ts `sellable`) and no loot roll drops it (`lootPool`): the GM decides how many exist.
   */
  revive?: true;
};

/** The slots a piece of armour may take, each with its share of a kit in hundredths (design table 2.5); they sum to 100. */
export const KIT_SHARE = { chest: 35, legs: 20, offhand: 15, head: 10, hands: 10, feet: 10 } as const;
export type ArmorSlot = keyof typeof KIT_SHARE;

/** Every item has these. Without `value` its price is the rule's (`valueOf`); with it, the price was set by hand. Without `grade`, the middle. */
type Common = { name: string; rar: Rarity; desc: string; value?: number; grade?: Grade; icon?: IconKey };
/**
 * A built-in item. Its `type` decides what it must hold: a weapon has dice and how it attacks; armour has a slot and the
 * kit it is a piece of (`piece` works out its weight, armor and resist); an accessory a ring or neck slot and a bonus; a
 * consumable the ops it does when used. The rest is a thing to carry and sell.
 */
export type ItemDef =
  | Common & { type: 'weapon'; slot: 'weapon'; dice: string; attack: Attack; bonus?: ItemBonus }
  | Common & { type: 'armor'; slot: ArmorSlot; kit: Kit; bonus?: ItemBonus }
  | Common & { type: 'accessory'; slot: 'neck' | 'ring1' | 'ring2'; bonus: ItemBonus }
  | Common & { type: 'consumable'; effects: Op[]; revive?: true; tell?: true }
  | Common & { type: 'material' | 'key' | 'misc' };

// What a consumable does when used (plan section 3.3): its old `heal` heals that many HP, its old `restoreMp` restores a
// fifth as mana (max mana is a fifth of the old MP), its old `fatigue` removes that much fatigue.
const num = (value: number): Formula => ({ kind: 'number', value });
const heal = (hp: number): Op => ({ op: 'heal', amount: num(hp), when: 'use' });
const mana = (n: number): Op => ({ op: 'mana', amount: num(n), when: 'use' });
const rest = (fatigue: number): Op => ({ op: 'fatigue', amount: num(-fatigue), when: 'use' });

/** The shop's stock until the GM edits the shop. Each is priced by the rule (`valueOf`). */
export const SHOP_ITEMS: readonly ItemDef[] = [
  { name: 'Health Potion', rar: 'common', type: 'consumable', effects: [heal(30)], desc: 'Restores 30 HP.' },
  { name: 'Greater Health Potion', rar: 'uncommon', type: 'consumable', effects: [heal(150)], desc: 'Restores 150 HP.' },
  { name: 'Mana Potion', rar: 'common', type: 'consumable', effects: [mana(4)], desc: 'Restores 4 mana.' },
  { name: 'Elixir of Life', rar: 'epic', type: 'consumable', effects: [{ op: 'heal', amount: FULL_HEAL, when: 'use' }], desc: 'Fully restores HP.' },
  { name: 'Stamina Tonic', rar: 'common', type: 'consumable', effects: [rest(25)], desc: 'Removes 25 fatigue.' },
  { name: 'Iron Dagger', rar: 'common', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d4', attack: 'strike', desc: 'A plain iron dagger.' },
  { name: "Hunter's Leather", rar: 'common', grade: -1, type: 'armor', slot: 'chest', kit: 'light', desc: 'Light leather armor for the chest.' },
  { name: 'Steel Longsword', rar: 'common', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike', desc: 'A plain steel sword.' },
  // "Cruel to armored foes": 5 Lethality, 5 points of armor ignored on every hit (a resist is not armor). It was Rare+
  // while the budget could not weigh the armor ignored (design 2.5); weighed (balance plan section 9: 0.71 points a point
  // of Lethality at C), its d10, +2 Strength and 5 Lethality spend 2.8, under Rare−'s top.
  { name: 'Knight Killer', rar: 'rare', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d10', attack: 'strike', bonus: { str: 2, armorPenFlat: 5 }, desc: 'A dagger whose hits ignore 5 points of armor.' },
  { name: 'Ring of Vitality', rar: 'epic', grade: -1, type: 'accessory', slot: 'ring1', bonus: { vit: 5 }, desc: 'A ring that adds 5 Vitality.' },
  // One Resurrection Crystal of each rank (economy design section 5, the owner's ruling 4): its rarity's rank is the rank it
  // raises up to, and its price `reviveClears` Clears of that rank. The GM tells the table how common they are; its use
  // is told to the GM. A crystal has no grade.
  ...RARITIES.map((rar): ItemDef => ({
    name: `Resurrection Crystal (${RULES.rarities[rar].rank})`, rar, type: 'consumable', effects: [], revive: true, tell: true,
    desc: 'A dead hunter of its rank or lower who uses it comes back to life.',
  })),
];

// A piece of armour's kit is the old AC it gave: 0 or 1 light, 2 medium, 3 or more heavy (plan section 3.3). Old stats
// map as dex Agility, con Vitality, int Power, wis Instinct, cha Presence; old max MP is a fifth as max mana.
/** The items a gate's loot roll picks from by rarity (with the shop's stock). Priced by the rule unless they say otherwise. */
export const LOOT_ITEMS: readonly ItemDef[] = [
  { name: 'Goblin Shortbow', rar: 'common', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d6', attack: 'shot', desc: 'Dropped by a gate goblin.' },
  { name: 'Padded Cap', rar: 'common', grade: -1, type: 'armor', slot: 'head', kit: 'light', desc: 'A light cloth cap.' },
  { name: 'Mana Crystal Shard', rar: 'common', type: 'material', desc: 'A piece of mana crystal. Sell it for gold.' },
  { name: 'Worn Hunter Boots', rar: 'common', grade: 1, type: 'armor', slot: 'feet', kit: 'light', bonus: { agi: 1 }, desc: 'Light boots that add 1 Agility.' },
  { name: 'Orc Warrior\'s Cleaver', rar: 'uncommon', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d10', attack: 'strike', bonus: { str: 1 }, desc: 'A heavy cleaver that adds 1 Strength.' },
  { name: 'Reinforced Hunter Vest', rar: 'uncommon', grade: -1, type: 'armor', slot: 'chest', kit: 'medium', desc: 'A leather vest with metal plates. Medium armor for the chest.' },
  { name: 'Ironhide Gauntlets', rar: 'uncommon', grade: -1, type: 'armor', slot: 'hands', kit: 'light', bonus: { str: 1 }, desc: 'Light gauntlets that add 1 Strength.' },
  { name: 'Mana Talisman', rar: 'uncommon', grade: 1, type: 'accessory', slot: 'neck', bonus: { manaMax: 1 }, desc: 'A charm worn at the neck that adds 1 max mana.' },
  { name: 'Swift Runner Greaves', rar: 'uncommon', grade: -1, type: 'armor', slot: 'legs', kit: 'light', bonus: { agi: 1 }, desc: 'Light leg armor that adds 1 Agility.' },
  { name: "Kasaka's Venom Fang", rar: 'rare', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d6', attack: 'strike', bonus: { agi: 2 }, desc: 'A fang used as a dagger. Adds 2 Agility.' },
  { name: "Ice Elf's Cloak", rar: 'rare', grade: -1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { vit: 1 }, desc: 'A heavy cloak that adds 1 Vitality.' },
  { name: 'Mage Circlet', rar: 'rare', grade: 1, type: 'armor', slot: 'head', kit: 'light', bonus: { pow: 2, manaMax: 2 }, desc: 'A silver headband that adds 2 Power and 2 max mana.' },
  { name: "Baruka's Mana Ring", rar: 'rare', grade: 1, type: 'accessory', slot: 'ring2', bonus: { manaMax: 3 }, desc: 'A ring that adds 3 max mana.' },
  { name: 'Frost Giant Hammer', rar: 'epic', grade: -1, type: 'weapon', slot: 'weapon', dice: '2d6', attack: 'strike', bonus: { str: 3 }, desc: 'A hammer with a head of ice. Adds 3 Strength.' },
  { name: "Knight's Aegis", rar: 'epic', grade: -1, type: 'armor', slot: 'offhand', kit: 'heavy', bonus: { vit: 1 }, desc: 'A heavy tower shield that adds 1 Vitality.' },
  { name: 'Cloak of the Shadow Hunter', rar: 'epic', grade: -1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { agi: 2 }, desc: 'A heavy cloak that adds 2 Agility.' },
  { name: 'Helm of the Iron Knight', rar: 'epic', grade: -1, type: 'armor', slot: 'head', kit: 'medium', bonus: { vit: 2 }, desc: 'A medium helmet that adds 2 Vitality.' },
  { name: "Kamish's Wrath", rar: 'legendary', grade: 1, type: 'weapon', slot: 'weapon', dice: '3d8', attack: 'strike', bonus: { str: 4, agi: 2 }, desc: 'A pair of daggers made from a dragon\'s fang. Adds 4 Strength and 2 Agility.' },
  { name: 'Armor of the Black Knight', rar: 'legendary', grade: -1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { vit: 3 }, desc: 'Heavy chest armor that adds 3 Vitality.' },
  { name: 'Orb of Avarice', rar: 'legendary', grade: 1, type: 'accessory', slot: 'neck', bonus: { pow: 4, manaMax: 6 }, desc: 'An orb worn at the neck that adds 4 Power and 6 max mana.' },
  { name: 'Boots of Shadow Step', rar: 'legendary', grade: -1, type: 'armor', slot: 'feet', kit: 'light', bonus: { agi: 4 }, desc: 'Light boots that add 4 Agility.' },
  { name: "Monarch's Scepter", rar: 'mythic', grade: 1, type: 'weapon', slot: 'weapon', dice: '4d8', attack: 'strike', bonus: { pow: 6, manaMax: 10 }, desc: 'A scepter that adds 6 Power and 10 max mana.' },
  { name: 'Crown of the Shadow Sovereign', rar: 'mythic', grade: -1, type: 'armor', slot: 'head', kit: 'heavy', bonus: { pow: 5, ins: 5 }, desc: 'A heavy crown that adds 5 Power and 5 Instinct.' },
  { name: 'Armor of the Absolute Being', rar: 'mythic', grade: 1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { vit: 5, hpMax: 100 }, desc: 'Heavy chest armor that adds 5 Vitality and 100 max HP.' },
  { name: "Ring of the Monarch's Will", rar: 'mythic', grade: 1, type: 'accessory', slot: 'ring1', bonus: { str: 6, pre: 6 }, desc: 'A ring that adds 6 Strength and 6 Presence.' },
];

/** The item each of the starter campaign's three hunters begins with (src/views/starter.js). It is given as is: no price. */
export const STARTER_GEAR = {
  // A tower shield is not light, whatever its old AC of 1 said: a heavy kit's offhand.
  towerShield: { name: 'Dented Tower Shield', rar: 'common', grade: -1, type: 'armor', slot: 'offhand', kit: 'heavy', desc: 'A dented, heavy tower shield.' },
  huntingBow: { name: 'Hunting Bow', rar: 'common', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'shot', desc: 'A worn hunting bow.' },
  manaPotion: { name: 'Mana Potion', rar: 'common', type: 'consumable', effects: [mana(2)], desc: 'Restores 2 mana.' },
} as const satisfies Record<string, ItemDef>;

/** An item as a hunter would hold it, before it has an id. */
export type ItemTemplate = Omit<Item, 'id'>;

/**
 * The rules a price reads: the loot table (the Clear, `clearOf`), each rarity's rank, a grade's factor, the share a
 * consumable costs, and the Clears an item that revives costs.
 */
export type PriceRules = Pick<Rules, 'loot' | 'rarities' | 'gradeStep' | 'usedUpShare' | 'reviveClears'>;
/** What a price reads of an item: its rarity, its type (a consumable is used up), its grade, whether it revives, and a price typed by hand. */
export type Priced = Pick<Item, 'rar' | 'type'> & Partial<Pick<Item, 'value' | 'grade' | 'revive'>>;
/** One Clear of the rarity's rank (`clearOf`) times `gradeStep` to the grade, before rounding. */
const graded = (R: Pick<Rules, 'loot' | 'rarities' | 'gradeStep'>, rar: Rarity, grade: Grade): number => clearOf(R, R.rarities[rar].rank) * R.gradeStep ** grade;
/**
 * What an item's use does to its price, times its graded Clear: an item that revives costs `reviveClears` of it (economy
 * design 5: a full set of its rank's middle gear), another consumable `usedUpShare` (2.2: one use is worth half), and
 * anything kept the whole.
 */
const useFactor = (i: Pick<Priced, 'type' | 'revive'>, R: Pick<Rules, 'usedUpShare' | 'reviveClears'>): number =>
  (i.type !== 'consumable' ? 1 : i.revive ? R.reviveClears : R.usedUpShare);
/**
 * An item's price: the one it was given, else the rule's: one Clear of its rarity's rank times `gradeStep` to its grade
 * (`priceOf`), times what its use makes it worth (`useFactor`), rounded once.
 * Implicit audit 3, L1: the rule's price was stored as a number when an item was made, so a change of the price rule
 * reached no item already made or held.
 */
export const valueOf = (i: Priced, R: PriceRules): number =>
  i.value ?? Math.round(graded(R, i.rar, i.grade ?? 0) * useFactor(i, R));
/** An item's weight: the one it was given, else the rule's (a weapon's by its dice, `weaponWeight`; anything else 0). */
export const weightOf = (i: { readonly weight?: number; readonly type?: string; readonly dice?: string }): number => i.weight ?? (i.type === 'weapon' ? weaponWeight(i.dice ?? '') : 0);
/**
 * The price of an item of rarity `rar` and grade `grade` (the middle when left out) that sets none and is not used up:
 * one Clear of the rarity's rank (`clearOf`, the middle of that rank's loot gold) times `gradeStep` to the grade, rounded
 * to whole gold. Economy design 2.1, 2.2 and review E-1: computed from the loot table each read, so a GM's edit of a
 * rank's gold moves the price of its rarity, and an edit of `gradeStep` the price of every minus and plus.
 */
export const priceOf = (R: Pick<Rules, 'loot' | 'rarities' | 'gradeStep'>, rar: Rarity, grade: Grade = 0): number => Math.round(graded(R, rar, grade));

/**
 * The built-in shop as items at the rules' prices now, and every built-in item the same way: built at each read, so a
 * GM's price rule reaches the default shop and the loot at once (implicit audit 3, I1: they were priced once at load).
 */
export const defaultShop = (R: Rules): ItemTemplate[] => SHOP_ITEMS.map(d => itemOf(R, d));
export const builtInItems = (R: Rules): ItemTemplate[] => [...SHOP_ITEMS, ...LOOT_ITEMS].map(d => itemOf(R, d));
/**
 * What a loot roll draws from (a gate's Clear, a solo run, the GM's roll table): the built-in items without one that
 * revives. The owner, Nov 18: "GM determines resurrection", so a crystal comes from the shop or the GM's hand, never a roll.
 */
export const lootPool = (R: Rules): ItemTemplate[] => builtInItems(R).filter(i => !i.revive);

/**
 * A piece of armour: its slot's share of its kit's weight, armor and resist (`KIT_SHARE`; a full set of six is the kit),
 * each rounded half up, then armor and resist each raised by the rarity's index, common 0 to mythic 5 (design 2.3: armor
 * is a share stopped, so rarity adds to it rather than multiplying it).
 */
export function piece(kit: Kit, slot: ArmorSlot, rar: Rarity, R: Pick<Rules, 'fight'>): { weight: number; armor: number; resist: number } {
  const k = R.fight.kits[kit], share = KIT_SHARE[slot], up = RARITIES.indexOf(rar);
  const part = (n: number): number => Math.round(n * share / 100);
  return { weight: part(k.weight), armor: part(k.armor) + up, resist: part(k.resist) + up };
}

/** The sample hunter the item maker weighs gear on: C rank, its points 2:1 in Agility and Strength, in the medium kit. */
export const SAMPLE_WEARER = { rank: 'C', main: 'agi', second: 'str', kit: 'medium' } as const;
/**
 * The speed of the sample hunter (`SAMPLE_WEARER`) as it stands and with `extra` worn on top of its kit: what the item
 * maker shows while a GM makes gear, so "can't equip too much beefy stuff" is seen before the item is saved (design 2.3).
 */
export function wornSpeed(extra: GearPiece, R: DeriveRules): { bare: number; worn: number } {
  const level = R.rankLevels[SAMPLE_WEARER.rank], stats = split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, R), R);
  const speed = (gear: GearPiece[]): number => sheetOf({ stats, level, gear, perks: {} }, R).speed;
  const kit = kitGear(SAMPLE_WEARER.kit, R);
  return { bare: speed(kit), worn: speed([...kit, extra]) };
}

/** A weapon's weight by its dice: 1 for one d4 or d6, 2 for one d8 to d12, 4 for two or more dice. */
export function weaponWeight(dice: string): number {
  const m = /^(\d+)d(\d+)/.exec(dice);
  if (!m) return 1;
  return Number(m[1]) >= 2 ? 4 : Number(m[2]) <= 6 ? 1 : 2;
}

/**
 * A built-in item as an item a hunter can hold (no id yet): a price only when it sets one (else the rule's, `valueOf`),
 * a grade only when it is a minus or a plus (the middle is none, as `parseItem` reads it).
 */
export function itemOf(R: Rules, def: ItemDef): ItemTemplate {
  const base = { name: def.name, rar: def.rar, type: def.type, desc: def.desc, qty: 1, ...(def.value ? { value: def.value } : {}), ...(def.grade ? { grade: def.grade } : {}), ...(def.icon ? { icon: def.icon } : {}), dice: '', weight: 0, armor: 0, resist: 0 };
  switch (def.type) {
    case 'weapon':
      const { weight: _byDice, ...unweighed } = base; // a weapon's weight is its dice's (`weightOf`)
      return { ...unweighed, slot: def.slot, dice: def.dice, attack: def.attack, bonus: { ...def.bonus } };
    case 'armor': return { ...base, slot: def.slot, bonus: { ...def.bonus }, ...piece(def.kit, def.slot, def.rar, R) };
    case 'accessory': return { ...base, slot: def.slot, bonus: { ...def.bonus } };
    case 'consumable': return { ...base, slot: null, bonus: {}, ...(def.effects.length ? { effects: [...def.effects] } : {}), ...(def.revive ? { revive: true } : {}), ...(def.tell ? { tell: true } : {}) };
    default: return { ...base, slot: null, bonus: {} };
  }
}

// ── the one parser ──
/** The bounds of every item, wherever it comes from. Weight is design 2.3's 0 to 50; an item does at most 12 things, as a status. */
export const ITEM_BOUNDS = { name: 60, desc: 500, dice: 30, qty: 9999, value: 1e9, bonus: 999, weight: 50, armor: 999, resist: 999, effects: 12 } as const;
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A finite number cut to a whole one and clamped, or `d` when the value is not a number. */
const whole = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : d);
const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');

/**
 * An item read from outside data, without its id, or null when it is not an object or has no name. Each field of the
 * wrong type or value takes the default a new item has; a number is cut to a whole one inside `ITEM_BOUNDS`. The bonus
 * keeps each bonus key (`BONUS_KEYS`) that is not 0; an old item's `penFlat` (armor its hits ignored, from before the
 * four penetrations) is read as its bonus's `armorPenFlat`, Lethality, when it has none: the one-way read of old gear. Each effect is read by the fight's op
 * reader with the shipped rules' dice limits (as a reward is), one it refuses dropped, at most 12. `grade` is kept when it
 * is 1 or -1 (anything else is the middle, left out, so one item is never two stacks by a 0), `attack` when it is
 * strike or shot, `target` only when it is `other`, `tell` only when it is true, `revive`
 * only when it is true on a consumable, `icon` only when it is a key of the icon registry (an unknown one is dropped, the
 * default shows), and `worn` when the status reader takes it. Every other key is dropped. An item
 * past its size (size.ts `THING_MAX.item`), or whose worn status is past a status's, is refused whole: null.
 */
export function parseItem(v: unknown): ItemTemplate | null {
  if (!isObj(v)) return null;
  const B = ITEM_BOUNDS;
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, B.name) : '';
  if (!name) return null;
  const bonus: ItemBonus = {};
  const rawBonus = isObj(v.bonus) ? v.bonus : {};
  for (const k of BONUS_KEYS) { const n = whole(Object.hasOwn(rawBonus, k) ? rawBonus[k] : 0, -B.bonus, B.bonus, 0); if (n) bonus[k] = n; }
  const oldPenFlat = whole(v.penFlat, 0, B.bonus, 0);
  if (oldPenFlat && bonus.armorPenFlat === undefined) bonus.armorPenFlat = oldPenFlat;
  const out: ItemTemplate = {
    name, rar: oneOf(v.rar, RARITIES, 'common'), type: oneOf(v.type, ITEM_TYPES, 'misc'), slot: oneOf(v.slot, SLOTS, null), qty: whole(v.qty, 1, B.qty, 1),
    dice: text(v.dice, B.dice).trim(), bonus, desc: text(v.desc, B.desc),
    armor: whole(v.armor, 0, B.armor, 0), resist: whole(v.resist, 0, B.resist, 0),
  };
  // a price or weight that is not a number is the rule's (absent), a typed one kept inside its bound
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (finite(v.value)) out.value = whole(v.value, 0, B.value, 0);
  if (finite(v.weight)) out.weight = whole(v.weight, 0, B.weight, 0);
  if (v.grade === 1 || v.grade === -1) out.grade = v.grade;
  if (isIconKey(v.icon)) out.icon = v.icon;
  const attack = oneOf(v.attack, ATTACKS, null);
  if (attack) out.attack = attack;
  const effects = (Array.isArray(v.effects) ? v.effects : []).flatMap(o => parseOp(o, RULES) ?? []).slice(0, B.effects);
  if (effects.length) out.effects = effects;
  if (v.target === 'other') out.target = 'other';
  if (v.tell === true) out.tell = true;
  if (v.revive === true && out.type === 'consumable') out.revive = true;
  const worn = v.worn === undefined ? null : parseStatusDef(v.worn, RULES);
  if (worn) out.worn = worn;
  // refused whole for its size, never cut: an item without the worn status or the effect it was made with is another item
  if ((!worn && statusTooLarge(v.worn, RULES)) || !withinSize('item', out)) return null;
  return out;
}
