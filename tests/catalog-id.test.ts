// The pure SHA-256 the phone and the server share, the catalog id derived from a key, and custom item stamps.
import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '../src/core/sha256.ts';
import { catalogIdOf } from '../src/core/catalog-id.ts';
import { customItemDefId, parseCatalogId, parseItemDefId, stampOfItemDefId } from '../src/core/ids.ts';
import { GM_CATALOG_ID, GM_CATALOG_KEY, OTHER_CATALOG_ID, randomStamp, stampOf } from './fixtures/items.ts';

const node = async (t: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), b => b.toString(16).padStart(2, '0')).join('');

describe('sha256Hex', () => {
  test('matches the known vectors and WebCrypto for every length across the block edges', async () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (let n = 0; n < 200; n++) { const t = 'k'.repeat(n); expect(sha256Hex(t), String(n)).toBe(await node(t)); }
    for (const t of ['ünïcödé key', '\u{1F600} emoji', 'ck_test_secret_key_0123456789abcdef']) expect(sha256Hex(t)).toBe(await node(t));
  });
});

describe('catalogIdOf', () => {
  test('is cat- and the first 20 hex of the key\'s SHA-256, and parses as a catalog id', async () => {
    expect(GM_CATALOG_ID).toBe(`cat-${(await node(GM_CATALOG_KEY)).slice(0, 20)}` as never);
    expect(parseCatalogId(GM_CATALOG_ID)).toBe(GM_CATALOG_ID);
    expect(OTHER_CATALOG_ID).not.toBe(GM_CATALOG_ID);
  });
});

describe('custom item stamps', () => {
  test('a stamp is 16 to 20 of [a-z0-9]; a short one is refused, and the stamp reads back', () => {
    const id = customItemDefId(GM_CATALOG_ID, stampOf('blade'));
    expect(stampOfItemDefId(id)).toBe(stampOf('blade'));
    for (let i = 0; i < 50; i++) expect(parseItemDefId(customItemDefId(GM_CATALOG_ID, randomStamp()))).not.toBeNull();
    for (const bad of ['abcd1234', 'a'.repeat(15), 'a'.repeat(21), 'ABCDEFGHIJKLMNOP']) {
      expect(() => customItemDefId(GM_CATALOG_ID, bad), bad).toThrow();
      expect(parseItemDefId(`c:${GM_CATALOG_ID}:${bad}`), bad).toBeNull();
    }
  });
});
