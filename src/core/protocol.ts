// protocol.ts: every room message and room document, typed, and the one parser for each. Pure.
// server.ts parses every event, sheet and doc with these before it stores one, and the client parses everything it
// receives with the same functions. Inside the app a parsed value is trusted: nothing re-checks its fields.
// A new room message is a member of `Payloads`, an entry in `DEFS` and `EVENTS` and a case in tests/protocol.test.ts.
import { GATE_STATUSES, GATE_TYPES, monsterId, parseGateId, shownGate } from './gates/gate.ts';
import { isStateChip } from './hunter/chips.ts';
import type { GateFields, GateId, GateStatus, ShownGate } from './gates/gate.ts';
import { QUEST_KINDS, QUEST_STATUSES, SHADOW_GRADES, parseSheetHunter } from './hunter/hunter.ts';
import { ARCHETYPE_LIST, MONSTER_BOUNDS, parseMonster } from './registry/monsters.ts';
import type { MonsterTemplate } from './registry/monsters.ts';
import { RUN_OUTCOMES } from './combat/odds.ts';
import type { RunOutcome } from './combat/odds.ts';
import { CAP_ROUNDS } from './combat/play.ts';
import { LIFE_STATES } from './hunter/vitals.ts';
import type { LifeState } from './hunter/vitals.ts';
import type { ShadowOrigin } from './hunter/shadows.ts';
import { BUNDLE_NAME, newRewards, parseRewards, parseWords } from './rewards.ts';
import type { SystemWords } from './rewards.ts';
import { RANKS, RULES, SOLO_BOUNDS } from './rules.ts';
import { parseFact } from './hunter/facts.ts';
import type { Fact } from './hunter/facts.ts';
import { parseFeats } from './hunter/feats.ts';
import type { FeatDef } from './hunter/feats.ts';
import { parseObjectiveCount } from './hunter/counts.ts';
import { oneOf } from './one-of.ts';
import type { Hunter, Objective, Quest, QuestKind, QuestStatus, Rank, Rewards } from './save.ts';
import { isJobName } from './registry/jobs.ts';
import type { JobName } from './registry/jobs.ts';
import { abilityId, combatantId } from './combat/ability-types.ts';
import type { AbilityId, CombatantId } from './combat/ability-types.ts';
import { statusKey } from './combat/effect-ops.ts';
import type { SheetStatus, StatusDef, StatusKey } from './combat/effect-ops.ts';
import { parseSheetStatus, parseStatusDef } from './combat/fight-parse.ts';
import { LOG_LINE_MAX, MAX_STATUSES, NAME_MAX, fightId } from './combat/fight-types.ts';
import type { Fight } from './combat/fight-types.ts';
import { tick } from './combat/timeline.ts';
import type { Tick } from './combat/timeline.ts';
import { BANDS, DOC_AHEAD, DOC_DEFS_MAX, DOC_INTENT_LINES, DOC_LOG, DOC_READY, DOC_ROWS, DOC_STATUSES, DOC_TILES_MAX, DOC_ZONE_RUNS, INTENT_LINE_MAX, TABLE_REFUSALS, UNSEEN, fightWire, unpackBits } from './combat/fight-doc.ts';
import type { Band, DocBurst, DocChannel, DocGrid, DocIntent, DocPlace, DocTaunt, DocRefusal, DocStatus, DocZone, FightDoc, FightDocRow } from './combat/fight-doc.ts';
import { TERRAIN, TERRAINS } from './combat/space.ts';
import { MAX_ZONES, ZONE_NAME_MAX, zoneId } from './combat/zones.ts';
import { deviceOf, hunterIdOf, parseDeviceId, parseEventId, parseRoomCode, parseSaveId, parseSheetKey } from './ids.ts';
import { COIN_TEXT_MAX, SIDES, faceOf, rollId } from './coin.ts';
import type { CoinNatural, LandingBody, RollId, CoinSide } from './coin.ts';
import type { DeviceId, EventId, ItemId, RoomCode, SheetKey } from './ids.ts';
import { OFFER_ID_MAX, endIdOf, isEndId, parseOfferId } from './ids.ts';
import type { OfferId } from './ids.ts';
import { OFFER_MAX, goodsSize, noGoods, parseBagPick, parseGoods } from './trade/goods.ts';
import type { BagPick, Goods } from './trade/goods.ts';
import type { Seat } from './role.ts';
import { ITEM_BOUNDS, RARITIES } from './registry/items.ts';
import type { Rarity } from './registry/items.ts';
import { MAX_LEVEL } from './hunter/progress.ts';
import type { ChapterBody } from './story/story.ts';

// The ids (src/core/ids.ts) are made only by their parsers, so ids of different things do not mix.
export { deviceOf, hunterIdOf, parseDeviceId, parseEventId, parseRoomCode, parseSheetKey };
export type { DeviceId, EventId, RoomCode, SheetKey };
const WORD_RE = /^[\w-]{1,40}$/;

// ── bounds. For junk and hostile input; every real sender stays well inside them. ──
/** Events per poll answer. A full page means there are more. */
export const ROOM_PAGE = 200;
/** Hunter sheets a room holds (a tombstone counts). */
export const ROOM_SHEETS = 24;
/** Entries in a `to` list, rewards and statuses in one event. */
const MAX_TO = ROOM_SHEETS, MAX_OBJECTIVES = 10, MAX_STATUS_CHANGES = 10, MAX_ROLLS = 50;
/** The biggest HP, mana or fatigue change, and the biggest roll total. A reward's bounds are `REWARD_BOUNDS` (src/core/rewards.ts). */
const MAX_HP = 99999, MAX_ROLL = 1e6;
/** The biggest HP, mana or fatigue total, a time in a fight and a number a fight doc shows: the save's and the fight's bound for junk. */
const MAX_TOTAL = 1e9;
/** A tile's x or y: the biggest grid is 64 by 64 (fight-parse.ts). */
const MAX_TILE = 63;
/** The most a channel's charge or its max may be on the wire: a channel's max is a small whole number (rules' `channelMax` 5). */
const MAX_CHARGE = 99;
/** Dice a player's `cast` carries, and the biggest face. */
const MAX_DICE = 8, MAX_FACE = 999;
/** The longest ability id a `cast` names. */
const ABILITY_ID_MAX = 40;

// ── readers. Each returns the value, bounded, or throws `Refused` when the field is wrong. ──
// A wrong type is refused, never turned into a default. A missing optional field takes its default. A string is cut
// to its length and a list to its count; a number outside its range is clamped to it. An id that is too long or
// malformed is refused: a cut id names another thing.
class Refused extends Error {}
const refuse = (): never => { throw new Refused(); };
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An own field: never one inherited from Object.prototype. */
const own = (o: Rec, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const obj = (v: unknown): Rec => (isObj(v) ? v : refuse());
const need = <T>(v: T | null): T => (v === null ? refuse() : v);
/** `read(v)` when the field is there, else `d`. */
const opt = <T>(v: unknown, read: (v: unknown) => T, d: T): T => (v === undefined ? d : read(v));
const text = (n: number) => (v: unknown): string => (typeof v === 'string' ? v.slice(0, n) : refuse());
/** A string with something in it after trimming. */
const filled = (n: number) => (v: unknown): string => { const s = text(n)(v); return s.trim() ? s : refuse(); };
const int = (lo: number, hi: number) => (v: unknown): number =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : refuse());
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : refuse());
/** A reader of one of `list`: anything else refuses the event. */
const choiceOf = <T extends string>(list: readonly T[]) => (v: unknown): T => oneOf(v, list, null) ?? refuse();
const nullOr = <T>(read: (v: unknown) => T) => (v: unknown): T | null => (v === null ? null : read(v));
/** At most `n` entries; an entry `read` refuses is dropped. */
function listOf<T>(v: unknown, n: number, read: (v: unknown) => T): T[] {
  if (!Array.isArray(v)) return refuse();
  const out: T[] = [];
  for (const raw of v) {
    if (out.length >= n) break;
    try { out.push(read(raw)); } catch (e) { if (!(e instanceof Refused)) throw e; }
  }
  return out;
}
/** Runs a reader: its value, or null when it refused. */
function attempt<T>(read: () => T): T | null {
  try { return read(); } catch (e) { if (e instanceof Refused) return null; throw e; }
}
const sheetKey = (v: unknown): SheetKey => need(parseSheetKey(v));
const deviceId = (v: unknown): DeviceId => need(parseDeviceId(v));
const id = (v: unknown): string => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : refuse());
const rowId = (v: unknown): CombatantId => combatantId(id(v));
/** A number from `lo` to `hi`, fractions kept, clamped. */
const num = (lo: number, hi: number) => (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : refuse());
const time0 = (v: unknown): Tick => tick(int(0, MAX_TOTAL)(v));
/** A tile. Outside the biggest grid it is refused, not clamped: a moved tile is another tile. */
function tile(v: unknown): DocPlace {
  const o = obj(v), at = (k: string): number => { const n = own(o, k); return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_TILE ? n : refuse(); };
  return { x: at('x'), y: at('y') };
}
/** A row of the fight, or a tile. */
const aim = (v: unknown): CombatantId | DocPlace => (typeof v === 'string' ? rowId(v) : tile(v));
/** Who an event is for: at least one sheet key. */
const toList = (v: unknown): SheetKey[] => { const to = listOf(v, MAX_TO, sheetKey); return to.length ? to : refuse(); };
/** A time as the app writes one (an ISO string). */
const time = (v: unknown): string => { const s = text(40)(v); return Number.isFinite(Date.parse(s)) ? s : refuse(); };
/** A coin's roll id: refused when malformed or too long, never cut (a cut id names another roll). */
const roll = (v: unknown): RollId => need(rollId(v));
const side = choiceOf(SIDES);

