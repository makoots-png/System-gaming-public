import { describe, expect, test } from 'bun:test';
import { CATALOG_TTL_MS, DB_EVENTS, DB_STATES, ROOM_TTL_MS, catalogLive, dbHealth, dbStep, dbTransition, keptOut, kickedAfter, pushed, roomLive } from '../src/core/room-server.ts';
import type { Db } from '../src/core/room-server.ts';
import { FREE, OWNER_EVENTS, OWNER_STATES, ownedBy, ownerStep } from '../src/core/sync/owner.ts';
import type { Owner, OwnerEvent, TokenHash } from '../src/core/sync/owner.ts';
import type { SheetKey } from '../src/core/protocol.ts';
import { REMOVED_MS, ROOM_SHEETS } from '../src/core/protocol.ts';

const DAY = 24 * 3600 * 1000, KEY = 'd-player1:h1' as SheetKey;

describe('a room\'s life', () => {
  test('a room lives 30 days after its last use, to the millisecond', () => {
    const t0 = Date.parse('2026-11-01T12:00:00.000Z');
    expect(ROOM_TTL_MS).toBe(30 * DAY);
    expect(roomLive(t0, t0)).toBe(true);
    expect(roomLive(t0, t0 + 30 * DAY)).toBe(true);
    expect(roomLive(t0, t0 + 30 * DAY + 1)).toBe(false);
  });
});

describe('a catalog\'s life', () => {
  test('an unlinked catalog lives 30 days after its last update, and a catalog linked by a live room stays alive past 30 days', () => {
    const t0 = Date.parse('2026-11-01T12:00:00.000Z');
    expect(CATALOG_TTL_MS).toBe(30 * DAY);
    expect(catalogLive(t0, false, t0)).toBe(true);
    expect(catalogLive(t0, false, t0 + 30 * DAY)).toBe(true);
    expect(catalogLive(t0, false, t0 + 30 * DAY + 1)).toBe(false);
    expect(catalogLive(t0, true, t0 + 90 * DAY)).toBe(true);
  });
});

describe('a removal', () => {
  const at = Date.parse('2026-11-14T10:00:00.000Z');
  const kicked = { keys: { [KEY]: new Date(at).toISOString() }, names: {} };

  test('a removed hunter\'s phone may not push its sheet for 20 seconds after the removal, then may', () => {
    expect(keptOut(kicked, KEY, at)).toBe(true);
    expect(keptOut(kicked, KEY, at + 19_999)).toBe(true);
    expect(keptOut(kicked, KEY, at + 20_000)).toBe(false);
  });

  test('a hunter the doc does not name, or a room with no removal doc, is never kept out', () => {
    expect(keptOut(kicked, 'd-player2:h1' as SheetKey, at)).toBe(false);
    expect(keptOut(null, KEY, at)).toBe(false);
  });
});

describe('a pushed sheet', () => {
  const at = Date.parse('2026-11-14T10:00:00.000Z');
  const kicked = { keys: { [KEY]: new Date(at).toISOString() }, names: {} };

  test('a room of 23 takes a new hunter; a room of 24 refuses one as full', () => {
    expect(ROOM_SHEETS).toBe(24);
    expect(pushed(null, KEY, false, 23, at)).toBe('stored');
    expect(pushed(null, KEY, false, 24, at)).toBe('full');
  });

  test('a full room still takes the sheet of a hunter it holds: the push replaces it', () => {
    expect(pushed(null, KEY, true, 24, at)).toBe('stored');
  });

  test('a hunter removed within 20 seconds is refused as removed, full room or not, and taken after', () => {
    expect(pushed(kicked, KEY, false, 0, at + 19_999)).toBe('removed');
    expect(pushed(kicked, KEY, false, 24, at)).toBe('removed');
    expect(pushed(kicked, KEY, false, 0, at + 20_000)).toBe('stored');
  });
});

