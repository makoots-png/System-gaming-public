import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import type { Stats } from '../src/core/stats.ts';
import { kitGear, NO_TWEAK, share } from '../src/core/hunter/derive.ts';
import { bareRefusal, evaluate, NO_KIT, parseFormula, printFormula, someFormula } from '../src/core/formula.ts';
import type { Formula } from '../src/core/formula.ts';
import { openGrid, place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import type { Tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId, tag } from '../src/core/combat/ability-types.ts';
import {
  OP_KINDS, addSheetStatus, applyStatus, bareBody, cureStatus, describeStatus, dispelled, dueAmount, freeStatusKey, FULL_HEAL, isControl, landLine, lasting, modified, modsOf, onSheet, opLines, opsOffered, removeStatus, settle,
  sheetStatuses, shielded, shieldGrown, statusKey, statusOn, statusShield, withStatuses,
} from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseLandOp, parseOp, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import type { Body, Op, Origin, StackDef, StackRule, Status, StatusDef, StatusFields } from '../src/core/combat/effect-ops.ts';
import { stackStep } from '../src/core/combat/stacks.ts';
import { admitted, boostsOn, counts, damageShare, edgeOn, harmful, helpful, holds, sheetAdds, STATUS_LIVES, statusStep, wardedDamage, withSheetOps } from '../src/core/combat/standing.ts';
import type { StatusLife } from '../src/core/combat/standing.ts';
import { isMythicStatusKey } from '../src/core/combat/mythic-types.ts';
import { zoneId, zoneTone } from '../src/core/combat/zones.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { wornWorth } from '../src/core/registry/worth.ts';
import { fightDoc, fightWire } from '../src/core/combat/fight-doc.ts';
import { giverOf, payDue } from '../src/core/combat/fight-turn.ts';
import { NO_PEN, afterDefence, channelBreaks, held, landOps } from '../src/core/combat/land.ts';
import { resolve } from '../src/core/combat/resolve.ts';
import type { Stack, StackCtx } from '../src/core/combat/stacks.ts';
import { STATUS_WALK, WALK_EVENTS as STACK_WALK } from './models/stack-events.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Command, Fight, NewRow } from '../src/core/combat/fight.ts';
import { abilityOf, tagsOf } from '../src/core/registry/ability-kinds.ts';
import type { Ability, CombatantId } from '../src/core/combat/ability-types.ts';
import { rng } from './models/fight-play.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { atHp, lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';

const f = (text: string): Formula => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const def = (...ops: Op[]): StatusDef => ({ label: 'Test', desc: '', ops });
const status = (key: string, d: StatusDef, until: number | null, o: Partial<StatusFields> = {}): Status =>
  statusOn(d, { key: statusKey(key), source: { id: null, tier: 0 }, until: until === null ? null : tick(until), since: tick(0), settledAt: tick(0), ...o });
const stats = (o: Partial<Stats> = {}): Stats => ({ ...baseStats(RULES.fight), ...o });
const hunterOf = (s: Stats = stats()): Origin => ({ kind: 'hunter', build: { stats: s, level: 1, gear: kitGear('light', RULES), perks: {} } });
function body(origin: Origin = hunterOf(), o: RowPatch<Body> = {}): Body {
  const { stats: st, sheet } = modified(origin, [], RULES), { kind, hp, ...rest } = o;
  return {
    id: combatantId('b'), side: 'party', ...lifeAt(kind ?? (origin.kind === 'hunter' ? 'hunter' : 'monster'), hp ?? sheet.hpMax), origin, tier: 0, stats: st, sheet,
    place: place(0, 0), mana: sheet.manaMax, fatigue: 0, shield: null, stagger: null, channel: null, threat: null,
    statuses: [], readyAt: {}, abilities: [], intent: null, holder: null, xp: 0, mythic: null, name: 'Body', at: tick(1000), speed: sheet.speed, tie: 0, ...rest,
  } as Body;
}
const near = (actual: readonly number[], expected: readonly number[], digits: number): void => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((a, i) => expect(a).toBeCloseTo(expected[i]!, digits));
};
const sheetUnder = (...ops: Op[]) => modified(hunterOf(), [status('s', def(...ops), null)], RULES).sheet;

describe('what each op does to a sheet', () => {
  test('a stat op adds to the stat before its curve: Strength 10 raised by 10 gives 0.6 * eff(20) = 10.45 physical power', () => {
    expect(sheetUnder({ op: 'stat', key: 'str', amount: { kind: 'number', value: 10 } }).phys).toBeCloseTo(10.45, 2);
    expect(modified(hunterOf(), [status('s', def({ op: 'stat', key: 'str', amount: { kind: 'number', value: 10 } }), null)], RULES).stats.str).toBe(20);
  });

  test('a speed op changes speed by its percent', () => {
    expect([sheetUnder({ op: 'speed', pct: -30 }).speed, sheetUnder({ op: 'speed', pct: 20 }).speed]).toEqual([70, 120]);
  });

  test('a root makes a body move 0 tiles', () => {
    expect([sheetUnder({ op: 'root' }).move, sheetUnder({ op: 'root' }).stride]).toEqual([0, 0]);
  });

  test('every other op leaves the sheet as it is', () => {
    const plain = modified(hunterOf(), [], RULES).sheet;
    const others: Op[] = [
      { op: 'damage', type: 'physical', amount: f('2') }, { op: 'heal', amount: f('2') }, { op: 'mana', amount: f('2') },
      { op: 'fatigue', amount: f('2') }, { op: 'applyStatus', key: statusKey('x'), def: def(), duration: tick(1000) },
      { op: 'cureStatus', key: statusKey('x') }, { op: 'note', text: 'n' }, { op: 'delay', ticks: tick(300) }, { op: 'hold' },
      { op: 'taunt' }, { op: 'threat', amount: 5 }, { op: 'shield', amount: f('10') }, { op: 'channel', mode: 'protect' },
      { op: 'staggerRate', pct: 50 }, { op: 'refund', pct: 50, chance: 100 }, { op: 'aura', radius: 2, on: 'all' }, { op: 'spread', range: 1 },
    ];
    expect(others.filter(o => JSON.stringify(sheetUnder(o)) !== JSON.stringify(plain)).map(o => o.op)).toEqual([]);
  });

  test('an aura and a spread say what they do, and read back through the op parser as they were written', () => {
    const aura: Op = { op: 'aura', radius: 2, on: 'allies' }, spread: Op = { op: 'spread', range: 1 };
    expect(describeStatus(def(aura, spread), null, RULES)).toEqual([
      'Applies its other effects to allies within 2 tiles', 'Spreads each round to anyone within 1 tile who fails to resist it, once a fight',
    ]);
    expect([parseOp(aura, RULES), parseOp(spread, RULES)]).toEqual([aura, spread]);
    for (const bad of [{ ...aura, radius: 0 }, { ...aura, on: 'friends' }, { ...spread, range: 1.5 }, { op: 'spread' }]) expect(parseOp(bad, RULES)).toBeNull();
  });

  test('a number given per tier is read at the source\'s tier', () => {
    const slow = def({ op: 'speed', pct: [-10, -20, -30, -40, -50, -60] });
    expect([0, 2, 5].map(tier => modified(hunterOf(), [status('s', slow, null, { source: { id: null, tier } })], RULES).sheet.speed)).toEqual([90, 70, 40]);
  });
});

describe('speed changes', () => {
  test('the strongest slow and the strongest haste both apply and multiply: 30% slow and 20% haste give 0.84', () => {
    const list = [status('a', def({ op: 'speed', pct: -30 }), null), status('b', def({ op: 'speed', pct: -10 }), null),
      status('c', def({ op: 'speed', pct: 20 }), null), status('d', def({ op: 'speed', pct: 5 }), null)];
    expect(modified(hunterOf(), list, RULES).sheet.speed).toBe(84);
    const [mod, ...rest] = modsOf(list, bareBody(hunterOf(), RULES)).mods;
    expect([mod?.op, rest]).toEqual(['speed', []]);
    near([mod?.op === 'speed' ? mod.pct : NaN], [-16], 10);
  });

  test('a slow on a body rescales the wait left by old speed over new', () => {
    const b = body(hunterOf(), { at: tick(1500) });
    const slowed = withStatuses(b, [status('s', def({ op: 'speed', pct: -50 }), 3000)], tick(500), RULES);
    expect([slowed.speed, slowed.sheet.speed, slowed.at]).toEqual([50, 50, 2500]);
  });

  test('a status that lowers max HP brings a full body down to the new max, and leaves a hurt one below it as it is', () => {
    const full = body(hunterOf(stats({ vit: 40 })));
    const weak = [status('weak', def({ op: 'stat', key: 'vit', amount: { kind: 'number', value: -30 } }), 3000)];
    const after = withStatuses(full, weak, tick(500), RULES);
    expect(after.sheet.hpMax).toBeLessThan(full.sheet.hpMax);
    expect(rowHp(after)).toBe(after.sheet.hpMax);
    expect(rowHp(withStatuses(atHp(full, 5), weak, tick(500), RULES))).toBe(5);
  });
});

describe('one instance per key, stronger wins', () => {
  const burn = (tier: number, until: number, label = 'Burn'): Status =>
    status('burning', { label, desc: '', ops: [] }, until, { source: { id: null, tier } });

  test('a new key is added at the end', () => {
    expect(applyStatus([burn(1, 1000)], status('slowed', def(), 500)).map(s => s.key)).toEqual(['burning', 'slowed']);
  });

  test('the higher tier wins and the later end is kept', () => {
    const [weakFirst] = applyStatus([burn(1, 3000, 'Weak')], burn(3, 2000, 'Strong'));
    const [strongFirst] = applyStatus([burn(3, 2000, 'Strong')], burn(1, 3000, 'Weak'));
    expect([weakFirst!.def.label, weakFirst!.source.tier, weakFirst!.until]).toEqual(['Strong', 3, 3000]);
    expect([strongFirst!.def.label, strongFirst!.until]).toEqual(['Strong', 3000]);
  });

  test('a tie goes to the new one, and a status with no end outlasts any end', () => {
    const [s] = applyStatus([burn(2, 3000, 'Old')], { ...burn(2, 0, 'New'), until: null });
    expect([s!.def.label, s!.until]).toEqual(['New', null]);
  });

  test('a status put on again keeps the time it was paid to', () => {
    const [s] = applyStatus([{ ...burn(1, 3000), since: tick(1000), settledAt: tick(1200) }], { ...burn(1, 5000), since: tick(2500), settledAt: tick(2500) });
    expect([s!.since, s!.settledAt]).toEqual([tick(1000), tick(1200)]);
  });

  test('a cure removes the key', () => {
    expect(removeStatus([burn(1, 1000), status('slowed', def(), 500)], statusKey('burning')).map(s => s.key)).toEqual(['slowed']);
  });
});

describe('durations (design 3.1 rule 18 and table 4.4)', () => {
  const taunt = def({ op: 'taunt' });
  const rounds = (t: Tick): number => t / RULES.fight.round;

  test('a taunt of 2 rounds holds 1.92, 1.77 and 1.65 rounds on the E, C and S bruiser\'s tenacity, the most of the five builds', () => {
    near([4.44, 12.83, 20.88].map(ten => rounds(lasting(taunt, tick(2000), 0, 0, ten))), [1.915, 1.773, 1.654], 2);
  });

  test('potency lengthens a control status as tenacity shortens it, so equal amounts cancel', () => {
    expect(lasting(taunt, tick(2000), 0, 50, 0)).toBe(tick(3000));
    expect(lasting(taunt, tick(2000), 0, 30, 30)).toBe(tick(2000));
  });

  test('a status that controls nothing lasts its duration whatever the tenacity', () => {
    const burn = def({ op: 'damage', type: 'arcane', amount: f('3') }), haste = def({ op: 'speed', pct: 20 });
    expect([isControl(burn, 0), isControl(haste, 0), lasting(burn, tick(2000), 0, 0, 60)]).toEqual([false, false, 2000]);
  });
});

