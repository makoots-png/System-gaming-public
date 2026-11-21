// The reworked fight's commands, one or more tests each. Every expected number comes from docs/agent-handoff/rw/design.md:
// the timeline's interval and opening (1.2), the tie rule, section 4's channel, stagger, shield, threat and taunt rules,
// the walking cost of 4.6 and the default lines of 5.2. Random play is tests/fight-model.test.ts.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { sheetEdit } from '../src/core/hunter/grant.ts';
import { REVIVE_HP, rest } from '../src/core/hunter/vitals.ts';
import { isRefused } from '../src/core/save-step.ts';
import { baseStats } from '../src/core/stats.ts';
import type { Stats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import type { MonsterKind } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { dist, place, tiles } from '../src/core/combat/space.ts';
import type { Place, Side, Terrain } from '../src/core/combat/space.ts';
import { MAX_ZONES, zoneId, zoneStep, zoneTiles } from '../src/core/combat/zones.ts';
import { ZONE_WALK } from './models/zone-events.ts';
import { summonStep } from '../src/core/combat/summons.ts';
import { SUMMON_WALK } from './models/summon-events.ts';
import { usesStep } from '../src/core/combat/uses.ts';
import { USES_WALK } from './models/uses-events.ts';
import { interval, tick } from '../src/core/combat/timeline.ts';
import { CHANNEL_EVENTS, CHANNEL_STATES, channelState, channelStep, released } from '../src/core/combat/fight-channel.ts';
import type { ChannelEvent } from '../src/core/combat/fight-channel.ts';
import { REACT_STATES, reactStep } from '../src/core/combat/fight-react.ts';
import type { ReactEvent, ReactState } from '../src/core/combat/fight-react.ts';
import { INVISIBLE_HIDE, REACT_WALK, STEALTH_HIDE, STEALTH_WALK } from './models/wave2-events.ts';
import { stealthLevel, stealthStep } from '../src/core/combat/standing.ts';
import type { HideLevel, Stealth, StealthEvent } from '../src/core/combat/standing.ts';
import { tallyOf } from '../src/core/combat/row-tally.ts';
import { REFUSAL_WORDS, TABLE_REFUSAL_WORDS } from '../src/core/combat/refusal-words.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import { parseSheetKey } from '../src/core/ids.ts';
import type { DeviceId, SheetKey } from '../src/core/ids.ts';
import { TABLE_REFUSALS, fightDoc } from '../src/core/combat/fight-doc.ts';
import { tauntOf } from '../src/core/combat/fight-view.ts';
import { sensible } from '../src/core/combat/policy.ts';
import type { Ability, AbilityKind, CombatantId } from '../src/core/combat/ability-types.ts';
import { modified, shadowId, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Body, Op, Origin, StackDef, Status, StatusDef, UseOp } from '../src/core/combat/effect-ops.ts';
import { afterDefence, landOps } from '../src/core/combat/land.ts';
import { ARMED, endStep } from '../src/core/combat/delayed.ts';
import { ENDS, WALK_EVENTS } from './models/delayed-events.ts';
import { parseAbility, parseFight } from '../src/core/combat/fight-parse.ts';
import { attemptsLeft, extractionStep, UNTRIED } from '../src/core/combat/extraction.ts';
import { EXTRACTION_WALK } from './models/extraction-events.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { SKILL_ABILITIES } from '../src/core/registry/abilities.ts';
import { can, fightId, owed, reduce, runningState } from '../src/core/combat/fight.ts';
import type { Command, CommandType, Ctx, Effect, Fight, NewRow, Opening, Result, RowLifeEvent, Running, StatusGrant, ZoneDraft } from '../src/core/combat/fight.ts';
import { needs } from '../src/core/combat/resolve.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';
const sheetKey = (s: string) => parseSheetKey(s) ?? (() => { throw new Error(`not a sheet key: ${s}`); })();

const ctx: Ctx = { rules: RULES };
const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const id = combatantId;
const ability = (kind: AbilityKind, name: string, text: string | null, o: Partial<Ability> = {}): Ability => {
  const a = abilityOf(kind, { id: abilityId(name), name }, RULES);
  return { ...a, ...(text ? { effect: { type: a.effect!.type, by: 'hand', formula: f(text) } as Ability['effect'] } : {}), ...o };
};
const FAR = { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as const;
/** A plain hit of 10 before armor, no dice, that reaches across the grid: base light armor 10 makes it round(10 * 100 / 110) = 9 (rule 12). */
const HIT = ability('strike', 'hit', '10', FAR);
const BIG = ability('strike', 'big', '999', FAR);
const st = (key: string, until: number | null, ...ops: Op[]): Status =>
  ({ key: statusKey(key), def: { label: key, desc: '', ops }, source: { id: null, tier: 0 }, until: until === null ? null : tick(until), since: tick(0), settledAt: tick(0) });
const hunterOrigin = (o: Partial<Stats> = {}): Origin => ({ kind: 'hunter', build: { stats: { ...baseStats(RULES.fight), ...o }, level: 1, gear: kitGear('light', RULES), perks: {} } });

/** A body of base stats in a light kit: speed 100, move 6, stride 3, armor 10. A status may change its speed. */
function row(name: string, side: Side, o: RowPatch<NewRow> = {}): NewRow {
  const { kind: k, hp, ...rest } = o;
  const origin = o.origin ?? hunterOrigin(), hpMax = modified(origin, o.statuses ?? [], RULES).sheet.hpMax;
  const kind = k ?? (side === 'party' ? 'hunter' : 'monster');
  // a row of `kind` with that kind's own fields (effect-ops.ts `Body`); a patch that names a summon gives its owner and end
  return {
    id: id(name), name, side, ...lifeAt(kind, hp ?? hpMax), origin, tier: 0, place: null, mana: 10, fatigue: 0, shield: null, stagger: null, channel: null,
    threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: [HIT, BIG], intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0, ...rest,
  } as NewRow;
}
const haste = (pct: number): Status => st(`speed${pct}`, null, { op: 'speed', pct });
const openings = (...list: [string, number, number?][]): Opening[] => list.map(([name, d20, tie]) => ({ id: id(name), d20, tie: tie ?? 0 }));
const rolls = (react: Record<string, number> = {}, dice: Record<string, number[]> = {}): Rolls => ({ dice: dice as Rolls['dice'], react: react as Rolls['react'] });

/** Plays commands from no fight, failing on any refusal; answers the last fight and every effect. */
function play(...commands: Command[]): { fight: Fight | null; effects: Effect[] } {
  let fight: Fight | null = null;
  const effects: Effect[] = [];
  for (const cmd of commands) {
    const r = reduce(fight, cmd, ctx);
    const no = r.effects.find(e => e.type === 'refused');
    if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
    effects.push(...r.effects);
    fight = r.fight;
  }
  return { fight, effects };
}
const running = (x: { fight: Fight | null }): Running => { if (x.fight?.phase !== 'running') throw new Error(`not running: ${x.fight?.phase}`); return x.fight; };
const body = (fight: Fight | null, name: string): Body => fight!.rows.find(r => r.id === name)!;
const add = (...rows: NewRow[]): Command => ({ type: 'add', fightId: fightId('f-1'), rows, openings: [] });
const join = (rows: NewRow[], opens: Opening[]): Command => ({ type: 'add', fightId: fightId('f-1'), rows, openings: opens });
const start = (...list: [string, number, number?][]): Command => ({ type: 'start', openings: openings(...list) });
const pass = (by: string): Command => ({ type: 'endTurn', by: id(by) });
const hit = (by: string, at: string, a: Ability = HIT, react = 10): Command => ({ type: 'act', by: id(by), ability: a.id, aim: id(at), rolls: rolls({ [at]: react }) });
/** Whose turn started, and when, in order. */
const turns = (effects: readonly Effect[]): string[] => effects.flatMap(e => e.type === 'turnStarted' ? [`${e.id}@${e.now}`] : []);
/** A refused command changes nothing: the same fight back, deeply equal, and one refusal with this reason. */
function refuses(fight: Fight | null, cmd: Command, reason: string): void {
  const copy = JSON.parse(JSON.stringify(fight));
  const r: Result = reduce(fight, cmd, ctx);
  expect(r.effects).toEqual([{ type: 'refused', reason } as Effect]);
  expect(JSON.parse(JSON.stringify(r.fight))).toEqual(copy);
}
const duel = (party: Partial<NewRow> = {}, foe: Partial<NewRow> = {}) => [add(row('A', 'party', party), row('M', 'foe', foe)), start(['A', 20], ['M', 10])] as const;

describe('add: rows join the fight', () => {
  test('from no fight, rows build a new one and stand in their side\'s line: the party on row 2, the foes 8 rows below (5.2)', () => {
    const { fight } = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')));
    expect(fight?.phase).toBe('setup');
    expect(fight!.rows.map(r => [r.id, r.place])).toEqual([['A', place(0, 2)], ['B', place(1, 2)], ['M', place(0, 10)]]);
  });

  test('a row with a free place of its own keeps it, and a taken one falls back to the line', () => {
    const { fight } = play(add(row('A', 'party', { place: place(5, 5) }), row('B', 'party', { place: place(5, 5) })));
    expect([body(fight, 'A').place, body(fight, 'B').place]).toEqual([place(5, 5), place(0, 2)]);
  });

  test('the same id twice is refused whole, and a refused first add leaves no fight', () => {
    const { fight } = play(add(row('A', 'party')));
    refuses(fight, add(row('B', 'party'), row('A', 'party')), 'duplicate');
    refuses(null, add(row('A', 'party'), row('A', 'party')), 'duplicate');
  });

  test('joining a running fight needs an opening roll, and a d20 of 20 joins at now', () => {
    const r = play(...duel());
    refuses(r.fight, add(row('B', 'party')), 'needsRoll');
    const after = reduce(r.fight, join([row('B', 'party')], openings(['B', 20])), ctx);
    expect(body(after.fight, 'B').at).toBe(tick(0));
    const late = reduce(r.fight, join([row('B', 'party')], openings(['B', 10])), ctx);
    expect(body(late.fight, 'B').at).toBe(tick(500));
  });
});

describe('start: the openings decide the first turns (1.2)', () => {
  test('a d20 of 20 acts at once, a 10 waits half an interval, a 1 waits 19/20 of one', () => {
    const r = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 10], ['B', 1], ['M', 20]));
    expect(r.fight!.rows.map(x => x.at)).toEqual([tick(500), tick(950), tick(0)]);
    expect(turns(r.effects)).toEqual(['M@0']);
    expect(running(r).currentId).toBe(id('M'));
  });

  test('the turnStarted of a hunter on this phone names its sheet', () => {
    const r = play(...duel());
    expect(r.effects.find(e => e.type === 'turnStarted')).toEqual({ type: 'turnStarted', id: id('A'), hunterId: hunterId('h-A'), now: tick(0) });
  });

  test('a row without an opening, or a fight with one side, cannot start', () => {
    refuses(play(add(row('A', 'party'), row('M', 'foe'))).fight, start(['A', 20]), 'needsRoll');
    refuses(play(add(row('A', 'party'), row('B', 'party'))).fight, start(['A', 20], ['B', 20]), 'needBothSides');
  });
});

describe('endTurn: who acts when (1.1 and 1.2)', () => {
  test('a pass costs a standard action: speed 100 waits 1000 ticks, speed 200 waits 500, and a tie goes to the faster', () => {
    const r = play(add(row('S', 'party'), row('F', 'foe', { statuses: [haste(100)] })), start(['S', 20], ['F', 20]));
    expect([body(r.fight, 'S').speed, body(r.fight, 'F').speed]).toEqual([100, 200]);
    const more = play(add(row('S', 'party'), row('F', 'foe', { statuses: [haste(100)] })), start(['S', 20], ['F', 20]),
      pass('F'), pass('S'), pass('F'), pass('F'), pass('S'));
    expect(turns(more.effects)).toEqual(['F@0', 'S@0', 'F@500', 'F@1000', 'S@1000', 'F@1500']);
  });

  test('only the current row may pass', () => {
    refuses(play(...duel()).fight, pass('M'), 'notYourTurn');
  });

  test('a held body is passed by rule: its turn moves on a standard interval and the next one starts', () => {
    const r = play(add(row('A', 'party'), row('M', 'foe', { statuses: [st('stun', null, { op: 'hold' })] })), start(['A', 20], ['M', 10]), pass('A'));
    expect(turns(r.effects)).toEqual(['A@0', 'A@1000']);
    expect(body(r.fight, 'M').at).toBe(tick(1500));
  });
});

describe('act: one use, then the next turn', () => {
  test('a hit deals its formula through armor (rule 12), costs its fatigue, and the user waits a standard interval', () => {
    const r = play(...duel(), hit('A', 'M'));
    const m = body(r.fight, 'M');
    expect(m.sheet.hpMax - rowHp(m)).toBe(Math.round(10 * 100 / (100 + 10)));
    expect([body(r.fight, 'A').at, body(r.fight, 'A').fatigue]).toEqual([tick(1000), 8]);
    expect(turns(r.effects)).toEqual(['A@0', 'M@500']);
  });

  test('a critical hit names the target it landed on, so a screen can mark it; an ordinary hit names none (rule 9)', () => {
    // rule 9: a reaction die at or under the user's crit faces (at least 1) is a crit; a 1 always is, a 20 never
    const crits = (react: number) => play(...duel(), hit('A', 'M', HIT, react)).effects.filter(e => e.type === 'crit');
    expect(crits(1)).toEqual([{ type: 'crit', id: id('M') }]);
    expect(crits(20)).toEqual([]);
  });

  test('a hunter on this phone hit by a monster gets one vitals write-back with its HP and life', () => {
    const r = play(...duel(), pass('A'), hit('M', 'A'));
    const a = body(r.fight, 'A');
    expect(r.effects.filter(e => e.type === 'vitals')).toEqual([{ type: 'vitals', hunterId: hunterId('h-A'), life: { at: 'up', hp: rowHp(a) }, mana: 10, fatigue: 0, statuses: [] }]);
    expect(a.sheet.hpMax - rowHp(a)).toBe(9);
  });

  test('a hunter on another phone is told its totals instead', () => {
    const r = play(...duel({ holder: { kind: 'remote', remote: sheetKey('dev-mira:h1') } }), pass('A'), hit('M', 'A')), a = body(r.fight, 'A');
    expect(r.effects.filter(e => e.type === 'vitals')).toEqual([]);
    expect(r.effects.flatMap(e => (e.type === 'sendRemote' ? [e.life] : [])), 'as it joins, then after the hit').toEqual([{ at: 'up', hp: a.sheet.hpMax }, { at: 'up', hp: rowHp(a) }]);
  });

  test('a monster brought to 0 is defeated, and the fight ends when its side has nobody up, with its XP', () => {
    const r = play(...duel({}, { xp: 40 }), hit('A', 'M', BIG));
    expect(r.fight?.phase).toBe('ended');
    expect(r.effects.filter(e => e.type === 'defeated' || e.type === 'ended')).toEqual([
      { type: 'defeated', id: id('M') }, { type: 'ended', summary: { rounds: 0, winner: 'party', down: [id('M')], xp: 40 } },
    ]);
  });

  test('out of turn only the GM may act, and the turn stays where it was', () => {
    const r = play(...duel());
    refuses(r.fight, hit('M', 'A'), 'notYourTurn');
    const forced = reduce(r.fight, { ...hit('M', 'A'), force: true } as Command, ctx);
    expect(running(forced).currentId).toBe(id('A'));
    expect(running(forced).log[0]!.text).toContain('(GM)');
  });

  test('a use answers the line it logged, so the GM\'s toast is that line whatever its words', () => {
    const r = play(...duel(), hit('A', 'M'));
    const used = r.effects.find(e => e.type === 'used');
    expect(used).toEqual({ type: 'used', by: id('A'), ability: HIT.id, line: r.fight!.log.find(l => l.text.endsWith(used && used.type === 'used' ? used.line : '?'))!.text.replace(/^R\d+: /, '') });
  });

  test('an ability it does not have, a down user and a missing reaction roll are refused', () => {
    const r = play(...duel());
    refuses(r.fight, { type: 'act', by: id('A'), ability: abilityId('nope'), aim: id('M'), rolls: rolls() }, 'unknownAbility');
    refuses(r.fight, { type: 'act', by: id('A'), ability: HIT.id, aim: id('M'), rolls: rolls() }, 'needsRoll');
    const down = play(add(row('A', 'party'), row('B', 'party', { hp: 0 }), row('M', 'foe')), start(['A', 20], ['B', 20], ['M', 10]));
    refuses(down.fight, { ...hit('B', 'M'), force: true } as Command, 'down');
  });
});

describe('move: a walk on the turn (4.6)', () => {
  test('three tiles cost round(100 * 3 / 6) = 50 hundredths: a speed-100 walker waits 500 ticks', () => {
    const r = play(...duel(), { type: 'move', by: id('A'), to: place(0, 5) });
    expect([body(r.fight, 'A').place, body(r.fight, 'A').at]).toEqual([place(0, 5), tick(500)]);
    expect(r.effects).toContainEqual({ type: 'moved', id: id('A'), to: place(0, 5) });
  });

  test('a stride is ceil(6 / 2) = 3 tiles: four is too far', () => {
    refuses(play(...duel()).fight, { type: 'move', by: id('A'), to: place(0, 6) }, 'tooFar');
  });

  test('a root refuses the walk, and a tile with a body, off the grid or walled in is refused', () => {
    refuses(play(...duel({ statuses: [st('root', null, { op: 'root' })] })).fight, { type: 'move', by: id('A'), to: place(0, 3) }, 'rooted');
    const r = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 1], ['M', 1]));
    refuses(r.fight, { type: 'move', by: id('A'), to: place(1, 2) }, 'taken');
    refuses(r.fight, { type: 'move', by: id('A'), to: place(-1, 2) }, 'offGrid');
    const boxed = play(add(row('A', 'party', { place: place(0, 0) }), row('B', 'party', { place: place(1, 0) }), row('C', 'party', { place: place(0, 1) }),
      row('D', 'party', { place: place(1, 1) }), row('E', 'party', { place: place(3, 0) }), row('M', 'foe')), start(['A', 20], ['B', 1], ['C', 1], ['D', 1], ['E', 1], ['M', 1]));
    refuses(boxed.fight, { type: 'move', by: id('A'), to: place(2, 0) }, 'blocked');
  });

  test('a dash runs the whole move of 6 tiles in a straight line for a standard action (1000 ticks at speed 100) and its fatigue', () => {
    const r = play(...duel(), { type: 'move', by: id('A'), to: place(0, 8), dash: true });
    const a = body(r.fight, 'A');
    expect([a.place, a.at, a.fatigue]).toEqual([place(0, 8), tick(1000), RULES.fight.dashFatigue]);
    expect(running(r).log.some(l => l.text.includes('A dashes 6 tiles.'))).toBe(true);
  });

  test('a dash may go diagonally as far as the 5-10-5 distance allows: 4 across and 4 down is 6, 4 across and 5 down is 7', () => {
    expect(body(play(...duel(), { type: 'move', by: id('A'), to: place(4, 6), dash: true }).fight, 'A').place).toEqual(place(4, 6));
    refuses(play(...duel()).fight, { type: 'move', by: id('A'), to: place(4, 7), dash: true }, 'tooFar');
    refuses(play(...duel()).fight, { type: 'move', by: id('A'), to: place(0, 9), dash: true }, 'tooFar');
  });

  test('a body on the line refuses a dash where a walk would go round it, and a root refuses it', () => {
    const r = play(add(row('A', 'party'), row('B', 'party', { place: place(0, 4) }), row('M', 'foe')), start(['A', 20], ['B', 1], ['M', 1]));
    refuses(r.fight, { type: 'move', by: id('A'), to: place(0, 6), dash: true }, 'blocked');
    expect(body(play(add(row('A', 'party'), row('B', 'party', { place: place(0, 4) }), row('M', 'foe')), start(['A', 20], ['B', 1], ['M', 1]),
      { type: 'move', by: id('A'), to: place(1, 5) }).fight, 'A').place).toEqual(place(1, 5));
    refuses(play(...duel({ statuses: [st('root', null, { op: 'root' })] })).fight, { type: 'move', by: id('A'), to: place(0, 4), dash: true }, 'rooted');
  });
});

