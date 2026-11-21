// The battle map's scene: the tokens, where a move can go and the way it goes, an ability's reach, targets, splash and
// ring, what a tap does, and the hotbar. Expected tiles come from the design's rules, drawn as rows of characters: the
// 5-10-5 distance and the stride of 4.6 (a walk of ceil(move / 2) around bodies), the dash of 4.6 (the whole move in the
// centre line a line ability uses, a half rounding up, with nothing on it), rule 5 (range) and rule 6 (the shape).
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { TERRAIN, openGrid, percent, place, tiles } from '../src/core/combat/space.ts';
import type { Grid, Place, Side, Terrain } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import type { Ability, AbilityKind, CombatantId } from '../src/core/combat/ability-types.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { ATTACK_ID, itemAbilityId } from '../src/core/registry/abilities.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, CombatantKind, Origin, Status } from '../src/core/combat/effect-ops.ts';
import { fightId, reduce } from '../src/core/combat/fight.ts';
import type { Fight, NewRow } from '../src/core/combat/fight.ts';
import type { FightDocRow } from '../src/core/combat/fight-doc.ts';
import { aims } from '../src/core/combat/fight-view.ts';
import { EVERYTHING, NO_CHOICE, PINS, choose, docBodies, docGround, eyesChoices, fightBodies, fightGround, frameOf, hotbar, labelOf, mapScene, outline, packLetter, shortOf, tapOn, turnWords, viewAsOf } from '../src/core/combat/map-view.ts';
import { fightDoc, fightWire } from '../src/core/combat/fight-doc.ts';
import type { FightDoc } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import type { DeviceId } from '../src/core/ids.ts';
import type { IconKey } from '../src/core/registry/icons.ts';
import { iid } from './fixtures/ids.ts';
import type { Choice, ChoiceEvent, ChoiceFx, HotbarKit, MapBody, MapScene, Selection, ViewAs } from '../src/core/combat/map-view.ts';
import { rng } from './models/fight-play.ts';
import { lifeAt } from './fixtures/life.ts';

const id = combatantId;
const ability = (kind: AbilityKind, name: string = kind, o: Partial<Ability> = {}): Ability => ({ ...abilityOf(kind, { id: abilityId(name), name }, RULES), ...o });
/** A strike as the kind makes it: range 1, a touch of reach 1. */
const STRIKE = ability('strike');
/** A blast of radius 1 and an outer ring of 2, thrown up to 6 tiles. */
const BLAST = ability('blast', 'blast', { range: tiles(6), shape: { kind: 'radius', radius: tiles(1), ring: { outer: tiles(2), share: percent(50) } } });

type Drawn = { grid: Grid; bodies: MapBody[] };
/**
 * A map drawn as rows: a terrain's character is that terrain; `@` is the hunter whose turn it is, an upper-case letter a
 * hunter of the party, a lower-case one a foe; anything else is floor. Each body is named by its letter.
 */
function draw(rows: readonly string[], o: { stride?: number; dash?: number } = {}): Drawn {
  const chars = (Object.keys(TERRAIN) as Terrain[]).map(t => [TERRAIN[t].char, t] as const);
  const cells = rows.flatMap(r => [...r]), w = rows[0]!.length;
  const grid: Grid = { w, h: rows.length, tiles: cells.map(c => chars.find(([ch]) => ch === c)?.[1] ?? 'floor') };
  const bodies = cells.flatMap((c, i): MapBody[] => {
    if (!/[@A-Za-z]/.test(c)) return [];
    const party = c === '@' || c === c.toUpperCase(), me = c === '@';
    return [body(c, party ? 'party' : 'foe', i % w, Math.floor(i / w), me ? { stride: o.stride ?? 3, dash: o.dash ?? 6, mine: true } : {})];
  });
  return { grid, bodies };
}
function body(name: string, side: Side, x: number, y: number, o: { stride?: number; dash?: number; mine?: boolean; down?: boolean; kind?: CombatantKind } = {}): MapBody {
  return {
    id: id(name), side, kind: o.kind ?? (side === 'party' ? 'hunter' : 'monster'), place: place(x, y), down: o.down ?? false, name,
    ring: { share: 1, band: null }, statuses: false, mine: o.mine ?? false, stride: tiles(o.stride ?? 0), dash: tiles(o.dash ?? 0), bars: null,
    extras: { shield: null, stagger: null, channel: null, taunted: false, reacted: false }, aim: null, summon: null, unseen: false, word: null, icon: null,
  };
}
const scene = (d: Drawn, sel: Selection = { kind: 'none' }, actor: string | null = '@'): MapScene =>
  mapScene({ bodies: d.bodies, grid: d.grid, currentId: actor === null ? null : id(actor), actor: actor === null ? null : id(actor) }, sel, RULES);
const same = (a: Place, b: Place): boolean => a.x === b.x && a.y === b.y;
const on = (list: readonly Place[], p: Place): boolean => list.some(q => same(q, p));
/**
 * The scene's selection drawn back as rows: `S` a stride tile, `d` a dash tile, `*` the chosen way, `r` a tile in reach,
 * `x` the splash, `o` its ring; a body as its letter; walls as drawn; `.` the rest. The splash and the way win over the area.
 */
function picture(s: MapScene, d: Drawn): string[] {
  const f = s.focus;
  return Array.from({ length: s.h }, (_, y) => Array.from({ length: s.w }, (_, x) => {
    const p = place(x, y), who = s.tokens.find(t => same(t.place, p));
    if (who) return who.id;
    if (d.grid.tiles?.[y * s.w + x] === 'wall') return TERRAIN.wall.char;
    if (f.kind === 'move') return f.path && on(f.path.tiles, p) ? '*' : on(f.stride, p) ? 'S' : on(f.dash, p) ? 'd' : '.';
    if (f.kind === 'aim') return f.aim && on(f.aim.splash, p) ? 'x' : f.aim && on(f.aim.ring, p) ? 'o' : on(f.reach, p) ? 'r' : '.';
    return '.';
  }).join(''));
}