describe('settling a per-round op (design 1.3, table 1.6)', () => {
  const tenARound = def({ op: 'damage', type: 'arcane', amount: f('10') });
  // Applied at 0.40 for 2 rounds; the bearer's turns start every interval from 0.
  function paid(interval: number): number[] {
    let list: Status[] = [status('burn', tenARound, 2400, { since: tick(400), settledAt: tick(400) })];
    const out: number[] = [];
    for (let now = interval; list.length; now += interval) {
      if (now <= 400) continue;
      const r = settle(list, tick(now), RULES);
      out.push(...r.due.map(d => dueAmount(d, { user: SELF, target: SELF, charge: 0 }, [])));
      list = r.statuses;
    }
    return out;
  }
  const SELF = { stats: stats(), sheet: modified(hunterOf(), [], RULES).sheet };

  test('10 a round for 2 rounds pays 6 + 10 + 4 on a speed-100 bearer and 1 + 5 + 5 + 5 + 4 on a speed-200 one', () => {
    expect(paid(1000)).toEqual([6, 10, 4]);
    expect(paid(500)).toEqual([1, 5, 5, 5, 4]);
  });

  test('on a speed-80 bearer the two turns pay for 0.85 and 1.15 rounds, 20 in all', () => {
    const first = settle([status('burn', tenARound, 2400, { since: tick(400), settledAt: tick(400) })], tick(1250), RULES);
    const second = settle(first.statuses, tick(2500), RULES);
    near([...first.due, ...second.due].map(d => d.share), [0.85, 1.15], 10);
    expect([first.statuses.length, second.statuses.length, second.expired.length]).toEqual([1, 0, 1]);
    expect(paid(1250)).toEqual([9, 11]);
  });

  test('the total over a span does not depend on how the span is split', () => {
    const r = rng(47);
    const sevenAThird = def({ op: 'damage', type: 'arcane', amount: f('7.3') });
    for (let run = 0; run < 300; run++) {
      const until = r.int(1, 6000);
      let list: Status[] = [status('burn', sevenAThird, until)], now = 0, total = 0;
      while (list.length) {
        now += r.int(1, 1700);
        const res = settle(list, tick(now), RULES);
        total += res.due.reduce((n, d) => n + dueAmount(d, { user: SELF, target: SELF, charge: 0 }, []), 0);
        list = res.statuses;
      }
      expect(total).toBe(Math.round(7.3 * until / 1000));
    }
  });

  test('a heal, mana and fatigue op settle the same way, and an op marked for use does not', () => {
    const d = def({ op: 'heal', amount: f('4') }, { op: 'mana', amount: f('2') }, { op: 'fatigue', amount: f('-6') }, { op: 'damage', type: 'physical', amount: f('9'), when: 'use' });
    const r = settle([status('regen', d, null)], tick(500), RULES);
    expect(r.due.map(x => [x.op.op, dueAmount(x, { user: SELF, target: SELF, charge: 0 }, [])])).toEqual([['heal', 2], ['mana', 1], ['fatigue', -3]]);
  });

  test('the dice the edge rolled for a settle are the formula\'s dice', () => {
    const r = settle([status('poison', def({ op: 'damage', type: 'arcane', amount: f('1d6 + 2') }), null)], tick(1000), RULES);
    expect(dueAmount(r.due[0]!, { user: SELF, target: SELF, charge: 0 }, [5])).toBe(7);
  });

  test('a status ends at the bearer\'s first turn at or after its end, and not before', () => {
    const s = status('slowed', def({ op: 'speed', pct: -30 }), 2000);
    expect([settle([s], tick(1999), RULES).statuses.length, settle([s], tick(2000), RULES).expired.length]).toEqual([1, 1]);
  });

  test('a status never settles twice for the same span of time, over seeded waits', () => {
    const r = rng(31);
    for (let run = 0; run < 300; run++) {
      const start = r.int(0, 2000), until = start + r.int(1, 5000);
      let list: Status[] = [status('burn', tenARound, until, { since: tick(start), settledAt: tick(start) })], now = start, spans = 0;
      while (list.length) {
        now += r.int(0, 1500);
        const before = list[0]!.settledAt, res = settle(list, tick(now), RULES);
        for (const d of res.due) spans += d.share * RULES.fight.round;
        const after = (res.statuses[0] ?? res.expired[0])!.settledAt;
        expect(after).toBeGreaterThanOrEqual(before);
        expect(after).toBeLessThanOrEqual(Math.min(now, until));
        list = res.statuses;
      }
      expect(Math.round(spans)).toBe(until - start);
    }
  });
});

describe('shields (design 4.4)', () => {
  test('two shields do not add: the larger amount holds, with the later end of the two', () => {
    expect(shielded({ amount: 30, until: tick(2000) }, { amount: 20, until: tick(3000) }, tick(500))).toEqual({ amount: 30, until: 3000 });
    expect(shielded({ amount: 10, until: tick(4000) }, { amount: 20, until: tick(3000) }, tick(500))).toEqual({ amount: 20, until: 4000 });
  });

  test('a shield past its end counts for nothing', () => {
    expect(shielded({ amount: 50, until: tick(400) }, { amount: 20, until: tick(3000) }, tick(500))).toEqual({ amount: 20, until: 3000 });
  });
});

describe('shields received, the `shielded` share (balance plan section 10, rule 11c)', () => {
  const more = (pct: number): Status => status('warded', def({ op: 'share', on: 'shielded', pct }), null);
  const giver = (amount: string): StatusDef => def({ op: 'shield', amount: f(amount) });
  const self = (b: Body) => ({ user: { stats: b.stats, sheet: b.sheet }, target: { stats: b.stats, sheet: b.sheet }, charge: 0 });

  test('it reads back through the parser, says what it changes, and is harmful only when it lowers shields', () => {
    for (const pct of [25, -40]) expect(parseOp({ op: 'share', on: 'shielded', pct }, RULES)).toEqual({ op: 'share', on: 'shielded', pct });
    expect(describeStatus(def({ op: 'share', on: 'shielded', pct: 25 }), 0, RULES)).toEqual(['Shields received +25%']);
    expect([harmful(def({ op: 'share', on: 'shielded', pct: 25 })), harmful(def({ op: 'share', on: 'shielded', pct: -40 }))]).toEqual([false, true]);
  });

  test('a status\'s shield of 20 lands as 30 on a bearer whose shields received is +50%, and as 20 on one with none', () => {
    const plain = body(), warded = body(hunterOf(), { statuses: [more(50)] });
    expect(statusShield(giver('20'), plain, self(plain), null, tick(0), tick(2000), RULES)).toEqual({ amount: 20, until: 2000 });
    expect(statusShield(giver('20'), warded, self(warded), null, tick(0), tick(2000), RULES)).toEqual({ amount: 30, until: 2000 });
  });

  test('the share stays within kit.shareCap of 1: +100% lands a shield of 20 as 20 times 1.5, -100% as 20 times 0.5', () => {
    const cap = RULES.fight.kit.shareCap, up = body(hunterOf(), { statuses: [more(100)] }), down = body(hunterOf(), { statuses: [more(-100)] });
    expect(statusShield(giver('20'), up, self(up), null, tick(0), tick(2000), RULES)!.amount).toBe(Math.round(20 * (1 + cap)));
    expect(statusShield(giver('20'), down, self(down), null, tick(0), tick(2000), RULES)!.amount).toBe(Math.round(20 * (1 - cap)));
  });

  test('a land op\'s shield of 20 lands as 30 on a bearer whose shields received is +50%', () => {
    const t = body(hunterOf(), { statuses: [more(50)] }), rows = new Map([[t.id, t]]);
    landOps(rows, [{ op: 'shield', amount: f('20') }], null, [t.id], { id: null, tier: 0 }, tick(0), RULES);
    expect(rows.get(t.id)!.shield!.amount).toBe(30);
  });
});

describe('a giver\'s heal and shield power, and damage to shield (item-stats 2)', () => {
  const END = tick(2000), NOW = tick(0), CEILING = 40;
  const shieldOf = (amount: number, until: number) => ({ amount, until: tick(until) });
  const grow = (b: Body, gain: number) => shieldGrown(b, gain, CEILING, END, NOW, RULES);
  const powered = (power: number, o: RowPatch<Body> = {}): Body => { const b = body(hunterOf(), o); return { ...b, sheet: { ...b.sheet, healPower: share(power) } }; };
  const self = (b: Body) => ({ user: { stats: b.stats, sheet: b.sheet }, target: { stats: b.stats, sheet: b.sheet }, charge: 0 });

  test('a gain of 20 on a body with no shield is a shield of 20 to the end given', () => {
    expect(grow(body(), 20)).toEqual(shieldOf(20, END));
  });

  test('a gain adds to the shield held now and moves its end: 15 held and 10 gained is 25', () => {
    expect(grow(body(hunterOf(), { shield: shieldOf(15, 1500) }), 10)).toEqual(shieldOf(25, END));
  });

  test('the ceiling holds: 35 held and 10 gained is the ceiling of 40', () => {
    expect(grow(body(hunterOf(), { shield: shieldOf(35, 1500) }), 10)).toEqual(shieldOf(CEILING, END));
  });

  test('a shield past its end counts as none: 30 that ended and 10 gained is 10', () => {
    expect(grow(body(hunterOf(), { shield: shieldOf(30, 0) }), 10)).toEqual(shieldOf(10, END));
  });

  test('a larger shield from elsewhere is kept: 60 held and 10 gained stays 60, with the later end of the two', () => {
    expect(grow(body(hunterOf(), { shield: shieldOf(60, 1500) }), 10)).toEqual(shieldOf(60, END));
  });

  test('the gain is times the bearer\'s shields received share: 10 at +50% is 15', () => {
    expect(grow(body(hunterOf(), { statuses: [status('warded', def({ op: 'share', on: 'shielded', pct: 50 }), null)] }), 10)).toEqual(shieldOf(10 * 1.5, END));
  });

  test('a gain that rounds to nothing leaves the shield as it is, its end too', () => {
    const held = shieldOf(15, 1500);
    expect([grow(body(), 0.4), grow(body(hunterOf(), { shield: held }), 0.4)]).toEqual([null, held]);
  });

  test('a status\'s shield of 20 put on by a giver at 20% power lands 24; with no giver (the GM\'s Status window, a worn status) 20', () => {
    const shield = def({ op: 'shield', amount: f('20') }), b = body();
    expect([statusShield(shield, b, self(b), powered(0.2), NOW, END, RULES)!.amount, statusShield(shield, b, self(b), null, NOW, END, RULES)!.amount]).toEqual([20 * 1.2, 20]);
  });

  test('a per-round heal of 10 a healer at 20% put on heals 12 as it settles; a worn one, one no body put on and one whose giver left the fight heal 10', () => {
    const healer = powered(0.2, { id: combatantId('h') }), regen = def({ op: 'heal', amount: f('10'), when: 'turn' });
    const from = (id: string | null, o: Partial<StatusFields> = {}) => status('regen', regen, null, { source: { id: id === null ? null : combatantId(id), tier: 0 }, ...o });
    const due = { key: statusKey('regen'), op: { op: 'heal', amount: f('10'), when: 'turn' } as const, tier: 0, before: 0, share: 1, stacks: 1 };
    const healed = (s: Status, rows: Body[]): number => {
      const b = body(hunterOf(), { hp: 1, statuses: [s] });
      return rowHp(payDue(b, due, [], NOW, RULES, giverOf({ rows: [...rows, b] }, b.statuses, due.key))) - rowHp(b);
    };
    expect([healed(from('h'), [healer]), healed(from('h', { worn: true }), [healer]), healed(from(null), [healer]), healed(from('h'), [])]).toEqual([10 * 1.2, 10, 10, 10]);
  });
});

