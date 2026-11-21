import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import type { StatKey, Stats } from '../src/core/stats.ts';
import { kitGear, NO_TWEAK, share } from '../src/core/hunter/derive.ts';
import type { Archetype, Kit, MonsterKind, Sheet } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { openGrid, place, tiles } from '../src/core/combat/space.ts';
import type { Place, Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability, AbilityKind, Outcome } from '../src/core/combat/ability-types.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Body, Op, Origin, StackDef, Status, StatusDef, UseOp } from '../src/core/combat/effect-ops.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { afterDefence, castDice, needs, resolve } from '../src/core/combat/resolve.ts';
import type { Aim, Resolved, Rolls } from '../src/core/combat/resolve.ts';
import { rng } from './models/fight-play.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { heldDieId, LEVELS } from '../src/core/combat/standing.ts';
import type { HideLevel, Level } from '../src/core/combat/standing.ts';
import { landOps } from '../src/core/combat/land.ts';
import { atHp, lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';

const GRID = openGrid(20, 14);
const NOW = tick(5000);
const formula = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };

// The paper's builds at C (table 2.1): main 63, second 33.
const C_BUILDS: Record<string, [StatKey, StatKey, Kit]> = {
  bruiser: ['str', 'vit', 'medium'], speed: ['agi', 'str', 'light'], cannon: ['pow', 'ctl', 'light'], tank: ['vit', 'str', 'heavy'], support: ['pre', 'dis', 'light'],
};
const hunterOrigin = (build: string): Origin => {
  const [main, second, kit] = C_BUILDS[build]!;
  const stats: Stats = { ...baseStats(RULES.fight), [main]: 63, [second]: 33 };
  return { kind: 'hunter', build: { stats, level: 20, gear: kitGear(kit, RULES), perks: {} } };
};
const monsterOrigin = (archetype: Archetype, monsterKind: MonsterKind = 'normal'): Origin => ({ kind: 'monster', name: 'Monster', rank: 'C', archetype, monsterKind, tweak: NO_TWEAK });

function body(id: string, origin: Origin, at: Place, side: Side, o: RowPatch<Body> = {}, sheet: Partial<Sheet> = {}): Body {
  const m = modified(origin, [], RULES), s = { ...m.sheet, ...sheet }, { kind, hp, ...rest } = o;
  return {
    id: combatantId(id), side, ...lifeAt(kind ?? (origin.kind === 'hunter' ? 'hunter' : 'monster'), hp ?? s.hpMax), origin, tier: 2, stats: m.stats, sheet: s, place: at,
    mana: s.manaMax, fatigue: 0, shield: null, stagger: null, channel: null, threat: origin.kind === 'monster' ? {} : null,
    statuses: [], readyAt: {}, abilities: [], intent: null, holder: null, xp: 0, name: 'Body', at: NOW, speed: s.speed, tie: 0, ...rest,
  } as Body;
}
const ability = (kind: AbilityKind, o: Partial<Ability> = {}, text?: string): Ability => {
  const a = abilityOf(kind, { id: abilityId(kind), name: kind }, RULES);
  return { ...a, ...(text ? { effect: { type: a.effect!.type, by: 'hand', formula: formula(text) } as Ability['effect'] } : {}), ...o };
};
const rolls = (dice: Record<string, number[]>, react: Record<string, number> = {}, refund?: number): Rolls =>
  ({ dice: dice as Rolls['dice'], react: react as Rolls['react'], ...(refund === undefined ? {} : { refund }) });
function ok(r: Resolved): Extract<Resolved, { ok: true }> {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
}
const run = (a: Ability, user: Body, bodies: Body[], aim: Aim, rl: Rolls) => ok(resolve(a, user, bodies, aim, GRID, rl, NOW, RULES));
const find = (bodies: readonly Body[], id: string): Body => bodies.find(b => b.id === id)!;
const statusOf = (key: string, ...ops: Op[]): UseOp => ({ op: 'applyStatus', key: statusKey(key), def: { label: key, desc: '', ops }, duration: tick(2000) });
const FACES = Array.from({ length: 20 }, (_, i) => i + 1);

describe('the worked examples of design 3.5', () => {
  test('3.A: a C bruiser\'s swing deals 29 of an adjacent C skirmisher\'s 48 HP, and no face of its d20 gets it out', () => {
    const bruiser = body('u', hunterOrigin('bruiser'), place(5, 5), 'party'), skirm = body('t', monsterOrigin('skirmisher'), place(6, 5), 'foe');
    const r = run(ability('strike'), bruiser, [bruiser, skirm], skirm.id, rolls({ t: [6] }, { t: 9 }));
    const [o] = r.outcomes;
    expect([o!.avoid, o!.crit, o!.dealt, rowHp(skirm), rowHp(find(r.bodies, 't'))]).toEqual(['caught', false, 29, 48, 19]);
    expect(o!.raw).toBeCloseTo(32.16, 2);
    expect([find(r.bodies, 'u').at, find(r.bodies, 'u').fatigue]).toEqual([NOW + 1000, 8]);
    const best = run(ability('strike'), bruiser, [bruiser, skirm], skirm.id, rolls({ t: [6] }, { t: 20 }));
    expect(best.outcomes[0]!.avoid).toBe('caught');
  });

  test('3.B: an arrow at 8 tiles is dodged on 17 or more by a speed-100 target and on 6 or more by a speed-141 one, whose Agility gives it an edge of 6, and hits for 18', () => {
    const shot = ability('shot', {}, '1d8 + phys');
    const user = body('u', hunterOrigin('speed'), place(2, 6), 'party');
    const lowest = (target: Body): number => FACES.find(f => run(shot, user, [user, target], target.id, rolls({ t: [4.5] }, { t: f })).outcomes[0]!.avoid === 'out')!;
    const caster = body('t', monsterOrigin('caster'), place(10, 6), 'foe'), fast = body('t', hunterOrigin('speed'), place(10, 6), 'foe');
    expect([caster.speed, fast.speed, lowest(caster), lowest(fast)]).toEqual([100, 141, 17, 6]);
    expect(run(shot, user, [user, caster], caster.id, rolls({ t: [4.5] }, { t: 10 })).outcomes[0]!.dealt).toBe(18);
  });

  test('3.C: a slow blast never catches the C speed build, rings it 15% and misses it 85%; the slow tank is caught 65%', () => {
    const meteor = ability('blast', {}, '3d8 + 1.5 * mag');
    const cannon = body('u', hunterOrigin('cannon'), place(10, 0), 'foe');
    const spread = (target: Body): Record<string, number> => {
      const count: Record<string, number> = { caught: 0, ring: 0, out: 0 };
      for (const f of FACES) count[run(meteor, cannon, [cannon, target], place(10, 7), rolls({ t: [13.5] }, { t: f })).outcomes[0]!.avoid]! += 5;
      return count;
    };
    const speed = body('t', hunterOrigin('speed'), place(11, 7), 'party'), tank = body('t', hunterOrigin('tank'), place(11, 7), 'party');
    expect([spread(speed), spread(tank)]).toEqual([{ caught: 0, ring: 15, out: 85 }, { caught: 65, ring: 25, out: 10 }]);
    const dealt = (target: Body, f: number): number => run(meteor, cannon, [cannon, target], place(10, 7), rolls({ t: [13.5] }, { t: f })).outcomes[0]!.dealt;
    expect([dealt(speed, 2), dealt(tank, 5), dealt(tank, 15)]).toEqual([23, 33, 16]);
  });
});