describe('moving on the map', () => {
  test('on its turn a body sees its stride, and lighter the tiles past it a dash reaches in a clear straight line', () => {
    // stride 1 and a dash of 2: the walk reaches the eight tiles around but the foe's; a dash runs 2 tiles by 5-10-5, and
    // its line to the right (and up-right, whose first tile rounds onto the foe) passes through the foe
    const d = draw([
      '.......',
      '.......',
      '...@g..',
      '.......',
      '.......',
    ], { stride: 1, dash: 2 });
    expect(picture(scene(d), d)).toEqual([
      '..ddd..',
      '.dSSS..',
      '.dS@g..',
      '.dSSSd.',
      '..ddd..',
    ]);
  });

  test('a move on its way to the GM\'s phone keeps its way drawn while nobody acts on this phone, and nothing else', () => {
    const d = draw(['@....'], { stride: 3, dash: 4 }), way = [place(1, 0), place(2, 0)];
    const s = mapScene({ bodies: d.bodies, grid: d.grid, currentId: id('@'), actor: null, sent: { by: id('@'), way } }, { kind: 'none' }, RULES);
    expect(s.shades).toEqual([{ kind: 'way', tone: 'move', loops: outline(way) }]);
    expect(mapScene({ bodies: d.bodies, grid: d.grid, currentId: id('@'), actor: null, sent: null }, { kind: 'none' }, RULES).shades).toEqual([]);
  });

  test('a walk goes round a wall, and a dash never crosses one', () => {
    const d = draw([
      '.....',
      '.###.',
      '..@..',
    ], { stride: 3, dash: 4 });
    // the tiles above the wall are 4 steps or more round it, past the stride of 3, and every line to them meets the wall
    expect(picture(scene(d), d)).toEqual([
      'S...S',
      'S###S',
      'SS@SS',
    ]);
  });

  test('a rooted hunter has no area', () => {
    const d = draw(['.....', '..@..', '.....'], { stride: 0, dash: 0 });
    expect(scene(d).focus).toEqual({ kind: 'move', stride: [], dash: [], path: null });
  });

  test('a tile in the stride draws the walk to it and its cost in words; a tile only a dash reaches draws the dash', () => {
    const d = draw(['.......', '...@...', '.......'], { stride: 3, dash: 6 });
    const walk = scene(d, { kind: 'move', to: place(5, 1) }).focus;
    // two tiles: each costs a sixth of a standard action (RULES.fight.moveCost, six tiles a turn), so a third
    expect(walk.kind === 'move' && walk.path).toEqual({ to: place(5, 1), tiles: [place(4, 1), place(5, 1)], steps: 2, dash: false, words: '2 tiles: a third of your turn' });
    const dash = scene(d, { kind: 'move', to: place(0, 1) }).focus;
    expect(dash.kind === 'move' && dash.path && [dash.path.dash, dash.path.steps, dash.path.tiles.length]).toEqual([false, 3, 3]);
    const far = draw(['........', '@.......', '........'], { stride: 3, dash: 6 });
    const run = scene(far, { kind: 'move', to: place(6, 1) }).focus;
    expect(run.kind === 'move' && run.path).toMatchObject({ dash: true, steps: 6, words: `Dash 6 tiles: all of your turn and ${RULES.fight.dashFatigue} fatigue` });
  });

  test('a tile outside the area cannot be chosen: it draws no way, and a tap on it does not pick it', () => {
    const d = draw(['..........', '@.........'], { stride: 1, dash: 2 });
    const s = scene(d, { kind: 'move', to: place(9, 1) });
    expect(s.focus.kind === 'move' && s.focus.path).toBeNull();
    expect(tapOn(scene(d), place(9, 1)).kind).not.toBe('moveTo');
    expect(tapOn(scene(d), place(1, 1))).toEqual({ kind: 'moveTo', to: place(1, 1) });
  });

  test('a phone that is not playing the turn sees no area, and a tap on a token opens its card', () => {
    const d = draw(['@..g']);
    const s = scene(d, { kind: 'none' }, null);
    expect([s.actor, s.focus.kind]).toEqual([null, 'none']);
    expect(tapOn(s, place(3, 0))).toEqual({ kind: 'card', id: id('g') });
    expect(tapOn(s, place(1, 0))).toEqual({ kind: 'nothing' });
  });

  test('the words for a share of a turn are the nearest of the fractions a table says', () => {
    expect([1 / 6, 0.33, 0.5, 0.7, 1].map(turnWords)).toEqual(['a sixth of your turn', 'a third of your turn', 'half of your turn', 'two thirds of your turn', 'all of your turn']);
  });
});

describe('aiming from the map', () => {
  test('a strike reaches the tiles within its range, and only a foe beside the user can be hit; a tap on a far foe is refused', () => {
    const d = draw([
      '.....',
      '.@g..',
      '....h',
    ]);
    const s = scene(d, { kind: 'aim', ability: STRIKE, at: null });
    expect(picture(s, d)).toEqual([
      'rrr..',
      'r@g..',
      'rrr.h',
    ]);
    expect(s.focus.kind === 'aim' && s.focus.targets).toEqual([id('g')]);
    expect(tapOn(s, place(4, 2))).toEqual({ kind: 'refuse', reason: 'range' });
    expect(tapOn(s, place(2, 1))).toEqual({ kind: 'aimAt', at: place(2, 1) });
    const aimed = scene(d, { kind: 'aim', ability: STRIKE, at: place(2, 1) }).focus;
    expect(aimed.kind === 'aim' && aimed.aim).toMatchObject({ target: id('g'), hit: [id('g')], ok: true, send: id('g') });
    expect(tapOn(s, place(4, 0))).toEqual({ kind: 'cancel' });
  });

  test('the map offers the targets the card offers (fight-view aims in range and in shape) for a foe, an ally and a self ability; one aimed at a tile offers tiles', () => {
    const d = draw([
      '.A...',
      '.@g..',
      '....h',
    ]);
    const mend = ability('support', 'mend', { range: tiles(2) });
    const guard = ability('support', 'self', { aim: 'self', shape: { kind: 'self' }, range: tiles(0) });
    for (const a of [STRIKE, mend, guard]) {
      const s = scene(d, { kind: 'aim', ability: a, at: null });
      const offered = aims(d.bodies, id('@'), a, d.grid).filter(x => x.inRange && x.inShape).map(x => x.target.id);
      expect([a.name, s.focus.kind === 'aim' && [...s.focus.targets].sort()]).toEqual([a.name, [...offered].sort()]);
    }
  });

  test('a blast aimed at a tile marks its splash and ring and every body inside each, before it is used', () => {
    const d = draw([
      '.........',
      '....a..b.',
      '@.c......',
      '.........',
      '.........',
    ]);
    const s = scene(d, { kind: 'aim', ability: BLAST, at: place(5, 2) });
    // reach 6 by 5-10-5 from the user; radius 1 is the 3 by 3 square around the aim (a diagonal of 1 costs 1), and the
    // ring to 2 the tiles at distance 2
    expect(picture(s, d)).toEqual([
      'rrrrooo..',
      'rrroaxxb.',
      '@rcoxxxo.',
      'rrroxxxo.',
      'rrrrooo..',
    ]);
    expect(s.focus.kind === 'aim' && s.focus.aim).toMatchObject({ target: null, hit: [id('a')], ringed: [id('b')], ok: true, send: place(5, 2) });
  });

  test('a blast past its range can be seen but not used', () => {
    const d = draw(['@.......']);
    const s = scene(d, { kind: 'aim', ability: BLAST, at: place(7, 0) });
    expect(tapOn(scene(d, { kind: 'aim', ability: BLAST, at: null }), place(7, 0))).toEqual({ kind: 'cancel' });
    expect(s.focus.kind === 'aim' && s.focus.aim && [s.focus.aim.ok, s.focus.aim.send]).toEqual([false, null]);
  });
});

