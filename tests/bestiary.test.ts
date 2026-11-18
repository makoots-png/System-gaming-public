import { describe, expect, test } from 'bun:test';
import { codexDoc, codexFromRoom, codexKey, mergeMonsters, monsterOfKind, playerShelf, recordDefeat, recordOf, removeMonster, saveMonster } from '../src/core/bestiary.ts';
import { CODEX_DOC_ENTRIES, DOCS, DOC_MAX } from '../src/core/protocol.ts';
import type { BestiaryParts } from '../src/core/bestiary.ts';
import { CODEX_SEEN_MAX, newMonster } from '../src/core/save.ts';
import type { CodexEntry, Monster } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { cid, mid } from './fixtures/ids.ts';

const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const mon = (id: string, name: string): Monster => ({ ...newMonster(), id: mid(id), name });
const entry = (o: Partial<CodexEntry>): CodexEntry => ({ name: 'Goblin', rank: 'E', kills: 1, firstAt: '2026-01-01', lastAt: '2026-01-01', monsterId: null, ...o });
const parts = (o: Partial<BestiaryParts> = {}): BestiaryParts => ({ monsters: [], codex: {}, codexSeen: [], ...o });

describe('the GM\'s monsters', () => {
  test('a new monster is added, a known id replaced', () => {
    const one = saveMonster(parts(), mon('m1', 'Goblin'));
    expect(one.monsters.map(m => m.name)).toEqual(['Goblin']);
    expect(saveMonster(one, mon('m1', 'Hobgoblin')).monsters.map(m => m.name)).toEqual(['Hobgoblin']);
  });
  test('saved then deleted leaves the monsters as they were', () => {
    const start = parts({ monsters: [mon('m1', 'Goblin')] });
    expect(ok(removeMonster(saveMonster(start, mon('m2', 'Orc')), 'm2'))).toEqual(start);
  });
  test('a deleted monster\'s codex entry keeps its kills and names no monster', () => {
    const s = ok(removeMonster(parts({ monsters: [mon('m1', 'Goblin')], codex: { 'goblin|E': entry({ kills: 4, monsterId: mid('m1') }) } }), mid('m1')));
    expect(s.codex['goblin|E']).toMatchObject({ kills: 4, monsterId: null });
    expect(removeMonster(s, 'm1')).toEqual({ ok: false, why: 'missing' });
  });
});

