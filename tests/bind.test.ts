// What the room link writes in the save (src/core/sync/bind.ts): the room fields, the ring of GM keys, the server seen,
// and a player's hunter bound to the room. Each is one step; the room model runs the same ones.
import { describe, expect, test } from 'bun:test';
import { KEYS_MAX, boundTo, linkSaved, ringDrop, ringGone, ringKeep, serverSeen } from '../src/core/sync/bind.ts';
import { SEEN_MAX, parseSeen, seenFrom, seenKept } from '../src/core/sync/seen.ts';
import { ROOM_TTL_MS } from '../src/core/room-server.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { ParseEnv, Save, SyncSettings } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { post } from '../src/core/sync/outbox.ts';
import { dev, gmKey, hid, room } from './fixtures/ids.ts';

const AT = '2026-11-15T10:00:00.000Z';
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') };
const A = room('AAAA22'), B = room('BBBB33'), KA = gmKey('key-a'), KB = gmKey('key-b');
const sync = (o: Partial<SyncSettings> = {}): SyncSettings => ({ ...freshSave(ENV, { onboarded: true }).settings.sync, ...o });
const code = (n: number) => room(`RMMM${'ABCDEFGHJKLMNPQRSTUVWXYZ'[n]}2`);

describe('the ring of GM keys', () => {
  test('a key kept is the newest; past the cap the oldest goes', () => {
    let g: Record<string, ReturnType<typeof gmKey>> = {};
    for (let i = 0; i <= KEYS_MAX; i++) g = ringKeep(g, code(i), gmKey(`k${i}`));
    expect(Object.keys(g)).toHaveLength(KEYS_MAX);
    expect(Object.keys(g)[0]).toBe(code(1));
    expect(Object.keys(ringKeep(g, code(1), gmKey('again'))).at(-1), 'a key kept again moves to the newest').toBe(code(1));
  });

  test('a refused key goes; a wrong key typed by hand leaves the good stored one', () => {
    const s = sync({ gmKeys: { [A]: KA }, gmKey: KA });
    expect(ringDrop(s, A, KA)).toMatchObject({ gmKeys: {}, gmKey: null });
    expect(ringDrop(s, A, null).gmKeys, 'the stored one was the one tried').toEqual({});
    expect(ringDrop(s, A, gmKey('typo'))).toMatchObject({ gmKeys: { [A]: KA }, gmKey: KA });
  });

  test('a room gone, or its key forgotten, takes its key and the room\'s key when it is that one; the others stay', () => {
    const s = sync({ gmKeys: { [A]: KA, [B]: KB }, gmKey: KA });
    expect(ringGone(s, A)).toMatchObject({ gmKeys: { [B]: KB }, gmKey: null });
    expect(ringGone(s, B)).toMatchObject({ gmKeys: { [A]: KA }, gmKey: KA });
  });
});

describe('the link\'s save effect', () => {
  test('each field it names is written, a room marks the server seen, and the ring changes with it', () => {
    const s = linkSaved(freshSave(ENV, { onboarded: true }), { room: A, cursor: 7, gmKey: KA, ring: { keep: A, key: KA } }, null, AT).settings.sync;
    expect(s).toMatchObject({ room: A, cursor: 7, gmKey: KA, serverOk: true, gmKeys: { [A]: KA } });
  });

  test('a field it does not name stays; leaving a room keeps the server seen', () => {
    const was = linkSaved(freshSave(ENV, { onboarded: true }), { room: A, cursor: 7 }, null, AT);
    expect(linkSaved(was, { room: null, last: { code: A, why: 'left' } }, null, AT).settings.sync).toMatchObject({ room: null, cursor: 7, serverOk: true, lastRoom: { code: A, why: 'left' } });
    expect(serverSeen(sync({ serverOk: true }))).toEqual(sync({ serverOk: true }));
  });
});

describe('a player\'s hunter bound to the room', () => {
  /** A player's save with two hunters, h1 active, and a tombstone of h2 waiting in the outbox. */
  function player(): Save {
    const s = freshSave(ENV, { onboarded: true }), two = [{ ...s.hunters[0]!, id: hid('h1') }, { ...newHunter(RULES), id: hid('h2') }];
    const outbox = post([], A, { kind: 'tomb', hid: hid('h2') }).box;
    return { ...s, hunters: two, settings: { ...s.settings, activeHunterId: hid('h1'), sync: { ...s.settings.sync, outbox } } };
  }

  test('a join or a rebind makes the hunter active and bound from the server\'s time, and drops its tombstone', () => {
    const s = boundTo(player(), hid('h2'), AT);
    expect([s.settings.activeHunterId, s.settings.sync.boundHunterId, s.settings.sync.joinedAt]).toEqual(['h2', 'h2', AT]);
    expect(s.settings.sync.outbox?.map(e => e.at)).toEqual([]);
  });

  test('a hunter this phone does not hold binds the active one', () => {
    const s = boundTo(player(), hid('h9'), AT);
    expect([s.settings.activeHunterId, s.settings.sync.boundHunterId]).toEqual(['h1', 'h1']);
  });
});