describe('a stacking status (kits design 1.1, table 2.1)', () => {
  const rule = (o: Partial<StackRule> = {}): StackRule => ({ cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null, ...o });
  const stacking = (o: Partial<StackRule>, ...ops: Op[]): StackDef => ({ label: 'Pain', desc: '', ops, stack: rule(o) });
  const of = (d: StatusDef, stacks: number, o: Partial<StatusFields> = {}): Status =>
    statusOn(d, { key: statusKey('pain'), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0), ...o }, stacks);
  const count = (list: readonly Status[]): number | undefined => list.find(s => s.key === 'pain')?.stacks;

  test('applying adds the incoming stacks to what the bearer holds, never past the cap, and a plain status holds no count', () => {
    const pain = stacking({});
    expect(count(applyStatus([], of(pain, 2)))).toBe(2);
    expect(count(applyStatus([of(pain, 2)], of(pain, 2)))).toBe(4);
    expect(count(applyStatus([of(pain, 4)], of(pain, 3)))).toBe(5);
    expect(of(def(), 3).stacks).toBeUndefined();
    expect(of(pain, 99).stacks).toBe(5);
  });

  test('every number of its ops is per stack: 3 stacks of +4 Strength are +12, of a 10% slow a 30% slow; a root acts from one', () => {
    const at3 = (...ops: Op[]) => modified(hunterOf(), [of(stacking({}, ...ops), 3)], RULES);
    expect(at3({ op: 'stat', key: 'str', amount: { kind: 'number', value: 4 } }).stats.str).toBe(10 + 12);
    expect(at3({ op: 'speed', pct: -10 }).sheet.speed).toBe(70);
    expect(at3({ op: 'root' }).sheet.move).toBe(0);
  });

  test('a per-round op pays at the count the status holds when its bearer settles: 3 stacks of 4 a round pay 12 a round', () => {
    const burn = stacking({}, { op: 'damage', type: 'arcane', amount: f('4'), when: 'turn' });
    const s = settle([of(burn, 3)], tick(RULES.fight.round), RULES);
    expect(s.due.map(d => d.stacks)).toEqual([3]);
    expect(dueAmount(s.due[0]!, { user: body(), target: body(), charge: 0 }, [])).toBe(12);
  });

  test('stacks that leave a round lose one for each whole round held, and the last to go is spent, not ended', () => {
    const fading = stacking({ leave: { kind: 'round' } }), R1 = RULES.fight.round;
    const half = settle([of(fading, 3)], tick(R1 / 2), RULES);
    expect(count(half.statuses)).toBe(3);
    const two = settle(half.statuses, tick(2 * R1), RULES);
    expect(count(two.statuses)).toBe(1);
    const gone = settle(two.statuses, tick(3 * R1), RULES);
    expect([gone.statuses.length, gone.spent.length, gone.expired.length]).toEqual([0, 1, 0]);
  });

  test('a status whose time runs out at a settle ends there, at the count it settled at, however its stacks leave', () => {
    const R1 = RULES.fight.round;
    for (const leave of [{ kind: 'never' }, { kind: 'round' }, { kind: 'event', event: 'struck' }] as const) {
      for (const stacks of [1, 3]) for (const rounds of [1, 2, 4]) {
        const s = settle([of(stacking({ leave }), stacks, { until: tick(rounds * R1) })], tick(rounds * R1), RULES);
        expect([s.statuses.length, s.spent.length, s.expired.map(x => x.stacks)]).toEqual([0, 0, [stacks]]);
      }
    }
  });

  test('stacks that never leave stay through any settle until the status\'s time runs out', () => {
    expect(count(settle([of(stacking({}), 4)], tick(10 * RULES.fight.round), RULES).statuses)).toBe(4);
  });

  test('a cure of n stacks takes n and keeps the rest; a cure of more, or with no count, takes the status', () => {
    const pain = stacking({});
    expect(count(cureStatus([of(pain, 4)], statusKey('pain'), 3))).toBe(1);
    expect(cureStatus([of(pain, 2)], statusKey('pain'), 3)).toEqual([]);
    expect(cureStatus([of(pain, 4)], statusKey('pain'))).toEqual([]);
    expect(cureStatus([of(def(), 1)], statusKey('pain'), 1)).toEqual([]);
  });

  test('the sheet keeps a stacking status\'s count and adds counts to its cap, and a fight\'s count is not the sheet\'s', () => {
    const cold = stacking({ keep: 'sheet' }), pain = stacking({ keep: 'fight' });
    const sheet = sheetStatuses([of(cold, 2)], tick(0), RULES);
    expect(sheet.map(s => s.stacks)).toEqual([2]);
    expect(addSheetStatus(sheet, { ...sheet[0]!, stacks: 4 })[0]!.stacks).toBe(5);
    expect([onSheet(of(cold, 2)), onSheet(of(pain, 2)), onSheet(of(def(), 1))]).toEqual([true, false, true]);
  });

  test('a sheet keeps one instance per key by the body\'s rule: the same puts leave the same def, source and count on both', () => {
    const cold = stacking({ keep: 'sheet', cap: 5 }), plain = def();
    const cases: [StatusDef, number, number, StatusDef, number, number][] = [
      [cold, 2, 0, cold, 4, 0], [cold, 4, 1, cold, 3, 0], [plain, 1, 2, cold, 3, 1], [cold, 3, 2, plain, 1, 1], [plain, 1, 0, plain, 1, 3],
    ];
    for (const [d0, n0, t0, d1, n1, t1] of cases) {
      const old = of(d0, n0, { source: { id: null, tier: t0 } }), incoming = of(d1, n1, { source: { id: null, tier: t1 } });
      const body = applyStatus([old], incoming)[0]!;
      const sheet = addSheetStatus(sheetStatuses([old], tick(0), RULES), sheetStatuses([incoming], tick(0), RULES)[0]!)[0]!;
      expect([sheet.def, sheet.source, sheet.stacks]).toEqual([body.def, body.source, 'stacks' in body ? body.stacks : undefined]);
    }
  });

  test('a stack rule and a threshold read back through the parser as written; a cap past the rules is clamped, an unknown leave refused', () => {
    const burst: StackDef = {
      label: 'Resonance', desc: '', ops: [], stack: { cap: 3, leave: { kind: 'event', event: 'struck' }, keep: 'fight', threshold: {
        at: { kind: 'count', n: 3 }, to: { kind: 'area', radius: tiles(2), on: 'foes' }, then: 'spend',
        ops: [{ op: 'damage', type: 'arcane', amount: f('1d8 + mag'), when: 'use' }, { op: 'refund', pct: 50 }],
      } },
    };
    expect(parseStatusDef(JSON.parse(JSON.stringify(burst)), RULES)).toEqual(burst);
    expect((parseStatusDef({ ...burst, stack: { ...burst.stack, cap: 99, threshold: null } }, RULES) as StackDef).stack.cap).toBe(RULES.fight.kit.stackCap);
    expect(parseStatusDef({ ...burst, stack: { ...burst.stack, leave: { kind: 'sometimes' } } }, RULES)).toBeNull();
    const add = parseOp({ op: 'applyStatus', key: 'pain', def: burst, duration: null, stacks: 9 }, RULES);
    expect(add && add.op === 'applyStatus' ? add.stacks : null).toBe(RULES.fight.kit.stackAdd);
  });

  test('a stacking status says how it stacks, what each stack does and what its count sets off', () => {
    const marked = stacking({ leave: { kind: 'round' }, threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend', ops: [{ op: 'damage', type: 'arcane', amount: f('2d8'), when: 'use' }] } },
      { op: 'damage', type: 'arcane', amount: f('4'), when: 'turn' });
    expect(describeStatus(marked, 0, RULES)).toEqual([
      'Stacks to 5. 1 stack expires each round.', 'Each stack: 4 arcane damage a round', 'At 3 stacks: Deals 2d8 arcane damage. The stacks are spent.', 'Removed when the fight ends.',
    ]);
  });

  test('a trigger and a delayed end each say when they act, on whom and how often (kits design 5.1)', () => {
    const hemo: StatusDef = { label: 'Hemoplague', desc: '', ops: [], end: { ops: [{ op: 'damage', type: 'arcane', amount: f('1d8 + mag'), when: 'use' }], cleanse: 'cancel' },
      triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'note', text: 'Marked' }] },
        { on: 'turnStart', to: { kind: 'area', radius: tiles(2), on: 'foes' }, limit: { kind: 'fight', n: 2 }, ops: [{ op: 'refund', pct: 50 }] }] };
    expect(describeStatus(hemo, 0, RULES)).toEqual([
      'When its bearer deals a hit: Marked on the other, every time.', 'When its bearer starts its turn: 50% of an action\'s time back on foes within 2 tiles, 2 times a fight.',
      'When it ends: Deals 1d8 + mag arcane damage. Curing this status cancels it.',
    ]);
  });
});

describe('the stack machine, cell by cell (kits table 2.1)', () => {
  const ctx = (o: Partial<StackRule> = {}, at: number | null = null): StackCtx => ({ rule: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null, ...o }, at });
  const at3 = (then: 'spend' | 'keep') => ctx({ threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, ops: [], then } }, 3);
  const held = (n: number): Stack => ({ at: 'held', n });
  const ABSENT: Stack = { at: 'absent' };

  test('absent, apply k: held k, to the cap', () => {
    expect(stackStep(ABSENT, { type: 'apply', k: 2 }, ctx()).stack).toEqual(held(2));
    expect(stackStep(ABSENT, { type: 'apply', k: 9 }, ctx()).stack).toEqual(held(5));
  });

  test('a crossing fires the threshold once: spend takes its count off, keep leaves the count and fires again only after it falls below', () => {
    expect(stackStep(held(2), { type: 'apply', k: 2 }, at3('spend'))).toEqual({ stack: held(1), fired: true, gone: null });
    expect(stackStep(held(2), { type: 'apply', k: 1 }, at3('spend'))).toEqual({ stack: ABSENT, fired: true, gone: 'spent' });
    expect(stackStep(held(2), { type: 'apply', k: 1 }, at3('keep'))).toEqual({ stack: held(3), fired: true, gone: null });
    expect(stackStep(held(3), { type: 'apply', k: 1 }, at3('keep')).fired).toBe(false);
    expect(stackStep(held(1), { type: 'apply', k: 1 }, at3('spend')).fired).toBe(false);
  });

  test('a threshold not read here (the GM\'s window, a sheet) never fires', () => {
    expect(stackStep(held(2), { type: 'apply', k: 1 }, { ...at3('spend'), at: null })).toEqual({ stack: held(3), fired: false, gone: null });
  });

  test('a round leave takes one a round, its named event takes all, another event nothing', () => {
    expect(stackStep(held(3), { type: 'round', rounds: 2 }, ctx({ leave: { kind: 'round' } })).stack).toEqual(held(1));
    expect(stackStep(held(3), { type: 'round', rounds: 2 }, ctx()).stack).toEqual(held(3));
    expect(stackStep(held(3), { type: 'event', event: 'moved' }, ctx({ leave: { kind: 'event', event: 'moved' } }))).toEqual({ stack: ABSENT, fired: false, gone: 'spent' });
    expect(stackStep(held(3), { type: 'event', event: 'struck' }, ctx({ leave: { kind: 'event', event: 'moved' } })).stack).toEqual(held(3));
  });

  test('a price takes m and never fires; its time ending ends it; a cure takes n or all; the fight\'s end drops a fight\'s count and keeps a sheet\'s', () => {
    expect(stackStep(held(4), { type: 'price', m: 3 }, at3('spend'))).toEqual({ stack: held(1), fired: false, gone: null });
    expect(stackStep(held(4), { type: 'timeEnds' }, ctx())).toEqual({ stack: ABSENT, fired: false, gone: 'ended' });
    expect(stackStep(held(4), { type: 'cure', n: null }, ctx())).toEqual({ stack: ABSENT, fired: false, gone: 'cured' });
    expect(stackStep(held(4), { type: 'fightEnds' }, ctx())).toEqual({ stack: ABSENT, fired: false, gone: 'dropped' });
    expect(stackStep(held(4), { type: 'fightEnds' }, ctx({ keep: 'sheet' })).stack).toEqual(held(4));
  });

  test('nothing but an apply changes an absent count', () => {
    for (const e of STACK_WALK.filter(x => x.type !== 'apply')) expect([e.type, stackStep(ABSENT, e, ctx()).stack]).toEqual([e.type, ABSENT]);
  });
});

