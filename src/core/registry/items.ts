// items.ts: the built-in items, one typed table: the shop's stock, the loot a gate can drop, and the gear the starter
// campaign's hunters begin with. To add an item: add an entry to its list and run `bun run test` (tests/items.test.ts
// checks every entry). The GM's own items live in the save (`library`, `shop`), not here.
// `parseItem` is the one reader of an item from outside data: a save, a room message, a form, an import. The `Item` type
// lives here; save.ts re-exports it. A worn item's grade is the one its spend reads (item-budget.ts, economy design 2.5):
// most built-in gear is plain for its tier, so its minus. Six are past their tier's top and kept as they are at its plus
// (the owner's ruling 6, "Keep them."); tests/item-budget.test.ts names them, so a seventh fails it.
import { FULL_HEAL, healsFully } from '../combat/effect-ops.ts';
import type { Op } from '../combat/effect-ops.ts';
import { parseOp } from '../combat/fight-parse.ts';
import { withinSize } from '../size.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { kitGear, pointsAt, sheetOf, split } from '../hunter/derive.ts';
import type { DeriveRules, GearPiece, Kit } from '../hunter/derive.ts';
import { BONUS_KEYS, RULES, priceBaseOf } from '../rules.ts';
import type { BonusKey, Rules } from '../rules.ts';
import { oneOf } from '../one-of.ts';
import { isIconKey } from './icons.ts';
import type { IconKey } from './icons.ts';
import type { ItemId } from '../ids.ts';
import { DAMAGE_TYPES, defenceOf } from '../combat/damage-type.ts';
import type { DamageType } from '../combat/damage-type.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import type { StatusDef } from '../combat/effect-ops.ts';
import { statusKey } from '../combat/effect-ops.ts';
import { tiles } from '../combat/space.ts';
import { tick } from '../combat/timeline.ts';
import { abilityOf } from './ability-kinds.ts';
import { parsePowers } from './powers.ts';
import type { Powers } from './powers.ts';
import { BUILT_IN_STATUSES } from './statuses.ts';

// The item enums live here, beside the one parser that reads them; save.ts re-exports them.
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export const ITEM_TYPES = ['weapon', 'armor', 'accessory', 'consumable', 'material', 'key', 'misc'] as const;
export const SLOTS = ['weapon', 'offhand', 'head', 'chest', 'neck', 'legs', 'feet', 'orb', 'ring1', 'ring2'] as const;
/** How many gear slots a hunter may wear at one time out of the ten (`SLOTS`). */
export const WEAR_LIMIT = 6;
/** How a weapon attacks (src/core/registry/abilities.ts `weaponAttack`): a bow shoots, anything else strikes. */
export const ATTACKS = ['strike', 'shot'] as const;
export type Rarity = (typeof RARITIES)[number];
export type ItemType = (typeof ITEM_TYPES)[number];
export type Slot = (typeof SLOTS)[number];
export type Attack = (typeof ATTACKS)[number];
/** Player-facing label for each gear slot, in the order the sheet shows them. */
export const SLOT_LABELS: Readonly<Record<Slot, string>> = {
  weapon: 'Main hand', offhand: 'Off hand', head: 'Helm', chest: 'Armor', neck: 'Neck',
  legs: 'Pants', feet: 'Boots', orb: 'Orb', ring1: 'Ring 1', ring2: 'Ring 2',
};
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
 * sheet (src/core/hunter/sheet.ts), and gives its `Powers` in every fight (powers.ts: its `worn` status on its wearer's
 * row at the item's rarity, its `active` an ability its wearer may use; combat/rows.ts `heldPowers`). A weapon in the
 * weapon slot attacks with its `dice` as its `attack`. Used, it does its `effects` (src/core/effects.ts) to the user, or
 * to another it picks when `target` is `other`.
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
  attack?: Attack;
  /** What kind of damage this weapon deals (`physical`, `arcane`, or `true`). Absent means physical. */
  damageType?: DamageType;
  /** Uses finesse power (`max(phys, agi finesse)`) instead of physical power alone; kept only on strike weapons (shots already use finesse). */
  finesse?: true;
  /** Takes both hand slots (main hand and off hand); kept only on a weapon in the main-hand slot. */
  twoHanded?: true;
  effects?: Op[];
  /** All of its use effects go to another the user picks. Without it they go to the user. */
  target?: 'other';
  /** The GM is told when a player uses it (the room's `used` message, and the session log). */
  tell?: true;
  /**
   * Used, it brings its dead user back through the life machine's `revive` (src/core/hunter/use.ts `useItem`): refused
   * while the user is not dead, and outside a fight only. It raises a hunter of its rarity's rank or lower (`revives`),
   * and its price is `revivePrices` times that rank's `priceBase` (`valueOf`). Only a consumable holds it. The Association does not
   * buy it back (inventory.ts `sellable`) and no loot roll drops it (`lootPool`): the GM decides how many exist.
   */
  revive?: true;
  /**
   * Used on its own user, it works only for hunters of its rarity's rank or lower (`usableAtRank` in use.ts, and
   * `Ability.maxTier` in charge.ts). Only a consumable holds it. Loot rolls skip it (`lootPool`), so higher-rank gates
   * never flood drops with unusable lower-rank bottles.
   */
  rankCap?: true;
} & Powers;

