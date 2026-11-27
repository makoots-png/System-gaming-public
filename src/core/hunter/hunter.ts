// hunter.ts: what a hunter is. Its type and the types of what it holds (quests, titles, boons, shadows, loadouts), its
// default (`newHunter`), and its repair in two steps: `fixHunter` reads the shapes and claims the ids, then `fixRefs`
// checks what points at those ids, once every id is final. The save's repair in save.ts runs both, with the rename of
// repeated ids between them; `parseSheetHunter` runs both for a sheet another phone sent. Pure. save.ts loads the
// room's parts (the outbox, the story runs, the offers), and those load protocol.ts, which reads a sheet with
// `parseSheetHunter`: so this file imports nothing that reads a save, and a module save.ts loads takes the hunter from
// here (tests/deps.test.ts refuses a cycle of value imports).
// A change to the shape of a hunter is made here and in tests/save.test.ts.

import { parseObjectiveCount } from './counts.ts';
import type { ObjectiveCount } from './counts.ts';
import type { SheetStatus } from '../combat/effect-ops.ts';
import { parseSheetStatus } from '../combat/fight-parse.ts';
import { MAX_STATUSES } from '../combat/fight-types.ts';
import { SLOTS, WEAR_LIMIT } from '../registry/items.ts';
import type { Slot } from '../registry/items.ts';
import type { HeldItem } from '../registry/item-book.ts';
import { parsePowers } from '../registry/powers.ts';
import type { Powers } from '../registry/powers.ts';
import { ARCHETYPE_LIST } from '../registry/monsters.ts';
import type { Skill } from '../registry/skills.ts';
import type { Archetype } from './derive.ts';
import { oneOf } from '../one-of.ts';
import { STAT_KEYS, baseStats, statsBy } from '../stats.ts';
import type { Stats } from '../stats.ts';
import { HUNTER_COLORS, BONUS_KEYS, RANKS, RULES as BASE_RULES } from '../rules.ts';
import { isIconKey } from '../registry/icons.ts';
import type { Perk, Rank, Rules } from '../rules.ts';
import { REWARD_BOUNDS, newRewards, parseBand, parseRewards } from '../rewards.ts';
import type { Rewards } from '../rewards.ts';
import { newProgress, parseCapDisplay, undoableOn } from './progress.ts';
import { levelOf } from './level.ts';
import type { CapDisplay, Pending, Progress, StatPoints } from './progress.ts';
import { newVitals, parseLife, parseUsed } from './vitals.ts';
import type { Vitals } from './vitals.ts';
import { REVIVE_STANDINGS } from './revive-standing.ts';
import type { ReviveStanding } from './revive-standing.ts';
import { CRYSTAL_MAX } from './crystal.ts';
import { parseGuild } from './guild.ts';
import type { GuildMembership } from './guild.ts';
import { hunterSheet } from './sheet.ts';
import { isStateChip } from './chips.ts';
import { parsePenalty } from './penalty.ts';
import type { Penalty } from './penalty.ts';
import { parseJobChain } from './job-chain.ts';
import type { JobChain } from './job-chain.ts';
import { CLASS_NAME_MAX, gmBackedClasses, parseClasses } from './class-locker.ts';
import type { ClassHolders, ClassLocker } from './class-locker.ts';
import { newChronicle, parseChronicle } from './chronicle.ts';
import type { Chronicle } from './chronicle.ts';
import { newSolo, parseSolo } from '../gates/personal.ts';
import type { Solo } from '../gates/personal.ts';
import { parseDayKey, timeOf } from '../day.ts';
import type { DayKey } from '../day.ts';
import { SAVE_ID_RE, saveId, titleKey } from '../ids.ts';
import type { BoonId, ChainId, HunterId, ItemId, LoadoutId, QuestId, ShadowId, TitleId } from '../ids.ts';
import { LIMITS, NO_DEVICE, VITAL_MAX, fill, int, isNum, isObj, isStr, items, list, num, optional, skills, str, strOrNull } from '../repair.ts';
import type { Rec, RepairRun } from '../repair.ts';

// ── enums ──
export const QUEST_KINDS = ['daily', 'main', 'side', 'job', 'urgent', 'penalty'] as const;
export const QUEST_STATUSES = ['active', 'done', 'failed'] as const;
export const QUEST_SOURCES = ['gm', 'system', 'self'] as const;
export const SHADOW_GRADES = ['Normal', 'Elite', 'Knight', 'Elite Knight', 'Commander', 'Marshal'] as const;