describe('a channel (4.1)', () => {
  // Wound up 600 ticks, so a base body (move 6) on a d20 of 10 steps 1 tile and stays in the radius of 2.
  const CHARGE = ability('blast', 'charge', '10 * (1 + charge)', { channel: { growth: 'linear', max: 5 }, cost: { fatigue: 0, mana: 0, time: 100 as never, cooldown: tick(0) }, range: tiles(20), delivery: { kind: 'travel', windup: tick(600), speed: 'instant' } });
  const begin = (by: string, at: string): Command => ({ type: 'act', by: id(by), ability: CHARGE.id, aim: id(at), rolls: rolls() });
  const caster = (o: Partial<NewRow> = {}) => row('A', 'party', { abilities: [HIT, CHARGE], ...o });

  test('it begins holding at charge 0, grows one a turn, and its release resolves at the current charge', () => {
    const r = play(add(caster(), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), pass('M'), pass('A'), pass('M'));
    expect(body(r.fight, 'A').channel).toEqual({ ability: CHARGE.id, aim: id('M'), charge: 2, spent: 0, state: 'holding' });
    const fired = reduce(r.fight, { type: 'release', by: id('A'), rolls: rolls({ M: 10 }) }, ctx);
    const m = body(fired.fight, 'M');
    expect(body(fired.fight, 'A').channel?.state).toBe('fired');
    expect(m.sheet.hpMax - rowHp(m)).toBe(Math.max(1, Math.round((10 * 3 - RULES.fight.armorFlat * m.sheet.resist) * 100 / (100 + m.sheet.resist))));
  });

  test('a hit of at least its hold (0.15 of max HP on a base body) breaks it to half its charge, rounded down', () => {
    const r = play(add(caster(), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), pass('M'), pass('A'), pass('M'), pass('A'), pass('M'));
    expect(body(r.fight, 'A').channel?.charge).toBe(3);
    const broke = play(add(caster(), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), pass('M'), pass('A'), pass('M'), pass('A'), hit('M', 'A'));
    expect(body(broke.fight, 'A').channel).toEqual({ ability: CHARGE.id, aim: id('M'), charge: 1, spent: 0, state: 'broken' });
  });

  test('a broken channel fires out of turn at once at its charge and costs its user no time', () => {
    // A slowed to speed 50 begins at 0 and waits to 2000; M hits it at 950 and has the turn again at 1950.
    const r = play(add(caster({ statuses: [haste(-50)] }), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), hit('M', 'A'));
    const a = body(r.fight, 'A');
    expect([a.speed, a.at, a.channel?.state, running(r).currentId]).toEqual([50, tick(2000), 'broken', id('M')]);
    const before = body(r.fight, 'M');
    const out = reduce(r.fight, { type: 'release', by: id('A'), rolls: rolls({ M: 10 }) }, ctx);
    expect([body(out.fight, 'A').at, body(out.fight, 'A').channel?.state, running(out).currentId]).toEqual([tick(2000), 'fired', id('M')]);
    expect(rowHp(before) - rowHp(body(out.fight, 'M'))).toBe(Math.round((10 * (1 + 0) - RULES.fight.armorFlat * before.sheet.resist) * 100 / (100 + before.sheet.resist)));
  });

  test('acting or walking while holding ends it unspent; a full channel cannot be held another turn', () => {
    const base = [add(caster(), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), pass('M')] as const;
    const walked = play(...base, { type: 'move', by: id('A'), to: place(0, 3) });
    expect(body(walked.fight, 'A').channel).toBeNull();
    expect(walked.effects).toContainEqual({ type: 'channel', id: id('A'), state: null, charge: 0 });
    let full = play(...base);
    for (let k = 0; k < 4; k++) full = { fight: play(...base, ...Array.from({ length: k + 1 }, () => [pass('A'), pass('M')]).flat()).fight, effects: [] };
    expect(body(full.fight, 'A').channel?.charge).toBe(5);
    const held = reduce(full.fight, pass('A'), ctx);
    expect(body(held.fight, 'A').channel).toBeNull();
  });

  test('a channel pays its HP price at its begin, once, and a channel of once a fight still goes off: its release asks and pays nothing again', () => {
    const PRICED = { ...CHARGE, id: abilityId('priced'), prices: [{ kind: 'hp', amount: { kind: 'flat', n: 5 } }], gates: [{ kind: 'uses', per: 'fight', n: 1 }] } as Ability;
    const r = play(add(caster({ abilities: [HIT, PRICED] }), row('M', 'foe')), start(['A', 20], ['M', 1]), { type: 'act', by: id('A'), ability: PRICED.id, aim: id('M'), rolls: rolls() }, pass('M'));
    const a = body(r.fight, 'A');
    expect(a.sheet.hpMax - rowHp(a)).toBe(5);
    const out = reduce(r.fight, { type: 'release', by: id('A'), rolls: rolls({ M: 10 }) }, ctx);
    expect(out.effects.find(e => e.type === 'refused')).toBeUndefined();
    expect([body(out.fight, 'A').channel?.state, body(out.fight, 'A').sheet.hpMax - rowHp(body(out.fight, 'A'))]).toEqual(['fired', 5]);
  });

  test('a broken channel whose aim is gone goes off at nothing and is owed no more', () => {
    const r = play(add(caster({ statuses: [haste(-50)] }), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), hit('M', 'A'));
    const f0 = r.fight!, gone = { ...f0, rows: f0.rows.map(b => b.id === 'A' && b.channel ? { ...b, channel: { ...b.channel, aim: id('ghost') } } : b) };
    expect(owed(gone)).toEqual([{ kind: 'release', id: id('A') }]);
    const out = reduce(gone, { type: 'release', by: id('A'), rolls: rolls() }, ctx);
    expect([out.effects.find(e => e.type === 'refused'), body(out.fight, 'A').channel?.state, owed(out.fight)]).toEqual([undefined, 'fired', []]);
  });

  test('a release with no channel is refused', () => {
    refuses(play(...duel()).fight, { type: 'release', by: id('A'), rolls: rolls() }, 'noChannel');
  });

  test('the machine: every state of a channel under every event of its table (design 4.1)', () => {
    const chan = (state: 'holding' | 'broken' | 'fired') => ({ ability: CHARGE.id, aim: id('M'), charge: 2, spent: 0, state });
    const events: Record<(typeof CHANNEL_EVENTS)[number], ChannelEvent> = {
      begin: { type: 'begin', ability: CHARGE.id, aim: id('M'), spent: 0 }, grow: { type: 'grow', max: 5 }, release: { type: 'release' },
      interrupt: { type: 'interrupt', share: 0.5 }, drop: { type: 'drop' },
    };
    const expected: Record<(typeof CHANNEL_STATES)[number], Record<(typeof CHANNEL_EVENTS)[number], (typeof CHANNEL_STATES)[number]>> = {
      none: { begin: 'holding', grow: 'none', release: 'none', interrupt: 'none', drop: 'none' },
      holding: { begin: 'holding', grow: 'holding', release: 'fired', interrupt: 'broken', drop: 'none' },
      broken: { begin: 'broken', grow: 'broken', release: 'fired', interrupt: 'broken', drop: 'none' },
      fired: { begin: 'holding', grow: 'fired', release: 'fired', interrupt: 'fired', drop: 'fired' },
    };
    for (const s of CHANNEL_STATES) for (const e of CHANNEL_EVENTS) {
      expect(channelState(channelStep(s === 'none' ? null : chan(s), events[e])), `${s} × ${e}`).toBe(expected[s][e]);
    }
  });

  test('a release reads where it was released from: a holding one on its user\'s turn costs the turn, a broken one out of it costs nothing', () => {
    const chan = (state: 'holding' | 'broken' | 'fired') => ({ ability: CHARGE.id, aim: id('M'), charge: 2, spent: 0, state });
    const expected = {
      none: { own: null, other: null }, fired: { own: null, other: null },
      holding: { own: 'turn', other: null },
      // rules-3.1 waits on the owner: today a broken channel released on its user's own turn costs that turn
      broken: { own: 'turn', other: 'free' },
    } as const;
    for (const s of CHANNEL_STATES) for (const turn of ['own', 'other'] as const) {
      const r = released(s === 'none' ? null : chan(s), turn);
      expect(r && r.costs, `${s} × ${turn}`).toBe(expected[s][turn]);
      if (r) expect(r.channel.state).toBe('fired');
    }
  });

  test('a channel broken as its user\'s own turn starts costs that turn when it goes off (rules-3.1, as the app does today)', () => {
    const r = play(add(caster(), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), pass('M'));
    const g = running(r), a = body(g, 'A');
    expect(g.currentId).toBe(id('A'));
    const broke = { ...g, rows: g.rows.map(b => b.id === 'A' ? { ...b, channel: { ...b.channel!, state: 'broken' as const } } : b) };
    const out = reduce(broke, { type: 'release', by: id('A'), rolls: rolls({ M: 10 }) }, ctx);
    expect(out.effects.find(e => e.type === 'refused')).toBeUndefined();
    expect([body(out.fight, 'A').at, running(out).currentId]).toEqual([tick(g.now + interval(a.speed, CHARGE.cost.time, RULES.fight)), id('M')]);
  });

  test('a running fight owes dice while a broken channel waits to go off, and acts again once it has', () => {
    const r = play(add(caster({ statuses: [haste(-50)] }), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), hit('M', 'A'));
    expect(runningState(running(play(add(caster(), row('M', 'foe')), start(['A', 20], ['M', 1]))))).toEqual({ at: 'acting' });
    expect(runningState(running(r))).toEqual({ at: 'owing', owed: [{ kind: 'release', id: id('A') }] });
    const out = reduce(r.fight, { type: 'release', by: id('A'), rolls: rolls({ M: 10 }) }, ctx);
    expect(runningState(running(out))).toEqual({ at: 'acting' });
  });

  test('a turn may end while dice are owed, and the dice stay owed (rules-3.2, as the app does today)', () => {
    const r = play(add(caster({ statuses: [haste(-50)] }), row('M', 'foe')), start(['A', 20], ['M', 1]), begin('A', 'M'), hit('M', 'A'));
    expect(running(r).currentId).toBe(id('M'));
    const out = reduce(r.fight, pass('M'), ctx);
    expect(out.effects.find(e => e.type === 'refused')).toBeUndefined();
    expect(runningState(running(out))).toEqual({ at: 'owing', owed: [{ kind: 'release', id: id('A') }] });
  });

  test('while it holds, a foe\'s threat for the channeler does not fade and grows with the payoff: 100 is 200 at charge 2 of a linear channel, 210.25 of an exponential one', () => {
    // Linear: the payoff is 1 + 0.5 * charge, so 100 * 2 at charge 2. Exponential: 1.45 ^ charge, so 100 * 1.45 ^ 2.
    const EXP = { ...CHARGE, id: abilityId('exp'), channel: { growth: 'exponential', max: 5 } } as Ability;
    const threat = { [id('A')]: 100 } as Record<CombatantId, number>;
    const at2 = (a: Ability) => play(add(caster({ abilities: [HIT, a] }), row('M', 'foe', { threat })), start(['A', 20], ['M', 1]),
      { type: 'act', by: id('A'), ability: a.id, aim: id('M'), rolls: rolls() }, pass('M'), pass('A'), pass('M'));
    const lin = at2(CHARGE), exp = at2(EXP);
    expect([body(lin.fight, 'A').channel?.charge, body(exp.fight, 'A').channel?.charge]).toEqual([2, 2]);
    expect(body(lin.fight, 'M').threat![id('A')]).toBeCloseTo(100 * (1 + RULES.fight.channelLin * 2), 9);
    expect(body(exp.fight, 'M').threat![id('A')]).toBeCloseTo(100 * RULES.fight.channelExp ** 2, 9);
  });
});

// A channel's begin is rules 2 to 5 of its use and its release the rest (design 4.1, guide "What a use or a reaction must
// pass and pay"), so a release lands as a use through `act` lands. Audit BUG-rules-3; the steps are
// docs/agent-handoff/audit/notes-channel-release.md.
describe('a channel\'s release lands as a use does (design 4.1)', () => {
  const ROUND = RULES.fight.round;
  const channel = { growth: 'linear', max: 5 } as const;
  const free = { fatigue: 0, mana: 0, time: HIT.cost.time, cooldown: tick(0) };
  /** `a` as a channel of no cost but its time. */
  const channeled = (a: Ability, name: string): Ability => ({ ...a, id: abilityId(name), name, channel, cost: free });
  const use = (by: string, a: Ability, aim: string | Place): Command => ({ type: 'act', by: id(by), ability: a.id, aim: typeof aim === 'string' ? id(aim) : aim, rolls: rolls() });
  const release = (by: string, r: Rolls = rolls()): Command => ({ type: 'release', by: id(by), rolls: r });
  const ten = { kind: 'number' as const, value: 10 };

  test('a release whose op breaks a foe\'s channel leaves it at half its charge, as every break does (rule 17)', () => {
    const SNAP = channeled(ability('curse', 'snap', null, { ...FAR, effect: null, delivery: { kind: 'sure' }, ops: [{ op: 'channel', mode: 'break' }] }), 'snap');
    const WIND = channeled(HIT, 'wind');
    const r = play(add(row('A', 'party', { abilities: [SNAP] }), row('M', 'foe', { abilities: [WIND] })), start(['A', 20], ['M', 1]),
      use('A', SNAP, 'M'), use('M', WIND, 'A'), pass('A'), pass('M'), pass('A'), pass('M'));
    const held = body(r.fight, 'M').channel!.charge;
    expect([held, running(r).currentId]).toEqual([2, id('A')]);
    const out = reduce(r.fight, release('A', rolls({ M: 10 })), ctx);
    expect(body(out.fight, 'M').channel).toMatchObject({ state: 'broken', charge: Math.floor(held * RULES.fight.breakShare) });
  });

  test('a trigger that breaks a channel after a use leaves it at half its charge too', () => {
    const WIND = channeled(HIT, 'wind'), TAP = ability('strike', 'tap', '1', FAR);
    const snaps: Status = { key: statusKey('brittle'), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0),
      def: { label: 'Brittle', desc: '', ops: [], triggers: [{ on: 'struck', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'channel', mode: 'break' }] }] } };
    const r = play(add(row('A', 'party', { abilities: [TAP] }), row('M', 'foe', { abilities: [WIND], statuses: [snaps] })), start(['M', 20], ['A', 1]),
      use('M', WIND, 'A'), pass('A'), pass('M'), pass('A'), pass('M'));
    const held = body(r.fight, 'M').channel!.charge;
    expect([held, running(r).currentId]).toEqual([2, id('A')]);
    // TAP's 1 is under M's hold, so only the trigger breaks it
    const out = reduce(r.fight, hit('A', 'M', TAP), ctx);
    expect(body(out.fight, 'M').channel).toMatchObject({ state: 'broken', charge: Math.floor(held * RULES.fight.breakShare) });
  });

  test('a zone price is paid at the begin: the zone ends then, its end lands once, and the release takes no zone again (rule 4, kits 1.4.3)', () => {
    const keep = ability('support', 'keep', null, { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null,
      zone: { name: 'Boundary', duration: null, ops: [], endsWithOwner: false, around: tiles(1), grow: null, end: [{ op: 'damage', type: 'physical', amount: ten, when: 'use' }] } });
    const POP = channeled({ ...HIT, prices: [{ kind: 'zone', name: 'Boundary', take: 'one' }] }, 'pop');
    const lay: Command = { type: 'act', by: id('A'), ability: keep.id, aim: id('A'), rolls: rolls() };
    // two zones, laid at 0 and a round later; the price takes the oldest, a round old at the begin
    const laid = [add(row('A', 'party', { abilities: [keep, POP] }), row('M', 'foe')), start(['A', 20], ['M', 10]), lay, pass('M'), lay, pass('M')] as const;
    const began = play(...laid, use('A', POP, 'M'));
    const a = body(began.fight, 'A'), endHit = afterDefence(10, 'physical', a.sheet, a.sheet, RULES);
    expect([running(began).zones.length, a.sheet.hpMax - rowHp(a)]).toEqual([1, endHit]);
    const again = play(...laid, use('A', POP, 'M'), pass('M'), release('A', rolls({ M: 10 })));
    expect([running(again).zones.length, body(again.fight, 'A').sheet.hpMax - rowHp(body(again.fight, 'A'))]).toEqual([1, endHit]);
  });

  test('a channeled hide is refused at its begin while a foe that is up sees the user (kits 8.7.2)', () => {
    const CLOAK = channeled(ability('support', 'cloak', null, { aim: 'self', effect: null, shape: { kind: 'self' },
      ops: [{ op: 'applyStatus', key: statusKey('cloak'), def: { label: 'Cloak', desc: '', ops: [{ op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } }] }, duration: tick(3 * ROUND) }] }), 'cloak');
    refuses(play(...duel({ abilities: [CLOAK] })).fight, use('A', CLOAK, 'A'), 'seen');
  });

  test('a release sets off the reactions a use sets off: a negate before it lands, a ward before a killing hit, a riposte after (rules 7c, 13b, 19c)', () => {
    const quick = abilityOf('shot', { id: abilityId('q'), name: 'q' }, RULES).cost.time;
    const reaction = (name: string, when: 'before' | 'lethal' | 'after', o: Partial<Ability>): Ability =>
      ability('strike', name, null, { ...FAR, effect: null, cost: { ...HIT.cost, fatigue: 0, time: quick }, react: { when, reach: tiles(0) }, ...o });
    const NEGATE = reaction('shinsuu', 'before', { ops: [{ op: 'negate' }] });
    const STAND = reaction('stand', 'lethal', { ops: [{ op: 'applyStatus', key: statusKey('stone'), def: { label: 'Stone', desc: '', ops: [{ op: 'invulnerable' }] }, duration: tick(1000) }] });
    const RIPOSTE = reaction('riposte', 'after', { effect: { type: 'physical', by: 'hand', formula: f('10') } });
    const WIND = channeled(HIT, 'wind'), CRUSH = channeled(BIG, 'crush');
    const released = (wind: Ability, react: Ability) => play(add(row('A', 'party', { abilities: [HIT, react] }), row('M', 'foe', { abilities: [wind] })),
      start(['M', 20], ['A', 10]), use('M', wind, 'A'), { type: 'arm', by: id('A'), ability: react.id }, pass('A'), release('M', rolls({ A: 10 })));
    const negated = released(WIND, NEGATE), warded = released(CRUSH, STAND), answered = released(WIND, RIPOSTE);
    expect(rowHp(body(negated.fight, 'A'))).toBe(body(negated.fight, 'A').sheet.hpMax);
    expect(rowHp(body(warded.fight, 'A'))).toBe(1);
    const m = body(answered.fight, 'M');
    expect(m.sheet.hpMax - rowHp(m)).toBe(afterDefence(10, 'physical', body(answered.fight, 'A').sheet, m.sheet, RULES));
  });

  test('a release on a foe ends its user\'s hide, as a use from hiding does (kits 8.7.3)', () => {
    const HIDE = ability('support', 'hide', null, { aim: 'self', effect: null, shape: { kind: 'self' },
      ops: [{ op: 'applyStatus', key: statusKey('hide'), def: { label: 'hide', desc: '', ops: [{ op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } }] }, duration: tick(3 * ROUND) }] });
    const BOOM = channeled(ability('blast', 'boom', '5', { range: tiles(20) }), 'boom');
    const wall: Command = { type: 'paint', tiles: Array.from({ length: 20 }, (_, x) => place(x, 6)), terrain: 'wall' };
    const r = play(add(row('A', 'party', { abilities: [HIDE, BOOM] }), row('M', 'foe')), wall, start(['A', 20], ['M', 10]),
      { type: 'act', by: id('A'), ability: HIDE.id, aim: id('A'), rolls: rolls() }, pass('M'), use('A', BOOM, place(0, 10)), pass('M'),
      release('A', { ...rolls({ M: 10 }, { M: [] }), second: { [id('M')]: 3 } }));
    expect(body(r.fight, 'A').statuses.map(s => s.key)).not.toContain('hide');
  });

  test('a released summon calls its row (rule 18d)', () => {
    const CALL = channeled(ability('support', 'call', null, { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, summon: { name: 'Sprite', archetype: 'skirmisher', rounds: 2, statuses: [] } }), 'call');
    const r = play(...duel({ abilities: [CALL] }), use('A', CALL, 'A'), pass('M'), release('A'));
    expect(r.fight!.rows.filter(x => x.kind === 'summon').map(x => [x.name, x.owner])).toEqual([['Sprite', id('A')]]);
  });

  test('a released zone act moves the zone (kits 8.5.4)', () => {
    const LAY = ability('blast', 'lay', null, { range: tiles(20), effect: null, foesOnly: true, cost: { ...HIT.cost, mana: 0 },
      zone: { name: 'Mire', duration: null, ops: [], endsWithOwner: false, around: null, grow: null } });
    const SHIFT = channeled(ability('blast', 'shift', null, { range: tiles(20), effect: null, foesOnly: true, zoneAct: { act: 'shift', name: null, by: 6 } }), 'shift');
    const r = play(add(row('A', 'party', { abilities: [LAY, SHIFT], place: place(5, 2) }), row('M', 'foe', { place: place(5, 12) })), start(['A', 20], ['M', 10]),
      use('A', LAY, place(5, 4)), pass('M'), use('A', SHIFT, place(5, 12)), pass('M'), release('A', rolls({ M: 10 }, { M: [] })));
    const z = running(r).zones[0]!;
    expect(z.ground.kind === 'around' ? z.ground.anchor : null).toEqual({ kind: 'place', at: place(5, 10) });
  });

  test('a body a released push moves into a zone takes its hold and pays no on-entry part (kits 8.3.4)', () => {
    const P3 = channeled(ability('strike', 'push', '1', { ...FAR, ops: [{ op: 'shove', dir: 'away', from: 'user', tiles: 3 }] }), 'push');
    const spikes: Command = { type: 'zoneAdd', zone: { id: zoneId('z1'), name: 'Spikes', tiles: [place(5, 7)], spares: null, tier: 0, duration: null, ops: [{ op: 'damage', type: 'physical', amount: f('20'), when: 'use' }] } };
    const pushed = (...ground: Command[]) => play(add(row('A', 'party', { abilities: [P3], place: place(5, 2) }), row('M', 'foe', { place: place(5, 4) })), ...ground,
      start(['A', 20], ['M', 10]), use('A', P3, 'M'), pass('M'), release('A', rolls({ M: 10 })));
    const m = body(pushed(spikes).fight, 'M');
    expect([m.place, m.statuses.some(x => x.zone === 'z1')]).toEqual([place(5, 7), true]);
    expect(rowHp(m)).toBe(rowHp(body(pushed().fight, 'M')));
  });

  test('a release logs one line naming each target and its number, and tells the GM that line (rule 20)', () => {
    const WIND = channeled(HIT, 'wind');
    const r = play(...duel({ abilities: [WIND] }), use('A', WIND, 'M'), pass('M'));
    const out = reduce(r.fight, release('A', rolls({ M: 10 })), ctx);
    const dealt = rowHp(body(r.fight, 'M')) - rowHp(body(out.fight, 'M'));
    const said = running(out).log.find(l => l.text.includes('is released'))!;
    expect([said.text.endsWith(`M caught ${dealt}.`), said.rows]).toEqual([true, [id('A'), id('M')]]);
    expect(out.effects.find(e => e.type === 'used')).toEqual({ type: 'used', by: id('A'), ability: WIND.id, line: said.text.replace(/^R\d+: /, '') });
  });
});

describe('stagger, shields and threat: data with a rule each', () => {
  test('a full stagger bar costs the monster 1.5 rounds, empties and regrows 75% larger (4.3)', () => {
    const r = play(...duel({}, { stagger: { fill: 0, max: 8, hit: 20 } }), hit('A', 'M'));
    const m = body(r.fight, 'M');
    expect(m.stagger).toEqual({ fill: 0, max: 14, hit: 20, until: tick(1500) });
    expect(m.at).toBe(tick(1500));
    expect(r.effects).toContainEqual({ type: 'staggered', id: id('M') });
  });

  test('a weak hit, under a third of a same-rank hit, fills the bar 1.5 times its damage', () => {
    const r = play(...duel({}, { stagger: { fill: 0, max: 100, hit: 30 } }), hit('A', 'M'));
    expect(body(r.fight, 'M').stagger?.fill).toBe(9 * 1.5);
  });

  const SHIELD = (n: number) => ability('support', `shield${n}`, `${n}`, { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } });
  test('two shields do not add: the larger holds, with the later end (4.4), and it is gone when its time is up', () => {
    const shielder = row('A', 'party', { abilities: [SHIELD(30), SHIELD(20)] });
    const one = play(add(shielder, row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 1], ['M', 1]),
      { type: 'act', by: id('A'), ability: abilityId('shield30'), aim: id('B'), rolls: rolls() });
    expect(body(one.fight, 'B').shield).toEqual({ amount: 30, until: tick(2000) });
    const two = play(add(shielder, row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 1], ['M', 1]),
      { type: 'act', by: id('A'), ability: abilityId('shield30'), aim: id('B'), rolls: rolls() }, pass('B'), pass('M'),
      { type: 'act', by: id('A'), ability: abilityId('shield20'), aim: id('B'), rolls: rolls() });
    expect(body(two.fight, 'B').shield).toEqual({ amount: 30, until: tick(3000) });
    const later = play(add(shielder, row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 1], ['M', 1]),
      { type: 'act', by: id('A'), ability: abilityId('shield30'), aim: id('B'), rolls: rolls() }, pass('B'), pass('M'), pass('A'), pass('B'), pass('M'));
    expect(running(later).now).toBe(tick(2000));
    expect(body(later.fight, 'B').shield).toBeNull();
  });

  test('a monster\'s threat falls 10% a round of time: after two rounds an entry of 100 is 81 (4.2)', () => {
    const r = play(...duel({}, { threat: { [id('A')]: 100 } as Record<CombatantId, number> }), pass('A'), pass('M'), pass('A'), pass('M'));
    expect(running(r).now).toBe(tick(2000));
    expect(body(r.fight, 'M').threat![id('A')]).toBeCloseTo(81, 9);
  });

  const TAUNT = ability('strike', 'taunt', null, {
    effect: null, range: tiles(20), shape: { kind: 'touch', reach: tiles(20) }, delivery: { kind: 'sure' },
    ops: [{ op: 'applyStatus', key: statusKey('taunted'), def: { label: 'Taunted', desc: '', ops: [{ op: 'taunt' }] }, duration: tick(2000) } as UseOp],
  });
  test('a taunt forces the monster to aim at the taunter for 2 rounds, and ends early on a Discipline build (4.2, rule 18)', () => {
    const plain = play(add(row('T', 'party', { abilities: [TAUNT] }), row('B', 'party'), row('M', 'foe', { abilities: [HIT] })), start(['T', 20], ['B', 1], ['M', 10]),
      { type: 'act', by: id('T'), ability: TAUNT.id, aim: id('M'), rolls: rolls() });
    const s = body(plain.fight, 'M').statuses.find(x => x.key === 'taunted')!;
    expect(s.until).toBe(tick(2000));
    refuses(plain.fight, { type: 'act', by: id('M'), ability: HIT.id, aim: id('B'), rolls: rolls({ B: 10 }) }, 'taunted');
    const stubborn = play(add(row('T', 'party', { abilities: [TAUNT] }), row('B', 'party'), row('M', 'foe', { abilities: [HIT], origin: hunterOrigin({ dis: 63 }) })),
      start(['T', 20], ['B', 1], ['M', 10]), { type: 'act', by: id('T'), ability: TAUNT.id, aim: id('M'), rolls: rolls() });
    const m = body(stubborn.fight, 'M');
    expect(m.statuses.find(x => x.key === 'taunted')!.until).toBe(tick(Math.round(2000 * 100 / (100 + m.sheet.tenacity))));
    expect(m.sheet.tenacity).toBeGreaterThan(0);
  });
});

