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
import { LIFE_STATES, parseLife } from './hunter/vitals.ts';
import type { Life, LifeState } from './hunter/vitals.ts';
import type { ShadowOrigin } from './hunter/shadows.ts';
import { RAISES } from './hunter/revive-standing.ts';
import type { Raise } from './hunter/revive-standing.ts';
import { BUNDLE_NAME, newRewards, parseRewards, parseWords } from './rewards.ts';
import type { SystemWords } from './rewards.ts';
import { RANKS, RULES, SOLO_BOUNDS, domainOf } from './rules.ts';
import type { Rules } from './rules.ts';
import { parseFact } from './hunter/facts.ts';
import type { Fact } from './hunter/facts.ts';
import { parseFeats } from './hunter/feats.ts';
import type { FeatDef } from './hunter/feats.ts';
import { parseObjectiveCount } from './hunter/counts.ts';
import { questReaches } from './hunter/quest-secret.ts';
import { oneOf } from './one-of.ts';
import type { Hunter, Objective, Quest, QuestKind, QuestStatus, Rank, Rewards } from './save.ts';
import { isJobName } from './registry/jobs.ts';
import { isIconKey } from './registry/icons.ts';
import type { IconKey } from './registry/icons.ts';
import type { JobName } from './registry/jobs.ts';
import { abilityId, combatantId } from './combat/ability-types.ts';
import type { AbilityId, CombatantId } from './combat/ability-types.ts';
import { statusKey } from './combat/effect-ops.ts';
import type { SheetStatus, StatusDef, StatusKey } from './combat/effect-ops.ts';
import { parseSheetStatus, parseStatusDef } from './combat/fight-parse.ts';
import { FORCED_FACES, LOG_LINE_MAX, MAX_STATUSES, NAME_MAX, fightId } from './combat/fight-types.ts';
import type { Fight, FightId, ForcedFace } from './combat/fight-types.ts';
import { tick } from './combat/timeline.ts';
import { FOE_LIFE_STATES } from './combat/row-life.ts';
import type { Tick } from './combat/timeline.ts';
import { BANDS, DOC_AHEAD, DOC_DEFS_MAX, DOC_INTENT_LINES, DOC_LOG, DOC_MYTHICS, DOC_READY, DOC_ROWS, DOC_STATUSES, DOC_TILES_MAX, DOC_ZONE_RUNS, INTENT_LINE_MAX, TABLE_REFUSALS, UNSEEN, fightWire, keystoneStatusDef, unpackBits } from './combat/fight-doc.ts';
import type { Band, DocBurst, DocChannel, DocGrid, DocIntent, DocStanding, DocPlace, DocTaunt, DocRefusal, DocStatus, DocZone, FightDoc, FightDocRow } from './combat/fight-doc.ts';
import { TERRAIN, TERRAINS } from './combat/space.ts';
import { MYTHIC_STATES } from './combat/mythic.ts';
import { isMythicScriptId, mythicScriptOf, omensOf } from './registry/mythics.ts';
import { MAX_ZONES, ZONE_NAME_MAX, zoneId } from './combat/zones.ts';
import { deviceOf, hunterIdOf, parseDeviceId, parseEventId, parseRoomCode, parseSaveId, parseSheetKey } from './ids.ts';
import { COIN_TEXT_MAX, SIDES, faceOf, rollId } from './coin.ts';
import type { CoinNatural, LandingBody, RollId, CoinSide } from './coin.ts';
import type { DeviceId, EventId, ItemId, RoomCode, SheetKey } from './ids.ts';
import { OFFER_ID_MAX, endIdOf, isEndId, parseOfferId } from './ids.ts';
import type { OfferId } from './ids.ts';
import { GOODS_GOLD_MAX, OFFER_MAX, goodsSize, noGoods, parseBagPick, parseGoods } from './trade/goods.ts';
import type { BagPick, Goods } from './trade/goods.ts';
import type { Seat } from './role.ts';
import { ITEM_BOUNDS, RARITIES, parseItem } from './registry/items.ts';
import type { Item, Rarity } from './registry/items.ts';
import { parseStashAsk } from './sync/asked.ts';
import type { StashAsk } from './sync/asked.ts';
import { parseLevel } from './hunter/level.ts';
import type { ChapterBody } from './story/story.ts';
import { WEIGHT_MAX } from './table-weight.ts';
import type { HunterWeight } from './table-weight.ts';

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
/** A forced face of a d20: 1 or 20, anything else refused. */
const forcedFace = (v: unknown): ForcedFace => oneOf(v, FORCED_FACES, null) ?? refuse();

