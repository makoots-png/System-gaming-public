// monsters.ts: the built-in bestiary, one typed table, and the sheet a monster has from its rank, archetype, kind and
// tweak. To add a monster: add a row to SEEDS and run `bun run test` (tests/monsters.test.ts checks every row). The GM's
// own monsters live in the save (`monsters`). A seed's XP and abilities are made from the (possibly GM-overridden) rules
// each time it is listed. The `Monster` type lives here; save.ts re-exports it.
// `parseMonster` is the one reader of a monster from outside data: the save, a pack and the bestiary editor. A fight's
// rows of one are `monsterRows` (src/core/combat/rows.ts); `lootOf` is what a fight's defeated monsters dropped.
import { RANKS, RULES } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import { STAT_KEYS } from '../stats.ts';
import type { StatKey } from '../stats.ts';
import { ARCHETYPES, monsterSheet, NO_TWEAK } from '../hunter/derive.ts';
import type { Archetype, DeriveRules, MonsterKind, Sheet } from '../hunter/derive.ts';
import type { Ability } from '../combat/ability-types.ts';
import { seedId } from '../ids.ts';
import type { MonsterId } from '../ids.ts';
import { isStatusKey } from '../combat/effect-ops.ts';
import { parseAbility } from '../combat/fight-parse.ts';
import { MAX_ABILITIES } from '../combat/fight-types.ts';
import { isStateChip } from '../hunter/chips.ts';
import { ITEM_BOUNDS, parseItem } from './items.ts';
import type { ItemTemplate } from './items.ts';
import { monsterAbility } from './abilities.ts';
import type { MonsterSpec } from './abilities.ts';
import type { BuiltInStatus } from './statuses.ts';
import { oneOf } from '../one-of.ts';
import { isIconKey } from './icons.ts';
import type { IconKey } from './icons.ts';

/**
 * A status a monster starts a fight with. `rounds: null` lasts until removed. Its def is the rules' for its key. `stacks`
 * (2 to `RULES.fight.kit.stackCap`; absent, 1) is the count a stacking one starts at, cut to its def's cap ("Starts with 3 Pain").
 */
export type StartStatus = { key: string; rounds: number | null; stacks?: number };
/** What a monster drops. Kept and read only: the end of a fight does not offer it yet. */
export type Loot = { gold: number; items: ItemTemplate[] };
/** How a monster differs from its rank, archetype and kind: `hp` multiplies its max HP, `stats` adds points to named stats. */
export type MonsterTweak = { hp?: number; stats?: Partial<Record<StatKey, number>> };
/**
 * A monster the GM keeps. Its body is a hunter of its rank's first level built 2:1 by its `archetype`, times its `kind`'s
 * factors, with its `tweak` (src/core/hunter/derive.ts `monsterSheet`). In a fight it attacks with its archetype's attack
 * and its own `abilities`; `notes` are what its text says that no ability does, drawn as text.
 */
export type Monster = {
  id: MonsterId; name: string; rank: Rank; type: string; archetype: Archetype; kind: MonsterKind; tweak: MonsterTweak;
  abilities: Ability[]; notes: string[];
  /** Its XP as the GM typed it; absent, the rule's for its rank and kind (`monsterXp`), so a change of the XP table reaches it. */
  xp?: number;
  /** The picture a GM picked, any key of the registry; absent, the default (icon-defaults.ts `monsterIcon`: its type's, else its archetype's). */
  icon?: IconKey;
  extractable: boolean; desc: string; statuses: StartStatus[]; loot: Loot;
  /** Added by the bestiary on the monster's first defeat. */
  auto?: boolean;
  /** Made by a gate's spawn for a rank the bestiary had no monster of (gates.js); not one of the GM's own (spawn.ts). */
  placeholder?: true;
};
/** A monster as the GM keeps it, before it has an id. */
export type MonsterTemplate = Omit<Monster, 'id'>;
/** A monster made from its rank (no id until it is saved). */
export type StatBlock = MonsterTemplate & { id: string | null };

