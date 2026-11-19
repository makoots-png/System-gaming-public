// save.ts: what a save is. The types, the default of every entity and the parser at the boundary. A save from before
// schema 4 (the new combat rules) is not read: `loadSave` keeps its text for the backups and opens a new campaign.
// Pure: the caller passes the clock and the device id maker in `ParseEnv`.
// A change to the shape of a save is made here and in tests/save.test.ts.
import { parseFeats } from './hunter/feats.ts';
import type { FeatDef } from './hunter/feats.ts';
import { STATUS_KEY_RE } from './combat/effect-ops.ts';
import type { SheetStatus, StatusDef } from './combat/effect-ops.ts';
import { parseFight, parseSheetStatus, parseStatusDef } from './combat/fight-parse.ts';
import { MAX_STATUSES } from './combat/fight-types.ts';
import type { Fight } from './combat/fight-types.ts';
import { monsterId, newGate, parseGate, parseGateId } from './gates/gate.ts';
import type { Gate, GateMonster, GateStatus, GateType } from './gates/gate.ts';
import { parseApplied, parseHeld } from './applied.ts';
import { parseOutbox } from './sync/outbox.ts';
import type { Outbox } from './sync/outbox.ts';
import type { RoomEvent } from './protocol.ts';
import { ITEM_TYPES, LOOT_ITEMS, RARITIES, SHOP_ITEMS, SLOTS, itemOf, parseItem } from './registry/items.ts';
import { ARCHETYPE_LIST, parseMonster } from './registry/monsters.ts';
import { SKILL_SEEDS, SKILL_TYPES, parseSkill, skillOf } from './registry/skills.ts';
import type { SkillType } from './registry/skills.ts';
import type { ItemTemplate, ItemType, Rarity, Slot } from './registry/items.ts';
import type { Skill } from './registry/skills.ts';
import type { Item } from './registry/items.ts';
import type { Loot, Monster, StartStatus } from './registry/monsters.ts';
import { MAX_MAPS, parseBattleMap } from './registry/maps.ts';
import type { BattleMap } from './registry/maps.ts';
import { parseStory } from './story/story.ts';
import type { Story } from './story/story.ts';
import type { Archetype } from './hunter/derive.ts';
import { oneOf } from './one-of.ts';
import { parseCoins } from './coin.ts';
import { parseCheck, parseRollKind } from './roll.ts';
import type { Check, RollKind } from './roll.ts';
import type { Coin } from './coin.ts';
import { STAT_KEYS, baseStats, statsBy } from './stats.ts';
import type { StatKey, Stats } from './stats.ts';
import { PERK_KEYS, RANKS } from './rules.ts';
import type { Perk, Rank } from './rules.ts';
/** The ranks, and a rank: src/core/rules.ts. */
export { RANKS };
export type { Rank };
import { REWARD_BOUNDS, newRewards, parseBundle, parseRewards } from './rewards.ts';
import type { RewardBundle, Rewards } from './rewards.ts';
import { MAX_LEVEL, newProgress, pendingTotal } from './hunter/progress.ts';
import type { Pending, Progress } from './hunter/progress.ts';
import { newVitals, parseLife, parseUsed } from './hunter/vitals.ts';
import { hunterSheet } from './hunter/sheet.ts';
import { isStateChip } from './hunter/chips.ts';
import { parsePenalty } from './hunter/penalty.ts';
import { newSolo, parseSolo } from './gates/personal.ts';
import { newChronicle, parseChronicle } from './hunter/chronicle.ts';
import type { Chronicle } from './hunter/chronicle.ts';
import type { Solo } from './gates/personal.ts';
import { parseRuns } from './gates/solo-wait.ts';
import type { WaitingRun } from './gates/solo-wait.ts';
import type { Penalty } from './hunter/penalty.ts';
import { parseJobChain } from './hunter/job-chain.ts';
import type { JobChain } from './hunter/job-chain.ts';
import type { Life, Vitals } from './hunter/vitals.ts';
import { parseCombatantId, parseDeviceId, parseGmKey, parseRoomCode, parseSaveId, SAVE_ID_RE, saveId, titleKey } from './ids.ts';
import type { BoonId, ChainId, CombatantId, DeviceId, EventId, GateId, GmKey, HunterId, IdOf, ItemId, LoadoutId, LogId, MonsterId, QuestId, RollEntryId, ShadowId, TitleId } from './ids.ts';
import type { RoomCode } from './ids.ts';
import { EMBLEMS, HUNTER_COLORS, RULES as BASE_RULES, pathOf, rulesOf } from './rules.ts';
import { parseOverrides } from './overrides.ts';
import { dayKey, parseDayKey, timeOf } from './day.ts';
import type { DayKey } from './day.ts';
import type { Rules } from './rules.ts';
export { rulesOf };
export type { Rules };
/** A gate, its statuses and its default: src/core/gates/gate.ts. Only its transition table changes a gate's status or XP paid. */
export type { Gate, GateMonster, GateStatus, GateType };

// ── enums ──
export const MODES = ['player', 'gm'] as const;
export const QUEST_KINDS = ['daily', 'main', 'side', 'job', 'urgent', 'penalty'] as const;
export const QUEST_STATUSES = ['active', 'done', 'failed'] as const;
export const QUEST_SOURCES = ['gm', 'system', 'self'] as const;
/** The skill enum and the one skill parser: src/core/registry/skills.ts. */
export { SKILL_TYPES };
export type { SkillType };
/** The item enums and the one item parser: src/core/registry/items.ts. */
export { ITEM_TYPES, RARITIES, SLOTS };
export type { ItemTemplate, ItemType, Rarity, Slot };
/** A skill, an item and a monster live in the registry that owns each (src/core/registry/). */
export type { Item, Loot, Monster, Skill, StartStatus };
export const SHADOW_GRADES = ['Normal', 'Elite', 'Knight', 'Elite Knight', 'Commander', 'Marshal'] as const;
export const LOG_KINDS = ['system', 'award', 'quest', 'gate', 'combat', 'rank', 'use'] as const;