// ── shared shapes ──
/** A build change the GM sends: clear the path and perks, set a path, or pick the perk of the next open tier. */
export type BuildChange = 'respec' | { path: string } | { tier: number; pick: 0 | 1 };
/** A quest the GM issues to another phone. That phone gives it an id and the times it keeps. */
export type QuestOffer = Pick<Quest, 'kind' | 'title' | 'desc' | 'objectives' | 'dueAt' | 'penaltyText' | 'secret'> & { rewards: Rewards; onFail: Rewards };
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
    dueAt: opt(own(o, 'dueAt'), nullOr(time), null), penaltyText: opt(own(o, 'penaltyText'), text(300), ''), secret: opt(own(o, 'secret'), bool, false),
  };
}
/** A quest message's `to` and quest: a secret quest named to more than one hunter is refused (`questReaches`). */
function questTo(o: Rec): { to: SheetKey[]; quest: QuestOffer } {
  const to = toList(own(o, 'to')), quest = questOffer(own(o, 'quest'));
  return questReaches(quest, to.length) ? { to, quest } : refuse();
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
/**
 * Where a reward asked of the GM by a player's phone came from (`rewardAsk`): a won solo run, a quest, or a feat.
 */
export const ASK_FROM = ['solo', 'quest', 'feat'] as const;
export type AskFrom = (typeof ASK_FROM)[number];
/**
 * Where a waiting reward came from (hunter/pending.ts): a solo run, a counted quest, a feat, or a gate clear preset.
 */
export const REWARD_FROM = ['solo', 'quest', 'feat', 'clear'] as const;
export type RewardFrom = (typeof REWARD_FROM)[number];
/** The longest words of what earned a waiting reward: a quest's title, a feat's or a gate's name. */
export const EARNED_WHAT_MAX = 120;
/** What earned a reward the GM approved: where it came from and its words, for the player's window. */
export type EarnedBy = { from: RewardFrom; what: string };
/**
 * `earned`: the reward waited for the GM's approval (hunter/pending.ts) and was earned so; the player's window says what
 * earned it.
 */
export type AwardPayload = Base & { to: SheetKey[]; rewards: Rewards & { build?: BuildChange }; bundle?: GivenBundle; earned?: EarnedBy };
/**
 * Hunter `by` (`name`) earned `rewards` by itself (`from`, `what`): on a player's phone in a room the reward is not paid
 * but asked of the GM, whose phone keeps it waiting until the GM approves or refuses it (hunter/pending.ts). Sealed to
 * the GM and that hunter's phone.
 */
export type RewardAskPayload = Base & { by: SheetKey; name: string; from: AskFrom; what: string; rewards: Rewards };
/** A quest the GM issues to the hunters of `to`. Always sealed (`audience: 'named'`), and a secret quest names only one hunter. */
export type QuestPayload = Base & { to: SheetKey[]; quest: QuestOffer };
/** HP, mana and fatigue changes the GM taps on the board: negative is damage (or rest, for fatigue). */
export type HpPayload = Base & { to: SheetKey[]; hp: number; mana: number; fatigue: number; reason: string };
/**
 * The fight's write-back of a hunter on another phone (the `sendRemote` effect of src/core/combat/fight-types.ts): its
 * life (its HP with it), mana, fatigue and statuses as the fight's row holds them. The row is the one writer of that
 * life while the fight holds the hunter, so the player's sheet takes it as it is (grant.ts `totals`): a death and the
 * GM's Revive all reach the sheet here. Totals, so a repeat changes nothing. For one hunter. `fight`: the fight that
 * holds the row, which the player's phone keeps (fight-heard.ts `FightHeard`) until the room's fight doc answers it.
 */
export type VitalsPayload = Base & { to: [SheetKey]; fight: FightId; life: Life; mana: number; fatigue: number; statuses: SheetStatus[]; reason: string };
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
/**
 * The GM raises these dead hunters at 1 HP: the vitals `revive` event (src/core/hunter/vitals.ts) on the player's phone.
 * Only for a hunter no fight holds: a row of the GM's fight is revived by the fight's `life` command, and its phone hears
 * the new life in `vitals`.
 */
export type RevivePayload = Base & { to: SheetKey[] };
/**
 * A player's roll, shown in the GM's Table feed: the hunter who rolled it (`by`), its words and its numbers. An item or
 * skill used on another travels as `used`.
 */
export type RollPayload = Base & {
  by: SheetKey; name: string; label: string; expr: string; total: number; rolls: number[]; crit: boolean; fumble: boolean;
};
/** A player's progress on a quest the GM issued. Always sealed (`audience: 'named'`), and `secret` is copied from the quest for the GM's label. */
export type QuestUpdatePayload = Base & {
  by: SheetKey; name: string; questId: string; title: string; kind: QuestKind; status: QuestStatus; objectives: Objective[]; secret: boolean;
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
 * A player's report that the System raised their dead hunter `name` (grant.ts `systemRaise`, the owner, Nov 22: "System
 * raise", no GM button): the free raise or the one on debt (`raise`), and the gold that raise owes (`owes`, 0 when
 * free). Posted in the raise's own write; the GM's phone logs it. A report: it changes nothing on any phone.
 */
export type SystemRaisePayload = Base & { by: SheetKey; name: string; raise: Raise; owes: number };
/** The most gold a System raise reports owed: past any rank's ten Clears of the shipped table. */
export const RAISE_OWES_MAX = 1e9;
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
export type CastPayload = Base & { by: SheetKey; ability: AbilityId; aim: CombatantId | DocPlace; at: Tick };
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
 * The GM's phone has ruled the coin of `roll`: the roll, and nothing else. The side and the ruling stay on the GM's phone
 * (the owner, Nov 21: the GM says the outcome at the table), so no field may carry either. A phone acts on the first one of a roll only.
 */
export type CoinLandPayload = Base & LandingBody;
/**
 * A player's run of the room's solo gate `gate` (src/core/gates/solo.ts): the hunter of `by` (`name`) played it alone
 * on its phone and came out as `outcome` after `rounds`, `life` its life after. A report and a claim: the GM's phone acts
 * on it once by its id, clears a won gate if it still can and answers with `soloAnswer`; a lost or stalled run moves a
 * detected gate to raiding. Its cost is already on the player's sheet.
 */
export type SoloRunPayload = Base & { by: SheetKey; gate: GateId; name: string; outcome: RunOutcome; rounds: number; life: LifeState };
/** Why the GM's phone did not pay a won run: the gate was cleared first (another hunter's run or the GM), closed, is gone, or the party stash was full. */
export const SOLO_REFUSED = ['taken', 'closed', 'gone', 'stash-full'] as const;
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
 * The GM's phone's answer to the won run `run` of gate `gate` (`name`): cleared (the gate's Clear for that hunter, whose
 * reward waits for the GM's approval and comes as an `award`: ruling 20, SMX-gates-2.3), or refused with why. Landed once,
 * and only while that run waits on the player's phone (sync/asked.ts).
 */
export type SoloAnswerPayload = Base & { to: [SheetKey]; run: EventId; gate: GateId; name: string }
  & ({ verdict: 'cleared' } | { verdict: 'refused'; why: SoloRefused });
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
 * Hunter `by` (`name`) asks the GM's phone, which holds the party stash (trade/stash.ts), to keep the goods of a put (set
 * aside on its phone until the answer) or to give it a line or gold. Sealed to the GM and the asking hunter's phone.
 */
export type StashAskPayload = Base & { by: SheetKey; name: string; ask: StashAsk };
/** Why the GM's phone refused a stash ask: the line is gone, the stash holds fewer than asked, the stash is full, trading is off. */
export const STASH_REFUSALS = ['gone', 'short', 'full', 'off'] as const;
export type StashRefusal = (typeof STASH_REFUSALS)[number];
/**
 * The GM's phone's answer to stash ask `ask`: a put kept, a take given (the goods by value), or refused with why and how
 * many of the line or how much gold the stash held (`have`). Landed once, and only while that ask waits (sync/asked.ts).
 */
export type StashAnswerPayload = Base & { to: [SheetKey]; ask: EventId }
  & ({ verdict: 'kept' } | { verdict: 'given'; goods: Goods } | { verdict: 'refused'; why: StashRefusal; have: number });
/**
 * A chapter of a story the GM opened for the hunters of `to` (story/story.ts `chapterLanded`): its window's words, its
 * reward and its quest, its due time made when it opened. No story name, run or chapter number: a player sees what the
 * GM wrote for players. Landed once by its id. Its size is bounded where the chapter is made and at the open
 * (`CHAPTER_MAX`, 48 KiB, so the body with 24 sheet keys stays under the server's 64 KiB). Sealed.
 */
export type ChapterPayload = Base & { to: SheetKey[] } & ChapterBody;
/**
 * The GM's table weight on the player's hunter of `to` (src/core/table-weight.ts `weightOf`): its total in faces, the
 * hunters' plus its own, and its forced next d20 roll or none. A total, so a copy sets the same value; a newer one stands
 * for an older one of its hunter. Sealed to the GM and that hunter's phone.
 */
export type WeighPayload = Base & { to: [SheetKey] } & HunterWeight;
/** The longest word to the GM or answer: a few sentences typed on a phone, as long as a quest's description. */
export const WORD_MAX = 500;
/**
 * Hunter `by` (`name`) sends the GM a private word, `text` (sync/word.ts). Sealed: only the GM's phones and the sender's
 * phone get it (notes-5-trade.md 4.2).
 */
export type WordPayload = Base & { by: SheetKey; name: string; text: string };
/** The GM's answer `text` to word `re`, for the hunter of `to` only. Sealed; landed once, only while that word waits for one. */
export type WordBackPayload = Base & { to: [SheetKey]; re: EventId; text: string };
type Payloads = {
  offer: OfferPayload; offerEnd: OfferEndPayload; offerStop: OfferStopPayload; stashAsk: StashAskPayload; stashAnswer: StashAnswerPayload;
  system: SystemPayload; award: AwardPayload; quest: QuestPayload; hp: HpPayload; vitals: VitalsPayload; spent: SpentPayload; status: StatusPayload; revive: RevivePayload;
  roll: RollPayload; questUpdate: QuestUpdatePayload; used: UsedPayload; step: StepPayload; cast: CastPayload; pass: PassPayload; chain: ChainPayload;
  coinCall: CoinCallPayload; coinLand: CoinLandPayload; arm: ArmPayload; shadow: ShadowPayload; soloRun: SoloRunPayload; soloAnswer: SoloAnswerPayload; noted: NotedPayload;
  chapter: ChapterPayload; weigh: WeighPayload; word: WordPayload; wordBack: WordBackPayload;
  systemRaise: SystemRaisePayload; rewardAsk: RewardAskPayload;
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
const reason = (o: Rec): string => opt(own(o, 'reason'), text(120), '');
const hpDelta = (o: Rec, k: string): number => opt(own(o, k), int(-MAX_HP, MAX_HP), 0);
/** Where a waiting reward came from and its words. */
const earned = (o: Rec): EarnedBy => ({ from: choiceOf(REWARD_FROM)(own(o, 'from')), what: opt(own(o, 'what'), text(EARNED_WHAT_MAX), '') });
/** Where a player's rewardAsk came from and its words. */
const asked = (o: Rec): { from: AskFrom; what: string } => ({ from: choiceOf(ASK_FROM)(own(o, 'from')), what: opt(own(o, 'what'), text(EARNED_WHAT_MAX), '') });
/** Who receives a stored event. `'named'` reaches only the GM and the phones named by `by` or `to`. `'room'` reaches every viewer. */
export type Audience = 'named' | 'room';
/**
 * Required audience for payload `P`: `'named'` compiles only when `P` carries `by` or `to` (`toList` refuses an empty list and
 * `sheetKey` parses `by`, so a `'named'` event always names someone).
 */
export type EventAudience<P> =
  [P] extends [{ by: SheetKey } | { to: readonly SheetKey[] }]
    ? Audience | ((payload: P) => Audience)
    : 'to' extends keyof P
      ? [NonNullable<P['to']>] extends [readonly SheetKey[]]
        ? 'room' | ((payload: P) => Audience)
        : 'room'
      : 'room';
/**
 * One event type: who may send it, who receives it, and its payload's reader. `gmOnly`: only the room's GM key may send it.
 * `ownSheet`: it speaks for the hunter in its `by`, so the server takes it only from the phone that hunter belongs to.
 */
type EventDef<K extends EventType> = {
  readonly gmOnly: boolean; readonly ownSheet: boolean;
  /** Required audience (`'named'` or `'room'`, or a function of the payload). The server's poll reads it through `servedTo`. */
  readonly audience: EventAudience<Payloads[K]>;
  readonly read: (payload: Rec) => Payloads[K];
  /**
   * What a message of the type stands for, when a newer one takes an older one's place: a fight's totals for one hunter.
   * Absent, each message stands for itself. The GM's outbox keeps one waiting per key (combat.js), and a player's phone
   * lets a held one go once a newer one of its key has come (applied.ts `replaced`).
   */
  readonly standsFor?: (payload: Payloads[K]) => string;
};

/** Every event type. A type missing here does not compile. */
const DEFS: { readonly [K in EventType]: EventDef<K> } = {
  offer: { gmOnly: false, ownSheet: true, audience: 'named', read: o => {
    const eid = need(parseEventId(own(o, 'eid'))), by = sheetKey(own(o, 'by')), names = obj(own(o, 'names')), gives = need(parseGoods(own(o, 'gives')));
    if (parseOfferId(eid) === null || noGoods(gives)) return refuse();
    return withinOffer({
      eid, by, to: otherOf(o, by), names: { by: text(60)(own(names, 'by')), to: text(60)(own(names, 'to')) }, gives, asks: need(parseBagPick(own(o, 'asks'))),
    });
  } },
  offerEnd: { gmOnly: false, ownSheet: true, audience: 'named', read: o => {
    const b = endBase(o), by = sheetKey(own(o, 'by')), how = choiceOf(END_HOWS)(own(o, 'how')), gives = need(parseGoods(own(o, 'gives')));
    if (how !== 'accept' && !noGoods(gives)) return refuse();
    return withinOffer({ ...b, by, to: otherOf(o, by), how, gives });
  } },
  offerStop: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const b = endBase(o), raw = own(o, 'to'), to = Array.isArray(raw) && raw.length === 2 ? raw.map(sheetKey) : refuse();
    return to[0] === to[1] ? refuse() : { ...b, to: [to[0]!, to[1]!] };
  } },
  stashAsk: { gmOnly: false, ownSheet: true, audience: 'named', read: o => withinOffer({
    ...base(o), by: sheetKey(own(o, 'by')), name: opt(own(o, 'name'), text(NAME_MAX), ''), ask: need(parseStashAsk(own(o, 'ask'))),
  }) },
  stashAnswer: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const to = toList(own(o, 'to')), b = { ...base(o), to: to.length === 1 ? [to[0]!] as [SheetKey] : refuse(), ask: need(parseEventId(own(o, 'ask'))) };
    switch (choiceOf(['kept', 'given', 'refused'] as const)(own(o, 'verdict'))) {
      case 'kept': return { ...b, verdict: 'kept' as const };
      case 'given': { const goods = need(parseGoods(own(o, 'goods'))); return noGoods(goods) ? refuse() : withinOffer({ ...b, verdict: 'given' as const, goods }); }
      case 'refused': return { ...b, verdict: 'refused' as const, why: choiceOf(STASH_REFUSALS)(own(o, 'why')), have: opt(own(o, 'have'), int(0, GOODS_GOLD_MAX), 0) };
    }
  } },
  // SMX-sync-5.2: a System whisper (one with `to`) is sealed to the GM and the hunters it names (the owner, Nov 22: "Yes");
  // a broadcast to the room is not
  system: { gmOnly: true, ownSheet: false, audience: p => (p.to === undefined ? 'room' : 'named'), read: o => {
    const to = own(o, 'to');
    return { ...base(o), ...(to === undefined ? {} : { to: toList(to) }), tag: opt(own(o, 'tag'), text(40), '! Notification'),
      title: filled(120)(own(o, 'title')), body: opt(own(o, 'body'), text(1000), ''), kind: opt(own(o, 'kind'), choiceOf(SYSTEM_KINDS), 'info') };
  } },
  award: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const r = obj(own(o, 'rewards')), build = own(r, 'build'), given = own(o, 'bundle'), why = own(o, 'earned');
    return {
      ...base(o), to: toList(own(o, 'to')), rewards: { ...rewards(r), ...(build === undefined ? {} : { build: buildChange(build) }) }, ...(given === undefined ? {} : { bundle: givenBundle(given) }),
      ...(why === undefined ? {} : { earned: earned(obj(why)) }),
    };
  } },
  rewardAsk: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), name: opt(own(o, 'name'), text(NAME_MAX), ''), ...asked(o), rewards: rewards(own(o, 'rewards')),
  }) },
  quest: { gmOnly: true, ownSheet: false, audience: 'named', read: o => ({ ...base(o), ...questTo(o) }) },
  hp: { gmOnly: true, ownSheet: false, audience: 'named', read: o => ({ ...base(o), to: toList(own(o, 'to')), hp: hpDelta(o, 'hp'), mana: hpDelta(o, 'mana'), fatigue: hpDelta(o, 'fatigue'), reason: reason(o) }) },
  vitals: { gmOnly: true, ownSheet: false, audience: 'named', standsFor: p => `vitals ${p.to[0]}`, read: o => {
    const to = toList(own(o, 'to')), total = (k: string): number => int(0, MAX_TOTAL)(own(o, k));
    return {
      ...base(o), to: to.length === 1 ? [to[0]!] : refuse(), fight: fightId(id(own(o, 'fight'))), life: need(parseLife(own(o, 'life'), MAX_TOTAL)), mana: total('mana'), fatigue: total('fatigue'),
      statuses: listOf(own(o, 'statuses'), MAX_STATUSES, sheetStatus), reason: reason(o),
    };
  } },
  spent: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const to = toList(own(o, 'to'));
    return { ...base(o), to: to.length === 1 ? [to[0]!] : refuse(), item: need(parseSaveId<'i'>(own(o, 'item'))) };
  } },
  status: { gmOnly: true, ownSheet: false, audience: 'named', read: o => ({
    ...base(o), to: toList(own(o, 'to')), add: opt(own(o, 'add'), v => listOf(v, MAX_STATUS_CHANGES, sheetStatus), []),
    remove: opt(own(o, 'remove'), v => listOf(v, MAX_STATUS_CHANGES, changeableKey), []), reason: reason(o),
  }) },
  revive: { gmOnly: true, ownSheet: false, audience: 'named', read: o => ({ ...base(o), to: toList(own(o, 'to')) }) },
  roll: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), name: opt(own(o, 'name'), text(60), ''), label: opt(own(o, 'label'), text(60), ''),
    expr: opt(own(o, 'expr'), text(60), ''), total: int(-MAX_ROLL, MAX_ROLL)(own(o, 'total')),
    rolls: opt(own(o, 'rolls'), v => listOf(v, MAX_ROLLS, int(-MAX_ROLL, MAX_ROLL)), []), crit: opt(own(o, 'crit'), bool, false),
    fumble: opt(own(o, 'fumble'), bool, false),
  }) },
  questUpdate: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), name: opt(own(o, 'name'), text(60), ''), questId: id(own(o, 'questId')), title: opt(own(o, 'title'), text(120), ''),
    kind: choiceOf(QUEST_KINDS)(own(o, 'kind')), status: choiceOf(QUEST_STATUSES)(own(o, 'status')),
    objectives: opt(own(o, 'objectives'), v => listOf(v, MAX_OBJECTIVES, objective), []), secret: opt(own(o, 'secret'), bool, false),
  }) },
  chain: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const job = own(o, 'job');
    return { ...base(o), to: toList(own(o, 'to')), job: isJobName(job) ? job : refuse(), kind: choiceOf(CHAIN_KINDS)(own(o, 'kind')) };
  } },
  used: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), who: opt(own(o, 'who'), text(60), ''), what: choiceOf(USED_WHAT)(own(o, 'what')), name: filled(60)(own(o, 'name')),
    text: opt(own(o, 'text'), text(200), ''), target: opt(own(o, 'target'), choiceOf(USED_TARGETS), 'self'), tell: opt(own(o, 'tell'), bool, false),
  }) },
  systemRaise: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), name: filled(60)(own(o, 'name')), raise: choiceOf(RAISES)(own(o, 'raise')), owes: int(0, RAISE_OWES_MAX)(own(o, 'owes')),
  }) },
  step: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({ ...base(o), by: sheetKey(own(o, 'by')), place: tile(own(o, 'place')), at: time0(own(o, 'at')), dash: opt(own(o, 'dash'), bool, false) }) },
  cast: { gmOnly: false, ownSheet: true, audience: 'named', read: o => {
    const ability = own(o, 'ability');
    return {
      ...base(o), by: sheetKey(own(o, 'by')),
      ability: typeof ability === 'string' && ability.length > 0 && ability.length <= ABILITY_ID_MAX ? abilityId(ability) : refuse(),
      aim: aim(own(o, 'aim')), at: time0(own(o, 'at')),
    };
  } },
  pass: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({ ...base(o), by: sheetKey(own(o, 'by')), at: time0(own(o, 'at')) }) },
  arm: { gmOnly: false, ownSheet: true, audience: 'named', read: o => {
    const ability = own(o, 'ability'), on = own(o, 'on');
    const id = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max ? v : refuse();
    return {
      ...base(o), by: sheetKey(own(o, 'by')), ability: ability === null || ability === undefined ? null : abilityId(id(ability, ABILITY_ID_MAX)),
      on: on === null || on === undefined ? null : rowId(on),
    };
  } },
  coinCall: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), roll: roll(own(o, 'roll')), who: opt(own(o, 'who'), text(COIN_TEXT_MAX), ''),
    what: opt(own(o, 'what'), text(COIN_TEXT_MAX), ''), face: need(faceOf(own(o, 'face'))), call: side(own(o, 'call')),
  }) },
  coinLand: { gmOnly: true, ownSheet: false, audience: 'room', read: o => ({ ...base(o), roll: roll(own(o, 'roll')) }) },
  shadow: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const to = toList(own(o, 'to'));
    return { ...base(o), to: to.length === 1 ? [to[0]!] : refuse(), shadow: shadowOrigin(own(o, 'shadow')) };
  } },
  soloRun: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), gate: need(parseGateId(own(o, 'gate'))), name: opt(own(o, 'name'), text(NAME_MAX), ''),
    outcome: choiceOf(RUN_OUTCOMES)(own(o, 'outcome')), rounds: num(0, CAP_ROUNDS + 1)(own(o, 'rounds')), life: choiceOf(LIFE_STATES)(own(o, 'life')),
  }) },
  noted: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const to = toList(own(o, 'to')), raw = own(o, 'facts');
    if (to.length !== 1 || !Array.isArray(raw) || raw.length > NOTED_MAX) return refuse();
    return { ...base(o), to: [to[0]!] as [SheetKey], facts: raw.flatMap(f => parseFact(f) ?? []) };
  } },
  soloAnswer: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const to = toList(own(o, 'to'));
    const b = { ...base(o), to: to.length === 1 ? [to[0]!] as [SheetKey] : refuse(), run: need(parseEventId(own(o, 'run'))), gate: need(parseGateId(own(o, 'gate'))), name: opt(own(o, 'name'), text(WORLD_NAME_MAX), '') };
    return choiceOf(['cleared', 'refused'] as const)(own(o, 'verdict')) === 'cleared'
      ? { ...b, verdict: 'cleared' as const }
      : { ...b, verdict: 'refused' as const, why: choiceOf(SOLO_REFUSED)(own(o, 'why')) };
  } },
  chapter: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const q = own(o, 'quest'), to = toList(own(o, 'to')), quest = q === null || q === undefined ? null : questOffer(q);
    return quest && !questReaches(quest, to.length) ? refuse() : { ...base(o), to, words: need(parseWords(own(o, 'words'))), rewards: rewards(own(o, 'rewards')), quest };
  } },
  word: { gmOnly: false, ownSheet: true, audience: 'named', read: o => ({
    ...base(o), by: sheetKey(own(o, 'by')), name: opt(own(o, 'name'), text(NAME_MAX), ''), text: filled(WORD_MAX)(own(o, 'text')),
  }) },
  wordBack: { gmOnly: true, ownSheet: false, audience: 'named', read: o => {
    const to = toList(own(o, 'to'));
    return { ...base(o), to: to.length === 1 ? [to[0]!] : refuse(), re: plainEid(own(o, 're')), text: filled(WORD_MAX)(own(o, 'text')) };
  } },
  weigh: { gmOnly: true, ownSheet: false, audience: 'named', standsFor: p => `weigh ${p.to[0]}`, read: o => {
    const to = toList(own(o, 'to'));
    return { ...base(o), to: to.length === 1 ? [to[0]!] : refuse(), total: int(-WEIGHT_MAX, WEIGHT_MAX)(own(o, 'total')), force: nullOr(forcedFace)(own(o, 'force')) };
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
  offer: entry('offer'), offerEnd: entry('offerEnd'), offerStop: entry('offerStop'), stashAsk: entry('stashAsk'), stashAnswer: entry('stashAnswer'),
  system: entry('system'), award: entry('award'), quest: entry('quest'), hp: entry('hp'), vitals: entry('vitals'), spent: entry('spent'), status: entry('status'),
  revive: entry('revive'), roll: entry('roll'), questUpdate: entry('questUpdate'), used: entry('used'), step: entry('step'), cast: entry('cast'), pass: entry('pass'),
  chain: entry('chain'), coinCall: entry('coinCall'), coinLand: entry('coinLand'), arm: entry('arm'), shadow: entry('shadow'),
  soloRun: entry('soloRun'), soloAnswer: entry('soloAnswer'), noted: entry('noted'),
  chapter: entry('chapter'), weigh: entry('weigh'), word: entry('word'), wordBack: entry('wordBack'),
  systemRaise: entry('systemRaise'), rewardAsk: entry('rewardAsk'),
};
function entry<K extends EventType>(type: K): EventEntry<K> {
  const def: EventDef<K> = DEFS[type];
  const a = def.audience;
  const sealed: (p: Payloads[K]) => boolean = typeof a === 'function' ? p => a(p) === 'named' : () => a === 'named';
  return { gmOnly: def.gmOnly, ownSheet: def.ownSheet, parse: payload => attempt(() => def.read(obj(payload))), sealed, standsFor: def.standsFor ?? null };
}
/** What a message stands for, when a newer one of the same takes its place (`EventDef.standsFor`); null when it stands for itself. */
export function standsFor(ev: RoomEvent): string | null {
  // EVENTS pairs each type with the key of its own payload.
  const key = EVENTS[ev.type].standsFor as ((p: RoomEvent['payload']) => string) | null;
  return key ? key(ev.payload) : null;
}
/** The hunter an event speaks for, when its type is `ownSheet`: the server takes it only from that hunter's phone. Else null. */
export const speaksFor = (ev: RoomEvent): SheetKey | null => (EVENTS[ev.type].ownSheet && 'by' in ev.payload ? ev.payload.by : null);
/** Whether a stored event is sealed (`EventDef.audience` is `'named'`): it reaches only the GM and the phones of the hunters it names. */
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
/** What makes an event id unique: the sending phone, the time in ms, a random number from 0 to 1, and an optional index when one tap makes several ids. */
export type EventStamp = { device: string; now: number; rand: number; seq?: number };
/**
 * The one maker of a new event id from `stamp`: the phone, the time, an optional index, and four random base-36
 * characters, within `OFFER_ID_MAX` so it is never an offer's end id. Used by `newEvent` and by GM-local pending records (`clear`).
 */
export function newEventId(stamp: EventStamp): EventId | null {
  if (!/^[\w-]+$/.test(stamp.device)) return null;
  const rand = Math.floor(Math.max(0, Math.min(0.999999, stamp.rand)) * 36 ** 4).toString(36).padStart(4, '0');
  const seq = stamp.seq === undefined ? '' : `-${Math.max(0, Math.trunc(stamp.seq)).toString(36)}-`;
  const tail = `-${Math.trunc(stamp.now).toString(36)}${seq}${rand}`;
  return parseEventId(stamp.device.slice(0, Math.max(0, OFFER_ID_MAX - tail.length)) + tail);
}
/**
 * The one constructor of a room event: `body` with a new event id, read by the parser the server uses. Null when the
 * server would refuse it. The id is the phone, the time and a random part, so it does not repeat across phones or rooms;
 * at most `OFFER_ID_MAX` characters, so an offer's end id fits, and ending in four random characters, never an end id.
 * An offer's end is made by `endEvent`.
 */
export function newEvent<K extends EventType>(type: K, body: EventBody<K>, stamp: EventStamp): RoomEvent | null {
  const eid = newEventId(stamp);
  return eid && parseEvent(type, { ...body, eid });
}
/**
 * The time of a page's next event id: its clock's now, or one millisecond after the page's last when the clock has not
 * passed it. So every id one page makes differs by its time alone, however close together the posts and whatever
 * `Math.random` answers (a test fixes it for its dice; one tap may post two events in one millisecond).
 */
export const stampTime = (last: number, now: number): number => Math.max(Math.trunc(now), last + 1);
/** `v` as JSON with each object's keys sorted, so two readings of one message compare equal whatever order a store keeps. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) =>
  (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
/**
 * Whether `ev`, posted under an id the room or a phone's outbox already holds for `held`, is that message again: the
 * same type and payload (a send whose answer was lost), or any end of an offer, whose first end is its one end
 * (trade/offer.ts). Anything else under a held id is a different message: the outbox and the room refuse it, never
 * answer it as taken.
 */
export const sentAgain = (held: RoomEvent, ev: RoomEvent): boolean =>
  isEndId(ev.payload.eid) || (held.type === ev.type && canonical(held.payload) === canonical(ev.payload));
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
 * armed (implicit audit 3, T1). A row's life went on the wire in place of its down flag (`d`, the state's index, absent
 * while up): a row that is not up is 3 characters shorter (`"d":1` for `"d":true`), one that is up the same, so the worst
 * case, every monster up, is unchanged at 45,818 and 53,627 (measured by the test). The room's cap is eight ninths of
 * `DOC_MAX` (55,111), so 53,627 left 1,484 to spare, not the 1,821 once written: that was 53,627 x 9 / 8 = 60,330, not
 * 60,179, with the eighth. An icon on every row (`ic`, 18 characters with the longest key the registry holds, 540
 * for `DOC_ROWS`) makes it 46,358 and 54,167 (measured by the test), 944 to spare. Ruling 5 (icons design) asked, under
 * 2,000 to spare, for only a GM's pick on the wire and the default worked out on a player's phone from the enemy's type;
 * but the row holds no type, and the type itself (up to `TYPE_MAX`, 40) would cost more than its picture. So the GM's
 * phone sends each row's picture as it answers it (row-icon.ts `rowIcon`, a hunter's emblem too), which costs no more
 * than a pick on every row did: the worst case is the same 54,167 with 944 to spare. The longest key a registry may hold
 * is `ICON_KEY_MAX` (20), which would be 840 for the rows and 644 to spare. A mythic's standing in an omen (`my`, fight-doc.ts
 * `standingWire`: the longest script id and omen key, an aim at a tile, a beat and a time of seven digits) is 105 characters:
 * the doc carries at most `DOC_MYTHICS` (4) of them, 420 more, so the worst case is 54,611 (measured by the test), 500 to
 * spare under the eight ninths. One standing a row for all 18 monsters would be 1,890: over.
 * Keystones (unit K7): the 71 shipped keystone status defs (41 base worn, 7 awakened worn, and 23 child statuses) are
 * omitted from `wire.defs` when they match `RULES` and reconstructed on read (`keystoneStatusDef`), costing 0 bytes in
 * `defs` and only their status refs on rows (119 characters for 4 longest-key enemy NPC keystones, 166 for 5 awakened
 * hunter keystones). With 4 awakened hunters holding 5 keystones each, 4 hunter-like enemy rows holding 4 keystones
 * each, and 22 monsters (4 mythics), the worst case is 47,103 (built-in defs) and 53,976 (full defs table), leaving
 * 1,135 to spare under 55,111. Even 30 keystone-holding enemy rows fit under `DOC_MAX` at 51,308 (built-in) and 58,181
 * (full defs table).
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
  /** The monster's icon as the GM's phone resolved it (icon-defaults.ts `monsterIcon`), so a player's bestiary draws what the GM's does; absent, none was sent. */
  icon?: IconKey;
};
export type CodexDoc = { at: string; entries: CodexDocEntry[] };
/** How many entries the codex doc holds at most; the GM's phone builds it within this and `DOC_MAX` (bestiary.ts `codexDoc`). */
export const CODEX_DOC_ENTRIES = 200;
/**
 * The GM's rules a player's phone plays by in the room (src/core/hunter/build.ts `withRoomRules`): the build switches,
 * the personal gates' switch, hours and share of the loot (`RULES.solo`), and the economy (each rule's reason in
 * economy design 7.1), so a GM's edit prices an item the same on every phone. Laid over the player's own rules, never
 * written to its save. `feats.on`: the GM's switch for the feats the System notices (hunter/feats.ts); a doc without it
 * reads as on, and so does one without `trade.on`, the GM's trading switch; one without `mythic.scripts` reads as off. Every other field is required: each number is read in its rule's domain (`ruleNumber`).
 */