// ── shared shapes ──
/** A build change the GM sends: clear the path and perks, set a path, or pick the perk of the next open tier. */
export type BuildChange = 'respec' | { path: string } | { tier: number; pick: 0 | 1 };
/** A quest the GM issues to another phone. That phone gives it an id and the times it keeps. */
export type QuestOffer = Pick<Quest, 'kind' | 'title' | 'desc' | 'objectives' | 'dueAt' | 'penaltyText'> & { rewards: Rewards; onFail: Rewards };
export const SYSTEM_KINDS = ['info', 'quest', 'warning', 'penalty', 'levelup', 'arise'] as const;
export type SystemKind = (typeof SYSTEM_KINDS)[number];
/** What a player used: an item, a skill or a boon. */
export const USED_WHAT = ['item', 'skill', 'boon'] as const;
export type UsedWhat = (typeof USED_WHAT)[number];
export const USED_TARGETS = ['self', 'other'] as const;
/**
 * Where a use by a hunter of a phone in this seat goes: a player's phone in a room posts `used` for a told use or one on
 * another, for the GM to rule on; a phone alone or the GM's own writes a told use to its session log; the rest goes
 * nowhere (a use on oneself the GM need not hear of).
 */
export const useRoute = (seat: Seat, use: { tell: boolean; target: (typeof USED_TARGETS)[number] }): 'post' | 'log' | 'none' =>
  seat === 'player' ? (use.tell || use.target === 'other' ? 'post' : 'none') : use.tell ? 'log' : 'none';
/** What the GM does to a Job Change chain on a player's phone: start one, reissue its failed step, or abandon it. */
export const CHAIN_KINDS = ['issue', 'reissue', 'abandon'] as const;
export type ChainKind = (typeof CHAIN_KINDS)[number];

/** A status key a room message may name: an id of the fight's bound (80 characters, fight-parse.ts). */
const keyOf = (v: unknown): StatusKey => statusKey(id(v));
/** A status a room message may add or remove: not a chip a hunter's state draws (Down, Dead, Exhausted, Penalized). */
const changeableKey = (v: unknown): StatusKey => { const key = keyOf(v); return isStateChip(key) ? refuse() : key; };
/**
 * A status as a hunter's sheet keeps it, read by the fight's own reader (`parseSheetStatus`) with the shipped rules'
 * dice limits, as every room message is read before any GM's rules are known. It carries its def as written, because
 * the receiving phone may not know the key, and its source, whose tier decides its numbers on that phone.
 */
const sheetStatus = (v: unknown): SheetStatus => { const s = need(parseSheetStatus(v, RULES)); return isStateChip(s.key) ? refuse() : s; };
/** A risen shadow's body and name: a rank, an archetype and a grade the tables hold, the monster it was (or none), a name of up to `NAME_MAX`. */
function shadowOrigin(v: unknown): ShadowOrigin {
  const o = obj(v), m = own(o, 'monster');
  return {
    rank: choiceOf(RANKS)(own(o, 'rank')), archetype: choiceOf(ARCHETYPE_LIST)(own(o, 'archetype')), grade: choiceOf(SHADOW_GRADES)(own(o, 'grade')),
    monster: m === null ? null : need(monsterId(m)), name: text(NAME_MAX)(own(o, 'name')),
  };
}
/** The rewards of an award or a quest, read by `parseRewards`: refused only when they are not an object. */
const rewards = (v: unknown): Rewards => need(parseRewards(v));
/** The bundle an award names: a key and a name, and window words read by `parseWords` or none. */
function givenBundle(v: unknown): GivenBundle {
  const o = obj(v), w = own(o, 'window');
  return { key: filled(BUNDLE_KEY_MAX)(own(o, 'key')), name: filled(BUNDLE_NAME)(own(o, 'name')), window: w === null || w === undefined ? null : need(parseWords(w)) };
}
function buildChange(v: unknown): BuildChange {
  if (v === 'respec') return v;
  const o = obj(v);
  if (own(o, 'tier') !== undefined) {
    const pick = own(o, 'pick');
    return { tier: int(0, 99)(own(o, 'tier')), pick: pick === 0 || pick === 1 ? pick : refuse() };
  }
  const path = own(o, 'path');
  return { path: typeof path === 'string' && WORD_RE.test(path) ? path : refuse() };
}
function objective(v: unknown): Objective {
  const o = obj(v), target = opt(own(o, 'target'), int(1, 99999), 1), count = parseObjectiveCount(own(o, 'count'));
  return { label: filled(100)(own(o, 'label')), target, progress: Math.min(target, opt(own(o, 'progress'), int(0, 99999), 0)), ...(count ? { count } : {}) };
}
function questOffer(v: unknown): QuestOffer {
  const o = obj(v);
  return {
    kind: choiceOf(QUEST_KINDS)(own(o, 'kind')), title: filled(120)(own(o, 'title')), desc: opt(own(o, 'desc'), text(500), ''),
    objectives: opt(own(o, 'objectives'), v => listOf(v, MAX_OBJECTIVES, objective), []), rewards: opt(own(o, 'rewards'), rewards, newRewards()),
    onFail: opt(own(o, 'onFail'), rewards, newRewards()),
    dueAt: opt(own(o, 'dueAt'), nullOr(time), null), penaltyText: opt(own(o, 'penaltyText'), text(300), ''),
  };
}

// ── the events ──
type Base = { eid: EventId };
/** A System window on the players' phones. No `to` means every player. */
export type SystemPayload = Base & { to?: SheetKey[]; tag: string; title: string; body: string; kind: SystemKind };
/**
 * The bundle an award was given from by hand (the GM's awards for roleplay, src/core/registry/bundles.ts): its key and
 * name, which the player's chronicle records (`given`), and the words of its window, or none for "REWARD RECEIVED".
 */
export type GivenBundle = { key: string; name: string; window: SystemWords | null };
/** The longest bundle key an award names: a library id or a built-in's `seed-` key. */
const BUNDLE_KEY_MAX = 80;
export type AwardPayload = Base & { to: SheetKey[]; rewards: Rewards & { build?: BuildChange }; bundle?: GivenBundle };
export type QuestPayload = Base & { to: SheetKey[]; quest: QuestOffer };
/** HP, mana and fatigue changes the GM taps on the board: negative is damage (or rest, for fatigue). */
export type HpPayload = Base & { to: SheetKey[]; hp: number; mana: number; fatigue: number; reason: string };
/**
 * The fight's write-back of a hunter on another phone (the `sendRemote` effect of src/core/combat/fight-types.ts): its
 * HP, mana, fatigue and statuses as the fight holds them. Totals, so a repeat changes nothing. For one hunter.
 */
export type VitalsPayload = Base & { to: [SheetKey]; hp: number; mana: number; fatigue: number; statuses: SheetStatus[]; reason: string };
/**
 * The GM's fight took a use of item `item` by the player's hunter of `to` (src/core/combat/fight-save.ts `itemSpent`):
 * one leaves that hunter's bag now. Sent once per use the fight took, never for one it refused, so a refused cast keeps
 * the item (implicit audit 2, N1). Not a total: each one spends one, at most once by its id.
 */
export type SpentPayload = Base & { to: [SheetKey]; item: ItemId };
/**
 * A shadow rose for the player's hunter of `to` from a fallen monster in the GM's fight: the GM's phone rolled that
 * hunter's extraction (src/views/shadows.js), the fight recorded the outcome on the corpse (its `extract`), and this
 * message, posted in the same write, puts the shadow in the hunter's army (core/hunter/shadows.ts `shadowRises`, which
 * refuses an army at its cap). Once by its id.
 */
export type ShadowPayload = Base & { to: [SheetKey]; shadow: ShadowOrigin };
export type StatusPayload = Base & { to: SheetKey[]; add: SheetStatus[]; remove: StatusKey[]; reason: string };
/** The GM raises these dead hunters at 1 HP: the vitals `revive` event (src/core/hunter/vitals.ts) on the player's phone. */
export type RevivePayload = Base & { to: SheetKey[] };
/**
 * A player's roll, shown in the GM's Table feed: the hunter who rolled it (`by`), its words and its numbers. An item or
 * skill used on another travels as `used`.
 */
export type RollPayload = Base & {
  by: SheetKey; name: string; label: string; expr: string; total: number; rolls: number[]; crit: boolean; fumble: boolean;
};
/** A player's progress on a quest the GM issued. */
export type QuestUpdatePayload = Base & {
  by: SheetKey; name: string; questId: string; title: string; kind: QuestKind; status: QuestStatus; objectives: Objective[];
};
/**
 * A player's report that one of their hunters used a thing. `who` is the hunter's name, `name` the thing's, `text` its
 * description or a boon's text. `tell`: the GM asked to be told (a boon, an item marked `tell`), so it goes in the
 * session log. A report: it changes nothing; a use in a fight is a `cast`.
 */
export type UsedPayload = Base & {
  by: SheetKey; who: string; what: UsedWhat; name: string; text: string; target: (typeof USED_TARGETS)[number]; tell: boolean;
};
/**
 * A player's step in the GM's fight: the hunter of `by` moves to `place` on its turn (`to` names whom a message is
 * for), a dash when `dash` (the move command's). `at` is the fight's `now` the player's phone drew, so the GM's phone
 * takes it only on that turn (`onTurn`): a replay or a stale tap changes nothing.
 */
export type StepPayload = Base & { by: SheetKey; place: DocPlace; at: Tick; dash: boolean };
/**
 * A player's use in the GM's fight: the hunter of `by` uses `ability` on `aim` (a row of the fight or a tile) on its
 * turn, with the player's own `dice`. The GM's phone rolls each target's reaction d20 itself (m2-plan.md 1.3). `at` as
 * for a step.
 */
export type CastPayload = Base & { by: SheetKey; ability: AbilityId; aim: CombatantId | DocPlace; at: Tick; dice: number[] };
/**
 * A player's pass in the GM's fight: the hunter of `by` ends its turn, at the cost of the fight's `endTurn`. `at` as for
 * a step, so a replay or a stale tap ends no later turn.
 */
export type PassPayload = Base & { by: SheetKey; at: Tick };
/**
 * A player arms one of its hunter's reactions in the GM's fight (kits design 8.4.2): the hunter of `by` holds `ability`
 * ready, or none (null); a reaction before a turn names the row `on` whose turn it answers (null for the rest). Taken at
 * any time, since it changes nothing but its own row: the GM's phone turns it into the fight's `arm`.
 */
