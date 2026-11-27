import { describe, expect, test } from 'bun:test';
import { buildApp } from '../scripts/build.ts';
import { handler } from '../server.ts';
import { catalogIdOf } from '../src/core/catalog-id.ts';
import type { CatalogKey } from '../src/core/ids.ts';

type Reply = { status: number; body: Record<string, any> };

const { build } = await buildApp();
const CURRENT = { 'x-hunter-build': build }, OLD = { 'x-hunter-build': 'old-build-01' };
const PLAYER = 'd-player1', TOKEN = { 'x-device-token': 'p1'.padEnd(16, 'x') };
const REFUSED = { status: 426, body: { code: 'UPGRADE', error: 'upgrade', build } };

async function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', ...opts.headers } };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await handler(new Request('http://test' + path, init));
  return { status: res.status, body: await res.json() };
}

async function newRoom(): Promise<{ code: string; gm: Record<string, string> }> {
  const r = await call('POST', '/api/rooms', { headers: CURRENT });
  expect(r.status).toBe(200);
  return { code: r.body.code, gm: { ...CURRENT, 'x-gm-key': r.body.gmKey } };
}

describe('build handshake', () => {
  test('a room request with no build header is refused with 426 and the server\'s build', async () => {
    const { code } = await newRoom();
    expect(await call('GET', `/api/rooms/${code}?after=0`)).toEqual(REFUSED);
    expect(await call('POST', '/api/rooms')).toEqual(REFUSED);
    expect(await call('GET', '/api/rooms/ZZZZZZ?peek=1')).toEqual(REFUSED);
  });

  test('a room request from another build is refused with 426', async () => {
    const { code } = await newRoom();
    expect(await call('GET', `/api/rooms/${code}?after=0`, { headers: OLD })).toEqual(REFUSED);
  });

  test('a room request from the same build is answered', async () => {
    const { code } = await newRoom();
    expect((await call('GET', `/api/rooms/${code}?after=0`, { headers: CURRENT })).status).toBe(200);
  });

  test('a refused sheet PUT and a refused event POST leave the room unchanged', async () => {
    const { code, gm } = await newRoom();
    const sheet = `/api/rooms/${code}/sheets/${PLAYER}:h1`;
    await call('PUT', sheet, { headers: { ...CURRENT, ...TOKEN }, body: { from: PLAYER, data: { seen: 0, hunter: { id: 'h1', name: 'Kai' } } } });
    const before = await call('GET', `/api/rooms/${code}?after=0`, { headers: gm });
    expect(before.body.sheets[`${PLAYER}:h1`].data.hunter.name).toBe('Kai');

    expect(await call('PUT', sheet, { headers: { ...OLD, ...TOKEN }, body: { from: PLAYER, data: { seen: 0, hunter: { id: 'h1', name: 'Changed' } } } })).toEqual(REFUSED);
    expect(await call('PUT', `/api/rooms/${code}/sheets/${PLAYER}:h2`, { headers: TOKEN, body: { from: PLAYER, data: { seen: 0, hunter: { id: 'h2', name: 'New' } } } })).toEqual(REFUSED);
    expect(await call('POST', `/api/rooms/${code}/events`, { headers: { ...gm, ...OLD }, body: { from: 'gm', type: 'system', payload: { eid: 'd-gm-e1', title: 'Hi' } } })).toEqual(REFUSED);

    const after = await call('GET', `/api/rooms/${code}?after=0`, { headers: gm });
    expect(after.body.sheets).toEqual(before.body.sheets);
    expect(after.body.events).toEqual(before.body.events);
  });

  test('a refused poll does not mark the device as present', async () => {
    const { code, gm } = await newRoom();
    expect(await call('GET', `/api/rooms/${code}?after=0&d=${PLAYER}`, { headers: OLD })).toEqual(REFUSED);
    expect((await call('GET', `/api/rooms/${code}?after=0`, { headers: gm })).body.presence).toEqual({});
  });

  test('a catalog request without the current build header is refused with 426 and leaves the catalog unchanged', async () => {
    const key = 'handshake_cat_key_123456' as CatalogKey, id = catalogIdOf(key);
    const body = { ifRev: 0, data: { items: {}, statuses: {}, shop: null } };
    expect(await call('PUT', `/api/catalogs/${id}`, { headers: { 'x-catalog-key': key }, body })).toEqual(REFUSED);
    expect(await call('PUT', `/api/catalogs/${id}`, { headers: { ...OLD, 'x-catalog-key': key }, body })).toEqual(REFUSED);
    expect(await call('GET', `/api/catalogs/${id}`, { headers: { ...OLD, 'x-catalog-key': key } })).toEqual(REFUSED);
    expect((await call('GET', `/api/catalogs/${id}`, { headers: { ...CURRENT, 'x-catalog-key': key } })).status).toBe(404);
  });

  test('health answers without the build header', async () => {
    expect((await call('GET', '/api/health')).status).toBe(200);
    expect((await call('GET', '/healthz')).status).toBe(200);
  });

  test('a different BUILD_SALT gives a different build from the same code', async () => {
    const was = Bun.env.BUILD_SALT;
    Bun.env.BUILD_SALT = 'next';
    try { expect((await buildApp()).build).not.toBe(build); }
    finally { if (was === undefined) delete Bun.env.BUILD_SALT; else Bun.env.BUILD_SALT = was; }
  });
});
