// What a made ability or status is worth against its budget (src/core/registry/worth.ts). The expected numbers are the
// kits design's section 3 (tables 3.4 and 3.5, printed by `bun scripts/kits-paper.ts`) and the rules each correction of
// docs/agent-handoff/kits/notes-worth.md states, not a run of the code. The last group plays the example kits on the real
// reducer (tests/models/fight-sim.ts) and holds the bar to what the simulation measures.
import { describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { monsterSheet } from '../src/core/hunter/derive.ts';
import { defenceLeft, NO_PEN, throughDefence } from '../src/core/combat/land.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { parseFormula } from '../src/core/formula.ts';
import type { Formula } from '../src/core/formula.ts';
import { abilityOf, defaultTicks, recommended } from '../src/core/registry/ability-kinds.ts';
import type { AbilityInput } from '../src/core/registry/ability-kinds.ts';
import { missingMean, suggestScaler } from '../src/core/registry/scalers.ts';
import { abilityWorth, bestScope, breakWorth, defenceAdjusted, defWorth, delayedShare, deliveredShare, firings, gateCredit, lapseAfter, hpPriceWorth, hpRate, modeCredit, referenceBody, thresholdWorth, wornWorth, worthLine } from '../src/core/registry/worth.ts';
import type { Rules } from '../src/core/rules.ts';
import { exampleSkills } from '../src/core/registry/kit-examples.ts';
import { place } from '../src/core/combat/space.ts';
import { abilities, builtIns, hunter, playFight } from './models/fight-sim.ts';
import type { Archetype, SimRow } from './models/fight-sim.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { AbilityKind, DamageType } from '../src/core/combat/ability-types.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { StackDef, StatusDef } from '../src/core/combat/effect-ops.ts';
import { tick } from '../src/core/combat/timeline.ts';

const f = (text: string): Formula => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const of = (kind: AbilityKind, o: Partial<AbilityInput> = {}) => abilityOf(kind, { id: abilityId('x'), name: 'x', ...o }, RULES);
const TOL = RULES.fight.kit.tolerance;

describe('the yardstick: a recommended ability is worth its pace\'s budget', () => {
  test('a standard strike, curse and support are worth 1, a quick shot 0.7, a heavy blast 1.5, each inside its budget', () => {
    const want: Record<AbilityKind, number> = { strike: 1, curse: 1, support: 1, shot: 0.7, blast: 1.5 };
    for (const kind of Object.keys(want) as AbilityKind[]) {
      const w = abilityWorth(of(kind), RULES);
      expect([kind, Number(w.worth.toFixed(6)), w.over, w.unweighed]).toEqual([kind, want[kind], false, []]);
      if (kind !== 'curse') expect(w.budget).toBe(want[kind]);
    }
  });

  test('a curse\'s budget is what a Mage\'s Arc Bolt holds, 2d6 + mag over 1d8 + mag, since the simulation\'s cannon casts it every turn', () => {
    const mag = (rank: 'E' | 'C' | 'S') => referenceBody('cannon', rank, RULES).sheet.mag;
    for (const rank of ['E', 'C', 'S'] as const) {
      const w = abilityWorth(of('curse'), RULES, { rank });
      expect(w.budget).toBeCloseTo((7 + mag(rank)) / (4.5 + mag(rank)), 6);
      expect(w.by).toBe('Arc Bolt');
    }
    expect(worthLine(abilityWorth(of('curse'), RULES))).toBe('Power rating: 1.00 (target 1.08 for this action speed, matching Arc Bolt).');
  });

  test('a curse with no formula of its own is weighed against a arcane curse, its kind\'s, not a physical one', () => {
    const end: StatusDef = { label: 'Later', desc: '', ops: [], end: { ops: [{ op: 'damage', type: 'arcane', amount: f('1d8 + mag'), when: 'use' }], cleanse: 'cancel' } };
    const later = of('curse', { effect: null, ops: [{ op: 'applyStatus', key: statusKey('later'), def: end, duration: tick(3 * RULES.fight.round) }] });
    // the end lands whole (against a curse that delivers 0.775 of its average), on 55% of uses, half the time 3 rounds late in 6
    expect(abilityWorth(later, RULES).worth).toBeCloseTo(0.55 / 0.775 * 0.5, 6);
  });
});

describe('what each block is worth (design 3, tables 3.4 and 3.5)', () => {
  test('one HP paid is worth what a same-rank support\'s heal of 1.5 sup gives back: 0.064 SA at E, 0.025 at C, 0.011 at S', () => {
    expect([hpRate('E', RULES), hpRate('C', RULES), hpRate('S', RULES)].map(x => Number(x.toFixed(3)))).toEqual([0.064, 0.025, 0.011]);
    expect(1.5 * referenceBody('support', 'C', RULES).sheet.sup).toBeCloseTo(39.2, 1);
  });

  test('10% of max HP as a price is 0.21 SA for a C cannon and 0.26 for a C bruiser', () => {
    const tenth = { kind: 'hp', amount: { kind: 'share', share: 0.1 } } as const;
    expect(hpPriceWorth(tenth, referenceBody('cannon', 'C', RULES).sheet.hpMax, 'C', RULES)).toBeCloseTo(0.21, 2);
    expect(hpPriceWorth(tenth, referenceBody('bruiser', 'C', RULES).sheet.hpMax, 'C', RULES)).toBeCloseTo(0.26, 2);
  });

  test('a mode of a standard action and 10% of max HP for 3 rounds gives each gated use 0.43 SA at E and 0.40 at C and S', () => {
    const at = (rank: 'E' | 'C' | 'S') => modeCredit({ hpShare: 0.1, rounds: 3 }, rank, RULES);
    expect([at('E').price, at('C').price, at('S').price].map(x => Number(x.toFixed(2)))).toEqual([1.29, 1.21, 1.2]);
    expect([at('E').credit, at('C').credit, at('S').credit].map(x => Number(x.toFixed(2)))).toEqual([0.43, 0.4, 0.4]);
  });

  test('a threshold payoff of 1 SA at 5 stacks is worth 0.2 for each stack an ability adds, when every stack reaches a whole firing', () => {
    expect(thresholdWorth(1, 5, 1, 1, 5)).toBeCloseTo(0.2, 10);
    expect(thresholdWorth(1, 5, 5, 1, 1)).toBeCloseTo(1, 10);
  });

  test('a threshold pays in whole firings: over 6 uses landing 55% of the time, 0.70 of the stacks reach one at 3 and 0.85 at 2', () => {
    // E[floor(L / n)] * n / E[L] for L binomial(6, 0.55), worked by hand from the binomial's terms
    const p = 0.55, b = (l: number) => [1, 6, 15, 20, 15, 6, 1][l]! * p ** l * (1 - p) ** (6 - l);
    const whole = (n: number) => [0, 1, 2, 3, 4, 5, 6].reduce((s, l) => s + b(l) * Math.floor(l / n), 0) * n / (6 * p);
    expect(firings(3, 1, p, 6)).toBeCloseTo(whole(3), 10);
    expect(firings(2, 1, p, 6)).toBeCloseTo(whole(2), 10);
    expect([firings(3, 1, p, 6), firings(2, 1, p, 6)].map(x => Number(x.toFixed(2)))).toEqual([0.7, 0.85]);
  });

  test('stacks lasting d rounds, from uses a round apart, lapse after d - 1 uses in a row land nothing; every use landing never lapses', () => {
    expect([lapseAfter(2, 1), lapseAfter(3, 1), lapseAfter(null, 1)]).toEqual([0, 1, Infinity]);
    expect(firings(2, 1, 1, 6, 0)).toBe(1);
    // at 2 stacks with no miss allowed over 4 uses: a firing at the 2nd use (LL), the 3rd (MLL), or the 4th (the count at 0
    // after two uses, by LL or by a miss second, then LL)
    const p = 0.55, q = 1 - p, fires = p * p + q * p * p + (p * p + q) * p * p;
    expect(firings(2, 1, p, 4, 0)).toBeCloseTo(fires * 2 / (4 * p), 10);
  });

  test('a delayed end lands the share of the reference fight left after its delay; a cleanse takes its rule\'s share each round', () => {
    expect(delayedShare(3, 'cancel', RULES)).toBeCloseTo(0.5, 10);
    expect(delayedShare(6, 'cancel', RULES)).toBe(0);
    const cleansing = { ...RULES, fight: { ...RULES.fight, kit: { ...RULES.fight.kit, cleanse: 0.1 } } } as Rules;
    expect(delayedShare(3, 'cancel', cleansing)).toBeCloseTo(0.5 * 0.9 ** 3, 10);
    expect(delayedShare(3, 'land', cleansing)).toBeCloseTo(0.5, 10);
  });

  test('a curse\'s own roll delivers 0.775 of its average at parity (resisted for half on 45%); a travel or a sure use all of it', () => {
    expect(deliveredShare({ kind: 'direct' }, RULES)).toBeCloseTo(0.55 + 0.45 * 0.5, 10);
    expect(deliveredShare({ kind: 'sure' }, RULES)).toBe(1);
  });

  test('a gated ability carries its mode\'s price: Hemoplague under Crimson Pact (a standard action and half max HP for 3 rounds)', () => {
    const K = exampleSkills(RULES).flatMap(s => (s.type === 'active' && s.ability ? [s.ability] : []));
    const hemo = K.find(a => a.name === 'Hemoplague')!, cannon = referenceBody('cannon', 'C', RULES).sheet;
    const price = 1 + RULES.fight.kit.hpShare * cannon.hpMax * hpRate('C', RULES), uses = 3 * cannon.speed / RULES.fight.speedBase;
    expect(gateCredit(hemo, K, RULES)).toBeCloseTo(price / uses, 6);
    expect(gateCredit(hemo, K.filter(a => a.name !== 'Crimson Pact'), RULES)).toBe(0);
  });
});

describe('the example kits sit inside the tolerance, and a GM\'s overreach is warned, never refused', () => {
  test('an execute at its suggestion is worth its plain budget; a giant slayer typed to +100% is past the tolerance against a boss', () => {
    const exec = of('strike', { ticks: { scalers: [suggestScaler('strike', 'execute', RULES)] } });
    expect(abilityWorth(exec, RULES).worth).toBeCloseTo(1, 2);
    const hot = of('strike', { ticks: { scalers: [{ measure: 'maxPair', dir: 'over', start: 0.5, scale: 1 }] } });
    expect(abilityWorth(hot, RULES).over).toBe(true);
  });

  test('a scaler weighs the same in a threshold\'s burst as in an ability: an execute at its suggestion keeps the burst at its plain worth', () => {
    const exec = suggestScaler('curse', 'execute', RULES), plain = recommended('curse', { ...defaultTicks('curse'), pace: 'standard' }, RULES);
    const scaled = recommended('curse', { ...defaultTicks('curse'), pace: 'standard', scalers: [exec] }, RULES);
    const mark = (formula: Formula): StackDef => ({ label: 'Mark', desc: '', ops: [], stack: { cap: 2, leave: { kind: 'never' }, keep: 'fight', threshold: {
      at: { kind: 'count', n: 2 }, to: { kind: 'bearer' }, then: 'spend', ops: [{ op: 'damage', type: 'arcane', amount: formula, when: 'use' }] } } });
    const worth = (formula: Formula) => abilityWorth(of('curse', { effect: null, ops: [{ op: 'applyStatus', key: statusKey('mark'), def: mark(formula), duration: tick(2000), stacks: 1 }] }), RULES).worth;
    // the base cut pays the scaler's mean back over the reference dungeon, so against the larger of its two foes it is within the tolerance of plain
    expect(worth(scaled.formula) / worth(plain.formula)).toBeGreaterThanOrEqual(0.99);
    expect(worth(scaled.formula) / worth(plain.formula)).toBeLessThanOrEqual(1 + RULES.fight.kit.tolerance);
  });

  test('an ability with a scaler says what it weighs against packs and against a boss', () => {
    const slayer = abilityWorth(of('strike', { ticks: { scalers: [suggestScaler('strike', 'giantSlayer', RULES)] } }), RULES);
    expect(slayer.against!.boss).toBeGreaterThan(slayer.against!.packs);
    expect(slayer.against!.boss).toBeLessThanOrEqual(1 + RULES.fight.kit.tolerance + 1e-9);
    expect(worthLine(slayer)).toContain(`against packs and ${slayer.against!.boss.toFixed(2)}x against a boss.`);
    expect(abilityWorth(of('strike'), RULES).against).toBeUndefined();
  });

  test('Bloodletting, a curse at 0.7 that adds a Resonance stack bursting for 1.6 SA at 3: 0.7 plus 1.6 / 3 of the 55% it lands, in whole firings, whole', () => {
    const burst = recommended('curse', { ...defaultTicks('curse'), pace: 'standard' }, RULES).text;
    const resonance: StackDef = { label: 'Resonance', desc: '', ops: [], stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight', threshold: {
      at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend', ops: [{ op: 'damage', type: 'arcane', amount: f(`1.6 * (${burst})`), when: 'use' }] } } };
    const blood = of('curse', { effect: { type: 'arcane', by: 'hand', formula: f(`0.7 * (${burst})`) }, ops: [{ op: 'applyStatus', key: statusKey('resonance'), def: resonance, duration: tick(2000), stacks: 1 }] });
    const w = abilityWorth(blood, RULES);
    // its stacks last 2 rounds and the cannon casts once a round, so one miss lets them lapse (no use in a row may miss)
    expect(w.worth).toBeCloseTo(0.7 + 1.6 / 3 * 0.55 * firings(3, 1, 0.55, 6, 0) / 0.775, 2);
    expect(w.over).toBe(false);
  });

  test('Hemoplague at 1.4 of a curse is over a standard budget alone and inside it with Crimson Pact\'s credit of 0.40', () => {
    const hemo = of('curse', { effect: { type: 'arcane', by: 'hand', formula: f('1.4 * (1d8 + mag)') } });
    expect(abilityWorth(hemo, RULES).over).toBe(true);
    expect(abilityWorth(hemo, RULES, { credit: modeCredit({ hpShare: 0.1, rounds: 3 }, 'C', RULES).credit }).over).toBe(false);
  });

  test('an HP price buys power: a strike at 1.2 with a 10% HP price is inside its budget', () => {
    const paid = of('strike', { effect: { type: 'physical', by: 'hand', formula: f('1.2 * (1d8 + phys)') } });
    expect(abilityWorth(paid, RULES).over).toBe(true);
    expect(abilityWorth({ ...paid, prices: [{ kind: 'hp', amount: { kind: 'share', share: 0.1 } }] }, RULES).over).toBe(false);
  });

  test('a worn status is held to the tolerance a round: a stack on each hit dealt is nothing on its own, a free hit on each hit is far past it', () => {
    const pain: StatusDef = { label: 'Pain', desc: '', ops: [], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
    const stacker: StatusDef = { label: 'Pain is Power', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: statusKey('pain'), def: pain, duration: null, stacks: 1 }] }] };
    expect(wornWorth(stacker, RULES)).toEqual({ worth: 0, budget: TOL, over: false, unweighed: [] });
    const echo: StatusDef = { label: 'Echo', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'physical', amount: f('1d8 + phys'), when: 'use' }] }] };
    expect(wornWorth(echo, RULES).over).toBe(true);
  });

  test('a Lifeline is weighed at its event\'s rate: a heal on falling under 30% HP is 0.17 of the same heal at each turn\'s start, one on a status imposed all of it', () => {
    const heal = (on: 'lowHp' | 'turnStart'): StatusDef => ({ label: 'Lifeline', desc: '', ops: [], triggers: [{ on, to: 'self', limit: { kind: 'fight', n: 1 }, ops: [{ op: 'heal', amount: f('20'), when: 'use' }] }] });
    const rates = RULES.fight.kit.eventRates, each = wornWorth(heal('turnStart'), RULES).worth;
    expect(each).toBeGreaterThan(0);
    expect(wornWorth(heal('lowHp'), RULES).worth).toBeCloseTo(each * rates.lowHp / rates.turnStart, 9);
    expect(rates.lowHp).toBe(0.17);
    const strings: StatusDef = { label: 'Strings', desc: '', ops: [], triggers: [{ on: 'imposed', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'heal', amount: f('20'), when: 'use' }] }] };
    expect(wornWorth(strings, RULES).worth).toBeCloseTo(each * rates.imposed / rates.turnStart, 9);
  });

  test('a trigger\'s shield is weighed as an HP healed: its HP at the rate a support\'s standard heal makes one action, once a fight at `lowHp`\'s rate', () => {
    const shield = (text: string): StatusDef => ({ label: 'Lifeline', desc: '', ops: [], triggers: [{ on: 'lowHp', to: 'self', limit: { kind: 'fight', n: 1 }, ops: [{ op: 'shield', amount: f(text) }] }] });
    for (const rank of ['E', 'C', 'S'] as const) {
      const w = wornWorth(shield('30'), RULES, rank);
      expect(w.unweighed, rank).toEqual([]);
      expect(w.worth, rank).toBeCloseTo(30 / (1.5 * referenceBody('support', rank, RULES).sheet.sup) * RULES.fight.kit.eventRates.lowHp, 9);
    }
    const tank = referenceBody('tank', 'C', RULES).sheet.hpMax;
    expect(tank, 'the tank has the most max HP of the paper builds').toBe(Math.max(...(['speed', 'tank', 'cannon', 'bruiser', 'support'] as const).map(b => referenceBody(b, 'C', RULES).sheet.hpMax)));
    expect(wornWorth(shield('0.1 * hpmax'), RULES, 'C', { on: 'best' }).worth).toBeCloseTo(wornWorth(shield(String(0.1 * tank)), RULES, 'C').worth, 9);
  });

  test('the worth line says the worth and the budget, and past the tolerance by how much', () => {
    expect(worthLine({ worth: 1.04, budget: 1, over: false, unweighed: [] })).toBe('Power rating: 1.04 (target 1.00 for this action speed).');
    expect(worthLine({ worth: 1.12, budget: 1, over: true, unweighed: [] })).toBe('Power rating: 1.12 (target 1.00 for this action speed). Stronger than expected for this action speed by 12%.');
  });
});

