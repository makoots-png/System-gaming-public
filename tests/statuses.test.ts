// Every built-in status must pass these. A new status in src/core/registry/statuses.ts is checked here with no new test.
// The expected numbers are the old statuses restated by docs/agent-handoff/rw/m2-plan.md section 3.1.
import { describe as group, expect, test } from 'bun:test';
import { RANKS, RULES, rulesOf } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import type { StatKey } from '../src/core/stats.ts';
import type { Formula } from '../src/core/formula.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { describeStatus, isControl, modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Op, Origin, Status, StatusDef, Tiered } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseOp, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import { harmful, healShare, hideOf } from '../src/core/combat/standing.ts';
import { BUILT_IN_STATUSES, STATE_CHIP_DEFS, STATUS_KEYS } from '../src/core/registry/statuses.ts';
import type { BuiltInStatus } from '../src/core/registry/statuses.ts';
import { STATE_CHIPS, chipDef } from '../src/core/hunter/chips.ts';

const TIERS = RANKS.map((_, t) => t);
/** The mean of a dice term, `NdM` averages N × (M + 1) / 2, or a number. Every built-in per-round amount is one of the two. */
const meanOf = (f: Formula): number => { if (f.kind === 'number') return f.value; if (f.kind !== 'dice') throw new Error(`not dice: ${f.kind}`); return f.count * (f.sides + 1) / 2; };
const at = <T>(v: Tiered<T>, t: number): T => (Array.isArray(v) ? (v as readonly T[])[t]! : v as T);
const sizes = (o: Op): number[] | null => {
  switch (o.op) {
    case 'damage': case 'heal': case 'mana': case 'fatigue': return Array.isArray(o.amount) ? TIERS.map(t => meanOf(at(o.amount, t))) : null;
    case 'speed': return Array.isArray(o.pct) ? TIERS.map(t => Math.abs(at(o.pct, t))) : null;
    case 'stat': return Array.isArray(o.amount) ? TIERS.map(t => Math.abs(meanOf(at(o.amount, t)))) : null;
    case 'hidden': return Array.isArray(o.level) ? TIERS.map(t => at(o.level, t)) : null;
    default: return null;
  }
};
const nonDecreasing = (xs: number[]): boolean => xs.every((x, i) => i === 0 || x >= xs[i - 1]!);
/** The average damage a status deals a round when its source is at `tier`. */
const roundDamage = (key: BuiltInStatus, tier: number): number =>
  BUILT_IN_STATUSES[key].ops.reduce((n, o) => n + (o.op === 'damage' ? meanOf(at(o.amount, tier)) : 0), 0);
/** A level 1 hunter at the base of every stat with no gear: speed 100, so a percent is read off it as it is. */
const HUNTER: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: [], perks: {} } };
const on = (key: BuiltInStatus, tier: number): Status =>
  statusOn(BUILT_IN_STATUSES[key], { key: statusKey(key), source: { id: null, tier }, until: null, since: tick(0), settledAt: tick(0) });
const under = (key: BuiltInStatus, tier: number) => modified(HUNTER, [on(key, tier)], RULES);

for (const key of STATUS_KEYS) {
  const def = BUILT_IN_STATUSES[key];
  group(`the built-in status ${key}`, () => {
    test('has a name and a description a player can read', () => {
      expect(def.label.trim()).not.toBe('');
      expect(def.desc.trim()).not.toBe('');
    });

    test('a save, a pack or a room message reads it back as it is', () => {
      expect(parseStatusDef(JSON.parse(JSON.stringify(def)), RULES)).toEqual(def);
    });

    test('its status card has a line for each op, at every rank and for all ranks at once', () => {
      for (const t of [...TIERS, null]) expect(describeStatus(def, t, RULES)).toHaveLength(def.ops.length);
    });

    test('the rules serve it under its key', () => {
      expect(rulesOf({}, {}).conditions[key]).toEqual(def);
    });

    test('each number that grows with the source has one value per rank, and grows or stays as the rank rises', () => {
      for (const o of def.ops) {
        const xs = sizes(o);
        if (xs) expect({ op: o.op, rising: nonDecreasing(xs) }).toEqual({ op: o.op, rising: true });
      }
    });
  });
}