describe('the GM\'s moves', () => {
  test('setIntent shows a monster\'s next use; only a monster has one, and acting clears it', () => {
    const r = play(...duel(), { type: 'setIntent', by: id('M'), ability: HIT.id, aim: id('A') });
    expect(body(r.fight, 'M').intent).toEqual({ ability: HIT.id, aim: id('A'), revealed: false });
    refuses(r.fight, { type: 'setIntent', by: id('A'), ability: HIT.id, aim: id('M') }, 'notMonster');
    const acted = play(...duel(), { type: 'setIntent', by: id('M'), ability: HIT.id, aim: id('A') }, pass('A'), hit('M', 'A'));
    expect(body(acted.fight, 'M').intent).toBeNull();
  });

  test('reveal shows an announced intent\'s numbers; nothing announced, or shown already, is refused', () => {
    refuses(play(...duel()).fight, { type: 'reveal', by: id('M') }, 'noIntent');
    const r = play(...duel(), { type: 'setIntent', by: id('M'), ability: HIT.id, aim: id('A') }, { type: 'reveal', by: id('M') });
    expect(body(r.fight, 'M').intent).toEqual({ ability: HIT.id, aim: id('A'), revealed: true });
    refuses(r.fight, { type: 'reveal', by: id('M') }, 'noChange');
    const again = play(...duel(), { type: 'setIntent', by: id('M'), ability: HIT.id, aim: id('A') }, { type: 'reveal', by: id('M') }, { type: 'setIntent', by: id('M'), ability: HIT.id, aim: id('A') });
    expect(body(again.fight, 'M').intent?.revealed, 'a new intent starts hidden').toBe(false);
  });

  test('place drags a row with no time and no path; a taken tile is refused', () => {
    const r = play(...duel(), { type: 'place', id: id('M'), to: place(19, 13) });
    expect([body(r.fight, 'M').place, body(r.fight, 'M').at]).toEqual([place(19, 13), tick(500)]);
    refuses(r.fight, { type: 'place', id: id('M'), to: place(0, 2) }, 'taken');
  });

  test('a per-round op with dice waits for them; one without pays at its bearer\'s turn start (1.3)', () => {
    const burn = st('burn', 3000, { op: 'damage', type: 'magical', amount: f('1d6') }), sear = st('sear', 3000, { op: 'damage', type: 'magical', amount: f('10') });
    const r = play(...duel({}, { statuses: [burn, sear] }), pass('A'));
    expect(r.effects.filter(e => e.type === 'rollSettle')).toEqual([
      { type: 'rollSettle', id: id('M'), key: statusKey('burn'), dice: [{ count: 1, sides: 6 }], share: 0.5 },
      { type: 'rollSettle', id: id('M'), key: statusKey('sear'), dice: [], share: 0.5 },
    ]);
    const m = body(r.fight, 'M');
    expect(m.sheet.hpMax - rowHp(m)).toBe(5);
    refuses(r.fight, { type: 'settle', id: id('M'), key: statusKey('burn'), dice: [] }, 'needsRoll');
    refuses(r.fight, { type: 'settle', id: id('M'), key: statusKey('sear'), dice: [] }, 'nothingDue');
    const paid = reduce(r.fight, { type: 'settle', id: id('M'), key: statusKey('burn'), dice: [6] }, ctx);
    expect(rowHp(m) - rowHp(body(paid.fight, 'M'))).toBe(3);
    expect(running(paid).pending).toEqual([]);
  });

  test('removing the current row starts the next turn; removing the last foe ends the fight', () => {
    const r = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 10], ['M', 1]), { type: 'remove', id: id('A') });
    expect(running(r).currentId).toBe(id('B'));
    expect(play(...duel(), { type: 'remove', id: id('M') }).fight?.phase).toBe('ended');
  });

  test('end gives the summary, clear closes it, and nothing else applies to an ended fight', () => {
    const r = play(...duel(), pass('A'), { type: 'end' });
    expect(r.fight?.phase).toBe('ended');
    expect(r.effects.at(-1)).toEqual({ type: 'ended', summary: { rounds: 0.5, winner: null, down: [], xp: 0 } });
    refuses(r.fight, pass('M'), 'notNow');
    expect(play(...duel(), { type: 'end' }, { type: 'clear' }).fight).toBeNull();
    refuses(null, { type: 'end' }, 'notNow');
  });
});

// A base body (light kit, every stat 10) has 45 HP (hpBase), 10 mana (manaBase) and a fatigue capacity of 100 (fatigueBase).
const HP = RULES.fight.hpBase, FATIGUE_MAX = RULES.fight.fatigueBase;
const adjust = (at: string, o: { hp?: number; mana?: number; fatigue?: number }): Command => ({ type: 'adjust', id: id(at), ...o });
const def = (label: string, ...ops: Op[]): StatusDef => ({ label, desc: '', ops });
const grant = (key: string, d: StatusDef, duration: number | null, tier = 0): StatusGrant => ({ key: statusKey(key), def: d, duration: duration === null ? null : tick(duration), tier });
const putOn = (at: string, g: StatusGrant): Command => ({ type: 'status', id: id(at), add: g });
const takeOff = (at: string, key: string): Command => ({ type: 'status', id: id(at), remove: statusKey(key) });
const SLOW = def('Slowed', { op: 'speed', pct: -50 }), STUN = def('Stunned', { op: 'hold' }), MARK = def('Marked');
const trio = (m: Partial<NewRow> = {}, n: Partial<NewRow> = {}) => [add(row('A', 'party'), row('M', 'foe', m), row('N', 'foe', n)), start(['A', 20], ['M', 10], ['N', 1])] as const;

describe('refill: a level-up\'s refill of a hunter\'s row, which takes no time', () => {
  test('a hunter\'s row comes back to its maximum HP and mana, and the log says so', () => {
    const r = play(...duel(), adjust('A', { hp: -5, mana: -3 }), { type: 'refill', id: id('A') });
    expect([rowHp(body(r.fight, 'A')), body(r.fight, 'A').mana]).toEqual([HP, RULES.fight.manaBase]);
    expect(running(r).log[0]!.text).toBe('R1: A is refilled: HP +5, mana +3 (level up).');
  });

  test('a monster\'s row, an unknown row, no fight and an ended fight are refused; a full row changes nothing and is not refused', () => {
    const r = play(...duel());
    refuses(r.fight, { type: 'refill', id: id('M') }, 'notHunter');
    refuses(r.fight, { type: 'refill', id: id('ghost') }, 'unknown');
    refuses(play(...duel(), { type: 'end' }).fight, { type: 'refill', id: id('A') }, 'notNow');
    refuses(null, { type: 'refill', id: id('A') }, 'notNow');
    expect(reduce(r.fight, { type: 'refill', id: id('A') }, ctx)).toEqual({ fight: r.fight, effects: [] });
  });
});

describe('adjust: the GM\'s hand edit, which takes no time', () => {
  test('the GM takes 5 HP off a monster: its HP falls by 5, whose turn it is and every wait stay, and the log says so', () => {
    const r = play(...duel(), adjust('M', { hp: -5 }));
    expect(rowHp(body(r.fight, 'M'))).toBe(HP - 5);
    expect([running(r).currentId, body(r.fight, 'A').at, body(r.fight, 'M').at]).toEqual([id('A'), tick(0), tick(500)]);
    expect(running(r).log[0]!.text).toBe('R1: M: HP -5 (GM).');
  });

  test('a hunter on this phone hears its new totals once, each kept within 0 and its maximum', () => {
    const r = play(...duel(), adjust('A', { hp: 50, mana: -99, fatigue: 999 }));
    expect(r.effects.filter(e => e.type === 'vitals')).toEqual([
      { type: 'vitals', hunterId: hunterId('h-A'), life: { at: 'up', hp: HP }, mana: 0, fatigue: FATIGUE_MAX, statuses: [] },
    ]);
  });

  test('an edit that changes nothing, an unknown row, no fight and an ended fight are refused', () => {
    const r = play(...duel());
    refuses(r.fight, adjust('A', { hp: 5 }), 'noChange');
    refuses(r.fight, adjust('ghost', { hp: -1 }), 'unknown');
    refuses(play(...duel(), { type: 'end' }).fight, adjust('A', { hp: -1 }), 'notNow');
    refuses(null, adjust('A', { hp: -1 }), 'notNow');
  });

  test('mana paid as a price outside the fight (a shadow summoned) is taken whole, or refused when the row holds less', () => {
    const r = play(...duel(), adjust('A', { mana: -6 }));
    expect(body(play(...duel(), { type: 'adjust', id: id('A'), mana: -4, pay: true }).fight, 'A').mana).toBe(RULES.fight.manaBase - 4);
    refuses(r.fight, { type: 'adjust', id: id('A'), mana: -5, pay: true }, 'mana');
    expect(body(play(...duel(), adjust('A', { mana: -6 }), adjust('A', { mana: -5 })).fight, 'A').mana, 'a hand edit still stops at 0').toBe(0);
  });

  test('the GM bringing the last foe to 0 defeats it and ends the fight with its XP', () => {
    const r = play(...duel({}, { xp: 25 }), adjust('M', { hp: -999 }));
    expect(r.effects.filter(e => e.type === 'defeated' || e.type === 'ended')).toEqual([
      { type: 'defeated', id: id('M') }, { type: 'ended', summary: { rounds: 0, winner: 'party', down: [id('M')], xp: 25 } },
    ]);
  });

  test('the GM bringing the current hunter to 0 leaves it dying and starts the next turn', () => {
    const r = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 10], ['M', 1]), adjust('A', { hp: -999 }));
    expect(r.effects.find(e => e.type === 'vitals')).toMatchObject({ hunterId: hunterId('h-A'), life: { at: 'dying', successes: 0, failures: 0 } });
    expect([running(r).currentId, running(r).now]).toEqual([id('B'), tick(500)]);
  });

  test('a monster the GM revives after another body took its tile is refused, so no two bodies share a tile', () => {
    const r = play(...trio(), adjust('M', { hp: -999 }), { type: 'place', id: id('N'), to: place(0, 10) });
    expect(body(r.fight, 'M').place).toEqual(place(0, 10));
    refuses(r.fight, { type: 'life', id: id('M'), event: { type: 'revive' } }, 'taken');
  });
});

describe('a row\'s life: every change of a row\'s HP goes through its life (row-life.ts), so only Revive lifts the dead', () => {
  const MEND = { ...ability('support', 'mend', null, FAR), effect: { type: 'heal', by: 'hand', formula: f('20') } } as Ability;
  const life = (at: string, event: RowLifeEvent): Command => ({ type: 'life', id: id(at), event });
  const save = (at: string, roll: number): Command => life(at, { type: 'deathSave', roll });
  const lifeOf = (r: { fight: Fight | null }, name: string): Body['life'] => body(r.fight, name).life;
  const DYING = { at: 'dying', successes: 0, failures: 0 } as const, DEAD = { at: 'dead' } as const;
  /** Hunters A and B against M, and the GM's hand takes A to 0: A is dying (its turn goes to B). */
  const fallen = (): Command[] => [add(row('A', 'party'), row('B', 'party', { abilities: [HIT, MEND] }), row('M', 'foe')), start(['A', 20], ['B', 15], ['M', 10]), adjust('A', { hp: -999 })];
  /** The same, and A fails three death saves (a 2 is one failure each): dead. */
  const dead = (): Command[] => [...fallen(), save('A', 2), save('A', 2), save('A', 2)];
  const mended = (at: string): Command => ({ type: 'act', by: id('B'), ability: MEND.id, aim: id(at), rolls: rolls(), force: true });
  const spring = (at: Place): Command => ({ type: 'zoneAdd', zone: { id: zoneId('spring'), name: 'Spring', tiles: [at], spares: null, tier: 0, duration: null, ops: [{ op: 'heal', amount: f('10'), when: 'use' }] } });

  test('three failed death saves leave a fallen hunter\'s row dead, and its sheet hears each one with the life itself', () => {
    const r = play(...dead());
    expect(lifeOf(r, 'A')).toEqual(DEAD);
    const told = r.effects.flatMap(e => (e.type === 'vitals' && e.hunterId === hunterId('h-A') ? [e.life] : []));
    expect(told).toEqual([DYING, { ...DYING, failures: 1 }, { ...DYING, failures: 2 }, DEAD]);
    expect(running(r).log[0]!.text).toBe('R1: A fails a third death save and dies.');
  });

  test('the GM\'s hand heal stands a fallen hunter\'s row up, and of a dead one it is refused: nothing to change', () => {
    expect(lifeOf(play(...fallen(), adjust('A', { hp: 10 })), 'A')).toEqual({ at: 'up', hp: 10 });
    refuses(play(...dead()).fight, adjust('A', { hp: 10 }), 'noChange');
  });

  test('an ally\'s heal stands a fallen hunter\'s row up and leaves a dead one dead', () => {
    expect(lifeOf(play(...fallen(), mended('A')), 'A').at).toBe('up');
    expect(lifeOf(play(...dead(), mended('A')), 'A')).toEqual(DEAD);
  });

  test('a paid heal (a healing ground\'s entry) stands a fallen hunter\'s row up and leaves a dead one dead', () => {
    const at = body(play(...fallen()).fight, 'A').place;
    expect(lifeOf(play(...fallen(), spring(at)), 'A')).toEqual({ at: 'up', hp: 10 });
    expect(lifeOf(play(...dead(), spring(at)), 'A')).toEqual(DEAD);
  });

  test('a heal land op (a trigger\'s, a threshold\'s, a zone end\'s) stands a fallen hunter\'s row up and leaves a dead one dead', () => {
    const healOf = (b: Body): Body['life'] => {
      const rows = new Map([[b.id, b]]);
      landOps(rows, [{ op: 'heal', amount: f('10'), when: 'use' }], null, [b.id], { id: null, tier: 0 }, tick(0), RULES);
      return rows.get(b.id)!.life;
    };
    expect(healOf(body(play(...fallen()).fight, 'A'))).toEqual({ at: 'up', hp: 10 });
    expect(healOf(body(play(...dead()).fight, 'A'))).toEqual(DEAD);
  });

  test('a level-up\'s refill stands a fallen hunter\'s row up at its maximum and leaves a dead one dead', () => {
    expect(lifeOf(play(...fallen(), { type: 'refill', id: id('A') }), 'A')).toEqual({ at: 'up', hp: HP });
    expect(lifeOf(play(...dead(), { type: 'refill', id: id('A') }), 'A')).toEqual(DEAD);
  });

  test('the GM\'s Revive stands a dead hunter\'s row up at 1 HP: it takes turns again and its sheet hears it', () => {
    const before = play(...dead()), r = play(...dead(), life('A', { type: 'revive' }));
    expect(lifeOf(r, 'A')).toEqual({ at: 'up', hp: REVIVE_HP });
    expect(body(r.fight, 'A').at).toBeGreaterThanOrEqual(running(before).now);
    expect(r.effects.at(-1)).toMatchObject({ type: 'vitals', hunterId: hunterId('h-A'), life: { at: 'up', hp: REVIVE_HP } });
    expect(running(r).log[0]!.text).toBe('R1: A is revived (GM).');
  });

  test('a player\'s hunter\'s row sends its phone the life itself: the fall, each death save, the death and the GM\'s Revive', () => {
    const key = sheetKey('dev-a:h1');
    const r = play(add(row('A', 'party', { holder: { kind: 'remote', remote: key } }), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 15], ['M', 10]), adjust('A', { hp: -999 }),
      save('A', 2), save('A', 2), save('A', 2), life('A', { type: 'revive' }));
    const told = r.effects.flatMap(e => (e.type === 'sendRemote' && e.remote === key ? [e.life] : []));
    expect(told).toEqual([{ at: 'up', hp: HP }, DYING, { ...DYING, failures: 1 }, { ...DYING, failures: 2 }, DEAD, { at: 'up', hp: REVIVE_HP }]);
  });

  test('a player\'s hunter joining the fight tells its phone the row\'s life at once, even unchanged: the row is the one writer from the join', () => {
    const key = sheetKey('dev-a:h1'), a = row('A', 'party', { holder: { kind: 'remote', remote: key }, hp: 0 });
    expect(play(add(a, row('M', 'foe'))).effects.filter(e => e.type === 'sendRemote'), 'into a fight in setup').toEqual([{ type: 'sendRemote', remote: key, life: DYING, mana: 10, fatigue: 0, statuses: [] }]);
    const late = play(add(row('B', 'party'), row('M', 'foe')), start(['B', 20], ['M', 10]), join([a], openings(['A', 10])));
    expect(late.effects.flatMap(e => (e.type === 'sendRemote' ? [e.life] : [])), 'into a running fight').toEqual([DYING]);
  });

  test('a defeated monster comes back only by the GM\'s Revive, at 1 HP: a hand heal of it is refused', () => {
    const r = play(...trio(), adjust('M', { hp: -999 }));
    expect(lifeOf(r, 'M')).toEqual(DEAD);
    refuses(r.fight, adjust('M', { hp: 10 }), 'noChange');
    expect(lifeOf(play(...trio(), adjust('M', { hp: -999 }), life('M', { type: 'revive' })), 'M')).toEqual({ at: 'up', hp: REVIVE_HP });
  });

  test('Revive of a row that is not dead is refused, and so is a death save or Stabilize of a row not dying, and a death save that is no d20 face', () => {
    const r = play(...trio());
    refuses(r.fight, life('A', { type: 'revive' }), 'lifeCannot');
    refuses(r.fight, life('M', { type: 'revive' }), 'lifeCannot');
    refuses(r.fight, save('A', 15), 'lifeCannot');
    refuses(play(...fallen()).fight, life('A', { type: 'revive' }), 'lifeCannot');
    refuses(play(...dead()).fight, life('A', { type: 'stabilize' }), 'lifeCannot');
    const down = play(...trio(), adjust('M', { hp: -999 }));
    refuses(down.fight, life('M', { type: 'stabilize' }), 'lifeCannot');
    refuses(down.fight, save('M', 15), 'lifeCannot');
    refuses(play(...fallen()).fight, save('A', 21), 'needsRoll');
    refuses(r.fight, life('ghost', { type: 'revive' }), 'unknown');
    refuses(null, life('A', { type: 'revive' }), 'notNow');
    refuses(play(...dead(), { type: 'end' }).fight, life('A', { type: 'revive' }), 'notNow');
  });
});

describe('status: the GM\'s Status window, which takes no time', () => {
  test('a status with a shield op of 1d6 + 17 gives its bearer a shield of 20.5 rounded, 21, for as long as it lasts; a hit takes the shield first', () => {
    const WARD = def('Ward', { op: 'shield', amount: f('1d6 + 17') });
    const r = play(...duel(), putOn('A', grant('ward', WARD, 2000)));
    // the average of 1d6 is 3.5 (statusShield reads the average: the Status window rolls no dice)
    expect(body(r.fight, 'A').shield).toEqual({ amount: 21, until: tick(2000) });
    // HIT is 10 before armor, 9 after the light kit's 10 (rule 12): the shield takes all 9
    const after = play(...duel(), putOn('A', grant('ward', WARD, 2000)), pass('A'), hit('M', 'A'));
    expect([rowHp(body(after.fight, 'A')), body(after.fight, 'A').shield?.amount]).toEqual([HP, 12]);
  });

  test('a slow of 2 rounds goes on from the GM at its tier, ends 2000 ticks from now, and halves the speed so the wait left doubles', () => {
    const r = play(...duel(), putOn('M', grant('slowed', SLOW, 2000, 3)));
    const m = body(r.fight, 'M');
    expect(m.statuses).toEqual([{ key: statusKey('slowed'), def: SLOW, source: { id: null, tier: 3 }, until: tick(2000), since: tick(0), settledAt: tick(0) }]);
    expect([m.speed, m.at, running(r).currentId]).toEqual([50, tick(1000), id('A')]);
  });

  test('a stun on the current hunter ends its turn as a use would: it waits a standard action, the next row acts, and its sheet hears of the stun', () => {
    const r = play(...duel(), putOn('A', grant('stunned', STUN, 3000)));
    expect([running(r).currentId, running(r).now, body(r.fight, 'A').at]).toEqual([id('M'), tick(500), tick(1000)]);
    // the sheet hears the time left as the command leaves the fight, at 500: 3000 - 500 ticks is 2.5 rounds
    expect(r.effects.filter(e => e.type === 'vitals')).toEqual([{
      type: 'vitals', hunterId: hunterId('h-A'), life: { at: 'up', hp: HP }, mana: 10, fatigue: 0,
      statuses: [{ key: statusKey('stunned'), def: STUN, source: { id: null, tier: 0 }, rounds: 2.5 }],
    }]);
  });

  test('the GM takes a status off and the sheet hears it is gone; taking off one the row lacks is refused', () => {
    const r = play(...duel({ statuses: [st('marked', 3000)] }), takeOff('A', 'marked'));
    expect(body(r.fight, 'A').statuses).toEqual([]);
    expect(r.effects.filter(e => e.type === 'vitals').map(e => e.type === 'vitals' && e.statuses)).toEqual([[]]);
    refuses(r.fight, takeOff('A', 'marked'), 'noChange');
    refuses(r.fight, { type: 'status', id: id('A') }, 'noChange');
  });

  test('in setup the GM\'s status and hand edit stand from the start, and the sheet hears of both', () => {
    const r = play(add(row('A', 'party'), row('M', 'foe')), putOn('A', grant('marked', MARK, 2000)), adjust('A', { hp: -3 }));
    expect(r.fight?.phase).toBe('setup');
    expect(r.effects.filter(e => e.type === 'vitals').map(e => e.type === 'vitals' && [e.life, e.statuses.map(x => [x.key, x.rounds])])).toEqual([
      [{ at: 'up', hp: HP }, [['marked', 2]]], [{ at: 'up', hp: HP - 3 }, [['marked', 2]]],
    ]);
  });

  test('a hunter on another phone hears of a status with the rounds left in tenths, rounded up as every time left is: 1340 ticks is 1.4 rounds', () => {
    const r = play(...duel({ holder: { kind: 'remote', remote: sheetKey('dev-a:h1') } }), pass('A'), putOn('A', grant('marked', MARK, 1340, 2)));
    expect(running(r).now).toBe(tick(500));
    expect(r.effects.filter(e => e.type === 'sendRemote').at(-1)).toMatchObject({
      remote: 'dev-a:h1', statuses: [{ key: statusKey('marked'), def: MARK, source: { id: null, tier: 2 }, rounds: 1.4 }],
    });
  });

  test('a status that runs out reaches the sheet: when time passes its end, the hunter\'s next vitals no longer lists it', () => {
    const r = play(...duel({ statuses: [st('marked', 1000)] }), pass('A'), pass('M'));
    expect(running(r).now).toBe(tick(1000));
    expect(r.effects.filter(e => e.type === 'vitals')).toEqual([
      { type: 'vitals', hunterId: hunterId('h-A'), life: { at: 'up', hp: HP }, mana: 10, fatigue: 0, statuses: [] },
    ]);
  });

  test('a slow the GM puts on a monster that is down leaves its turn time as it was, so the fight can still be stored', () => {
    const r = play(...trio(), adjust('M', { hp: -999 }), pass('A'), putOn('M', grant('slowed', def('Slowed', { op: 'speed', pct: -70 }), 2000)));
    expect(running(r).now).toBe(tick(950));
    expect(body(r.fight, 'M').at).toBe(tick(500));
    expect(parseFight(JSON.parse(JSON.stringify(r.fight)), RULES)).not.toBeNull();
  });
});

describe('who holds a row\'s sheet, and the XP of the foes', () => {
  test('a shadow\'s HP goes back to its hunter\'s list as shadowHp, and nothing else is written for it', () => {
    const shadow = row('S', 'party', { kind: 'shadow', holder: { kind: 'shadow', hunterId: hunterId('h-1'), shadowId: shadowId('s-1') } });
    const r = play(add(shadow, row('M', 'foe')), start(['S', 20], ['M', 10]), pass('S'), hit('M', 'S'));
    expect(r.effects.filter(e => e.type === 'shadowHp' || e.type === 'vitals' || e.type === 'sendRemote')).toEqual([
      { type: 'shadowHp', hunterId: hunterId('h-1'), shadowId: shadowId('s-1'), hp: HP - 9 },
    ]);
  });

  test('a foe removed while down keeps its XP for the summary, and one removed while up gives none', () => {
    const base = [add(row('A', 'party'), row('M', 'foe', { xp: 30 }), row('N', 'foe', { xp: 50 }), row('O', 'foe', { xp: 70 })),
      start(['A', 20], ['M', 1], ['N', 1], ['O', 1]), hit('A', 'M', BIG), { type: 'remove', id: id('M') }, { type: 'remove', id: id('N') }] as const;
    expect(play(...base, { type: 'end' }).effects.at(-1)).toMatchObject({ type: 'ended', summary: { xp: 30 } });
    expect(play(...base, adjust('O', { hp: -999 })).effects.at(-1)).toMatchObject({ type: 'ended', summary: { winner: 'party', xp: 100 } });
  });
});

describe('a stored row holds only its own kind\'s fields (SMX-rules-8)', () => {
  const WOLF: Origin = { kind: 'monster', name: 'Wolf', rank: 'E', archetype: 'brute', monsterKind: 'normal', tweak: { hp: 1, stats: {} } };
  const stored = (): { rows: Record<string, unknown>[] } => JSON.parse(JSON.stringify(play(add(
    row('A', 'party'), row('M', 'foe', { origin: WOLF, xp: 30 }),
    row('S', 'party', { kind: 'shadow', origin: WOLF, holder: { kind: 'shadow', hunterId: hunterId('h-A'), shadowId: shadowId('s-1') } }),
    row('U', 'foe', { kind: 'summon', origin: WOLF, owner: id('M'), until: tick(5000) }),
  ), start(['A', 20], ['M', 10], ['S', 5], ['U', 1])).fight));
  /** The stored fight with row `name`'s fields changed (`undefined` drops one), read back. */
  const edited = (name: string, patch: Record<string, unknown>) => {
    const f = stored();
    f.rows = f.rows.map(r => (r.id === name ? JSON.parse(JSON.stringify({ ...r, ...patch })) : r));
    return parseFight(f, RULES);
  };
  const local = { kind: 'local', hunterId: 'h-A' }, bar = { fill: 0, max: 10, hit: 5 }, intent = { ability: 'hit', aim: 'A', revealed: false };

  test('a fight of a hunter, a monster, a shadow and a summon, each with its own fields, reads back as it was', () => {
    const f = stored();
    expect(parseFight(f, RULES)).toEqual(JSON.parse(JSON.stringify(f)));
  });

  test('a row that holds a field of another kind does not read, and its fight reads as none', () => {
    const cases: [string, string, Record<string, unknown>][] = [
      ['a hunter with a stagger bar', 'A', { stagger: bar }],
      ['a hunter with an extraction', 'A', { extraction: { at: 'open', tried: 1 } }],
      ['a hunter with a threat table', 'A', { threat: {} }],
      ['a hunter with an intent', 'A', { intent }],
      ['a hunter worth XP', 'A', { xp: 30 }],
      ['a hunter with an owner', 'A', { owner: 'M' }],
      ['a hunter held as a shadow', 'A', { holder: { kind: 'shadow', hunterId: 'h-A', shadowId: 's-1' } }],
      ['a monster held by a hunter', 'M', { holder: local }],
      ['a monster with an owner and an end', 'M', { owner: 'A', until: 5000 }],
      ['a monster with no threat table', 'M', { threat: null }],
      ['a shadow held by a hunter', 'S', { holder: local }],
      ['a shadow with a stagger bar', 'S', { stagger: bar }],
      ['a shadow with a threat table', 'S', { threat: {} }],
      ['a summon with no owner', 'U', { owner: undefined }],
      ['a summon with no end', 'U', { until: undefined }],
      ['a summon with an intent', 'U', { intent }],
      ['a summon worth XP', 'U', { xp: 10 }],
      ['a summon with an extraction', 'U', { extraction: { at: 'open', tried: 1 } }],
    ];
    for (const [what, name, patch] of cases) expect(edited(name, patch), what).toBeNull();
  });
});