export type QuestKind = (typeof QUEST_KINDS)[number];
export type QuestStatus = (typeof QUEST_STATUSES)[number];
export type QuestSource = (typeof QUEST_SOURCES)[number];
export type ShadowGrade = (typeof SHADOW_GRADES)[number];

// ── what a hunter holds. A `?` field is one a view adds and removes as it goes, so it has no default. ──
/** A status on a hunter: its def, who applied it and the rounds left (src/core/combat/effect-ops.ts `SheetStatus`). */
export type Condition = SheetStatus;
/**
 * A quest's objective. `count`: the System moves it by the hunter's facts on the phone that holds the hunter (counts.ts
 * `objectiveStep`, in the notice step): its progress is the count, capped at its target, and no tap moves it. Absent: a tap moves it.
 */
export type Objective = { label: string; target: number; progress: number; count?: ObjectiveCount };
/**
 * An active quest has not ended; a done or failed one has the time it ended. A done quest's `told`: whether its
 * completion was shown (one the System completed is done untold until its window is answered: quests.ts `questStep`).
 * A step sets them together with `questState`.
 */
export type QuestState = { status: 'active'; doneAt: null } | { status: 'done'; doneAt: string; told: boolean } | { status: 'failed'; doneAt: string };
export const questState = (status: QuestStatus, at: string, told = true): QuestState =>
  (status === 'active' ? { status, doneAt: null } : status === 'done' ? { status, doneAt: at, told } : { status, doneAt: at });
export type Quest = QuestState & {
  id: QuestId; kind: QuestKind; title: string; desc: string; objectives: Objective[]; rewards: Rewards;
  issuedAt: string; dueAt: string | null; from: QuestSource; penaltyText: string;
  /** On a Job Change step's quest: the id of the chain that issued it (src/core/hunter/job-chain.ts). A back-reference only. */
  chainId?: ChainId;
  /** What failing costs: given by `grant` in the write that fails it (grant.ts `questFailed`). Empty gives nothing. */
  onFail: Rewards;
  /**
   * A secret quest: the GM gave it to this one hunter, and no other player's phone gets it or its progress (the room
   * seals its `quest` and `questUpdate`, protocol.ts). Only a quest from the GM is secret (quests.ts `questOf`).
   */
  secret: boolean;
};
export type Loadout = { id: LoadoutId; name: string; slots: Partial<Record<Slot, ItemId>> };
/**
 * A title a hunter holds. `bonus`: while it is the active one, points on any bonus key (`BONUS_KEYS`).
 * `seedKey`: the key of the rule title it was given from (src/core/hunter/record.ts `giveTitle`), kept through a rename.
 * `band`: the rank whose budget it fits (item-budget.ts `titleSpend`); absent reads E (rewards.ts `bandOf`).
 * Its `Powers` (registry/powers.ts), while it is the active title, are its hunter's in every fight at the hunter's rank:
 * its `worn` status on the row, its `active` an ability (rows.ts `heldPowers`).
 */
export type Title = { id: TitleId; name: string; desc: string; bonus: Perk; seedKey?: string; band?: Rank } & Powers;
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
/** Who set a hunter's rank: its level (`level`: at the start, or by Re-evaluate) or the GM by hand (`gm`). record.ts `rankStep` writes it. */
export const RANK_BY = ['level', 'gm'] as const;
export type RankBy = (typeof RANK_BY)[number];
/**
 * A hunter. Its sheet (max HP, mana, speed, armor and the rest) is worked out from these fields by
 * src/core/hunter/sheet.ts `hunterSheet`. `hpAdj` and `manaAdj` are the GM's edits of max HP and max mana.
 */