group('the old statuses restated (plan 3.1)', () => {
  test('a d20 modifier of the source\'s rank bonus N is 4N points off the stat the roll now reads', () => {
    // Attacks read Accuracy (Control), checks and fear read Will (Discipline); Prone slows the dodge (Agility). Blinded
    // was twice the rank bonus.
    const RESTATED: readonly { key: BuiltInStatus; stat: StatKey; times: number }[] = [
      { key: 'poisoned', stat: 'ctl', times: 1 }, { key: 'restrained', stat: 'ctl', times: 1 }, { key: 'blinded', stat: 'ctl', times: 2 },
      { key: 'frightened', stat: 'dis', times: 1 }, { key: 'bloodlust', stat: 'dis', times: 1 }, { key: 'prone', stat: 'agi', times: 1 },
    ];
    for (const { key, stat, times } of RESTATED) {
      const lowered = TIERS.map(t => RULES.fight.statBase - under(key, t).stats[stat]);
      expect({ key, lowered }).toEqual({ key, lowered: RANKS.map(r => 4 * times * RULES.rankBonus[r]) });
    }
  });

  test('Bloodlust\'s damage penalty is Strength and Power points: the old modifier over the power factor, rounded', () => {
    const OLD_DAMAGE = [-1, -3, -5, -9, -13, -19];
    for (const t of TIERS) {
      const s = under('bloodlust', t).stats, points = Math.round(OLD_DAMAGE[t]! / RULES.fight.powerK);
      expect([s.str, s.pow]).toEqual([RULES.fight.statBase + points, RULES.fight.statBase + points]);
    }
  });

  test('Slowed takes 20% to 50% off a body\'s speed by rank, and Hasted adds as much', () => {
    const PCT = [20, 25, 30, 35, 40, 50];
    const base = modified(HUNTER, [], RULES).sheet.speed;
    expect(base).toBe(RULES.fight.speedBase);
    for (const t of TIERS) {
      expect(under('slowed', t).sheet.speed).toBeCloseTo(base * (1 - PCT[t]! / 100), 6);
      expect(under('hasted', t).sheet.speed).toBeCloseTo(base * (1 + PCT[t]! / 100), 6);
    }
  });

  test('Hasted gives half an action back a quarter of the time', () => {
    expect(BUILT_IN_STATUSES.hasted.ops).toContainEqual({ op: 'refund', pct: 50, chance: 25 });
  });

  test('Stunned and Paralyzed take the turn, Paralyzed and Restrained the move, and all three are control a tenacity shortens', () => {
    const has = (key: BuiltInStatus, op: Op['op']) => BUILT_IN_STATUSES[key].ops.some(o => o.op === op);
    expect(['stunned', 'paralyzed', 'restrained'].map(k => [has(k as BuiltInStatus, 'hold'), has(k as BuiltInStatus, 'root')])).toEqual([[true, false], [true, true], [false, true]]);
    for (const k of ['paralyzed', 'restrained'] as const) expect(under(k, 0).sheet.move).toBe(0);
    for (const k of ['stunned', 'paralyzed', 'restrained', 'slowed'] as const) expect(isControl(BUILT_IN_STATUSES[k], 0)).toBe(true);
    expect(isControl(BUILT_IN_STATUSES.hasted, 0)).toBe(false);
  });

  test('damaging built-in statuses have their R6 types: bleeding physical, burning arcane, poisoned and plague true', () => {
    const expected: Record<string, string> = { bleeding: 'physical', burning: 'arcane', poisoned: 'true', plague: 'true' };
    const seen: Record<string, string> = {};
    for (const key of STATUS_KEYS) for (const o of BUILT_IN_STATUSES[key].ops) {
      if (o.op === 'damage') {
        expect(o.when).toBe('turn');
        seen[key] = o.type;
      }
    }
    expect(seen).toEqual(expected);
  });

  test('Plague deals Poisoned\'s damage a round without its aim penalty, and passes to a body next to its bearer', () => {
    const [damage, spread] = BUILT_IN_STATUSES.plague.ops;
    expect(damage).toEqual(BUILT_IN_STATUSES.poisoned.ops[0]);
    expect(spread).toEqual({ op: 'spread', range: RULES.fight.spreadRange });
  });

  test('Stealth hides out of sight and Invisible in the open, each ended by a hurt, a reveal or damage dealt', () => {
    // a level that rises with the rank (notes-7-stealth.md section 5), ranks E and D at 0: stealth beats sight at the same
    // level (the owner, Nov 22), so a hide at 0 hides from everyone's starting sight of 0, and rank C hides from a sight of 1
    const ALL_ENDS = { hurt: true, revealed: true, dealt: true };
    expect(BUILT_IN_STATUSES.stealth.ops).toEqual([{ op: 'hidden', level: [0, 0, 1, 2, 3, 4], start: 'unseen', ends: ALL_ENDS }]);
    expect(BUILT_IN_STATUSES.invisible.ops).toEqual([{ op: 'hidden', level: [0, 0, 1, 2, 3, 4], start: 'anywhere', ends: ALL_ENDS }]);
    const hideAt = (key: BuiltInStatus, t: number) => hideOf(statusKey(key), BUILT_IN_STATUSES[key], t)!.level;
    expect(TIERS.map(t => hideAt('stealth', t))).toEqual(TIERS.map(t => Math.max(0, t - 1)));
    expect(TIERS.map(t => hideAt('invisible', t))).toEqual(TIERS.map(t => hideAt('stealth', t)));
  });

  test('at every rank Burning deals more a round than Bleeding, and Bleeding at least as much as Poisoned', () => {
    for (const t of TIERS) {
      expect(roundDamage('burning', t)).toBeGreaterThan(roundDamage('bleeding', t));
      expect(roundDamage('bleeding', t)).toBeGreaterThanOrEqual(roundDamage('poisoned', t));
    }
  });

  test('Grievous Wounds cuts healing received by 40% via a share-on-healed op, is harmful, and can be overridden in the library', () => {
    expect(BUILT_IN_STATUSES.grievous.ops).toEqual([{ op: 'share', on: 'healed', pct: -40 }]);
    expect(harmful(BUILT_IN_STATUSES.grievous)).toBe(true);
    expect(healShare({ statuses: [on('grievous', 0)] }, RULES)).toBeCloseTo(0.6, 9);
    const custom: StatusDef = { ...BUILT_IN_STATUSES.grievous, ops: [{ op: 'share', on: 'healed', pct: -25 }] };
    expect(rulesOf({}, { grievous: custom }).conditions.grievous).toEqual(custom);
  });
});

