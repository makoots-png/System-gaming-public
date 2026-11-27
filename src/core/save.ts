// save.ts: what a save is. The types, the default of every entity and the parser at the boundary. A save from before
// schema 4 (the new combat rules) is not read: `loadSave` keeps its text for the backups and opens a new campaign.
// Pure: the caller passes the clock and the device id maker in `ParseEnv`. A hunter, its default and its repair are
// src/core/hunter/hunter.ts, and the repair's tools src/core/repair.ts, both below this file: a module this file loads
// (the outbox, the story runs, protocol.ts) may load them, never this file.
// A change to the shape of a save is made here and in tests/save.test.ts.
import { parseFeats } from './hunter/feats.ts';
import type { FeatDef } from './hunter/feats.ts';
import { STATUS_KEY_RE } from './combat/effect-ops.ts';
import type { StatusDef } from './combat/effect-ops.ts';
import { parseFight, parseStatusDef } from './combat/fight-parse.ts';
import type { Fight } from './combat/fight-types.ts';
import { monsterId, newGate, parseGate } from './gates/gate.ts';
import type { Gate, GateMonster, GateNpc, GateStatus, GateType } from './gates/gate.ts';
import { parseApplied, parseHeld } from './applied.ts';
import { parseOutbox } from './sync/outbox.ts';
import { parseSeen } from './sync/seen.ts';
import { parseFightHeard } from './sync/fight-heard.ts';
import type { FightHeard } from './sync/fight-heard.ts';
import { ringMerged } from './sync/bind.ts';
import type { BindJoin } from './sync/bind.ts';
import type { RoomPlaces } from './sync/seen.ts';
import type { Outbox } from './sync/outbox.ts';
import type { RoomEvent } from './protocol.ts';
import { ITEM_TYPES, LOOT_ITEMS, RARITIES, SHOP_ITEMS, SLOTS, SLOT_LABELS, WEAR_LIMIT } from './registry/items.ts';
import { HEARD_MAX, bagDefs, parseItemBook, parseItemGrant } from './registry/item-book.ts';
import type { HeldItem, ItemDefData, ItemGrant, ItemResolveRules } from './registry/item-book.ts';
import { catalogIdOf } from './catalog-id.ts';
import { parseMonster } from './registry/monsters.ts';
import { parseNpc } from './registry/npcs.ts';
import type { Npc, NpcSkill, NpcTier } from './registry/npcs.ts';
import { isIconKey } from './registry/icons.ts';
import type { IconKey } from './registry/icons.ts';
import { SKILL_SEEDS, SKILL_TYPES, skillOf } from './registry/skills.ts';
import type { SkillType } from './registry/skills.ts';
import type { ItemTemplate, ItemType, Rarity, Slot } from './registry/items.ts';
import type { Skill } from './registry/skills.ts';
import type { Item } from './registry/items.ts';
import type { Loot, Monster, StartStatus } from './registry/monsters.ts';
import { parseBattleMap } from './registry/maps.ts';
import type { BattleMap } from './registry/maps.ts';
import { parseStory } from './story/story.ts';
import type { Story } from './story/story.ts';
import { keptRuns, parseStoryRun } from './story/run.ts';
import type { StoryRun } from './story/run.ts';
import { oneOf } from './one-of.ts';
import { roleOf } from './role.ts';
import { parseCoins } from './coin.ts';
import { parseCheck, parseRollKind } from './roll.ts';
import { NO_TABLE_WEIGHT, parseHeldWeights, parseTableWeight } from './table-weight.ts';
import type { HeldWeights, TableWeight } from './table-weight.ts';
import type { Check, RollKind } from './roll.ts';
import type { Coin } from './coin.ts';
import { RANKS } from './rules.ts';
import type { Rank } from './rules.ts';
/** The ranks, and a rank: src/core/rules.ts. */
export { RANKS };
export type { Rank };
import { newRewards, parseBundle } from './rewards.ts';
import type { RewardBundle, Rewards } from './rewards.ts';
import type { CapDisplay, Progress } from './hunter/progress.ts';
import { isStateChip } from './hunter/chips.ts';
import { parseAsked } from './sync/asked.ts';
import { parseStashAsk } from './trade/goods.ts';
import { NO_STASH, parseStash } from './trade/stash.ts';
import type { Stash } from './trade/stash.ts';
import type { Asked } from './sync/asked.ts';
import { parseOffers } from './trade/offer.ts';
import { parseWords } from './sync/word.ts';
import type { Word } from './sync/word.ts';
import { parsePending } from './hunter/pending.ts';
import type { PendingReward } from './hunter/pending.ts';
import { newClassHolders, parseClassHolders, parseClassOffer } from './hunter/class-locker.ts';
import type { ClassEntry, ClassHolder, ClassHolders, ClassLocker, ClassOffer } from './hunter/class-locker.ts';
import type { OfferRecord } from './trade/offer.ts';
import type { Penalty } from './hunter/penalty.ts';
import type { JobChain } from './hunter/job-chain.ts';
import type { Life, Vitals } from './hunter/vitals.ts';
import { fightId, parseCatalogId, parseCatalogKey, parseCombatantId, parseDeviceId, parseGateId, parseGmKey, parseItemDefId, parseNpcId, parseRoomCode, parseSaveId, saveId } from './ids.ts';
import type { CatalogId, CatalogKey, ItemDefId, CombatantId, DeviceId, EventId, FightId, GateId, GmKey, HunterId, IdOf, LogId, MonsterId, QuestId, RollEntryId } from './ids.ts';
import type { RoomCode } from './ids.ts';
import { RULES as BASE_RULES, rulesOf } from './rules.ts';
import { parseOverrides } from './overrides.ts';
import { dayKey, parseDayKey } from './day.ts';
import type { DayKey } from './day.ts';
import type { Rules } from './rules.ts';
import { LIMITS, NO_DEVICE, SEQ_MAX, VITAL_MAX, claimId, fill, idNumber, int, isNum, isObj, isStr, items, list, num, numOrNull, optional, refill, skills, str } from './repair.ts';
import type { ParseEnv, Rec, RepairRun } from './repair.ts';
import { atSync } from './save-step.ts';
import {
  QUEST_KINDS, QUEST_SOURCES, QUEST_STATUSES, SHADOW_GRADES, fixGmLocalUniques, fixHunter, fixRefs, hunterExample, jobOf, newBoon, newEquipped, newHunter, newLoadout,
  newQuest, newShadow, newStats, newTitle, parseSheetHunter, questState,
} from './hunter/hunter.ts';
import type {
  Boon, Condition, Daily, Hunter, Loadout, Objective, Quest, QuestKind, QuestSource, QuestState, QuestStatus, RankBy, Shadow, ShadowGrade, Title,
} from './hunter/hunter.ts';
export { rulesOf };
export type { Rules };
/** A gate, its statuses and its default: src/core/gates/gate.ts. Only its transition table changes a gate's status or XP paid. */
export type { Gate, GateMonster, GateNpc, GateStatus, GateType };

