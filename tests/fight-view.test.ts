// The fight screen's model: the order ahead, a card, the targets an ability can aim at and the move control's steps.
// Expected numbers come from the rules: the interval and opening of design 1.2, armor (rule 12), a weak hit's stagger
// (4.3), rounds left in tenths, the 5-10-5 distance and the walk of 4.6, and the tie rule of 3.1 rule 8a (fewest steps,
// lowest y, then x). Aims read rules 5 and 6 from resolve.ts, so they are tested only by what they return.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { openGrid, place, tiles } from '../src/core/combat/space.ts';
import type { Grid, Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import type { Ability, AbilityKind, CombatantId } from '../src/core/combat/ability-types.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Body, CombatantKind, Op, Origin, Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { fightId, reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow, Opening, Running } from '../src/core/combat/fight.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { aims, cardOf, docSpots, order, readyIn, spotOf, statusGrant, stepAway, stepToward } from '../src/core/combat/fight-view.ts';

const ctx: Ctx = { rules: RULES, life: () => null };
const id = combatantId;
const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const ability = (kind: AbilityKind, name: string = kind, o: Partial<Ability> = {}): Ability => ({ ...abilityOf(kind, { id: abilityId(name), name }, RULES), ...o });
/** A strike as the kind makes it: range 1, a touch of reach 1 (RULES.fight.abilityKinds.strike). */
const STRIKE = ability('strike');
/** A plain hit of 10 before armor that reaches across the grid: light armor 10 makes it round(10 * 100 / 110) = 9 (rule 12). */
const HIT = { ...ability('strike', 'hit', { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } }), effect: { type: 'physical', by: 'hand', formula: f('10') } } as Ability;
const st = (key: string, ...ops: Op[]): StatusDef => ({ label: key, desc: '', ops });
const haste = (pct: number): Status =>
  statusOn(st('haste', { op: 'speed', pct }), { key: statusKey(`haste${pct}`), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) });
const hunterOrigin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };

/** A body of base stats in a light kit: speed 100, move 6, stride 3, armor 10. */
function row(name: string, side: Side, o: Partial<NewRow> = {}): NewRow {
  const hpMax = modified(hunterOrigin, o.statuses ?? [], RULES).sheet.hpMax, kind = o.kind ?? (side === 'party' ? 'hunter' : 'monster');
  return {
    id: id(name), name, side, kind, origin: hunterOrigin, tier: 0, place: null, hp: hpMax, mana: 10, fatigue: 0, shield: null, stagger: null,
    channel: null, threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: [HIT, STRIKE], intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0, ...o,
  };
}

function play(...commands: Command[]): Fight {
  let fight: Fight | null = null;
  for (const cmd of commands) {
    const r = reduce(fight, cmd, ctx);
    const no = r.effects.find(e => e.type === 'refused');
    if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
    fight = r.fight;
  }
  return fight!;
}
const add = (...rows: NewRow[]): Command => ({ type: 'add', fightId: fightId('f-1'), rows, openings: [] });
const start = (...list: [string, number][]): Command => ({ type: 'start', openings: list.map(([n, d20]): Opening => ({ id: id(n), d20, tie: 0 })) });
const pass = (by: string): Command => ({ type: 'endTurn', by: id(by) });
const adjust = (who: string, hp: number): Command => ({ type: 'adjust', id: id(who), hp });
const rolls = (react: Record<string, number> = {}): Rolls => ({ dice: {}, react: react as Rolls['react'] });
const body = (fight: Fight, name: string): Body => fight.rows.find(r => r.id === name)!;
const running = (fight: Fight): Running => { if (fight.phase !== 'running') throw new Error(fight.phase); return fight; };

/** Spots as a player's phone reads them from the room doc: plain rows with more fields than a spot needs. */
const spot = (name: string, side: Side, x: number, y: number, o: { kind?: CombatantKind; down?: boolean } = {}) =>
  ({ id: id(name), name, side, kind: o.kind ?? (side === 'party' ? 'hunter' : 'monster'), place: place(x, y), down: o.down ?? false, band: 'healthy' });
