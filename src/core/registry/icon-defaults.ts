// icon-defaults.ts: the icon a thing shows when the GM picked none (docs/agent-handoff/features/icons/design.md section
// 3), so "why does this thing have this picture" has one answer. Each answer is the thing's own key when it holds one,
// else a cell of a table below. A table keyed by a union is a mapped type, so the typecheck asks for a cell when an
// archetype, slot, item type, attack, op kind, damage type, ability kind or built-in status is added. The default is
// never stored: a changed type or a better table reaches every thing that never picked. Pure; imports types, and the
// one reading of an amount's sign (formula.ts `signOf`) with the one reading of a tier (op-amount.ts `atTier`).
// To change a default: change its cell, then `bun run test` (tests/icons.test.ts states each cell as the design does).
import type { IconKey } from './icons.ts';
import type { Attack, ItemType, Slot } from './items.ts';
import type { BuiltInStatus } from './statuses.ts';
import type { Archetype } from '../hunter/derive.ts';
import type { AbilityKind, DamageType } from '../combat/ability-types.ts';
import type { Op, OpKind, StatusDef, Tiered } from '../combat/effect-ops.ts';
import { signOf } from '../formula.ts';
import { atTier } from '../combat/op-amount.ts';
import type { ItemId } from '../ids.ts';

/** The sixteen enemy types (the enemy draft's), by their lowercase name, each with its picture. */
const TYPE_ICON: Readonly<Record<string, IconKey>> = {
  beast: 'wolf', undead: 'skull', insect: 'beetle', construct: 'golem', demon: 'horns', spirit: 'ghost', humanoid: 'warrior',
  dragon: 'dragon', giant: 'giant', plant: 'vine', elemental: 'vortex', fey: 'butterfly', aquatic: 'fish', aberration: 'tentacle',
  ooze: 'slime', celestial: 'halo',
};
/** An archetype's picture, for an enemy whose type is none of the sixteen: a brute's claw, a caster's orb, a skirmisher's dagger. */
const ARCHETYPE_ICON: { readonly [A in Archetype]: IconKey } = { brute: 'claw', caster: 'orb', skirmisher: 'dagger' };

/**
 * An enemy's icon: its pick, else its type's picture (the type as the GM typed it, any case, spaces around it trimmed),
 * else its archetype's. A shadow's or a summon's body has no type, so it takes its archetype's.
 */
export function monsterIcon(m: { readonly type?: string; readonly archetype: Archetype; readonly icon?: IconKey }): IconKey {
  const type = (m.type ?? '').trim().toLowerCase();
  return m.icon ?? (Object.hasOwn(TYPE_ICON, type) ? TYPE_ICON[type] : undefined) ?? ARCHETYPE_ICON[m.archetype];
}

/** A weapon's picture by how it attacks. */
const ATTACK_ICON: { readonly [A in Attack]: IconKey } = { strike: 'sword', shot: 'bow' };
/** Armour's and an accessory's picture by the slot it takes (a weapon's is its attack's; the offhand's is the emblem shield). */
const SLOT_ICON: { readonly [S in Slot]: IconKey } = {
  weapon: 'sword', offhand: 'shield', head: 'helm', chest: 'chestplate', hands: 'gauntlet', legs: 'greaves', feet: 'boots',
  neck: 'amulet', ring1: 'ring', ring2: 'ring',
};
/** An item's picture by its type, when nothing more particular answers: a weapon with no attack, armour or an accessory with no slot, a consumable that does not revive. */
const ITEM_TYPE_ICON: { readonly [T in ItemType]: IconKey } = {
  weapon: 'sword', armor: 'chestplate', accessory: 'ring', consumable: 'potion', material: 'ore', key: 'key', misc: 'pouch',
};
/** What an item's default reads: its type, its slot, how it attacks and whether it revives. */
export type IconItem = {
  readonly type: ItemType; readonly slot: Slot | null; readonly attack?: Attack; readonly revive?: true; readonly icon?: IconKey;
};

/** An item's icon: its pick, else a weapon's attack, armour's or an accessory's slot, a crystal for a consumable that revives, else its type's. */
export function itemIcon(i: IconItem): IconKey {
  const particular = i.type === 'weapon' ? (i.attack ? ATTACK_ICON[i.attack] : undefined)
    : i.type === 'armor' || i.type === 'accessory' ? (i.slot ? SLOT_ICON[i.slot] : undefined)
    : i.type === 'consumable' && i.revive ? 'crystal' : undefined;
  return i.icon ?? particular ?? ITEM_TYPE_ICON[i.type];
}