export const ARCHETYPE_LIST = Object.keys(ARCHETYPES) as Archetype[];
export const MONSTER_KINDS = Object.keys(RULES.fight.kinds) as MonsterKind[];

/**
 * How a seed differs from its rank, archetype and kind: its tweak, a factor on its XP, whether a Necromancer may extract
 * it (yes unless it says no), and the statuses it starts a fight with.
 */
export type SeedTweak = MonsterTweak & { xp?: number; extractable?: boolean; statuses?: readonly StartStatus[] };
/** One row of the bestiary. The slug makes its id (`seed:<slug>`). */
export type MonsterSeed = readonly [
  slug: string, name: string, rank: Rank, type: string, archetype: Archetype, kind: MonsterKind, tweak: SeedTweak,
  abilities: readonly MonsterSpec[], notes: readonly string[], desc: string,
];

// The old seeds restated by docs/agent-handoff/rw/m2-plan.md section 3.2. The archetype is the largest of the old
// Strength (brute), Dexterity (skirmisher) and Intelligence (caster), a tie a brute; the kind is the old boss or elite
// mark. An old initiative of N is Instinct 4N (the opening bonus is a quarter of Instinct's points); the old AC, attack and
// damage are the archetype's and kind's now. A line of text that is an ability is a `MonsterSpec` (abilities.ts says how
// each reads), every other line a note. Two or three attacks a turn are one heavy strike; a summons stays a note.
const status = (s: BuiltInStatus, rounds?: number) => (rounds === undefined ? { status: s } : { status: s, rounds });
const regenerating: readonly StartStatus[] = [{ key: 'regenerating' satisfies BuiltInStatus, rounds: null }];