export type ArmPayload = Base & { by: SheetKey; ability: AbilityId | null; on: CombatantId | null };
/**
 * The GM's Job Change chain on a player's phone (src/core/hunter/job-chain.ts): `issue` starts one for `job`; `reissue`
 * and `abandon` act on the hunter's failed chain (`job` is the chain's, for the words).
 */
export type ChainPayload = Base & { to: SheetKey[]; job: JobName; kind: ChainKind };
/**
 * A player's call on a natural 1 or 20 (src/core/coin.ts): the hunter of `by` (`who`) rolled `face` for `what` and calls
 * `call`. Only the GM's phone acts on it, once per `roll`.
 */
export type CoinCallPayload = Base & { by: SheetKey; roll: RollId; who: string; what: string; face: CoinNatural; call: CoinSide };
/**
 * Where the GM's phone says the coin of `roll` landed: the roll and the side, and nothing else. A ruling and a true flip
 * send the same message, so no field may say how the side was chosen. A phone acts on the first landing of a roll only.
 */
export type CoinLandPayload = Base & LandingBody;
/**
 * A player's run of the room's solo gate `gate` (src/core/gates/solo.ts): the hunter of `by` (`name`) played it alone
 * on its phone and came out as `outcome` after `rounds`, `life` its life after. A report and a claim: the GM's phone acts
 * on it once by its id, clears a won gate if it still can and answers with `soloAnswer`; a lost or stalled run moves a
 * detected gate to raiding. Its cost is already on the player's sheet.
 */
export type SoloRunPayload = Base & { by: SheetKey; gate: GateId; name: string; outcome: RunOutcome; rounds: number; life: LifeState };
/** Why the GM's phone did not pay a won run: the gate was cleared first (another hunter's run or the GM), closed, or is gone. */
export const SOLO_REFUSED = ['taken', 'closed', 'gone'] as const;
export type SoloRefused = (typeof SOLO_REFUSED)[number];
/** The most facts one `noted` carries: a fight's fact, a kill a row, and its consumables (notes-1-feats.md 2.3). */
export const NOTED_MAX = 1 + 60 + 20;
/**
 * Facts the GM's phone saw of the player's hunter of `to` (feature 1's notes 2.3): a fight's end (its row's facts,
 * fight-facts.ts `rowFacts`), a gate's Clear it was paid in. Landed once by its id: recorded on the hunter, noticed in
 * the same write. A fact that does not read (`parseFact`) is left out.
 */
export type NotedPayload = Base & { to: [SheetKey]; facts: Fact[] };
/**
 * The GM's phone's answer to the won run `run` of gate `gate` (`name`): paid with `rewards` (the gate's Clear for that
 * hunter), or refused with why. Landed once, and only while that run waits on the player's phone (gates/solo-wait.ts).
 */
export type SoloAnswerPayload = Base & { to: [SheetKey]; run: EventId; gate: GateId; name: string }
  & ({ verdict: 'paid'; rewards: Rewards } | { verdict: 'refused'; why: SoloRefused });
/**
 * Hunter `by` offers hunter `to[0]` the goods `gives`, asking `asks` back (gold, and items of its bag by id). Its id is the
 * offer's (`parseOfferId`); `names` are the two hunters' names as the giving phone showed them. The giver's goods wait aside
 * on its phone until the offer's one end is read (trade/offer.ts). Sealed to the GM and the two hunters' phones.
 */
export type OfferPayload = Base & { by: SheetKey; to: [SheetKey]; names: { by: string; to: string }; gives: Goods; asks: BagPick };
/** How one of an offer's two hunters ends it: the taker accepts or refuses, the giver takes it back. */
export const END_HOWS = ['accept', 'refuse', 'withdraw'] as const;
/**
 * The end of offer `offer` by its hunter `by`, for the other one (`to`): an accept carries the asked goods by value, a
 * refuse or a take back none. Its id is the offer's end id (`endIdOf`), so the room keeps one end of an offer. Sealed.
 */
export type OfferEndPayload = Base & { by: SheetKey; to: [SheetKey]; offer: OfferId; how: (typeof END_HOWS)[number]; gives: Goods };
/** The GM stops offer `offer` between the two hunters of `to`. Its id is the offer's end id, so it races an accept and a take back. Sealed. */
export type OfferStopPayload = Base & { to: [SheetKey, SheetKey]; offer: OfferId };
/**
 * A chapter of a story the GM opened for the hunters of `to` (story/story.ts `chapterLanded`): its window's words, its
 * reward and its quest, its due time made when it opened. No story name, run or chapter number: a player sees what the
 * GM wrote for players. Landed once by its id. Its size is bounded where the chapter is made and at the open
 * (`CHAPTER_MAX`, 48 KiB, so the body with 24 sheet keys stays under the server's 64 KiB). Sealed.
 */
export type ChapterPayload = Base & { to: SheetKey[] } & ChapterBody;
type Payloads = {
  offer: OfferPayload; offerEnd: OfferEndPayload; offerStop: OfferStopPayload;
  system: SystemPayload; award: AwardPayload; quest: QuestPayload; hp: HpPayload; vitals: VitalsPayload; spent: SpentPayload; status: StatusPayload; revive: RevivePayload;
  roll: RollPayload; questUpdate: QuestUpdatePayload; used: UsedPayload; step: StepPayload; cast: CastPayload; pass: PassPayload; chain: ChainPayload;
  coinCall: CoinCallPayload; coinLand: CoinLandPayload; arm: ArmPayload; shadow: ShadowPayload; soloRun: SoloRunPayload; soloAnswer: SoloAnswerPayload; noted: NotedPayload;
  chapter: ChapterPayload;
};
export type EventType = keyof Payloads;
export type PayloadOf<K extends EventType> = Payloads[K];
/** One room message. */
export type RoomEvent = { [K in EventType]: { type: K; payload: Payloads[K] } }[EventType];

/** An event id that is not an offer's end id: only an offer's end carries one (ids.ts `isEndId`, notes-5-trade.md 12.1). */
const plainEid = (v: unknown): EventId => { const e = need(parseEventId(v)); return isEndId(e) ? refuse() : e; };
const base = (o: Rec): Base => ({ eid: plainEid(own(o, 'eid')) });
/** An end's offer and id: the id must be the offer's end id, else the whole end is refused, so the room never stores a mismatched end. */
function endBase(o: Rec): Base & { offer: OfferId } {
  const offer = need(parseOfferId(own(o, 'offer'))), eid = need(parseEventId(own(o, 'eid')));
  return eid === endIdOf(offer) ? { eid, offer } : refuse();
}
/** The one hunter an offer or its end is for, other than its `by`. */
const otherOf = (o: Rec, by: SheetKey): [SheetKey] => { const to = toList(own(o, 'to')); return to.length === 1 && to[0] !== by ? [to[0]!] : refuse(); };
/** A payload of an offer or an end within `OFFER_MAX` bytes. */
const withinOffer = <T>(p: T): T => (goodsSize(p) > OFFER_MAX ? refuse() : p);
/** Sealed to the GM and the hunters an event names (lead's ruling 1 of notes-5-trade.md 10). */
const always = (): boolean => true;
const reason = (o: Rec): string => opt(own(o, 'reason'), text(120), '');
const hpDelta = (o: Rec, k: string): number => opt(own(o, k), int(-MAX_HP, MAX_HP), 0);
/**
 * One event type: who may send it, and its payload's reader. `gmOnly`: only the room's GM key may send it. `ownSheet`: it
 * speaks for the hunter in its `by`, so the server takes it only from the phone that hunter belongs to.
 */
type EventDef<K extends EventType> = {
  readonly gmOnly: boolean; readonly ownSheet: boolean; readonly read: (payload: Rec) => Payloads[K];
  /**
   * Whether a stored event of the type reaches only the GM and the phones of the hunters its `by` and `to` name; absent, never.
   * The server's poll reads it through `servedTo` (notes-5-trade.md 4.1).
   */
  readonly sealed?: (payload: Payloads[K]) => boolean;
  /**
   * What a message of the type stands for, when a newer one takes an older one's place: a fight's totals for one hunter.
   * Absent, each message stands for itself. The GM's outbox keeps one waiting per key (combat.js), and a player's phone
   * lets a held one go once a newer one of its key has come (applied.ts `replaced`).
   */
  readonly standsFor?: (payload: Payloads[K]) => string;
};

