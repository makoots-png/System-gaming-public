// ability-types.ts: an ability of the reworked fight and what one use of it does to each target (docs/agent-handoff/rw/
// design.md section 3.3). Types only. A kind's defaults are src/core/registry/ability-kinds.ts; a use is worked out by
// src/core/combat/resolve.ts.

import type { Formula } from '../formula.ts';
import type { StatKey } from '../stats.ts';
import type { Scaler } from '../registry/scalers.ts';
import type { Place, Shape, Tiles } from './space.ts';
import type { Cost, Tick } from './timeline.ts';
import type { StatusKey, UseOp } from './effect-ops.ts';
import type { ZoneSpec } from './zones.ts';
import type { Archetype } from '../hunter/derive.ts';
import type { CombatantId, HunterId, Id, ItemId } from '../ids.ts';
export type { CombatantId, HunterId };

import type { DamageType } from './damage-type.ts';
export type { DamageType };

export type AbilityId = Id<'AbilityId'>;
export const abilityId = (s: string): AbilityId => s as AbilityId;
export const combatantId = (s: string): CombatantId => s as CombatantId;
export const hunterId = (s: string): HunterId => s as HunterId;

/** How an ability reaches its target, which decides how the target avoids it (design 3.1 rules 7 and 8). */
export type Delivery =
  /** `speed` in tiles a round. */
  | { readonly kind: 'travel'; readonly windup: Tick; readonly speed: number | 'instant' }
  /** No travel: the target's Will resists it. */
  | { readonly kind: 'direct' }
  /** Nothing avoids it. */
  | { readonly kind: 'sure' };

export type AbilityKind = 'strike' | 'shot' | 'blast' | 'curse' | 'support';

/** What a use costs: fatigue and mana before the cost cut, the time it takes and the ticks until it is ready again. */
export type AbilityCost = { readonly fatigue: number; readonly mana: number; readonly time: Cost; readonly cooldown: Tick };

/** What an effect does to its target: damage of a type, a heal or a shield. */
export type AbilityEffectType = DamageType | 'heal' | 'shield';
/** A bonus per point the user's stat is over the target's, at most `cap` (the owner: "+10% per point of Power over their Discipline, up to +100%"). */
export type Gap = { readonly mine: StatKey; readonly theirs: StatKey; readonly per: number; readonly cap: number };
/**
 * What the GM ticked for a formula by the rule (the maker's "Build the formula"): the stat it grows with (null: its dice
 * alone; the type's own stat reads the type's power), a stat gap, and the conditional scalers of kits design 8.0 (at
 * most `RULES.fight.kit.scalers`). The pace and the channel the recommendation also reads are the ability's own
 * (`cost.time`, `channel`), so they are not kept here a second time.
 */
export type RuleTicks = { readonly scale: StatKey | null; readonly gap: Gap | null; readonly scalers: readonly Scaler[] };
/**
 * What a use lands on each target (`type`) and how its formula is made: `rule`, the kind's recommended formula of
 * `ticks`, worked out with the rules where it is read (ability-kinds.ts `formulaOf`), so a rule the GM changes reaches
 * every such ability; `hand`, a formula the GM typed (or a built-in's own dice), kept as it is (implicit audit 3, M2).
 */
export type AbilityEffect =
  | { readonly type: AbilityEffectType; readonly by: 'rule'; readonly ticks: RuleTicks }
  | { readonly type: AbilityEffectType; readonly by: 'hand'; readonly formula: Formula };

export type Ability = {
  readonly id: AbilityId;
  readonly name: string;
  readonly kind: AbilityKind;
  readonly cost: AbilityCost;
  readonly aim: 'foe' | 'ally' | 'self' | 'place';
  readonly range: Tiles;
  readonly shape: Shape;
  readonly delivery: Delivery;
  readonly foesOnly: boolean;
  readonly effect: AbilityEffect | null;
  /** Applied to each target it lands on in full, as today's `effects`. */
  readonly ops: readonly UseOp[];
  readonly channel: { readonly growth: 'linear' | 'exponential'; readonly max: number } | null;
  /** A lasting field it leaves on its shape's tiles where it lands (zones.ts); absent when it leaves none. */
  readonly zone?: ZoneSpec;
  /** The GM's words for it that a trigger may name (at most `RULES.fight.kit.tags`); absent when it has none. */
  readonly tags?: readonly Tag[];
  /** What it costs besides fatigue and mana (at most `prices`, kits design 1.4); absent when nothing more. */
  readonly prices?: readonly Price[];
  /** What must hold for it to be used (at most `gates`, kits design 1.4); absent when nothing. */
  readonly gates?: readonly AbilityGate[];
  /** A body it calls to its user's side for a few rounds (kits design 1.9); absent when it calls none. */
  readonly summon?: Summon;
  /** How it moves its user (kits design 8.3): a blink to a tile it aims at, or a swap with the body it aims at; absent, none. */
  readonly move?: AbilityMove;
  /** It is a reaction (kits design 8.4): armed ahead, it fires by rule at its moment; absent, it is used on a turn. */
  readonly react?: React;
  /** What it does to one of its user's zones (kits design 8.5): moves it toward the aim, or widens it; absent, nothing. */
  readonly zoneAct?: ZoneAct;
  /**
   * The bag item it is the use of (registry/abilities.ts `itemAbility`): a fight spends one of it at each use. Only a
   * fight row's abilities hold it; a skill's or a monster's never does (`parseAbility`). Absent for every other ability.
   */
  readonly item?: ItemId;
  /**
   * Highest user tier (0 E to 5 S) that may use this item ability (`charge.ts` `tooLow`): set by `itemAbility` for
   * self-used rank-capped consumables, stripped by `parseAbility` on skills and monsters. Absent when uncapped.
   */
  readonly maxTier?: number;
};
/** A blink to a free tile the user sees within the ability's range (at most `kit.blinkMax`), or a swap of places with the body aimed at (restricted to shadows when `only: 'shadow'`). */
export type AbilityMove = { readonly kind: 'blink' } | { readonly kind: 'swap'; readonly only?: 'shadow' };
/**
 * When an armed reaction fires (kits design 8.4): a foe's use is about to land on the reactor or an ally within `reach`
 * (`before`, rule 7c), a hit is about to take one of them to 0 (`lethal`, rule 13b), a foe's use landed on one of them
 * (`after`, rule 19c), or the named body's turn is about to start (`turn`).
 */
