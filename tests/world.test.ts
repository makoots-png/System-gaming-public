import { describe, expect, test } from 'bun:test';
import { BREAK_CHECK, advanceDay, checkBreaks, dayStep, sessionStarted, worldDocUnmerged, clearGate, closeGate, deleteGate, editGate, encounterEnded, enterGate, gateFightStarted, mergeWorld, spawnGate, worldDoc, worldEmptyWords } from '../src/core/gates/world.ts';
import { DOCS, WORLD_GATES, WORLD_NAME_MAX } from '../src/core/protocol.ts';
import type { WorldChange, WorldDayEvent, WorldParts } from '../src/core/gates/world.ts';
import { newSave, newMonster } from '../src/core/save.ts';
import { parseGate } from '../src/core/gates/gate.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { told } from '../src/core/session-log.ts';
import { den, gid, mid } from './models/gate-events.ts';
import { dev } from './fixtures/ids.ts';

const stamp = { at: '2026-11-14T10:00:00.000Z', cap: 200 };
/** A save on world day 3 holding the Goblin Den (breaks on day 5, 150 XP), detected. */
const world = (): WorldParts => ({ ...newSave(dev('d')), world: { day: 3, lastDailyKey: null, session: 0 }, gates: [den('detected')] });
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const titles = (s: WorldParts) => s.log.map(l => l.title);

describe('the session log', () => {
  test('a line takes the next seq as its id and goes first; the log keeps at most its cap', () => {
    const s = { ...newSave(dev('d')), seq: 41 };
    const one = told(s, stamp, { kind: 'gate', hunterId: null, title: 'A', text: 'a' });
    expect(one.log[0]).toEqual({ id: 'l42', at: stamp.at, kind: 'gate', hunterId: null, title: 'A', text: 'a' });
    expect(one.seq).toBe(42);
    const two = told(one, { ...stamp, cap: 1 }, { kind: 'gate', hunterId: null, title: 'B', text: '' });
    expect(two.log.map(l => l.id)).toEqual(['l43']);
  });
  test('two lines at once: the last given is the newest', () => {
    const s = told(newSave(dev('d')), stamp, { kind: 'gate', hunterId: null, title: 'first', text: '' }, { kind: 'gate', hunterId: null, title: 'second', text: '' });
    expect(titles(s as WorldParts)).toEqual(['second', 'first']);
  });
});

describe('the world day', () => {
  test('reaching the break day breaks the gate and logs the break after the day\'s own line', () => {
    const r = ok(advanceDay(world(), 2, stamp));
    expect(r.save.world.day).toBe(5);
    expect(r.save.gates[0]!.status).toBe('broken');
    expect(r.broke.map(g => g.id)).toEqual([gid('g-den')]);
    expect(titles(r.save)).toEqual(['DUNGEON BREAK', 'World day']);
  });
  test('a day before the break day changes only the day, and the line says how far it moved', () => {
    const r = ok(advanceDay(world(), 1, stamp));
    expect(r).toMatchObject({ day: 4, by: 1, broke: [] });
    expect(r.save.gates).toEqual(world().gates);
    expect(r.save.log.map(l => [l.title, l.text])).toEqual([['World day', 'Day advanced by 1 to 4.']]);
  });
  test('a move back never goes under day 1, and says the days it really moved', () => {
    const r = ok(advanceDay(world(), -30, stamp));
    expect(r).toMatchObject({ day: 1, by: -2 });
    expect(r.save.log[0]!.text).toBe('Day moved back by 2 to 1.');
  });
  test('a move that leaves the day where it was is refused and logs nothing: no days, or back from day 1', () => {
    expect(advanceDay(world(), 0, stamp)).toEqual({ ok: false, why: 'unchanged' });
    const first = ok(advanceDay(world(), -5, stamp)).save;
    expect(advanceDay(first, -1, stamp)).toEqual({ ok: false, why: 'unchanged' });
  });
  test('forward then back by the same days gives the day back but not the broken gate (a break is not undone)', () => {
    const fwd = ok(advanceDay(world(), 2, stamp)).save, back = ok(advanceDay(fwd, -2, stamp)).save;
    expect(back.world.day).toBe(3);
    expect(back.gates[0]!.status).toBe('broken');
  });
});