describe('an area as one shape', () => {
  /** The tiles drawn `#` in rows. */
  const tilesOf = (rows: readonly string[]): Place[] => rows.flatMap((r, y) => [...r].flatMap((c, x) => (c === '#' ? [place(x, y)] : [])));
  const c = (x: number, y: number) => ({ x, y });

  test('a single tile is one square loop, clockwise from its top left corner', () => {
    expect(outline(tilesOf(['...', '.#.']))).toEqual([[c(1, 1), c(2, 1), c(2, 2), c(1, 2)]]);
  });
  test('tiles side by side make one loop with corners only where the edge turns, so no seam shows between them', () => {
    expect(outline(tilesOf(['##', '#.']))).toEqual([[c(0, 0), c(2, 0), c(2, 1), c(1, 1), c(1, 2), c(0, 2)]]);
    expect(outline(tilesOf(['###']))).toEqual([[c(0, 0), c(3, 0), c(3, 1), c(0, 1)]]);
  });
  test('a ring of tiles is a loop round the outside and a loop the other way round the hole', () => {
    expect(outline(tilesOf(['###', '#.#', '###']))).toEqual([
      [c(0, 0), c(3, 0), c(3, 3), c(0, 3)],
      [c(1, 1), c(1, 2), c(2, 2), c(2, 1)],
    ]);
  });
  test('two tiles that touch only at a corner are two shapes', () => {
    expect(outline(tilesOf(['#.', '.#']))).toEqual([[c(0, 0), c(1, 0), c(1, 1), c(0, 1)], [c(1, 1), c(2, 1), c(2, 2), c(1, 2)]]);
  });
  test('no tiles draw nothing', () => {
    expect(outline([])).toEqual([]);
  });
  test('a body\'s stride is one shape and its dash another, under the way it picked', () => {
    const d = draw(['.......', '.......', '...@...', '.......', '.......'], { stride: 1, dash: 2 });
    const s = scene(d, { kind: 'move', to: place(4, 2) });
    // the dash of 2 is the ring at distance 2 (5-10-5): a row of three above and below, three down each side, which meet
    // the rows only at corners, so four shapes
    expect(s.shades.map(x => [x.kind, x.tone, x.loops.length])).toEqual([['dash', 'move', 4], ['stride', 'move', 2], ['way', 'move', 1]]);
    // the stride of 1 is the eight tiles round the body: one loop round them, one round the body's own tile
    expect(s.shades[1]!.loops).toEqual([[c(2, 1), c(5, 1), c(5, 4), c(2, 4)], [c(3, 2), c(3, 3), c(4, 3), c(4, 2)]]);
  });
  test('an ability aimed at a foe or a place shades warm, one aimed at an ally or the user cool', () => {
    const d = draw(['@.a.']);
    const tones = (a: Ability) => scene(d, { kind: 'aim', ability: a, at: null }).shades.map(x => x.tone);
    expect(tones(STRIKE)).toEqual(['hostile']);
    expect(tones(BLAST)).toEqual(['hostile']);
    expect(tones(ability('support', 'mend', { aim: 'ally' }))).toEqual(['helpful']);
  });
});