/** The types a hunter wears (`parseItem` keeps powers on these alone): a consumable is used, and the rest are carried. */
const WORN_TYPES: readonly ItemType[] = ['weapon', 'armor', 'accessory'];

/** The five slots a piece of armor may take, each with its share of a kit in hundredths; they sum to 100. */
export const KIT_SHARE = { chest: 35, legs: 20, offhand: 15, head: 15, feet: 15 } as const;
export type ArmorSlot = keyof typeof KIT_SHARE;
const ARMOR_SLOTS = Object.keys(KIT_SHARE) as ArmorSlot[];

/** Every item has these. Without `value` its price is the rule's (`valueOf`); with it, the price was set by hand. Without `grade`, the middle. */
type Common = { name: string; rar: Rarity; desc: string; value?: number; grade?: Grade; icon?: IconKey };
/**
 * A built-in item. Its `type` decides what it must hold: a weapon has dice and how it attacks (and may be two-handed);
 * armor has a slot and the kit it is a piece of (`piece` works out its weight, armor and resist); an accessory a neck,
 * orb or ring slot and a bonus; a consumable the ops it does when used. The rest is a thing to carry and sell.
 */
export type ItemDef =
  | Common & Powers & { type: 'weapon'; slot: 'weapon'; dice: string; attack: Attack; damageType?: DamageType; finesse?: true; twoHanded?: true; bonus?: ItemBonus }
  | Common & Powers & { type: 'armor'; slot: ArmorSlot; kit: Kit; bonus?: ItemBonus }
  | Common & Powers & { type: 'accessory'; slot: 'neck' | 'orb' | 'ring1' | 'ring2'; bonus: ItemBonus }
  | Common & { type: 'consumable'; effects: Op[]; revive?: true; rankCap?: true; tell?: true }
  | Common & { type: 'material' | 'key' | 'misc' };

// What a consumable does when used: a Health Potion heals 50% of max HP (`HALF_HP`), Mana Potion restores 4 mana,
// Stamina Tonic removes 25 fatigue, and Elixir of Life heals fully (`FULL_HEAL`).
const num = (value: number): Formula => ({ kind: 'number', value });
const HALF_HP: Formula = { kind: 'binary', op: '*', left: num(0.5), right: { kind: 'sheet', whose: 'user', key: 'hpMax' } };
const heal = (amount: number | Formula): Op => ({ op: 'heal', amount: typeof amount === 'number' ? num(amount) : amount, when: 'use' });
const mana = (n: number): Op => ({ op: 'mana', amount: num(n), when: 'use' });
const rest = (fatigue: number): Op => ({ op: 'fatigue', amount: num(-fatigue), when: 'use' });
const rankedConsumables = (make: (rar: Rarity, rank: string) => ItemDef): ItemDef[] =>
  RARITIES.map(rar => make(rar, RULES.rarities[rar].rank));

