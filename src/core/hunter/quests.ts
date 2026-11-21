// quests.ts: a hunter's quests (`hunter.quests`) and the daily engine (`hunter.daily`, `world.lastDailyKey`): a quest
// issued, edited, its progress set, completed, failed, reopened and deleted, and the daily rollover. A quest's status
// changes only by the one `TABLE` below (`questStep`), and its status and end time together (`questState`, save.ts).
// The Job Change chain (job-chain.ts) and the penalty (penalty.ts) hear of a quest's end here, in the same step, and
// what they answer is applied here (`chained`, `penalized`). The Quests view (quests.js) changes quests only through
// these steps. Pure: the caller passes the time, today's day key, the ids a new quest takes and the rules.
import { soloWake } from '../gates/personal.ts';
import { chainAfter } from './job-chain.ts';
import type { ChainEffect, ChainEvent } from './job-chain.ts';
import { systemCounts } from './quest-rights.ts';
import { missedDays, penaltyAfter, penaltyQuest } from './penalty.ts';
import type { PenaltyEffect, PenaltyEvent } from './penalty.ts';
import type { Role } from '../role.ts';
import { QUEST_KINDS, QUEST_SOURCES, QUEST_STATUSES, questState } from './hunter.ts';
import type { Hunter, Objective, Quest, QuestKind, QuestSource, QuestState, Save } from '../save.ts';
import { newRewards, parseRewards } from '../rewards.ts';
import type { Rewards } from '../rewards.ts';
import { oneOf } from '../one-of.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { told } from '../session-log.ts';
import { RECHECK_MS, dayGap, dayKey, nextReset, timeOf } from '../day.ts';
import type { DayKey } from '../day.ts';
import type { Said, Stamp } from '../session-log.ts';
import { saveId } from '../ids.ts';
import type { HunterId, QuestId } from '../ids.ts';
import { record } from './chronicle.ts';
import type { Fact } from './facts.ts';
import { parseObjectiveCount } from './counts.ts';
import type { QuestOffer } from '../protocol.ts';

/** A quest's end as a fact of its hunter's chronicle. */
const questFact = (q: Quest, end: 'done' | 'failed'): Fact => ({ kind: 'quest', end, qkind: q.kind, from: q.from, title: q.title });

// ── the life of a quest ──
/**
 * Where a quest is: active; `untold`, done by the System (its last counted objective filled) with its QUEST COMPLETE
 * window not yet answered; done; failed. The status of a done quest and its `told` (hunter.ts `QuestState`) are one phase.
 */
export const QUEST_PHASES = ['active', 'untold', 'done', 'failed'] as const;
export type QuestPhase = (typeof QUEST_PHASES)[number];
export const questPhase = (q: QuestState): QuestPhase => (q.status === 'done' && !q.told ? 'untold' : q.status);
/**
 * What can happen to a quest. `complete`: a tap (Complete, or a filled objective's "Complete quest?"), whose own window
 * shows at once; `counted`: the System completing it (noticed.ts `countQuests`); `told`: its window answered; `reset`:
 * the daily rollover (dailies only); `reopen`: the Reopen of a failed quest.
 */
export const QUEST_EVENTS = ['complete', 'counted', 'told', 'fail', 'reopen', 'reset'] as const;
export type QuestEvent = (typeof QUEST_EVENTS)[number];
/**
 * For each phase, where each event leads, or null where it does not apply. A daily reset before its window is answered
 * is active again and its window is not shown, as when the window was kept in the phone's memory.
 */
export const TABLE: { readonly [P in QuestPhase]: { readonly [E in QuestEvent]: QuestPhase | null } } = {
  active: { complete: 'done', counted: 'untold', told: null, fail: 'failed', reopen: null, reset: 'active' },
  untold: { complete: null, counted: null, told: 'done', fail: null, reopen: null, reset: 'active' },
  done: { complete: null, counted: null, told: null, fail: null, reopen: null, reset: 'active' },
  failed: { complete: null, counted: null, told: null, fail: null, reopen: 'active', reset: 'active' },
};
export type QuestWhy = 'missing' | 'not-now' | 'chain' | 'not-daily' | 'pastDue';
/** A quest's body: all but its phase (status, end time and told). */
function bodyOf(q: Quest): Omit<Quest, 'status' | 'doneAt'> {
  const { status: _s, doneAt: _d, ...rest } = q;
  if (!('told' in rest)) return rest;
  const { told: _t, ...body } = rest;
  return body;
}
/**
 * Quest `q` after `event` at time `at`, or why not. A completed quest's objectives are full; a reset daily is active
 * with its progress back to 0; a Job Change step is not reopened (the GM reissues its chain instead). Its window told,
 * a quest keeps the time it ended.
 */
