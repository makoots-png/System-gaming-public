import { describe, expect, test } from 'bun:test';
import { buildApp } from '../scripts/build.ts';
import { MEM_EVENTS, database, handler, memoryStore, openDatabase, postgresStore, serverOf } from '../server.ts';
import { parseEvent } from '../src/core/protocol.ts';
import type { StoredEvent } from '../src/core/protocol.ts';
import type { Store } from '../server.ts';
import { DOC_MAX, ROOM_SHEETS, SHEET_MAX, parseDeviceId, parseRoomCode, parseSheet, parseSheetKey } from '../src/core/protocol.ts';
import type { RoomCode } from '../src/core/protocol.ts';
import { ROOM_TTL_MS } from '../src/core/room-server.ts';
import { newEvent } from '../src/core/protocol.ts';
import { CHAPTER_MAX, chapterSize } from '../src/core/story/story.ts';
import { worstBody, worstChapter } from './fixtures/worst-chapter.ts';
import { roomRulesOf } from '../src/core/hunter/build.ts';
import { rulesOf } from '../src/core/rules.ts';

type Reply = { status: number; body: Record<string, any> };

/** The room's rules doc as a GM's phone publishes it (build.ts `roomRulesOf`). */
const RULES_DOC = roomRulesOf(rulesOf({ build: { playerPick: false } }));
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
const cast = { eid: 'd-player1-e5', by: `${PLAYER}:h1`, ability: 'strike', aim: 'c2', at: 2500 };
/** A player's solo run of the room's gate g1, as gates/solo.ts `soloRunBody` writes it. */
const soloRun = { eid: 'd-player1-e8', by: `${PLAYER}:h1`, gate: 'g1', name: 'Kai', outcome: 'won', rounds: 4, life: 'up' };
const arm = { eid: 'd-player1-e8', by: `${PLAYER}:h1`, ability: 'parry', on: null };
const coinCall = { eid: 'd-player1-e6', by: `${PLAYER}:h1`, roll: `${PLAYER}:r12`, who: 'Kai', what: 'STR check', face: 20, call: 'heads' };
const coinLand = { eid: 'd-player1-e7', roll: `${PLAYER}:r12`, side: 'heads' };
/** The fight's totals for a player's hunter, as the GM's phone sends them. */
const vitals = { eid: 'd-gm-e5', to: [`${PLAYER}:h1`], life: { at: 'up', hp: 12 }, mana: 3, fatigue: 20, statuses: [] };
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
    const r = await call('GET', `/api/rooms/${code}?after=999999999`, { headers: gm });
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

  for (const type of ['system', 'award', 'quest', 'hp', 'vitals', 'spent', 'status', 'revive', 'chain', 'coinLand', 'shadow', 'soloAnswer', 'chapter', 'weigh']) {
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

  test('a player cannot open a story\'s chapter for their own hunter, and the room is unchanged', async () => {
    const { code } = await newRoom();
    const chapter = { eid: 'd-gm-e12', to: [`${PLAYER}:h1`], words: { title: 'THE DEEP ASKS', line: '' }, rewards: { points: 5 }, quest: null };
    expect(await call('POST', `/api/rooms/${code}/events`, { headers: token('p1'), body: { from: PLAYER, type: 'chapter', payload: chapter } })).toEqual({ status: 403, body: { error: 'gm only' } });
    expect((await call('GET', `/api/rooms/${code}`)).body.events).toEqual([]);
  });

  test('the largest chapter a GM can save, sent to the room\'s 24 hunters with the longest keys, is taken and reads back whole', async () => {
    const { code, gm } = await newRoom();
    const ev = newEvent('chapter', worstBody('2026-11-19T10:00:00.000Z') as never, { device: 'd-gm', now: Date.parse('2026-11-19T10:00:00.000Z'), rand: 0.5 })!;
    expect(chapterSize(worstChapter())).toBe(CHAPTER_MAX);
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'd-gm', type: 'chapter', payload: ev.payload } })).status).toBe(200);
    const [back] = (await call('GET', `/api/rooms/${code}`, { headers: gm })).body.events;
    expect([back.type, back.payload]).toEqual(['chapter', ev.payload]);
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

  test('another message under an id the room holds is refused (409 id taken) and not stored; the first, sent again, still answers its seq', async () => {
    const { code, gm } = await newRoom();
    const post = (payload: unknown, type = 'system') => call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'gm', type, payload } });
    expect((await post(system('one', 'd-gm-a1'))).body).toEqual({ seq: 1 });
    expect(await post(system('another', 'd-gm-a1')), 'the same type with another body').toEqual({ status: 409, body: { error: 'id taken' } });
    expect(await post(award(5, 'd-gm-a1'), 'award'), 'another type').toEqual({ status: 409, body: { error: 'id taken' } });
    expect((await post(system('one', 'd-gm-a1'))).body).toEqual({ seq: 1 });
    const all = await call('GET', `/api/rooms/${code}`);
    expect(all.body.events.map((e: any) => [e.seq, e.type, e.payload.title])).toEqual([[1, 'system', 'one']]);
  });

  test('an offer ends once: a take back under the accept\'s id answers the accept\'s seq, and the room holds one end', async () => {
    const { code, gm } = await newRoom();
    const post = (from: string, type: string, payload: unknown, headers: Record<string, string> = token(from)) => call('POST', `/api/rooms/${code}/events`, { headers, body: { from, type, payload } });
    const offer = 'd-player1-mo1', end = `${offer}-e`, A = `${PLAYER}:h1`, B = `${OTHER}:h3`;
    const potion = { from: 'i2', item: { name: 'Healing Potion', qty: 1 } };
    expect((await post(PLAYER, 'offer', { eid: offer, by: A, to: [B], names: { by: 'Brakk', to: 'Mira' }, gives: { gold: 0, items: [potion] }, asks: { gold: 20, items: [] } })).body).toEqual({ seq: 1 });
    const answers = await Promise.all([
      post(OTHER, 'offerEnd', { eid: end, by: B, to: [A], offer, how: 'accept', gives: { gold: 20, items: [] } }),
      post(PLAYER, 'offerEnd', { eid: end, by: A, to: [B], offer, how: 'withdraw', gives: { gold: 0, items: [] } }),
      post('gm', 'offerStop', { eid: end, to: [A, B], offer }, gm),
    ]);
    expect(answers.map(a => a.body)).toEqual([{ seq: 2 }, { seq: 2 }, { seq: 2 }]);
    const all = await call('GET', `/api/rooms/${code}`, { headers: gm });
    expect(all.body.events.filter((e: any) => e.payload.eid === end)).toHaveLength(1);
    expect(all.body.events.map((e: any) => e.seq)).toEqual([1, 2]);
  });

  test('only the giver\'s phone may post its offer, only a hunter\'s own phone its end, and only the GM key a stop', async () => {
    const { code, gm } = await newRoom();
    const post = (from: string, type: string, payload: unknown, headers: Record<string, string> = token(from)) => call('POST', `/api/rooms/${code}/events`, { headers, body: { from, type, payload } });
    const offer = 'd-player1-mo2', A = `${PLAYER}:h1`, B = `${OTHER}:h3`;
    const body = { eid: offer, by: A, to: [B], names: { by: 'Brakk', to: 'Mira' }, gives: { gold: 5, items: [] }, asks: { gold: 0, items: [] } };
    expect(await post(OTHER, 'offer', body)).toEqual({ status: 403, body: { error: 'not your sheet' } });
    expect(await post(OTHER, 'offerEnd', { eid: `${offer}-e`, by: A, to: [B], offer, how: 'withdraw', gives: { gold: 0, items: [] } })).toEqual({ status: 403, body: { error: 'not your sheet' } });
    expect(await post(PLAYER, 'offerStop', { eid: `${offer}-e`, to: [A, B], offer })).toEqual({ status: 403, body: { error: 'gm only' } });
    expect(await post(PLAYER, 'roll', { ...roll, eid: `${offer}-e` })).toEqual({ status: 400, body: { error: 'bad event', reason: 'payload' } });
    expect((await post('gm', 'offerStop', { eid: `${offer}-e`, to: [A, B], offer }, gm)).status).toBe(200);
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

describe('what each phone gets of the room (notes-5-trade.md 4.1)', () => {
  const THIRD = 'd-player3', A = `${PLAYER}:h1`, B = `${OTHER}:h3`;
  const sword = { id: 'i1', name: 'Iron Sword', rar: 'rare', type: 'weapon', slot: 'weapon', qty: 1 };
  const potions = { id: 'i2', name: 'Healing Potion', rar: 'common', type: 'consumable', qty: 3 };
  /** Mira, with a worn sword and three potions in her bag. */
  const mira = { from: OTHER, data: { hunter: { id: 'h3', name: 'Mira', level: 4, job: 'Healer', items: [sword, potions], equipped: { weapon: 'i1' } } } };
  const offer = (eid: string) => ({ eid, by: A, to: [B], names: { by: 'Kai', to: 'Mira' }, gives: { gold: 5, items: [] }, asks: { gold: 0, items: [] } });
  /** A room with Kai's and Mira's sheets, a third player's, and an offer from Kai to Mira that Mira refused. */
  async function tradeRoom() {
    const { code, gm } = await newRoom();
    for (const [dev, body] of [[PLAYER, sheetOf(PLAYER, 'Kai')], [OTHER, mira], [THIRD, sheetOf(THIRD, 'Eldrin')]] as const) {
      expect((await call('PUT', `/api/rooms/${code}/sheets/${dev}:${dev === OTHER ? 'h3' : 'h1'}`, { headers: token(dev), body })).status).toBe(200);
    }
    const post = (from: string, type: string, payload: unknown, headers: Record<string, string> = token(from)) => call('POST', `/api/rooms/${code}/events`, { headers, body: { from, type, payload } });
    expect((await post('gm', 'system', system('Welcome', 'd-gm-w1'), gm)).body).toEqual({ seq: 1 });
    expect((await post(PLAYER, 'offer', offer('d-player1-mo1'))).body).toEqual({ seq: 2 });
    expect((await post(OTHER, 'offerEnd', { eid: 'd-player1-mo1-e', by: B, to: [A], offer: 'd-player1-mo1', how: 'refuse', gives: { gold: 0, items: [] } })).body).toEqual({ seq: 3 });
    const poll = (dev: string | null, headers: Record<string, string> = dev ? token(dev) : {}, after = 0) => call('GET', `/api/rooms/${code}?after=${after}${dev ? `&d=${dev}` : ''}`, { headers });
    return { code, gm, post, poll };
  }
  const eids = (r: Reply): string[] => r.body.events.map((e: any) => e.payload.eid);

  test('a player\'s poll carries its own sheet whole and the other players\' as faces: name, level, job and unworn bag lines', async () => {
    const { poll } = await tradeRoom();
    const sheets = (await poll(PLAYER)).body.sheets;
    expect(sheets[A].data).toMatchObject({ hunter: { id: 'h1', name: 'Kai' } });
    expect(sheets[B].data).toEqual({ face: { name: 'Mira', level: 4, job: 'Healer', bag: [{ id: 'i2', name: 'Healing Potion', qty: 3, rar: 'common' }] } });
    expect(sheets[`${THIRD}:h1`].data).toEqual({ face: { name: 'Eldrin', level: 1, job: null, bag: [] } });
  });

  test('with the GM\'s trading switch off, a player\'s faces carry no bag lines; turned on again, they do', async () => {
    const { code, gm, poll } = await tradeRoom();
    const rules = (on: boolean) => call('PUT', `/api/rooms/${code}/sheets/_rules`, { headers: gm, body: { from: 'gm', data: { ...RULES_DOC, trade: { on } } } });
    expect((await rules(false)).status).toBe(200);
    expect((await poll(PLAYER)).body.sheets[B].data).toEqual({ face: { name: 'Mira', level: 4, job: 'Healer', bag: null } });
    expect((await rules(true)).status).toBe(200);
    expect((await poll(PLAYER)).body.sheets[B].data.face.bag).toEqual([{ id: 'i2', name: 'Healing Potion', qty: 3, rar: 'common' }]);
  });

  test('the GM\'s poll carries every sheet whole and every message, sealed ones too', async () => {
    const { gm, poll } = await tradeRoom();
    const r = await poll(null, gm);
    expect(r.body.sheets[B].data.hunter).toMatchObject({ name: 'Mira', items: [{ id: 'i1' }, { id: 'i2' }] });
    expect(eids(r)).toEqual(['d-gm-w1', 'd-player1-mo1', 'd-player1-mo1-e']);
  });

  test('a sealed message reaches the GM and its hunters\' phones and no other: an offer and its end reach Kai\'s and Mira\'s phones', async () => {
    const { poll } = await tradeRoom();
    for (const dev of [PLAYER, OTHER]) expect(eids(await poll(dev))).toEqual(['d-gm-w1', 'd-player1-mo1', 'd-player1-mo1-e']);
  });

  test('a third player\'s phone gets neither an offer between two others nor its end', async () => {
    const { poll } = await tradeRoom();
    expect(eids(await poll(THIRD))).toEqual(['d-gm-w1']);
  });

  test('a weigh reaches only its hunter\'s phone: the GM\'s poll and Kai\'s carry it, Mira\'s, a third player\'s and an unproven poll do not', async () => {
    const { gm, post, poll } = await tradeRoom();
    expect((await post('gm', 'weigh', { eid: 'd-gm-wt1', to: [A], total: 2, force: 20 }, gm)).body).toEqual({ seq: 4 });
    expect(eids(await poll(null, gm))).toContain('d-gm-wt1');
    expect(eids(await poll(PLAYER))).toContain('d-gm-wt1');
    for (const r of [await poll(OTHER), await poll(THIRD), await poll(null), await poll(PLAYER, token('thief'))]) expect(eids(r)).not.toContain('d-gm-wt1');
  });

  test('a word reaches the GM and not the other player: Kai\'s word and the GM\'s answer reach the GM\'s poll and Kai\'s, never Mira\'s, a third player\'s or an unproven poll', async () => {
    const { gm, post, poll } = await tradeRoom();
    expect((await post(PLAYER, 'word', { eid: 'd-player1-wd1', by: A, name: 'Kai', text: 'Can my shadow scout the gate?' })).body).toEqual({ seq: 4 });
    expect((await post('gm', 'wordBack', { eid: 'd-gm-wb1', to: [A], re: 'd-player1-wd1', text: 'Yes.' }, gm)).body).toEqual({ seq: 5 });
    for (const r of [await poll(null, gm), await poll(PLAYER)]) expect(eids(r).slice(-2)).toEqual(['d-player1-wd1', 'd-gm-wb1']);
    for (const r of [await poll(OTHER), await poll(THIRD), await poll(null), await poll(OTHER, token('thief'))]) {
      expect(eids(r)).not.toContain('d-player1-wd1');
      expect(eids(r)).not.toContain('d-gm-wb1');
    }
  });

  test('a player cannot send another\'s word nor answer one, and the room is unchanged', async () => {
    const { post, poll, gm } = await tradeRoom();
    expect((await post(OTHER, 'word', { eid: 'd-player2-wd1', by: A, name: 'Kai', text: 'Not me' })).status).toBe(403);
    expect(await post(PLAYER, 'wordBack', { eid: 'd-player1-wb1', to: [A], re: 'd-player1-wd1', text: 'Yes.' })).toEqual({ status: 403, body: { error: 'gm only' } });
    expect(eids(await poll(null, gm))).toEqual(['d-gm-w1', 'd-player1-mo1', 'd-player1-mo1-e']);
  });

  test('a player cannot weigh their own hunter\'s dice, and the room is unchanged', async () => {
    const { post, poll, gm } = await tradeRoom();
    expect(await post(PLAYER, 'weigh', { eid: 'd-player1-wt1', to: [A], total: 5, force: 20 })).toEqual({ status: 403, body: { error: 'gm only' } });
    expect(eids(await poll(null, gm))).not.toContain('d-player1-wt1');
  });

  test('a poll without a proven device gets faces and no sealed message, and so does one with another phone\'s token', async () => {
    const { poll } = await tradeRoom();
    for (const r of [await poll(null), await poll(OTHER, token('thief'))]) {
      expect(eids(r)).toEqual(['d-gm-w1']);
      expect(r.body.sheets[B].data).toHaveProperty('face');
      expect(r.body.sheets[A].data).toHaveProperty('face');
    }
  });

  test('the cursor passes a sealed message a phone did not get, so its next poll starts after it', async () => {
    const { gm, post, poll } = await tradeRoom();
    const first = await poll(THIRD);
    expect(first.body).toMatchObject({ next: 3, more: false });
    expect((await post('gm', 'system', system('Later', 'd-gm-w2'), gm)).body).toEqual({ seq: 4 });
    const later = await poll(THIRD, token(THIRD), first.body.next);
    expect(eids(later)).toEqual(['d-gm-w2']);
    expect(later.body.next).toBe(4);
  });

  test('a phone back after a removal polls before its sheet binds it again: its cursor stops short of the offer sealed to it, and the poll after its push gets the offer', async () => {
    const { code, gm, post, poll } = await tradeRoom();
    expect((await call('DELETE', `/api/rooms/${code}/sheets/${B}`, { headers: gm })).status).toBe(200);
    expect((await post(PLAYER, 'offer', offer('d-player1-mo3'))).body).toEqual({ seq: 4 });
    expect((await post('gm', 'system', system('Later', 'd-gm-w3'), gm)).body).toEqual({ seq: 5 });
    const back = await poll(OTHER, token(OTHER), 3);
    expect([eids(back), back.body.next, back.body.more]).toEqual([[], 3, false]);
    expect((await call('DELETE', `/api/rooms/${code}/kicks/${B}`, { headers: gm })).status).toBe(200);
    expect((await call('PUT', `/api/rooms/${code}/sheets/${B}`, { headers: token(OTHER), body: mira })).status).toBe(200);
    const proven = await poll(OTHER, token(OTHER), back.body.next);
    expect([eids(proven), proven.body.next]).toEqual([['d-player1-mo3', 'd-gm-w3'], 5]);
    const thief = await poll(OTHER, token('thief'), 3);
    expect([eids(thief), thief.body.next], 'a phone that names Mira\'s device without her token is held there too, and learns nothing more').toEqual([[], 3]);
  });

  test('a poll binds no phone: before its first write a phone gets no message sealed to its hunter, and a thief who polled first cannot write for it', async () => {
    const { code, gm } = await newRoom();
    const NEW = 'd-player4', D = `${NEW}:h1`;
    await call('PUT', `/api/rooms/${code}/sheets/${A}`, { headers: token(PLAYER), body: sheetOf(PLAYER, 'Kai') });
    const toNew = { ...offer('d-player1-mo2'), to: [D] };
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: token(PLAYER), body: { from: PLAYER, type: 'offer', payload: toNew } })).body).toEqual({ seq: 1 });
    expect(eids(await call('GET', `/api/rooms/${code}?after=0&d=${NEW}`, { headers: token('thief') }))).toEqual([]);
    expect(eids(await call('GET', `/api/rooms/${code}?after=0&d=${NEW}`, { headers: token(NEW) }))).toEqual([]);
    expect((await call('PUT', `/api/rooms/${code}/sheets/${D}`, { headers: token(NEW), body: sheetOf(NEW, 'Rin') })).status).toBe(200);
    expect(eids(await call('GET', `/api/rooms/${code}?after=0&d=${NEW}`, { headers: token(NEW) }))).toEqual(['d-player1-mo2']);
    expect(await call('PUT', `/api/rooms/${code}/sheets/${D}`, { headers: token('thief'), body: sheetOf(NEW, 'Mallory') })).toEqual({ status: 403, body: { error: 'not your sheet' } });
    expect((await call('GET', `/api/rooms/${code}`, { headers: gm })).body.sheets[D].data.hunter.name).toBe('Rin');
  });

  test('a face pushed as a sheet is refused, and the room is unchanged', async () => {
    const { code, gm } = await newRoom();
    const face = { from: PLAYER, data: { face: { name: 'Kai', level: 99, job: null, bag: [] } } };
    expect(await call('PUT', `/api/rooms/${code}/sheets/${A}`, { headers: token(PLAYER), body: face })).toEqual({ status: 400, body: { error: 'bad sheet' } });
    expect((await call('GET', `/api/rooms/${code}`, { headers: gm })).body.sheets).toEqual({});
  });
});