describe('the codex', () => {
  const d = { bodyId: cid('c7'), key: codexKey('Goblin', 'E'), name: 'Goblin', rank: 'E' as const, monsterId: mid('m1'), at: '2026-11-14' };
  test('a first defeat makes the entry with one kill; the same row is not counted twice', () => {
    const s = ok(recordDefeat(parts(), d));
    expect(s.codex['goblin|E']).toEqual({ name: 'Goblin', rank: 'E', kills: 1, firstAt: '2026-11-14', lastAt: '2026-11-14', monsterId: mid('m1') });
    expect(recordDefeat(s, d)).toEqual({ ok: false, why: 'counted' });
  });
  test('a later defeat adds a kill and keeps the first time; an entry from the room takes this time as its first', () => {
    const own = ok(recordDefeat(parts({ codex: { 'goblin|E': entry({ kills: 2 }) } }), d));
    expect(own.codex['goblin|E']).toMatchObject({ kills: 3, firstAt: '2026-01-01', lastAt: '2026-11-14' });
    const room = ok(recordDefeat(parts({ codex: { 'goblin|E': entry({ kills: 5, room: true }) } }), d));
    expect(room.codex['goblin|E']).toMatchObject({ kills: 6, firstAt: '2026-11-14' });
    expect(room.codex['goblin|E']!.room).toBeUndefined();
  });
  test('a monster the bestiary lacked is added with its first record, in the same step; a row counted already adds nothing', () => {
    const made = mon('m9', 'Cave Bat');
    const s = ok(recordDefeat(parts(), { ...d, key: codexKey('Cave Bat', 'E'), name: 'Cave Bat', monsterId: mid('m9') }, made));
    expect(s.monsters).toEqual([made]);
    expect(s.codex['cave bat|E']).toMatchObject({ kills: 1, monsterId: mid('m9') });
    expect(recordDefeat(s, { ...d, key: codexKey('Cave Bat', 'E'), name: 'Cave Bat', monsterId: mid('m10') }, mon('m10', 'Cave Bat'))).toEqual({ ok: false, why: 'counted' });
  });
  test('the rows remembered keep only the newest', () => {
    const full = parts({ codexSeen: Array.from({ length: CODEX_SEEN_MAX }, (_, i) => cid(`c${1000 + i}`)) });
    const s = ok(recordDefeat(full, d));
    expect(s.codexSeen).toHaveLength(CODEX_SEEN_MAX);
    expect(s.codexSeen.at(-1)).toBe(cid('c7'));
    expect(s.codexSeen[0]).toBe(cid('c1001'));
  });
  test('the room\'s codex doc lays over a player\'s: new kinds are added and told, a room entry whose kills moved is replaced, this phone\'s own stay', () => {
    const doc = (key: string, name: string, kills: number) => ({ key, name, rank: 'E' as const, kills, firstAt: '2026-01-01', hpMax: 30, armor: 2, resist: 1, speed: 100, abilities: ['Bite'] });
    const mine = parts({ codex: { 'goblin|E': entry({ kills: 3 }), 'wolf|E': entry({ name: 'Wolf', kills: 1, room: true }), 'bat|E': entry({ name: 'Bat', kills: 2, room: true }) } });
    const r = codexFromRoom(mine, { at: '2026-05-01', entries: [doc('goblin|E', 'Goblin', 9), doc('wolf|E', 'Wolf', 4), doc('bat|E', 'Bat', 2), doc('orc|E', 'Orc', 1)] });
    expect([r.save.codex['goblin|E']!.kills, r.save.codex['wolf|E']!.kills, r.save.codex['bat|E'], r.fresh.map(e => e.name)]).toEqual([3, 4, mine.codex['bat|E'], ['Orc']]);
    expect(r.save.codex['orc|E']).toEqual({ name: 'Orc', rank: 'E', kills: 1, firstAt: '2026-01-01', lastAt: '2026-05-01', monsterId: null, room: true, info: { hpMax: 30, armor: 2, resist: 1, speed: 100, abilities: ['Bite'] } });
    expect(codexFromRoom(r.save, { at: '2026-05-02', entries: [doc('orc|E', 'Orc', 1)] }).save).toBe(r.save);
  });
  test('a merge sums the kills into the destination, keeps the earliest and latest times, and deletes the source monster', () => {
    const start = parts({
      monsters: [mon('m1', 'Gob'), mon('m2', 'Goblin')],
      codex: { 'gob|E': entry({ name: 'Gob', kills: 2, firstAt: '2026-02-01', lastAt: '2026-05-01', monsterId: mid('m1') }), 'goblin|E': entry({ kills: 3, firstAt: '2026-03-01', lastAt: '2026-04-01', monsterId: mid('m2') }) },
    });
    const s = mergeMonsters(start, { srcId: mid('m1'), srcKey: 'gob|E', dst: { id: mid('m2'), name: 'Goblin', rank: 'E' }, dstKey: 'goblin|E' });
    expect(s.codex).toEqual({ 'goblin|E': entry({ kills: 5, firstAt: '2026-02-01', lastAt: '2026-05-01', monsterId: mid('m2') }) });
    expect(s.monsters.map(m => m.id)).toEqual(['m2']);
  });
});