/** Every event type. A type missing here does not compile. */
const DEFS: { readonly [K in EventType]: EventDef<K> } = {
  offer: { gmOnly: false, ownSheet: true, sealed: always, read: o => {
    const eid = need(parseEventId(own(o, 'eid'))), by = sheetKey(own(o, 'by')), names = obj(own(o, 'names')), gives = need(parseGoods(own(o, 'gives')));
    if (parseOfferId(eid) === null || noGoods(gives)) return refuse();
    return withinOffer({
      eid, by, to: otherOf(o, by), names: { by: text(60)(own(names, 'by')), to: text(60)(own(names, 'to')) }, gives, asks: need(parseBagPick(own(o, 'asks'))),
    });
  } },
  offerEnd: { gmOnly: false, ownSheet: true, sealed: always, read: o => {
    const b = endBase(o), by = sheetKey(own(o, 'by')), how = choiceOf(END_HOWS)(own(o, 'how')), gives = need(parseGoods(own(o, 'gives')));
    if (how !== 'accept' && !noGoods(gives)) return refuse();
    return withinOffer({ ...b, by, to: otherOf(o, by), how, gives });
  } },
  offerStop: { gmOnly: true, ownSheet: false, sealed: always, read: o => {
    const b = endBase(o), raw = own(o, 'to'), to = Array.isArray(raw) && raw.length === 2 ? raw.map(sheetKey) : refuse();
    return to[0] === to[1] ? refuse() : { ...b, to: [to[0]!, to[1]!] };
  } },
  system: { gmOnly: true, ownSheet: false, read: o => {
    const to = own(o, 'to');
    return { ...base(o), ...(to === undefined ? {} : { to: toList(to) }), tag: opt(own(o, 'tag'), text(40), '! Notification'),
      title: filled(120)(own(o, 'title')), body: opt(own(o, 'body'), text(1000), ''), kind: opt(own(o, 'kind'), choiceOf(SYSTEM_KINDS), 'info') };
  } },
  award: { gmOnly: true, ownSheet: false, read: o => {
    const r = obj(own(o, 'rewards')), build = own(r, 'build'), given = own(o, 'bundle');
    return { ...base(o), to: toList(own(o, 'to')), rewards: { ...rewards(r), ...(build === undefined ? {} : { build: buildChange(build) }) }, ...(given === undefined ? {} : { bundle: givenBundle(given) }) };
  } },
  quest: { gmOnly: true, ownSheet: false, read: o => ({ ...base(o), to: toList(own(o, 'to')), quest: questOffer(own(o, 'quest')) }) },
  hp: { gmOnly: true, ownSheet: false, read: o => ({ ...base(o), to: toList(own(o, 'to')), hp: hpDelta(o, 'hp'), mana: hpDelta(o, 'mana'), fatigue: hpDelta(o, 'fatigue'), reason: reason(o) }) },
  vitals: { gmOnly: true, ownSheet: false, standsFor: p => `vitals ${p.to[0]}`, read: o => {
    const to = toList(own(o, 'to')), total = (k: string): number => int(0, MAX_TOTAL)(own(o, k));
    return {
      ...base(o), to: to.length === 1 ? [to[0]!] : refuse(), hp: total('hp'), mana: total('mana'), fatigue: total('fatigue'),
      statuses: listOf(own(o, 'statuses'), MAX_STATUSES, sheetStatus), reason: reason(o),
    };
  } },
  spent: { gmOnly: true, ownSheet: false, read: o => {
    const to = toList(own(o, 'to'));
    return { ...base(o), to: to.length === 1 ? [to[0]!] : refuse(), item: need(parseSaveId<'i'>(own(o, 'item'))) };
  } },
  status: { gmOnly: true, ownSheet: false, read: o => ({
    ...base(o), to: toList(own(o, 'to')), add: opt(own(o, 'add'), v => listOf(v, MAX_STATUS_CHANGES, sheetStatus), []),
    remove: opt(own(o, 'remove'), v => listOf(v, MAX_STATUS_CHANGES, changeableKey), []), reason: reason(o),
  }) },
  revive: { gmOnly: true, ownSheet: false, read: o => ({ ...base(o), to: toList(own(o, 'to')) }) },
  roll: { gmOnly: false, ownSheet: true, read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), name: opt(own(o, 'name'), text(60), ''), label: opt(own(o, 'label'), text(60), ''),
    expr: opt(own(o, 'expr'), text(60), ''), total: int(-MAX_ROLL, MAX_ROLL)(own(o, 'total')),
    rolls: opt(own(o, 'rolls'), v => listOf(v, MAX_ROLLS, int(-MAX_ROLL, MAX_ROLL)), []), crit: opt(own(o, 'crit'), bool, false),
    fumble: opt(own(o, 'fumble'), bool, false),
  }) },
  questUpdate: { gmOnly: false, ownSheet: true, read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), name: opt(own(o, 'name'), text(60), ''), questId: id(own(o, 'questId')), title: opt(own(o, 'title'), text(120), ''),
    kind: choiceOf(QUEST_KINDS)(own(o, 'kind')), status: choiceOf(QUEST_STATUSES)(own(o, 'status')),
    objectives: opt(own(o, 'objectives'), v => listOf(v, MAX_OBJECTIVES, objective), []),
  }) },
  chain: { gmOnly: true, ownSheet: false, read: o => {
    const job = own(o, 'job');
    return { ...base(o), to: toList(own(o, 'to')), job: isJobName(job) ? job : refuse(), kind: choiceOf(CHAIN_KINDS)(own(o, 'kind')) };
  } },
  used: { gmOnly: false, ownSheet: true, read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), who: opt(own(o, 'who'), text(60), ''), what: choiceOf(USED_WHAT)(own(o, 'what')), name: filled(60)(own(o, 'name')),
    text: opt(own(o, 'text'), text(200), ''), target: opt(own(o, 'target'), choiceOf(USED_TARGETS), 'self'), tell: opt(own(o, 'tell'), bool, false),
  }) },
  step: { gmOnly: false, ownSheet: true, read: o => ({ ...base(o), by: sheetKey(own(o, 'by')), place: tile(own(o, 'place')), at: time0(own(o, 'at')), dash: opt(own(o, 'dash'), bool, false) }) },
  cast: { gmOnly: false, ownSheet: true, read: o => {
    const ability = own(o, 'ability');
    return {
      ...base(o), by: sheetKey(own(o, 'by')),
      ability: typeof ability === 'string' && ability.length > 0 && ability.length <= ABILITY_ID_MAX ? abilityId(ability) : refuse(),
      aim: aim(own(o, 'aim')), at: time0(own(o, 'at')), dice: opt(own(o, 'dice'), v => listOf(v, MAX_DICE, int(0, MAX_FACE)), []),
    };
  } },
  pass: { gmOnly: false, ownSheet: true, read: o => ({ ...base(o), by: sheetKey(own(o, 'by')), at: time0(own(o, 'at')) }) },
  arm: { gmOnly: false, ownSheet: true, read: o => {
    const ability = own(o, 'ability'), on = own(o, 'on');
    const id = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max ? v : refuse();
    return {
      ...base(o), by: sheetKey(own(o, 'by')), ability: ability === null || ability === undefined ? null : abilityId(id(ability, ABILITY_ID_MAX)),
      on: on === null || on === undefined ? null : rowId(on),
    };
  } },
  coinCall: { gmOnly: false, ownSheet: true, read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), roll: roll(own(o, 'roll')), who: opt(own(o, 'who'), text(COIN_TEXT_MAX), ''),
    what: opt(own(o, 'what'), text(COIN_TEXT_MAX), ''), face: need(faceOf(own(o, 'face'))), call: side(own(o, 'call')),
  }) },
  coinLand: { gmOnly: true, ownSheet: false, read: o => ({ ...base(o), roll: roll(own(o, 'roll')), side: side(own(o, 'side')) }) },
  shadow: { gmOnly: true, ownSheet: false, read: o => {
    const to = toList(own(o, 'to'));
    return { ...base(o), to: to.length === 1 ? [to[0]!] : refuse(), shadow: shadowOrigin(own(o, 'shadow')) };
  } },
  soloRun: { gmOnly: false, ownSheet: true, read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), gate: need(parseGateId(own(o, 'gate'))), name: opt(own(o, 'name'), text(NAME_MAX), ''),
    outcome: choiceOf(RUN_OUTCOMES)(own(o, 'outcome')), rounds: num(0, CAP_ROUNDS + 1)(own(o, 'rounds')), life: choiceOf(LIFE_STATES)(own(o, 'life')),
  }) },
  noted: { gmOnly: true, ownSheet: false, read: o => {
    const to = toList(own(o, 'to')), raw = own(o, 'facts');
    if (to.length !== 1 || !Array.isArray(raw) || raw.length > NOTED_MAX) return refuse();
    return { ...base(o), to: [to[0]!] as [SheetKey], facts: raw.flatMap(f => parseFact(f) ?? []) };
  } },
  soloAnswer: { gmOnly: true, ownSheet: false, read: o => {
    const to = toList(own(o, 'to'));
    const b = { ...base(o), to: to.length === 1 ? [to[0]!] as [SheetKey] : refuse(), run: need(parseEventId(own(o, 'run'))), gate: need(parseGateId(own(o, 'gate'))), name: opt(own(o, 'name'), text(WORLD_NAME_MAX), '') };
    return choiceOf(['paid', 'refused'] as const)(own(o, 'verdict')) === 'paid'
      ? { ...b, verdict: 'paid' as const, rewards: rewards(own(o, 'rewards')) }
      : { ...b, verdict: 'refused' as const, why: choiceOf(SOLO_REFUSED)(own(o, 'why')) };
  } },
  chapter: { gmOnly: true, ownSheet: false, sealed: always, read: o => {
    const q = own(o, 'quest');
    return { ...base(o), to: toList(own(o, 'to')), words: need(parseWords(own(o, 'words'))), rewards: rewards(own(o, 'rewards')), quest: q === null || q === undefined ? null : questOffer(q) };
  } },
};

type EventEntry<K extends EventType> = {
  readonly gmOnly: boolean; readonly ownSheet: boolean; readonly parse: (payload: unknown) => Payloads[K] | null; readonly sealed: (payload: Payloads[K]) => boolean;
  readonly standsFor: ((payload: Payloads[K]) => string) | null;
};
/**
 * Per event type: whether only the room's GM key may send it, whether only the phone of the hunter it speaks for may, and
 * its payload parser (unknown in, the payload or null out).
 */
export const EVENTS: { readonly [K in EventType]: EventEntry<K> } = {
  offer: entry('offer'), offerEnd: entry('offerEnd'), offerStop: entry('offerStop'),
  system: entry('system'), award: entry('award'), quest: entry('quest'), hp: entry('hp'), vitals: entry('vitals'), spent: entry('spent'), status: entry('status'),
  revive: entry('revive'), roll: entry('roll'), questUpdate: entry('questUpdate'), used: entry('used'), step: entry('step'), cast: entry('cast'), pass: entry('pass'),
  chain: entry('chain'), coinCall: entry('coinCall'), coinLand: entry('coinLand'), arm: entry('arm'), shadow: entry('shadow'),
  soloRun: entry('soloRun'), soloAnswer: entry('soloAnswer'), noted: entry('noted'),
  chapter: entry('chapter'),
};
function entry<K extends EventType>(type: K): EventEntry<K> {
  const def: EventDef<K> = DEFS[type];
  return { gmOnly: def.gmOnly, ownSheet: def.ownSheet, parse: payload => attempt(() => def.read(obj(payload))), sealed: def.sealed ?? (() => false), standsFor: def.standsFor ?? null };
}
/** What a message stands for, when a newer one of the same takes its place (`EventDef.standsFor`); null when it stands for itself. */
export function standsFor(ev: RoomEvent): string | null {
  // EVENTS pairs each type with the key of its own payload.
  const key = EVENTS[ev.type].standsFor as ((p: RoomEvent['payload']) => string) | null;
  return key ? key(ev.payload) : null;
}
/** The hunter an event speaks for, when its type is `ownSheet`: the server takes it only from that hunter's phone. Else null. */
export const speaksFor = (ev: RoomEvent): SheetKey | null => (EVENTS[ev.type].ownSheet && 'by' in ev.payload ? ev.payload.by : null);
/** Whether a stored event is sealed: it reaches only the GM and the phones of the hunters it names (`EventDef.sealed`). */
export function isSealed(ev: RoomEvent): boolean {
  // EVENTS pairs each type with the seal of its own payload.
  const sealed = EVENTS[ev.type].sealed as (p: RoomEvent['payload']) => boolean;
  return sealed(ev.payload);
}
export const EVENT_TYPES = Object.keys(DEFS) as EventType[];
export const isEventType = (v: unknown): v is EventType => typeof v === 'string' && Object.hasOwn(DEFS, v);

