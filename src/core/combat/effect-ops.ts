// effect-ops.ts: what a status does in a fight, and the combatant as a use of an ability reads and changes it
// (docs/agent-handoff/rw/design.md sections 1.3, 3.1 rule 18, 3.3 and 4). A status is a key, its def (a label and its
// ops), its source and its end in fight time. Pure; the rule numbers come in as `RULES.fight`. A new op kind is a member of
// `Op` and its cell in `modsOf` and `opLine` (the typecheck asks), with a case in tests/effect-ops.test.ts.

import type { RowTally } from './row-tally.ts';
import type { Rank } from '../rules.ts';
import { STAT_KEYS, STAT_LABELS } from '../stats.ts';
import type { StatKey, Stats } from '../stats.ts';
import { average, evaluate, printFormula } from '../formula.ts';
import type { Formula, Scope } from '../formula.ts';
import { monsterSheet, monsterStats, sheetOf } from '../hunter/derive.ts';
import type { Archetype, SheetBasis, DeriveRules, MonsterKind, Sheet, StatusMod, Tweak } from '../hunter/derive.ts';
import { tiles } from './space.ts';
import type { Place, Side, Tiles } from './space.ts';
import { roundsOf, tick, withSpeed } from './timeline.ts';
import type { Clock, Tick } from './timeline.ts';
import type { Ability, AbilityId, CombatantId, DamageType, HunterId, Tag } from './ability-types.ts';
import type { ZoneId } from './zones.ts';
import type { Extraction } from './extraction.ts';
import type { BearerEvent, Trigger, Trip } from './triggers.ts';
import { stackStep } from './stacks.ts';
import { SHEET_OP_KEYS, atTier, countOn, isStacking, isTiers, stacked } from './op-amount.ts';
import { counting, harmful, statusLife, statusStep, withSheetOps } from './standing.ts';
import { rowLifeAfter } from './row-life.ts';
import type { FoeLife } from './row-life.ts';
import type { Life } from '../hunter/vitals.ts';
import type { Stack } from './stacks.ts';
import type { HunterRef, Id, ShadowId } from '../ids.ts';