export type ReactWhen = 'before' | 'lethal' | 'after' | 'turn';
export const REACT_WHEN: readonly ReactWhen[] = ['before', 'lethal', 'after', 'turn'];
export type React = { readonly when: ReactWhen; readonly reach: Tiles };
/** A zone act (kits design 8.5): `shift` moves the zone named (null: any of the user's) by up to `by` tiles toward the aim, `grow` widens an around zone by `by`. */
export type ZoneAct = { readonly act: 'shift' | 'grow'; readonly name: string | null; readonly by: number };

/** A GM's word on an ability, which a trigger may name: lower-case letters, digits and hyphens, "sword", "ultimate". */
export type Tag = Id<'Tag'>;
export const tag = (s: string): Tag => s as Tag;
/**
 * An extra cost of a use (kits design 1.4): HP (a flat number, or a share of max HP; refused at the HP it would take, so
 * never the killing blow), stacks of a status (`n` or all, from the user or from each target, whose count is the
 * formula's `spent`), or the user's zones of a name (one, or all of them).
 */
export type Price =
  | { readonly kind: 'hp'; readonly amount: { readonly kind: 'flat'; readonly n: number } | { readonly kind: 'share'; readonly share: number } }
  | { readonly kind: 'stacks'; readonly key: StatusKey; readonly from: 'self' | 'target'; readonly take: { readonly kind: 'n'; readonly n: number } | { readonly kind: 'all' } }
  | { readonly kind: 'zone'; readonly name: string | null; readonly take: 'one' | 'all' };
/**
 * What must hold for a use (kits design 1.4, rule 3b): a status on the user or the aimed target with at least `atLeast`
 * stacks (1 for a plain status: a mode), or uses left of `n` a fight or `n` a gate (back at the gate's Clear).
 */
export type AbilityGate =
  | { readonly kind: 'holds'; readonly key: StatusKey; readonly on: 'self' | 'target'; readonly atLeast: number }
  | { readonly kind: 'uses'; readonly per: 'fight' | 'gate'; readonly n: number }
  /** The user stands in a zone of this name (kits design 8.8): "only inside your Aura". */
  | { readonly kind: 'inside'; readonly zone: string };
/**
 * A timed summon (kits design 1.9): a row of the archetype's body at the user's rank on the user's side for 1 to
 * `summonRounds` rounds, with its starting statuses.
 */
export type Summon = {
  readonly name: string;
  readonly archetype: Archetype;
  readonly rounds: number;
  readonly statuses: readonly { readonly key: StatusKey; readonly rounds: number }[];
};

/** Where a target ended against a use: in its shape, in its ring, out of it, or, with no travel, resisted by Will. */
export type Avoid = 'caught' | 'ring' | 'out' | 'resisted';

/** What one use did to one target (design 3.3). `to` is where a target that dodged moved, else null. */
export type Outcome = {
  readonly target: CombatantId;
  readonly avoid: Avoid;
  readonly to: Place | null;
  readonly crit: boolean;
  /** The formula's value after the multipliers of rule 11, before defence. */
  readonly raw: number;
  /** After defence: damage before the shield, or what was healed or shielded. */
  readonly dealt: number;
  readonly absorbed: number;
  /** Null for an ability with no damage, heal or shield, such as a taunt alone. */
  readonly type: DamageType | 'heal' | 'shield' | null;
  readonly statuses: readonly StatusKey[];
  readonly threat: number;
  readonly stagger: number;
  /** The bar filled and the target lost its next turn to it (design 4.3). */
  readonly staggered: boolean;
  readonly channelBroken: boolean;
  readonly down: boolean;
};