// ── enums ──
export const MODES = ['player', 'gm'] as const;
/** The skill enum and the one skill parser: src/core/registry/skills.ts. */
export { SKILL_TYPES };
export type { SkillType };
/** The item enums and the one item parser: src/core/registry/items.ts. */
export { ITEM_TYPES, RARITIES, SLOTS, SLOT_LABELS, WEAR_LIMIT };
export type { ItemTemplate, ItemType, Rarity, Slot };
/** A skill, an item, a monster and an NPC live in the registry that owns each (src/core/registry/). */
export type { Item, Loot, Monster, Npc, NpcSkill, NpcTier, Skill, StartStatus };
export const LOG_KINDS = ['system', 'award', 'quest', 'gate', 'combat', 'rank', 'use', 'story', 'trade', 'word', 'answer'] as const;

export type Mode = (typeof MODES)[number];
export type LogKind = (typeof LOG_KINDS)[number];

// ── entities. A `?` field is one a view adds and removes as it goes, so it has no default. ──
export type { StatusDef };
/** A hunter's earned class locker and campaign unique-class registry types. */
export type { ClassEntry, ClassHolder, ClassHolders, ClassLocker, ClassOffer };
/** A hunter's display-only level cap chip value (`Rank | 'none' | null`): src/core/hunter/progress.ts. */
export type { CapDisplay };
/** A hunter and what it holds (quests, titles, boons, shadows, loadouts), its defaults and its repair: src/core/hunter/hunter.ts. */
export {
  QUEST_KINDS, QUEST_SOURCES, QUEST_STATUSES, SHADOW_GRADES, jobOf, newBoon, newEquipped, newHunter, newLoadout, newQuest, newShadow, newStats,
  newTitle, parseSheetHunter, questState,
};
export type { Boon, Condition, Daily, Hunter, Loadout, Objective, Quest, QuestKind, QuestSource, QuestState, QuestStatus, RankBy, Shadow, ShadowGrade, Title };
/** What a reward may hold and its one reader: src/core/rewards.ts. */
export { newRewards };
export type { RewardBundle, Rewards };
/** Level, XP, peak level and ability points: src/core/hunter/progress.ts. Only its functions change them. */
export type { Progress };
/** Life (HP, or dead), mana, fatigue and collapse: src/core/hunter/vitals.ts. Only its functions change them. */
export type { Life, Vitals };
/** The daily penalty, tied to its Penalty Zone quest: src/core/hunter/penalty.ts. Only its functions change it. */
export type { Penalty };
/** The Job Change chain, tied to its open step's quest: src/core/hunter/job-chain.ts. Only its functions change it. */
export type { JobChain };

/** A fight and its rows: src/core/combat/fight-types.ts. Only the fight's reducer (src/core/combat/fight.ts) changes them. */
export type { Fight };
/**
 * The fight's links outside it: the gate it was started from (its End pays that gate's XP once, through `fightAward`),
 * and the bestiary entry of each monster row by row id (its loot and its extraction).
 */
export type FightRefs = { gate: GateId | null; monsters: Record<CombatantId, MonsterId> };
export type LogEntry = { id: LogId; at: string; kind: LogKind; hunterId: HunterId | null; title: string; text: string };
/**
 * A roll in this phone's roll log. `hid`: the hunter of this phone who rolled, or null for the GM's own roll; `who`: the
 * words the log shows for them. `kind`: what it was for; `check`: a check's DC and result (src/core/roll.ts). Each is set
 * by the dice tray as it rolls (src/views/dice.js).
 */
export type RollEntry = {
  id: RollEntryId; at: string; hid: HunterId | null; who: string; kind: RollKind; label: string; expr: string; rolls: number[]; total: number;
  natural: number | null; crit: boolean; fumble: boolean; adv: boolean; dis: boolean; check: Check | null;
};

/** The room this phone was last in and why it is not in it now (src/core/sync/link.ts `Last`). */
export type LastRoom = { code: RoomCode; why: LastWhy };
export const LAST_WHY = ['left', 'gone', 'removed'] as const;
export type LastWhy = (typeof LAST_WHY)[number];
/** The last catalog revision and canonical doc hash this phone published to the server (sync/catalog-publish.ts). */
export type CatalogSent = { readonly id: CatalogId; readonly rev: number; readonly hash: string };
export type SyncSettings = {
  room: RoomCode | null; cursor: number; serverOk: boolean;
  /** The GM key of `room`, and this phone's GM keys by room code. */
  gmKey?: GmKey | null; gmKeys?: Record<string, GmKey>; lastRoom?: LastRoom | null; boundHunterId?: HunterId;
  /** This phone's secret for the sheets it writes (the server keeps only its hash). Made at load beside `deviceId`. */
  deviceToken: string;
  /** This phone's join of a room, which names its room (src/core/sync/bind.ts `BindJoin`); only a join writes it. */
  joined?: BindJoin;
  /** What this phone still owes the room: room events and tombstones, each with its state (src/core/sync/outbox.ts). */
  outbox?: Outbox;
  /** Room events this phone could not apply yet, tried again after each good poll (src/core/applied.ts `hold`). */
  held?: RoomEvent[];
  /** Ids of the room events that changed a hunter on this phone, newest last (src/core/applied.ts). */
  applied?: EventId[];
  /** On a player's phone, the GM's fight's last `vitals` message to a hunter of it (src/core/sync/fight-heard.ts): it holds the hunter until the room's fight doc answers it. */
  heard?: FightHeard;
  /** A player's letters to the GM's phone until it answers each: won runs of a room's solo gates, stash asks (src/core/sync/asked.ts). */
  asked?: Asked[];
  /** This phone's records of the room's offers: its hunters' (with their goods aside), offers to them, and on the GM's phone every one (src/core/trade/offer.ts). */
  offers?: OfferRecord[];
  /** Where this phone stopped reading each room it went out of, so a join back reads on from there (src/core/sync/seen.ts). */
  seen?: RoomPlaces;
  /** On a player's phone, the GM's weight on its hunters' rolls outside a fight, as the room's `weigh` set it (src/core/table-weight.ts). */
  weights?: HeldWeights;
  /** Words to the GM: a player's own with the GM's answers, and on the GM's phone each it heard (src/core/sync/word.ts). */
  words?: Word[];
  /** On the GM's phone, the rewards the app would have paid by itself, waiting for the GM's approval (src/core/hunter/pending.ts). */
  pending?: PendingReward[];
  /**
   * This phone's catalog keys by catalog id: the secret that owns a GM's item catalog (`library.catalogId` is
   * `catalogIdOf` its key). The edge mints one at the first custom item or first publish; a campaign file whose catalog
   * has no key here is rekeyed at import (item-refs.ts `rekeyCatalog`).
   */
  catalogKeys?: Record<CatalogId, CatalogKey>;
  /** The last catalog id, rev and canonical doc hash this phone published (sync/catalog-publish.ts). */
  catalogSent?: CatalogSent;
};
/**
 * Whose each field of the sync settings is (docs/agent-handoff/audit/notes-sync-3.md). `campaign`: the room the campaign
 * plays in, its place there and the hunter it sends, which a file carries and a save swapped in brings. `phone`: this
 * phone's identity to the room and its dealings with rooms under it (the room knows a hunter as this device and the
 * hunter's id), never in a file and kept across every swap. `key`: a GM key, this phone's credential, in a file only
 * when asked and merged into the ring on a swap (`keepPhone`). A new field does not typecheck until it has an owner.
 */