group('a status card in words', () => {
  test('a status on a body reads its source\'s rank; the picker\'s card reads every rank E to S', () => {
    expect(describeStatus(BUILT_IN_STATUSES.poisoned, 2, RULES)).toEqual(['1d6 true damage a round', 'Control: −16']);
    expect(describeStatus(BUILT_IN_STATUSES.slowed, null, RULES)).toEqual(['Speed −20% / −25% / −30% / −35% / −40% / −50%, by rank E to S']);
    expect(describeStatus(BUILT_IN_STATUSES.hasted, 5, RULES)).toEqual(['Speed +50%', '25% chance to get 50% of an action\'s time back']);
    expect(describeStatus(BUILT_IN_STATUSES.paralyzed, 0, RULES)).toEqual(['Cannot act', 'Cannot move']);
  });

  test('a status that applies another names it, how long it lasts in rounds, and what it does at the same rank', () => {
    const def: StatusDef = { label: 'Kindling', desc: 'Catches fire.', ops: [
      { op: 'applyStatus', key: statusKey('burning'), def: BUILT_IN_STATUSES.burning, duration: tick(3 * RULES.fight.round) },
      { op: 'cureStatus', key: statusKey('hasted') },
    ] };
    expect(describeStatus(def, 2, RULES)).toEqual(['Applies Burning (3 rounds): 3d8 arcane damage a round', 'Cures Hasted']);
  });
});

