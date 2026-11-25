// penalty.ts: the daily penalty. Pure.
// `penalty` on a hunter is the only store: the Penalized chip and the check penalty are drawn from it, and its Penalty
// Zone quest is an ordinary quest tied to it by `questId`. One table of events, `penaltyAfter`, answers the next penalty
// and what the app must do (issue the quest, tell the player it is lifted). The daily rollover in src/views/quests.js
// counts the missed days with `missedDays` and sends `dailyMissed`; completing or deleting a quest sends its event.
// Only the GM may delete the tied quest, and that lifts the penalty (the GM pardons it); a player's delete is refused.
import type { Rules } from '../rules.ts';
import type { Quest, QuestKind, QuestStatus } from '../save.ts';
import type { Role } from '../role.ts';
import type { QuestId } from '../ids.ts';

/** A penalty: since when, how many missed days it holds, and the Penalty Zone quest whose completion lifts it. */
export type Penalty = { since: string; days: number; questId: QuestId };
/** What the model reads of a hunter's quests. */
export type QuestRef = { id: QuestId; status: QuestStatus; kind: QuestKind };

/**
 * `dailyMissed`: the rollover found `days` days with a daily not done. `questId` is the id the Penalty Zone quest
 * takes if one is issued; `at` is when. `questCompleted` and `questDeleted` name the quest that was completed or deleted;
 * `by` is the role of the phone that deletes it.
 */
export type PenaltyEvent =
  | { type: 'dailyMissed'; days: number; at: string; questId: QuestId }
  | { type: 'questCompleted'; questId: QuestId }
  | { type: 'questDeleted'; questId: QuestId; by: Role };
export type PenaltyEventType = PenaltyEvent['type'];
export const PENALTY_EVENT_TYPES = ['dailyMissed', 'questCompleted', 'questDeleted'] as const satisfies readonly PenaltyEventType[];
/**
 * `issueQuest`: add `penaltyQuest(questId, at)` to the hunter's quests. `lifted`: the penalty has just ended.
 * `refused`: the event may not happen (a player deleting the tied quest); the caller leaves the quest where it is.
 */
export type PenaltyEffect = { type: 'issueQuest'; questId: QuestId; at: string } | { type: 'lifted' } | { type: 'refused' };
export type PenaltyResult = { penalty: Penalty | null; effects: PenaltyEffect[] };

/** The longest penalty the repair keeps, in days. A bound for junk, far beyond any real one. */
const MAX_DAYS = 99999;
const whole = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null);

type Step<T extends PenaltyEventType> = (p: Penalty | null, e: Extract<PenaltyEvent, { type: T }>, quests: readonly QuestRef[]) => PenaltyResult;
type Row = { readonly [T in PenaltyEventType]: Step<T> };
const same = (p: Penalty | null): PenaltyResult => ({ penalty: p, effects: [] });

const issue = (e: { questId: QuestId; at: string }): PenaltyEffect => ({ type: 'issueQuest', questId: e.questId, at: e.at });
/** One penalty, however many days: the days add up, and a new quest is issued only when the tied one is not open. */
const dailyMissed: Step<'dailyMissed'> = (p, e, quests) => {
  const days = whole(e.days);
  if (days === null || days < 1 || days !== e.days) return same(p);
  if (!p) return { penalty: { since: e.at, days: Math.min(days, MAX_DAYS), questId: e.questId }, effects: [issue(e)] };
  const open = quests.some(q => q.id === p.questId && q.status === 'active');
  const next = { ...p, days: Math.min(p.days + days, MAX_DAYS) };
  return open ? { penalty: next, effects: [] } : { penalty: { ...next, questId: e.questId }, effects: [issue(e)] };
};
/** The tied quest completed or deleted lifts the penalty. Any other quest changes nothing. */
const tiedQuestEnded = (p: Penalty | null, e: { questId: string }): PenaltyResult => (p && e.questId === p.questId ? { penalty: null, effects: [{ type: 'lifted' }] } : same(p));