export type Mode = (typeof MODES)[number];
export type QuestKind = (typeof QUEST_KINDS)[number];
export type QuestStatus = (typeof QUEST_STATUSES)[number];
export type QuestSource = (typeof QUEST_SOURCES)[number];
export type ShadowGrade = (typeof SHADOW_GRADES)[number];
export type LogKind = (typeof LOG_KINDS)[number];

// ── entities. A `?` field is one a view adds and removes as it goes, so it has no default. ──
/** A status on a hunter: its def, who applied it and the rounds left (src/core/combat/effect-ops.ts `SheetStatus`). */
export type Condition = SheetStatus;
export type { StatusDef };

export type Objective = { label: string; target: number; progress: number };
/** What a reward may hold and its one reader: src/core/rewards.ts. */
export { newRewards };
export type { RewardBundle, Rewards };
/** An active quest has not ended; a done or failed one has the time it ended. A view sets both with `questState`. */
export type QuestState = { status: 'active'; doneAt: null } | { status: Exclude<QuestStatus, 'active'>; doneAt: string };
export const questState = (status: QuestStatus, at: string): QuestState => (status === 'active' ? { status, doneAt: null } : { status, doneAt: at });
export type Quest = QuestState & {
  id: QuestId; kind: QuestKind; title: string; desc: string; objectives: Objective[]; rewards: Rewards;
  issuedAt: string; dueAt: string | null; from: QuestSource; penaltyText: string;
  /** On a Job Change step's quest: the id of the chain that issued it (src/core/hunter/job-chain.ts). A back-reference only. */
  chainId?: ChainId;
};
export type Loadout = { id: LoadoutId; name: string; slots: Partial<Record<Slot, ItemId>> };
/**
 * A title a hunter holds. `bonus`: while it is the active one, the eight stats, `hpMax` and `manaMax` (`PERK_KEYS`).
 * `seedKey`: the key of the rule title it was given from (src/core/hunter/record.ts `giveTitle`), kept through a rename.
 */
export type Title = { id: TitleId; name: string; desc: string; bonus: Perk; seedKey?: string };
/** A text reward the GM honours at the table, held until the player redeems it. `at`: when it was given. */
export type Boon = { id: BoonId; name: string; text: string; at: string };
/**
 * A shadow a hunter keeps. Its body is a monster's at its rank and archetype, of the kind its grade gives
 * (src/core/combat/rows.ts `SHADOW_KINDS`), so its max HP is worked out, not stored. `hp`: its HP now.
 */
export type Shadow = {
  id: ShadowId; name: string; monster: string | null; rank: Rank; archetype: Archetype; grade: ShadowGrade; hp: number; summoned: boolean;
  notes: string;
};
export type Daily = { streak: number; lastCompleteKey: DayKey | null; lastCheckedKey: DayKey | null };
export type Build = { path: string | null; picks: (0 | 1)[] };
/** Level, XP, peak level and ability points: src/core/hunter/progress.ts. Only its functions change them. */
export type { Progress };
/** Life (HP, dying, stable, dead), mana, fatigue and collapse: src/core/hunter/vitals.ts. Only its functions change them. */
export type { Life, Vitals };
/** The daily penalty, tied to its Penalty Zone quest: src/core/hunter/penalty.ts. Only its functions change it. */
export type { Penalty };
/** The Job Change chain, tied to its open step's quest: src/core/hunter/job-chain.ts. Only its functions change it. */
export type { JobChain };
/**
 * A hunter. Its sheet (max HP, mana, speed, armor and the rest) is worked out from these fields by
 * src/core/hunter/sheet.ts `hunterSheet`. `hpAdj` and `manaAdj` are the GM's edits of max HP and max mana.
 */
