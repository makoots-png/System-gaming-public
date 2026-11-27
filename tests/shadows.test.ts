import { describe, expect, test } from 'bun:test';
import { SHADOW_CASES, SHADOW_COLUMNS, addShadow, can, extractDc, extractOutcome, healRestingShadows, healShadow, newShadowOf, noteShadow, renameShadow, risesAs, setShadowHp, shadowCase, shadowColumn, shadowMove, shadowState, stepShadow } from '../src/core/hunter/shadows.ts';
import type { ShadowEvent, ShadowState } from '../src/core/hunter/shadows.ts';
import { hunterSheet, statBonus } from '../src/core/hunter/sheet.ts';
import { pointsAt, split } from '../src/core/hunter/derive.ts';
import { middleBudget } from '../src/core/registry/item-budget.ts';
import { WEAR_LIMIT } from '../src/core/registry/items.ts';
import { bloodExtractDc } from '../src/core/hunter/blood-vessels.ts';
import { ARMY, WALK_EVENTS } from './models/shadow-events.ts';
import { shadowSheet } from '../src/core/combat/rows.ts';
import { RANKS, RULES, domainOf } from '../src/core/rules.ts';
import { extractDiceExpr, extractDiceLabel, extractionCheck, plainRollCheckText, rollCheckText } from '../src/core/combat/roll-adjust.ts';
import { parseOverrides } from '../src/core/overrides.ts';
import { freshSave, parseSave } from '../src/core/save.ts';
import { dev } from './fixtures/ids.ts';
import { parseFormula } from '../src/core/formula.ts';
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

  test('healRestingShadows restores damaged and fallen resting shadows to full HP, leaves summoned shadows alone, and is idempotent', () => {
    const elite = newShadowOf(origin, shid('sh1'), RULES);
    const marshal = newShadowOf({ rank: 'S', archetype: 'brute', grade: 'Marshal', monster: null, name: 'Igris' }, shid('sh2'), RULES);
    const scout = newShadowOf({ rank: 'C', archetype: 'skirmisher', grade: 'Normal', monster: null, name: 'Fang' }, shid('sh3'), RULES);
    const legacyZero = newShadowOf({ rank: 'E', archetype: 'caster', grade: 'Normal', monster: null, name: 'Wisp' }, shid('sh4'), RULES);
    const h0 = {
      ...newHunter(RULES),
      shadows: [
        { ...elite, hp: 5, summoned: false },
        { ...marshal, hp: 0, summoned: false },
        { ...scout, hp: 3, summoned: true },
        // Pre-rules-10.1 legacy save: summoned at 0 HP must not be treated as resting.
        { ...legacyZero, hp: 0, summoned: true },
      ],
    };
    const healed = healRestingShadows(h0, RULES);
    expect(healed.shadows.map(s => [s.id, s.hp, s.summoned])).toEqual([
      ['sh1', elite.hp, false],
      ['sh2', marshal.hp, false],
      ['sh3', 3, true],
      ['sh4', 0, true],
    ]);
    expect(can(healed, 'sh2', SUMMON), 'fallen resting shadow can be summoned again after heal').toBe(true);
    expect(healRestingShadows(healed, RULES), 'idempotent when nothing needs healing').toBe(healed);
    const empty = newHunter(RULES);
    expect(healRestingShadows(empty, RULES)).toBe(empty);
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

describe('the DC to extract a shadow (rank-driven gamble: dcBase + dcRank[foe] + dcPerRank * diff + kindDc, floor dcMin)', () => {
  const R = RULES.shadow;
  test('the foe\'s absolute rank weighs heavily alongside rank difference and monster kind', () => {
    expect([
      extractDc('E', 'E', 'normal', R),
      extractDc('C', 'C', 'normal', R),
      extractDc('C', 'C', 'elite', R),
      extractDc('C', 'C', 'boss', R),
      extractDc('C', 'A', 'normal', R),
      extractDc('C', 'A', 'boss', R),
      extractDc('C', 'D', 'normal', R),
      extractDc('S', 'S', 'normal', R),
      extractDc('S', 'S', 'boss', R),
    ]).toEqual([13, 36, 40, 44, 72, 80, 19, 84, 92]);
  });
  test('far below the hunter it stops at the floor, dcMin (10), and respects dcMin overrides', () => {
    expect([extractDc('S', 'E', 'normal', R), extractDc('S', 'E', 'normal', { ...R, dcMin: 2 })]).toEqual([10, 2]);
  });
  test('extraction no longer auto-passes at C, B, A, or S for geared Necromancer (Shadow & Arise) or Hemomancer (Blood)', () => {
    // A d20 check auto-passes (95% on 2..20) whenever 2 + bonus >= dc. Verify every C/B/A/S rank requires a real roll (> 2).
    for (const rank of ['C', 'B', 'A', 'S'] as const) {
      const lvl = RULES.rankLevels[rank];
      const pts = pointsAt(lvl, RULES);
      const s = split('pre', 'pow', pts, RULES);
      const gearPts = WEAR_LIMIT * middleBudget(RULES, rank);
      const gMain = Math.round((gearPts * 2) / 3);
      const gSec = Math.round(gearPts - gMain);
      const rb = RULES.rankBonus[rank];
      const necroBonus = statBonus(s.pre + gMain, RULES.fight) + rb;
      const hemoVitPrimary = statBonus(s.pre + gMain, RULES.fight) + rb;
      const hemoVitSecondary = statBonus(s.pow + gSec, RULES.fight) + rb;

      // Shadow extraction against same-rank normal/elite/boss: rolling a 2 must FAIL
      for (const kind of ['normal', 'elite', 'boss'] as const) {
        const sdc = extractDc(rank, rank, kind, R);
        expect(extractionCheck({ natural: 2, bonus: necroBonus, dc: sdc }).outcome, `Shadow ${rank} ${kind} DC ${sdc} vs +${necroBonus}`).toBe('failed');
        const bdc = bloodExtractDc(rank, kind, RULES, rank);
        expect(2 + hemoVitSecondary < bdc, `Blood pow:vit ${rank} ${kind} DC ${bdc} vs +${hemoVitSecondary}`).toBe(true);
        expect(2 + hemoVitPrimary < bdc, `Blood vit:pow ${rank} ${kind} DC ${bdc} vs +${hemoVitPrimary}`).toBe(true);
      }
    }
    // Even a maxed-out S-rank 32-node Necromancer (+75 pre, +81 Arise III) does not auto-pass S normal/elite/boss
    expect(extractionCheck({ natural: 2, bonus: 75, dc: extractDc('S', 'S', 'normal', R) }).outcome).toBe('failed');
    expect(extractionCheck({ natural: 2, bonus: 81, dc: extractDc('S', 'S', 'normal', R) }).outcome).toBe('failed');
  });
  test('higher-rank shadows scale sharply in HP across ranks E through S', () => {
    const hps = RANKS.map(rank => shadowSheet({ name: 'Shade', rank, archetype: 'brute', grade: 'Normal' }, RULES).hpMax);
    for (let i = 1; i < hps.length; i++) expect(hps[i]!).toBeGreaterThan(hps[i - 1]!);
    // An S-rank normal shadow is tougher than both an E-rank boss (Marshal) and a C-rank elite shadow
    const sNorm = shadowSheet({ name: 'S', rank: 'S', archetype: 'brute', grade: 'Normal' }, RULES).hpMax;
    const eBoss = shadowSheet({ name: 'E', rank: 'E', archetype: 'brute', grade: 'Marshal' }, RULES).hpMax;
    const cElite = shadowSheet({ name: 'C', rank: 'C', archetype: 'brute', grade: 'Elite' }, RULES).hpMax;
    expect(sNorm).toBeGreaterThan(eBoss);
    expect(sNorm).toBeGreaterThan(cElite);
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

describe('GM hidden roll adjustment and forced natural 20/1 on shadow extraction', () => {
  test('RULES.shadow has no adjustMax cap, and parseOverrides / parseSave repair legacy shadow.adjustMax without refusing', () => {
    expect('adjustMax' in RULES.shadow).toBe(false);
    expect(domainOf('shadow.adjustMax')).toBeNull();
    expect(parseOverrides({ shadow: { adjustMax: 10 } })).toEqual({ overrides: {}, refused: [] });
    expect(parseOverrides({ shadow: { adjustMax: 15, maxAttempts: 5 } })).toEqual({ overrides: { shadow: { maxAttempts: 5 } }, refused: [] });
    const env = { now: new Date('2026-11-26T00:00:00.000Z'), newDeviceId: () => dev('d-sh1'), newDeviceToken: () => 't'.repeat(32) };
    const stored = { ...freshSave(env, { onboarded: true }), rulesOverrides: { shadow: { adjustMax: 10, maxAttempts: 4 } } };
    const parsed = parseSave(JSON.stringify(stored), env);
    expect(parsed.kind).toBe('save');
    if (parsed.kind !== 'save') throw new Error('expected save');
    expect(parsed.save.rulesOverrides).toEqual({ shadow: { maxAttempts: 4 } });
  });

  test('uncapped adjust matrix and forced 20 / forced 1 obey nat 20 auto-rise and nat 1 auto-crumble invariants', () => {
    const bonus = 6, dc = 15;
    for (const adj of [-100, -10, 0, 10, 100]) {
      for (let natural = 1; natural <= 20; natural++) {
        const checked = extractionCheck({ natural, bonus, dc }, adj);
        const total = natural + bonus + adj;
        const expected = natural === 1 ? 'crumbled' : natural === 20 || total >= dc ? 'risen' : 'failed';
        expect(checked.total, `d20=${natural} adj=${adj}`).toBe(total);
        expect(checked.outcome, `d20=${natural} adj=${adj}`).toBe(expected);
        expect(checked.forced).toBeNull();
        if (adj === 0) expect(checked.outcome).toBe(extractOutcome({ natural, total }, dc));
      }
      expect(extractionCheck({ natural: 1, bonus: 50, dc: 5 }, adj).outcome, `nat 1 always crumbles at adj=${adj}`).toBe('crumbled');
      expect(extractionCheck({ natural: 20, bonus: -5, dc: 100 }, adj).outcome, `nat 20 always rises at adj=${adj}`).toBe('risen');
    }
    // Forced 20 plays as natural 20 even when raw roll is 1 and DC is unreachable
    const f20 = extractionCheck({ natural: 1, bonus: -5, dc: 999 }, -50, 20);
    expect(f20).toEqual({ natural: 20, bonus: -5, adjust: 0, forced: 20, total: 15, dc: 999, outcome: 'risen' });
    // Forced 1 plays as natural 1 (crumbles) even when raw roll is 20 and bonus dwarfs DC
    const f1 = extractionCheck({ natural: 20, bonus: 100, dc: 5 }, 50, 1);
    expect(f1).toEqual({ natural: 1, bonus: 100, adjust: 0, forced: 1, total: 101, dc: 5, outcome: 'crumbled' });
  });

  test('extractDiceExpr, extractDiceLabel, plainRollCheckText, and rollCheckText keep player text plain and GM text explicit', () => {
    expect(extractDiceExpr(6)).toBe('1d20+6');
    expect(extractDiceExpr(0)).toBe('1d20+0');
    expect(extractDiceExpr(-1)).toBe('1d20-1');
    for (const expr of ['1d20+6', '1d20+0', '1d20-1']) {
      expect(parseFormula(expr, RULES).ok, `parseFormula(${expr})`).toBe(true);
    }

    expect(extractDiceLabel('shadow', 'Igris')).toBe('Extract shadow: Igris');
    expect(extractDiceLabel('blood', 'Igris')).toBe('Extract blood: Igris');

    expect(plainRollCheckText(20, 6, 21)).toBe('20 + 6 = 26 vs DC 21');
    expect(plainRollCheckText(8, -1, 12)).toBe('8 - 1 = 7 vs DC 12');

    expect(rollCheckText(9, 6, 50, 15)).toBe('9 + 6 + 50 GM = 65 vs DC 15');
    expect(rollCheckText(9, 6, 0, 15)).toBe('9 + 6 = 15 vs DC 15');
    expect(rollCheckText(11, 10, -25, 13)).toBe('11 + 10 - 25 GM = -4 vs DC 13');
    expect(rollCheckText(20, 6, 0, 21, 20)).toBe('20 + 6 = 26 vs DC 21, GM forced 20');
    expect(rollCheckText(1, 6, 0, 10, 1)).toBe('1 + 6 = 7 vs DC 10, GM forced 1');
  });
});