export type Hunter = Progress & Vitals & {
  id: HunterId; name: string; /** The hunter's job, or null for none. */ job: string | null;
  /** The job whose Job Change this hunter finished: what its keystones' awakened powers read, so deleting the done quest takes none. */
  jobDone: string | null;
  /** Earned classes and their bought skill-tree node ids in purchase order. Changed only through classes.ts. */
  classes: ClassLocker;
  rank: Rank;
  /** Who set the rank: a rank set by the GM by hand stays when levels are lost (SMX-rules-7.2). */
  rankBy: RankBy;
  /** Display-only level cap chip shown on the Status tab (`Rank`, `'none'`, or `null` when hidden). Changed only through progress.ts `setCapDisplay`. */
  capDisplay: CapDisplay;
  gold: number;
  /** Whole-number mana crystal balance, distinct from Resurrection Crystals. Changed only through crystal.ts. */
  crystal: number;
  /** Guild contract and optional per-hunter GM cut overrides, or null when unsigned. Changed only through guild.ts. */
  guild: GuildMembership | null;
  stats: Stats;
  hpAdj: number; manaAdj: number; conditions: Condition[];
  titleId: TitleId | null; titles: Title[]; quests: Quest[]; skills: Skill[]; items: HeldItem[]; equipped: Record<Slot, ItemId | null>;
  shadows: Shadow[]; daily: Daily; penalty: Penalty | null; jobChain: JobChain | null; notes: string; updatedAt: string;
  emblem: string; color: string; loadouts: Loadout[]; boons: Boon[];
  /** The rests taken since a gate last ended for it: src/core/hunter/rests.ts. Only grant.ts `sheetEdit` changes it. */
  restsTaken: number;
  /** What is left of its revive ladder (src/core/hunter/revive-standing.ts): `free`, `debt` or `none`. Only a System raise moves it. */
  reviveLeft: ReviveStanding;
  /** The gold it owes the System from a raise on debt or shop borrowing. Changed only through grant.ts and inventory.ts via debtStep. */
  debt: number;
  /** Its personal gates, the System's, and their clock: src/core/gates/personal.ts and solo.ts. Only their functions change them. */
  solo: Solo;
  /** What the System remembers of it (its facts, kept and waiting, and its lifetime numbers): src/core/hunter/chronicle.ts. Only `record` and `noticed` change it. */
  chronicle: Chronicle;
  /** The hunter a new install starts with (`starterHunter`), until first-run setup replaces it or makes it the player's (src/core/starter.ts). */
  seed?: true;
};

// ── defaults. Each factory is typed by its entity, so a field added to a type without a default does not compile. ──
export const newStats = (R: Rules = BASE_RULES): Stats => ({ ...baseStats(R.fight) });
export const newEquipped = (): Record<Slot, ItemId | null> => ({
  weapon: null, offhand: null, head: null, chest: null, neck: null, legs: null, feet: null, orb: null, ring1: null, ring2: null,
});
export const newQuest = (): Quest => ({
  id: saveId('q', 0), kind: 'side', title: '', desc: '', objectives: [], rewards: newRewards(), status: 'active', issuedAt: '', doneAt: null,
  dueAt: null, from: 'self', penaltyText: '', onFail: newRewards(), secret: false,
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
    ...newProgress(), ...newVitals({ hpMax: 1, manaMax: 0, fatigueMax: 0 }), id: saveId('h', 1), name: 'Hunter', job: null, jobDone: null, classes: {}, rank: 'E', rankBy: 'level', capDisplay: null,
    gold: 0, crystal: 0, guild: null, stats, hpAdj: 0, manaAdj: 0, conditions: [], titleId: null, titles: [],
    quests: [], skills: [], items: [], equipped: newEquipped(), shadows: [],
    daily: { streak: 0, lastCompleteKey: null, lastCheckedKey: null }, penalty: null, jobChain: null, notes: '', updatedAt: '',
    emblem: '', color: '', loadouts: [], boons: [], restsTaken: 0, reviveLeft: 'free', debt: 0, solo: newSolo(), chronicle: newChronicle(),
  };
  return Object.assign(h, newVitals(hunterSheet(h, R).sheet));
};

// ── the repair ──

/**
 * A job as a hunter holds it: the name (spaces cleaned, at most 60 characters), or null for none, a blank or the old
 * default word "None". "No job" is null, never a word a view compares with (implicit audit 3, H9).
 */
export const jobOf = (v: unknown): string | null => { const j = String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, CLASS_NAME_MAX); return j && j !== 'None' ? j : null; };
/** A title's bonus keeps only a perk key (`BONUS_KEYS`) with a finite number. */
function fixBonus(bonus: Rec): void {
  for (const key of Object.keys(bonus)) if (!(BONUS_KEYS as readonly string[]).includes(key) || !isNum(bonus[key])) delete bonus[key];
}
/** A hunter's conditions, each read by `parseSheetStatus`; one that does not read, or a chip the hunter's state draws, is dropped. At most `MAX_STATUSES`, as on a fight row. */
const conditions = (R: Rules, value: unknown[]): Condition[] =>
  value.flatMap(c => parseSheetStatus(c, R) ?? []).filter(c => !isStateChip(c.key)).slice(0, MAX_STATUSES);