describe('the world day\'s moves (SMX-gates-7)', () => {
  // Each move against day 3 (and day 1 for a move back): the day it reaches and the change it is, or null when the day stays.
  const rows: [string, number, WorldDayEvent, { day: number; change: string } | null][] = [
    ['forward 2 days', 3, { type: 'moved', by: 2 }, { day: 5, change: 'forward' }],
    ['forward 2.7 days, a whole number of days', 3, { type: 'moved', by: 2.7 }, { day: 5, change: 'forward' }],
    ['back 1 day', 3, { type: 'moved', by: -1 }, { day: 2, change: 'back' }],
    ['back 30 days, never under day 1', 3, { type: 'moved', by: -30 }, { day: 1, change: 'back' }],
    ['no days', 3, { type: 'moved', by: 0 }, null],
    ['a number that is not one', 3, { type: 'moved', by: Number.NaN }, null],
    ['back from day 1', 1, { type: 'moved', by: -1 }, null],
    ['another GM phone\'s later day', 3, { type: 'merged', day: 7 }, { day: 7, change: 'merged' }],
    ['another GM phone\'s same day', 3, { type: 'merged', day: 3 }, null],
    ['another GM phone\'s earlier day, never back', 3, { type: 'merged', day: 1 }, null],
  ];
  for (const [what, day, e, to] of rows) test(`on day ${day}, ${what}: ${to ? `day ${to.day}, ${to.change}` : 'the day stays'}`, () => expect(dayStep(day, e)).toEqual(to));

  // The den breaks on day 5; on day 6 it is open past its break day, with nobody in it (detected) or a party in it
  // (raiding). Each change runs the one check. The owner, Nov 22 (SMX-gates-7.1, 7.2): the day may go back, and a gate an
  // edit leaves past its break day does not break while someone is in it, and breaks at once when nobody is.
  const past = (status: 'detected' | 'raiding'): WorldParts => ({ ...world(), world: { day: 6, lastDailyKey: null, session: 0 }, gates: [den(status)] });
  const checks: [WorldChange, 'detected' | 'raiding', string, 'broken' | 'detected' | 'raiding'][] = [
    ['forward', 'detected', 'a move forward breaks it', 'broken'],
    ['forward', 'raiding', 'a move forward breaks it', 'broken'],
    ['back', 'detected', 'a move back leaves it as it is', 'detected'],
    ['back', 'raiding', 'a move back leaves it as it is', 'raiding'],
    ['merged', 'detected', 'a merged world breaks it, nobody being in it', 'broken'],
    ['merged', 'raiding', 'a merged world leaves it open while a party is in it', 'raiding'],
    ['edited', 'detected', 'the GM\'s edit breaks it, nobody being in it', 'broken'],
    ['edited', 'raiding', 'the GM\'s edit leaves it open while a party is in it', 'raiding'],
  ];
  for (const [change, before, what, status] of checks) {
    test(`an open gate past its break day, ${before}, ${change}: ${what}`, () => {
      const r = checkBreaks(past(before), change, stamp);
      expect([BREAK_CHECK[change][before], r.save.gates[0]!.status, r.broke.length]).toEqual([status === 'broken' ? 'break' : 'keep', status, status === 'broken' ? 1 : 0]);
    });
  }
  test('the GM\'s edit of a break day to today breaks a gate nobody is in, and a merged later day breaks it too (SMX-gates-7.2)', () => {
    const edited = ok(editGate(world(), 'g-den', { name: 'Goblin Den', rank: 'E', type: 'normal', breakDay: 3, monsters: [], bossId: null, notes: '', mapId: null, status: 'detected', solo: false }, stamp));
    expect(edited.gates[0]).toMatchObject({ breakDay: 3, status: 'broken' });
    const merged = mergeWorld(world(), { day: 10, gates: [] }, () => null, stamp);
    expect([merged.world.day, merged.gates[0]!.status]).toEqual([10, 'broken']);
  });
  test('the GM\'s edit of a break day to today leaves a gate a party is in open (SMX-gates-7.2)', () => {
    const edited = ok(editGate({ ...world(), gates: [den('raiding')] }, 'g-den', { name: 'Goblin Den', rank: 'E', type: 'normal', breakDay: 3, monsters: [], bossId: null, notes: '', mapId: null, status: 'raiding', solo: false }, stamp));
    expect(edited.gates[0]).toMatchObject({ breakDay: 3, status: 'raiding' });
  });
});

