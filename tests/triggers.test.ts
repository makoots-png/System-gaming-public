// A trigger: what a status does when something happens to its bearer (docs/agent-handoff/kits/design.md section 1.3,
// table 2.5). Every expected number comes from the design: the order of rule 19b, the depth of 2, the 16 firings a
// command, the three limits, a refund's limit of once a round, and a trigger's ops at their averages as a hit its bearer
// deals (rule 12 through `afterDefence`).
import { tallyOf } from '../src/core/combat/row-tally.ts';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import type { Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId, tag } from '../src/core/combat/ability-types.ts';
import type { Ability, Outcome } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, LandOp, Origin, StackDef, Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { afterDefence } from '../src/core/combat/land.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { eventsOf, READY, tripStep } from '../src/core/combat/triggers.ts';
import type { Limit, Trigger, Trip } from '../src/core/combat/triggers.ts';
import { fightId, reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow } from '../src/core/combat/fight.ts';
import { LIMITS, WALK_EVENTS } from './models/trip-events.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';

const ctx: Ctx = { rules: RULES };
const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const id = combatantId;
const origin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
const FAR = { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as const;
const ability = (name: string, text: string, o: Partial<Ability> = {}): Ability => {
  const a = abilityOf('strike', { id: abilityId(name), name }, RULES);
  return { ...a, ...FAR, effect: { type: 'physical', by: 'hand', formula: f(text) }, ...o };
};
const HIT = ability('hit', '10');
const SWORD = ability('sword', '10', { tags: [tag('sword')] });
const BIG = ability('big', '999');
const PAIN: StackDef = { label: 'Pain', desc: '', ops: [], stack: { cap: 20, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
const addPain = (n = 1): LandOp => ({ op: 'applyStatus', key: statusKey('pain'), def: PAIN, duration: null, stacks: n });
const worn = (label: string, ...triggers: Trigger[]): StatusDef => ({ label, desc: '', ops: [], triggers });
const on = (key: string, def: StatusDef): Status => ({ key: statusKey(key), def, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) } as Status);
function row(name: string, side: Side, statuses: Status[] = [], o: RowPatch<NewRow> = {}): NewRow {
  const { kind, hp, ...rest } = o;
  const hpMax = modified(rest.origin ?? origin, statuses, RULES).sheet.hpMax;
  return {
    id: id(name), name, side, ...lifeAt(kind ?? (side === 'party' ? 'hunter' : 'monster'), hp ?? hpMax), origin, tier: 0, place: null, mana: 10, fatigue: 0, shield: null, stagger: null,
    channel: null, threat: side === 'foe' ? {} : null, statuses, readyAt: {}, abilities: [HIT, SWORD, BIG], intent: null, holder: null, xp: 0, ...rest,
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
const body = (fight: Fight, name: string): Body => fight.rows.find(r => r.id === name)!;
const stacksOf = (b: Body, key: string): number => b.statuses.find(s => s.key === key)?.stacks ?? 0;
const duel = (a: NewRow, m: NewRow, ...rest: NewRow[]): Command[] => [
  { type: 'add', fightId: fightId('f'), rows: [a, m, ...rest], openings: [] },
  { type: 'start', openings: [a, m, ...rest].map((r, i) => ({ id: r.id, d20: i === 0 ? 20 : 1, tie: 0 })) },
];
const use = (by: string, at: string, a: Ability = HIT, react = 10): Command => ({ type: 'act', by: id(by), ability: a.id, aim: id(at), rolls: { dice: {}, react: { [at]: react } }, force: true });
/** A light-kit body takes a hit of `raw` from another through armor 10 (rule 12). */
const through = (raw: number): number => afterDefence(raw, 'physical', modified(origin, [], RULES).sheet, modified(origin, [], RULES).sheet, RULES);

describe('a trigger\'s limit, cell by cell (table 2.5)', () => {
  const run = (limit: Limit, rounds: number[]): boolean[] => {
    let t: Trip = READY;
    return rounds.map(round => { const s = tripStep(t, { type: 'event', round }, limit); t = s.trip; return s.fires; });
  };
  test('every time fires on each event and stays ready', () => {
    expect(run({ kind: 'each' }, [0, 0, 0])).toEqual([true, true, true]);
  });
  test('once a round fires on the first event of a round and not again until the round moves on', () => {
    expect(run({ kind: 'round' }, [0, 0, 1, 1, 3])).toEqual([true, false, true, false, true]);
  });
  test('n a fight fires n times and is then spent for the fight', () => {
    expect(run({ kind: 'fight', n: 2 }, [0, 1, 2, 3])).toEqual([true, true, false, false]);
  });
  test('a skipped event (past the depth or the firings) changes nothing in any state', () => {
    for (const limit of LIMITS) for (const e of WALK_EVENTS) {
      const after = tripStep(READY, e, limit).trip;
      expect(tripStep(after, { type: 'skipped' }, limit)).toEqual({ trip: after, fires: false });
    }
  });
});

describe('the events a use raises, in rule 19b\'s order', () => {
  const o = (target: string, x: Partial<Outcome>): Outcome => ({
    target: id(target), avoid: 'caught', to: null, crit: false, raw: 10, dealt: 9, absorbed: 0, type: 'physical', statuses: [], threat: 0, stagger: 0, staggered: false, channelBroken: false, down: false, ...x,
  });
  test('by outcome, the user\'s events before the target\'s; then the use itself when the ability has tags', () => {
    const list = eventsOf({ ops: [], tags: [tag('sword')] }, id('A'), [o('M', { crit: true, down: true, statuses: [statusKey('pain')] }), o('N', { avoid: 'out', dealt: 0 })], [], []);
    expect(list.map(e => `${e.bearer} ${e.event}${e.key ? ` ${e.key}` : ''}`)).toEqual([
      'A hitDealt', 'A critDealt', 'A kill', 'M struck', 'M critTaken', 'M down', 'M statusGained pain', 'N avoided', 'A used',
    ]);
    expect(list.every(e => e.tags.includes(tag('sword')))).toBe(true);
  });
  test('a heal is no hit, a resisted curse is avoided, and a cure that takes a status whole ends it', () => {
    const cure = { ops: [{ op: 'cureStatus', key: statusKey('burn') }] as Ability['ops'] };
    const before = [{ ...row('M', 'foe'), statuses: [on('burn', worn('Burn'))] }] as unknown as Body[], after = [{ ...row('M', 'foe') }] as unknown as Body[];
    expect(eventsOf(cure, id('A'), [o('M', { type: 'heal' })], before, after).map(e => e.event)).toEqual(['statusEnded']);
    expect(eventsOf({ ops: [] }, id('A'), [o('M', { avoid: 'resisted', type: 'magical' })], [], []).map(e => e.event)).toEqual(['hitDealt', 'struck', 'avoided']);
  });
});

describe('firing (rule 19b)', () => {
  const painIsPower = worn('Pain is Power', { on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' }, ops: [addPain()] });
  test('a worn status adds a stack to its bearer on each hit it deals, after the hit', () => {
    const fight = play(...duel(row('A', 'party', [on('pip', painIsPower)]), row('M', 'foe')), use('A', 'M'), use('A', 'M'));
    expect(stacksOf(body(fight, 'A'), 'pain')).toBe(2);
    expect(fight.log.some(l => l.text.includes('Then: A\'s Pain is Power'))).toBe(true);
  });
  test('a trigger that names a tag answers only a hit of an ability with it', () => {
    const voidKnight = worn('Void Knight', { on: 'hitDealt', tag: tag('sword'), to: 'other', limit: { kind: 'each' }, ops: [addPain()] });
    const fight = play(...duel(row('A', 'party', [on('vk', voidKnight)]), row('M', 'foe')), use('A', 'M'), use('A', 'M', SWORD));
    expect(stacksOf(body(fight, 'M'), 'pain')).toBe(1);
  });
  test('Retribution: a foe that avoids a use hits the user back, at its average through the user\'s armor', () => {
    const retribution = worn('Retribution', { on: 'avoided', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'physical', amount: f('2d6'), when: 'use' }] });
    const curse = ability('curse', '10', { delivery: { kind: 'direct' } });
    const start = duel(row('A', 'party', [], { abilities: [curse] }), row('M', 'foe', [on('ret', retribution)]));
    const fight = play(...start, use('A', 'M', curse, 20));
    const a = body(fight, 'A');
    expect(a.sheet.hpMax - rowHp(a)).toBe(through(7));
  });
  test('a chain stops at depth 2: struck hits back, that hit\'s struck hits back, and the next is not fired', () => {
    const thorns = worn('Thorns', { on: 'struck', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'physical', amount: f('10'), when: 'use' }] });
    const fight = play(...duel(row('A', 'party', [on('th', thorns)]), row('M', 'foe', [on('th', thorns)])), use('A', 'M'));
    const a = body(fight, 'A'), m = body(fight, 'M');
    // A's hit (depth 0), M's thorns on A (depth 1), A's thorns on M (depth 2); M's thorns would be depth 3
    expect([a.sheet.hpMax - rowHp(a), m.sheet.hpMax - rowHp(m)]).toEqual([through(10), 2 * through(10)]);
  });
  test('at most 16 triggers fire in one command, whatever the depth', () => {
    const four = worn('Four', ...Array.from({ length: 4 }, (): Trigger => ({ on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' }, ops: [addPain()] })));
    const statuses = Array.from({ length: 5 }, (_, i) => on(`four-${i}`, four));
    const fight = play(...duel(row('A', 'party', statuses), row('M', 'foe')), use('A', 'M'));
    expect(stacksOf(body(fight, 'A'), 'pain')).toBe(RULES.fight.kit.fires);
  });
  test('once a round counts on the row: a second hit in the round does not fire it, nor a cure and a fresh copy', () => {
    const once = worn('Once', { on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'round' }, ops: [addPain()] });
    const fight = play(...duel(row('A', 'party', [on('once', once)]), row('M', 'foe')), use('A', 'M'), use('A', 'M'),
      { type: 'status', id: id('A'), remove: statusKey('once') }, { type: 'status', id: id('A'), add: { key: statusKey('once'), def: once, duration: null, tier: 0 } }, use('A', 'M'));
    expect(stacksOf(body(fight, 'A'), 'pain')).toBe(1);
  });
  test('Rend: a kill gives back the whole wait to the next turn, once a round, and the parser lowers every time to once a round', () => {
    const def = parseStatusDef({ label: 'Rend', desc: '', ops: [], triggers: [{ on: 'kill', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'refund', pct: 100 }] }] }, RULES)!;
    expect(def.triggers![0]!.limit).toEqual({ kind: 'round' });
    const fight = play(...duel(row('A', 'party', [on('rend', def)]), row('M', 'foe'), row('N', 'foe')), { type: 'act', by: id('A'), ability: BIG.id, aim: id('M'), rolls: { dice: {}, react: { [id('M')]: 10 } } });
    expect(fight.phase === 'running' && fight.currentId).toBe(id('A'));
    expect(tallyOf(body(fight, 'A')).kills.map(k => k.row)).toEqual([id('M')]);
  });
  test('a kill counts on the row, and the formula\'s kills reads it', () => {
    const reap = ability('reap', '10 * kills');
    const fight = play(...duel(row('A', 'party', [], { abilities: [BIG, reap] }), row('M', 'foe'), row('N', 'foe')), use('A', 'M', BIG), use('A', 'N', reap));
    const n = body(fight, 'N');
    expect(n.sheet.hpMax - rowHp(n)).toBe(through(10));
  });
  test('a turn\'s start fires its bearer\'s triggers, and stacks that leave on a move go when it moves', () => {
    const storage: StackDef = { label: 'Storage', desc: '', ops: [], stack: { cap: 5, leave: { kind: 'event', event: 'moved' }, keep: 'fight', threshold: null } };
    const easel = worn('Easel', { on: 'turnStart', to: 'self', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: statusKey('storage'), def: storage, duration: null, stacks: 2 }] });
    const started = play(...duel(row('A', 'party', [on('easel', easel)]), row('M', 'foe')));
    expect(stacksOf(body(started, 'A'), 'storage')).toBe(2);
    const held = { ...on('storage', storage), stacks: 3 } as Status;
    const moved = play(...duel(row('A', 'party', [held]), row('M', 'foe')), { type: 'move', by: id('A'), to: place(1, 3) });
    expect(stacksOf(body(moved, 'A'), 'storage')).toBe(0);
  });
  test('a status that runs out raises its end for the bearer\'s other statuses', () => {
    const mourn = worn('Mourning', { on: 'statusEnded', key: statusKey('shield-up'), to: 'self', limit: { kind: 'each' }, ops: [addPain(3)] });
    const brief = { ...on('shield-up', worn('Shield up')), until: tick(500) };
    const fight = play(...duel(row('A', 'party', [on('mourn', mourn), brief]), row('M', 'foe')), { type: 'endTurn', by: id('A') }, { type: 'endTurn', by: id('M') });
    expect(stacksOf(body(fight, 'A'), 'pain')).toBe(3);
  });
});

describe('moving counts, a bearer going down, and a condition on where (kits design 8.5 and 8.8)', () => {
  const CORRUPTION: StackDef = { label: 'Corruption', desc: '', ops: [], stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
  const slowDef: StatusDef = { label: 'Slowed', desc: '', ops: [{ op: 'speed', pct: -20 }] };
  const stacked = (key: string, def: StackDef, n: number): Status => ({ ...on(key, def), stacks: n } as Status);

  test('a move takes 2 stacks from the user to the target, with their def and source', () => {
    const give = ability('give', '1', { ops: [{ op: 'move', key: statusKey('corruption'), take: 2, from: 'user', as: null }] });
    const fight = play(...duel(row('A', 'party', [stacked('corruption', CORRUPTION, 3)], { abilities: [give] }), row('M', 'foe')), use('A', 'M', give));
    expect([stacksOf(body(fight, 'A'), 'corruption'), stacksOf(body(fight, 'M'), 'corruption')]).toEqual([1, 2]);
  });

  test('Essence Transfer: the user\'s first harmful status moves to the target whole; a safeguard on the target keeps it with the user', () => {
    const transfer = ability('transfer', '1', { ops: [{ op: 'move', key: 'harmful', take: 'all', from: 'user', as: null }] });
    const fight = play(...duel(row('A', 'party', [on('slowed', slowDef)], { abilities: [transfer] }), row('M', 'foe')), use('A', 'M', transfer));
    expect([body(fight, 'A').statuses.map(x => x.key), body(fight, 'M').statuses.map(x => x.key)]).toEqual([[], ['slowed']]);
    const guard = on('guard', { label: 'Guard', desc: '', ops: [{ op: 'safeguard' }] });
    const kept = play(...duel(row('A', 'party', [on('slowed', slowDef)], { abilities: [transfer] }), row('M', 'foe', [guard])), use('A', 'M', transfer));
    expect(body(kept, 'A').statuses.map(x => x.key)).toEqual(['slowed']);
  });

  test('a move put on as another key adds to the receiver\'s own status of that key, to its cap', () => {
    const MOMENTUM: StackDef = { ...CORRUPTION, label: 'Momentum' };
    const pour = ability('pour', '1', { ops: [{ op: 'move', key: statusKey('inertia'), take: 'all', from: 'target', as: statusKey('momentum') }] });
    const fight = play(...duel(row('A', 'party', [stacked('momentum', MOMENTUM, 4)], { abilities: [pour] }), row('M', 'foe', [stacked('inertia', CORRUPTION, 3)])), use('A', 'M', pour));
    expect([stacksOf(body(fight, 'A'), 'momentum'), body(fight, 'M').statuses.length]).toEqual([5, 0]);
  });

  test('a trigger that takes stacks from the one its bearer hit gives them to its bearer: the bearer\'s threshold goes off and the bearer gains the status, not the one that lost it', () => {
    const MARK: StackDef = { ...CORRUPTION, label: 'Mark', stack: { ...CORRUPTION.stack, threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, ops: [addPain(1)], then: 'spend' } } };
    const gained = (n: number): Trigger => ({ on: 'statusGained', key: statusKey('mark'), to: 'self', limit: { kind: 'each' }, ops: [addPain(n)] });
    const leech = worn('Leech', { on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'move', key: statusKey('mark'), take: 2, from: 'target', as: null }] }, gained(5));
    const fight = play(...duel(row('A', 'party', [on('leech', leech), stacked('mark', MARK, 1)]), row('M', 'foe', [on('watch', worn('Watch', gained(7))), stacked('mark', MARK, 2)])), use('A', 'M'));
    // A holds 1 and takes 2: 3 crosses its threshold, which spends them and puts 1 Pain on A; A gained Mark, so its own trigger puts 5 more
    expect([stacksOf(body(fight, 'A'), 'mark'), stacksOf(body(fight, 'A'), 'pain')]).toEqual([0, 6]);
    expect([stacksOf(body(fight, 'M'), 'mark'), stacksOf(body(fight, 'M'), 'pain')]).toEqual([0, 0]);
  });

  test('The Cycle Continues: when its bearer goes down, all its Corruption moves to its ally with the most HP within reach', () => {
    const cycle: StackDef = { ...CORRUPTION, triggers: [{ on: 'down', to: { kind: 'most', of: 'hp', radius: tiles(20), on: 'allies' }, limit: { kind: 'each' },
      ops: [{ op: 'move', key: 'event', take: 'all', from: 'user', as: null }] }] };
    const fight = play(...duel(row('A', 'party'), row('M', 'foe', [stacked('corruption', cycle, 3)]), row('N', 'foe', [], { hp: 5 }), row('O', 'foe')), use('A', 'M', BIG));
    expect(rowHp(body(fight, 'M'))).toBe(0);
    expect([stacksOf(body(fight, 'O'), 'corruption'), stacksOf(body(fight, 'N'), 'corruption')]).toEqual([3, 0]);
  });

  test('a trigger with a need fires only while its bearer holds that status', () => {
    const doom = worn('Doom', { on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' }, need: { kind: 'holds', key: statusKey('aura') }, ops: [addPain()] });
    const without = play(...duel(row('A', 'party', [on('doom', doom)]), row('M', 'foe')), use('A', 'M'));
    expect(stacksOf(body(without, 'A'), 'pain')).toBe(0);
    const within = play(...duel(row('A', 'party', [on('doom', doom), on('aura', worn('Aura'))]), row('M', 'foe')), use('A', 'M'));
    expect(stacksOf(body(within, 'A'), 'pain')).toBe(1);
  });

  test('a gate inside a zone refuses a use outside one of that name', () => {
    const supernova = ability('supernova', '5', { gates: [{ kind: 'inside', zone: 'Wrath' }] });
    const outside = play(...duel(row('A', 'party', [], { abilities: [supernova] }), row('M', 'foe')));
    expect(reduce(outside, use('A', 'M', supernova), ctx).effects).toEqual([{ type: 'refused', reason: 'gated' }]);
    const wrath: Command = { type: 'zoneAdd', zone: { id: 'z1' as never, name: 'Wrath', tiles: [place(0, 2)], spares: null, tier: 0, duration: null, ops: [] } };
    const inside = play(...duel(row('A', 'party', [], { abilities: [supernova] }), row('M', 'foe')), wrath, use('A', 'M', supernova));
    expect(rowHp(body(inside, 'M'))).toBeLessThan(rowHp(body(outside, 'M')));
  });
});

describe('a land op puts a status and hastens by a use\'s rules (rule 18, kits design 8.6.2)', () => {
  const ROOTED: StatusDef = { label: 'Rooted', desc: '', ops: [{ op: 'root' }] };
  const STUN: StatusDef = { label: 'Stunned', desc: '', ops: [{ op: 'hold' }] };
  const put = (key: string, def: StatusDef): LandOp => ({ op: 'applyStatus', key: statusKey(key), def, duration: tick(6 * RULES.fight.round) });
  const BOSS: Origin = { kind: 'monster', name: 'Monster', rank: 'E', archetype: 'brute', monsterKind: 'boss', tweak: { hp: 1, dealt: 1, stats: {}, traits: [] } };
  const boss = (): NewRow => row('M', 'foe', [], { kind: 'monster', origin: BOSS, hp: modified(BOSS, [], RULES).sheet.hpMax });
  const lasts = (b: Body, key: string): number => { const s = b.statuses.find(x => x.key === key)!; return s.until! - s.since; };

  test('a root from a "when you hit" trigger lasts on a boss as the same root from a use does: its whole length less its tenacity\'s share, as on any body', () => {
    const snare = worn('Snare', { on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [put('rooted', ROOTED)] });
    const byTrigger = play(...duel(row('A', 'party', [on('snare', snare)]), boss()), use('A', 'M'));
    const bind = ability('bind', '1', { ops: [put('rooted', ROOTED) as Ability['ops'][number]] });
    const byUse = play(...duel(row('A', 'party', [], { abilities: [bind] }), boss()), use('A', 'M', bind));
    expect(lasts(body(byTrigger, 'M'), 'rooted')).toBe(lasts(body(byUse, 'M'), 'rooted'));
    expect(lasts(body(byTrigger, 'M'), 'rooted')).toBe(Math.round(6 * RULES.fight.round * 100 / (100 + modified(BOSS, [], RULES).sheet.tenacity)));
  });

  test('a stun from a trigger stuns as a use\'s does: the bearer\'s turn waits until it ends', () => {
    const shock = worn('Shock', { on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [put('stun', STUN)] });
    const fight = play(...duel(row('A', 'party', [on('shock', shock)]), row('M', 'foe')), use('A', 'M'));
    const m = body(fight, 'M'), s = m.statuses.find(x => x.key === 'stun')!;
    expect(m.at).toBeGreaterThanOrEqual(s.until!);
  });

  test('a hasten from a trigger moves the other\'s turn as a use\'s hasten does', () => {
    const rally = worn('Rally', { on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'hasten', share: 0.5 }] });
    const plain = play(...duel(row('A', 'party'), row('M', 'foe')), use('A', 'M'));
    const byTrigger = play(...duel(row('A', 'party', [on('rally', rally)]), row('M', 'foe')), use('A', 'M'));
    const quick = ability('quick', '10', { ops: [{ op: 'hasten', share: 0.5 }] });
    const byUse = play(...duel(row('A', 'party', [], { abilities: [quick] }), row('M', 'foe')), use('A', 'M', quick));
    expect(body(byTrigger, 'M').at).toBeLessThan(body(plain, 'M').at);
    expect(body(byTrigger, 'M').at).toBe(body(byUse, 'M').at);
  });

  test('the parser keeps a land op only of a kind a land lands: a push, an extra action, a guard or a negate is refused', () => {
    const def = (op: unknown) => parseStatusDef({ label: 'X', desc: '', ops: [], triggers: [{ on: 'struck', tag: null, to: 'other', limit: { kind: 'each' }, ops: [op] }] }, RULES);
    expect(def({ op: 'hasten', share: 0.5 })?.triggers?.[0]?.ops).toEqual([{ op: 'hasten', share: 0.5 }]);
    for (const op of [{ op: 'shove', dir: 'away', from: 'user', tiles: 2 }, { op: 'extra' }, { op: 'guard', share: 0.5 }, { op: 'negate' }]) expect(def(op)?.triggers ?? []).toEqual([]);
  });
});