export function questStep(q: Quest, event: QuestEvent, at: string): Quest | Refused<QuestWhy> {
  const to = TABLE[questPhase(q)][event];
  if (!to) return refuse('not-now');
  if (event === 'reopen' && q.chainId) return refuse('chain');
  if (event === 'reset' && q.kind !== 'daily') return refuse('not-daily');
  const objectives = event === 'complete' || event === 'counted' ? q.objectives.map(o => ({ ...o, progress: o.target }))
    : event === 'reset' ? q.objectives.map(o => ({ ...o, progress: 0 })) : q.objectives;
  const ended = event === 'told' && q.doneAt !== null ? q.doneAt : at;
  const state = to === 'untold' ? questState('done', ended, false) : to === 'done' ? questState('done', ended, true) : questState(to, ended);
  return { ...bodyOf(q), ...state, objectives };
}

// ── what a quest holds, from a form or a message ──
const clampInt = (v: unknown, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.trunc(Number(v)) || 0));
/**
 * A form's objectives: a label (cut to 80) and a target of 1 to 99999, the progress at most the target, and the count
 * the System moves it by (`parseObjectiveCount`; one that does not read leaves it moved by taps); one with no label is dropped.
 */
export function cleanObjectives(list: unknown): Objective[] {
  return (Array.isArray(list) ? list : []).map((o): Objective => {
    const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
    const target = clampInt(r.target, 1, 99999) || 1, count = parseObjectiveCount(r.count);
    return { label: String(r.label || '').slice(0, 80), target, progress: Math.min(target, clampInt(r.progress, 0, 99999)), ...(count ? { count } : {}) };
  }).filter(o => o.label);
}
/** What the quest form or the Issue to... button gives: any field may be missing or wrong. */
export type QuestDraft = { kind?: unknown; title?: unknown; desc?: unknown; objectives?: unknown; rewards?: unknown; onFail?: unknown; dueAt?: unknown; penaltyText?: unknown; from?: unknown };
/**
 * The quest a draft makes, active from `at`, with id `id`. A kind it does not know is a side quest, a source it does not
 * know is the GM's; a due time is kept only for an urgent quest or one from the GM, and only when it reads as a time.
 * A player's own quest (`self`) carries no reward, no cost and no penalty: only the GM gives those.
 */
export function questOf(d: QuestDraft, id: QuestId, at: string): Quest {
  const kind: QuestKind = oneOf(d.kind, QUEST_KINDS, 'side'), from: QuestSource = oneOf(d.from, QUEST_SOURCES, 'gm');
  const due = kind === 'urgent' || from === 'gm' ? timeOf(d.dueAt) : null;
  return {
    id, kind, title: String(d.title || 'Quest').slice(0, 120), desc: String(d.desc || '').slice(0, 500), objectives: cleanObjectives(d.objectives),
    rewards: from === 'self' ? newRewards() : parseRewards(d.rewards) ?? newRewards(), ...questState('active', at), issuedAt: at, dueAt: due,
    penaltyText: from === 'self' ? '' : String(d.penaltyText || '').slice(0, 300), from,
    onFail: from === 'self' ? newRewards() : parseRewards(d.onFail) ?? newRewards(),
  };
}
/**
 * The quest the room's `quest` message carries to players, from a form's draft and its due time: the objectives from no
 * progress, each with its count. The one place a view builds the offer (the Quests view's form and the GM view's Issue quest).
 */
export function questOffer(d: QuestDraft, dueAt: string | null): QuestOffer {
  const q = questOf({ ...d, from: 'gm', dueAt }, saveId('q', 0), '');
  return { kind: q.kind, title: q.title, desc: q.desc, objectives: q.objectives.map(o => ({ ...o, progress: 0 })), rewards: q.rewards, onFail: q.onFail, dueAt: q.dueAt, penaltyText: q.penaltyText };
}

