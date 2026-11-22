// The fudge on a fight's dice (docs/agent-handoff/features/notes-8-fudge.md section 2, unit 4): the weight of each die
// the GM's phone draws for a use, an opening and a settle (src/core/combat/fudge.ts), drawn by src/core/draws.ts, and a
// forced face spent by the one command that read it (fight.ts `reduce`). Each test draws chosen faces from a source and
// reads what the fight did with them. Every expected face is the rule's: `clamp(face + weight, 1, sides)`, with the
// weight `fudge(helped) − fudge(hindered)` by section 2's table, and a force read as its row's best (or worst) face.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { tiles } from '../src/core/combat/space.ts';
import type { Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import type { Ability, AbilityKind, CombatantId } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, Op, Origin, Status } from '../src/core/combat/effect-ops.ts';
import { fightId, owed, reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Effect, Fight, ForcedFace, FudgeScope, NewRow, Running, Setup } from '../src/core/combat/fight.ts';
import { needs } from '../src/core/combat/resolve.ts';
import type { Aim, Rolls } from '../src/core/combat/resolve.ts';
import { critFacesAgainst } from '../src/core/combat/standing.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { forcesRead, fudgeOf, NO_FUDGE, openingWeights, settleWeights, weightsFor } from '../src/core/combat/fudge.ts';
import { drawNeeds, drawOpenings, drawSettle, NO_WEIGHTS } from '../src/core/draws.ts';
import type { Random } from '../src/core/gates/spawn.ts';
import { lifeAt } from './fixtures/life.ts';

const ctx: Ctx = { rules: RULES };
const id = combatantId;
const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const FAR = { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as const;
const ability = (kind: AbilityKind, name: string, text: string | null, o: Partial<Ability> = {}): Ability => {
  const a = abilityOf(kind, { id: abilityId(name), name }, RULES);
  return { ...a, ...(text ? { effect: { type: a.effect!.type, by: 'hand', formula: f(text) } as Ability['effect'] } : {}), ...o };
};
/** A strike of 10 with no dice: it rolls only its target's reaction d20. */
const HIT = ability('strike', 'hit', '10', FAR);
/** A strike whose damage is two d6. */
const CUT = ability('strike', 'cut', '2d6', FAR);
/** A curse: nothing carries it, so its target resists it with a d20 against the fight's resist DC. */
const HEX = ability('curse', 'hex', '5', FAR);
/** A heal on an ally, sure to land: it rolls no d20. */
const MEND: Ability = { ...ability('support', 'mend', null, FAR), effect: { type: 'heal', by: 'hand', formula: f('2d6') } };
const st = (key: string, ...ops: Op[]): Status =>
  ({ key: statusKey(key), def: { label: key, desc: '', ops }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) });
const origin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };

/** A body of base stats in a light kit, knowing HIT, CUT, HEX and MEND. */
function row(name: string, side: Side, o: Partial<NewRow> = {}): NewRow {
  const kind = side === 'party' ? 'hunter' : 'monster', hpMax = modified(origin, o.statuses ?? [], RULES).sheet.hpMax;
  return {
    id: id(name), name, side, ...lifeAt(kind, hpMax), origin, tier: 0, place: null, mana: 50, fatigue: 0, shield: null, stagger: null, channel: null,
    threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: [HIT, CUT, HEX, MEND], intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0, mythic: null, ...o,
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
const running = (x: Fight | null): Running => { if (x?.phase !== 'running') throw new Error(`not running: ${x?.phase}`); return x; };
const body = (fight: Fight | null, name: string): Body => fight!.rows.find(r => r.id === name)!;
const add = (...rows: NewRow[]): Command => ({ type: 'add', fightId: fightId('f-1'), rows, openings: [] });
const start = (...list: [string, number][]): Command => ({ type: 'start', openings: list.map(([name, d20], tie) => ({ id: id(name), d20, tie })) });
const weigh = (scope: FudgeScope, n: number): Command => ({ type: 'fudge', set: { kind: 'weight', scope, n } });
const party: FudgeScope = { kind: 'side', side: 'party' }, foes: FudgeScope = { kind: 'side', side: 'foe' };
const one = (name: string): FudgeScope => ({ kind: 'row', id: id(name) });
const force = (name: string, face: ForcedFace | null): Command => ({ type: 'fudge', set: { kind: 'force', id: id(name), face } });
/** A and M, A's turn first; `fudge` set on the running fight. */
const aFirst = (o: { a?: Partial<NewRow>; m?: Partial<NewRow> } = {}, ...fudge: Command[]): Running =>
  running(play(add(row('A', 'party', o.a), row('M', 'foe', o.m)), start(['A', 20], ['M', 10]), ...fudge));
/** A and M, M's turn first. */
const mFirst = (o: { a?: Partial<NewRow>; m?: Partial<NewRow> } = {}, ...fudge: Command[]): Running =>
  running(play(add(row('A', 'party', o.a), row('M', 'foe', o.m)), start(['M', 20], ['A', 10]), ...fudge));

/** A source that gives each listed face of its die, in order: `face(n, sides)` falls on `n` of a die of `sides`. */
const face = (n: number, sides = 20): number => (n - 0.5) / sides;
const source = (...list: number[]): Random => () => { const x = list.shift(); if (x === undefined) throw new Error('the source ran out'); return x; };

/** The dice `by`'s use of `a` at `aim` asks for on `g`, drawn from `faces` with the fight's weights, and the command that sends them. */
function use(g: Running, by: string, a: Ability, aim: string, faces: number[], R: Rules = RULES): { rolls: Rolls; cmd: Command } {
  const u = body(g, by), n = needs(a, u, g.rows, id(aim) as Aim, g.grid, g.now, R);
  const rolls = drawNeeds(n, source(...faces), weightsFor(g, u.id, n));
  return { rolls, cmd: { type: 'act', by: u.id, ability: a.id, aim: id(aim), rolls } };
}
/** Every line of the fight's log, newest first. */
const said = (fight: Fight | null): string => fight!.log.map(l => l.text).join('\n');
const crits = (effects: readonly Effect[]): CombatantId[] => effects.flatMap(e => (e.type === 'crit' ? [e.id] : []));
const fudgeOn = (fight: Fight | null) => { if (!fight || fight.phase === 'ended') throw new Error('no fudge'); return fight.fudge; };
/** The fight as the table sees it: everything but the GM's fudge. */
const table = (fight: Fight | null) => { const { fudge: _, ...rest } = running(fight); return rest; };

describe('a reaction d20 helps its target and hinders the user: fudge(target) − fudge(user)', () => {
  test('a hunter at +2 is not crit on the drawn face that crits at 0', () => {
    const at0 = mFirst(), at2 = mFirst({}, weigh(party, 2));
    const cf = critFacesAgainst(body(at0, 'M'), body(at0, 'A'), RULES);
    expect(crits(reduce(at0, use(at0, 'M', HIT, 'A', [face(cf)]).cmd, ctx).effects), 'the drawn face crits at 0').toEqual([id('A')]);
    const u = use(at2, 'M', HIT, 'A', [face(cf)]);
    expect(u.rolls.react[id('A')]).toBe(cf + 2);
    expect(crits(reduce(at2, u.cmd, ctx).effects)).toEqual([]);
  });

  test('a hunter at +2 crits a foe on a drawn face of critFaces + 2', () => {
    const g = aFirst({}, weigh(one('A'), 2)), cf = critFacesAgainst(body(g, 'A'), body(g, 'M'), RULES);
    const u = use(g, 'A', HIT, 'M', [face(cf + 2)]);
    expect(u.rolls.react[id('M')]).toBe(cf);
    expect(crits(reduce(g, u.cmd, ctx).effects)).toEqual([id('M')]);
  });

  test('a party and a foe both at +2 roll as at 0', () => {
    const g = aFirst({}, weigh(party, 2), weigh(foes, 2));
    const n = needs(CUT, body(g, 'A'), g.rows, id('M'), g.grid, g.now, RULES);
    expect(weightsFor(g, id('A'), n)).toEqual({ dice: { [id('M')]: 0 }, react: { [id('M')]: 0 }, refund: -2 });
    const faces = [face(3, 6), face(5, 6), face(9)];
    expect(drawNeeds(n, source(...faces), weightsFor(g, id('A'), n))).toEqual(drawNeeds(n, source(...faces)));
  });

  test('a drawn 19 at +5 is 20 and resists as a natural 20', () => {
    // at a resist DC of 21 only a natural 20 resists (rules.ts `resistDc`)
    const R: Rules = { ...RULES, fight: { ...RULES.fight, resistDc: 21 } }, c: Ctx = { rules: R };
    const at0 = mFirst(), at5 = mFirst({}, weigh(one('A'), 5));
    expect(said(reduce(at0, use(at0, 'M', HEX, 'A', [face(19)], R).cmd, c).fight), 'a 19 at 0 does not resist').not.toContain('resist');
    const u = use(at5, 'M', HEX, 'A', [face(19)], R);
    expect(u.rolls.react[id('A')]).toBe(20);
    expect(said(reduce(at5, u.cmd, c).fight)).toContain('resist');
  });

  test('a drawn 1 at −5 stays 1', () => {
    const g = mFirst({}, weigh(one('A'), -5));
    expect(use(g, 'M', HIT, 'A', [face(1)]).rolls.react[id('A')]).toBe(1);
  });

  test('the edge keeps a weighted die: 7 and 15 at +2, kept high, read 17', () => {
    const braced = st('braced', { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true });
    const g = mFirst({ a: { statuses: [braced] } }, weigh(party, 2));
    const u = use(g, 'M', HIT, 'A', [face(7), face(15)]);
    expect([u.rolls.react[id('A')], u.rolls.second?.[id('A')]]).toEqual([9, 17]);
    // the same fight at 0 with the dice read 9 and 17 keeps 17: the table sees one fight
    const at0 = mFirst({ a: { statuses: [braced] } });
    expect(table(reduce(g, u.cmd, ctx).fight)).toEqual(table(reduce(at0, { ...u.cmd, rolls: { dice: { [id('A')]: [] }, react: { [id('A')]: 9 }, second: { [id('A')]: 17 } } } as Command, ctx).fight));
  });
});

describe('a use\'s dice help the user: fudge(user) − fudge(target) on the other side, fudge(user) on its own', () => {
  test('a hunter at +2 deals each damage die 2 faces higher, within the die', () => {
    const g = aFirst({}, weigh(one('A'), 2)), u = use(g, 'A', CUT, 'M', [face(3, 6), face(6, 6), face(10)]);
    expect(u.rolls.dice[id('M')]).toEqual([5 + 6]);
    const at0 = aFirst();
    expect(rowHp(body(reduce(g, u.cmd, ctx).fight, 'M'))).toBe(rowHp(body(reduce(at0, { ...u.cmd, rolls: { dice: { [id('M')]: [11] }, react: { [id('M')]: 8 } } } as Command, ctx).fight, 'M')));
  });

  test('a foe\'s heal on a foe at foe +1 moves each die up 1', () => {
    const g = running(play(add(row('A', 'party'), row('M', 'foe'), row('N', 'foe')), start(['M', 20], ['A', 10], ['N', 5]), weigh(foes, 1)));
    const u = use(g, 'M', MEND, 'N', [face(2, 6), face(4, 6)]);
    expect(u.rolls.dice[id('N')]).toEqual([3 + 5]);
  });

  test('a hunter\'s heal on itself reads its own weight, whatever the foes\' is', () => {
    const g = aFirst({}, weigh(one('A'), 3), weigh(foes, 7));
    const n = needs(MEND, body(g, 'A'), g.rows, id('A'), g.grid, g.now, RULES);
    expect(weightsFor(g, id('A'), n).dice).toEqual({ [id('A')]: 3 });
  });

  test('a refund at +3 lands on a drawn face 3 higher', () => {
    // a refund of 25% lands on a d20 of 5 or lower (resolve.ts `refundLands`: each face is 5%), so a drawn 8 at +3 reads 5
    const quick = st('quick', { op: 'refund', pct: 50, chance: 25 });
    const g = aFirst({ a: { statuses: [quick] } }, weigh(one('A'), 3)), u = use(g, 'A', HIT, 'M', [face(10), face(8)]);
    expect(u.rolls.refund).toBe(5);
    const at0 = aFirst({ a: { statuses: [quick] } }), sent = (refund: number) => reduce(at0, { ...u.cmd, rolls: { ...u.rolls, refund } } as Command, ctx).fight;
    expect(body(reduce(g, u.cmd, ctx).fight, 'A').at).toBe(body(sent(5), 'A').at);
    expect(body(sent(8), 'A').at, 'a drawn 8 at 0 lands no refund').not.toBe(body(sent(5), 'A').at);
  });
});

describe('the dice outside a use', () => {
  test('an opening at +2 comes 2 faces earlier', () => {
    const s = play(add(row('A', 'party'), row('M', 'foe')), weigh(one('A'), 2)) as Setup;
    const openings = drawOpenings([id('A'), id('M')], source(face(10), face(500, 1000), face(10), face(400, 1000)), openingWeights(s, s.rows));
    expect(openings.map(o => [o.id, o.d20, o.tie])).toEqual([[id('A'), 12, 500], [id('M'), 10, 400]]);
    const plain = play(add(row('A', 'party'), row('M', 'foe')), { type: 'start', openings: [{ id: id('A'), d20: 12, tie: 500 }, { id: id('M'), d20: 10, tie: 400 }] });
    expect(table(reduce(s, { type: 'start', openings }, ctx).fight)).toEqual(table(plain));
  });

  test('a bleed on a hunter at +2 moves each die down 2', () => {
    const bleed = st('bleed', { op: 'damage', type: 'physical', amount: f('2d6') });
    const g = running(play(add(row('A', 'party', { statuses: [bleed] }), row('M', 'foe')), start(['M', 20], ['A', 10]), weigh(party, 2), { type: 'endTurn', by: id('M') }));
    const o = owed(g)[0]!;
    expect(o).toMatchObject({ kind: 'settle', id: id('A'), key: statusKey('bleed') });
    expect(settleWeights(g, id('A'), statusKey('bleed'))).toEqual([-2]);
    expect(drawSettle(o.kind === 'settle' ? o.dice : [], source(face(5, 6), face(1, 6)), settleWeights(g, id('A'), statusKey('bleed')))).toEqual([3 + 1]);
  });

  test('a heal over time on a foe at foe +1 moves each die up 1', () => {
    const regen = st('regen', { op: 'heal', amount: f('1d6') });
    const g = running(play(add(row('A', 'party'), row('M', 'foe', { statuses: [regen] })), start(['A', 20], ['M', 10]), weigh(foes, 1), { type: 'endTurn', by: id('A') }));
    expect(settleWeights(g, id('M'), statusKey('regen'))).toEqual([1]);
  });
});

describe('a forced face: one roll of one row, its best (20) or worst (1), then gone', () => {
  test('a hunter forced to 20 is read as a natural 1 on the foe it attacks, then the force is gone', () => {
    const g = aFirst({}, force('A', 20)), u = use(g, 'A', HIT, 'M', [face(15)]);
    expect(u.rolls.react[id('M')]).toBe(1);
    const r = reduce(g, u.cmd, ctx);
    expect(crits(r.effects)).toEqual([id('M')]);
    expect(fudgeOn(r.fight).forced).toEqual({});
  });

  test('a hunter forced to 20 that is attacked reads a natural 20', () => {
    const R: Rules = { ...RULES, fight: { ...RULES.fight, resistDc: 21 } }, c: Ctx = { rules: R };
    const g = mFirst({}, force('A', 20)), u = use(g, 'M', HEX, 'A', [face(3)], R);
    expect(u.rolls.react[id('A')]).toBe(20);
    const r = reduce(g, u.cmd, c);
    expect(said(r.fight)).toContain('resist');
    expect(fudgeOn(r.fight).forced).toEqual({});
  });

  test('a hunter forced to 1 that is attacked reads a natural 1, and a foe forced to 1 gives its target a 20', () => {
    expect(use(mFirst({}, force('A', 1)), 'M', HIT, 'A', [face(15)]).rolls.react[id('A')]).toBe(1);
    expect(use(mFirst({}, force('M', 1)), 'M', HIT, 'A', [face(4)]).rolls.react[id('A')]).toBe(20);
  });

  test('two forces on one die cancel and both are spent', () => {
    const g = aFirst({}, weigh(one('M'), 3), force('A', 20), force('M', 20)), u = use(g, 'A', HIT, 'M', [face(12)]);
    expect(u.rolls.react[id('M')], 'the die reads its weight, fudge(M) − fudge(A)').toBe(15);
    expect(fudgeOn(reduce(g, u.cmd, ctx).fight).forced).toEqual({});
  });

  test('two forces that ask the same face set it', () => {
    const g = aFirst({}, force('A', 20), force('M', 1));
    expect(use(g, 'A', HIT, 'M', [face(12)]).rolls.react[id('M')]).toBe(1);
  });

  test('a force touches no damage die', () => {
    const g = aFirst({}, force('A', 20)), u = use(g, 'A', CUT, 'M', [face(2, 6), face(3, 6), face(12)]);
    expect(u.rolls.dice[id('M')]).toEqual([2 + 3]);
  });

  test('a refused command spends no force', () => {
    const g = aFirst({}, force('A', 20), force('M', 1));
    const r = reduce(g, { type: 'act', by: id('A'), ability: HIT.id, aim: id('M'), rolls: { dice: {}, react: {} } }, ctx);
    expect(r.effects).toEqual([{ type: 'refused', reason: 'needsRoll' }]);
    expect(fudgeOn(r.fight).forced).toEqual({ [id('A')]: 20, [id('M')]: 1 });
  });

  test('a use that rolls no d20 leaves the force for the next roll that does', () => {
    const g = aFirst({}, force('A', 20)), heal = use(g, 'A', MEND, 'A', [face(3, 6), face(3, 6)]);
    expect(forcesRead(g, heal.cmd)).toEqual([]);
    expect(fudgeOn(reduce(g, heal.cmd, ctx).fight).forced).toEqual({ [id('A')]: 20 });
  });

  test('a forced opening reads its face and is spent by the start', () => {
    const s = play(add(row('A', 'party'), row('M', 'foe')), force('A', 1), force('M', 20)) as Setup;
    const openings = drawOpenings([id('A'), id('M')], source(face(15), face(1, 1000), face(3), face(2, 1000)), openingWeights(s, s.rows));
    expect(openings.map(o => o.d20)).toEqual([1, 20]);
    expect(fudgeOn(reduce(s, { type: 'start', openings }, ctx).fight).forced).toEqual({});
  });
});

describe('a fight at no fudge plays as it did before the fudge', () => {
  test('its weights are none, and its draws are the source\'s own faces', () => {
    const braced = st('braced', { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true });
    const quick = st('quick', { op: 'refund', pct: 50, chance: 25 });
    const g = mFirst({ a: { statuses: [braced] }, m: { statuses: [quick] } });
    expect(g.fudge).toEqual(NO_FUDGE);
    const n = needs(CUT, body(g, 'M'), g.rows, id('A'), g.grid, g.now, RULES);
    expect([n.react, n.refund, n.second]).toEqual([[id('A')], true, [id('A')]]);
    expect(weightsFor(g, id('M'), n)).toEqual({ dice: { [id('A')]: 0 }, react: { [id('A')]: 0 }, refund: 0 });
    // two d6 of damage, the reaction d20, the refund's d20, the edge's second d20: each the face the source gave
    const faces = [face(1, 6), face(6, 6), face(1), face(20), face(13)];
    expect(drawNeeds(n, source(...faces), weightsFor(g, id('M'), n))).toEqual({ dice: { [id('A')]: [7] }, react: { [id('A')]: 1 }, refund: 20, second: { [id('A')]: 13 } });
    expect(drawNeeds(n, source(...faces), NO_WEIGHTS)).toEqual(drawNeeds(n, source(...faces)));
    expect(drawOpenings([id('A')], source(face(1), face(1000, 1000)), openingWeights(g, g.rows))).toEqual([{ id: id('A'), d20: 1, tie: 1000 }]);
  });

  test('a row\'s weight is its side\'s plus its own', () => {
    const g = aFirst({}, weigh(party, 2), weigh(one('A'), -5), weigh(foes, 1));
    expect([fudgeOf(g.fudge, body(g, 'A')), fudgeOf(g.fudge, body(g, 'M'))]).toEqual([-3, 1]);
  });
});
