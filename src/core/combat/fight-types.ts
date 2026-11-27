// fight-types.ts: what a fight is (docs/agent-handoff/rw/design.md sections 1, 3.3, 4 and 5), the commands that
// change it and the effects it asks the edge to carry out. Types only. The reducer and its machine tables are fight.ts,
// the boundary parser fight-parse.ts. The row of a fight is `Body` (effect-ops.ts).
import type { Rules } from '../rules.ts';
import type { Dice } from '../formula.ts';
import type { Life } from '../hunter/vitals.ts';
import type { Dodge, Grid, Place, Side, Terrain, Tiles } from './space.ts';
import type { Tick } from './timeline.ts';
import type { AbilityId, CombatantId, HunterId } from './ability-types.ts';
import type { FightId, SheetKey } from '../ids.ts';
import type { Body, Channel, Due, ShadowId, SheetStatus, Source, StatusDef, StatusKey } from './effect-ops.ts';
import type { Aim, UseRefusal as UseRefusal, Rolls } from './resolve.ts';
import type { Zone, ZoneId } from './zones.ts';
import type { ExtractKind, ExtractRoll } from './roll-adjust.ts';
import type { Answer, MythicRefusal } from './mythic.ts';
import type { AnswerOutcome, OmenKey } from './mythic-types.ts';
import type { NpcSkill } from '../registry/npcs.ts';

// ── the fight ──
/** The fight's own states. No fight is `null`. */
export const PHASES = ['setup', 'running', 'ended'] as const;
export type Phase = (typeof PHASES)[number];
/**
 * A line of the fight's log and the rows and zones it is about (`rows`, `zones`), named by the step that logs it: the party's doc keeps a
 * line only when none of them is hidden from the party (fight-doc.ts), whatever the words say. When `text` holds GM-only
 * details (a hidden roll adjustment or forced natural), `table` carries the player-safe text for the room doc and player messages.
 */
export type LogLine = { readonly text: string; readonly rows: readonly CombatantId[]; readonly zones: readonly ZoneId[]; readonly table?: string };
/** A log line about these rows and zones, with optional player-safe `table` words. */
export const line = (text: string, rows: readonly CombatantId[] = [], zones: readonly ZoneId[] = [], table?: string): LogLine =>
  (table === undefined ? { text, rows, zones } : { text, rows, zones, table });
/**
 * What every fight has: its rows (one `Body` each, in the order they joined), its map, the zones on it (zones.ts), its
 * fog (null: the party sees the whole map), its log (newest first) and `banked`, the XP of foes the GM removed while
 * they were down.
 */
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
/** Being built: rows join and stand in their places; nobody has a turn yet (`at` and `tie` are 0 until `start`). `partyScaled` marks a gate fight whose foes scale in core at `start` to the party rows actually present. */
export type Setup = Shared & { readonly phase: 'setup'; readonly fudge: Fudge; readonly partyScaled?: true };
/** A use held while a hunter picks its dodge tile: `act` (a mythic omen landing too) or `release`. */
export type HeldUse = Extract<Command, { readonly type: 'act' | 'release' }>;
/**
 * The fight's open dodge prompt: `n` increments on every ask (unique per prompt, including sequential hunters in one
 * area), `use` is the held command re-run once every caught hunter has picked, and `to` maps hunters who already picked
 * in this use to their chosen tiles. Who is asked next and their legal tiles are derived via `dodgeAsk` (fight.ts).
 */
export type DodgeWait = { readonly n: number; readonly use: HeldUse; readonly to: Readonly<Record<CombatantId, Place>> };
/**
 * Under way: `now` is the time of the current turn, `currentId` whose it is. `pending` are the per-round ops due at a
 * turn start whose dice the edge has been asked to roll (a `rollSettle` effect) and that a `settle` command pays.
 * `dodge`, when present, holds a use waiting for a caught hunter to pick its dodge tile; `dodges` counts prompts opened
 * so every prompt gets a fresh monotonic `n`. `sizedFor`, when present, is the weighted party headcount locked at
 * `start` for a gate fight; mid-fight joins never change it.
 */
