// What the room link writes in the save (src/core/sync/bind.ts): the room fields, the ring of GM keys, the server seen,
// and a player's hunter bound to the room. Each is one step; the room model runs the same ones.
import { describe, expect, test } from 'bun:test';
import { KEYS_MAX, boundTo, linkSaved, ringDrop, ringGone, ringKeep, serverSeen } from '../src/core/sync/bind.ts';
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
    const s = linkSaved(freshSave(ENV, { onboarded: true }), { room: A, cursor: 7, gmKey: KA, ring: { keep: A, key: KA } }, null).settings.sync;
    expect(s).toMatchObject({ room: A, cursor: 7, gmKey: KA, serverOk: true, gmKeys: { [A]: KA } });
  });

  test('a field it does not name stays; leaving a room keeps the server seen', () => {
    const was = linkSaved(freshSave(ENV, { onboarded: true }), { room: A, cursor: 7 }, null);
    expect(linkSaved(was, { room: null, last: { code: A, why: 'left' } }, null).settings.sync).toMatchObject({ room: null, cursor: 7, serverOk: true, lastRoom: { code: A, why: 'left' } });
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