/** Only the GM deletes the tied quest: a player would escape the penalty by deleting it. */
const questDeleted: Step<'questDeleted'> = (p, e) => (canDeleteQuest(p, e.questId, e.by) ? tiedQuestEnded(p, e) : { penalty: p, effects: [{ type: 'refused' }] });

const ROW: Row = { dailyMissed, questCompleted: tiedQuestEnded, questDeleted };

/** Whether a phone of role `by` may delete the quest `questId`: the GM any quest, a player any but the one the penalty is tied to. */
export const canDeleteQuest = (penalty: Penalty | null, questId: string, by: Role): boolean => by === 'gm' || penalty?.questId !== questId;

/** The penalty after `event`, given the hunter's quests. Never changes its inputs. */
export function penaltyAfter(penalty: Penalty | null, event: PenaltyEvent, quests: readonly QuestRef[]): PenaltyResult {
  // ROW pairs each event type with its own step.
  const r = (ROW[event.type] as Step<PenaltyEventType>)(penalty, event as never, quests);
  return r.penalty === penalty ? r : { ...r, penalty: r.penalty && { ...r.penalty } };
}

/**
 * The penalty of a hunter whose quests took new ids (one brought in from another campaign's file, imported.ts): tied to
 * its quest's new id, or none when its quest is not among them, as the repair reads a penalty without its quest.
 */
export const penaltyMoved = (p: Penalty | null, moved: (id: QuestId) => QuestId | null): Penalty | null => {
  const questId = p && moved(p.questId);
  return p && questId ? { ...p, questId } : null;
};

/** The Penalty Zone quest the System issues for a penalty. */
export function penaltyQuest(id: QuestId, at: string): Quest {
  return {
    id, kind: 'penalty', title: 'Penalty Zone: Survive for 4 hours', desc: 'You failed the Daily Quest. Survive the Penalty Zone. The GM decides how it plays.',
    objectives: [{ label: 'Hours survived', target: 4, progress: 0 }], rewards: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
    status: 'active', issuedAt: at, doneAt: null, dueAt: null, from: 'system', penaltyText: '', secret: false,
    onFail: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
  };
}

/**
 * The days missed at a rollover `gap` days after the hunter was last checked, given the status of each daily as it
 * stood. Dailies all done keep the last day checked, so only the days after it are missed. No daily, no miss.
 */
export function missedDays(gap: number, dailies: readonly QuestStatus[]): number {
  if (!dailies.length || !(gap >= 1)) return 0;
  return Math.max(0, Math.trunc(gap) - (dailies.every(s => s === 'done') ? 1 : 0));
}

// ── what the penalty shows ──
/** The number taken off every check while penalized: the rules' `penaltyCheck`. */
export const checkPenalty = (penalty: Penalty | null, R: Pick<Rules, 'penaltyCheck'>): number => (penalty ? R.penaltyCheck : 0);
/** The chip the penalty draws. It is not a status: nothing applies or removes it. Its label is in the status registry. */
export const PENALTY_CHIPS = ['penalized'] as const;
export type PenaltyChip = (typeof PENALTY_CHIPS)[number];
export const penaltyChipsOf = (h: { penalty: Penalty | null }): PenaltyChip[] => (h.penalty ? ['penalized'] : []);

// ── the boundary ──
/**
 * The penalty in `value` for a hunter with `quests`, or null. Days are whole and at least 1; a missing start is `now`.
 * A penalty without a valid `questId` matching one of the hunter's quests is dropped: nothing could lift it.
 */
export function parsePenalty(value: unknown, quests: readonly QuestRef[], now: string): Penalty | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const since = typeof o.since === 'string' && o.since ? o.since.slice(0, 40) : now;
  const days = Math.max(1, Math.min(MAX_DAYS, whole(o.days) ?? 1));
  const questId = typeof o.questId === 'string' ? (quests.find(q => q.id === o.questId)?.id ?? null) : null;
  return questId === null ? null : { since, days, questId };
}