describe('tokens', () => {
  test('a token shows the name\'s first letters, and a pack\'s letter after the first initial', () => {
    expect(['Brakk Ironhide', 'Cave Rat B', 'Goblin', 'Mira'].map(labelOf)).toEqual(['BI', 'CB', 'GO', 'MI']);
  });

  test('the name under a token is a hunter\'s first name and a monster\'s last word with its pack letter', () => {
    expect([shortOf('Brakk Ironhide', 'hunter'), shortOf('Mira', 'hunter'), shortOf('Cave Rat B', 'monster'), shortOf('Ice Warden', 'monster'), shortOf('Goblin', 'monster')])
      .toEqual(['Brakk', 'Mira', 'Rat B', 'Warden', 'Goblin']);
  });

  /** Each token's name as `side text`, or `none`, by its id. */
  const names = (s: MapScene): Record<string, string> =>
    Object.fromEntries(s.tokens.map(t => [t.id, t.plate ? `${t.plate.side} ${t.plate.text}` : 'none']));

  test('of two bodies one above the other, the upper\'s name is written over it and the lower\'s under it', () => {
    const s = scene(draw([
      '...',
      '.a.',
      '.b.',
      '...',
    ]), { kind: 'none' }, null);
    expect(names(s)).toEqual({ a: 'above a', b: 'below b' });
  });

  test('a row of three each has its name under it, one tile wide, short even on its turn', () => {
    const d = draw([
      '.....',
      '.a@c.',
      '.....',
    ]);
    d.bodies[1] = { ...d.bodies[1]!, name: 'Brakk Ironhide' };
    const s = scene(d);
    expect(names(s)).toEqual({ a: 'below a', '@': 'below Brakk', c: 'below c' });
    expect(s.tokens.map(t => t.plate?.span)).toEqual([1, 1, 1]);
  });

  test('in a full 3 by 3 block the top row is named over, the bottom row under, and the middle row not at all', () => {
    const s = scene(draw([
      '.....',
      '.abc.',
      '.def.',
      '.ghi.',
      '.....',
    ]), { kind: 'none' }, null);
    expect(names(s)).toEqual({
      a: 'above a', b: 'above b', c: 'above c',
      d: 'none', e: 'none', f: 'none',
      g: 'below g', h: 'below h', i: 'below i',
    });
  });

  test('a name is never written off the map: a body on the bottom row is named over, one alone in a one-row map not at all', () => {
    expect(names(scene(draw(['...', '.a.']), { kind: 'none' }, null))).toEqual({ a: 'above a' });
    expect(names(scene(draw(['.a.']), { kind: 'none' }, null))).toEqual({ a: 'none' });
  });

  test('the body aimed at is named whole, three tiles wide, where those tiles are free, and short where another name is beside', () => {
    const d = draw([
      '.....',
      '..@..',
      '..g..',
      '.....',
    ]);
    d.bodies[1] = { ...d.bodies[1]!, name: 'Cave Rat A' };
    const aimed = scene(d, { kind: 'aim', ability: STRIKE, at: place(2, 2) });
    expect(names(aimed)).toEqual({ '@': 'above @', g: 'below Cave Rat A' });
    expect(aimed.tokens.find(t => t.id === 'g')!.plate!.span).toBe(3);
    expect(names(scene(d))).toEqual({ '@': 'above @', g: 'below Rat A' });
    const crowded = draw([
      '.....',
      '..@..',
      '..gh.',
      '.....',
    ]);
    crowded.bodies[1] = { ...crowded.bodies[1]!, name: 'Cave Rat A' };
    expect(names(scene(crowded, { kind: 'aim', ability: STRIKE, at: place(2, 2) }))).toEqual({ '@': 'above @', g: 'below Rat A', h: 'below h' });
  });

  test('from the room doc a hunter\'s ring is exact and a monster\'s is its band; a monster down leaves the map and a hunter down lies there', () => {
    const base = { key: null, at: tick(0), speed: 100, statuses: [], shield: null, shieldLeft: null, channel: null, taunt: null, icon: null } as const;
    const rows = [
      { ...base, id: id('k'), name: 'Kai', side: 'party', place: { x: 0, y: 0 }, band: 'wounded', life: { at: 'up' }, kind: 'hunter', hp: 15, hpMax: 20, stride: 3, move: 6 },
      { ...base, id: id('m'), name: 'Rat', side: 'foe', place: { x: 1, y: 0 }, band: 'bloodied', life: { at: 'up' }, kind: 'monster', intent: null, stagger: null, suggest: null },
      { ...base, id: id('dead'), name: 'Rat B', side: 'foe', place: { x: 2, y: 0 }, band: 'down', life: { at: 'dead' }, kind: 'monster', intent: null, stagger: null, suggest: null },
      { ...base, id: id('fell'), name: 'Mira', side: 'party', place: { x: 3, y: 0 }, band: 'down', life: { at: 'dying' }, kind: 'hunter', hp: 0, hpMax: 20, stride: 3, move: 6 },
    ] satisfies FightDocRow[];
    const s = mapScene({ bodies: docBodies(rows, r => r.id === 'k', openGrid(4, 1)), grid: openGrid(4, 1), currentId: id('m'), actor: null }, { kind: 'none' }, RULES);
    expect(s.tokens.map(t => [t.id, t.ring.band ?? t.ring.share, t.current, t.down, t.mine])).toEqual([
      ['k', 0.75, false, false, true],
      ['m', 'bloodied', true, false, false],
      ['fell', 0, false, true, false],
    ]);
  });

  test('on the GM\'s phone a party row\'s ring is exact and a foe\'s shows only its band, as a player sees it', () => {
    const origin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
    const hpMax = modified(origin, [], RULES).sheet.hpMax;
    const row = (name: string, side: Side, hp: number): NewRow => ({
      id: id(name), name, side, ...lifeAt(side === 'party' ? 'hunter' : 'monster', hp), origin, tier: 0, place: null, mana: 0, fatigue: 0, shield: null, stagger: null,
      channel: null, threat: side === 'foe' ? {} : null, statuses: [], readyAt: {}, abilities: [STRIKE], intent: null,
      holder: side === 'party' ? { kind: 'local', hunterId: hunterId(name) } : null, xp: 0,
    } as NewRow);
    const f = reduce(null, { type: 'add', fightId: fightId('f'), rows: [row('A', 'party', hpMax / 2), row('M', 'foe', hpMax / 2)], openings: [] }, { rules: RULES }).fight as Fight;
    const [a, m] = fightBodies(f, RULES, b => b.id === 'A', EVERYTHING);
    expect([a!.ring, a!.mine, a!.stride, a!.dash]).toEqual([{ share: 0.5, band: null }, true, Math.ceil(RULES.fight.moveBase * RULES.fight.strideShare), RULES.fight.moveBase]);
    expect(m!.ring.band).toBe('bloodied');
  });

  describe('a token\'s picture (icons design 5, ruling 1)', () => {
    const build: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
    const beast = (o: { icon?: IconKey } = {}): Origin => ({ kind: 'monster', name: 'Rat', rank: 'E', archetype: 'brute', monsterKind: 'normal', tweak: { hp: 1, stats: {}, traits: [] }, type: 'Beast', ...o });
    const row = (name: string, side: Side, origin: Origin, x: number): NewRow => ({
      id: id(name), name, side, ...lifeAt(side === 'party' ? 'hunter' : 'monster', 20), origin, tier: 0, place: place(x, 0), mana: 0, fatigue: 0, shield: null, stagger: null,
      channel: null, threat: side === 'foe' ? {} : null, statuses: [], readyAt: {}, abilities: [STRIKE], intent: null,
      holder: side === 'party' ? { kind: 'remote', remote: `d-1:${name}` } : null, xp: 0,
    } as NewRow);
    /** Brakk wears a crown, Mira picked no emblem; a pack of two Beasts and a boss its GM gave a raven. */
    const f = reduce(null, { type: 'add', fightId: fightId('f'), rows: [
      row('Brakk', 'party', build, 0), row('Mira Vale', 'party', build, 1), row('Cave Rat A', 'foe', beast(), 3), row('Cave Rat B', 'foe', beast(), 4),
      row('Old Crow', 'foe', beast({ icon: 'raven' }), 5),
    ], openings: [] }, { rules: RULES }).fight as Fight;
    const sheets: Record<string, { emblem: string }> = { Brakk: { emblem: 'crown' }, 'Mira Vale': { emblem: '' } };
    const hunterOf = (b: Body) => sheets[b.name] ?? null;
    const drawn = (bodies: readonly MapBody[]) => mapScene({ bodies, grid: openGrid(6, 1), currentId: null, actor: null }, { kind: 'none' }, RULES).tokens
      .map(t => [t.name, t.icon, t.letter, t.label]);
    const PICTURE = [
      ['Brakk', 'crown', null, 'BR'], ['Mira Vale', null, null, 'MV'], ['Cave Rat A', 'wolf', 'A', 'CA'], ['Cave Rat B', 'wolf', 'B', 'CB'], ['Old Crow', 'raven', null, 'OC'],
    ];

    test('the GM\'s map draws a hunter\'s emblem, a monster\'s type\'s picture with its pack letter and a pick; a hunter with no emblem keeps its initials', () => {
      expect(drawn(fightBodies(f, RULES, () => false, EVERYTHING, hunterOf))).toEqual(PICTURE);
    });
    test('a player\'s map, from the doc on the wire, draws every token with the GM\'s picture', () => {
      const doc = fightDoc(f, RULES, { by: 'd-gm' as DeviceId, at: 'now', was: null, keyOf: () => null, hunterOf });
      const read = DOCS.fight(JSON.parse(JSON.stringify(fightWire(doc!)))) as FightDoc;
      if (read.ended) throw new Error('not a live doc');
      expect(drawn(docBodies(read.rows, () => false, openGrid(6, 1)))).toEqual(PICTURE);
    });
    test('a pack\'s letter is the last word of two or more when it is one character', () => {
      expect(['Cave Rat B', 'Rat C', 'Goblin', 'Ice Warden', 'Rat  D ', ''].map(packLetter)).toEqual(['B', 'C', null, null, 'D', null]);
    });
  });
});