export type Running = Shared & {
  readonly phase: 'running'; readonly now: Tick; readonly currentId: CombatantId; readonly pending: readonly DueTurn[]; readonly fudge: Fudge;
  readonly dodge?: DodgeWait; readonly dodges?: number; readonly sizedFor?: number;
};
/**
 * Over: a side had nobody up, or the GM ended it. The rows and the log stay for the summary screen until `clear`. It
 * holds no `fudge`: the GM's weight ends with the fight, and the next one starts at 0.
 */
export type Ended = Shared & { readonly phase: 'ended'; readonly now: Tick; readonly summary: Summary; readonly sizedFor?: number };

/** The faces a GM may force a row's next d20 roll to (notes-8-fudge.md section 2). */
export const FORCED_FACES = [1, 20] as const;
/** A row's next d20 roll as the GM forced it: 20 reads as well as it can for that row, 1 as badly. */
export type ForcedFace = (typeof FORCED_FACES)[number];
/**
 * The GM's hidden weight on a fight's dice (docs/agent-handoff/features/notes-8-fudge.md section 2): a whole number of
 * faces for each side and for a row (no entry: 0), the two added; plus means the dice fall that body's way. `forced`: a
 * row's next d20 roll, set to 20 or 1 for that one roll. Only the GM's phone holds it; the fight's doc copies none of it.
 */
export type Fudge = {
  readonly sides: Readonly<Record<Side, number>>;
  readonly rows: Readonly<Record<CombatantId, number>>;
  readonly forced: Readonly<Record<CombatantId, ForcedFace>>;
};
/** Whose weight a `fudge` command sets: a side's or one row's. */
export type FudgeScope = { readonly kind: 'side'; readonly side: Side } | { readonly kind: 'row'; readonly id: CombatantId };
/** What a `fudge` command sets: a weight to `n` faces, or a row's forced next roll (null takes it off). */
export type FudgeSet =
  | { readonly kind: 'weight'; readonly scope: FudgeScope; readonly n: number }
  | { readonly kind: 'force'; readonly id: CombatantId; readonly face: ForcedFace | null };
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
 * down, the XP of the foes that went down (those still in the fight and those removed while down), and the fatigue each
 * living hunter recovered when the fight ended (`fightRest`, absent when nobody recovered any).
 */
export type Summary = {
  readonly rounds: number; readonly winner: Side | null; readonly down: readonly CombatantId[]; readonly xp: number;
  readonly rested?: Readonly<Record<CombatantId, number>>;
};

/** `Omit` on each member of a union, so a row's kind keeps the life that goes with it (effect-ops.ts `BodyLife`). */
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A row as the edge hands it in: the fight works out its stats, sheet and speed, and gives a place to one without. */
export type NewRow = OmitEach<Body, 'at' | 'tie' | 'speed' | 'stats' | 'sheet' | 'place'> & { readonly place: Place | null };
/** The opening roll of one row: its d20 (the fight adds its Instinct bonus) and the d1000 that breaks ties. */
export type Opening = { readonly id: CombatantId; readonly d20: number; readonly tie: number };