export const SEEDS: readonly MonsterSeed[] = [
  ['goblin', 'Goblin', 'E', 'Humanoid', 'skirmisher', 'normal', {}, [],
    ['Nimble Escape: bonus-action Disengage', 'Pack Tactics: advantage when an ally is adjacent'],
    'Green-skinned scavengers with rusted knives. They come in large groups in low-rank gates.'],
  ['goblin-shaman', 'Goblin Shaman', 'E', 'Humanoid', 'caster', 'normal', { hp: 0.7 }, [{ kind: 'curse', name: 'Hex Bolt', feet: 30 }],
    ['Rally: allies within 30 ft gain +1 to hit'],
    'A goblin that casts curses.'],
  ['giant-centipede', 'Giant Centipede', 'E', 'Insect', 'skirmisher', 'normal', { hp: 1.2, stats: { ins: 4 } },
    [{ kind: 'curse', name: 'Venom Bite', feet: 5, applies: status('poisoned') }],
    ['Swarm: appears in groups of 6+', 'Lives in the Penalty Zone'],
    'A large centipede. Many of them live in the Penalty Zone.'],
  // Strength and Dexterity tie at 16: a brute.
  ['steel-fanged-lycan', 'Steel-fanged Lycan', 'D', 'Beast', 'brute', 'normal', { stats: { ins: 8 } },
    [{ kind: 'strike', name: 'Pounce', feet: 10, applies: status('prone', 1) }],
    ['Steel Fangs: bites ignore 2 AC of armor', 'Howl: allies gain advantage on their next attack'],
    'A werewolf with steel fangs.'],
  ['hobgoblin', 'Hobgoblin', 'D', 'Humanoid', 'brute', 'normal', { hp: 1.2 }, [{ kind: 'shield', name: 'Shield Wall' }],
    ['Martial Advantage: +2d6 once per round'],
    'Goblin soldiers in iron armor.'],
  ['lizardman', 'Lizardman', 'D', 'Humanoid', 'brute', 'normal', { stats: { ins: 4 } }, [{ kind: 'strike', name: 'Spear Reach', feet: 10 }],
    ['Hold Breath: amphibious'],
    'Spear-wielding reptilian warriors of flooded gates.'],
  ['kasaka', 'Kasaka', 'D', 'Beast', 'brute', 'boss', { hp: 0.9 },
    [{ kind: 'curse', name: 'Blue Venom Fangs', feet: 5, applies: status('poisoned') }, { kind: 'curse', name: 'Serpentine Coil', feet: 5, applies: status('restrained') }],
    ['Venom Fang: drops the Kasaka fang'],
    'A blue-scaled snake. Its venom fangs sell for a lot of gold.'],
  ['stone-golem', 'Stone Golem', 'C', 'Construct', 'brute', 'normal', { hp: 1.5, stats: { ins: -12 } }, [],
    ['Immutable Form: immune to poison and psychic', 'Slam: pushes target 10 ft', 'Slow: speed 20 ft'],
    'Hulking animated rock.'],
  ['ice-elf', 'Ice Elf', 'C', 'Humanoid', 'skirmisher', 'normal', { hp: 0.8, stats: { ins: 8 } },
    [{ kind: 'shot', name: 'Frost Arrow', feet: 120, applies: status('slowed', 1) }, { kind: 'strike', name: 'Flurry', heavy: true }],
    ['Ice Veil: resistance to cold'],
    'Pale archers of the frozen gate.'],
  ['high-orc', 'High Orc', 'C', 'Humanoid', 'brute', 'normal', { hp: 1.2, stats: { ins: -4 } }, [{ kind: 'curse', name: 'War Cry', applies: status('frightened') }],
    ['Rage: +4 damage, resistance to physical when under half HP'],
    'Orc warlords with greataxes.'],
  ['cerberus', 'Cerberus', 'C', 'Beast', 'brute', 'boss', { hp: 1.1, stats: { ins: 8 } },
    [{ kind: 'strike', name: 'Three Heads', heavy: true }, { kind: 'blast', name: 'Hellfire Breath', feet: 30 }],
    ['Hounds of the Gate: calls 1d4 hellhounds at half HP'],
    'Triple-headed guardian of the double dungeon.'],
  ['red-gate-ice-bear', 'Red Gate Ice Bear', 'B', 'Beast', 'brute', 'normal', { hp: 1.3, stats: { ins: -4 } },
    [{ kind: 'strike', name: 'Frost Maul', applies: status('slowed', 1) }, { kind: 'blast', name: 'Blizzard Roar', feet: 20 }],
    ['Thick Hide: resistance to cold'],
    'Huge bears that live in the snow of red gates.'],
  ['demon-knight', 'Demon Knight', 'B', 'Demon', 'brute', 'normal', { stats: { ins: 4 } },
    [{ kind: 'curse', name: 'Dread Presence', applies: status('frightened') }, { kind: 'shield', name: 'Parry' }],
    ['Hellforged Blade: ignores resistance to fire'],
    'A knight in black plate who serves the demon lords.'],
  ['gate-troll', 'Gate Troll', 'B', 'Giant', 'brute', 'normal', { hp: 1.2, stats: { ins: -8 }, statuses: regenerating },
    [{ kind: 'strike', name: 'Rend', heavy: true }, { kind: 'shot', name: 'Boulder Throw', feet: 60, type: 'physical' }],
    ['Regeneration: 10 HP per round unless hit by fire'],
    'Regenerating brutes found deep in B-rank dungeons.'],
  ['vulcan', 'Vulcan', 'B', 'Demon', 'brute', 'boss', { hp: 0.9 },
    [{ kind: 'strike', name: 'Flame Whip', feet: 15, applies: status('burning') }, { kind: 'blast', name: 'Inferno', feet: 30, leaves: { name: 'Burning ground', rounds: 2, status: 'burning' } }],
    ['Cinder Aura: 5 ft, 1d10 fire to adjacent enemies each round'],
    'A demon lord of the volcanic gate who fights with fire.'],
  ['igris', 'Igris the Bloodred', 'A', 'Undead', 'brute', 'boss', { hp: 0.9, stats: { ins: 12 }, xp: 1.2, extractable: true },
    [{ kind: 'strike', name: 'Crimson Slash', heavy: true }],
    ['Knight Order: allies gain +2 to hit while Igris stands', 'Unyielding Loyalty: reaction, survive lethal damage at 1 HP once', 'Extractable: makes a strong shadow'],
    'An undead knight in red armor who guards the Demon Castle.'],
  ['giant', 'Giant', 'A', 'Giant', 'brute', 'normal', { hp: 1.3, stats: { ins: -16 } },
    [{ kind: 'blast', name: 'Earthshaker', feet: 20, type: 'physical', applies: status('prone', 1) }, { kind: 'shot', name: 'Hurl Boulder', feet: 120 }],
    ['Towering: attacks against Large or smaller allies have advantage'],
    'Colossal humanoids that guard A-rank vaults.'],
  ['ant-soldier', 'Ant Soldier', 'A', 'Insect', 'brute', 'normal', { hp: 0.8, stats: { ins: 12 } }, [],
    ['Mandible Shear: crit on 19-20', 'Carapace: resistance to piercing', 'Hive Mind: shares initiative with other ants'],
    'Chitinous soldiers of the ant nest.'],
  ['ant-royal-guard', 'Ant Royal Guard', 'A', 'Insect', 'brute', 'elite', { hp: 1, stats: { ins: 12 } }, [{ kind: 'strike', name: 'Scythe Arms', heavy: true }],
    ['Sacrifice: redirects an attack aimed at the king to itself'],
    'Elite bodyguards of the ant king.'],
  ['beru', 'Beru the Ant King', 'S', 'Insect', 'brute', 'boss', { hp: 0.8, stats: { ins: 8 }, xp: 1.25, statuses: regenerating },
    [{ kind: 'curse', name: 'Venom Mandibles', feet: 5, applies: status('paralyzed') }],
    ['Regeneration: 25 HP per round', 'Flight: 60 ft fly', 'Ant King\'s Command: summons 1d6 Ant Soldiers', 'Extractable: legendary shadow'],
    'The king of the ant nest.'],
  ['kamish', 'Kamish', 'S', 'Dragon', 'brute', 'boss', { hp: 1.5, stats: { ins: 8 }, xp: 1.5 },
    [{ kind: 'blast', name: 'Dragon Breath', feet: 90 }, { kind: 'curse', name: 'Frightful Presence', applies: status('frightened') },
      { kind: 'blast', name: 'Wing Gust', feet: 40, type: 'physical', applies: status('prone', 1) }],
    ['Flight: 120 ft fly', 'Scale Armor: resistance to non-magical damage'],
    'A dragon that burned half a continent.'],
  ['baran', 'Baran', 'S', 'Demon', 'brute', 'boss', { hp: 0.9, xp: 1.2 }, [{ kind: 'curse', name: 'Demon Monarch\'s Presence', applies: status('frightened') }],
    ['Ice Domain: 30 ft cold aura, 3d10 per round', 'Dark Command: calls 1d4 Demon Knights', 'Blink: teleport 30 ft as a bonus action'],
    'Demon king of the frozen castle.'],
];