describe('where a phone stopped reading a room it went out of (notes-5-trade.md 11)', () => {
  const NOW = Date.parse(AT), LATER = '2026-11-15T11:00:00.000Z';
  const inA = (cursor: number): Save => linkSaved(freshSave(ENV, { onboarded: true }), { room: A, cursor }, null, AT);
  const seen = (s: Save) => s.settings.sync.seen ?? {};

  test('a leave, a removal and another room each keep the room\'s cursor with the time, in the write that takes the phone out', () => {
    // the link's save of a leave names the room, a cursor of 0 and the last room together (link.ts `stored`)
    for (const why of ['left', 'removed'] as const) {
      const out = linkSaved(inA(41), { room: null, cursor: 0, last: { code: A, why } }, null, LATER);
      expect([out.settings.sync.room, out.settings.sync.cursor, seen(out)]).toEqual([null, 0, { [A]: { seq: 41, at: LATER } }]);
    }
    const moved = linkSaved(inA(41), { room: B, cursor: 9, last: { code: A, why: 'left' } }, null, LATER);
    expect([moved.settings.sync.room, seen(moved)]).toEqual([B, { [A]: { seq: 41, at: LATER } }]);
  });

  test('a page\'s cursor written while the phone stays in the room keeps no place', () => {
    expect(seen(linkSaved(inA(41), { cursor: 60 }, null, LATER))).toEqual({});
  });

  test('back in the room, its place goes: the cursor carries on from there', () => {
    const out = linkSaved(inA(41), { room: null, cursor: 0, last: { code: A, why: 'left' } }, null, LATER);
    expect(seenFrom(seen(out), A, NOW)).toBe(41);
    expect(seen(linkSaved(out, { room: A, cursor: 41, last: null }, null, LATER))).toEqual({});
  });

  test('a room that is gone keeps no place: nothing will be read from it', () => {
    expect(seen(linkSaved(inA(41), { room: null, cursor: 0, last: { code: A, why: 'gone' } }, null, LATER))).toEqual({});
    const out = linkSaved(inA(41), { room: null, cursor: 0, last: { code: A, why: 'left' } }, null, LATER);
    expect(seen(linkSaved(out, { last: { code: A, why: 'gone' } }, null, LATER)), 'a join that finds the room gone').toEqual({});
    expect(seen(linkSaved(out, { ring: { gone: A } }, KA, LATER)), 'a GM\'s room gone takes its place with its key').toEqual({});
  });

  test('a place is good for a room\'s life, 30 days from this phone\'s last read: a millisecond past it the code may name another room', () => {
    const kept = seenKept({}, A, 41, AT);
    expect(seenFrom(kept, A, NOW + ROOM_TTL_MS)).toBe(41);
    expect(seenFrom(kept, A, NOW + ROOM_TTL_MS + 1)).toBeNull();
    expect(seenFrom(kept, B, NOW), 'a room this phone was never in').toBeNull();
  });

  test('the newest places are kept, at most SEEN_MAX; a save\'s places are read: a bad code, seq or time and an old place are dropped', () => {
    let s = {};
    for (let i = 0; i < 24; i++) for (let j = 0; j < 5; j++) s = seenKept(s, room(`RM${'ABCDEFGHJKLMNPQRSTUVWXYZ'[i]}${'ABCDE'[j]}M2`), i * 5 + j, AT);
    expect([Object.keys(s).length, Object.values(s as Record<string, { seq: number }>)[0]?.seq]).toEqual([SEEN_MAX, 20]);
    const old = new Date(NOW - ROOM_TTL_MS - 1).toISOString();
    expect(parseSeen({ [A]: { seq: 41, at: AT }, [B]: { seq: 5, at: old }, nope: { seq: 1, at: AT }, GHJKLM: { seq: -1, at: AT }, HJKLMN: { seq: 2, at: 'soon' }, JKLMNP: 7 }, NOW)).toEqual({ [A]: { seq: 41, at: AT } });
    expect(parseSeen('x', NOW)).toEqual({});
  });
});