/** The only door into the app for a room message: the typed event, or null when the type is unknown or the payload wrong. */
export function parseEvent(type: unknown, payload: unknown): RoomEvent | null {
  if (!isEventType(type)) return null;
  const p = EVENTS[type].parse(payload);
  // EVENTS pairs each type with its own payload's parser, so `p` is the payload of `type`.
  return p === null ? null : ({ type, payload: p } as RoomEvent);
}

/**
 * What a sender writes: the payload without its id, which `newEvent` makes. Taken member by member, so a payload that is
 * a union (`soloAnswer`'s verdicts) keeps each member's fields.
 */
export type EventBody<K extends EventType> = Payloads[K] extends infer P ? (P extends unknown ? Omit<P, 'eid'> : never) : never;
/** What makes an event id unique: the sending phone, the time in ms and a random number from 0 to 1. */
export type EventStamp = { device: string; now: number; rand: number };
/**
 * The one constructor of a room event: `body` with a new event id, read by the parser the server uses. Null when the
 * server would refuse it. The id is the phone, the time and a random part, so it does not repeat across phones or rooms;
 * at most `OFFER_ID_MAX` characters, so an offer's end id fits, and ending in four random characters, never an end id.
 * An offer's end is made by `endEvent`.
 */
export function newEvent<K extends EventType>(type: K, body: EventBody<K>, stamp: EventStamp): RoomEvent | null {
  const tail = `-${Math.trunc(stamp.now).toString(36)}${Math.floor(stamp.rand * 36 ** 4).toString(36).padStart(4, '0')}`;
  const eid = parseEventId(stamp.device.slice(0, OFFER_ID_MAX - tail.length) + tail);
  return eid && parseEvent(type, { ...body, eid });
}
/** The one constructor of an offer's end: `body` under the offer's end id (`endIdOf`), read by the parser the server uses; null when it would refuse it. */
export function endEvent(type: 'offerEnd', body: EventBody<'offerEnd'>): RoomEvent | null;
export function endEvent(type: 'offerStop', body: EventBody<'offerStop'>): RoomEvent | null;
export function endEvent(type: 'offerEnd' | 'offerStop', body: EventBody<'offerEnd'> | EventBody<'offerStop'>): RoomEvent | null {
  return parseEvent(type, { ...body, eid: endIdOf(body.offer) });
}

/**
 * The row a player's `step`, `cast` or `pass` moves in the GM's fight: the row of the hunter of `p.by`, when the fight is running,
 * it is that row's turn and `p.at` is the fight's `now`. Else null, and the GM's phone does nothing. A turn is one
 * `currentId` at one `now` (time moves on after every use), so a message replayed after its turn, or sent from a stale
 * view, never acts twice.
 */
export function onTurn(f: Fight | null, p: Pick<StepPayload | CastPayload | PassPayload, 'by' | 'at'>): CombatantId | null {
  if (f?.phase !== 'running' || f.now !== p.at) return null;
  const row = f.rows.find(r => r.id === f.currentId);
  // a summon is commanded by its owner's phone (kits design 1.9.2)
  const who = row?.kind === 'summon' ? f.rows.find(r => r.id === row.owner) : row;
  return row && who?.holder?.kind === 'remote' && parseSheetKey(who.holder.remote) === p.by ? row.id : null;
}

// ── room documents: the latest state the GM publishes (stored as sheet rows whose key starts with '_') ──
export { BANDS };
export type { Band, DocRefusal, FightDoc, FightDocRow, TableRefusal } from './combat/fight-doc.ts';
/**
 * The longest room doc the server stores, in characters of its JSON. The fight doc is the longest. Its worst-case row is
 * a monster with a 60-character name, the six longest built-in statuses, a shield with its rounds left, a stagger bar with
 * its stagger, a speed with decimals, a taunt, a channel with a 60-character name, the target its threat suggests, and an
 * intent with a 60-character name revealed with its four lines of 80 characters and its area: about 1,350 characters
 * (milestone 5 added the channel, the taunt, the suggestion and the revealed numbers to the 700 P4 measured). 32 such rows
 * (`DOC_ROWS`) and the rest of the doc (5 log lines of 300, 8 ids ahead, the GM's phone, the time stamp, the last refusal
 * of a player's tap and the current row's cooldowns: 2,523) come to 45,819. Milestone 6 adds the map: a tile text and a
 * lit line of 1,600 characters each (a 40 by 40 map, `DOC_TILES_MAX`; the map's own characters, not a list of objects)
 * and 16 zones (`MAX_ZONES`) of about 340 each (a 40-character id and name, runs of `DOC_ZONE_RUNS` 200): 54,800 in all,
 * which tests/protocol.test.ts builds. Design 4.8 adds an aura's row to each zone (`"anchor":"m-00"`, 16 characters
 * with a row id as the doc's rows have them): 256 more, 55,056. With an eighth to spare that is 55,056 x 9 / 8 = 61,938, under 62,000, under
 * the server's 64 KiB body with its wrapper (a fifth to spare no longer fits under it). The kits (kits design 1.11) add a
 * stack count to each of a row's six statuses (`"stacks":20`, 12 characters) and the current row's uses left (12 ability
 * ids of 40 characters, 562): 57,642 at 32 rows, over, so `DOC_ROWS` is 30, a worst-case row of 1,425 with its stacks,
 * 54,790 in all (measured by the test) and 61,639 with the eighth. Wave 2 (kits design 8.4.8) adds the party's rows with
 * a ready reaction, 12 row ids (`kit.doArmed`, 87 characters with the key): 54,877, 61,737 with the eighth; with each
 * reaction's ability id it would be 62,325, over, so the doc names the rows only. The table's kits (kits table 8.9.1, rule
 * 18a) add the rows whose reaction is spent and the last command's bursts, 12 row ids each with a count: 55,094 (measured
 * by the test), 61,981 with the eighth: 19 characters to spare, so the doc went on the wire in a shorter shape
 * (fight-doc.ts `fightWire`): the same fields with one or two letter names below the top level, a field at its default
 * left out, a place as `[x, y]`, a band as its index, and the lit line packed six tiles a character (1,600 to 267). The
 * same content, with each status's source tier added and each status's def sent once in the doc's table rather than its
 * label on every row (the six built-ins' defs, 1,052), is 44,557 (a row 1,093; rows 32,821, zones 5,425, grid 1,902, log
 * 1,516). The table can take another shape: full at `DOC_DEFS_MAX` (6,000), with every other status named inline because
 * its def is not the table's: 52,416 (rows 35,750, defs 5,982), 58,968 with the eighth, 3,032 to spare. The test prints
 * both shapes by part. A summon's row is a shadow's with its owner's id and its rounds left. A hunter's or shadow's row
 * carries no intent, stagger or suggestion but its HP, maximum, stride and `move`: with the same name, statuses, channel
 * and taunt it is still shorter than the monster's, so the worst case stays all monsters; the test checks both numbers
 * and that a hunter's row is no longer. The shorter shape left room for what the doc once could not hold: each armed or
 * spent row's reaction by row (`reacts`, 24 entries of a 40-character row id and a 40-character ability id, 1,211): 45,768
 * and 53,627 (measured by the test), 60,179 with the eighth, 1,821 to spare, so a player's phone keeps no copy of what it
 * armed (implicit audit 3, T1).
 */
export const DOC_MAX = 62000;
/**
 * The longest sheet push the room takes, as the server measures it (the push's `data`, `{ hunter }`, as JSON). A
 * player's phone counts it before it sends, so a sheet past it reads as too big, not as "not sent" (implicit audit 3,
 * SV1: it was a literal of server.ts only).
 */
export const SHEET_MAX = 32768;
/** A removal in the `_kicked` doc younger than this keeps the player out; the server drops older ones when it writes the doc. */
export const REMOVED_MS = 600000;
/** Hunters the GM removed, by sheet key: when, and the name to show. Written only by the server (its removal routes). */
export type KickedDoc = { keys: Record<SheetKey, string>; names: Record<SheetKey, string> };
/** A monster the GM's party has met, shared with the players' bestiary. */
export type CodexDocEntry = {
  key: string; name: string; rank: Rank; hpMax: number; armor: number; resist: number; speed: number; abilities: string[]; kills: number; firstAt: string;
};
export type CodexDoc = { at: string; entries: CodexDocEntry[] };
/** How many entries the codex doc holds at most; the GM's phone builds it within this and `DOC_MAX` (bestiary.ts `codexDoc`). */
export const CODEX_DOC_ENTRIES = 200;
/**
 * The GM's rules a player's phone plays by in the room (src/core/hunter/build.ts `withRoomRules`): the build switches,
 * and the personal gates' switch and hours (`RULES.solo`). Laid over the player's own rules, never written to its save.
 * `feats.on`: the GM's switch for the feats the System notices (hunter/feats.ts); a doc without it reads as on.
 */
export type RoomRules = { build: { enabled: boolean; playerPick: boolean }; solo: { personal: boolean; hours: number }; feats: { on: boolean } };
/** A gate as the room's world doc carries it: a cleared one with the day it was cleared (gate.ts `countdown` reads both); `solo` when the solo doc holds it. */
export type WorldGate = ShownGate & { solo?: true };
/** One roster line of a solo gate in the solo doc: `n` of the doc's monster `m` (its key in `monsters`). */
export type SoloDocLine = { m: string; n: number };
/** A gate open to solo runs as the solo doc carries it: its roster, its last line the boss when `boss`. */
export type SoloDocGate = { id: GateId; name: string; rank: Rank; boss: boolean; lines: SoloDocLine[] };
/**
 * What a player's phone needs to play the room's solo gates (gates/solo.ts `soloDoc`): each gate's roster, each monster
 * once by value as `parseMonster` reads it (its text fields left out), and the GM's statuses those monsters name.
 */
