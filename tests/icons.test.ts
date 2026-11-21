import { describe, expect, test } from 'bun:test';
import { SCHEMA, parseSaveValue } from '../src/core/save.ts';
import { dev } from './fixtures/ids.ts';
import { ICON_GROUPS, ICON_KEYS, ICON_KEY_MAX, iconDef, iconsOf, isIconKey } from '../src/core/registry/icons.ts';

/** The twelve emblem keys a hunter could pick before the registry, in their order. A saved key is never renamed. */
const EMBLEM_KEYS = ['star', 'crown', 'moon', 'flame', 'shield', 'blade', 'eye', 'bolt', 'skull', 'wing', 'diamond', 'fang'];

/** The arguments each path command takes. */
const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** The points a path reaches (an arc by its end), relative commands walked from the current point. Throws on a path that does not read. */
function points(path: string): [number, number][] {
  if (!/^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/.test(path)) throw new Error('a character that is not path data');
  const out: [number, number][] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const [, cmd, rest] of path.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const up = cmd!.toUpperCase(), rel = cmd !== up, n = ARGS[up]!;
    const nums = (rest!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (n === 0 ? nums.length > 0 : nums.length === 0 || nums.length % n !== 0) throw new Error(`${cmd} has ${nums.length} numbers`);
    for (let i = 0; n > 0 && i < nums.length; i += n) {
      const a = nums.slice(i, i + n);
      if (up === 'A' && !(a[3] === 0 || a[3] === 1) ) throw new Error('arc flag');
      const ex = a[n - 2]!, ey = a[n - 1]!;
      if (up === 'H') x = (rel ? x : 0) + a[0]!;
      else if (up === 'V') y = (rel ? y : 0) + a[0]!;
      else { x = (rel ? x : 0) + ex; y = (rel ? y : 0) + ey; }
      out.push([x, y]);
      if (up === 'M') { sx = x; sy = y; }
    }
    if (up === 'Z') { x = sx; y = sy; }
  }
  return out;
}

describe('every icon of the registry', () => {
  test('has a key of lowercase letters and hyphens within the limit, a known group, a label and a path that reads inside 0 to 24', () => {
    expect(ICON_KEYS.length).toBeGreaterThan(0);
    for (const k of ICON_KEYS) {
      const d = iconDef(k);
      expect(k, k).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(k.length, k).toBeLessThanOrEqual(ICON_KEY_MAX);
      expect(ICON_GROUPS, k).toContain(d.group);
      expect(d.label.trim(), k).not.toBe('');
      expect(d.path.length, k).toBeLessThanOrEqual(400);
      for (const [px, py] of points(d.path)) {
        expect(px, `${k} x`).toBeGreaterThanOrEqual(0); expect(px, `${k} x`).toBeLessThanOrEqual(24);
        expect(py, `${k} y`).toBeGreaterThanOrEqual(0); expect(py, `${k} y`).toBeLessThanOrEqual(24);
      }
    }
  });

  test('the path check itself refuses a path that does not read or leaves the grid', () => {
    expect(() => points('M1 1L2')).toThrow();
    expect(() => points('M1 1<script>')).toThrow();
    expect(points('M1 1h30').some(([px]) => px > 24)).toBe(true);
    expect(points('M2 2l3 3z')).toEqual([[2, 2], [5, 5]]);
  });
});

describe('the emblems', () => {
  test('every emblem key a hunter could save before the registry is still found, in the group emblem, in its old order', () => {
    for (const k of EMBLEM_KEYS) { expect(isIconKey(k), k).toBe(true); expect(iconDef(k as never).group, k).toBe('emblem'); }
    expect(iconsOf('emblem')).toEqual(EMBLEM_KEYS);
  });

  test('keep their old drawings', () => {
    expect(iconDef('star' as never).path).toBe('M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z');
    expect(iconDef('fang' as never).path).toBe('M4 3h16l-3 8-5 11-5-11z');
  });
});

describe('a key that is not in the registry', () => {
  test('is refused, whatever it is', () => {
    for (const v of ['', 'dragon', 'Star', 'toString', '__proto__', 'constructor', 'hasOwnProperty', 3, null, undefined, {}, ['star']]) {
      expect(isIconKey(v), String(v)).toBe(false);
    }
  });
});

describe('a saved hunter\'s emblem', () => {
  const env = { now: new Date('2026-11-14T10:00:00Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') };
  const emblemAfterLoad = (emblem: unknown): unknown => {
    const p = parseSaveValue({ schema: SCHEMA, hunters: [{ id: 'h1', emblem }] }, env);
    if (p.kind !== 'save') throw new Error(p.kind);
    return p.save.hunters[0]!.emblem;
  };

  test('every key of an old save reads as it was saved', () => {
    for (const k of EMBLEM_KEYS) expect(emblemAfterLoad(k), k).toBe(k);
  });

  test('a key the registry does not hold reads as no emblem (the initial)', () => {
    for (const v of ['dragon', 'toString', '__proto__', 7, null]) expect(emblemAfterLoad(v), String(v)).toBe('');
  });
});