export type RoomRules = {
  build: { enabled: boolean; playerPick: boolean };
  solo: { personal: boolean; hours: number; lootShare: number };
  feats: { on: boolean };
  /** The GM's trading switch (`RULES.trade`): a doc without it reads as on. */
  trade: { on: boolean };
  /** The GM's mythic switch (`RULES.fight.mythic.scripts`): a doc without it reads as off, so a room from before scripts plays none. */
  mythic: { scripts: boolean };
  /** The GM's keystone switch and thresholds (`RULES.fight.keystone`): a doc without it reads as off with shipped shares and ranks. */
  keystone: { on: boolean; markShare: number; pairShare: number; apexShare: number; markRank: Rank; pairRank: Rank; apexRank: Rank };
  /** The rank whose base price prices each rarity an item can carry (`RARITIES`); its color stays the phone's own. */
  rarities: RoomRarities;
  priceBase: Rules['priceBase'];
  gradeStep: number;
  saleShare: number;
  usedUpShare: number;
  elixirPrices: number;
  revivePrices: number;
  reviveDebtPrices: Rules['reviveDebtPrices'];
  reviveDebtShare: number;
  reviveDebtBurn: number;
  reviveDebtXpRate: number;
  borrowCapPrices: number;
  reviveLevelShare: number;
  gateParty: number;
  crystal: Rules['crystal'];
  loot: Rules['loot'];
};
/** Each rarity an item can carry, with the rank whose Clear prices it. */
export type RoomRarities = { readonly [R in Rarity]: { readonly rank: Rank } };
/** One `T` for each rarity an item can carry, made by `f`: how the room's rarities are written, read and laid over. */
export const eachRarity = <T>(f: (r: Rarity) => T): Record<Rarity, T> =>
  Object.fromEntries(RARITIES.map(r => [r, f(r)])) as Record<Rarity, T>; // the compiler cannot follow a map over a list to its keys