export type SoloDoc = { gates: SoloDocGate[]; monsters: Record<string, MonsterTemplate>; statuses: Record<string, StatusDef> };
/*
 * The solo doc's size against `DOC_MAX`. Its builder (`soloDoc`) adds a gate whole only while the doc's JSON stays
 * within `DOC_MAX`, so the doc is never longer by construction, and the reader refuses a longer one. What decides how
 * many gates fit is the monsters, each sent once. Measured (tests/protocol.test.ts, "the worst-case solo doc on the
 * wire"): 40 gates of 60-character names, three lines of 26 copies and a boss each, naming every one of the 22 built-in
 * monsters, are 29,996 characters: 9,466 of gates (about 237 a gate) and 20,209 of monsters (about 920 a monster, the
 * largest 1,744), under half of `DOC_MAX`. A GM's monster at its bounds is far larger (11 abilities with their ops and
 * nested status defs), so one gate of many of them can pass `DOC_MAX` alone: such a gate is never sent, the world doc
 * does not mark it solo, and the GM's card says so (the same test builds one of 50 such monsters and sees it left out).
 */
/** The bounds of the solo doc's reader besides `DOC_MAX`: roster lines a gate (a gate's 50 and its boss), monsters, statuses. */
export const SOLO_DOC = { lines: 51, monsters: 400, statuses: 400 } as const;
/** The world doc's bounds: at most `WORLD_GATES` gates, each name at most `WORLD_NAME_MAX` characters (gates/world.ts `worldDoc` keeps within them). */
export const WORLD_GATES = 40, WORLD_NAME_MAX = 60;
/** The world day, the GM's session count (`world.session`: the session a player's facts belong to) and the gates players see. */
export type WorldDoc = { day: number; session: number; gates: WorldGate[] };
/**
 * The GM's feats a player's phone checks (feature 1's notes 3.2): the GM's own and the GM's edits of the built-ins,
 * each by value as `parseFeat` reads it, under its key; `featsDoc` (hunter/feats.ts) adds whole entries while the doc's
 * JSON stays within `DOC_MAX`. The switch is the `rules` doc's.
 */
export type FeatsDoc = { feats: Record<string, FeatDef> };
/** The most feats the doc holds: the library's cap. */
export const FEATS_DOC_MAX = 100;
type Docs = { fight: FightDoc; kicked: KickedDoc; codex: CodexDoc; rules: RoomRules; world: WorldDoc; solo: SoloDoc; feats: FeatsDoc };
export type DocName = keyof Docs;
export type DocOf<K extends DocName> = Docs[K];

/** The doc's table of status defs (fight-doc.ts `fightWire`): each read by `parseStatusDef`, a bad one dropped; past `DOC_DEFS_MAX` characters the doc is refused. */
function docDefs(v: unknown): Record<string, StatusDef> {
  if (v === undefined) return {};
  if (JSON.stringify(v).length > DOC_DEFS_MAX) return refuse();
  const out: Record<string, StatusDef> = {};
  for (const [k, x] of Object.entries(obj(v))) {
    const key = attempt(() => keyOf(k)), def = parseStatusDef(x, RULES);
    if (key !== null && def) out[key] = def;
  }
  return out;
}
/**
 * A status on the wire: k key, b label (only when its def is not the doc's table's under its key; else the def is that
 * one), l rounds left, n stacks, t its source's tier.
 */
function docStatus(v: unknown, defs: Record<string, StatusDef>): DocStatus {
  const o = obj(v), key = keyOf(own(o, 'k')), named = own(o, 'b'), stacks = own(o, 'n');
  const def = named === undefined ? (Object.hasOwn(defs, key) ? defs[key]! : refuse()) : undefined;
  const out = {
    key, label: def ? def.label : filled(NAME_MAX)(named), left: opt(own(o, 'l'), num(0, MAX_TOTAL), null),
    tier: opt(own(o, 't'), int(0, RANKS.length - 1), 0), ...(def ? { def } : {}),
  };
  return stacks === undefined ? out : { ...out, stacks: int(1, RULES.fight.kit.stackCap)(stacks) };
}
/** A band on the wire, its index in `BANDS`. */
const bandAt = (v: unknown): Band => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < BANDS.length ? BANDS[v]! : refuse());
/** A place on the wire, `[x, y]`. */
function wirePlace(v: unknown): DocPlace {
  if (!Array.isArray(v) || v.length !== 2) return refuse();
  return tile({ x: v[0], y: v[1] });
}
/** An intent on the wire: n name, t its aim (a row id or a place), r its revealed numbers (l lines, r radius, o outer). */
function docIntent(v: unknown): DocIntent {
  const o = obj(v), r = opt(own(o, 'r'), obj, null), t = own(o, 't');
  const reveal = r && {
    lines: listOf(own(r, 'l'), DOC_INTENT_LINES, text(INTENT_LINE_MAX)),
    radius: opt(own(r, 'r'), int(0, MAX_TILE + 1), null), outer: opt(own(r, 'o'), int(0, MAX_TILE + 1), null),
  };
  return { name: text(NAME_MAX)(own(o, 'n')), target: typeof t === 'string' ? rowId(t) : wirePlace(t), reveal };
}
/** A channel on the wire: a ability, n name, c charge, m max, s state, f factor. */
function docChannel(v: unknown): DocChannel {
  const o = obj(v);
  const ability = own(o, 'a');
  return {
    ability: typeof ability === 'string' && ability.length > 0 && ability.length <= ABILITY_ID_MAX ? abilityId(ability) : refuse(),
    name: text(NAME_MAX)(own(o, 'n')), charge: int(0, MAX_CHARGE)(own(o, 'c')), max: int(0, MAX_CHARGE)(own(o, 'm')),
    state: choiceOf(['holding', 'broken', 'fired'] as const)(own(o, 's')), factor: num(0, MAX_TOTAL)(own(o, 'f')),
  };
}
/** A taunt on the wire: b who taunted, l rounds left. */
function docTaunt(v: unknown): DocTaunt {
  const o = obj(v);
  return { by: rowId(own(o, 'b')), left: opt(own(o, 'l'), num(0, MAX_TOTAL), null) };
}
/**
 * One row of the fight doc, by the wire's names (fight-doc.ts `rowWire`). Players never get a monster's HP; a hunter's or
 * shadow's is never past its maximum.
 */
function fightRow(v: unknown, defs: Record<string, StatusDef>): FightDocRow {
  const o = obj(v), n = (k: string): number => num(0, MAX_TOTAL)(own(o, k));
  const row = {
    id: rowId(own(o, 'i')), name: text(NAME_MAX)(own(o, 'n')), side: choiceOf(['party', 'foe'] as const)(own(o, 's')),
    key: opt(own(o, 'k'), sheetKey, null), place: wirePlace(own(o, 'p')), at: time0(own(o, 'a')), speed: n('v'),
    band: bandAt(own(o, 'b')), statuses: opt(own(o, 'st'), x => listOf(x, DOC_STATUSES, s => docStatus(s, defs)), []),
    shield: opt(own(o, 'sh'), num(0, MAX_TOTAL), null), shieldLeft: opt(own(o, 'sl'), num(0, MAX_TOTAL), null), channel: opt(own(o, 'c'), docChannel, null),
    taunt: opt(own(o, 't'), docTaunt, null), down: opt(own(o, 'd'), bool, false),
  };
  const kind = choiceOf(['monster', 'hunter', 'shadow', 'summon'] as const)(own(o, 'q'));
  if (kind === 'monster') {
    const st = own(o, 'g'), stagger = st === undefined ? null : {
      fill: int(0, MAX_TOTAL)(own(obj(st), 'f')), max: int(0, MAX_TOTAL)(own(obj(st), 'm')), staggered: opt(own(obj(st), 's'), num(0, MAX_TOTAL), null),
    };
    return { ...row, kind, intent: opt(own(o, 'in'), docIntent, null), stagger, suggest: opt(own(o, 'u'), rowId, null) };
  }
  const hpMax = int(1, MAX_TOTAL)(own(o, 'hm'));
  const body = { hp: int(0, hpMax)(own(o, 'h')), hpMax, stride: int(0, MAX_TILE + 1)(own(o, 'r')), move: int(0, MAX_TILE + 1)(own(o, 'm')) };
  return kind === 'summon' ? { ...row, kind, ...body, owner: rowId(own(o, 'o')), left: opt(own(o, 'l'), num(0, MAX_TOTAL), null) } : { ...row, kind, ...body };
}
/** The characters a doc's tile text may hold: each terrain's, and the unseen tile's. */
const TILE_CHARS = new Set([...TERRAINS.map(t => TERRAIN[t].char), UNSEEN]);
/**
 * The doc's map: its size, a tile text of exactly w times h known characters or none, and a lit line packed six tiles a
 * character (fight-doc.ts `packBits`) or none; each at most `DOC_TILES_MAX` tiles.
 */
function docGrid(v: unknown): DocGrid {
  const g = obj(v), side = (k: string): number => int(1, MAX_TILE + 1)(own(g, k)), w = side('w'), h = side('h');
  if (w * h > DOC_TILES_MAX && (own(g, 'tiles') !== undefined || own(g, 'lit') !== undefined)) return refuse();
  const tiles = opt(own(g, 'tiles'), t => typeof t === 'string' && t.length === w * h && [...t].every(c => TILE_CHARS.has(c)) ? t : refuse(), null);
  const lit = opt(own(g, 'lit'), t => (typeof t === 'string' ? unpackBits(t, w * h) : null) ?? refuse(), null);
  return { w, h, tiles, lit };
}
/**
 * A zone on the wire: i an id of 1 to 40 characters, n a name, t runs of at most `DOC_ZONE_RUNS` characters, o a tone, l
 * the rounds left, a the row an aura moves with.
 */