const GRID = openGrid(20, 14);
const walled = (w: number, h: number, walls: readonly [number, number][]): Grid =>
  ({ w, h, tiles: Array.from({ length: w * h }, (_, i) => walls.some(([x, y]) => y * w + x === i) ? 'wall' : 'floor') });
const ids = (list: readonly { target: { id: CombatantId } }[]) => list.map(a => a.target.id);

describe('order: the turns ahead', () => {
  test('a fight being set up, or one that is over, has no order ahead', () => {
    const setup = play(add(row('A', 'party'), row('M', 'foe')));
    expect(order(setup, 8, RULES)).toEqual([]);
    expect(order(play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 20]), { type: 'end' }), 8, RULES)).toEqual([]);
  });

  test('the current turn comes first, and a speed-200 body acts twice for each turn of a speed-100 one, a tie going to the faster (1.2)', () => {
    const fight = running(play(add(row('Fast', 'party', { statuses: [haste(100)] }), row('Slow', 'foe')), start(['Fast', 20], ['Slow', 20])));
    const turns = order(fight, 6, RULES);
    expect(turns[0]!.row.id).toBe(fight.currentId);
    expect(turns.map(t => [t.row.id, t.at, t.round])).toEqual([
      ['Fast', 0, 1], ['Slow', 0, 1], ['Fast', 500, 1], ['Fast', 1000, 2], ['Slow', 1000, 2], ['Fast', 1500, 2],
    ]);
  });

  test('each turn holds the row as the fight has it now, and n turns are at most n', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 1]));
    const turns = order(fight, 3, RULES);
    expect(turns).toHaveLength(3);
    expect(turns[0]!.row).toBe(body(fight, 'A'));
  });

  test('a row that joins with a higher tie at the time of the turn under way does not take that turn: the current row stays first, in the round of now', () => {
    const fight = running(play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 1])));
    const joined = running(reduce(fight, { type: 'add', fightId: fightId('f-1'), rows: [row('J', 'foe')], openings: [{ id: id('J'), d20: 20, tie: 999 }] }, ctx).fight!);
    const j = body(joined, 'J'), cur = body(joined, joined.currentId);
    expect([j.at, j.tie > cur.tie]).toEqual([cur.at, true]);
    const turns = order(joined, 3, RULES);
    expect(turns[0]!.row.id).toBe(joined.currentId);
    expect([turns[0]!.at, turns[0]!.round]).toEqual([joined.now, 1]);
    expect(turns.map(t => t.row.id)).toContain(id('J'));
  });

  test('a monster at 0 and a dying hunter take no turns, so the order leaves them out', () => {
    const fight = play(add(row('A', 'party'), row('B', 'party'), row('M1', 'foe'), row('M2', 'foe')),
      start(['A', 20], ['B', 20], ['M1', 20], ['M2', 20]), adjust('B', -999), adjust('M2', -999));
    expect(new Set(order(fight, 8, RULES).map(t => t.row.id))).toEqual(new Set([id('A'), id('M1')]));
  });
});

