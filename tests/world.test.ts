import { describe, expect, test } from 'bun:test';
import { advanceDay, sessionStarted, clearGate, closeGate, deleteGate, editGate, encounterEnded, enterGate, gateFightStarted, gateNews, mergeWorld, parseGateTold, spawnGate, toldGate, worldDoc, worldEmptyWords } from '../src/core/gates/world.ts';
import { DOCS, WORLD_GATES, WORLD_NAME_MAX } from '../src/core/protocol.ts';
import type { WorldParts } from '../src/core/gates/world.ts';
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
    const g = ok(editGate(world(), 'g-den', edit)).gates[0]!;
    expect(g).toMatchObject({ name: 'Den II', rank: 'D', type: 'red', breakDay: 9, bossId: null, notes: 'x', mapId: null, status: 'raiding', solo: true });
  });
  test('an empty name and a break day of 0 keep the old ones; a break day under 0 is day 1', () => {
    const g = ok(editGate(world(), 'g-den', { ...edit, name: ' ', breakDay: 0 })).gates[0]!;
    expect(g).toMatchObject({ name: 'Goblin Den', breakDay: 5 });
    expect(ok(editGate(world(), 'g-den', { ...edit, breakDay: -4 })).gates[0]!.breakDay).toBe(1);
  });
  test('an edit to the same values leaves the gate as it was', () => {
    const d = den('detected'), same = { name: d.name, rank: d.rank, type: d.type, breakDay: d.breakDay, monsters: d.monsters, bossId: d.bossId, notes: d.notes, mapId: null, status: d.status, solo: d.solo };
    expect(ok(editGate(world(), 'g-den', same)).gates).toEqual(world().gates);
  });
});

describe('another GM phone\'s world', () => {
  test('the later day wins, a known gate takes the doc\'s fields, a new one is added, none is deleted', () => {
    const start = { ...world(), gates: [den('detected'), { ...den('detected'), id: gid('g-mine'), name: 'Mine' }] };
    const doc = { day: 7, gates: [{ id: 'g-den', name: 'Den', rank: 'E' as const, type: 'normal' as const, status: 'closed' as const, breakDay: 5 },
      { id: 'g-new', name: 'New', rank: 'C' as const, type: 'red' as const, status: 'detected' as const, breakDay: 9 }] };
    const s = mergeWorld(start, doc, (g, day) => parseGate({ ...g, createdDay: day }));
    expect(s.world.day).toBe(7);
    expect(s.gates.map(g => [g.id, g.name, g.status])).toEqual([['g-den', 'Den', 'closed'], ['g-mine', 'Mine', 'detected'], ['g-new', 'New', 'detected']]);
    expect(mergeWorld(start, { day: 1, gates: [] }, () => null).world.day).toBe(3);
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

describe('a player\'s gate news (implicit audit 2, N7)', () => {
  const shown = (id: string, status: 'detected' | 'broken' = 'detected') => ({ id: gid(id), name: id, rank: 'E' as const, type: 'normal' as const, breakDay: 5, status });
  test('a first sight of a room tells nothing and takes every gate as told, so joining replays no old gate', () => {
    const r = gateNews(null, [shown('g1'), shown('g2', 'broken')]);
    expect(r).toEqual({ told: { ids: ['g1', 'g2'], broken: ['g2'] }, news: [] });
  });
  test('a gate is news until the player answers its window: a doc read again before that tells it again, after it tells nothing', () => {
    const told = { ids: ['g1'], broken: [] };
    const first = gateNews(told, [shown('g1'), shown('g2')]);
    expect(first.news.map(n => [n.kind, n.gate.id])).toEqual([['appeared', 'g2']]);
    expect(gateNews(told, [shown('g1'), shown('g2')]).news).toHaveLength(1);
    expect(gateNews(toldGate(told, first.news[0]!), [shown('g1'), shown('g2')]).news).toEqual([]);
  });
  test('at most 3 of each kind at once; the rest wait for a later look instead of being marked told unseen; a break tells once', () => {
    const many = ['g1', 'g2', 'g3', 'g4'].map(id => shown(id));
    const r = gateNews({ ids: [], broken: [] }, many);
    expect(r.news.map(n => n.gate.id)).toEqual(['g1', 'g2', 'g3']);
    const after = r.news.reduce(toldGate, r.told);
    expect(gateNews(after, many).news.map(n => n.gate.id)).toEqual(['g4']);
    const broke = gateNews(after, [shown('g1', 'broken')]);
    expect(broke.news.map(n => n.kind)).toEqual(['broke']);
    expect(gateNews(toldGate(after, broke.news[0]!), [shown('g1', 'broken')]).news).toEqual([]);
    expect(parseGateTold({ ids: ['g1'], broken: 'x' })).toBeNull();
  });
});

describe('the world list with no gate (lead-look-2-solo.md, finding 4)', () => {
  test('under a solo section it says the world has none, never that the world is quiet; alone it says what it said', () => {
    expect([worldEmptyWords(false, true), worldEmptyWords(true, true)]).toEqual(['No world gates.', 'No world gates. Spawn one above.']);
    expect([worldEmptyWords(false, false), worldEmptyWords(true, false)]).toEqual(['No gates detected.', 'No active gates. Spawn one above.']);
  });
});