/** What the reducer may know besides the fight: the rules. A row's life is the row's own (row-life.ts). */
export type Ctx = { readonly rules: Rules };

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
    /** Marks a gate fight to scale foes in core at `start` (or scales newly joined gate foes to the running fight's locked `sizedFor`). */
    readonly partyScaled?: boolean;
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
    /** The uses spent of one of its abilities limited a fight or a gate (kits table 2.3, "the GM sets it"), 0 to `fightUses`. */
    readonly used?: { readonly ability: AbilityId; readonly spent: number };
    /** The mana taken is a price paid outside the fight (a shadow summoned): refused (`mana`) when the row holds less. */
    readonly pay?: boolean;
  }
  /**
   * A level-up's refill of hunter row `id` (a grant to its hunter, fight-save.ts `heldCommands`): the sheet's refill
   * (vitals.ts `refilled`) on the row as it stands when the command is reduced, so its maxima are those the statuses
   * before it in the batch left. No time passes. A row already full changes nothing and is not refused.
   */
  | { readonly type: 'refill'; readonly id: CombatantId }
  /**
   * The GM's Revive of dead row `id` (a hunter or a foe): its life up at the revive HP (row-life.ts `rowLifeAfter`) and
   * every status taken off, so a poison does not kill it again. Refused (`lifeCannot`) when the row is not dead. No time
   * passes; a row stood up rejoins the turns.
   */
  | { readonly type: 'revive'; readonly id: CombatantId }
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
   * An attempt to extract a shadow or blood from fallen monster `id` with `roll` (and optional GM `adjust` or `force`
   * overriding the corpse's standing adjustment/force): the reducer computes the outcome (roll-adjust.ts `extractionCheck` /
   * `bloodExtractionCheck`), records it on the row (`extraction` for `'shadow'`, independent `bled: true` for `'blood'`),
   * clears `corpse.adjust` and `corpse.force`, and logs the GM breakdown with a player-safe `table` line. Blood
   * extraction is post-fight only (`phase === 'ended'`); shadow extraction may run in setup, running, or ended. No time passes.
   */
  | { readonly type: 'extract'; readonly what: ExtractKind; readonly id: CombatantId; readonly by: CombatantId; readonly roll: ExtractRoll; readonly adjust?: number; readonly force?: ForcedFace | null }
  /**
   * The GM sets a hidden signed adjustment (any whole number) or forced natural face (20 or 1, or null to clear) for the
   * next extraction or Arise roll on monster `id`. It sets, never adds, and 0 / null clears it. No time passes and nothing
   * is logged until a roll consumes it.
   */
  | { readonly type: 'adjustRoll'; readonly id: CombatantId; readonly n?: number; readonly force?: ForcedFace | null }
  /**
   * The GM sets the fight's hidden weight (`Fudge`): a side's or a row's to `n` faces, or a row's forced next roll. It
   * sets, never adds. No time passes and nothing is logged.
   */
  | { readonly type: 'fudge'; readonly set: FudgeSet }
  /**
   * The GM sets NPC `id`'s hidden play skill (1 Sloppy to 5 Optimal). Allowed in setup and running (outside dodging).
   * No time passes, nothing is logged, and nothing changes on the room's fight doc.
   */
  | { readonly type: 'setNpcSkill'; readonly id: CombatantId; readonly skill: NpcSkill }
  /**
   * The GM's hand on mythic `by`'s script (notes-11-keystones.md, design B.4, "The GM's hand"): `drop`, the omen standing
   * is dropped and nothing lands; `next`, it enters its next phase now, its HP brought down to that phase's start. Both
   * are the events its turns raise (mythic.ts `MythicEvent`), logged; no time passes.
   */
  | { readonly type: 'mythic'; readonly by: CombatantId; readonly step: 'drop' | 'next' }
  /**
   * Answers the fight's open dodge prompt (`Running.dodge`): hunter `id` (or whoever is currently asked when `id` is
   * null, the GM's override) takes tile `to` (or the automatic nearest tile `tiles[0]` when `to` is null).
   */
  | { readonly type: 'dodge'; readonly id: CombatantId | null; readonly to: Place | null }
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
  | 'notExtractor'
  /** A refill of a row no hunter holds: a level-up is a hunter's. */
  | 'notHunter'
  /** A `revive` of a row that is not dead. */
  | 'lifeCannot'
  /** A `fudge` whose weight is not a whole number, or whose forced face is not 1 or 20. */
  | 'fudgeValue'
  /** An `adjustRoll` or `extract` adjustment that is not a whole number, or a forced face that is not 1 or 20. */
  | 'adjustValue'
  /** A mythic's machine refused the event (mythic.ts `MythicRefusal`): no omen to drop, one standing, its last phase. */
  | MythicRefusal
  /** A `mythic` command on a row that plays no script. */
  | 'notMythic'
  /** On a mythic's landing turn, any use but its omen's move at the omen's aim. */
  | 'omenDue'
  /** A `dodge` command when no dodge is open, for the wrong hunter, or to a tile outside the offered dodge set. */
  | 'noDodge'
  /** Any command other than `dodge`, `end`, or `clear` while a dodge prompt waits for a pick. */
  | 'dodging'
  /** Adding a shadow whose owning hunter row is not in the fight. */
  | 'ownerOut'
  /** Removing a hunter row while any of that hunter's shadows remain in the fight. */
  | 'shadowsIn'
  /** Adding a shadow when its owner already fields `min(sheet.shadows, MAX_FIELD_SHADOWS)` shadows in the fight. */
  | 'shadowCap'
  /** A `setNpcSkill` command on a row that is not an NPC. */
  | 'notNpc'
  /** A `setNpcSkill` command whose skill is not a whole number from 1 to 5. */
  | 'npcSkillValue';