/**
 * Each built-in status's own picture. Four of them would share a first op (bleeding, burning, poisoned and plague all
 * hurt first), so each names its own. A GM's status of a built-in's key replaces that built-in in the library and keeps
 * its picture until it picks one.
 */
const STATUS_ICON: { readonly [K in BuiltInStatus]: IconKey } = {
  bleeding: 'blood', burning: 'flame', poisoned: 'poison', paralyzed: 'bolt', stunned: 'dizzy', frightened: 'fear',
  blinded: 'blind', slowed: 'snail', hasted: 'wing', invisible: 'faded', prone: 'fallen', restrained: 'chain', stealth: 'hood',
  bloodlust: 'rage', regenerating: 'heal', plague: 'plague',
};
/** A hit's picture by what it hurts with. */
const DAMAGE_ICON: { readonly [T in DamageType]: IconKey } = { physical: 'slash', magical: 'spark' };
/** An op's E value (its first tier's, or its one value), whose sign picks a speed's or a stat's picture. */
const eValue = (v: Tiered<number>): number => (typeof v === 'number' ? v : v[0]);
/** A signed op's picture: `up` at 0 and above (no sign is no harm), `down` below. */
const bySign = (v: Tiered<number>, up: IconKey, down: IconKey): IconKey => (eValue(v) < 0 ? down : up);
/** A cell of OP_ICON: a key, or the rule that picks one from the op. */
type OpCell<K extends OpKind> = IconKey | ((o: Extract<Op, { readonly op: K }>) => IconKey);
/** Each op kind's picture, for a GM's status by its first op. The kinds no picture says better take `status`. */
const OP_ICON: { readonly [K in OpKind]: OpCell<K> } = {
  damage: o => DAMAGE_ICON[o.type], heal: 'heal', mana: 'mana', fatigue: 'weary',
  speed: o => bySign(o.pct, 'wing', 'snail'), stat: o => (signOf(atTier(o.amount, 0)) < 0 ? 'down' : 'up'),
  hold: 'dizzy', root: 'chain', shield: 'shield', hidden: 'hood', stayHidden: 'hood', spread: 'plague', cureStatus: 'cure', dispel: 'cure',
  taunt: 'taunt', threat: 'taunt', untargetable: 'ward', invulnerable: 'ward', safeguard: 'ward', delay: 'timer', refund: 'timer',
  shove: 'push', move: 'push', reveal: 'eye',
  applyStatus: 'status', note: 'status', channel: 'status', staggerRate: 'status', aura: 'status', sheet: 'status', share: 'status',
  edge: 'status', boost: 'status', alert: 'status', hasten: 'status', extra: 'status', guard: 'status', negate: 'status',
};

/** An op's picture: its kind's cell, or what the cell's rule picks from the op. */
export function opIcon(o: Op): IconKey {
  // A cell's rule takes its own kind's op; `o` is that op, which the compiler cannot pair with the looked-up cell.
  const cell = OP_ICON[o.op] as OpCell<OpKind>;
  return typeof cell === 'string' ? cell : (cell as (o: Op) => IconKey)(o);
}

/**
 * A status's icon: its pick, else a built-in key's own picture, else its first op's, else a timer for a status that only
 * ends in something (a delayed effect), else the plain `status`.
 */
export function statusIcon(key: string, def: Pick<StatusDef, 'ops' | 'end'> & { readonly icon?: IconKey }): IconKey {
  const first = def.ops[0];
  return def.icon ?? (Object.hasOwn(STATUS_ICON, key) ? STATUS_ICON[key as BuiltInStatus] : undefined)
    ?? (first ? opIcon(first) : def.end ? 'timer' : 'status');
}

/** An ability's picture by its kind. */
const KIND_ICON: { readonly [K in AbilityKind]: IconKey } = { strike: 'strike', shot: 'arrow', blast: 'burst', curse: 'hex', support: 'aid' };

/**
 * An ability's icon: a bag item's use shows the item's icon (`itemOf` finds it in the user's bag), so the hotbar's
 * potion is the bag's; any other, or a use whose item the bag no longer holds, its kind's picture.
 */
export function abilityIcon(a: { readonly kind: AbilityKind; readonly item?: ItemId }, itemOf: (id: ItemId) => IconItem | null): IconKey {
  const item = a.item ? itemOf(a.item) : null;
  return item ? itemIcon(item) : KIND_ICON[a.kind];
}
