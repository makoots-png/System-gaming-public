// fight-types.ts: what a fight is (docs/agent-handoff/rw/design.md sections 1, 3.3, 4 and 5), the commands that
// change it and the effects it asks the edge to carry out. Types only. The reducer and its machine tables are fight.ts,
// the boundary parser fight-parse.ts. The row of a fight is `Body` (effect-ops.ts).
import type { Rules } from '../rules.ts';
import type { Dice } from '../formula.ts';
import type { Life } from '../hunter/vitals.ts';
import type { Grid, Place, Side, Terrain, Tiles } from './space.ts';
import type { Tick } from './timeline.ts';
import type { AbilityId, CombatantId, HunterId } from './ability-types.ts';
import type { SheetKey } from '../ids.ts';
import type { Body, Channel, Due, ShadowId, SheetStatus, Source, StatusDef, StatusKey } from './effect-ops.ts';
import type { Aim, UseRefusal as UseRefusal, Rolls } from './resolve.ts';
import type { Zone, ZoneId } from './zones.ts';
import type { ExtractionOutcome } from './extraction.ts';
import type { Id } from '../ids.ts';

export type FightId = Id<'FightId'>;
export const fightId = (s: string): FightId => s as FightId;

// ── the fight ──
/** The fight's own states. No fight is `null`. */
export const PHASES = ['setup', 'running', 'ended'] as const;
export type Phase = (typeof PHASES)[number];
/**
 * What every fight has: its rows (one `Body` each, in the order they joined), its map, the zones on it (zones.ts), its
 * fog (null: the party sees the whole map), its log (newest first) and `banked`, the XP of foes the GM removed while
 * they were down.
 */
/**
 * A line of the fight's log and the rows and zones it is about (`rows`, `zones`), named by the step that logs it: the party's doc keeps a
 * line only when none of them is hidden from the party (fight-doc.ts), whatever the words say.
 */
export type LogLine = { readonly text: string; readonly rows: readonly CombatantId[]; readonly zones: readonly ZoneId[] };
/** A log line about these rows and zones. */
export const line = (text: string, rows: readonly CombatantId[] = [], zones: readonly ZoneId[] = []): LogLine => ({ text, rows, zones });
type Shared = {
  readonly id: FightId; readonly grid: Grid; readonly zones: readonly Zone[]; readonly fog: Fog | null; readonly rows: readonly Body[];
  readonly log: readonly LogLine[]; readonly banked: number;
  /**
   * Who has held each spreading status in this fight, by its key (design 4.8): a body on a list never catches that
   * status again, so a spread ends. Marked by `reduce` after every command; at most `MAX_SPREAD` keys.
   */
  readonly had: Readonly<Record<StatusKey, readonly CombatantId[]>>;
};
/**
 * The party's fog of war (design 5.3): how far a body sees, in tiles, and `seen`, one character a tile ('1' once any of
 * the party saw it, '0' never), so the room's doc keeps a wall the party saw once drawn after it is out of sight.
 */
export type Fog = { readonly sight: Tiles; readonly seen: string };
/** Being built: rows join and stand in their places; nobody has a turn yet (`at` and `tie` are 0 until `start`). */
export type Setup = Shared & { readonly phase: 'setup' };
/**
 * Under way: `now` is the time of the current turn, `currentId` whose it is. `pending` are the per-round ops due at a
 * turn start whose dice the edge has been asked to roll (a `rollSettle` effect) and that a `settle` command pays.
 */
export type Running = Shared & { readonly phase: 'running'; readonly now: Tick; readonly currentId: CombatantId; readonly pending: readonly DueTurn[] };
/** Over: a side had nobody up, or the GM ended it. The rows and the log stay for the summary screen until `clear`. */
export type Ended = Shared & { readonly phase: 'ended'; readonly now: Tick; readonly summary: Summary };
export type Fight = Setup | Running | Ended;

/**
 * What waits for its dice at `id`'s turn start: a per-round op of one of its statuses (`due`), or a spreading status's
 * pass to the bodies near it (`spread`).
 */
