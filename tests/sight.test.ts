// The one sight rule (docs/agent-handoff/features/notes-7-stealth.md section 3, with the owner's rulings 1 and 8): whether
// a body's eyes perceive another body. Every expected value is read off the rule: its own side always; else the viewer
// is up, the body is within the range on a clear line, and the viewer's sight is above the body's stealth level
// (stealth beats sight at the same level: the owner, Nov 22).
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { TERRAIN, openGrid, place, seenBy, tiles, inSight } from '../src/core/combat/space.ts';
import type { Grid, Place, Terrain } from '../src/core/combat/space.ts';
import { eyesOf, figureOf, perceives, rangeOf } from '../src/core/combat/sight.ts';
import type { Eyes, Figure, SightRange } from '../src/core/combat/sight.ts';
import { asLevel, LEVELS } from '../src/core/combat/sight-levels.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Body, Op, Origin, Status, StatusFields } from '../src/core/combat/effect-ops.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { parseOp } from '../src/core/combat/fight-parse.ts';
import type { Level } from '../src/core/combat/sight-levels.ts';
import type { Tiered } from '../src/core/combat/effect-ops.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { lifeAt } from './fixtures/life.ts';

// A map drawn as rows of characters: a terrain's character is that terrain, any other character is floor with a mark on it.
function draw(rows: readonly string[]): { grid: Grid; mark: (c: string) => Place } {
  const chars = (Object.keys(TERRAIN) as Terrain[]).map(t => [TERRAIN[t].char, t] as const);
  const cells = rows.flatMap(r => [...r]);
  const grid: Grid = { w: rows[0]!.length, h: rows.length, tiles: cells.map(c => chars.find(([ch]) => ch === c)?.[1] ?? 'floor') };
  const mark = (c: string): Place => { const i = cells.indexOf(c); return place(i % grid.w, Math.floor(i / grid.w)); };
  return { grid, mark };
}

const WHOLE: SightRange = { kind: 'whole' };
const within = (n: number): SightRange => ({ kind: 'tiles', n: tiles(n) });
const OPEN = openGrid(20, 14);
const eyes = (o: Partial<Eyes> = {}): Eyes => ({ place: place(0, 0), side: 'party', up: true, sight: 0, ...o });
const figure = (o: Partial<Figure> = {}): Figure => ({ place: place(3, 0), side: 'foe', stealth: null, ...o });

describe('one sight rule (perceives)', () => {
  test('a body perceives its own side, a foe in sight with no stealth, and a hidden foe only with a sight above its level', () => {
    expect(perceives(eyes(), figure({ side: 'party', stealth: 5 }), OPEN, WHOLE)).toBe(true);
    expect(perceives(eyes(), figure(), OPEN, WHOLE)).toBe(true);
    expect(LEVELS.map(sight => perceives(eyes({ sight }), figure({ stealth: 3 }), OPEN, WHOLE))).toEqual([false, false, false, false, true, true]);
  });

  test('stealth beats sight at the same level: a viewer whose sight equals the stealth level does not perceive it, one a level above does (the owner, Nov 22)', () => {
    expect(perceives(eyes({ sight: 2 }), figure({ stealth: 2 }), OPEN, WHOLE)).toBe(false);
    expect(perceives(eyes({ sight: 3 }), figure({ stealth: 2 }), OPEN, WHOLE)).toBe(true);
    expect(perceives(eyes({ sight: 0 }), figure({ stealth: 0 }), OPEN, WHOLE)).toBe(false);
  });

  test('a down viewer perceives no foe, even next to it with no stealth, and still knows its own side', () => {
    expect(perceives(eyes({ up: false, sight: 5 }), figure({ place: place(1, 0) }), OPEN, WHOLE)).toBe(false);
    expect(perceives(eyes({ up: false }), figure({ side: 'party' }), OPEN, WHOLE)).toBe(true);
  });

  test('a wall blocks a range of tiles and not the whole map', () => {
    const { grid, mark } = draw(['A.#.B']);
    const e = eyes({ place: mark('A') }), f = figure({ place: mark('B') });
    expect([perceives(e, f, grid, within(25)), perceives(e, f, grid, WHOLE)]).toEqual([false, true]);
  });

  test('a range of tiles reaches its last tile by the 5-10-5 count and no further', () => {
    const e = eyes({ place: place(0, 0) }), f = figure({ place: place(4, 2) });
    // 4 across and 2 down: 4 + floor(2 / 2) = 5 tiles
    expect([perceives(e, f, OPEN, within(5)), perceives(e, f, OPEN, within(4))]).toEqual([true, false]);
  });

  test('a foe of the viewer is the other side, whichever side the viewer is on', () => {
    const e = eyes({ side: 'foe', sight: 1 });
    expect([perceives(e, figure({ side: 'party', stealth: 1 }), OPEN, WHOLE), perceives(e, figure({ side: 'party', stealth: 0 }), OPEN, WHOLE)]).toEqual([false, true]);
  });
});