describe('an amount that grows with its holder is weighed on the build that gets the most from it (item-stats 6.5)', () => {
  // An item or a title may be held by anyone, so an amount that scales costs what it gives the paper build of the rank
  // on which it averages highest: never undercharged. A flat amount of what that build has is the same amount.
  const C = (b: 'support' | 'bruiser' | 'tank' | 'speed' | 'cannon') => referenceBody(b, 'C', RULES);
  const onHit = (op: 'heal' | 'damage', amount: Formula): StatusDef => ({
    label: 'Charm', desc: '', ops: [],
    triggers: [{ on: 'hitDealt', tag: null, to: op === 'heal' ? 'self' : 'other', limit: { kind: 'each' }, ops: [op === 'heal' ? { op, amount, when: 'use' } : { op, type: 'physical', amount, when: 'use' }] }],
  });

  test('a Presence amount reads the support, a Strength amount the bruiser, a max HP amount the build with the most max HP', () => {
    expect(bestScope(f('pre'), 'C', RULES).user).toEqual(C('support'));
    expect(bestScope(f('str'), 'C', RULES).user).toEqual(C('bruiser'));
    const most = Math.max(...(['support', 'bruiser', 'tank', 'speed', 'cannon'] as const).map(b => C(b).sheet.hpMax));
    expect(bestScope(f('0.2 * hpmax'), 'C', RULES).user.sheet.hpMax).toBe(most);
  });

  test('an item\'s heal on Presence on each hit dealt is weighed as a heal of the support\'s Presence, not the bruiser\'s', () => {
    const pre = C('support').stats.pre;
    expect(pre).toBeGreaterThan(C('bruiser').stats.pre);
    expect(wornWorth(onHit('heal', f('pre')), RULES, 'C', { on: 'best' }).worth).toBeCloseTo(wornWorth(onHit('heal', f(`${pre}`)), RULES, 'C').worth, 9);
    expect(wornWorth(onHit('heal', f('pre')), RULES, 'C').worth, 'a passive skill keeps the bruiser').toBeCloseTo(wornWorth(onHit('heal', f(`${C('bruiser').stats.pre}`)), RULES, 'C').worth, 9);
  });

  test('an item\'s hit on Strength on each hit dealt is weighed on the bruiser, as a passive skill\'s is', () => {
    const str = C('bruiser').stats.str;
    expect(wornWorth(onHit('damage', f('str')), RULES, 'C', { on: 'best' }).worth).toBeCloseTo(wornWorth(onHit('damage', f(`${str}`)), RULES, 'C').worth, 9);
  });

  test('an active strike on Presence is weighed as one of the support\'s Presence, an active shield on Strength as one of the bruiser\'s Strength', () => {
    const strike = (text: string) => of('strike', { effect: { type: 'physical', by: 'hand', formula: f(text) } });
    const shield = (text: string) => of('support', { effect: { type: 'shield', by: 'hand', formula: f(text) } });
    expect(abilityWorth(strike('1d8 + pre'), RULES, { on: 'best' }).worth).toBeCloseTo(abilityWorth(strike(`1d8 + ${C('support').stats.pre}`), RULES).worth, 9);
    expect(abilityWorth(shield('2 * str'), RULES, { on: 'best' }).worth).toBeCloseTo(abilityWorth(shield(`${2 * C('bruiser').stats.str}`), RULES).worth, 9);
  });
});

