// The pure part of how a fight screen updates in place (src/views/patch.ts): which fields of a description changed, how a
// keyed list goes from one order to another, and how many lines a log gained at its front.
import { expect, test } from 'bun:test';
import { changed, plan, prepended } from '../src/views/patch.ts';

/** Applies a plan to a list of keys as `keyed` applies it to the DOM: remove, then put each key before another. */
const apply = (was: string[], p: ReturnType<typeof plan>): string[] => {
  const cur = was.filter(k => !p.remove.includes(k));
  for (const { key, before } of p.put) {
    const i = cur.indexOf(key); if (i >= 0) cur.splice(i, 1);
    cur.splice(before === null ? cur.length : cur.indexOf(before), 0, key);
  }
  return cur;
};

test('a description that did not change writes nothing, and the first one writes every field', () => {
  const card = { hp: 12, hpMax: 30, name: 'Brakk', down: false, shield: null };
  expect(changed(card, { ...card })).toEqual([]);
  expect(changed(undefined, card)).toEqual(['hp', 'hpMax', 'name', 'down', 'shield']);
});

test('only the fields whose value changed are written: a hit changes the HP and nothing else', () => {
  const was = { hp: 12, hpMax: 30, name: 'Brakk', down: false, shield: null, f: 0.4 };
  expect(changed(was, { ...was, hp: 7, f: 7 / 30 })).toEqual(['hp', 'f']);
  expect(changed(was, { ...was, down: true, shield: 4 })).toEqual(['down', 'shield']);
  expect(changed({ n: 0 }, { n: -0 })).toEqual(['n']);
});

test('the turn order after Next moves only the row that acted to its new place', () => {
  for (const now of [['b', 'c', 'a', 'd', 'e', 'f'], ['b', 'c', 'd', 'e', 'f', 'a']]) {
    const p = plan(['a', 'b', 'c', 'd', 'e', 'f'], now);
    expect(apply(['a', 'b', 'c', 'd', 'e', 'f'], p)).toEqual(now);
    expect(p).toEqual({ remove: [], put: [{ key: 'a', before: now[now.indexOf('a') + 1] ?? null }] });
  }
});

test('an order that did not change moves nothing; a row that leaves is removed and one that joins is put in its place', () => {
  expect(plan(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual({ remove: [], put: [] });
  const p = plan(['a', 'b', 'c'], ['a', 'x', 'c']);
  expect(p.remove).toEqual(['b']);
  expect(p.put).toEqual([{ key: 'x', before: 'c' }]);
  expect(apply(['a', 'b', 'c'], p)).toEqual(['a', 'x', 'c']);
  expect(apply([], plan([], ['a', 'b']))).toEqual(['a', 'b']);
  expect(apply(['a', 'b'], plan(['a', 'b'], []))).toEqual([]);
});

test('every order of five rows reaches any other order of the same and other rows', () => {
  const orders = [['a', 'b', 'c', 'd', 'e'], ['e', 'd', 'c', 'b', 'a'], ['c', 'a', 'e', 'b', 'd'], ['b', 'x', 'd'], ['y', 'a', 'z', 'e', 'c', 'b']];
  for (const was of orders) for (const now of orders) expect(apply(was, plan(was, now))).toEqual(now);
});

test('a log with new lines at its front gains only those, and one past its cap drops its oldest', () => {
  expect(prepended(['b', 'a'], ['b', 'a'])).toBe(0);
  expect(prepended(['b', 'a'], ['d', 'c', 'b', 'a'])).toBe(2);
  expect(prepended(['c', 'b', 'a'], ['d', 'c', 'b'])).toBe(1);
  expect(prepended(['x', 'x'], ['x', 'x', 'x'])).toBe(1);
  expect(prepended([], ['a'])).toBe(1);
  expect(prepended(['a', 'b'], ['c', 'd'])).toBe(2);
});

test('a log that got shorter (a cleared fight) is drawn again', () => {
  expect(prepended(['b', 'a'], [])).toBeNull();
  expect(prepended(['c', 'b', 'a'], ['d', 'c'])).toBeNull();
});