/** A monster's XP: its rank's XP times its kind's factor (normal 1, elite 1.5, boss 3) and its own, rounded. */
export const xpOf = (R: Pick<Rules, 'rankTable' | 'fight'>, rank: Rank, kind: MonsterKind, factor = 1): number =>
  Math.round(R.rankTable[rank].xp * R.fight.kinds[kind].xp * factor);
/**
 * A monster's XP: the one typed, else the rule's (`xpOf`). Implicit audit 3, B1: the rule's XP was stored as a number when
 * the maker saved, so a change of the XP table reached no saved monster, and "follows the rule" was guessed by equality.
 */
export const monsterXp = (m: { readonly xp?: number; readonly rank: Rank; readonly kind: MonsterKind }, R: Pick<Rules, 'rankTable' | 'fight'>): number =>
  m.xp ?? xpOf(R, m.rank, m.kind);

/** A monster's sheet: its rank, archetype and kind through `derive`, with its tweak. */
export const monsterSheetOf = (m: Pick<Monster, 'rank' | 'archetype' | 'kind' | 'tweak'>, R: DeriveRules): Sheet =>
  monsterSheet(m.rank, m.archetype, m.kind, R, [], { hp: m.tweak.hp ?? NO_TWEAK.hp, stats: m.tweak.stats ?? NO_TWEAK.stats });