export type Hunter = Progress & Vitals & {
  id: HunterId; name: string; /** The hunter's job, or null for none. */ job: string | null; rank: Rank; gold: number; stats: Stats;
  hpAdj: number; manaAdj: number; conditions: Condition[];
  titleId: TitleId | null; titles: Title[]; quests: Quest[]; skills: Skill[]; items: Item[]; equipped: Record<Slot, ItemId | null>;
  shadows: Shadow[]; daily: Daily; penalty: Penalty | null; jobChain: JobChain | null; notes: string; updatedAt: string;
  emblem: string; color: string; loadouts: Loadout[]; build: Build; boons: Boon[];
  /** Its personal gates, the System's, and their clock: src/core/gates/personal.ts and solo.ts. Only their functions change them. */
  solo: Solo;
  /** What the System remembers of it (its facts, kept and waiting, and its lifetime numbers): src/core/hunter/chronicle.ts. Only `record` and `noticed` change it. */
  chronicle: Chronicle;
  /** The hunter a new install starts with (`starterHunter`), until first-run setup replaces it or makes it the player's (src/core/starter.ts). */
  seed?: true;
};

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
export type SyncSettings = {
  room: RoomCode | null; cursor: number; serverOk: boolean;
  /** The GM key of `room`, and this phone's GM keys by room code. */
  gmKey?: GmKey | null; gmKeys?: Record<string, GmKey>; lastRoom?: LastRoom | null; boundHunterId?: HunterId;
  /** This phone's secret for the sheets it writes (the server keeps only its hash). Made at load beside `deviceId`. */
  deviceToken: string;
  joinedAt?: string;
  /** What this phone still owes the room: room events and tombstones, each with its state (src/core/sync/outbox.ts). */
  outbox?: Outbox;
  /** Room events this phone could not apply yet, tried again after each good poll (src/core/applied.ts `hold`). */
  held?: RoomEvent[];
  /** Ids of the room events that changed a hunter on this phone, newest last (src/core/applied.ts). */
  applied?: EventId[];
  /** A player's won runs of a room's solo gates until the GM's phone answers each (src/core/gates/solo-wait.ts). */
  runs?: WaitingRun[];
};
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
export type Library = { items: Item[]; statuses: Record<string, StatusDef>; skills: Skill[]; rewards: RewardBundle[]; maps: BattleMap[]; feats: Record<string, FeatDef>; stories: Story[] };
export type Save = {
  schema: number; savedAt: string; seq: number; settings: Settings; rulesOverrides: Record<string, unknown>; world: World;
  hunters: Hunter[]; gates: Gate[]; monsters: Monster[]; library: Library;
  /** The GM's own shop, made from the built-in one at its first edit; null shows the built-in shop. */
  shop: ItemTemplate[] | null;
  fight: Fight | null; log: LogEntry[]; rolls: RollEntry[];
  /**
   * What the last fight's defeated monsters dropped and the GM has not given or set aside yet (pay.ts `settleEncounter`
   * keeps it; the Award form's send or the GM's Set aside clears it, `dropDealt`), so a reload keeps the offer. Null: none.
   */
  dropped: Dropped | null;
  /** What the fight came from, which the fight itself does not hold. Written only by src/views/combat.js. */
  fightRefs?: FightRefs;
  /** The bestiary's record of defeated monsters by `name|rank`, and the combatant ids already counted (the newest `CODEX_SEEN_MAX`). */
  codex: Record<string, CodexEntry>; codexSeen: CombatantId[];
  /**
   * The coin calls (src/core/coin.ts), written only by src/views/coin.js. `coins`: the coins this phone's hunters called.
   * `calls`: on the GM's phone, the calls players sent. Nothing in either says how a coin's side was chosen.
   */
  coins: readonly Coin[]; calls: readonly Coin[];
};
/** A monster kind this campaign has defeated. `room`: copied from the GM's codex doc, with the numbers it carried in `info`. */
export type CodexEntry = { name: string; rank: Rank; kills: number; firstAt: string; lastAt: string; monsterId: MonsterId | null; room?: true; info?: CodexInfo };
/** What the GM's codex doc tells a player about a defeated monster: its sheet's max HP, armor, resist and speed, and up to 4 ability names. */
export type CodexInfo = { hpMax: number; armor: number; resist: number; speed: number; abilities: string[] };
export const CODEX_SEEN_MAX = 400;

// ── defaults. Each factory is typed by its entity, so a field added to a type without a default does not compile. ──
/** 4: the new combat rules (eight stats, mana, gear weight). A save of an older schema is not read. */
export const SCHEMA = 4;
/** A fight's drop: its gold and its items, as a monster's loot holds them (registry/monsters.ts `Loot`). */
export type Dropped = { gold: number; items: ItemTemplate[] };

/** Bounds for junk or hostile saves only. GM rules (loadoutCap, path tiers) never prune saved data. */
export const LIMITS = { loadouts: 24, picks: 12, libraryItems: 200, libraryStatuses: 200, librarySkills: 200, libraryRewards: 200, libraryMaps: MAX_MAPS, libraryFeats: 100, libraryStories: 30, boons: 50 } as const;

export const newStats = (R: Rules = BASE_RULES): Stats => ({ ...baseStats(R.fight) });
export const newEquipped = (): Record<Slot, ItemId | null> => ({
  weapon: null, offhand: null, head: null, chest: null, hands: null, legs: null, feet: null, neck: null, ring1: null, ring2: null,
});
export const newSyncSettings = (): SyncSettings => ({ room: null, cursor: 0, serverOk: false, deviceToken: '' });
export const newSettings = (deviceId: DeviceId): Settings => ({
  mode: 'player', activeHunterId: saveId('h', 1), dailyResetHour: 0, onboarded: true, sound: false, deviceId, sync: newSyncSettings(),
});
export const newWorld = (): World => ({ day: 1, lastDailyKey: null, session: 0 });
export const newQuest = (): Quest => ({
  id: saveId('q', 0), kind: 'side', title: '', desc: '', objectives: [], rewards: newRewards(), status: 'active', issuedAt: '', doneAt: null,
  dueAt: null, from: 'self', penaltyText: '',
});
export const newLoadout = (): Loadout => ({ id: saveId('lo', 0), name: '', slots: {} });
export const newTitle = (): Title => ({ id: saveId('t', 0), name: '', desc: '', bonus: {} });
export const newBoon = (): Boon => ({ id: saveId('bn', 0), name: '', text: '', at: '' });
export const newShadow = (): Shadow => ({
  id: saveId('sh', 0), name: '', monster: null, rank: 'E', archetype: 'brute', grade: 'Normal', hp: 1, summoned: false, notes: '',
});
/** A level 1 hunter with the rules' base stats and its creation points unspent, up at the full HP and mana its sheet gives. */
export const newHunter = (R: Rules = BASE_RULES): Hunter => {
  const stats = newStats(R);
  const h: Hunter = {
    ...newProgress(), ...newVitals({ hpMax: 1, manaMax: 0, fatigueMax: 0 }), id: saveId('h', 1), name: 'Hunter', job: null, rank: 'E',
    gold: 0, stats, hpAdj: 0, manaAdj: 0, conditions: [], titleId: null, titles: [],
    quests: [], skills: [], items: [], equipped: newEquipped(), shadows: [],
    daily: { streak: 0, lastCompleteKey: null, lastCheckedKey: null }, penalty: null, jobChain: null, notes: '', updatedAt: '',
    emblem: '', color: '', loadouts: [], build: { path: null, picks: [] }, boons: [], solo: newSolo(), chronicle: newChronicle(),
  };
  return Object.assign(h, newVitals(hunterSheet(h, R).sheet));
};
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
  monsters: [], library: { items: [], statuses: {}, skills: [], rewards: [], maps: [], feats: {}, stories: [] }, shop: null, fight: null, dropped: null, log: [], rolls: [], codex: {}, codexSeen: [], coins: [], calls: [],
});