describe('each rule of design 3.1', () => {
  const user = body('u', hunterOrigin('bruiser'), place(5, 5), 'party');
  const foe = body('t', monsterOrigin('brute'), place(6, 5), 'foe');
  const strike = ability('strike', {}, '1d8 + phys');
  const hitFoe = (a: Ability = strike, u: Body = user, t: Body = foe, d20 = 10, die = 4) => run(a, u, [u, t], t.id, rolls({ t: [die] }, { t: d20 }));

  test('rule 2: a taunted user must aim at its taunter while the taunter is up and in range', () => {
    const taunter = body('s', monsterOrigin('brute'), place(4, 5), 'foe');
    const held = { ...user, statuses: [{ key: statusKey('taunted'), def: { label: 'Taunted', desc: '', ops: [{ op: 'taunt' }] }, source: { id: taunter.id, tier: 2 }, until: tick(9000), since: NOW, settledAt: NOW } as Status] };
    const all = [held, foe, taunter];
    expect(resolve(strike, held, all, foe.id, GRID, rolls({ t: [4] }, { t: 10 }), NOW, RULES)).toEqual({ ok: false, reason: 'taunted' });
    expect(resolve(strike, held, all, taunter.id, GRID, rolls({ s: [4] }, { s: 10 }), NOW, RULES).ok).toBe(true);
    const down = all.map(b => b.id === 's' ? atHp(b, 0) : b);
    expect(resolve(strike, held, down, foe.id, GRID, rolls({ t: [4] }, { t: 10 }), NOW, RULES).ok).toBe(true);
  });

  test('rule 3: an ability on cooldown is refused, and a use sets when it is ready again', () => {
    const slam = { ...strike, cost: { ...strike.cost, cooldown: tick(2000) } };
    expect(resolve(slam, { ...user, readyAt: { [slam.id]: tick(NOW + 1) } }, [user, foe], foe.id, GRID, rolls({ t: [4] }, { t: 10 }), NOW, RULES)).toEqual({ ok: false, reason: 'cooldown' });
    expect(find(hitFoe(slam).bodies, 'u').readyAt[slam.id]).toBe(tick(NOW + 2000));
  });

  test('rule 4: the cost cut takes a share off fatigue and mana, rounded up, and mana must be on hand', () => {
    const bolt = { ...strike, cost: { ...strike.cost, fatigue: 8, mana: 10 } };
    const cut = body('u', hunterOrigin('bruiser'), place(5, 5), 'party', { mana: 8 }, { costCut: share(0.25) });
    const paid = find(hitFoe(bolt, cut).bodies, 'u');
    expect([paid.mana, paid.fatigue]).toEqual([0, 6]);
    expect(resolve(bolt, { ...cut, mana: 7 }, [cut, foe], foe.id, GRID, rolls({ t: [4] }, { t: 10 }), NOW, RULES)).toEqual({ ok: false, reason: 'mana' });
  });

  test('rule 5: a target out of range is refused', () => {
    const far = { ...foe, place: place(7, 5) };
    expect(resolve(strike, user, [user, far], far.id, GRID, rolls({ t: [4] }, { t: 10 }), NOW, RULES)).toEqual({ ok: false, reason: 'range' });
  });

  test('rule 8a: a rooted target moves 0 tiles, so it cannot dodge an arrow it would leave on a 20', () => {
    const shot = ability('shot', {}, '1d8 + phys');
    const archer = body('u', hunterOrigin('speed'), place(2, 6), 'party'), target = body('t', hunterOrigin('speed'), place(10, 6), 'foe');
    const rooted = { ...target, statuses: [] as Status[], sheet: modified(target.origin, [{ key: statusKey('root'), def: { label: 'Rooted', desc: '', ops: [{ op: 'root' }] }, source: { id: null, tier: 0 }, until: null, since: NOW, settledAt: NOW }], RULES).sheet };
    const avoid = (t: Body): string => run(shot, archer, [archer, t], t.id, rolls({ t: [4] }, { t: 20 })).outcomes[0]!.avoid;
    expect([avoid(target), avoid(rooted)]).toEqual(['out', 'caught']);
  });

  test('rule 8a: a dodging target moves to the nearest tile out, the lowest y then x on a tie', () => {
    const shot = ability('shot', {}, '1d8 + phys');
    const archer = body('u', hunterOrigin('speed'), place(2, 6), 'party'), target = body('t', hunterOrigin('speed'), place(10, 6), 'foe');
    const r = run(shot, archer, [archer, target], target.id, rolls({ t: [4] }, { t: 20 }));
    expect([r.outcomes[0]!.to, find(r.bodies, 't').place]).toEqual([place(9, 5), place(9, 5)]);
  });

  test('rule 11: a target left in the ring takes the ring\'s share', () => {
    const blast = ability('blast', {}, '20');
    const caster = body('u', hunterOrigin('cannon'), place(10, 0), 'foe');
    const tank = body('t', hunterOrigin('tank'), place(13, 7), 'party', {}, { resist: 0, move: 0 });
    const inner = { ...tank, place: place(11, 7) };
    const dealt = (t: Body): number => run(blast, caster, [caster, t], place(10, 7), rolls({ t: [] }, { t: 10 })).outcomes[0]!.dealt;
    expect([dealt(inner), dealt(tank)]).toEqual([20, 10]);
  });

  test('rule 11b: a target in cover takes a quarter less from a shot and from a blast, and nothing less from a strike', () => {
    // a 6 by 1 strip, the target on a cover tile at its end; armor and resist 0 and move 0, so the number is the formula's
    const grid = { w: 8, h: 1, tiles: [...'.......o'].map(c => (c === 'o' ? 'cover' : 'floor') as 'cover' | 'floor') };
    const user = body('u', hunterOrigin('bruiser'), place(0, 0), 'party');
    const target = body('t', monsterOrigin('brute'), place(7, 0), 'foe', {}, { armor: 0, resist: 0, move: 0 });
    const beside = { ...user, place: place(6, 0) };
    const dealt = (a: Ability, u: Body, aim: Aim) => ok(resolve(a, u, [u, target], aim, grid, rolls({ t: [] }, { t: 10 }), NOW, RULES)).outcomes[0]!.dealt;
    const cut = 100 * (1 - RULES.fight.coverShare);
    expect(dealt(ability('shot', { range: tiles(10) }, '100'), user, target.id)).toBe(cut);
    expect(dealt(ability('blast', { range: tiles(10) }, '100'), user, place(7, 0))).toBe(cut);
    expect(dealt(ability('strike', {}, '100'), beside, target.id)).toBe(100);
  });

  test('rule 8b: a resisted direct use deals half and applies no status', () => {
    const hex = ability('curse', { ops: [statusOf('weakened', { op: 'stat', key: 'str', amount: -5 })] }, '20');
    const target = body('t', monsterOrigin('caster'), place(8, 5), 'foe', {}, { resist: 0 });
    const at = (d20: number) => run(hex, user, [user, target], target.id, rolls({ t: [] }, { t: d20 })).outcomes[0]!;
    expect([at(20).avoid, at(20).dealt, at(20).statuses, at(3).avoid, at(3).dealt, at(3).statuses]).toEqual(['resisted', 10, [], 'caught', 20, ['weakened']]);
  });

  test('rule 9: a crit comes from the target\'s low faces, as many as the user\'s crit faces', () => {
    const t = body('t', monsterOrigin('brute'), place(6, 5), 'foe', {}, { armor: 0 });
    const keen = body('u', hunterOrigin('bruiser'), place(5, 5), 'party', {}, { critFaces: 3, critSize: 2, phys: 0 });
    const flat = ability('strike', {}, '10');
    expect(FACES.filter(f => hitFoe(flat, keen, t, f).outcomes[0]!.crit)).toEqual([1, 2, 3]);
    expect([hitFoe(flat, keen, t, 3).outcomes[0]!.dealt, hitFoe(flat, keen, t, 4).outcomes[0]!.dealt]).toEqual([20, 10]);
  });

  test('rule 12: penetration takes its share of the armor first, then the flat amount', () => {
    const t = body('t', monsterOrigin('brute'), place(6, 5), 'foe', {}, { armor: 100 });
    const piercer = body('u', hunterOrigin('bruiser'), place(5, 5), 'party', {}, { pen: share(0.5), penFlat: 20 });
    expect(hitFoe(ability('strike', {}, '130'), piercer, t).outcomes[0]!.dealt).toBe(99);
  });

  test('rule 12: the flat part of armor (3% of it) comes off before the percentage, so a weak hit loses more than a strong one', () => {
    const t = body('t', monsterOrigin('brute'), place(6, 5), 'foe', {}, { armor: 100 });
    const plain = body('u', hunterOrigin('bruiser'), place(5, 5), 'party', {}, { pen: share(0), penFlat: 0 });
    const dealt = (raw: number): number => hitFoe(ability('strike', {}, String(raw)), plain, t).outcomes[0]!.dealt;
    expect([dealt(9), dealt(103)]).toEqual([3, 50]);
  });

  test('rule 12: a hit always deals at least 1', () => {
    expect(hitFoe(ability('strike', {}, '0')).outcomes[0]!.dealt).toBe(1);
  });

  test('rule 13: the shield absorbs first, and a second shield does not add: the larger holds', () => {
    const shielded = { ...foe, shield: { amount: 10, until: tick(NOW + 1000) } };
    const r = hitFoe(ability('strike', {}, '20'), user, { ...shielded, sheet: { ...foe.sheet, armor: 0 } });
    expect([r.outcomes[0]!.absorbed, rowHp(find(r.bodies, 't')), find(r.bodies, 't').shield]).toEqual([10, rowHp(foe) - 10, null]);
    const support = body('u', hunterOrigin('support'), place(5, 5), 'party');
    const ally = body('a', hunterOrigin('tank'), place(6, 5), 'party', { shield: { amount: 50, until: tick(NOW + 500) } });
    const after = run(ability('support'), support, [support, ally], ally.id, rolls({ a: [] }));
    expect([after.outcomes[0]!.dealt, find(after.bodies, 'a').shield]).toEqual([39, { amount: 50, until: NOW + 2000 }]);
  });

  test('rule 14: HP stops at 0 and the target is down', () => {
    const r = hitFoe(ability('strike', {}, '500'));
    expect([rowHp(find(r.bodies, 't')), r.outcomes[0]!.down]).toEqual([0, true]);
  });

  test('rule 15: only a monster keeps threat, the damage times the user\'s threat multiplier', () => {
    const loud = body('u', hunterOrigin('bruiser'), place(5, 5), 'party', {}, { threat: 1.5 });
    const t = { ...foe, sheet: { ...foe.sheet, armor: 0 } };
    expect(find(hitFoe(ability('strike', {}, '20'), loud, t).bodies, 't').threat).toEqual({ u: 30 });
    const hunter = body('t', hunterOrigin('tank'), place(6, 5), 'foe', {}, { armor: 0 });
    const r = hitFoe(ability('strike', {}, '20'), loud, hunter);
    expect([find(r.bodies, 't').threat, r.outcomes[0]!.threat]).toEqual([null, 0]);
  });

  test('rule 16: a weak hit fills the stagger bar 1.5 times its damage, a normal one its damage', () => {
    const boss = { ...foe, sheet: { ...foe.sheet, armor: 0 }, stagger: { fill: 0, max: 88, hit: 22 } } as Body;
    expect([hitFoe(ability('strike', {}, '6'), user, boss).outcomes[0]!.stagger, hitFoe(ability('strike', {}, '20'), user, boss).outcomes[0]!.stagger]).toEqual([9, 20]);
  });

  test('rule 16: a full bar moves the target\'s next turn 1.5 rounds on, empties and grows 75%', () => {
    const boss = { ...foe, sheet: { ...foe.sheet, armor: 0 }, stagger: { fill: 80, max: 88, hit: 22 } } as Body;
    const r = hitFoe(ability('strike', {}, '20'), user, boss);
    expect([r.outcomes[0]!.staggered, find(r.bodies, 't').at, find(r.bodies, 't').stagger]).toEqual([true, NOW + 1500, { fill: 0, max: 154, hit: 22, until: NOW + 1500 }]);
  });

  test('rule 17: a single hit of at least hold times max HP breaks a channel', () => {
    const channeling = { ...foe, sheet: { ...foe.sheet, armor: 0, hpMax: 80, hold: share(0.15) }, channel: { ability: abilityId('m'), aim: place(0, 0), charge: 3, spent: 0, state: 'holding' as const } };
    const at = (n: number) => hitFoe(ability('strike', {}, String(n)), user, channeling);
    expect([at(11).outcomes[0]!.channelBroken, at(12).outcomes[0]!.channelBroken, find(at(12).bodies, 't').channel?.state]).toEqual([false, true, 'broken']);
  });

  test('rule 18: a boss takes a control status at half its duration, a normal monster in full', () => {
    const taunt = ability('strike', { ops: [statusOf('taunted', { op: 'taunt' })] }, '1');
    const until = (t: Body): number | null => find(hitFoe(taunt, user, t).bodies, 't').statuses[0]!.until;
    const boss = body('t', monsterOrigin('brute', 'boss'), place(6, 5), 'foe');
    expect([until(foe), until(boss)]).toEqual([NOW + 2000, NOW + 1000]);
  });

  test('rule 18: a taunt adds twice the gap to the leader to the taunter\'s threat, after the hit\'s own threat', () => {
    const taunt = ability('strike', { ops: [statusOf('taunted', { op: 'taunt' })] }, '1');
    const t = { ...foe, threat: { x: 100, u: 10 } as Record<string, number> } as Body;
    expect(find(hitFoe(taunt, user, t).bodies, 't').threat).toEqual({ x: 100, u: 11 + 2 * (100 - 11) });
  });

  test('rule 19: the user waits its cost\'s interval, then a delay on it, and a refund gives part back', () => {
    const slow = { ...user, statuses: [{ key: statusKey('heavy'), def: { label: 'Heavy', desc: '', ops: [{ op: 'delay', ticks: tick(200) }] }, source: { id: null, tier: 0 }, until: null, since: NOW, settledAt: NOW } as Status] };
    expect(find(hitFoe(strike, slow).bodies, 'u').at).toBe(tick(NOW + 1200));
    const quick = { ...user, statuses: [{ key: statusKey('quick'), def: { label: 'Quick', desc: '', ops: [{ op: 'refund', pct: 50, chance: 20 }] }, source: { id: null, tier: 0 }, until: null, since: NOW, settledAt: NOW } as Status] };
    const turn = (d20: number) => find(run(strike, quick, [quick, foe], foe.id, rolls({ t: [4] }, { t: 10 }, d20)).bodies, 'u').at;
    expect([turn(4), turn(5)]).toEqual([NOW + 500, NOW + 1000]);
    expect(resolve(strike, quick, [quick, foe], foe.id, GRID, rolls({ t: [4] }, { t: 10 }), NOW, RULES)).toEqual({ ok: false, reason: 'needsRoll' });
  });
});