describe('time is weighed as a share of a standard action, whoever gains or loses it', () => {
  // A standard action is the unit (1 SA); a body at parity does as much with an action as the user, so time an ally
  // gains or a foe loses is worth its share of one, as time back to the user (refund) already was.
  // A standard action takes a body of base speed (100) `round` ticks (rules.ts: "the time a speed-100 combatant needs
  // for one standard action"); `cost.standard` is the action's cost in hundredths, not its ticks.
  const ACTION = RULES.fight.round, landsOnFoe = (RULES.fight.resistDc - 1) / 20;
  test('a support that brings an ally\'s next turn half an action sooner is worth 0.5, named nowhere as unweighed', () => {
    const w = abilityWorth(of('support', { effect: null, ops: [{ op: 'hasten', share: 0.5 }] }), RULES);
    expect([Number(w.worth.toFixed(6)), w.unweighed]).toEqual([0.5, []]);
  });
  test('a curse that puts a foe\'s next turn one standard action later is worth one action of the foe, at the share a curse lands', () => {
    const w = abilityWorth(of('curse', { effect: null, ops: [{ op: 'delay', ticks: tick(ACTION) }] }), RULES);
    expect([Number(w.worth.toFixed(6)), w.unweighed]).toEqual([Number(landsOnFoe.toFixed(6)), []]);
  });
  test('a stagger bar\'s break is worth the rounds it pushes its monster\'s turn, a round being one standard action', () => {
    expect(breakWorth(RULES)).toBeCloseTo(RULES.fight.staggerCost, 10);
    const w = abilityWorth(of('curse', { effect: null, ops: [{ op: 'stagger', share: 0.5 }] }), RULES);
    expect([Number(w.worth.toFixed(6)), w.unweighed]).toEqual([Number((0.5 * RULES.fight.staggerCost * landsOnFoe).toFixed(6)), []]);
  });
  test('an extra action is worth one whole action', () => {
    const w = abilityWorth(of('support', { effect: null, aim: 'self', ops: [{ op: 'extra' }] }), RULES);
    expect([Number(w.worth.toFixed(6)), w.unweighed]).toEqual([1, []]);
  });
});

