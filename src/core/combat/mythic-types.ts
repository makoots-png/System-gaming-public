// mythic-types.ts: what a mythic's script is, and where a mythic row stands in it (notes-11-keystones.md, design B.3).
// Types only. A script is one row of `MYTHICS` (src/core/registry/mythics.ts); the machine that moves a row through it
// is combat/mythic.ts. The script is written with its own move and omen keys as plain words, and the
// compiler checks each omen lands a move the script holds and each beat names an omen it holds (`MythicScript<M, O>`);
// the registry's `mythicScript` brands the keys once, so a stored script reads `MoveKey` and `OmenKey`.
import type { Id } from '../ids.ts';
import type { AbilityKind, CombatantId, DamageType } from './ability-types.ts';
import type { Op, StatusDef, StatusKey } from './effect-ops.ts';
import type { Place } from './space.ts';
import type { Tick } from './timeline.ts';
import type { BuiltInStatus } from '../registry/statuses.ts';
import type { MythicScriptId } from '../registry/mythics.ts';

export type { MythicScriptId };
/** An omen of one script, by the key its script writes it under ("stars"). */
export type OmenKey = Id<'OmenKey'>;
/** A move of one script, by the key its script writes it under ("stars-fall"). */
export type MoveKey = Id<'MoveKey'>;

/**
 * One mythic's fight, as data. A new mythic is one of these in `MYTHICS` (registry/mythics.ts) and one test to copy.
 * `M` and `O` are the script's own move and omen keys while it is written; stored, they are `MoveKey` and `OmenKey`.
 */
export type MythicScript<M extends string = MoveKey, O extends string = OmenKey> = {
  /** What the codex and the card call the fight: "The Angel of the Last Trumpet". */
  readonly name: string;
  /** One sentence for the codex: what kind of fight it is ("A countdown: every phase is short, and the clock ends it."). */
  readonly shape: string;
  /** A factor on `fight.kinds.mythic.hp`: the script's one balance lever, moved by the sim until row B1 holds (B.8). */
  readonly hp: number;
  /** The moves its omens land, by key. Its act beats use the monster's own abilities (`acts` of a phase). */
  readonly moves: Readonly<Record<M, MythicMove>>;
  readonly omens: Readonly<Record<O, Omen<M>>>;
  /**
   * Its phases in order, within `mythic.bounds.phases`. The last is a gate phase, so the fight ends at 0 HP and never on
   * a clock.
   */
  readonly phases: readonly [...MythicPhase<O>[], GatePhase<O>];
  /** The rotation of any gate phase whose clock ran out: its doom, usually one omen beat. */
  readonly enraged: Rotation<O>;
};

/** What every phase has, whichever way it ends. */
type PhaseCommon<O extends string> = {
  /** "The First Breath": the card's and the log's name of the phase. */
  readonly name: string;
  /** One sentence a player reads when it begins: "It draws breath. It is faster, and the note is closer." */
  readonly line: string;
  /** Rounds: a gate phase is enraged past it, a clock phase ends at it. */
  readonly clock: number;
  /** Statuses it wears for the phase, put on as the phase begins and taken off as it ends (keystones A's `Phase.worn`). */
  readonly worn: readonly MythicStatus[];
  /** The names of its own abilities an act beat may use in this phase; `every`: all of them (the `plain` script). */
  readonly acts: readonly string[] | 'every';
  readonly rotation: Rotation<O>;
  /** The stagger bar's size in this phase, a factor on its kind's bar (rows.ts `staggerOf`). The bar empties as the phase begins. */
  readonly bar: number;
};
/**
 * A phase that holds a band of its HP: from `from` (a share of max HP: 1 for the first) down to the next gate phase's
 * `from` (0 for the last), its gate. It ends when its HP is held at the gate and its turn comes.
 */
export type GatePhase<O extends string = OmenKey> = PhaseCommon<O> & { readonly ends: 'gate'; readonly from: number };
/**
 * A phase to survive: it holds no band of HP. Its HP stays where it began, which is the next gate phase's `from`, and
 * no damage moves it; it ends when its clock runs out (Zaratan's Dive).
 */
export type ClockPhase<O extends string = OmenKey> = PhaseCommon<O> & { readonly ends: 'clock'; readonly from?: never };
export type MythicPhase<O extends string = OmenKey> = GatePhase<O> | ClockPhase<O>;

/** A status a phase wears or a move puts on its user: its key (each starts `mythic-`) and its def. */
export type MythicStatus = { readonly key: StatusKey; readonly def: StatusDef };
/** A phase's turns, in order, read at `beat` modulo its length. */
export type Rotation<O extends string = OmenKey> = readonly [Beat<O>, ...Beat<O>[]];
/** One turn of a rotation: an act is a normal turn; an omen beat announces that omen. */
export type Beat<O extends string = OmenKey> = { readonly kind: 'act' } | { readonly kind: 'omen'; readonly omen: NoInfer<O> };

/** Who an omen aims at, chosen when it is announced (MY2 `omenAim`). Ties go to row order. */
export type OmenAim =
  | 'threat'    // the body its threat table suggests
  | 'weakest'   // the party body up with the lowest share of its max HP
  | 'farthest'  // the party body up farthest from it
  | 'crowd'     // the tile, among the party's tiles, whose area catches the most party bodies
  | 'self'      // its own tile: an area around itself
  | 'all';      // every party body: the move's reach is the whole field, aimed at itself
