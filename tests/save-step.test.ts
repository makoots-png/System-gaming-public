import { describe, expect, test } from 'bun:test';
import { atHunter, atLibrary, both, isRefused, refuse, writeInto } from '../src/core/save-step.ts';
import { freshSave } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { dev, hid, iid } from './fixtures/ids.ts';

const env = { now: new Date('2026-11-14T10:00:00Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') };
const twoHunters = (): Save => {
  const save = freshSave(env, { onboarded: true });
  const a = { ...structuredClone(save.hunters[0]!), id: hid('h1'), name: 'Ana', gold: 5 };
  const b = { ...structuredClone(save.hunters[0]!), id: hid('h2'), name: 'Bo', gold: 9 };
  return { ...save, hunters: [a, b] };
};
const clone = <T>(v: T): T => structuredClone(v);

describe('a step aims at one part of the save', () => {
  test('atHunter changes only the hunter it names and shares the rest', () => {
    const save = twoHunters();
    const next = atHunter('h2', h => ({ ...h, gold: h.gold + 1 }))(save);
    if (isRefused(next)) throw new Error('refused');
    expect(next.hunters[1]!.gold).toBe(10);
    expect(next.hunters[0]).toBe(save.hunters[0]!);
    expect(save.hunters[1]!.gold).toBe(9);
  });
  test('a hunter that is not there is refused, and so is what the change refuses', () => {
    const save = twoHunters();
    expect(atHunter('h9', h => h)(save)).toEqual(refuse('no-hunter'));
    expect(atHunter('h1', () => refuse('broke'))(save)).toEqual(refuse('broke'));
  });
  test('both stops at the first refusal and keeps nothing of the steps before it', () => {
    const save = twoHunters();
    const pay = atHunter('h1', (h: Hunter) => ({ ...h, gold: h.gold - 5 }));
    expect(both(pay, atLibrary(() => refuse('full')))(save)).toEqual(refuse('full'));
    expect(save.hunters[0]!.gold).toBe(5);
  });
});

describe('writeInto makes the live save equal the answer', () => {
  test('the live save deep-equals the next one, and a hunter a view holds stays the live one', () => {
    const live = twoHunters();
    const held = live.hunters[1]!;
    const next = atHunter('h2', h => ({ ...h, gold: 0, items: [...h.items, { ...h.items[0]!, id: iid('i902') }] }))(clone(live));
    if (isRefused(next)) throw new Error('refused');
    writeInto(live, next);
    expect(live).toEqual(next);
    expect(live.hunters[1]).toBe(held);
    expect(held.gold).toBe(0);
  });
  test('a key the answer does not have is deleted', () => {
    const live: Record<string, unknown> = { a: 1, b: { c: 2, d: 3 } };
    writeInto(live, { a: 1, b: { c: 2 } });
    expect(live).toEqual({ a: 1, b: { c: 2 } });
  });
  test('a list reordered or cut keeps each element whole', () => {
    const live = { rows: [{ label: 'x', n: 1 }, { label: 'y', n: 2 }, { label: 'z', n: 3 }] };
    const [x, y, z] = live.rows;
    writeInto(live, { rows: [z!, x!] });
    expect(live.rows).toEqual([{ label: 'z', n: 3 }, { label: 'x', n: 1 }]);
    expect(live.rows[0]).toBe(z!);
    expect(y).toEqual({ label: 'y', n: 2 });
  });
  test('an element without an id put before a kept one leaves the kept one whole', () => {
    const live = { s: [{ key: 'burn', def: { ops: [{ kind: 'damage', n: 1 }] } }] };
    const burn = live.s[0]!;
    writeInto(live, { s: [{ key: 'slow', def: { ops: [{ kind: 'speed', n: -2 }] } }, burn] });
    expect(live.s).toEqual([
      { key: 'slow', def: { ops: [{ kind: 'speed', n: -2 }] } },
      { key: 'burn', def: { ops: [{ kind: 'damage', n: 1 }] } },
    ]);
    expect(live.s[1]).toBe(burn);
  });
  test('an element without an id put before a changed copy of one leaves the parts the copy shares whole', () => {
    const live = { s: [{ key: 'burn', rounds: 2, def: { ops: [{ kind: 'damage', n: 1 }] } }] };
    const burn = live.s[0]!;
    writeInto(live, { s: [{ key: 'slow', rounds: 1, def: { ops: [{ kind: 'speed', n: -2 }] } }, { ...burn, rounds: 1 }] });
    expect(live.s).toEqual([
      { key: 'slow', rounds: 1, def: { ops: [{ kind: 'speed', n: -2 }] } },
      { key: 'burn', rounds: 1, def: { ops: [{ kind: 'damage', n: 1 }] } },
    ]);
  });
  test('an element is matched by its id wherever it moved', () => {
    const live = { list: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }] };
    const b = live.list[1]!;
    writeInto(live, { list: [{ id: 'b', n: 5 }] });
    expect(live.list).toEqual([{ id: 'b', n: 5 }]);
    expect(live.list[0]).toBe(b);
  });
  test('an object a step brings in from outside the save is stored as a copy, so a later write leaves the outside alone', () => {
    const builtIn = [{ name: 'Potion', value: 5 }];
    const live: { shop: { name: string; value: number }[] | null } = { shop: null };
    writeInto(live, { shop: builtIn.map(t => t) });
    writeInto(live, { shop: [{ name: 'Potion', value: 9 }] });
    expect(live.shop).toEqual([{ name: 'Potion', value: 9 }]);
    expect(builtIn).toEqual([{ name: 'Potion', value: 5 }]);
  });
  test('a record without an id is replaced, as an assignment replaced it: one a view kept to compare with keeps the old values', () => {
    const live = twoHunters();
    const h = live.hunters[0]!, was = h.life;
    const next = atHunter('h1', x => ({ ...x, life: { at: 'up' as const, hp: 1 } }))(live);
    if (isRefused(next)) throw new Error('refused');
    writeInto(live, next);
    expect(h.life).toEqual({ at: 'up', hp: 1 });
    expect(was).not.toEqual(h.life);
    expect(live.hunters[0]).toBe(h);
  });
});