function docZone(v: unknown): DocZone {
  const o = obj(v), zid = own(o, 'i'), runs = text(DOC_ZONE_RUNS)(own(o, 't'));
  return {
    id: typeof zid === 'string' && zid.length > 0 && zid.length <= 40 ? zoneId(zid) : refuse(), name: filled(ZONE_NAME_MAX)(own(o, 'n')),
    tiles: /^[0-9+,]*$/.test(runs) ? runs : refuse(), tone: choiceOf(['harm', 'help', 'hinder', 'plain'] as const)(own(o, 'o')),
    left: opt(own(o, 'l'), num(0, MAX_TOTAL), null), anchor: opt(own(o, 'a'), rowId, null),
  };
}
/** The fight doc as `fightWire` (src/core/combat/fight-doc.ts) puts it on the wire, with its bounds. */
function fightDocOf(o: Rec): FightDoc {
  const docId = fightId(id(own(o, 'id'))), at = text(40)(own(o, 'at'));
  if (own(o, 'ended') === true) return { ended: true, active: false, id: docId, at };
  const defs = docDefs(own(o, 'defs'));
  return {
    ended: false, active: bool(own(o, 'active')), by: deviceId(own(o, 'by')), id: docId, at, now: time0(own(o, 'now')),
    currentId: nullOr(rowId)(own(o, 'currentId')), ahead: listOf(own(o, 'ahead'), DOC_AHEAD, rowId), grid: docGrid(own(o, 'grid')),
    zones: opt(own(o, 'zones'), v => listOf(v, MAX_ZONES, docZone), []),
    rows: listOf(own(o, 'rows'), DOC_ROWS, v => fightRow(v, defs)), log: listOf(own(o, 'log'), DOC_LOG, text(LOG_LINE_MAX)),
    refused: attempt(() => opt(own(o, 'refused'), nullOr(docRefusal), null)),
    ready: docReady(own(o, 'ready')), ...docLeft(own(o, 'left')), ...docIds('armed', own(o, 'armed')), ...docIds('spent', own(o, 'spent')), ...docReacts(own(o, 'reacts')),
    ...docBurst(own(o, 'burst')),
  };
}
/** At most `kit.doArmed` row ids; a bad one is dropped. */
const rowIds = (v: unknown): CombatantId[] =>
  (Array.isArray(v) ? v : []).slice(0, RULES.fight.kit.doArmed).flatMap(x => { const r = attempt(() => rowId(x)); return r === null ? [] : [r]; });
/** The party's rows with a ready reaction or a spent one (kits design 8.4.8, table 8.9.1); none, nothing. */
function docIds<K extends 'armed' | 'spent'>(k: K, v: unknown): { [P in K]?: CombatantId[] } {
  return (v === undefined ? {} : { [k]: rowIds(v) }) as { [P in K]?: CombatantId[] };
}
/** The armed reaction of each row of `armed` and `spent`: at most twice `kit.doArmed` rows, each an ability id of up to 40 characters; a bad entry is dropped; none, nothing. */
function docReacts(v: unknown): { reacts?: Record<CombatantId, AbilityId> } {
  if (!isObj(v)) return {};
  const out: Record<CombatantId, AbilityId> = {};
  for (const [k, a] of Object.entries(v).slice(0, 2 * RULES.fight.kit.doArmed)) {
    const r = attempt(() => rowId(k)), ab = typeof a === 'string' && a.length > 0 && a.length <= 40 ? (a as AbilityId) : null;
    if (r !== null && ab !== null) out[r] = ab;
  }
  return { reacts: out };
}
/** The thresholds that went off in the GM's last command that set any off: a count and the bearers; anything else, nothing. */
function docBurst(v: unknown): { burst?: DocBurst } {
  if (!isObj(v)) return {};
  const n = attempt(() => int(0, Number.MAX_SAFE_INTEGER)(own(v, 'n')));
  return n === null ? {} : { burst: { n, ids: rowIds(own(v, 'ids')) } };
}
/** The current row's uses left (kits table 2.3): at most `DOC_READY` ability ids of up to 40 characters, each 0 to `fightUses`; a bad entry is dropped; none, nothing. */
function docLeft(v: unknown): { left?: Record<string, number> } {
  if (v === undefined) return {};
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(isObj(v) ? v : {}).slice(0, DOC_READY)) {
    const n = attempt(() => int(0, RULES.fight.kit.fightUses)(x));
    if (k.length >= 1 && k.length <= 40 && n !== null) out[k] = n;
  }
  return { left: out };
}
/** The current row's cooldowns: at most `DOC_READY` ability ids of up to 40 characters, each with a time; a bad entry is dropped. */
function docReady(v: unknown): Record<string, Tick> {
  const out: Record<string, Tick> = {};
  for (const [k, x] of Object.entries(isObj(v) ? v : {}).slice(0, DOC_READY)) {
    const at = attempt(() => time0(x));
    if (k.length >= 1 && k.length <= 40 && at !== null) out[k] = at;
  }
  return out;
}
function docRefusal(v: unknown): DocRefusal {
  const o = obj(v);
  return { id: rowId(own(o, 'id')), at: time0(own(o, 'at')), reason: choiceOf(TABLE_REFUSALS)(own(o, 'reason')), n: int(0, MAX_TOTAL)(own(o, 'n')) };
}
/** A record keyed by sheet key: at most 50 entries, each value read by `read`. A bad key or value drops the entry. */
function bySheetKey<T>(v: unknown, read: (v: unknown) => T): Record<SheetKey, T> {
  const out: Record<SheetKey, T> = {};
  for (const [k, x] of Object.entries(obj(v)).slice(0, 50)) {
    const key = parseSheetKey(k), value = attempt(() => read(x));
    if (key && value !== null) out[key] = value;
  }
  return out;
}
function codexEntry(v: unknown): CodexDocEntry {
  const o = obj(v), stat = (k: string): number => opt(own(o, k), int(0, MAX_TOTAL), 0);
  return {
    key: filled(100)(own(o, 'key')), name: text(60)(own(o, 'name')), rank: opt(own(o, 'rank'), choiceOf(RANKS), 'E'), hpMax: stat('hpMax'),
    armor: stat('armor'), resist: stat('resist'), speed: stat('speed'), abilities: opt(own(o, 'abilities'), v => listOf(v, 4, text(70)), []),
    kills: opt(own(o, 'kills'), int(1, 1e9), 1),
    firstAt: opt(own(o, 'firstAt'), text(40), ''),
  };
}
function worldGate(v: unknown): WorldGate {
  const o = obj(v);
  const base = { id: id(own(o, 'id')) as GateId, name: text(WORLD_NAME_MAX)(own(o, 'name')), rank: choiceOf(RANKS)(own(o, 'rank')), type: choiceOf(GATE_TYPES)(own(o, 'type')), breakDay: int(0, 1e6)(own(o, 'breakDay')) };
  const status = choiceOf(GATE_STATUSES)(own(o, 'status'));
  const g = shownGate(base, status, status === 'cleared' ? int(0, 1e6)(own(o, 'clearedDay')) : null);
  return opt(own(o, 'solo'), bool, false) ? { ...g, solo: true } : g;
}
/** A solo gate of the solo doc: its id, name, rank, whether its last line is the boss, its lines. */
function soloGate(v: unknown): SoloDocGate {
  const o = obj(v);
  return {
    id: need(parseGateId(own(o, 'id'))), name: text(WORLD_NAME_MAX)(own(o, 'name')), rank: choiceOf(RANKS)(own(o, 'rank')), boss: bool(own(o, 'boss')),
    lines: listOf(own(o, 'lines'), SOLO_DOC.lines, l => { const x = obj(l); return { m: id(own(x, 'm')), n: int(1, MONSTER_BOUNDS.copies)(own(x, 'n')) }; }),
  };
}
/** The solo doc, within `DOC_MAX`: each monster read by `parseMonster`, each status by `parseStatusDef`, a bad entry dropped. */
function soloDocOf(data: unknown): SoloDoc {
  if (JSON.stringify(data).length > DOC_MAX) return refuse();
  const o = obj(data), monsters: Record<string, MonsterTemplate> = {}, statuses: Record<string, StatusDef> = {};
  for (const [k, v] of Object.entries(obj(own(o, 'monsters'))).slice(0, SOLO_DOC.monsters)) {
    const m = k !== '__proto__' && k.length > 0 && k.length <= 80 ? parseMonster(v) : null;
    if (m) monsters[k] = m;
  }
  for (const [k, v] of Object.entries(obj(own(o, 'statuses'))).slice(0, SOLO_DOC.statuses)) {
    const key = attempt(() => keyOf(k)), def = key === null || k === '__proto__' ? null : parseStatusDef(v, RULES);
    if (key !== null && def) statuses[key] = def;
  }
  return { gates: listOf(own(o, 'gates'), WORLD_GATES, soloGate), monsters, statuses };
}

/** Every room document by name, with its parser (unknown in, the doc or null out). A name missing here does not compile. */
export const DOCS: { readonly [K in DocName]: (data: unknown) => Docs[K] | null } = {
  fight: data => attempt(() => fightDocOf(obj(data))),
  kicked: data => attempt(() => { const o = obj(data); return { keys: bySheetKey(own(o, 'keys'), time), names: opt(own(o, 'names'), v => bySheetKey(v, text(60)), {}) }; }),
  codex: data => attempt(() => { const o = obj(data); return { at: text(40)(own(o, 'at')), entries: listOf(own(o, 'entries'), CODEX_DOC_ENTRIES, codexEntry) }; }),
  rules: data => attempt(() => {
    const o = obj(data), b = obj(own(o, 'build')), so = obj(own(o, 'solo'));
    return { build: { enabled: bool(own(b, 'enabled')), playerPick: bool(own(b, 'playerPick')) }, solo: { personal: bool(own(so, 'personal')), hours: int(1, SOLO_BOUNDS.hours)(own(so, 'hours')) }, feats: { on: own(obj(opt(own(o, 'feats'), v => v, {})), 'on') !== false } };
  }),
  world: data => attempt(() => { const o = obj(data); return { day: int(1, 1e6)(own(o, 'day')), session: opt(own(o, 'session'), int(0, 1e6), 0), gates: listOf(own(o, 'gates'), WORLD_GATES, worldGate) }; }),
  solo: data => attempt(() => soloDocOf(data)),
  feats: data => attempt(() => ({ feats: parseFeats(own(obj(data), 'feats'), FEATS_DOC_MAX) })),
};
/**
 * Each doc as it goes on the wire, which `DOCS` reads back: the fight's shorter shape (fight-doc.ts `fightWire`), the rest as
 * they are. The server stores and serves a doc in this shape, after `DOCS` read it.
 */