describe('what the bar cannot estimate it names, never counting it as 0', () => {
  const K = exampleSkills(RULES);
  const ability = (name: string) => { const s = K.find(x => x.name === name)!; if (s.type !== 'active' || !s.ability) throw new Error(name); return s.ability; };

  test('Parry names its reaction and its guard, Call Sprite its summon, Violence and Fester the count they read', () => {
    expect(abilityWorth(ability('Parry'), RULES).unweighed).toEqual(['guard', 'reaction']);
    expect(abilityWorth(ability('Call Sprite'), RULES).unweighed).toEqual(['summon']);
    expect(abilityWorth(ability('Violence'), RULES).unweighed).toEqual(['count']);
    expect(abilityWorth(ability('Fester'), RULES).unweighed).toEqual(['count']);
    expect(abilityWorth(ability('Bloodletting'), RULES).unweighed).toEqual([]);
  });

  test('the line says what it weighed and what to test in a fight', () => {
    expect(worthLine(abilityWorth(ability('Call Sprite'), RULES))).toBe('Power rating: 0.00 (target 1.00 for this action speed). Not estimated: its summon. Test it in a fight.');
    expect(worthLine({ worth: 0, budget: 0.7, over: false, unweighed: ['guard', 'reaction'] })).toBe('Power rating: 0.00 (target 0.70 for this action speed). Not estimated: a guard and its reaction. Test them in a fight.');
  });

  test('a status alone weighs its per-round damage over the reference fight, whole, and names its stat change and its end', () => {
    const rot: StatusDef = { label: 'Rot', desc: '', ops: [{ op: 'damage', type: 'arcane', amount: f('1d8 + mag'), when: 'turn' }, { op: 'stat', key: 'str', amount: { kind: 'number', value: -2 } }],
      end: { ops: [{ op: 'damage', type: 'arcane', amount: f('1d8 + mag'), when: 'use' }], cleanse: 'cancel' } };
    const w = defWorth(rot, RULES);
    expect(w.worth).toBeCloseTo(RULES.fight.kit.referenceRounds / 0.775, 6);
    expect(w.unweighed).toEqual(['stat', 'end']);
    expect(w.over).toBe(true);
  });
});