/** What an answer does to the omen standing. */
export type AnswerOutcome = 'cancel' | 'weaken' | 'none';
/** The status ops that answer an omen when a status holding one lands on the mythic (a stun holds, a root roots). */
export type Interrupt = Extract<Op['op'], 'hold' | 'root' | 'taunt'>;
/**
 * An announced move and the answers that change it (design B.4), each answer's outcome written for every omen, `none`
 * included. Decision 43: an omen aimed at a hunter or its tile may be answered by a turn that is not an attack (`shield`,
 * `step`); one aimed at the mythic itself has no hunter or tile to answer for, so the type holds those two at `none`.
 */
export type Omen<M extends string = MoveKey> = OmenAnswers<M> & (AimedOmen | SelfOmen);
type OmenAnswers<M extends string> = {
  /** The banner's name: "Stars Fall". */
  readonly name: string;
  /** The move that lands when nothing answered it, and the one that lands when it was weakened (null: none can weaken it). */
  readonly full: NoInfer<M>;
  readonly weak: NoInfer<M> | null;
  /** A status with one of these ops landing on it while the omen stands. */
  readonly interrupt: { readonly by: readonly Interrupt[]; readonly outcome: AnswerOutcome };
  /**
   * Its stagger bar taking `mythic.answerReach.stagger` same-rank hits after the announce (decision 42: a bar filled
   * before the omen answers nothing).
   */
  readonly stagger: AnswerOutcome;
  /** `mythic.answerReach.burst` of its max HP taken from it after the announce (HP it healed counts against it). */
  readonly burst: AnswerOutcome;
};
/** An omen aimed at one hunter (a curse) or at a hunter's tile (a blast). */
type AimedOmen = {
  readonly aim: Exclude<OmenAim, 'self' | 'all'>;
  /** A shield landing on the hunter it is aimed at (on a blast, the one standing on its tile) after the announce. */
  readonly shield: AnswerOutcome;
  /**
   * The tile it is aimed at left with no hunter on it, standing or fallen, after the announce. Only a blast aims at a
   * tile (a curse follows its hunter), so only a blast's omen writes one (tests/mythics.test.ts).
   */
  readonly step: AnswerOutcome;
};
/** An omen aimed at the mythic itself: an area around it (`self`) or the whole field (`all`). */
type SelfOmen = { readonly aim: 'self' | 'all'; readonly shield: 'none'; readonly step: 'none' };

/** What every move has, whatever its kind. */
type MoveCommon = {
  readonly name: string;
  readonly type: DamageType;
  /** Tiles from the mythic to its aim. */
  readonly range: number;
  /** Its damage as a share of the sample S hunter's max HP before armor and resist (0: a move of statuses only). */
  readonly hits: number;
  /** Nothing avoids it (`delivery: sure`): only a shield, an HP pool or being out of its reach answers it. */
  readonly sure: boolean;
  readonly applies: { readonly status: BuiltInStatus; readonly rounds: number } | null;
  /** A zone it leaves where it lands (registry/abilities.ts `MonsterSpec`'s `leaves`). */
  readonly leaves: { readonly name: string; readonly rounds: number; readonly status: BuiltInStatus } | null;
  /** A status it puts on itself when it lands (a doom's Crescendo, so each one lands harder). */
  readonly self: MythicStatus | null;
};
/**
 * A move an omen lands. Built into an `Ability` when it is needed (registry/mythic-moves.ts `mythicMove`), never saved as
 * one. A blast reaches tiles around its aim (`field`: every tile, with aim `all`); a strike, shot or curse lands on one
 * body, so its reach is 0.
 */
export type MythicMove = MoveCommon & (
  | { readonly kind: 'blast'; readonly reach: number | 'field' }
  | { readonly kind: Exclude<AbilityKind, 'blast' | 'support'>; readonly reach: 0 }
);

/**
 * Where a mythic row stands in its script (`Body.mythic`); null on any other row. Only combat/mythic.ts writes it
 * (`mythicStep`, and `mythicStart` and `mythicJoined` for a new row). `phase` and `beat` index the script's phases and the phase's rotation (modulo its
 * length); `since` is when its phase's clock began counting: the phase's start, moved later by each answer met
 * (mythic.ts `answerBack`, decision 40), never past the fight's now. While an omen stands, `aim` is where it was
 * aimed, and `hpAt` and `barAt` the mythic's HP and stagger bar then (null: it has none), which the burst and the
 * stagger answers count from (decision 42).
 */
export type MythicStanding =
  | { readonly at: 'calm'; readonly script: MythicScriptId; readonly phase: number; readonly beat: number; readonly since: Tick }
  | {
    readonly at: 'omen' | 'faltering'; readonly script: MythicScriptId; readonly phase: number; readonly beat: number; readonly since: Tick;
    readonly omen: OmenKey; readonly aim: Place | CombatantId; readonly hpAt: number; readonly barAt: BarAt | null;
  };
/** A stagger bar as an omen found it: its fill and its max. */
export type BarAt = { readonly fill: number; readonly max: number };