group('a status def from outside data', () => {
  test('a def with an op that does not read is refused whole, as is one with no label', () => {
    expect(parseStatusDef({ label: 'Ok', desc: '', ops: [{ op: 'explode' }, { op: 'hold' }] }, RULES)).toBeNull();
    expect(parseStatusDef({ desc: 'no label', ops: [] }, RULES)).toBeNull();
    expect(parseStatusDef({ label: 'Ok', desc: '', ops: [], icon: 'ward' }, RULES)!.icon, 'a key of the registry is read back, on any def').toBe('ward');
    expect(parseStatusDef({ label: 'Ok', desc: '', ops: [], icon: 'wolf' }, RULES)!.icon, 'a GM may give any icon to anything').toBe('wolf');
    for (const icon of ['nope', '', 7, null]) expect(parseStatusDef({ label: 'Ok', desc: '', ops: [], icon }, RULES), `${String(icon)} is dropped, the def is not refused`).not.toBeNull();
    expect(parseStatusDef({ label: 'Ok', desc: '', ops: [], icon: 'nope' }, RULES)).not.toHaveProperty('icon');
    expect(parseStatusDef({ label: 'Old', desc: '', ops: [{ op: 'mod', stat: 'ac', value: -2 }] }, RULES)).toBeNull();
  });

  test('a GM\'s colour is kept in lower case, and a colour that is not #rrggbb refuses the def', () => {
    expect(parseStatusDef({ label: 'Marked', desc: '', ops: [], color: '#FF00AA' }, RULES)).toEqual({ label: 'Marked', desc: '', ops: [], color: '#ff00aa' });
    expect(parseStatusDef({ label: 'Marked', desc: '', ops: [], color: 'red' }, RULES)).toBeNull();
  });

  test('dice past the rules\' limits refuse the def', () => {
    const big = { label: 'Big', desc: '', ops: [{ op: 'damage', type: 'arcane', amount: { kind: 'dice', count: RULES.dice.maxDice + 1, sides: 6 } }] };
    expect(parseStatusDef(big, RULES)).toBeNull();
  });

  test('damage type "magical" and missing type are refused, and "true" is allowed on both ops and ability effects', () => {
    const amt = { kind: 'dice', count: 1, sides: 6 };
    expect(parseOp({ op: 'damage', type: 'magical', amount: amt }, RULES)).toBeNull();
    expect(parseOp({ op: 'damage', type: 'true', amount: amt }, RULES)).toEqual({ op: 'damage', type: 'true', amount: amt });
    expect(parseOp({ op: 'damage', amount: amt }, RULES)).toBeNull();
    const base = abilityOf('curse', { id: abilityId('bolt'), name: 'Bolt' }, RULES);
    expect(parseAbility({ ...base, effect: { type: 'magical', by: 'hand', formula: amt } }, RULES)).toBeNull();
    expect(parseAbility({ ...base, effect: { type: 'true', by: 'hand', formula: amt } }, RULES)?.effect).toEqual({ type: 'true', by: 'hand', formula: amt });
    expect(parseAbility({ ...base, effect: { by: 'hand', formula: amt } }, RULES)).toBeNull();
  });
});

test('the chips a hunter\'s state draws have a label and no ops, and none of them is a status a picker offers', () => {
  for (const key of STATE_CHIPS) {
    expect(STATE_CHIP_DEFS[key].label.length).toBeGreaterThan(0);
    expect(STATE_CHIP_DEFS[key].ops).toEqual([]);
    expect(STATUS_KEYS as string[]).not.toContain(key);
  }
});

test('a dead hunter wears the chip the death panel names, Dead, and its card says the ways back and the cleanse', () => {
  expect(chipDef('dead').label).toBe('Dead');
  expect(chipDef('dead').desc).toBe(STATE_CHIP_DEFS.dead.desc);
  expect(chipDef('dead').desc).toMatch(/clear all statuses/);
  // a chip that has nothing to do with the life reads as the registry names it
  expect(chipDef('penalized').label).toBe(STATE_CHIP_DEFS.penalized.label);
});
