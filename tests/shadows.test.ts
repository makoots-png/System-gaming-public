import { describe, expect, test } from 'bun:test';
import { SHADOW_EVENTS, SHADOW_STATES, addShadow, extractDc, extractOutcome, healShadow, newShadowOf, noteShadow, renameShadow, risesAs, shadowState, stepShadow, transition } from '../src/core/hunter/shadows.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { ARMY, WALK_EVENTS } from './models/shadow-events.ts';
import { shadowSheet } from '../src/core/combat/rows.ts';
import { RULES } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { shid } from './fixtures/ids.ts';

const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const origin = { rank: 'D' as const, archetype: 'brute' as const, grade: 'Elite' as const, monster: null, name: '  Igris ' };
const shade = newShadowOf(origin, shid('sh1'), RULES);

test('a new shadow is at the full HP its body gives, not summoned, its name cleaned; a blank name is "Shadow"', () => {
  expect(shade).toEqual({ id: 'sh1', name: 'Igris', monster: null, rank: 'D', archetype: 'brute', grade: 'Elite', hp: shadowSheet(origin, RULES).hpMax, summoned: false, notes: '' });
  expect(newShadowOf({ ...origin, name: ' ' }, shid('sh2'), RULES).name).toBe('Shadow');
});

test('round trip: a shadow summoned then dismissed leaves the army as it was (the mana it cost is not given back)', () => {
  const h = ok(addShadow(newHunter(RULES), shade, RULES));
  expect(ok(stepShadow(ok(stepShadow(h, 'sh1', 'summon')), 'sh1', 'dismiss'))).toEqual(h);
});

test('round trip: a shadow that joins then is released leaves the hunter as it was', () => {
  const h = newHunter(RULES);
  expect(ok(stepShadow(ok(addShadow(h, shade, RULES)), 'sh1', 'release'))).toEqual(h);
  expect(stepShadow(h, 'sh1', 'release')).toEqual({ ok: false, why: 'not-now' });
});

test('heal brings HP to the full, a rename is cut to 60 and refused blank, notes are cut to 500', () => {
  const hurt = ok(addShadow(newHunter(RULES), { ...shade, hp: 1 }, RULES));
  expect(ok(healShadow(hurt, 'sh1', RULES)).shadows[0]!.hp).toBe(shade.hp);
  expect(ok(renameShadow(hurt, 'sh1', 'x'.repeat(70))).shadows[0]!.name).toHaveLength(60);
  expect(renameShadow(hurt, 'sh1', '  ')).toEqual({ ok: false, why: 'blank' });
  expect(ok(noteShadow(hurt, 'sh1', 'n'.repeat(600))).shadows[0]!.notes).toHaveLength(500);
});

test('the machine: a resting shadow is summoned, a summoned one dismissed, either released, and a released one takes nothing', () => {
  const rows = SHADOW_STATES.map(st => [st, Object.fromEntries(SHADOW_EVENTS.map(e => [e, transition(st, e)]))]);
  expect(Object.fromEntries(rows)).toEqual({
    resting: { summon: 'summoned', dismiss: null, release: 'released' },
    summoned: { summon: null, dismiss: 'resting', release: 'released' },
    released: { summon: null, dismiss: null, release: null },
  });
});

test('every walk of the army\'s events moves the stored shadow as the table says, and refuses the rest', () => {
  for (const first of WALK_EVENTS) for (const second of WALK_EVENTS) {
    let h = ARMY();
    for (const e of [first, second]) {
      const want = transition(shadowState(h, 'sh1'), e), next = stepShadow(h, 'sh1', e);
      expect(isRefused(next)).toBe(want === null);
      if (!isRefused(next)) { h = next; expect(shadowState(h, 'sh1')).toBe(want!); }
    }
  }
});

describe('the DC to extract a shadow (RULES.shadow: base 10, 3 a rank, a boss +5, never under 5)', () => {
  const R = RULES.shadow;
  test('a foe of the hunter\'s rank is the base; each rank above adds 3, each below takes 3; a boss adds 5', () => {
    expect([extractDc('C', 'C', 'normal', R), extractDc('C', 'A', 'normal', R), extractDc('C', 'D', 'normal', R), extractDc('C', 'A', 'boss', R)]).toEqual([10, 16, 7, 21]);
  });
  test('far below the hunter it stops at the floor, 5, and the floor is the rule\'s', () => {
    expect([extractDc('S', 'E', 'normal', R), extractDc('S', 'E', 'normal', { ...R, dcMin: 2 })]).toEqual([5, 2]);
  });
});

describe('the army\'s cap, an extraction\'s outcome and the grade a monster rises as are core\'s', () => {
  test('a hunter\'s army takes no shadow past its cap (its sheet\'s shadow capacity): one more is refused army-full', () => {
    const cap = hunterSheet(newHunter(RULES), RULES).sheet.shadows;
    let h = newHunter(RULES);
    for (let i = 0; i < cap; i++) h = ok(addShadow(h, { ...shade, id: shid(`sh${i + 10}`) }, RULES));
    expect(h.shadows).toHaveLength(cap);
    expect(addShadow(h, { ...shade, id: shid('sh99') }, RULES)).toEqual({ ok: false, why: 'army-full' });
  });

  test('an extraction roll: a natural 1 crumbles whatever the total, a natural 20 rises whatever the DC, else the total against the DC', () => {
    const rows: [number, number, number][] = [[1, 30, 10], [20, 5, 25], [12, 15, 15], [12, 14, 15]];
    expect(rows.map(([natural, total, dc]) => extractOutcome({ natural, total }, dc))).toEqual(['crumbled', 'risen', 'risen', 'failed']);
  });

  test('a boss rises as a Knight, an elite as an Elite, a normal monster as a Normal shadow', () => {
    expect([risesAs('boss'), risesAs('elite'), risesAs('normal')]).toEqual(['Knight', 'Elite', 'Normal']);
  });
});