describe('a phone\'s hold on its hunters (SMX-sync-5)', () => {
  const VIC = 'd-vic1', ONE = `${VIC}:h1`, TWO = `${VIC}:h2`;
  const chapter = (eid: string, to: string) => ({ eid, to: [to], words: { title: 'SECRET CHAPTER', line: '' }, rewards: { points: 5 }, quest: null });
  const two = (name: string, id: string) => ({ from: VIC, data: { hunter: { id, name } } });
  /** A room where the victim's phone holds two hunters, Kai and Rin, and the GM has sent Rin a sealed chapter. */
  async function victimRoom() {
    const { code, gm } = await newRoom();
    for (const [key, body] of [[ONE, two('Kai', 'h1')], [TWO, two('Rin', 'h2')]] as const) {
      expect((await call('PUT', `/api/rooms/${code}/sheets/${key}`, { headers: token(VIC), body })).status).toBe(200);
    }
    expect((await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'd-gm', type: 'chapter', payload: chapter('d-gm-c1', TWO) } })).body).toEqual({ seq: 1 });
    const poll = (headers: Record<string, string>) => call('GET', `/api/rooms/${code}?after=0&d=${VIC}`, { headers });
    const push = (headers: Record<string, string>, name: string) => call('PUT', `/api/rooms/${code}/sheets/${TWO}`, { headers, body: two(name, 'h2') });
    return { code, gm, poll, push };
  }
  const titles = (r: Reply): string[] => r.body.events.map((e: any) => e.payload.words?.title ?? e.payload.title);

  test('after the GM removes one of a phone\'s two hunters, another phone polling with its id gets only faces and no sealed chapter, and the player still writes the other', async () => {
    const { code, gm, poll, push } = await victimRoom();
    expect((await call('DELETE', `/api/rooms/${code}/sheets/${ONE}`, { headers: gm })).status).toBe(200);
    const thief = await poll(token('thief'));
    expect(titles(thief)).toEqual([]);
    expect(thief.body.sheets[TWO].data).toEqual({ face: { name: 'Rin', level: 1, job: null, bag: [] } });
    expect(await push(token('thief'), 'Mallory')).toEqual({ status: 403, body: { error: 'not your sheet' } });
    expect((await push(token(VIC), 'Rin')).status).toBe(200);
    expect(titles(await poll(token(VIC)))).toEqual(['SECRET CHAPTER']);
  });

  test('after the GM releases a phone, another phone that polls first with its id reads no sealed chapter and takes nothing: the player\'s new phone writes and holds it', async () => {
    const { code, gm, poll, push } = await victimRoom();
    expect((await call('POST', `/api/rooms/${code}/release`, { headers: gm, body: { device: VIC } })).body).toEqual({ ok: true });
    const thief = await poll(token('thief'));
    expect(titles(thief)).toEqual([]);
    expect(thief.body.sheets[TWO].data).toHaveProperty('face');
    expect((await push(token('newphone'), 'Rin')).status).toBe(200);
    expect(titles(await poll(token('newphone')))).toEqual(['SECRET CHAPTER']);
    expect(await push(token('thief'), 'Mallory')).toEqual({ status: 403, body: { error: 'not your sheet' } });
    expect(await push(token(VIC), 'Rin')).toEqual({ status: 403, body: { error: 'not your sheet' } });
  });

  test('removing a phone\'s last hunter frees it: once the GM allows it back, the player\'s new phone may push it', async () => {
    const { code, gm } = await newRoom();
    const path = `/api/rooms/${code}/sheets/${ONE}`;
    expect((await call('PUT', path, { headers: token(VIC), body: two('Kai', 'h1') })).status).toBe(200);
    expect((await call('DELETE', path, { headers: gm })).status).toBe(200);
    expect((await call('DELETE', `/api/rooms/${code}/kicks/${ONE}`, { headers: gm })).status).toBe(200);
    expect((await call('PUT', path, { headers: token('newphone'), body: two('Kai', 'h1') })).status).toBe(200);
    expect(await call('PUT', path, { headers: token(VIC), body: two('Kai', 'h1') })).toEqual({ status: 403, body: { error: 'not your sheet' } });
  });
});