describe('a session started', () => {
  test('the first session is session 1: the count, the day and its line move in one step', () => {
    const r = ok(sessionStarted(world(), true, stamp));
    expect(r).toMatchObject({ session: 1, day: 4, by: 1, broke: [] });
    expect(r.save.world).toMatchObject({ day: 4, session: 1 });
    expect(r.save.log.map(l => [l.kind, l.title, l.text])).toEqual([['system', 'Session 1 began', 'A backup was saved. World day 4.'], ['gate', 'World day', 'Day advanced by 1 to 4.']]);
  });
  test('the next session counts on from the save, however many lines the log has dropped', () => {
    let s: WorldParts = { ...world(), world: { day: 3, lastDailyKey: null, session: 0 } };
    for (let i = 0; i < 3; i++) s = ok(sessionStarted(s, true, { ...stamp, cap: 1 })).save;
    expect(s.log.map(l => l.title)).toEqual(['Session 3 began']);
    expect(ok(sessionStarted(s, true, { ...stamp, cap: 1 })).session).toBe(4);
  });
  test('a session on the break day breaks the gate in the same step', () => {
    const r = ok(sessionStarted({ ...world(), world: { day: 4, lastDailyKey: null, session: 6 } }, true, stamp));
    expect(r.session).toBe(7);
    expect(r.broke.map(g => g.id)).toEqual([gid('g-den')]);
    expect(titles(r.save)).toEqual(['Session 7 began', 'DUNGEON BREAK', 'World day']);
  });
  test('when the browser refused the backup, the line says so', () => {
    expect(ok(sessionStarted(world(), false, stamp)).save.log[0]!.text).toBe('No backup: this browser refused to store it. World day 4.');
  });
});

describe('a gate on the list', () => {
  test('a spawned gate goes first, its made monsters join the save, and it is logged', () => {
    const g = { ...den('detected'), id: gid('g9'), name: 'Pit' }, m = { ...newMonster(), id: mid('m9'), name: 'E-rank Gate Boss' };
    const s = spawnGate(world(), g, [m], stamp);
    expect(s.gates.map(x => x.id)).toEqual([gid('g9'), gid('g-den')]);
    expect(s.monsters.map(x => x.id)).toEqual(['m9']);
    expect(s.log[0]!.text).toBe('E-rank normal gate "Pit" appeared. It breaks on day 5.');
  });
  test('spawn then delete leaves the gates as they were; the made monsters and the log line stay', () => {
    const start = world(), g = { ...den('detected'), id: gid('g9') }, m = { ...newMonster(), id: mid('m9') };
    const back = ok(deleteGate(spawnGate(start, g, [m], stamp), 'g9'));
    expect(back.gates).toEqual(start.gates);
    expect(back.monsters.map(x => x.id)).toEqual(['m9']);
    expect(titles(back)).toEqual(['Gate detected']);
  });
  test('entering a detected gate raids it; entering again is refused', () => {
    const s = ok(enterGate(world(), 'g-den', stamp));
    expect(s.gates[0]!.status).toBe('raiding');
    expect(titles(s)).toEqual(['Gate entered']);
    expect(enterGate(s, 'g-den', stamp)).toEqual({ ok: false, why: 'unchanged' });
  });
  test('a fight started in a raided gate keeps its status and is logged', () => {
    const raided = { ...world(), gates: [den('raiding')] }, s = ok(gateFightStarted(raided, 'g-den', stamp));
    expect(s.gates[0]!.status).toBe('raiding');
    expect(titles(s)).toEqual(['Fight started']);
  });
  test('closing a gate closes it once', () => {
    const s = ok(closeGate(world(), 'g-den', stamp));
    expect(s.gates[0]!.status).toBe('closed');
    expect(closeGate(s, 'g-den', stamp)).toEqual({ ok: false, why: 'unchanged' });
  });
  test('a gate that is not there is refused', () => {
    expect(enterGate(world(), 'g-x', stamp)).toEqual({ ok: false, why: 'missing' });
    expect(deleteGate(world(), 'g-x')).toEqual({ ok: false, why: 'missing' });
  });
});