/** A new monster of `rank`, a brute and normal unless `o` says otherwise: no abilities of its own, its XP by the rule. */
export function statBlock(R: Rules, rank: Rank, o: { id?: string; name?: string; type?: string; archetype?: Archetype; kind?: MonsterKind } = {}): StatBlock {
  rank = (RANKS as readonly unknown[]).includes(rank) ? rank : 'E';
  const kind = o.kind ?? 'normal';
  return {
    id: o.id || null, name: o.name || (kind === 'boss' ? `${rank}-rank Boss` : kind === 'elite' ? `Elite ${rank}-rank Monster` : `${rank}-rank Monster`),
    rank, type: o.type || '', archetype: o.archetype ?? 'brute', kind, tweak: {}, abilities: [], notes: [], extractable: true,
    desc: '', statuses: [], loot: { gold: 0, items: [] },
  };
}

/** The bestiary's seeds as monsters, their XP and abilities made under `R`. */
export function seedMonsters(R: Rules): Monster[] {
  return SEEDS.map(([slug, name, rank, type, archetype, kind, t, specs, notes, desc]) => ({
    id: seedId<'m'>(slug), name, rank, type, archetype, kind,
    tweak: { ...(t.hp === undefined ? {} : { hp: t.hp }), ...(t.stats === undefined ? {} : { stats: { ...t.stats } }) },
    abilities: specs.map(s => monsterAbility(s, R)), notes: notes.slice(), xp: xpOf(R, rank, kind, t.xp), extractable: t.extractable !== false, desc,
    statuses: (t.statuses ?? []).map(s => ({ ...s })), loot: { gold: 0, items: [] },
  }));
}

// ── the one parser ──
/**
 * The bounds of every monster the GM keeps. A fight row holds 12 abilities, one of them the archetype's attack; a note is
 * as long as an old ability's text. A tweak's HP factor is the fight's (above 0, at most 10).
 */
export const MONSTER_BOUNDS = {
  name: 60, type: 40, desc: 500, abilities: MAX_ABILITIES - 1, notes: 20, note: 500, stat: 999, hp: 10, xp: 1e9, statuses: 8, rounds: 999, gold: 1e9, lootItems: 20,
  /** Copies of one monster that join a fight in one add, or stand on one line of a gate's roster: a letter each, A to Z (rows.ts). */
  copies: 26,
} as const;
/** A count of copies a GM typed, as a whole number from 1 to `MONSTER_BOUNDS.copies` (1 for anything that is not a number). */
export const copiesOf = (v: unknown): number => whole(typeof v === 'string' && v.trim() !== '' ? Number(v) : v, 1, MONSTER_BOUNDS.copies, 1);
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : d);
const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function tweakOf(v: unknown): MonsterTweak {
  const t = isObj(v) ? v : {};
  const hp = typeof t.hp === 'number' && Number.isFinite(t.hp) && t.hp > 0 ? Math.min(MONSTER_BOUNDS.hp, t.hp) : null;
  const raw = isObj(t.stats) ? t.stats : {}, stats: Partial<Record<StatKey, number>> = {};
  for (const k of STAT_KEYS) { const n = whole(Object.hasOwn(raw, k) ? raw[k] : 0, -MONSTER_BOUNDS.stat, MONSTER_BOUNDS.stat, 0); if (n) stats[k] = n; }
  return { ...(hp === null ? {} : { hp }), ...(Object.keys(stats).length ? { stats } : {}) };
}

