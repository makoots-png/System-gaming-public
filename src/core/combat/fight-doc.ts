// fight-doc.ts: the fight as the players' table sees it, the room doc the GM's phone publishes (docs/agent-handoff/rw/
// design.md section 5.4, m2-plan.md section 1.3). `fightDoc` is the one place that turns a `Fight` into that doc: which
// rows it carries, what a player may see of each (a monster's HP only as a band) and the bounds that keep it under the
// server's `DOC_MAX` (protocol.ts). Pure; the edge passes the phone, the time stamp and the sheet keys. The doc's reader is in
// `DOCS` of src/core/protocol.ts and reads it with the bounds exported here. A new field is a member of `FightDoc` or
// `FightDocRow`, its line in `fightDoc` or `docRow`, and a case in tests/fight-doc.test.ts.
import { RULES } from '../rules.ts';
import type { Rules } from '../rules.ts';
import { STAT_KEYS } from '../stats.ts';
import { STAT_PAIRS } from '../hunter/keystones.ts';
import { keystoneOf } from '../registry/keystones.ts';
import { classStatusDef } from '../registry/class-powers.ts';
import { parseSheetKey } from '../ids.ts';
import type { DeviceId, FightId, SheetKey } from '../ids.ts';
import { ahead, roundsOf, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { dodgeOptions, place, TERRAIN, terrainOfChar } from './space.ts';
import type { Cover, Dodge, DodgeOptions, Grid, Place, Side, Tiles } from './space.ts';
import { anchorOf, zoneTiles, zoneTone } from './zones.ts';
import type { ZoneId, ZoneTone } from './zones.ts';
import type { AbilityId, CombatantId, HunterId } from './ability-types.ts';
import { stacked } from './op-amount.ts';
import { GRIEVOUS_LEGACY_MAX, GRIEVOUS_MAX, grievousCutOf, hasTieredGrievousCut, isGrievousKey, withGrievousCut } from './grievous.ts';
import { isUp, rowHp } from './row-hp.ts';
import { freeStatusKey } from './effect-ops.ts';
import type { Body, CombatantKind, LandOp, StatusDef, StatusKey } from './effect-ops.ts';
import type { FoeLifeState } from './row-life.ts';
import type { IconKey } from '../registry/icons.ts';
import { rowIcon } from './row-icon.ts';
import type { HunterOf } from './row-icon.ts';
import { LIFE_STATES } from '../hunter/vitals.ts';
import type { LifeState } from '../hunter/vitals.ts';
import { partyView } from './fight-turn.ts';
import { alive } from './land.ts';
import { counting } from './standing.ts';
import { perceivedBy } from './sight.ts';
import { cardOf, channelView, intentOf, tauntOf, usesLeft } from './fight-view.ts';
import { NAME_MAX } from './fight-types.ts';
import type { Fight, Refusal, Running } from './fight-types.ts';
import { dodgeAsk } from './fight.ts';
import type { DodgeAsked } from './resolve.ts';
import { MYTHIC_STATES } from './mythic.ts';
import type { MythicStanding } from './mythic-types.ts';
import { canRiseInFight } from './rise.ts';

// ── bounds (the doc's reader uses the same numbers) ──
/**
 * Rows the doc carries; the fight itself holds up to `MAX_ROWS` (60). 30 worst-case rows with the kits' stack counts and
 * uses left fit the server's cap with an eighth to spare (kits design 1.11; it was 32 before the stacks): still 4 hunters,
 * 4 shadows, 4 summons and 18 monsters, more than a phone draws.
 */
export const DOC_ROWS = 30;
/** Statuses shown per row. */
export const DOC_STATUSES = 12;
/** Turns in the order ahead. */
export const DOC_AHEAD = 8;
/** The newest log lines. Names, labels, keys and log lines keep the fight's own bounds (fight-types.ts). */
export const DOC_LOG = 5;
/** Abilities of the current row whose cooldown is running: at most every ability a row holds (rows.ts). */
export const DOC_READY = 12;
/** A revealed intent's lines of numbers (fight-view.ts `abilityLines`, at most four), each at most this long. */
export const DOC_INTENT_LINES = 4, INTENT_LINE_MAX = 80;
/** The longest run text of a zone's tiles (`runsOf`): a blast's is about 60 characters, a painted room's a few runs a row. */
export const DOC_ZONE_RUNS = 200;
/** The longest run text for each blast area (`hit`, `ring`) in `DocDodge`, fitting Kamish's radius-9 Dragon Breath on a 40×40 grid while keeping the worst-case doc under 8/9 of `DOC_MAX`. */
export const DOC_DODGE_RUNS = 300;
/** The most tiles a doc's tile text and lit line describe: a 40 by 40 map, the largest a saved map is (registry/maps.ts). */
export const DOC_TILES_MAX = 1600;
/**
 * Mythic standings the doc carries, the first rows' in the doc's order (a row past them shows as a plain monster). A
 * standing is at most about 120 characters on the wire, so four fit in what the worst-case doc has to spare (protocol.ts
 * `DOC_MAX`); a fight holds one mythic or two.
 */
export const DOC_MYTHICS = 4;
/** The character of a tile the party has never seen, in the doc's tile text. */
export const UNSEEN = '?';

// ── the band ──
export const BANDS = ['healthy', 'wounded', 'bloodied', 'critical', 'down'] as const;
/** How hurt a combatant looks to players who do not see its HP. */
export type Band = (typeof BANDS)[number];
/**
 * Each band above `down` and the share of max HP, in percent, a body must be above to be in it; the thresholds of the
 * old fight's table (combat.js). At 0 HP a body is `down`.
 */
const BAND_ABOVE: readonly (readonly [Band, number])[] = [['healthy', 75], ['wounded', 50], ['bloodied', 25], ['critical', 0]];
export function band(hp: number, hpMax: number): Band {
  if (hp <= 0) return 'down';
  const pct = hp / hpMax * 100;
  return BAND_ABOVE.find(([, above]) => pct > above)![0];
}

// ── the doc ──
/**
 * A status as the table shows it: what it is called, the rounds left with one decimal (null until removed), a stacking
 * one's count (kits design 1.11; absent on a plain status), its source's tier, and its def as the GM's phone holds it, so a
 * player's phone says what the GM's own status does (absent on a player's phone when the doc's table of defs had no room
 * for it, `DOC_DEFS_MAX`).
 */
export type DocStatus = {
  readonly key: StatusKey; readonly label: string; readonly left: number | null; readonly stacks?: number; readonly tier: number; readonly def?: StatusDef;
};
/** A tile, as plain numbers on the wire. */
export type DocPlace = { readonly x: number; readonly y: number };
/**
 * What a monster announced: its ability's name and its aim, a row of the fight or a tile. `reveal` is null until the GM
 * reveals its numbers, so a player's phone never holds them before: then the lines of fight-view.ts `abilityLines` and
 * an area ability's splash radius and outer ring. `charge` marks a channel shown as the intent.
 */
export type DocIntent = {
  readonly name: string; readonly target: CombatantId | DocPlace;
  readonly reveal: { readonly lines: readonly string[]; readonly radius: number | null; readonly outer: number | null } | null;
};
/**
 * A channel on a row: its ability (a player's phone sends a tap on it as the Release) and name, the charge of its max, its
 * state and its payoff as a factor (fight-view.ts `channelView`).
 */
export type DocChannel = { readonly ability: AbilityId; readonly name: string; readonly charge: number; readonly max: number; readonly state: 'holding' | 'broken' | 'fired'; readonly factor: number };
/** A taunt on a row: who taunted it and the rounds left (null until removed). */
export type DocTaunt = { readonly by: CombatantId; readonly left: number | null };
/**
 * Where a mythic stands in its script, as the table shows it: the standing's own fields (combat/mythic-types.ts
 * `MythicStanding`), except what a player may not see. While an omen stands `aim` is the row or tile it was aimed at, null
 * when that row is one the party does not perceive (its place is not the party's to know), and `band` is how the mythic
 * looked when it was announced, never its HP (`hpAt`): a monster's HP is a band on every phone.
 */
type StandingCommon = Omit<Extract<MythicStanding, { readonly at: 'calm' }>, 'at'>;
export type DocStanding =
  | (StandingCommon & { readonly state: 'calm' })
  | (StandingCommon & {
    readonly state: 'omen' | 'faltering'; readonly omen: Extract<MythicStanding, { readonly omen: unknown }>['omen'];
    readonly aim: CombatantId | DocPlace | null; readonly band: Band;
  });
type DocRowBase = {
  readonly id: CombatantId;
  readonly name: string;
  readonly side: Side;
  /** The sheet key of a hunter in the room (on the GM's phone or a player's), else null. */
  readonly key: SheetKey | null;
  readonly place: DocPlace;
  readonly at: Tick;
  readonly speed: number;
  readonly band: Band;
  readonly statuses: readonly DocStatus[];
  /** The amount a live shield holds, or null, and its rounds left. */
  readonly shield: number | null;
  readonly shieldLeft: number | null;
  readonly channel: DocChannel | null;
  readonly taunt: DocTaunt | null;
  /**
   * The row's picture as the GM's phone answers it (row-icon.ts `rowIcon`: a monster's pick, else its type's or its
   * archetype's; a hunter's emblem), or null for a hunter with none, whose initials show. The doc carries the answer
   * because a player's phone cannot work one out: the row holds no type, archetype or sheet. Every row may carry one, so
   * the worst doc counts one on every row (`DOC_MAX`); off the wire at null (`ic`).
   */
  readonly icon: IconKey | null;
};
/** A body's HP, its maximum, its stride and `move`: what players see of a party hunter, a shadow and a summon. */
type DocBody = { readonly hp: number; readonly hpMax: number; readonly stride: number; readonly move: number };
/**
 * One combatant on the players' table. Players see a party hunter's or shadow's exact HP, and only a foe's band
 * (monsters and foe hunters omit `hp`, `hpMax`, `stride` and `move` so dead-hunter tile blocking stays synced without
 * leaking foe HP). A party hunter's or shadow's `stride` is the tiles one move may walk as its fight sheet holds it now
 * (a slow or a root included), which a player's phone needs for its Toward and Away and its movement area on the map;
 * `move` is its sheet's `move` in whole tiles, as far as a dash runs (design 4.6), for the map's lighter dash area.
 * `life` is the row's life's state by its kind's table (row-life.ts `LifeAt`): dead for every kind (a foe's reads
 * Defeated); every phone reads its word from row-life.ts `lifeWord` and whether it is up from row-hp.ts `isUp`.
 */
export type FightDocRow = DocRowBase & (
  | {
    readonly kind: 'monster'; readonly life: { readonly at: FoeLifeState }; readonly intent: DocIntent | null;
    /** The bar, and while a break holds the monster back the rounds it costs (fight-view.ts `Card`). */
    readonly stagger: { readonly fill: number; readonly max: number; readonly staggered: number | null } | null;
    /** The target its threat table suggests (fight-view.ts `threatOf`); the table itself stays on the GM's phone. */
    readonly suggest: CombatantId | null;
    /** The standing of a mythic's row in its script (`DocStanding`); absent on a row that plays no script (and on the wire). */
    readonly standing?: DocStanding;
    /** Set when this dead monster corpse is currently eligible for Arise (`canRiseInFight`). */
    readonly canRise?: true;
  }
  | (DocBody & { readonly kind: 'hunter'; readonly life: { readonly at: LifeState }; readonly stagger?: undefined })
  | { readonly kind: 'hunter'; readonly life: { readonly at: LifeState }; readonly stagger?: { readonly fill: number; readonly max: number; readonly staggered: number | null } | null; readonly hp?: undefined; readonly hpMax?: undefined; readonly stride?: undefined; readonly move?: undefined }
  | (DocBody & { readonly kind: 'shadow'; readonly life: { readonly at: FoeLifeState } })
  /**
   * A summon (kits design 1.9) as a shadow is shown, with the row that owns it (that hunter's phone commands it) and the
   * rounds it has left, one decimal (null for one that stays).
   */
  | (DocBody & { readonly kind: 'summon'; readonly life: { readonly at: FoeLifeState }; readonly owner: CombatantId; readonly left: number | null })
);
/**
 * Why the GM's phone turned down a player's `cast` or `step`: the refusals a player's tap can meet. Each has its words on
 * the player's phone (table.js).
 */
export const TABLE_REFUSALS = [
  'range', 'notYourTurn', 'cooldown', 'mana', 'taunted', 'noTarget', 'unknownAbility', 'down', 'rooted', 'blocked', 'tooFar', 'noMove', 'offGrid', 'taken',
  // the kits' (kits design 1.4): a gate that does not hold, uses spent, an HP price at the HP it would take, too few stacks, no zone to end
  'gated', 'noUses', 'hp', 'stacks', 'zone',
  // wave 2's (kits design 8.6, 8.7): a second extra action in a round, a hide while a foe sees the tile
  'extra', 'seen',
  // rank-capped consumables (potion-prices): the user's rank is above the consumable's rank
  'tooLow',
  // dodge-tile picker: a dodge sent when none is open, or another command while a dodge waits
  'noDodge', 'dodging',
  // fallback refusals so a player's tap is never silently dropped and stranded in TurnHold
  'notNow', 'noChannel',
] as const satisfies readonly Refusal[];
export type TableRefusal = (typeof TABLE_REFUSALS)[number];
/**
 * The last tap of a player the GM's phone turned down: the row it was for, the fight's time then, the reason, and a count
 * the GM's phone raises for each, so two refusals at one time are two pieces of news. `text` carries the exact plain
 * refusal message (needed vs held counts) when available. A doc carries it only while the
 * fight's time is still `at`: a refusal changes nothing, so it is news only until the fight moves on.
 */
export type DocRefusal = { readonly id: CombatantId; readonly at: Tick; readonly reason: TableRefusal; readonly n: number; readonly text?: string };
/**
 * A zone as the table sees it: its id and name, the tiles of it the party sees now as runs (`runsOf`), its tone for the
 * colour, its rounds left (null until removed), and the row it moves with (an aura's body, when the doc carries that
 * row; else null).
 */
export type DocZone = {
  readonly id: ZoneId; readonly name: string; readonly tiles: string; readonly tone: ZoneTone; readonly left: number | null; readonly anchor: CombatantId | null;
};
/**
 * The map as the table sees it: its size; `tiles`, one terrain character a tile with `UNSEEN` where the party never saw,
 * or null for open floor with no fog; `lit`, one '1' or '0' a tile for what the party sees now, or null with no fog.
 */
export type DocGrid = { readonly w: number; readonly h: number; readonly tiles: string | null; readonly lit: string | null };
/**
 * The fight the GM runs, as the players' table shows it. `active` while it runs; in setup nobody has a turn, `now` is 0,
 * `currentId` is null and `ahead` is empty. An ended fight keeps only its id and when the doc was made.
 */
export type FightDoc =
  | { readonly ended: true; readonly active: false; readonly id: FightId; readonly at: string }
  | {
    readonly ended: false; readonly active: boolean; readonly by: DeviceId; readonly id: FightId; readonly at: string;
    readonly now: Tick; readonly currentId: CombatantId | null; readonly ahead: readonly CombatantId[];
    readonly grid: DocGrid; readonly zones: readonly DocZone[]; readonly rows: readonly FightDocRow[]; readonly log: readonly string[];
    readonly refused: DocRefusal | null;
    /** When each ability of the current row on cooldown is ready again, by ability id: the player's phone draws its wait. */
    readonly ready: Readonly<Record<string, Tick>>;
    /**
     * The uses left of each ability of the current row limited a fight or a gate (kits table 2.3), by ability id, 0 for a
     * spent one; absent when it has none.
     */
    readonly left?: Readonly<Record<string, number>>;
    /**
     * The party's rows whose armed reaction is ready (kits design 8.4.8), at most `kit.doArmed`: a teammate's card says
     * "Ready to react". Not which one: a player's phone knows what it armed. A foe's is shown to nobody. Absent when none.
     */
    readonly armed?: readonly CombatantId[];
    /**
     * The party's rows whose armed reaction fired since their last turn began (kits table 8.9.1, `spent`), at most
     * `kit.doArmed`: a card says "Reacted", and a row that moves from `armed` to here is a reaction firing. Absent when none.
     */
    readonly spent?: readonly CombatantId[];
    /**
     * The reaction each row of `armed` and `spent` holds armed, by row (implicit audit 3, T1): a player's phone shows its
     * own on its hotbar from here and keeps no copy; a teammate's card still says only "Ready to react". Absent when none.
     */
    readonly reacts?: Readonly<Record<CombatantId, AbilityId>>;
    /**
     * The bearers whose stacks went off in the GM's last command that set any off (rule 18a), at most `kit.doArmed`, and
     * a count the GM's phone raises for each such command, so a phone shows each burst once. Absent before the first.
     */
    readonly burst?: DocBurst;
    /**
     * An open dodge prompt, derived from party-perceived bodies and known terrain only (hidden foes and unseen fog walls
     * never create holes in `tiles` or move `auto`). Absent when no dodge is open.
     */
    readonly dodge?: DocDodge;
  };
/** The thresholds that went off in one command: its count on the GM's phone, and their bearers. */
export type DocBurst = { readonly n: number; readonly ids: readonly CombatantId[] };
/** An open dodge prompt as the players' table sees it: prompt id, hunter, perceived attacker/ability, mode, capped reach, movement bank left, default tile, and runs of lit blast tiles. */
export type DocDodge = {
  readonly n: number; readonly who: CombatantId; readonly by: CombatantId | null; readonly ability: string | null;
  readonly mode: Dodge; readonly reach: number; readonly left: number;
  readonly auto: DocPlace; readonly hit: string; readonly ring: string;
};

/** What the edge knows that the fight does not: this phone, the time stamp, the room's last doc, a local hunter's sheet key. */
export type DocContext = {
  readonly by: DeviceId;
  readonly at: string;
  /** The fight doc the room holds now, or null. */
  readonly was: FightDoc | null;
  /** The sheet key of a hunter on this phone in the room, or null when it has none. */
  readonly keyOf: (id: HunterId) => SheetKey | null;
  /** The last player's tap this phone turned down, if any. */
  readonly refused?: DocRefusal | null;
  /** The last command of this phone that set a threshold off (the fight's `burst` effects), if any. */
  readonly burst?: DocBurst | null;
  /** The hunter sheet behind a row, for its emblem (row-icon.ts `HunterOf`); absent, no hunter's row carries one. */
  readonly hunterOf?: HunterOf;
};

/**
 * The doc for `f`, as the party sees it (design 5.3). No fight ends this phone's fight on the table (null when the
 * room's doc is another GM phone's, or already ended, so nothing is published); an ended fight is the ended doc. The doc
 * holds the party's own rows (a hidden hunter with its status) and a foe only while some party row perceives it by the
 * one sight rule (sight.ts `perceivedBy`: one body that is up must both have it in sight and see its stealth level,
 * notes-7-stealth.md section 3). What the party does not perceive is not in the doc at all: its row, its turn, its place
 * in the order, and the log lines about it; with a fog also a zone's tiles it does not see, while a tile it saw before
 * keeps its terrain.
 */
export function fightDoc(f: Fight | null, R: Rules, o: DocContext): FightDoc | null {
  if (f === null) return o.was && o.was.ended === false && o.was.by === o.by ? { ended: true, active: false, id: o.was.id, at: o.at } : null;
  if (f.phase === 'ended') return { ended: true, active: false, id: f.id, at: o.at };
  const now = f.phase === 'running' ? f.now : tick(0), lit = partyView(f);
  const seen = f.rows.filter(b => perceivedBy('party', b, f)), ids = new Set(seen.map(b => b.id as string));
  const zones = docZones(f, lit, ids, now, R), shownZones = new Set(zones.map(z => z.id as string));
  const hiddenRows = new Set(f.rows.filter(b => !ids.has(b.id)).map(b => b.id)), hiddenZones = new Set(f.zones.filter(z => !shownZones.has(z.id)).map(z => z.id));
  const currentId = f.phase === 'running' && ids.has(f.currentId) ? f.currentId : null;
  const carried = shown(seen, currentId, f.rows), scripted = new Set(carried.filter(b => b.mythic).slice(0, DOC_MYTHICS).map(b => b.id));
  const ask = f.phase === 'running' && f.dodge ? dodgeAsk(f, R) : null;
  // Earlier hunters who already picked and party rows (ally NPCs, shadows, summons) that auto-dodged in pass 1 render at
  // their pass-1 tile (`ask.bodies`) so the player's phone never offers an occupied tile that the GM would refuse `taken`.
  const moved = f.phase === 'running' && f.dodge ? f.dodge.to : null;
  const askPlaces = ask ? new Map(ask.bodies.filter(b => b.side === 'party').map(b => [b.id, b.place] as const)) : null;
  const grid = docGrid(f, lit);
  const rows = carried.map(b => {
    const at = askPlaces?.get(b.id) ?? (moved && Object.hasOwn(moved, b.id) ? moved[b.id]! : b.place);
    return docRow(f, at !== b.place ? { ...b, place: at } : b, now, R, o, ids, scripted);
  });
  const dodge = f.phase === 'running' && ask ? partyDodge(f, ask, grid, rows, ids, lit) : undefined;
  return {
    ended: false, active: f.phase === 'running', by: o.by, id: f.id, at: o.at, now, currentId,
    ahead: f.phase === 'running' ? ahead(f.rows.filter(isUp), DOC_AHEAD + hiddenRows.size, R.fight).map(r => r.id).filter(id => ids.has(id)).slice(0, DOC_AHEAD) : [],
    grid, zones, rows,
    log: f.log.filter(l => !l.rows.some(x => hiddenRows.has(x)) && !l.zones.some(x => hiddenZones.has(x))).map(l => l.table ?? l.text).slice(0, DOC_LOG),
    refused: f.phase === 'running' && o.refused && o.refused.at === now ? o.refused : null,
    ready: readyOf(f.rows.find(b => b.id === currentId), now), ...leftOf(f.rows.find(b => b.id === currentId)), ...armedOf(seen, R),
    ...(o.burst ? { burst: { n: o.burst.n, ids: o.burst.ids.filter(id => ids.has(id)).slice(0, R.fight.kit.doArmed) } } : {}),
    ...(dodge ? { dodge } : {}),
  };
}
/**
 * Turns a room doc's `DocGrid` into a `Grid` (unseen `?` tiles become floor): shared by `partyDodge` and `docGround` so
 * both phones evaluate walkability and dodge reach on the exact same map.
 */
export function gridOfDoc(g: DocGrid): Grid {
  return { w: g.w, h: g.h, tiles: g.tiles ? [...g.tiles].map(c => terrainOfChar(c) ?? 'floor') : null };
}
/**
 * Offered dodge tiles, `mode`, and `auto` from the room doc's grid and carried row places (`rows`), called by both
 * `partyDodge` (GM building `DocDodge`) and `docDodge` (player phone building `MapDodge`) so both sides agree on every
 * tile, step cost, mode, and auto pick, including on a fogged map.
 */
export function docDodgeOptions(
  grid: DocGrid,
  rows: readonly { readonly id: CombatantId; readonly kind: CombatantKind; readonly place: DocPlace; readonly life: { readonly at: LifeState } }[],
  who: CombatantId,
  reach: Tiles,
  cover: Cover,
): DodgeOptions | null {
  const dodger = rows.find(r => r.id === who);
  if (!dodger) return null;
  const g = gridOfDoc(grid);
  const others = rows
    .filter(r => r.id !== who && (isUp(r) || r.kind === 'hunter'))
    .map(r => place(r.place.x, r.place.y));
  return dodgeOptions(place(dodger.place.x, dodger.place.y), reach, cover, g, others);
}
/**
 * Builds `DocDodge` strictly from the doc's party-perceived rows and known terrain (`docDodgeOptions`), so hidden foes
 * and unseen fog walls never leak through `mode` or `auto`. When the attacker is not perceived by the party, `by`,
 * `ability`, `hit` and `ring` are redacted.
 */
function partyDodge(f: Running, ask: DodgeAsked, grid: DocGrid, rows: readonly FightDocRow[], ids: ReadonlySet<string>, lit: Set<number> | null): DocDodge | undefined {
  if (!f.dodge) return undefined;
  const size = grid.w * grid.h;
  const toIdx = (p: Place): number => p.y * grid.w + p.x;
  const at = (i: number): Place => place(i % grid.w, Math.floor(i / grid.w));
  const seesBy = ids.has(ask.by);
  const inLit = (list: readonly Place[]): number[] => list.map(toIdx).filter(i => lit === null || lit.has(i));
  const hitRuns = seesBy ? runsOf(inLit(ask.hit), DOC_DODGE_RUNS) : '';
  const ringRuns = seesBy ? runsOf(inLit(ask.ring), DOC_DODGE_RUNS) : '';
  const cover: Cover = seesBy
    ? { hit: tilesOfRuns(hitRuns, size).map(at), ring: tilesOfRuns(ringRuns, size).map(at) }
    : { hit: ask.hit, ring: ask.ring };
  const opts = docDodgeOptions(grid, rows, ask.who, ask.reach, cover);
  const auto = opts ? opts.auto.place : ask.auto.place;
  const mode: Dodge = opts ? opts.auto.avoid : ask.mode;
  return {
    n: f.dodge.n, who: ask.who, by: seesBy ? ask.by : null, ability: seesBy ? ask.ability.name.slice(0, NAME_MAX) : null,
    mode, reach: ask.reach, left: ask.left, auto: { x: auto.x, y: auto.y },
    hit: hitRuns, ring: ringRuns,
  };
}
/**
 * The party's rows the doc carries whose reaction is armed and not spent, and those whose reaction is spent, each at
 * most `kit.doArmed`; none, nothing.
 */
function armedOf(rows: readonly Body[], R: Rules): { armed?: CombatantId[]; spent?: CombatantId[]; reacts?: Record<CombatantId, AbilityId> } {
  const of = (spent: boolean) => rows.filter(b => b.side === 'party' && b.armed && b.armed.spent === spent).slice(0, R.fight.kit.doArmed);
  const armed = of(false), spent = of(true), reacts = Object.fromEntries([...armed, ...spent].map(b => [b.id, b.armed!.ability])) as Record<CombatantId, AbilityId>;
  return { ...(armed.length ? { armed: armed.map(b => b.id) } : {}), ...(spent.length ? { spent: spent.map(b => b.id) } : {}), ...(armed.length + spent.length ? { reacts } : {}) };
}
/** The uses left of the abilities of `b` limited a fight or a gate, in its ability order, at most `DOC_READY`; none, nothing. */
function leftOf(b: Body | undefined): { left?: Record<string, number> } {
  const out = b ? usesLeft(b, DOC_READY) : {};
  return Object.keys(out).length ? { left: out } : {};
}

/**
 * The doc's map: open floor with no fog is null tiles; with a fog a tile the party never saw is `UNSEEN`. A grid past
 * `DOC_TILES_MAX` (only the open arena under a GM's override of its size) is sent as open floor.
 */
function docGrid(f: Fight, lit: Set<number> | null): DocGrid {
  const { w, h } = f.grid;
  if ((!f.fog && !f.grid.tiles) || w * h > DOC_TILES_MAX) return { w, h, tiles: null, lit: null };
  const seen = f.fog?.seen ?? '';
  const tiles = Array.from({ length: w * h }, (_, i) => f.fog && seen[i] !== '1' && !lit!.has(i) ? UNSEEN : TERRAIN[f.grid.tiles?.[i] ?? 'floor'].char).join('');
  return { w, h, tiles, lit: lit && Array.from({ length: w * h }, (_, i) => lit.has(i) ? '1' : '0').join('') };
}

/**
 * The zones the party sees: each with only the tiles it sees now (an aura where its body stands); one it sees no tile of
 * is left out. An aura names its body only when the doc carries that row (`shown`).
 */
function docZones(f: Fight, lit: Set<number> | null, shown: Set<string>, now: Tick, R: Rules): DocZone[] {
  return f.zones.flatMap(z => {
    const at = zoneTiles(z, f.rows, f.grid, now, R).map(p => p.y * f.grid.w + p.x).filter(i => lit === null || lit.has(i));
    if (!at.length) return [];
    const left = z.until === null ? null : Math.max(0, roundsOf(z.until - now, R, 'up')), anchor = anchorOf(z);
    return [{ id: z.id, name: z.name, tiles: runsOf(at, DOC_ZONE_RUNS), tone: zoneTone(z.ops), left, anchor: anchor !== null && shown.has(anchor) ? anchor : null }];
  });
}

/**
 * Tile indices as runs, "start+length" joined by commas in order ("45+3,65+5"), cut to whole runs within `max`
 * characters. `tilesOfRuns` reads them back.
 */
export function runsOf(indices: readonly number[], max: number): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b), out: string[] = [];
  let len = -1;
  for (let i = 0; i < sorted.length;) {
    let n = 1;
    while (sorted[i + n] === sorted[i]! + n) n++;
    const run = `${sorted[i]}+${n}`;
    if (len + 1 + run.length > max) break;
    out.push(run); len += 1 + run.length; i += n;
  }
  return out.join(',');
}
/** The tile indices of a run text, those below `size`; anything that is not a run is skipped. */
export function tilesOfRuns(text: string, size: number): number[] {
  const out: number[] = [];
  for (const run of text.split(',')) {
    const m = /^(\d+)\+(\d+)$/.exec(run);
    if (!m) continue;
    for (let i = Number(m[1]), end = Math.min(size, i + Number(m[2])); i < end; i++) out.push(i);
  }
  return out;
}