describe('cardOf: what a combatant\'s card shows', () => {
  test('after a hit of 10 against light armor the monster\'s card shows 9 HP gone, and the striker\'s its 8 fatigue, against the sheet\'s maxima', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]),
      { type: 'act', by: id('A'), ability: HIT.id, aim: id('M'), rolls: rolls({ M: 10 }) });
    const m = cardOf(fight, body(fight, 'M'), RULES), a = cardOf(fight, body(fight, 'A'), RULES);
    expect([m.hpMax - m.hp, m.hpMax, m.down]).toEqual([9, body(fight, 'M').sheet.hpMax, false]);
    expect([a.fatigue, a.fatigueMax, a.mana, a.manaMax]).toEqual([8, body(fight, 'A').sheet.fatigueMax, 10, body(fight, 'A').sheet.manaMax]);
  });

  test('a shield shows its amount until its end, then none', () => {
    const shielded = row('B', 'party', { shield: { amount: 12, until: tick(1500) } });
    const setup = play(add(row('A', 'party'), shielded, row('M', 'foe')));
    expect(cardOf(setup, body(setup, 'B'), RULES).shield).toBe(12);
    const later = running(play(add(row('A', 'party'), shielded, row('M', 'foe')), start(['A', 20], ['B', 20], ['M', 20]),
      pass('A'), pass('B'), pass('M'), pass('A'), pass('B'), pass('M')));
    expect(later.now).toBe(tick(2000));
    expect(cardOf(later, body(later, 'B'), RULES).shield).toBeNull();
  });

  test('statuses show the rounds left in tenths, rounded up as every time left is: 1340 ticks is 1.4 rounds, 0.4 a round later, and a status with no end shows none', () => {
    const grant = (key: string, duration: number | null): Command =>
      ({ type: 'status', id: id('A'), add: { key: statusKey(key), def: st(key, { op: 'note', text: key }), duration: duration === null ? null : tick(duration), tier: 0 } });
    const setup = play(add(row('A', 'party'), row('M', 'foe')), grant('marked', 1340), grant('blessed', null));
    expect(cardOf(setup, body(setup, 'A'), RULES).statuses.map(s => [s.key, s.rounds])).toEqual([['marked', 1.4], ['blessed', null]]);
    const later = play(add(row('A', 'party'), row('M', 'foe')), grant('marked', 1340), grant('blessed', null), start(['A', 20], ['M', 20]), pass('A'), pass('M'));
    expect(running(later).now).toBe(tick(1000));
    expect(cardOf(later, body(later, 'A'), RULES).statuses.map(s => [s.key, s.rounds])).toEqual([['marked', 0.4], ['blessed', null]]);
  });

  test('a weak hit of 9 fills a stagger bar 1.5 times, and the card shows 13.5 as 14 of 100', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe', { stagger: { fill: 0, max: 100, hit: 30 } })), start(['A', 20], ['M', 10]),
      { type: 'act', by: id('A'), ability: HIT.id, aim: id('M'), rolls: rolls({ M: 10 }) });
    expect(cardOf(fight, body(fight, 'M'), RULES).stagger).toEqual({ fill: 14, max: 100, staggered: null });
    expect(cardOf(fight, body(fight, 'A'), RULES).stagger).toBeNull();
  });

  test('the card of the row whose turn it is says so, and every card shows its row\'s speed and its sheet\'s armor, resist and stride', () => {
    const fight = running(play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10])));
    for (const n of ['A', 'M']) {
      const b = body(fight, n), k = cardOf(fight, b, RULES);
      expect(k.turn).toBe(b.id === fight.currentId);
      expect([k.speed, k.armor, k.resist, k.stride]).toEqual([b.speed, b.sheet.armor, b.sheet.resist, b.sheet.stride]);
    }
    const setup = play(add(row('A', 'party'), row('M', 'foe')));
    expect(cardOf(setup, body(setup, 'A'), RULES).turn).toBe(false);
  });

  test('a monster at 0 and a dying hunter are down on their cards', () => {
    const fight = play(add(row('A', 'party'), row('B', 'party'), row('M1', 'foe'), row('M2', 'foe')),
      start(['A', 20], ['B', 20], ['M1', 20], ['M2', 20]), adjust('B', -999), adjust('M2', -999));
    expect(['A', 'B', 'M1', 'M2'].map(n => cardOf(fight, body(fight, n), RULES).down)).toEqual([false, true, false, true]);
  });
});