export type DueTurn = { readonly id: CombatantId; readonly due: Due } | { readonly id: CombatantId; readonly spread: Spread };
/**
 * A spreading status passing from its bearer (design 4.8): the key its dice come back under (`spreadKey`), the status
 * (key, def, source, its first length or null), the bearer's Accuracy the resist is rolled against, and the bodies that
 * each roll one d20, in order.
 */
export type Spread = {
  readonly key: StatusKey; readonly status: StatusKey; readonly def: StatusDef; readonly source: Source; readonly length: Tick | null;
  readonly aim: number; readonly targets: readonly CombatantId[];
};
/** The key a pending pass of status `key` goes by. */
export const spreadKey = (key: StatusKey): StatusKey => `${key}-spread` as StatusKey;
/** The key a pending entry's dice come back under. */
export const pendingKey = (p: DueTurn): StatusKey => 'due' in p ? p.due.key : p.spread.key;
/**
 * What the end of a fight reports: its length in rounds with one decimal, the side still up (null if neither), who is
 * down, and the XP of the foes that went down (those still in the fight and those removed while down).
 */
export type Summary = { readonly rounds: number; readonly winner: Side | null; readonly down: readonly CombatantId[]; readonly xp: number };

/** A row as the edge hands it in: the fight works out its stats, sheet and speed, and gives a place to one without. */
export type NewRow = Omit<Body, 'at' | 'tie' | 'speed' | 'stats' | 'sheet' | 'place'> & { readonly place: Place | null };
/** The opening roll of one row: its d20 (the fight adds its Instinct bonus) and the d1000 that breaks ties. */
export type Opening = { readonly id: CombatantId; readonly d20: number; readonly tie: number };

/** What the reducer may know besides the fight: the rules, and the life of a hunter on this phone (for `vitals`). */
export type Ctx = { readonly rules: Rules; readonly life: (id: HunterId) => Life | null };