// ── parser ──
// How a save is repaired: each object is filled by its default ("fill by example": a missing or wrongly typed field
// takes the default's value) and then the typed fields are clamped and checked. Keys the types do not know are kept
// as they are, because the untyped view modules still stash fields of their own on these objects and dropping them
// would lose that data. The repair works in place and returns the object it was given: views hold on to a hunter
// between updates, so the object must stay the same one.

/** What a read needs from outside: the clock, and the makers of this phone's device id and device token (random, the edge's). */
export type ParseEnv = { now: Date; newDeviceId: () => DeviceId; newDeviceToken: () => string };

export type Parsed =
  /**
   * A save of this schema. `fightLost`: it held a fight the fight's parser did not read as one (a damaged fight), so the
   * repair dropped it; a load tells the player (`loadSave`). A fight a lowered rule made past its maxima still reads (V13).
   */
  | { kind: 'save'; save: Save; fightLost: boolean }
  /** Written by a newer app: the edge opens it read-only. */
  | { kind: 'newer'; schema: number; save: Save }
  /**
   * Written before the new combat rules (schema 1 to 3): not read, so nothing of it is carried over. `serverOk`: it says
   * this host has a room server, a fact about the host that the update does not change.
   */
  | { kind: 'old'; serverOk: boolean }
  | { kind: 'invalid'; reason: 'not-json' | 'not-an-object' | 'not-a-save' };

type Rec = Record<string, unknown>;
const ID_RE = SAVE_ID_RE;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : fallback;
}
const int = (v: unknown, fallback: number, lo?: number, hi?: number): number => Math.round(num(v, fallback, lo, hi));
const str = <D extends string | null>(v: unknown, fallback: D, max = 500): string | D => (isStr(v) ? v.slice(0, max) : fallback);
const strOrNull = (v: unknown): string | null => (isStr(v) ? v : null);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);

/**
 * A job as a hunter holds it: the name (spaces cleaned, at most 60 characters), or null for none, a blank or the old
 * default word "None". "No job" is null, never a word a view compares with (implicit audit 3, H9).
 */
export const jobOf = (v: unknown): string | null => { const j = String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, 60); return j && j !== 'None' ? j : null; };

function fillValue(v: unknown, example: unknown): unknown {
  if (typeof example === 'number') return isNum(v) ? v : example;
  if (typeof example === 'string') return isStr(v) ? v.slice(0, 500) : example;
  if (typeof example === 'boolean') return isBool(v) ? v : example;
  if (example === null) return v === undefined ? null : v;
  if (Array.isArray(example)) return Array.isArray(v) ? v : example;
  return isObj(v) ? fill(v, example as Rec) : example;
}
/**
 * Fills `o` in place from a fresh default and returns it as that type. After it, every number, string, boolean,
 * array and object field of the default has that kind of value. Enums, nullable fields and list entries are not
 * checked yet: the caller does that next.
 */
function fill<T extends object>(o: Rec, example: T): T {
  for (const [key, value] of Object.entries(example)) o[key] = fillValue(o[key], value);
  return o as T;
}
/** Removes an optional field whose value is not of its type. */
function optional<T extends object>(o: T, key: keyof T & string, ok: (v: unknown) => boolean): void {
  if (key in o && !ok(o[key])) delete o[key];
}

/**
 * One repair run: the save's rules, and every id seen so far with the entities whose id must be replaced. `sheet` is a
 * hunter another phone sent: its build path is checked against that phone's rules, which this run does not have.
 */
type Run = { R: Rules; env: ParseEnv; ids: Set<string>; bad: [{ id: string }, string][]; sheet?: true };

/** A list of entities: drops what is not an object, fills defaults, and notes a missing or repeated id for a new one. */
function list<T extends { id: string }>(run: Run, value: unknown, prefix: string, example: () => T, fix?: (o: T) => void): T[] {
  return (Array.isArray(value) ? value : []).filter(isObj).map(raw => {
    const o = fill(raw, example());
    if (fix) fix(o);
    claimId(run, o, prefix);
    return o;
  });
}
/** Keeps a good id, or notes a malformed or repeated one for a new id. */
function claimId(run: Run, o: { id: string }, prefix: string): void {
  if (!ID_RE.test(o.id) || idNumber(o.id) > SEQ_MAX || run.ids.has(o.id)) run.bad.push([o, prefix]); else run.ids.add(o.id);
}
/** Gates come from their own parser, which builds new objects with only the fields a gate has. One without an id takes the default's. */
function gates(run: Run, value: unknown): Gate[] {
  return (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => {
    const g = parseGate(raw) ?? parseGate({ ...raw, id: newGate().id });
    if (!g) return [];
    claimId(run, g, 'g');
    return [g];
  });
}
/** A title's bonus keeps only a perk key (`PERK_KEYS`) with a finite number. */
function fixBonus(bonus: Rec): void {
  for (const key of Object.keys(bonus)) if (!(PERK_KEYS as readonly string[]).includes(key) || !isNum(bonus[key])) delete bonus[key];
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
      };
    }
    out[key] = e;
  }
  return out;
}
/**
 * Empties `raw` and fills it with `t` and an id (its own, else `defaultId`), noting a bad id for a new one. The object
 * stays the same one, because a view may hold it between updates.
 */