describe('wave 2\'s ops as data (kits design 8.1 to 8.6, table 8.1)', () => {
  const K = RULES.fight.kit;
  const OPS: Op[] = [
    { op: 'sheet', key: 'armor', amount: { kind: 'number', value: 20 } }, { op: 'sheet', key: 'exposed', amount: [0.5, 0.5, 1, 1, 1.5, 1.5] }, { op: 'share', on: 'taken', pct: 25 },
    { op: 'untargetable' }, { op: 'invulnerable' }, { op: 'safeguard' }, { op: 'hidden', level: 2, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } }, { op: 'alert' },
    { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true }, { op: 'boost', side: 'defend', die: { kind: 'die', sides: 6 } },
    { op: 'shove', dir: 'toward', from: 'user', tiles: 3 }, { op: 'move', key: 'harmful', take: 'all', from: 'target', as: null },
    { op: 'move', key: statusKey('energize'), take: 2, from: 'user', as: statusKey('momentum') },
    { op: 'hasten', share: 1 }, { op: 'extra' }, { op: 'guard', share: K.parry }, { op: 'negate' }, { op: 'dispel', which: 'first' }, { op: 'stayHidden', on: 'dealt' },
  ];

  test('each reads back through the parser as written, and every kind is one of them', () => {
    for (const o of OPS) expect(parseOp(JSON.parse(JSON.stringify(o)), RULES)).toEqual(o);
    const kinds = new Set(OPS.map(o => o.op));
    for (const k of ['sheet', 'share', 'untargetable', 'invulnerable', 'safeguard', 'edge', 'boost', 'hidden', 'alert', 'shove', 'move', 'hasten', 'extra', 'guard', 'negate', 'dispel', 'stayHidden']) expect(kinds.has(k as Op['op'])).toBe(true);
  });

  test('a number past its rule is held at it: armor at a suit of plate, a shove at half a walk, a held die at a d20, a share at 100%', () => {
    expect(parseOp({ op: 'sheet', key: 'armor', amount: -500 }, RULES)).toEqual({ op: 'sheet', key: 'armor', amount: { kind: 'number', value: -K.armorOp } });
    expect(parseOp({ op: 'sheet', key: 'critSize', amount: 3 }, RULES)).toEqual({ op: 'sheet', key: 'critSize', amount: { kind: 'number', value: K.critSizeMax - RULES.fight.critSizeBase } });
    expect(parseOp({ op: 'shove', dir: 'away', from: 'aim', tiles: 9 }, RULES)).toEqual({ op: 'shove', dir: 'away', from: 'aim', tiles: K.shoveMax });
    expect(parseOp({ op: 'boost', side: 'attack', die: { kind: 'die', sides: 100 } }, RULES)).toEqual({ op: 'boost', side: 'attack', die: { kind: 'die', sides: K.boostSides } });
    expect(parseOp({ op: 'share', on: 'dealt', pct: 400 }, RULES)).toEqual({ op: 'share', on: 'dealt', pct: 100 });
    expect(parseOp({ op: 'sheet', key: 'speed', amount: 3 }, RULES)).toBeNull();
    expect(parseOp({ op: 'edge', side: 'up', keep: 'better', tag: null, spend: true }, RULES)).toBeNull();
  });

  test('the four penetrations as sheet ops: the percent pair held at penMax, the flat pair at a suit of plate\'s 60', () => {
    expect(parseOp({ op: 'sheet', key: 'armorPen', amount: 90 }, RULES)).toEqual({ op: 'sheet', key: 'armorPen', amount: { kind: 'number', value: RULES.fight.penMax } });
    expect(parseOp({ op: 'sheet', key: 'resistPen', amount: [5, 10, 15, 20, 25, 30] }, RULES)).toEqual({ op: 'sheet', key: 'resistPen', amount: [{ kind: 'number', value: 5 }, { kind: 'number', value: 10 }, { kind: 'number', value: 15 }, { kind: 'number', value: 20 }, { kind: 'number', value: 25 }, { kind: 'number', value: 30 }] });
    expect(parseOp({ op: 'sheet', key: 'armorPenFlat', amount: -500 }, RULES)).toEqual({ op: 'sheet', key: 'armorPenFlat', amount: { kind: 'number', value: -K.armorOp } });
    expect(parseOp({ op: 'sheet', key: 'resistPenFlat', amount: 12 }, RULES)).toEqual({ op: 'sheet', key: 'resistPenFlat', amount: { kind: 'number', value: 12 } });
  });

  test('unknown sheet op key `pen` is refused', () => {
    expect(parseStatusDef({ label: 'Keen', desc: '', ops: [{ op: 'sheet', key: 'pen', amount: 0.1 }] }, RULES)).toBeNull();
    expect(parseOp({ op: 'sheet', key: 'pen', amount: 0.1 }, RULES)).toBeNull();
  });

  test('each says what it does', () => {
    const lines = OPS.map(o => describeStatus({ label: 'x', desc: '', ops: [o] }, 0, RULES)[0]);
    expect(lines.every(l => typeof l === 'string' && l.length > 0)).toBe(true);
    expect(lines[2]).toBe('Damage taken +25%');
    expect(lines[8]).toBe('On its next use against a foe, the target rolls twice and keeps the lower. Spent after one use');
    expect(lines[10]).toBe('Pulls each target 3 tiles toward you');
  });
});

describe('the hidden op\'s fields and the stayHidden op (stealth design section 2, with the owner\'s rulings)', () => {
  const ALL = { hurt: true, revealed: true, dealt: true } as const;
  const read = (v: unknown): Op | null => parseOp(v, RULES);
  const line = (o: Op): string => describeStatus({ label: 'x', desc: '', ops: [o] }, null, RULES)[0]!;

  test('a hidden op reads back its level, where it may start and what ends it, as written, its level by rank too', () => {
    const ops: Op[] = [
      { op: 'hidden', level: 3, start: 'anywhere', ends: { hurt: false, revealed: true, dealt: false } },
      { op: 'hidden', level: [1, 1, 2, 2, 3, 5], start: 'unseen', ends: ALL },
      { op: 'hidden', level: 5, start: 'unseen', ends: { hurt: false, revealed: false, dealt: false } },
    ];
    for (const o of ops) expect(read(JSON.parse(JSON.stringify(o)))).toEqual(o);
  });

  test('a hidden op with no field written is the kits\' Stealth: level 0 (stealth beats sight at the same level, the owner, Nov 22), it hides only out of sight, and a hurt, a reveal or damage it deals ends it', () => {
    expect(read({ op: 'hidden' })).toEqual({ op: 'hidden', level: 0, start: 'unseen', ends: ALL });
  });

  test('a level of 0 is kept, since a hide at 0 hides from a plain sight of 0; under 0 is 0, past 5 is 5, a fraction rounds down, and a level that is not one is 0', () => {
    const level = (v: unknown) => { const o = read({ op: 'hidden', level: v }); return o?.op === 'hidden' ? o.level : null; };
    expect([0, -3, 2.7, 5, 9, 'two', null].map(level)).toEqual([0, 0, 2, 5, 5, 0, 0]);
    expect(level([0, 1, 2, 3, 4, 9])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(level([1, 2, 3])).toBe(0);
  });

  test('a wrong start reads as out of sight, a wrong or missing end as true, and an end other than the three is dropped', () => {
    expect(read({ op: 'hidden', level: 2, start: 'nowhere', ends: { hurt: false, seen: false, dealt: 'no' } }))
      .toEqual({ op: 'hidden', level: 2, start: 'unseen', ends: { hurt: false, revealed: true, dealt: true } });
    expect(read({ op: 'hidden', level: 2, start: 'anywhere', ends: 'never' })).toEqual({ op: 'hidden', level: 2, start: 'anywhere', ends: ALL });
  });

  test('a stayHidden op reads back each of the three ends, and one that names none of them is refused', () => {
    for (const on of ['hurt', 'revealed', 'dealt'] as const) expect(read({ op: 'stayHidden', on })).toEqual({ op: 'stayHidden', on });
    expect([read({ op: 'stayHidden', on: 'seen' }), read({ op: 'stayHidden' })]).toEqual([null, null]);
  });

  test('a hide says its level, where it may start and what ends it; a stayHidden says which end it keeps off', () => {
    expect(line({ op: 'hidden', level: 1, start: 'unseen', ends: ALL }))
      .toBe('Hidden at stealth level 1. Only a foe with that sight level or higher can see it. Can only hide while out of foes\' sight. Ends when it is hurt, is revealed or deals damage');
    expect(line({ op: 'hidden', level: [1, 1, 2, 2, 3, 5], start: 'anywhere', ends: { hurt: false, revealed: false, dealt: true } }))
      .toBe('Hidden at stealth level 1 / 1 / 2 / 2 / 3 / 5, by rank E to S. Only a foe with that sight level or higher can see it. Can hide even in foes\' sight. Ends when it deals damage');
    expect(line({ op: 'hidden', level: 4, start: 'unseen', ends: { hurt: false, revealed: false, dealt: false } }))
      .toBe('Hidden at stealth level 4. Only a foe with that sight level or higher can see it. Can only hide while out of foes\' sight. Ends only when it expires or is cured');
    expect(line({ op: 'hidden', level: 2, start: 'unseen', ends: { hurt: true, revealed: false, dealt: true } })).toMatch(/Ends when it is hurt or deals damage$/);
    expect([line({ op: 'stayHidden', on: 'hurt' }), line({ op: 'stayHidden', on: 'revealed' }), line({ op: 'stayHidden', on: 'dealt' })])
      .toEqual(['Stays hidden when it is hurt', 'Stays hidden when it is revealed', 'Stays hidden when it deals damage']);
  });

  test('a reveal is a land op with no fields: a trigger, a threshold or a delayed end lands it, and it says what it ends', () => {
    expect(read({ op: 'reveal', level: 3 })).toEqual({ op: 'reveal' });
    const flare: StatusDef = { label: 'Flare', desc: '', ops: [], triggers: [{ on: 'turnStart', to: { kind: 'area', radius: tiles(3), on: 'foes' }, limit: { kind: 'each' }, ops: [{ op: 'reveal' }] }],
      end: { ops: [{ op: 'reveal' }], cleanse: 'cancel' } };
    expect(parseStatusDef(JSON.parse(JSON.stringify(flare)), RULES)).toEqual(flare);
    expect(line({ op: 'reveal' })).toBe('Reveals each target it hits, ending stealth that breaks on reveal');
  });

  test('a sight op says the stealth it sees through, with no plus: sight levels do not add (ruling 8)', () => {
    expect(line({ op: 'sheet', key: 'sight', amount: 2 })).toBe('Sees foes hidden at stealth level 2 or under');
    expect(line({ op: 'sheet', key: 'sight', amount: [0, 1, 1, 2, 3, 4] })).toBe('Sees foes hidden at stealth level 0 / 1 / 1 / 2 / 3 / 4 or under, by rank E to S');
    expect(line({ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 5 } })).toBe('Armor: +5');
  });
});

