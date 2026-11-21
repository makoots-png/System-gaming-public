import { describe, expect, test } from 'bun:test';
import { CHRONICLE_MAX, INBOX_MAX, PUSHED_FACTS, newChronicle, parseChronicle, pushedChronicle, record } from '../src/core/hunter/chronicle.ts';
import { FACT_FIELDS, FACT_KINDS, KEPT, parseFact } from '../src/core/hunter/facts.ts';
import type { Fact, FactKind } from '../src/core/hunter/facts.ts';
import { INBOX, noticed, released } from '../src/core/hunter/noticed.ts';
import type { NoticeCtx } from '../src/core/hunter/noticed.ts';
import { grant, sheetEdit } from '../src/core/hunter/grant.ts';
import { completeQuest, failQuest, rollover } from '../src/core/hunter/quests.ts';
import { setRank } from '../src/core/hunter/record.ts';
import { useItem } from '../src/core/hunter/use.ts';
import { putItem } from '../src/core/hunter/inventory.ts';
import { shadowRises } from '../src/core/hunter/shadows.ts';
import { soloTick } from '../src/core/gates/solo.ts';
import { chapterLanded } from '../src/core/story/story.ts';
import { personalGateId } from '../src/core/gates/personal.ts';
import { pushedSheet } from '../src/core/sync/push.ts';
import { rolled } from '../src/core/session-log.ts';
import { dailyQuest, freshSave, newHunter, newRewards, newRollEntry, parseSheetHunter } from '../src/core/save.ts';
import type { Hunter, ParseEnv, Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { SHOP_ITEMS, itemOf } from '../src/core/registry/items.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { dayKey } from '../src/core/day.ts';
import { saveId, seedId } from '../src/core/ids.ts';
import type { HunterId, MonsterId } from '../src/core/ids.ts';
import { SHEET_MAX } from '../src/core/protocol.ts';
import { dev, hid, iid, qid } from './fixtures/ids.ts';

const AT = '2026-11-18T10:00:00.000Z', TODAY = dayKey(new Date(AT), 0);
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-me') };
const H1 = hid('h1'), H2 = hid('h2');
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const mira = (h: Partial<Hunter> = {}): Hunter => ({ ...newHunter(RULES), id: H1, name: 'Mira', ...h });
const saveOf = (...hunters: Hunter[]): Save => ({ ...freshSave(ENV, { onboarded: true }), hunters });
const free = (): boolean => false;
const ctx = (c: Partial<NoticeCtx> = {}): NoticeCtx => ({ at: AT, today: TODAY, session: 4, held: free, R: RULES, feats: [], ...c });
const inbox = (h: Hunter): readonly Fact[] => h.chronicle.inbox;
const hpMax = (h: Hunter): number => hunterSheet(h, RULES).sheet.hpMax;
const level: Fact = { kind: 'level', level: 2 }, roll: Fact = { kind: 'roll', natural: 20 }, title: Fact = { kind: 'title', name: 'Wolf Slayer' };

describe('the notice step', () => {
  test('a write that recorded nothing is the same save, and the context is never asked for', () => {
    const s = saveOf(mira());
    expect(noticed(s, () => { throw new Error('asked'); })).toBe(s);
  });

  test('each fact is stamped with the write\'s moment, counted in the tally and kept when its kind is kept, oldest first', () => {
    const s = noticed(saveOf(record(mira(), level, roll, title)), () => ctx());
    const c = s.hunters[0]!.chronicle;
    expect(c.inbox).toEqual([]);
    expect(c.facts, 'a roll counts and is not kept').toEqual([
      { ...level, at: AT, day: TODAY, session: 4 }, { ...title, at: AT, day: TODAY, session: 4 },
    ]);
    expect([c.tally.levels, c.tally.nat20, c.tally.titles, c.tally.nat1]).toEqual([1, 1, 1, 0]);
  });

  test('the chronicle keeps the newest 40 facts and the tally counts every one', () => {
    let s = saveOf(mira());
    for (let n = 1; n <= CHRONICLE_MAX + 5; n++) s = noticed({ ...s, hunters: [record(s.hunters[0]!, { kind: 'level', level: n })] }, () => ctx());
    const c = s.hunters[0]!.chronicle;
    expect(c.facts).toHaveLength(CHRONICLE_MAX);
    expect(c.facts.map(f => (f.kind === 'level' ? f.level : 0))[0]).toBe(6);
    expect(c.tally.levels).toBe(CHRONICLE_MAX + 5);
  });

  test('a hunter a fight holds keeps its facts until a write in which no fight holds it', () => {
    const held = (_s: Save, id: HunterId): boolean => id === H1;
    const s = noticed(saveOf(record(mira(), level), record({ ...mira(), id: H2 }, title)), () => ctx({ held }));
    const stamp = { at: AT, day: TODAY, session: 4 };
    expect(inbox(s.hunters[0]!), 'held: waiting, stamped by the write it happened in').toEqual([{ ...level, ...stamp }]);
    expect(inbox(s.hunters[1]!), 'free: taken').toEqual([]);
    const more = { ...s, hunters: [record(s.hunters[0]!, roll), s.hunters[1]!] };
    const later = { at: '2026-11-18T10:30:00.000Z', day: TODAY, session: 5 };
    expect(inbox(noticed(more, () => ctx({ held, at: later.at, session: later.session })).hunters[0]!), 'still held: appended, each with its own stamp').toEqual([{ ...level, ...stamp }, { ...roll, ...later }]);
    expect(released(more, held)).toEqual({ ok: false, why: 'unchanged' });
    expect(released(more, free)).toBe(more);
    const after = noticed(more, () => ctx({ at: '2026-11-18T11:00:00.000Z' })).hunters[0]!;
    expect(after.chronicle.facts, 'noticed when let go, at that write\'s moment').toEqual([{ ...level, at: '2026-11-18T11:00:00.000Z', day: TODAY, session: 4 }]);
    expect(after.chronicle.tally.nat20).toBe(1);
    expect(released(noticed(more, () => ctx()), free), 'nothing waits: a repeat writes nothing').toEqual({ ok: false, why: 'unchanged' });
  });
});

describe('a fact in a hunter\'s inbox, a machine (noticed.ts `INBOX`)', () => {
  const now = { at: AT, day: TODAY, session: 4 };
  const NEXT = '2026-11-19T10:00:00.000Z', then = { at: NEXT, day: dayKey(new Date(NEXT), 0), session: 5 };
  const held = (): boolean => true;
  test('every state against every end of a write: recorded or waiting, held or free', () => {
    const waiting = { ...level, ...now };
    expect(INBOX.recorded.held(level, then), 'recorded, held: waits, stamped by this write').toEqual({ ...level, ...then });
    expect(INBOX.recorded.free(level, then), 'recorded, free: taken with this write\'s stamp').toEqual(then);
    expect(INBOX.waiting.held(waiting, then), 'waiting, still held: as it was').toBe(waiting);
    expect(INBOX.waiting.free(waiting, then), 'waiting, freed: taken with the stamp of the write that frees it, as today (SMX-rules-9.1 waits on the day ruling)').toEqual(then);
  });
  test('a held write that records nothing leaves the save as it was', () => {
    const s = noticed(saveOf(record(mira(), level)), () => ctx({ held }));
    expect(noticed(s, () => ctx({ held, at: NEXT, today: then.day, session: 5 }))).toBe(s);
  });
  test('freed on a later day, a waiting fact is kept with the day of the write that frees it, as today (SMX-rules-9.1 waits)', () => {
    const s = noticed(saveOf(record(mira(), level)), () => ctx({ held }));
    const after = noticed(s, () => ctx({ at: NEXT, today: then.day, session: 5 })).hunters[0]!.chronicle;
    expect(after.inbox).toEqual([]);
    expect(after.facts).toEqual([{ ...level, ...then }]);
  });
  test('a waiting fact keeps its stamp through a load; a fact recorded and not yet noticed reads with none', () => {
    const c = parseChronicle({ inbox: [{ ...level, ...now }, roll] });
    expect(c.inbox).toEqual([{ ...level, ...now }, roll]);
  });
});

describe('each fact is recorded by its one writer, in that thing\'s write', () => {
  test('a change of life: a fall, a death save, a revive by the GM or by an item', () => {
    const h = mira();
    const fell = ok(sheetEdit(h, { type: 'life', event: { type: 'damage', amount: hpMax(h) } }, RULES));
    expect(inbox(fell)).toEqual([{ kind: 'life', news: 'fell', how: 'hand', failures: 0 }]);
    const failed = ok(sheetEdit(fell, { type: 'life', event: { type: 'deathSave', roll: 1 } }, RULES));
    expect(inbox(failed).at(-1)).toEqual({ kind: 'life', news: 'failed', how: 'save', failures: 0 });
    expect(KEPT.life({ kind: 'life', news: 'failed', how: 'save', failures: 0 }), 'a death save made or failed is not kept').toBe(false);
    const up = ok(sheetEdit(failed, { type: 'life', event: { type: 'deathSave', roll: 20 } }, RULES));
    expect(inbox(up).at(-1)).toEqual({ kind: 'life', news: 'raised', how: 'save', failures: 2 });
    const dead: Hunter = { ...mira(), life: { at: 'dead' } };
    expect(inbox(ok(sheetEdit(dead, { type: 'life', event: { type: 'revive' } }, RULES)))).toEqual([{ kind: 'life', news: 'raised', how: 'gm', failures: 0 }]);
    expect(inbox(ok(sheetEdit(dead, { type: 'life', event: { type: 'revive' }, by: 'item' }, RULES)))).toEqual([{ kind: 'life', news: 'raised', how: 'item', failures: 0 }]);
    expect(inbox(ok(sheetEdit(h, { type: 'mana', delta: -1 }, RULES))), 'no change of life, no fact').toEqual([]);
  });

  test('a fight\'s totals that take a hunter to 0 HP are a fall from the fight', () => {
    const h = mira();
    expect(inbox(ok(sheetEdit(h, { type: 'totals', life: { at: 'dying', successes: 0, failures: 0 }, mana: h.mana, fatigue: 0, statuses: [] }, RULES)))).toEqual([{ kind: 'life', news: 'fell', how: 'fight', failures: 0 }]);
  });

  test('a rest, short or long; a long rest that brings a stable hunter up is also that life\'s fact', () => {
    expect(inbox(ok(sheetEdit(mira(), { type: 'rest', kind: 'short' }, RULES)))).toEqual([{ kind: 'rest', long: false }]);
    const stable: Hunter = { ...mira(), life: { at: 'stable' } };
    expect(inbox(ok(sheetEdit(stable, { type: 'rest', kind: 'long' }, RULES)))).toEqual([{ kind: 'life', news: 'raised', how: 'rest', failures: 0 }, { kind: 'rest', long: true }]);
  });

  test('a new level, a new rank and a title given', () => {
    const g = ok(grant(saveOf(mira()), H1, { ...newRewards(), xp: 100000 }, null, { at: AT, today: TODAY, R: RULES, vitals: 'sheet' }));
    const h = g.save.hunters[0]!;
    expect(inbox(h)).toEqual([{ kind: 'level', level: h.level }]);
    expect(inbox(setRank(mira(), 'D'))).toEqual([{ kind: 'rank', rank: 'D' }]);
    expect(inbox(setRank(mira(), 'E')), 'the same rank: nothing').toEqual([]);
  });

  test('the day\'s dailies done: the quest\'s end and the streak; a quest failed', () => {
    const h = mira({ quests: [dailyQuest(qid('q5'), RULES, ENV)] });
    const done = ok(completeQuest(h, 'q5', { at: AT, today: TODAY, nextQuestId: qid('q6'), streakBonusEvery: 7 })).hunter;
    expect(inbox(done)).toEqual([{ kind: 'quest', end: 'done', qkind: 'daily', from: 'system', title: h.quests[0]!.title }, { kind: 'daily', streak: 1 }]);
    expect(inbox(ok(failQuest(h, 'q5', AT)).hunter)).toEqual([{ kind: 'quest', end: 'failed', qkind: 'daily', from: 'system', title: h.quests[0]!.title }]);
  });

  test('a missed day takes the streak and issues the penalty; its Penalty Zone quest done lifts it', () => {
    const yesterday = dayKey(new Date(Date.parse(AT) - 86400e3), 0);
    const h = mira({ quests: [dailyQuest(qid('q5'), RULES, ENV)], daily: { streak: 3, lastCompleteKey: null, lastCheckedKey: yesterday } });
    const r = rollover(saveOf(h), { today: TODAY, at: AT, nowMs: Date.parse(AT), gm: false });
    const after = r.save.hunters[0]!;
    expect(inbox(after)).toEqual([{ kind: 'streakLost', streak: 3 }, { kind: 'penaltyIssued', days: 1 }]);
    const zone = after.penalty!.questId;
    const lifted = ok(completeQuest(after, zone, { at: AT, today: TODAY, nextQuestId: qid('q90'), streakBonusEvery: 7 })).hunter;
    expect(inbox(lifted).at(-1)).toEqual({ kind: 'penaltyLifted', days: 1 });
  });

  test('an urgent quest past its due time fails through the one failing step, its fact with it', () => {
    const urgent = { ...dailyQuest(qid('q5'), RULES, ENV), kind: 'urgent' as const, title: 'Hold the bridge', dueAt: '2026-11-18T09:00:00.000Z' };
    const h = mira({ quests: [urgent], daily: { streak: 0, lastCompleteKey: null, lastCheckedKey: TODAY } });
    const r = rollover(saveOf(h), { today: TODAY, at: AT, nowMs: Date.parse(AT), gm: false });
    expect(inbox(r.save.hunters[0]!)).toEqual([{ kind: 'quest', end: 'failed', qkind: 'urgent', from: 'system', title: 'Hold the bridge' }]);
    expect(r.said.map(l => l.text)).toEqual(['Hold the bridge (past due)']);
  });

  test('a consumable used up, a check\'s natural 20, a shadow risen', () => {
    const potion = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Health Potion')!);
    const hurt = putItem(mira({ life: { at: 'up', hp: 1 } }), potion, iid('i5'));
    expect(inbox(ok(useItem(hurt, 'i5', [], RULES)).hunter)).toEqual([{ kind: 'used', item: 'Health Potion', rar: potion.rar }]);
    const check = { ...newRollEntry(), hid: H1, kind: 'check' as const, natural: 20 };
    expect(inbox(ok(rolled(check, RULES)(saveOf(mira()))).hunters[0]!)).toEqual([{ kind: 'roll', natural: 20 }]);
    expect(inbox(ok(rolled({ ...check, natural: 14 }, RULES)(saveOf(mira()))).hunters[0]!), 'neither 1 nor 20').toEqual([]);
    expect(inbox(ok(rolled({ ...check, kind: 'die' }, RULES)(saveOf(mira()))).hunters[0]!), 'not a check').toEqual([]);
    const risen = ok(shadowRises(saveOf(mira()), H1, { rank: 'E', archetype: 'brute', grade: 'Normal', monster: null, name: 'Igris' }, saveId('sh', 9), { at: AT, cap: 200 }, RULES));
    expect(inbox(risen.hunters[0]!)).toEqual([{ kind: 'shadow', name: 'Igris' }]);
  });

  test('a personal gate that closed with its time', () => {
    const goblin = seedId<'m'>('goblin') as MonsterId;
    const gate = { id: personalGateId(1), name: 'Goblin Warren', rank: 'E' as const, monsters: [{ monsterId: goblin, count: 1 }], at: '2026-11-17T08:00:00.000Z', closesAt: '2026-11-18T08:00:00.000Z' };
    const s = saveOf(mira({ solo: { clock: { at: 'off' }, gates: [gate] } }));
    const t = ok(soloTick(s, { now: new Date(AT), R: { ...RULES, solo: { ...RULES.solo, personal: false } }, gm: false, seed: 1 }));
    expect(inbox(t.save.hunters[0]!)).toEqual([{ kind: 'closed', name: 'Goblin Warren', rank: 'E' }]);
  });

  test('a story\'s chapter the GM opened: its window\'s words, and nothing for the hunter it did not go to', () => {
    const words = { title: 'THE DEEP IS PATIENT', line: 'Nothing is asked.' };
    const g = ok(chapterLanded(saveOf(mira(), { ...newHunter(RULES), id: H2, name: 'Brakk' }), H1, { words, rewards: newRewards(), quest: null }, { at: AT, today: TODAY, R: RULES, vitals: 'sheet' }));
    expect(g.save.hunters.map(inbox)).toEqual([[{ kind: 'chapter', title: 'THE DEEP IS PATIENT', line: 'Nothing is asked.' }], []]);
  });
});

describe('the boundary', () => {
  test('a fact reads back whole; one with a field that does not read is refused, not guessed', () => {
    const all: Fact[] = [level, roll, title, { kind: 'gate', name: 'Den', rank: 'C', above: 1, toBreak: null }, { kind: 'shop', act: 'sell', item: 'Rope', rar: 'common', price: 3, goldAfter: 40 }];
    for (const f of all) expect(parseFact(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(parseFact({ kind: 'roll' })).toBeNull();
    expect(parseFact({ kind: 'gate', name: 'Den', rank: 'Z', above: 1, toBreak: null }), 'a rank that is none').toBeNull();
    expect(parseFact({ kind: 'nothing' })).toBeNull();
    expect(parseFact({ ...level, level: 2.6 }), 'a number is whole').toEqual({ kind: 'level', level: 3 });
  });

  test('every kind has a field table and a keep rule', () => {
    for (const k of FACT_KINDS) { expect(FACT_FIELDS[k as FactKind]).toBeDefined(); expect(typeof KEPT[k as FactKind]).toBe('function'); }
  });

  test('a stored chronicle that does not read is empty; a bad fact in one is dropped', () => {
    expect(parseChronicle('junk')).toEqual(newChronicle());
    const c = parseChronicle({ inbox: [level, { kind: 'x' }], facts: [{ ...title, at: AT, day: TODAY, session: 2 }, title], tally: { levels: 3, nat1: -4, x: 9 } });
    expect(c.inbox).toEqual([level]);
    expect(c.facts, 'a kept fact needs its stamp').toEqual([{ ...title, at: AT, day: TODAY, session: 2 }]);
    expect([c.tally.levels, c.tally.nat1]).toEqual([3, 0]);
    expect(Object.keys(c.tally)).not.toContain('x');
    expect(parseChronicle({ inbox: Array.from({ length: INBOX_MAX + 3 }, () => level) }).inbox).toHaveLength(INBOX_MAX);
  });

  test('the sheet push carries the tally and the last 8 kept facts, and a worst chronicle stays within a quarter of the room\'s bound', () => {
    // the largest kind is a fight's, every number at its bound and every text at its length
    const B = 1e9;
    const fat: Fact = {
      kind: 'fight', outcome: 'ended', rounds: 1000, up: false, downs: B, low: 100, endPct: 100, exactOne: false, struck: B, hits: B, crits: B, critRun: B, avoided: B,
      dealt: B, taken: B, healed: B, raised: B, hexes: B, kills: B, bosses: B, turnKills: B, items: B, allies: B, alliesDown: B, sideUp: B, foes: B, foeTop: -5, bossTop: -5,
      gate: 'G'.repeat(60), names: 'N'.repeat(80),
    };
    const kept = Array.from({ length: CHRONICLE_MAX }, () => ({ ...fat, at: AT, day: TODAY, session: 999999 }));
    const tally = Object.fromEntries(Object.keys(newChronicle().tally).map(k => [k, 1e9])) as Hunter['chronicle']['tally'];
    const h = mira({ chronicle: { inbox: [level], facts: kept, tally, feats: {} } });
    const sent = pushedSheet(h);
    expect(sent.chronicle).toEqual(pushedChronicle(h.chronicle));
    expect(sent.chronicle.facts).toEqual(kept.slice(-PUSHED_FACTS));
    expect(sent.chronicle.inbox).toEqual([]);
    const size = JSON.stringify(sent.chronicle).length;
    expect(size, `the worst pushed chronicle is ${size} characters`).toBeLessThan(SHEET_MAX / 4);
    const back = parseSheetHunter(JSON.parse(JSON.stringify(sent)));
    expect(back!.chronicle).toEqual(sent.chronicle);
  });
});