// ── the chain and the penalty, applied ──
/** A hunter step that also says what to log and what effects happened. */
export type Told<T> = { hunter: Hunter; said: Said[]; effects: T[] };
const questLine = (h: Hunter, title: string, text: string): Said => ({ kind: 'quest', hunterId: h.id, title, text });
/** A chain event on `h` and what it answers applied: the chain, the step quest it issues, a level step's progress, the job it grants. */
export function chained(h: Hunter, event: ChainEvent): Told<ChainEffect> {
  const { effects, jobChain } = chainAfter(h.jobChain, event), said: Said[] = [];
  let next: Hunter = { ...h, jobChain };
  for (const fx of effects) {
    if (fx.type === 'issueQuest') { next = { ...next, quests: [...next.quests, fx.quest] }; said.push(questLine(h, 'Quest issued', fx.quest.title)); }
    if (fx.type === 'progress') next = { ...next, quests: next.quests.map(q => (q.id === fx.questId && q.objectives[0] ? { ...q, objectives: [{ ...q.objectives[0], progress: fx.value }, ...q.objectives.slice(1)] } : q)) };
    if (fx.type === 'grantJob') next = { ...next, job: fx.job };
  }
  return { hunter: next, said, effects };
}
/**
 * A penalty event on `h` and what it answers applied: the penalty, and the Penalty Zone quest it issues. A penalty issued
 * for missed days, or lifted, is a fact of the chronicle.
 */
export function penalized(h: Hunter, event: PenaltyEvent): Told<PenaltyEffect> {
  const { effects, penalty } = penaltyAfter(h.penalty, event, h.quests);
  let next: Hunter = { ...h, penalty };
  for (const fx of effects) {
    if (fx.type === 'issueQuest') next = { ...next, quests: [...next.quests, penaltyQuest(fx.questId, fx.at)] };
    if (fx.type === 'lifted' && h.penalty) next = record(next, { kind: 'penaltyLifted', days: h.penalty.days });
  }
  if (event.type === 'dailyMissed' && penalty && penalty !== h.penalty) next = record(next, { kind: 'penaltyIssued', days: event.days });
  return { hunter: next, said: [], effects };
}

/**
 * A step on hunter `hid` that also logs: `f` answers the hunter and its lines (or a refusal), and the save gets both in
 * one write. A hunter that is not there is refused.
 */
export function withTold<S extends Pick<Save, 'hunters' | 'log' | 'seq'>>(save: S, hid: string, stamp: Stamp, f: (h: Hunter) => Told<unknown> | Refused): S | Refused {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const t = f(save.hunters[at]!);
  if ('ok' in t) return t;
  return told({ ...save, hunters: save.hunters.map((h, i) => (i === at ? t.hunter : h)) }, stamp, ...t.said);
}

// ── a hunter's quests, as steps ──
const atQuest = (h: Hunter, qid: string): number => h.quests.findIndex(q => q.id === qid);
const withQuest = (h: Hunter, q: Quest): Hunter => ({ ...h, quests: h.quests.map(x => (x.id === q.id ? q : x)) });

/** A quest issued to `h` from a draft, logged as issued. */
export function issueQuest(h: Hunter, d: QuestDraft, id: QuestId, at: string): Told<never> {
  const q = questOf(d, id, at);
  return { hunter: { ...h, quests: [...h.quests, q] }, said: [questLine(h, 'Quest issued', q.title)], effects: [] };
}

/** What the edit form writes over a quest. Its status, times, id and source stay. */
export type QuestEdit = { kind: QuestKind; title: string; desc: string; objectives: unknown; rewards: Rewards; onFail: Rewards; dueAt: string | null; penaltyText: string };
/**
 * Quest `qid` edited by `role`. The objectives are cleaned as a new quest's; a failed quest stays failed until reopened.
 * A player's edit keeps the quest's reward, cost and penalty: only the GM gives those.
 */
export function editQuest(h: Hunter, qid: string, e: QuestEdit, role: Role): Hunter | Refused<QuestWhy> {
  const at = atQuest(h, qid);
  if (at < 0) return refuse('missing');
  const q = h.quests[at]!, gm = role === 'gm';
  return withQuest(h, {
    ...q, kind: e.kind, title: e.title.slice(0, 120), desc: e.desc.slice(0, 500), objectives: cleanObjectives(e.objectives),
    rewards: gm ? e.rewards : q.rewards, onFail: gm ? e.onFail : q.onFail, dueAt: timeOf(e.dueAt), penaltyText: gm ? e.penaltyText.slice(0, 300) : q.penaltyText,
  });
}