describe('a Clear', () => {
  const pay = { due: 150, xp: 75, gold: 12, items: ['Mana Crystal'], payees: ['Ana', 'Bo'] };
  test('clears on today\'s day, counts the XP it owed as paid, and logs who got what', () => {
    const s = ok(clearGate(world(), 'g-den', pay, stamp)), g = s.gates[0]!;
    expect(g).toMatchObject({ status: 'cleared', clearedDay: 3, xpPaid: 150 });
    expect(s.log[0]!.text).toBe('E-rank gate "Goblin Den" cleared. Ana, Bo rewarded: +75 XP, 12 gold, Mana Crystal.');
  });
  test('with no one paid, the XP stays owed', () => {
    const s = ok(clearGate(world(), 'g-den', { ...pay, xp: 0, gold: 0, items: [], payees: [] }, stamp));
    expect(s.gates[0]!.xpPaid).toBe(0);
    expect(s.log[0]!.text).toContain('No one rewarded');
  });
  test('a fight\'s award inside the gate counts as paid', () => {
    const s = encounterEnded(world(), { gateId: 'g-den', paid: 60, text: '3 defeated, 60 XP awarded (30 each).' }, stamp);
    expect(s.gates[0]!.xpPaid).toBe(60);
    expect(s.log[0]).toMatchObject({ kind: 'combat', title: 'Fight ended' });
  });
});

describe('the GM\'s edit', () => {
  const edit = { name: '  Den II ', rank: 'D' as const, type: 'red' as const, breakDay: 9, monsters: [{ monsterId: mid('m-goblin'), count: 2 }], bossId: null, notes: 'x', mapId: 'mp-none', status: 'raiding' as const, solo: true };
  test('writes the fields and the status; a map the library lacks is none', () => {
    const g = ok(editGate(world(), 'g-den', edit, stamp)).gates[0]!;
    expect(g).toMatchObject({ name: 'Den II', rank: 'D', type: 'red', breakDay: 9, bossId: null, notes: 'x', mapId: null, status: 'raiding', solo: true });
  });
  test('an empty name and a break day of 0 keep the old ones; a break day under 0 is day 1', () => {
    const g = ok(editGate(world(), 'g-den', { ...edit, name: ' ', breakDay: 0 }, stamp)).gates[0]!;
    expect(g).toMatchObject({ name: 'Goblin Den', breakDay: 5 });
    expect(ok(editGate(world(), 'g-den', { ...edit, breakDay: -4 }, stamp)).gates[0]!.breakDay).toBe(1);
  });
  test('an edit to the same values leaves the gate as it was', () => {
    const d = den('detected'), same = { name: d.name, rank: d.rank, type: d.type, breakDay: d.breakDay, monsters: d.monsters, bossId: d.bossId, notes: d.notes, mapId: null, status: d.status, solo: d.solo };
    expect(ok(editGate(world(), 'g-den', same, stamp)).gates).toEqual(world().gates);
  });
});