describe('an echo (keystones design A.7)', () => {
  // Hex: a slow whose own trigger echoes it when its bearer gains it. A at (5,5) hexes M at (6,5); of M's side N is
  // 2 tiles from M and O 3, both within the echo's 3; B, A's ally, stands 1 tile from M. O is 1 tile from N, so an
  // echo that echoed again would put Hex on O.
  const echo = (radius: number): Trigger => ({ on: 'statusGained', key: statusKey('hex'), to: 'self', limit: { kind: 'each' }, ops: [{ op: 'echo', radius }] });
  const HEX: StatusDef = { label: 'Hex', desc: '', ops: [{ op: 'speed', pct: -20 }], triggers: [echo(3)] };
  const hex = ability('hex', '1', { ops: [{ op: 'applyStatus', key: statusKey('hex'), def: HEX, duration: tick(4 * RULES.fight.round) }] });
  const at = (x: number) => ({ place: place(x, 5) });
  const table = (): Command[] => duel(row('A', 'party', [], { abilities: [hex], ...at(5) }), row('M', 'foe', [], at(6)), row('B', 'party', [], { place: place(6, 6) }),
    row('N', 'foe', [], at(8)), row('O', 'foe', [], at(9)));
  const hexOf = (fight: Fight, name: string): Status | undefined => body(fight, name).statuses.find(x => x.key === 'hex');

  test('an echoed status lands on the nearest other foe and does not echo again', () => {
    const fight = play(...table(), use('A', 'M', hex));
    const m = hexOf(fight, 'M')!, n = hexOf(fight, 'N')!;
    expect(['M', 'N', 'O', 'B'].map(k => hexOf(fight, k) !== undefined)).toEqual([true, true, false, false]);
    expect([n.source, n.until! - n.since]).toEqual([m.source, m.until! - m.since]);
  });

  test('an echo passes over a foe that holds the status already, and reaches no further than its radius', () => {
    const held = { key: statusKey('hex'), def: { ...HEX, triggers: [] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) } as Status;
    const past = play(...duel(row('A', 'party', [], { abilities: [hex], ...at(5) }), row('M', 'foe', [], at(6)), row('N', 'foe', [held], at(8)), row('O', 'foe', [], at(9))), use('A', 'M', hex));
    expect(['N', 'O'].map(k => hexOf(past, k)?.source.id ?? null)).toEqual([null, 'A']);
    const short: StatusDef = { ...HEX, triggers: [echo(1)] };
    const jab = ability('jab', '1', { ops: [{ op: 'applyStatus', key: statusKey('hex'), def: short, duration: tick(4 * RULES.fight.round) }] });
    const far = play(...duel(row('A', 'party', [], { abilities: [jab], ...at(5) }), row('M', 'foe', [], at(6)), row('N', 'foe', [], at(8))), use('A', 'M', jab));
    expect(hexOf(far, 'N')).toBeUndefined();
  });

  test('an echo outside a trigger a status gained sets off does nothing', () => {
    const loud: StatusDef = { label: 'Loud', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'echo', radius: 3 }] }] };
    const slowed = { key: statusKey('slowed'), def: { label: 'Slowed', desc: '', ops: [{ op: 'speed', pct: -20 }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) } as Status;
    const fight = play(...duel(row('A', 'party', [on('loud', loud)], at(5)), row('M', 'foe', [slowed], at(6)), row('N', 'foe', [], at(8))), use('A', 'M'));
    expect(body(fight, 'N').statuses).toEqual([]);
  });
});