export const SYNC_OWNER: { readonly [K in keyof SyncSettings]-?: 'campaign' | 'phone' | 'key' } = {
  room: 'campaign', cursor: 'campaign', lastRoom: 'campaign', boundHunterId: 'campaign',
  gmKey: 'key', gmKeys: 'key', catalogKeys: 'key',
  deviceToken: 'phone', serverOk: 'phone', joined: 'phone', outbox: 'phone', held: 'phone', applied: 'phone', heard: 'phone', asked: 'phone', offers: 'phone', seen: 'phone',
  weights: 'phone', words: 'phone', pending: 'phone', catalogSent: 'phone',
};
/** The fields of `sync` that `owner` owns, as they are. */
const ownedBy = (sync: SyncSettings, owner: (typeof SYNC_OWNER)[keyof SyncSettings]): Partial<SyncSettings> =>
  Object.fromEntries(Object.entries(sync).filter(([k]) => SYNC_OWNER[k as keyof SyncSettings] === owner));
export type Settings = {
  mode: Mode; activeHunterId: HunterId; dailyResetHour: number; onboarded: boolean; sound: boolean; deviceId: DeviceId;
  sync: SyncSettings;
};
/** `session`: how many sessions the GM has started (`sessionStarted`, gates/world.ts), the next one's number less one. */
export type World = { day: number; lastDailyKey: DayKey | null; session: number };
/**
 * The GM's own content. `statuses`: the GM's statuses by key. A built-in key holds an override of that built-in, any
 * other key a status of the GM's own. `rulesOf` merges them over the built-ins. `skills`: skills the GM gives to hunters
 * and monsters, each copied by value. `rewards`: named rewards the GM gives again (src/core/rewards.ts). `maps`: battle
 * maps a gate may name (src/core/registry/maps.ts). `feats`: the GM's own feats and the GM's edits of the built-ins, by
 * key (hunter/feats.ts, laid over the built-ins by `featsFor`). `stories`: the GM's stories, each a list of chapters the
 * GM opens one at a time (story/story.ts).
 */
export type Library = {
  /** The GM's item definitions by id: a `c:<catalogId>:*` of the GM's own, or a `b:*` override of a built-in. Written only by library.ts `saveItemDef` and `removeItemDef`, and the rekeys of item-refs.ts. */
  items: Record<ItemDefId, ItemDefData>;
  /** The catalog this campaign's custom items belong to (`catalogIdOf` its key in `settings.sync.catalogKeys`); null until the first custom item. */
  catalogId: CatalogId | null;
  statuses: Record<string, StatusDef>; skills: Skill[]; rewards: RewardBundle[]; maps: BattleMap[]; feats: Record<string, FeatDef>; stories: Story[]; npcs: Npc[] };
export type Save = {
  schema: number; savedAt: string; seq: number; settings: Settings; rulesOverrides: Record<string, unknown>; world: World;
  hunters: Hunter[]; gates: Gate[]; monsters: Monster[]; library: Library;
  /** The GM's own shop by item id, made from the built-in one at its first edit; null shows the built-in shop. */
  shop: ItemDefId[] | null;
  /**
   * Item defs this phone heard and does not hold in its library: a custom item of another catalog, or one the GM deleted,
   * held by a hunter, the stash, an offer or a reward of this save. Laid under `library.items` in `R.items`
   * (edge/rules.ts). Written only by item-refs.ts `heardStep`, which drops a def nothing names.
   */
  heardItems: Record<ItemDefId, ItemDefData>;
  fight: Fight | null; log: LogEntry[]; rolls: RollEntry[];
  /**
   * What fights' defeated monsters dropped and the GM has not given or set aside yet, oldest first (pay.ts: `settleEncounter`
   * adds a fight's drop, `dropDealt` takes one away as the Award form's send gives it or the GM sets it aside), so a
   * reload keeps the offer and a later fight never writes over it.
   */
  loot: FightLoot;
  /** What the fight came from, which the fight itself does not hold. Written only by src/views/combat.js. */
  fightRefs?: FightRefs;
  /** The bestiary's record of defeated monsters by `name|rank`, and the combatant ids already counted (the newest `CODEX_SEEN_MAX`). */
  codex: Record<string, CodexEntry>; codexSeen: CombatantId[];
  /**
   * The coin calls (src/core/coin.ts), written only by src/views/coin.js. `coins`: the coins this phone's hunters called.
   * `calls`: on the GM's phone, the calls players sent. Nothing in either says how a coin's side was chosen.
   */
  coins: readonly Coin[]; calls: readonly Coin[];
  /** The GM's stories on the table (story/run.ts), written only by that file's `storyMove`: running ones and the newest ended. */
  storyRuns: StoryRun[];
  /** The GM's weight on the hunters' dice outside a fight (src/core/table-weight.ts), written only by its `weightStep`. */
  tableWeight: TableWeight;
  /** The party stash (src/core/trade/stash.ts): on the GM's save, published to the room as the `stash` doc; written only by that file's steps. */
  stash: Stash;
  /** Campaign registry of claimed unique Epic and Mythic classes (src/core/hunter/class-holders.ts). */
  classHolders: ClassHolders;
  /** Active GM unique-class offer (`null` when closed; written only by src/core/hunter/class-offer.ts). */
  classOffer: ClassOffer | null;
};
/** A monster kind this campaign has defeated. `room`: copied from the GM's codex doc, with the numbers it carried in `info`. */
export type CodexEntry = { name: string; rank: Rank; kills: number; firstAt: string; lastAt: string; monsterId: MonsterId | null; room?: true; info?: CodexInfo };
/** What the GM's codex doc tells a player about a defeated monster: its sheet's max HP, armor, resist and speed, and up to 4 ability names. */
export type CodexInfo = { hpMax: number; armor: number; resist: number; speed: number; abilities: string[]; icon?: IconKey };
export const CODEX_SEEN_MAX = 400;