describe('the reducer never changes its input', () => {
  test('a fight frozen deep through a hit, a walk and a channel comes out new', () => {
    const deep = <T>(v: T): T => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deep(x); } return v; };
    const r = play(...duel());
    const frozen = deep(r.fight);
    expect(() => reduce(frozen, hit('A', 'M'), ctx)).not.toThrow();
    expect(() => reduce(frozen, { type: 'move', by: id('A'), to: place(1, 3) }, ctx)).not.toThrow();
  });
});


describe('the ground: the GM paints terrain and puts zones down (4.7, 5.3)', () => {
  const paint = (terrain: Terrain, ...at: [number, number][]): Command => ({ type: 'paint', tiles: at.map(([x, y]) => place(x, y)), terrain });
  const fire = (o: Partial<ZoneDraft> = {}): Command => ({
    type: 'zoneAdd', zone: { id: zoneId('z1'), name: 'Fire', tiles: [place(5, 5)], spares: null, tier: 0, duration: tick(2000), ops: [], ...o },
  });

  test('a painted wall is on the grid at once, no time passes, and painting it again is refused as no change', () => {
    const r = play(...duel(), paint('wall', [3, 3], [4, 3]));
    const g = running(r).grid;
    expect([g.tiles![3 * g.w + 3], g.tiles![3 * g.w + 4], g.tiles![3 * g.w + 5]]).toEqual(['wall', 'wall', 'floor']);
    expect(running(r).now).toBe(running(play(...duel())).now);
    refuses(r.fight, paint('wall', [3, 3]), 'noChange');
  });

  test('a tile a body stands on takes cover or rough ground but not a wall or a pit; a tile off the grid is refused', () => {
    expect(running(play(...duel(), paint('rough', [0, 2]))).grid.tiles![2 * 20]).toBe('rough');
    refuses(play(...duel()).fight, paint('wall', [0, 2]), 'taken');
    refuses(play(...duel()).fight, paint('pit', [0, 10]), 'taken');
    refuses(play(...duel()).fight, paint('wall', [20, 0]), 'offGrid');
  });

  test('a zone the GM puts down ends its duration after now; one id once, and an unknown one cannot be removed', () => {
    const r = play(...duel(), fire());
    const now = running(play(...duel())).now;
    expect(running(r).zones).toEqual([{ id: 'z1', name: 'Fire', ground: { kind: 'tiles', tiles: [place(5, 5)] }, spares: null, tier: 0, until: tick(now + 2000), owner: null, endsWithOwner: false, ops: [] }]);
    refuses(r.fight, fire(), 'duplicate');
    refuses(r.fight, { type: 'zoneRemove', id: zoneId('z9') }, 'unknown');
    expect(running(play(...duel(), fire(), { type: 'zoneRemove', id: zoneId('z1') })).zones).toEqual([]);
  });

  test('a zone with no tiles or a tile off the grid is refused, and a seventeenth zone is one too many', () => {
    refuses(play(...duel()).fight, fire({ tiles: [] }), 'noChange');
    refuses(play(...duel()).fight, fire({ tiles: [place(0, 14)] }), 'offGrid');
    const sixteen = Array.from({ length: MAX_ZONES }, (_, i) => fire({ id: zoneId(`z${i}`) }));
    refuses(play(...duel(), ...sixteen).fight, fire({ id: zoneId('z99') }), 'tooMany');
  });

  test('rows join at their side\'s start tiles in order (one whose asked tile is held takes the next start), and past the starts the default line', () => {
    const starts = { party: [place(5, 5), place(6, 5)], foe: [place(9, 9)] };
    const r = play({ type: 'add', fightId: fightId('f-1'), rows: [row('A', 'party'), row('M', 'foe'), row('B', 'party', { place: place(5, 5) }), row('C', 'party')], openings: [], starts });
    expect(r.fight!.rows.map(x => [x.id, x.place])).toEqual([['A', place(5, 5)], ['M', place(9, 9)], ['B', place(6, 5)], ['C', place(0, 2)]]);
  });

  test('a row that joins a running fight has its statuses from the fight\'s now: the fight, not the screen, starts its clock', () => {
    const r = play(...duel(), pass('A'));
    const now = running(r).now, slow: StatusDef = { label: 'Slowed', desc: '', ops: [] };
    const late = row('B', 'party', { statuses: [{ key: statusKey('slowed'), def: slow, source: { id: null, tier: 0 }, until: tick(2000), since: tick(0), settledAt: tick(0) }] });
    const joined = play(...duel(), pass('A'), { type: 'add', fightId: fightId('f-1'), rows: [late], openings: [{ id: id('B'), d20: 10, tie: 0 }] });
    expect(now).toBeGreaterThan(0);
    expect(body(joined.fight, 'B').statuses.map(s => [s.since, s.until])).toEqual([[now, now + 2000]]);
  });

  test('a running fight still reads after the GM lowers a rule a maximum reads: each row keeps at most its new maximum', () => {
    const r = play(...duel());
    const lower = { ...RULES, fight: { ...RULES.fight, hpBase: RULES.fight.hpBase - 20, manaBase: RULES.fight.manaBase - 5 } };
    const back = parseFight(JSON.parse(JSON.stringify(r.fight)), lower);
    expect(back).not.toBeNull();
    const a = back!.rows.find(x => x.id === 'A')!;
    expect([rowHp(a), a.mana]).toEqual([a.sheet.hpMax, Math.min(body(r.fight, 'A').mana, a.sheet.manaMax)]);
    expect(a.sheet.hpMax).toBeLessThan(rowHp(body(r.fight, 'A')));
  });

  test('a fight with walls and zones round-trips through parseFight', () => {
    const r = play(...duel(), paint('wall', [3, 3]), paint('cover', [4, 4]), fire());
    expect(parseFight(JSON.parse(JSON.stringify(r.fight)), RULES)).toEqual(r.fight);
  });
});

describe('a zone on the ground (4.7)', () => {
  const N = (n: number) => ({ kind: 'number' as const, value: n });
  const zone = (name: string, at: [number, number][], ops: Op[], o: Partial<ZoneDraft> = {}): Command => ({
    type: 'zoneAdd', zone: { id: zoneId(name), name, tiles: at.map(([x, y]) => place(x, y)), spares: null, tier: 0, duration: null, ops, ...o },
  });
  const burn = (n: number): Op => ({ op: 'damage', type: 'magical', amount: N(n) });
  /** The duel with A standing in `cmds`'s zones from the start of its first turn, then A and M passing `turns` times each. */
  const inFire = (turns: number, ...cmds: Command[]) => {
    const out = play(...duel(), ...cmds, ...Array.from({ length: turns }, () => [pass('A'), pass('M')]).flat());
    return { r: out, t0: running(play(...duel())).now };
  };

  test('a body that stands in a fire of 10 a round pays it for the time inside at its turn start, as a status settles', () => {
    const { r, t0 } = inFire(1, zone('Fire', [[0, 2]], [burn(10)]));
    const a = body(r.fight, 'A'), start = body(play(...duel()).fight, 'A');
    // A's turn starts again a round after it passed: 10 a round for (now - t0) ticks, a round being 1000
    expect(running(r).currentId).toBe(id('A'));
    expect(rowHp(start) - rowHp(a)).toBe(Math.round(10 * (running(r).now - t0) / RULES.fight.round));
    expect(a.statuses.some(s => s.def.label === 'Fire' && s.until === null)).toBe(true);
  });

  test('what a fire pays over a span does not depend on how the span is split into turns', () => {
    const rate = 7, one = inFire(1, zone('Fire', [[0, 2]], [burn(rate)])), three = inFire(3, zone('Fire', [[0, 2]], [burn(rate)]));
    const paid = (x: typeof one) => rowHp(body(play(...duel()).fight, 'A')) - rowHp(body(x.r.fight, 'A'));
    expect(paid(one)).toBe(Math.round(rate * (running(one.r).now - one.t0) / RULES.fight.round));
    expect(paid(three)).toBe(Math.round(rate * (running(three.r).now - three.t0) / RULES.fight.round));
  });

  test('a zone\'s part that acts on use pays once on each entry: twice in, twice paid; standing still pays nothing more', () => {
    const spike = zone('Spikes', [[1, 2]], [{ op: 'damage', type: 'physical', amount: N(5), when: 'use' }]);
    /** Plays `cmds` for A, each on A's turn: whoever's turn it is before passes. */
    const asA = (...cmds: Command[]) => {
      let f: Fight | null = play(...duel(), spike).fight;
      for (const c of cmds) {
        while (running({ fight: f }).currentId !== 'A') f = reduce(f, pass(running({ fight: f }).currentId), ctx).fight;
        f = reduce(f, c, ctx).fight;
      }
      return f;
    };
    const step = (x: number): Command => ({ type: 'move', by: id('A'), to: place(x, 2) });
    const hp0 = rowHp(body(play(...duel()).fight, 'A'));
    expect(hp0 - rowHp(body(asA(step(1)), 'A'))).toBe(5);
    expect(hp0 - rowHp(body(asA(step(1), pass('A'), pass('A')), 'A'))).toBe(5);
    expect(hp0 - rowHp(body(asA(step(1), step(2), step(1)), 'A'))).toBe(10);
  });

  test('two slowing zones on one tile apply the stronger slow, not both, and a slow holds only while the body stands inside', () => {
    const slow = (name: string, pct: number) => zone(name, [[0, 2]], [{ op: 'speed', pct }]);
    const r = play(...duel(), slow('Mud', -20), slow('Ice', -40));
    expect(body(r.fight, 'A').speed).toBeCloseTo(100 * 0.6, 5);
    const out = play(...duel(), slow('Mud', -20), slow('Ice', -40), { type: 'place', id: id('A'), to: place(5, 5) });
    expect(body(out.fight, 'A').speed).toBe(100);
  });

  test('a zone that spares a side touches only the other side', () => {
    const r = play(...duel(), zone('Ward', [[0, 2], [0, 10]], [{ op: 'speed', pct: -50 }], { spares: 'party' }));
    expect([body(r.fight, 'A').speed, body(r.fight, 'M').speed]).toEqual([100, 50]);
  });

  test('a zone ends at its time and is gone from the fight; its body pays only to that end', () => {
    const { r, t0 } = inFire(2, zone('Fire', [[0, 2]], [burn(10)], { duration: tick(500) }));
    expect(running(r).zones).toEqual([]);
    expect(running(r).log.some(l => l.text.includes('Fire is gone.'))).toBe(true);
    expect(rowHp(body(play(...duel()).fight, 'A')) - rowHp(body(r.fight, 'A'))).toBe(Math.round(10 * 500 / RULES.fight.round));
    expect(body(r.fight, 'A').statuses.filter(s => s.zone !== undefined)).toEqual([]);
    void t0;
  });

  test('an ability that leaves a field puts its zone on its shape where it landed, owned by its user, and it ends when its owner goes down', () => {
    const lava: Ability = { ...ability('blast', 'lava', '1', { range: tiles(20) }), zone: { name: 'Burning ground', duration: null, ops: [burn(4)], endsWithOwner: true, around: null, grow: null } };
    const r = play(...duel({}, { abilities: [lava] }), { type: 'act', by: id('M'), ability: lava.id, aim: place(5, 5), rolls: rolls(), force: true });
    const z = running(r).zones[0]!;
    // a blast's ring reaches 3 tiles (RULES.fight.abilityKinds.blast): the tiles within 3 of (5, 5) by the 5-10-5 count
    const within = Array.from({ length: 14 * 20 }, (_, i) => place(i % 20, Math.floor(i / 20))).filter(p => dist(p, place(5, 5)) <= RULES.fight.abilityKinds.blast.ring);
    expect([z.name, z.owner, z.until, zoneTiles(z, running(r).rows, running(r).grid, running(r).now, RULES).length]).toEqual(['Burning ground', 'M', null, within.length]);
    expect(z.ground).toEqual({ kind: 'around', anchor: { kind: 'place', at: place(5, 5) }, radius: RULES.fight.abilityKinds.blast.ring, grow: null });
    const down = play(...duel({}, { abilities: [lava] }), { type: 'act', by: id('M'), ability: lava.id, aim: place(5, 5), rolls: rolls(), force: true },
      { type: 'place', id: id('A'), to: place(5, 3) }, { type: 'adjust', id: id('M'), hp: -999 });
    expect(down.fight!.phase).toBe('ended');
  });

  test('a GM\'s zone removed mid-fight closes the hold of who stood in it', () => {
    const r = play(...duel(), zone('Ice', [[0, 2]], [{ op: 'speed', pct: -40 }]), { type: 'zoneRemove', id: zoneId('Ice') });
    expect(body(r.fight, 'A').speed).toBe(100);
    expect(body(r.fight, 'A').statuses).toEqual([]);
  });

  // ── an aura (design 4.8) ──
  const glow: Op = { op: 'stat', key: 'agi', amount: 10 };
  /** A support on its user that leaves an aura of `radius` around it holding `ops`. */
  const auraOf = (ops: Op[], radius = 1, o: Partial<Ability> = {}): Ability => ({
    ...ability('support', 'aura', null, { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, ...o }),
    zone: { name: 'Glow', duration: null, ops, endsWithOwner: true, around: tiles(radius), grow: null },
  });
  /** A with the aura at (0, 2), its ally B and the foe M where they are put; A acts first. */
  const trio = (a: Ability, b: [number, number], m: [number, number]): Command[] => [
    add(row('A', 'party', { abilities: [HIT, a] }), row('B', 'party', { place: place(...b) }), row('M', 'foe', { place: place(...m) })),
    start(['A', 20], ['B', 5], ['M', 10]),
  ];
  const cast = (a: Ability): Command => ({ type: 'act', by: id('A'), ability: a.id, aim: id('A'), rolls: rolls() });
  /** Plays `cmds` from `f`, each on A's turn: whoever's turn it is before passes. */
  const onA = (f: Fight | null, ...cmds: Command[]): Fight | null => {
    let g = f;
    for (const c of cmds) {
      while (running({ fight: g }).currentId !== 'A') g = reduce(g, pass(running({ fight: g }).currentId), ctx).fight;
      const r = reduce(g, c, ctx);
      if (r.effects.some(e => e.type === 'refused')) throw new Error(`${c.type} refused: ${JSON.stringify(r.effects)}`);
      g = r.fight;
    }
    return g;
  };
  const inAura = (fight: Fight | null, who: string, name = 'Glow'): boolean => body(fight, who).statuses.some(s => s.def.label === name && s.zone !== undefined && s.until === null);
  const step = (x: number, y: number): Command => ({ type: 'move', by: id('A'), to: place(x, y) });

  test('an aura lies around its user, holds the user, and moves with it on a step and on the GM\'s drag', () => {
    const a = auraOf([glow]);
    const r = play(...trio(a, [2, 2], [0, 10]), cast(a));
    const z = running(r).zones[0]!;
    expect(z.ground).toEqual({ kind: 'around', anchor: { kind: 'body', id: 'A', status: null }, radius: 1, grow: null });
    expect([inAura(r.fight, 'A'), inAura(r.fight, 'B')]).toEqual([true, false]);
    const near = onA(r.fight, step(1, 2));
    expect(zoneTiles(z, near!.rows, near!.grid, running({ fight: near }).now, RULES)).toContainEqual(place(2, 2));
    expect([inAura(near, 'A'), inAura(near, 'B')]).toEqual([true, true]);
    const dragged = reduce(near, { type: 'place', id: id('A'), to: place(8, 8) }, ctx).fight;
    expect([inAura(dragged, 'A'), inAura(dragged, 'B')]).toEqual([true, false]);
  });

  test('an aura moves with its user when a blast makes the user dodge', () => {
    const a = auraOf([glow], 1), boom = ability('blast', 'boom', '1', { range: tiles(20) });
    const r = play(add(row('A', 'party', { abilities: [HIT, a] }), row('M', 'foe', { abilities: [boom] })), start(['A', 20], ['M', 10]), cast(a));
    // M's blast at A: A's d20 of 20 takes it out of the blast's reach (rule 8a), and the aura goes with it
    const out = play(add(row('A', 'party', { abilities: [HIT, a] }), row('M', 'foe', { abilities: [boom] })), start(['A', 20], ['M', 10]), cast(a),
      { type: 'act', by: id('M'), ability: boom.id, aim: place(0, 2), rolls: rolls({ A: 20 }), force: true });
    const to = body(out.fight, 'A').place;
    expect(to).not.toEqual(body(r.fight, 'A').place);
    const z = running(out).zones[0]!;
    expect(zoneTiles(z, running(out).rows, running(out).grid, running(out).now, RULES)).toContainEqual(to);
    expect(zoneTiles(z, running(out).rows, running(out).grid, running(out).now, RULES).every(p => dist(p, to) <= 1)).toBe(true);
  });

  test('a foe the aura comes over pays its entry once, and nothing more while the aura moves and it stays inside', () => {
    const spikes: Op = { op: 'damage', type: 'physical', amount: N(5), when: 'use' };
    const a = auraOf([spikes], 1, { foesOnly: true });
    const r = play(...trio(a, [0, 5], [2, 2]), cast(a));
    const hp0 = rowHp(body(r.fight, 'M'));
    const came = onA(r.fight, step(1, 2));
    expect(hp0 - rowHp(body(came, 'M'))).toBe(5);
    expect(inAura(came, 'A')).toBe(false);
    const stayed = onA(came, step(1, 3), { type: 'endTurn', by: id('A') });
    expect(hp0 - rowHp(body(stayed, 'M'))).toBe(5);
  });

  test('an aura ends when its user goes down, and closes the hold of who stood in it', () => {
    const a = auraOf([glow]);
    const r = play(...trio(a, [1, 2], [0, 10]), cast(a));
    expect(inAura(r.fight, 'B')).toBe(true);
    const down = play(...trio(a, [1, 2], [0, 10]), cast(a), { type: 'adjust', id: id('A'), hp: -9999 });
    expect(running(down).zones).toEqual([]);
    expect(inAura(down.fight, 'B')).toBe(false);
    expect(running(down).log.some(l => l.text.includes('Glow is gone.'))).toBe(true);
  });

  test('an aura does not pass a wall: an ally behind one is outside it, and inside it without the wall', () => {
    const a = auraOf([glow], 2);
    const open = play(...trio(a, [2, 2], [0, 10]), cast(a));
    const walled = play(...trio(a, [2, 2], [0, 10]), { type: 'paint', tiles: [place(1, 2)], terrain: 'wall' }, cast(a));
    expect([inAura(open.fight, 'B'), inAura(walled.fight, 'B')]).toEqual([true, false]);
  });

  test('an aura of an ability on its user spares the other side; one marked foes only spares the user\'s', () => {
    const help = play(...trio(auraOf([glow]), [0, 10], [1, 2]), cast(auraOf([glow])));
    expect(running(help).zones[0]!.spares).toBe('foe');
    expect(inAura(help.fight, 'M')).toBe(false);
    const harm = play(...trio(auraOf([glow], 1, { foesOnly: true }), [0, 10], [1, 2]), cast(auraOf([glow], 1, { foesOnly: true })));
    expect(running(harm).zones[0]!.spares).toBe('party');
    expect([inAura(harm.fight, 'A'), inAura(harm.fight, 'M')]).toEqual([false, true]);
  });

  test('a status with an aura gives off its other ops around its bearer while it lasts; the bearer is not inside its own', () => {
    const sick: StatusDef = { label: 'Glow', desc: '', ops: [glow, { op: 'aura', radius: 1, on: 'all' }] };
    const give: Command = { type: 'status', id: id('M'), add: { key: statusKey('sick'), def: sick, duration: tick(3000), tier: 2 } };
    const r = play(...trio(auraOf([]), [5, 9], [5, 10]), give);
    const z = running(r).zones.find(x => x.name === 'Glow')!;
    expect(z.ground).toEqual({ kind: 'around', anchor: { kind: 'body', id: 'M', status: 'sick' }, radius: 1, grow: null });
    expect([z.ops, z.tier, z.owner, z.spares]).toEqual([[glow], 2, null, null]);
    expect([inAura(r.fight, 'M'), inAura(r.fight, 'B')]).toEqual([false, true]);
    const cured = play(...trio(auraOf([]), [5, 9], [5, 10]), give, { type: 'status', id: id('M'), remove: statusKey('sick') });
    expect([running(cured).zones, inAura(cured.fight, 'B')]).toEqual([[], false]);
  });

  // ── a field that grows (design 4.8) ──
  test('a blast\'s field grows a tile of radius each whole round from its centre to its cap, and reaches a body as it grows', () => {
    const lava: Ability = { ...ability('blast', 'lava', '1', { range: tiles(20) }), zone: { name: 'Spreading fire', duration: null, ops: [glow], endsWithOwner: false, around: null, grow: { step: tiles(1), cap: tiles(5) } } };
    // M's blast centred on (5, 6) with a ring to 3; B stands 5 tiles from the centre: outside now, inside after two rounds
    const cmds = [add(row('A', 'party', { place: place(0, 2) }), row('B', 'party', { place: place(5, 1) }), row('M', 'foe', { abilities: [lava], place: place(0, 10) })),
      start(['A', 20], ['B', 5], ['M', 10]), { type: 'act', by: id('M'), ability: lava.id, aim: place(5, 6), rolls: rolls(), force: true } as Command];
    const radiusOf = (f: Fight) => { const z = f.zones[0]!, at = zoneTiles(z, f.rows, f.grid, running({ fight: f }).now, RULES); return Math.max(...at.map(p => dist(p, place(5, 6)))); };
    let f = play(...cmds).fight!;
    const t0 = running({ fight: f }).now, seen: [number, number, boolean][] = [];
    for (let n = 0; n < 30 && running({ fight: f }).now < t0 + 3500; n++) {
      seen.push([Math.floor((running({ fight: f }).now - t0) / RULES.fight.round), radiusOf(f), inAura(f, 'B', 'Spreading fire')]);
      f = reduce(f, pass(running({ fight: f }).currentId), ctx).fight!;
    }
    for (const [rounds, radius, inside] of seen) {
      expect(radius).toBe(Math.min(5, RULES.fight.abilityKinds.blast.ring + rounds));
      expect(inside).toBe(radius >= 5);
    }
    expect(seen.some(([, , inside]) => inside)).toBe(true);
  });

  test('an aura that grows keeps its body at its centre as it grows; its cap is at most the rules\' widest field', () => {
    const a: Ability = { ...auraOf([glow], 1), zone: { name: 'Glow', duration: null, ops: [glow], endsWithOwner: true, around: tiles(1), grow: { step: tiles(2), cap: tiles(99) } } };
    const r = play(...trio(a, [9, 9], [0, 13]), cast(a));
    const g = running(r).zones[0]!.ground;
    // A acts first, at time 0
    expect(g.kind === 'around' && g.grow).toEqual({ step: 2, cap: RULES.fight.fieldRadiusMax, from: 0 });
    const later = onA(r.fight, step(1, 3));
    const z = running({ fight: later }).zones[0]!, now = running({ fight: later }).now, at = zoneTiles(z, later!.rows, later!.grid, now, RULES);
    expect(Math.max(...at.map(p => dist(p, place(1, 3))))).toBe(Math.min(RULES.fight.fieldRadiusMax, 1 + 2 * Math.floor(now / RULES.fight.round)));
  });

  // ── a sickness that spreads (design 4.8) ──
  const plague: StatusDef = { label: 'Plague', desc: '', ops: [{ op: 'damage', type: 'physical', amount: N(1) }, { op: 'spread', range: 1 }] };
  const sicken = (who: string, duration: number | null = 3000): Command => ({ type: 'status', id: id(who), add: { key: statusKey('plague'), def: plague, duration: duration === null ? null : tick(duration), tier: 1 } });
  /** Plays `cmds`, then passes every turn until `until` says stop, answering each spread's dice with `d20`. */
  const sick = (d20: number, until: (f: Running) => boolean, ...cmds: Command[]) => {
    let f = play(...cmds).fight as Running;
    const effects: Effect[] = [];
    for (let n = 0; n < 40 && !until(f); n++) {
      const p = f.pending.find(x => 'spread' in x);
      const r = p && 'spread' in p ? reduce(f, { type: 'settle', id: p.id, key: p.spread.key, dice: p.spread.targets.map(() => d20) }, ctx) : reduce(f, pass(f.currentId), ctx);
      effects.push(...r.effects);
      f = r.fight as Running;
    }
    return { f, effects };
  };
  const has = (f: Fight, who: string) => body(f, who).statuses.some(s => s.key === 'plague');

  test('a sickness passes to a body next to its bearer once a round of holding it has passed, on a failed resist, from the same source', () => {
    const r = sick(1, f => has(f, 'B'), ...trio(auraOf([]), [1, 2], [0, 10]), sicken('A'));
    const caught = body(r.f, 'B').statuses.find(s => s.key === 'plague')!;
    expect(caught.source).toEqual({ id: null, tier: 1 });
    expect(caught.until! - caught.since).toBe(3000);
    expect(r.effects.some(e => e.type === 'rollSettle' && e.key === 'plague-spread' && e.dice.length === 1)).toBe(true);
    expect(r.f.log.some(l => l.text.includes('B catches Plague.'))).toBe(true);
    expect(has(r.f, 'M')).toBe(false);
  });

  test('a body that resists does not catch it, and one out of reach or behind a wall is never asked', () => {
    const resisted = sick(20, f => f.now > 4000, ...trio(auraOf([]), [1, 2], [0, 10]), sicken('A'));
    expect(has(resisted.f, 'B')).toBe(false);
    expect(resisted.f.log.some(l => l.text.includes('B resists Plague.'))).toBe(true);
    const far = sick(1, f => f.now > 4000, ...trio(auraOf([]), [2, 2], [0, 10]), sicken('A'));
    expect(far.effects.some(e => e.type === 'rollSettle' && e.key === 'plague-spread')).toBe(false);
    const walled = sick(1, f => f.now > 4000, ...trio(auraOf([]), [2, 2], [0, 10]), { type: 'paint', tiles: [place(1, 2)], terrain: 'wall' }, sicken('A', null));
    expect(walled.effects.some(e => e.type === 'rollSettle' && e.key === 'plague-spread')).toBe(false);
  });

  test('a sickness never returns to a body that has had it: two bodies cannot hand it back and forth, so it ends', () => {
    // A is sick for 1.5 rounds; B catches it, A's ends, then B's settles next to A for 3 rounds and A is never asked
    const r = sick(1, f => f.now > 9000, ...trio(auraOf([]), [1, 2], [0, 10]), sicken('A', 1500));
    expect(r.f.had['plague' as never]).toEqual(['A', 'B']);
    const asked = r.effects.flatMap(e => e.type === 'rollSettle' && e.key === 'plague-spread' ? [e.id] : []);
    expect(asked).toEqual(['A']);
    expect([has(r.f, 'A'), has(r.f, 'B')]).toEqual([false, false]);
  });

  test('a fight with auras round-trips through parseFight', () => {
    const sick: StatusDef = { label: 'Sick', desc: '', ops: [glow, { op: 'aura', radius: 2, on: 'foes' }] };
    const r = play(...trio(auraOf([glow]), [2, 2], [3, 3]), cast(auraOf([glow])), { type: 'status', id: id('M'), add: { key: statusKey('sick'), def: sick, duration: null, tier: 0 } });
    expect(running(r).zones).toHaveLength(2);
    expect(parseFight(JSON.parse(JSON.stringify(r.fight)), RULES)).toEqual(r.fight);
  });
});