describe('aims: whom an ability can aim at', () => {
  test('a strike lists the foes on the map nearest first, by the 5-10-5 distance, in range only beside its user', () => {
    const spots = [spot('A', 'party', 5, 5), spot('B', 'party', 4, 5), spot('Far', 'foe', 8, 9), spot('Near', 'foe', 6, 6),
      spot('Two', 'foe', 5, 3), spot('Gone', 'foe', 5, 6, { down: true })];
    const list = aims(spots, id('A'), STRIKE, GRID);
    expect(list.map(a => [a.target.name, a.dist, a.inRange, a.inShape])).toEqual([['Near', 1, true, true], ['Two', 2, false, true], ['Far', 5, false, true]]);
  });

  test('a player\'s phone aims over the room doc\'s rows as the GM\'s phone does over the fight\'s', () => {
    const spots = [spot('A', 'party', 5, 5), spot('Near', 'foe', 6, 6), spot('Far', 'foe', 8, 9)];
    const wire = spots.map(s => ({ ...s, place: { x: s.place.x, y: s.place.y }, band: 'healthy' }));
    const fromDoc = aims(docSpots(wire), id('A'), STRIKE, GRID);
    expect(fromDoc.map(a => [a.target.name, a.target.band, a.dist, a.inRange])).toEqual(aims(spots, id('A'), STRIKE, GRID).map(a => [a.target.name, 'healthy', a.dist, a.inRange]));
  });

  test('a shot that does not pierce hits the first foe on its line, so the one behind is out of its shape; a piercing one reaches both', () => {
    const spots = [spot('A', 'party', 0, 0), spot('Ally', 'party', 0, 1), spot('M1', 'foe', 0, 3), spot('M2', 'foe', 0, 6)];
    const shot = ability('shot');
    expect(aims(spots, id('A'), shot, GRID).map(a => [a.target.id, a.inShape])).toEqual([['M1', true], ['M2', false]]);
    const pierce = { ...shot, shape: { kind: 'line', width: tiles(0), pierce: true } } as const;
    expect(aims(spots, id('A'), pierce, GRID).map(a => a.inShape)).toEqual([true, true]);
    const notFoesOnly = { ...shot, foesOnly: false };
    expect(aims(spots, id('A'), notFoesOnly, GRID).map(a => a.inShape)).toEqual([false, false]);
  });

  test('a wall stops a line: a foe behind it is in range but out of the shape', () => {
    const spots = [spot('A', 'party', 0, 0), spot('M', 'foe', 0, 4)];
    const [m] = aims(spots, id('A'), ability('shot'), walled(5, 5, [[0, 2]]));
    expect([m!.dist, m!.inRange, m!.inShape]).toEqual([4, true, false]);
  });

  test('a blast aimed at a place lists only the other side, each in its own shape', () => {
    const spots = [spot('A', 'party', 0, 0), spot('B', 'party', 1, 0), spot('M', 'foe', 0, 9)];
    expect(aims(spots, id('A'), ability('blast'), GRID).map(a => [a.target.id, a.dist, a.inRange, a.inShape])).toEqual([['M', 9, true, true]]);
  });

  test('a self ability offers only its user, at distance 0', () => {
    const spots = [spot('A', 'party', 3, 3), spot('B', 'party', 4, 3), spot('M', 'foe', 3, 5)];
    const self = { ...ability('support'), aim: 'self' } as const;
    expect(aims(spots, id('A'), self, GRID).map(a => [a.target.id, a.dist, a.inRange, a.inShape])).toEqual([['A', 0, true, true]]);
  });

  test('an ally ability offers its user\'s side on the map, a dying hunter among them, and no shadow gone at 0 nor any foe', () => {
    const spots = [spot('A', 'party', 0, 0), spot('Dying', 'party', 2, 0, { down: true }), spot('Shade', 'party', 1, 0, { kind: 'shadow', down: true }),
      spot('Far', 'party', 9, 0), spot('M', 'foe', 1, 1)];
    expect(aims(spots, id('A'), ability('support'), GRID).map(a => [a.target.id, a.dist, a.inRange])).toEqual([['A', 0, true], ['Dying', 2, true], ['Far', 9, false]]);
  });

  test('an unknown user has nothing to aim at', () => {
    expect(aims([spot('M', 'foe', 0, 0)], id('A'), STRIKE, GRID)).toEqual([]);
  });

});

