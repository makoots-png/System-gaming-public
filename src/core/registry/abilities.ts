// abilities.ts: the built-in abilities: each monster archetype's default attack, a hunter's weapon attack, and the fight
// ability of each built-in and starter skill, and the abilities of the bestiary's seeds (src/core/registry/monsters.ts)
// (docs/agent-handoff/rw/m2-plan.md sections 3.2, 3.3 and 3.5). Every one is
// made by `abilityOf` from its kind, so a GM's override of a kind's numbers reaches it. A skill keeps its own dice in its
// kind's recommended formula and its old cooldown, read as rounds; its fatigue and mana are the kind's. To add one: an
// entry in SKILL_ABILITIES, then `bun run test` (tests/abilities.test.ts checks every entry against the single-hit bound
// of design.md section 6).

import { parseFormula, printFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { percent, tiles } from '../combat/space.ts';
import { paceCost, tick } from '../combat/timeline.ts';
import type { Pace } from '../combat/timeline.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityEffect, AbilityId, AbilityKind, DamageType } from '../combat/ability-types.ts';
import { isUseOp, statusKey } from '../combat/effect-ops.ts';
import { atTier } from '../combat/op-amount.ts';
import type { Op, StatusDef, UseOp } from '../combat/effect-ops.ts';
import { itemSource } from '../effects.ts';
import type { Archetype } from '../hunter/derive.ts';
import type { ItemId } from '../ids.ts';
import type { BuiltInStatus } from './statuses.ts';
import { abilityOf, defaultTicks, kindDefaults, KINDS, recommended } from './ability-kinds.ts';
import type { AbilityInput, KindRules } from './ability-kinds.ts';

/** What Mending Aura's field heals a round, by the user's rank: Regenerating's numbers (statuses.ts). */
const N = (value: number): Formula => ({ kind: 'number', value });
const MENDING: Op = { op: 'heal', when: 'turn', amount: [N(2), N(4), N(6), N(10), N(15), N(25)] };

/** The statuses a built-in skill puts on its user. */
type SelfStatus = 'hasted' | 'stealth';
/**
 * The rule numbers a skill's ability reads: the kinds' numbers, and the defs of the statuses it applies. `conditions` is
 * the rules' built-in statuses with the GM's laid over them, so an edited Hasted reaches Sprint.
 */
export type SkillRules = KindRules & { readonly conditions: { readonly [K in SelfStatus]: StatusDef } };

/** The id of a body's default attack, a hunter's weapon or a monster's archetype attack. A skill's ability has its own. */
export const ATTACK_ID = abilityId('attack');

/** What `weaponAttack` reads of an item. A bow shoots and anything else strikes (plan 3.3). */
export type Weapon = { readonly name: string; readonly dice: string; readonly attack: 'strike' | 'shot' };

/** How one built-in differs from its kind. A field left out is the kind's. */
type Differs = {
  /** In place of the kind's dice in its recommended formula. */
  readonly dice?: string;
  readonly type?: DamageType;
  /** The formula takes this pace's share of the damage budget in place of the kind's (design 3.3). */
  readonly pace?: Pace;
  /** In rounds: a skill's old cooldown of N turns is N rounds (plan 3.5). */
  readonly cooldown?: number;
  /** A touch's reach, in feet as the old text gives it. */
  readonly feet?: number;
};
/** Fields an ability sets past its kind's, as `abilityOf` takes them. */
type Fields = Pick<AbilityInput, 'aim' | 'shape' | 'range' | 'effect' | 'ops' | 'zone'>;

/** `f` with each dice term replaced by `dice`. */
function withDice(f: Formula, dice: Formula): Formula {
  switch (f.kind) {
    case 'dice': return dice;
    case 'number': case 'stat': case 'sheet': case 'charge': case 'stacks': case 'field': case 'missing': case 'held': case 'count': return f;
    case 'negate': return { kind: 'negate', arg: withDice(f.arg, dice) };
    case 'fn': return { ...f, arg: withDice(f.arg, dice) };
    case 'binary': case 'min': case 'max': return { ...f, left: withDice(f.left, dice), right: withDice(f.right, dice) };
    default: return f satisfies never;
  }
}

/**
 * A built-in of `kind`: the kind's ability with the differences given. The formula is the kind's recommended one with
 * these dice (a text the rules' dice limits refuse keeps the kind's dice), times the pace's share over the kind's. It is
 * marked edited only when it is not the kind's own formula.
 */
function built(kind: AbilityKind, id: string, name: string, d: Differs, R: KindRules, set: Fields = {}): Ability {
  const k = kindDefaults(kind, R), pace = d.pace ?? KINDS[kind].pace;
  const ticks = defaultTicks(kind, d.type);
  const own = recommended(kind, ticks, R).formula;
  const parsed = d.dice === undefined ? null : parseFormula(d.dice, R);
  const dice = parsed?.ok ? withDice(own, parsed.formula) : own;
  const share = R.fight.cost[pace] / R.fight.cost[KINDS[kind].pace];
  const formula: Formula = share === 1 ? dice : { kind: 'binary', op: '*', left: { kind: 'number', value: share }, right: dice };
  const reach = d.feet === undefined ? null : tiles(Math.floor(d.feet / R.fight.tileFeet));
  return abilityOf(kind, {
    id: abilityId(id), name, ticks,
    cost: { fatigue: k.fatigue, mana: k.mana, time: paceCost(pace, R.fight), cooldown: d.cooldown === undefined ? k.cooldown : tick(d.cooldown * R.fight.round) },
    ...(printFormula(formula) === printFormula(own) ? {} : { effect: { type: ticks.type, by: 'hand', formula } satisfies AbilityEffect }),
    ...(reach === null ? {} : { range: reach, shape: { kind: 'touch', reach } }),
    ...set,
  }, R);
}

/** A support on its user alone that puts `status` on it for `rounds` (null: until removed) and deals or shields nothing. */
function onSelf(id: string, name: string, status: SelfStatus, rounds: number | null, d: Differs, R: SkillRules): Ability {
  const op: UseOp = { op: 'applyStatus', key: statusKey(status), def: R.conditions[status], duration: rounds === null ? null : tick(rounds * R.fight.round) };
  return built('support', id, name, d, R, { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, ops: [op] });
}

/** Each monster archetype's default attack (plan 3.2): a brute strikes, a skirmisher shoots, a caster curses. */
export const ARCHETYPE_ATTACKS: { readonly [A in Archetype]: (R: KindRules) => Ability } = {
  brute: R => built('strike', ATTACK_ID, 'Strike', {}, R),
  skirmisher: R => built('shot', ATTACK_ID, 'Shot', {}, R),
  caster: R => built('curse', ATTACK_ID, 'Curse', {}, R),
};

/**
 * A hunter's default attack with this weapon: its kind's recommended formula with the weapon's dice, `<dice> + phys` for
 * a strike and the quick share of it for a shot (plan 3.3). With no weapon, or dice the rules refuse, it is the strike
 * kind's own, `1d8 + phys`, the default attack of the design's builds.
 */
export function weaponAttack(item: Weapon | null, R: KindRules): Ability {
  return item === null ? built('strike', ATTACK_ID, 'Strike', {}, R) : built(item.attack, ATTACK_ID, item.name, { dice: item.dice }, R);
}

/**
 * The fight ability of each active built-in skill (src/core/registry/skills.ts) and starter skill (src/views/starter.js),
 * by the skill's name (plan 3.5). Arise is the extraction on the Shadows panel and Shadow Exchange needs the map, so in M2
 * they have no ability.
 */
const SKILLS = {
  'Dagger Rush': R => built('strike', 'dagger-rush', 'Dagger Rush', { dice: '2d4', pace: 'quick', cooldown: 2 }, R),
  Mutilation: R => built('strike', 'mutilation', 'Mutilation', { dice: '2d6', cooldown: 3 }, R),
  Sprint: R => onSelf('sprint', 'Sprint', 'hasted', 1, { pace: 'quick', cooldown: 3 }, R),
  Stealth: R => onSelf('stealth', 'Stealth', 'stealth', null, { cooldown: 4 }, R),
  // "Telekinetic force ... within 30 ft": a physical curse.
  "Ruler's Authority": R => built('curse', 'rulers-authority', "Ruler's Authority", { type: 'physical', feet: 30, cooldown: 5 }, R),
  'Shadow Exchange': () => null,
  Arise: () => null,
  'Shield Wall': R => built('support', 'shield-wall', 'Shield Wall', { cooldown: 3 }, R),
  'Marked Shot': R => built('shot', 'marked-shot', 'Marked Shot', { dice: '1d6', cooldown: 2 }, R),
  'Arc Bolt': R => built('curse', 'arc-bolt', 'Arc Bolt', { dice: '2d6' }, R),
  // An aura around its user (design 4.8): Regenerating's heal a round, at the user's rank, for 3 rounds, to the user and
  // every ally within the rules' aura radius; it moves with the user and ends when the user goes down.
  'Mending Aura': R => built('support', 'mending-aura', 'Mending Aura', { cooldown: 4 }, R, {
    aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null,
    zone: { name: 'Mending aura', duration: tick(3 * R.fight.round), ops: [MENDING], endsWithOwner: true, around: tiles(R.fight.auraRadius), grow: null },
  }),
} satisfies Record<string, (R: SkillRules) => Ability | null>;
export type BuiltInSkill = keyof typeof SKILLS;
export const SKILL_ABILITIES: { readonly [S in BuiltInSkill]: (R: SkillRules) => Ability | null } = SKILLS;

// ── the bestiary's abilities ──

/** The rule numbers a seed's ability reads: the kinds' numbers and the built-in statuses it may apply. */
export type MonsterRules = KindRules & { readonly conditions: { readonly [K in BuiltInStatus]: StatusDef } };

/**
 * One ability of a seed, read from its old text by plan section 3.2. A distance is in feet as the text gives it: a shot's
 * or a curse's range and reach, a strike's reach, a blast's radius (a tenth of its feet, at least 1 tile). A status it
 * applies lasts `rounds` (the old text's rounds, else 3, what the old ability reader gave a status with none). A shield
 * on its user stands for "+N AC". The dice are always the kind's: a monster's power comes from its rank, archetype and
 * kind, so the old damage dice of its text are not kept. A blast may leave a field (`leaves`): a zone of its shape that
 * holds a built-in status's ops for its rounds.
 */
export type MonsterSpec =
  | { readonly kind: 'strike'; readonly name: string; readonly heavy?: true; readonly feet?: number; readonly applies?: Applies }
  | { readonly kind: 'shot' | 'curse'; readonly name: string; readonly feet?: number; readonly type?: DamageType; readonly applies?: Applies }
  | { readonly kind: 'blast'; readonly name: string; readonly feet: number; readonly type?: DamageType; readonly applies?: Applies; readonly leaves?: Leaves }
  | { readonly kind: 'shield'; readonly name: string };
type Applies = { readonly status: BuiltInStatus; readonly rounds?: number };
/** A field a blast leaves where it lands (zones.ts): its name, its rounds, and the built-in status whose ops it holds. */
type Leaves = { readonly name: string; readonly rounds: number; readonly status: BuiltInStatus };
/** A status with no rounds in its text lasts this many (what the old text reader of a monster's abilities gave it). */
const DEFAULT_ROUNDS = 3;

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A seed's ability under these rules, its id the slug of its name. */
export function monsterAbility(spec: MonsterSpec, R: MonsterRules): Ability {
  const id = slug(spec.name);
  if (spec.kind === 'shield') return built('support', id, spec.name, {}, R, { aim: 'self', shape: { kind: 'self' }, range: tiles(0) });
  const ops: UseOp[] = spec.applies
    ? [{ op: 'applyStatus', key: statusKey(spec.applies.status), def: R.conditions[spec.applies.status], duration: tick((spec.applies.rounds ?? DEFAULT_ROUNDS) * R.fight.round) }]
    : [];
  const type = 'type' in spec && spec.type ? { type: spec.type } : {};
  switch (spec.kind) {
    case 'strike': return built('strike', id, spec.name, { ...(spec.heavy ? { pace: 'heavy' } : {}), ...(spec.feet === undefined ? {} : { feet: spec.feet }) }, R, { ops });
    case 'curse': return built('curse', id, spec.name, { ...type, ...(spec.feet === undefined ? {} : { feet: spec.feet }) }, R, { ops });
    case 'shot': return built('shot', id, spec.name, type, R, { ops, ...(spec.feet === undefined ? {} : { range: tiles(Math.floor(spec.feet / R.fight.tileFeet)) }) });
    case 'blast': {
      const n = R.fight.abilityKinds.blast, radius = Math.max(1, Math.floor(spec.feet / 10));
      const zone = spec.leaves && { name: spec.leaves.name, duration: tick(spec.leaves.rounds * R.fight.round), ops: R.conditions[spec.leaves.status].ops, endsWithOwner: false, around: null, grow: null };
      return built('blast', id, spec.name, type, R, {
        ops, shape: { kind: 'radius', radius: tiles(radius), ring: { outer: tiles(radius + n.ring - n.radius), share: percent(R.fight.ringShare * 100) } }, ...(zone ? { zone } : {}),
      });
    }
    default: return spec satisfies never;
  }
}

// ── a consumable used in a fight, and a held thing's active ──

/** What `itemAbility` reads of an item: a consumable, used on its user or (`target: 'other'`) on another. */
export type ThrownItem = { readonly id: ItemId; readonly name: string; readonly rar: string; readonly target?: 'self' | 'other'; readonly effects?: readonly Op[] };
/** The id of the ability of the item with id `itemId`: the room's `cast` names an ability in at most 40 characters. */
export const itemAbilityId = (itemId: string): AbilityId => abilityId(`item-${itemId}`.slice(0, 40));
/**
 * The id a held thing's active has on its holder's row (registry/powers.ts, rows.ts `hunterAbilities`): `worn-` and its
 * own id, cut to the 40 characters the room's `cast` names. Not a skill's own id, so a skill of the same id keeps both;
 * two worn things of one active give one (League's "Unique").
 */
export const wornAbilityId = (id: AbilityId): AbilityId => abilityId(`worn-${id}`.slice(0, 40));
/** The bag item an ability is the use of, else null (`Ability.item`). */
export const itemOfAbility = (a: Pick<Ability, 'item'>): ItemId | null => a.item ?? null;

/**
 * A consumable as the ability its user takes into a fight (m2-plan 4.4, W6). In a fight the row holds its user's HP,
 * mana and fatigue, so a potion drunk there is a use of this ability like any other, never a write to the sheet beside
 * the fight. An item does what it says, so nothing avoids it (`sure`), it costs no fatigue or mana, and it is ready again
 * at once (the bag holds the count). One for its user is a support on itself; one for another has its first damage op as
 * its effect (a curse's reach on a foe), else its first heal op (a support's reach on an ally). Each amount is at the
 * item's rarity tier, and its other ops (statuses, cures, notes) land on the target. Mana and fatigue ops are the
 * user's own, so only an item for its user carries them. Null when nothing is left to do.
 */
export function itemAbility(item: ThrownItem, R: KindRules): Ability | null {
  const tier = itemSource(item).tier, effects = item.effects ?? [], self = item.target !== 'other';
  const damage = self ? undefined : effects.find(o => o.op === 'damage'), heal = effects.find(o => o.op === 'heal');
  const effect: AbilityEffect | null = damage?.op === 'damage' ? { type: damage.type, by: 'hand', formula: atTier(damage.amount, tier) }
    : heal?.op === 'heal' ? { type: 'heal', by: 'hand', formula: atTier(heal.amount, tier) } : null;
  const ops = effects.filter(isUseOp).flatMap((o): UseOp[] => o.op !== 'mana' && o.op !== 'fatigue' ? [o] : self ? [{ op: o.op, amount: atTier(o.amount, tier) }] : []);
  if (effect === null && ops.length === 0) return null;
  const kind = self || effect?.type === 'heal' ? 'support' : 'curse';
  const base = abilityOf(kind, { id: itemAbilityId(item.id), name: item.name, effect, ops, delivery: { kind: 'sure' }, ...(self ? { aim: 'self', shape: { kind: 'self' }, range: tiles(0) } : {}) }, R);
  return { ...base, item: item.id, cost: { ...base.cost, fatigue: 0, mana: 0, cooldown: tick(0) } };
}