/** Objective `i` of active quest `qid` set to `value` (0 to its target); a level step or a counted objective the System moves is refused. */
export function setProgress(h: Hunter, qid: string, i: number, value: number): Hunter | Refused<QuestWhy> {
  const q = h.quests[atQuest(h, qid)], o = q && q.objectives[i];
  if (!q || !o) return refuse('missing');
  if (q.status !== 'active' || systemCounts(q, h.jobChain) || o.count) return refuse('not-now');
  return withQuest(h, { ...q, objectives: q.objectives.map((x, k) => (k === i ? { ...x, progress: clampInt(value, 0, x.target) } : x)) });
}

/** A failed quest made active again at `at`. An urgent quest past its due time is refused: it needs a new due time first. */
export function reopenQuest(h: Hunter, qid: string, at: string): Hunter | Refused<QuestWhy> {
  const q = h.quests[atQuest(h, qid)];
  if (!q) return refuse('missing');
  if (pastDue(q, Date.parse(at))) return refuse('pastDue');
  const next = questStep(q, 'reopen', at);
  return 'ok' in next ? next : withQuest(h, next);
}

/** An active quest failed, logged; a Job Change step fails its chain. */
export function failQuest(h: Hunter, qid: string, at: string): Told<ChainEffect> | Refused<QuestWhy> {
  const q = h.quests[atQuest(h, qid)];
  if (!q) return refuse('missing');
  const failed = questStep(q, 'fail', at);
  if ('ok' in failed) return failed;
  const done = record(withQuest(h, failed), questFact(q, 'failed')), said = [questLine(h, 'Quest failed', q.title)];
  if (!q.chainId) return { hunter: done, said, effects: [] };
  const c = chained(done, { type: 'stepFailed', questId: q.id });
  return { hunter: c.hunter, said: [...said, ...c.said], effects: c.effects };
}

/**
 * Quest `qid` deleted. A player's phone may not delete the quest a penalty is tied to (the penalty refuses it); the
 * GM's deleting it lifts the penalty. A Job Change step deleted fails its chain.
 */
export function deleteQuest(h: Hunter, qid: string, by: Role): Told<ChainEffect | PenaltyEffect> | Refused<QuestWhy | 'refused'> {
  if (atQuest(h, qid) < 0) return refuse('missing');
  const q = h.quests[atQuest(h, qid)]!;
  const p = penalized(h, { type: 'questDeleted', questId: q.id, by });
  if (p.effects.some(fx => fx.type === 'refused')) return refuse('refused');
  const step = q.chainId ? chained(p.hunter, { type: 'stepFailed', questId: q.id }) : { hunter: p.hunter, said: [], effects: [] };
  return { hunter: { ...step.hunter, quests: step.hunter.quests.filter(q => q.id !== qid) }, said: step.said, effects: [...p.effects, ...step.effects] };
}

/** What a completion did besides the quest: the streak reached (or null), whether a bonus point is due, whether every daily is done, whether the penalty lifted. */
export type Completed = Told<ChainEffect | PenaltyEffect> & { streak: number | null; bonus: boolean; allDaily: boolean; lifted: boolean };
/** Who completed a quest: a tap, or the System counting it (`counted`, whose window waits to be told). */
export type QuestCompletedBy = 'hand' | 'system';
/**
 * Active quest `qid` completed by `by` (a tap when not given) at `at` on day `today`: its objectives full, the penalty asked whether it lifts, the
 * chain told (a level step below its level is refused, `belowLevel`), and, when it was the last daily of the day,
 * the streak counted (one more after yesterday, else 1) with a bonus point every `streakBonusEvery` days.
 */