describe('another GM phone\'s world', () => {
  test('the later day wins, a known gate takes the doc\'s fields, a new one is added, none is deleted', () => {
    const start = { ...world(), gates: [den('detected'), { ...den('detected'), id: gid('g-mine'), name: 'Mine' }] };
    const doc = { day: 7, gates: [{ id: 'g-den', name: 'Den', rank: 'E' as const, type: 'normal' as const, status: 'closed' as const, breakDay: 5 },
      { id: 'g-new', name: 'New', rank: 'C' as const, type: 'red' as const, status: 'detected' as const, breakDay: 9 }] };
    const s = mergeWorld(start, doc, (g, day) => parseGate({ ...g, createdDay: day }), stamp);
    expect(s.world.day).toBe(7);
    // Mine breaks on day 5 and nobody is in it, so the merge that takes the day to 7 breaks it (SMX-gates-7.2)
    expect(s.gates.map(g => [g.id, g.name, g.status])).toEqual([['g-den', 'Den', 'closed'], ['g-mine', 'Mine', 'broken'], ['g-new', 'New', 'detected']]);
    expect(mergeWorld(start, { day: 1, gates: [] }, () => null, stamp).world.day).toBe(3);
  });
});

describe('which world doc a GM phone merges (SMX-gates-7.3a)', () => {
  const at = '2026-11-14T10:00:00.000Z', later = '2026-11-14T10:00:00.001Z';
  test('the first doc of a room, and a doc written later, are merged; the doc merged last is not merged again', () => {
    expect(worldDocUnmerged({ at, from: 'd-a' }, null)).toBe(true);
    expect(worldDocUnmerged({ at: later, from: 'd-a' }, { at, from: 'd-a' })).toBe(true);
    expect(worldDocUnmerged({ at, from: 'd-a' }, { at, from: 'd-a' })).toBe(false);
    expect(worldDocUnmerged({ at, from: 'd-b' }, { at: later, from: 'd-a' })).toBe(false);
  });
  test('a second GM phone\'s doc written in the same millisecond as the one merged is merged too, not lost', () => {
    expect(worldDocUnmerged({ at, from: 'd-b' }, { at, from: 'd-a' })).toBe(true);
  });
});

describe('the room\'s world doc (implicit audit 3, G1)', () => {
  test('it holds the gates still to clear first, at most 40, names within the doc\'s bound, a cleared one with its day, and the reader takes it whole', () => {
    const open = Array.from({ length: 45 }, (_, i) => ({ ...den('detected'), id: gid(`g${i + 10}`), name: 'x'.repeat(80) }));
    const done = { ...den('detected'), id: gid('g1'), status: 'cleared', clearedDay: 2 } as never;
    const d = worldDoc({ gates: [done, ...open] }, 7, new Set(), 0);
    expect([d.gates.length, d.gates.every(g => g.status === 'detected'), d.gates[0]!.name.length]).toEqual([WORLD_GATES, true, WORLD_NAME_MAX]);
    expect(DOCS.world(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(worldDoc({ gates: [done] }, 7, new Set(), 0).gates[0]).toMatchObject({ status: 'cleared', clearedDay: 2 });
  });
});

describe('the world list with no gate (lead-look-2-solo.md, finding 4)', () => {
  test('under a solo section it says the world has none, never that the world is quiet; alone it says what it said', () => {
    expect([worldEmptyWords(false, true), worldEmptyWords(true, true)]).toEqual(['No world gates.', 'No world gates. Spawn one above.']);
    expect([worldEmptyWords(false, false), worldEmptyWords(true, false)]).toEqual(['No gates detected.', 'No active gates. Spawn one above.']);
  });
});