// ── defaults. Each factory is typed by its entity, so a field added to a type without a default does not compile. ──
/** 6: current save shape (items by reference: item sync PR 2). Saves of an older schema are not read. */
export const SCHEMA = 6;
/** A fight's drop: the fight it came from, its gold and its items, as a monster's loot holds them (registry/monsters.ts `Loot`). */
export type Dropped = { readonly fight: FightId; readonly gold: number; readonly items: ItemGrant[] };
/** The loot waiting for the GM (pay.ts `lootStep`): none, or the drops of one or more fights, oldest first, one per fight. */
export type FightLoot = { readonly at: 'none' } | { readonly at: 'waiting'; readonly drops: readonly [Dropped, ...Dropped[]] };
/** Bounds for junk or hostile saves only: src/core/repair.ts. */
export { LIMITS };

export const newSyncSettings = (): SyncSettings => ({ room: null, cursor: 0, serverOk: false, deviceToken: '' });
export const newSettings = (deviceId: DeviceId): Settings => ({
  mode: 'player', activeHunterId: saveId('h', 1), dailyResetHour: 0, onboarded: true, sound: false, deviceId, sync: newSyncSettings(),
});
export const newWorld = (): World => ({ day: 1, lastDailyKey: null, session: 0 });
/** A blank bestiary entry: what `parseMonster` reads an empty object as. The bestiary's codex entries start from it until W5. */
export const newMonster = (): Monster => ({ ...parseMonster({})!, id: saveId('m', 0) });
export const newLogEntry = (): LogEntry => ({ id: saveId('l', 0), at: '', kind: 'system', hunterId: null, title: '', text: '' });
export const newRollEntry = (): RollEntry => ({
  id: saveId('r', 0), at: '', hid: null, who: '', kind: 'other', label: '', expr: '', rolls: [], total: 0, natural: null, crit: false, fumble: false,
  adv: false, dis: false, check: null,
});
/** An empty save, the example a stored one is filled from: no hunters. Read through the repair, every save holds one. */
export const newSave = (deviceId: DeviceId): Save => ({
  schema: SCHEMA, savedAt: '', seq: 100, settings: newSettings(deviceId), rulesOverrides: {}, world: newWorld(), hunters: [], gates: [],
  monsters: [], library: { items: {}, catalogId: null, statuses: {}, skills: [], rewards: [], maps: [], feats: {}, stories: [], npcs: [] }, shop: null, heardItems: {}, fight: null, loot: { at: 'none' }, log: [], rolls: [], codex: {}, codexSeen: [], coins: [], calls: [], storyRuns: [],
  tableWeight: NO_TABLE_WEIGHT, stash: NO_STASH, classHolders: newClassHolders(deviceId), classOffer: null,
});

// ── parser ──
// How a save is repaired, in place, each object filled by its default and then checked: src/core/repair.ts. A hunter's
// repair is `fixHunter` in src/core/hunter/hunter.ts.

/** What a read needs from outside: src/core/repair.ts. */
export type { ParseEnv };

export type Parsed =
  /**
   * A save of this schema. `fightLost`: it held a fight the fight's parser did not read as one (a damaged fight), so the
   * repair dropped it; a load tells the player (`loadSave`). A fight a lowered rule made past its maxima still reads (V13).
   */
  | { kind: 'save'; save: Save; fightLost: boolean }
  /** Written by a newer app: the edge opens it read-only. */
  | { kind: 'newer'; schema: number; save: Save }
  | { kind: 'invalid'; reason: 'not-json' | 'not-an-object' | 'not-a-save' | 'old' };

/** Gates come from their own parser, which builds new objects with only the fields a gate has. One without an id takes the default's. */
function gates(run: RepairRun, value: unknown): Gate[] {
  return (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => {
    const g = parseGate(raw) ?? parseGate({ ...raw, id: newGate().id });
    if (!g) return [];
    claimId(run, g, 'g');
    return [g];
  });
}
function codexOf(v: Rec): Record<string, CodexEntry> {
  const out: Record<string, CodexEntry> = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!isObj(raw) || key === '__proto__') continue;
    const e: CodexEntry = { name: str(raw.name, '', 60), rank: oneOf(raw.rank, RANKS, 'E'), kills: int(raw.kills, 1, 1), firstAt: str(raw.firstAt, '', 40),
      lastAt: str(raw.lastAt, '', 40), monsterId: monsterId(raw.monsterId) };
    if (raw.room === true) e.room = true;
    if (isObj(raw.info)) {
      const i = raw.info;
      e.info = {
        hpMax: num(i.hpMax, 0, 0, VITAL_MAX), armor: num(i.armor, 0, 0, VITAL_MAX), resist: num(i.resist, 0, 0, VITAL_MAX), speed: num(i.speed, 0, 0, VITAL_MAX),
        abilities: (Array.isArray(i.abilities) ? i.abilities : []).filter(isStr).map(a => a.slice(0, 60)).slice(0, 4),
        ...(isIconKey(i.icon) ? { icon: i.icon } : {}),
      };
    }
    out[key] = e;
  }
  return out;
}
/** The GM's monsters, each read by `parseMonster`; one without an id takes the default's. */
const monsters = (run: RepairRun, value: unknown): Monster[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseMonster(raw); return t ? [refill<Monster>(run, raw, t, 'm0', 'm')] : []; });
/** The GM's reward bundles, each read by `parseBundle`; one without a name is dropped, one without an id takes the default's. */
const bundles = (run: RepairRun, value: unknown): RewardBundle[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseBundle(raw); return t ? [refill<RewardBundle>(run, raw, t, 'rb0', 'rb')] : []; });
/** The GM's battle maps, each read by `parseBattleMap`; one without a name is dropped, one without an id takes the default's. */
const maps = (run: RepairRun, value: unknown): BattleMap[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseBattleMap(raw, run.R); return t ? [refill<BattleMap>(run, raw, t, 'mp0', 'mp')] : []; });
/** The GM's stories, each read by `parseStory`; one without a name or a chapter is dropped, one without an id takes the default's. */
const stories = (run: RepairRun, value: unknown): Story[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseStory(raw); return t ? [refill<Story>(run, raw, t, 'st0', 'st')] : []; });
/** The GM's NPCs, each read by `parseNpc` under shipped rules; one without a name is dropped, and any id `parseNpcId` refuses is blanked so `claimId` renumbers it. */
const npcs = (run: RepairRun, value: unknown): Npc[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => {
    const t = parseNpc(raw);
    if (!t) return [];
    if (parseNpcId(raw.id) === null) raw.id = '';
    return [refill<Npc>(run, raw, t, 'npc_0', 'npc_')];
  });