describe('what a use needs and what a refusal leaves', () => {
  test('needs lists each body in the shape with the formula\'s dice and a reaction d20', () => {
    const user = body('u', hunterOrigin('cannon'), place(10, 0), 'foe');
    const a = body('a', hunterOrigin('speed'), place(10, 7), 'party'), b = body('b', hunterOrigin('tank'), place(13, 7), 'party'), c = body('c', hunterOrigin('tank'), place(18, 7), 'party');
    const n = needs(ability('blast'), user, [user, a, b, c], place(10, 7), GRID, NOW, RULES);
    expect([Object.keys(n.dice), n.dice['a' as never], n.react, n.refund]).toEqual([['a', 'b'], [{ count: 2, sides: 8 }], ['a', 'b'], false]);
  });

  test('a player\'s blast rolls each foe apart, as the GM\'s does: the player\'s dice land on the first it takes, the GM\'s phone rolls the other', () => {
    const user = body('u', hunterOrigin('cannon'), place(10, 0), 'foe');
    const a = body('a', hunterOrigin('speed'), place(10, 7), 'party'), b = body('b', hunterOrigin('tank'), place(13, 7), 'party');
    const n = needs(ability('blast'), user, [user, a, b], place(10, 7), GRID, NOW, RULES);
    expect(castDice(n, place(10, 7), [8], { ['a' as never]: [3], ['b' as never]: [5] })).toEqual({ a: [8], b: [5] });
    expect(castDice(n, b.id, [8], { ['a' as never]: [3], ['b' as never]: [5] })).toEqual({ a: [3], b: [8] });
  });

  test('a missing roll is a refusal, not a throw', () => {
    const user = body('u', hunterOrigin('bruiser'), place(5, 5), 'party'), foe = body('t', monsterOrigin('brute'), place(6, 5), 'foe');
    expect(resolve(ability('strike'), user, [user, foe], foe.id, GRID, rolls({ t: [4] }), NOW, RULES)).toEqual({ ok: false, reason: 'needsRoll' });
    expect(resolve(ability('strike'), user, [user, foe], foe.id, GRID, rolls({}, { t: 4 }), NOW, RULES)).toEqual({ ok: false, reason: 'needsRoll' });
  });

  test('a refused use changes nothing', () => {
    const user = body('u', hunterOrigin('bruiser'), place(5, 5), 'party', { mana: 0 }), foe = body('t', monsterOrigin('brute'), place(6, 5), 'foe');
    const bodies = [user, foe], copy = structuredClone(bodies);
    const r = resolve(ability('strike', { cost: { fatigue: 8, mana: 5, time: ability('strike').cost.time, cooldown: tick(0) } }), user, bodies, foe.id, GRID, rolls({ t: [4] }, { t: 10 }), NOW, RULES);
    expect([r, bodies]).toEqual([{ ok: false, reason: 'mana' }, copy]);
  });
});