describe('true-damage worth (R5): defense-ignoring hits price at raw / throughDefence against the reference target', () => {
  test('a true-damage strike, curse, trigger, and status each pay the exact defense ratio on the weighing\'s reference brute', () => {
    const bruteC = monsterSheet('C', 'brute', 'normal', RULES);
    const bruiserC = referenceBody('bruiser', 'C', RULES).sheet;
    const cannonC = referenceBody('cannon', 'C', RULES).sheet;

    // Direct strike: physical vs true
    const strikePhys = of('strike');
    const strikeTrue = of('strike', { ticks: { ...defaultTicks('strike', 'true') } });
    const rawStrike = 4.5 + bruiserC.phys;
    const strikeRatio = rawStrike / throughDefence(rawStrike, defenceLeft('physical', bruiserC, bruteC), RULES);
    expect(abilityWorth(strikeTrue, RULES).worth / abilityWorth(strikePhys, RULES).worth).toBeCloseTo(strikeRatio, 9);

    // Direct curse: arcane vs true (cannon has resistPen)
    const curseArc = of('curse');
    const curseTrue = of('curse', { ticks: { ...defaultTicks('curse', 'true') } });
    const rawCurse = 4.5 + cannonC.mag;
    const curseRatio = rawCurse / throughDefence(rawCurse, defenceLeft('arcane', cannonC, bruteC), RULES);
    expect(abilityWorth(curseTrue, RULES).worth / abilityWorth(curseArc, RULES).worth).toBeCloseTo(curseRatio, 9);

    // Worn trigger: small true tick earns a larger premium than a big hit because of armorFlat
    const hitTrigger = (type: DamageType, amount: string): StatusDef => ({
      label: 'Hit', desc: '', ops: [],
      triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type, amount: f(amount), when: 'use' }] }],
    });
    const smallRatio = 4 / throughDefence(4, defenceLeft('physical', bruiserC, bruteC), RULES);
    const bigRatio = 30 / throughDefence(30, defenceLeft('physical', bruiserC, bruteC), RULES);
    expect(smallRatio).toBeGreaterThan(bigRatio);
    expect(wornWorth(hitTrigger('true', '4'), RULES).worth / wornWorth(hitTrigger('physical', '4'), RULES).worth).toBeCloseTo(smallRatio, 9);
    expect(wornWorth(hitTrigger('true', '30'), RULES).worth / wornWorth(hitTrigger('physical', '30'), RULES).worth).toBeCloseTo(bigRatio, 9);

    // Per-round status: Poisoned and Plague use NO_PEN against brute resist (arcane baseline) and stay within budget
    const tickRatio = 3.5 / throughDefence(3.5, defenceLeft('arcane', NO_PEN, bruteC), RULES);
    const poisonTrue = defWorth(BUILT_IN_STATUSES.poisoned, RULES);
    const poisonArc: StatusDef = { ...BUILT_IN_STATUSES.poisoned, ops: BUILT_IN_STATUSES.poisoned.ops.map(o => (o.op === 'damage' ? { ...o, type: 'arcane' } : o)) };
    expect(poisonTrue.worth / defWorth(poisonArc, RULES).worth).toBeCloseTo(tickRatio, 9);
    expect(poisonTrue.over).toBe(false);
    expect(defWorth(BUILT_IN_STATUSES.plague, RULES).over).toBe(false);
    // Tiny ticks under the 1-damage floor never divide by zero or drop below 1x
    expect(defenceAdjusted(1, 'true', 'physical', bruiserC, bruteC, RULES)).toBe(1);
    expect(defenceAdjusted(0.5, 'true', 'physical', bruiserC, bruteC, RULES)).toBe(0.5);
  });

  test('a GM override via RULES.fight.damageTypes and a custom defense-ignoring type both price the same as true', () => {
    const baseStrike = abilityOf('strike', { id: abilityId('gm-strike'), name: 'GM Strike' }, RULES);
    const explicitTrue = abilityOf('strike', { id: abilityId('gm-strike'), name: 'GM Strike', ticks: { ...defaultTicks('strike', 'true') } }, RULES);
    const R = rulesOf({ fight: { damageTypes: { 'gm-strike': 'true' } } });
    expect(abilityWorth(baseStrike, R).worth).toBeCloseTo(abilityWorth(explicitTrue, RULES).worth, 9);

    // Custom defense-ignoring type (defenceOf returns null) prices identically to true across weigh, landWorth, and statusWorth
    const custom = 'void' as DamageType;
    const customAbility = abilityOf('strike', { id: abilityId('void-strike'), name: 'Void Strike', effect: { type: custom, by: 'hand', formula: f('1d8 + phys') } }, RULES);
    expect(abilityWorth(customAbility, RULES).worth).toBeCloseTo(abilityWorth(explicitTrue, RULES).worth, 9);
    const customStatus: StatusDef = { label: 'Void', desc: '', ops: [{ op: 'damage', type: custom, amount: f('1d6'), when: 'turn' }] };
    const trueStatus: StatusDef = { label: 'True', desc: '', ops: [{ op: 'damage', type: 'true', amount: f('1d6'), when: 'turn' }] };
    expect(defWorth(customStatus, RULES).worth).toBeCloseTo(defWorth(trueStatus, RULES).worth, 9);
    const customTrig: StatusDef = { label: 'T', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: custom, amount: f('10'), when: 'use' }] }] };
    const trueTrig: StatusDef = { label: 'T', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'true', amount: f('10'), when: 'use' }] }] };
    expect(wornWorth(customTrig, RULES).worth).toBeCloseTo(wornWorth(trueTrig, RULES).worth, 9);
  });
});