/** The stories on the table, each read by `parseStoryRun` (one naming no story or no state is dropped), then `keptRuns`. */
const storyRuns = (run: RepairRun, value: unknown): StoryRun[] =>
  keptRuns((Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseStoryRun(raw); return t ? [refill<StoryRun>(run, raw, t, 'sr0', 'sr')] : []; }));
/** Item grants (a drop's): each read by `parseItemGrant`, one it refuses dropped, at most `cap`. */
const grants = (value: unknown, cap: number): ItemGrant[] => (Array.isArray(value) ? value : []).flatMap(raw => parseItemGrant(raw) ?? []).slice(0, cap);
/** The GM's shop: each id `parseItemDefId` reads, once, at most `SHOP_MAX`. */
const shopIds = (value: unknown): ItemDefId[] => [...new Set((Array.isArray(value) ? value : []).flatMap(v => parseItemDefId(v) ?? []))].slice(0, SHOP_MAX);
/**
 * The item defs a save holds, for `R.items`: what this phone heard (`heardItems`) under the library's own, so a GM's
 * edit wins over a def heard earlier. Built-in ids heard from elsewhere are never laid over the shipped ones.
 */
export function savedItemBook(save: { readonly library: Pick<Library, 'items'>; readonly heardItems: Readonly<Record<ItemDefId, ItemDefData>> }): Record<ItemDefId, ItemDefData> {
  const heard = Object.entries(save.heardItems).filter(([id]) => id.startsWith('c:'));
  return heard.length ? { ...Object.fromEntries(heard), ...save.library.items } : save.library.items;
}
/** The most ids the GM's shop lists. */
export const SHOP_MAX = 200;
/** The most item lines one fight's drop holds: a monster's loot bound (registry/monsters.ts `lootItems`) times the eight monsters of a fight. */
const LOOT_GRANTS_MAX = 160;
/** The longest id of a fight a drop names: what the fight's parser reads as one (fight-parse.ts `idText`). */
const FIGHT_ID_MAX = 80;
/**
 * A stored drop: the id of the fight it came from, its gold a whole number from 0 and its items a list, each read by
 * `parseItem`. Null for anything else, and for a drop that holds nothing.
 */
function dropOf(v: unknown): Dropped | null {
  if (!isObj(v) || typeof v.fight !== 'string' || !v.fight || v.fight.length > FIGHT_ID_MAX || !Array.isArray(v.items)) return null;
  const gold = v.gold, items = grants(v.items, LOOT_GRANTS_MAX);
  if (typeof gold !== 'number' || !Number.isInteger(gold) || gold < 0) return null;
  return gold || items.length ? { fight: fightId(v.fight), gold, items } : null;
}
/** The stored loot: waiting with each drop that reads, the first of each fight kept; none when no drop reads or it is not waiting. */
function lootOf(v: unknown): FightLoot {
  if (!isObj(v) || v.at !== 'waiting' || !Array.isArray(v.drops)) return { at: 'none' };
  const drops: Dropped[] = [];
  for (const raw of v.drops) { const d = dropOf(raw); if (d && !drops.some(x => x.fight === d.fight)) drops.push(d); }
  const [first, ...rest] = drops;
  return first ? { at: 'waiting', drops: [first, ...rest] } : { at: 'none' };
}

/**
 * The GM's statuses: at most `LIMITS.libraryStatuses`, each under a key `STATUS_KEY_RE` accepts that is not a chip a
 * hunter's state draws, each def read by `parseStatusDef`. An entry that fails any of these is dropped.
 */
function statusLibrary(value: Rec): Record<string, StatusDef> {
  const out: Record<string, StatusDef> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (Object.keys(out).length >= LIMITS.libraryStatuses) break;
    if (!STATUS_KEY_RE.test(key) || isStateChip(key)) continue;
    const def = parseStatusDef(raw, BASE_RULES, key);
    if (def) out[key] = def;
  }
  return out;
}

function fixSync(sync: SyncSettings, now: number): void {
  sync.room = parseRoomCode(sync.room);
  optional(sync, 'gmKey', v => v === null || parseGmKey(v) !== null);
  if ('gmKeys' in sync) {
    const keys: unknown = sync.gmKeys;
    if (!isObj(keys)) delete sync.gmKeys;
    else for (const code of Object.keys(keys)) if (!parseRoomCode(code) || !parseGmKey(keys[code])) delete keys[code];
  }
  if ('catalogKeys' in sync) {
    const keys: unknown = sync.catalogKeys;
    if (!isObj(keys)) delete sync.catalogKeys;
    else for (const id of Object.keys(keys)) { const key = parseCatalogKey(keys[id]); if (!key || catalogIdOf(key) !== id) delete keys[id]; }
  }
  if ('catalogSent' in sync) {
    const raw: unknown = sync.catalogSent;
    const id = isObj(raw) ? parseCatalogId(raw.id) : null;
    const rev = isObj(raw) && typeof raw.rev === 'number' && Number.isInteger(raw.rev) && raw.rev >= 1 && raw.rev <= Number.MAX_SAFE_INTEGER ? raw.rev : null;
    const hash = isObj(raw) && typeof raw.hash === 'string' && /^[0-9a-f]{64}$/.test(raw.hash) ? raw.hash : null;
    if (id && rev !== null && hash) sync.catalogSent = { id, rev, hash };
    else delete sync.catalogSent;
  }
  if ('lastRoom' in sync) {
    const last: unknown = sync.lastRoom;
    const code = isObj(last) ? parseRoomCode(last.code) : null;
    if (isObj(last) && code) sync.lastRoom = { code, why: LAST_WHY.includes(last.why as LastWhy) ? (last.why as LastWhy) : 'left' };
    else if (last !== null) delete sync.lastRoom;
  }
  optional(sync, 'boundHunterId', v => parseSaveId<'h'>(v) !== null);
  optional(sync, 'joined', v => isObj(v) && parseRoomCode(v.room) !== null && isStr(v.at));
  if ('outbox' in sync) sync.outbox = parseOutbox(sync.outbox);
  if ('held' in sync) sync.held = parseHeld(sync.held);
  if ('heard' in sync) { const h = parseFightHeard(sync.heard); if (h) sync.heard = h; else delete sync.heard; }
  if ('asked' in sync) sync.asked = parseAsked(sync.asked, parseStashAsk);
  if ('offers' in sync) sync.offers = parseOffers(sync.offers);
  if ('words' in sync) sync.words = parseWords(sync.words);
  if ('pending' in sync) sync.pending = parsePending(sync.pending);
  if ('seen' in sync) sync.seen = parseSeen(sync.seen, now);
  if ('weights' in sync) { const w = parseHeldWeights(sync.weights); if (w) sync.weights = w; else delete sync.weights; }
  if ('applied' in sync) {
    const ids: unknown = sync.applied;
    if (!Array.isArray(ids)) delete sync.applied;
    else sync.applied = parseApplied(ids);
  }
}