describe('properties over seeded uses', () => {
  const kinds: AbilityKind[] = ['strike', 'shot', 'blast', 'curse'];
  function scene(seed: number) {
    const r = rng(seed);
    const user = body('u', hunterOrigin(r.pick(['bruiser', 'speed', 'cannon'])), place(r.int(0, 19), r.int(0, 3)), 'party');
    const foes = Array.from({ length: r.int(1, 4) }, (_, i) => body(`f${i}`, monsterOrigin(r.pick(['brute', 'skirmisher', 'caster'] as const)), place(r.int(0, 19), r.int(5, 13)), 'foe',
      { hp: r.int(1, 48) }, { armor: r.int(0, 80), resist: r.int(0, 40) })).filter((f, i, all) => all.findIndex(g => g.place.x === f.place.x && g.place.y === f.place.y) === i);
    const kind = r.pick(kinds), target = r.pick(foes);
    const a = ability(kind, { range: tiles(30) });
    const aim: Aim = kind === 'blast' ? target.place : target.id;
    const bodies = [user, ...foes], n = needs(a, user, bodies, aim, GRID, NOW, RULES);
    const dice = Object.fromEntries(Object.entries(n.dice).map(([id, ds]) => [id, ds.map(d => r.int(d.count, d.count * d.sides))]));
    const react = Object.fromEntries(n.react.map(id => [id, r.int(1, 20)]));
    return { a, user, bodies, aim, rl: rolls(dice, react), r };
  }

  test('HP never leaves 0 to max, and resolve never changes its inputs', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = scene(seed), copy = structuredClone(s.bodies);
      const res = resolve(s.a, s.user, s.bodies, s.aim, GRID, s.rl, NOW, RULES);
      expect(s.bodies).toEqual(copy);
      if (res.ok) for (const b of res.bodies) { expect(rowHp(b)).toBeGreaterThanOrEqual(0); expect(rowHp(b)).toBeLessThanOrEqual(b.sheet.hpMax); }
    }
  });

  test('a higher armor never raises the damage dealt', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = scene(seed), target = s.bodies.find(b => b.id === s.aim || (typeof s.aim !== 'string' && b.place === s.aim))!;
      const dealt = (armor: number): number => {
        const bodies = s.bodies.map(b => b.id === target.id ? { ...b, sheet: { ...b.sheet, armor, resist: armor } } : b);
        const res = resolve(s.a, s.user, bodies, s.aim, GRID, s.rl, NOW, RULES);
        return res.ok ? res.outcomes.find(o => o.target === target.id)?.dealt ?? 0 : 0;
      };
      expect(dealt(target.sheet.armor + 25)).toBeLessThanOrEqual(dealt(target.sheet.armor));
    }
  });

  test('a higher reaction roll never moves a target from out to caught', () => {
    const rank = { out: 0, ring: 1, resisted: 1, caught: 2 } as const;
    for (let seed = 1; seed <= 300; seed++) {
      const s = scene(seed);
      for (const id of Object.keys(s.rl.react)) {
        const at = (d20: number) => {
          const res = resolve(s.a, s.user, s.bodies, s.aim, GRID, { ...s.rl, react: { ...s.rl.react, [id]: d20 } }, NOW, RULES);
          return res.ok ? rank[res.outcomes.find(o => o.target === id)!.avoid] : null;
        };
        for (let f = 1; f < 20; f++) { const lo = at(f), hi = at(f + 1); if (lo !== null && hi !== null) expect(hi).toBeLessThanOrEqual(lo); }
      }
    }
  });
});