describe('the room server\'s database', () => {
  const store = { name: 'store' };
  const down = (since: number): Db<typeof store> => ({ at: 'down', since, error: 'ERR_POSTGRES_CONNECTION_REFUSED' });

  test('a database that opens is ready; one that fails is down and says since when', () => {
    expect(dbStep({ at: 'opening' }, { type: 'opened', store })).toEqual({ at: 'ready', store });
    expect(dbStep({ at: 'opening' }, { type: 'failed', at: 5, error: 'ERR_POSTGRES_CONNECTION_REFUSED' })).toEqual(down(5));
  });

  test('a down database that fails again keeps when its outage began; one that opens is ready', () => {
    expect(dbStep(down(5), { type: 'failed', at: 9, error: 'ERR_POSTGRES_CONNECTION_REFUSED' })).toEqual(down(5));
    expect(dbStep(down(5), { type: 'opened', store })).toEqual({ at: 'ready', store });
  });

  test('a ready database stays ready: no event of opening moves it', () => {
    const ready: Db<typeof store> = { at: 'ready', store };
    for (const e of [{ type: 'opened', store }, { type: 'failed', at: 9, error: 'x' }] as const) expect(dbStep(ready, e)).toBe(ready);
  });

  test('every state answers every event: ready takes only a close, closed takes none, the others take all three', () => {
    const cells = DB_STATES.flatMap(s => DB_EVENTS.map(e => `${s} ${e} ${dbTransition(s, e)}`));
    expect(cells).toEqual([
      'opening opened ready', 'opening failed down', 'opening close closed',
      'ready opened null', 'ready failed null', 'ready close closed',
      'down opened ready', 'down failed down', 'down close closed',
      'closed opened null', 'closed failed null', 'closed close null',
    ]);
  });

  test('a closed database stays closed (SMX-sync-7): a try that answers or fails after the close moves nothing', () => {
    const closed: Db<typeof store> = { at: 'closed' };
    for (const from of [{ at: 'opening' }, { at: 'ready', store }, down(5)] as const) expect(dbStep(from, { type: 'close' })).toEqual(closed);
    for (const e of [{ type: 'opened', store }, { type: 'failed', at: 9, error: 'x' }, { type: 'close' }] as const) expect(dbStep(closed, e)).toBe(closed);
  });

  test('a closed database serves no room: health answers 503 and says closed', () => {
    expect(dbHealth({ at: 'closed' }, 'postgres')).toEqual({ status: 503, body: { ok: false, db: 'postgres', error: 'closed' } });
  });

  test('health is 200 only when the database is ready, and a down one says since when and the error\'s code', () => {
    expect(dbHealth({ at: 'ready', store }, 'postgres')).toEqual({ status: 200, body: { ok: true, db: 'postgres' } });
    expect(dbHealth(down(Date.parse('2026-11-14T10:00:00.000Z')), 'postgres')).toEqual({
      status: 503, body: { ok: false, db: 'postgres', since: '2026-11-14T10:00:00.000Z', error: 'ERR_POSTGRES_CONNECTION_REFUSED' },
    });
    expect(dbHealth({ at: 'opening' }, 'postgres').status).toBe(503);
  });
});

describe('the record of who the GM removed (kickedAfter)', () => {
  const A = 'd-player1:h1' as SheetKey, B = 'd-player2:h1' as SheetKey, at = Date.parse('2026-11-15T10:00:00.000Z');
  test('a removal is written with its time and the board\'s name; lifting it takes it out', () => {
    const doc = kickedAfter(null, A, 'Mira', at);
    expect(doc).toEqual({ keys: { [A]: new Date(at).toISOString() }, names: { [A]: 'Mira' } });
    expect(kickedAfter(doc, A, null, at + 1)).toEqual({ keys: {}, names: {} });
  });
  test(`a removal older than REMOVED_MS (${REMOVED_MS} ms) is dropped at the next write; a younger one stays`, () => {
    const doc = kickedAfter(null, A, 'Mira', at);
    expect(Object.keys(kickedAfter(doc, B, 'Kai', at + REMOVED_MS - 1).keys)).toEqual([A, B]);
    expect(Object.keys(kickedAfter(doc, B, 'Kai', at + REMOVED_MS).keys)).toEqual([B]);
  });
});

describe('a device\'s slot in a room: which phone speaks for it (SMX-sync-5)', () => {
  const MINE = 'a'.repeat(64) as TokenHash, THEIRS = 'b'.repeat(64) as TokenHash;
  const bound = (hash: TokenHash): Owner => ({ at: 'bound', hash });
  const name = (o: Owner): string => (o.at === 'free' ? 'free' : o.hash === MINE ? 'mine' : 'theirs');
  const EVENTS: readonly [string, OwnerEvent][] = [
    ['my write', { type: 'write', hash: MINE }],
    ['their write', { type: 'write', hash: THEIRS }],
    ['release', { type: 'release' }],
    ['removed, one sheet left', { type: 'removed', left: 1 }],
    ['removed, none left', { type: 'removed', left: 0 }],
  ];

  test('every slot against every event: only a write binds a free slot, a bound one keeps its phone through another\'s write, and only a release or the last sheet\'s removal frees it', () => {
    expect([...OWNER_STATES]).toEqual(['free', 'bound']);
    expect([...OWNER_EVENTS]).toEqual(['write', 'release', 'removed']);
    const cells = [FREE, bound(MINE)].flatMap(o => EVENTS.map(([what, e]) => `${name(o)} × ${what} → ${name(ownerStep(o, e))}`));
    expect(cells).toEqual([
      'free × my write → mine', 'free × their write → theirs', 'free × release → free', 'free × removed, one sheet left → free', 'free × removed, none left → free',
      'mine × my write → mine', 'mine × their write → mine', 'mine × release → free', 'mine × removed, one sheet left → mine', 'mine × removed, none left → free',
    ]);
  });

  test('a request speaks for the device only with the token its slot is bound to: a free slot is no one\'s, so a poll on it proves nothing', () => {
    expect([ownedBy(FREE, MINE), ownedBy(bound(MINE), MINE), ownedBy(bound(MINE), THEIRS)]).toEqual([false, true, false]);
  });

  test('a write that loses a free slot to another\'s first write is refused, and the first writer keeps it', () => {
    const won = ownerStep(FREE, { type: 'write', hash: THEIRS });
    const late = ownerStep(won, { type: 'write', hash: MINE });
    expect([ownedBy(late, MINE), ownedBy(late, THEIRS)]).toEqual([false, true]);
  });
});