// ── commands ──
export type Command =
  /**
   * Rows join: from no fight they make a new one on `grid` (the rules' open grid when left out); in setup they stand;
   * while running they join at their opening.
   */
  | {
    readonly type: 'add'; readonly fightId: FightId; readonly rows: readonly NewRow[]; readonly openings: readonly Opening[]; readonly grid?: Grid;
    readonly zones?: readonly Zone[]; readonly fog?: Fog | null;
    /** The tiles a row of each side takes, in order, before its side's default line (a saved map's starts). */
    readonly starts?: { readonly party: readonly Place[]; readonly foe: readonly Place[] };
  }
  /** A row leaves. */
  | { readonly type: 'remove'; readonly id: CombatantId }
  /**
   * The fight begins: every row's first turn from its opening roll. A side `surprised` (kits design 8.7.5) has each of
   * its rows' openings `kit.surprise` rounds later, but a row holding a status with `alert`.
   */
  | { readonly type: 'start'; readonly openings: readonly Opening[]; readonly surprised?: Side }
  /** `by` uses `ability` at `aim` with the dice the edge rolled. `force` is the GM acting out of turn. */
  | { readonly type: 'act'; readonly by: CombatantId; readonly ability: AbilityId; readonly aim: Aim; readonly rolls: Rolls; readonly force?: boolean }
  /**
   * `by` walks to `to` on its turn: a stride at most, around bodies and walls, for the time the tiles cost. With `dash`
   * it runs up to its whole `move` in a straight line with nothing on it, for a standard action's time and `dashFatigue`.
   */
  | { readonly type: 'move'; readonly by: CombatantId; readonly to: Place; readonly dash?: boolean }
  /** `by` passes its turn: a standard action's time. */
  | { readonly type: 'endTurn'; readonly by: CombatantId }
  /** `by`'s channel goes off: a holding one on its turn at its charge, a broken one at once at its halved charge. */
  | { readonly type: 'release'; readonly by: CombatantId; readonly rolls: Rolls }
  /** The GM announces what monster `by` will do on its turn: its name and aim; its numbers stay hidden. */
  | { readonly type: 'setIntent'; readonly by: CombatantId; readonly ability: AbilityId; readonly aim: Aim }
  /** The GM shows the numbers of monster `by`'s announced intent on every phone. */
  | { readonly type: 'reveal'; readonly by: CombatantId }
  /** The GM drags `id` to `to`: no time, no path. */
  | { readonly type: 'place'; readonly id: CombatantId; readonly to: Place }
  /**
   * The GM's hand edit of `id`'s HP, mana or fatigue by signed amounts, each kept within its bounds. No time passes; a row
   * brought to 0 goes down as a hit would put it there.
   */
  | {
    readonly type: 'adjust'; readonly id: CombatantId; readonly hp?: number; readonly mana?: number; readonly fatigue?: number;
    /** The uses spent of one of its abilities limited a fight or a rest (kits table 2.3, "the GM sets it"), 0 to `fightUses`. */
    readonly used?: { readonly ability: AbilityId; readonly spent: number };
    /** The mana taken is a price paid outside the fight (a shadow summoned): refused (`mana`) when the row holds less. */
    readonly pay?: boolean;
  }
  /**
   * The GM's Status window on `id`: `remove` takes a status off, then `add` puts one on from the GM at `tier`, lasting
   * `duration` (null until removed). No time passes; a hold put on the current row ends its turn, as a use would.
   */
  | { readonly type: 'status'; readonly id: CombatantId; readonly add?: StatusGrant; readonly remove?: StatusKey }
  /** The dice for the per-round op of status `key` on `id` that its turn start asked for. */
  | { readonly type: 'settle'; readonly id: CombatantId; readonly key: StatusKey; readonly dice: readonly number[] }
  /** The GM paints `tiles` with `terrain`: a wall falls or rises. No time passes; a tile a body stands on takes only terrain it may stand on. */
  | { readonly type: 'paint'; readonly tiles: readonly Place[]; readonly terrain: Terrain }
  /** The GM puts a zone on the ground, lasting `duration` from now (null: until removed). No time passes. */
  | { readonly type: 'zoneAdd'; readonly zone: ZoneDraft }
  /** The GM takes zone `id` off the ground. */
  | { readonly type: 'zoneRemove'; readonly id: ZoneId }
  /**
   * The GM makes the map `w` by `h` tiles (each side within `GRID_SIDE`): floor is added or cut at the right and the
   * bottom. No time passes. Refused when it would cut off a body or a tile a channel or an intent aims at (design 4.8).
   */
  | { readonly type: 'resize'; readonly w: number; readonly h: number }
  /**
   * `by` arms its reaction `ability` (null disarms), the GM's for anyone and a player's for its hunter (the room's `arm`):
   * one a row, taken at any time, no time passes. A `turn` reaction names the body `on` whose turn it answers.
   */
  | { readonly type: 'arm'; readonly by: CombatantId; readonly ability: AbilityId | null; readonly on?: CombatantId }
  /**
   * An attempt to extract a shadow from fallen monster `id` came to `outcome` (extraction.ts): kept on its row. No time
   * passes; it may come after the fight ended, while its rows are the summary's record.
   */
  /** `by`: the hunter row of the fight that extracts (its hunter's job and rank are the view's to judge, `canExtract`, `extractDc`). */
  | { readonly type: 'extract'; readonly id: CombatantId; readonly by: CombatantId; readonly outcome: ExtractionOutcome }
  /** The GM ends the fight now. */
  | { readonly type: 'end' }
  /** The ended fight's screen is closed: no fight. */
  | { readonly type: 'clear' };
export type CommandType = Command['type'];
/** A zone as the GM paints it: on its `tiles` (a fixed ground), its end `duration` after the fight's now, and nobody owns it. */
export type ZoneDraft = Omit<Zone, 'until' | 'owner' | 'endsWithOwner' | 'ground'> & { readonly tiles: readonly Place[]; readonly duration: Tick | null };
/** A status the GM puts on a row: no tenacity shortens it, since the GM chose its length. */
export type StatusGrant = { readonly key: StatusKey; readonly def: StatusDef; readonly duration: Tick | null; readonly tier: number };