/** The shop's stock until the GM edits the shop. Each is priced by the rule (`valueOf`). */
export const SHOP_ITEMS: readonly ItemDef[] = [
  ...rankedConsumables((rar, rank) => ({
    name: `Health Potion (${rank})`, rar, type: 'consumable', rankCap: true, effects: [heal(HALF_HP)],
    desc: `Restores 50% of max HP. For hunters of rank ${rank} or lower.`,
  })),
  ...rankedConsumables((rar, rank) => ({
    name: `Mana Potion (${rank})`, rar, type: 'consumable', rankCap: true, effects: [mana(4)],
    desc: `Restores 4 mana. For hunters of rank ${rank} or lower.`,
  })),
  ...rankedConsumables((rar, rank) => ({
    name: `Stamina Tonic (${rank})`, rar, type: 'consumable', rankCap: true, effects: [rest(25)],
    desc: `Removes 25 fatigue. For hunters of rank ${rank} or lower.`,
  })),
  ...rankedConsumables((rar, rank) => ({
    name: `Elixir of Life (${rank})`, rar, type: 'consumable', rankCap: true, effects: [heal(FULL_HEAL)],
    desc: `Fully restores HP. For hunters of rank ${rank} or lower.`,
  })),
  { name: 'Iron Dagger', rar: 'common', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike', finesse: true, desc: 'A plain iron dagger.' },
  { name: "Hunter's Leather", rar: 'common', grade: -1, type: 'armor', slot: 'chest', kit: 'light', desc: 'Light leather armor for the chest.' },
  { name: 'Steel Longsword', rar: 'common', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike', desc: 'A plain steel sword.' },
  // "Cruel to armored foes": 5 Lethality (5 points of armor ignored on every hit; a resist is not armor) plus 1 Strength
  // on a 1d8 finesse dagger spends 4.32 (0.0 weapon damage, 4.32 stats), inside Rare−'s top 5.17.
  { name: 'Knight Killer', rar: 'rare', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike', finesse: true, bonus: { str: 1, armorPenFlat: 5 }, desc: 'A finesse dagger that adds 1 Strength and ignores 5 points of armor.' },
  { name: 'Ring of Vitality', rar: 'epic', grade: -1, type: 'accessory', slot: 'ring1', bonus: { vit: 5 }, desc: 'A ring that adds 5 Vitality.' },
  // One Resurrection Crystal of each rank (economy design section 5, the owner's ruling 4): its rarity's rank is the rank it
  // raises up to, and its price `revivePrices` times that rank's `priceBase`. The GM tells the table how common they are; its use
  // is told to the GM. A crystal has no grade.
  ...rankedConsumables((rar, rank) => ({
    name: `Resurrection Crystal (${rank})`, rar, type: 'consumable', effects: [], revive: true, tell: true,
    desc: 'Use from your bag outside a fight while dead to come back to life, if your rank is this rank or lower.',
  })),
];

// ── the recipes: items built only from shapes that exist (item-stats units 3 and 10) ──
// Each is sized to its grade by `itemSpend` (item-budget.ts), and each comment says how its spend adds up. A recipe part
// that needs a shape not built yet is left out and said in its comment.
/** A formula from its text. A built-in's text is checked here, once, at load: a wrong one stops the app and its test. */
const formula = (text: string): Formula => {
  const p = parseFormula(text, RULES);
  if ('error' in p) throw new Error(`a built-in item's formula "${text}": ${p.error}`);
  return p.formula;
};
/** A fight round in ticks, times `n`. */
const rounds = (n: number) => tick(n * RULES.fight.round);
/** Spellblade's mark: it leaves with the next hit its bearer deals (the stack leaves on `hitDealt`). */
const SPELLBLADE_READY: StatusDef = {
  label: 'Spellblade ready', desc: 'The next hit deals bonus damage.', ops: [],
  stack: { cap: 1, leave: { kind: 'event', event: 'hitDealt' }, keep: 'fight', threshold: null },
};
/** Bulwark: a shield of 10 + 10% of max HP on its user, ready again 8 rounds later (once a fight of six rounds); it takes a standard action. */
const BULWARK: Ability = abilityOf('support', {
  id: abilityId('bulwark'), name: 'Bulwark', aim: 'self', shape: { kind: 'self' }, range: tiles(0), delivery: { kind: 'sure' },
  effect: { type: 'shield', by: 'hand', formula: formula('10 + 0.1 * hpmax') },
  cost: { fatigue: 0, mana: 0, time: abilityOf('support', { id: abilityId('x'), name: 'x' }, RULES).cost.time, cooldown: rounds(8) },
}, RULES);

/** The recipe items: the library holds them with the other loot, and a gate may drop them by rarity. */
export const RECIPE_ITEMS: readonly ItemDef[] = [
  // Thornmail, Epic+: a struck trigger reflects `0.03 * armor` arcane damage (6.72, read on the build with the most
  // armor, one strike a round) and applies Grievous Wounds (-40% healing, 2 rounds so it covers the attacker's next
  // turn and regen tick: 3.83), spending 10.54 inside Epic+'s 9.76..11.22.
  {
    name: 'Thornmail', rar: 'epic', grade: 1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: {},
    desc: 'Heavy chest armor. When a foe strikes you, it takes magic damage equal to 3% of your armor and gets Grievous Wounds for 2 rounds.',
    worn: {
      label: 'Thornmail', desc: 'Foes that strike you take magic damage and get Grievous Wounds.', ops: [],
      triggers: [{ on: 'struck', tag: null, to: 'other', limit: { kind: 'each' }, ops: [
        { op: 'damage', type: 'arcane', amount: formula('0.03 * armor'), when: 'use' },
        { op: 'applyStatus', key: statusKey('grievous'), def: BUILT_IN_STATUSES.grievous, duration: rounds(2) },
      ] }],
    },
  },
  // Spellblade, Rare+: 1d8 spends 0.0 weapon damage so the whole budget goes to its power; the hit trigger
  // `0.1 * phys` is read on the build with the most physical power at one hit a round: 7.11 inside Rare+'s 6.18..7.39.
  // The mark's stack has no rule worth reads. A GM tags a skill "spell" for it to ready the blade.
  {
    name: 'Spellblade', rar: 'rare', grade: 1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike', bonus: {},
    desc: 'After you use an ability tagged "spell", your next hit deals extra physical damage equal to 10% of your physical power.',
    worn: {
      label: 'Spellblade', desc: 'Using a spell adds bonus physical damage to your next hit.', ops: [],
      triggers: [
        { on: 'used', tag: tag('spell'), to: 'self', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: statusKey('spellblade-ready'), def: SPELLBLADE_READY, duration: null }] },
        { on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, need: { kind: 'holds', key: statusKey('spellblade-ready') }, ops: [{ op: 'damage', type: 'physical', amount: formula('0.1 * phys'), when: 'use' }] },
      ],
    },
  },
  // Healer's Charm, Rare+: Presence 2 (2.00), 4% heal and shield power (3.33), and a kill heal of `0.05 * sup` (1.24,
  // rate 0.35 a round on the support build), spending 6.58 inside Rare+'s 6.18..7.39.
  {
    name: "Healer's Charm", rar: 'rare', grade: 1, type: 'accessory', slot: 'neck', bonus: { pre: 2, healPower: 4 },
    desc: 'A charm that adds 2 Presence and 4% heal and shield power. When you defeat a foe, you heal for 5% of your support power.',
    worn: {
      label: "Healer's Charm", desc: 'Defeating a foe heals you.', ops: [],
      triggers: [{ on: 'kill', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'heal', amount: formula('0.05 * sup'), when: 'use' }] }],
    },
  },
  // Bulwark Ring, Rare: no bonus; the active's shield `10 + 0.1 * hpmax` on the build with the most max HP, over the
  // support's standard shield, times its uses a round (one in 8, its cooldown) times the rate a worn worth pays: 5.68
  // inside Rare's 5.17..6.18.
  {
    name: 'Bulwark Ring', rar: 'rare', type: 'accessory', slot: 'ring1', bonus: {},
    desc: 'While worn, you can use Bulwark in a fight to gain a shield equal to 10 + 10% of your max HP. 8-round cooldown.',
    active: BULWARK,
  },
  // Lifeline Locket, Rare+: no bonus; a shield of `0.16 * hpmax` once a fight, when its wearer falls under 30% HP (the
  // `lowHp` event, `kit.lowHpAt`). Read on the build with the most max HP, an HP of shield weighed as an HP healed
  // (`hpRate`), at `lowHp`'s rate of once a fight: 6.59 inside Rare+'s 6.18..7.39.
  {
    name: 'Lifeline Locket', rar: 'rare', grade: 1, type: 'accessory', slot: 'neck', bonus: {},
    desc: 'The first time you drop under 30% HP in a fight, you gain a shield equal to 16% of your max HP.',
    worn: {
      label: 'Lifeline Locket', desc: 'Gain a shield when you drop under 30% HP.', ops: [],
      triggers: [{ on: 'lowHp', to: 'self', limit: { kind: 'fight', n: 1 }, ops: [{ op: 'shield', amount: formula('0.16 * hpmax') }] }],
    },
  },
  // Warden's Plate, Epic+: the heavy chest piece is free; Vitality 1 (1.00) plus the `sheet` armor op `0.03 * hpmax`
  // read on the build with the most max HP (9.84, item-budget.ts `SHEET_OP_COST`): 10.84 inside Epic+'s 9.76..11.22.
  {
    name: "Warden's Plate", rar: 'epic', grade: 1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { vit: 1 },
    desc: 'Heavy chest armor that adds 1 Vitality. While worn, you gain extra armor equal to 3% of your max HP.',
    worn: { label: "Warden's Plate", desc: 'Adds armor equal to 3% of max HP.', ops: [{ op: 'sheet', key: 'armor', amount: formula('0.03 * hpmax') }] },
  },
];