/**
 * A monster read from outside data, without its id, or null when it is not an object. Each field of the wrong type or
 * value takes the default a new monster has (a blank name is "Monster", a brute, normal); a number is cut to a whole one
 * inside `MONSTER_BOUNDS`. The tweak keeps an HP factor above 0 (at most 10) and stat points from -999 to 999 that are
 * not 0. Each ability is read by the fight's ability reader with the shipped rules' limits, one it refuses dropped (at
 * most 11). Notes are the non-blank lines of text, at most 20 of 500. A starting status is a status key (not a hunter's
 * state chip, each key once) with whole rounds 1 to 999 or null and a count of 1 to `kit.stackCap` (kept when above 1),
 * at most 8. Loot is gold and items read by `parseItem`
 * (at most 20). `icon` is kept only when it is a key of the icon registry (an unknown one is dropped, the default shows). `auto` (added on its first defeat) and `placeholder` (made by a gate's spawn) are kept only when true.
 * Every other key is dropped.
 */
export function parseMonster(v: unknown): MonsterTemplate | null {
  if (!isObj(v)) return null;
  const B = MONSTER_BOUNDS;
  const loot = isObj(v.loot) ? v.loot : {};
  const out: MonsterTemplate = {
    name: text(v.name, B.name) || 'Monster', rank: oneOf(v.rank, RANKS, 'E'), type: text(v.type, B.type),
    archetype: oneOf(v.archetype, ARCHETYPE_LIST, 'brute'), kind: oneOf(v.kind, MONSTER_KINDS, 'normal'), tweak: tweakOf(v.tweak),
    abilities: (Array.isArray(v.abilities) ? v.abilities : []).flatMap(a => parseAbility(a, RULES) ?? []).slice(0, B.abilities),
    notes: (Array.isArray(v.notes) ? v.notes : []).map(a => text(a, B.note)).filter(Boolean).slice(0, B.notes),
    // an XP that is not a number is the rule's (absent, `monsterXp`), a typed one kept inside its bound
    ...(typeof v.xp === 'number' && Number.isFinite(v.xp) ? { xp: whole(v.xp, 0, B.xp, 0) } : {}),
    extractable: v.extractable !== false, desc: typeof v.desc === 'string' ? v.desc.slice(0, B.desc) : '',
    statuses: startStatuses(v.statuses),
    loot: { gold: whole(loot.gold, 0, B.gold, 0), items: (Array.isArray(loot.items) ? loot.items : []).flatMap(i => parseItem(i) ?? []).slice(0, B.lootItems) },
  };
  if (isIconKey(v.icon)) out.icon = v.icon;
  if (v.auto === true) out.auto = true;
  if (v.placeholder === true) out.placeholder = true;
  return out;
}
function startStatuses(v: unknown): StartStatus[] {
  const out: StartStatus[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= MONSTER_BOUNDS.statuses) break;
    if (!isObj(raw) || !isStatusKey(raw.key) || isStateChip(raw.key) || out.some(s => s.key === raw.key)) continue;
    const stacks = whole(raw.stacks, 1, RULES.fight.kit.stackCap, 1);
    out.push({ key: raw.key, rounds: raw.rounds === null ? null : whole(raw.rounds, 1, MONSTER_BOUNDS.rounds, 1), ...(stacks > 1 ? { stacks } : {}) });
  }
  return out;
}

/**
 * What the defeated monsters of a fight dropped, together: their gold summed, and their items, the same item (every field
 * but its count) stacked, at most `ITEM_BOUNDS.qty` a stack. Nothing is given here: the GM picks who gets it.
 */
export function lootOf(drops: readonly Loot[]): Loot {
  const items: Loot['items'] = [];
  const same = (a: Loot['items'][number], b: Loot['items'][number]): boolean => JSON.stringify({ ...a, qty: 0 }) === JSON.stringify({ ...b, qty: 0 });
  for (const it of drops.flatMap(d => d.items)) {
    const have = items.find(x => same(x, it));
    if (have) have.qty = Math.min(ITEM_BOUNDS.qty, have.qty + it.qty); else items.push({ ...it });
  }
  return { gold: drops.reduce((n, d) => Math.min(MONSTER_BOUNDS.gold, n + d.gold), 0), items };
}