describe('the hotbar', () => {
  const skill = (n: string) => ability('blast', n);
  const potion = { ...ability('support', 'Potion'), id: itemAbilityId(iid('i1')), item: iid('i1') };
  const attack = { ...STRIKE, id: ATTACK_ID, name: 'Sword' };

  test('the attack comes first, then the first four of the hunter\'s own abilities; the rest and every item go in the drawer', () => {
    const list = [attack, skill('a'), skill('b'), potion, skill('c'), skill('d'), skill('e')];
    const h = hotbar(list, {}, tick(0), 0, null, RULES);
    expect(h.bar.map(s => s.name)).toEqual(['Sword', 'a', 'b', 'c', 'd']);
    expect(h.more.map(s => [s.name, s.item])).toEqual([['e', false], ['Potion', true]]);
  });

  test('pinned abilities replace the first four, in the order pinned, and a pin the body does not have is skipped', () => {
    const list = [attack, skill('a'), skill('b'), skill('c')];
    expect(hotbar(list, {}, tick(0), 0, ['c', 'gone', 'a'], RULES).bar.map(s => [s.name, s.pinned])).toEqual([['Sword', false], ['c', true], ['a', true]]);
  });

  test('the bar is full at PINS pinned, so the drawer offers no more Pin, and one fewer leaves room (implicit audit 3, P1)', () => {
    const own = Array.from({ length: PINS + 1 }, (_, i) => skill(String.fromCharCode(97 + i)));
    const ids = own.map(a => a.id as string);
    expect(hotbar([attack, ...own], {}, tick(0), 0, ids.slice(0, PINS), RULES).full).toBe(true);
    expect(hotbar([attack, ...own], {}, tick(0), 0, ids.slice(0, PINS - 1), RULES).full).toBe(false);
  });

  test('a slot shows its cost after the cost cut (rule 4, rounded up) and the rounds until it is ready', () => {
    const costly = { ...skill('a'), cost: { ...skill('a').cost, fatigue: 10, mana: 5 } };
    const [, s] = hotbar([attack, costly], { a: tick(RULES.fight.round * 1.5) }, tick(0), 0.25, null, RULES).bar;
    expect([s!.fatigue, s!.mana, s!.wait]).toEqual([8, 4, 1.5]);
  });

  test('a reaction says Arm, Armed or Spent (kits table 8.9.1), and an ability limited in uses says how many are left', () => {
    const parry = { ...skill('parry'), react: { when: 'before' as const, reach: tiles(0) } };
    const bar = (kit: HotbarKit) => hotbar([attack, parry, skill('a')], {}, tick(0), 0, null, RULES, kit).bar.map(s => [s.name, s.react, s.left]);
    expect(bar({})).toEqual([['Sword', null, null], ['parry', 'arm', null], ['a', null, null]]);
    expect(bar({ armed: { ability: 'parry', spent: false } })[1]).toEqual(['parry', 'armed', null]);
    expect(bar({ armed: { ability: 'parry', spent: true } })[1]).toEqual(['parry', 'spent', null]);
    expect(bar({ armed: { ability: 'other', spent: false } })[1]).toEqual(['parry', 'arm', null]);
    expect(bar({ left: { a: 0 } })[2]).toEqual(['a', null, 0]);
  });

  test('each slot shows its kind\'s picture, and a bag item\'s use the item\'s from the user\'s bag, its kind\'s with no bag to look in', () => {
    const shot = { ...ability('shot', 'Aimed Shot') }, hex = ability('curse', 'Hex'), aid = ability('support', 'Mend');
    const h = (kit: HotbarKit) => hotbar([attack, skill('Nova'), shot, hex, aid, potion], {}, tick(0), 0, null, RULES, kit);
    expect(h({}).bar.map(s => [s.name, s.icon])).toEqual([['Sword', 'strike'], ['Nova', 'burst'], ['Aimed Shot', 'arrow'], ['Hex', 'hex'], ['Mend', 'aid']]);
    expect(h({ itemOf: i => (i === iid('i1') ? { type: 'consumable', slot: null, revive: true } : null) }).more.map(s => [s.name, s.icon])).toEqual([['Potion', 'crystal']]);
    expect(h({}).more.map(s => [s.name, s.icon])).toEqual([['Potion', 'aid']]);
  });
});

describe('a summon and an unseen body on the map', () => {
  test('a summon\'s token names its owner and its rounds left; a body the other side does not perceive is drawn dimmed', () => {
    const { grid, bodies } = draw(['A.b', '...']);
    const sprite: MapBody = { ...body('Sprite', 'party', 1, 1, { kind: 'summon' }), summon: { owner: id('A'), left: 1.5 } };
    const sly: MapBody = { ...body('Sly', 'foe', 2, 1), unseen: true };
    const scene = mapScene({ bodies: [...bodies, sprite, sly], grid, currentId: null, actor: null }, { kind: 'none' }, RULES);
    expect(scene.tokens.find(t => t.name === 'Sprite')!.summon).toEqual({ owner: 'A', left: 1.5 });
    expect(scene.tokens.find(t => t.name === 'A')!.summon).toBeNull();
    expect(scene.tokens.find(t => t.name === 'Sly')!.hidden).toBe(true);
    expect(scene.tokens.find(t => t.name === 'b')!.hidden).toBe(false);
  });
});