function refill<T extends { id: string }>(run: Run, raw: Rec, t: Omit<T, 'id'>, defaultId: string, prefix: string): T {
  const id = isStr(raw.id) ? raw.id : defaultId;
  for (const key of Object.keys(raw)) delete raw[key];
  const o = Object.assign(raw, t, { id }) as unknown as T;
  claimId(run, o, prefix);
  return o;
}
/** Saved items, each read by `parseItem`; one it refuses (no name) is dropped, one without an id takes the default's. */
const items = (run: Run, value: unknown): Item[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseItem(raw); return t ? [refill<Item>(run, raw, t, 'i0', 'i')] : []; });
/** The GM's monsters, each read by `parseMonster`; one without an id takes the default's. */
const monsters = (run: Run, value: unknown): Monster[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseMonster(raw); return t ? [refill<Monster>(run, raw, t, 'm0', 'm')] : []; });
/** Saved skills, each read by `parseSkill`; one it refuses (no name) is dropped, one without an id takes the default's. */
const skills = (run: Run, value: unknown): Skill[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseSkill(raw); return t ? [refill<Skill>(run, raw, t, 's0', 's')] : []; });
/** The GM's reward bundles, each read by `parseBundle`; one without a name is dropped, one without an id takes the default's. */
const bundles = (run: Run, value: unknown): RewardBundle[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseBundle(raw); return t ? [refill<RewardBundle>(run, raw, t, 'rb0', 'rb')] : []; });
/** The GM's battle maps, each read by `parseBattleMap`; one without a name is dropped, one without an id takes the default's. */
const maps = (run: Run, value: unknown): BattleMap[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseBattleMap(raw, run.R); return t ? [refill<BattleMap>(run, raw, t, 'mp0', 'mp')] : []; });
/** The GM's stories, each read by `parseStory`; one without a name or a chapter is dropped, one without an id takes the default's. */
const stories = (run: Run, value: unknown): Story[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseStory(raw); return t ? [refill<Story>(run, raw, t, 'st0', 'st')] : []; });
/** Items without ids (the shop): each read by `parseItem`, one it refuses dropped. */
const templates = (value: unknown): ItemTemplate[] => (Array.isArray(value) ? value : []).flatMap(raw => parseItem(raw) ?? []);
/** A stored drop: its gold a whole number from 0, its items each read by `parseItem`; null when it holds nothing. */
function droppedOf(v: unknown): Dropped | null {
  if (!isObj(v)) return null;
  const gold = typeof v.gold === 'number' && Number.isFinite(v.gold) ? Math.max(0, Math.floor(v.gold)) : 0, items = templates(v.items);
  return gold || items.length ? { gold, items } : null;
}
/** A hunter's conditions, each read by `parseSheetStatus`; one that does not read, or a chip the hunter's state draws, is dropped. At most `MAX_STATUSES`, as on a fight row. */
const conditions = (R: Rules, value: unknown[]): Condition[] =>
  value.flatMap(c => parseSheetStatus(c, R) ?? []).filter(c => !isStateChip(c.key)).slice(0, MAX_STATUSES);

/**
 * The GM's statuses: at most `LIMITS.libraryStatuses`, each under a key `STATUS_KEY_RE` accepts that is not a chip a
 * hunter's state draws, each def read by `parseStatusDef`. An entry that fails any of these is dropped.
 */
function statusLibrary(value: Rec): Record<string, StatusDef> {
  const out: Record<string, StatusDef> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (Object.keys(out).length >= LIMITS.libraryStatuses) break;
    if (!STATUS_KEY_RE.test(key) || isStateChip(key)) continue;
    const def = parseStatusDef(raw, BASE_RULES);
    if (def) out[key] = def;
  }
  return out;
}
/** Bound for junk only: the GM's max HP edit stops at 9999, and a level 9999 hunter's HP is far below this. */
const VITAL_MAX = 1e9;
/** Bound for junk only: a level holds `pointsPerLevel` points, 3 by default, so MAX_LEVEL holds 30,006 with the creation points. */
const POINTS_MAX = 1e6;
/**
 * Life, mana, fatigue, collapse and the uses spent this rest, within bounds for junk only: the maxima come from the sheet,
 * and a GM's rule change never prunes a hunter. A life that does not read is up at the full HP of the hunter's sheet, so
 * this runs last. A `used` that does not read is none spent (`parseUsed`).
 */
function fixVitals(h: Hunter, R: Rules): void {
  h.life = parseLife(h.life, VITAL_MAX) ?? newVitals(hunterSheet(h, R).sheet).life;
  h.mana = int(h.mana, 0, 0, VITAL_MAX); h.fatigue = int(h.fatigue, 0, 0, VITAL_MAX);
  h.used = parseUsed(h.used, R);
}