// ── effects ──
/** Why a command changed nothing: one of the use's own refusals (resolve.ts) or one of the fight's. */
export type Refusal = UseRefusal
  | 'notNow' | 'unknown' | 'duplicate' | 'tooMany' | 'noPlace' | 'needBothSides' | 'notYourTurn' | 'down' | 'unknownAbility'
  | 'tooFar' | 'noMove' | 'offGrid' | 'taken' | 'noChannel' | 'notMonster' | 'nothingDue' | 'noChange' | 'noIntent' | 'cutOff'
  /** A zone price (kits design 1.4.3) and the user holds no zone of that name. */
  | 'zone'
  /** A use that hides its user while a foe that is up sees its tile (kits design 8.7.2). */
  | 'seen'
  /** A corpse with no extraction attempt left, or one that rose or crumbled already. */
  | 'noAttempts'
  /** An extraction named by a row that is not a hunter of the fight. */
  | 'notExtractor';
// `extra` (a second extra action in a round, kits design 8.6.1) is a use's refusal, in `UseRefusal`.

export type Effect =
  /** The turn of `id` began at `now`; `hunterId` when it is a hunter on this phone. */
  | { readonly type: 'turnStarted'; readonly id: CombatantId; readonly hunterId: HunterId | null; readonly now: Tick }
  /** A per-round op of `key` on `id` paid for `share` of a round. With dice the edge rolls them and sends `settle`; with none it is paid already. */
  | { readonly type: 'rollSettle'; readonly id: CombatantId; readonly key: StatusKey; readonly dice: readonly Dice[]; readonly share: number }
  /**
   * The one write-back of a hunter on this phone: its HP, life, mana, fatigue and statuses as the fight holds them, as
   * totals so a repeat changes nothing.
   */
  | {
    readonly type: 'vitals'; readonly hunterId: HunterId; readonly hp: number; readonly life: Life; readonly mana: number; readonly fatigue: number;
    readonly statuses: readonly SheetStatus[];
    /** The uses spent of its abilities limited a long rest (`Vitals.used`, kits table 2.3); absent when it has none. */
    readonly used?: Readonly<Record<AbilityId, number>>;
  }
  /** The same numbers for a hunter on another phone. */
  | {
    readonly type: 'sendRemote'; readonly remote: SheetKey; readonly hp: number; readonly mana: number; readonly fatigue: number;
    readonly statuses: readonly SheetStatus[];
  }
  /** The write-back of a shadow of a hunter on this phone: its HP as a total. */
  | { readonly type: 'shadowHp'; readonly hunterId: HunterId; readonly shadowId: ShadowId; readonly hp: number }
  /** `id` stands on a new tile (a walk, a dodge, a drag): the map animates it. */
  | { readonly type: 'moved'; readonly id: CombatantId; readonly to: Place }
  /** `id`'s channel is in a new state; null when it ended without going off. */
  | { readonly type: 'channel'; readonly id: CombatantId; readonly state: Channel['state'] | null; readonly charge: number }
  /** `id`'s stagger bar filled and it lost its next turn. */
  | { readonly type: 'staggered'; readonly id: CombatantId }
  /** A use's critical hit landed on `id`. A fact of the hit that no row keeps: the screens mark it. */
  | { readonly type: 'crit'; readonly id: CombatantId }
  /** A monster or shadow went down. */
  | { readonly type: 'defeated'; readonly id: CombatantId }
  /**
   * A stacking status's threshold (or a cleanse that set off a delayed effect) went off on `id` in a use (rule 18a,
   * `Resolved.bursts`). Like a crit, a fact of the use that no row keeps (kits design 1.2): the screens mark it.
   */
  | { readonly type: 'burst'; readonly id: CombatantId }
  /** Row `by` used `ability`: the line the use logged, without its round (the GM's toast of what it did). */
  | { readonly type: 'used'; readonly by: CombatantId; readonly ability: AbilityId; readonly line: string }
  | { readonly type: 'ended'; readonly summary: Summary }
  | { readonly type: 'refused'; readonly reason: Refusal };
export type EffectType = Effect['type'];
export type Result = { readonly fight: Fight | null; readonly effects: readonly Effect[] };

// ── limits ──
export const MAX_ROWS = 60;
export const NAME_MAX = 60;
export const LOG_CAP = 100;
export const LOG_LINE_MAX = 300;
export const MAX_STATUSES = 30;
export const MAX_ABILITIES = 12;
export const MAX_PENDING = 200;
/** At most this many spreading statuses a fight remembers who has held (design 4.8); another one does not spread. */
export const MAX_SPREAD = 16;