export function completeQuest(h: Hunter, qid: string, o: { at: string; today: DayKey; nextQuestId: QuestId; streakBonusEvery: number; by?: QuestCompletedBy }): Completed | Refused<QuestWhy | 'belowLevel'> {
  const q = h.quests[atQuest(h, qid)];
  if (!q) return refuse('missing');
  if (q.status !== 'active') return refuse('not-now');
  let next = h, said: Said[] = [], effects: (ChainEffect | PenaltyEffect)[] = [];
  if (q.chainId) {
    const c = chained(next, { type: 'stepCompleted', questId: q.id, level: h.level, nextQuestId: o.nextQuestId, at: o.at });
    if (c.effects.some(fx => fx.type === 'refused')) return refuse('belowLevel');
    next = c.hunter; said = c.said; effects = c.effects;
  }
  const finished = questStep(next.quests[atQuest(next, qid)]!, o.by === 'system' ? 'counted' : 'complete', o.at);
  if ('ok' in finished) return finished;
  next = record(withQuest(next, finished), questFact(q, 'done'));
  const p = penalized(next, { type: 'questCompleted', questId: q.id });
  next = p.hunter; effects = [...effects, ...p.effects];
  const lifted = p.effects.some(fx => fx.type === 'lifted');
  const allDaily = q.kind === 'daily' && next.quests.filter(x => x.kind === 'daily').every(x => x.status === 'done');
  let streak: number | null = null, bonus = false;
  if (allDaily && next.daily.lastCompleteKey !== o.today) {
    // calendar keys, not now minus 24 h: a 25 h night at a clock change still counts
    streak = (next.daily.lastCompleteKey && dayGap(next.daily.lastCompleteKey, o.today) === 1 ? next.daily.streak : 0) + 1;
    next = record({ ...next, daily: { ...next.daily, streak, lastCompleteKey: o.today } }, { kind: 'daily', streak });
    bonus = streak % o.streakBonusEvery === 0;
  }
  return { hunter: next, said: [...said, questLine(h, 'Quest complete', q.title)], effects, streak, bonus, allDaily, lifted };
}

// ── an urgent quest's time, and the daily rollover ──
/** When urgent quest `q` is due, in ms; null for a quest of another kind or with no due time. A stored due time is a time (save.ts reads it with `timeOf`). */
const dueMs = (q: Quest): number | null => (q.kind === 'urgent' && q.dueAt !== null ? Date.parse(q.dueAt) : null);
/** An urgent quest whose due time has come by `nowMs`, whatever its status. */
export const pastDue = (q: Quest, nowMs: number): boolean => { const t = dueMs(q); return t !== null && t <= nowMs; };
/** An active urgent quest whose due time has come by `nowMs`: the rollover fails it. */
export const overdue = (q: Quest, nowMs: number): boolean => q.status === 'active' && pastDue(q, nowMs);
/** Whether a missed daily penalizes `h`: always on a player's phone; on the GM's (NPCs, pregens) once it has completed a daily. */
export const tracked = (h: Pick<Hunter, 'daily'>, gm: boolean): boolean => !gm || !!h.daily.lastCompleteKey;
/** A hunter the rollover penalized, and an urgent quest it failed for being past due. */
export type Rollover = { penalties: { hid: HunterId; name: string; days: number }[]; failed: { hid: HunterId; qid: QuestId; name: string; title: string }[] };
/**
 * The daily rollover on day `today` at time `at` (`nowMs` its time in ms): each hunter not yet checked today has its
 * dailies reset; days with a daily left undone since its last check reset the streak and raise the penalty (only for a
 * `tracked` hunter: on the GM's phone, one that has completed a daily once); an urgent quest past its due time fails.
 * A Penalty Zone quest takes its id from the save's `seq`. Answers the save, what to log, and what to tell the player.
 */