/** The abilities of `b` not ready at `now`, in its ability order, at most `DOC_READY`. */
function readyOf(b: Body | undefined, now: Tick): Record<string, Tick> {
  const out: Record<string, Tick> = {};
  for (const a of b ? b.abilities.slice(0, DOC_READY) : []) { const at = b!.readyAt[a.id]; if (at !== undefined && at > now) out[a.id] = at; }
  return out;
}

const SHOWN_RANK = { current: 0, alive: 1, rise: 2, spent: 3 } as const;
/**
 * The rows the doc carries, in the fight's order: all of them up to `DOC_ROWS`; past it the current row first, then those
 * on the map, then dead corpses eligible for Arise (`canRiseInFight`), then spent corpses and down shadows.
 */
function shown(rows: readonly Body[], currentId: CombatantId | null, allRows: readonly Body[]): readonly Body[] {
  if (rows.length <= DOC_ROWS) return rows;
  const rank = (b: Body): number => b.id === currentId ? SHOWN_RANK.current : alive(b) ? SHOWN_RANK.alive : canRiseInFight(b, allRows) ? SHOWN_RANK.rise : SHOWN_RANK.spent;
  const keep = new Set([...rows].sort((a, b) => rank(a) - rank(b)).slice(0, DOC_ROWS).map(b => b.id));
  return rows.filter(b => keep.has(b.id));
}

