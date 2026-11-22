// What a fight keeps of each row for its facts (src/core/combat/row-tally.ts) and the facts a hunter row gets at the
// fight's end (src/core/combat/fight-facts.ts), each from a fight played on the reducer with fixed numbers.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { tiles } from '../src/core/combat/space.ts';
import type { Side } from '../src/core/combat/space.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified } from '../src/core/combat/effect-ops.ts';
import type { Body, Origin } from '../src/core/combat/effect-ops.ts';
import { afterDefence } from '../src/core/combat/land.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { fightId, reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Ended, Fight, NewRow } from '../src/core/combat/fight.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { NO_TALLY, tallied, tallyOf, turnKillsMax } from '../src/core/combat/row-tally.ts';
import { killFacts, killsSeen, rowFacts } from '../src/core/combat/fight-facts.ts';
import { parseFact } from '../src/core/hunter/facts.ts';

const ctx: Ctx = { rules: RULES };
const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const id = combatantId;
const HUNTER: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
const WOLF: Origin = { kind: 'monster', name: 'Wolf', rank: 'D', archetype: 'brute', monsterKind: 'normal', tweak: { hp: 1, dealt: 1, stats: {}, traits: [] }, type: 'Beast' };
const ALPHA: Origin = { ...WOLF, name: 'Alpha', monsterKind: 'boss', rank: 'C' };
const ELDER: Origin = { ...WOLF, name: 'Elder', monsterKind: 'mythic', rank: 'B' };
const PACKLEAD: Origin = { ...WOLF, name: 'Packlead', monsterKind: 'elite', rank: 'C' };
const FAR = { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as const;
const ability = (name: string, text: string): Ability => ({ ...abilityOf('strike', { id: abilityId(name), name }, RULES), ...FAR, effect: { type: 'physical', by: 'hand', formula: f(text) } });
const HIT = ability('hit', '10'), BIG = ability('big', '9999');
function row(name: string, side: Side, origin: Origin = side === 'party' ? HUNTER : WOLF): NewRow {
  const hpMax = modified(origin, [], RULES).sheet.hpMax;
  return {
    id: id(name), name, side, kind: side === 'party' ? 'hunter' : 'monster', origin, tier: 0, place: null, life: { at: 'up', hp: hpMax }, mana: 10, fatigue: 0, shield: null, stagger: null,
    channel: null, threat: side === 'foe' ? {} : null, statuses: [], readyAt: {}, abilities: [HIT, BIG], intent: null, holder: null, xp: 0,
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
const begin = (...rows: NewRow[]): Command[] => [
  { type: 'add', fightId: fightId('f'), rows, openings: [] },
  { type: 'start', openings: rows.map((r, i) => ({ id: r.id, d20: 20 - i, tie: 0 })) },
];
/** A use forced in by the GM: the aim's reaction die `react`, so a 10 against a strike is caught. */
const use = (by: string, at: string, a: Ability = HIT, react = 10): Command => ({ type: 'act', by: id(by), ability: a.id, aim: id(at), rolls: { dice: {}, react: { [at]: react } }, force: true });
const body = (fight: Fight, name: string): Body => fight.rows.find(r => r.id === name)!;
/** What a hit of `raw` leaves through a light-kit hunter's armor and a wolf's (rule 12). */
const into = (raw: number, from: Origin, to: Origin): number => afterDefence(raw, 'physical', modified(from, [], RULES).sheet, modified(to, [], RULES).sheet, RULES);

describe('a row\'s tally in a fight', () => {
  test('a hunter that hits a wolf twice counts two hits and the HP they took; the wolf keeps nothing but its kills', () => {
    const fight = play(...begin(row('A', 'party'), row('W', 'foe')), use('A', 'W'), use('A', 'W'));
    const a = tallyOf(body(fight, 'A'));
    expect([a.hits, a.dealt, a.struck]).toEqual([2, 2 * into(10, HUNTER, WOLF), 0]);
    expect(body(fight, 'W').tally).toBeUndefined();
  });

  test('a hunter the wolf strikes counts it struck, the HP it lost and its lowest share of HP', () => {
    const fight = play(...begin(row('A', 'party'), row('W', 'foe')), use('W', 'A'));
    const a = body(fight, 'A'), t = tallyOf(a), lost = into(10, WOLF, HUNTER);
    expect([t.struck, t.taken, t.low]).toEqual([1, lost, Math.round(100 * (a.sheet.hpMax - lost) / a.sheet.hpMax)]);
  });

  test('a kill counts on the killer with its HP share and its turn; the hunter the wolf took down counts the fall and who did it', () => {
    const fight = play(...begin(row('A', 'party'), row('B', 'party'), row('W', 'foe'), row('V', 'foe')), use('W', 'B', BIG), use('A', 'W', BIG));
    expect(tallyOf(body(fight, 'A')).kills).toEqual([{ row: id('W'), hpPct: 100, turn: 1 }]);
    expect(tallyOf(body(fight, 'W')).kills).toEqual([{ row: id('B'), hpPct: 100, turn: 0 }]);
    const b = tallyOf(body(fight, 'B'));
    expect([b.downs, b.downedBy]).toEqual([1, [id('W')]]);
  });

  test('a turn begun counts on its row, and two kills in one turn are the most in a turn', () => {
    const fight = play(...begin(row('A', 'party'), row('W', 'foe'), row('V', 'foe'), row('U', 'foe')), use('A', 'W', BIG), use('A', 'V', BIG));
    const t = tallyOf(body(fight, 'A'));
    expect([t.turns, t.kills.length, turnKillsMax(t)]).toEqual([1, 2, 2]);
  });

  test('a stored fight reads its tallies back whole, and a tally field that does not read is left out', () => {
    const fight = play(...begin(row('A', 'party'), row('W', 'foe'), row('V', 'foe')), use('A', 'W', BIG), use('V', 'A'));
    const back = parseFight(JSON.parse(JSON.stringify(fight)), RULES);
    expect(back?.rows.map(r => r.tally)).toEqual(fight.rows.map(r => r.tally));
    const junk = JSON.parse(JSON.stringify(fight));
    junk.rows[0].tally = { ...junk.rows[0].tally, hits: -3, kills: [{ row: 'W', hpPct: 'x', turn: 1 }] };
    const read = parseFight(junk, RULES)!;
    expect(read.rows[0]!.tally?.hits).toBeUndefined();
    expect(read.rows[0]!.tally?.kills).toBeUndefined();
  });

  test('a change that moves nothing a tally counts answers the rows as they were', () => {
    const fight = play(...begin(row('A', 'party'), row('W', 'foe')));
    expect(tallied(fight.rows, { type: 'changed', before: fight.rows })).toEqual([...fight.rows]);
    expect(tallyOf({})).toEqual(NO_TALLY);
  });
});

describe('a hunter row\'s facts at the fight\'s end', () => {
  test('a won fight: its outcome, the kill with the monster\'s type and rank, the foes by name, read back by the fact parser', () => {
    const fight = play(...begin(row('A', 'party'), row('B', 'party'), row('W', 'foe'), row('X', 'foe', ALPHA)), use('A', 'W', BIG), use('A', 'X', BIG)) as Ended;
    expect(fight.phase).toBe('ended');
    const facts = rowFacts(fight, id('A'), 'D', 'Goblin Den');
    const [fact, ...kills] = facts;
    expect(fact).toMatchObject({ kind: 'fight', outcome: 'won', up: true, kills: 2, bosses: 1, turnKills: 2, allies: 1, alliesDown: 0, sideUp: 2, foes: 2, foeTop: 1, bossTop: 1, gate: 'Goblin Den', names: 'Wolf, Alpha' });
    expect(kills).toEqual([
      { kind: 'kill', monster: 'Wolf', rank: 'D', type: 'Beast', mkind: 'normal', above: 0, hpPct: 100, payback: false, where: 'fight' },
      { kind: 'kill', monster: 'Alpha', rank: 'C', type: 'Beast', mkind: 'boss', above: 1, hpPct: 100, payback: false, where: 'fight' },
    ]);
    for (const x of facts) expect(parseFact(JSON.parse(JSON.stringify(x)))).toEqual(x);
    expect(rowFacts(fight, id('W'), 'D', '')).toEqual([]);
  });

  test('a mythic defeated counts among the fight\'s bosses and gives its boss rank, as a boss does; an elite does not', () => {
    const fight = play(...begin(row('A', 'party'), row('E', 'foe', ELDER), row('P', 'foe', PACKLEAD)), use('A', 'E', BIG), use('A', 'P', BIG)) as Ended;
    expect(rowFacts(fight, id('A'), 'D', '')[0]).toMatchObject({ outcome: 'won', kills: 2, bosses: 1, bossTop: 2 });
  });

  test('a kill of the monster that had put the hunter down is payback, and a pack is named once with its count', () => {
    const t = { ...NO_TALLY, kills: [{ row: id('W'), hpPct: 40, turn: 3 }], downedBy: [id('W')] };
    const rows = play(...begin(row('A', 'party'), row('W', 'foe'))).rows;
    expect(killFacts(killsSeen(t, rows), 'E', 'solo')).toEqual([{ kind: 'kill', monster: 'Wolf', rank: 'D', type: 'Beast', mkind: 'normal', above: 1, hpPct: 40, payback: true, where: 'solo' }]);
    const pack = play(...begin(row('A', 'party'), row('W', 'foe'), row('V', 'foe'), row('U', 'foe')), { type: 'end' }) as Ended;
    expect(rowFacts(pack, id('A'), 'D', '')[0]).toMatchObject({ outcome: 'ended', names: 'Wolf ×3', foes: 3, bossTop: null });
  });
});