describe('the fog and a single body see with one geometry (inSight)', () => {
  test('the tiles the party sees are the tiles inSight of a body of the party that is up', () => {
    const { grid, mark } = draw([
      '.#....#.',
      'A..#....',
      '#....#..',
      '..#...B.',
    ]);
    const a = mark('A'), b = mark('B');
    const lit = seenBy('party', [{ place: a, side: 'party', up: true }, { place: b, side: 'foe', up: true }], grid, 6);
    const each = Array.from({ length: grid.w * grid.h }, (_, i) => i).filter(i => inSight(a, place(i % grid.w, Math.floor(i / grid.w)), grid, 6));
    expect([...lit].sort((x, y) => x - y)).toEqual(each);
  });

  test('inSight is within the distance and on a clear line, both', () => {
    const { grid, mark } = draw(['A.#.B...C']);
    expect([inSight(mark('A'), mark('B'), grid, 8), inSight(mark('B'), mark('C'), grid, 4), inSight(mark('B'), mark('C'), grid, 3)]).toEqual([false, true, false]);
  });
});

describe('a level', () => {
  test('is one of six, one per rank E to S, and a number is read into them: under 0 is 0, past 5 is 5, a fraction rounds down', () => {
    expect(LEVELS).toEqual([0, 1, 2, 3, 4, 5]);
    expect([-1, 0, 2.7, 5, 9, Number.NaN].map(asLevel)).toEqual([0, 0, 2, 5, 5, 0]);
  });
});

describe('a fight body\'s eyes and figure', () => {
  const hunter: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
  const status = (key: string, ...ops: Op[]): Status => statusAt(0, key, ...ops);
  const statusAt = (tier: number, key: string, ...ops: Op[]): Status =>
    statusOn({ label: key, desc: '', ops }, { key: statusKey(key), source: { id: null, tier }, until: tick(100), since: tick(0), settledAt: tick(0) });
  const hide = (level: Tiered<Level>): Op => ({ op: 'hidden', level, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } });
  const owed = (s: Status): Status => statusOn(s.def, { ...(s as StatusFields), owed: true });
  function body(statuses: readonly Status[], o: { side?: 'party' | 'foe'; hp?: number; at?: Place } = {}): Body {
    const { stats, sheet } = modified(hunter, statuses, RULES);
    return {
      id: combatantId('b'), side: o.side ?? 'party', ...lifeAt('hunter', o.hp ?? sheet.hpMax), origin: hunter, tier: 0, stats, sheet,
      place: o.at ?? place(2, 3), mana: sheet.manaMax, fatigue: 0, shield: null, stagger: null, channel: null, threat: null,
      statuses, readyAt: {}, abilities: [], intent: null, holder: null, xp: 0, mythic: null, name: 'Body', at: tick(1000), speed: sheet.speed, tie: 0,
    } as Body;
  }

  test('a body\'s eyes are its place, its side, whether it is up, and its sheet\'s sight after its sight ops', () => {
    expect(eyesOf(body([]))).toEqual({ place: place(2, 3), side: 'party', up: true, sight: 0 });
    expect(eyesOf(body([status('eye', { op: 'sheet', key: 'sight', amount: 2 })], { side: 'foe', hp: 0 }))).toEqual({ place: place(2, 3), side: 'foe', up: false, sight: 2 });
  });

  test('a body with no hidden status has no stealth; one hidden hides at its hidden op\'s level', () => {
    expect(figureOf(body([]))).toEqual({ place: place(2, 3), side: 'party', stealth: null });
    expect(figureOf(body([status('stealth', hide(2))], { side: 'foe' }))).toEqual({ place: place(2, 3), side: 'foe', stealth: 2 });
  });

  test('a hide by rank is read at its source\'s tier, and of two hides the higher level counts', () => {
    expect(figureOf(body([statusAt(3, 'stealth', hide([1, 1, 2, 4, 5, 5]))])).stealth).toBe(4);
    expect(figureOf(body([status('stealth', hide(2)), status('cloak', hide(4)), status('veil', hide(3))])).stealth).toBe(4);
  });

  test('a hide with no level written hides from a body with no sight content, and a sight op of 1 sees it (the default level is 0, which a plain sight of 0 does not see: the owner, Nov 22)', () => {
    const plain = parseOp({ op: 'hidden' }, RULES)!, foe = figureOf(body([status('stealth', plain)], { side: 'foe' }));
    expect<number>(eyesOf(body([])).sight).toBe(RULES.fight.stealth.sightBase);
    expect(perceives(eyesOf(body([])), foe, OPEN, WHOLE)).toBe(false);
    expect(perceives(eyesOf(body([status('eye', { op: 'sheet', key: 'sight', amount: 1 })])), foe, OPEN, WHOLE)).toBe(true);
  });

  test('a hidden status whose time ran out (owed until its settle) hides nothing', () => {
    expect(figureOf(body([owed(status('stealth', hide(3)))])).stealth).toBeNull();
  });

  test('a fight with fog looks as far as its fog\'s sight; a fight with none sees the whole map', () => {
    expect(rangeOf({ fog: { sight: tiles(6), seen: '' } })).toEqual({ kind: 'tiles', n: 6 });
    expect(rangeOf({ fog: null })).toEqual({ kind: 'whole' });
  });
});
