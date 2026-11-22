import { describe, expect, test } from 'bun:test';
import { SHADOW_CASES, SHADOW_COLUMNS, addShadow, can, extractDc, extractOutcome, healShadow, newShadowOf, noteShadow, renameShadow, risesAs, setShadowHp, shadowCase, shadowColumn, shadowMove, shadowState, stepShadow } from '../src/core/hunter/shadows.ts';
import type { ShadowEvent, ShadowState } from '../src/core/hunter/shadows.ts';
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

const SUMMON = { kind: 'summon' } as const, DISMISS = { kind: 'dismiss' } as const, RELEASE = { kind: 'release' } as const;
const army = (s: Partial<typeof shade> = {}) => ok(addShadow(newHunter(RULES), { ...shade, ...s }, RULES));

test('round trip: a shadow summoned then dismissed leaves the army as it was (the mana it cost is not given back)', () => {
  const h = army();
  expect(ok(stepShadow(ok(stepShadow(h, 'sh1', SUMMON)), 'sh1', DISMISS))).toEqual(h);
});

test('round trip: a shadow that joins then is released leaves the hunter as it was', () => {
  const h = newHunter(RULES);
  expect(ok(stepShadow(ok(addShadow(h, shade, RULES)), 'sh1', RELEASE))).toEqual(h);
  expect(stepShadow(h, 'sh1', RELEASE)).toEqual({ ok: false, why: 'not-now' });
});

test('heal brings HP to the full, a rename is cut to 60 and refused blank, notes are cut to 500', () => {
  const hurt = army({ hp: 1 });
  expect(ok(healShadow(hurt, 'sh1', RULES)).shadows[0]!.hp).toBe(shade.hp);
  expect(ok(renameShadow(hurt, 'sh1', 'x'.repeat(70))).shadows[0]!.name).toHaveLength(60);
  expect(renameShadow(hurt, 'sh1', '  ')).toEqual({ ok: false, why: 'blank' });
  expect(ok(noteShadow(hurt, 'sh1', 'n'.repeat(600))).shadows[0]!.notes).toHaveLength(500);
});

describe('a shadow\'s life: resting or summoned with its HP, or released', () => {
  test('the table: every case of a shadow against every column of an event, the refused ones null', () => {
    const rows = SHADOW_CASES.map(c => [c, Object.fromEntries(SHADOW_COLUMNS.map(e => [e, shadowMove(c, e)]))]);
    expect(Object.fromEntries(rows)).toEqual({
      resting: { summon: 'summoned', dismiss: null, release: 'released', fought: 'resting', fell: 'resting', heal: 'resting' },
      restingFallen: { summon: null, dismiss: null, release: 'released', fought: 'resting', fell: 'resting', heal: 'resting' },
      summoned: { summon: null, dismiss: 'resting', release: 'released', fought: 'summoned', fell: 'resting', heal: 'summoned' },
      released: { summon: null, dismiss: null, release: null, fought: null, fell: null, heal: null },
    });
  });

  test('a shadow\'s case is where it is, and resting whether its HP is 0 (a summoned one at 0 HP is one stored before rules-10.1); a fight that leaves it at 0 or below is the fell column', () => {
    expect([{ at: 'resting', hp: 4 }, { at: 'resting', hp: 0 }, { at: 'summoned', hp: 4 }, { at: 'summoned', hp: 0 }, { at: 'released' }].map(s => shadowCase(s as ShadowState)))
      .toEqual(['resting', 'restingFallen', 'summoned', 'summoned', 'released']);
    expect([SUMMON, DISMISS, RELEASE, { kind: 'fought', hp: 3 }, { kind: 'fought', hp: 0 }, { kind: 'fought', hp: -2 }, { kind: 'heal', hpMax: 9 }].map(e => shadowColumn(e as ShadowEvent)))
      .toEqual(['summon', 'dismiss', 'release', 'fought', 'fell', 'fell', 'heal']);
  });

  test('the stored shadow is read as its state: summoned or resting with its HP, released when it is not in the army', () => {
    expect(shadowState(army({ hp: 7 }), 'sh1')).toEqual({ at: 'resting', hp: 7 });
    expect(shadowState(army({ hp: 0, summoned: true }), 'sh1')).toEqual({ at: 'summoned', hp: 0 });
    expect(shadowState(army(), 'sh9')).toEqual({ at: 'released' });
  });

  test('a fight leaves a summoned shadow summoned at the HP it ended on', () => {
    const h = ok(setShadowHp(army({ summoned: true }), 'sh1', 3));
    expect(h.shadows[0]).toEqual({ ...shade, summoned: true, hp: 3 });
  });

  test('a shadow that falls to 0 HP in a fight leaves the field: it is dismissed, at 0 HP (rules-10.1)', () => {
    expect(ok(setShadowHp(army({ summoned: true }), 'sh1', 0)).shadows[0]).toEqual({ ...shade, summoned: false, hp: 0 });
  });

  test('a fight that leaves a shadow below 0 stores 0, never a negative HP', () => {
    expect(ok(setShadowHp(army({ summoned: true }), 'sh1', -4)).shadows[0]!.hp).toBe(0);
  });

  test('a resting shadow at 0 HP cannot be summoned until it is healed; after Full HP it can (rules-10.1)', () => {
    expect(can(army({ hp: 0 }), 'sh1', SUMMON)).toBe(false);
    expect(stepShadow(army({ hp: 0 }), 'sh1', SUMMON)).toEqual({ ok: false, why: 'not-now' });
    const healed = ok(healShadow(army({ hp: 0 }), 'sh1', RULES));
    expect(ok(stepShadow(healed, 'sh1', SUMMON)).shadows[0]).toEqual({ ...shade, summoned: true });
  });

  test('Full HP brings a fallen shadow back to the full HP its body gives, summoned or resting as it was', () => {
    expect(ok(healShadow(army({ hp: 0, summoned: true }), 'sh1', RULES)).shadows[0]).toEqual({ ...shade, summoned: true });
    expect(ok(healShadow(army({ hp: 0 }), 'sh1', RULES)).shadows[0]).toEqual(shade);
  });

  test('a released shadow takes no fight\'s HP and no heal: both are refused and the hunter is left as it was', () => {
    const h = newHunter(RULES);
    expect([setShadowHp(h, 'sh1', 3), healShadow(h, 'sh1', RULES)]).toEqual([{ ok: false, why: 'not-now' }, { ok: false, why: 'not-now' }]);
  });

  test('every walk of three of the army\'s events moves the stored shadow as the table says, and refuses the rest', () => {
    for (const a of WALK_EVENTS) for (const b of WALK_EVENTS) for (const c of WALK_EVENTS) {
      let h = ARMY();
      for (const e of [a, b, c]) {
        const was = shadowState(h, 'sh1'), want = shadowMove(shadowCase(was), shadowColumn(e)), next = stepShadow(h, 'sh1', e);
        expect(isRefused(next)).toBe(want === null);
        expect(can(h, 'sh1', e)).toBe(want !== null);
        if (!isRefused(next)) { h = next; expect(shadowState(h, 'sh1').at).toBe(want!); }
      }
    }
  });
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
