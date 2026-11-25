// The fight screen's model: the order ahead, a card, the targets an ability can aim at and the move control's steps.
// Expected numbers come from the rules: the interval and opening of design 1.2, armor (rule 12), a weak hit's stagger
// (4.3), rounds left in tenths, the 5-10-5 distance and the walk of 4.6, and the tie rule of 3.1 rule 8a (fewest steps,
// lowest y, then x). Aims read rules 5 and 6 from resolve.ts, so they are tested only by what they return.
import { fightId } from '../src/core/ids.ts';
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
import { reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow, Opening, Running } from '../src/core/combat/fight.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { aims, answersBy, cardOf, docSpots, mythicHand, mythicSeenOfDoc, mythicStrip, omenBanner, omenOnYou, order, readyIn, spotOf, statusGrant, stepAway, stepToward, waitChoices } from '../src/core/combat/fight-view.ts';
import type { MythicSeen } from '../src/core/combat/fight-view.ts';
import { ANSWERS, answerOutcome } from '../src/core/combat/mythic.ts';
import type { MythicScriptId, Omen, OmenKey } from '../src/core/combat/mythic-types.ts';
import { MYTHICS, bandOf, mythicScriptOf, omensOf } from '../src/core/registry/mythics.ts';
import { lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';

const ctx: Ctx = { rules: RULES };
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
function row(name: string, side: Side, o: RowPatch<NewRow> = {}): NewRow {
  const { kind: k, hp, ...rest } = o;
  const hpMax = modified(hunterOrigin, o.statuses ?? [], RULES).sheet.hpMax, kind = k ?? (side === 'party' ? 'hunter' : 'monster');
  // a row of `kind` with that kind's own fields (effect-ops.ts `Body`); a patch that names a summon gives its owner and end
  return {
    id: id(name), name, side, ...lifeAt(kind, hp ?? hpMax), origin: hunterOrigin, tier: 0, place: null, mana: 10, fatigue: 0, shield: null, stagger: null,
    channel: null, threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: [HIT, STRIKE], intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0, mythic: null, ...rest,
  } as NewRow;
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

  test('a monster at 0 and a dead hunter take no turns, so the order leaves them out', () => {
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

  test('a monster at 0 and a dead hunter are down on their cards', () => {
    const fight = play(add(row('A', 'party'), row('B', 'party'), row('M1', 'foe'), row('M2', 'foe')),
      start(['A', 20], ['B', 20], ['M1', 20], ['M2', 20]), adjust('B', -999), adjust('M2', -999));
    expect(['A', 'B', 'M1', 'M2'].map(n => cardOf(fight, body(fight, n), RULES).down)).toEqual([false, true, false, true]);
  });

  test('a card shows its side\'s weight plus its own, and the row\'s forced next roll', () => {
    const side = (n: number): Command => ({ type: 'fudge', set: { kind: 'weight', scope: { kind: 'side', side: 'party' }, n } });
    const own = (who: string, n: number): Command => ({ type: 'fudge', set: { kind: 'weight', scope: { kind: 'row', id: id(who) }, n } });
    const fight = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 19], ['M', 1]), side(2), own('B', 1), { type: 'fudge', set: { kind: 'force', id: id('M'), face: 20 } });
    const [a, b, m] = ['A', 'B', 'M'].map(n => cardOf(fight, body(fight, n), RULES));
    expect([a!.fudge, b!.fudge, m!.fudge]).toEqual([2, 3, 0]);
    expect([a!.fudgeOwn, b!.fudgeOwn, m!.fudgeOwn]).toEqual([0, 1, 0]);
    expect([a!.forced, m!.forced]).toEqual([null, 20]);
  });

  test('a fight that is over, or one with no weight set, shows no weight and no forced roll', () => {
    const fresh = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 1]));
    expect(cardOf(fresh, body(fresh, 'A'), RULES)).toMatchObject({ fudge: 0, fudgeOwn: 0, forced: null });
    const over = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 1]), { type: 'fudge', set: { kind: 'force', id: id('A'), face: 1 } }, { type: 'end' });
    expect(cardOf(over, body(over, 'A'), RULES)).toMatchObject({ fudge: 0, fudgeOwn: 0, forced: null });
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
    const wire = spots.map(({ down: _, ...s }) => ({ ...s, place: { x: s.place.x, y: s.place.y }, band: 'healthy', life: { at: 'up' as const } }));
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

  test('an ally ability offers its user\'s side that is up, leaving out a dead hunter, a shadow gone at 0 and any foe', () => {
    const spots = [spot('A', 'party', 0, 0), spot('Dead', 'party', 2, 0, { down: true }), spot('Shade', 'party', 1, 0, { kind: 'shadow', down: true }),
      spot('Far', 'party', 9, 0), spot('M', 'foe', 1, 1)];
    expect(aims(spots, id('A'), ability('support'), GRID).map(a => [a.target.id, a.dist, a.inRange])).toEqual([['A', 0, true], ['Far', 9, false]]);
  });

  test('a foe ability and a self ability leave out a dead hunter as well', () => {
    const spots = [spot('A', 'party', 0, 0), spot('DeadFoe', 'foe', 1, 0, { kind: 'hunter', down: true }), spot('LiveFoe', 'foe', 1, 1)];
    expect(aims(spots, id('A'), STRIKE, GRID).map(a => a.target.id)).toEqual(['LiveFoe']);
    const self = { ...ability('support'), aim: 'self' } as const;
    expect(aims([spot('Dead', 'party', 0, 0, { down: true })], id('Dead'), self, GRID)).toEqual([]);
  });

  test('an unknown user has nothing to aim at', () => {
    expect(aims([spot('M', 'foe', 0, 0)], id('A'), STRIKE, GRID)).toEqual([]);
  });

  test('a swap excludes its user, and a shadow swap offers only allied shadows', () => {
    const spots = [spot('A', 'party', 0, 0), spot('Ally', 'party', 2, 0), spot('Shade', 'party', 4, 0, { kind: 'shadow' }), spot('M', 'foe', 1, 0)];
    const swap = { ...ability('support'), move: { kind: 'swap' } } as const;
    const shadowSwap = { ...ability('support'), move: { kind: 'swap', only: 'shadow' } } as const;
    expect(aims(spots, id('A'), swap, GRID).map(a => a.target.id)).toEqual(['Ally', 'Shade']);
    expect(aims(spots, id('A'), shadowSwap, GRID).map(a => a.target.id)).toEqual(['Shade']);
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

describe('waitChoices: the rows a reaction before a turn may wait for', () => {
  // Audit BUG-views-2: a player's phone armed a reaction before a turn with no row, and the fight refuses that one
  // (`noTarget`, fight.ts `arm`). Kits design 8.4: such a reaction names the row whose turn it fires before. The GM's card
  // and a player's phone offer the same rows; an arm that names none waits for the first.
  const waiting = (name: string, side: Side, down = false) => ({ id: id(name), name, side, down });
  const rows = [waiting('Kai', 'party'), waiting('Mira', 'party'), waiting('Wolf', 'foe', true), waiting('Ogre', 'foe'), waiting('Imp', 'foe')];

  test('every other row is offered, the other side\'s rows still up first, each part in the order given', () => {
    expect(waitChoices(rows, id('Kai')).map(r => r.name)).toEqual(['Ogre', 'Imp', 'Mira', 'Wolf']);
    expect(waitChoices(rows, id('Ogre')).map(r => r.name)).toEqual(['Kai', 'Mira', 'Wolf', 'Imp']);
  });

  test('with no other side up, the first other row is the one it waits for; alone, there is none', () => {
    const won = [waiting('Kai', 'party'), waiting('Mira', 'party'), waiting('Wolf', 'foe', true)];
    expect(waitChoices(won, id('Kai')).map(r => r.name)).toEqual(['Mira', 'Wolf']);
    expect(waitChoices([waiting('Kai', 'party')], id('Kai'))).toEqual([]);
  });

  test('a player\'s phone reads the room doc\'s rows and the GM\'s phone the fight\'s, and both wait on the same row', () => {
    const fight = play(add(row('Kai', 'party'), row('Ogre', 'foe', { hp: 0 }), row('Imp', 'foe')));
    const doc = [spot('Kai', 'party', 0, 0), spot('Ogre', 'foe', 3, 0, { down: true }), spot('Imp', 'foe', 4, 0)];
    expect(waitChoices(fight.rows.map(spotOf), id('Kai')).map(s => s.id)).toEqual([id('Imp'), id('Ogre')]);
    expect(waitChoices(doc, id('Kai')).map(s => s.id)).toEqual([id('Imp'), id('Ogre')]);
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

describe('a mythic on the table (notes-11-keystones.md B.5, unit MY7)', () => {
  const R = RULES;
  const seen = (script: MythicScriptId, o: Partial<MythicSeen> = {}): MythicSeen => ({
    id: id('Boss'), name: 'Boss', script, phase: 0, beat: 1, since: tick(0), omen: null, hp: { hp: 580, hpMax: 1000 }, bandWord: null, held: false, ...o,
  });
  const names = [{ id: id('Mira'), name: 'Mira' }, { id: id('Boss'), name: 'Boss' }];
  const answersOf = (script: MythicScriptId, key: string) => mythicScriptOf(script).omens[key as OmenKey]!;
  /** The answers of an omen that do something: each non-none outcome of the five kinds, a weaken only where a weak move exists. */
  const live = (o: Omen) => ANSWERS.filter(a => { const w = answerOutcome(o, a); return w === 'cancel' || (w === 'weaken' && o.weak !== null); });

  test('the banner lists each answer of the omen in plain words', () => {
    for (const id0 of Object.keys(MYTHICS) as MythicScriptId[]) {
      for (const [key, o] of omensOf(mythicScriptOf(id0))) {
        const b = omenBanner(seen(id0, { omen: { key, faltering: false, aim: id('Mira') } }), names, tick(0), R)!;
        const outcomes = b.answers.filter(l => l.endsWith('cancels it') || l.endsWith('weakens it'));
        expect(outcomes).toHaveLength(live(o).length);
        expect(b.answerHead).toBe('How to counter it:');
        const inPhase = mythicScriptOf(id0).phases[0]!.rotation.some(x => x.kind === 'omen' && x.omen === key);
        const inDoom = mythicScriptOf(id0).enraged.some(x => x.kind === 'omen' && x.omen === key);
        expect(b.title).toBe(`${inDoom && !inPhase ? 'DOOM' : 'OMEN'}: ${o.name}`);
        for (const a of live(o)) expect(b.answers.some(l => l.endsWith(answerOutcome(o, a) === 'cancel' ? 'cancels it' : 'weakens it'))).toBe(true);
      }
    }
  });
  test('the banner says on whom, in which tiles and when', () => {
    const weighed = seen('angel-of-the-last-trumpet', { omen: { key: 'weighed' as OmenKey, faltering: false, aim: id('Mira') } });
    expect(omenBanner(weighed, names, tick(0), R)!.when).toBe('Lands on its next turn, on Mira.');
    const stars = seen('angel-of-the-last-trumpet', { omen: { key: 'stars' as OmenKey, faltering: false, aim: { x: 3, y: 4 } } });
    expect(omenBanner(stars, names, tick(0), R)!.when).toBe('Lands on its next turn, on the marked tiles.');
    const note = seen('angel-of-the-last-trumpet', { omen: { key: 'note' as OmenKey, faltering: false, aim: id('Boss') } });
    expect(omenBanner(note, names, tick(0), R)!.when).toBe('Lands on its next turn, on everyone.');
    const hidden = seen('angel-of-the-last-trumpet', { omen: { key: 'weighed' as OmenKey, faltering: false, aim: null } });
    expect(omenBanner(hidden, names, tick(0), R)!.when).toBe('Lands on its next turn, on someone you cannot see.');
  });
  test('a weakened omen names the move that lands and offers no second weaken', () => {
    const script = mythicScriptOf('angel-of-the-last-trumpet'), o = script.omens['breath' as OmenKey]!;
    const m = seen('angel-of-the-last-trumpet', { omen: { key: 'breath' as OmenKey, faltering: true, aim: id('Boss') } });
    const b = omenBanner(m, names, tick(0), R)!;
    expect(b.title).toBe(`OMEN, WEAKENED: ${o.name}`);
    expect(b.when).toBe(`Lands as ${script.moves[o.weak!]!.name} on its next turn, on the tiles around it.`);
    expect(b.answers.some(l => l.endsWith('weakens it'))).toBe(false);
  });
  test('an omen of the enraged rotation reads as a doom', () => {
    const script = mythicScriptOf('angel-of-the-last-trumpet'), beat = script.enraged[0]!;
    if (beat.kind !== 'omen') throw new Error('the Angel enrages into an omen');
    const late = tick(Math.round(R.fight.round * (script.phases[0]!.clock + 1)));
    const m = seen('angel-of-the-last-trumpet', { omen: { key: beat.omen, faltering: false, aim: id('Boss') } });
    expect(omenBanner(m, names, late, R)!.title).toBe(`DOOM: ${script.omens[beat.omen]!.name}`);
  });
  test('Cannot be dodged or resisted on a sure move, and a blast says to step out of its tiles', () => {
    const sure = omenBanner(seen('angel-of-the-last-trumpet', { omen: { key: 'note' as OmenKey, faltering: false, aim: id('Boss') } }), names, tick(0), R)!;
    expect(sure.answers).toContain('Cannot be dodged or resisted.');
    const blast = omenBanner(seen('angel-of-the-last-trumpet', { omen: { key: 'stars' as OmenKey, faltering: false, aim: { x: 1, y: 1 } } }), names, tick(0), R)!;
    expect(blast.answers).toContain('Step out of the marked tiles to dodge it.');
  });

  test('the strip counts the clock down', () => {
    const script = mythicScriptOf('angel-of-the-last-trumpet'), clock = script.phases[0]!.clock, round = R.fight.round;
    const at = (rounds: number) => mythicStrip(seen('angel-of-the-last-trumpet'), tick(round * rounds), R);
    expect(at(0).clock).toBe(`Clock: ${clock} rounds left`);
    expect(at(clock - 1).clock).toBe('Clock: 1 round left');
    expect(at(0).phase).toBe(`Phase 1 of ${script.phases.length}: ${script.phases[0]!.name}`);
    expect(at(0).hp).toBe(`HP 58% · next phase at ${Math.round(bandOf(script, 0).gate * 100)}% HP`);
  });
  test('the strip says held at the gate and what its next turn does', () => {
    const script = mythicScriptOf('angel-of-the-last-trumpet');
    const s = mythicStrip(seen('angel-of-the-last-trumpet', { held: true, hp: { hp: 650, hpMax: 1000 } }), tick(0), R);
    expect(s.hp).toBe('HP 65% · HP locked until next phase');
    expect(s.clock).toBe(`Phase 2 (${script.phases[1]!.name}) starts on its next turn.`);
  });
  test('the strip says enraged once a gate phase runs past its clock, and names the doom', () => {
    const script = mythicScriptOf('angel-of-the-last-trumpet'), late = tick(R.fight.round * (script.phases[0]!.clock + 1));
    const s = mythicStrip(seen('angel-of-the-last-trumpet'), late, R);
    expect(s.mark).toBe('enraged');
    expect(s.clock).toBe(`Enraged: ${script.omens['note' as OmenKey]!.name} every other turn.`);
  });
  test('a clock phase says immune to damage and counts the rounds to survive', () => {
    const script = mythicScriptOf('zaratan-the-island-that-wakes'), dive = script.phases[1]!;
    const s = mythicStrip(seen('zaratan-the-island-that-wakes', { phase: 1, beat: 0 }), tick(0), R);
    expect(s.hp).toBe('HP 58% · immune to damage');
    expect(s.clock).toBe(`Survive ${dive.clock} more rounds.`);
    expect(s.note).toBe(dive.line);
  });
  test('the last phase says so, and a table that does not know the HP says the band', () => {
    const script = mythicScriptOf('angel-of-the-last-trumpet');
    const s = mythicStrip(seen('angel-of-the-last-trumpet', { phase: script.phases.length - 1, hp: null, bandWord: 'Bloodied' }), tick(0), R);
    expect(s.hp).toBe('Bloodied · last phase');
    expect(s.share).toBeNull();
  });
  test('the phase\'s own line shows until the mythic\'s next turn', () => {
    expect(mythicStrip(seen('angel-of-the-last-trumpet', { beat: 0 }), tick(0), R).note).toBe(mythicScriptOf('angel-of-the-last-trumpet').phases[0]!.line);
    expect(mythicStrip(seen('angel-of-the-last-trumpet', { beat: 1 }), tick(0), R).note).toBeNull();
  });

  test('a hunter in the marked tiles, or named by the omen, reads it on its own card', () => {
    const stars = seen('angel-of-the-last-trumpet', { omen: { key: 'stars' as OmenKey, faltering: false, aim: { x: 5, y: 5 } } });
    expect(omenOnYou(stars, id('Mira'), { x: 6, y: 5 }, R)).toBe('You are in the marked tiles.');
    expect(omenOnYou(stars, id('Mira'), { x: 20, y: 5 }, R)).toBeNull();
    const breath = seen('angel-of-the-last-trumpet', { place: { x: 4, y: 2 }, omen: { key: 'breath' as OmenKey, faltering: false, aim: id('Boss') } });
    expect(omenOnYou(breath, id('Mira'), { x: 3, y: 2 }, R)).toBe('You are in the marked tiles.');
    expect(omenOnYou(breath, id('Mira'), { x: 20, y: 2 }, R)).toBeNull();
    const weighed = seen('angel-of-the-last-trumpet', { omen: { key: 'weighed' as OmenKey, faltering: false, aim: id('Mira') } });
    expect(omenOnYou(weighed, id('Mira'), { x: 1, y: 1 }, R)).toBe('Weighed and Found Wanting is aimed at you.');
    expect(omenOnYou(weighed, id('Ren'), { x: 1, y: 1 }, R)).toBeNull();
  });
  test('an ability that stuns or shields answers the omen its data says it answers', () => {
    const stun = ability('strike', 'bash', { ops: [{ op: 'applyStatus', key: statusKey('stun'), def: st('stun', { op: 'hold' }), duration: null }] });
    const shield = ability('support', 'ward', { ops: [{ op: 'shield', amount: 5, rounds: 2 } as unknown as Op & { op: 'shield' }] });
    const breath = seen('angel-of-the-last-trumpet', { omen: { key: 'breath' as OmenKey, faltering: false, aim: id('Boss') } });
    const weighed = seen('angel-of-the-last-trumpet', { omen: { key: 'weighed' as OmenKey, faltering: false, aim: id('Mira') } });
    expect(answersBy(stun, breath)).toBe('weakens it');
    expect(answersBy(stun, weighed)).toBeNull();
    expect(answersBy(shield, weighed)).toBe('cancels it');
    expect(answersBy(HIT, breath)).toBeNull();
  });
  test('the doc\'s standing and the GM\'s row read to the same words', () => {
    const doc = mythicSeenOfDoc({ id: id('Boss'), name: 'Boss', band: 'bloodied', standing: { state: 'omen', script: 'angel-of-the-last-trumpet' as MythicScriptId, phase: 0, beat: 2, since: tick(0), omen: 'weighed' as OmenKey, aim: id('Mira'), band: 'wounded' } }, { bloodied: 'Bloodied' });
    expect(omenBanner(doc!, names, tick(0), R)!.title).toBe('OMEN: Weighed and Found Wanting');
    expect(mythicStrip(doc!, tick(0), R).hp.startsWith('Bloodied')).toBe(true);
    expect(mythicSeenOfDoc({ id: id('Rat'), name: 'Rat', band: 'healthy' }, {})).toBeNull();
  });
});

describe('the GM\'s hand on a mythic (unit MY7)', () => {
  const R = RULES, script = mythicScriptOf('angel-of-the-last-trumpet');
  const seen = (o: Partial<MythicSeen> = {}): MythicSeen => ({ id: id('Boss'), name: 'Boss', script: 'angel-of-the-last-trumpet', phase: 0, beat: 1, since: tick(0), omen: null, hp: { hp: 100, hpMax: 100 }, bandWord: null, held: false, ...o });
  test('on its turn with an omen standing the GM lands it or drops it', () => {
    const h = mythicHand(seen({ omen: { key: 'weighed' as OmenKey, faltering: false, aim: id('Mira') } }));
    expect([h.landTitle, h.land, h.drop]).toEqual([`${script.name}'s turn. The omen lands.`, 'Land Weighed and Found Wanting', 'Drop the omen']);
  });
  test('with no omen standing there is nothing to land or drop, and Next phase asks what its HP drops to', () => {
    const h = mythicHand(seen());
    expect([h.land, h.drop]).toEqual([null, null]);
    expect(h.next).toEqual({ label: 'Next phase', ask: `Move ${script.name} to ${script.phases[1]!.name} now? Its HP drops to ${Math.round((script.phases[1] as { from: number }).from * 100)}%.`, yes: 'Start next phase', no: 'Cancel' });
  });
  test('in the last phase there is no Next phase', () => {
    expect(mythicHand(seen({ phase: script.phases.length - 1 })).next).toBeNull();
  });
  test('on an act beat the strip names the next omen and how many turns away it is', () => {
    const rot = script.phases[0]!.rotation, at = rot.findIndex(b => b.kind === 'omen'), beat = rot[at]!;
    if (beat.kind !== 'omen') throw new Error('an omen beat');
    const name = script.omens[beat.omen]!.name;
    expect(mythicStrip(seen({ beat: at }), tick(0), R).ahead).toBe(`Next omen: ${name}, on its next turn.`);
    if (at > 0) expect(mythicStrip(seen({ beat: 0 }), tick(0), R).ahead).toBe(`Next omen: ${name}, in ${at + 1} turns.`);
    expect(mythicStrip(seen({ omen: { key: beat.omen, faltering: false, aim: id('Mira') } }), tick(0), R).ahead).toBeNull();
  });
});