/** A device token shorter than this is not a secret: the load makes a new one. */
export const DEVICE_TOKEN_MIN = 16;
/** Repairs a save-shaped object in place. */
function repair(s: Rec, env: ParseEnv, fight: FightRepair = 'read'): Save {
  const save = fill(s, newSave(NO_DEVICE));
  save.library.statuses = statusLibrary(save.library.statuses);
  // An override the rules do not have, or of the wrong type, is dropped here, so it never reaches `rulesOf`.
  save.rulesOverrides = parseOverrides(save.rulesOverrides).overrides;
  save.library.items = parseItemBook(save.library.items, LIMITS.libraryItems);
  save.library.catalogId = parseCatalogId(save.library.catalogId);
  save.heardItems = parseItemBook(save.heardItems, HEARD_MAX);
  // a hunter's sheet reads its worn items by id, so the repair reads them under the save's own defs
  const R = rulesOf(save.rulesOverrides, save.library.statuses, savedItemBook(save));
  const run: RepairRun = { R, env, ids: new Set(), bad: [], owner: null };
  const st = save.settings;
  st.mode = oneOf(st.mode, MODES, 'player');
  st.dailyResetHour = int(st.dailyResetHour, 0, 0, 23);
  st.deviceId = parseDeviceId(st.deviceId) ?? env.newDeviceId();
  fixSync(st.sync, env.now.getTime());
  if (st.sync.deviceToken.length < DEVICE_TOKEN_MIN) st.sync.deviceToken = env.newDeviceToken();
  save.world.lastDailyKey = parseDayKey(save.world.lastDailyKey) ?? dayKey(env.now, st.dailyResetHour);
  save.world.day = int(save.world.day, 1, 1); save.world.session = int(save.world.session, 0, 0);
  save.savedAt = str(save.savedAt, '', 40);

  save.hunters = list(run, save.hunters, 'h', () => hunterExample(R), h => fixHunter(run, h));
  save.library.skills = skills(run, save.library.skills.slice(0, LIMITS.librarySkills));
  save.library.rewards = bundles(run, save.library.rewards.slice(0, LIMITS.libraryRewards));
  save.library.maps = maps(run, save.library.maps.slice(0, LIMITS.libraryMaps));
  save.library.feats = parseFeats(save.library.feats, LIMITS.libraryFeats);
  save.library.stories = stories(run, save.library.stories.slice(0, LIMITS.libraryStories));
  save.library.npcs = npcs(run, save.library.npcs.slice(0, LIMITS.libraryNpcs));
  save.storyRuns = storyRuns(run, save.storyRuns);
  save.gates = gates(run, save.gates);
  save.shop = Array.isArray(save.shop) ? shopIds(save.shop) : null;
  save.loot = lootOf(save.loot);
  save.codex = codexOf(save.codex);
  save.codexSeen = save.codexSeen.flatMap(v => parseCombatantId(v) ?? []).slice(-CODEX_SEEN_MAX);
  save.coins = parseCoins(save.coins); save.calls = parseCoins(save.calls);
  save.stash = parseStash(save.stash);
  const regStamp = Math.max(0, Math.trunc(env.now.getTime())).toString(36);
  const fallbackReg = `${st.deviceId.slice(0, 40 - 1 - regStamp.length)}-${regStamp}`;
  save.classHolders = parseClassHolders(save.classHolders, env.now.toISOString(), fallbackReg);
  save.classOffer = parseClassOffer(save.classOffer, env.now.toISOString());
  save.tableWeight = parseTableWeight(save.tableWeight);
  save.monsters = monsters(run, save.monsters);
  // A fight the fight's parser does not read as one is dropped. One its reducer stored in this app is kept.
  if (fight === 'read') save.fight = parseFight(save.fight, R);
  if ('fightRefs' in save) {
    const refs: unknown = save.fightRefs;
    if (!isObj(refs) || !save.fight) delete save.fightRefs;
    else {
      const monsters: Record<CombatantId, MonsterId> = {};
      for (const [row, m] of Object.entries(isObj(refs.monsters) ? refs.monsters : {})) { const r = parseCombatantId(row), id = monsterId(m); if (r && id) monsters[r] = id; }
      save.fightRefs = { gate: parseGateId(refs.gate), monsters };
    }
  }
  save.log = list(run, save.log, 'l', newLogEntry, l => {
    l.kind = oneOf(l.kind, LOG_KINDS, 'system'); l.title = l.title.slice(0, 120); l.hunterId = parseSaveId<'h'>(l.hunterId);
  }).slice(0, R.logCap);
  save.rolls = list(run, save.rolls, 'r', newRollEntry, r => {
    r.rolls = r.rolls.filter(isNum); r.natural = numOrNull(r.natural); r.hid = parseSaveId<'h'>(r.hid); r.kind = parseRollKind(r.kind);
    r.check = r.kind === 'check' ? parseCheck(r.check) : null;
  }).slice(0, R.rollCap);

  // seq is at least the number every id ends in. Then each missing or repeated id gets the next one, and only then does
  // each hunter's repair point its references at what it holds (`fixRefs`), reading them against the ids as stored.
  let seq = int(save.seq, 100, 0, SEQ_MAX);
  for (const id of run.ids) seq = Math.max(seq, idNumber(id));
  if (save.classOffer) {
    const m = /^co(\d+)/.exec(save.classOffer.id);
    if (m) seq = Math.max(seq, Math.min(SEQ_MAX, Number(m[1])));
  }
  save.seq = seq;
  const storedAs = new Map<Hunter, Map<string, string>>();
  for (const [o, prefix, owner] of run.bad) {
    const was = o.id;
    o.id = prefix + (++save.seq);
    if (owner) storedAs.set(owner, (storedAs.get(owner) ?? new Map<string, string>()).set(o.id, was));
  }
  const nowIso = env.now.toISOString();
  for (const h of save.hunters) fixRefs(h, storedAs.get(h) ?? new Map(), nowIso);
  // GM-mode saves prune unbacked local uniques (e.g., duplicate imported hunter files) and park foreign-campaign uniques;
  // player-mode saves carry an empty classHolders and reconcile against the GM's holders doc in a room.
  if (roleOf(st, st.sync.room) === 'gm') {
    for (const h of save.hunters) fixGmLocalUniques(h, save.classHolders);
  } else {
    save.classOffer = null;
  }
  // A save holds a hunter: one read with none gets the starter here, so every view has an active one to read. It is made
  // after the rename, its ids from `seq` (its title's is the rule title's `t1`).
  if (!save.hunters.length) {
    const starter = starterHunter(save, env);
    fixHunter(run, starter); fixRefs(starter, new Map(), nowIso);
    save.hunters.push(starter);
  }

  if (!save.hunters.some(h => h.id === st.activeHunterId)) st.activeHunterId = save.hunters[0]!.id;
  // the hunter a player's phone sends its room (sync.ts `bound`) is one of the save's; a save in a room has one
  const sy = st.sync;
  if (sy.boundHunterId !== undefined && !save.hunters.some(h => h.id === sy.boundHunterId)) delete sy.boundHunterId;
  if (sy.room && sy.boundHunterId === undefined && save.hunters.length) sy.boundHunterId = st.activeHunterId;
  return save;
}