describe('wave 2\'s sheet and share ops (kits design 8.1)', () => {
  test('harmful is one rule: a slow, a lowered sheet number, raised exposure, raised damage taken or lowered healing; a haste or a ward is not', () => {
    const is = (...ops: Op[]) => harmful({ ops });
    expect([is({ op: 'speed', pct: -10 }), is({ op: 'sheet', key: 'armor', amount: { kind: 'number', value: -5 } }), is({ op: 'sheet', key: 'exposed', amount: 1 }),
      is({ op: 'share', on: 'taken', pct: 10 }), is({ op: 'share', on: 'healed', pct: -50 }), is({ op: 'share', on: 'dealt', pct: -10 })]).toEqual([true, true, true, true, true, true]);
    expect([is({ op: 'speed', pct: 10 }), is({ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 5 } }), is({ op: 'share', on: 'taken', pct: -10 }), is({ op: 'invulnerable' })]).toEqual([false, false, false, false]);
  });

  test('a zone that lowers armor is drawn as one that holds back', () => {
    expect(zoneTone([{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: -10 } }])).toBe('hinder');
    expect(zoneTone([{ op: 'share', on: 'dealt', pct: 20 }])).toBe('plain');
  });

  test('a zone holds back exactly when a safeguard would refuse its status as harmful: a field that taunts is drawn as one that holds back', () => {
    const ops: Op[][] = [[{ op: 'taunt' }], [{ op: 'root' }], [{ op: 'speed', pct: 10 }], [{ op: 'share', on: 'healed', pct: -50 }], [{ op: 'invulnerable' }]];
    expect(ops.map(o => zoneTone(o) === 'hinder')).toEqual(ops.map(o => harmful({ ops: o })));
  });

  test('a percent penetration op adds to the bearer\'s own and stops at penMax (60); a flat one adds, never under 0', () => {
    const plain = modified(hunterOf(), [], RULES).sheet;
    const on = (...ops: Op[]) => withSheetOps(plain, [status('x', def(...ops), null)], bareBody(hunterOf(), RULES), RULES);
    expect([on({ op: 'sheet', key: 'armorPen', amount: { kind: 'number', value: 20 } }).armorPen, on({ op: 'sheet', key: 'resistPen', amount: { kind: 'number', value: 20 } }).resistPen]).toEqual([plain.armorPen + 20, plain.resistPen + 20]);
    expect(on({ op: 'sheet', key: 'armorPen', amount: { kind: 'number', value: 60 } }, { op: 'sheet', key: 'armorPen', amount: { kind: 'number', value: 60 } }).armorPen).toBe(RULES.fight.penMax);
    expect([on({ op: 'sheet', key: 'armorPenFlat', amount: { kind: 'number', value: 8 } }).armorPenFlat, on({ op: 'sheet', key: 'resistPenFlat', amount: { kind: 'number', value: -8 } }).resistPenFlat]).toEqual([8, 0]);
    expect(on({ op: 'sheet', key: 'armorPen', amount: { kind: 'number', value: 20 } }).resistPen).toBe(plain.resistPen);
  });

  test('a status with no sheet op leaves the sheet derive made, to the last field', () => {
    const plain = modified(hunterOf(), [], RULES).sheet;
    expect(modified(hunterOf(), [status('x', def({ op: 'stat', key: 'str', amount: { kind: 'number', value: 0 } }), null)], RULES).sheet).toEqual(plain);
    expect(withSheetOps(plain, [status('x', def({ op: 'share', on: 'taken', pct: 10 }), null)], bareBody(hunterOf(), RULES), RULES)).toBe(plain);
  });

  test('sight ops do not add: the highest is the body\'s sight level, at most 5, and never under its own (ruling 8)', () => {
    const sight = (...amounts: number[]): number =>
      modified(hunterOf(), amounts.map((amount, i) => status(`eye${i}`, def({ op: 'sheet', key: 'sight', amount }), null)), RULES).sheet.sight;
    expect([sight(), sight(2), sight(2, 3), sight(3, 2), sight(4, 7), sight(-2)]).toEqual([0, 2, 3, 3, 5, 0]);
  });

  test('a sight op is read at its source\'s tier, and adds nothing to the sheet numbers that add', () => {
    const atA = status('eye', def({ op: 'sheet', key: 'sight', amount: [0, 1, 1, 2, 3, 4] }), null, { source: { id: null, tier: 4 } });
    const plain = modified(hunterOf(), [], RULES).sheet;
    expect(modified(hunterOf(), [atA], RULES).sheet).toEqual({ ...plain, sight: 3 });
    expect(Object.keys(sheetAdds([atA], bareBody(hunterOf(), RULES), RULES))).not.toContain('sight');
  });

  test('a per-round damage reads its bearer\'s damage taken share at the settle before rule 12: 10 a round on a body taking +50% is 15 raw', () => {
    const b = body(hunterOf(), { statuses: [status('brittle', def({ op: 'share', on: 'taken', pct: 50 }), null)] });
    const due = { key: statusKey('burn'), op: { op: 'damage', type: 'arcane', amount: f('10'), when: 'turn' } as const, tier: 0, before: 0, share: 1, stacks: 1 };
    expect(rowHp(b) - rowHp(payDue(b, due, [], tick(0), RULES, null))).toBe(afterDefence(15, 'arcane', NO_PEN, b.sheet, RULES));
  });

  test('a heal of the target\'s max HP reads "Heals fully" and fills any body; a heal that only reaches a big number is that number', () => {
    expect(opLines([{ op: 'heal', amount: FULL_HEAL, when: 'use' }, { op: 'heal', amount: f('99999'), when: 'use' }], 0, RULES)).toEqual(['Heals fully', 'Heal: 99999']);
    const b = body(hunterOf(), { hp: 1 }), rows = new Map([[b.id, b]]);
    landOps(rows, [{ op: 'heal', amount: FULL_HEAL, when: 'use' }], null, [b.id], { id: null, tier: 0 }, tick(0), RULES);
    expect(rowHp(rows.get(b.id)!)).toBe(b.sheet.hpMax);
  });

  test('a burn meets a shield as a hit does (rule 13): a live shield takes it first, one past its end takes nothing', () => {
    const due = { key: statusKey('burn'), op: { op: 'damage', type: 'arcane', amount: f('10'), when: 'turn' } as const, tier: 0, before: 0, share: 1, stacks: 1 };
    const shielded = body(hunterOf(), { shield: { amount: 4, until: tick(50) } });
    const dealt = afterDefence(10, 'arcane', NO_PEN, shielded.sheet, RULES);
    const live = payDue(shielded, due, [], tick(40), RULES, null), past = payDue(shielded, due, [], tick(60), RULES, null);
    expect([rowHp(shielded) - rowHp(live), live.shield]).toEqual([dealt - 4, null]);
    expect(rowHp(shielded) - rowHp(past)).toBe(dealt);
  });

  test('per-round status damage meets Armor for physical, Resist for arcane (with NO_PEN), and ignores both for true', () => {
    const tank = body({ kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: [{ weight: 0, armor: 74, resist: 60 }], perks: {} } });
    const highPen = { sheet: { ...tank.sheet, armorPen: 50, resistPen: 50, armorPenFlat: 30, resistPenFlat: 30 } };
    const tickOf = (type: 'physical' | 'arcane' | 'true', expr: string, before = 0, share = 1) =>
      ({ key: statusKey('dot'), op: { op: 'damage', type, amount: f(expr), when: 'turn' } as const, tier: 0, before, share, stacks: 1 });
    // 14 arcane vs resist 60 with NO_PEN = round((14 - 0.03*60) * 100 / 160) = round(7.625) = 8; applier pen is ignored
    expect(rowHp(tank) - rowHp(payDue(tank, tickOf('arcane', '14'), [], tick(0), RULES, highPen))).toBe(8);
    // 14 physical vs armor 74 with NO_PEN = round((14 - 0.03*74) * 100 / 174) = round(6.77) = 7
    expect(rowHp(tank) - rowHp(payDue(tank, tickOf('physical', '14'), [], tick(0), RULES, highPen))).toBe(7);
    // 14 true bypasses both armor and resist
    expect(rowHp(tank) - rowHp(payDue(tank, tickOf('true', '14'), [], tick(0), RULES, null))).toBe(14);
    // zero rate deals 0 HP, never clamped to 1
    expect(rowHp(tank) - rowHp(payDue(tank, tickOf('arcane', '0'), [], tick(0), RULES, null))).toBe(0);
    // prorating after afterDefence keeps 2 half-round settles equal to 1 full-round settle (4 + 4 = 8)
    const half1 = payDue(tank, tickOf('arcane', '14', 0, 0.5), [], tick(0), RULES, null);
    const half2 = payDue(half1, tickOf('arcane', '14', 0.5, 0.5), [], tick(500), RULES, null);
    expect(rowHp(tank) - rowHp(half1)).toBe(4);
    expect(rowHp(half1) - rowHp(half2)).toBe(4);
    expect(rowHp(tank) - rowHp(half2)).toBe(8);
  });
});

describe('a lasting change that grows with its bearer: `stat` and `sheet` take a formula (item-stats 6.2)', () => {
  const plainOf = (o: Origin) => modified(o, [], RULES);
  const raw = (v: unknown): Op => { const o = parseOp(v, RULES); if (!o) throw new Error(`refused: ${JSON.stringify(v)}`); return o; };
  const sheetOp = (key: string, text: string): unknown => ({ op: 'sheet', key, amount: f(text) });
  const flat = (value: number): Formula => ({ kind: 'number', value });

  test('armor of 0.1 * hpmax on a bearer of max HP 200 adds 20', () => {
    const plain = plainOf(hunterOf()), bare = { stats: plain.stats, sheet: { ...plain.sheet, hpMax: 200 } };
    expect(withSheetOps(plain.sheet, [status('ward', def(raw(sheetOp('armor', '0.1 * hpmax'))), null)], bare, RULES).armor).toBe(plain.sheet.armor + 20);
  });

  test('a stat op on Vitality beside it raises max HP but not what the armor reads, in either order', () => {
    const armor = status('ward', def(raw(sheetOp('armor', '0.1 * hpmax'))), null);
    const vit = status('hardy', def({ op: 'stat', key: 'vit', amount: flat(30) }), null);
    const plain = plainOf(hunterOf()).sheet, hardy = modified(hunterOf(), [vit], RULES).sheet, both = modified(hunterOf(), [armor, vit], RULES).sheet;
    expect(both.hpMax).toBeGreaterThan(plain.hpMax);
    expect(both.armor).toBeCloseTo(hardy.armor + 0.1 * plain.hpMax, 9);
    expect(modified(hunterOf(), [vit, armor], RULES).sheet).toEqual(both);
  });

  test('a stat op of 0.5 * vit reads the bearer\'s own Vitality before any status: one pass, no feedback', () => {
    const grow = status('grow', def({ op: 'stat', key: 'vit', amount: f('0.5 * vit') }), null);
    const lift = status('lift', def({ op: 'stat', key: 'vit', amount: flat(10) }), null);
    const vit = plainOf(hunterOf()).stats.vit;
    expect(modified(hunterOf(), [grow, lift], RULES).stats.vit).toBe(vit + 0.5 * vit + 10);
  });

  test('the rule\'s bound holds each op: armor of 1 * hpmax at max HP 200 adds kit.armorOp, and two stacks add it twice', () => {
    const plain = plainOf(hunterOf()), bare = { stats: plain.stats, sheet: { ...plain.sheet, hpMax: 200 } }, op = raw(sheetOp('armor', 'hpmax'));
    expect(withSheetOps(plain.sheet, [status('wall', def(op), null)], bare, RULES).armor).toBe(plain.sheet.armor + RULES.fight.kit.armorOp);
    const wall: StackDef = { label: 'Wall', desc: '', ops: [op], stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
    const two = statusOn(wall, { key: statusKey('wall'), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) }, 2);
    expect(withSheetOps(plain.sheet, [two], bare, RULES).armor).toBe(plain.sheet.armor + 2 * RULES.fight.kit.armorOp);
  });

  test('a number still reads as a flat amount, held at its bound as before', () => {
    expect(raw({ op: 'stat', key: 'str', amount: 4 })).toEqual({ op: 'stat', key: 'str', amount: flat(4) });
    expect(raw({ op: 'sheet', key: 'armor', amount: [1, 2, 3, 4, 5, 999] })).toEqual({ op: 'sheet', key: 'armor', amount: [1, 2, 3, 4, 5, RULES.fight.kit.armorOp].map(flat) });
    expect(raw({ op: 'sheet', key: 'armor', amount: f('2000') })).toEqual({ op: 'sheet', key: 'armor', amount: flat(RULES.fight.kit.armorOp) });
  });

  test('the parser refuses what a bare body lacks (the target, a charge, missing, the kits\' names) and a malformed formula', () => {
    for (const text of ['0.1 * target.hpmax', 'charge', '10 * missing', 'stacks(pain)', 'field(pain)', 'held(pain)', 'hits', 'kills + str', 'spent']) {
      expect(parseOp(sheetOp('armor', text), RULES), text).toBeNull();
      expect(parseOp({ op: 'stat', key: 'str', amount: f(text) }, RULES), text).toBeNull();
    }
    expect(parseOp({ op: 'sheet', key: 'armor', amount: { kind: 'binary', op: '*', left: flat(0.1) } }, RULES)).toBeNull();
    expect(parseOp({ op: 'stat', key: 'str', amount: 'str' }, RULES)).toBeNull();
  });

  test('exposed, range and sight hold a plain number: a formula there is refused', () => {
    for (const key of ['exposed', 'range', 'sight']) expect(parseOp(sheetOp(key, '0.1 * hpmax'), RULES), key).toBeNull();
    expect(raw({ op: 'sheet', key: 'exposed', amount: 1 })).toEqual({ op: 'sheet', key: 'exposed', amount: 1 });
  });

  test('a lowering formula is harmful, a raising one is not: -0.1 * armor and 0.1 * hpmax', () => {
    expect([harmful(def(raw(sheetOp('armor', '-0.1 * armor')))), harmful(def(raw(sheetOp('armor', '0.1 * hpmax'))))]).toEqual([true, false]);
    expect([harmful(def({ op: 'stat', key: 'str', amount: f('-0.2 * str') })), harmful(def({ op: 'stat', key: 'str', amount: f('0.2 * str') }))]).toEqual([true, false]);
  });

  test('its words name the share and, on a wearer, what it comes to now: "Armor: +10% of max HP (now 12)"', () => {
    const plain = plainOf(hunterOf()), wearer = { stats: plain.stats, sheet: { ...plain.sheet, hpMax: 120 } }, op = raw(sheetOp('armor', '0.1 * hpmax'));
    expect(opLines([op], 0, RULES, wearer)).toEqual(['Armor: +10% of max HP (now 12)']);
    expect(opLines([op, { op: 'stat', key: 'str', amount: f('-0.3 * vit') }], 0, RULES)).toEqual(['Armor: +10% of max HP', 'Strength: −0.3 × Vitality']);
  });
});

