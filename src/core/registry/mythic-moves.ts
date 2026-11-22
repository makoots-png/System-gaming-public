// mythic-moves.ts: an omen's move as the ability a mythic lands (notes-11-keystones.md, design B.3, "Why `hits` and not a
// formula"), sized on the sample hunter's max HP. Apart from registry/mythics.ts because it reads the items, the
// ability kinds and the status ops: the scripts' data stays a leaf that combat/row-life.ts and fight-parse.ts read.
import type { Rank } from '../rules.ts';
import { average } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { kitGear, monsterSheet, monsterStats, pointsAt, sheetOf, split } from '../hunter/derive.ts';
import type { Archetype, DeriveRules, MonsterKind, Tweak } from '../hunter/derive.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityEffect } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { UseOp } from '../combat/effect-ops.ts';
import { GRID_SIDE, percent, tiles } from '../combat/space.ts';
import type { Shape } from '../combat/space.ts';
import { paceCost, tick } from '../combat/timeline.ts';
import type { MoveKey, MythicMove } from '../combat/mythic-types.ts';
import { abilityOf, defaultTicks, kindDefaults, recommended } from './ability-kinds.ts';
import type { MonsterRules } from './abilities.ts';
import { SAMPLE_WEARER } from './items.ts';

/**
 * The max HP of the sample hunter (the item maker's `SAMPLE_WEARER` build, in its kit) at the first level of `rank`:
 * what a move's `hits` is a share of, at rank S.
 */
export function sampleHp(rank: Rank, R: DeriveRules): number {
  const level = R.rankLevels[rank], stats = split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, R), R);
  return sheetOf({ stats, level, gear: kitGear(SAMPLE_WEARER.kit, R), perks: {} }, R).hpMax;
}

/** The body a move is sized on: the mythic that lands it, as its rank, archetype, kind and tweak make it. */
export type MythicBody = { readonly rank: Rank; readonly archetype: Archetype; readonly kind: MonsterKind; readonly tweak: Tweak };
/** The rules a move reads: its kind's numbers, the built-in statuses it applies, and the mythic's sheet. */
export type MythicRules = MonsterRules & DeriveRules;
/**
 * The reach of a `field` move: the farthest apart two tiles of the largest map are (space.ts `dist` on a side of
 * `GRID_SIDE`'s most), so it covers every tile from wherever the mythic stands.
 */
const FIELD_REACH = tiles(GRID_SIDE[1] + Math.floor(GRID_SIDE[1] / 2));
/** Three significant figures: a move's factor as a GM reads it in its formula, within half a percent of the rule's. */
const FIGURES = 3;

/**
 * The move under key `key` as the ability `body` lands it (design B.3, "Why `hits` and not a formula"): its kind's
 * recommended formula for its damage type, times `hits × sampleHp(S) / kindHit`, where `kindHit` is that formula's mean
 * on `body`; so at mean dice it deals `hits` of the sample S hunter's max HP before armor and resist. Its id is
 * `mythic-<key>`. Its time is `mythic.turnPace` (the landing takes the mythic's turn); it costs no fatigue or mana and
 * has no cooldown, since the omen already said when it comes. It never lands on its own side. A `sure` move cannot be
 * avoided; any other is dodged or resisted as its kind is. Its `self` status is the landing's, not the ability's (MY4).
 */
export function mythicMove(key: MoveKey, move: MythicMove, body: MythicBody, R: MythicRules): Ability {
  const k = kindDefaults(move.kind, R), own = recommended(move.kind, defaultTicks(move.kind, move.type), R).formula;
  const self = { stats: monsterStats(body.rank, body.archetype, R, body.tweak), sheet: monsterSheet(body.rank, body.archetype, body.kind, R, [], body.tweak) };
  const kindHit = average(own, { user: self, target: self, charge: 0 });
  const factor = Number((move.hits * sampleHp('S', R) / kindHit).toPrecision(FIGURES));
  const formula: Formula = { kind: 'binary', op: '*', left: { kind: 'number', value: factor }, right: own };
  const effect: AbilityEffect | null = move.hits > 0 ? { type: move.type, by: 'hand', formula } : null;
  const ops: UseOp[] = move.applies
    ? [{ op: 'applyStatus', key: statusKey(move.applies.status), def: R.conditions[move.applies.status], duration: tick(move.applies.rounds * R.fight.round) }]
    : [];
  const n = R.fight.abilityKinds.blast;
  const shape: Shape = move.kind === 'shot' ? k.shape
    : move.kind !== 'blast' ? { kind: 'touch', reach: tiles(move.range) }
    : move.reach === 'field' ? { kind: 'radius', radius: FIELD_REACH, ring: null }
    : { kind: 'radius', radius: tiles(move.reach), ring: { outer: tiles(move.reach + n.ring - n.radius), share: percent(R.fight.ringShare * 100) } };
  const zone = move.leaves && { name: move.leaves.name, duration: tick(move.leaves.rounds * R.fight.round), ops: R.conditions[move.leaves.status].ops, endsWithOwner: false, around: null, grow: null };
  return abilityOf(move.kind, {
    id: abilityId(`mythic-${key}`), name: move.name, effect, ops, shape, range: tiles(move.range),
    delivery: move.sure ? { kind: 'sure' } : k.delivery, foesOnly: true,
    cost: { fatigue: 0, mana: 0, time: paceCost(R.fight.mythic.turnPace, R.fight), cooldown: tick(0) },
    ...(zone ? { zone } : {}),
  }, R);
}