describe('grievous wounds and antiHealWorth (R4)', () => {
  test('a share-on-healed healing cut is weighed via kit.antiHealWorth, scales with pct up to kit.shareCap, and is not unweighed', () => {
    const K = RULES.fight.kit;
    const gw = defWorth(BUILT_IN_STATUSES.grievous, RULES);
    expect(gw.unweighed).toEqual([]);
    expect(gw.worth).toBeCloseTo(0.4 * K.antiHealWorth * K.referenceRounds, 9);
    expect(gw.over).toBe(false);

    const cutOf = (pct: number): StatusDef => ({ label: 'Cut', desc: '', ops: [{ op: 'share', on: 'healed', pct }] });
    expect(defWorth(cutOf(-20), RULES).worth).toBeCloseTo(gw.worth / 2, 9);
    expect(defWorth(cutOf(-50), RULES).worth).toBeCloseTo(K.shareCap * K.antiHealWorth * K.referenceRounds, 9);
    expect(defWorth(cutOf(-80), RULES).worth).toBeCloseTo(defWorth(cutOf(-50), RULES).worth, 9);
    // Grievous Wounds (key 'grievous') scales up to 90% even when shareCap is 0.5
    expect(defWorth(cutOf(-90), RULES, 'C', 'grievous').worth).toBeCloseTo(0.9 * K.antiHealWorth * K.referenceRounds, 9);
    expect(defWorth(cutOf(-95), RULES, 'C', 'grievous').worth).toBeCloseTo(0.9 * K.antiHealWorth * K.referenceRounds, 9);

    // Positive healed share and other share targets remain unweighed
    expect(defWorth(cutOf(20), RULES).unweighed).toEqual(['share']);
    expect(defWorth(BUILT_IN_STATUSES.marked, RULES).unweighed).toEqual(['share']);

    // GM override of fight.kit.antiHealWorth scales worth proportionally
    const doubleR = rulesOf({ fight: { kit: { antiHealWorth: K.antiHealWorth * 2 } } });
    expect(defWorth(BUILT_IN_STATUSES.grievous, doubleR).worth).toBeCloseTo(gw.worth * 2, 9);
  });
});