function keyOf(b: Body, o: DocContext): SheetKey | null {
  switch (b.holder?.kind) {
    case 'local': return o.keyOf(b.holder.hunterId);
    case 'remote': return parseSheetKey(b.holder.remote);
    case 'shadow': case 'remoteShadow': case undefined: return null;
    default: return b.holder satisfies never;
  }
}

function docRow(f: Fight, b: Body, now: Tick, R: Rules, o: DocContext, shownIds: ReadonlySet<string>, scripted: ReadonlySet<CombatantId>): FightDocRow {
  const live = counting(b.statuses), k = cardOf(f, b, R), c = channelView(b, R);
  const base: DocRowBase = {
    id: b.id, name: b.name, side: b.side, key: keyOf(b, o), place: { x: b.place.x, y: b.place.y }, at: b.at, speed: b.speed,
    band: band(rowHp(b), b.sheet.hpMax),
    // a zone's hold shows as a status here (it is why a body slows or burns), though its sheet never keeps it
    statuses: live.slice(0, DOC_STATUSES).map(s => ({
      key: s.key, label: s.def.label, left: s.until === null ? null : Math.max(0, roundsOf(s.until - now, R, 'up')), ...(stacked(s) ? { stacks: s.stacks } : {}),
      tier: s.source.tier, def: s.def,
    })),
    shield: b.shield && b.shield.until > now ? b.shield.amount : null, shieldLeft: b.shield && b.shield.until > now ? k.shieldLeft : null,
    channel: c && { ability: c.ability, name: c.name, charge: c.charge, max: c.max, state: c.state, factor: c.factor }, taunt: tauntOf(b, now, R),
    icon: rowIcon(b, o.hunterOf ? o.hunterOf(b) : null),
  };
  const body: DocBody = { hp: rowHp(b), hpMax: b.sheet.hpMax, stride: b.sheet.stride, move: Math.floor(b.sheet.move) };
  if (b.kind === 'hunter') return b.side === 'foe'
    ? { ...base, kind: 'hunter', life: { at: b.life.at }, ...(k.stagger ? { stagger: k.stagger } : {}) }
    : { ...base, ...body, kind: 'hunter', life: { at: b.life.at } };
  const life = { at: b.life.at };
  if (b.kind === 'summon') return { ...base, ...body, kind: 'summon', life, owner: b.owner, left: b.until === null ? null : Math.max(0, roundsOf(b.until - now, R, 'up')) };
  if (b.kind === 'shadow') return { ...base, ...body, kind: 'shadow', life };
  const i = intentOf(b, R);
  const intent = i && {
    name: i.name, target: aimOf(i.target),
    reveal: i.revealed ? { lines: i.lines.map(l => l.slice(0, INTENT_LINE_MAX)).slice(0, DOC_INTENT_LINES), radius: i.area?.radius ?? null, outer: i.area?.outer ?? null } : null,
  };
  return {
    ...base, kind: 'monster', life, intent, stagger: k.stagger, suggest: k.threat?.suggest ?? null,
    ...(b.mythic && scripted.has(b.id) ? { standing: docStanding(b.mythic, b.sheet.hpMax, shownIds) } : {}),
    ...(canRiseInFight(b, f.rows) ? { canRise: true as const } : {}),
  };
}
/** A mythic's standing for the party: an omen's aim on a row the doc does not carry is left out, and its HP at the announce is a band. */
function docStanding(s: MythicStanding, hpMax: number, shownIds: ReadonlySet<string>): DocStanding {
  if (s.at === 'calm') return { state: 'calm', script: s.script, phase: s.phase, beat: s.beat, since: s.since };
  const aim = typeof s.aim === 'string' ? (shownIds.has(s.aim) ? s.aim : null) : { x: s.aim.x, y: s.aim.y };
  return { state: s.at, script: s.script, phase: s.phase, beat: s.beat, since: s.since, omen: s.omen, aim, band: band(s.hpAt, hpMax) };
}

