import { describe, expect, test } from 'bun:test';
import { NO_TOLD, TOLD_MAX, TOLD_STATES, gateNews, gateTold, hunterNews, parseTold, toldAt, toldFor, toldStep } from '../src/core/told.ts';
import type { ToldAt, ToldEvent, ToldHunter, ToldMemory, ToldTopic } from '../src/core/told.ts';
import { newHunter } from '../src/core/hunter/hunter.ts';
import type { HunterId } from '../src/core/ids.ts';
import type { PersonalGate } from '../src/core/gates/personal.ts';
import { gid } from './models/gate-events.ts';

/** Hunter `id` holding feats earned in the order given (`x` earned first) and open personal gates `gates`. */
function hunter(id: string, feats: string[] = [], gates: string[] = []): ToldHunter {
  const h = newHunter();
  const earned = Object.fromEntries(feats.map((k, i) => [k, { at: 'earned' as const, on: `2026-11-0${i + 1}T10:00:00.000Z`, day: '2026-11-01', name: k }]));
  return { ...h, id: id as HunterId, chronicle: { ...h.chronicle, feats: earned as never }, solo: { ...h.solo, gates: gates.map(g => ({ id: g }) as unknown as PersonalGate) } };
}
const shown = (id: string, status: 'detected' | 'broken' = 'detected') => ({ id: gid(id), name: id, rank: 'E' as const, type: 'normal' as const, breakDay: 5, status });
const answered = (campaign: string, topic: ToldTopic, id: string, broke = false): ToldEvent => ({ type: 'answered', campaign, topic, id, broke });

const TOPICS: [string, ToldTopic][] = [['a hunter\'s feat', { of: 'feat', hunter: 'h1' }], ['a hunter\'s personal gate', { of: 'personal', hunter: 'h1' }], ['a room\'s gate', { of: 'room', room: 'ABCD' }]];
/** Campaign "c1"'s record with piece "x" of `topic` in state `at` (a hunter's piece is never unseen: its record starts with the hunter). */
function holding(topic: ToldTopic, at: ToldAt): ToldMemory {
  const start = toldFor('c1', [hunter('h1')]);
  const seen = topic.of === 'room' && at !== 'unseen' ? toldStep(start, { type: 'looked', room: topic.room, gates: [] }) : start;
  return at === 'told' ? toldStep(seen, answered('c1', topic, 'x')) : seen;
}

describe('the told memory of one piece of news (SMX-gates-8)', () => {
  // Every state against every event. A room's first look tells what it sees; nothing but an answer in the record's own
  // campaign tells a piece after that; a replaced campaign forgets it (a hunter's piece that the hunter does not hold).
  const events: [string, (t: ToldTopic) => ToldEvent][] = [
    ['looked at, its room showing it', () => ({ type: 'looked', room: 'ABCD', gates: [shown('x')] })],
    ['answered in this campaign', t => answered('c1', t, 'x')],
    ['answered in the campaign before', t => answered('c0', t, 'x')],
    ['the campaign replaced', () => ({ type: 'replaced', campaign: 'c2', hunters: [hunter('h1')] })],
  ];
  const expected: Record<string, Record<ToldAt, (ToldAt | null)[]>> = {
    hunter: { unseen: [null, null, null, null], untold: ['untold', 'told', 'untold', 'untold'], told: ['told', 'told', 'told', 'untold'] },
    room: { unseen: ['told', 'told', 'unseen', 'unseen'], untold: ['untold', 'told', 'untold', 'unseen'], told: ['told', 'told', 'told', 'unseen'] },
  };
  for (const [what, topic] of TOPICS) {
    const rows = expected[topic.of === 'room' ? 'room' : 'hunter']!;
    for (const at of TOLD_STATES) {
      events.forEach(([name, event], i) => {
        const to = rows[at][i];
        if (!to) return;
        test(`${what}: ${at}, ${name}, is ${to}`, () => {
          expect(toldAt(toldStep(holding(topic, at), event(topic)), topic, 'x')).toBe(to);
        });
      });
    }
  }
  test('a step that changes nothing answers the same record, so the store writes nothing', () => {
    const feat: ToldTopic = { of: 'feat', hunter: 'h1' }, room: ToldTopic = { of: 'room', room: 'ABCD' };
    const m = holding(feat, 'told'), r = holding(room, 'told');
    expect(toldStep(m, answered('c1', feat, 'x'))).toBe(m);
    expect(toldStep(m, answered('c0', feat, 'y'))).toBe(m);
    expect(toldStep(r, answered('c1', room, 'x'))).toBe(r);
    expect(toldStep(r, { type: 'looked', room: 'ABCD', gates: [shown('y')] })).toBe(r);
  });
  test('one hunter\'s feats, its personal gates and another hunter are apart: telling one tells no other', () => {
    const m = toldStep(toldFor('c1', [hunter('h1'), hunter('h2')]), answered('c1', { of: 'feat', hunter: 'h1' }, 'x'));
    expect(toldAt(m, { of: 'feat', hunter: 'h2' }, 'x')).toBe('untold');
    expect(toldAt(m, { of: 'personal', hunter: 'h1' }, 'x')).toBe('untold');
  });
});

