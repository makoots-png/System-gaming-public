import { describe, expect, test } from 'bun:test';
import { DB_EVENTS, DB_STATES, ROOM_TTL_MS, dbHealth, dbStep, dbTransition, keptOut, kickedAfter, roomLive } from '../src/core/room-server.ts';
import type { Db } from '../src/core/room-server.ts';
import type { SheetKey } from '../src/core/protocol.ts';
import { REMOVED_MS } from '../src/core/protocol.ts';

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

  test('every state answers every event: ready takes none, the others take both', () => {
    const cells = DB_STATES.flatMap(s => DB_EVENTS.map(e => `${s} ${e} ${dbTransition(s, e)}`));
    expect(cells).toEqual(['opening opened ready', 'opening failed down', 'ready opened null', 'ready failed null', 'down opened ready', 'down failed down']);
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
