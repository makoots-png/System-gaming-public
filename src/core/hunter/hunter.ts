// hunter.ts: what a hunter is. Its type and the types of what it holds (quests, titles, boons, shadows, loadouts), its
// default (`newHunter`), and its repair (`fixHunter`, run by the save's repair in save.ts and by `parseSheetHunter` for
// a sheet another phone sent). Pure. save.ts loads the room's parts (the outbox, the story runs, the offers), and those
// load protocol.ts, which reads a sheet with `parseSheetHunter`: so this file imports nothing that reads a save, and
// a module save.ts loads takes the hunter from here (tests/deps.test.ts refuses a cycle of value imports).
// A change to the shape of a hunter is made here and in tests/save.test.ts.

import { parseObjectiveCount } from './counts.ts';
import type { ObjectiveCount } from './counts.ts';
import type { SheetStatus, StatusDef } from '../combat/effect-ops.ts';
import { parseSheetStatus, parseStatusDef } from '../combat/fight-parse.ts';
import { MAX_STATUSES } from '../combat/fight-types.ts';
import { SLOTS } from '../registry/items.ts';
import type { Item, Slot } from '../registry/items.ts';
import { ARCHETYPE_LIST } from '../registry/monsters.ts';
import type { Skill } from '../registry/skills.ts';
import type { Archetype } from './derive.ts';
import { oneOf } from '../one-of.ts';
import { STAT_KEYS, baseStats, statsBy } from '../stats.ts';
import type { Stats } from '../stats.ts';
import { EMBLEMS, HUNTER_COLORS, PERK_KEYS, RANKS, RULES as BASE_RULES, pathOf } from '../rules.ts';
import type { Perk, Rank, Rules } from '../rules.ts';
import { REWARD_BOUNDS, newRewards, parseRewards } from '../rewards.ts';
import type { Rewards } from '../rewards.ts';
import { MAX_LEVEL, newProgress, pendingTotal } from './progress.ts';
import type { Pending, Progress } from './progress.ts';
import { newVitals, parseLife, parseUsed } from './vitals.ts';
import type { Vitals } from './vitals.ts';
import { hunterSheet } from './sheet.ts';
import { isStateChip } from './chips.ts';
import { parsePenalty } from './penalty.ts';
import type { Penalty } from './penalty.ts';
import { parseJobChain } from './job-chain.ts';
import type { JobChain } from './job-chain.ts';
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
/** An active quest has not ended; a done or failed one has the time it ended. A view sets both with `questState`. */
export type QuestState = { status: 'active'; doneAt: null } | { status: Exclude<QuestStatus, 'active'>; doneAt: string };
export const questState = (status: QuestStatus, at: string): QuestState => (status === 'active' ? { status, doneAt: null } : { status, doneAt: at });
export type Quest = QuestState & {
  id: QuestId; kind: QuestKind; title: string; desc: string; objectives: Objective[]; rewards: Rewards;
  issuedAt: string; dueAt: string | null; from: QuestSource; penaltyText: string;
  /** On a Job Change step's quest: the id of the chain that issued it (src/core/hunter/job-chain.ts). A back-reference only. */
  chainId?: ChainId;
  /** What failing costs: given by `grant` in the write that fails it (grant.ts `questFailed`). Empty gives nothing. */
  onFail: Rewards;
};
export type Loadout = { id: LoadoutId; name: string; slots: Partial<Record<Slot, ItemId>> };
/**
 * A title a hunter holds. `bonus`: while it is the active one, the eight stats, `hpMax` and `manaMax` (`PERK_KEYS`).
 * `seedKey`: the key of the rule title it was given from (src/core/hunter/record.ts `giveTitle`), kept through a rename.
 */
export type Title = {
  id: TitleId; name: string; desc: string; bonus: Perk; seedKey?: string;
  /** While it is the active title, this status is on its hunter's row in every fight, at the hunter's rank (rows.ts `wornStatuses`). */
  worn?: StatusDef;
};
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

// ── defaults. Each factory is typed by its entity, so a field added to a type without a default does not compile. ──
export const newStats = (R: Rules = BASE_RULES): Stats => ({ ...baseStats(R.fight) });
export const newEquipped = (): Record<Slot, ItemId | null> => ({
  weapon: null, offhand: null, head: null, chest: null, hands: null, legs: null, feet: null, neck: null, ring1: null, ring2: null,
});
export const newQuest = (): Quest => ({
  id: saveId('q', 0), kind: 'side', title: '', desc: '', objectives: [], rewards: newRewards(), status: 'active', issuedAt: '', doneAt: null,
  dueAt: null, from: 'self', penaltyText: '', onFail: newRewards(),
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

// ── the repair ──

/**
 * A job as a hunter holds it: the name (spaces cleaned, at most 60 characters), or null for none, a blank or the old
 * default word "None". "No job" is null, never a word a view compares with (implicit audit 3, H9).
 */
export const jobOf = (v: unknown): string | null => { const j = String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, 60); return j && j !== 'None' ? j : null; };
/** A title's bonus keeps only a perk key (`PERK_KEYS`) with a finite number. */
function fixBonus(bonus: Rec): void {
  for (const key of Object.keys(bonus)) if (!(PERK_KEYS as readonly string[]).includes(key) || !isNum(bonus[key])) delete bonus[key];
}
/** A hunter's conditions, each read by `parseSheetStatus`; one that does not read, or a chip the hunter's state draws, is dropped. At most `MAX_STATUSES`, as on a fight row. */
const conditions = (R: Rules, value: unknown[]): Condition[] =>
  value.flatMap(c => parseSheetStatus(c, R) ?? []).filter(c => !isStateChip(c.key)).slice(0, MAX_STATUSES);
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
export const hunterExample = (R: Rules): Hunter => newHunter(R);
export function fixHunter(run: RepairRun, h: Hunter): void {
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
  h.titles = list(run, h.titles, 't', newTitle, t => {
    t.name = t.name.slice(0, 60); fixBonus(t.bonus); if (t.seedKey !== undefined && !titleKey(t.seedKey)) delete t.seedKey;
    if (t.worn !== undefined) { const worn = parseStatusDef(t.worn, BASE_RULES); if (worn) t.worn = worn; else delete t.worn; }
  });
  if (h.titleId !== null && !h.titles.some(t => t.id === h.titleId)) h.titleId = null;
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

/**
 * A hunter another phone sent to a room (its sheet), repaired the way a save's hunter is, or null when it is not an
 * object or its id is not a hunter id. In place, like the save repair. Two differences: the build path is kept as sent
 * (it means something only under the sending phone's rules), and a malformed id inside the hunter
 * (a quest's, an item's) is kept, since no other phone looks things up by those ids. A penalty with no start date
 * takes the epoch: the sending phone's own repair always sets one.
 */
export function parseSheetHunter(value: unknown): Hunter | null {
  if (!isObj(value)) return null;
  const run: RepairRun = { R: BASE_RULES, env: { now: new Date(0), newDeviceId: () => NO_DEVICE, newDeviceToken: () => '' }, ids: new Set(), bad: [], sheet: true };
  const h = fill(value, hunterExample(BASE_RULES));
  if (!SAVE_ID_RE.test(h.id)) return null;
  fixHunter(run, h);
  return h;
}