describe('hp shorthand and missing mean weighing (R6)', () => {
  test('target.hp and missing are weighed at missingMean from kit.reference instead of flagging count', () => {
    const bruteHp = monsterSheet('C', 'brute', 'normal', RULES).hpMax;
    const mean = missingMean('strike', 'C', RULES);
    const pctHp = of('strike', { effect: { type: 'physical', by: 'hand', formula: f('0.1 * target.hp') } });
    const flat = of('strike', { effect: { type: 'physical', by: 'hand', formula: f(String(0.1 * bruteHp * (1 - mean))) } });
    const w = abilityWorth(pctHp, RULES);
    expect(w.unweighed).toEqual([]);
    expect(w.worth).toBeCloseTo(abilityWorth(flat, RULES).worth, 9);
  });
});

// ── the bar agrees with the simulation (notes-worth.md) ──
// The simulation is the authority: it plays the real reducer. Each example kit is played against the tank (the duel its
// bolt decides; against the speed build and the cannon the bolt is cast 1.5 times a fight and the rows move by noise),
// both openings, 150 fights each, less its plain build in the same fights: the kit row's measure of
// tests/fight-sim.test.ts. The bar's word on the same kit is its worth over the worth of the ability it replaces (Arc
// Bolt, which is also a curse's budget, `standardHeld`), less 1. Stated tolerance 0.1: one band of the tolerance (0.08)
// plus the noise floor of a difference of two win shares at 300 fights each (about 0.035) less what both share. The
// verdicts must also agree: past +0.08 the bar warns exactly when the simulation's row is out.
describe('the bar agrees with the simulation on the example kits', () => {
  const START = { lines: [null, null], adjacent: [place(0, 2), place(0, 3)] } as const;
  const FIGHTS = 150, AGREE = 0.1, TOLERANCE = RULES.fight.kit.tolerance;
  const foe = (s: SimRow): SimRow => ({ ...s, row: { ...s.row, side: 'foe' } });
  const at = (s: SimRow, p: (typeof START)['lines'][number] | (typeof START)['adjacent'][number]): SimRow => ({ ...s, row: { ...s.row, place: p } });
  const wins = (a: Archetype, rank: 'C' | 'S', R: Rules): number => {
    let won = 0;
    for (const o of ['lines', 'adjacent'] as const) for (let seed = 1; seed <= FIGHTS; seed++) {
      const r = playFight({ rows: [at(hunter(a, rank, a, R), START[o][0]), at(foe(hunter('tank', rank, 'tank', R)), START[o][1])], rules: R }, seed);
      if (r.winner === 'party') won++;
    }
    return won / (2 * FIGHTS);
  };
  const withLever = (kit: 'blood' | 'mark', share: number): Rules => {
    const ex = RULES.fight.kit.examples;
    return { ...RULES, fight: { ...RULES.fight, kit: { ...RULES.fight.kit, examples: { ...ex, [kit]: { ...ex[kit], share } } } } } as Rules;
  };
  const CASES = [
    { kit: 'blood', ability: 'bloodletting', shares: [0.7, RULES.fight.kit.examples.blood.share, 1] },
    { kit: 'mark', ability: 'stroke', shares: [RULES.fight.kit.examples.mark.share, 1] },
  ] as const;
  for (const rank of ['C', 'S'] as const) {
    test(`at ${rank}, Bloodletting and Disaster Stroke at the examples' shares and either side: the bar within ${AGREE} of the simulation, the same verdict`, () => {
      const plain = wins('cannon', rank, RULES), bolt = abilityWorth(builtIns(RULES).arcBolt, RULES, { rank }).worth;
      for (const c of CASES) for (const share of c.shares) {
        const R = withLever(c.kit, share), w = abilityWorth(abilities(R)[c.ability], R, { rank });
        const bar = w.worth / bolt - 1, sim = wins(c.kit, rank, R) - plain;
        expect([c.kit, share, Math.abs(bar - sim) <= AGREE]).toEqual([c.kit, share, true]);
        expect([c.kit, share, w.over]).toEqual([c.kit, share, sim > TOLERANCE]);
      }
    }, 120_000);
  }
});