describe('a status\'s own life on its bearer (SMX-rules-2)', () => {
  const owedOn = (key: string, d: StatusDef): Status => status(key, d, 0, { owed: true });
  // Read in the order of tests/models/stack-events.ts STATUS_WALK: land (runs, past); time (ahead, ahead owing, past, past
  // owing); settle (ahead, past); taken.
  const EXPECTED: { readonly [S in StatusLife]: readonly StatusLife[] } = {
    gone: ['active', 'owed', 'gone', 'gone', 'gone', 'gone', 'gone', 'gone', 'gone'],
    active: ['active', 'active', 'active', 'active', 'gone', 'owed', 'active', 'gone', 'gone'],
    owed: ['active', 'owed', 'gone', 'owed', 'gone', 'owed', 'gone', 'gone', 'gone'],
  };

  test('every life against every event: only a land brings it on; time past its end keeps it owed only while its settle owes; a settle past its end or a taking ends it', () => {
    expect(STATUS_WALK.length).toBe(9);
    for (const life of STATUS_LIVES) expect(STATUS_WALK.map(e => statusStep(life, e)), life).toEqual([...EXPECTED[life]]);
  });

  test('an attack edge that names a kind reaches a use of that kind and no other', () => {
    const keen = def({ op: 'edge', side: 'attack', keep: 'better', tag: tag('strike'), spend: false });
    const user = withStatuses(body(), [status('k', keen, 100)], tick(0), RULES), target = body(hunterOf(), { id: combatantId('f'), side: 'foe' });
    expect(edgeOn(tagsOf({ kind: 'strike', channel: null, tags: [] }), user, target).cut).toBe('kl');
    expect(edgeOn(tagsOf({ kind: 'blast', channel: null, tags: [] }), user, target).cut).toBeNull();
  });
  test('an active status counts; an owed one counts for nothing on any reader, as if it were gone', () => {
    const ward = def({ op: 'invulnerable' }, { op: 'safeguard' }, { op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } }, { op: 'hold' }, { op: 'channel', mode: 'protect' }, { op: 'stat', key: 'str', amount: { kind: 'number', value: 10 } },
      { op: 'share', on: 'taken', pct: -50 }, { op: 'sheet', key: 'armor', amount: { kind: 'number', value: 20 } }, { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: false },
      { op: 'boost', side: 'defend', die: { kind: 'face', n: 3 } });
    expect([counts(status('w', ward, 100)), counts(owedOn('w', ward))]).toEqual([true, false]);
    const plain = body(), channel = { ability: abilityId('m'), aim: place(0, 0), charge: 2, spent: 0, state: 'holding' as const };
    const live = withStatuses({ ...body(), channel }, [status('w', ward, 100)], tick(0), RULES), gone = withStatuses({ ...body(), channel }, [owedOn('w', ward)], tick(0), RULES);
    const foe = body(hunterOf(), { id: combatantId('f'), side: 'foe' }), poison = def({ op: 'damage', type: 'arcane', amount: f('2') });
    const reads = (b: Body) => [holds(b, 'invulnerable'), holds(b, 'hidden'), wardedDamage(b, 999) < 999, held(b, tick(0)), channelBreaks(b, 0, true, tick(0)),
      b.stats.str, b.sheet.armor, damageShare(foe, b, RULES), sheetAdds(b.statuses, b, RULES).armor, edgeOn([], foe, b).cut, boostsOn(foe, b).length,
      admitted(b, poison, 'foe', 1000, 0, RULES).ok];
    expect(reads(live)).toEqual([true, true, true, true, false, plain.stats.str + 10, plain.sheet.armor + 20, 0.5, 20, 'kh', 1, false]);
    expect(reads(gone)).toEqual(reads({ ...plain, channel }));
  });

  test('a status put on whose end is already behind it lands owed: it counts for nothing and waits for time or its settle to take it', () => {
    const slow = def({ op: 'speed', pct: -50 });
    const list = applyStatus([], status('s', slow, 500, { since: tick(500), settledAt: tick(500) }));
    expect(list.map(s => s.owed)).toEqual([true]);
    expect(applyStatus(list, status('s', slow, 900, { since: tick(500), settledAt: tick(500) })).map(s => s.owed)).toEqual([undefined]);
  });

  describe('in a fight (SMX-rules-2.1: a status whose time ran out on another body\'s turn)', () => {
    const BIG: Ability = { ...abilityOf('strike', { id: abilityId('big'), name: 'big' }, RULES), range: tiles(20), shape: { kind: 'touch', reach: tiles(20) }, effect: { type: 'physical', by: 'hand', formula: f('999') } };
    const row = (name: string, side: 'party' | 'foe', statuses: Status[] = []): NewRow => {
      const kind = side === 'party' ? 'hunter' : 'monster', hp = modified(hunterOf(), [], RULES).sheet.hpMax;
      return { id: combatantId(name), name, side, ...lifeAt(kind, hp), origin: hunterOf(), tier: 0, place: null, mana: 10, fatigue: 0, shield: null, stagger: null, channel: null,
        threat: kind === 'monster' ? {} : null, statuses, readyAt: {}, abilities: [BIG], intent: null, holder: null, xp: 0, mythic: null } as NewRow;
    };
    const play = (...cmds: Command[]): Fight => cmds.reduce<Fight | null>((fight, cmd) => {
      const r = reduce(fight, cmd, { rules: RULES });
      const no = r.effects.find(e => e.type === 'refused');
      if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
      return r.fight;
    }, null)!;
    const A = combatantId('A'), M = combatantId('M');
    // A acts at 0 and next at 1000 (a standard action of a speed-100 body); M's opening d20 of 1 puts its first turn at 950.
    const opening: Command[] = [{ type: 'add', fightId: fightId('f-1'), rows: [], openings: [] }];
    const begin = (statuses: Status[]): Command[] => [
      { ...opening[0]!, rows: [row('A', 'party', statuses), row('M', 'foe')] } as Command,
      { type: 'start', openings: [{ id: A, d20: 20, tie: 0 }, { id: M, d20: 1, tie: 0 }] },
      { type: 'endTurn', by: A },
    ];
    const rowIn = (fight: Fight, id: CombatantId): Body => fight.rows.find(r => r.id === id)!;
    // ends at 500, and owes its heal of 1 a round to A's next settle (at 1000), so it stays on A's row past its end
    const ward = (...ops: Op[]): Status => status('ward', def(...ops, { op: 'heal', amount: f('1') }), 500);

    test('an invulnerable ward that ran out at 500 does not save its bearer from M\'s lethal hit at 950', () => {
      const f0 = play(...begin([ward({ op: 'invulnerable' })]));
      expect([f0.phase === 'running' && f0.currentId, f0.phase === 'running' && f0.now]).toEqual([M, 950]);
      expect(rowIn(f0, A).statuses.map(s => [s.key, s.owed])).toEqual([['ward', true]]);
      const hit = play(...begin([ward({ op: 'invulnerable' })]), { type: 'act', by: M, ability: BIG.id, aim: A, rolls: { dice: {}, react: { [A]: 10 } as Record<CombatantId, number> } });
      expect([rowHp(rowIn(hit, A)), rowIn(hit, A).life.at]).toEqual([0, 'dead']);
    });

    test('a Strength buff that ran out at 500 is off its bearer\'s sheet when time reaches 950, though its heal is still owed', () => {
      const f0 = play(...begin([ward({ op: 'stat', key: 'str', amount: { kind: 'number', value: 10 } })]));
      expect(rowIn(f0, A).stats.str).toBe(stats().str);
    });
  });
});

describe('a land op meets the rules a use meets (SMX-rules-2.3b)', () => {
  const from = (o: RowPatch<Body> = {}): Body => body(hunterOf(), { id: combatantId('foe'), side: 'foe', ...o });
  const landOn = (t: Body, ops: Op[], src: Body = from()) => {
    const rows = new Map([[t.id, t], [src.id, src]]);
    const r = landOps(rows, ops as never, src, [t.id], { id: src.id, tier: 0 }, tick(0), RULES);
    return { landed: r.landed[0]!, after: rows.get(t.id)! };
  };
  const bomb = (cleanse: 'cancel' | 'land'): StatusDef => ({ label: 'Bomb', desc: '', ops: [], end: { ops: [{ op: 'damage', type: 'arcane', amount: f('20') }], cleanse } });

  test('a status a safeguard refuses is not reported gained, and is not on the bearer', () => {
    const t = body(hunterOf(), { statuses: [status('guard', def({ op: 'safeguard' }), 1000)] });
    const r = landOn(t, [{ op: 'applyStatus', key: statusKey('poison'), def: def({ op: 'damage', type: 'arcane', amount: f('2') }), duration: tick(2000) }]);
    expect([r.landed.gained, r.after.statuses.map(s => s.key)]).toEqual([[], ['guard']]);
  });

  test('a channel break does not break a channel a status protects, and breaks one it does not', () => {
    const channel = { ability: abilityId('m'), aim: place(0, 0), charge: 2, spent: 0, state: 'holding' as const };
    const guarded = body(hunterOf(), { channel, statuses: [status('focus', def({ op: 'channel', mode: 'protect' }), 1000)] });
    expect(landOn(guarded, [{ op: 'channel', mode: 'break' }]).after.channel?.state).toBe('holding');
    expect(landOn(body(hunterOf(), { channel }), [{ op: 'channel', mode: 'break' }]).after.channel?.state).toBe('broken');
  });

  test('a dispel of a bomb that a cure sets off lands its end, as a cure of it does; one a cure cancels lands nothing', () => {
    const on = (d: StatusDef) => body(hunterOf(), { statuses: [status('bomb', { ...d, ops: [{ op: 'root' }] }, 3000)] });
    const dispel = landOn(on(bomb('land')), [{ op: 'dispel', which: 'all' }]), cure = landOn(on(bomb('land')), [{ op: 'cureStatus', key: statusKey('bomb') }]);
    expect(dispel.landed.dealt).toBeGreaterThan(0);
    expect([dispel.landed.dealt, rowHp(dispel.after), dispel.after.statuses]).toEqual([cure.landed.dealt, rowHp(cure.after), []]);
    expect(landOn(on(bomb('cancel')), [{ op: 'dispel', which: 'all' }]).landed.dealt).toBe(0);
  });

  test('a cure of a bomb the same ops put on a moment before sets it off: the cure reads the bearer as the ops left it', () => {
    const put: Op = { op: 'applyStatus', key: statusKey('bomb'), def: bomb('land'), duration: tick(3000) };
    const r = landOn(body(), [put, { op: 'cureStatus', key: statusKey('bomb') }], body(hunterOf(), { id: combatantId('ally'), side: 'party' }));
    expect([r.landed.dealt > 0, r.landed.gained, r.landed.cured]).toEqual([true, ['bomb'], ['bomb']]);
  });
});