/** A gate as the room's world doc carries it: a cleared one with the day it was cleared (gate.ts `countdown` reads both); `solo` when the solo doc holds it. */
export type WorldGate = ShownGate & { solo?: true };
/** One roster line of a solo gate in the solo doc: `n` of the doc's monster `m` (its key in `monsters`), with optional difficulty `hp`/`dealt` scales. */
export type SoloDocLine = { m: string; n: number; hp?: number; dealt?: number };
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
 * monsters, are 31,664 characters: 9,466 of gates (about 237 a gate) and 21,877 of monsters (about 994 a monster, the
 * largest 2,059), about half of `DOC_MAX` (the test holds them to 55%; a built-in status's `stat` op holds six formulas
 * since item-stats.md 6.2, `{"kind":"number","value":-8}` where a number was). A GM's monster at its bounds is far larger (11 abilities with their ops and
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
/**
 * The item lines the party stash holds at most (trade/stash.ts): a put past them is refused `full`. What bounds the doc
 * is its size: a put that would make the doc's JSON longer than `DOC_MAX` is refused `full` too, so the doc is never
 * longer by construction. Measured (tests/protocol.test.ts, "the worst-case stash doc on the wire"): forty lines of the
 * largest item the game ships (the Spellblade, 1,027 characters) are 41,749 characters, 67% of `DOC_MAX`; forty lines
 * of a large item the readers take (6,156 characters; an item is at most `THING_MAX.item`, 7,168 bytes) are 246,909,
 * four times `DOC_MAX`, and ten of those fill the doc. So the count bounds a stash of the game's items, and the size
 * check what a GM's own large items can fill.
 */