// `extra` (a second extra action in a round, kits design 8.6.1) is a use's refusal, in `UseRefusal`.

export type Effect =
  /** The turn of `id` began at `now`; `hunterId` when it is a hunter on this phone. */
  | { readonly type: 'turnStarted'; readonly id: CombatantId; readonly hunterId: HunterId | null; readonly now: Tick }
  /** A per-round op of `key` on `id` paid for `share` of a round. With dice the edge rolls them and sends `settle`; with none it is paid already. */
  | { readonly type: 'rollSettle'; readonly id: CombatantId; readonly key: StatusKey; readonly dice: readonly Dice[]; readonly share: number }
  /**
   * The one write-back of a hunter on this phone: its life (its HP with it), mana, fatigue and statuses as the fight holds
   * them, as totals so a repeat changes nothing.
   */
  | {
    readonly type: 'vitals'; readonly hunterId: HunterId; readonly life: Life; readonly mana: number; readonly fatigue: number;
    readonly statuses: readonly SheetStatus[];
    /** The uses spent of its abilities limited a gate (`Vitals.used`, kits table 2.3); absent when it has none. */
    readonly used?: Readonly<Record<AbilityId, number>>;
  }
  /** The same for a hunter on another phone: the room's `vitals` message (protocol.ts), whose life the player's sheet takes. */
  | {
    readonly type: 'sendRemote'; readonly remote: SheetKey; readonly life: Life; readonly mana: number; readonly fatigue: number;
    readonly statuses: readonly SheetStatus[];
  }
  /** The write-back of a shadow of a hunter on this phone: its HP as a total. */
  | { readonly type: 'shadowHp'; readonly hunterId: HunterId; readonly shadowId: ShadowId; readonly hp: number }
  /** The write-back of a shadow of a hunter on another phone: the room's `shadowHp` message (protocol.ts). */
  | { readonly type: 'sendRemoteShadow'; readonly remote: SheetKey; readonly shadowId: ShadowId; readonly hp: number }
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
  /** Mythic `id` entered phase `phase` of its script (an index), at its turn or by the GM's hand: the screens mark it. */
  | { readonly type: 'phased'; readonly id: CombatantId; readonly phase: number }
  /** Mythic `id` announced omen `omen` of its script: it lands on its next turn unless answered. */
  | { readonly type: 'omen'; readonly id: CombatantId; readonly omen: OmenKey }
  /** A change met an answer (`how`) to mythic `id`'s omen (`omen`), which it canceled or weakened. */
  | { readonly type: 'omenAnswered'; readonly id: CombatantId; readonly omen: OmenKey; readonly how: Answer; readonly outcome: Exclude<AnswerOutcome, 'none'>; readonly line: string }
  /** Prompt `n` opened for hunter `who` (`mode`: best outcome reachable, `reach`: capped dodge tiles, `left`: movement bank left). */
  | { readonly type: 'dodgeAsked'; readonly n: number; readonly who: CombatantId; readonly mode: Dodge; readonly reach: Tiles; readonly left: Tiles }
  | { readonly type: 'ended'; readonly summary: Summary }
  | { readonly type: 'refused'; readonly reason: Refusal };
export type EffectType = Effect['type'];
export type Result = { readonly fight: Fight | null; readonly effects: readonly Effect[] };

// ── limits ──
export const MAX_ROWS = 60;
export const NAME_MAX = 60;
export const STATUS_DESC_MAX = 500;
export const LOG_CAP = 100;
export const LOG_LINE_MAX = 300;
export const MAX_STATUSES = 30;
export const MAX_ABILITIES = 12;
export const MAX_PENDING = 200;
/** At most this many spreading statuses a fight remembers who has held (design 4.8); another one does not spread. */
export const MAX_SPREAD = 16;
/** Maximum shadows one hunter may field in a single fight (bounded further by that hunter's sheet `shadows`). */
export const MAX_FIELD_SHADOWS = 4;
/** Maximum shadows a hunter with sheet capacity `shadows` may field in one fight. */
export const shadowFieldCap = (shadows: number): number => Math.min(Math.max(0, Math.floor(shadows)), MAX_FIELD_SHADOWS);
