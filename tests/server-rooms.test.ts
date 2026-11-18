import { describe, expect, test } from 'bun:test';
import { buildApp } from '../scripts/build.ts';
import { database, handler, memoryStore, openDatabase, postgresStore, serverOf } from '../server.ts';
import type { Store } from '../server.ts';
import { DOC_MAX, SHEET_MAX, parseDeviceId, parseRoomCode, parseSheet, parseSheetKey } from '../src/core/protocol.ts';
import type { RoomCode } from '../src/core/protocol.ts';
import { ROOM_TTL_MS } from '../src/core/room-server.ts';

type Reply = { status: number; body: Record<string, any> };

/** The room's rules doc as a GM's phone publishes it (build.ts `roomRulesOf`). */
const RULES_DOC = { build: { enabled: true, playerPick: false }, solo: { personal: true, hours: 8 }, feats: { on: true } };
const { build } = await buildApp();

/** Every request carries this build's id, as the app's requests do. tests/server-handshake.test.ts covers the refusals. */
type Server = (req: Request) => Promise<Response>;
async function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; server?: Server } = {}): Promise<Reply> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', 'x-hunter-build': build, ...opts.headers } };
  if (opts.body !== undefined) init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  const res = await (opts.server ?? handler)(new Request('http://test' + path, init));
  return { status: res.status, body: await res.json() };
}
/** A store of the kind the deploy uses when DATABASE_URL is set (an empty database), else a memory store. */
const PG = Bun.env.DATABASE_URL;
const freshStore = (): Promise<Store> => (PG ? postgresStore(PG) : Promise.resolve(memoryStore()));
/** A Postgres that is not there: nothing listens on port 1. */
const NO_PG = 'postgres://postgres:pg@127.0.0.1:1/none';

async function newRoom(): Promise<{ code: string; gm: Record<string, string> }> {
  const r = await call('POST', '/api/rooms');
  expect(r.status).toBe(200);
  return { code: r.body.code, gm: { 'x-gm-key': r.body.gmKey } };
}

const PLAYER = 'd-player1', OTHER = 'd-player2';
const token = (name: string) => ({ 'x-device-token': name.padEnd(16, 'x') });
/** Payloads as the app sends them (src/core/protocol.ts). tests/protocol.test.ts covers each parser. */
const system = (title: string, eid = 'd-gm-e1') => ({ eid, title });
const award = (xp: number, eid = 'd-gm-e2') => ({ eid, to: [`${PLAYER}:h1`], rewards: { xp } });
const roll = { eid: 'd-player1-e1', by: `${PLAYER}:h1`, name: 'Kai', total: 17 };
const questUpdate = { eid: 'd-player1-e2', by: `${PLAYER}:h1`, name: 'Kai', questId: 'q7', title: 'Den', kind: 'main', status: 'active' };
const used = { eid: 'd-player1-e3', by: `${PLAYER}:h1`, who: 'Kai', what: 'boon', name: 'Free resurrection', text: 'Once.', tell: true };
const step = { eid: 'd-player1-e4', by: `${PLAYER}:h1`, place: { x: 3, y: 4 }, at: 2500 };
const cast = { eid: 'd-player1-e5', by: `${PLAYER}:h1`, ability: 'strike', aim: 'c2', at: 2500, dice: [4, 6] };
/** A player's solo run of the room's gate g1, as gates/solo.ts `soloRunBody` writes it. */
const soloRun = { eid: 'd-player1-e8', by: `${PLAYER}:h1`, gate: 'g1', name: 'Kai', outcome: 'won', rounds: 4, life: 'up' };
const arm = { eid: 'd-player1-e8', by: `${PLAYER}:h1`, ability: 'parry', on: null };
const coinCall = { eid: 'd-player1-e6', by: `${PLAYER}:h1`, roll: `${PLAYER}:r12`, who: 'Kai', what: 'STR check', face: 20, call: 'heads' };
const coinLand = { eid: 'd-player1-e7', roll: `${PLAYER}:r12`, side: 'heads' };
/** The fight's totals for a player's hunter, as the GM's phone sends them. */
const vitals = { eid: 'd-gm-e5', to: [`${PLAYER}:h1`], hp: 12, mana: 3, fatigue: 20, statuses: [] };
/** A hunter sheet for `dev`'s hunter h1. */
/** A sheet as a player's phone pushes it: its hunter. */
const sheetOf = (dev: string, name: string, fields: Record<string, unknown> = {}) => ({ from: dev, data: { hunter: { id: 'h1', name, ...fields } } });