describe('the kits\' rules of a use (kits design 1.4 and 1.5: rules 3b, 4, 6b, 10a, 18 and 18a)', () => {
  const pain: StackDef = { label: 'Pain', desc: '', ops: [], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
  const mode: StatusDef = { label: 'Crimson Pact', desc: '', ops: [] };
  const holding = (b: Body, def: StatusDef, key: string, stacks = 1): Body =>
    ({ ...b, statuses: [...b.statuses, statusOn(def, { key: statusKey(key), source: { id: b.id, tier: 2 }, until: null, since: tick(NOW - 2000), settledAt: NOW }, stacks)] });
  const user = body('u', hunterOrigin('bruiser'), place(5, 5), 'party');
  const foe = body('t', monsterOrigin('brute'), place(6, 5), 'foe');
  const sure = (text: string, o: Partial<Ability> = {}) => ability('strike', { delivery: { kind: 'sure' }, ...o }, text);
  const use = (a: Ability, u: Body, t: Body, others: Body[] = []) => resolve(a, u, [u, t, ...others], t.id, GRID, rolls({ [t.id]: [], ...Object.fromEntries(others.map(b => [b.id, []])) }), NOW, RULES);

  test('rule 3b: a use gated on a mode is refused without it and goes with it; a gate on the target reads the body aimed at', () => {
    const gatedOnSelf = sure('10', { gates: [{ kind: 'holds', key: statusKey('crimson-pact'), on: 'self', atLeast: 1 }] });
    expect(use(gatedOnSelf, user, foe)).toEqual({ ok: false, reason: 'gated' });
    expect(use(gatedOnSelf, holding(user, mode, 'crimson-pact'), foe).ok).toBe(true);
    const fiveReveal = sure('10', { gates: [{ kind: 'holds', key: statusKey('pain'), on: 'target', atLeast: 5 }] });
    expect([use(fiveReveal, user, holding(foe, pain, 'pain', 4)).ok, use(fiveReveal, user, holding(foe, pain, 'pain', 5)).ok]).toEqual([false, true]);
  });

  test('rule 4: an HP price is paid past the shield and refused at the HP it would take, so it is never the killing blow', () => {
    const pact = sure('0', { prices: [{ kind: 'hp', amount: { kind: 'share', share: 0.1 } }] });
    const shielded = { ...user, shield: { amount: 50, until: tick(NOW + 5000) } };
    const r = ok(use(pact, shielded, foe));
    expect([rowHp(find(r.bodies, 'u')), find(r.bodies, 'u').shield?.amount]).toEqual([rowHp(user) - Math.ceil(0.1 * user.sheet.hpMax), 50]);
    expect(use(pact, atHp(user, Math.ceil(0.1 * user.sheet.hpMax)), foe)).toEqual({ ok: false, reason: 'hp' });
  });

  test('rule 4 and 6b: a price in the user\'s stacks takes them before the formula reads, and `spent` says what it took', () => {
    const violence = sure('spent * 10 + stacks(pain)', { prices: [{ kind: 'stacks', key: statusKey('pain'), from: 'self', take: { kind: 'n', n: 3 } }] });
    const r = ok(use(violence, holding(user, pain, 'pain', 7), foe));
    expect(r.outcomes[0]!.raw).toBe(3 * 10 + 4);
    expect(find(r.bodies, 'u').statuses[0]!.stacks).toBe(4);
    expect(use(violence, holding(user, pain, 'pain', 2), foe)).toEqual({ ok: false, reason: 'stacks' });
    const all = sure('spent', { prices: [{ kind: 'stacks', key: statusKey('pain'), from: 'self', take: { kind: 'all' } }] });
    const gone = ok(use(all, holding(user, pain, 'pain', 6), foe));
    expect([gone.outcomes[0]!.raw, find(gone.bodies, 'u').statuses]).toEqual([6, []]);
  });

  test('rule 6b: every target of an area reads the same snapshot, its own lost share, the field and the bodies hit', () => {
    const blast = ability('blast', { delivery: { kind: 'sure' }, foesOnly: true }, '100 * target.missing + field(pain) + hits');
    const a = holding({ ...body('a', monsterOrigin('brute'), place(10, 5), 'foe') }, pain, 'pain', 2), b = { ...body('b', monsterOrigin('brute'), place(11, 5), 'foe') };
    const hurtB = atHp(b, Math.round(b.sheet.hpMax / 2));
    const r = ok(resolve(blast, user, [user, a, hurtB], place(10, 5), GRID, rolls({ a: [], b: [] }), NOW, RULES));
    const raw = (id: string) => r.outcomes.find(o => o.target === id)!.raw;
    expect(raw('a')).toBeCloseTo(0 + 2 + 2, 10);
    expect(raw('b')).toBeCloseTo(100 * (1 - rowHp(hurtB) / hurtB.sheet.hpMax) + 2 + 2, 10);
  });

  test('rule 10a: a price in each target\'s stacks takes what each holds, up to n, and each target\'s `spent` is its own', () => {
    const purify = ability('blast', { delivery: { kind: 'sure' }, foesOnly: true, prices: [{ kind: 'stacks', key: statusKey('pain'), from: 'target', take: { kind: 'n', n: 3 } }] }, 'spent');
    const a = holding(body('a', monsterOrigin('brute'), place(10, 5), 'foe'), pain, 'pain', 5), b = holding(body('b', monsterOrigin('brute'), place(11, 5), 'foe'), pain, 'pain', 1);
    const r = ok(resolve(purify, user, [user, a, b], place(10, 5), GRID, rolls({ a: [], b: [] }), NOW, RULES));
    expect(r.outcomes.map(o => [o.target, o.raw])).toEqual([['a', 3], ['b', 1]]);
    expect([find(r.bodies, 'a').statuses[0]!.stacks, find(r.bodies, 'b').statuses]).toEqual([2, []]);
  });

  test('rule 18: a stacking status adds the op\'s stacks to the target\'s, to its cap', () => {
    const add = sure('0', { ops: [{ op: 'applyStatus', key: statusKey('pain'), def: pain, duration: null, stacks: 3 }] });
    expect(find(ok(use(add, user, holding(foe, pain, 'pain', 8))).bodies, 't').statuses[0]!.stacks).toBe(10);
    expect(find(ok(use(add, user, foe)).bodies, 't').statuses[0]!.stacks).toBe(3);
  });

  test('rule 18a: a count that reaches its threshold sets it off once, from the status\'s source, at its average, and spends it', () => {
    const resonance = (then: 'spend' | 'keep'): StackDef => ({ label: 'Resonance', desc: '', ops: [], stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: {
      at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then, ops: [{ op: 'damage', type: 'physical', amount: formula('2d10'), when: 'use' }] } } });
    const bloodletting = (d: StackDef) => sure('0', { effect: null, ops: [{ op: 'applyStatus', key: statusKey('resonance'), def: d, duration: null, stacks: 1 }] });
    const burst = afterDefence(11, 'physical', user.sheet, foe.sheet, RULES);
    const spent = ok(use(bloodletting(resonance('spend')), user, holding(foe, resonance('spend'), 'resonance', 2)));
    expect([rowHp(find(spent.bodies, 't')), find(spent.bodies, 't').statuses, spent.bursts]).toEqual([rowHp(foe) - burst, [], [{ bearer: 't', key: 'resonance', label: 'Resonance', landed: [{ target: 't', dealt: burst }] }]]);
    const below = ok(use(bloodletting(resonance('spend')), user, holding(foe, resonance('spend'), 'resonance', 1)));
    expect([rowHp(find(below.bodies, 't')), find(below.bodies, 't').statuses[0]!.stacks]).toEqual([rowHp(foe), 2]);
    const kept = ok(use(bloodletting(resonance('keep')), user, holding(foe, resonance('keep'), 'resonance', 3)));
    expect([rowHp(find(kept.bodies, 't')), find(kept.bodies, 't').statuses[0]!.stacks]).toEqual([rowHp(foe), 4]);
  });

  test('rule 18a: a threshold reaching an area lands on every body of the side it names within its radius of the bearer', () => {
    const mark: StackDef = { label: 'Mark', desc: '', ops: [], stack: { cap: 2, leave: { kind: 'never' }, keep: 'fight', threshold: {
      at: { kind: 'count', n: 2 }, to: { kind: 'area', radius: tiles(2), on: 'allies' }, then: 'spend', ops: [{ op: 'damage', type: 'magical', amount: formula('10'), when: 'use' }] } } };
    const near = body('n', monsterOrigin('brute'), place(8, 5), 'foe'), far = body('f', monsterOrigin('brute'), place(12, 5), 'foe');
    const stroke = sure('0', { effect: null, ops: [{ op: 'applyStatus', key: statusKey('mark'), def: mark, duration: null, stacks: 1 }] });
    const r = ok(use(stroke, user, holding(foe, mark, 'mark', 1), [near, far]));
    expect(r.bursts[0]!.landed.map(l => l.target).sort()).toEqual(['n', 't']);
    expect([rowHp(find(r.bodies, 'f')), rowHp(find(r.bodies, 'u'))]).toEqual([rowHp(far), rowHp(user)]);
  });
});