describe('the map\'s size in a fight under way (design 4.8)', () => {
  const resize = (w: number, h: number): Command => ({ type: 'resize', w, h });
  const at = (f: Fight, x: number, y: number) => f.grid.tiles?.[y * f.grid.w + x] ?? 'floor';

  test('growing adds floor at the right and the bottom: nobody moves, a wall stays where it was, no time passes', () => {
    const before = play(...duel(), { type: 'paint', tiles: [place(19, 13)], terrain: 'wall' });
    const r = play(...duel(), { type: 'paint', tiles: [place(19, 13)], terrain: 'wall' }, resize(24, 16));
    const f = running(r);
    expect([f.grid.w, f.grid.h, at(f, 19, 13), at(f, 23, 15), at(f, 20, 13)]).toEqual([24, 16, 'wall', 'floor', 'floor']);
    expect(f.rows.map(x => x.place)).toEqual(running(before).rows.map(x => x.place));
    expect(f.now).toBe(running(before).now);
    expect(f.log[0]!.text).toContain('The GM makes the map 24 by 16.');
  });

  test('shrinking under a body is refused, and so is a size past the bounds or no change', () => {
    const r = play(...duel());
    refuses(r.fight, resize(20, 10), 'cutOff');
    refuses(r.fight, resize(3, 14), 'offGrid');
    refuses(r.fight, resize(41, 14), 'offGrid');
    refuses(r.fight, resize(20, 14), 'noChange');
  });

  test('shrinking under a tile an intent aims at is refused; once the aim is inside it shrinks', () => {
    const aimed = play(...duel(), { type: 'setIntent', by: id('M'), ability: HIT.id, aim: place(15, 12) });
    refuses(aimed.fight, resize(12, 12), 'cutOff');
    expect(running(play(...duel(), resize(12, 12))).grid).toEqual({ w: 12, h: 12, tiles: null });
  });

  test('shrinking clips a painted zone to what is left inside, drops one with nothing left, and keeps the fog of what is inside', () => {
    const zone = (zid: string, tiles: [number, number][]): Command => ({ type: 'zoneAdd', zone: { id: zoneId(zid), name: zid, tiles: tiles.map(([x, y]) => place(x, y)), spares: null, tier: 0, duration: null, ops: [] } });
    const cmds = [add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10])];
    const r = play(...cmds, zone('Mud', [[3, 3], [15, 3]]), zone('Far', [[18, 12]]), resize(12, 12));
    expect(running(r).zones.map(z => [z.id, z.ground])).toEqual([['Mud', { kind: 'tiles', tiles: [place(3, 3)] }]]);
    const fogged = play({ ...add(row('A', 'party'), row('M', 'foe')), fog: { sight: tiles(4), seen: '0'.repeat(20 * 14) } } as Command, start(['A', 20], ['M', 10]), resize(12, 12));
    const f = running(fogged);
    expect(f.fog!.seen).toHaveLength(12 * 12);
    // A at (0, 2) sees 4 tiles: (4, 2) is seen and (5, 2) is not
    expect([f.fog!.seen[2 * 12 + 4], f.fog!.seen[2 * 12 + 5]]).toEqual(['1', '0']);
  });

  test('a fight made smaller round-trips through parseFight, a monster down beyond the edge moved inside', () => {
    const r = play(add(row('A', 'party'), row('M', 'foe'), row('N', 'foe', { place: place(18, 12) })), start(['A', 20], ['M', 10], ['N', 5]),
      { type: 'adjust', id: id('N'), hp: -9999 }, resize(12, 12));
    expect(body(r.fight, 'N').place).toEqual(place(11, 11));
    expect(parseFight(JSON.parse(JSON.stringify(r.fight)), RULES)).toEqual(r.fight);
  });
});

describe('a delayed effect (kits design 1.6, table 2.2)', () => {
  const hemo = (cleanse: 'cancel' | 'land', stack?: StackDef['stack']): StatusDef => ({
    label: 'Hemoplague', desc: '', ops: [], end: { ops: [{ op: 'damage', type: 'physical', amount: f('10'), when: 'use' }], cleanse }, ...(stack ? { stack } : {}),
  } as StatusDef);
  const curse = (def: StatusDef, stacks = 1) => ability('curse', 'hemoplague', null, { ...FAR, effect: null, delivery: { kind: 'sure' },
    ops: [{ op: 'applyStatus', key: statusKey('hemo'), def, duration: tick(1000), ...(stacks > 1 ? { stacks } : {}) }] });
  const cleanse = ability('curse', 'cleanse', null, { ...FAR, effect: null, delivery: { kind: 'sure' }, ops: [{ op: 'cureStatus', key: statusKey('hemo') }] });
  const sheets = (fight: Fight | null) => ({ a: body(fight, 'A').sheet, m: body(fight, 'M').sheet });
  const lost = (fight: Fight | null, name: string) => { const b = body(fight, name); return b.sheet.hpMax - rowHp(b); };
  const use = (a: Ability, at = 'M'): Command => ({ type: 'act', by: id('A'), ability: a.id, aim: id(at), rolls: rolls() });

  test('the machine, cell by cell: armed lands when due, a cure cancels or sets it off, a price, a fall and the fight\'s end land nothing', () => {
    for (const end of ENDS) {
      expect(endStep(ARMED, { type: 'due' }, end)).toEqual({ to: { at: 'landed' }, lands: true });
      expect(endStep(ARMED, { type: 'cure' }, end)).toEqual(end.cleanse === 'land' ? { to: { at: 'landed' }, lands: true } : { to: { at: 'cancelled' }, lands: false });
      for (const type of ['spent', 'down', 'fightEnds'] as const) expect(endStep(ARMED, { type }, end).lands).toBe(false);
      for (const at of ['landed', 'cancelled', 'void'] as const) for (const e of WALK_EVENTS) expect(endStep({ at }, e, end)).toEqual({ to: { at }, lands: false });
    }
  });

  test('its end lands on its bearer at the bearer\'s first turn start at or after its end, from the source, through the bearer\'s armor', () => {
    const ab = curse(hemo('cancel'));
    const before = play(...duel({ abilities: [ab] }), use(ab), pass('M'));
    expect([lost(before.fight, 'M'), body(before.fight, 'M').statuses.length]).toEqual([0, 1]);
    const after = play(...duel({ abilities: [ab] }), use(ab), pass('M'), pass('A'));
    const { a, m } = sheets(after.fight);
    expect([lost(after.fight, 'M'), body(after.fight, 'M').statuses]).toEqual([afterDefence(10, 'physical', a, m, RULES), []]);
    expect(after.fight!.log.some(l => l.text.includes('M: Hemoplague lands'))).toBe(true);
  });

  test('a stacking one lands times its stacks', () => {
    const ab = curse(hemo('cancel', { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null }), 3);
    const r = play(...duel({ abilities: [ab] }), use(ab), pass('M'), pass('A'));
    const { a, m } = sheets(r.fight);
    expect(lost(r.fight, 'M')).toBe(afterDefence(30, 'physical', a, m, RULES));
  });

  test('one whose stacks leave each round still lands when its time and its last round end on the same turn, at the count it held (the owner, Nov 20)', () => {
    const fading = (stacks: number) => curse(hemo('cancel', { cap: 5, leave: { kind: 'round' }, keep: 'fight', threshold: null }), stacks);
    for (const [stacks, dealt] of [[1, 10], [3, 30]] as const) {
      const ab = fading(stacks), r = play(...duel({ abilities: [ab] }), use(ab), pass('M'), pass('A'));
      const { a, m } = sheets(r.fight);
      expect([lost(r.fight, 'M'), body(r.fight, 'M').statuses]).toEqual([afterDefence(dealt, 'physical', a, m, RULES), []]);
      expect(r.fight!.log.some(l => l.text.includes('M: Hemoplague lands'))).toBe(true);
      expect(r.fight!.log.some(l => l.text.includes('wears off'))).toBe(false);
    }
  });

  test('a cure saves its bearer by default, and sets off at once one whose cleanse lands', () => {
    const saved = play(...duel({ abilities: [curse(hemo('cancel')), cleanse] }), use(curse(hemo('cancel'))), pass('M'), use(cleanse), pass('M'), pass('A'));
    expect([lost(saved.fight, 'M'), body(saved.fight, 'M').statuses]).toEqual([0, []]);
    const bomb = curse(hemo('land'));
    const set = play(...duel({ abilities: [bomb, cleanse] }), use(bomb), pass('M'), use(cleanse));
    const { a, m } = sheets(set.fight);
    expect(lost(set.fight, 'M')).toBe(afterDefence(10, 'physical', a, m, RULES));
    // the screens mark what went off (the table's burst), and nothing when the cure saved
    expect(set.effects).toContainEqual({ type: 'burst', id: id('M') });
    expect(saved.effects.some(e => e.type === 'burst')).toBe(false);
  });

  test('it is never written to a sheet: the fight\'s end voids it', () => {
    const r = play(...duel(), { type: 'status', id: id('A'), add: { key: statusKey('hemo'), def: hemo('cancel'), duration: tick(1000), tier: 0 } });
    const v = r.effects.filter(e => e.type === 'vitals');
    expect(v.length).toBeGreaterThan(0);
    for (const e of v) if (e.type === 'vitals') expect(e.statuses.map(s => s.key)).not.toContain('hemo');
    expect(body(r.fight, 'A').statuses.map(s => s.key)).toContain('hemo');
  });
});

describe('a zone on the ground: the kits\' upkeep, cap per owner and end (kits design 1.8, table 2.6)', () => {
  const ten = { kind: 'number' as const, value: 10 };
  const hit10: Op = { op: 'damage', type: 'physical', amount: ten, when: 'use' };
  /** A self ability that leaves a field of radius 1 around its user (an aura with no status: it holds its user too). */
  const boundary = (o: Partial<NonNullable<Ability['zone']>> = {}, name = 'boundary') => ability('support', name, null, {
    aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null,
    zone: { name: 'Boundary', duration: null, ops: [], endsWithOwner: false, around: tiles(1), grow: null, ...o },
  });
  const lay = (a: Ability): Command => ({ type: 'act', by: id('A'), ability: a.id, aim: id('A'), rolls: rolls(), force: true });
  const self = (fight: Fight | null) => body(fight, 'A').sheet;

  test('the machine, cell by cell: paid stays, unpaid lapses, a fourth evicts, a price or its time lands only when a round old, its owner down lands nothing', () => {
    const laid = { at: 'laid' } as const;
    expect(zoneStep(laid, { type: 'paid' })).toEqual({ to: laid, lands: false });
    expect(zoneStep(laid, { type: 'unpaid' })).toEqual({ to: { at: 'lapsed' }, lands: false });
    expect(zoneStep(laid, { type: 'fourth' })).toEqual({ to: { at: 'evicted' }, lands: false });
    for (const type of ['price', 'time'] as const) for (const old of [true, false]) expect(zoneStep(laid, { type, old })).toEqual({ to: { at: 'ended', landed: old }, lands: old });
    expect(zoneStep(laid, { type: 'ownerDown' })).toEqual({ to: { at: 'ended', landed: false }, lands: false });
    for (const z of [{ at: 'lapsed' }, { at: 'evicted' }, { at: 'ended', landed: true }] as const) for (const e of ZONE_WALK) expect(zoneStep(z, e)).toEqual({ to: z, lands: false });
  });

  test('its owner pays the upkeep at its turn start for the time since it last paid, and a zone it cannot pay lapses with no end', () => {
    const keep = boundary({ upkeep: { fatigue: 10, mana: 0 }, end: [hit10] });
    const paid = play(...duel({ abilities: [keep] }), lay(keep), pass('M'));
    // laid at 0; A's next turn at 1000 pays a round of 10 fatigue on top of the support's own 6
    expect([body(paid.fight, 'A').fatigue, running(paid).zones.length]).toEqual([RULES.fight.abilityKinds.support.fatigue + 10, 1]);
    const broke = play(...duel({ abilities: [keep] }), lay(keep), { type: 'adjust', id: id('A'), fatigue: 999 }, pass('M'));
    expect([running(broke).zones, rowHp(body(broke.fight, 'A'))]).toEqual([[], self(broke.fight).hpMax]);
    expect(running(broke).log.some(l => l.text.includes('Boundary ends: '))).toBe(true);
  });

  test('a fourth zone of one owner evicts its oldest, with no end', () => {
    const keep = boundary({ end: [hit10] });
    const r = play(...duel({ abilities: [keep] }), lay(keep), lay(keep), lay(keep), lay(keep));
    const z = running(r).zones;
    expect(z.length).toBe(RULES.fight.kit.zonesPerOwner);
    expect(rowHp(body(r.fight, 'A'))).toBe(self(r.fight).hpMax);
    expect(running(r).log.some(l => l.text.includes('Boundary gives way'))).toBe(true);
  });

  test('its end lands on who stands in it when its time passes a round or more after it was laid; younger, nothing lands', () => {
    const late = boundary({ duration: tick(1500), end: [hit10] }), soon = boundary({ duration: tick(500), end: [hit10] });
    const r = play(...duel({ abilities: [late] }), lay(late), pass('M'), pass('A'));
    expect(self(r.fight).hpMax - rowHp(body(r.fight, 'A'))).toBe(afterDefence(10, 'physical', self(r.fight), self(r.fight), RULES));
    const y = play(...duel({ abilities: [soon] }), lay(soon), pass('M'), pass('A'));
    expect(self(y.fight).hpMax - rowHp(body(y.fight, 'A'))).toBe(0);
  });

  test('a zone price ends the user\'s zone of that name and lands its end once it is a round old; with none it is refused', () => {
    const keep = boundary({ end: [hit10] });
    const pop = ability('support', 'pop', null, { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, prices: [{ kind: 'zone', name: 'Boundary', take: 'one' }] });
    refuses(play(...duel({ abilities: [keep, pop] })).fight, lay(pop), 'zone');
    const r = play(...duel({ abilities: [keep, pop] }), lay(keep), pass('M'), lay(pop));
    expect([running(r).zones, self(r.fight).hpMax - rowHp(body(r.fight, 'A'))]).toEqual([[], afterDefence(10, 'physical', self(r.fight), self(r.fight), RULES)]);
  });

  test('a zone\'s triggers ride on its hold: a body that starts its turn inside sets them off', () => {
    const pain: StackDef = { label: 'Pain', desc: '', ops: [], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
    const harmony: ZoneDraft = {
      id: zoneId('harmony'), name: 'Harmony', tiles: [place(0, 10)], spares: null, tier: 0, duration: null, ops: [],
      triggers: [{ on: 'turnStart', to: 'self', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: statusKey('pain'), def: pain, duration: null }] }],
    };
    const r = play(...duel(), { type: 'zoneAdd', zone: harmony }, pass('A'));
    expect(body(r.fight, 'M').statuses.find(s => s.key === 'pain')?.stacks).toBe(1);
  });

  test('a zone\'s end that downs every body at a turn\'s start ends the fight with no side standing, and no one takes that turn', () => {
    // A stands on (0, 2) and M on (0, 10), the sides' lines; the zone holds both, ends at 1500 and lands 999 on each
    const doom: ZoneDraft = { id: zoneId('doom'), name: 'Doom', tiles: [place(0, 2), place(0, 10)], spares: null, tier: 0, duration: tick(1500), ops: [], end: [{ ...hit10, amount: f('999') }] };
    let fight: Fight | null = play(...duel(), { type: 'zoneAdd', zone: doom }).fight;
    let last: readonly Effect[] = [];
    for (let n = 0; n < 6 && fight?.phase === 'running'; n++) {
      const r = reduce(fight, pass(fight.currentId), ctx);
      last = r.effects;
      fight = r.fight;
    }
    expect(fight?.phase).toBe('ended');
    expect(last.at(-1)).toMatchObject({ type: 'ended', summary: { winner: null } });
    expect(new Set((fight as Extract<Fight, { phase: 'ended' }>).summary.down)).toEqual(new Set([id('A'), id('M')]));
    const fell = last.findIndex(e => e.type === 'defeated');
    expect(fell, 'the zone\'s end downed M in the pass that ended the fight').toBeGreaterThan(-1);
    expect(last.some(e => e.type === 'vitals' && e.hunterId === hunterId('h-A') && e.life.at === 'dying'), 'A\'s fall reaches its sheet').toBe(true);
    expect(last.slice(fell).some(e => e.type === 'turnStarted'), 'no turn began after the zone downed both').toBe(false);
  });
});

describe('a timed summon (kits design 1.9, table 2.4)', () => {
  const sprite = (rounds = 2, name = 'call') => ability('support', name, null, {
    aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, summon: { name: 'Sprite', archetype: 'skirmisher', rounds, statuses: [] },
  });
  const call = (a: Ability, by = 'A'): Command => ({ type: 'act', by: id(by), ability: a.id, aim: id(by), rolls: rolls(), force: true });
  const summons = (fight: Fight | null) => fight!.rows.filter(r => r.kind === 'summon');

  test('the machine, cell by cell: a turn before its end keeps it; a late turn, its owner gone, HP 0, a third and the fight\'s end send it away', () => {
    expect(summonStep('present', { type: 'turn', late: false })).toBe('present');
    for (const e of SUMMON_WALK.filter(x => !(x.type === 'turn' && !x.late))) expect(summonStep('present', e)).toBe('gone');
    for (const e of SUMMON_WALK) expect(summonStep('gone', e)).toBe('gone');
  });

  test('rule 18d: it joins its user\'s side on the free tile nearest its user, owned by it, its first turn a standard interval from now', () => {
    const a = sprite();
    const r = play(...duel({ abilities: [a] }), call(a));
    const s = summons(r.fight)[0]!, user = body(r.fight, 'A');
    expect([s.side, s.owner, s.until, s.holder, s.xp]).toEqual(['party', id('A'), tick(2 * RULES.fight.round), null, 0]);
    expect(dist(s.place, user.place)).toBe(tiles(1));
    expect(s.at).toBe(tick(Math.round(RULES.fight.round * RULES.fight.cost.standard / s.speed)));
    expect(running(r).log.some(l => l.text.includes('A calls Sprite'))).toBe(true);
  });

  test('it leaves at its first turn start at or after its end, before it acts', () => {
    const a = sprite(1);
    let fight: Fight | null = play(...duel({ abilities: [a] }), call(a)).fight;
    for (let i = 0; i < 12 && summons(fight).length; i++) fight = reduce(fight, pass(running({ fight }).currentId), ctx).fight;
    expect(summons(fight)).toEqual([]);
    expect(running({ fight }).now).toBeGreaterThanOrEqual(RULES.fight.round);
    expect(running({ fight }).log.some(l => l.text.includes('Sprite leaves: its time is up'))).toBe(true);
  });

  // Random play found it: the GM removed a summoner while its summon's turn ran, and the fight kept a current row it no longer held.
  test('when its owner leaves during the summon\'s own turn, the summon goes and the next turn starts', () => {
    const a = sprite(3);
    let fight: Fight | null = play(add(row('A', 'party', { abilities: [a] }), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 1], ['M', 1]), call(a)).fight;
    for (let i = 0; i < 12 && running({ fight }).currentId !== summons(fight)[0]?.id; i++) fight = reduce(fight, pass(running({ fight }).currentId), ctx).fight;
    expect(body(fight, running({ fight }).currentId).kind).toBe('summon');
    const r = reduce(fight, { type: 'remove', id: id('A') }, ctx);
    expect(summons(r.fight)).toEqual([]);
    expect(r.fight!.rows.some(x => x.id === running(r).currentId)).toBe(true);
  });

  test('a third summon of one owner sends its oldest away; its owner going down sends them all; and a summon keeps no side up', () => {
    const a = sprite();
    const three = play(...duel({ abilities: [a] }), call(a), call(a), call(a));
    expect(summons(three.fight).length).toBe(RULES.fight.kit.summons);
    const down = play(...duel({ abilities: [a] }, { abilities: [a] }), call(a, 'M'), { type: 'adjust', id: id('M'), hp: -999 });
    expect([summons(down.fight), down.fight!.phase]).toEqual([[], 'ended']);
    expect((down.fight as Extract<Fight, { phase: 'ended' }>).summary.winner).toBe('party');
  });
});