describe('room lifecycle', () => {
  test('health reports the store kind', async () => {
    expect((await call('GET', '/api/health')).body).toEqual({ ok: true, db: Bun.env.DATABASE_URL ? 'postgres' : 'memory' });
  });

  test('a new room has a six character code and a GM key', async () => {
    const r = await call('POST', '/api/rooms');
    expect(r.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(r.body.gmKey).toHaveLength(32);
  });

  test('every room code has a digit, so a code pasted in a message never reads like a word', async () => {
    for (let i = 0; i < 60; i++) expect((await call('POST', '/api/rooms')).body.code).toMatch(/\d/);
  });

  test('a room is always created with a GM key', async () => {
    for (const body of [undefined, {}, { v: 1 }, 'not json']) {
      const r = await call('POST', '/api/rooms', body === undefined ? {} : { body });
      expect(r.status).toBe(200);
      expect(r.body.gmKey).toHaveLength(32);
      const asPlayer = await call('POST', `/api/rooms/${r.body.code}/events`, { body: { from: 'd-player1', type: 'award', payload: {} } });
      expect(asPlayer).toEqual({ status: 403, body: { error: 'gm only' } });
    }
  });

  test('peek answers 200 for a real code and for a wrong one', async () => {
    const { code } = await newRoom();
    expect(await call('GET', `/api/rooms/${code}?peek=1`)).toEqual({ status: 200, body: { exists: true } });
    expect(await call('GET', '/api/rooms/ZZZZZZ?peek=1')).toEqual({ status: 200, body: { exists: false } });
    expect(await call('GET', '/api/rooms/not-a-code?peek=1')).toEqual({ status: 200, body: { exists: false } });
  });

  test('a room nobody polls for 30 days is gone, even when someone checked its code meanwhile', async () => {
    const { code } = await newRoom();
    const realNow = Date.now, t0 = realNow(), day = 24 * 3600 * 1000;
    try {
      Date.now = () => t0 + 29 * day;
      expect(await call('GET', `/api/rooms/${code}?peek=1`)).toEqual({ status: 200, body: { exists: true } });
      Date.now = () => t0 + 31 * day;
      expect(await call('GET', `/api/rooms/${code}?peek=1`)).toEqual({ status: 200, body: { exists: false } });
      expect(await call('GET', `/api/rooms/${code}?after=0`)).toEqual({ status: 404, body: { error: 'no such room' } });
    } finally { Date.now = realNow; }
  });

  test('reading an unknown room is 404 with the reason players see', async () => {
    expect(await call('GET', '/api/rooms/ZZZZZZ')).toEqual({ status: 404, body: { error: 'no such room' } });
  });

  test('polling an unknown room with a cursor is 404, the answer that marks a saved room gone', async () => {
    expect(await call('GET', `/api/rooms/ZZZZZZ?after=5&d=${PLAYER}`)).toEqual({ status: 404, body: { error: 'no such room' } });
  });

  test('a cursor past the last event returns no events but still returns the sheets', async () => {
    const { code, gm } = await newRoom();
    await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'system', payload: system('one') } });
    await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body: sheetOf(PLAYER, 'Kai') });
    const r = await call('GET', `/api/rooms/${code}?after=999999999`);
    expect(r.body.events).toEqual([]);
    expect(r.body.sheets[`${PLAYER}:h1`].data.hunter.name).toBe('Kai');
  });

  test('a lower-case code reaches the same room', async () => {
    const { code } = await newRoom();
    expect((await call('GET', `/api/rooms/${code.toLowerCase()}`)).status).toBe(200);
  });
});

describe('who is the GM', () => {
  test('only the key holder is told it is the GM and sees presence', async () => {
    const { code, gm } = await newRoom();
    const asGm = await call('GET', `/api/rooms/${code}?d=d-gm`, { headers: gm });
    const asPlayer = await call('GET', `/api/rooms/${code}?d=${PLAYER}`);
    expect(asGm.body.gm).toBe(true);
    expect(Object.keys(asGm.body.presence)).toContain('d-gm');
    expect(asPlayer.body.gm).toBe(false);
    expect(asPlayer.body.presence).toBeUndefined();
  });

  test('the GM sees a polling player in presence, with a timestamp, and a bad device id is ignored', async () => {
    const { code, gm } = await newRoom();
    await call('GET', `/api/rooms/${code}?d=${PLAYER}`);
    await call('GET', `/api/rooms/${code}?d=${encodeURIComponent('bad id!')}`);
    const asGm = await call('GET', `/api/rooms/${code}`, { headers: gm });
    expect(Object.keys(asGm.body.presence)).toEqual([PLAYER]);
    expect(Number.isNaN(Date.parse(asGm.body.presence[PLAYER]))).toBe(false);
  });

  test('a wrong key is treated as a player', async () => {
    const { code } = await newRoom();
    const r = await call('GET', `/api/rooms/${code}`, { headers: { 'x-gm-key': 'A'.repeat(32) } });
    expect(r.body.gm).toBe(false);
  });
});