export const WIRES: { readonly [K in DocName]: (doc: Docs[K]) => object } = {
  fight: fightWire, kicked: d => d, codex: d => d, rules: d => d, world: d => d, solo: d => d, feats: d => d,
};
/** A room's docs as they go on the wire (`WIRES`), each with when and from whom. */
export function wireDocs(docs: RoomDocs): Partial<Record<DocName, Stored<unknown>>> {
  const out: Partial<Record<DocName, Stored<unknown>>> = {};
  const put = <K extends DocName>(name: K): void => { const d = docs[name] as Stored<Docs[K]> | undefined; if (d) out[name] = { ...d, data: WIRES[name](d.data) }; };
  for (const name of Object.keys(DOCS) as DocName[]) put(name);
  return out;
}
export const parseDocName = (v: unknown): DocName | null => (typeof v === 'string' && Object.hasOwn(DOCS, v) ? (v as DocName) : null);

// ── hunter sheets ──
/** What a phone leaves for a hunter it deleted, so the GM's board drops the hunter. */
export type Tombstone = { deleted: true };
/** What a player's phone pushes for its hunter: the hunter as it is now. */
export type PushedSheet = { hunter: Hunter };
export type RoomSheet = PushedSheet | Tombstone;
const SHEET_LISTS = ['conditions', 'titles', 'quests', 'skills', 'items', 'shadows', 'loadouts', 'boons'] as const;
const SHEET_LIST_MAX = 100;
/** A JSON copy without `__proto__` keys, or null when it cannot be copied (too deep). */
function plainCopy(v: unknown): unknown {
  try { return JSON.parse(JSON.stringify(v), (k, x: unknown) => (k === '__proto__' ? undefined : x)); } catch { return null; } // too deep: its reader refuses null
}
/**
 * The sheet stored under `key`: a tombstone, or the hunter repaired the way a save repairs one (`parseSheetHunter` in
 * save.ts), each of its lists cut to 100. Null when it is neither, or when the hunter's own id is not the one in the key.
 */
export function parseSheet(key: SheetKey, data: unknown): RoomSheet | null {
  if (!isObj(data)) return null;
  if (own(data, 'deleted') === true) return { deleted: true };
  const raw = own(data, 'hunter');
  if (!isObj(raw) || own(raw, 'id') !== hunterIdOf(key)) return null;
  const copy = plainCopy(raw);
  if (!isObj(copy)) return null;
  for (const k of SHEET_LISTS) { const list = copy[k]; if (Array.isArray(list)) copy[k] = list.slice(0, SHEET_LIST_MAX); }
  const h = parseSheetHunter(copy);
  return h && h.id === hunterIdOf(key) ? { hunter: h } : null;
}

// ── what each phone gets of the room (notes-5-trade.md 4.1, rulings 1 and 4) ──
/** The most bag lines a face carries. */
export const FACE_LINES = 40;
/** One unworn line of a hunter's bag as the other players see it: what an offer may ask for. */
export type FaceLine = { id: ItemId; name: string; qty: number; rar: Rarity };
/**
 * A hunter as the other players in the room see it: who it is, and its unworn bag lines in bag order, or `null` when the
 * table shows no bags (the caller of `hunterFace` decides; an empty bag is `[]`). It holds no quest, title or status.
 */
export type HunterFace = { face: { name: string; level: number; job: string | null; bag: FaceLine[] | null } };
/** A sheet as a poll answers it: whole, a tombstone, or a face. The store holds only a `RoomSheet`. */
export type ServedSheet = RoomSheet | HunterFace;
/** Who asks for the room: the GM (its key), a phone proven by its device token (server.ts `proven`), or anyone who knows the code. */
export type RoomViewer = { readonly kind: 'gm' } | { readonly kind: 'phone'; readonly device: DeviceId } | { readonly kind: 'anyone' };
/** `h` as the other players see it; its bag lines only when `bags`. */
export function hunterFace(h: Hunter, o: { readonly bags: boolean }): HunterFace {
  const worn = new Set(Object.values(h.equipped));
  const bag = o.bags ? h.items.filter(i => !worn.has(i.id)).slice(0, FACE_LINES).map(i => ({ id: i.id, name: i.name, qty: i.qty, rar: i.rar })) : null;
  return { face: { name: h.name, level: h.level, job: h.job, bag } };
}
/** The sheet under `key` as `v` gets it: whole to the GM and to the phone the key belongs to, a face to anyone else. */
export function sheetFor(key: SheetKey, sheet: RoomSheet, v: RoomViewer, o: { readonly bags: boolean }): ServedSheet {
  if ('deleted' in sheet || v.kind === 'gm' || (v.kind === 'phone' && deviceOf(key) === v.device)) return sheet;
  return hunterFace(sheet.hunter, o);
}
/** The hunters a stored event names: its `by` and every key of its `to`. */
function named(ev: RoomEvent): readonly SheetKey[] {
  const p = ev.payload;
  return [...('by' in p ? [p.by] : []), ...('to' in p && p.to ? p.to : [])];
}
/** Whether `v` gets a stored event: the GM every one; a sealed one only the phones of the hunters it names; any other, everyone. */
export function servedTo(ev: RoomEvent, v: RoomViewer): boolean {
  if (v.kind === 'gm' || !isSealed(ev)) return true;
  return v.kind === 'phone' && named(ev).some(k => deviceOf(k) === v.device);
}
const faceLine = (v: unknown): FaceLine => {
  const o = obj(v);
  return { id: need(parseSaveId<'i'>(own(o, 'id'))), name: text(ITEM_BOUNDS.name)(own(o, 'name')), qty: int(1, ITEM_BOUNDS.qty)(own(o, 'qty')), rar: choiceOf(RARITIES)(own(o, 'rar')) };
};
/** A sheet in a poll answer: a face (each bag line that reads, at most `FACE_LINES`), else what `parseSheet` reads. */
export function parseServedSheet(key: SheetKey, data: unknown): ServedSheet | null {
  const raw = isObj(data) ? own(data, 'face') : undefined;
  if (raw === undefined) return parseSheet(key, data);
  return attempt(() => {
    const f = obj(raw), bag = own(f, 'bag');
    return { face: { name: text(NAME_MAX)(own(f, 'name')), level: int(1, MAX_LEVEL)(own(f, 'level')), job: nullOr(text(NAME_MAX))(own(f, 'job')), bag: bag === null ? null : listOf(bag, FACE_LINES, faceLine) } };
  });
}

// ── the poll answer ──
/** A sheet or doc as the server keeps it: when it was written, by which phone. */
export type Stored<T> = { at: string; from: DeviceId; data: T };
/** An event as the server keeps it: its place in the room (`seq`), when, and the phone that sent it. */
export type StoredEvent = RoomEvent & { seq: number; at: string; from: DeviceId };
export type RoomDocs = { [K in DocName]?: Stored<Docs[K]> };
/**
 * What `GET /api/rooms/:code` answers. `next` is the cursor to ask from next; `more` says the page was full. Only the
 * GM is sent `presence`: each phone's last poll.
 */
export type RoomState = {
  gm: boolean; now: string; presence?: Record<DeviceId, string>; events: StoredEvent[]; next: number; more: boolean;
  sheets: Record<SheetKey, Stored<ServedSheet>>; docs: RoomDocs;
};

function stored<T>(v: unknown, read: (data: unknown) => T | null): Stored<T> {
  const o = obj(v);
  return { at: text(40)(own(o, 'at')), from: deviceId(own(o, 'from')), data: need(read(own(o, 'data'))) };
}
function storedEvent(v: unknown): StoredEvent {
  const o = obj(v), event = need(parseEvent(own(o, 'type'), own(o, 'payload')));
  return { ...event, seq: int(1, Number.MAX_SAFE_INTEGER)(own(o, 'seq')), at: text(40)(own(o, 'at')), from: deviceId(own(o, 'from')) };
}
function roomDocs(v: unknown): RoomDocs {
  const o = obj(v), out: RoomDocs = {};
  const put = <K extends DocName>(name: K): void => {
    const raw = own(o, name);
    const doc = raw === undefined ? null : attempt(() => stored(raw, DOCS[name]));
    const docs: { [P in K]?: Stored<Docs[P]> } = out;
    if (doc) docs[name] = doc;
  };
  for (const name of Object.keys(DOCS) as DocName[]) put(name);
  return out;
}
/** The poll answer, typed, or null when it is not one. A bad event, sheet or doc in it is dropped; `next` still passes it. */
export function parseRoomState(v: unknown): RoomState | null {
  return attempt(() => {
    const o = obj(v), presence = own(o, 'presence');
    const sheets: Record<SheetKey, Stored<ServedSheet>> = {};
    for (const [k, x] of Object.entries(obj(own(o, 'sheets'))).slice(0, SHEET_LIST_MAX)) {
      const key = parseSheetKey(k), sheet = key && attempt(() => stored(x, data => parseServedSheet(key, data)));
      if (key && sheet) sheets[key] = sheet;
    }
    const state: RoomState = {
      gm: bool(own(o, 'gm')), now: text(40)(own(o, 'now')), events: listOf(own(o, 'events'), ROOM_PAGE, storedEvent),
      next: int(0, Number.MAX_SAFE_INTEGER)(own(o, 'next')), more: bool(own(o, 'more')), sheets, docs: roomDocs(own(o, 'docs')),
    };
    if (presence !== undefined) {
      const seen: Record<DeviceId, string> = {};
      for (const [k, t] of Object.entries(obj(presence)).slice(0, 200)) { const d = parseDeviceId(k); if (d && typeof t === 'string') seen[d] = t.slice(0, 40); }
      state.presence = seen;
    }
    return state;
  });
}