export function rollover<S extends Pick<Save, 'hunters' | 'world' | 'seq'>>(save: S, o: { today: DayKey; at: string; nowMs: number; gm: boolean }): { save: S; said: Said[]; told: Rollover } {
  const said: Said[] = [], told: Rollover = { penalties: [], failed: [] };
  let seq = save.seq;
  const hunters = save.hunters.map(h0 => {
    let h = h0;
    if (!h.daily.lastCheckedKey || dayGap(h.daily.lastCheckedKey, o.today) > 0) { // a clock that went backwards is ignored
      const prev = h.daily.lastCheckedKey;
      if (prev) {
        const dailies = h.quests.filter(q => q.kind === 'daily');
        const days = tracked(h, o.gm) ? missedDays(dayGap(prev, o.today), dailies.map(q => q.status)) : 0;
        h = { ...h, quests: h.quests.map(q => { const r = q.kind === 'daily' ? questStep(q, 'reset', o.at) : q; return 'ok' in r ? q : r; }) };
        if (days >= 1) {
          const lost = h.daily.streak > 0 ? record(h, { kind: 'streakLost', streak: h.daily.streak }) : h;
          h = penalized({ ...lost, daily: { ...lost.daily, streak: 0 } }, { type: 'dailyMissed', days, at: o.at, questId: saveId('q', ++seq) }).hunter;
          said.push({ kind: 'quest', hunterId: h.id, title: 'Penalty', text: `${h.name} failed the Daily Quest (${days} day${days === 1 ? '' : 's'}).` });
          told.penalties.push({ hid: h.id, name: h.name, days });
        }
      }
      h = { ...h, daily: { ...h.daily, lastCheckedKey: o.today } };
    }
    for (const q of h.quests.filter(x => overdue(x, o.nowMs))) {
      // the one way a quest fails (its fact, its chain told); its first line is replaced by the rollover's, which says why
      const r = failQuest(h, q.id, o.at);
      if ('ok' in r) continue;
      h = r.hunter;
      told.failed.push({ hid: h.id, qid: q.id, name: h.name, title: q.title });
      said.push({ kind: 'quest', hunterId: h.id, title: 'Quest failed', text: `${q.title} (past due)` }, ...r.said.slice(1));
    }
    return h;
  });
  return { save: { ...save, seq, hunters, world: { ...save.world, lastDailyKey: o.today } }, said, told };
}

/**
 * When the phone tries a rollover again whose write was refused (a fight that holds a cost's part refused it, or the
 * store could not write): `RECHECK_MS` on, not at once, as the rollover is still due and would be refused again at once.
 * A change of the save or the page shown tries it sooner.
 */
export const rolloverRetry = (now: Date): number => now.getTime() + RECHECK_MS;

/** Whether the rollover has anything to do on day `today`: a new day, a hunter not checked today, or an urgent quest past due. */
export function rolloverDue(save: Pick<Save, 'hunters' | 'world'>, today: DayKey, nowMs: number): boolean {
  return save.world.lastDailyKey !== today || save.hunters.some(h => !h.daily.lastCheckedKey || dayGap(h.daily.lastCheckedKey, today) > 0 || h.quests.some(q => overdue(q, nowMs)));
}

/**
 * When the phone next runs the rollover, in ms, at reset hour `hour`: `now` when it has something to do, else the next
 * reset, the earliest due time of an active urgent quest, or the System's clock's next spawn or close (gates/personal.ts
 * `soloWake`, with `solo`: personal gates on, and whether the phone is the GM's), and never later than `RECHECK_MS` ahead
 * (day.ts says why).
 */
export function nextWake(save: Pick<Save, 'hunters' | 'world'>, now: Date, hour: number, solo: { readonly personal: boolean; readonly gm: boolean }): number {
  const t = now.getTime();
  if (rolloverDue(save, dayKey(now, hour), t)) return t;
  const dues = save.hunters.flatMap(h => h.quests.flatMap(q => { const d = q.status === 'active' ? dueMs(q) : null; return d === null ? [] : [d]; }));
  const gates = soloWake(save, t, solo);
  return Math.min(nextReset(now, hour).getTime(), t + RECHECK_MS, ...dues, ...(gates === null ? [] : [gates]));
}

export { QUEST_STATUSES };

/**
 * The quests of `h` the System completed whose window is not yet told (`untold`), oldest first: the Quests view shows
 * each one's window and, when it is answered, writes `questTold`. A daily completed again after its reset is untold again.
 */
export function questNews(h: Pick<Hunter, 'quests'>): Quest[] {
  return h.quests.filter(q => questPhase(q) === 'untold');
}
/**
 * Quest `qid`'s window answered: done, as it ended. A quest told already, reset or deleted since its window opened is
 * left as it is, so an answer that comes late or twice changes nothing.
 */
export function questTold(h: Hunter, qid: string): Hunter {
  const q = h.quests[atQuest(h, qid)];
  const told = q ? questStep(q, 'told', '') : null;
  return !told || 'ok' in told ? h : withQuest(h, told);
}