describe('a limited use (kits design 1.4, table 2.3)', () => {
  const twice = ability('strike', 'twice', '10', { ...FAR, gates: [{ kind: 'uses', per: 'fight', n: 2 }] });
  const daily = ability('strike', 'daily', '10', { ...FAR, gates: [{ kind: 'uses', per: 'rest', n: 1 }] });
  const fightGate = { kind: 'uses', per: 'fight', n: 2 } as const, restGate = { kind: 'uses', per: 'rest', n: 2 } as const;

  test('the machine, cell by cell: a use counts down to spent, a spent one is refused, the fight\'s end or a long rest gives its own kind back, the GM sets it', () => {
    expect(usesStep({ at: 'ready', left: 2 }, { type: 'used' }, fightGate)).toEqual({ at: 'ready', left: 1 });
    expect(usesStep({ at: 'ready', left: 1 }, { type: 'used' }, fightGate)).toEqual({ at: 'spent' });
    expect(usesStep({ at: 'spent' }, { type: 'used' }, fightGate)).toEqual({ at: 'spent' });
    expect([usesStep({ at: 'spent' }, { type: 'fightEnds' }, fightGate), usesStep({ at: 'spent' }, { type: 'fightEnds' }, restGate)]).toEqual([{ at: 'ready', left: 2 }, { at: 'spent' }]);
    expect([usesStep({ at: 'spent' }, { type: 'longRest' }, restGate), usesStep({ at: 'spent' }, { type: 'longRest' }, fightGate)]).toEqual([{ at: 'ready', left: 2 }, { at: 'spent' }]);
    for (const u of [{ at: 'spent' }, { at: 'ready', left: 2 }] as const) expect(usesStep(u, { type: 'gmSets', spent: 1 }, fightGate)).toEqual({ at: 'ready', left: 1 });
    for (const e of USES_WALK) expect(['ready', 'spent']).toContain(usesStep({ at: 'ready', left: 1 }, e, restGate).at);
  });

  test('two uses a fight: each that resolves is counted on the row, the third is refused and changes nothing', () => {
    const r = play(...duel({ abilities: [twice] }), hit('A', 'M', twice), hit('M', 'A'), hit('A', 'M', twice), hit('M', 'A'));
    expect(body(r.fight, 'A').used).toEqual({ [twice.id]: 2 });
    refuses(r.fight, hit('A', 'M', twice), 'noUses');
  });

  test('the GM reads words for a use refused with no uses left, never the refusal\'s key (implicit audit 3, C5)', () => {
    const r = play(...duel({ abilities: [twice] }), hit('A', 'M', twice), hit('M', 'A'), hit('A', 'M', twice), hit('M', 'A'));
    const no = reduce(r.fight, hit('A', 'M', twice), ctx).effects.find(e => e.type === 'refused');
    const words = no?.type === 'refused' ? REFUSAL_WORDS[no.reason] : undefined;
    expect(words).toBe('No uses left.');
    for (const reason of TABLE_REFUSALS) expect(TABLE_REFUSAL_WORDS[reason], `a player's words for ${reason}`).toMatch(/^[A-Z].*\.$/);
  });

  test('a use the rules refuse for another reason is not counted', () => {
    const far = ability('strike', 'far', '10', { gates: [{ kind: 'uses', per: 'fight', n: 1 }] });
    const r = play(...duel({ abilities: [far] }));
    refuses(r.fight, hit('A', 'M', far), 'range');
    expect(body(r.fight, 'A').used).toBeUndefined();
  });

  test('the GM sets the uses spent with the fight\'s adjust', () => {
    const r = play(...duel({ abilities: [twice] }), hit('A', 'M', twice), hit('M', 'A'), hit('A', 'M', twice), { type: 'adjust', id: id('A'), used: { ability: twice.id, spent: 0 } });
    expect(body(r.fight, 'A').used).toEqual({ [twice.id]: 0 });
    refuses(r.fight, { type: 'adjust', id: id('A'), used: { ability: HIT.id, spent: 0 } }, 'unknownAbility');
  });

  test('one a rest is written back with the hunter\'s vitals, and a row that starts with it spent refuses it', () => {
    const r = play(...duel({ abilities: [daily] }), hit('A', 'M', daily));
    const v = r.effects.filter(e => e.type === 'vitals').at(-1);
    expect(v?.type === 'vitals' && v.used).toEqual({ [daily.id]: 1 });
    refuses(play(...duel({ abilities: [daily], used: { [daily.id]: 1 } })).fight, hit('A', 'M', daily), 'noUses');
  });

  test('round trip: a use a rest spent in a fight is still spent on the sheet after it, and a long rest gives it back', () => {
    const r = play(...duel({ abilities: [daily] }), hit('A', 'M', daily));
    const v = r.effects.filter(e => e.type === 'vitals').at(-1);
    if (v?.type !== 'vitals') throw new Error('no vitals effect');
    const before = { ...newHunter(RULES), used: {} };
    const after = sheetEdit(before, { type: 'totals', life: v.life, mana: v.mana, fatigue: v.fatigue, statuses: v.statuses, used: v.used ?? {} }, RULES);
    if (isRefused(after)) throw new Error(after.why);
    expect(after.used).toEqual({ [daily.id]: 1 });
    refuses(play(...duel({ abilities: [daily], used: after.used })).fight, hit('A', 'M', daily), 'noUses');
    const rested = rest(after, 'long', { hpMax: 100, manaMax: 100, fatigueMax: 100 }, RULES);
    expect(rested.used).toEqual({});
    expect(play(...duel({ abilities: [daily], used: rested.used }), hit('A', 'M', daily)).effects.some(e => e.type === 'refused')).toBe(false);
    const kept = sheetEdit(after, { type: 'totals', life: v.life, mana: v.mana, fatigue: v.fatigue, statuses: v.statuses }, RULES);
    expect(!isRefused(kept) && kept.used).toEqual({ [daily.id]: 1 });
  });
});

describe('a monster\'s kind shortens nothing that lands on it (the owner, Nov 21: a boss is tougher by its HP, not by halving effects)', () => {
  const ROUND = RULES.fight.round;
  const STUN = ability('curse', 'stun', null, { ...FAR, effect: null, ops: [{ op: 'applyStatus', key: statusKey('stunned'), def: { label: 'Stunned', desc: '', ops: [{ op: 'hold' }] }, duration: tick(2 * ROUND) }] });
  const SLOW = ability('curse', 'slow', null, { ...FAR, effect: null, ops: [{ op: 'applyStatus', key: statusKey('slowed'), def: { label: 'Slowed', desc: '', ops: [{ op: 'speed', pct: -30 }] }, duration: tick(2 * ROUND) }] });
  const of = (kind: MonsterKind): Origin => ({ kind: 'monster', name: 'Monster', rank: 'C', archetype: 'brute', monsterKind: kind, tweak: { hp: 1, stats: {} } });
  /** How long the status `a` puts on lasts on a monster of `kind` at rank C, from A's use. */
  const lasts = (a: Ability, key: string, kind: MonsterKind): number => {
    const m = body(play(add(row('A', 'party', { abilities: [a] }), row('M', 'foe', { origin: of(kind) })), start(['A', 20], ['M', 10]), hit('A', 'M', a)).fight, 'M');
    const s = m.statuses.find(x => x.key === key)!;
    return s.until! - s.since;
  };

  test('a stun or a slow on a boss or an elite lasts as long as on a normal monster of its rank', () => {
    for (const [a, key] of [[STUN, 'stunned'], [SLOW, 'slowed']] as const) {
      const normal = lasts(a, key, 'normal');
      expect(normal, key).toBeGreaterThan(0);
      expect([lasts(a, key, 'elite'), lasts(a, key, 'boss')], key).toEqual([normal, normal]);
    }
  });
});

describe('wards and stealth (kits design 8.1 and 8.7, tables 8.9.4 and 8.9.5)', () => {
  const ROUND = RULES.fight.round;
  const self = (name: string, ...ops: Op[]): Ability => ability('support', name, null, { aim: 'self', effect: null, shape: { kind: 'self' },
    ops: [{ op: 'applyStatus', key: statusKey(name), def: { label: name, desc: '', ops }, duration: tick(3 * ROUND) }] });
  const VEIL = self('veil', { op: 'untargetable' }), STONE = self('stone', { op: 'invulnerable' }), HIDE = self('hide', { op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } });
  const SLOW = ability('curse', 'slow', null, { ...FAR, effect: null, ops: [{ op: 'applyStatus', key: statusKey('slowed'), def: { label: 'Slowed', desc: '', ops: [{ op: 'speed', pct: -30 }] }, duration: tick(2 * ROUND) }] });
  const use = (by: string, a: Ability, at: string = by): Command => ({ type: 'act', by: id(by), ability: a.id, aim: id(at), rolls: rolls({ [at]: 10 }) });
  const keys = (fight: Fight | null, name: string) => body(fight, name).statuses.map(x => x.key);

  test('an untargetable body cannot be aimed at by a foe, its ward lasts a round at most, and acting on a foe ends it', () => {
    const veiled = play(...duel({ abilities: [HIT, VEIL] }), use('A', VEIL));
    const a = body(veiled.fight, 'A'), now = running(play(...duel())).now;
    expect(a.statuses.find(x => x.key === 'veil')!.until).toBe(tick(now + ROUND));
    refuses(veiled.fight, hit('M', 'A'), 'noTarget');
    const struck = play(...duel({ abilities: [HIT, VEIL] }, { abilities: [HIT] }), use('A', VEIL), pass('M'), hit('A', 'M'));
    expect(keys(struck.fight, 'A')).not.toContain('veil');
  });

  test('a ward reaches a body once a fight: the second does nothing', () => {
    const r = play(...duel({ abilities: [HIT, VEIL] }), use('A', VEIL), pass('M'), hit('A', 'M'), pass('M'), use('A', VEIL));
    expect(keys(r.fight, 'A')).not.toContain('veil');
    expect(body(r.fight, 'A').warded).toEqual(['untargetable']);
  });

  test('an invulnerable body is not taken under 1 HP; its shield still takes the hit first', () => {
    const r = play(...duel({ abilities: [HIT, STONE] }), use('A', STONE), hit('M', 'A', BIG));
    expect(rowHp(body(r.fight, 'A'))).toBe(1);
  });

  test('a safeguard stops a harmful status from a foe, never a friend\'s', () => {
    const guarded = st('guard', null, { op: 'safeguard' });
    const foe = play(add(row('A', 'party', { statuses: [guarded] }), row('M', 'foe', { abilities: [SLOW] })), start(['M', 20], ['A', 10]), use('M', SLOW, 'A'));
    expect(keys(foe.fight, 'A')).toEqual(['guard']);
    const kind = { ...SLOW, aim: 'ally', foesOnly: false } as const;
    const friend = play(add(row('B', 'party', { abilities: [kind] }), row('A', 'party', { statuses: [guarded] }), row('M', 'foe')), start(['B', 20], ['A', 10], ['M', 5]), use('B', kind, 'A'));
    expect(keys(friend.fight, 'A')).toEqual(['guard', 'slowed']);
  });

  // A hide is played by its own fields (docs/agent-handoff/features/notes-7-stealth.md section 4, with the owner's rulings
  // at its end): where it may start, and which of a hurt, a reveal and damage its bearer deals end it.
  const wall: Command = { type: 'paint', tiles: Array.from({ length: 20 }, (_, x) => place(x, 6)), terrain: 'wall' };
  const ends = (o: Partial<Record<'hurt' | 'revealed' | 'dealt', boolean>> = {}) => ({ hurt: true, revealed: true, dealt: true, ...o });
  // a blast at a place reaches over the wall, where a touch would need to see its target
  const BOOM = ability('blast', 'boom', '5', { range: tiles(20) });
  const SLOWS = ability('blast', 'slows', null, { range: tiles(20), effect: null, ops: SLOW.ops });
  /** A behind the wall from M, with these abilities besides HIT and HIDE and these statuses, hides on its first turn. */
  const hiding = (abilities: Ability[], statuses: Status[] = []) =>
    [add(row('A', 'party', { abilities: [HIT, HIDE, ...abilities], statuses }), row('M', 'foe')), wall, start(['A', 20], ['M', 10]), use('A', HIDE)] as const;
  /** A use of `a` by `by` at a place, on `who` there, whose d20 of 1 cannot get it out. */
  const atPlace = (by: string, a: Ability, to: Place, who: string): Command => ({ type: 'act', by: id(by), ability: a.id, aim: to, rolls: rolls({ [who]: 1 }, { [who]: [] }) });
  /** The GM burns A, and its burn pays on A's next turn. */
  const burnt: readonly Command[] = [
    { type: 'status', id: id('A'), add: { key: statusKey('burn'), def: st('burn', null, { op: 'damage', type: 'magical', amount: f('3'), when: 'turn' }).def, duration: null, tier: 0 } },
    pass('M'), pass('A'), pass('M'),
  ];
  const hurtOf = (fight: Fight | null, name: string) => body(fight, name).sheet.hpMax - rowHp(body(fight, name));

  test('behind a wall a body hides, and a foe cannot aim at it', () => {
    const hidden = play(...hiding([]));
    expect(keys(hidden.fight, 'A')).toEqual(['hide']);
    refuses(hidden.fight, hit('M', 'A'), 'noTarget');
  });

  test('the Stealth skill hides its hunter behind a wall, where a foe cannot pick it, and is refused in a foe\'s sight; the built-in Invisible lands in the open', () => {
    const STEALTH = SKILL_ABILITIES.Stealth(RULES)!;
    const hidden = play(add(row('A', 'party', { abilities: [HIT, STEALTH] }), row('M', 'foe')), wall, start(['A', 20], ['M', 10]), use('A', STEALTH));
    expect(keys(hidden.fight, 'A')).toEqual(['stealth']);
    refuses(hidden.fight, hit('M', 'A'), 'noTarget');
    refuses(play(...duel({ abilities: [HIT, STEALTH] })).fight, use('A', STEALTH), 'seen');
    const INVISIBLE = ability('support', 'invisible', null, { aim: 'self', effect: null, shape: { kind: 'self' },
      ops: [{ op: 'applyStatus', key: statusKey('invisible'), def: RULES.conditions.invisible!, duration: tick(3 * ROUND) }] });
    const open = play(...duel({ abilities: [HIT, INVISIBLE] }), use('A', INVISIBLE));
    expect(keys(open.fight, 'A')).toEqual(['invisible']);
    refuses(open.fight, hit('M', 'A'), 'noTarget');
  });

  test('a hidden body that slows a foe stays hidden: a use that deals no damage does not give it away', () => {
    const r = play(...hiding([SLOWS]), pass('M'), atPlace('A', SLOWS, place(0, 10), 'M'));
    expect([keys(r.fight, 'A'), keys(r.fight, 'M')]).toEqual([['hide'], ['slowed']]);
  });

  test('a hidden body whose use deals damage to a foe is seen', () => {
    const r = play(...hiding([BOOM]), pass('M'), atPlace('A', BOOM, place(0, 10), 'M'));
    expect(hurtOf(r.fight, 'M')).toBeGreaterThan(0);
    expect(keys(r.fight, 'A')).toEqual([]);
    expect(running(r).log.some(l => /A is seen\.$/.test(l.text))).toBe(true);
  });

  test('a hidden body\'s blast says more damage on the log than the same blast from a body that is seen (the ambush, rule 11c)', () => {
    const said = (r: { fight: Fight | null }) => Number(/: M caught(?:, crit)? (\d+)\.$/.exec(running(r).log.find(l => /A uses boom/.test(l.text))!.text)![1]);
    const hidden = play(...hiding([BOOM]), pass('M'), atPlace('A', BOOM, place(0, 10), 'M'));
    const seen = play(add(row('A', 'party', { abilities: [HIT, HIDE, BOOM] }), row('M', 'foe')), wall, start(['A', 20], ['M', 10]), pass('A'), pass('M'), atPlace('A', BOOM, place(0, 10), 'M'));
    expect([said(seen), said(hidden)]).toEqual([hurtOf(seen.fight, 'M'), hurtOf(hidden.fight, 'M')]);
    expect(said(hidden)).toBeGreaterThan(said(seen));
  });

  test('a hidden body whose reaction deals damage to a foe is seen', () => {
    const RIPOSTE = ability('strike', 'riposte', '10', { ...FAR, cost: { ...HIT.cost, fatigue: 0 }, react: { when: 'after', reach: tiles(1) } });
    const MBOOM = ability('blast', 'mboom', '5', { range: tiles(20), shape: { kind: 'radius', radius: tiles(0), ring: null } });
    const r = play(add(row('A', 'party', { abilities: [HIT, HIDE, RIPOSTE] }), row('B', 'party', { place: place(1, 2) }), row('M', 'foe', { abilities: [MBOOM] })), wall,
      start(['A', 20], ['M', 10], ['B', 5]), use('A', HIDE), { type: 'arm', by: id('A'), ability: RIPOSTE.id },
      { type: 'act', by: id('M'), ability: MBOOM.id, aim: place(1, 2), rolls: rolls({ B: 1 }, { B: [] }) });
    expect([body(r.fight, 'A').armed?.spent, hurtOf(r.fight, 'M') > 0, keys(r.fight, 'A')]).toEqual([true, true, []]);
  });

  test('a body that wears stayHidden on dealing damage stays hidden through a hit it deals', () => {
    const r = play(...hiding([BOOM], [st('unseen-blade', null, { op: 'stayHidden', on: 'dealt' })]), pass('M'), atPlace('A', BOOM, place(0, 10), 'M'));
    expect(hurtOf(r.fight, 'M')).toBeGreaterThan(0);
    expect(keys(r.fight, 'A')).toEqual(['unseen-blade', 'hide']);
  });

  test('a hide whose ends.hurt is false survives a hurt; one that ends on a hurt does not', () => {
    const TOUGH = self('tough', { op: 'hidden', level: 1, start: 'unseen', ends: ends({ hurt: false }) });
    const burning = (a: Ability) => play(add(row('A', 'party', { abilities: [HIT, a] }), row('M', 'foe')), wall, start(['A', 20], ['M', 10]), use('A', a), ...burnt);
    const tough = burning(TOUGH), plain = burning(HIDE);
    expect([hurtOf(tough.fight, 'A') > 0, keys(tough.fight, 'A')]).toEqual([true, ['tough', 'burn']]);
    expect([hurtOf(plain.fight, 'A') > 0, keys(plain.fight, 'A')]).toEqual([true, ['burn']]);
  });

  test('a hide that starts out of sight is refused in a foe\'s sight; one that starts anywhere lands there', () => {
    const VANISH = self('vanish', { op: 'hidden', level: 1, start: 'anywhere', ends: ends() });
    refuses(play(...duel({ abilities: [HIT, HIDE, VANISH] })).fight, use('A', HIDE), 'seen');
    expect(keys(play(...duel({ abilities: [HIT, HIDE, VANISH] }), use('A', VANISH)).fight, 'A')).toEqual(['vanish']);
  });

  test('a hide that starts out of sight, cast on an ally, is refused on it while a foe watches it, whoever cast it', () => {
    const COVER = ability('support', 'cover', null, { aim: 'ally', effect: null, range: tiles(20), shape: { kind: 'touch', reach: tiles(20) },
      ops: [{ op: 'applyStatus', key: statusKey('cover'), def: { label: 'Cover', desc: '', ops: [{ op: 'hidden', level: 1, start: 'unseen', ends: ends() }] }, duration: tick(3 * ROUND) }] });
    // the wall on row 6 stands between the party's line (row 2) and M at (0, 10); (3, 9) is on M's side of it, in its sight
    const cast = (caster: Place, ally: Place) => play(add(row('B', 'party', { abilities: [HIT, COVER], place: caster }), row('A', 'party', { place: ally }), row('M', 'foe')), wall,
      start(['B', 20], ['M', 10], ['A', 5]), { type: 'act', by: id('B'), ability: COVER.id, aim: id('A'), rolls: rolls() });
    expect(keys(cast(place(0, 2), place(3, 9)).fight, 'A')).toEqual([]);
    expect(keys(cast(place(3, 9), place(0, 2)).fight, 'A')).toEqual(['cover']);
  });

  test('a foe that steps next to a hidden body does not reveal it (the owner\'s ruling 4)', () => {
    const near = play(add(row('A', 'party', { abilities: [HIT, HIDE], place: place(5, 2) }), row('M', 'foe', { place: place(5, 8) })), wall, start(['A', 20], ['M', 10]), use('A', HIDE),
      { type: 'place', id: id('M'), to: place(5, 3) });
    expect(keys(near.fight, 'A')).toEqual(['hide']);
  });

  // Picking and catching ask the one sight rule (notes-7-stealth.md section 3 and unit 4, with the owner's rulings): a picked
  // target is refused when no body of the user's side perceives it; an area at a place catches a hidden body whatever
  // the sight, and only the untargetable ward keeps a body out of a shape.
  /** A hide put on in the open at `level`, which a hurt does not end, so a hit on its bearer shows only what picking, catching and a reveal do. */
  const shade = (level: HideLevel) => self(`shade${level}`, { op: 'hidden', level, start: 'anywhere', ends: ends({ hurt: false }) });
  /** A worn status that raises its bearer's sight level to `n`. */
  const eye = (n: number): Status => st(`eye${n}`, null, { op: 'sheet', key: 'sight', amount: n });
  const NOVA = ability('blast', 'nova', '5', { range: tiles(20) }), LANCE = ability('shot', 'lance', '5', { range: tiles(20) });
  /** A, on the party's line at (0, 2), hides at `level` on its first turn; then it is M's turn, M wearing `sight`. */
  const shaded = (level: HideLevel, sight: Status[] = []) =>
    [add(row('A', 'party', { abilities: [HIT, shade(level)] }), row('M', 'foe', { abilities: [HIT, NOVA, LANCE], statuses: sight })), start(['A', 20], ['M', 10]), use('A', shade(level))] as const;
  const blasts = (by: string, at: Place, who: string): Command => ({ type: 'act', by: id(by), ability: NOVA.id, aim: at, rolls: rolls({ [who]: 1 }, { [who]: [] }) });

  test('a foe cannot pick a hidden body with a sight under its level, and can at its level or above (the owner\'s ruling 1)', () => {
    refuses(play(...shaded(2)).fight, hit('M', 'A'), 'noTarget');
    refuses(play(...shaded(2, [eye(1)])).fight, hit('M', 'A'), 'noTarget');
    for (const n of [2, 3]) expect(hurtOf(play(...shaded(2, [eye(n)]), hit('M', 'A')).fight, 'A'), `sight ${n}`).toBeGreaterThan(0);
  });

  test('a foe\'s blast at a place catches a hidden body it cannot pick and reveals it (the owner\'s ruling 2); a strike from a foe that sees it does not reveal it', () => {
    const area = play(...shaded(1), blasts('M', place(0, 2), 'A'));
    expect([hurtOf(area.fight, 'A') > 0, keys(area.fight, 'A')]).toEqual([true, []]);
    expect(running(area).log.some(l => /A is seen\.$/.test(l.text))).toBe(true);
    const strike = play(...shaded(1, [eye(1)]), hit('M', 'A'));
    expect([hurtOf(strike.fight, 'A') > 0, keys(strike.fight, 'A')]).toEqual([true, ['shade1']]);
  });

  // Ruling 2 and the ruling of Nov 21 by the one rule of fight.ts `useStealth`: a use reveals each hidden body of the other
  // side it hits but the one a single-target use picked by id. Eyes find a picked body, so hitting it shows nothing new;
  // an area (a radius, a piercing line) or a use at a place finds every body on its tiles, the aimed one too.
  const aimed = (a: Ability, aim: Place | string): Command => ({ type: 'act', by: id('M'), ability: a.id, aim: typeof aim === 'string' ? id(aim) : aim, rolls: rolls({ A: 1 }, { A: [] }) });

  test('a foe\'s line at a place that catches a hidden body reveals it, as a strike at its tile does (the owner\'s ruling 2)', () => {
    for (const a of [LANCE, HIT]) {
      const r = play(...shaded(1), aimed(a, place(0, 2)));
      expect([hurtOf(r.fight, 'A') > 0, keys(r.fight, 'A')], a.name).toEqual([true, []]);
      expect(running(r).log.some(l => /A is seen\.$/.test(l.text)), a.name).toBe(true);
    }
  });

  test('an aimed shot at a hidden body its user sees does not reveal it; a blast at its place from the same foe does', () => {
    const shot = play(...shaded(1, [eye(1)]), aimed(LANCE, 'A'));
    expect([hurtOf(shot.fight, 'A') > 0, keys(shot.fight, 'A')]).toEqual([true, ['shade1']]);
    const blast = play(...shaded(1, [eye(1)]), aimed(NOVA, place(0, 2)));
    expect([hurtOf(blast.fight, 'A') > 0, keys(blast.fight, 'A')]).toEqual([true, []]);
  });

  test('a blast aimed by id at a hidden body its user sees reveals it: every area hit reveals (the owner, Nov 21)', () => {
    const r = play(...shaded(1, [eye(1)]), aimed(NOVA, 'A'));
    expect([hurtOf(r.fight, 'A') > 0, keys(r.fight, 'A')]).toEqual([true, []]);
    expect(running(r).log.some(l => /A is seen\.$/.test(l.text))).toBe(true);
  });

  test('a piercing line aimed by id at a hidden body its user sees reveals it; one that stops at the first body does not', () => {
    const PIKE = ability('shot', 'pike', '5', { range: tiles(20), shape: { kind: 'line', width: tiles(1), pierce: true } });
    const STAB = ability('shot', 'stab', '5', { range: tiles(20), shape: { kind: 'line', width: tiles(1), pierce: false } });
    const seen = (a: Ability) =>
      play(add(row('A', 'party', { abilities: [HIT, shade(1)] }), row('M', 'foe', { abilities: [HIT, a], statuses: [eye(1)] })), start(['A', 20], ['M', 10]), use('A', shade(1)), aimed(a, 'A'));
    expect([hurtOf(seen(PIKE).fight, 'A') > 0, keys(seen(PIKE).fight, 'A')]).toEqual([true, []]);
    expect([hurtOf(seen(STAB).fight, 'A') > 0, keys(seen(STAB).fight, 'A')]).toEqual([true, ['shade1']]);
  });

  test('an untargetable body is neither picked nor caught by a foe\'s blast at its place', () => {
    const veiled = play(add(row('A', 'party', { abilities: [HIT, VEIL] }), row('B', 'party', { place: place(1, 2) }), row('M', 'foe', { abilities: [HIT, NOVA] })),
      start(['A', 20], ['M', 10], ['B', 5]), use('A', VEIL));
    refuses(veiled.fight, hit('M', 'A'), 'noTarget');
    const blasted = play(add(row('A', 'party', { abilities: [HIT, VEIL] }), row('B', 'party', { place: place(1, 2) }), row('M', 'foe', { abilities: [HIT, NOVA] })),
      start(['A', 20], ['M', 10], ['B', 5]), use('A', VEIL), blasts('M', place(0, 2), 'B'));
    expect([hurtOf(blasted.fight, 'A'), hurtOf(blasted.fight, 'B') > 0]).toEqual([0, true]);
  });

  test('a use that carries a reveal op (a Flare) reveals the hidden body it lands on; the parser reads the op back', () => {
    // M sees A and picks it, so the reveal here is the op's, not ruling 2's (a picked body is not revealed by the hit)
    const FLARE = ability('shot', 'flare', null, { effect: null, range: tiles(20), ops: [{ op: 'reveal' }] });
    expect(parseAbility(JSON.parse(JSON.stringify(FLARE)), RULES)).toEqual(FLARE);
    const MIST = self('mist', { op: 'hidden', level: 1, start: 'anywhere', ends: ends({ hurt: false, revealed: false }) });
    const flared = (hide: Ability) => play(add(row('A', 'party', { abilities: [HIT, hide] }), row('M', 'foe', { abilities: [HIT, FLARE], statuses: [eye(1)] })), start(['A', 20], ['M', 10]), use('A', hide),
      { type: 'act', by: id('M'), ability: FLARE.id, aim: id('A'), rolls: rolls({ A: 1 }) });
    expect([keys(flared(shade(1)).fight, 'A'), keys(flared(MIST).fight, 'A')]).toEqual([[], ['mist']]);
  });

  test('in fog a body picks a foe it cannot itself see when an ally sees it, by that one ally\'s own eyes (the owner\'s ruling 7)', () => {
    // fog sight 4: A at (0, 2) is 8 tiles from M at (0, 10); an ally at (0, 8) is 2 from it, one at (10, 2) is 10
    const fog = { sight: tiles(4), seen: '0'.repeat(RULES.fight.grid.w * RULES.fight.grid.h) };
    const near = place(0, 8), far = place(10, 2), CLOAK = st('cloak', null, { op: 'hidden', level: 2, start: 'anywhere', ends: ends() });
    const fogged = (ally: Place, foe: Status[], a: Status[] = [], b: Status[] = []) =>
      [{ ...add(row('A', 'party', { statuses: a }), row('B', 'party', { place: ally, statuses: b }), row('M', 'foe', { statuses: foe })), fog }, start(['A', 20], ['B', 15], ['M', 10])] as const;
    refuses(play(...fogged(far, [])).fight, hit('A', 'M'), 'noTarget');
    expect(hurtOf(play(...fogged(near, []), hit('A', 'M')).fight, 'M')).toBeGreaterThan(0);
    // hidden at 2: A sees at 2 but out of the fog's reach, the ally in reach at 0; the ally with sight 2 brings it in
    refuses(play(...fogged(near, [CLOAK], [eye(2)])).fight, hit('A', 'M'), 'noTarget');
    expect(hurtOf(play(...fogged(near, [CLOAK], [], [eye(2)]), hit('A', 'M')).fight, 'M')).toBeGreaterThan(0);
  });

  test('a reveal that lands ends a hide that ends on being revealed, sight or none; one that does not stays (a Flare\'s)', () => {
    // a reveal op lands from a trigger, a threshold or a delayed end; here M's flare at the start of each of its turns, on
    // every foe within 20 tiles, which reaches over the wall as an area does
    const flare = statusOn({ label: 'Flare', desc: '', ops: [], triggers: [{ on: 'turnStart', to: { kind: 'area', radius: tiles(20), on: 'foes' }, limit: { kind: 'each' }, ops: [{ op: 'reveal' }] }] },
      { key: statusKey('flare'), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) });
    const SHROUD = self('shroud', { op: 'hidden', level: 1, start: 'unseen', ends: ends({ revealed: false }) });
    const flared = (a: Ability) => play(add(row('A', 'party', { abilities: [HIT, a] }), row('M', 'foe', { statuses: [flare] })), wall, start(['A', 20], ['M', 10]), use('A', a));
    expect([keys(flared(HIDE).fight, 'A'), keys(flared(SHROUD).fight, 'A')]).toEqual([[], ['shroud']]);
  });

  test('the machine: every state of stealth under every event of tests/models/wave2-events.ts (notes-7-stealth.md section 4)', () => {
    // A state is the hides a body holds (the Stealth hide S at level 1, ended by each of the three; the Invisible hide I at
    // level 3, not ended by a hurt) and whether it wears stayHidden on dealt (+kept). Seen is no hide.
    const named = (s: Stealth): string => `${s.hides.map(h => (h.key === 'stealth' ? 'S' : 'I')).sort().join('') || 'seen'}${s.kept.size ? '+kept' : ''}`;
    const of = (name: string): Stealth => {
      const [hides, kept] = name.split('+');
      return { hides: [...(hides === 'seen' ? '' : hides!)].map(c => (c === 'S' ? STEALTH_HIDE : INVISIBLE_HIDE)), kept: new Set(kept ? ['dealt'] as const : []) };
    };
    const key = (e: StealthEvent): string => e.type === 'hide' ? `hide ${e.hide.key === 'stealth' ? 'S' : 'I'}${e.watched ? ' watched' : ''}` : e.type;
    const expected: Record<string, Record<string, string>> = {
      // seen: a hide out of sight is refused while watched; one anywhere lands; no end applies
      seen: { 'hide S watched': 'seen', 'hide S': 'S', 'hide I watched': 'I', hurt: 'seen', dealt: 'seen', revealed: 'seen' },
      S: { 'hide S watched': 'S', 'hide S': 'S', 'hide I watched': 'IS', hurt: 'seen', dealt: 'seen', revealed: 'seen' },
      // a hurt does not end the Invisible hide
      I: { 'hide S watched': 'IS', 'hide S': 'IS', 'hide I watched': 'I', hurt: 'I', dealt: 'seen', revealed: 'seen' },
      IS: { 'hide S watched': 'IS', 'hide S': 'IS', 'hide I watched': 'IS', hurt: 'I', dealt: 'seen', revealed: 'seen' },
      // stayHidden on dealt: damage dealt ends neither hide
      'seen+kept': { 'hide S watched': 'seen+kept', 'hide S': 'S+kept', 'hide I watched': 'I+kept', hurt: 'seen+kept', dealt: 'seen+kept', revealed: 'seen+kept' },
      'S+kept': { 'hide S watched': 'S+kept', 'hide S': 'S+kept', 'hide I watched': 'IS+kept', hurt: 'seen+kept', dealt: 'S+kept', revealed: 'seen+kept' },
      'I+kept': { 'hide S watched': 'IS+kept', 'hide S': 'IS+kept', 'hide I watched': 'I+kept', hurt: 'I+kept', dealt: 'I+kept', revealed: 'seen+kept' },
      'IS+kept': { 'hide S watched': 'IS+kept', 'hide S': 'IS+kept', 'hide I watched': 'IS+kept', hurt: 'I+kept', dealt: 'IS+kept', revealed: 'seen+kept' },
    };
    expect(STEALTH_WALK.map(key).sort()).toEqual(Object.keys(expected.seen!).sort());
    for (const [from, to] of Object.entries(expected)) for (const e of STEALTH_WALK) expect(named(stealthStep(of(from), e)), `${from} × ${key(e)}`).toBe(to[key(e)]!);
    expect([stealthLevel(of('IS')), stealthLevel(of('S')), stealthLevel(of('seen'))]).toEqual([3, 1, null]);
  });
});