/** A status's key: lower-case words joined by hyphens, as the GM's library keeps them. */
export type StatusKey = Id<'StatusKey'>;
export const statusKey = (s: string): StatusKey => s as StatusKey;
/** The form of a key a status in the GM's library or on a reward may have: at most `STATUS_KEY_MAX` (40) characters. */
export const STATUS_KEY_RE = /^(?=.{1,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUS_KEY_MAX = 40;
export const isStatusKey = (v: unknown): v is StatusKey => typeof v === 'string' && STATUS_KEY_RE.test(v);
/**
 * A key for a new status named `label`: its words in lower case joined by hyphens (`status` when it has none), cut to
 * 40 characters, with the first suffix from -2 that `taken` refuses no more.
 */
export function freeStatusKey(label: string, taken: (key: string) => boolean): StatusKey {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, STATUS_KEY_MAX).replace(/-+$/, '') || 'status';
  let key = base;
  for (let n = 2; taken(key); n++) { const suf = `-${n}`; key = base.slice(0, STATUS_KEY_MAX - suf.length).replace(/-+$/, '') + suf; }
  return statusKey(key);
}

/** One value per tier of the source, E (0) to S (5), as phase 4 has them. */
export type Tiers<T> = readonly [T, T, T, T, T, T];
/** A number an op carries: one value, or one per tier of the source. */
export type Tiered<T> = T | Tiers<T>;
/** When a numeric op acts: at once when used, or a share of it each round the status lasts. */
export type When = 'use' | 'turn';

/**
 * What every def has, as the rules or the GM write it: a label, a description, what it does, the chip's colour a GM may
 * pick, what it does when something happens to its bearer (`triggers`, at most `RULES.fight.kit.triggers`; triggers.ts),
 * and what lands when its time runs out (`end`: a delayed effect, kits design 1.6). An absent list or end is none, so a
 * status written before the kits reads as it was.
 */
type DefBase = {
  readonly label: string; readonly desc: string; readonly ops: readonly Op[]; readonly color?: string;
  readonly triggers?: readonly Trigger[];
  readonly end?: End;
};
/** A status that does not stack: one instance with no count (kits design 1.1). */
export type PlainDef = DefBase & { readonly stack?: never };
/** A status that stacks: its instance holds a count, 1 to its cap, and its ops act per stack (kits design 1.1). */
export type StackDef = DefBase & { readonly stack: StackRule };
/** A def is plain or stacking; only a stacking def may have a threshold, and only its status a count. */
export type StatusDef = PlainDef | StackDef;
/**
 * How a stacking status counts (kits design 1.1 and table 2.1): its cap (1 to `stackCap`); how stacks leave (`never`
 * but with the status, one a `round` held, or all on its bearer's named `event`); whether the count is the fight's alone
 * or written back to the sheet (`keep`); and what a count sets off (`threshold`, design 1.2).
 */
export type StackRule = {
  readonly cap: number;
  readonly leave: { readonly kind: 'never' } | { readonly kind: 'round' } | { readonly kind: 'event'; readonly event: BearerEvent };
  readonly keep: 'fight' | 'sheet';
  readonly threshold: Threshold | null;
};
/**
 * What a count sets off (kits design 1.2): at a count, or a formula over the bearer clamped to 1 to the cap, its ops
 * land once on the bearer or the area around it, from the status's source; then the count is spent or kept. It fires on
 * the crossing, so nothing records that it fired.
 */
export type Threshold = {
  readonly at: { readonly kind: 'count'; readonly n: number } | { readonly kind: 'formula'; readonly formula: Formula };
  readonly to: Reach;
  readonly ops: readonly LandOp[];
  readonly then: 'spend' | 'keep';
};
/** Where a threshold's, a trigger's or an end's ops land: on the bearer, or on the bodies `on` its side within `radius`. */
export type Reach = { readonly kind: 'bearer' } | { readonly kind: 'area'; readonly radius: Tiles; readonly on: AuraOn }
  /** The one body `on` the bearer's side, the other or either within `radius` with the most HP (kits design 8.5: The Cycle Continues). */
  | { readonly kind: 'most'; readonly of: 'hp'; readonly radius: Tiles; readonly on: AuraOn };
/** A delayed effect (kits design 1.6): ops that land on the bearer when the time runs out; a cure cancels it or sets it off. */
export type End = { readonly ops: readonly LandOp[]; readonly cleanse: 'cancel' | 'land' };
/**
 * What a threshold, a trigger or an end lands: an ability's own ops that land on one body at a time (`LAND_USE_OPS`), a
 * hit or a heal (whose damage formula may carry the scalers of kits design 8.0; nothing kills outright), and time back on
 * the bearer's turn (`pct` of its last action). A push or pull needs the map and an anchor, an extra action is the user's
 * own turn, and a guard or a negate answers a use: a use's rules, which nothing lands outside one, so none is a land op.
 */
export type LandOp = Extract<UseOp, { readonly op: (typeof LAND_USE_OPS)[number] }> | Extract<Op, { readonly op: 'damage' | 'heal' }> | { readonly op: 'refund'; readonly pct: number };
/** The use ops a land op may be (land.ts `landOne` lands each). */
export const LAND_USE_OPS = ['applyStatus', 'cureStatus', 'delay', 'threat', 'shield', 'channel', 'note', 'mana', 'fatigue', 'move', 'hasten', 'dispel'] as const satisfies readonly UseOp['op'][];
/** Whether a use op is one a land op may be. */
export const landsAlone = (o: UseOp): o is Extract<UseOp, LandOp> => (LAND_USE_OPS as readonly string[]).includes(o.op);
/**
 * Whether a reaction's ability may hold use op `o`: a reaction lands its ops as a trigger does (`landsAlone`, fight-react.ts
 * `react`), and a guard or a negate answers the use it fires on. A push or pull and an extra action are a use's own
 * (they need its outcomes and its user's turn), so a reaction holding one is refused by the parser and the skill maker.
 */
export const reactionMayHold = (o: UseOp): boolean => landsAlone(o) || o.op === 'guard' || o.op === 'negate';

/**
 * Everything a status or an ability can do. Numbers that grow with the source's rank are `Tiered`. A per-round op settles
 * pro rata in fight time (design 1.3); `speed`, `stat` and `root` change the bearer's sheet through `derive`; `hold` is the
 * stun floor; `taunt` forces the bearer's target and makes a threat burst; `refund` gives the bearer back part of a turn.
 */
export type Op =
  | { readonly op: 'damage'; readonly type: DamageType; readonly amount: Tiered<Formula>; readonly when?: When }
  | { readonly op: 'heal'; readonly amount: Tiered<Formula>; readonly when?: When }
  | { readonly op: 'mana'; readonly amount: Tiered<Formula>; readonly when?: When }
  /** A negative amount removes fatigue. */
  | { readonly op: 'fatigue'; readonly amount: Tiered<Formula>; readonly when?: When }
  /**
   * `duration` null lasts until removed. The def travels with the op, so a status the rules do not know still works.
   * `stacks` (1 to `RULES.fight.kit.stackAdd`; absent, 1) is what it adds to a stacking status (kits design 1.1).
   */
  | { readonly op: 'applyStatus'; readonly key: StatusKey; readonly def: StatusDef; readonly duration: Tiered<Tick> | null; readonly stacks?: number }
  /** `stacks` (1 to `stackAdd`) takes that many from a stacking status; absent, the whole status goes. */
  | { readonly op: 'cureStatus'; readonly key: StatusKey; readonly stacks?: number }
  | { readonly op: 'note'; readonly text: string }
  /** A signed percent of the bearer's speed. */
  | { readonly op: 'speed'; readonly pct: Tiered<number> }
  /** Pushes the next turn back. */
  | { readonly op: 'delay'; readonly ticks: Tiered<Tick> }
  | { readonly op: 'hold' }
  | { readonly op: 'root' }
  | { readonly op: 'taunt' }
  /** Threat the source gains with the bearer, if the bearer keeps a threat table. */
  | { readonly op: 'threat'; readonly amount: Tiered<number> }
  | { readonly op: 'shield'; readonly amount: Formula }
  /** `protect` keeps the bearer's channel from breaking; `break` breaks it. */
  | { readonly op: 'channel'; readonly mode: 'protect' | 'break' }
  /** A signed percent on what the bearer's stagger bar fills by. */
  | { readonly op: 'staggerRate'; readonly pct: Tiered<number> }
  | { readonly op: 'stat'; readonly key: StatKey; readonly amount: Tiered<number> }
  /** An extra-turn passive: `pct` of the action's time comes back when the bearer's d20 falls within `chance` percent. */
  | { readonly op: 'refund'; readonly pct: Tiered<number>; readonly chance: number }
  /**
   * The bearer gives off the status's other ops to the bodies `on` its side, the other or both within `radius` tiles,
   * as a zone around it (design 4.8, zones.ts): an aura, while the status lasts. The bearer is not inside its own.
   */
  | { readonly op: 'aura'; readonly radius: number; readonly on: AuraOn }
  /**
   * The status passes on (design 4.8): once a round of holding it, each body within `range` tiles of the bearer that
   * has never held it in this fight resists or takes it, from the same source, for its first length.
   */
  | { readonly op: 'spread'; readonly range: number }
  // ── wave 2 (kits design 8.1 to 8.6) ──
  /**
   * A change to the bearer's sheet after `derive` (8.1): armor, resist, pen, crit faces, crit size or the cost cut, each
   * kept within its rule (`kit.armorOp`, `fight.penCap`, `kit.critFacesMax`, `kit.critSizeMax`, `kit.costCutMax`); or
   * `exposed`, the crit faces any attacker gains against the bearer (0.5 a stack, the sum rounded down); or `range`,
   * tiles added to the bearer's ranges of 2 or more (`kit.rangeAdd`). Ops of one key add, as `stat` ops do.
   */
  | { readonly op: 'sheet'; readonly key: SheetOpKey; readonly amount: Tiered<number> }
  /**
   * A signed percent on the damage the bearer deals or takes, or the heals it gets (8.1, rule 11c): of each, the
   * strongest increase and the strongest decrease apply and multiply; the product stays within `kit.shareCap` of 1.
   */
  | { readonly op: 'share'; readonly on: ShareOn; readonly pct: Tiered<number> }
  /** A foe's use cannot aim at the bearer nor catch it; it ends when the bearer acts against a foe or a place (8.1). */
  | { readonly op: 'untargetable' }
  /** HP damage does not take the bearer under 1; a shield still absorbs first (8.1). */
  | { readonly op: 'invulnerable' }
  /** A harmful status from the other side does nothing on the bearer (8.1). */
  | { readonly op: 'safeguard' }
  /**
   * Advantage on a reaction d20 (8.2, rule 7b): `attack` reaches each target's die of the bearer's uses against foes
   * (only a use with `tag`, when one is named), `defend` the bearer's own die. `better` keeps the face better for the
   * bearer, `worse` the face worse for it. With `spend` the status loses a stack after the first use it changed.
   */
  | { readonly op: 'edge'; readonly side: EdgeSide; readonly keep: 'better' | 'worse'; readonly tag: Tag | null; readonly spend: boolean }
  /** A held die (8.2): `attack` lowers each target's face by its roll, `defend` raises the bearer's; a die of 2 to `boostSides` sides, or a fixed face. It always spends. */
  | { readonly op: 'boost'; readonly side: EdgeSide; readonly die: { readonly kind: 'die'; readonly sides: number } | { readonly kind: 'face'; readonly n: number } }
  /** The other side cannot aim at the bearer nor catch it, and a hidden foe is out of the room's doc (8.7). */
  | { readonly op: 'hidden' }
  /** The bearer is never surprised (8.7). */
  | { readonly op: 'alert' }
  /** A push or a pull of a caught target, 1 to `kit.shoveMax` tiles, away from or toward the user or the aim (8.3, rule 18). */
  | { readonly op: 'shove'; readonly dir: 'away' | 'toward'; readonly from: 'user' | 'aim'; readonly tiles: number }
  /**
   * Up to `take` stacks (or all) of a status leave `from` for the other of user and target (8.5): `key` a status, the
   * first `harmful` one, or the one that raised a trigger (`event`), put on as `as` when named.
   */
  | { readonly op: 'move'; readonly key: StatusKey | 'harmful' | 'event'; readonly take: number | 'all'; readonly from: 'user' | 'target'; readonly as: StatusKey | null }
  /** The target's next turn comes `share` of the user's standard interval earlier, never before `now + 1` (8.6). */
  | { readonly op: 'hasten'; readonly share: number }
  /** The user's next turn is now: an extra action, at most `kit.extraPerRound` a round (8.6). */
  | { readonly op: 'extra' }
  /** A `before` reaction's: the share taken off the triggering strike's damage to the one it protects (8.4). */
  | { readonly op: 'guard'; readonly share: number }
  /** A `before` reaction's: the triggering use does nothing more to the one it protects (8.4). */
  | { readonly op: 'negate' }
  /** A cure of the first harmful status (the earliest put on), or of every one (8.1's Dispel and Purge). */
  | { readonly op: 'dispel'; readonly which: 'first' | 'all' };
/** A sheet number a `sheet` op may change (op-amount.ts `SHEET_OP_KEYS`). */
export type SheetOpKey = (typeof SHEET_OP_KEYS)[number];
export const SHARE_ON = ['dealt', 'taken', 'healed'] as const;
export type ShareOn = (typeof SHARE_ON)[number];
export type EdgeSide = 'attack' | 'defend';
/** Whom a status's aura reaches, from its bearer's side: everyone, its allies, or its foes. */
export const AURA_ON = ['all', 'allies', 'foes'] as const;
export type AuraOn = (typeof AURA_ON)[number];
export type OpKind = Op['op'];
/** Every kind of op, once: the status maker offers each (the typecheck asks for a new kind here). */
const OP_KIND_SET: { readonly [K in OpKind]: true } = {
  damage: true, heal: true, mana: true, fatigue: true, applyStatus: true, cureStatus: true, note: true, speed: true, delay: true,
  hold: true, root: true, taunt: true, threat: true, shield: true, channel: true, staggerRate: true, stat: true, refund: true, aura: true, spread: true,
  sheet: true, share: true, untargetable: true, invulnerable: true, safeguard: true, edge: true, boost: true, hidden: true, alert: true,
  shove: true, move: true, hasten: true, extra: true, guard: true, negate: true, dispel: true,
};
export const OP_KINDS = Object.keys(OP_KIND_SET) as readonly OpKind[];

/**
 * What an ability's own `ops` may do to each target it lands on; the rest act only from inside a status. `mana` and
 * `fatigue` change the target's at once (an item drunk in a fight: abilities.ts `itemAbility`).
 */
export type UseOp = Extract<Op, { readonly op: 'applyStatus' | 'cureStatus' | 'delay' | 'threat' | 'shield' | 'channel' | 'note' | 'mana' | 'fatigue'
  | 'shove' | 'move' | 'hasten' | 'extra' | 'guard' | 'negate' | 'dispel' }>;
/** Every use op, once: the typecheck asks for a new member of `UseOp` here, so no reader of the list can miss one. */
const USE_OP_SET: { readonly [K in UseOp['op']]: true } = {
  applyStatus: true, cureStatus: true, delay: true, threat: true, shield: true, channel: true, note: true, mana: true, fatigue: true,
  shove: true, move: true, hasten: true, extra: true, guard: true, negate: true, dispel: true,
};
/**
 * Whether op `o` is one an ability carries to each target it lands on; the rest act only from inside a status. The one
 * test of a use op: the parser reads an ability's and a trigger's ops by it (fight-parse.ts), and a consumable carries
 * into a fight the ops it passes (abilities.ts `itemAbility`).
 */
export const isUseOp = (o: Op): o is UseOp => Object.hasOwn(USE_OP_SET, o.op);

/** Who applied a status: its id (null for the GM or an item) and its tier, snapshotted when the status went on. */
export type Source = { readonly id: CombatantId | null; readonly tier: number };

/**
 * A status's end and its life (standing.ts `statusLife`, SMX-rules-2): `until` null lasts until removed; `owed`, set
 * once its time ran out while its bearer's settle still owes a per-round span or its end, absent while it runs. Written
 * only by `applyStatus` (a land) and fight-turn.ts `advance` (time), each through `statusStep` and on a status with an
 * end (`owedOf`). Not a union of the two: fight.ts `joined` moves a status's times by a spread, which a union refuses.
 */
type StatusTime = { readonly until: Tick | null; readonly owed?: true };
/**
 * What every status on a body has: one instance per key, its end and life (`StatusTime`). Its per-round ops have been
 * paid from `since` to `settledAt`, so what it has dealt so far is known and each settle pays only the difference.
 */
type StatusCommon = StatusTime & {
  readonly key: StatusKey;
  readonly source: Source;
  readonly since: Tick;
  readonly settledAt: Tick;
  /** The zone this status is the hold of (zones.ts): the body stands in it while `until` is null. Absent on any other status. */
  readonly zone?: ZoneId;
  /**
   * A passive skill's or a worn item's status (kits design 1.3.2): on its hunter's row from the fight's start, never
   * written back to the sheet, which already holds the skill or the item. Absent on any other status.
   */
  readonly worn?: true;
};
/** A status of a plain def: it has no count. */
export type PlainStatus = StatusCommon & { readonly def: PlainDef; readonly stacks?: never };
/** A status of a stacking def: its count, 1 to its def's cap (kits design 1.1). */
export type StackStatus = StatusCommon & { readonly def: StackDef; readonly stacks: number };
/** One status on a body. Its def says which: `statusOn` builds one from any def, `stacked` (op-amount.ts) tells them apart. */
export type Status = PlainStatus | StackStatus;
/** What a status is besides its def and count, as `statusOn` takes it. */
export type StatusFields = StatusCommon;
/**
 * A status of `def`: a stacking def's holds `stacks`, kept within 1 and its cap; a plain def's holds no count. The one
 * way core builds a status from a def it did not write itself.
 */
export function statusOn(def: StatusDef, fields: StatusFields, stacks = 1): Status {
  const { key, source, since, settledAt, zone, worn } = fields;
  const time: StatusTime = fields.owed && fields.until !== null ? { until: fields.until, owed: true } : { until: fields.until };
  const base: StatusCommon = { ...time, key, source, since, settledAt, ...(zone === undefined ? {} : { zone }), ...(worn ? { worn } : {}) };
  if (!isStacking(def)) return { ...base, def };
  return { ...base, def, stacks: Math.max(1, Math.min(def.stack.cap, Math.trunc(stacks))) };
}

/** The longest monster type a row's origin keeps (a kill fact's `type`, facts.ts). */
export const TYPE_MAX = 40;
/**
 * What `derive` builds a body's sheet from: a hunter's build, or a monster's rank, archetype, kind and its seed's tweak (a
 * shadow keeps its monster's).
 */
export type Origin =
  | { readonly kind: 'hunter'; readonly build: SheetBasis }
  /** `name`: the monster's own name, the kind a pack's rows share (a row's `name` adds its letter, "Goblin B"). */
  | { readonly kind: 'monster'; readonly name: string; readonly rank: Rank; readonly archetype: Archetype; readonly monsterKind: MonsterKind; readonly tweak: Tweak; /** The monster's type ("Beast"), for a kill's fact; absent on a shadow, a summon or a monster without one. */ readonly type?: string };

/** A summon is a body called to its owner's side for a few rounds (kits design 1.9, summons.ts). */
export type CombatantKind = 'hunter' | 'monster' | 'shadow' | 'summon';
/** A shield on a body (design 4.4). */
export type Shield = { readonly amount: number; readonly until: Tick };
/**
 * The stagger bar of an elite or a boss (design 4.3). `hit` is a same-rank hit, the yardstick of a weak hit. `until`: when
 * the bar last broke, the time its pushed turn starts, so a card says "Staggered" until then; absent before the first break.
 */
export type Stagger = { readonly fill: number; readonly max: number; readonly hit: number; readonly until?: Tick };
/** A channel on its user's row (design 4.1). Its machine is the reducer's; a hit only reports that it broke. `spent`: the stacks its begin's price took, which its release's formula reads. */
export type Channel = {
  readonly ability: AbilityId;
  readonly aim: Place | CombatantId;
  readonly charge: number;
  readonly spent: number;
  readonly state: 'holding' | 'fired' | 'broken';
};

/** A shadow's id in its hunter's list. */
export type { ShadowId };
export const shadowId = (s: string): ShadowId => s as ShadowId;

/**
 * Who holds a row's sheet, which the fight writes back to: a hunter on this phone (its `vitals` effect), a hunter on
 * another phone (`sendRemote`), or a shadow of a hunter on this phone (`shadowHp`).
 */
export type Holder = HunterRef | { readonly kind: 'shadow'; readonly hunterId: HunterId; readonly shadowId: ShadowId };
/**
 * What a monster will do on its turn, set by the GM and shown to the players (design 4.5). Cleared when it acts. Players
 * see its name and aim; its numbers only once `revealed`.
 */
export type Intent = { readonly ability: AbilityId; readonly aim: Place | CombatantId; readonly revealed: boolean };

/** A shadow's holder: the hunter on this phone whose Shadows panel keeps its HP (`shadowHp`). */
export type ShadowHolder = Extract<Holder, { readonly kind: 'shadow' }>;
/** A threat table (design 4.2): what each foe of its keeper has done to it, which its keeper's target follows. */
export type ThreatTable = Readonly<Record<CombatantId, number>>;

/**
 * What every row has, whatever its kind. `stats` and `sheet` are what `modified` makes of `origin` and `statuses`;
 * `speed` (from `Clock`) is the sheet's speed. `readyAt` is when each used ability is ready again. Its origin is not its
 * kind's: rows.ts gives a hunter its build and the rest a monster's, but `derive` reads either for any row, and the
 * fight's tests stand monsters on a hunter's build for their known numbers.
 */
type BodyCommon = Clock & {
  readonly id: CombatantId;
  readonly name: string;
  readonly side: Side;
  readonly origin: Origin;
  /** The rank index (E 0 to S 5) the statuses this body applies are read at. */
  readonly tier: number;
  readonly stats: Stats;
  readonly sheet: Sheet;
  readonly place: Place;
  readonly mana: number;
  readonly fatigue: number;
  readonly shield: Shield | null;
  readonly channel: Channel | null;
  readonly statuses: readonly Status[];
  readonly readyAt: Readonly<Record<AbilityId, Tick>>;
  /** What it can use in this fight. */
  readonly abilities: readonly Ability[];
  /** Where each trigger of its statuses stands against its limit (kits table 2.5), by `tripKey`; absent when none has fired. */
  readonly trips?: Readonly<Record<string, Trip>>;
  /**
   * What happened to it this fight (row-tally.ts, written only by `tallied`): a hunter's whole tally, any other row's kills
   * alone, which the formula's `kills` reads (kits design 1.5). Sparse; absent is nothing yet.
   */
  readonly tally?: Partial<RowTally>;
  /**
   * The uses spent of each ability limited to n a fight or a rest (kits table 2.3, uses.ts): this fight's, and for one
   * limited a rest also the rest's before the fight. Absent when none.
   */
  readonly used?: Readonly<Record<AbilityId, number>>;
  /** The wards it has had this fight (kits design 8.1, table 8.9.5): each reaches a body once a fight. Absent when none. */
  readonly warded?: readonly ('untargetable' | 'invulnerable')[];
  /** The extra actions it took in the round of fight time `round` (`floor(now / round)`, kits table 8.9.6); absent before its first. */
  readonly extras?: { readonly round: number; readonly n: number };
  /** Hastened by another since its turn began (kits table 8.9.6): a second hasten does nothing. Absent when not. */
  readonly hastened?: true;
  /**
   * Its armed reaction (kits design 8.4, fight-react.ts): the ability, the body a `turn` reaction names (null for the
   * rest), and whether it fired since it was last restored. Absent when it holds none.
   */
  readonly armed?: { readonly ability: AbilityId; readonly on: CombatantId | null; readonly spent: boolean };
};
/**
 * The fields of one kind only (SMX-rules-8). Another kind's are null or absent in each, so a row cannot hold them:
 * - `holder`: whose sheet the fight writes back to: a hunter's (on this phone or another) or a shadow's hunter; null for
 *   a monster and a summon, and for a hunter or shadow no sheet holds.
 * - `threat`: a monster's table, and a summon's on the foes' side, as a monster's (rows.ts `summonRow`); null for the rest.
 * - `stagger`: an elite's or a boss's bar; null for a monster without one and for every other kind.
 * - `intent`: a monster's announced next use (fight.ts `setIntent` refuses any other kind); null when none.
 * - `xp`: what the party earns when a monster goes down; 0 for every other kind.
 * - `owner` and `until`: a summon's caller, whose phone commands it, and when it leaves (table 2.4).
 * - `extraction`: a fallen monster's shadow extraction (extraction.ts); absent before the first attempt.
 */
type HunterOwn = {
  readonly kind: 'hunter'; readonly life: Life; readonly holder: HunterRef | null;
  readonly threat: null; readonly stagger: null; readonly intent: null; readonly xp: 0;
  readonly owner?: never; readonly until?: never; readonly extraction?: never;
};
type MonsterOwn = {
  readonly kind: 'monster'; readonly life: FoeLife; readonly holder: null;
  readonly threat: ThreatTable; readonly stagger: Stagger | null; readonly intent: Intent | null; readonly xp: number;
  readonly owner?: never; readonly until?: never; readonly extraction?: Extraction;
};
type ShadowOwn = {
  readonly kind: 'shadow'; readonly life: FoeLife; readonly holder: ShadowHolder | null;
  readonly threat: null; readonly stagger: null; readonly intent: null; readonly xp: 0;
  readonly owner?: never; readonly until?: never; readonly extraction?: never;
};
type SummonOwn = {
  readonly kind: 'summon'; readonly life: FoeLife; readonly holder: null;
  readonly threat: ThreatTable | null; readonly stagger: null; readonly intent: null; readonly xp: 0;
  readonly owner: CombatantId; readonly until: Tick; readonly extraction?: never;
};
/** A hunter's row: its life is the life machine's (vitals.ts). */
export type HunterRow = BodyCommon & HunterOwn;
/** A monster's row. */
export type MonsterRow = BodyCommon & MonsterOwn;
/** A shadow's row: the monster it was, on its hunter's side. */
export type ShadowRow = BodyCommon & ShadowOwn;
/** A summon's row: called by its owner for a few rounds (kits design 1.9). */
export type SummonRow = BodyCommon & SummonOwn;
/**
 * A combatant in a fight as one use of an ability reads and changes it: the row of the reducer (design 4 and 5.4), one
 * of four kinds, each with only its own fields (SMX-rules-8).
 */
export type Body = HunterRow | MonsterRow | ShadowRow | SummonRow;
/**
 * `b` with its threat table changed by `change`: a monster's, and a summon's that keeps one; any other row as it was.
 * Every write of a table goes through here, so none can give one to a row whose kind keeps none.
 */
export function withThreat(b: Body, change: (t: ThreatTable) => ThreatTable): Body {
  switch (b.kind) {
    case 'monster': return { ...b, threat: change(b.threat) };
    case 'summon': return b.threat === null ? b : { ...b, threat: change(b.threat) };
    case 'hunter': case 'shadow': return b;
    default: return b satisfies never;
  }
}
/**
 * Which life a row holds goes with its kind (docs/agent-handoff/audit/notes-dead-row.md section 2): a hunter's row holds
 * the hunter's `Life` (vitals.ts: up, dying, stable, dead), any other row a `FoeLife` (row-life.ts: up or dead), so a
 * dying monster cannot be written. A row's HP is its life's (row-hp.ts `rowHp`); only row-life.ts changes it.
 */
export type BodyLife =
  | { readonly kind: 'hunter'; readonly life: Life }
  | { readonly kind: Exclude<CombatantKind, 'hunter'>; readonly life: FoeLife };

/** The rule numbers this file reads. */
export type OpRules = DeriveRules;

// ── applying, lasting and removing ──

/** A control status (speed down, hold, root, taunt; design 3.1 rule 18) at its source's tier: tenacity shortens it. */
export function isControl(def: StatusDef, tier: number): boolean {
  return def.ops.some(o => o.op === 'hold' || o.op === 'root' || o.op === 'taunt' || (o.op === 'speed' && atTier(o.pct, tier) < 0));
}

/** The kind factor on a control status's duration: a boss's flat resistance (design 4.2). A hunter and a shadow take it in full. */
export const controlFactor = (body: Pick<Body, 'kind' | 'origin'>, R: OpRules): number =>
  body.kind === 'monster' && body.origin.kind === 'monster' ? R.fight.kinds[body.origin.monsterKind].control : 1;

/**
 * How long a status lasts on its target: a control status lasts `duration * (100 + potency) / (100 + tenacity)` times the
 * target's kind factor; any other status lasts `duration`.
 */
export function lasting(def: StatusDef, duration: Tick, tier: number, potency: number, tenacity: number, factor: number): Tick {
  return isControl(def, tier) ? tick(Math.round(duration * (100 + potency) / (100 + tenacity) * factor)) : duration;
}

/** The later of two ends (a body's tick, a sheet's rounds left); null, until removed, is the latest. */
const later = <T extends number>(a: T | null, b: T | null): T | null => (a === null || b === null ? null : a >= b ? a : b);

/** A status's count as the stack machine (stacks.ts) holds it: held at its stacks, or absent for a plain one. */
export const stackOf = (s: Status | undefined): Stack => (s !== undefined && stacked(s) ? { at: 'held', n: s.stacks } : { at: 'absent' });

/**
 * A status put on a list at its `since` (every land puts one on from the fight's now): a key the list lacks is added at
 * the end. A key it holds stays one instance in its place: the source with the higher tier wins (a tie goes to the new
 * one, with its def), it lasts the later of the two ends, and it keeps the time its per-round ops are paid to, so no
 * span is paid twice. A stacking status adds the incoming stacks to the ones it holds, to its cap (stacks.ts `apply`); a
 * threshold is not read here (resolve.ts reads it for a use). Its life is the land's (standing.ts `statusStep`): active
 * while its end is ahead, owed when even the later end is behind it.
 */
export function applyStatus(list: readonly Status[], incoming: Status): Status[] {
  const at = list.findIndex(s => s.key === incoming.key), old = at < 0 ? undefined : list[at]!;
  const until = old ? later(old.until, incoming.until) : incoming.until, now = incoming.since;
  const life = statusStep(old ? statusLife(old) : 'gone', { type: 'land', runs: until === null || until > now });
  const time: StatusTime = life === 'owed' && until !== null ? { until, owed: true } : { until };
  if (!old) return [...list, incoming.owed === time.owed ? incoming : statusOn(incoming.def, fieldsOf(incoming, time), countOn(incoming))];
  const kept = oneInstance(old, stackOf(old), incoming, countOn(incoming));
  const fields: StatusFields = { ...time, key: incoming.key, source: kept.source, since: old.since, settledAt: old.settledAt, ...(old.worn ? { worn: old.worn } : {}) };
  return list.map((s, i) => i === at ? statusOn(kept.def, fields, kept.stacks) : s);
}
/** A status's fields with its end and life `time`. */
const fieldsOf = (s: Omit<StatusCommon, keyof StatusTime>, time: StatusTime): StatusFields =>
  ({ ...time, key: s.key, source: s.source, since: s.since, settledAt: s.settledAt, ...(s.zone === undefined ? {} : { zone: s.zone }), ...(s.worn ? { worn: s.worn } : {}) });
/** Status `s` marked owed (standing.ts `statusLife`): its time ran out at `until` while its settle still owes its bearer. */
export const owedOf = (s: Status & { readonly until: Tick }): Status => statusOn(s.def, fieldsOf(s, { until: s.until, owed: true }), countOn(s));
/**
 * The one instance a key keeps when a second is put on, on a body (`applyStatus`) or a sheet (`addSheetStatus`): the
 * source with the higher tier wins (a tie goes to the new one, with its def); a stacking one adds `k` to the count it
 * held (`before`) through the stack machine (stacks.ts `apply`), to its cap; a plain one counts 1.
 */
function oneInstance(old: { readonly def: StatusDef; readonly source: Source }, before: Stack, incoming: { readonly def: StatusDef; readonly source: Source }, k: number): { def: StatusDef; source: Source; stacks: number } {
  const win = incoming.source.tier >= old.source.tier ? incoming : old;
  if (!isStacking(win.def)) return { def: win.def, source: win.source, stacks: 1 };
  const step = stackStep(before, { type: 'apply', k }, { rule: win.def.stack, at: null });
  return { def: win.def, source: win.source, stacks: step.stack.at === 'held' ? step.stack.n : 1 };
}

export const removeStatus = (list: readonly Status[], key: StatusKey): Status[] => list.filter(s => s.key !== key);
/**
 * A dispel (kits design 8.1, Dispel and Purge): the first harmful status of the list, which is the order they were put
 * on, or every harmful one, each whole with all its stacks. A zone's hold is the ground's and stays.
 */
export function dispelled(list: readonly Status[], which: 'first' | 'all'): Status[] {
  const bad = list.filter(s => s.zone === undefined && harmful(s.def));
  const gone = which === 'first' ? bad.slice(0, 1) : bad;
  return list.filter(s => !gone.includes(s));
}
/**
 * A cure of `key` (kits design 1.1 rule 3, table 2.1): `n` stacks of a stacking status, the rest kept; with `n` absent,
 * or on a plain status, the whole status goes.
 */
export function cureStatus(list: readonly Status[], key: StatusKey, n?: number): Status[] {
  const s = list.find(x => x.key === key);
  if (!s) return [...list];
  if (!stacked(s) || n === undefined) return removeStatus(list, key);
  const after = stackStep(stackOf(s), { type: 'cure', n }, { rule: s.def.stack, at: null }).stack;
  return after.at === 'held' ? list.map(x => x.key === key ? { ...s, stacks: after.n } : x) : removeStatus(list, key);
}

/**
 * A status as a hunter's sheet keeps it: its key, def and source, the rounds left with one decimal (null until removed),
 * and a stacking status's count (absent on a plain one).
 */
export type SheetStatus = { readonly key: StatusKey; readonly def: StatusDef; readonly source: Source; readonly rounds: number | null; readonly stacks?: number };
/**
 * A status put on a sheet's list by `applyStatus`'s rule (`oneInstance`): a key the list lacks is added at the end; a key
 * it holds stays one instance in its place and lasts the longer of the two (null, until removed, is the longest).
 */
export function addSheetStatus(list: readonly SheetStatus[], incoming: SheetStatus): SheetStatus[] {
  const at = list.findIndex(s => s.key === incoming.key);
  if (at < 0) return [...list, incoming];
  const old = list[at]!, kept = oneInstance(old, old.stacks === undefined ? { at: 'absent' } : { at: 'held', n: old.stacks }, incoming, incoming.stacks ?? 1);
  const merged: SheetStatus = { key: incoming.key, def: kept.def, source: kept.source, rounds: later(old.rounds, incoming.rounds) };
  return list.map((s, i) => i === at ? (isStacking(kept.def) ? { ...merged, stacks: kept.stacks } : merged) : s);
}
/**
 * Whether a status goes back to its bearer's sheet: a plain one does, a stacking one only when its count is the sheet's
 * (`keep: 'sheet'`, kits table 2.1). A fight's count (Pain, Baangs) stays in the fight, a delayed effect (one with
 * an `end`, table 2.2) is never written to a sheet (the fight's end voids it), and neither is a worn status (its skill
 * or item puts it on again next fight).
 */
export const onSheet = (s: Status): boolean => s.worn === undefined && s.def.end === undefined && (!stacked(s) || s.def.stack.keep === 'sheet');
/**
 * A body's statuses as its sheet keeps them at `now`, with a stacking one's count. A zone's hold is the ground's, not the
 * body's: it stays in the fight.
 */
export const sheetStatuses = (list: readonly Status[], now: Tick, R: OpRules): SheetStatus[] => list.filter(s => s.zone === undefined).map(s => {
  const out: SheetStatus = { key: s.key, def: s.def, source: s.source, rounds: s.until === null ? null : Math.max(0, roundsOf(s.until - now, R, 'up')) };
  return stacked(s) ? { ...out, stacks: s.stacks } : out;
});

// ── settling at a turn start (design 1.3) ──

/**
 * A per-round op that is due: its status, the op, the tier it is read at, the rounds its status had already paid for
 * (`before`) and the share of a round it pays for now.
 */
export type Due = {
  readonly key: StatusKey; readonly op: Extract<Op, { readonly amount: Tiered<Formula> }>; readonly tier: number;
  readonly before: number; readonly share: number;
  /** The count it pays at: a stacking status's stacks when its bearer settles (kits design 1.1 rule 7), else 1. */
  readonly stacks: number;
};

/** Whether an op pays an amount from its formula: damage, a heal, mana or fatigue, each round or once. */
export const amountOp = (o: Op): o is Extract<Op, { readonly op: 'damage' | 'heal' | 'mana' | 'fatigue' }> =>
  o.op === 'damage' || o.op === 'heal' || o.op === 'mana' || o.op === 'fatigue';
/** Whether an op pays a share each round its status lasts (design 1.3). */
export const perRound = (o: Op): o is Due['op'] =>
  (o.op === 'damage' || o.op === 'heal' || o.op === 'mana' || o.op === 'fatigue') && (o.when ?? 'turn') === 'turn';

/**
 * What the bearer's turn start at `now` does to its statuses. Each per-round op is due for the time from its status's
 * `settledAt` to `now`, or to its end if that came first, at the count the status holds as it settles (kits design 1.1
 * rule 7); `settledAt` moves there. Then, in this order: its life's `settle` (standing.ts `statusStep`) ends a status
 * whose end is at or before `now`, owed or not: it is `expired`, at the count it settled at, and its end lands (the owner,
 * Nov 20: when its time and the round that takes its last stack fall on one turn, it goes off rather than fading). Only
 * a status that stays then decays: a stacking one whose stacks leave a round loses one for each whole round held since
 * `since` that this span completed (as a spread counts its rounds), and one that loses its last is `spent`, gone but not
 * ended (the stack machine's `round` step, stacks.ts).
 */
export function settle(statuses: readonly Status[], now: Tick, R: OpRules): { statuses: Status[]; due: Due[]; expired: Status[]; spent: Status[] } {
  const kept: Status[] = [], expired: Status[] = [], spent: Status[] = [], due: Due[] = [];
  for (const s of statuses) {
    const end = s.until === null ? now : tick(Math.min(now, s.until));
    const span = Math.max(0, end - s.settledAt);
    const before = (s.settledAt - s.since) / R.fight.round;
    const count = stacked(s) ? s.stacks : 1;
    if (span > 0) for (const op of s.def.ops) if (perRound(op)) due.push({ key: s.key, op, tier: s.source.tier, before, share: span / R.fight.round, stacks: count });
    const settledAt = tick(Math.max(s.settledAt, end)), next: Status = { ...s, settledAt };
    if (statusStep(statusLife(s), { type: 'settle', past: s.until !== null && now >= s.until }) === 'gone') { expired.push(next); continue; }
    if (!stacked(s)) { kept.push(next); continue; }
    const rounds = Math.floor((settledAt - s.since) / R.fight.round) - Math.floor((s.settledAt - s.since) / R.fight.round);
    const step = stackStep(stackOf(s), { type: 'round', rounds }, { rule: s.def.stack, at: null });
    if (step.stack.at === 'held') kept.push({ ...s, settledAt, stacks: step.stack.n });
    else spent.push(next);
  }
  return { statuses: kept, due, expired, spent };
}

/**
 * What a due op pays: its formula with the dice the edge rolled for this settle is the rate, and it pays the rounded
 * running total less what the rounded total had already paid, `round(rate * (before + share)) - round(rate * before)`.
 * For a fixed rate the sum over any split of a span is `round(rate * span)`, so rounding never drifts. A status's
 * formula reads its bearer.
 */
export function dueAmount(d: Due, scope: Scope, dice: readonly number[]): number {
  const rate = evaluate(atTier(d.op.amount, d.tier), { ...scope, dice }) * d.stacks;
  return Math.round(rate * (d.before + d.share)) - Math.round(rate * d.before);
}

// ── what statuses do to a sheet ──

/**
 * The sheet changes a body's statuses that count (standing.ts `counts`) make: `stat` changes, one speed change, and
 * whether it is rooted. Of the speed changes only the strongest slow and the strongest haste apply, and they multiply
 * (proposals.md, point 2). A stacking status's numbers are per stack (kits design 1.1 rule 4); a root acts from one
 * stack; `derive` keeps speed in its clamp.
 */
export function modsOf(statuses: readonly Status[]): { mods: StatusMod[]; rooted: boolean } {
  const mods: StatusMod[] = [];
  let slow = 0, haste = 0, rooted = false;
  for (const s of counting(statuses)) for (const o of s.def.ops) {
    const tier = s.source.tier, n = countOn(s);
    switch (o.op) {
      case 'stat': mods.push({ op: 'stat', key: o.key, amount: atTier(o.amount, tier) * n }); break;
      case 'speed': { const pct = atTier(o.pct, tier) * n; slow = Math.min(slow, pct); haste = Math.max(haste, pct); break; }
      case 'root': rooted = true; break;
      case 'damage': case 'heal': case 'mana': case 'fatigue': case 'applyStatus': case 'cureStatus': case 'note': case 'delay':
      case 'hold': case 'taunt': case 'threat': case 'shield': case 'channel': case 'staggerRate': case 'refund': case 'aura': case 'spread':
      case 'sheet': case 'share': case 'untargetable': case 'invulnerable': case 'safeguard': case 'edge': case 'boost': case 'hidden': case 'alert':
      case 'shove': case 'move': case 'hasten': case 'extra': case 'guard': case 'negate': case 'dispel': break;
      default: o satisfies never;
    }
  }
  if (slow || haste) mods.push({ op: 'speed', pct: ((1 + slow / 100) * (1 + haste / 100) - 1) * 100 });
  return { mods, rooted };
}

/**
 * The stats and the sheet of a body of this origin under these statuses, through `derive`, then the `sheet` ops of
 * kits design 8.1 (standing.ts `withSheetOps`). A rooted body moves 0 tiles.
 */
export function modified(origin: Origin, statuses: readonly Status[], R: OpRules): { stats: Stats; sheet: Sheet } {
  const { mods, rooted } = modsOf(statuses);
  const bonus = (k: StatKey): number => mods.reduce((n, m) => m.op === 'stat' && m.key === k ? n + m.amount : n, 0);
  const base = origin.kind === 'hunter' ? origin.build.stats : monsterStats(origin.rank, origin.archetype, R, origin.tweak);
  const perks = origin.kind === 'hunter' ? origin.build.perks : {};
  const stats = Object.fromEntries(STAT_KEYS.map(k => [k, base[k] + (perks[k] ?? 0) + bonus(k)])) as Record<StatKey, number>;
  const derived = origin.kind === 'hunter' ? sheetOf(origin.build, R, mods) : monsterSheet(origin.rank, origin.archetype, origin.monsterKind, R, mods, origin.tweak);
  const sheet = withSheetOps(derived, statuses, R);
  return { stats, sheet: rooted ? { ...sheet, move: 0, stride: tiles(0) } : sheet };
}

/**
 * A body with new statuses at `now`: its stats and sheet worked out again, a new speed rescaling the wait left (design
 * 1.2), and its HP (through its life's `maxChanged`, row-life.ts), mana and fatigue kept within the new maxima, as a hunter's sheet keeps HP under a lowered max. A
 * body whose turn time is already past (one that is down) has no wait left to rescale.
 */
export function withStatuses<T extends Body>(body: T, statuses: readonly Status[], now: Tick, R: OpRules): T {
  const { stats, sheet } = modified(body.origin, statuses, R);
  return rowLifeAfter({
    ...(body.at < now ? { ...body, speed: sheet.speed } : withSpeed(body, now, sheet.speed)), statuses, stats, sheet,
    mana: Math.min(body.mana, sheet.manaMax), fatigue: Math.min(body.fatigue, sheet.fatigueMax),
  }, { type: 'maxChanged' });
}

// ── shields (design 4.4) ──

/** Two shields do not add: the larger amount holds, with the later end of the two. A shield past its end is none. */
export function shielded(current: Shield | null, incoming: Shield, now: Tick): Shield {
  if (current === null || current.until <= now) return incoming;
  return { amount: Math.max(current.amount, incoming.amount), until: tick(Math.max(current.until, incoming.until)) };
}

/**
 * The shield a status gives its bearer as it lands: each `shield` op of its def at its formula's average, read with
 * `scope` (the one who applied it as the user, the bearer as the target), lasting as long as the status, or the rules'
 * shield life for a status that lasts until removed. The average, because the GM's Status window rolls no dice; two
 * shields do not add (`shielded`).
 */
export function statusShield(def: StatusDef, current: Shield | null, scope: Scope, now: Tick, until: Tick | null, R: OpRules): Shield | null {
  let out = current;
  for (const o of def.ops) if (o.op === 'shield') {
    const amount = Math.max(0, Math.round(average(o.amount, scope)));
    if (amount > 0) out = shielded(out, { amount, until: until ?? tick(now + R.fight.shieldLife * R.fight.round) }, now);
  }
  return out;
}

// ── what a status or an item's ops do, in words ──

/** What the words read: a round's length, to show a duration in rounds, and the statuses a `cureStatus` names. */
export type DescribeRules = { readonly fight: { readonly round: number }; readonly conditions: Readonly<Record<string, StatusDef>> };

const BY_RANK = ', by rank E to S';
const signed = (n: number): string => `${n < 0 ? '−' : '+'}${Math.abs(n)}`;
const roundsText = (n: number): string => `${n} round${n === 1 ? '' : 's'}`;

/**
 * A `Tiered` value in words: at `tier`, or with `tier` null every rank's value E to S (one value if all six are equal).
 * `byRank` is true when the words name six values.
 */
function tieredText<T>(v: Tiered<T>, tier: number | null, show: (x: T) => string): { text: string; byRank: boolean } {
  if (tier !== null || !isTiers(v)) return { text: show(atTier(v, tier ?? 0)), byRank: false };
  const all = v.map(show);
  return all.every(t => t === all[0]) ? { text: all[0]!, byRank: false } : { text: all.join(' / '), byRank: true };
}

/** A heal of the target's whole maximum HP (`target.hpMax`): it fills HP whatever the maximum, and reads "Heals fully". */
export const FULL_HEAL: Formula = { kind: 'sheet', whose: 'target', key: 'hpMax' };
/** Whether a heal's amount at `tier` is `FULL_HEAL`. */
export const healsFully = (amount: Tiered<Formula>, tier: number): boolean => { const f = atTier(amount, tier); return f.kind === 'sheet' && f.whose === 'target' && f.key === 'hpMax'; };
const isNumber = (f: Formula): f is Extract<Formula, { kind: 'number' }> => f.kind === 'number';

/** One op in words, read at `tier` (null: every rank). A `when` left out on a numeric op means every round. */
function opLine(o: Op, tier: number | null, R: DescribeRules): string {
  const amount = (a: Tiered<Formula>) => tieredText(a, tier, printFormula);
  const num = (a: Tiered<number>, show: (n: number) => string) => tieredText(a, tier, show);
  const rank = (t: { byRank: boolean }) => (t.byRank ? BY_RANK : '');
  switch (o.op) {
    case 'damage': {
      const a = amount(o.amount);
      return (o.when ?? 'turn') === 'turn' ? `${a.text} ${o.type} damage a round${rank(a)}` : `Deals ${a.text} ${o.type} damage${rank(a)}`;
    }
    case 'heal': {
      const turn = (o.when ?? 'turn') === 'turn', at = atTier(o.amount, tier ?? 0);
      if (!turn && healsFully(o.amount, tier ?? 0)) return 'Heals fully';
      const a = amount(o.amount);
      return `Heals ${a.text} HP${turn ? ' a round' : ''}${rank(a)}`;
    }
    case 'mana': { const a = amount(o.amount); return `Restores ${a.text} mana${(o.when ?? 'turn') === 'turn' ? ' a round' : ''}${rank(a)}`; }
    case 'fatigue': {
      const turn = (o.when ?? 'turn') === 'turn' ? ' a round' : '', at = atTier(o.amount, tier ?? 0);
      if (isNumber(at) && at.value < 0 && !isTiers(o.amount)) return `Removes ${-at.value} fatigue${turn}`;
      const a = amount(o.amount);
      return `Adds ${a.text} fatigue${turn}${rank(a)}`;
    }
    case 'applyStatus': {
      const lasts = o.duration === null ? null : num(o.duration, n => roundsText(roundsOf(n, R, 'near')));
      const inner = opLines(o.def.ops, tier, R);
      return `Applies ${o.def.label}${lasts ? ` (${lasts.text}${rank(lasts)})` : ''}${inner.length ? `: ${inner.join('; ')}` : ''}`;
    }
    case 'cureStatus': return `Cures ${o.stacks === undefined ? '' : `${o.stacks} of `}${R.conditions[o.key]?.label ?? o.key}`;
    case 'note': return o.text;
    case 'speed': { const p = num(o.pct, n => `${signed(n)}%`); return `Speed ${p.text}${rank(p)}`; }
    case 'delay': { const d = num(o.ticks, n => roundsText(roundsOf(n, R, 'near'))); return `Next turn ${d.text} later${rank(d)}`; }
    case 'hold': return 'Cannot act';
    case 'root': return 'Cannot move';
    case 'taunt': return 'Must attack the one who taunted it';
    case 'threat': { const t = num(o.amount, n => signed(n)); return `${t.text} threat${rank(t)}`; }
    case 'shield': return `Shield of ${printFormula(o.amount)}`;
    case 'channel': return o.mode === 'protect' ? 'A hit does not break a channel' : 'Breaks a channel';
    case 'staggerRate': { const p = num(o.pct, n => `${signed(n)}%`); return `Stagger fills ${p.text}${rank(p)}`; }
    case 'stat': { const n = num(o.amount, signed); return `${STAT_LABELS[o.key]} ${n.text}${rank(n)}`; }
    case 'refund': {
      const p = num(o.pct, n => `${n}%`);
      return `${o.chance}% chance to get ${p.text} of an action's time back${rank(p)}`;
    }
    case 'aura': return `Gives off its other effects to ${o.on === 'all' ? 'everyone' : o.on} within ${o.radius} tile${o.radius === 1 ? '' : 's'}`;
    case 'spread': return `Spreads each round to anyone within ${o.range} tile${o.range === 1 ? '' : 's'} who fails to resist it, once a fight`;
    case 'sheet': { const n = num(o.amount, signed); return `${SHEET_OP_TEXT[o.key]} ${n.text}${rank(n)}`; }
    case 'share': { const p = num(o.pct, n => `${signed(n)}%`); return `${SHARE_TEXT[o.on]} ${p.text}${rank(p)}`; }
    case 'untargetable': return 'Foes cannot aim at it or hit it with an area, for a round, once a fight. Acting on a foe ends it';
    case 'invulnerable': return 'Damage does not take it under 1 HP, for a round, once a fight';
    case 'safeguard': return 'A harmful status from a foe does nothing, for a round';
    case 'edge': {
      const who = o.side === 'attack' ? `Its next use against a foe${o.tag ? ` tagged ${o.tag}` : ''}: the target rolls twice and keeps the ${o.keep === 'better' ? 'lower' : 'higher'}`
        : `A use against it: it rolls twice and keeps the ${o.keep === 'better' ? 'higher' : 'lower'}`;
      return `${who}${o.spend ? '. Spent once used' : ''}`;
    }
    case 'boost': {
      const die = o.die.kind === 'die' ? `a d${o.die.sides}` : `${o.die.n}`;
      return o.side === 'attack' ? `Its next use against a foe: each target's die is lowered by ${die}` : `The next use against it: its die is raised by ${die}`;
    }
    case 'hidden': return 'Hidden: foes cannot aim at it or hit it with an area. It is revealed when it acts, when a foe is beside it, or when it is hurt';
    case 'alert': return 'Never surprised';
    case 'shove': return `${o.dir === 'away' ? 'Pushes' : 'Pulls'} each target ${o.tiles} tile${o.tiles === 1 ? '' : 's'} ${o.dir === 'away' ? 'away from' : 'toward'} ${o.from === 'user' ? 'you' : 'the center'}`;
    case 'move': {
      const what = o.key === 'harmful' ? 'the first harmful status' : o.key === 'event' ? 'the status that set it off' : (R.conditions[o.key]?.label ?? o.key);
      return `Moves ${o.take === 'all' ? 'all of' : `${o.take} of`} ${what} ${o.from === 'user' ? 'to the target' : 'from the target to you'}${o.as ? ` as ${R.conditions[o.as]?.label ?? o.as}` : ''}`;
    }
    case 'hasten': return `The target's next turn comes ${Math.round(o.share * 100)}% of your action sooner`;
    case 'extra': return 'Take another action at once, once a round';
    case 'guard': return `Takes ${Math.round(o.share * 100)}% off the strike it answers`;
    case 'negate': return 'The use it answers does nothing more';
    case 'dispel': return o.which === 'first' ? 'Cures the first harmful status' : 'Cures every harmful status';
    default: return o satisfies never;
  }
}

const SHEET_OP_TEXT: { readonly [K in SheetOpKey]: string } = {
  armor: 'Armor', resist: 'Resist', pen: 'Penetration (share)', critFaces: 'Crit faces', exposed: 'Faces a foe crits it on', critSize: 'Crit size',
  costCut: 'Cost cut (share)', range: 'Range of 2 or more', sight: 'Sight level',
};
const SHARE_TEXT: { readonly [K in ShareOn]: string } = { dealt: 'Damage dealt', taken: 'Damage taken', healed: 'Healing received' };

/** Ops in words, one line each, read at `tier` (the source's rank or an item's rarity, 0 to 5), or every rank with null. */
export const opLines = (ops: readonly Op[], tier: number | null, R: DescribeRules): string[] => ops.map(o => opLine(o, tier, R)).filter(Boolean);

/**
 * What a status does, one line per op: on a body, at its source's tier; on the status card of a picker or the rules, with
 * `tier` null, every rank's number E to S.
 */
export function describeStatus(def: StatusDef, tier: number | null, R: DescribeRules): string[] {
  return [...describeStack(def, tier, R), ...(def.triggers ?? []).map(t => triggerLine(t, tier, R)), ...(def.end ? [endLine(def.end, tier, R)] : [])];
}
/** A land op in words: time back, or the op's own line. */
const landLine = (o: LandOp, tier: number | null, R: DescribeRules): string => (o.op === 'refund' ? `${o.pct}% of an action's time back` : opLine(o, tier, R));
const reachText = (to: Reach): string => (to.kind === 'bearer' ? ''
  : `${to.kind === 'most' ? ' on the one with the most HP of' : ' on'} ${to.on === 'all' ? 'everyone' : to.on} within ${to.radius} tile${to.radius === 1 ? '' : 's'}`);
const EVENT_TEXT: { readonly [K in Trigger['on']]: string } = {
  hitDealt: 'deals a hit', struck: 'is struck', critDealt: 'crits', critTaken: 'takes a crit', kill: 'kills', avoided: 'avoids a use', down: 'goes down',
  turnStart: 'starts its turn', turnEnd: 'ends its turn', moved: 'moves', statusGained: 'gains', statusEnded: 'loses', used: 'uses an ability tagged',
};
/** A trigger in words (kits design 5.1): "When its bearer deals a hit with a sword: Applies Corruption on the other, every time." */
function triggerLine(t: Trigger, tier: number | null, R: DescribeRules): string {
  const what = t.on === 'statusGained' || t.on === 'statusEnded' ? `${EVENT_TEXT[t.on]} ${R.conditions[t.key]?.label ?? t.key}`
    : t.on === 'used' ? `${EVENT_TEXT.used} ${t.tag}` : `${EVENT_TEXT[t.on]}${'tag' in t && t.tag ? ` with a ${t.tag}` : ''}`;
  const where = t.to === 'self' ? '' : t.to === 'other' ? ' on the other' : reachText(t.to);
  const often = t.limit.kind === 'each' ? 'every time' : t.limit.kind === 'round' ? 'once a round' : `${t.limit.n} time${t.limit.n === 1 ? '' : 's'} a fight`;
  const need = !t.need ? '' : t.need.kind === 'holds' ? ` Only while it holds ${R.conditions[t.need.key]?.label ?? t.need.key}.` : ` Only inside ${t.need.zone}.`;
  return `When its bearer ${what}: ${t.ops.map(o => landLine(o, tier, R)).join('; ')}${where}, ${often}.${need}`;
}
/** A delayed effect in words (kits design 5.1): "When it ends: Deals 1d8 + mag magical damage. A cure cancels it." */
const endLine = (e: End, tier: number | null, R: DescribeRules): string =>
  `When it ends: ${e.ops.map(o => landLine(o, tier, R)).join('; ')}. ${e.cleanse === 'cancel' ? 'A cure cancels it.' : 'A cure makes it happen at once.'}`;
/** What a status does apart from its triggers and end: its ops, and a stacking one's count and threshold. */
function describeStack(def: StatusDef, tier: number | null, R: DescribeRules): string[] {
  if (!isStacking(def)) return opLines(def.ops, tier, R);
  const st = def.stack, t = st.threshold, out = [`Stacks to ${st.cap}.${LEAVE_TEXT[st.leave.kind === 'event' ? st.leave.event : st.leave.kind]}`];
  out.push(...opLines(def.ops, tier, R).map(l => `Each stack: ${l}`));
  if (t) {
    const at = t.at.kind === 'count' ? `${t.at.n} stack${t.at.n === 1 ? '' : 's'}` : `${printFormula(t.at.formula)} stacks`;
    const where = reachText(t.to);
    const lines = t.ops.map(o => landLine(o, tier, R));
    out.push(`At ${at}${where}: ${lines.join('; ')}. ${t.then === 'spend' ? 'The stacks are spent.' : 'The stacks stay.'}`);
  }
  if (st.keep === 'fight') out.push('Gone when the fight ends.');
  return out;
}
const LEAVE_TEXT: { readonly [K in 'never' | 'round' | BearerEvent]: string } = {
  never: '', round: ' One leaves each round.', hitDealt: ' All leave when its bearer deals a hit.', struck: ' All leave when its bearer is struck.',
  critDealt: ' All leave when its bearer crits.', critTaken: ' All leave when its bearer takes a crit.', kill: ' All leave when its bearer kills.',
  avoided: ' All leave when its bearer avoids a use.', turnStart: ' All leave at its bearer\'s turn start.', turnEnd: ' All leave at its bearer\'s turn end.',
  moved: ' All leave when its bearer moves.', down: ' All leave when its bearer goes down.',
};