describe('the move control: a step toward or away from a picked body', () => {
  test('toward a far foe, a full stride of 3 brings the user 3 rows nearer, the lowest x winning a tie of steps and row', () => {
    const spots = [spot('A', 'party', 2, 2), spot('M', 'foe', 2, 10)];
    expect(stepToward(spots, id('A'), id('M'), tiles(3), GRID)).toEqual({ place: place(1, 5), steps: tiles(3) });
  });

  test('toward stops beside the target, short of a full stride', () => {
    const spots = [spot('A', 'party', 0, 2), spot('M', 'foe', 0, 4)];
    expect(stepToward(spots, id('A'), id('M'), tiles(3), GRID)).toEqual({ place: place(0, 3), steps: tiles(1) });
  });

  test('beside the target already, or rooted with a stride of 0, toward offers no step', () => {
    expect(stepToward([spot('A', 'party', 0, 2), spot('M', 'foe', 1, 3)], id('A'), id('M'), tiles(3), GRID)).toBeNull();
    expect(stepToward([spot('A', 'party', 0, 2), spot('M', 'foe', 0, 9)], id('A'), id('M'), tiles(0), GRID)).toBeNull();
  });

  test('toward walks round a body in the way, and a monster gone at 0 is in nobody\'s way', () => {
    const blocked = [spot('A', 'party', 0, 2), spot('B', 'party', 0, 3), spot('M', 'foe', 0, 6)];
    expect(stepToward(blocked, id('A'), id('M'), tiles(3), GRID)).toEqual({ place: place(1, 5), steps: tiles(3) });
    const gone = [spot('A', 'party', 0, 2), spot('X', 'foe', 0, 3, { down: true }), spot('M', 'foe', 0, 6)];
    expect(stepToward(gone, id('A'), id('M'), tiles(3), GRID)).toEqual({ place: place(0, 5), steps: tiles(3) });
  });

  test('away from a foe beside it, a full stride ends 4 tiles off, the lowest row then the lowest x winning the tie', () => {
    const spots = [spot('A', 'party', 5, 5), spot('M', 'foe', 5, 6)];
    expect(stepAway(spots, id('A'), id('M'), tiles(3), GRID)).toEqual({ place: place(4, 2), steps: tiles(3) });
  });

  test('boxed into a corner, away offers no step', () => {
    const spots = [spot('A', 'party', 0, 0), spot('B', 'party', 1, 0), spot('C', 'party', 0, 1), spot('M', 'foe', 1, 1)];
    expect(stepAway(spots, id('A'), id('M'), tiles(3), GRID)).toBeNull();
  });

  test('the toward step is a move the fight takes: the hunter stands on that tile and waits 50 hundredths of a turn for 3 tiles (4.6)', () => {
    const fight = running(play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 1])));
    const a = body(fight, 'A'), step = stepToward(fight.rows.map(spotOf), a.id, id('M'), a.sheet.stride, fight.grid)!;
    expect(step.steps).toBe(tiles(3));
    const r = reduce(fight, { type: 'move', by: a.id, to: step.place }, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    expect([body(r.fight!, 'A').place, body(r.fight!, 'A').at]).toEqual([step.place, tick(500)]);
  });
});

describe('readyIn: when an ability on cooldown is ready again', () => {
  // A round is RULES.fight.round ticks (design 1.2); a cooldown of 2 rounds used at 3000 is ready at 3000 + 2 rounds.
  const round = RULES.fight.round, used = tick(3000), readyAt = { slam: tick(used + 2 * round) };

  test('right after the use it waits its whole cooldown, then counts down by the share of a round gone', () => {
    expect(readyIn(readyAt, 'slam', used, RULES)).toBe(2);
    expect(readyIn(readyAt, 'slam', tick(used + round / 2), RULES)).toBe(1.5);
  });

  test('a wait under a tenth of a round still reads a tenth, never 0, until it is ready', () => {
    expect(readyIn(readyAt, 'slam', tick(used + 2 * round - 1), RULES)).toBe(0.1);
    expect(readyIn(readyAt, 'slam', tick(used + 2 * round), RULES)).toBe(0);
  });

  test('an ability never used, or one with no cooldown, is ready', () => {
    expect(readyIn(readyAt, 'hit', used, RULES)).toBe(0);
    expect(readyIn({ hit: used }, 'hit', used, RULES)).toBe(0);
  });
});

describe('the Status window', () => {
  test('a status the GM puts on for 2 rounds lasts 2 rounds of the rules (2 x round ticks), and one with no rounds until removed', () => {
    const def = st('Marked');
    expect(statusGrant('marked', def, 2, 3, RULES)).toEqual({ key: statusKey('marked'), def, duration: tick(2 * RULES.fight.round), tier: 3 });
    expect(statusGrant('marked', def, null, 0, RULES).duration).toBeNull();
    const fight = running(play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 1])));
    const r = reduce(fight, { type: 'status', id: id('M'), add: statusGrant('marked', def, 2, 0, RULES) }, ctx);
    expect(cardOf(r.fight!, body(r.fight!, 'M'), RULES).statuses.map(s => [s.key, s.rounds])).toEqual([['marked', 2]]);
  });
});