export const STASH_LINES = 40;
/** The party stash as the GM's phone publishes it (trade/stash.ts `stashDoc`): its gold and its lines, each item whole with its id. */
export type StashDoc = { gold: number; items: Item[] };
type Docs = { fight: FightDoc; kicked: KickedDoc; codex: CodexDoc; rules: RoomRules; world: WorldDoc; solo: SoloDoc; feats: FeatsDoc; stash: StashDoc };
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
 * A status on the wire: k key, b label (only when its def is neither in the doc's `defs` table nor a shipped keystone
 * def matching `RULES`), l rounds left, n stacks, t its source's tier.
 */
function docStatus(v: unknown, defs: Record<string, StatusDef>): DocStatus {
  const o = obj(v), key = keyOf(own(o, 'k')), named = own(o, 'b'), stacks = own(o, 'n');
  const def = named === undefined ? (Object.hasOwn(defs, key) ? defs[key]! : keystoneStatusDef(key) ?? refuse()) : undefined;
  const out = {
    key, label: def ? def.label : filled(NAME_MAX)(named), left: opt(own(o, 'l'), num(0, MAX_TOTAL), null),
    tier: opt(own(o, 't'), int(0, RANKS.length - 1), 0), ...(def ? { def } : {}),
  };
  return stacks === undefined ? out : { ...out, stacks: int(1, RULES.fight.kit.stackCap)(stacks) };
}
/** A band on the wire, its index in `BANDS`. */
const bandAt = (v: unknown): Band => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < BANDS.length ? BANDS[v]! : refuse());
/**
 * A row's life on the wire (`d`): its state's index in `LIFE_STATES`, absent while up, one of `states`, the row's kind's
 * table (up or dead for every kind). Anything else is refused.
 */