/** The default a stored hunter is filled from. */
const hunterExample = (R: Rules): Hunter => newHunter(R);
function fixHunter(run: Run, h: Hunter): void {
  const { R } = run;
  h.name = h.name.slice(0, 60) || 'Hunter'; h.job = jobOf(h.job);
  h.rank = oneOf(h.rank, RANKS, 'E');
  h.level = int(h.level, 1, 1, MAX_LEVEL); h.xp = Math.max(0, h.xp); h.gold = Math.max(0, h.gold);
  h.peakLevel = int(h.peakLevel, h.level, h.level, MAX_LEVEL);
  h.bonusPoints = int(h.bonusPoints, 0, -POINTS_MAX, POINTS_MAX); h.spent = int(h.spent, 0, 0, POINTS_MAX);
  h.hpAdj = int(h.hpAdj, 0, -VITAL_MAX, VITAL_MAX); h.manaAdj = int(h.manaAdj, 0, -VITAL_MAX, VITAL_MAX);
  // A missing stat takes the rules' base. A pending count is a whole number of 1 or more, else none is pending.
  // One way: a hunter stored with `statsLocked` (the confirmed stats, beside stats that held the pending points too, and
  // `spent` that counted them) keeps its unconfirmed points as pending, and they leave `spent` (progress.ts header).
  const old = h as Hunter & { statsLocked?: unknown };
  const locked: Rec | null = isObj(old.statsLocked) ? old.statsLocked : null;
  delete old.statsLocked;
  const stored: Rec = isObj(h.pending) ? h.pending : {};
  const pending: Pending = {};
  const raw: Rec = isObj(h.stats) ? h.stats : {}, read = statsBy(k => int(raw[k], R.fight.statBase, 0, POINTS_MAX));
  for (const k of STAT_KEYS) {
    const was = locked ? locked[k] : undefined;
    const n = locked ? (isNum(was) ? read[k] - Math.max(0, Math.round(was)) : 0) : int(stored[k], 0, 0, POINTS_MAX);
    if (n >= 1) pending[k] = n;
  }
  h.stats = { ...raw, ...(locked ? statsBy(k => read[k] - (pending[k] ?? 0)) : read) }; // keys the types do not know are kept, as everywhere in the repair
  h.pending = pending;
  if (locked) h.spent = Math.max(0, h.spent - pendingTotal(h));
  h.conditions = conditions(R, h.conditions);
  h.titles = list(run, h.titles, 't', newTitle, t => { t.name = t.name.slice(0, 60); fixBonus(t.bonus); if (t.seedKey !== undefined && !titleKey(t.seedKey)) delete t.seedKey; });
  if (h.titleId !== null && !h.titles.some(t => t.id === h.titleId)) h.titleId = null;
  optional(h, 'seed', v => v === true);
  // A boon without a name is dropped; past the cap the oldest go (a new boon is added last).
  h.boons = list(run, h.boons, 'bn', newBoon, b => {
    b.name = b.name.trim().slice(0, REWARD_BOUNDS.boonName); b.text = b.text.slice(0, REWARD_BOUNDS.boonText); b.at = b.at.slice(0, 40);
  }).filter(b => b.name).slice(-LIMITS.boons);
  h.quests = list(run, h.quests, 'q', newQuest, q => {
    q.penaltyText = q.penaltyText.slice(0, 300); q.title = q.title.slice(0, 120);
    q.kind = oneOf(q.kind, QUEST_KINDS, 'side'); q.from = oneOf(q.from, QUEST_SOURCES, 'self');
    q.objectives = q.objectives.filter(isObj).map(o => ({ ...o, label: str(o.label, '', 120), target: num(o.target, 1), progress: num(o.progress, 0) }));
    q.rewards = parseRewards(q.rewards) ?? newRewards();
    Object.assign(q, questState(oneOf(q.status, QUEST_STATUSES, 'active'), strOrNull(q.doneAt) ?? q.issuedAt)); q.dueAt = timeOf(q.dueAt);
    optional(q, 'chainId', isStr);
  });
  // A save from before the chain had its own field kept it on the quests as `step` and `chainJob`: read once, then dropped.
  h.jobChain = parseJobChain(h.jobChain, h.quests);
  for (const q of h.quests) { delete (q as Rec).step; delete (q as Rec).chainJob; }
  h.skills = skills(run, h.skills);
  h.items = items(run, h.items);
  for (const slot of SLOTS) if (!h.items.some(i => i.id === h.equipped[slot])) h.equipped[slot] = null;
  h.shadows = list(run, h.shadows, 'sh', newShadow, x => {
    x.name = x.name.slice(0, 60); x.rank = oneOf(x.rank, RANKS, 'E'); x.grade = oneOf(x.grade, SHADOW_GRADES, 'Normal');
    x.archetype = oneOf(x.archetype, ARCHETYPE_LIST, 'brute'); x.hp = int(x.hp, 1, 0, VITAL_MAX); x.monster = strOrNull(x.monster);
  });
  const d = h.daily;
  d.lastCompleteKey = parseDayKey(d.lastCompleteKey); d.lastCheckedKey = parseDayKey(d.lastCheckedKey);
  d.streak = Math.max(0, d.streak);
  h.penalty = parsePenalty(h.penalty, h.quests, run.env.now.toISOString());
  h.solo = parseSolo(h.solo);
  h.chronicle = parseChronicle(h.chronicle);
  // Looks: an unknown emblem or color means "automatic". A loadout slot keeps only a real item, each item once (the
  // fit is checked at swap time). The build path must exist. A lowered loadoutCap or fewer tiers keep the data.
  if (!Object.hasOwn(EMBLEMS, h.emblem)) h.emblem = '';
  if (!HUNTER_COLORS.includes(h.color)) h.color = '';
  h.loadouts = list(run, h.loadouts, 'lo', newLoadout, l => {
    l.name = l.name.replace(/\s+/g, ' ').trim().slice(0, 24) || 'Set';
    const slots: Loadout['slots'] = {}; const used = new Set<string>();
    for (const slot of SLOTS) {
      const item = h.items.find(i => i.id === l.slots[slot]);
      if (item && !used.has(item.id)) { slots[slot] = item.id; used.add(item.id); }
    }
    l.slots = slots;
  }).slice(0, LIMITS.loadouts);
  const b = h.build;
  if (run.sheet ? !isStr(b.path) : !pathOf(R, b.path)) b.path = null;
  if (run.sheet && b.path !== null) b.path = b.path.slice(0, 40);
  const cut = b.picks.findIndex(x => x !== 0 && x !== 1);
  if (cut >= 0) b.picks.length = cut;
  b.picks.length = Math.min(b.picks.length, b.path ? LIMITS.picks : 0);
  fixVitals(h, R);
}

function fixSync(sync: SyncSettings): void {
  sync.room = parseRoomCode(sync.room);
  optional(sync, 'gmKey', v => v === null || parseGmKey(v) !== null);
  if ('gmKeys' in sync) {
    const keys: unknown = sync.gmKeys;
    if (!isObj(keys)) delete sync.gmKeys;
    else for (const code of Object.keys(keys)) if (!parseRoomCode(code) || !parseGmKey(keys[code])) delete keys[code];
  }
  if ('lastRoom' in sync) {
    const last: unknown = sync.lastRoom;
    const code = isObj(last) ? parseRoomCode(last.code) : null;
    if (isObj(last) && code) sync.lastRoom = { code, why: LAST_WHY.includes(last.why as LastWhy) ? (last.why as LastWhy) : last.gone === true ? 'gone' : 'left' };
    else if (last !== null) delete sync.lastRoom;
  }
  optional(sync, 'boundHunterId', v => parseSaveId<'h'>(v) !== null); optional(sync, 'joinedAt', isStr);
  if ('outbox' in sync) sync.outbox = parseOutbox(sync.outbox);
  if ('held' in sync) sync.held = parseHeld(sync.held);
  if ('runs' in sync) sync.runs = parseRuns(sync.runs);
  if ('applied' in sync) {
    const ids: unknown = sync.applied;
    if (!Array.isArray(ids)) delete sync.applied;
    else sync.applied = parseApplied(ids);
  }
}