/** Bound for junk only: a hunter's debt is a few S-rank Clears (an S Clear is 75,000 gold). */
const DEBT_MAX = 1e9;
/** Bound for junk only: a level holds `pointsPerLevel` points, 3 by default, so MAX_LEVEL holds 30,006 with the creation points. */
const POINTS_MAX = 1e6;
/**
 * Life, mana, fatigue, collapse, the uses spent this gate, the rests taken in it, the revive standing and the debt, within bounds for junk only: the maxima come from the sheet,
 * and a GM's rule change never prunes a hunter. A life that does not read is up at the full HP of the hunter's sheet, so
 * this runs last. A `used` that does not read is none spent (`parseUsed`).
 */
function fixVitals(h: Hunter, R: Rules): void {
  h.life = parseLife(h.life, VITAL_MAX) ?? newVitals(hunterSheet(h, R).sheet).life;
  h.mana = int(h.mana, 0, 0, VITAL_MAX); h.fatigue = int(h.fatigue, 0, 0, VITAL_MAX);
  h.used = parseUsed(h.used, R);
  h.restsTaken = int(h.restsTaken, 0, 0, VITAL_MAX);
  h.reviveLeft = oneOf(h.reviveLeft, REVIVE_STANDINGS, 'free'); h.debt = int(h.debt, 0, 0, DEBT_MAX);
}

/**
 * GM-mode repair for one local hunter against `holders`: prunes unbacked same-campaign unique classes (for example,
 * a duplicate Hemomancer imported from a hunter file) and parks foreign-campaign uniques without touching player saves.
 */
export function fixGmLocalUniques(h: Hunter, holders: ClassHolders): void {
  const fixed = gmBackedClasses(h, holders);
  if (!fixed.changed) return;
  h.classes = fixed.classes;
  h.job = fixed.job;
  h.jobDone = fixed.jobDone;
}

/** The default a stored hunter is filled from. */
export const hunterExample = (R: Rules): Hunter => newHunter(R);
/**
 * Reads a hunter's fields and lists to their shapes and claims the ids of what it holds, as `run.owner` this hunter. It
 * checks no reference: an id it claims may still be replaced by the save's repair, so `fixRefs` runs after that.
 */