describe('forced movement: a shove, a blink, a swap (kits design 8.3, table 8.9.3)', () => {
  const shove = (dir: 'away' | 'toward', n: number, from: 'user' | 'aim' = 'user'): Ability =>
    ability('strike', `shove-${dir}-${n}-${from}`, '1', { ...FAR, ops: [{ op: 'shove', dir, from, tiles: n }] });
  const P3 = shove('away', 3), GRASP = shove('toward', 3);
  const at = (fight: Fight | null, name: string) => body(fight, name).place;
  const placed = (a: [number, number], m: [number, number], ...extra: NewRow[]) => add(row('A', 'party', { abilities: [HIT, P3, GRASP], place: place(...a) }), row('M', 'foe', { place: place(...m) }), ...extra);

  test('a push of 3 moves a caught target 3 tiles on the line away from its user', () => {
    expect(at(play(placed([5, 2], [5, 4]), start(['A', 20], ['M', 10]), hit('A', 'M', P3)).fight, 'M')).toEqual(place(5, 7));
  });

  test('a pull stops next to its user (Death\'s Grasp)', () => {
    expect(at(play(placed([5, 2], [5, 9]), start(['A', 20], ['M', 10]), hit('A', 'M', GRASP)).fight, 'M')).toEqual(place(5, 6));
    expect(at(play(placed([5, 2], [5, 4]), start(['A', 20], ['M', 10]), hit('A', 'M', GRASP)).fight, 'M')).toEqual(place(5, 3));
  });

  test('a boss moves the whole push as any body does (the owner, Nov 21), a rooted body none, and a dodge is not a push', () => {
    const boss = { kind: 'monster', name: 'Monster', rank: 'E', archetype: 'brute', monsterKind: 'boss', tweak: { hp: 1, stats: {} } } as const;
    const r = play(add(row('A', 'party', { abilities: [P3], place: place(5, 2) }), row('M', 'foe', { place: place(5, 4), origin: boss })), start(['A', 20], ['M', 10]), hit('A', 'M', P3));
    expect(at(r.fight, 'M')).toEqual(place(5, 7));
    const held = play(placed([5, 2], [5, 4]), { type: 'status', id: id('M'), add: { key: statusKey('root'), def: { label: 'Root', desc: '', ops: [{ op: 'root' }] }, duration: null, tier: 0 } }, start(['A', 20], ['M', 10]), hit('A', 'M', P3));
    expect(at(held.fight, 'M')).toEqual(place(5, 4));
    const shot = ability('shot', 'push-shot', '1', { range: tiles(20), ops: [{ op: 'shove', dir: 'away', from: 'user', tiles: 3 }] });
    const dodged = play(add(row('A', 'party', { abilities: [shot], place: place(5, 2) }), row('M', 'foe', { place: place(5, 12) })), start(['A', 20], ['M', 10]), hit('A', 'M', shot, 20));
    expect(at(dodged.fight, 'M')).not.toEqual(place(5, 13));
  });

  test('a body pushed into a zone takes its hold but pays no on-entry part; walking in pays it', () => {
    const spikes: Command = { type: 'zoneAdd', zone: { id: zoneId('z1'), name: 'Spikes', tiles: [place(5, 7)], spares: null, tier: 0, duration: null, ops: [{ op: 'damage', type: 'physical', amount: f('20'), when: 'use' }] } };
    const r = play(placed([5, 2], [5, 4]), spikes, start(['A', 20], ['M', 10]), hit('A', 'M', P3));
    const m = body(r.fight, 'M');
    expect(m.place).toEqual(place(5, 7));
    expect(m.statuses.some(x => x.zone === 'z1')).toBe(true);
    expect(rowHp(m)).toBe(rowHp(body(play(placed([5, 2], [5, 4]), start(['A', 20], ['M', 10]), hit('A', 'M', P3)).fight, 'M')));
  });

  test('a crowd packs: of a push, the farthest moves first', () => {
    const wide = ability('blast', 'quake', '1', { range: tiles(20), foesOnly: true, ops: [{ op: 'shove', dir: 'away', from: 'user', tiles: 3 }] });
    const r = play(add(row('A', 'party', { abilities: [wide], place: place(5, 2) }), row('M', 'foe', { place: place(5, 5) }), row('N', 'foe', { place: place(5, 6) })),
      start(['A', 20], ['M', 10], ['N', 9]), { type: 'act', by: id('A'), ability: wide.id, aim: place(5, 5), rolls: rolls({ M: 1, N: 1 }, { M: [], N: [] }) });
    expect([at(r.fight, 'M'), at(r.fight, 'N')]).toEqual([place(5, 8), place(5, 9)]);
  });

  test('a blink stands its user on a free tile it sees within 8 before its use, and a root refuses it', () => {
    const blink = ability('support', 'blink', null, { aim: 'place', effect: null, shape: { kind: 'self' }, range: tiles(12), move: { kind: 'blink' } });
    const r = play(add(row('A', 'party', { abilities: [blink], place: place(5, 2) }), row('M', 'foe')), start(['A', 20], ['M', 10]),
      { type: 'act', by: id('A'), ability: blink.id, aim: place(5, 8), rolls: rolls() });
    expect(at(r.fight, 'A')).toEqual(place(5, 8));
    const far = play(add(row('A', 'party', { abilities: [blink], place: place(5, 2) }), row('M', 'foe')), start(['A', 20], ['M', 10])).fight;
    refuses(far, { type: 'act', by: id('A'), ability: blink.id, aim: place(5, 11), rolls: rolls() }, 'range');
    const rooted = play(add(row('A', 'party', { abilities: [blink], place: place(5, 2), statuses: [st('root', null, { op: 'root' })] }), row('M', 'foe')), start(['A', 20], ['M', 10])).fight;
    refuses(rooted, { type: 'act', by: id('A'), ability: blink.id, aim: place(5, 6), rolls: rolls() }, 'rooted');
  });

  test('a blink\'s use reaches from the tile it lands on: its dice are of the bodies it reaches there, and a foe it only passed sets off no reaction', () => {
    const LEAP = ability('strike', 'leap', '5', { aim: 'place', range: tiles(12), shape: { kind: 'line', width: tiles(0), pierce: false }, move: { kind: 'blink' } });
    const BURST = ability('blast', 'burst', '5', { range: tiles(12), shape: { kind: 'radius', radius: tiles(1), ring: null }, move: { kind: 'blink' } });
    const PARRY = ability('strike', 'parry', null, { ...FAR, effect: null, cost: { ...HIT.cost, fatigue: 0 }, react: { when: 'before', reach: tiles(0) }, ops: [{ op: 'guard', share: 0.3 }] });
    const g = running(play(add(row('A', 'party', { abilities: [LEAP, BURST], place: place(5, 2) }), row('M', 'foe', { abilities: [HIT, PARRY], place: place(5, 5) })),
      start(['A', 20], ['M', 10]), { type: 'arm', by: id('M'), ability: PARRY.id }));
    expect(needs(LEAP, body(g, 'A'), g.rows, place(5, 8), g.grid, g.now, RULES).dice).toEqual({});
    expect(needs(BURST, body(g, 'A'), g.rows, place(5, 8), g.grid, g.now, RULES).react).toEqual([id('A')]);
    const r = reduce(g,{ type: 'act', by: id('A'), ability: LEAP.id, aim: place(5, 8), rolls: rolls() }, ctx);
    expect([body(r.fight, 'A').place, body(r.fight, 'M').armed?.spent, rowHp(body(r.fight, 'M'))]).toEqual([place(5, 8), false, rowHp(body(g, 'M'))]);
  });

  test('a swap exchanges the places of its user and an ally', () => {
    const swap = ability('support', 'swap', null, { aim: 'ally', effect: null, range: tiles(12), move: { kind: 'swap' } });
    const r = play(add(row('A', 'party', { abilities: [swap], place: place(1, 2) }), row('B', 'party', { place: place(6, 2) }), row('M', 'foe')), start(['A', 20], ['B', 10], ['M', 5]),
      { type: 'act', by: id('A'), ability: swap.id, aim: id('B'), rolls: rolls() });
    expect([at(r.fight, 'A'), at(r.fight, 'B')]).toEqual([place(6, 2), place(1, 2)]);
  });
});

describe('a zone act: shift and grow (kits design 8.5.4)', () => {
  const free = { ...HIT.cost, mana: 0 };
  const field = (act: 'shift' | 'grow', by: number): Ability => ability('blast', `field-${act}`, null, { range: tiles(20), effect: null, foesOnly: true, cost: free,
    zoneAct: { act, name: null, by } });
  const LAY = ability('blast', 'lay', null, { range: tiles(20), effect: null, foesOnly: true, cost: { ...HIT.cost, mana: 0 }, zone: { name: 'Mire', duration: null, ops: [{ op: 'damage', type: 'magical', amount: f('7'), when: 'use' }], endsWithOwner: false, around: null, grow: null } });
  const SHIFT = field('shift', 6), GROW = field('grow', 2);
  const begin = () => [add(row('A', 'party', { abilities: [LAY, SHIFT, GROW], place: place(5, 2) }), row('M', 'foe', { place: place(5, 12) })), start(['A', 20], ['M', 10])] as const;
  const at = (x: number, y: number) => (by: string, a: Ability): Command => ({ type: 'act', by: id(by), ability: a.id, aim: place(x, y), rolls: rolls() });

  test('a shift moves a zone toward the aim by at most 6 tiles; a body it moves onto takes its hold but pays no entry', () => {
    const laid = play(...begin(), at(5, 4)('A', LAY), pass('M'));
    const z0 = running(laid).zones[0]!;
    const r = play(...begin(), at(5, 4)('A', LAY), pass('M'), { type: 'act', by: id('A'), ability: SHIFT.id, aim: place(5, 12), rolls: rolls({ M: 10 }, { M: [] }) });
    const z = running(r).zones[0]!;
    expect(z.ground.kind === 'around' && z0.ground.kind === 'around' ? [z0.ground.anchor, z.ground.anchor] : null).toEqual([{ kind: 'place', at: place(5, 4) }, { kind: 'place', at: place(5, 10) }]);
    const m = body(r.fight, 'M');
    expect(m.statuses.some(x => x.zone === z.id)).toBe(true);
    expect(rowHp(m)).toBe(rowHp(body(laid.fight, 'M')));
  });

  test('a grow widens an around zone by 2, to the most a field may be', () => {
    const r = play(...begin(), at(5, 4)('A', LAY), pass('M'), at(5, 4)('A', GROW));
    const z = running(r).zones[0]!;
    expect(z.ground.kind === 'around' ? z.ground.radius : null).toBe(tiles(Math.min(RULES.fight.fieldRadiusMax, RULES.fight.abilityKinds.blast.ring + 2)));
  });
});

describe('turn economy: an extra action, a hasten (kits design 8.6, table 8.9.6)', () => {
  const ROUND = RULES.fight.round;
  const SURGE = ability('strike', 'surge', '1', { ...FAR, ops: [{ op: 'extra' }] });
  const TRANSFER = ability('support', 'transfer', null, { aim: 'ally', effect: null, range: tiles(20), ops: [{ op: 'hasten', share: 1 }] });

  test('an extra action makes the user\'s next turn now; a second in the same round is refused', () => {
    const r = play(...duel({ abilities: [HIT, SURGE] }), hit('A', 'M', SURGE));
    const now = running(play(...duel())).now;
    expect([running(r).currentId, running(r).now, body(r.fight, 'A').extras]).toEqual(['A', tick(now + 1), { round: Math.floor(now / ROUND), n: 1 }]);
    refuses(r.fight, hit('A', 'M', SURGE), 'extra');
  });

  test('a hasten of 1 gives an ally the giver\'s standard action, once between its turns, never before the next tick', () => {
    const begin = [add(row('A', 'party', { abilities: [TRANSFER] }), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 1], ['M', 10])] as const;
    const before = body(play(...begin).fight, 'B').at;
    const r = play(...begin, { type: 'act', by: id('A'), ability: TRANSFER.id, aim: id('B'), rolls: rolls() });
    const now = running(play(...begin)).now, g = running(r);
    // B's turn may come at once: then it is the current one at that time, and its turn's start cleared its mark
    expect(g.currentId === 'B' ? g.now : body(r.fight, 'B').at).toBe(tick(Math.max(now + 1, before - ROUND)));
    const once = { ...g, rows: g.rows.map(x => x.id === 'B' ? { ...x, hastened: true as const, at: tick(before) } : x), currentId: id('A') } as Running;
    const again = reduce(once, { type: 'act', by: id('A'), ability: TRANSFER.id, aim: id('B'), rolls: rolls(), force: true }, ctx).fight!;
    expect(body(again, 'B').at).toBe(tick(before));
  });
});