function wireLife<S extends LifeState>(v: unknown, states: readonly S[]): { readonly at: S } {
  if (v === undefined) return { at: oneOf('up', states, null) ?? refuse() };
  const at = typeof v === 'number' && Number.isInteger(v) && v > 0 ? oneOf(LIFE_STATES[v], states, null) : null;
  return at === null ? refuse() : { at };
}
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
 * A mythic's standing on the wire (fight-doc.ts `standingWire`), or null when this build cannot read it: a script, a phase
 * or an omen it lacks, or an omen that cannot be weakened standing as faltering. A row with none shows as a plain monster
 * (as an icon key this build lacks shows its default), never refuses the doc.
 */
function docStanding(v: unknown): DocStanding | null {
  return attempt(() => {
    const o = obj(v), script = own(o, 's');
    if (!isMythicScriptId(script)) return refuse();
    const sc = mythicScriptOf(script), phase = int(0, sc.phases.length - 1)(own(o, 'p')), beat = int(0, MAX_TOTAL)(own(o, 'b')), since = time0(own(o, 't'));
    const z = own(o, 'z');
    if (z === undefined) return { state: 'calm', script, phase, beat, since };
    const at = typeof z === 'number' && Number.isInteger(z) ? MYTHIC_STATES[z] : undefined;
    const key = omensOf(sc).find(([k]) => k === own(o, 'o')), a = own(o, 'a');
    if (!at || at === 'calm' || !key || (at === 'faltering' && key[1].weak === null)) return refuse();
    return { state: at, script, phase, beat, since, omen: key[0], aim: a === undefined ? null : typeof a === 'string' ? rowId(a) : wirePlace(a), band: bandAt(own(o, 'h')) };
  });
}
/** A key of the icon registry, or null: a key this build lacks is no error, the row's default shows (icons design 3). */
const iconOrNull = (v: unknown): IconKey | null => (isIconKey(v) ? v : null);
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
    taunt: opt(own(o, 't'), docTaunt, null), icon: opt(own(o, 'ic'), iconOrNull, null),
  };
  const kind = choiceOf(['monster', 'hunter', 'shadow', 'summon'] as const)(own(o, 'q'));
  if (kind === 'monster') {
    const life = wireLife(own(o, 'd'), FOE_LIFE_STATES);
    const st = own(o, 'g'), stagger = st === undefined ? null : {
      fill: int(0, MAX_TOTAL)(own(obj(st), 'f')), max: int(0, MAX_TOTAL)(own(obj(st), 'm')), staggered: opt(own(obj(st), 's'), num(0, MAX_TOTAL), null),
    };
    const standing = opt(own(o, 'my'), docStanding, null);
    return { ...row, kind, life, intent: opt(own(o, 'in'), docIntent, null), stagger, suggest: opt(own(o, 'u'), rowId, null), ...(standing ? { standing } : {}) };
  }
  const hpMax = int(1, MAX_TOTAL)(own(o, 'hm'));
  const body = { hp: int(0, hpMax)(own(o, 'h')), hpMax, stride: int(0, MAX_TILE + 1)(own(o, 'r')), move: int(0, MAX_TILE + 1)(own(o, 'm')) };
  if (kind === 'hunter') return { ...row, kind, ...body, life: wireLife(own(o, 'd'), LIFE_STATES) };
  const life = wireLife(own(o, 'd'), FOE_LIFE_STATES);
  return kind === 'summon' ? { ...row, kind, ...body, life, owner: rowId(own(o, 'o')), left: opt(own(o, 'l'), num(0, MAX_TOTAL), null) } : { ...row, kind, ...body, life };
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
/** The rows with the standings past `DOC_MYTHICS` taken off, as the doc's builder leaves them out. */
function withinMythics(rows: FightDocRow[]): FightDocRow[] {
  let n = 0;
  return rows.map(r => {
    if (r.kind !== 'monster' || !r.standing || ++n <= DOC_MYTHICS) return r;
    const { standing: _out, ...plain } = r;
    return plain;
  });
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
    rows: withinMythics(listOf(own(o, 'rows'), DOC_ROWS, v => fightRow(v, defs))), log: listOf(own(o, 'log'), DOC_LOG, text(LOG_LINE_MAX)),
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
  const o = obj(v), stat = (k: string): number => opt(own(o, k), int(0, MAX_TOTAL), 0), icon = iconOrNull(own(o, 'icon'));
  return {
    key: filled(100)(own(o, 'key')), name: text(60)(own(o, 'name')), rank: opt(own(o, 'rank'), choiceOf(RANKS), 'E'), hpMax: stat('hpMax'),
    armor: stat('armor'), resist: stat('resist'), speed: stat('speed'), abilities: opt(own(o, 'abilities'), v => listOf(v, 4, text(70)), []),
    kills: opt(own(o, 'kills'), int(1, 1e9), 1),
    firstAt: opt(own(o, 'firstAt'), text(40), ''),
    ...(icon ? { icon } : {}),
  };
}
/** A line of the stash doc: an item as `parseItem` reads it, with its id in the stash. */
function stashLine(v: unknown): Item {
  const o = obj(v), id = need(parseSaveId<'i'>(own(o, 'id')));
  return { ...need(parseItem(o)), id };
}
function worldGate(v: unknown): WorldGate {
  const o = obj(v);
  const base = { id: id(own(o, 'id')) as GateId, name: text(WORLD_NAME_MAX)(own(o, 'name')), rank: choiceOf(RANKS)(own(o, 'rank')), type: choiceOf(GATE_TYPES)(own(o, 'type')), breakDay: int(0, 1e6)(own(o, 'breakDay')) };
  const status = choiceOf(GATE_STATUSES)(own(o, 'status'));
  const g = shownGate(base, status, status === 'cleared' ? int(0, 1e6)(own(o, 'clearedDay')) : null);
  return opt(own(o, 'solo'), bool, false) ? { ...g, solo: true } : g;
}
const optScale = (v: unknown): number | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100) return refuse();
  return v;
};
/** A solo gate of the solo doc: its id, name, rank, whether its last line is the boss, its lines. */
function soloGate(v: unknown): SoloDocGate {
  const o = obj(v);
  return {
    id: need(parseGateId(own(o, 'id'))), name: text(WORLD_NAME_MAX)(own(o, 'name')), rank: choiceOf(RANKS)(own(o, 'rank')), boss: bool(own(o, 'boss')),
    lines: listOf(own(o, 'lines'), SOLO_DOC.lines, l => {
      const x = obj(l);
      const hp = optScale(own(x, 'hp')), dealt = optScale(own(x, 'dealt'));
      return { m: id(own(x, 'm')), n: int(1, MONSTER_BOUNDS.copies)(own(x, 'n')), ...(hp !== undefined ? { hp } : {}), ...(dealt !== undefined ? { dealt } : {}) };
    }),
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

/**
 * A number of the rule at dotted `path` (`saleShare`, `loot.C.gold`), read in that rule's domain (rules.ts `domainOf`), so
 * the room takes what the Rules editor takes: clamped to it as every number here is, whole when the rule is.
 */
const ruleNumber = (path: string) => (v: unknown): number => {
  const d = domainOf(path);
  if (!d) throw new Error(`protocol.ts reads ${path}, a rule with no domain`);
  return (d.whole ? int : num)(d.least, d.most)(v);
};
/** A rank's loot gold: two numbers of its rule, low to high as overrides.ts keeps a GM's; any other is refused. */
function goldRange(v: unknown, path: string): number[] {
  if (!Array.isArray(v) || v.length !== 2) return refuse();
  const lo = ruleNumber(path)(v[0]), hi = ruleNumber(path)(v[1]);
  return lo <= hi ? [lo, hi] : refuse();
}
/** A rank's loot table: its gold and each weight the shipped table has (overrides.ts refuses a GM's other keys). */
function lootRank<K extends Rank>(v: unknown, rank: K): Rules['loot'][K] {
  const o = obj(v), w = obj(own(o, 'weights')), shipped = RULES.loot[rank].weights;
  const weights = Object.fromEntries(Object.keys(shipped).map(k => [k, ruleNumber(`loot.${rank}.weights.${k}`)(own(w, k))]));
  return { gold: goldRange(own(o, 'gold'), `loot.${rank}.gold`), weights } as Rules['loot'][K]; // the shipped table's keys, each read
}
/** One `T` for each rank, made by `f`: how per-rank tables (`priceBase`, `reviveDebtPrices`) are read from the room's rules doc. */
const eachRank = <T>(f: (r: Rank) => T): Record<Rank, T> =>
  Object.fromEntries(RANKS.map(r => [r, f(r)])) as Record<Rank, T>;
/** The room's keystone switch and earning rules: absent reads as off with shipped shares and ranks. */
function roomKeystone(v: unknown): RoomRules['keystone'] {
  const ks = obj(opt(v, x => x, {})), d = RULES.fight.keystone;
  return {
    on: own(ks, 'on') === true,
    markShare: opt(own(ks, 'markShare'), ruleNumber('fight.keystone.markShare'), d.markShare),
    pairShare: opt(own(ks, 'pairShare'), ruleNumber('fight.keystone.pairShare'), d.pairShare),
    apexShare: opt(own(ks, 'apexShare'), ruleNumber('fight.keystone.apexShare'), d.apexShare),
    markRank: opt(own(ks, 'markRank'), choiceOf(RANKS), d.markRank),
    pairRank: opt(own(ks, 'pairRank'), choiceOf(RANKS), d.pairRank),
    apexRank: opt(own(ks, 'apexRank'), choiceOf(RANKS), d.apexRank),
  };
}
/** The room's mana crystal economy rules: absent reads as the shipped defaults. */
function roomCrystal(v: unknown): Rules['crystal'] {
  const c = obj(opt(v, x => x, {})), d = RULES.crystal;
  const r = obj(opt(own(c, 'rates'), x => x, {}));
  return {
    poolBase: opt(own(c, 'poolBase'), ruleNumber('crystal.poolBase'), d.poolBase),
    specialMult: opt(own(c, 'specialMult'), ruleNumber('crystal.specialMult'), d.specialMult),
    unsignedShare: opt(own(c, 'unsignedShare'), ruleNumber('crystal.unsignedShare'), d.unsignedShare),
    personalShare: opt(own(c, 'personalShare'), ruleNumber('crystal.personalShare'), d.personalShare),
    rates: {
      helix: opt(own(r, 'helix'), ruleNumber('crystal.rates.helix'), d.rates.helix),
      bureau: opt(own(r, 'bureau'), ruleNumber('crystal.rates.bureau'), d.rates.bureau),
      stair: opt(own(r, 'stair'), ruleNumber('crystal.rates.stair'), d.rates.stair),
    },
  };
}
/** The room's rules doc: every field required but the feats and trading switches (on when absent), the mythic and keystone switches (off when absent), and crystal (shipped defaults when absent). */
function roomRulesDoc(o: Rec): RoomRules {
  const b = obj(own(o, 'build')), so = obj(own(o, 'solo')), ra = obj(own(o, 'rarities')), pb = obj(own(o, 'priceBase')), rdp = obj(own(o, 'reviveDebtPrices')), lo = obj(own(o, 'loot'));
  const rule = (k: 'gradeStep' | 'saleShare' | 'usedUpShare' | 'elixirPrices' | 'revivePrices' | 'reviveDebtShare' | 'reviveDebtBurn' | 'reviveDebtXpRate' | 'borrowCapPrices' | 'reviveLevelShare' | 'gateParty'): number => ruleNumber(k)(own(o, k));
  const reviveDebtShare = rule('reviveDebtShare'), reviveDebtBurn = rule('reviveDebtBurn');
  if (reviveDebtShare + reviveDebtBurn > 1 + 1e-9) return refuse();
  return {
    build: { enabled: bool(own(b, 'enabled')), playerPick: bool(own(b, 'playerPick')) },
    solo: { personal: bool(own(so, 'personal')), hours: int(1, SOLO_BOUNDS.hours)(own(so, 'hours')), lootShare: ruleNumber('solo.lootShare')(own(so, 'lootShare')) },
    feats: { on: own(obj(opt(own(o, 'feats'), v => v, {})), 'on') !== false },
    trade: { on: own(obj(opt(own(o, 'trade'), v => v, {})), 'on') !== false },
    mythic: { scripts: own(obj(opt(own(o, 'mythic'), v => v, {})), 'scripts') === true },
    keystone: roomKeystone(own(o, 'keystone')),
    rarities: eachRarity(r => ({ rank: choiceOf(RANKS)(own(obj(own(ra, r)), 'rank')) })),
    priceBase: eachRank(r => ruleNumber(`priceBase.${r}`)(own(pb, r))),
    gradeStep: rule('gradeStep'),
    saleShare: rule('saleShare'),
    usedUpShare: rule('usedUpShare'),
    elixirPrices: rule('elixirPrices'),
    revivePrices: rule('revivePrices'),
    reviveDebtPrices: eachRank(r => ruleNumber(`reviveDebtPrices.${r}`)(own(rdp, r))),
    reviveDebtShare,
    reviveDebtBurn,
    reviveDebtXpRate: rule('reviveDebtXpRate'),
    borrowCapPrices: rule('borrowCapPrices'),
    reviveLevelShare: rule('reviveLevelShare'),
    gateParty: rule('gateParty'),
    crystal: roomCrystal(own(o, 'crystal')),
    loot: { E: lootRank(own(lo, 'E'), 'E'), D: lootRank(own(lo, 'D'), 'D'), C: lootRank(own(lo, 'C'), 'C'), B: lootRank(own(lo, 'B'), 'B'), A: lootRank(own(lo, 'A'), 'A'), S: lootRank(own(lo, 'S'), 'S') },
  };
}

/** Every room document by name, with its parser (unknown in, the doc or null out). A name missing here does not compile. */
export const DOCS: { readonly [K in DocName]: (data: unknown) => Docs[K] | null } = {
  fight: data => attempt(() => fightDocOf(obj(data))),
  kicked: data => attempt(() => { const o = obj(data); return { keys: bySheetKey(own(o, 'keys'), time), names: opt(own(o, 'names'), v => bySheetKey(v, text(60)), {}) }; }),
  codex: data => attempt(() => { const o = obj(data); return { at: text(40)(own(o, 'at')), entries: listOf(own(o, 'entries'), CODEX_DOC_ENTRIES, codexEntry) }; }),
  rules: data => attempt(() => roomRulesDoc(obj(data))),
  world: data => attempt(() => { const o = obj(data); return { day: int(1, 1e6)(own(o, 'day')), session: opt(own(o, 'session'), int(0, 1e6), 0), gates: listOf(own(o, 'gates'), WORLD_GATES, worldGate) }; }),
  solo: data => attempt(() => soloDocOf(data)),
  feats: data => attempt(() => ({ feats: parseFeats(own(obj(data), 'feats'), FEATS_DOC_MAX) })),
  stash: data => attempt(() => {
    if (JSON.stringify(data).length > DOC_MAX) return refuse();
    const o = obj(data);
    return { gold: int(0, GOODS_GOLD_MAX)(own(o, 'gold')), items: listOf(own(o, 'items'), STASH_LINES, stashLine) };
  }),
};
/**
 * Each doc as it goes on the wire, which `DOCS` reads back: the fight's shorter shape (fight-doc.ts `fightWire`), the rest as
 * they are. The server stores and serves a doc in this shape, after `DOCS` read it.
 */
export const WIRES: { readonly [K in DocName]: (doc: Docs[K]) => object } = {
  fight: fightWire, kicked: d => d, codex: d => d, rules: d => d, world: d => d, solo: d => d, feats: d => d, stash: d => d,
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
/**
 * A page of the room's events as viewer `v` gets it (`servedTo`), and the cursor past it. A poll that names device
 * `claims` and is not proven for it stops just before the first sealed event that names that device: the cursor would
 * otherwise pass a message for that phone which it never got. That is a phone back in the room after a removal, which
 * freed its slot: its catch-up polls come before the sheet push that binds the slot again (owner.ts), and it reads the
 * message on a later poll, proven. Its page then says no `more`, so it waits for its next poll rather than asking again
 * at once. A phone that names another's device learns no more than that a sealed message waits there.
 */
export function servedPage<E extends RoomEvent & { readonly seq: number }>(page: { readonly events: readonly E[]; readonly next: number; readonly more: boolean }, v: RoomViewer, claims: DeviceId | null): { events: E[]; next: number; more: boolean } {
  const held = v.kind === 'anyone' && claims !== null ? page.events.findIndex(e => isSealed(e) && named(e).some(k => deviceOf(k) === claims)) : -1;
  if (held < 0) return { events: page.events.filter(e => servedTo(e, v)), next: page.next, more: page.more };
  const before = page.events.slice(0, held);
  return { events: before.filter(e => servedTo(e, v)), next: page.events[held]!.seq - 1, more: false };
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
    return { face: { name: text(NAME_MAX)(own(f, 'name')), level: need(parseLevel(own(f, 'level'))), job: nullOr(text(NAME_MAX))(own(f, 'job')), bag: bag === null ? null : listOf(bag, FACE_LINES, faceLine) } };
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