export function fixHunter(saveRun: RepairRun, h: Hunter): void {
  const run: RepairRun = { ...saveRun, owner: h };
  const { R } = run;
  h.name = h.name.slice(0, 60) || 'Hunter';
  const parsedClasses = parseClasses(h.classes, {
    job: jobOf(h.job),
    fallbackAt: run.env.now.toISOString(),
    ...(run.env.classTrees ? { trees: run.env.classTrees } : {}),
  });
  h.classes = parsedClasses.classes; h.job = parsedClasses.job; h.jobDone = parsedClasses.jobDone;
  h.rank = oneOf(h.rank, RANKS, 'E'); h.rankBy = oneOf(h.rankBy, RANK_BY, 'level');
  h.capDisplay = parseCapDisplay(h.capDisplay);
  h.level = levelOf(h.level); h.xp = Math.max(0, h.xp); h.gold = Math.max(0, h.gold); h.crystal = int(h.crystal, 0, 0, CRYSTAL_MAX);
  h.guild = parseGuild(h.guild);
  h.peakLevel = Math.max(h.level, levelOf(h.peakLevel));
  h.bonusPoints = int(h.bonusPoints, 0, -POINTS_MAX, POINTS_MAX);
  h.hpAdj = int(h.hpAdj, 0, -VITAL_MAX, VITAL_MAX); h.manaAdj = int(h.manaAdj, 0, -VITAL_MAX, VITAL_MAX);
  // A missing stat takes the rules' base. `spent` is a sparse per-stat map (non-object reads as `{}`).
  // `pending` is signed per stat: positive placements up to POINTS_MAX, negative take-backs clamped to `-undoableOn`.
  const raw: Rec = isObj(h.stats) ? h.stats : {}, read = statsBy(k => int(raw[k], R.fight.statBase, 0, POINTS_MAX));
  h.stats = { ...raw, ...read }; // keys the types do not know are kept, as everywhere in the repair
  const rawSpent: Rec = isObj(h.spent) ? h.spent : {};
  const spent: StatPoints = {};
  for (const k of STAT_KEYS) {
    const n = int(rawSpent[k], 0, 0, POINTS_MAX);
    if (n >= 1) spent[k] = n;
  }
  h.spent = spent;
  const stored: Rec = isObj(h.pending) ? h.pending : {};
  const pending: Pending = {};
  for (const k of STAT_KEYS) {
    const floor = -undoableOn(h, k);
    const n = int(stored[k], 0, floor, POINTS_MAX);
    if (n !== 0) pending[k] = n;
  }
  h.pending = pending;
  h.conditions = conditions(R, h.conditions);
  h.titles = list(run, h.titles, 't', newTitle, t => {
    t.name = t.name.slice(0, 60); fixBonus(t.bonus); if (t.seedKey !== undefined && !titleKey(t.seedKey)) delete t.seedKey;
    if (t.band !== undefined && !parseBand(t.band)) delete t.band;
    // its powers by their one parser; a part refused, or both when one is past its size, leave the title without them
    const powers = parsePowers(t) ?? {}; delete t.worn; delete t.active; Object.assign(t, powers);
  });
  optional(h, 'seed', v => v === true);
  // A boon without a name is dropped; past the cap the oldest go (a new boon is added last).
  h.boons = list(run, h.boons, 'bn', newBoon, b => {
    b.name = b.name.trim().slice(0, REWARD_BOUNDS.boonName); b.text = b.text.slice(0, REWARD_BOUNDS.boonText); b.at = b.at.slice(0, 40);
  }).filter(b => b.name).slice(-LIMITS.boons);
  h.quests = list(run, h.quests, 'q', newQuest, q => {
    q.penaltyText = q.penaltyText.slice(0, 300); q.title = q.title.slice(0, 120);
    q.kind = oneOf(q.kind, QUEST_KINDS, 'side'); q.from = oneOf(q.from, QUEST_SOURCES, 'self');
    q.objectives = q.objectives.filter(isObj).map(o => {
      const count = o.count === undefined ? null : parseObjectiveCount(o.count), { count: _, ...rest } = o;
      return { ...rest, label: str(o.label, '', 120), target: num(o.target, 1), progress: num(o.progress, 0), ...(count ? { count } : {}) };
    });
    q.rewards = parseRewards(q.rewards) ?? newRewards(); q.onFail = parseRewards(q.onFail) ?? newRewards();
    const told = !('told' in q && q.told === false); Reflect.deleteProperty(q, 'told');
    Object.assign(q, questState(oneOf(q.status, QUEST_STATUSES, 'active'), strOrNull(q.doneAt) ?? q.issuedAt, told)); q.dueAt = timeOf(q.dueAt);
    optional(q, 'chainId', isStr);
    q.secret = q.from === 'gm' && q.secret === true;
  });
  h.skills = skills(run, h.skills);
  h.items = items(run, h.items);
  h.shadows = list(run, h.shadows, 'sh', newShadow, x => {
    x.name = x.name.slice(0, 60); x.rank = oneOf(x.rank, RANKS, 'E'); x.grade = oneOf(x.grade, SHADOW_GRADES, 'Normal');
    x.archetype = oneOf(x.archetype, ARCHETYPE_LIST, 'brute'); x.hp = int(x.hp, 1, 0, VITAL_MAX); x.monster = strOrNull(x.monster);
  });
  const d = h.daily;
  d.lastCompleteKey = parseDayKey(d.lastCompleteKey); d.lastCheckedKey = parseDayKey(d.lastCheckedKey);
  d.streak = Math.max(0, d.streak);
  h.solo = parseSolo(h.solo);
  h.chronicle = parseChronicle(h.chronicle);
  // Looks: an unknown emblem or color means "automatic". A lowered loadoutCap keeps saved sets. A loadout's slots are references: `fixRefs` reads them.
  if (!isIconKey(h.emblem)) h.emblem = '';
  if (!HUNTER_COLORS.includes(h.color)) h.color = '';
  h.loadouts = list(run, h.loadouts, 'lo', newLoadout, l => { l.name = l.name.replace(/\s+/g, ' ').trim().slice(0, 24) || 'Set'; }).slice(0, LIMITS.loadouts);
  // The sheet reads the gear and the title by the ids as stored, which name the objects `fixRefs` points them at.
  fixVitals(h, R);
}