describe('the room\'s codex doc', () => {
  const info = { hpMax: 30, armor: 2, resist: 1, speed: 30, abilities: ['Bite'] };
  /** `n` entries of this campaign, entry i last beaten on day i, each name `pad` characters long. */
  const codexOf = (n: number, pad: number): Record<string, CodexEntry> => Object.fromEntries(Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    return [`m${i}|E`, entry({ name: `m${i} `.padEnd(pad, 'x'), kills: 1 + i, firstAt: day, lastAt: day })];
  }));
  const at = '2026-11-15T00:00:00.000Z';

  test('a campaign that has beaten nothing of its own publishes no doc; the entries read from the room are not sent back', () => {
    expect(codexDoc({}, () => info, at)).toBeNull();
    expect(codexDoc({ 'orc|E': entry({ name: 'Orc', room: true }) }, () => info, at)).toBeNull();
  });
  test('the doc goes whole while it fits the room: 160 entries, more than twice the old cut at 15,500 characters', () => {
    const doc = codexDoc(codexOf(160, 60), () => info, at)!;
    expect(JSON.stringify(doc).length).toBeGreaterThan(2 * 15500);
    expect(doc.entries).toHaveLength(160);
    expect(doc.entries[0]).toEqual({ key: 'm159|E', name: 'm159 '.padEnd(60, 'x'), rank: 'E', ...info, kills: 160, firstAt: '2026-06-09T00:00:00.000Z' });
    expect(doc.entries.map(e => e.kills)).toEqual(Array.from({ length: 160 }, (_, i) => 160 - i));
  });
  test('a codex longer than the room takes keeps the latest defeats, up to the last entry that fits the room\'s DOC_MAX', () => {
    const big = { ...info, abilities: ['a'.repeat(70), 'b'.repeat(70), 'c'.repeat(70), 'd'.repeat(70)] };
    const codex = codexOf(CODEX_DOC_ENTRIES, 60), doc = codexDoc(codex, () => big, at)!;
    const size = JSON.stringify(doc).length;
    expect(size).toBeLessThanOrEqual(DOC_MAX);
    expect(doc.entries.length).toBeLessThan(CODEX_DOC_ENTRIES);
    const next = codexDoc(codex, () => big, at, Number.MAX_SAFE_INTEGER)!.entries[doc.entries.length]!;
    expect(size + 1 + JSON.stringify(next).length, 'the next entry would not have fitted').toBeGreaterThan(DOC_MAX);
    expect(doc.entries[0]!.key).toBe(`m${CODEX_DOC_ENTRIES - 1}|E`);
    expect(DOCS.codex(JSON.parse(JSON.stringify(doc))), 'the room reads back every entry sent').toEqual(doc);
  });
  test('at most as many entries as the room reads', () => {
    const doc = codexDoc(codexOf(CODEX_DOC_ENTRIES + 30, 8), () => info, at)!;
    expect(doc.entries).toHaveLength(CODEX_DOC_ENTRIES);
    expect(doc.entries.at(-1)!.key).toBe('m30|E');
  });
});

describe('which codex entry is a monster\'s (the rule a player\'s bestiary reads, U13 left it to U14)', () => {
  test('a kind\'s key is its monster\'s own name in lower case, spaces collapsed, and its rank; a name ending in a letter or number is its own kind', () => {
    expect(['Goblin', 'goblin', '  GOBLIN '].map(n => codexKey(n, 'E'))).toEqual(Array(3).fill(codexKey('goblin', 'E')));
    expect([String(codexKey('Unit 7', 'E')), String(codexKey('Type A', 'E'))]).toEqual(['unit 7|E', 'type a|E']);
    expect(String(codexKey('Cave  Bat', 'Z'))).toBe('cave bat|E');
  });

  test('a monster\'s entry is the one that names it; else the one of its kind, unless that names another monster still held', () => {
    const named = entry({ monsterId: mid('m2') }), kind = entry({ monsterId: null });
    const held = (id: string): boolean => id === 'm2';
    expect(recordOf({ x: named }, mon('m2', 'Wolf'), held)).toBe(named);
    expect(recordOf({ 'goblin|E': kind }, mon('m1', 'Goblin'), held)).toBe(kind);
    expect(recordOf({ 'goblin|E': entry({ monsterId: mid('m2') }) }, mon('m1', 'Goblin'), held)).toBeNull();
    expect(recordOf({ 'goblin|E': entry({ monsterId: mid('m9') }) }, mon('m1', 'Goblin'), held), 'm9 is gone: the kind\'s entry is m1\'s').not.toBeNull();
  });

  test('a defeat counts for the monster its entry names, else the first of its kind', () => {
    const monsters = [mon('m1', 'Goblin'), mon('m2', 'Goblin')];
    expect(monsterOfKind({ 'goblin|E': entry({ monsterId: mid('m2') }) }, monsters, codexKey('Goblin', 'E'))!.id).toBe(mid('m2'));
    expect(monsterOfKind({}, monsters, codexKey('Goblin', 'E'))!.id).toBe(mid('m1'));
    expect(monsterOfKind({}, monsters, codexKey('Wolf', 'E'))).toBeNull();
  });

  test('a player sees the monsters the codex records, a count of the rest, and the room\'s entries no monster stands for', () => {
    const info = { hpMax: 20, armor: 1, resist: 0, speed: 6, abilities: [] };
    const codex = { 'goblin|E': entry({ room: true, info }), 'troll|C': entry({ name: 'Troll', rank: 'C', room: true, info }) };
    const shelf = playerShelf(codex, [mon('m1', 'Goblin'), mon('m2', 'Wolf')]);
    expect(shelf.known.map(m => m.id)).toEqual(['m1']);
    expect(shelf.unknown).toBe(1);
    expect(shelf.roomOnly.map(([k]) => String(k))).toEqual(['troll|C']);
  });
});