describe('a reaction (kits design 8.4, table 8.9.1)', () => {
  const K = RULES.fight.kit;
  const reaction = (name: string, when: 'before' | 'lethal' | 'after' | 'turn', o: Partial<Ability> = {}): Ability =>
    ability('strike', name, null, { ...FAR, effect: null, cost: { ...HIT.cost, fatigue: 0, time: abilityOf('shot', { id: abilityId('q'), name: 'q' }, RULES).cost.time }, react: { when, reach: tiles(0) }, ...o });
  const PARRY = reaction('parry', 'before', { ops: [{ op: 'guard', share: K.parry }] });
  const NEGATE = reaction('shinsuu', 'before', { ops: [{ op: 'negate' }] });
  const STAND = reaction('stand', 'lethal', { ops: [{ op: 'applyStatus', key: statusKey('stone'), def: { label: 'Stone', desc: '', ops: [{ op: 'invulnerable' }] }, duration: tick(1000) }] });
  const RIPOSTE = reaction('riposte', 'after', { effect: { type: 'physical', by: 'hand', formula: f('10') } });
  const armed = (by: string, a: Ability | null, on?: string): Command => ({ type: 'arm', by: id(by), ability: a ? a.id : null, ...(on ? { on: id(on) } : {}) });
  const foeFirst = (abilities: Ability[]) => [add(row('A', 'party', { abilities }), row('M', 'foe')), start(['M', 20], ['A', 10])] as const;

  test('the GM arms a row\'s reaction at no time, one at a time; a use that is no reaction is refused, and null disarms', () => {
    const r = play(...foeFirst([HIT, PARRY, NEGATE]), armed('A', PARRY));
    expect(body(r.fight, 'A').armed).toEqual({ ability: 'parry', on: null, spent: false });
    expect(running(r).now).toBe(running(play(...foeFirst([HIT]))).now);
    expect(body(play(...foeFirst([HIT, PARRY, NEGATE]), armed('A', PARRY), armed('A', NEGATE)).fight, 'A').armed?.ability).toBe(NEGATE.id);
    refuses(r.fight, armed('A', HIT), 'unknownAbility');
    expect(body(play(...foeFirst([HIT, PARRY]), armed('A', PARRY), armed('A', null)).fight, 'A').armed).toBeUndefined();
  });

  test('Parry takes its guard (30%, kit.parry) off a strike before it lands, and its quick action\'s time comes off its reactor\'s next turn', () => {
    const plain = play(...foeFirst([HIT, PARRY]), hit('M', 'A'));
    const parried = play(...foeFirst([HIT, PARRY]), armed('A', PARRY), hit('M', 'A'));
    const a0 = body(plain.fight, 'A'), a1 = body(parried.fight, 'A');
    const sheet = a0.sheet;
    expect(a0.sheet.hpMax - rowHp(a0)).toBe(afterDefence(10, 'physical', sheet, sheet, RULES));
    expect(a1.sheet.hpMax - rowHp(a1)).toBe(afterDefence(10 * (1 - K.parry), 'physical', sheet, sheet, RULES));
    expect(a1.at - a0.at).toBe(Math.round(RULES.fight.round * RULES.fight.cost.quick / a1.speed));
    expect(a1.armed?.spent).toBe(true);
  });

  test('a reaction fires once between two of its reactor\'s turns, and its turn restores it', () => {
    const twice = play(...foeFirst([HIT, PARRY]), armed('A', PARRY), hit('M', 'A', HIT), { ...hit('M', 'A', HIT), force: true } as Command);
    const a = body(twice.fight, 'A');
    const one = afterDefence(10 * (1 - K.parry), 'physical', a.sheet, a.sheet, RULES), full = afterDefence(10, 'physical', a.sheet, a.sheet, RULES);
    expect(a.sheet.hpMax - rowHp(a)).toBe(one + full);
    // its quick action's time pushed A's turn past M's next one: A is spent through M's turn, and armed again at its own
    let g = play(...foeFirst([HIT, PARRY]), armed('A', PARRY), hit('M', 'A')).fight!;
    expect([running({ fight: g }).currentId, body(g, 'A').armed?.spent]).toEqual(['M', true]);
    while (running({ fight: g }).currentId !== 'A') g = reduce(g, pass(running({ fight: g }).currentId), ctx).fight!;
    expect(body(g, 'A').armed?.spent).toBe(false);
  });

  test('a reaction is refused and charged as a use is: a gate that does not hold keeps it from firing, an HP price is paid when it fires', () => {
    const gatedParry = reaction('gparry', 'before', { ops: [{ op: 'guard', share: K.parry }], gates: [{ kind: 'holds', key: statusKey('stance'), on: 'self', atLeast: 1 }] });
    const unfired = play(...foeFirst([HIT, gatedParry]), armed('A', gatedParry), hit('M', 'A'));
    expect(body(unfired.fight, 'A').armed?.spent).toBe(false);
    const bloodParry = reaction('bparry', 'before', { ops: [{ op: 'guard', share: K.parry }], prices: [{ kind: 'hp', amount: { kind: 'flat', n: 3 } }] });
    const plain = play(...foeFirst([HIT, PARRY]), armed('A', PARRY), hit('M', 'A')), paid = play(...foeFirst([HIT, bloodParry]), armed('A', bloodParry), hit('M', 'A'));
    expect([body(paid.fight, 'A').armed?.spent, rowHp(body(plain.fight, 'A')) - rowHp(body(paid.fight, 'A'))]).toEqual([true, 3]);
  });

  test('a reaction holds only what lands from it (a trigger\'s ops, a guard, a negate): one that would push or give an extra action is refused when read', () => {
    const read = (a: Ability) => parseAbility(JSON.parse(JSON.stringify(a)), RULES);
    expect(read(PARRY)).not.toBeNull();
    expect(read(reaction('shove-back', 'after', { ops: [{ op: 'shove', dir: 'away', from: 'user', tiles: tiles(2) }] }))).toBeNull();
    expect(read(reaction('again', 'before', { ops: [{ op: 'extra' }] }))).toBeNull();
    expect(read({ ...reaction('push', 'after', { ops: [{ op: 'shove', dir: 'away', from: 'user', tiles: tiles(2) }] }), react: undefined } as unknown as Ability)).not.toBeNull();
  });

  test('a negate leaves the strike nothing more to do; its user has paid', () => {
    const r = play(...foeFirst([HIT, NEGATE]), armed('A', NEGATE), hit('M', 'A'));
    expect(rowHp(body(r.fight, 'A'))).toBe(body(r.fight, 'A').sheet.hpMax);
    expect(body(r.fight, 'M').fatigue).toBe(HIT.cost.fatigue);
  });

  test('a lethal reaction lands before the killing hit: a ward of stone keeps its reactor at 1', () => {
    const r = play(...foeFirst([HIT, STAND]), armed('A', STAND), hit('M', 'A', BIG));
    expect(rowHp(body(r.fight, 'A'))).toBe(1);
    expect(rowHp(body(play(...foeFirst([HIT, STAND]), hit('M', 'A', BIG)).fight, 'A'))).toBe(0);
  });

  test('an after reaction answers a landed hit at the attacker, a dodge sets none off', () => {
    const r = play(...foeFirst([HIT, RIPOSTE]), armed('A', RIPOSTE), hit('M', 'A'));
    const m = body(r.fight, 'M');
    expect(m.sheet.hpMax - rowHp(m)).toBe(afterDefence(10, 'physical', body(r.fight, 'A').sheet, m.sheet, RULES));
  });

  test('a turn reaction moves its reactor\'s turn before the named body\'s, and adds no turn', () => {
    const REACT = reaction('react', 'turn');
    const base = [add(row('A', 'party', { abilities: [HIT, REACT] }), row('M', 'foe'), row('B', 'party')), start(['B', 20], ['M', 15], ['A', 1])] as const;
    const plain = play(...base, pass('B'));
    expect(running(plain).currentId).toBe(id('M'));
    const r = play(...base, armed('A', REACT, 'M'), pass('B'));
    expect(running(r).currentId).toBe(id('A'));
    refuses(play(...base).fight, armed('A', REACT), 'noTarget');
  });

  test('a turn reaction\'s cost reaches its hunter\'s sheet, on this phone and on a player\'s, as a use on its own turn does', () => {
    const REACT = reaction('react', 'turn', { cost: { ...reaction('react', 'turn').cost, mana: 5, fatigue: 2 } });
    const base = (holder: NewRow['holder']) => [add(row('A', 'party', { abilities: [HIT, REACT], holder }), row('M', 'foe'), row('B', 'party')),
      start(['B', 20], ['M', 15], ['A', 1]), armed('A', REACT, 'M')] as const;
    const local = reduce(play(...base({ kind: 'local', hunterId: hunterId('h-A') })).fight, pass('B'), ctx);
    expect(running(local).currentId).toBe(id('A'));
    expect(local.effects.filter(e => e.type === 'vitals').at(-1)).toMatchObject({ hunterId: hunterId('h-A'), mana: 10 - 5, fatigue: 0 + 2 });
    const key = sheetKey('dev-a:h1');
    const remote = reduce(play(...base({ kind: 'remote', remote: key })).fight, pass('B'), ctx);
    expect(remote.effects.filter(e => e.type === 'sendRemote').at(-1)).toMatchObject({ remote: key, mana: 10 - 5, fatigue: 0 + 2 });
  });

  test('a reactor that goes down is unarmed', () => {
    const r = play(add(row('A', 'party', { abilities: [HIT, PARRY] }), row('B', 'party'), row('M', 'foe')), start(['M', 20], ['A', 10], ['B', 5]), armed('A', PARRY),
      { ...hit('M', 'A', BIG) });
    expect(body(r.fight, 'A').armed).toBeUndefined();
  });

  test('a before reaction that gives its reactor the defender\'s edge is rolled for: the dice the use asks for land it, and the better die is kept', () => {
    const braced = { label: 'Braced', desc: '', ops: [{ op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true }] } as const;
    const BRACE = reaction('brace', 'before', { ops: [{ op: 'applyStatus', key: statusKey('braced'), def: braced, duration: tick(1000) }] });
    const g = running(play(...foeFirst([HIT, BRACE]), armed('A', BRACE)));
    expect(needs(HIT, body(g, 'M'), g.rows, id('A'), g.grid, g.now, RULES).second).toEqual([id('A')]);
    const r = reduce(g, { type: 'act', by: id('M'), ability: HIT.id, aim: id('A'), rolls: { dice: { [id('A')]: [] }, react: { [id('A')]: 1 }, second: { [id('A')]: 20 } } }, ctx);
    expect(r.effects.filter(e => e.type === 'refused' || e.type === 'crit')).toEqual([]);
    expect(rowHp(body(r.fight, 'A'))).toBe(rowHp(body(play(...foeFirst([HIT]), hit('M', 'A', HIT, 20)).fight, 'A')));
  });

  test('the machine: every state of a reaction under every event of tests/models/wave2-events.ts (table 8.9.1)', () => {
    const key = (e: ReactEvent): string => e.type === 'arm' ? `arm ${e.up ? 'up' : 'down'}` : e.type === 'moment' ? `moment ${e.may ? 'may' : 'may not'} at ${e.aim}` : e.type;
    const expected: Record<ReactState, Record<string, ReactState>> = {
      // rules-4.3a waits on the owner: today a reactor who is down arms
      unarmed: { 'arm up': 'armed', 'arm down': 'armed', disarm: 'unarmed', 'moment may at up': 'unarmed', 'moment may at down': 'unarmed', 'moment may not at up': 'unarmed', resolves: 'unarmed', turnStart: 'unarmed', down: 'unarmed' },
      // rules-4.2 waits on the owner: today a reaction fires at an aim already down
      armed: { 'arm up': 'armed', 'arm down': 'armed', disarm: 'unarmed', 'moment may at up': 'fired', 'moment may at down': 'fired', 'moment may not at up': 'armed', resolves: 'armed', turnStart: 'armed', down: 'unarmed' },
      fired: { 'arm up': 'fired', 'arm down': 'fired', disarm: 'fired', 'moment may at up': 'fired', 'moment may at down': 'fired', 'moment may not at up': 'fired', resolves: 'spent', turnStart: 'fired', down: 'unarmed' },
      spent: { 'arm up': 'spent', 'arm down': 'spent', disarm: 'unarmed', 'moment may at up': 'spent', 'moment may at down': 'spent', 'moment may not at up': 'spent', resolves: 'spent', turnStart: 'armed', down: 'unarmed' },
    };
    expect(REACT_WALK.map(key).sort()).toEqual(Object.keys(expected.unarmed).sort());
    for (const s of REACT_STATES) for (const e of REACT_WALK) expect(reactStep(s, e), `${s} × ${key(e)}`).toBe(expected[s][key(e)]!);
  });

  test('a hunter who is down may arm a reaction (rules-4.3a, as the app does today)', () => {
    const r = play(add(row('A', 'party', { abilities: [HIT, PARRY] }), row('B', 'party'), row('M', 'foe')), start(['M', 20], ['A', 10], ['B', 5]), hit('M', 'A', BIG));
    expect(rowHp(body(r.fight, 'A'))).toBe(0);
    const out = reduce(r.fight, armed('A', PARRY), ctx);
    expect([out.effects, body(out.fight, 'A').armed]).toEqual([[], { ability: PARRY.id, on: null, spent: false }]);
  });

  test('a second ally\'s after reaction still fires at an attacker the first one\'s took down, and that kill is not counted (rules-4.2, as the app does today)', () => {
    const KILL = reaction('kill', 'after', { effect: { type: 'physical', by: 'hand', formula: f('999') } });
    const wide = ability('blast', 'quake', '5', { range: tiles(20), foesOnly: true, cost: { ...HIT.cost, mana: 0 } });
    const r = play(add(row('A', 'party', { abilities: [KILL], place: place(5, 5) }), row('B', 'party', { abilities: [KILL], place: place(6, 5) }), row('C', 'party'), row('M', 'foe', { abilities: [wide] })),
      start(['M', 20], ['A', 10], ['B', 9], ['C', 1]), armed('A', KILL), armed('B', KILL),
      { type: 'act', by: id('M'), ability: wide.id, aim: place(5, 5), rolls: rolls({ A: 1, B: 1 }, { A: [], B: [] }) });
    expect(r.fight!.phase).toBe('ended');
    expect([rowHp(body(r.fight, 'M')), body(r.fight, 'A').armed?.spent, body(r.fight, 'B').armed?.spent]).toEqual([0, true, true]);
    expect(tallyOf(body(r.fight, 'A')).kills).toEqual([]);
  });

  test('a reaction that pushes its aim past a threshold sets it off for all to see: its burst lands, is logged and is told (rules-4.3b)', () => {
    const mark = (threshold: StackDef['stack']['threshold']): StackDef => ({ label: 'Mark', desc: '', ops: [], stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight', threshold } });
    const brand = (d: StackDef) => reaction('brand', 'after', { ops: [{ op: 'applyStatus', key: statusKey('mark'), def: d, duration: null }] });
    const pop = mark({ at: { kind: 'count', n: 1 }, to: { kind: 'bearer' }, then: 'spend', ops: [{ op: 'damage', type: 'magical', amount: f('7'), when: 'use' }] });
    const fought = (d: StackDef) => play(...foeFirst([HIT, brand(d)]), armed('A', brand(d)), hit('M', 'A'));
    const plain = fought(mark(null)), burst = fought(pop);
    const m = body(burst.fight, 'M');
    expect(rowHp(body(plain.fight, 'M')) - rowHp(m)).toBe(afterDefence(7, 'magical', body(burst.fight, 'A').sheet, m.sheet, RULES));
    expect(burst.effects).toContainEqual({ type: 'burst', id: id('M') });
    expect(running(burst).log.some(l => l.text.includes('M\'s Mark goes off (M '))).toBe(true);
  });

  test('a use sets off at most 4 reactions', () => {
    const wide = ability('blast', 'quake', '5', { range: tiles(20), foesOnly: true, cost: { ...HIT.cost, mana: 0 } });
    const party = ['A', 'B', 'C', 'D', 'E'].map((n, i) => row(n, 'party', { abilities: [PARRY], place: place(4 + i, 5) }));
    const begin = play(add(...party, row('M', 'foe', { abilities: [wide] })), start(['M', 20], ['A', 10], ['B', 9], ['C', 8], ['D', 7], ['E', 6]), ...party.map(p => armed(p.name, PARRY)));
    const all = Object.fromEntries(party.map(p => [p.name, 1]));
    const r = reduce(begin.fight, { type: 'act', by: id('M'), ability: wide.id, aim: place(6, 5), rolls: rolls(all, Object.fromEntries(party.map(p => [p.name, []]))) }, ctx);
    expect(r.fight!.rows.filter(x => x.armed?.spent).length).toBe(K.reactionsPerUse);
  });
});

describe('surprise (kits design 8.7.5)', () => {
  test('a surprised side\'s openings come a round later, but an alert row\'s', () => {
    const plain = play(add(row('A', 'party'), row('M', 'foe'), row('N', 'foe', { statuses: [st('alert', null, { op: 'alert' })] })), start(['A', 1], ['M', 20], ['N', 20]));
    const shocked = play(add(row('A', 'party'), row('M', 'foe'), row('N', 'foe', { statuses: [st('alert', null, { op: 'alert' })] })),
      { ...start(['A', 1], ['M', 20], ['N', 20]), surprised: 'foe' } as Command);
    expect(body(shocked.fight, 'M').at - body(plain.fight, 'M').at).toBe(RULES.fight.kit.surprise * RULES.fight.round);
    expect(body(shocked.fight, 'N').at).toBe(body(plain.fight, 'N').at);
    expect(running(shocked).log.some(l => l.text.includes('the foes are surprised'))).toBe(true);
  });
});

describe('a fallen monster\'s extraction (implicit audit row 39)', () => {
  const MAX = RULES.shadow.maxAttempts;
  const extract = (who: string, outcome: 'failed' | 'crumbled' | 'risen', by = 'A'): Command => ({ type: 'extract', id: id(who), by: id(by), outcome });
  /** A against two monsters; M falls to the 999 hit, N stands, so the fight goes on. */
  const fallen = () => [add(row('A', 'party'), row('M', 'foe'), row('N', 'foe')), start(['A', 20], ['M', 10], ['N', 5]), hit('A', 'M', BIG)] as const;

  test('the machine: an attempt under the DC counts one, the last one spends the corpse, a natural 1 or a shadow risen ends it', () => {
    expect(extractionStep(UNTRIED, 'failed', MAX)).toEqual({ at: 'open', tried: 1 });
    expect(extractionStep({ at: 'open', tried: MAX - 1 }, 'failed', MAX)).toEqual({ at: 'gone', why: 'spent' });
    expect(extractionStep({ at: 'open', tried: 1 }, 'crumbled', MAX)).toEqual({ at: 'gone', why: 'crumbled' });
    expect(extractionStep(UNTRIED, 'risen', MAX)).toEqual({ at: 'gone', why: 'risen' });
    for (const why of ['risen', 'crumbled', 'spent'] as const) for (const o of EXTRACTION_WALK) expect(extractionStep({ at: 'gone', why }, o, MAX)).toBeNull();
    expect(extractionStep({ at: 'open', tried: MAX }, 'failed', MAX), 'a rule lowered since leaves none').toBeNull();
    expect([attemptsLeft(UNTRIED, MAX), attemptsLeft({ at: 'open', tried: 1 }, MAX), attemptsLeft({ at: 'gone', why: 'risen' }, MAX)]).toEqual([MAX, MAX - 1, 0]);
  });

  test('an extraction is made by a hunter row of the fight: one named by a monster or by nobody in the fight is refused', () => {
    refuses(play(...fallen()).fight, extract('M', 'failed', 'N'), 'notExtractor');
    refuses(play(...fallen()).fight, extract('M', 'failed', 'ghost'), 'notExtractor');
    expect(body(play(...fallen(), extract('M', 'failed', 'A')).fight, 'M').extraction).toEqual({ at: 'open', tried: 1 });
  });

  test('each failed attempt is kept on the corpse\'s row with a log line, and the stored fight read back keeps it, so a reload gives no try back', () => {
    const r = play(...fallen(), extract('M', 'failed'));
    expect(body(r.fight, 'M').extraction).toEqual({ at: 'open', tried: 1 });
    expect(r.fight!.log[0]!.text).toContain(`The extraction of M fails (${MAX - 1} left).`);
    expect(running(r).now, 'no time passes').toBe(running(play(...fallen())).now);
    const read = parseFight(JSON.parse(JSON.stringify(r.fight)), RULES);
    expect(body(read, 'M').extraction).toEqual({ at: 'open', tried: 1 });
  });

  test('the attempts run out: after the last failure the corpse takes no more, risen or crumbled ends it, and only a fallen monster takes one', () => {
    const spent = play(...fallen(), ...Array.from({ length: MAX }, () => extract('M', 'failed')));
    expect(body(spent.fight, 'M').extraction).toEqual({ at: 'gone', why: 'spent' });
    refuses(spent.fight, extract('M', 'risen'), 'noAttempts');
    const risen = play(...fallen(), extract('M', 'risen'));
    expect(body(risen.fight, 'M').extraction).toEqual({ at: 'gone', why: 'risen' });
    refuses(risen.fight, extract('M', 'failed'), 'noAttempts');
    expect(body(play(...fallen(), extract('M', 'crumbled')).fight, 'M').extraction).toEqual({ at: 'gone', why: 'crumbled' });
    const f0 = play(...fallen()).fight;
    refuses(f0, extract('N', 'failed'), 'notNow');
    refuses(f0, extract('A', 'failed'), 'notMonster');
    refuses(f0, extract('ghost', 'failed'), 'unknown');
  });

  test('after the fight ends its corpses may still be tried, until the fight is closed', () => {
    expect(play(...fallen(), { type: 'end' }).fight!.phase).toBe('ended');
    expect(body(play(...fallen(), { type: 'end' }, extract('M', 'risen')).fight, 'M').extraction).toEqual({ at: 'gone', why: 'risen' });
    refuses(null, extract('M', 'failed'), 'notNow');
  });
});

describe('the fight\'s table: every state under every command (SMX-rules-3)', () => {
  const ALL: Record<CommandType, true> = {
    add: true, remove: true, start: true, act: true, move: true, endTurn: true, release: true, setIntent: true, reveal: true, place: true, adjust: true, refill: true,
    life: true, status: true, settle: true, paint: true, zoneAdd: true, zoneRemove: true, resize: true, arm: true, extract: true, end: true, clear: true,
  };
  const SETUP: CommandType[] = ['add', 'remove', 'start', 'setIntent', 'reveal', 'place', 'adjust', 'refill', 'life', 'status', 'paint', 'zoneAdd', 'zoneRemove', 'resize', 'arm', 'extract', 'end', 'clear'];
  const RUNNING = (Object.keys(ALL) as CommandType[]).filter(t => t !== 'start');
  const CHARGE = ability('blast', 'charge', '10 * (1 + charge)', { channel: { growth: 'linear', max: 5 }, range: tiles(20) });
  const owing = play(add(row('A', 'party', { abilities: [HIT, CHARGE], statuses: [haste(-50)] }), row('M', 'foe')), start(['A', 20], ['M', 1]),
    { type: 'act', by: id('A'), ability: CHARGE.id, aim: id('M'), rolls: rolls() }, hit('M', 'A')).fight;
  const states: [string, Fight | null, readonly CommandType[]][] = [
    ['none', null, ['add']],
    ['setup', play(add(row('A', 'party'), row('M', 'foe'))).fight, SETUP],
    ['running, acting', play(...duel()).fight, RUNNING],
    // rules-3.2 waits on the owner: today a turn may be taken and ended (act, move, endTurn) while dice are owed
    ['running, owing', owing, RUNNING],
    ['ended', play(...duel(), { type: 'end' }).fight, ['extract', 'clear']],
  ];

  test('each state takes the commands of its row and refuses the rest', () => {
    expect(runningState(running({ fight: states[3]![1] })).at).toBe('owing');
    for (const [name, fight, takes] of states) {
      for (const t of Object.keys(ALL) as CommandType[]) expect(can(fight, t), `${name} × ${t}`).toBe(takes.includes(t));
    }
  });
});

describe('a status whose time ran out counts for no reader while its bearer\'s settle still owes it (SMX-rules-2)', () => {
  /** Ends at `until` and owes its heal of 1 a round to its bearer's next settle, so it stays on the row past its end. */
  const owing = (key: string, until: number, ...ops: Op[]): Status => st(key, until, ...ops, { op: 'heal', amount: f('1') });
  /** A worn status whose trigger hits the striker for 50 when its bearer is struck, only while it holds `need` when one is named. */
  const thorns = (need: string | null, until: number | null = null): Status => statusOn({
    label: 'Thorns', desc: '', ops: [{ op: 'heal', amount: f('1') }], triggers: [{
      on: 'struck', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'physical', amount: f('50') }],
      ...(need ? { need: { kind: 'holds', key: statusKey(need) } } : {}),
    }],
  }, st('thorns', until));
  /** A at 0 passes; M's turn at 500, when A's statuses of `until` 500 have run out and A's settle at 1000 still owes them. */
  const atM = (...statuses: Status[]) => [add(row('A', 'party', { statuses }), row('M', 'foe')), start(['A', 20], ['M', 10]), pass('A')] as const;
  /** M at 0 passes; A's turn at 500, when M's statuses of `until` 500 have run out and M's settle at 1000 still owes them. */
  const atA = (a: Partial<NewRow>, ...statuses: Status[]) => [add(row('A', 'party', a), row('M', 'foe', { statuses })), start(['A', 10], ['M', 20]), pass('M')] as const;
  const hurt = (fight: Fight | null, name: string): number => body(fight, name).sheet.hpMax - rowHp(body(fight, name));

  test('the status is on its bearer\'s row at 500, owed', () => {
    expect(body(play(...atM(owing('ward', 500))).fight, 'A').statuses.map(s => [s.key, s.owed])).toEqual([['ward', true]]);
  });

  test('a trigger that needs a status its bearer held until 500 does not fire when its bearer is struck at 500; held until 2000, it does', () => {
    expect(hurt(play(...atM(owing('ward', 500), thorns('ward')), hit('M', 'A')).fight, 'M')).toBe(0);
    expect(hurt(play(...atM(owing('ward', 2000), thorns('ward')), hit('M', 'A')).fight, 'M')).toBeGreaterThan(0);
  });

  test('the trigger of a status that ran out at 500 does not fire at 500', () => {
    expect(hurt(play(...atM(thorns(null, 500)), hit('M', 'A')).fight, 'M')).toBe(0);
    expect(hurt(play(...atM(thorns(null, 2000)), hit('M', 'A')).fight, 'M')).toBeGreaterThan(0);
  });

  test('the table\'s doc does not show it, and the GM\'s card shows no taunt from it', () => {
    const taunted = (until: number) => ({ ...owing('taunted', until, { op: 'taunt' }), source: { id: id('M'), tier: 0 } });
    const doc = (until: number) => {
      const fight = play(...atM(owing('ward', until), taunted(until))).fight!;
      const d = fightDoc(fight, RULES, { by: 'd-gm' as DeviceId, at: '2026-11-21T10:00:00.000Z', was: null, keyOf: h => h as unknown as SheetKey })!;
      const a = d.ended ? null : d.rows.find(r => r.id === 'A')!;
      return [a?.statuses.map(s => s.key), a?.taunt, tauntOf(body(fight, 'A'), tick(500), RULES)];
    };
    expect(doc(500)).toEqual([[], null, null]);
    expect(doc(2000)).toEqual([['ward', 'taunted'], { by: 'M', left: 1.5 }, { by: 'M', left: 1.5 }]);
  });

  test('a hunter\'s turn puts its curse on a foe whose same status ran out at 500, and not on one that holds it until 2000', () => {
    const HEX = { ...ability('curse', 'hex', null, FAR), effect: null, ops: [{ op: 'applyStatus', key: statusKey('hex'), def: { label: 'Hex', desc: '', ops: [] }, duration: tick(2000) } as UseOp] };
    const choice = (until: number) => {
      const f = running(play(...atA({ abilities: [HEX, HIT] }, owing('hex', until))));
      const c = sensible(f, body(f, 'A'), RULES);
      return c.type === 'act' ? c.ability.id : c.type;
    };
    expect([choice(500), choice(2000)]).toEqual(['hex', 'hit']);
  });

  test('a use gated on the target holding a mark is refused on a foe whose mark ran out at 500', () => {
    const MARKED = ability('strike', 'marked', '10', { ...FAR, gates: [{ kind: 'holds', key: statusKey('mark'), on: 'target', atLeast: 1 }] });
    const use = (until: number) => reduce(running(play(...atA({ abilities: [MARKED] }, owing('mark', until)))), hit('A', 'M', MARKED), ctx).effects.find(e => e.type === 'refused');
    expect([use(500), use(2000)]).toEqual([{ type: 'refused', reason: 'gated' }, undefined]);
  });
});