describe('the stagger op (keystones design A.7)', () => {
  const K = RULES.fight.kit, F = RULES.fight;
  const BOSS: Origin = { kind: 'monster', name: 'Boss', rank: 'C', archetype: 'brute', monsterKind: 'boss', tweak: NO_TWEAK };
  // an 88-point bar: four same-rank hits of 22
  const bar = (fill: number) => ({ fill, max: 88, hit: 22 });
  const boss = (fill = 0, statuses: Status[] = []): Body => body(BOSS, { id: combatantId('boss'), side: 'foe', kind: 'monster', place: place(3, 0), stagger: bar(fill), threat: {}, statuses, at: tick(1000) });
  const user = body(hunterOf(), { id: combatantId('u') });
  const landOn = (t: Body, share: number): Body => {
    const rows = new Map([[t.id, t], [user.id, user]]);
    landOps(rows, [{ op: 'stagger', share }], user, [t.id], { id: user.id, tier: 0 }, tick(0), RULES);
    return rows.get(t.id)!;
  };

  test('the stagger op fills half a bar and no more', () => {
    // the rule's words: half a bar, so no one op breaks a bar alone
    expect(K.staggerOpMax).toBe(0.5);
    expect(parseOp({ op: 'stagger', share: 0.8 }, RULES)).toEqual({ op: 'stagger', share: 0.5 });
    expect(landOn(boss(), 0.5).stagger).toEqual(bar(44));
    // a boss whose bar fills twice as fast still takes half a bar from one op
    expect(landOn(boss(0, [status('cracked', def({ op: 'staggerRate', pct: 100 }), null)]), 0.5).stagger).toEqual(bar(44));
    expect(landOn(boss(), 0.25).stagger).toEqual(bar(22));
  });

  test('a stagger op on a bar half full breaks it as a hit would: the boss loses 1.5 rounds, the bar empties and grows 75%', () => {
    const broken = landOn(boss(44), 0.5);
    expect([F.staggerCost, F.staggerRegrow]).toEqual([1.5, 0.75]);
    expect([broken.at, broken.stagger]).toEqual([1500, { fill: 0, max: 154, hit: 22, until: 1500 }]);
  });

  test('a body with no bar ignores it', () => {
    const hunter = body(hunterOf(), { id: combatantId('h'), side: 'foe' });
    expect(landOn(hunter, 0.5)).toEqual(hunter);
  });

  test('an ability that staggers fills the bar of the boss it lands on, and its outcome says how much', () => {
    const quake: Ability = { ...abilityOf('support', { id: abilityId('quake'), name: 'Quake' }, RULES), effect: null, aim: 'foe', range: tiles(20), shape: { kind: 'touch', reach: tiles(20) }, ops: [{ op: 'stagger', share: 0.25 }] };
    const r = resolve(quake, user, [user, boss()], combatantId('boss'), openGrid(20, 14), { dice: {}, react: {} }, tick(0), RULES);
    if (!r.ok) throw new Error(r.reason);
    expect([r.outcomes.map(o => [o.target, o.stagger]), r.bodies.find(b => b.id === 'boss')!.stagger]).toEqual([[['boss', 22]], bar(22)]);
  });

  test('the parser refuses a stagger that fills nothing, an echo with no whole radius, and an echo among an ability\'s own ops', () => {
    for (const bad of [{ op: 'stagger' }, { op: 'stagger', share: 0 }, { op: 'stagger', share: -0.25 }, { op: 'stagger', share: '0.25' },
      { op: 'echo' }, { op: 'echo', radius: 0 }, { op: 'echo', radius: 1.5 }]) expect(parseOp(bad, RULES)).toBeNull();
    expect(parseOp({ op: 'echo', radius: 99 }, RULES)).toEqual({ op: 'echo', radius: F.fieldRadiusMax });
    const quake = { ...abilityOf('support', { id: abilityId('quake'), name: 'Quake' }, RULES), effect: null, ops: [{ op: 'stagger', share: 0.25 }] };
    expect(parseAbility(JSON.parse(JSON.stringify(quake)), RULES)?.ops).toEqual([{ op: 'stagger', share: 0.25 }]);
    expect(parseAbility(JSON.parse(JSON.stringify({ ...quake, ops: [{ op: 'echo', radius: 2 }] })), RULES)).toBeNull();
  });

  test('each says what it does', () => {
    expect(describeStatus(def({ op: 'stagger', share: 0.25 }, { op: 'echo', radius: 2 }), 0, RULES)).toEqual([
      'Fills 25% of an elite or boss target\'s stagger bar',
      'Copies the gained status to the nearest other combatant on that side within 2 tiles who does not have it, for the same duration. Copied statuses do not copy again',
    ]);
  });

  test('echo is offered only in a trigger on a status gained or imposed', () => {
    const kinds = ['damage', 'echo', 'heal'] as const;
    expect(opsOffered(kinds, 'statusGained')).toEqual(['damage', 'echo', 'heal']);
    expect(opsOffered(kinds, 'imposed')).toEqual(['damage', 'echo', 'heal']);
    for (const event of [null, 'hitDealt', 'struck', 'turnStart', 'statusEnded', 'used']) expect(opsOffered(kinds, event)).toEqual(['damage', 'heal']);
    expect(opsOffered(OP_KINDS, null)).toEqual(OP_KINDS.filter(k => k !== 'echo'));
  });
});

describe('offensive dispel of helpful statuses (Wave 3 Hook 2)', () => {
  const num = (value: number): Formula => ({ kind: 'number', value });

  test('isMythicStatusKey matches only mythic- prefixed status keys', () => {
    expect([
      isMythicStatusKey(statusKey('mythic-shell')),
      isMythicStatusKey(statusKey('mythic-crescendo')),
      isMythicStatusKey(statusKey('hasted')),
      isMythicStatusKey(statusKey('not-mythic-shell')),
    ]).toEqual([true, true, false, false]);
  });

  test('helpful(def) is mutually exclusive with harmful(def) and excludes neutral marks and delayed-end statuses', () => {
    const yes: Op[] = [
      { op: 'heal', amount: num(5) },
      { op: 'mana', amount: num(5) },
      { op: 'fatigue', amount: num(-10) },
      { op: 'speed', pct: 20 },
      { op: 'stat', key: 'str', amount: num(4) },
      { op: 'sheet', key: 'armor', amount: f('0.1 * hpmax') },
      { op: 'sheet', key: 'exposed', amount: -1 },
      { op: 'sheet', key: 'range', amount: 2 },
      { op: 'sheet', key: 'sight', amount: 1 },
      { op: 'share', on: 'taken', pct: -15 },
      { op: 'share', on: 'dealt', pct: 15 },
      { op: 'share', on: 'healed', pct: 20 },
      { op: 'share', on: 'shielded', pct: 20 },
      { op: 'untargetable' },
      { op: 'invulnerable' },
      { op: 'safeguard' },
      { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true },
      { op: 'boost', side: 'defend', die: { kind: 'die', sides: 6 } },
      { op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } },
      { op: 'stayHidden', on: 'dealt' },
      { op: 'alert' },
      { op: 'channel', mode: 'protect' },
      { op: 'staggerRate', pct: -50 },
      { op: 'refund', pct: 25, chance: 50 },
    ];
    for (const op of yes) {
      expect([op.op, harmful(def(op)), helpful(def(op))]).toEqual([op.op, false, true]);
    }

    // Neutral statuses (empty ops, shield-only since statusShield already paid on landing, note + delayed end like Void Brand, 0 values, disadvantage edge, fatigue gain, staggerRate gain)
    const voidBrand: StatusDef = {
      label: 'Void Brand', desc: '', ops: [{ op: 'note', text: 'Marked by the void.' }],
      end: { ops: [{ op: 'damage', type: 'arcane', amount: f('2d6') }], cleanse: 'land' },
    };
    const neutralDefs: StatusDef[] = [
      def(),
      def({ op: 'shield', amount: num(15) }),
      voidBrand,
      def({ op: 'speed', pct: 0 }),
      def({ op: 'fatigue', amount: num(10) }),
      def({ op: 'edge', side: 'attack', keep: 'worse', tag: null, spend: true }),
      def({ op: 'channel', mode: 'break' }),
      def({ op: 'staggerRate', pct: 50 }),
    ];
    for (const d of neutralDefs) {
      expect([harmful(d), helpful(d)]).toEqual([false, false]);
    }

    // Mixed harmful + helpful status is harmful, never helpful
    const mixed = def({ op: 'share', on: 'dealt', pct: 20 }, { op: 'sheet', key: 'armor', amount: num(-10) });
    expect([harmful(mixed), helpful(mixed)]).toEqual([true, false]);

    // Every built-in status classifies cleanly with zero overlap
    const helpfulBuiltIns = Object.entries(BUILT_IN_STATUSES).filter(([, d]) => helpful(d)).map(([k]) => k).sort();
    expect(helpfulBuiltIns).toEqual(['hasted', 'invisible', 'regenerating', 'stealth']);
    for (const [k, d] of Object.entries(BUILT_IN_STATUSES)) {
      expect([k, harmful(d) && helpful(d)]).toEqual([k, false]);
    }
  });

  test('dispelled with kind helpful strips non-worn, non-zone helpful statuses and exempts mythic- keys only when mythic is true', () => {
    const voidBrandDef: StatusDef = {
      label: 'Void Brand', desc: '', ops: [{ op: 'note', text: 'Delayed mark' }],
      end: { ops: [{ op: 'damage', type: 'arcane', amount: f('10') }], cleanse: 'land' },
    };
    const list: Status[] = [
      status('worn-buff', def({ op: 'share', on: 'dealt', pct: 15 }), null, { worn: true }),
      status('mythic-crescendo', def({ op: 'share', on: 'dealt', pct: 50 }), null),
      status('zone-haste', def({ op: 'speed', pct: 20 }), null, { zone: zoneId('z1') }),
      status('void-brand', voidBrandDef, 2000),
      status('slowed', def({ op: 'speed', pct: -20 }), 2000),
      status('regenerating', BUILT_IN_STATUSES.regenerating, null), // non-worn monster start status
      status('hasted', BUILT_IN_STATUSES.hasted, 3000),
    ];

    // Scripted mythic bearer (mythic = true): mythic-crescendo is exempt
    expect(dispelled(list, 'first', 'helpful', true).map(s => s.key)).toEqual([
      'worn-buff', 'mythic-crescendo', 'zone-haste', 'void-brand', 'slowed', 'hasted',
    ]);
    expect(dispelled(list, 'all', 'helpful', true).map(s => s.key)).toEqual([
      'worn-buff', 'mythic-crescendo', 'zone-haste', 'void-brand', 'slowed',
    ]);
    // Non-mythic bearer (default mythic = false): a GM-made mythic- prefixed buff is dispellable
    expect(dispelled(list, 'first', 'helpful').map(s => s.key)).toEqual([
      'worn-buff', 'zone-haste', 'void-brand', 'slowed', 'regenerating', 'hasted',
    ]);
    expect(dispelled(list, 'all', 'helpful').map(s => s.key)).toEqual([
      'worn-buff', 'zone-haste', 'void-brand', 'slowed',
    ]);
    // Harmful dispel leaves helpful and neutral statuses intact
    expect(dispelled(list, 'all', 'harmful').map(s => s.key)).toEqual([
      'worn-buff', 'mythic-crescendo', 'zone-haste', 'void-brand', 'regenerating', 'hasted',
    ]);
    expect(dispelled(list, 'all').map(s => s.key)).toEqual([
      'worn-buff', 'mythic-crescendo', 'zone-haste', 'void-brand', 'regenerating', 'hasted',
    ]);
  });

  test('parseOp omits kind for harmful dispel so shipped defs still match isShippedDef, preserves kind helpful, and refuses invalid kind', () => {
    const a = parseOp({ op: 'dispel', which: 'first' }, RULES);
    const b = parseOp({ op: 'dispel', which: 'all', kind: 'harmful' }, RULES);
    const c = parseOp({ op: 'dispel', which: 'first', kind: 'helpful' }, RULES);
    const d = parseOp({ op: 'dispel', which: 'all', kind: 'helpful' }, RULES);
    expect(a).toEqual({ op: 'dispel', which: 'first' });
    expect('kind' in a!).toBe(false);
    expect(b).toEqual({ op: 'dispel', which: 'all' });
    expect('kind' in b!).toBe(false);
    expect(c).toEqual({ op: 'dispel', which: 'first', kind: 'helpful' });
    expect(d).toEqual({ op: 'dispel', which: 'all', kind: 'helpful' });
    expect(parseOp({ op: 'dispel', which: 'first', kind: 'neutral' }, RULES)).toBeNull();
    expect(parseOp({ op: 'dispel', which: 'first', kind: 42 }, RULES)).toBeNull();

    // Shipped keystone with dispel round-tripped through parseStatusDef must still omit itself from fightWire defs
    const ks = keystoneOf({ tier: 'apex', stat: 'dis' }, RULES);
    expect(ks.worn).toBeDefined();
    const key = freeStatusKey(ks.worn!.label, () => false);
    const parsed = parseStatusDef(JSON.parse(JSON.stringify(ks.worn!)), RULES)!;
    const h1 = body(hunterOf(), { id: combatantId('h1'), statuses: [status(key, parsed, null, { worn: true })] });
    const f0 = reduce(null, { type: 'add', fightId: fightId('f-shipped'), rows: [h1 as unknown as NewRow], openings: [] }, { rules: RULES }).fight!;
    const doc = fightDoc(f0, RULES, { by: 'gm' as never, at: 'now', was: null, keyOf: () => null })!;
    const wire = fightWire(doc);
    expect(wire.defs).toBeUndefined();
  });

  test('opLine describes harmful and helpful dispels distinctly', () => {
    expect(opLines([
      { op: 'dispel', which: 'first' },
      { op: 'dispel', which: 'all' },
      { op: 'dispel', which: 'first', kind: 'harmful' },
      { op: 'dispel', which: 'first', kind: 'helpful' },
      { op: 'dispel', which: 'all', kind: 'helpful' },
    ], 0, RULES)).toEqual([
      'Cures the first harmful status',
      'Cures every harmful status',
      'Cures the first harmful status',
      'Removes the first helpful status',
      'Removes every helpful status',
    ]);
  });

  test('landOps with kind helpful strips helpful buffs, triggers a helpful end on cleanse land, and never touches neutral Void Brand', () => {
    const voidBrand: StatusDef = {
      label: 'Void Brand', desc: '', ops: [{ op: 'note', text: 'Void Brand' }],
      end: { ops: [{ op: 'damage', type: 'arcane', amount: f('20') }], cleanse: 'land' },
    };
    const volatileWard: StatusDef = {
      label: 'Volatile Ward', desc: '', ops: [{ op: 'speed', pct: 20 }],
      end: { ops: [{ op: 'damage', type: 'arcane', amount: f('12') }], cleanse: 'land' },
    };
    const t = body(hunterOf(), {
      id: combatantId('foe'), side: 'foe',
      statuses: [
        status('void-brand', voidBrand, 3000),
        status('volatile-ward', volatileWard, 3000),
        status('hasted', BUILT_IN_STATUSES.hasted, 3000),
      ],
    });
    const src = body(hunterOf(), { id: combatantId('u'), side: 'party' });
    const rows = new Map([[t.id, t], [src.id, src]]);
    const r = landOps(rows, [{ op: 'dispel', which: 'first', kind: 'helpful' }], src, [t.id], { id: src.id, tier: 0 }, tick(0), RULES);
    expect(r.landed[0]!.dealt).toBeGreaterThan(0);
    expect(rows.get(t.id)!.statuses.map(s => s.key)).toEqual(['void-brand', 'hasted']);
  });
});