describe('a hunter\'s news', () => {
  test('a campaign opened on this phone tells nothing it arrived with: its feats earned and personal gates open are told', () => {
    const h = hunter('h1', ['first_blood', 'early-riser'], ['pg1']), m = toldFor('c1', [h]);
    expect([hunterNews(m, h, 'feat'), hunterNews(m, h, 'personal')]).toEqual([[], []]);
  });
  test('a hunter added to the campaign later has all its news told, its feats oldest first', () => {
    const m = toldFor('c1', [hunter('h1')]), late = hunter('h9', ['b', 'a'], ['pg1']);
    expect([hunterNews(m, late, 'feat'), hunterNews(m, late, 'personal')]).toEqual([['b', 'a'], ['pg1']]);
  });
  test('a piece is news until its window is answered, and then never again', () => {
    const m = toldFor('c1', [hunter('h1')]), h = hunter('h1', ['a', 'b']);
    expect(hunterNews(m, h, 'feat')).toEqual(['a', 'b']);
    expect(hunterNews(toldStep(m, answered('c1', { of: 'feat', hunter: 'h1' }, 'a')), h, 'feat')).toEqual(['b']);
  });
  test('a record the phone could not keep tells nothing, so a blocked storage never asks one window again and again', () => {
    expect(hunterNews(NO_TOLD, hunter('h1', ['a'], ['pg1']), 'feat')).toEqual([]);
    expect(gateNews(toldStep(NO_TOLD, { type: 'looked', room: 'ABCD', gates: [] }), 'ABCD', [shown('g1')])).toEqual([]);
  });
  test('SMX-gates-8.1: a feat told in one campaign is news again when the next campaign earns it', () => {
    const topic: ToldTopic = { of: 'feat', hunter: 'h1' }, earnedIt = hunter('h1', ['first_blood']);
    const old = toldStep(toldFor('c1', [hunter('h1')]), answered('c1', topic, 'first_blood'));
    expect(hunterNews(old, earnedIt, 'feat')).toEqual([]);
    const next = toldStep(old, { type: 'replaced', campaign: 'c2', hunters: [hunter('h1')] });
    expect(hunterNews(next, earnedIt, 'feat')).toEqual(['first_blood']);
  });
  test('SMX-gates-8.1: a window of the campaign before, answered after the replace, does not silence the new campaign', () => {
    const next = toldStep(toldFor('c2', [hunter('h1')]), answered('c1', { of: 'feat', hunter: 'h1' }, 'first_blood'));
    expect(hunterNews(next, hunter('h1', ['first_blood']), 'feat')).toEqual(['first_blood']);
  });
});

describe('a room\'s gate news (SMX-gates-8.2)', () => {
  const room: ToldTopic = { of: 'room', room: 'ABCD' };
  const seen = (): ToldMemory => toldStep(toldFor('c1', []), { type: 'looked', room: 'ABCD', gates: [] });
  test('a first sight of a room tells nothing and takes every gate as told, a broken one as broken, so joining replays no old gate', () => {
    const gates = [shown('g1'), shown('g2', 'broken')], m = toldStep(toldFor('c1', []), { type: 'looked', room: 'ABCD', gates });
    expect([gateNews(toldFor('c1', []), 'ABCD', gates), gateNews(m, 'ABCD', gates)]).toEqual([[], []]);
    expect(m.room.ABCD).toEqual({ ids: ['g1', 'g2'], broken: ['g2'] });
  });
  test('five gates that appeared while the player was away are all news at once, none left for a later look', () => {
    const five = ['g1', 'g2', 'g3', 'g4', 'g5'].map(id => shown(id));
    expect(gateNews(seen(), 'ABCD', five).map(n => n.gate.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
  });
  test('a gate is news until its window is answered; its break is news once more; a gate told broken is not news as appeared', () => {
    const first = gateNews(seen(), 'ABCD', [shown('g1')]);
    expect(first.map(n => [n.kind, n.gate.id])).toEqual([['appeared', 'g1']]);
    const told = toldStep(seen(), gateTold('c1', 'ABCD', first[0]!));
    expect(gateNews(told, 'ABCD', [shown('g1')])).toEqual([]);
    const broke = gateNews(told, 'ABCD', [shown('g1', 'broken')]);
    expect(broke.map(n => n.kind)).toEqual(['broke']);
    expect(gateNews(toldStep(told, gateTold('c1', 'ABCD', broke[0]!)), 'ABCD', [shown('g1', 'broken')])).toEqual([]);
    const wasBroken = toldStep(seen(), answered('c1', room, 'g2', true));
    expect(gateNews(wasBroken, 'ABCD', [shown('g2')])).toEqual([]);
  });
});

describe('the record as stored', () => {
  test('a record reads back as it was written', () => {
    const m = toldStep(toldStep(toldFor('c1', [hunter('h1', ['a'], ['pg1'])]), { type: 'looked', room: 'ABCD', gates: [shown('g1', 'broken')] }), answered('c1', { of: 'personal', hunter: 'h2' }, 'pg2'));
    expect(parseTold(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
  test('no campaign is no record, so the store starts one; junk ids are dropped and a topic keeps its newest ids', () => {
    expect([parseTold(null), parseTold({ feat: {} }), parseTold({ campaign: '' }), parseTold(['c1'])]).toEqual([null, null, null, null]);
    const many = Array.from({ length: TOLD_MAX + 5 }, (_, i) => `k${i}`);
    const r = parseTold({ campaign: 'c1', feat: { h1: [...many, 3, ''] }, room: { R: { ids: ['g1'], broken: 'x' } } });
    expect(r!.feat.h1).toEqual(many.slice(-TOLD_MAX));
    expect([r!.personal, r!.room]).toEqual([{}, {}]);
  });
});
