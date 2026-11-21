import { afterEach, describe, expect, test } from 'bun:test';
import {
  QUEST_EVENTS, QUEST_PHASES, TABLE, chained, cleanObjectives, completeQuest, deleteQuest, editQuest, failQuest, issueQuest, nextWake, overdue, pastDue, questNews, questOf, questPhase, questStep, questTold,
  questOffer, reopenQuest, rollover, rolloverDue, rolloverRetry, setProgress, tracked, withTold,
} from '../src/core/hunter/quests.ts';
import type { QuestEvent, QuestPhase } from '../src/core/hunter/quests.ts';
import { freshSave, newHunter, newRewards, repairSave } from '../src/core/save.ts';
import type { Hunter, Objective, Quest, QuestStatus, Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { questAt, questIn } from './models/quest-events.ts';

/** Personal gates off (gates/personal.ts `soloWake`): these cases are the quests' own times. */
const NO_GATES = { personal: false, gm: false };
import { day, dev, hid, jcid, qid } from './fixtures/ids.ts';
import type { QuestId } from '../src/core/ids.ts';
import type { DayKey } from '../src/core/day.ts';
import { ROOM_HEARS, STREAK_BONUS_POINTS, chainStep, finishQuest, questEnded, questFailed, rolledOver } from '../src/core/hunter/grant.ts';
import { COMPLETER, GM_QUEST_KINDS, PLAYER_QUEST_KINDS, completerOf, questKindsFor } from '../src/core/hunter/quest-rights.ts';
import { noticed } from '../src/core/hunter/noticed.ts';
import type { NoticeCtx } from '../src/core/hunter/noticed.ts';
import { record } from '../src/core/hunter/chronicle.ts';
import type { Fact } from '../src/core/hunter/facts.ts';
import { parseRoomCode } from '../src/core/ids.ts';
import { QUEST_KINDS } from '../src/core/save.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { QUEST_FORM_CLOSED, questFormStep } from '../src/core/hunter/quest-form.ts';
import type { QuestFormEvent, QuestFormState } from '../src/core/hunter/quest-form.ts';

const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const AT = '2026-11-14T10:00:00.000Z';
const hunterWith = (...quests: Quest[]): Hunter => ({ ...newHunter(RULES), id: hid('h1'), quests });
const daily = (id: string, status: QuestStatus = 'active'): Quest => ({ ...questIn(status, 'daily'), id: qid(id), title: `Daily ${id}` });
const opts = (o: Partial<{ today: DayKey; nextQuestId: QuestId }> = {}) => ({ at: AT, today: day('2026-11-14'), nextQuestId: qid('q99'), streakBonusEvery: RULES.streakBonusEvery, by: 'hand' as const, ...o });

describe('the life of a quest', () => {
  // Every phase and event: the phase it leads to, or 'refused'. A reset applies to a daily only (the side quest refuses it).
  const rows: [QuestPhase, QuestEvent, QuestPhase | 'refused'][] = [
    ['active', 'complete', 'done'], ['active', 'counted', 'untold'], ['active', 'told', 'refused'], ['active', 'fail', 'failed'], ['active', 'reopen', 'refused'], ['active', 'reset', 'refused'],
    ['untold', 'complete', 'refused'], ['untold', 'counted', 'refused'], ['untold', 'told', 'done'], ['untold', 'fail', 'refused'], ['untold', 'reopen', 'refused'], ['untold', 'reset', 'refused'],
    ['done', 'complete', 'refused'], ['done', 'counted', 'refused'], ['done', 'told', 'refused'], ['done', 'fail', 'refused'], ['done', 'reopen', 'refused'], ['done', 'reset', 'refused'],
    ['failed', 'complete', 'refused'], ['failed', 'counted', 'refused'], ['failed', 'told', 'refused'], ['failed', 'fail', 'refused'], ['failed', 'reopen', 'active'], ['failed', 'reset', 'refused'],
  ];
  for (const [from, event, to] of rows) {
    test(`a ${from} side quest + ${event}: ${to}`, () => {
      const r = questStep(questAt(from), event, AT);
      if (to === 'refused') expect(isRefused(r)).toBe(true);
      else expect(questPhase(ok(r))).toBe(to);
    });
  }
  test('the rows are every phase against every event', () => {
    expect(rows.map(([p, e]) => `${p} ${e}`)).toEqual(QUEST_PHASES.flatMap(p => QUEST_EVENTS.map(e => `${p} ${e}`)));
  });
  test('the table: a reset leads every phase of a daily back to active', () => {
    for (const p of QUEST_PHASES) expect(ok(questStep(questAt(p, 'daily'), 'reset', AT))).toMatchObject({ status: 'active', doneAt: null, objectives: [{ progress: 0 }] });
    expect(Object.values(TABLE).map(r => r.reset)).toEqual(['active', 'active', 'active', 'active']);
  });
  test('a quest the System completes is done untold, with its end time; told, it keeps that time; reset, it carries no told', () => {
    const untold = ok(questStep(questIn('active', 'daily'), 'counted', AT));
    expect(untold).toMatchObject({ status: 'done', doneAt: AT, told: false, objectives: [{ progress: 3 }] });
    expect(ok(questStep(untold, 'told', '2026-11-14T11:00:00.000Z'))).toMatchObject({ status: 'done', doneAt: AT, told: true });
    expect('told' in ok(questStep(untold, 'reset', AT))).toBe(false);
    expect(ok(questStep(questIn('active'), 'complete', AT))).toMatchObject({ status: 'done', told: true });
  });
  test('a completed quest has its objectives full and its end time; a failed one keeps its progress', () => {
    expect(ok(questStep(questIn('active'), 'complete', AT))).toMatchObject({ status: 'done', doneAt: AT, objectives: [{ progress: 3 }] });
    expect(ok(questStep(questIn('active'), 'fail', AT))).toMatchObject({ status: 'failed', doneAt: AT, objectives: [{ progress: 1 }] });
  });
  test('a Job Change step is not reopened', () => {
    expect(questStep({ ...questIn('failed'), chainId: jcid('jc1') }, 'reopen', AT)).toEqual({ ok: false, why: 'chain' });
  });
  test('failed then reopened is the quest it was, but for the times', () => {
    const h = hunterWith(questIn('active')), failed = ok(failQuest(h, 'q800', AT)).hunter;
    const back = ok(reopenQuest(failed, 'q800', AT));
    // but for what the System remembers: the failure stays a fact of the chronicle
    expect({ ...back, chronicle: h.chronicle }).toEqual(h);
    expect(back.chronicle.inbox).toEqual([{ kind: 'quest', end: 'failed', qkind: h.quests[0]!.kind, from: h.quests[0]!.from, title: h.quests[0]!.title }]);
  });
  test('an urgent quest past its due time is not reopened until it is given a new one', () => {
    const urgent = { ...questIn('failed', 'urgent'), dueAt: '2026-11-14T09:00:00.000Z' }, h = hunterWith(urgent);
    expect(reopenQuest(h, 'q800', AT)).toEqual({ ok: false, why: 'pastDue' });
    const later = hunterWith({ ...urgent, dueAt: '2026-11-14T12:00:00.000Z' });
    expect(ok(reopenQuest(later, 'q800', AT)).quests[0]!.status).toBe('active');
  });
});

describe('an urgent quest\'s time', () => {
  const due = (status: QuestStatus, kind: Quest['kind'] = 'urgent'): Quest => ({ ...questIn(status, kind), dueAt: AT });
  test('overdue from its due time on, while it is active; past due whatever its status', () => {
    expect(overdue(due('active'), Date.parse(AT) - 1)).toBe(false);
    expect(overdue(due('active'), Date.parse(AT))).toBe(true);
    expect(overdue(due('failed'), Date.parse(AT))).toBe(false);
    expect(pastDue(due('failed'), Date.parse(AT))).toBe(true);
  });
  test('a quest of another kind with a due time is never overdue', () => {
    expect(overdue(due('active', 'side'), Date.parse(AT) + 1)).toBe(false);
  });
  test('an edit that gives a due time that is no time leaves the quest with none', () => {
    const q = due('active'), h = hunterWith(q);
    const edit = (dueAt: string | null) => ok(editQuest(h, q.id, { kind: q.kind, title: q.title, desc: q.desc, objectives: q.objectives, rewards: q.rewards, onFail: q.onFail, dueAt, penaltyText: q.penaltyText }, 'gm')).quests[0]!.dueAt;
    expect(edit('tomorrow-ish')).toBeNull();
    expect(edit('2026-11-15T10:00:00+02:00')).toBe('2026-11-15T08:00:00.000Z');
  });
});

describe('when the phone next runs the rollover', () => {
  const ZONE = process.env.TZ;
  afterEach(() => { process.env.TZ = ZONE ?? 'Etc/UTC'; });
  const checked = (...quests: Quest[]): Save => ({
    ...freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d') }, { onboarded: true }), world: { day: 1, lastDailyKey: day('2026-11-14'), session: 0 },
    hunters: [{ ...hunterWith(...quests), daily: { streak: 0, lastCompleteKey: null, lastCheckedKey: day('2026-11-14') } }],
  });
  const urgent = (dueAt: string, status: QuestStatus = 'active'): Quest => ({ ...questIn(status, 'urgent'), dueAt });
  const ms = (iso: string): number => Date.parse(iso);
  test('at the reset when it comes within a minute, else a minute on, to read the wall clock again', () => {
    process.env.TZ = 'Europe/Berlin';
    expect(nextWake(checked(), new Date('2026-11-14T22:59:30.000Z'), 0, NO_GATES)).toBe(ms('2026-11-14T23:00:00.000Z'));
    expect(nextWake(checked(), new Date(AT), 0, NO_GATES)).toBe(ms(AT) + 60_000);
  });
  test('at an active urgent quest\'s due time when it comes first; a finished one, or a due time that is no time in a stored save, is not waited for', () => {
    process.env.TZ = 'Europe/Berlin';
    expect(nextWake(checked(urgent('2026-11-14T10:00:10.000Z')), new Date(AT), 0, NO_GATES)).toBe(ms('2026-11-14T10:00:10.000Z'));
    expect(nextWake(checked(urgent('2026-11-14T10:00:10.000Z', 'done')), new Date(AT), 0, NO_GATES)).toBe(ms(AT) + 60_000);
    const env = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d') };
    expect(nextWake(repairSave(checked(urgent('tomorrow-ish')), env), new Date(AT), 0, NO_GATES)).toBe(ms(AT) + 60_000);
  });
  test('now, when a quest is past due or the day has turned since the last rollover', () => {
    process.env.TZ = 'Europe/Berlin';
    expect(nextWake(checked(urgent('2026-11-14T09:00:00.000Z')), new Date(AT), 0, NO_GATES)).toBe(ms(AT));
    expect(nextWake(checked(), new Date('2026-11-14T23:00:00.000Z'), 0, NO_GATES)).toBe(ms('2026-11-14T23:00:00.000Z'));
  });
  test('a rollover whose write was refused is tried again a minute on, not at once (SMX-gates-3.2)', () => {
    expect(rolloverRetry(new Date(AT))).toBe(ms(AT) + 60_000);
  });
});

describe('a quest from a form', () => {
  test('an unknown kind is a side quest, an unknown source the GM\'s; the title and text are cut to their bounds', () => {
    const q = questOf({ kind: 'epic', from: 'alien', title: 'x'.repeat(200), desc: 'y'.repeat(600) }, qid('q1'), AT);
    expect(q).toMatchObject({ id: 'q1', kind: 'side', from: 'gm', status: 'active', issuedAt: AT });
    expect(q.title).toHaveLength(120);
    expect(q.desc).toHaveLength(500);
    expect(questOf({}, qid('q1'), AT).title).toBe('Quest');
  });
  test('a due time is kept for an urgent quest or the GM\'s, and only when it reads as a time', () => {
    expect(questOf({ kind: 'urgent', from: 'self', dueAt: '2026-11-15T10:00:00Z' }, qid('q1'), AT).dueAt).toBe('2026-11-15T10:00:00.000Z');
    expect(questOf({ kind: 'side', from: 'self', dueAt: '2026-11-15T10:00:00Z' }, qid('q1'), AT).dueAt).toBeNull();
    expect(questOf({ kind: 'side', from: 'gm', dueAt: 'soon' }, qid('q1'), AT).dueAt).toBeNull();
  });
  test('objectives: no label dropped, a target from 1 to 99999, progress at most the target', () => {
    expect(cleanObjectives([{ label: 'A', target: 0, progress: 5 }, { label: '', target: 3 }, { label: 'B', target: 1e9, progress: -2 }]))
      .toEqual([{ label: 'A', target: 1, progress: 1 }, { label: 'B', target: 99999, progress: 0 }]);
  });
  test('issued then deleted leaves the hunter as it was, with a log line', () => {
    const h = hunterWith(), t = issueQuest(h, { title: 'Hunt' }, qid('q5'), AT);
    expect(t.hunter.quests.map(q => q.id)).toEqual(['q5']);
    expect(t.said).toEqual([{ kind: 'quest', hunterId: 'h1', title: 'Quest issued', text: 'Hunt' }]);
    expect(ok(deleteQuest(t.hunter, 'q5', 'player')).hunter).toEqual(h);
  });
});

describe('progress and edits', () => {
  test('a tick up then down is the quest it was; the value stays from 0 to the target', () => {
    const h = hunterWith(questIn('active')), up = ok(setProgress(h, 'q800', 0, 2));
    expect(up.quests[0]!.objectives[0]!.progress).toBe(2);
    expect(ok(setProgress(up, 'q800', 0, 1))).toEqual(h);
    expect(ok(setProgress(h, 'q800', 0, 99)).quests[0]!.objectives[0]!.progress).toBe(3);
    expect(ok(setProgress(h, 'q800', 0, -4)).quests[0]!.objectives[0]!.progress).toBe(0);
  });
  test('progress on a finished quest is refused', () => {
    expect(setProgress(hunterWith(questIn('done')), 'q800', 0, 2)).toEqual({ ok: false, why: 'not-now' });
  });
  test('an edit writes the fields and keeps the status; edited back it is the quest it was', () => {
    const q = questIn('failed'), h = hunterWith(q), back = { kind: q.kind, title: q.title, desc: q.desc, objectives: q.objectives, rewards: q.rewards, onFail: q.onFail, dueAt: q.dueAt, penaltyText: q.penaltyText };
    const edited = ok(editQuest(h, 'q800', { ...back, title: 'New', objectives: [{ label: 'Orcs', target: 2 }] }, 'gm'));
    expect(edited.quests[0]).toMatchObject({ title: 'New', status: 'failed', objectives: [{ label: 'Orcs', target: 2, progress: 0 }] });
    expect(ok(editQuest(edited, 'q800', back, 'gm'))).toEqual(h);
  });
  test('a player\'s edit or own quest gives no reward and no penalty; the GM\'s does', () => {
    const q = questIn('active'), h = hunterWith(q), rich = { ...newRewards(), gold: 500 };
    const mine = ok(editQuest(h, 'q800', { kind: q.kind, title: 'Mine', desc: '', objectives: q.objectives, rewards: rich, onFail: rich, dueAt: null, penaltyText: 'Run' }, 'player'));
    expect(mine.quests[0]).toMatchObject({ title: 'Mine', rewards: q.rewards, onFail: q.onFail, penaltyText: q.penaltyText });
    expect(ok(editQuest(h, 'q800', { kind: q.kind, title: 'GM', desc: '', objectives: q.objectives, rewards: rich, onFail: rich, dueAt: null, penaltyText: 'Run' }, 'gm')).quests[0]!.rewards.gold).toBe(500);
    expect(questOf({ from: 'self', rewards: rich, penaltyText: 'Run' }, qid('q1'), AT)).toMatchObject({ rewards: newRewards(), penaltyText: '' });
    expect(questOf({ from: 'gm', rewards: rich }, qid('q1'), AT).rewards.gold).toBe(500);
  });
});

describe('a completion', () => {
  test('the last daily of the day counts the streak: one more after yesterday, else 1', () => {
    const h = { ...hunterWith(daily('d1', 'done'), daily('d2')), daily: { streak: 4, lastCompleteKey: day('2026-11-13'), lastCheckedKey: day('2026-11-14') } };
    const r = ok(completeQuest(h, 'd2', opts()));
    expect(r).toMatchObject({ allDaily: true, streak: 5 });
    expect(r.hunter.daily).toEqual({ streak: 5, lastCompleteKey: day('2026-11-14'), lastCheckedKey: day('2026-11-14') });
    const gap = ok(completeQuest({ ...h, daily: { ...h.daily, lastCompleteKey: day('2026-11-10') } }, 'd2', opts()));
    expect(gap.streak).toBe(1);
  });
  test('a bonus point every streakBonusEvery days', () => {
    const n = RULES.streakBonusEvery;
    const h = { ...hunterWith(daily('d1')), daily: { streak: n - 1, lastCompleteKey: day('2026-11-13'), lastCheckedKey: day('2026-11-14') } };
    expect(ok(completeQuest(h, 'd1', opts())).bonus).toBe(true);
  });
  test('a daily that is not the last counts no streak; a quest not active is refused', () => {
    expect(ok(completeQuest(hunterWith(daily('d1'), daily('d2')), 'd1', opts())).streak).toBeNull();
    expect(completeQuest(hunterWith(questIn('done')), 'q800', opts())).toEqual({ ok: false, why: 'not-now' });
  });
  test('completing the Penalty Zone quest lifts the penalty', () => {
    const zone = { ...questIn('active', 'penalty'), id: qid('q700') };
    const h = { ...hunterWith(zone), penalty: { since: AT, days: 1, questId: qid('q700') } };
    const r = ok(completeQuest(h, 'q700', opts()));
    expect(r.lifted).toBe(true);
    expect(r.hunter.penalty).toBeNull();
  });
});

describe('the Job Change chain and the penalty, heard in the same step', () => {
  test('a chain issued adds step 1\'s quest and logs it', () => {
    const t = chained(hunterWith(), { type: 'issued', id: jcid('jc1'), job: 'Assassin', questId: qid('q7'), level: 1, at: AT });
    expect(t.hunter.jobChain).toMatchObject({ id: jcid('jc1'), job: 'Assassin', step: 1, status: 'active', questId: 'q7' });
    expect(t.hunter.quests.map(q => q.id)).toEqual(['q7']);
    expect(t.said.map(l => l.title)).toEqual(['Quest issued']);
  });
  test('a player may not delete the quest a penalty is tied to; the GM may, and that lifts the penalty', () => {
    const zone = { ...questIn('active', 'penalty'), id: qid('q700') }, h = { ...hunterWith(zone), penalty: { since: AT, days: 1, questId: qid('q700') } };
    expect(deleteQuest(h, 'q700', 'player')).toEqual({ ok: false, why: 'refused' });
    const gm = ok(deleteQuest(h, 'q700', 'gm'));
    expect(gm.hunter.quests).toEqual([]);
    expect(gm.hunter.penalty).toBeNull();
  });
});

describe('the daily rollover', () => {
  const save = (h: Hunter): Save => ({ ...freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d') }, { onboarded: true }), seq: 50, hunters: [h], world: { day: 1, lastDailyKey: day('2026-11-13'), session: 0 } });
  test('a missed day resets the dailies, the streak, and raises the penalty with its Zone quest from seq', () => {
    const h = { ...hunterWith(daily('d1', 'active')), daily: { streak: 3, lastCompleteKey: day('2026-11-12'), lastCheckedKey: day('2026-11-13') } };
    const r = rollover(save(h), { today: day('2026-11-14'), at: AT, nowMs: Date.parse(AT), gm: false }), x = r.save.hunters[0]!;
    expect(x.daily).toEqual({ streak: 0, lastCompleteKey: day('2026-11-12'), lastCheckedKey: day('2026-11-14') });
    expect(x.penalty).toEqual({ since: AT, days: 1, questId: 'q51' });
    expect(x.quests.map(q => [q.id, q.status])).toEqual([['d1', 'active'], ['q51', 'active']]);
    expect(r.save.seq).toBe(51);
    expect(r.save.world.lastDailyKey).toBe(day('2026-11-14'));
    expect(r.told.penalties).toEqual([{ hid: 'h1', name: h.name, days: 1 }]);
    expect(r.said.map(l => l.title)).toEqual(['Penalty']);
  });
  test('dailies done yesterday are reset with no penalty', () => {
    const h = { ...hunterWith(daily('d1', 'done')), daily: { streak: 3, lastCompleteKey: day('2026-11-13'), lastCheckedKey: day('2026-11-13') } };
    const x = rollover(save(h), { today: day('2026-11-14'), at: AT, nowMs: Date.parse(AT), gm: false }).save.hunters[0]!;
    expect(x.penalty).toBeNull();
    expect(x.daily.streak).toBe(3);
    expect(x.quests[0]).toMatchObject({ status: 'active', objectives: [{ progress: 0 }] });
  });
  test('on the GM\'s phone a hunter that never completed a daily is not penalized', () => {
    const h = { ...hunterWith(daily('d1')), daily: { streak: 0, lastCompleteKey: null, lastCheckedKey: day('2026-11-13') } };
    expect(tracked(h, true)).toBe(false);
    expect(rollover(save(h), { today: day('2026-11-14'), at: AT, nowMs: Date.parse(AT), gm: true }).save.hunters[0]!.penalty).toBeNull();
  });
  test('an urgent quest past its due time fails, and the rollover is due for it on the same day', () => {
    const urgent = { ...questIn('active', 'urgent'), dueAt: '2026-11-14T09:00:00.000Z' };
    const h = { ...hunterWith(urgent), daily: { streak: 0, lastCompleteKey: null, lastCheckedKey: day('2026-11-14') } };
    const s = { ...save(h), world: { day: 1, lastDailyKey: day('2026-11-14'), session: 0 } };
    expect(rolloverDue(s, day('2026-11-14'), Date.parse(AT))).toBe(true);
    const r = rollover(s, { today: day('2026-11-14'), at: AT, nowMs: Date.parse(AT), gm: false });
    expect(r.save.hunters[0]!.quests[0]!.status).toBe('failed');
    expect(r.told.failed).toEqual([{ hid: 'h1', qid: urgent.id, name: h.name, title: 'Clear the den' }]);
    expect(rolloverDue(r.save, day('2026-11-14'), Date.parse(AT))).toBe(false);
  });
});

describe('a step that logs', () => {
  test('the hunter and its lines land in one save, the line ids from seq', () => {
    const s = { ...freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d') }, { onboarded: true }), seq: 9 };
    const hid = s.hunters[0]!.id, next = ok(withTold(s, hid, { at: AT, cap: 200 }, h => issueQuest(h, { title: 'Hunt', rewards: newRewards() }, qid('q1'), AT)));
    expect(next.hunters[0]!.quests.at(-1)!.id).toBe(qid('q1'));
    expect(next.log[0]).toMatchObject({ id: 'l10', title: 'Quest issued', text: 'Hunt' });
    expect(withTold(s, 'h-none', { at: AT, cap: 200 }, h => issueQuest(h, {}, qid('q1'), AT))).toEqual({ ok: false, why: 'no-hunter' });
  });
});

describe('a quest finished in one step (grant.ts finishQuest)', () => {
  const ENV = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') };
  const DAY = { at: AT, today: day('2026-11-14'), R: RULES, vitals: 'sheet' as const };
  /** A save whose one hunter (h1) holds `quests`, `hp` HP below its maximum and no mana. */
  const saveWith = (quests: Quest[], down = 0): Save => {
    const s = freshSave(ENV, { onboarded: true }), h = { ...s.hunters[0]!, id: hid('h1'), quests, mana: 0 };
    return { ...s, hunters: [down ? { ...h, life: { at: 'up' as const, hp: hunterSheet(h, RULES).sheet.hpMax - down } } : h] };
  };
  const reward = (q: Quest, o: Partial<Quest['rewards']>): Quest => ({ ...q, rewards: { ...newRewards(), ...o } });

  test('the quest done, its XP and gold given and its line logged are one save; the window lists what was given', () => {
    const q = reward({ ...questIn('active', 'side'), id: qid('q5'), title: 'Wolf Hunt' }, { xp: 50, gold: 10 });
    const s = saveWith([q]), r = ok(finishQuest(s, 'h1', 'q5', DAY)), h = r.save.hunters[0]!;
    expect(h.quests[0]!.status).toBe('done');
    expect([h.xp, h.gold - s.hunters[0]!.gold]).toEqual([50, 10]);
    expect(r.save.log.map(l => l.title)).toContain('Quest complete');
    expect(['+50 XP', '+10 gold'].every(l => r.granted.lines.includes(l)), r.granted.lines.join(' | ')).toBe(true);
  });

  test('the day\'s last daily pays its reward and refills nobody: HP, mana and a dying hunter\'s life stay as they were', () => {
    const s = saveWith([daily('d1', 'done'), daily('d2')], 10), before = s.hunters[0]!;
    for (const vitals of ['sheet', 'fight'] as const) {
      const r = ok(finishQuest(s, 'h1', 'd2', { ...DAY, vitals })), h = r.save.hunters[0]!;
      expect(r.completed.allDaily).toBe(true);
      expect([h.life, h.mana]).toEqual([before.life, before.mana]);
    }
    const dying = { ...s, hunters: [{ ...before, life: { at: 'dying' as const, successes: 0 as const, failures: 1 as const } }] };
    expect(ok(finishQuest(dying, 'h1', 'd2', DAY)).save.hunters[0]!.life).toEqual(dying.hunters[0]!.life);
  });

  test(`the streak's bonus gives ${STREAK_BONUS_POINTS} point beside the quest's own`, () => {
    const s = saveWith([reward(daily('d1'), { points: 2 })]), n = RULES.streakBonusEvery;
    const streaking = { ...s, hunters: [{ ...s.hunters[0]!, daily: { streak: n - 1, lastCompleteKey: day('2026-11-13'), lastCheckedKey: day('2026-11-14') } }] };
    const before = streaking.hunters[0]!.bonusPoints, r = ok(finishQuest(streaking, 'h1', 'd1', DAY));
    expect(r.completed.bonus).toBe(true);
    expect(r.save.hunters[0]!.bonusPoints - before).toBe(2 + STREAK_BONUS_POINTS);
  });

  test('a Job quest gives its job; a quest not active, or a hunter not here, writes nothing', () => {
    const job = reward({ ...questIn('active', 'job'), id: qid('q6') }, { job: 'Mage' });
    const r = ok(finishQuest(saveWith([job]), 'h1', 'q6', DAY));
    expect([r.job, r.save.hunters[0]!.job]).toEqual(['Mage', 'Mage']);
    expect(finishQuest(saveWith([questIn('done')]), 'h1', 'q800', DAY)).toEqual({ ok: false, why: 'not-now' });
    expect(finishQuest(saveWith([job]), 'h9', 'q6', DAY)).toEqual({ ok: false, why: 'no-hunter' });
  });
});

describe('a Job Change chain event and the steps it completes, in one step (grant.ts chainStep)', () => {
  const ENV = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') };
  const DAY = { at: AT, today: day('2026-11-14'), R: RULES };
  const saveAt = (level: number): Save => { const s = freshSave(ENV, { onboarded: true }); return { ...s, hunters: [{ ...s.hunters[0]!, id: hid('h1'), level }] }; };

  test('a chain issued adds its first step quest and its log line, with ids from the save', () => {
    const s = saveAt(1), r = ok(chainStep(s, 'h1', next => ({ type: 'issued', id: next('jc'), job: 'Assassin', questId: next('q'), level: 1, at: AT }), DAY));
    const h = r.save.hunters[0]!;
    expect(h.jobChain).toMatchObject({ job: 'Assassin', step: 1, status: 'active' });
    expect(h.quests.map(q => q.id)).toEqual([...s.hunters[0]!.quests.map(q => q.id), h.jobChain!.questId]);
    expect(r.save.seq).toBeGreaterThan(s.seq);
    expect(r.save.log[0]!.title).toBe('Quest issued');
  });

  test('a second chain is refused and writes nothing; a hunter not here is refused', () => {
    const one = ok(chainStep(saveAt(1), 'h1', next => ({ type: 'issued', id: next('jc'), job: 'Assassin', questId: next('q'), level: 1, at: AT }), DAY)).save;
    expect(chainStep(one, 'h1', next => ({ type: 'issued', id: next('jc'), job: 'Mage', questId: next('q'), level: 1, at: AT }), DAY)).toEqual({ ok: false, why: 'running' });
    expect(chainStep(one, 'h9', () => ({ type: 'abandoned', by: 'gm' }), DAY)).toEqual({ ok: false, why: 'no-hunter' });
  });
});

describe('the kinds a quest form offers (quest-rights.ts questKindsFor)', () => {
  test('the GM every kind but the Penalty Zone\'s; a player no Job Change and no penalty', () => {
    expect(questKindsFor('gm', null)).toEqual([...GM_QUEST_KINDS]);
    expect(questKindsFor('gm', null)).not.toContain('penalty');
    expect(questKindsFor('player', null)).toEqual([...PLAYER_QUEST_KINDS]);
    expect(questKindsFor('player', null).some(k => k === 'job' || k === 'penalty')).toBe(false);
  });
  test('a quest being edited keeps its kind on offer', () => {
    expect(questKindsFor('gm', { kind: 'penalty' })).toContain('penalty');
    expect(questKindsFor('player', { kind: 'job' })).toContain('job');
  });
  test('every kind a form offers is a kind a quest may be', () => {
    for (const k of [...GM_QUEST_KINDS, ...PLAYER_QUEST_KINDS]) expect(QUEST_KINDS).toContain(k);
  });
});

describe('a quest that counts by itself, and what failing costs (feature 1\'s notes 17.14)', () => {
  const ENV = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-me') };
  const beasts = (target: number, within: 'ever' | 'session' | 'row' = 'ever'): Objective => ({ label: 'Beasts defeated', target, progress: 0,
    count: { rule: { on: 'kill' as const, where: [{ field: 'type', op: '=' as const, value: 'Beast' }], measure: { of: 'facts' as const }, within }, mark: '' } });
  const kill = (type: string) => ({ kind: 'kill' as const, monster: 'Wolf', rank: 'E' as const, type, mkind: 'normal' as const, above: 0, hpPct: 50, payback: false, where: 'fight' as const });
  const counted = (o: Partial<Quest> = {}): Quest => ({ ...questIn('active'), id: qid('q7'), kind: 'side', title: 'Ten Beasts', from: 'gm', objectives: [beasts(3)], rewards: { ...newRewards(), gold: 40 }, ...o }) as Quest;
  const saveWith = (q: Quest): Save => ({ ...freshSave(ENV, { onboarded: true }), hunters: [{ ...hunterWith(q), gold: 100 }] });
  const ctx = (o: Partial<NoticeCtx> = {}): NoticeCtx => ({ at: AT, today: day('2026-11-14'), session: 2, held: () => false, R: RULES, feats: [], ...o });
  const write = (s: Save, facts: readonly Fact[], c = ctx()): Save => noticed({ ...s, hunters: s.hunters.map(h => record(h, ...facts)) }, () => c);
  const quest = (s: Save) => s.hunters[0]!.quests.find(q => q.id === 'q7')!;

  test('three Beasts defeated complete it in the write of the third, with its reward and its quest fact; a Goblin moves nothing', () => {
    let s = write(saveWith(counted()), [kill('Beast'), kill('Humanoid')]);
    expect(quest(s).objectives[0]!.progress).toBe(1);
    expect(quest(s).status).toBe('active');
    s = write(s, [kill('Beast'), kill('Beast')]);
    expect(quest(s).status).toBe('done');
    expect(quest(s).objectives[0]!.progress).toBe(3);
    expect(s.hunters[0]!.gold, 'its reward, given by finishQuest').toBe(140);
    expect(s.hunters[0]!.chronicle.facts.filter(f => f.kind === 'quest').map(f => (f as { end: string }).end)).toEqual(['done']);
    expect(s.hunters[0]!.chronicle.inbox).toEqual([]);
  });
  test('a count within a session starts again in a new session; a full objective is not counted again', () => {
    let s = write(saveWith(counted({ objectives: [beasts(3, 'session'), { label: 'Report back', target: 1, progress: 0 }] })), [kill('Beast'), kill('Beast')], ctx({ session: 2 }));
    expect(quest(s).objectives[0]!.progress).toBe(2);
    s = write(s, [kill('Beast')], ctx({ session: 3 }));
    expect(quest(s).objectives[0]!.progress, 'a new session counts from 1').toBe(1);
    s = write(s, [kill('Beast'), kill('Beast'), kill('Beast')], ctx({ session: 3 }));
    expect(quest(s).objectives[0]!.progress).toBe(3);
    expect(quest(s).status, 'the objective moved by taps is not full').toBe('active');
    expect(write(s, [kill('Beast')], ctx({ session: 4 })).hunters[0]!.quests[0]!.objectives[0]!.progress, 'a full objective stays full').toBe(3);
  });
  test('a quest the System completes waits, untold, for its window; a tapped one is told at once', () => {
    const s = write(saveWith(counted({ objectives: [beasts(1)] })), [kill('Beast')]);
    expect(questNews(s.hunters[0]!).map(q => q.id)).toEqual(['q7']);
    const told = questTold(s.hunters[0]!, 'q7');
    expect(questNews(told)).toEqual([]);
    expect(questTold(told, 'q7'), 'a second answer changes nothing').toBe(told);
    expect(questTold(told, 'q404'), 'nor one for a quest gone').toBe(told);
    const byTap = ok(finishQuest(saveWith(counted({ objectives: [{ label: 'Report', target: 1, progress: 1 }] })), 'h1', 'q7', { at: AT, today: day('2026-11-14'), R: RULES, vitals: 'sheet' }));
    expect(questNews(byTap.save.hunters[0]!)).toEqual([]);
  });
  test('a GM\'s daily the System counts shows its window on day 2 as on day 1 (SMX-gates-4.2)', () => {
    const daily = counted({ kind: 'daily', objectives: [beasts(1)] });
    const checked = (sv: Save, d: string): Save => ({ ...sv, world: { ...sv.world, lastDailyKey: day(d) }, hunters: sv.hunters.map(h => ({ ...h, daily: { ...h.daily, lastCheckedKey: day(d) } })) });
    let s = write(checked(saveWith(daily), '2026-11-14'), [kill('Beast')]);
    expect(questNews(s.hunters[0]!).map(q => q.title), 'day 1').toEqual(['Ten Beasts']);
    s = { ...s, hunters: [questTold(s.hunters[0]!, 'q7')] };
    s = rollover(s, { today: day('2026-11-15'), at: '2026-11-15T10:00:00.000Z', nowMs: Date.parse('2026-11-15T10:00:00.000Z'), gm: false }).save;
    expect(quest(s).status, 'reset in place, the same id').toBe('active');
    s = write(s, [kill('Beast')], ctx({ at: '2026-11-15T11:00:00.000Z', today: day('2026-11-15') }));
    expect(questNews(s.hunters[0]!).map(q => q.title), 'day 2').toEqual(['Ten Beasts']);
  });
  test('a counted objective refuses a tap; a quest with none is never completed by the System', () => {
    expect(setProgress(hunterWith(counted()), 'q7', 0, 2)).toEqual({ ok: false, why: 'not-now' });
    const byHand = counted({ objectives: [{ label: 'Beasts', target: 1, progress: 1 }] });
    expect(COMPLETER[completerOf(byHand)].counted).toBe(false);
    expect(quest(write(saveWith(byHand), [kill('Beast')])).status).toBe('active');
  });
  test('a GM\'s counted quest on a player\'s phone in a room posts its end once, in the write that completes it', () => {
    const room = parseRoomCode('ABC234')!;
    const s = write(saveWith(counted({ objectives: [beasts(1)] })), [kill('Beast')], ctx({ room }));
    const box = s.settings.sync.outbox ?? [];
    expect(box).toHaveLength(1);
    const e = box[0]!.letter as { kind: 'event'; event: { type: string; payload: { status: string; questId: string } } };
    expect(e.event.type).toBe('questUpdate');
    expect(e.event.payload).toMatchObject({ status: 'done', questId: 'q7' });
    expect(write(saveWith(counted({ objectives: [beasts(1)] })), [kill('Beast')]).settings.sync.outbox ?? [], 'alone or the GM: nothing posted').toEqual([]);
  });
  test('a failed quest pays its cost in the failing write; the rollover pays an overdue quest\'s cost the same way', () => {
    const cost = { ...newRewards(), gold: -30 };
    const day0 = { at: AT, today: day('2026-11-14'), R: RULES, vitals: 'sheet' as const };
    const f = ok(questFailed(saveWith(counted({ onFail: cost })), 'h1', 'q7', day0));
    expect(quest(f.save).status).toBe('failed');
    expect(f.save.hunters[0]!.gold).toBe(70);
    expect(f.granted.lines).toEqual(['Loses 30 gold']);
    const urgent = counted({ kind: 'urgent', dueAt: '2026-11-14T09:00:00.000Z', onFail: cost });
    const r = rolledOver(saveWith(urgent), { ...day0, nowMs: Date.parse(AT), gm: false, vitals: () => 'sheet', room: null });
    expect(quest(r.save).status).toBe('failed');
    expect(r.save.hunters[0]!.gold).toBe(70);
    expect(r.failed.map(f => [f.hid, f.qid, f.granted.lines])).toEqual([['h1', 'q7', ['Loses 30 gold']]]);
  });
  test('two urgent quests that run out at once each carry their own cost (SMX-gates-3.3)', () => {
    const day0 = { at: AT, today: day('2026-11-14'), R: RULES, vitals: () => 'sheet' as const, nowMs: Date.parse(AT), gm: false, room: null };
    const due = '2026-11-14T09:00:00.000Z';
    const a = counted({ id: qid('q7'), kind: 'urgent', title: 'Hold the bridge', dueAt: due, onFail: { ...newRewards(), gold: -30 } });
    const b = counted({ id: qid('q8'), kind: 'urgent', title: 'Guard the gate', dueAt: due, onFail: { ...newRewards(), gold: -5 } });
    const r = rolledOver({ ...saveWith(a), hunters: [{ ...hunterWith(a, b), gold: 100 }] }, day0);
    expect(r.failed.map(f => [f.title, f.granted.lines])).toEqual([['Hold the bridge', ['Loses 30 gold']], ['Guard the gate', ['Loses 5 gold']]]);
    expect(r.save.hunters[0]!.gold).toBe(65);
  });
  test('a GM\'s urgent quest that runs out on a player\'s phone in a room is not posted to the room, as today (SMX-gates-3.3 waits on its ruling)', () => {
    const room = parseRoomCode('ABC234')!;
    const urgent = counted({ kind: 'urgent', dueAt: '2026-11-14T09:00:00.000Z' });
    const r = rolledOver(saveWith(urgent), { at: AT, today: day('2026-11-14'), R: RULES, vitals: () => 'sheet', nowMs: Date.parse(AT), gm: false, room });
    expect(ROOM_HEARS).toEqual({ counted: true, overdue: false });
    expect(quest(r.save).status).toBe('failed');
    expect(r.save.settings.sync.outbox ?? []).toEqual([]);
  });
  test('the post a quest\'s end makes, done or failed, carries the quest as it ended, so the ruling is one row', () => {
    const room = parseRoomCode('ABC234')!;
    const failed = ok(questStep({ ...questIn('active'), id: qid('q7'), from: 'gm', title: 'Hold the bridge' }, 'fail', AT));
    if (failed.status === 'active') throw new Error('not ended');
    const s = questEnded(saveWith(failed), hid('h1'), failed, { at: AT, room });
    const box = s.settings.sync.outbox ?? [];
    expect(box).toHaveLength(1);
    const e = box[0]!.letter as { kind: 'event'; event: { type: string; payload: { status: string; questId: string; objectives: unknown } } };
    expect(e.event.type).toBe('questUpdate');
    expect(e.event.payload).toMatchObject({ status: 'failed', questId: 'q7', objectives: [{ label: 'Goblins', progress: 1, target: 3 }] });
    expect(questEnded(s, hid('h1'), failed, { at: AT, room }).settings.sync.outbox, 'posted again it replaces itself').toHaveLength(1);
  });
  test('the count and the cost survive the save\'s repair and the room\'s quest message; a count that does not read leaves a row moved by taps', () => {
    const q = counted({ onFail: { ...newRewards(), xp: -20 } });
    const back = repairSave({ ...saveWith(q) }, ENV).hunters[0]!.quests[0]!;
    expect(back.objectives[0]!.count).toEqual(q.objectives[0]!.count!);
    expect(back.onFail.xp).toBe(-20);
    const offer = questOffer({ ...q, objectives: [...q.objectives, { label: 'Junk', target: 2, count: { rule: { on: 'kill', where: [{ field: 'nope', op: '=', value: 1 }] } } }] }, null);
    expect(offer.objectives.map(o => !!o.count)).toEqual([true, false]);
    expect(offer.onFail.xp).toBe(-20);
  });
});

describe('the Quests view\'s quest form (quest-form.ts, SMX-views-4)', () => {
  const closed = QUEST_FORM_CLOSED;
  const asNew: QuestFormState = { at: 'new', role: 'player', hid: hid('h1') };
  const editing: QuestFormState = { at: 'editing', role: 'gm', hid: hid('h1'), qid: qid('q1') };
  const opensNew: QuestFormEvent = { type: 'new', role: 'gm', hid: hid('h2') };
  const opensEdit: QuestFormEvent = { type: 'edit', role: 'player', hid: hid('h2'), qid: qid('q2') };
  // Every state against every event: the form it leads to. `seen` is the screen as it is now: the form's own role and
  // hunter leave it, another of either closes it.
  const rows: [string, QuestFormState, string, QuestFormEvent, QuestFormState][] = [
    ['closed', closed, 'New quest', opensNew, { at: 'new', role: 'gm', hid: hid('h2') }],
    ['closed', closed, 'Edit', opensEdit, { at: 'editing', role: 'player', hid: hid('h2'), qid: qid('q2') }],
    ['closed', closed, 'saved', { type: 'saved' }, closed],
    ['closed', closed, 'Cancel', { type: 'cancelled' }, closed],
    ['closed', closed, 'seen', { type: 'seen', role: 'gm', hid: hid('h2') }, closed],
    ['new', asNew, 'New quest', opensNew, { at: 'new', role: 'gm', hid: hid('h2') }],
    ['new', asNew, 'Edit', opensEdit, { at: 'editing', role: 'player', hid: hid('h2'), qid: qid('q2') }],
    ['new', asNew, 'saved', { type: 'saved' }, closed],
    ['new', asNew, 'Cancel', { type: 'cancelled' }, closed],
    ['new', asNew, 'seen as it was', { type: 'seen', role: 'player', hid: hid('h1') }, asNew],
    ['new', asNew, 'seen with another hunter', { type: 'seen', role: 'player', hid: hid('h2') }, closed],
    ['new', asNew, 'seen as the GM', { type: 'seen', role: 'gm', hid: hid('h1') }, closed],
    ['editing', editing, 'New quest', opensNew, { at: 'new', role: 'gm', hid: hid('h2') }],
    ['editing', editing, 'Edit', opensEdit, { at: 'editing', role: 'player', hid: hid('h2'), qid: qid('q2') }],
    ['editing', editing, 'saved', { type: 'saved' }, closed],
    ['editing', editing, 'Cancel', { type: 'cancelled' }, closed],
    ['editing', editing, 'seen as it was', { type: 'seen', role: 'gm', hid: hid('h1') }, editing],
    ['editing', editing, 'seen with another hunter', { type: 'seen', role: 'gm', hid: hid('h2') }, closed],
    ['editing', editing, 'seen as a player', { type: 'seen', role: 'player', hid: hid('h1') }, closed],
  ];
  for (const [from, s, what, e, to] of rows) test(`${from} + ${what}: ${to.at}`, () => { expect(questFormStep(s, e)).toEqual(to); });
});