/**
 * What a hunter wears as a save or a sheet holds it: the structure only (item sync PR 2). Walks `SLOTS` in order and
 * keeps a slot's item when it is held, a single one (qty 1), not worn in an earlier slot, and within `WEAR_LIMIT`.
 * Whether it fits the slot, and the two-handed lock, depend on its def, which may change after the save: inventory.ts
 * `wornOf` reads them each time from the resolved items.
 */
export function parseWorn(named: (slot: Slot) => HeldItem | undefined): Record<Slot, ItemId | null> {
  const out = Object.fromEntries(SLOTS.map(s => [s, null])) as Record<Slot, ItemId | null>;
  let kept = 0;
  for (const slot of SLOTS) {
    if (kept >= WEAR_LIMIT) break;
    const it = named(slot);
    if (!it || it.qty !== 1 || Object.values(out).includes(it.id)) continue;
    out[slot] = it.id;
    kept++;
  }
  return out;
}

/**
 * Points a hunter's references at what it holds, once the save's repair has given every object its final id: the
 * active title, the gear (`parseWorn`: each item once, single, at most `WEAR_LIMIT`), each loadout's slots (each item once; the fit is checked at swap time), and the quest of the
 * penalty and of the Job Change chain. A stored reference meant the first object of its list stored under that id, so
 * it is read against the ids as stored: `storedAs` holds, for each object of this hunter's that took a new id, its new
 * id and the id it was stored under. A reference that names nothing is cleared (the title, the gear), or read by the
 * parser without a quest (the penalty is dropped, the chain failed). `now`: the start of a penalty stored without one.
 */
export function fixRefs(h: Hunter, storedAs: ReadonlyMap<string, string>, now: string): void {
  const named = <T extends { id: string }>(list: readonly T[], ref: unknown): T | undefined =>
    isStr(ref) ? list.find(o => (storedAs.get(o.id) ?? o.id) === ref) : undefined;
  h.titleId = named(h.titles, h.titleId)?.id ?? null;
  const stored = h.equipped;
  h.equipped = parseWorn(slot => named(h.items, stored[slot]));
  for (const l of h.loadouts) {
    const slots: Loadout['slots'] = {};
    for (const slot of SLOTS) {
      const item = named(h.items, l.slots[slot]);
      if (item && !Object.values(slots).includes(item.id)) slots[slot] = item.id;
    }
    l.slots = slots;
  }
  const withQuest = (v: unknown): unknown => (isObj(v) ? { ...v, questId: named(h.quests, v.questId)?.id ?? v.questId } : v);
  h.penalty = parsePenalty(withQuest(h.penalty), h.quests, now);
  h.jobChain = parseJobChain(withQuest(h.jobChain), h.quests);
  h.quests = h.quests.map(q => {
    if (q.status === 'active' && q.chainId && (!h.jobChain || q.chainId !== h.jobChain.id)) {
      return { ...q, status: 'failed', doneAt: now };
    }
    return q;
  });
}

/**
 * A hunter another phone sent to a room (its sheet), repaired the way a save's hunter is, or null when it is not an
 * object or its id is not a hunter id. In place, like the save repair. Unknown keys stay untouched, and a malformed
 * id inside the hunter (a quest's, an item's) is kept, since no other phone looks things up by those ids. A penalty
 * with no start date takes the epoch: the sending phone's own repair always sets one.
 */
export function parseSheetHunter(value: unknown): Hunter | null {
  if (!isObj(value)) return null;
  const now = new Date(0);
  const run: RepairRun = { R: BASE_RULES, env: { now, newDeviceId: () => NO_DEVICE, newDeviceToken: () => '' }, ids: new Set(), bad: [], owner: null };
  const h = fill(value, hunterExample(BASE_RULES));
  if (!SAVE_ID_RE.test(h.id)) return null;
  fixHunter(run, h);
  // Server-side 1-entry wire cap: a pushed room sheet carries only the active class entry (matches client `pushedClasses`).
  h.classes = h.job && Object.hasOwn(h.classes, h.job) ? { [h.job]: h.classes[h.job]! } : {};
  fixRefs(h, new Map(), now.toISOString());
  return h;
}