describe('wave 2\'s sheet and share ops in a use (kits design 8.1, rule 11c)', () => {
  const marked = (key: string, ...ops: Op[]): Status => statusOn({ label: key, desc: '', ops }, { key: statusKey(key), source: { id: null, tier: 2 }, until: null, since: NOW, settledAt: NOW });
  const withOps = (b: Body, ...list: Status[]): Body => { const m = modified(b.origin, list, RULES); return { ...b, statuses: list, sheet: m.sheet, stats: m.stats }; };
  const strike = ability('strike', {}, '20');
  const swing = (user: Body, target: Body) => run(strike, user, [user, target], target.id, rolls({ t: [] }, { t: 10 })).outcomes[0]!;

  test('damage taken +25% on the target and dealt +20% on the user multiply: 20 raw is 30', () => {
    const u = body('u', hunterOrigin('bruiser'), place(5, 5), 'party'), t = body('t', hunterOrigin('tank'), place(6, 5), 'foe');
    const plain = swing(u, t).raw;
    expect(plain).toBe(20);
    expect(swing(withOps(u, marked('fury', { op: 'share', on: 'dealt', pct: 20 })), withOps(t, marked('brittle', { op: 'share', on: 'taken', pct: 25 }))).raw).toBeCloseTo(30, 9);
  });

  test('of one side only the strongest increase and the strongest decrease apply, and the product stays within the cap of 1.5', () => {
    const u = body('u', hunterOrigin('bruiser'), place(5, 5), 'party'), t = body('t', hunterOrigin('tank'), place(6, 5), 'foe');
    const two = withOps(t, marked('a', { op: 'share', on: 'taken', pct: 25 }), marked('b', { op: 'share', on: 'taken', pct: 40 }), marked('c', { op: 'share', on: 'taken', pct: -50 }));
    expect(swing(u, two).raw).toBeCloseTo(20 * 1.4 * 0.5, 9);
    const most = withOps(t, marked('a', { op: 'share', on: 'taken', pct: 100 }));
    expect(swing(withOps(u, marked('f', { op: 'share', on: 'dealt', pct: 100 })), most).raw).toBeCloseTo(20 * (1 + RULES.fight.kit.shareCap), 9);
  });

  test('a boss takes half the part above 1, an elite three quarters (their control factors)', () => {
    const u = body('u', hunterOrigin('bruiser'), place(5, 5), 'party'), up = marked('brittle', { op: 'share', on: 'taken', pct: 40 });
    const boss = withOps(body('t', monsterOrigin('brute', 'boss'), place(6, 5), 'foe'), up), elite = withOps(body('t', monsterOrigin('brute', 'elite'), place(6, 5), 'foe'), up);
    expect(swing(u, boss).raw).toBeCloseTo(20 * (1 + 0.4 * RULES.fight.kinds.boss.control), 9);
    expect(swing(u, elite).raw).toBeCloseTo(20 * (1 + 0.4 * RULES.fight.kinds.elite.control), 9);
  });

  test('a heal is multiplied by the healed share: Brutalize\'s -50% halves it', () => {
    const u = body('u', hunterOrigin('support'), place(5, 5), 'party'), t = withOps(body('t', hunterOrigin('tank'), place(6, 5), 'party', { hp: 1 }), marked('brutal', { op: 'share', on: 'healed', pct: -50 }));
    const heal = ability('support', { effect: { type: 'heal', by: 'hand', formula: formula('40') } });
    expect(run(heal, u, [u, t], t.id, rolls({ t: [] })).outcomes[0]!.dealt).toBe(20);
  });

  test('armor +20 from a sheet op meets the hit as worn armor does; a crit size op is held at 2', () => {
    const u = body('u', hunterOrigin('bruiser'), place(5, 5), 'party'), t = body('t', hunterOrigin('tank'), place(6, 5), 'foe');
    const plated = withOps(t, marked('plate', { op: 'sheet', key: 'armor', amount: 20 }));
    expect(plated.sheet.armor).toBe(t.sheet.armor + 20);
    expect(swing(u, plated).dealt).toBe(afterDefence(20, 'physical', u.sheet, { ...t.sheet, armor: t.sheet.armor + 20 }, RULES));
    expect(withOps(u, marked('big', { op: 'sheet', key: 'critSize', amount: 0.5 }), marked('bigger', { op: 'sheet', key: 'critSize', amount: 0.5 })).sheet.critSize).toBe(RULES.fight.kit.critSizeMax);
  });

  test('a target\'s exposed faces add to the user\'s crit faces, together at most 6', () => {
    const u = body('u', hunterOrigin('bruiser'), place(5, 5), 'party', {}, { critFaces: 2 }), t = body('t', hunterOrigin('tank'), place(6, 5), 'foe');
    const exposed = (n: number) => withOps(t, statusOn({ label: 'Vision', desc: '', ops: [{ op: 'sheet', key: 'exposed', amount: 0.5 }], stack: { cap: 20, leave: { kind: 'never' }, keep: 'fight', threshold: null } },
      { key: statusKey('vision'), source: { id: null, tier: 2 }, until: null, since: NOW, settledAt: NOW }, n));
    const critOn = (target: Body, face: number) => run(strike, u, [u, target], target.id, rolls({ t: [] }, { t: face })).outcomes[0]!.crit;
    expect([critOn(t, 2), critOn(t, 3)]).toEqual([true, false]);
    expect([critOn(exposed(3), 3), critOn(exposed(3), 4)]).toEqual([true, false]);
    expect([critOn(exposed(20), 6), critOn(exposed(20), 7)]).toEqual([true, false]);
  });

  test('a range op adds to a curse\'s 8 and never to a touch', () => {
    const curse = ability('curse', {}, '5'), u = body('u', hunterOrigin('cannon'), place(0, 5), 'party'), far = body('t', hunterOrigin('tank'), place(10, 5), 'foe');
    expect(resolve(curse, u, [u, far], far.id, GRID, rolls({ t: [] }, { t: 1 }), NOW, RULES)).toEqual({ ok: false, reason: 'range' });
    const longer = withOps(u, marked('reach', { op: 'sheet', key: 'range', amount: 3 }));
    expect(resolve(curse, longer, [longer, far], far.id, GRID, rolls({ t: [] }, { t: 1 }), NOW, RULES).ok).toBe(true);
    const next = body('t', hunterOrigin('tank'), place(2, 5), 'foe'), hand = withOps(body('u', hunterOrigin('bruiser'), place(0, 5), 'party'), marked('reach', { op: 'sheet', key: 'range', amount: 3 }));
    expect(resolve(strike, hand, [hand, next], next.id, GRID, rolls({ t: [] }, { t: 10 }), NOW, RULES)).toEqual({ ok: false, reason: 'range' });
  });

  test('a dispel cures the first harmful status put on, a purge every one, and a helpful one stays', () => {
    const u = body('u', hunterOrigin('support'), place(5, 5), 'party');
    const t = withOps(body('t', hunterOrigin('tank'), place(6, 5), 'party'), marked('haste', { op: 'speed', pct: 20 }), marked('slow', { op: 'speed', pct: -20 }), marked('weak', { op: 'share', on: 'dealt', pct: -25 }));
    const cleanse = (which: 'first' | 'all') => find(run(ability('support', { effect: null, ops: [{ op: 'dispel', which }] }), u, [u, t], t.id, rolls({ t: [] })).bodies, 't').statuses.map(s => s.key);
    expect(cleanse('first')).toEqual(['haste', 'weak']);
    expect(cleanse('all')).toEqual(['haste']);
  });

  test('a use\'s dispel of a bomb a cure sets off lands its end as a land op\'s dispel does: the same hit on the same body (SMX-rules-2.3b)', () => {
    const u = body('u', hunterOrigin('support'), place(5, 5), 'party');
    const def: StatusDef = { label: 'Bomb', desc: '', ops: [{ op: 'root' }], end: { ops: [{ op: 'damage', type: 'magical', amount: formula('20') }], cleanse: 'land' } };
    const t = withOps(body('t', hunterOrigin('tank'), place(6, 5), 'party'), statusOn(def, { key: statusKey('bomb'), source: { id: null, tier: 0 }, until: tick(NOW + 3000), since: NOW, settledAt: NOW }));
    const used = run(ability('support', { effect: null, ops: [{ op: 'dispel', which: 'all' }] }), u, [u, t], t.id, rolls({ t: [] }));
    const rows = new Map([[t.id, t]]), land = landOps(rows, [{ op: 'dispel', which: 'all' }], null, [t.id], { id: null, tier: 0 }, NOW, RULES);
    expect(used.bursts.map(b => b.landed[0]!.dealt)).toEqual([land.landed[0]!.dealt]);
    expect(land.landed[0]!.dealt).toBeGreaterThan(0);
    expect(rowHp(find(used.bodies, 't'))).toBe(rowHp(rows.get(t.id)!));
  });

  test('a use reads a ward whose time ran out as gone: an owed invulnerable status does not hold its bearer at 1 HP (SMX-rules-2.1)', () => {
    const u = body('u', hunterOrigin('bruiser'), place(5, 5), 'party'), big = ability('strike', {}, '999');
    const ward: StatusDef = { label: 'Ward', desc: '', ops: [{ op: 'invulnerable' }], end: { ops: [], cleanse: 'cancel' } };
    const on = (owed: boolean) => withOps(body('t', monsterOrigin('skirmisher'), place(6, 5), 'foe'),
      statusOn(ward, { key: statusKey('ward'), source: { id: null, tier: 0 }, until: owed ? tick(NOW - 500) : tick(NOW + 500), since: tick(0), settledAt: tick(0), ...(owed ? { owed: true as const } : {}) }));
    const hp = (t: Body) => rowHp(find(run(big, u, [u, t], t.id, rolls({ t: [] }, { t: 10 })).bodies, 't'));
    expect([hp(on(false)), hp(on(true))]).toEqual([1, 0]);
  });
});