describe('the extras on a card (design 4)', () => {
  const growing = (growth: 'linear' | 'exponential'): Ability => ({ ...HIT, id: abilityId(`charge-${growth}`), name: `Charge ${growth}`, channel: { growth, max: 5 } });
  test('a channel shows its charge of its max and its payoff: 1 + 0.5 a charge linear, 1.45 to the charge exponential', () => {
    for (const [growth, factor] of [['linear', 1 + RULES.fight.channelLin * 3], ['exponential', Math.round(RULES.fight.channelExp ** 3 * 100) / 100]] as const) {
      const a = growing(growth), fight = play(add(row('A', 'party', { abilities: [a], channel: { ability: a.id, aim: id('M'), charge: 3, spent: 0, state: 'holding' } }), row('M', 'foe')));
      expect(cardOf(fight, body(fight, 'A'), RULES).channel).toEqual({ ability: a.id, name: a.name, charge: 3, max: 5, state: 'holding', factor });
    }
  });

  test('an intent shows its name and aim with no numbers until the GM reveals it; then its formula, its range and, as it travels, that moving out avoids it', () => {
    const set = play(add(row('A', 'party'), row('M', 'foe')), { type: 'setIntent', by: id('M'), ability: HIT.id, aim: id('A') });
    expect(cardOf(set, body(set, 'M'), RULES).intent).toMatchObject({ name: 'hit', target: id('A'), revealed: false, lines: [], channel: null });
    const shown = play(add(row('A', 'party'), row('M', 'foe')), { type: 'setIntent', by: id('M'), ability: HIT.id, aim: id('A') }, { type: 'reveal', by: id('M') });
    expect(cardOf(shown, body(shown, 'M'), RULES).intent?.lines).toEqual(['Physical damage 10', 'Range 20 tiles', 'Avoided by moving out of it']);
  });

  test('a monster that holds a channel shows the channel as its intent, at its charge', () => {
    const a = growing('exponential');
    const fight = play(add(row('A', 'party'), row('M', 'foe', { abilities: [a], channel: { ability: a.id, aim: id('A'), charge: 2, spent: 0, state: 'holding' } })));
    expect(cardOf(fight, body(fight, 'M'), RULES).intent).toMatchObject({ name: a.name, target: id('A'), revealed: false, channel: { charge: 2 } });
  });

  test('threat suggests the highest entry of those still up, with each share in whole percent; a taunt suggests the taunter', () => {
    const taunt = statusOn(st('Taunted', { op: 'taunt' }), { key: statusKey('taunted'), source: { id: id('B'), tier: 0 }, until: tick(1500), since: tick(0), settledAt: tick(0) });
    const fight = play(add(row('A', 'party'), row('B', 'party'), row('C', 'party'), row('M', 'foe', { threat: { [id('A')]: 30, [id('B')]: 10, [id('C')]: 60 } })), adjust('C', -999));
    expect(cardOf(fight, body(fight, 'M'), RULES).threat).toEqual({ suggest: id('A'), shares: [{ id: id('A'), share: 75 }, { id: id('B'), share: 25 }] });
    const taunted = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe', { threat: { [id('A')]: 30, [id('B')]: 10 }, statuses: [taunt] })));
    const k = cardOf(taunted, body(taunted, 'M'), RULES);
    expect([k.threat?.suggest, k.taunt]).toEqual([id('B'), { by: id('B'), left: 1.5 }]);
  });

  test('a shield shows its rounds left; a broken stagger bar says Staggered and the rounds it costs until the monster\'s turn comes', () => {
    const shielded = play(add(row('A', 'party', { shield: { amount: 12, until: tick(1500) } }), row('M', 'foe')));
    expect(cardOf(shielded, body(shielded, 'A'), RULES).shieldLeft).toBe(1.5);
    const broke = play(add(row('A', 'party'), row('M', 'foe', { stagger: { fill: 0, max: 8, hit: 20 } })), start(['A', 20], ['M', 10]),
      { type: 'act', by: id('A'), ability: HIT.id, aim: id('M'), rolls: rolls({ M: 10 }) });
    expect(cardOf(broke, body(broke, 'M'), RULES).stagger?.staggered).toBe(RULES.fight.staggerCost);
  });
});