// A piece of armour's kit is the old AC it gave: 0 or 1 light, 2 medium, 3 or more heavy (plan section 3.3). Old stats
// map as dex Agility, con Vitality, int Power, wis Instinct, cha Presence; old max MP is a fifth as max mana.
/** The items a gate's loot roll picks from by rarity (with the shop's stock). Priced by the rule unless they say otherwise. */
export const LOOT_ITEMS: readonly ItemDef[] = [
  { name: 'Goblin Shortbow', rar: 'common', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'shot', twoHanded: true, desc: 'Dropped by a gate goblin.' },
  { name: 'Padded Cap', rar: 'common', grade: -1, type: 'armor', slot: 'head', kit: 'light', desc: 'A light cloth cap.' },
  { name: 'Mana Crystal Shard', rar: 'common', type: 'material', desc: 'A piece of mana crystal. Sell it for gold.' },
  { name: 'Worn Hunter Boots', rar: 'common', type: 'armor', slot: 'feet', kit: 'light', bonus: { agi: 1 }, desc: 'Light boots that add 1 Agility.' },
  { name: 'Orc Warrior\'s Cleaver', rar: 'uncommon', type: 'weapon', slot: 'weapon', dice: '2d6', attack: 'strike', desc: 'A heavy cleaver built for raw damage.' },
  { name: 'Reinforced Hunter Vest', rar: 'uncommon', grade: -1, type: 'armor', slot: 'chest', kit: 'medium', desc: 'A leather vest with metal plates. Medium armor for the chest.' },
  { name: 'Ironhide Gauntlets', rar: 'uncommon', grade: -1, type: 'armor', slot: 'chest', kit: 'light', icon: 'gauntlet', bonus: { str: 1 }, desc: 'Light gauntlets that add 1 Strength.' },
  { name: 'Mana Talisman', rar: 'uncommon', grade: -1, type: 'accessory', slot: 'neck', bonus: { manaMax: 1 }, desc: 'A charm worn at the neck that adds 1 max mana.' },
  { name: 'Swift Runner Greaves', rar: 'uncommon', grade: -1, type: 'armor', slot: 'legs', kit: 'light', bonus: { agi: 1 }, desc: 'Light leg armor that adds 1 Agility.' },
  { name: "Kasaka's Venom Fang", rar: 'rare', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike', finesse: true, bonus: { agi: 2 }, desc: 'A fang used as a dagger. Adds 2 Agility.' },
  { name: "Ice Elf's Cloak", rar: 'rare', grade: -1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { vit: 1 }, desc: 'A heavy cloak that adds 1 Vitality.' },
  { name: 'Mage Circlet', rar: 'rare', type: 'armor', slot: 'head', kit: 'light', bonus: { pow: 2, manaMax: 2 }, desc: 'A silver headband that adds 2 Power and 2 max mana.' },
  { name: "Baruka's Mana Ring", rar: 'rare', type: 'accessory', slot: 'ring2', bonus: { manaMax: 3 }, desc: 'A ring that adds 3 max mana.' },
  { name: 'Frost Giant Hammer', rar: 'epic', grade: 1, type: 'weapon', slot: 'weapon', dice: '2d12', attack: 'strike', twoHanded: true, desc: 'A massive two-handed hammer with a head of ice, built for raw damage.' },
  { name: "Knight's Aegis", rar: 'epic', grade: -1, type: 'armor', slot: 'offhand', kit: 'heavy', bonus: { vit: 1 }, desc: 'A heavy tower shield that adds 1 Vitality.' },
  { name: 'Cloak of the Shadow Hunter', rar: 'epic', grade: -1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { agi: 2 }, desc: 'A heavy cloak that adds 2 Agility.' },
  { name: 'Helm of the Iron Knight', rar: 'epic', grade: -1, type: 'armor', slot: 'head', kit: 'medium', bonus: { vit: 2 }, desc: 'A medium helmet that adds 2 Vitality.' },
  { name: "Kamish's Wrath", rar: 'legendary', grade: 1, type: 'weapon', slot: 'weapon', dice: '3d8', attack: 'strike', finesse: true, twoHanded: true, bonus: { str: 4, agi: 2 }, desc: 'A pair of daggers made from a dragon\'s fang. Adds 4 Strength and 2 Agility.' },
  { name: 'Armor of the Black Knight', rar: 'legendary', grade: -1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { vit: 3 }, desc: 'Heavy chest armor that adds 3 Vitality.' },
  { name: 'Orb of Avarice', rar: 'legendary', grade: 1, type: 'accessory', slot: 'orb', bonus: { pow: 4, manaMax: 6 }, desc: 'An orb that adds 4 Power and 6 max mana.' },
  { name: 'Boots of Shadow Step', rar: 'legendary', grade: -1, type: 'armor', slot: 'feet', kit: 'light', bonus: { agi: 4 }, desc: 'Light boots that add 4 Agility.' },
  { name: "Monarch's Scepter", rar: 'mythic', grade: 1, type: 'weapon', slot: 'weapon', dice: '4d8', attack: 'strike', twoHanded: true, bonus: { pow: 6, manaMax: 10 }, desc: 'A scepter that adds 6 Power and 10 max mana.' },
  { name: 'Crown of the Shadow Sovereign', rar: 'mythic', grade: -1, type: 'armor', slot: 'head', kit: 'heavy', bonus: { pow: 5, ins: 5 }, desc: 'A heavy crown that adds 5 Power and 5 Instinct.' },
  { name: 'Armor of the Absolute Being', rar: 'mythic', grade: 1, type: 'armor', slot: 'chest', kit: 'heavy', bonus: { vit: 5, hpMax: 100 }, desc: 'Heavy chest armor that adds 5 Vitality and 100 max HP.' },
  { name: "Ring of the Monarch's Will", rar: 'mythic', grade: -1, type: 'accessory', slot: 'ring1', bonus: { str: 6, pre: 6 }, desc: 'A ring that adds 6 Strength and 6 Presence.' },
  ...RECIPE_ITEMS,
];

/** The item each of the starter campaign's three hunters begins with (src/views/starter.js). It is given as is: no price. */
export const STARTER_GEAR = {
  // A tower shield is not light, whatever its old AC of 1 said: a heavy kit's offhand.
  towerShield: { name: 'Dented Tower Shield', rar: 'common', grade: -1, type: 'armor', slot: 'offhand', kit: 'heavy', desc: 'A dented, heavy tower shield.' },
  huntingBow: { name: 'Hunting Bow', rar: 'common', grade: -1, type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'shot', twoHanded: true, desc: 'A worn hunting bow.' },
  manaPotion: { name: 'Mana Potion', rar: 'common', type: 'consumable', effects: [mana(2)], desc: 'Restores 2 mana.' },
} as const satisfies Record<string, ItemDef>;

/** An item as a hunter would hold it, before it has an id. */
export type ItemTemplate = Omit<Item, 'id'>;

/**
 * The rules a price reads: the base prices by rank (`priceBaseOf`), each rarity's rank, a grade's factor, the share a
 * standard consumable costs, the base-price multiple a full-heal consumable costs (`elixirPrices`), and the multiple an
 * item that revives costs (`revivePrices`).
 */
export type PriceRules = Pick<Rules, 'priceBase' | 'rarities' | 'gradeStep' | 'usedUpShare' | 'elixirPrices' | 'revivePrices'>;
/** What a price reads of an item: its rarity, its type (a consumable is used up), its grade, whether it revives, its effects (for full heals), and a price typed by hand. */
export type Priced = Pick<Item, 'rar' | 'type'> & Partial<Pick<Item, 'value' | 'grade' | 'revive' | 'effects'>>;
/** Whether `i` has an immediate full-heal op at its rarity's tier (priced by `elixirPrices` instead of `usedUpShare`). */
export const isFullHealItem = (i: Pick<Priced, 'rar' | 'effects'>): boolean => {
  const tier = Math.max(0, RARITIES.indexOf(i.rar));
  return (i.effects ?? []).some(o => o.op === 'heal' && o.when !== 'turn' && healsFully(o.amount, tier));
};
/** The base price of the rarity's rank (`priceBaseOf`) times `gradeStep` to the grade, before rounding. */
const graded = (R: Pick<Rules, 'priceBase' | 'rarities' | 'gradeStep'>, rar: Rarity, grade: Grade): number => priceBaseOf(R, R.rarities[rar].rank) * R.gradeStep ** grade;
/**
 * What an item's use does to its price, times its graded base price: an item that revives costs `revivePrices` of it,
 * a full-heal consumable `elixirPrices`, another consumable `usedUpShare`, and anything kept the whole.
 */
const useFactor = (i: Pick<Priced, 'rar' | 'type' | 'revive' | 'effects'>, R: Pick<Rules, 'usedUpShare' | 'elixirPrices' | 'revivePrices'>): number =>
  (i.type !== 'consumable' ? 1 : i.revive ? R.revivePrices : isFullHealItem(i) ? R.elixirPrices : R.usedUpShare);
/**
 * An item's price: the one it was given, else the rule's: the base price of its rarity's rank times `gradeStep` to its
 * grade (`priceOf`), times what its use makes it worth (`useFactor`), rounded once.
 * Implicit audit 3, L1: the rule's price was stored as a number when an item was made, so a change of the price rule
 * reached no item already made or held.
 */
export const valueOf = (i: Priced, R: PriceRules): number =>
  i.value ?? Math.round(graded(R, i.rar, i.grade ?? 0) * useFactor(i, R));
/** An item's weight: the one it was given, else the rule's (a weapon's by its dice, `weaponWeight`; anything else 0). */
export const weightOf = (i: { readonly weight?: number; readonly type?: string; readonly dice?: string }): number => i.weight ?? (i.type === 'weapon' ? weaponWeight(i.dice ?? '') : 0);
/**
 * The price of an item of rarity `rar` and grade `grade` (the middle when left out) that sets none and is not used up:
 * the base price of the rarity's rank (`priceBaseOf`) times `gradeStep` to the grade, rounded to whole gold. Computed
 * from `priceBase` on each read, so a GM's edit of `priceBase` moves prices and an edit of `loot.*.gold` does not.
 */
export const priceOf = (R: Pick<Rules, 'priceBase' | 'rarities' | 'gradeStep'>, rar: Rarity, grade: Grade = 0): number => Math.round(graded(R, rar, grade));

/**
 * The built-in shop as items at the rules' prices now, and every built-in item the same way: built at each read, so a
 * GM's price rule reaches the default shop and the loot at once (implicit audit 3, I1: they were priced once at load).
 */
export const defaultShop = (R: Rules): ItemTemplate[] => SHOP_ITEMS.map(d => itemOf(R, d));
export const builtInItems = (R: Rules): ItemTemplate[] => [...SHOP_ITEMS, ...LOOT_ITEMS].map(d => itemOf(R, d));
/**
 * What a loot roll draws from (a gate's Clear, a solo run, the GM's roll table): the built-in items without reviving
 * items (the owner, Nov 18: "GM determines resurrection") and without rank-capped shop consumables, so higher-rank gates
 * never flood loot drops with unusable lower-rank bottles (the GM can still give any built-in item through Award).
 */
export const lootPool = (R: Rules): ItemTemplate[] => builtInItems(R).filter(i => !i.revive && !i.rankCap);

/**
 * One number of a kit split over its six pieces by their shares (`KIT_SHARE`) so the six add up to it exactly: each piece
 * takes its share rounded down, and each point the rounding left over goes to the piece that lost the most to it, on a
 * tie the larger share and then the slot order (the largest-remainder rule). Rounding each piece alone made a light set
 * armor 11 and resist 16 where the kit is 10 and 15 (sim-log.md, balance unit 4).
 */
function splitOver(n: number): Readonly<Record<ArmorSlot, number>> {
  // in hundredths, so a tie of what the rounding cut is an exact tie
  const exact = ARMOR_SLOTS.map(slot => ({ slot, whole: Math.floor(n * KIT_SHARE[slot] / 100), cut: (n * KIT_SHARE[slot]) % 100 }));
  const left = n - exact.reduce((s, e) => s + e.whole, 0);
  const first = [...exact].sort((a, b) => b.cut - a.cut || KIT_SHARE[b.slot] - KIT_SHARE[a.slot]).slice(0, left).map(e => e.slot);
  return Object.fromEntries(exact.map(e => [e.slot, e.whole + (first.includes(e.slot) ? 1 : 0)])) as Record<ArmorSlot, number>;
}

/**
 * A piece of armour: its slot's part of its kit's weight, armor and resist (`splitOver`), so a full set of six is the kit
 * (derive.ts `kitGear`). Its rarity gives it no armor or resist of its own: a rarer piece is better only by what its tier's
 * budget lets it hold beside them (item-budget.ts) and costs more (`priceOf`), so a hunter and a monster of any rank wear
 * the same kit and a boss is tougher only by its kind's factors.
 */
export function piece(kit: Kit, slot: ArmorSlot, R: Pick<Rules, 'fight'>): GearPiece {
  const k = R.fight.kits[kit];
  return { weight: splitOver(k.weight)[slot], armor: splitOver(k.armor)[slot], resist: splitOver(k.resist)[slot] };
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

/** A weapon's weight by the first dice term in its formula: 1 for one d4 or d6, 2 for one d8 to d12, 4 for two or more dice. */
export function weaponWeight(dice: string): number {
  const m = /(\d+)d(\d+)/.exec(dice);
  if (!m) return 1;
  return Number(m[1]) >= 2 ? 4 : Number(m[2]) <= 6 ? 1 : 2;
}

/** The powers a built-in def holds, copied as they are (a def without any gives `{}`). */
const powersOf = (def: Powers): Powers => ({ ...(def.worn ? { worn: def.worn } : {}), ...(def.active ? { active: def.active } : {}) });

/** Builds Thornmail's Grievous Wounds op from `R.conditions.grievous` so new copies follow the GM's status rule. */
function withThornmailGrievous(def: ItemDef, R: Rules): ItemDef {
  if (def.name !== 'Thornmail' || def.type !== 'armor' || !def.worn?.triggers) return def;
  const live = R.conditions.grievous;
  if (!live || live === BUILT_IN_STATUSES.grievous) return def;
  const triggers = def.worn.triggers.map(t => ({
    ...t,
    ops: t.ops.map(o => (o.op === 'applyStatus' && o.key === statusKey('grievous') ? { ...o, def: live } : o)),
  }));
  return { ...def, worn: { ...def.worn, triggers } };
}

/**
 * A built-in item as an item a hunter can hold (no id yet): a price only when it sets one (else the rule's, `valueOf`),
 * a grade only when it is a minus or a plus (the middle is none, as `parseItem` reads it).
 */
export function itemOf(R: Rules, rawDef: ItemDef): ItemTemplate {
  const def = withThornmailGrievous(rawDef, R);
  const base = { name: def.name, rar: def.rar, type: def.type, desc: def.desc, qty: 1, ...(def.value ? { value: def.value } : {}), ...(def.grade ? { grade: def.grade } : {}), ...(def.icon ? { icon: def.icon } : {}), dice: '', weight: 0, armor: 0, resist: 0 };
  switch (def.type) {
    case 'weapon':
      const { weight: _byDice, ...unweighed } = base; // a weapon's weight is its dice's (`weightOf`)
      return { ...unweighed, slot: def.slot, dice: def.dice, attack: def.attack, ...(def.damageType && defenceOf(def.damageType) !== 'armor' ? { damageType: def.damageType } : {}), ...(def.finesse ? { finesse: true as const } : {}), ...(def.twoHanded ? { twoHanded: true as const } : {}), bonus: { ...def.bonus }, ...powersOf(def) };
    case 'armor': return { ...base, slot: def.slot, bonus: { ...def.bonus }, ...piece(def.kit, def.slot, R), ...powersOf(def) };
    case 'accessory': return { ...base, slot: def.slot, bonus: { ...def.bonus }, ...powersOf(def) };
    case 'consumable': return { ...base, slot: null, bonus: {}, ...(def.effects.length ? { effects: [...def.effects] } : {}), ...(def.revive ? { revive: true } : {}), ...(def.rankCap ? { rankCap: true } : {}), ...(def.tell ? { tell: true } : {}) };
    default: return { ...base, slot: null, bonus: {} };
  }
}

// ── the one parser ──
/** The bounds of every item, wherever it comes from. Weight is design 2.3's 0 to 50; an item does at most 12 things, as a status. */
export const ITEM_BOUNDS = { name: 60, desc: 500, dice: 120, qty: 9999, value: 1e9, bonus: 999, weight: 50, armor: 999, resist: 999, effects: 12 } as const;
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
 * default shows), and its powers (`worn`, `active`) by `parsePowers` on a type that is worn (`WORN_TYPES`). Every other
 * key is dropped. An item past its size (size.ts `THING_MAX.item`, its powers included), or whose worn status or active
 * is past a status's or an ability's, is refused whole: null.
 */
export function parseItem(v: unknown): ItemTemplate | null {
  if (!isObj(v)) return null;
  const B = ITEM_BOUNDS;
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, B.name) : '';
  if (!name) return null;
  // refuse an over-bound dice formula whole instead of cutting a valid expression into a broken or smaller one
  if (typeof v.dice === 'string' && v.dice.trim().length > B.dice) return null;
  const bonus: ItemBonus = {};
  const rawBonus = isObj(v.bonus) ? v.bonus : {};
  for (const k of BONUS_KEYS) { const n = whole(Object.hasOwn(rawBonus, k) ? rawBonus[k] : 0, -B.bonus, B.bonus, 0); if (n) bonus[k] = n; }
  const oldPenFlat = whole(v.penFlat, 0, B.bonus, 0);
  if (oldPenFlat && bonus.armorPenFlat === undefined) bonus.armorPenFlat = oldPenFlat;
  const out: ItemTemplate = {
    name, rar: oneOf(v.rar, RARITIES, 'common'), type: oneOf(v.type, ITEM_TYPES, 'misc'), slot: oneOf(v.slot, SLOTS, null), qty: whole(v.qty, 1, B.qty, 1),
    dice: typeof v.dice === 'string' ? v.dice.trim() : '', bonus, desc: text(v.desc, B.desc),
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
  const damageType = out.type === 'weapon' ? oneOf(v.damageType, DAMAGE_TYPES, null) : null;
  if (damageType && defenceOf(damageType) !== 'armor') out.damageType = damageType;
  if (v.finesse === true && out.type === 'weapon' && out.attack !== 'shot') out.finesse = true;
  if (v.twoHanded === true && out.type === 'weapon' && out.slot === 'weapon') out.twoHanded = true;
  const effects = (Array.isArray(v.effects) ? v.effects : [])
    .flatMap(o => { const p = parseOp(o, RULES); return p ? [p] : []; })
    .slice(0, B.effects);
  if (effects.length) out.effects = effects;
  if (v.target === 'other') out.target = 'other';
  if (v.tell === true) out.tell = true;
  if (v.revive === true && out.type === 'consumable') out.revive = true;
  if (v.rankCap === true && out.type === 'consumable') out.rankCap = true;
  const powers = WORN_TYPES.includes(out.type) ? parsePowers(v) : {};
  // refused whole for its size, never cut: an item without the power or the effect it was made with is another item
  if (powers === null) return null;
  const item: ItemTemplate = { ...out, ...powers };
  return withinSize('item', item) ? item : null;
}