describe('Hook H1: blocked/lost formula counts and stacksBy land op', () => {
  test('blocked and lost parse as count formulas, default to 0 in NO_KIT, refuse target. prefix, and fail bareRefusal', () => {
    expect([f('blocked'), f('lost')]).toEqual([
      { kind: 'count', name: 'blocked' },
      { kind: 'count', name: 'lost' },
    ]);
    expect([printFormula(f('blocked')), printFormula(f('lost'))]).toEqual(['blocked', 'lost']);
    expect([NO_KIT.blocked, NO_KIT.lost]).toEqual([0, 0]);
    const b = bareBody(hunterOf(), RULES);
    expect(evaluate(f('blocked + lost'), { user: b, target: b, charge: 0, dice: [] })).toBe(0);
    expect(evaluate(f('0.25 * blocked + 0.5 * lost'), { user: b, target: b, charge: 0, dice: [], kit: { ...NO_KIT, blocked: 20, lost: 10 } })).toBe(10);
    expect(parseFormula('target.blocked', RULES).ok).toBe(false);
    expect(parseFormula('target.lost', RULES).ok).toBe(false);
    expect(bareRefusal(f('blocked'))).toContain('blocked');
    expect(bareRefusal(f('lost'))).toContain('lost');
  });

  test('parseLandOp and parseStatusDef preserve stacksBy, refuse invalid stacksBy, and omit stacksBy when absent so shipped defs stay byte-identical', () => {
    const wrath: StackDef = { label: 'Wrath', desc: '', ops: [], stack: { cap: 20, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
    const plainApply = { op: 'applyStatus', key: statusKey('wrath'), def: wrath, duration: null };
    const parsedPlain = parseLandOp(plainApply, RULES);
    expect(parsedPlain).toEqual(plainApply);
    expect('stacksBy' in parsedPlain!).toBe(false);

    const dynApply = { ...plainApply, stacksBy: f('(blocked + 0.5 * lost) / (0.025 * hpmax)') };
    const parsedDyn = parseLandOp(JSON.parse(JSON.stringify(dynApply)), RULES);
    expect(parsedDyn).toEqual(dynApply);

    expect(parseLandOp({ ...plainApply, stacksBy: { kind: 'bogus' } }, RULES)).toBeNull();

    // Shipped keystone with applyStatus triggers round-tripped through parseStatusDef stays byte-identical (wire.defs omitted)
    const ks = keystoneOf({ tier: 'confluence', pair: 'vit+dis' }, RULES);
    expect(ks.worn).toBeDefined();
    const key = freeStatusKey(ks.worn!.label, () => false);
    const roundTripped = parseStatusDef(JSON.parse(JSON.stringify(ks.worn!)), RULES)!;
    expect(roundTripped).toEqual(ks.worn!);
    const h1 = body(hunterOf(), { id: combatantId('h1'), statuses: [status(key, roundTripped, null, { worn: true })] });
    const f0 = reduce(null, { type: 'add', fightId: fightId('f-h1-shipped'), rows: [h1 as unknown as NewRow], openings: [] }, { rules: RULES }).fight!;
    const doc = fightDoc(f0, RULES, { by: 'gm' as never, at: 'now', was: null, keyOf: () => null })!;
    expect(fightWire(doc).defs).toBeUndefined();
  });

  test('landOps stacksBy floors average, clamps to 0..kit.stackAdd, skips at 0, and crosses thresholds on >= 1', () => {
    const mark: StackDef = {
      label: 'Mark', desc: '', ops: [],
      stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, ops: [{ op: 'note', text: 'boom' }], then: 'spend' } },
    };
    const op = { op: 'applyStatus', key: statusKey('mark'), def: mark, duration: null, stacksBy: f('blocked / 10') } as const;
    const t0 = body(hunterOf(), { id: combatantId('t') });

    // blocked = 9 -> floor(0.9) = 0 -> applies nothing, no gained, no fired
    const rows0 = new Map([[t0.id, t0]]);
    const r0 = landOps(rows0, [op], t0, [t0.id], { id: t0.id, tier: 0 }, tick(0), RULES, { cross: true, hit: { blocked: 9, lost: 0 } });
    expect(rows0.get(t0.id)!.statuses).toEqual([]);
    expect([r0.landed[0]!.gained, r0.fired]).toEqual([[], []]);

    // blocked = 25 -> floor(2.5) = 2 -> applies 2 stacks, below threshold 3
    const rows2 = new Map([[t0.id, t0]]);
    const r2 = landOps(rows2, [op], t0, [t0.id], { id: t0.id, tier: 0 }, tick(0), RULES, { cross: true, hit: { blocked: 25, lost: 0 } });
    expect(rows2.get(t0.id)!.statuses[0]?.stacks).toBe(2);
    expect([r2.landed[0]!.gained, r2.fired]).toEqual([[statusKey('mark')], []]);

    // blocked = 999 -> clamped to stackAdd (3) -> crosses threshold 3 and spends
    const rows3 = new Map([[t0.id, t0]]);
    const r3 = landOps(rows3, [op], t0, [t0.id], { id: t0.id, tier: 0 }, tick(0), RULES, { cross: true, hit: { blocked: 999, lost: 0 } });
    expect(rows3.get(t0.id)!.statuses).toEqual([]);
    expect([r3.landed[0]!.gained, r3.fired.length]).toEqual([[statusKey('mark')], 1]);
  });

  test('landOps damage with raw <= 0 deals 0 instead of rule 12\'s 1-damage floor, while positive raw still floors at 1', () => {
    const src = body(hunterOf(), { id: combatantId('u'), side: 'party' });
    const t0 = body(hunterOf(), { id: combatantId('foe'), side: 'foe' });
    const hp0 = rowHp(t0);

    for (const [amount, hit] of [
      [f('0'), undefined],
      [f('-10'), undefined],
      [f('0.25 * blocked'), { blocked: 0, lost: 30 }],
    ] as const) {
      const rows = new Map([[t0.id, t0], [src.id, src]]);
      const r = landOps(rows, [{ op: 'damage', type: 'physical', amount, when: 'use' }], src, [t0.id], { id: src.id, tier: 0 }, tick(0), RULES, hit ? { hit } : {});
      expect(r.landed[0]!.dealt).toBe(0);
      expect(rowHp(rows.get(t0.id)!)).toBe(hp0);
    }

    const posRows = new Map([[t0.id, t0], [src.id, src]]);
    const rPos = landOps(posRows, [{ op: 'damage', type: 'physical', amount: f('0.01'), when: 'use' }], src, [t0.id], { id: src.id, tier: 0 }, tick(0), RULES);
    expect(rPos.landed[0]!.dealt).toBe(1);
    expect(rowHp(posRows.get(t0.id)!)).toBe(hp0 - 1);
  });

  test('worth weighs a stacksBy applyStatus at kit.stackAdd and flags count in unweighed; someFormula and landLine work as exported', () => {
    const burn: StackDef = {
      label: 'Burn', desc: '', ops: [{ op: 'damage', type: 'arcane', amount: f('4'), when: 'turn' }],
      stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null },
    };
    const dynDef: StatusDef = {
      label: 'Dyn', desc: '', ops: [],
      triggers: [{ on: 'struck', tag: null, to: 'other', limit: { kind: 'round' }, ops: [{ op: 'applyStatus', key: statusKey('burn'), def: burn, duration: tick(2 * RULES.fight.round), stacksBy: f('blocked / 10') }] }],
    };
    const capDef: StatusDef = {
      label: 'Cap', desc: '', ops: [],
      triggers: [{ on: 'struck', tag: null, to: 'other', limit: { kind: 'round' }, ops: [{ op: 'applyStatus', key: statusKey('burn'), def: burn, duration: tick(2 * RULES.fight.round), stacks: RULES.fight.kit.stackAdd }] }],
    };
    const wDyn = wornWorth(dynDef, RULES), wCap = wornWorth(capDef, RULES);
    expect(wDyn.worth).toBeCloseTo(wCap.worth, 9);
    expect(wDyn.unweighed).toContain('count');
    expect(wCap.unweighed).not.toContain('count');
    expect(someFormula(f('(blocked + 0.5 * lost) / (0.025 * hpmax)'), x => x.kind === 'count' && x.name === 'blocked')).toBe(true);
    expect(someFormula(f('1d8 + phys'), x => x.kind === 'count')).toBe(false);
    expect(landLine({ op: 'refund', pct: 25 }, null, RULES)).toBe("25% of an action's time back");
    expect(landLine({ op: 'reform', hpShare: 0.5, mana: 15 }, null, RULES)).toBe('Reforms a fallen minion at 50% HP for 15 mana');
  });
});