const aimOf = (aim: Place | CombatantId): CombatantId | DocPlace => typeof aim === 'string' ? aim : { x: aim.x, y: aim.y };

// ── shipped keystone defs: reconstructed on read instead of carried in wire.defs ──
/** One shipped keystone status def and its key-sorted canonical JSON for wire matching. */
type ShippedDef = { readonly def: StatusDef; readonly json: string };
/** Key-sorted canonical JSON so a fresh def from registry/keystones.ts matches one reordered by parseStatusDef. */
const canonicalJson = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) =>
  (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
/**
 * Every status def shipped by KEYSTONES under RULES: the 41 base worn defs, 7 awakened worn defs, and 23 child
 * statuses applied by their triggers, thresholds, and ends, keyed by canonical StatusKey. Derived once from KEYSTONES.
 */
function buildKeystoneStatusDefs(): ReadonlyMap<StatusKey, ShippedDef> {
  const out = new Map<StatusKey, ShippedDef>();
  const recordOps = (ops: readonly LandOp[]): void => {
    for (const op of ops) if (op.op === 'applyStatus') record(op.key, op.def);
  };
  const record = (key: StatusKey, def: StatusDef): void => {
    if (!out.has(key)) out.set(key, { def, json: canonicalJson(def) });
    for (const tr of def.triggers ?? []) recordOps(tr.ops);
    if ('stack' in def && def.stack?.threshold) recordOps(def.stack.threshold.ops);
    if (def.end) recordOps(def.end.ops);
  };
  const recordWorn = (def: StatusDef | undefined): void => {
    if (def) record(freeStatusKey(def.label, () => false), def);
  };
  for (const stat of STAT_KEYS) {
    recordWorn(keystoneOf({ tier: 'mark', stat }, RULES).worn);
    recordWorn(keystoneOf({ tier: 'apex', stat }, RULES).worn);
  }
  for (const pair of STAT_PAIRS) {
    const k = keystoneOf({ tier: 'confluence', pair }, RULES);
    recordWorn(k.worn);
    recordWorn(k.awakened?.worn);
  }
  return out;
}
const KEYSTONE_STATUS_DEFS: ReadonlyMap<StatusKey, ShippedDef> = buildKeystoneStatusDefs();
/** The shipped keystone StatusDef for `key` under `RULES`, or null when `key` is not a shipped keystone status. */
export function keystoneStatusDef(key: StatusKey): StatusDef | null {
  return KEYSTONE_STATUS_DEFS.get(key)?.def ?? null;
}
/** The shipped keystone or class StatusDef for `key` under `RULES`, or null when `key` is neither. */
export function shippedStatusDef(key: StatusKey): StatusDef | null {
  return KEYSTONE_STATUS_DEFS.get(key)?.def ?? classStatusDef(key);
}
/** Whether `def` matches the shipped keystone or class StatusDef under `key` by key-sorted canonical JSON. */
function isShippedDef(key: StatusKey, def: StatusDef): boolean {
  const shipped = KEYSTONE_STATUS_DEFS.get(key);
  if (shipped !== undefined) return shipped.json === canonicalJson(def);
  const cls = classStatusDef(key);
  return cls !== null && canonicalJson(cls) === canonicalJson(def);
}

// ── the wire: the doc as the room stores and sends it ──
/**
 * The most characters the doc's table of status defs takes. Each non-shipped status a row carries sends its def once,
 * by key, the current row's first, then in the rows' order, while the table fits. Shipped keystone defs matching
 * `RULES` are omitted from `defs` and reconstructed on read (`keystoneStatusDef`), while any overridden or colliding
 * keystone def falls back to `defs`. A status whose def did not fit, or whose def differs from the one in `defs` under
 * its key, carries its label instead. 6,000 holds all 18 built-ins (5,287 characters); real fights only send statuses
 * currently held on a row. The doc's worst case with the table full is in `DOC_MAX`'s arithmetic (protocol.ts).
 */
export const DOC_DEFS_MAX = 6000;
/**
 * The doc on the wire: the same content as `FightDoc` in a shorter shape, read back by `DOCS.fight` (protocol.ts). Below
 * the top level each field has a one or two letter name (the table in `rowWire`), a field at its default (null, false,
 * none, tier 0) is left out, a place is `[x, y]`, a band is its index in `BANDS`, the lit line is packed six tiles a
 * character (`packBits`), and a status's def is sent once in `defs`. The top level keeps its names: the GM's phone drops
 * `log` to put a doc the room refused as too big (sync.ts `shorter`).
 */
export function fightWire(d: FightDoc): Record<string, unknown> {
  if (d.ended === true) return { ...d };
  const defs = defsOf(d);
  return {
    ended: false, active: d.active, by: d.by, id: d.id, at: d.at, now: d.now, currentId: d.currentId, ahead: d.ahead,
    grid: { w: d.grid.w, h: d.grid.h, ...(d.grid.tiles !== null ? { tiles: d.grid.tiles } : {}), ...(d.grid.lit !== null ? { lit: packBits(d.grid.lit) } : {}) },
    zones: d.zones.map(zoneWire), rows: d.rows.map(r => rowWire(r, defs)), log: d.log, refused: d.refused, ready: d.ready,
    ...(d.left ? { left: d.left } : {}), ...(d.armed ? { armed: d.armed } : {}), ...(d.spent ? { spent: d.spent } : {}), ...(d.reacts ? { reacts: d.reacts } : {}), ...(d.burst ? { burst: d.burst } : {}),
    ...(d.dodge ? { dodge: dodgeWire(d.dodge) } : {}),
    ...(Object.keys(defs).length ? { defs } : {}),
  };
}
const DODGE_MODES: readonly Dodge[] = ['out', 'ring', 'caught'];
/** An open dodge prompt on the wire: n id, w hunter, b attacker, a ability, v mode (0 out, 1 ring, 2 caught), k reach, l bank left, p default [x,y], h hit, r ring. */
const dodgeWire = (d: DocDodge): Record<string, unknown> => ({
  n: d.n, w: d.who, ...unlessNull('b', d.by), ...unlessNull('a', d.ability),
  v: DODGE_MODES.indexOf(d.mode), k: d.reach, l: d.left, p: [d.auto.x, d.auto.y],
  ...(d.hit ? { h: d.hit } : {}), ...(d.ring ? { r: d.ring } : {}),
});
/** Each non-shipped status's def once by key, the current row's first, at most `DOC_DEFS_MAX` characters of JSON. */
function defsOf(d: FightDoc & { ended: false }): Record<string, StatusDef> {
  const out: Record<string, StatusDef> = {}, tried = new Set<string>();
  let used = 2;
  const rows = [...d.rows.filter(r => r.id === d.currentId), ...d.rows.filter(r => r.id !== d.currentId)];
  for (const s of rows.flatMap(r => r.statuses)) {
    if (!s.def || tried.has(s.key)) continue;
    tried.add(s.key);
    if (isShippedDef(s.key, s.def)) continue;
    const n = JSON.stringify(s.key).length + JSON.stringify(s.def).length + 2;
    if (used + n <= DOC_DEFS_MAX) { out[s.key] = s.def; used += n; }
  }
  return out;
}
const unlessNull = <K extends string, V>(k: K, v: V | null): { [P in K]?: V } => (v === null ? {} : { [k]: v }) as { [P in K]?: V };
/** Whether `s.def` matches what `DOCS.fight` resolves under `s.key` when `b` is left out: `defs[s.key]` first, else shipped keystone. */
function knownDef(s: DocStatus, defs: Readonly<Record<string, StatusDef>>): boolean {
  if (!s.def) return false;
  if (Object.hasOwn(defs, s.key)) return canonicalJson(defs[s.key]) === canonicalJson(s.def);
  return isShippedDef(s.key, s.def);
}
/**
 * When `s.def` differs from the base def under `s.key` (`defs[s.key]` or shipped keystone/class def) only in its flat Grievous
 * Wounds healing-cut percentage, returns that cut so `statusWire` can send compact `h: cut` instead of dropping the def.
 */
function grievousVariant(s: DocStatus, defs: Readonly<Record<string, StatusDef>>): number | null {
  if (!s.def || hasTieredGrievousCut(s.def)) return null;
  const base = Object.hasOwn(defs, s.key) ? defs[s.key]! : shippedStatusDef(s.key);
  if (!base || hasTieredGrievousCut(base)) return null;
  const cut = grievousCutOf(s.def);
  if (cut === null || !Number.isInteger(cut)) return null;
  const max = isGrievousKey(s.key) ? GRIEVOUS_MAX : GRIEVOUS_LEGACY_MAX;
  return canonicalJson(withGrievousCut(base, cut, max)) === canonicalJson(s.def) ? cut : null;
}
function statusWire(s: DocStatus, defs: Record<string, StatusDef>): Record<string, unknown> {
  const known = knownDef(s, defs), cut = known ? null : grievousVariant(s, defs);
  return { k: s.key, ...(known ? {} : cut !== null ? { h: cut } : { b: s.label }), ...unlessNull('l', s.left), ...(s.stacks !== undefined ? { n: s.stacks } : {}), ...(s.tier ? { t: s.tier } : {}) };
}
/**
 * A row on the wire. Its names: i id, n name, s side, k sheet key, p place, a at, v speed, b band, st statuses, sh shield,
 * sl shield's rounds, c channel, t taunt, ic the row's icon, d life (its state's index in `LIFE_STATES`, absent while up: 1 dead), q
 * kind; a monster's in intent, g stagger, u suggested target, my a mythic's standing (`standingWire`); a body's h HP, hm max HP, r stride, m move; a
 * summon's o owner, l rounds left.
 */
function rowWire(r: FightDocRow, defs: Record<string, StatusDef>): Record<string, unknown> {
  const c = r.channel, t = r.taunt;
  const base = {
    i: r.id, n: r.name, s: r.side, ...unlessNull('k', r.key), p: [r.place.x, r.place.y], a: r.at, v: r.speed, b: BANDS.indexOf(r.band),
    ...(r.statuses.length ? { st: r.statuses.map(s => statusWire(s, defs)) } : {}), ...unlessNull('sh', r.shield), ...unlessNull('sl', r.shieldLeft),
    ...(c ? { c: { a: c.ability, n: c.name, c: c.charge, m: c.max, s: c.state, f: c.factor } } : {}),
    ...(t ? { t: { b: t.by, ...unlessNull('l', t.left) } } : {}), ...unlessNull('ic', r.icon), ...(r.life.at !== 'up' ? { d: LIFE_STATES.indexOf(r.life.at) } : {}), q: r.kind,
  };
  if (r.kind === 'monster') {
    const i = r.intent, g = r.stagger, v = i?.reveal ?? null;
    return {
      ...base, ...unlessNull('u', r.suggest),
      ...(r.standing ? { my: standingWire(r.standing) } : {}),
      ...(r.canRise ? { cr: 1 } : {}),
      ...(g ? { g: { f: g.fill, m: g.max, ...unlessNull('s', g.staggered) } } : {}),
      ...(i ? { in: { n: i.name, t: typeof i.target === 'string' ? i.target : [i.target.x, i.target.y], ...(v ? { r: { l: v.lines, ...unlessNull('r', v.radius), ...unlessNull('o', v.outer) } } : {}) } } : {}),
    };
  }
  if (r.kind === 'hunter' && r.hp === undefined) {
    const g = r.stagger;
    return g ? { ...base, g: { f: g.fill, m: g.max, ...unlessNull('s', g.staggered) } } : base;
  }
  const body = { ...base, h: r.hp, hm: r.hpMax, r: r.stride, m: r.move };
  return r.kind === 'summon' ? { ...body, o: r.owner, ...unlessNull('l', r.left) } : body;
}
/**
 * A mythic's standing on the wire: s script, p phase, b beat, t since; while an omen stands also z its state's index in
 * `MYTHIC_STATES`, o the omen, a its aim (a row id or `[x, y]`, absent when the doc leaves it out) and h the band's index.
 */
function standingWire(m: DocStanding): Record<string, unknown> {
  const base = { s: m.script, p: m.phase, b: m.beat, t: m.since };
  if (m.state === 'calm') return base;
  const a = m.aim;
  return { ...base, z: MYTHIC_STATES.indexOf(m.state), o: m.omen, ...(a === null ? {} : { a: typeof a === 'string' ? a : [a.x, a.y] }), h: BANDS.indexOf(m.band) };
}
/** A zone on the wire: i id, n name, t its runs of tiles, o tone, l rounds left, a the row it moves with. */
const zoneWire = (z: DocZone): Record<string, unknown> => ({ i: z.id, n: z.name, t: z.tiles, o: z.tone, ...unlessNull('l', z.left), ...unlessNull('a', z.anchor) });

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** The tiles one character of a packed line holds: a base64url character's bits. */
const BITS_PER_CHAR = 6;
/** A line of '0' and '1' as six of them a character (base64url, the first of each six the lowest bit). `unpackBits` reads it back. */
export function packBits(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i += BITS_PER_CHAR) {
    let n = 0;
    for (let j = 0; j < BITS_PER_CHAR && i + j < line.length; j++) if (line[i + j] === '1') n |= 1 << j;
    out += B64[n];
  }
  return out;
}
/** The `size` tiles of a packed line, or null when it is not exactly that many characters of base64url. */
export function unpackBits(packed: string, size: number): string | null {
  if (packed.length !== Math.ceil(size / BITS_PER_CHAR)) return null;
  let out = '';
  for (let i = 0; i < packed.length; i++) {
    const n = B64.indexOf(packed[i]!);
    if (n < 0) return null;
    for (let j = 0; j < BITS_PER_CHAR && i * BITS_PER_CHAR + j < size; j++) out += n & (1 << j) ? '1' : '0';
  }
  return out;
}