// ── the boundary ──

/** Reads the text of a stored or imported save. `invalid` means the text is not a save: the caller keeps it. */
export function parseSave(text: string, env: ParseEnv): Parsed {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { kind: 'invalid', reason: 'not-json' }; } // the caller tells the player why
  return parseSaveValue(value, env);
}

/**
 * The same for a value that is already parsed. The value is handed over: it is repaired in place and becomes the
 * save, so the caller must not use it again. A save of this schema holds `schema === SCHEMA` and a list of hunters,
 * whatever else is damaged. An integer schema below `SCHEMA` is refused as `old`; anything else is not a save.
 */
export function parseSaveValue(value: unknown, env: ParseEnv): Parsed {
  if (!isObj(value)) return { kind: 'invalid', reason: 'not-an-object' };
  const schema = value.schema;
  if (typeof schema === 'number' && Number.isInteger(schema) && schema > SCHEMA) return { kind: 'newer', schema, save: repair(value, env) };
  if (!Array.isArray(value.hunters)) return { kind: 'invalid', reason: 'not-a-save' };
  if (typeof schema === 'number' && Number.isInteger(schema) && schema >= 1 && schema < SCHEMA) return { kind: 'invalid', reason: 'old' };
  if (schema !== SCHEMA) return { kind: 'invalid', reason: 'not-a-save' };
  const held = value.fight !== null && value.fight !== undefined, save = repair(value, env);
  return { kind: 'save', save, fightLost: held && save.fight === null };
}

/** What an imported file holds: one hunter (the Data view's "Export active hunter" writes `kind: 'hunter'`) or a campaign. */
export const fileKind = (save: Save): 'hunter' | 'campaign' => ((save as Save & { kind?: unknown }).kind === 'hunter' ? 'hunter' : 'campaign');

/**
 * One hunter as a file that leaves this phone (the Data view's "Export active hunter", `fileKind` `hunter`): the hunter,
 * and the custom defs its bag reads (item-book.ts `bagDefs`) as the file's `heardItems`, so another campaign reads them.
 */
export const hunterFile = (h: Hunter, R: ItemResolveRules, savedAt: string): object =>
  ({ schema: SCHEMA, kind: 'hunter', savedAt, hunters: [h], heardItems: bagDefs(h.items, R) });

/**
 * A campaign as a file that leaves this phone (the Data view's Export): the save without this phone's identity (its
 * device id) and without any sync field that is the phone's (`SYNC_OWNER`), and without its GM keys unless `withKeys`.
 * Whoever opens the file is a phone of its own to the room (implicit audit 3, IO1: the file carried the token, so its
 * reader could write this phone's sheets; audit BUG-sync-3: it carried this phone's outbox, offers and the rest).
 */
export function exportedSave(save: Save, withKeys: boolean): object {
  const { deviceId: _device, ...settings } = save.settings, sync = save.settings.sync;
  return { ...save, classOffer: null, settings: { ...settings, sync: { ...ownedBy(sync, 'campaign'), ...(withKeys ? ownedBy(sync, 'key') : {}) } } };
}
/** The GM keys a save holds: its ring and the key of its room. */
const keysOf = (sync: SyncSettings): Record<string, GmKey> => ({ ...sync.gmKeys, ...(sync.room && sync.gmKey ? { [sync.room]: sync.gmKey } : {}) });
/**
 * A save swapped in on this phone (an import, a restore, a reset) with what is this phone's kept (`SYNC_OWNER`): its
 * device id and every sync field of the phone stay this phone's whatever the save held, so a friend's campaign never
 * makes two phones one device to the room, nor brings their letters, offers or runs. The campaign's fields are the
 * save's. The keys are merged (`ringMerged`): the room's key is the one this phone holds for the campaign's room, else
 * the save's, so a file exported without its key takes no GM power this phone has.
 */
export function keepPhone(save: Save, mine: Pick<Save, 'settings'>): Save {
  const theirs = save.settings.sync, own = mine.settings.sync, ownKeys = keysOf(own), theirKeys = keysOf(theirs);
  const gmKey = theirs.room ? ownKeys[theirs.room] ?? theirKeys[theirs.room] ?? null : null;
  const next: Save = { ...save, settings: { ...save.settings, deviceId: mine.settings.deviceId } };
  // every field of SyncSettings is in one of the two parts (SYNC_OWNER), and the keys are written after them
  const catalogKeys = { ...theirs.catalogKeys, ...own.catalogKeys };
  return atSync(() => ({ ...ownedBy(theirs, 'campaign'), ...ownedBy(own, 'phone'), gmKey, gmKeys: ringMerged(ownKeys, theirKeys), ...(Object.keys(catalogKeys).length ? { catalogKeys } : {}) }) as SyncSettings)(next);
}