describe('advantage and held dice: rule 7b, the kept face (kits design 8.2, table 8.9.2)', () => {
  const edge = (key: string, side: 'attack' | 'defend', keep: 'better' | 'worse', spend = true, tag: string | null = null): Status =>
    statusOn({ label: key, desc: '', ops: [{ op: 'edge', side, keep, tag: tag as never, spend }] }, { key: statusKey(key), source: { id: null, tier: 2 }, until: null, since: NOW, settledAt: NOW });
  const boost = (key: string, side: 'attack' | 'defend', die: { kind: 'die'; sides: number } | { kind: 'face'; n: number }): Status =>
    statusOn({ label: key, desc: '', ops: [{ op: 'boost', side, die }] }, { key: statusKey(key), source: { id: null, tier: 2 }, until: null, since: NOW, settledAt: NOW });
  const curse = ability('curse', {}, '10');
  // two equal casters: the edge of rule 8 is 0, so the curse is resisted on 12 or more (resistDc)
  const pair = (u: Status[] = [], t: Status[] = []) => [body('u', hunterOrigin('cannon'), place(5, 5), 'party', { statuses: u }), body('t', hunterOrigin('cannon'), place(6, 5), 'foe', { statuses: t })] as const;
  const avoid = (u: Body, t: Body, rl: Rolls) => run(curse, u, [u, t], t.id, rl).outcomes[0]!.avoid;
  const with2 = (react: number, second: number, boostRolls?: Record<string, number>): Rolls => ({ ...rolls({ t: [] }, { t: react }), second: { t: second } as NonNullable<Rolls['second']>, ...(boostRolls ? { boost: boostRolls as NonNullable<Rolls['boost']> } : {}) });

  test('the attacker\'s edge makes the target keep the lower of two d20s, the defender\'s the higher: 18 and 2 resist one way and not the other', () => {
    const [u0, t0] = pair();
    expect(avoid(u0, t0, rolls({ t: [] }, { t: 18 }))).toBe('resisted');
    const [u1, t1] = pair([edge('focus', 'attack', 'better')]);
    expect(avoid(u1, t1, with2(18, 2))).toBe('caught');
    const [u2, t2] = pair([], [edge('guard', 'defend', 'better')]);
    expect(avoid(u2, t2, with2(2, 18))).toBe('resisted');
  });

  test('an edge and its opposite on one die cancel: one d20 is read and no second is asked for; both spend', () => {
    const [u, t] = pair([edge('focus', 'attack', 'better')], [edge('guard', 'defend', 'better')]);
    expect(needs(curse, u, [u, t], t.id, GRID, NOW, RULES).second).toBeUndefined();
    const r = run(curse, u, [u, t], t.id, rolls({ t: [] }, { t: 18 }));
    expect(r.outcomes[0]!.avoid).toBe('resisted');
    expect([find(r.bodies, 'u').statuses, find(r.bodies, 't').statuses]).toEqual([[], []]);
  });

  test('a spending edge loses a stack after the first use whose die it reached, once however many targets; a worn one holds', () => {
    const blast = ability('blast', {}, '10');
    const spend: Status = statusOn({ label: 'Focus', desc: '', ops: [{ op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true }], stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null } },
      { key: statusKey('focus'), source: { id: null, tier: 2 }, until: null, since: NOW, settledAt: NOW }, 3);
    const u = body('u', hunterOrigin('cannon'), place(0, 0), 'party', { statuses: [spend, edge('bow', 'attack', 'better', false)] });
    const a = body('a', monsterOrigin('brute'), place(8, 5), 'foe'), b = body('b', monsterOrigin('brute'), place(9, 5), 'foe');
    const r = run(blast, u, [u, a, b], place(8, 5), { ...rolls({ a: [], b: [] }, { a: 10, b: 10 }), second: { a: 4, b: 4 } as NonNullable<Rolls['second']> });
    const left = find(r.bodies, 'u').statuses;
    expect(left.map(x => [x.key, 'stacks' in x ? x.stacks : null])).toEqual([['focus', 2], ['bow', null]]);
  });

  test('an edge with a tag reaches only a use with that tag', () => {
    const [u, t] = pair([edge('sword', 'attack', 'better', true, 'sword')]);
    expect(needs(curse, u, [u, t], t.id, GRID, NOW, RULES).second).toBeUndefined();
    expect(needs({ ...curse, tags: ['sword' as never] }, u, [u, t], t.id, GRID, NOW, RULES).second).toEqual([t.id]);
  });

  test('a held die moves the face: the attacker\'s d6 rolled 5 takes 15 to 10, the defender\'s fixed 20 lifts any face to 20; each spends', () => {
    const [u, t] = pair([boost('luck', 'attack', { kind: 'die', sides: 6 })]);
    expect(needs(curse, u, [u, t], t.id, GRID, NOW, RULES).boost).toEqual([{ id: heldDieId(u.id, statusKey('luck'), 0), sides: 6 }]);
    const r = run(curse, u, [u, t], t.id, { ...rolls({ t: [] }, { t: 15 }), boost: { [heldDieId(u.id, statusKey('luck'), 0)]: 5 } });
    expect(r.outcomes[0]!.avoid).toBe('caught');
    expect(find(r.bodies, 'u').statuses).toEqual([]);
    const [u2, t2] = pair([], [boost('myth', 'defend', { kind: 'face', n: 20 })]);
    expect(needs(curse, u2, [u2, t2], t2.id, GRID, NOW, RULES).boost).toBeUndefined();
    expect(avoid(u2, t2, rolls({ t: [] }, { t: 1 }))).toBe('resisted');
  });

  test('several held dice on one body each roll and stack (the owner, Nov 20): a d4 rolled 3 and a d8 rolled 7 take 20 to 10; both spend', () => {
    const [u, t] = pair([boost('bless', 'attack', { kind: 'die', sides: 4 }), boost('focus', 'attack', { kind: 'die', sides: 8 })]);
    const asked = needs(curse, u, [u, t], t.id, GRID, NOW, RULES).boost ?? [];
    expect(asked.map(b => b.sides).sort((x, y) => x - y)).toEqual([4, 8]);
    const held = Object.fromEntries(asked.map(b => [b.id, b.sides === 4 ? 3 : 7])) as NonNullable<Rolls['boost']>;
    const r = run(curse, u, [u, t], t.id, { ...rolls({ t: [] }, { t: 20 }), boost: held });
    expect(r.outcomes[0]!.avoid).toBe('caught');
    expect(find(r.bodies, 'u').statuses).toEqual([]);
  });

  test('a price that takes the user\'s edge leaves the target\'s alone: the second d20 is asked for, and the use lands with the dice asked', () => {
    const [u, t] = pair([edge('focus', 'attack', 'better')], [edge('guard', 'defend', 'better')]);
    const spending = { ...curse, prices: [{ kind: 'stacks', from: 'self', key: statusKey('focus'), take: { kind: 'n', n: 1 } }] } as Ability;
    const n = needs(spending, u, [u, t], t.id, GRID, NOW, RULES);
    expect(n.second).toEqual([t.id]);
    expect(run(spending, u, [u, t], t.id, with2(2, 18)).outcomes[0]!.avoid).toBe('resisted');
  });

  test('a use with an edge waits for its second d20, as for any roll it needs', () => {
    const [u, t] = pair([edge('focus', 'attack', 'better')]);
    expect(resolve(curse, u, [u, t], t.id, GRID, rolls({ t: [] }, { t: 18 }), NOW, RULES)).toEqual({ ok: false, reason: 'needsRoll' });
  });

  test('two edges of one kind do not add: two attack edges are one second d20 kept lower', () => {
    const [u, t] = pair([edge('a', 'attack', 'better'), edge('b', 'attack', 'better')]);
    expect(needs(curse, u, [u, t], t.id, GRID, NOW, RULES).second).toEqual([t.id]);
    expect(avoid(u, t, with2(18, 11))).toBe('caught');
  });
});