describe('seen through one foe\'s eyes (notes-7-stealth.md section 6)', () => {
  // One row of ten tiles, a wall at 2, a fog whose eyes look 3 tiles. Kai at 0, Mira at 4, Sly at 7 hiding at stealth
  // level 2, the Goblin at 5 and a Rat at 9, each with sight 0 (the rules' `sightBase`). The party sees every tile: Kai 0 to 2 (the wall stops
  // the line to 3), Mira 2 to 7, Sly 4 to 9. The Goblin's own eyes reach 2 to 8. It perceives Mira, 1 tile off; not Kai, 5
  // off; not Sly, 2 off but hidden at a level above its sight (sight.ts `perceives`, the owner's ruling 1).
  const origin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
  const veil: Status = { key: statusKey('veil'), def: { label: 'Veiled', desc: '', ops: [{ op: 'hidden', level: 2, start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
  const row = (name: string, side: Side, x: number, o: { statuses?: Status[]; hp?: number } = {}): NewRow => ({
    id: id(name), name, side, ...lifeAt(side === 'party' ? 'hunter' : 'monster', o.hp ?? 20), origin, tier: 0, place: place(x, 0), mana: 0, fatigue: 0, shield: null, stagger: null,
    channel: null, threat: side === 'foe' ? {} : null, statuses: o.statuses ?? [], readyAt: {}, abilities: [STRIKE], intent: null,
    holder: side === 'party' ? { kind: 'local', hunterId: hunterId(name) } : null, xp: 0,
  } as NewRow);
  const grid: Grid = { w: 10, h: 1, tiles: [...'..#.......'].map(c => (c === '#' ? 'wall' : 'floor')) };
  const room = (goblinHp = 20): Fight => reduce(null, {
    type: 'add', fightId: fightId('f-eyes'), openings: [], grid, fog: { sight: tiles(3), seen: '0'.repeat(10) },
    rows: [row('Kai', 'party', 0), row('Mira', 'party', 4), row('Sly', 'party', 7, { statuses: [veil] }), row('Goblin', 'foe', 5, { hp: goblinHp }), row('Rat', 'foe', 9)],
  }, { rules: RULES }).fight as Fight;
  const GOBLIN: ViewAs = { kind: 'row', id: id('Goblin') };
  const sceneAs = (f: Fight, as: ViewAs) => mapScene({
    bodies: fightBodies(f, RULES, () => false, as), grid: f.grid, currentId: null, actor: null,
    eyes: as.kind === 'row' ? eyesChoices(f).find(c => c.id === as.id) ?? null : null, ...fightGround(f, RULES, as),
  }, { kind: 'none' }, RULES);
  const at = (...xs: number[]) => xs.map(x => place(x, 0));

  test('as the Goblin sees it, the hidden hunter it cannot see is no token, nor the hunter out of its sight; the fog is its own', () => {
    const s = sceneAs(room(), GOBLIN);
    expect(s.tokens.map(t => [t.id, t.hidden])).toEqual([['Mira', false], ['Goblin', false], ['Rat', false]]);
    expect(s.fog).toEqual({ dim: outline(at(0, 1, 9)), dark: [], gm: true });
    expect(s.eyes).toEqual({ name: 'Goblin', down: false });
  });

  test('under everything the hidden hunter is there, dimmed, as is the hunter no foe has in sight; the fog is the party\'s', () => {
    const s = sceneAs(room(), EVERYTHING);
    expect(s.tokens.map(t => [t.id, t.hidden])).toEqual([['Kai', true], ['Mira', false], ['Sly', true], ['Goblin', false], ['Rat', false]]);
    expect(s.fog).toEqual({ dim: [], dark: [], gm: true });
    expect(s.eyes).toBeNull();
  });

  test('as a Goblin that is down, the map shows only its own side (it has left the map itself), every tile dimmed, and says it is down', () => {
    const s = sceneAs(room(0), GOBLIN);
    expect(s.tokens.map(t => t.id)).toEqual(['Rat']);
    expect(s.fog).toEqual({ dim: outline(at(0, 1, 2, 3, 4, 5, 6, 7, 8, 9)), dark: [], gm: true });
    expect(s.eyes).toEqual({ name: 'Goblin', down: true });
  });

  test('the choice kept on the phone reads as that foe only in its own fight while the row is in it; anything else is everything', () => {
    const f = room(), kept = (fight: string, as: unknown) => viewAsOf({ fight, as }, f);
    expect(eyesChoices(f)).toEqual([{ id: id('Goblin'), name: 'Goblin' }, { id: id('Rat'), name: 'Rat' }]);
    expect(kept('f-eyes', GOBLIN)).toEqual(GOBLIN);
    expect([kept('f-other', GOBLIN), kept('f-eyes', { kind: 'row', id: 'Gone' }), kept('f-eyes', { kind: 'row', id: 'Mira' }), kept('f-eyes', EVERYTHING), viewAsOf(null, f), viewAsOf('Goblin', f)])
      .toEqual([EVERYTHING, EVERYTHING, EVERYTHING, EVERYTHING, EVERYTHING, EVERYTHING]);
  });
});

describe('lines from a monster: its intent, or the target its threat suggests', () => {
  const base = { key: null, at: tick(0), speed: 100, statuses: [], shield: null, shieldLeft: null, channel: null, taunt: null, icon: null, band: 'healthy', life: { at: 'up' } } as const;
  const kai = { ...base, id: id('k'), name: 'Kai', side: 'party', place: { x: 1, y: 1 }, kind: 'hunter', hp: 20, hpMax: 20, stride: 3, move: 6 } as const;
  const boss = (o: Partial<Extract<FightDocRow, { kind: 'monster' }>>): FightDocRow => ({ ...base, id: id('b'), name: 'Boss', side: 'foe', place: { x: 5, y: 1 }, kind: 'monster', intent: null, stagger: null, suggest: null, ...o });
  const lines = (b: FightDocRow) => mapScene({ bodies: docBodies([kai, b], () => false, openGrid(9, 5)), grid: openGrid(9, 5), currentId: null, actor: null }, { kind: 'none' }, RULES).lines;

  test('an intent not yet revealed draws a line to its target and no area', () => {
    expect(lines(boss({ intent: { name: 'Slam', target: id('k'), reveal: null } }))).toEqual([{ from: id('b'), at: place(5, 1), to: place(1, 1), kind: 'intent', revealed: false, loops: [], words: null, nth: 0, of: 1 }]);
  });
  test('once revealed the line\'s end says the ability and what it does; before, it says nothing a player may not know', () => {
    const [l] = lines(boss({ intent: { name: 'Slam', target: id('k'), reveal: { lines: ['Physical damage 2d6', 'Range 1 tile'], radius: null, outer: null } } }));
    expect(l!.words).toEqual({ name: 'Slam', what: 'Physical damage 2d6' });
  });
  test('two lines that end on the same body are numbered, so the map draws them apart', () => {
    const b2 = { ...boss({ intent: { name: 'Bite', target: id('k'), reveal: null } }), id: id('b2'), place: { x: 1, y: 4 } } as FightDocRow;
    const ls = mapScene({ bodies: docBodies([kai, boss({ suggest: id('k') }), b2], () => false, openGrid(9, 5)), grid: openGrid(9, 5), currentId: null, actor: null }, { kind: 'none' }, RULES).lines;
    expect(ls.map(l => [l.from, l.nth, l.of])).toEqual([['b', 0, 2], ['b2', 1, 2]]);
  });
  test('a revealed area intent draws its splash and ring as one outline round the aimed tile', () => {
    const [l] = lines(boss({ intent: { name: 'Breath', target: { x: 1, y: 1 }, reveal: { lines: [], radius: 1, outer: null } } }));
    // radius 1 by 5-10-5 is the 3 by 3 square round (1, 1)
    expect([l!.revealed, l!.loops]).toEqual([true, [[{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }]]]);
  });
  test('with no intent the suggested target is a quieter line, and a channel, a shield, a stagger bar and a taunt reach the token', () => {
    expect(lines(boss({ suggest: id('k') })).map(l => l.kind)).toEqual(['suggest']);
    const b = boss({ shield: 5, stagger: { fill: 10, max: 40, staggered: 1.5 }, channel: { ability: abilityId('x'), name: 'X', charge: 2, max: 5, state: 'holding', factor: 2.1 }, taunt: { by: id('k'), left: 1 } });
    const t = mapScene({ bodies: docBodies([kai, b], () => false, openGrid(9, 5)), grid: openGrid(9, 5), currentId: null, actor: null }, { kind: 'none' }, RULES).tokens.find(x => x.id === 'b')!;
    expect(t.extras).toEqual({ shield: 1, stagger: { share: 0.25, staggered: true }, channel: { charge: 2, max: 5, state: 'holding' }, taunted: true, reacted: false });
    // a row the doc names as spent has reacted since its turn began (kits table 8.9.1)
    expect(docBodies([kai, b], () => false, openGrid(9, 5), [kai.id]).map(x => [x.id, x.extras.reacted])).toEqual([[kai.id, true], ['b', false]]);
  });
});


describe('what the map opens framed on', () => {
  test('the bodies, with the walls and zones within three tiles of them; a wall across an empty map does not pull the frame out', () => {
    const d = draw([
      '..........#',
      '..@...a...#',
      '.....#....#',
      '..........#',
      '..........#',
      '..........#',
      '..........#',
    ]);
    // the wall at x 10 is four tiles from the foe at x 6, so it is out; the one at (5, 2) is between them, so in
    expect(frameOf(d.grid, d.bodies.map(b => b.place), (d.grid.tiles ?? []).flatMap((t, i) => t === 'floor' ? [] : [place(i % 11, Math.floor(i / 11))]))).toEqual({ x0: 2, y0: 1, x1: 6, y1: 2 });
    const s = mapScene({ bodies: d.bodies, grid: d.grid, currentId: id('a'), actor: null, zones: [{ id: 'z' as never, name: 'Fire', tone: 'harm', left: null, tiles: [place(8, 4), place(9, 4)], anchor: null }] }, { kind: 'none' }, RULES);
    // nobody acts on this phone: the frame keeps the viewer's own body (@) in sight before the one whose turn it is (a)
    expect([s.frame, s.anchor]).toEqual([{ x0: 2, y0: 1, x1: 9, y1: 4 }, place(2, 1)]);
    expect(mapScene({ bodies: d.bodies.map(b => ({ ...b, mine: false })), grid: d.grid, currentId: id('a'), actor: null }, { kind: 'none' }, RULES).anchor).toEqual(place(6, 1));
  });
  test('a run of wall tiles is one outline, so the map draws it as one block', () => {
    const d = draw(['@.#', '..#', '.##']);
    expect(scene(d).walls).toEqual([[{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }, { x: 2, y: 2 }]]);
  });
  test('with no body the map opens on the whole grid', () => {
    expect(frameOf(openGrid(7, 4), [], [])).toEqual({ x0: 0, y0: 0, x1: 6, y1: 3 });
  });
});

describe('the ground on the map: zones and the fog', () => {
  const fire = { id: 'z1' as never, name: 'Fire', tone: 'harm' as const, left: 2, tiles: [place(3, 0), place(4, 0)], anchor: null };

  test('a zone is drawn as one outline in its tone, and a tap on it alone says which zone it is', () => {
    const d = draw(['@....']);
    const s = mapScene({ bodies: d.bodies, grid: d.grid, currentId: null, actor: null, zones: [fire] }, { kind: 'none' }, RULES);
    expect(s.zones.map(z => [z.name, z.tone, z.loops, z.at])).toEqual([['Fire', 'harm', [[{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1 }, { x: 3, y: 1 }]], place(3, 0)]]);
    expect(tapOn(s, place(4, 0))).toEqual({ kind: 'zone', id: 'z1' });
    expect(tapOn(s, place(1, 0))).toEqual({ kind: 'nothing' });
  });

  test('an aura\'s name is written above its body, not under the token or its name plate', () => {
    const d = draw(['.....', '.....', '..@..', '.....', '.....']);
    const all = [0, 1, 2, 3, 4].flatMap(y => [0, 1, 2, 3, 4].map(x => place(x, y)));
    const aura = { ...fire, tiles: all.filter(p => Math.abs(p.x - 2) + Math.abs(p.y - 2) <= 2), anchor: id('@') };
    const s = mapScene({ bodies: d.bodies, grid: d.grid, currentId: null, actor: null, zones: [aura] }, { kind: 'none' }, RULES);
    expect(s.zones[0]!.at).toEqual(place(2, 1));
  });

  test('a field that grew where it lay shows the tiles it gained as its new edge; an aura that moved with its body did not grow', () => {
    const d = draw(['@....']), at = (...xs: number[]) => xs.map(x => place(x, 0));
    const scene = (now: number[], was: number[]) => mapScene({ bodies: d.bodies, grid: d.grid, currentId: null, actor: null, zones: [{ ...fire, tiles: at(...now) }], before: [{ ...fire, tiles: at(...was) }] }, { kind: 'none' }, RULES);
    expect(scene([1, 2, 3], [2]).zones[0]!.grew).toEqual(outline(at(1, 3)));
    expect(scene([2, 3, 4], [1, 2]).zones[0]!.grew).toEqual([]);
    expect(scene([2], [2]).zones[0]!.grew).toEqual([]);
  });

  test('a tile in the movement area moves there even when a zone is on it', () => {
    const d = draw(['@....']);
    const s = mapScene({ bodies: d.bodies, grid: d.grid, currentId: id('@'), actor: id('@'), zones: [fire] }, { kind: 'none' }, RULES);
    expect(tapOn(s, place(3, 0))).toEqual({ kind: 'moveTo', to: place(3, 0) });
  });

  test('the fog dims what the party does not see now and darkens what it never saw, and lighter on the GM\'s map', () => {
    const d = draw(['@..a']);
    const sight = { lit: new Set([0, 1]), known: new Set([0, 1, 2]), gm: false };
    const s = mapScene({ bodies: d.bodies, grid: d.grid, currentId: null, actor: null, sight }, { kind: 'none' }, RULES);
    expect(s.fog).toEqual({ dim: outline([place(2, 0)]), dark: outline([place(3, 0)]), gm: false });
    const gm = mapScene({ bodies: d.bodies, grid: d.grid, currentId: null, actor: null, sight: { lit: new Set([0, 1]), known: null, gm: true } }, { kind: 'none' }, RULES);
    expect(gm.fog).toEqual({ dim: outline([place(2, 0), place(3, 0)]), dark: [], gm: true });
  });

  test('a player\'s map reads the doc: walls it saw, an unseen tile as floor, zones from their runs, and what is lit', () => {
    const doc = { ended: false, grid: { w: 4, h: 1, tiles: '#.?~', lit: '0110' }, zones: [{ id: 'z1', name: 'Fire', tiles: '1+2', tone: 'harm', left: null }] } as never;
    const g = docGround(doc);
    expect(g.grid.tiles).toEqual(['wall', 'floor', 'floor', 'rough']);
    expect(g.zones[0]!.tiles).toEqual([place(1, 0), place(2, 0)]);
    expect([[...g.sight!.lit], [...g.sight!.known!], g.sight!.gm]).toEqual([[1, 2], [0, 1, 3], false]);
  });
});

describe('what the map has chosen (select, pick, aim, confirm)', () => {
  const MAP = draw([
    '..........',
    '...@...g..',
    '.....h....',
    '..A.......',
  ], { stride: 3, dash: 6 });
  const WARD = ability('support', 'ward', { aim: 'self' });
  const KIT: readonly Ability[] = [STRIKE, BLAST, WARD];
  /** The choice after `events`, every effect in order, from a turn of `@` just begun with KIT. */
  function run(events: readonly ((c: Choice) => ChoiceEvent)[], from: Choice = choose(NO_CHOICE, { kind: 'seen', actor: id('@'), kit: KIT, waiting: false }).choice): { c: Choice; fx: ChoiceFx[] } {
    let c = from;
    const fx: ChoiceFx[] = [];
    for (const e of events) { const r = choose(c, e(c)); c = r.choice; fx.push(...r.fx); }
    return { c, fx };
  }
  const tap = (x: number, y: number) => (c: Choice): ChoiceEvent => ({ kind: 'tap', scene: scene(MAP, c.now), at: place(x, y) });
  const go = (c: Choice): ChoiceEvent => ({ kind: 'go', scene: scene(MAP, c.now) });
  const pick = (a: Ability) => (c: Choice): ChoiceEvent => ({ kind: 'pick', scene: scene(MAP, c.now), ability: a });

  test('a tile tapped in the stride is chosen, Move sends it once, and a second press before the map redraws sends nothing', () => {
    const chosen = run([tap(5, 1)]);
    expect(chosen.c.now).toEqual({ kind: 'move', to: place(5, 1) });
    const stale = scene(MAP, chosen.c.now);
    const sent = run([() => ({ kind: 'go', scene: stale }), () => ({ kind: 'go', scene: stale })], chosen.c);
    expect(sent.fx).toEqual([{ kind: 'move', to: place(5, 1), dash: false }]);
    expect(sent.c.now).toEqual({ kind: 'none' });
    expect(sent.c.sent).toEqual({ by: id('@'), way: [place(4, 1), place(5, 1)] });
  });

  test('a sent move\'s way stays drawn while it waits, and when the answer comes the token goes along it once', () => {
    const sent = run([tap(5, 1), go]);
    const waiting = run([() => ({ kind: 'seen', actor: id('@'), kit: KIT, waiting: true })], sent.c);
    expect([waiting.fx, waiting.c.sent !== null]).toEqual([[], true]);
    const answered = run([() => ({ kind: 'seen', actor: id('@'), kit: KIT, waiting: false }), () => ({ kind: 'seen', actor: id('@'), kit: KIT, waiting: false })], waiting.c);
    expect(answered.fx).toEqual([{ kind: 'along', id: id('@'), tiles: [place(4, 1), place(5, 1)] }]);
  });

  test('a double tap puts back what its two taps chose', () => {
    const r = run([pick(STRIKE), tap(5, 1), tap(5, 1), () => ({ kind: 'double' })]);
    expect(r.c.now).toEqual({ kind: 'aim', ability: STRIKE, at: null });
    expect(run([tap(5, 1), tap(5, 1), () => ({ kind: 'double' })]).c.now).toEqual({ kind: 'none' });
  });

  test('a new turn puts the choice down and closes More', () => {
    const r = run([pick(BLAST), () => ({ kind: 'more' }), () => ({ kind: 'seen', actor: id('A'), kit: KIT, waiting: false })]);
    expect([r.c.now, r.c.drawer]).toEqual([{ kind: 'none' }, false]);
  });

  test('an aimed ability that leaves the kit is put down; one that changed is used as the kit has it now', () => {
    expect(run([pick(BLAST), () => ({ kind: 'seen', actor: id('@'), kit: [STRIKE], waiting: false })]).c.now).toEqual({ kind: 'none' });
    const sharper = { ...STRIKE, name: 'Sharper strike' };
    const r = run([pick(STRIKE), () => ({ kind: 'seen', actor: id('@'), kit: [sharper], waiting: false }), tap(4, 2), go]);
    expect(r.fx).toEqual([]);
    const near = draw(['.@g..'], { stride: 3, dash: 6 }), seen: ChoiceEvent = { kind: 'seen', actor: id('@'), kit: [sharper], waiting: false };
    const used = [
      (c: Choice): ChoiceEvent => ({ kind: 'pick', scene: scene(near, c.now), ability: STRIKE }), () => seen,
      (c: Choice): ChoiceEvent => ({ kind: 'tap', scene: scene(near, c.now), at: place(2, 0) }),
      (c: Choice): ChoiceEvent => ({ kind: 'go', scene: scene(near, c.now) }),
    ];
    expect(run(used).fx).toEqual([{ kind: 'use', ability: sharper, aim: id('g'), at: place(2, 0) }]);
  });

  test('Use from a scene drawn before the last tap sends nothing: what is sent is what was last drawn', () => {
    const near = draw(['.@g', '..h'], { stride: 3, dash: 6 });
    const picked = run([(c: Choice): ChoiceEvent => ({ kind: 'pick', scene: scene(near, c.now), ability: STRIKE }), (c: Choice): ChoiceEvent => ({ kind: 'tap', scene: scene(near, c.now), at: place(2, 0) })]);
    const drawnAtG = scene(near, picked.c.now);
    const moved = run([(c: Choice): ChoiceEvent => ({ kind: 'tap', scene: scene(near, c.now), at: place(2, 1) }), () => ({ kind: 'go', scene: drawnAtG })], picked.c);
    expect(moved.fx).toEqual([]);
    expect(run([(c: Choice): ChoiceEvent => ({ kind: 'go', scene: scene(near, c.now) })], moved.c).fx).toEqual([{ kind: 'use', ability: STRIKE, aim: id('h'), at: place(2, 1) }]);
  });

  test('off the turn, an ability tapped on the hotbar or End turn says so and chooses nothing', () => {
    const off = choose(NO_CHOICE, { kind: 'seen', actor: null, kit: KIT, waiting: false }).choice;
    const r = run([(c: Choice): ChoiceEvent => ({ kind: 'pick', scene: scene(MAP, c.now, null), ability: STRIKE }), (c: Choice): ChoiceEvent => ({ kind: 'pass', scene: scene(MAP, c.now, null) })], off);
    expect([r.fx, r.c.now]).toEqual([[{ kind: 'offTurn' }, { kind: 'offTurn' }], { kind: 'none' }]);
  });

  test('a tile chosen that the scene no longer offers (a body now stands on it) is put down when the map draws', () => {
    const chosen = run([tap(4, 1)]).c;
    const blocked = draw(['..........', '...@g..g..', '.....h....', '..A.......'], { stride: 3, dash: 6 });
    expect(choose(chosen, { kind: 'drawn', scene: scene(blocked, chosen.now) }).choice.now).toEqual({ kind: 'none' });
    expect(choose(chosen, { kind: 'drawn', scene: scene(MAP, chosen.now) }).choice.now).toEqual(chosen.now);
  });

  /**
   * Random taps, picks, Moves and Uses (from the scene drawn last, or one drawn up to three events before), double taps,
   * Cancel, End turn, More, and draws with the turn coming and going and the kit changing. The scene the map has drawn is
   * the one from the choice as it is (`fresh`). Checked: a move or a use sent is exactly what that scene offered for the
   * choice; between two commands the viewer chose again (a tap or a pick); a new turn starts with nothing chosen; an aimed
   * ability is always the kit's own.
   */
  test('no sequence sends a move or a use twice, or one the scene did not offer', () => {
    const TILES = Array.from({ length: 40 }, (_, i) => place(i % 10, Math.floor(i / 10)));
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      let actor: string | null = '@', kit: readonly Ability[] = KIT, c = choose(NO_CHOICE, { kind: 'seen', actor: id('@'), kit, waiting: false }).choice;
      let chosenSince = true;
      const old: MapScene[] = [];
      for (let step = 0; step < 50; step++) {
        const fresh = scene(MAP, c.now, actor), roll = r.next();
        const given = old.length && r.chance(0.4) ? r.pick(old) : fresh;
        let e: ChoiceEvent;
        if (roll < 0.3) e = { kind: 'tap', scene: fresh, at: r.pick(TILES) };
        else if (roll < 0.45) e = { kind: 'pick', scene: fresh, ability: r.pick(kit.length ? kit : KIT) };
        else if (roll < 0.65) e = { kind: 'go', scene: given };
        else if (roll < 0.7) e = { kind: 'double' };
        else if (roll < 0.75) e = { kind: 'cancel' };
        else if (roll < 0.8) e = { kind: 'pass', scene: fresh };
        else if (roll < 0.85) e = { kind: 'more' };
        else {
          actor = r.chance(0.8) ? '@' : null;
          kit = r.pick([KIT, [STRIKE], [{ ...STRIKE }, BLAST, WARD]]);
          e = { kind: 'seen', actor: actor === null ? null : id(actor), kit, waiting: false };
        }
        const was = c, out = choose(c, e), where = `seed ${seed} step ${step} ${e.kind} with ${JSON.stringify(was.now)}`;
        c = out.choice;
        if (e.kind === 'seen' && e.actor !== was.actor) expect([c.now.kind, c.drawer], `${where}: a new turn starts with nothing chosen`).toEqual(['none', false]);
        if (e.kind === 'seen' && c.now.kind === 'aim') expect(kit, `${where}: the aimed ability is the kit's own`).toContain(c.now.ability);
        for (const f of out.fx) {
          const offer = fresh.focus;
          if (f.kind === 'move') {
            expect(offer.kind === 'move' && offer.path && was.now.kind === 'move' ? { kind: 'move', to: offer.path.to, dash: offer.path.dash } : null, `${where}: the move sent is the one drawn`).toEqual(f);
          }
          if (f.kind === 'use') {
            expect(offer.kind === 'aim' && offer.aim && offer.aim.ok && was.now.kind === 'aim' ? { kind: 'use', ability: was.now.ability, aim: offer.aim.send, at: offer.aim.at } : null, `${where}: the use sent is the one drawn`).toEqual(f);
          }
          if (f.kind === 'move' || f.kind === 'use') { expect(chosenSince, `${where}: chosen again since the last command`).toBe(true); chosenSince = false; }
        }
        if ((e.kind === 'tap' || e.kind === 'pick' || e.kind === 'double') && c.now !== was.now && c.now.kind !== 'none') chosenSince = true;
        if (e.kind === 'seen') c = choose(c, { kind: 'drawn', scene: scene(MAP, c.now, actor) }).choice;
        old.push(fresh); if (old.length > 3) old.shift();
      }
    }
  });
});