describe('events', () => {
  test('GM events reach a player in order and paging by "after" skips seen ones', async () => {
    const { code, gm } = await newRoom();
    const first = await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'system', payload: system('one') } });
    const second = await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'award', payload: award(50) } });
    expect([first.body.seq, second.body.seq]).toEqual([1, 2]);
    const all = await call('GET', `/api/rooms/${code}`);
    expect(all.body.events.map((e: any) => [e.seq, e.type])).toEqual([[1, 'system'], [2, 'award']]);
    const later = await call('GET', `/api/rooms/${code}?after=1`);
    expect(later.body.events.map((e: any) => e.seq)).toEqual([2]);
  });

  for (const type of ['system', 'award', 'quest', 'hp', 'vitals', 'spent', 'status', 'revive', 'chain', 'coinLand', 'shadow', 'soloAnswer']) {
    test(`a player cannot send a ${type} event`, async () => {
      const { code } = await newRoom();
      const r = await call('POST', `/api/rooms/${code}/events`, { body: { from: PLAYER, type, payload: {} } });
      expect(r).toEqual({ status: 403, body: { error: 'gm only' } });
    });
  }

  test('a player cannot set the fight\'s totals on their own hunter, and the room is unchanged', async () => {
    const { code } = await newRoom();
    const r = await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'vitals', payload: vitals } });
    expect(r).toEqual({ status: 403, body: { error: 'gm only' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
  });

  test('the GM sets the fight\'s totals on a player\'s hunter', async () => {
    const { code, gm } = await newRoom();
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'vitals', payload: vitals } })).status).toBe(200);
  });

  test('a player cannot keep an item by saying the GM\'s fight took it from another hunter, and the room is unchanged', async () => {
    const { code } = await newRoom();
    const spent = { eid: 'd-gm-e9', to: [`${PLAYER}:h1`], item: 'i3' };
    expect(await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'spent', payload: spent } })).toEqual({ status: 403, body: { error: 'gm only' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
  });

  test('a player cannot send facts of its own hunter as the GM\'s noted, and the room is unchanged; the GM can', async () => {
    const { code, gm } = await newRoom();
    const noted = { eid: 'd-gm-e11', to: [`${PLAYER}:h1`], facts: [{ kind: 'gate', name: 'Goblin Den', rank: 'E', above: 0, toBreak: 3 }] };
    expect(await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'noted', payload: noted } })).toEqual({ status: 403, body: { error: 'gm only' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'noted', payload: noted } })).status).toBe(200);
  });

  test('a player cannot raise a shadow for their own hunter, and the room is unchanged; the GM can', async () => {
    const { code, gm } = await newRoom();
    const shadow = { eid: 'd-gm-e10', to: [`${PLAYER}:h1`], shadow: { rank: 'C', archetype: 'brute', grade: 'Knight', monster: null, name: 'Ice Bear' } };
    expect(await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'shadow', payload: shadow } })).toEqual({ status: 403, body: { error: 'gm only' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'shadow', payload: shadow } })).status).toBe(200);
  });

  test('a player cannot land the coin of their own call, and the room keeps only the call', async () => {
    const { code } = await newRoom();
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'coinCall', payload: coinCall } })).status).toBe(200);
    const r = await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'coinLand', payload: coinLand } });
    expect(r).toEqual({ status: 403, body: { error: 'gm only' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events.map((e: any) => e.type)).toEqual(['coinCall']);
  });

  test('the GM lands a coin', async () => {
    const { code, gm } = await newRoom();
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'coinLand', payload: coinLand } })).status).toBe(200);
  });

  test('a player cannot start a Job Change chain on a hunter, even their own, and the room is unchanged', async () => {
    const { code } = await newRoom();
    const chain = { eid: 'd-player1-e9', to: [`${PLAYER}:h1`], job: 'Ranger', kind: 'issue' };
    const r = await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'chain', payload: chain } });
    expect(r).toEqual({ status: 403, body: { error: 'gm only' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
  });

  test('a player cannot pay its own solo run, and the room is unchanged; the GM\'s phone can', async () => {
    const { code, gm } = await newRoom();
    const answer = { eid: 'd-gm-e11', to: [`${PLAYER}:h1`], run: 'd-player1-e8', gate: 'g1', name: 'Den', verdict: 'paid', rewards: { xp: 9999 } };
    expect(await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'soloAnswer', payload: answer } })).toEqual({ status: 403, body: { error: 'gm only' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'soloAnswer', payload: answer } })).status).toBe(200);
  });

  for (const [type, payload] of [['roll', roll], ['questUpdate', questUpdate], ['used', used], ['step', step], ['cast', cast], ['coinCall', coinCall], ['arm', arm], ['soloRun', soloRun]] as const) {
    test(`a player can send a ${type} event`, async () => {
      const { code } = await newRoom();
      const r = await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type, payload } });
      expect(r.status).toBe(200);
    });
  }

  for (const [type, payload] of [['roll', roll], ['questUpdate', questUpdate], ['used', used], ['step', step], ['cast', cast], ['coinCall', coinCall], ['arm', arm], ['soloRun', soloRun]] as const) {
    test(`a player cannot post a ${type} in another player's name, and the room is unchanged`, async () => {
      const { code } = await newRoom();
      const r = await call('POST', `/api/rooms/${code}/events`, { headers: token('p2'), body: { from: OTHER, type, payload } });
      expect(r).toEqual({ status: 403, body: { error: 'not your sheet' } });
      expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
    });
  }

  test('a roll whose hunter key only starts with the sender\'s device id is refused', async () => {
    const { code } = await newRoom();
    const r = await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: 'd-player', type: 'roll', payload: roll } });
    expect(r).toEqual({ status: 403, body: { error: 'not your sheet' } });
  });

  // Each from the GM, so only the event itself is wrong. The reason code says which part.
  const refused: [string, unknown, string][] = [
    ['an unknown type', { from: 'gm', type: 'nuke', payload: system('one') }, 'type'],
    ['a type named after Object.prototype', { from: 'gm', type: '__proto__', payload: system('one') }, 'type'],
    ['a missing sender', { type: 'system', payload: system('one') }, 'sender'],
    ['a sender name over 40 characters', { from: 'x'.repeat(41), type: 'system', payload: system('one') }, 'sender'],
    ['no payload', { from: 'gm', type: 'system' }, 'payload'],
    ['no event id', { from: 'gm', type: 'system', payload: { title: 'one' } }, 'payload'],
    ['an award whose rewards are not an object', { from: 'gm', type: 'award', payload: { ...award(0), rewards: 'lots' } }, 'payload'],
    ['an award for no one', { from: 'gm', type: 'award', payload: { ...award(50), to: [] } }, 'payload'],
    ['an HP change for a target that is not a sheet key', { from: 'gm', type: 'hp', payload: { eid: 'd-gm-e3', to: ['__proto__'], hp: -5 } }, 'payload'],
    ['a status whose def is not an object', { from: 'gm', type: 'status', payload: { eid: 'd-gm-e4', to: [`${PLAYER}:h1`], add: 'burning' } }, 'payload'],
  ];
  for (const [what, body, reason] of refused) {
    test(`an event with ${what} is refused with its reason, and the room is unchanged`, async () => {
      const { code, gm } = await newRoom();
      expect(await call('POST', `/api/rooms/${code}/events`, { headers: gm, body })).toEqual({ status: 400, body: { error: 'bad event', reason } });
      expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
    });
  }

  test('the room keeps the parsed event: a field the type does not have never reaches a player', async () => {
    const { code, gm } = await newRoom();
    await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'award', payload: { ...award(50), v: 2, junk: 'x'.repeat(1000) } } });
    const [ev] = (await call('GET', `/api/rooms/${code}`)).body.events;
    expect(ev.payload).toEqual({ eid: 'd-gm-e2', to: [`${PLAYER}:h1`], rewards: { xp: 50, points: 0, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] } });
  });

  test('an event sent again with its id (an answer that was lost) is one event: the room answers its first seq', async () => {
    const { code, gm } = await newRoom();
    const post = (payload: unknown, type = 'system') => call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type, payload } });
    expect((await post(system('one', 'd-gm-a1'))).body).toEqual({ seq: 1 });
    expect((await post(system('two', 'd-gm-a2'))).body).toEqual({ seq: 2 });
    expect((await post(system('one', 'd-gm-a1'))).body).toEqual({ seq: 1 });
    expect((await post(system('three', 'd-gm-a3'))).body).toEqual({ seq: 3 });
    const all = await call('GET', `/api/rooms/${code}`);
    expect(all.body.events.map((e: any) => [e.seq, e.payload.eid])).toEqual([[1, 'd-gm-a1'], [2, 'd-gm-a2'], [3, 'd-gm-a3']]);
    const other = await newRoom();
    expect((await call('POST', `/api/rooms/${other.code}/events`, { headers: other.gm, body: { from: 'gm', type: 'system', payload: system('one', 'd-gm-a1') } })).body).toEqual({ seq: 1 });
  });

  test('events posted at the same moment each take their own seq, and one id posted many times at once is stored once', async () => {
    const { code, gm } = await newRoom();
    const post = (eid: string) => call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'system', payload: system('n', eid) } });
    const answers = await Promise.all([...Array.from({ length: 8 }, (_, i) => post(`d-gm-b${i}`)), ...Array.from({ length: 6 }, () => post('d-gm-same'))]);
    expect(answers.every(a => a.status === 200)).toBe(true);
    const seqs = answers.map(a => a.body.seq as number);
    expect(new Set(seqs.slice(0, 8)).size).toBe(8);
    expect(new Set(seqs.slice(8)).size).toBe(1);
    const all = await call('GET', `/api/rooms/${code}`);
    expect(all.body.events.map((e: any) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(all.body.events.filter((e: any) => e.payload.eid === 'd-gm-same')).toHaveLength(1);
  });

  test('a poll answer says where to ask from next, and whether the page was full', async () => {
    const { code, gm } = await newRoom();
    for (let i = 1; i <= 3; i++) await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'system', payload: system('n', `d-gm-e${i}`) } });
    expect((await call('GET', `/api/rooms/${code}?after=1`)).body).toMatchObject({ next: 3, more: false });
    expect((await call('GET', `/api/rooms/${code}?after=3`)).body).toMatchObject({ next: 3, more: false });
  });

  test('a body that is not JSON is refused', async () => {
    const { code } = await newRoom();
    expect((await call('POST', `/api/rooms/${code}/events`, { body: '{nope' })).status).toBe(400);
    expect((await call('POST', `/api/rooms/${code}/events`, { body: '[1,2]' })).status).toBe(400);
  });

  test('a body over 64 KB is refused', async () => {
    const { code, gm } = await newRoom();
    const r = await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'system', payload: { text: 'x'.repeat(70_000) } } });
    expect(r.status).toBe(413);
  });
});