describe('who a use may pick and who it catches: the one sight rule (notes-7-stealth.md section 3, stealth unit 4)', () => {
  // A picked target (rule 2) is refused `noTarget` when no body of the user's side perceives it (sight.ts `perceivedBy`):
  // a hidden body is seen by a sight at its level or above (the owner's ruling 1). A shape at a place catches it whatever
  // the sight; only the untargetable ward keeps a foe out of a shape.
  const curse = ability('curse', {}, '10'), blast = ability('blast', {}, '10');
  const worn = (key: string, ...ops: Op[]): Status => statusOn({ label: key, desc: '', ops }, { key: statusKey(key), source: { id: null, tier: 0 }, until: null, since: NOW, settledAt: NOW });
  const cloak = (level: HideLevel): Status => worn('cloak', { op: 'hidden', level, start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } });
  const user = (sight: Level = 0, at = place(2, 5)) => body('u', hunterOrigin('cannon'), at, 'party', {}, { sight });
  const foe = (...statuses: Status[]) => body('t', monsterOrigin('brute'), place(8, 5), 'foe', { statuses });
  const picked = (u: Body, bodies: Body[]) => resolve(curse, u, bodies, combatantId('t'), GRID, rolls({ t: [] }, { t: 1 }), NOW, RULES);

  test('a foe hidden at 3 is picked by a sight of 3 or more and refused noTarget under it', () => {
    const t = foe(cloak(3));
    expect(LEVELS.map(sight => { const u = user(sight); const r = picked(u, [u, t]); return r.ok || r.reason; })).toEqual(['noTarget', 'noTarget', 'noTarget', true, true, true]);
  });

  test('an ally whose sight reaches a hidden foe lets the user pick it; a foe with no stealth is picked by any sight', () => {
    const u = user(0), t = foe(cloak(2)), ally = body('a', hunterOrigin('tank'), place(2, 7), 'party', {}, { sight: 2 });
    expect(picked(u, [u, t, ally]).ok).toBe(true);
    expect(picked(u, [u, foe()]).ok).toBe(true);
  });

  test('a blast at a hidden foe\'s place catches it, which no sight of the user perceives', () => {
    const u = user(0), t = foe(cloak(5));
    const r = run(blast, u, [u, t], t.place, rolls({ t: [] }, { t: 1 }));
    expect(r.outcomes.map(o => [o.target, o.avoid !== 'out', o.dealt > 0])).toEqual([['t', true, true]]);
  });

  test('a use\'s reveal op ends each hide it catches that ends on a reveal; a hide that does not stays, and a use with no reveal op ends none', () => {
    const flare = ability('blast', { effect: null, ops: [{ op: 'reveal' }] }), dud = ability('blast', { effect: null });
    const shroud = worn('shroud', { op: 'hidden', level: 1, start: 'anywhere', ends: { hurt: true, revealed: false, dealt: true } });
    const after = (a: Ability, s: Status) => { const u = user(0), t = foe(s); return find(run(a, u, [u, t], t.place, rolls({ t: [] }, { t: 1 })).bodies, 't').statuses.map(x => x.key); };
    expect([after(flare, cloak(2)), after(flare, shroud), after(dud, cloak(2))]).toEqual([[], ['shroud'], ['cloak']]);
  });

  test('an untargetable foe is neither picked nor caught by a blast at its place', () => {
    const u = user(5), t = foe(worn('veil', { op: 'untargetable' }));
    expect(picked(u, [u, t])).toEqual({ ok: false, reason: 'noTarget' });
    const r = run(blast, u, [u, t], t.place, rolls({ t: [] }, { t: 1 }));
    expect([r.outcomes, find(r.bodies, 't')]).toEqual([[], t]);
  });
});