describe('sheets', () => {
  const sheet = (name: string) => sheetOf(PLAYER, name, { level: 1 });

  test('a player sheet reaches the GM whole', async () => {
    const { code, gm } = await newRoom();
    const put = await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body: sheet('Kai') });
    expect(put).toEqual({ status: 200, body: { ok: true } });
    const room = await call('GET', `/api/rooms/${code}`, { headers: gm });
    expect(room.body.sheets[`${PLAYER}:h1`].data).toMatchObject({ hunter: { id: 'h1', name: 'Kai', level: 1 } });
  });

  test('another device cannot overwrite a sheet it does not own', async () => {
    const { code, gm } = await newRoom();
    await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body: sheet('Kai') });
    const steal = await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('thief'), body: sheet('Mallory') });
    expect(steal).toEqual({ status: 403, body: { error: 'not your sheet' } });
    const room = await call('GET', `/api/rooms/${code}`, { headers: gm });
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
    const { code, gm } = await newRoom();
    const body = `{"from":"${PLAYER}","data":{"hunter":{"__proto__":{"admin":true},"id":"h1","name":"${'x'.repeat(1000)}"}}}`;
    expect((await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h1`, { headers: token('p1'), body })).status).toBe(200);
    const data = (await call('GET', `/api/rooms/${code}`, { headers: gm })).body.sheets[`${PLAYER}:h1`].data.hunter;
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
      expect(await st.pushSheet(code, KAI_KEY, KAI_PHONE, sheet, t0)).toBe('stored');
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

describe('a room keeps every message it took (notes-5-trade.md 13, ruling 3)', () => {
  const GM_PHONE = parseDeviceId('d-gm')!;
  const told = (n: number) => parseEvent('system', { eid: `d-gm-s${n}`, title: `Message ${n}` })!;
  /** Every event of the room, read page by page from the start as a phone's cursor reads it. */
  async function all(st: Store, code: RoomCode): Promise<StoredEvent[]> {
    const out: StoredEvent[] = [];
    for (let after = 0; ;) { const p = await st.events(code, after); out.push(...p.events); if (!p.more) return out; after = p.next; }
  }

  test('a phone that reads from the start after 2,000 more messages still reads the first, and a resend of it is not stored again', async () => {
    const st = await freshStore(), code = someCode(), t0 = Date.now(), first = parseEvent('award', award(10, 'd-gm-first'))!;
    try {
      await st.create(code, 'hash', t0);
      expect(await st.addEvent(code, GM_PHONE, first, t0)).toBe(1);
      for (let n = 1; n <= 2000; n++) await st.addEvent(code, GM_PHONE, told(n), t0);
      expect(String((await st.events(code, 0)).events[0]?.payload.eid), 'the award is the first message a phone reads from the start').toBe('d-gm-first');
      expect(await st.addEvent(code, GM_PHONE, first, t0), 'the outbox sends the award again: the room answers its seq').toBe(1);
      const events = await all(st, code);
      expect([events.length, events.filter(e => e.payload.eid === 'd-gm-first').length]).toEqual([2001, 1]);
    } finally { await st.close(); }
  });

  test('a memory room past its bound refuses a new message as full and forgets none; a resend of a message it holds still answers', async () => {
    const st = memoryStore(), server = serverOf(openDatabase(st));
    const made = await call('POST', '/api/rooms', { server }), code = parseRoomCode(made.body.code)!, gm = { 'x-gm-key': made.body.gmKey };
    try {
      for (let n = 1; n <= MEM_EVENTS; n++) await st.addEvent(code, GM_PHONE, told(n), Date.now());
      const post = (payload: unknown) => call('POST', `/api/rooms/${code}/events`, { server, headers: gm, body: { from: 'd-gm', type: 'system', payload } });
      expect(await post({ eid: 'd-gm-late', title: 'One too many' })).toEqual({ status: 413, body: { error: 'room full' } });
      expect(await post({ eid: 'd-gm-s1', title: 'Message 1' }), 'a message the room holds is that message again').toEqual({ status: 200, body: { seq: 1 } });
      const events = await all(st, code);
      expect([events.length, events[0]?.payload.eid, events.at(-1)?.seq]).toEqual([MEM_EVENTS, 'd-gm-s1', MEM_EVENTS]);
    } finally { await st.close(); }
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

describe('a database the server shuts (SMX-sync-7)', () => {
  const closedHealth = { status: 503, body: { ok: false, db: 'postgres', error: 'closed' } };

  test('shut while Postgres is still answering its first try: the store that try opens is closed, and no room is served', async () => {
    let answer = (_: Store): void => {}, closes = 0;
    const store: Store = { ...memoryStore(), kind: 'postgres', close: async () => { closes++; } };
    const db = database('postgres://later', () => new Promise<Store>(resolve => { answer = resolve; }), 60_000), server = serverOf(db);
    const closing = db.close();
    answer(store);
    await closing;
    expect((await db.now()).at).toBe('closed');
    expect(closes).toBe(1);
    expect(await call('GET', '/api/health', { server })).toEqual(closedHealth);
    expect(await call('POST', '/api/rooms', { server })).toEqual({ status: 503, body: { error: 'no database' } });
  });

  test('shut while Postgres does not answer: no other try is made', async () => {
    let tries = 0;
    const open = async (): Promise<Store> => { tries++; throw Object.assign(new Error('Failed to connect'), { code: 'ERR_POSTGRES_CONNECTION_REFUSED' }); };
    const db = database('postgres://never', open, 5), server = serverOf(db);
    expect((await db.now()).at).toBe('down');
    await db.close();
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(tries).toBe(1);
    expect(await call('GET', '/api/health', { server })).toEqual(closedHealth);
  });

  test('shut when ready: its store is closed once, and health and every room route answer 503', async () => {
    let closes = 0;
    const db = openDatabase({ ...memoryStore(), kind: 'postgres', close: async () => { closes++; } }), server = serverOf(db);
    expect((await call('POST', '/api/rooms', { server })).status).toBe(200);
    await db.close();
    await db.close();
    expect(closes).toBe(1);
    expect(await call('GET', '/api/health', { server })).toEqual(closedHealth);
    expect(await call('POST', '/api/rooms', { server })).toEqual({ status: 503, body: { error: 'no database' } });
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

describe('requests at the same moment (audit BUG-sync-6, AW-sync-2)', () => {
  const MIRA = 'd-player3';
  const keyOf = (dev: string) => `${dev}:h1`;
  /**
   * A room on a store whose every answer takes a turn of the event loop, as a database's does, so two requests sent
   * together run their store calls in turn about. `asked` names each call the server made of the store.
   */
  async function slowRoom() {
    const st = await freshStore(), asked: string[] = [];
    const slow = new Proxy(st, {
      get(target, name, receiver) {
        const v: unknown = Reflect.get(target, name, receiver);
        if (typeof v !== 'function' || name === 'see' || name === 'presence') return v;
        return async (...args: unknown[]) => { asked.push(String(name)); await new Promise(r => setTimeout(r, 0)); return v.apply(target, args); };
      },
    });
    const server = serverOf(openDatabase(slow));
    const made = await call('POST', '/api/rooms', { server }), code: string = made.body.code, gm = { 'x-gm-key': made.body.gmKey as string };
    return {
      asked,
      close: () => st.close(),
      push: (dev: string, name: string) => call('PUT', `/api/rooms/${code}/sheets/${keyOf(dev)}`, { server, headers: token(dev), body: sheetOf(dev, name) }),
      remove: (dev: string) => call('DELETE', `/api/rooms/${code}/sheets/${keyOf(dev)}`, { server, headers: gm }),
      allowBack: (dev: string) => call('DELETE', `/api/rooms/${code}/kicks/${keyOf(dev)}`, { server, headers: gm }),
      poll: () => call('GET', `/api/rooms/${code}?after=0`, { server, headers: gm }),
    };
  }

  test('two hunters the GM removes at the same moment are both removed: the room\'s record names both and neither pushes straight back', async () => {
    const room = await slowRoom();
    try {
      expect((await room.push(PLAYER, 'Kai')).status).toBe(200);
      expect((await room.push(OTHER, 'Bo')).status).toBe(200);
      const answers = await Promise.all([room.remove(PLAYER), room.remove(OTHER)]);
      expect(answers.map(a => a.status)).toEqual([200, 200]);
      const polled = await room.poll();
      expect(polled.body.sheets).toEqual({});
      expect(polled.body.docs.kicked.data.names).toEqual({ [keyOf(PLAYER)]: 'Kai', [keyOf(OTHER)]: 'Bo' });
      expect(await room.push(PLAYER, 'Kai')).toEqual({ status: 403, body: { error: 'removed' } });
      expect(await room.push(OTHER, 'Bo')).toEqual({ status: 403, body: { error: 'removed' } });
    } finally { await room.close(); }
  });

  test('an Allow back and another removal at the same moment both hold: the allowed hunter pushes again, the removed one does not', async () => {
    const room = await slowRoom();
    try {
      expect((await room.push(PLAYER, 'Kai')).status).toBe(200);
      expect((await room.push(OTHER, 'Bo')).status).toBe(200);
      expect((await room.remove(PLAYER)).status).toBe(200);
      const answers = await Promise.all([room.allowBack(PLAYER), room.remove(OTHER)]);
      expect(answers.map(a => a.status)).toEqual([200, 200]);
      expect(Object.keys((await room.poll()).body.docs.kicked.data.keys)).toEqual([keyOf(OTHER)]);
      expect((await room.push(PLAYER, 'Kai')).status).toBe(200);
      expect(await room.push(OTHER, 'Bo')).toEqual({ status: 403, body: { error: 'removed' } });
    } finally { await room.close(); }
  });

  test('a push that arrives with the GM\'s removal of the same hunter never leaves the sheet in the room', async () => {
    const room = await slowRoom();
    try {
      expect((await room.push(PLAYER, 'Kai')).status).toBe(200);
      await Promise.all([room.push(PLAYER, 'Kai'), room.remove(PLAYER)]);
      expect((await room.poll()).body.sheets).toEqual({});
    } finally { await room.close(); }
  });

  test(`two hunters joining a room of ${ROOM_SHEETS - 1} at the same moment: one is taken, the other is told the room is full`, async () => {
    const room = await slowRoom();
    try {
      for (let i = 0; i < ROOM_SHEETS - 1; i++) expect((await room.push(`d-full${i}`, 'H' + i)).status).toBe(200);
      const answers = await Promise.all([room.push(PLAYER, 'Kai'), room.push(MIRA, 'Mira')]);
      expect(answers.map(a => a.status).sort()).toEqual([200, 413]);
      expect(Object.keys((await room.poll()).body.sheets)).toHaveLength(ROOM_SHEETS);
    } finally { await room.close(); }
  });

  test('a player\'s sheet push, the GM\'s removal and Allow back ask the store for no room board: only a poll reads the room whole', async () => {
    const room = await slowRoom();
    try {
      room.asked.length = 0;
      expect((await room.push(PLAYER, 'Kai')).status).toBe(200);
      expect((await room.remove(PLAYER)).status).toBe(200);
      expect((await room.allowBack(PLAYER)).status).toBe(200);
      expect(room.asked).not.toContain('board');
      expect((await room.poll()).status).toBe(200);
      expect(room.asked).toContain('board');
    } finally { await room.close(); }
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
    const { code, gm } = await newRoom();
    const sql = new Bun.SQL(PG!), sheet = JSON.stringify(sheetOf(PLAYER, 'Kai').data);
    try {
      await sql`INSERT INTO sheets (room, hid, at, from_id, data) VALUES (${code}, ${PLAYER + ':h1'}, ${Date.now()}, ${PLAYER}, ${sheet}::jsonb)`;
      expect((await sql`SELECT jsonb_typeof(data) AS t FROM sheets WHERE room = ${code}`).map(r => r.t)).toEqual(['string']);
    } finally { await sql.close(); }
    const started = await postgresStore(PG!);
    try { expect((await call('GET', `/api/rooms/${code}`, { headers: gm, server: serverOf(openDatabase(started)) })).body.sheets[`${PLAYER}:h1`].data).toMatchObject(sheetOf(PLAYER, 'Kai').data); }
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