/** A device token shorter than this is not a secret: the load makes a new one. */
export const DEVICE_TOKEN_MIN = 16;

/** The largest number an id may end in. Above it `seq + 1` stops being exact, so such an id is replaced. */
const SEQ_MAX = 1e15;
const idNumber = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

/** The example save's device id: the repair makes one when the stored one does not read. */
const NO_DEVICE = '' as DeviceId;
/** Repairs a save-shaped object in place. */
function repair(s: Rec, env: ParseEnv, fight: FightRepair = 'read'): Save {
  const save = fill(s, newSave(NO_DEVICE));
  save.library.statuses = statusLibrary(save.library.statuses);
  // An override the rules do not have, or of the wrong type, is dropped here, so it never reaches `rulesOf`.
  save.rulesOverrides = parseOverrides(save.rulesOverrides).overrides;
  const R = rulesOf(save.rulesOverrides, save.library.statuses);
  const run: Run = { R, env, ids: new Set(), bad: [] };
  const st = save.settings;
  st.mode = oneOf(st.mode, MODES, 'player');
  st.dailyResetHour = int(st.dailyResetHour, 0, 0, 23);
  st.deviceId = parseDeviceId(st.deviceId) ?? env.newDeviceId();
  fixSync(st.sync);
  if (st.sync.deviceToken.length < DEVICE_TOKEN_MIN) st.sync.deviceToken = env.newDeviceToken();
  save.world.lastDailyKey = parseDayKey(save.world.lastDailyKey) ?? dayKey(env.now, st.dailyResetHour);
  save.world.day = int(save.world.day, 1, 1); save.world.session = int(save.world.session, 0, 0);
  save.savedAt = str(save.savedAt, '', 40);

  save.hunters = list(run, save.hunters, 'h', () => hunterExample(R), h => fixHunter(run, h));
  save.library.items = items(run, save.library.items.slice(0, LIMITS.libraryItems));
  save.library.skills = skills(run, save.library.skills.slice(0, LIMITS.librarySkills));
  save.library.rewards = bundles(run, save.library.rewards.slice(0, LIMITS.libraryRewards));
  save.library.maps = maps(run, save.library.maps.slice(0, LIMITS.libraryMaps));
  save.library.feats = parseFeats(save.library.feats, LIMITS.libraryFeats);
  save.library.stories = stories(run, save.library.stories.slice(0, LIMITS.libraryStories));
  save.gates = gates(run, save.gates);
  save.shop = Array.isArray(save.shop) ? templates(save.shop) : null;
  save.dropped = droppedOf(save.dropped);
  save.codex = codexOf(save.codex);
  save.codexSeen = save.codexSeen.flatMap(v => parseCombatantId(v) ?? []).slice(-CODEX_SEEN_MAX);
  save.coins = parseCoins(save.coins); save.calls = parseCoins(save.calls);
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

  // seq is at least the number every id ends in. Then each missing or repeated id gets the next one.
  let seq = int(save.seq, 100, 0, SEQ_MAX);
  for (const id of run.ids) seq = Math.max(seq, idNumber(id));
  save.seq = seq;
  for (const [o, prefix] of run.bad) o.id = prefix + (++save.seq);
  // A save holds a hunter: one read with none gets the starter here, so every view has an active one to read.
  if (!save.hunters.length) { const starter = starterHunter(save, env); fixHunter(run, starter); save.hunters.push(starter); }

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
 * save, so the caller must not use it again. A save of this schema holds a list of hunters, whatever else is damaged.
 * One with a list of hunters under another schema, or the first app's flat shape (stats, a name or quests), is from
 * before the new combat rules: `old`. Anything else is not a save.
 */
export function parseSaveValue(value: unknown, env: ParseEnv): Parsed {
  if (!isObj(value)) return { kind: 'invalid', reason: 'not-an-object' };
  const schema = value.schema;
  if (typeof schema === 'number' && schema > SCHEMA) return { kind: 'newer', schema, save: repair(value, env) };
  const old = { kind: 'old', serverOk: isObj(value.settings) && isObj(value.settings.sync) && value.settings.sync.serverOk === true } as const;
  if (!Array.isArray(value.hunters)) return isObj(value.stats) || 'name' in value || 'quests' in value ? old : { kind: 'invalid', reason: 'not-a-save' };
  if (schema !== SCHEMA) return old;
  const held = value.fight !== null && value.fight !== undefined, save = repair(value, env);
  return { kind: 'save', save, fightLost: held && save.fight === null };
}

/** What an imported file holds: one hunter (the Data view's "Export active hunter" writes `kind: 'hunter'`) or a campaign. */
export const fileKind = (save: Save): 'hunter' | 'campaign' => ((save as Save & { kind?: unknown }).kind === 'hunter' ? 'hunter' : 'campaign');

/**
 * A campaign as a file that leaves this phone (the Data view's Export): the save without this phone's identity, its
 * device id and its secret for the sheets it writes, and without its GM keys unless `withKeys`. Whoever opens the file is
 * a phone of their own to the room (implicit audit 3, IO1: the file carried the token, so its reader could write this
 * phone's sheets).
 */
export function exportedSave(save: Save, withKeys: boolean): object {
  const { deviceId: _device, ...settings } = save.settings, { deviceToken: _token, gmKey, gmKeys, ...sync } = save.settings.sync;
  return { ...save, settings: { ...settings, sync: { ...sync, ...(withKeys ? { gmKey: gmKey ?? null, gmKeys: gmKeys ?? {} } : {}) } } };
}
/**
 * A save swapped in on this phone (an import, a restore, a reset) with this phone's identity: its device id and its
 * token stay this phone's whatever the save held, so a friend's campaign never makes two phones one device to the room.
 */
export const keepPhone = (save: Save, mine: Pick<Save, 'settings'>): Save =>
  ({ ...save, settings: { ...save.settings, deviceId: mine.settings.deviceId, sync: { ...save.settings.sync, deviceToken: mine.settings.sync.deviceToken } } });

/**
 * An imported save with this phone's GM key for its room, when the file has none for it: a file exported without the
 * key ("Include GM key" off) must not take this phone's GM powers for the room it is running.
 */
export function keepGmKey(save: Save, mine: SyncSettings): Save {
  const theirs = save.settings.sync;
  if (theirs.gmKey || !mine.gmKey || !theirs.room || theirs.room !== mine.room) return save;
  const sync: SyncSettings = { ...theirs, gmKey: mine.gmKey, ...(mine.gmKeys ? { gmKeys: { ...mine.gmKeys } } : {}) };
  return { ...save, settings: { ...save.settings, sync } };
}

/** The text under each storage key, newest first. `null` means the key holds nothing. */
export type StoredKeys = { v4: string | null; v3: string | null; v2: string | null; v1: string | null };
/** What the app starts with. The edge acts on it: it owns storage, the backups and the words of the notice. */
export type Loaded = {
  save: Save;
  /** A newer app wrote the stored save: never overwrite it. */
  readOnly: boolean;
  /** Raw text the edge must put in the backups before it writes. */
  backup: { reason: string; data: string } | null;
  /**
   * What the player is told of the load itself: `old`, the stored save is from before the new combat rules, so the app
   * opens a new campaign; `unreadable`, it is not a save; `fight`, its running fight did not read and was dropped (the
   * rest opens). Each keeps the stored text in the backups. A read-only save is told by the store's life (store-life.ts).
   */
  notice: LoadNotice | null;
};
export type LoadNotice = 'unreadable' | 'old' | 'fight';

/**
 * Decides what the app opens with. The newest key that holds anything is the only one read: an unreadable newer text
 * never falls back to an older key, because the older text is from before the newer one existed. A save from before
 * the new combat rules is not carried over: its text goes to the backups and the app opens a new campaign.
 */
export function loadSave(stored: StoredKeys, env: ParseEnv): Loaded {
  const quiet = { readOnly: false, backup: null, notice: null };
  const text = stored.v4 ?? stored.v3 ?? stored.v2 ?? stored.v1;
  if (text === null) return { ...quiet, save: freshSave(env, { onboarded: false }) };
  const parsed = parseSave(text, env);
  switch (parsed.kind) {
    case 'save': return parsed.fightLost ? { ...quiet, save: parsed.save, backup: { reason: 'a fight that could not be read', data: text }, notice: 'fight' } : { ...quiet, save: parsed.save };
    case 'newer': return { ...quiet, save: parsed.save, readOnly: true };
    case 'old': {
      // Without `serverOk` a phone opened from its cache would hide the room panel until it reached the server again.
      const save = freshSave(env, { onboarded: true });
      save.settings.sync.serverOk = parsed.serverOk;
      return { ...quiet, save, backup: { reason: 'before the new combat rules', data: text }, notice: 'old' };
    }
    case 'invalid': return { ...quiet, save: freshSave(env, { onboarded: true }), backup: { reason: 'unreadable', data: text }, notice: 'unreadable' };
  }
}

/**
 * A hunter another phone sent to a room (its sheet), repaired the way a save's hunter is, or null when it is not an
 * object or its id is not a hunter id. In place, like the save repair. Two differences: the build path is kept as sent
 * (it means something only under the sending phone's rules), and a malformed id inside the hunter
 * (a quest's, an item's) is kept, since no other phone looks things up by those ids. A penalty with no start date
 * takes the epoch: the sending phone's own repair always sets one.
 */
export function parseSheetHunter(value: unknown): Hunter | null {
  if (!isObj(value)) return null;
  const run: Run = { R: BASE_RULES, env: { now: new Date(0), newDeviceId: () => NO_DEVICE, newDeviceToken: () => '' }, ids: new Set(), bad: [], sheet: true };
  const h = fill(value, hunterExample(BASE_RULES));
  if (!ID_RE.test(h.id)) return null;
  fixHunter(run, h);
  return h;
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
export function dailyQuest(id: QuestId, R: Rules, env: ParseEnv): Quest {
  const t = R.dailyTemplate;
  const copy: Pick<Quest, 'objectives' | 'rewards'> = JSON.parse(JSON.stringify({ objectives: t.objectives, rewards: t.rewards }));
  return { ...newQuest(), title: t.title, desc: t.desc || '', ...copy, id, kind: 'daily', issuedAt: env.now.toISOString(), from: 'system' };
}
/** The built-in skills and items Sung Jin-Woo starts with (src/core/registry/skills.ts and items.ts), by name. */
const STARTER_SKILL_NAMES: readonly string[] = ['Sprint', 'Bloodlust'];
const STARTER_ITEM_NAMES: readonly string[] = ["Kasaka's Venom Fang", 'Health Potion'];
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
  h.items = [...LOOT_ITEMS, ...SHOP_ITEMS].filter(d => STARTER_ITEM_NAMES.includes(d.name)).map((d): Item => ({ ...itemOf(R, d), id: next('i') }));
  h.daily.lastCheckedKey = dayKey(env.now, save.settings.dailyResetHour);
  return h;
}
/** A new profile: an empty campaign, which the repair gives the starter hunter. */
export function freshSave(env: ParseEnv, options: { onboarded: boolean }): Save {
  const save = repair({}, env);
  save.settings.onboarded = options.onboarded;
  return save;
}