describe('sheets', () => {
  const sheet = (name: string) => sheetOf(PLAYER, name, { level: 1 });

  test('a player sheet shows up for everyone in the room', async () => {
    const { code } = await newRoom();
    const put = await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body: sheet('Kai') });
    expect(put).toEqual({ status: 200, body: { ok: true } });
    const room = await call('GET', `/api/rooms/${code}`);
    expect(room.body.sheets[`${PLAYER}:h1`].data).toMatchObject({ hunter: { id: 'h1', name: 'Kai', level: 1 } });
  });

  test('another device cannot overwrite a sheet it does not own', async () => {
    const { code } = await newRoom();
    await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body: sheet('Kai') });
    const steal = await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('thief'), body: sheet('Mallory') });
    expect(steal).toEqual({ status: 403, body: { error: 'not your sheet' } });
    const room = await call('GET', `/api/rooms/${code}`);
    expect(room.body.sheets[`${PLAYER}:h1`].data.hunter.name).toBe('Kai');
  });

  test('a sheet the GM removed cannot be pushed straight back, until the GM allows it', async () => {
    const { code, gm } = await newRoom();
    const path = `/api/rooms/${code}/sheets/${PLAYER}:h1`;
    await call('PUT', path, { headers: token('p1'), body: sheet('Kai') });
    expect((await call('DELETE', path, { headers: gm })).status).toBe(200);
    expect((await call('GET', `/api/rooms/${code}`)).body.sheets).toEqual({});
    expect(await call('PUT', path, { headers: token('p1'), body: sheet('Kai') })).toEqual({ status: 403, body: { error: 'removed' } });
    expect((await call('DELETE', `/api/rooms/${code}/kicks/${PLAYER}:h1`, { headers: gm })).status).toBe(200);
    expect((await call('PUT', path, { headers: token('p1'), body: sheet('Kai') })).status).toBe(200);
  });

  test('the removal a player\'s next poll reads is written by the same request that removes the sheet, and lifted by Allow back', async () => {
    const { code, gm } = await newRoom();
    const key = `${PLAYER}:h1`, path = `/api/rooms/${code}/sheets/${key}`;
    await call('PUT', path, { headers: token('p1'), body: sheet('Kai') });
    const removed = await call('DELETE', path, { headers: gm });
    expect(removed.body.kicked.names).toEqual({ [key]: 'Kai' });
    const polled = await call('GET', `/api/rooms/${code}?after=0`);
    expect(Object.keys(polled.body.docs.kicked.data.keys)).toEqual([key]);
    const allowed = await call('DELETE', `/api/rooms/${code}/kicks/${key}`, { headers: gm });
    expect(allowed.body.kicked).toEqual({ keys: {}, names: {} });
    expect((await call('GET', `/api/rooms/${code}?after=0`)).body.docs.kicked.data.keys).toEqual({});
  });

  test('not even the GM can write the removal doc by hand', async () => {
    const { code, gm } = await newRoom();
    const r = await call('PUT', `/api/rooms/${code}/sheets/_kicked`, { headers: gm, body: { from: 'd-gm', data: { keys: {}, names: {} } } });
    expect(r).toEqual({ status: 403, body: { error: 'server doc' } });
  });

  test('a player cannot remove a sheet', async () => {
    const { code } = await newRoom();
    const path = `/api/rooms/${code}/sheets/${OTHER}:h1`;
    await call('PUT', path, { headers: token('p2'), body: sheetOf(OTHER, 'Bo') });
    expect((await call('DELETE', path, { headers: token('p1') })).status).toBe(403);
  });

  test('room documents are GM only and are listed apart from hunter sheets', async () => {
    const { code, gm } = await newRoom();
    const path = `/api/rooms/${code}/sheets/_fight`, ended = { id: 'e1', active: false, ended: true, at: '2026-11-12T12:00:00.000Z' };
    expect((await call('PUT', path, { body: { from: PLAYER, data: ended } })).status).toBe(403);
    expect((await call('PUT', path, { headers: gm, body: { from: 'gm', data: ended } })).status).toBe(200);
    const room = await call('GET', `/api/rooms/${code}`);
    expect(room.body.docs.fight.data).toEqual(ended);
    expect(room.body.sheets).toEqual({});
  });

  test(`a room doc of ${DOC_MAX} characters is stored, and one of a character more is refused as too large`, async () => {
    const { code, gm } = await newRoom();
    const path = `/api/rooms/${code}/sheets/_rules`;
    /** The room's rules, padded with a field the parser drops, so the doc's JSON is `n` characters long. */
    const padded = (n: number) => { const d = { ...RULES_DOC, pad: '' }; d.pad = 'x'.repeat(n - JSON.stringify(d).length); return d; };
    expect(JSON.stringify(padded(DOC_MAX)).length).toBe(DOC_MAX);
    expect((await call('PUT', path, { headers: gm, body: { from: 'gm', data: padded(DOC_MAX + 1) } }))).toEqual({ status: 413, body: { error: 'too large' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.docs).toEqual({});
    expect((await call('PUT', path, { headers: gm, body: { from: 'gm', data: padded(DOC_MAX) } })).status).toBe(200);
    expect((await call('GET', `/api/rooms/${code}`)).body.docs.rules.data).toEqual(RULES_DOC);
  });

  test(`a sheet push of ${SHEET_MAX} characters, the bound a player's phone counts by, is taken, and one of a character more is refused as too large`, async () => {
    const { code } = await newRoom();
    /** The push's data, padded in the hunter's notes so its JSON is `n` characters long. */
    const padded = (n: number) => { const d = { hunter: { id: 'h1', notes: '' } }; d.hunter.notes = 'x'.repeat(n - JSON.stringify(d).length); return d; };
    expect(JSON.stringify(padded(SHEET_MAX)).length).toBe(SHEET_MAX);
    const put = (n: number) => call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body: { from: PLAYER, data: padded(n) } });
    expect(await put(SHEET_MAX + 1)).toEqual({ status: 413, body: { error: 'too large' } });
    expect((await put(SHEET_MAX)).status).toBe(200);
  });

  test('a sheet whose data is not an object is refused', async () => {
    const { code } = await newRoom();
    const r = await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body: { from: PLAYER, data: 'hello' } });
    expect(r).toEqual({ status: 400, body: { error: 'bad sheet' } });
  });

  test('the 25th hunter is told the room is full', async () => {
    const { code } = await newRoom();
    for (let i = 0; i < 24; i++) {
      const dev = `d-full${i}`;
      const r = await call('PUT', `/api/rooms/${code}/sheets/${dev}:h1`, { headers: token(dev), body: sheetOf(dev, 'H' + i) });
      expect(r.status).toBe(200);
    }
    const r = await call('PUT', `/api/rooms/${code}/sheets/d-late:h1`, { headers: token('late'), body: sheetOf('d-late', 'Late') });
    expect(r).toEqual({ status: 413, body: { error: 'room full' } });
  });

  const badSheets: [string, string, unknown, Record<string, unknown>][] = [
    ['a hunter id that is not the one in its key', `${PLAYER}:h1`, sheetOf(PLAYER, 'Kai', { id: 'h2' }), { error: 'bad sheet' }],
    ['no hunter id', `${PLAYER}:h1`, { from: PLAYER, data: { hunter: { name: 'Kai' } } }, { error: 'bad sheet' }],
    ['a key without the device', 'h1', sheetOf(PLAYER, 'Kai'), { error: 'bad hunter id' }],
    ['a sender that is not a device id', `${PLAYER}:h1`, { ...sheetOf(PLAYER, 'Kai'), from: 'not a device!' }, { error: 'bad sheet' }],
  ];
  for (const [what, key, body, error] of badSheets) {
    test(`a sheet with ${what} is refused, and the room is unchanged`, async () => {
      const { code } = await newRoom();
      expect(await call('PUT', `/api/rooms/${code}/sheets/${key}`, { headers: token('p1'), body })).toEqual({ status: 400, body: error });
      expect((await call('GET', `/api/rooms/${code}`)).body.sheets).toEqual({});
    });
  }

  test('the room keeps the repaired sheet: a huge name is cut and a __proto__ key is gone', async () => {
    const { code } = await newRoom();
    const body = `{"from":"${PLAYER}","data":{"hunter":{"__proto__":{"admin":true},"id":"h1","name":"${'x'.repeat(1000)}"}}}`;
    expect((await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body })).status).toBe(200);
    const data = (await call('GET', `/api/rooms/${code}`)).body.sheets[`${PLAYER}:h1`].data.hunter;
    expect([data.name.length, data.admin, Object.hasOwn(data, '__proto__')]).toEqual([60, undefined, false]);
  });

  const badDocs: [string, string, unknown][] = [
    ['a name the app does not publish', '_nope', { enabled: true, playerPick: true }],
    ['a name Object.prototype has', '_constructor', { enabled: true, playerPick: true }],
    ['build switches that are not true or false', '_rules', { ...RULES_DOC, build: { enabled: 'yes', playerPick: true } }],
    ['the old build doc', '_build', { enabled: true, playerPick: true }],
    ['a running fight without its rows', '_fight', { id: 'e1', by: 'd-gm', active: true, ended: false, at: '', now: 0, currentId: null, ahead: [], grid: { w: 20, h: 14 }, log: [] }],
    ['the old encounter doc', '_encounter', { id: 'e1', active: false, ended: true, at: '' }],
  ];
  for (const [what, name, data] of badDocs) {
    test(`a room doc with ${what} is refused, and the room is unchanged`, async () => {
      const { code, gm } = await newRoom();
      expect(await call('PUT', `/api/rooms/${code}/sheets/${name}`, { headers: gm, body: { from: 'gm', data } })).toEqual({ status: 400, body: { error: 'bad doc' } });
      expect((await call('GET', `/api/rooms/${code}`)).body.docs).toEqual({});
    });
  }
});

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ', DIGITS = '23456789';
/** A code no other run of these tests has made, so a database kept between runs never holds it. */
const someCode = (): RoomCode => parseRoomCode(Array.from({ length: 5 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('') + DIGITS[Math.floor(Math.random() * DIGITS.length)])!;
const KAI_KEY = parseSheetKey(`${PLAYER}:h1`)!, KAI_PHONE = parseDeviceId(PLAYER)!;

describe('a room\'s expiry and the sweep', () => {
  test('a room used 30 days ago is still there; a millisecond later the sweep removes it, its sheets with it', async () => {
    const st = await freshStore(), code = someCode(), t0 = Date.now(), sheet = parseSheet(KAI_KEY, sheetOf(PLAYER, 'Kai').data)!;
    try {
      expect(await st.create(code, 'hash', t0)).toBe(true);
      await st.putSheet(code, KAI_KEY, KAI_PHONE, sheet, t0);
      expect(await st.sweep(t0 + ROOM_TTL_MS)).not.toContain(code);
      expect(await st.exists(code, t0 + ROOM_TTL_MS)).toBe(true);
      expect(await st.exists(code, t0 + ROOM_TTL_MS + 1)).toBe(false);
      expect(await st.sweep(t0 + ROOM_TTL_MS + 1)).toContain(code);
      expect(await st.create(code, 'hash', t0 + ROOM_TTL_MS + 1)).toBe(true);
      expect((await st.board(code)).sheets).toEqual({});
    } finally { await st.close(); }
  });

  test('a new room under the code of one that expired shows the GM none of the old room\'s phones as present', async () => {
    const st = await freshStore(), code = someCode(), t0 = Date.now(), later = t0 + ROOM_TTL_MS + 1;
    try {
      await st.create(code, 'hash', t0);
      st.see(code, KAI_PHONE, t0);
      expect([...st.presence(code).keys()]).toEqual([KAI_PHONE]);
      await st.sweep(later);
      await st.create(code, 'hash', later);
      expect([...st.presence(code).keys()]).toEqual([]);
    } finally { await st.close(); }
  });

  test('creating a room sweeps the expired ones: after 31 days the old code is no longer a room', async () => {
    const { code } = await newRoom();
    const realNow = Date.now, t0 = realNow();
    try {
      Date.now = () => t0 + ROOM_TTL_MS + 1;
      expect((await call('POST', '/api/rooms')).status).toBe(200);
      Date.now = () => t0;
      expect(await call('GET', `/api/rooms/${code}?peek=1`)).toEqual({ status: 200, body: { exists: false } });
    } finally { Date.now = realNow; }
  });
});

describe('a Postgres that does not answer', () => {
  test('rooms are not kept in memory: every room route answers 503, never "no such room", and health says why', async () => {
    const db = database(NO_PG, postgresStore, 60_000), server = serverOf(db);
    try {
      const health = await call('GET', '/api/health', { server });
      expect(health.status).toBe(503);
      expect(health.body).toMatchObject({ ok: false, db: 'postgres', error: 'ERR_POSTGRES_CONNECTION_REFUSED' });
      expect(Number.isNaN(Date.parse(health.body.since))).toBe(false);
      for (const [method, path] of [['POST', '/api/rooms'], ['GET', '/api/rooms/ABCD23?peek=1'], ['GET', '/api/rooms/ABCD23?after=0']] as const) {
        expect(await call(method, path, { server })).toEqual({ status: 503, body: { error: 'no database' } });
      }
    } finally { await db.close(); }
  });

  test('when Postgres answers again, rooms are served without a restart', async () => {
    let tries = 0, answered = (): void => {};
    const second = new Promise<void>(resolve => { answered = resolve; });
    const open = async (): Promise<Store> => {
      tries++;
      if (tries === 1) throw Object.assign(new Error('Failed to connect'), { code: 'ERR_POSTGRES_CONNECTION_REFUSED' });
      answered();
      return memoryStore();
    };
    const db = database('postgres://later', open, 5), server = serverOf(db);
    try {
      expect((await call('POST', '/api/rooms', { server })).status).toBe(503);
      await second;
      expect((await call('GET', '/api/health', { server })).body).toEqual({ ok: true, db: 'postgres' });
      expect((await call('POST', '/api/rooms', { server })).status).toBe(200);
    } finally { await db.close(); }
  });
});

describe('a removal is one record, the room\'s', () => {
  test('a server started again over the same rooms still refuses the removed sheet for 20 seconds, then takes it', async () => {
    const st = await freshStore(), first = serverOf(openDatabase(st));
    const again = PG ? await postgresStore(PG) : st, restarted = serverOf(openDatabase(again));
    const realNow = Date.now, t0 = realNow();
    try {
      Date.now = () => t0;
      const made = await call('POST', '/api/rooms', { server: first }), gm = { 'x-gm-key': made.body.gmKey };
      const path = `/api/rooms/${made.body.code}/sheets/${PLAYER}:h1`, kai = sheetOf(PLAYER, 'Kai');
      expect((await call('PUT', path, { server: first, headers: token('p1'), body: kai })).status).toBe(200);
      expect((await call('DELETE', path, { server: first, headers: gm })).status).toBe(200);
      Date.now = () => t0 + 19_000;
      expect(await call('PUT', path, { server: restarted, headers: token('p1'), body: kai })).toEqual({ status: 403, body: { error: 'removed' } });
      Date.now = () => t0 + 21_000;
      expect((await call('PUT', path, { server: restarted, headers: token('p1'), body: kai })).status).toBe(200);
    } finally {
      Date.now = realNow;
      await st.close();
      if (again !== st) await again.close();
    }
  });
});

describe('a write for a phone carries its token', () => {
  test('a sheet pushed with no device token is refused, and the room is unchanged', async () => {
    const { code } = await newRoom();
    expect(await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { body: sheetOf(PLAYER, 'Kai') })).toEqual({ status: 403, body: { error: 'not your sheet' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.sheets).toEqual({});
  });

  test('a roll posted with no device token is refused, and the room is unchanged', async () => {
    const { code } = await newRoom();
    expect(await call('POST', `/api/rooms/${code}/events`, { body: { from: PLAYER, type: 'roll', payload: roll } })).toEqual({ status: 403, body: { error: 'not your sheet' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
  });

  test('a phone whose id is not of the app\'s form needs a token too: no write goes unowned', async () => {
    const { code } = await newRoom();
    const odd = 'phone7', path = `/api/rooms/${code}/sheets/${odd}:h1`;
    expect((await call('PUT', path, { body: sheetOf(odd, 'Kai') })).status).toBe(403);
    expect((await call('PUT', path, { headers: token('mine'), body: sheetOf(odd, 'Kai') })).status).toBe(200);
    expect(await call('PUT', path, { headers: token('thief'), body: sheetOf(odd, 'Mallory') })).toEqual({ status: 403, body: { error: 'not your sheet' } });
  });

  test('the GM\'s key writes without a token', async () => {
    const { code, gm } = await newRoom();
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'system', payload: system('one') } })).status).toBe(200);
  });
});

const pgOnly = PG ? describe : describe.skip;
pgOnly('Postgres rows (with DATABASE_URL)', () => {
  test('a sheet and an event are kept as JSON objects, not as strings of JSON', async () => {
    const { code, gm } = await newRoom();
    await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body: sheetOf(PLAYER, 'Kai') });
    await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type: 'system', payload: system('one') } });
    const sql = new Bun.SQL(PG!);
    try {
      expect((await sql`SELECT jsonb_typeof(data) AS t FROM sheets WHERE room = ${code}`).map(r => r.t)).toEqual(['object']);
      expect((await sql`SELECT jsonb_typeof(payload) AS t FROM events WHERE room = ${code}`).map(r => r.t)).toEqual(['object']);
    } finally { await sql.close(); }
  });

  test('a row an older build wrote as a string of JSON is read again after a start', async () => {
    const { code } = await newRoom();
    const sql = new Bun.SQL(PG!), sheet = JSON.stringify(sheetOf(PLAYER, 'Kai').data);
    try {
      await sql`INSERT INTO sheets (room, hid, at, from_id, data) VALUES (${code}, ${PLAYER + ':h1'}, ${Date.now()}, ${PLAYER}, ${sheet}::jsonb)`;
      expect((await sql`SELECT jsonb_typeof(data) AS t FROM sheets WHERE room = ${code}`).map(r => r.t)).toEqual(['string']);
    } finally { await sql.close(); }
    const started = await postgresStore(PG!);
    try { expect((await call('GET', `/api/rooms/${code}`, { server: serverOf(openDatabase(started)) })).body.sheets[`${PLAYER}:h1`].data.hunter.name).toBe('Kai'); }
    finally { await started.close(); }
  });

  test('a row no parser of this build reads is left out, and the room still answers', async () => {
    const { code } = await newRoom();
    const sql = new Bun.SQL(PG!);
    try { await sql`INSERT INTO sheets (room, hid, at, from_id, data) VALUES (${code}, ${PLAYER + ':h1'}, ${Date.now()}, ${PLAYER}, ${{ nothing: true }}::jsonb)`; }
    finally { await sql.close(); }
    const r = await call('GET', `/api/rooms/${code}`);
    expect([r.status, r.body.sheets]).toEqual([200, {}]);
  });
});

describe('paths outside the API', () => {
  test('dot files and parent paths are never served', async () => {
    for (const path of ['/.git/config', '/.claude/settings.json', '/..%2Fserver.ts']) {
      const res = await handler(new Request('http://test' + path));
      expect([400, 404]).toContain(res.status);
    }
  });
});