/** What the app starts with. The edge acts on it: it owns storage, the backups and the words of the notice. */
export type Loaded = {
  save: Save;
  /** True when nothing was stored under the current key (fresh campaign). */
  fresh: boolean;
  /** A newer app wrote the stored save: never overwrite it. */
  readOnly: boolean;
  /** Raw text the edge must put in the backups before it writes. */
  backup: { reason: string; data: string } | null;
  /**
   * What the player is told of the load itself: `unreadable`, the stored text is not a save of this schema; `fight`,
   * its running fight did not read and was dropped (the rest opens). Each keeps the stored text in the backups. A
   * read-only save is told by the store's life (store-life.ts).
   */
  notice: LoadNotice | null;
};
export type LoadNotice = 'unreadable' | 'fight';

/**
 * Decides what the app opens with from the text stored under the current key (`null` when empty).
 */
export function loadSave(text: string | null, env: ParseEnv): Loaded {
  const quiet = { fresh: false, readOnly: false, backup: null, notice: null };
  if (text === null) return { ...quiet, fresh: true, save: freshSave(env, { onboarded: false }) };
  const parsed = parseSave(text, env);
  switch (parsed.kind) {
    case 'save': return parsed.fightLost ? { ...quiet, save: parsed.save, backup: { reason: 'a fight that could not be read', data: text }, notice: 'fight' } : { ...quiet, save: parsed.save };
    case 'newer': return { ...quiet, save: parsed.save, readOnly: true };
    case 'invalid': return { ...quiet, save: freshSave(env, { onboarded: true }), backup: { reason: 'unreadable', data: text }, notice: 'unreadable' };
  }
}

/**
 * How a repair treats the save's fight: `read` parses it as outside data (a load, an import, another tab's write); `kept`
 * keeps it as it is, after a change made in this app, where the fight's one writer is its reducer (combat.js `send`, held
 * by tests/lint.test.ts), whose answer is a `Fight` by its type. Reading it again there cost a phone at 4x CPU about 2 ms
 * of every fight command's tap.
 */
export type FightRepair = 'read' | 'kept';
/** What the store runs after every mutation. In place: returns the save it was given. Running it twice changes nothing more. */
export function repairSave(save: Save, env: ParseEnv, fight: FightRepair = 'read'): Save {
  return repair(save, env, fight);
}

/** The daily quest of the rules, for a new hunter. */
export function dailyQuest(id: QuestId, R: Rules, env: Pick<ParseEnv, 'now'>): Quest {
  const t = R.dailyTemplate;
  const copy: Pick<Quest, 'objectives' | 'rewards'> = JSON.parse(JSON.stringify({ objectives: t.objectives, rewards: t.rewards }));
  return { ...newQuest(), title: t.title, desc: t.desc || '', ...copy, id, kind: 'daily', issuedAt: env.now.toISOString(), from: 'system' };
}
/** A new level 1 hunter with the rules' daily quest, taking its hunter and quest ids from `save.seq` without mutating `save`. */
export function makeHunter(save: Pick<Save, 'seq' | 'settings'>, name: string, R: Rules, now: Date): { hunter: Hunter; seq: number } {
  const seq = save.seq + 2;
  const base = newHunter(R);
  const hunter: Hunter = {
    ...base,
    id: saveId('h', save.seq + 1),
    name: String(name).slice(0, 60) || 'Hunter',
    quests: [dailyQuest(saveId('q', seq), R, { now })],
    daily: { ...base.daily, lastCheckedKey: dayKey(now, save.settings.dailyResetHour) },
  };
  return { hunter, seq };
}
/** Pure step that adds a new level 1 hunter (with its daily quest) to `save`, sets it active, and advances `save.seq`. */
export function createHunter(save: Save, name: string, R: Rules, now: Date): { save: Save; hunter: Hunter } {
  const { hunter, seq } = makeHunter(save, name, R, now);
  return {
    save: { ...save, seq, hunters: [...save.hunters, hunter], settings: { ...save.settings, activeHunterId: hunter.id } },
    hunter,
  };
}
/** The built-in skills and items Sung Jin-Woo starts with (src/core/registry/skills.ts and items.ts), by name. */
const STARTER_SKILL_NAMES: readonly string[] = ['Sprint', 'Bloodlust'];
const STARTER_ITEM_NAMES: readonly string[] = ["Kasaka's Venom Fang", 'Health Potion (E)'];
/** The hunter a new profile starts with: base stats and the creation points unspent. Takes its ids from `save.seq`. */
export function starterHunter(save: Save, env: ParseEnv): Hunter {
  const R = rulesOf(save.rulesOverrides, save.library.statuses);
  const next = <P extends string>(prefix: P): IdOf<P> => saveId(prefix, ++save.seq);
  const nowIso = env.now.toISOString();
  const h = newHunter(R);
  h.seed = true;
  h.name = 'Sung Jin-Woo';
  const wolf = BASE_RULES.titles[0];
  if (wolf) { const id = saveId('t', 1); h.titles = [{ id, name: wolf.name, desc: wolf.desc, bonus: {}, seedKey: wolf.key }]; h.titleId = id; }
  h.quests = [
    dailyQuest(next('q'), R, env),
    { ...newQuest(), id: next('q'), title: 'Clear the E-rank gate outside the city', rewards: { ...newRewards(), xp: 150 }, issuedAt: nowIso },
  ];
  h.skills = SKILL_SEEDS.filter(d => STARTER_SKILL_NAMES.includes(d.name)).map((d): Skill => ({ ...skillOf(d, R), id: next('s') }));
  h.items = [...LOOT_ITEMS, ...SHOP_ITEMS].filter(d => STARTER_ITEM_NAMES.includes(d.name)).map((d): HeldItem => ({ kind: 'ref', id: next('i'), defId: d.defId, qty: 1 }));
  h.daily.lastCheckedKey = dayKey(env.now, save.settings.dailyResetHour);
  return h;
}
/** A new profile: an empty campaign, which the repair gives the starter hunter. */
export function freshSave(env: ParseEnv, options: { onboarded: boolean }): Save {
  const save = repair({}, env);
  save.settings.onboarded = options.onboarded;
  return save;
}
