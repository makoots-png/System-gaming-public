import { describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { parseOverrides } from '../src/core/overrides.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear, sheetOf } from '../src/core/hunter/derive.ts';
import { average, printFormula } from '../src/core/formula.ts';
import type { Scope } from '../src/core/formula.ts';
import { formulaOf, abilityOf, averages, checkGap, defaultTicks, describeAbility, gapOf, KINDS, paceOf, recommended, sampleBody, tagsOf, ticksOf } from '../src/core/registry/ability-kinds.ts';
import { cost } from '../src/core/combat/timeline.ts';
import type { Ticks } from '../src/core/registry/ability-kinds.ts';
import { abilityId, tag } from '../src/core/combat/ability-types.ts';
import type { Ability, AbilityEffect, AbilityKind } from '../src/core/combat/ability-types.ts';
import { againstEach, scalerMean, SCALER_NAMES, suggestScaler } from '../src/core/registry/scalers.ts';
import type { Scaler, ScalerName } from '../src/core/registry/scalers.ts';
import { parseAbility } from '../src/core/combat/fight-parse.ts';
import { tiles } from '../src/core/combat/space.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';

const KIND_LIST = Object.keys(KINDS) as AbilityKind[];
/** Scaler sets the round trips walk: none, an execute, and a giant slayer from 2 to 1 with a desperate from 30%. */
const SCALER_SETS: readonly (readonly Scaler[])[] = [
  [], [{ measure: 'target', dir: 'under', start: 0.5, scale: 1 }],
  [{ measure: 'maxPair', dir: 'over', start: 2 / 3, scale: 0.25 }, { measure: 'user', dir: 'under', start: 0.3, scale: 0.6 }],
];
const TYPES: readonly AbilityEffect['type'][] = ['physical', 'arcane', 'true', 'heal', 'shield'];

// A C bruiser on a C body, so every power and stat a formula reads is above 0.
const user = { stats: { ...baseStats(RULES.fight), str: 63, pow: 63, pre: 63 }, sheet: sheetOf({ stats: { ...baseStats(RULES.fight), str: 63, pow: 63, pre: 63 }, level: 20, gear: kitGear('medium', RULES), perks: {} }, RULES) };
const target = { stats: baseStats(RULES.fight), sheet: sheetOf({ stats: baseStats(RULES.fight), level: 20, gear: kitGear('medium', RULES), perks: {} }, RULES) };
const at = (charge: number): Scope => ({ user, target, charge });

describe('every kind\'s recommended formulas', () => {
  test('parse for every tick the maker offers', () => {
    const failed: string[] = [];
    for (const kind of KIND_LIST) for (const type of TYPES) for (const scale of [null, 'str', 'ins'] as const)
      for (const gap of [null, gapOf(type, kind)]) for (const channel of [null, 'linear', 'exponential'] as const) for (const scalers of SCALER_SETS) {
        const ticks: Ticks = { scale, type, pace: KINDS[kind].pace, gap, channel, scalers };
        try { recommended(kind, ticks, RULES); } catch (e) { failed.push(`${kind} ${JSON.stringify(ticks)}: ${String(e)}`); }
      }
    expect(failed).toEqual([]);
  });

  test('read as the design writes them: dice plus the power of the damage type, times the cost\'s share of the budget', () => {
    const text = (kind: AbilityKind, t: Partial<Ticks> = {}): string => recommended(kind, { ...defaultTicks(kind, t.type), ...t }, RULES).text;
    expect(text('strike')).toBe('1d8 + phys');
    expect(text('shot')).toBe('0.7 * (1d8 + phys)');
    expect(text('blast')).toBe('1.5 * (2d8 + mag)');
    expect(text('curse')).toBe('1d8 + mag');
    expect(text('support')).toBe('1.5 * sup');
    expect(text('strike', { type: 'arcane' })).toBe('1d8 + mag');
    expect(text('strike', { scale: null })).toBe('1d8');
  });

  test('a quick ability deals 0.7 of a standard one\'s damage and a heavy one 1.5 (design 3.3)', () => {
    const avg = (kind: AbilityKind): number => average(recommended(kind, defaultTicks(kind, 'physical'), RULES).formula, at(0));
    expect(avg('shot') / avg('strike')).toBeCloseTo(0.7, 10);
    const blast = average(recommended('blast', defaultTicks('blast'), RULES).formula, at(0));
    const curse = average(recommended('curse', { ...defaultTicks('curse'), scale: null }, RULES).formula, at(0));
    expect(blast).toBeCloseTo(1.5 * (9 + user.sheet.mag), 10);
    expect(curse).toBe(4.5);
  });

  test('a channel grows linear to 3.5 times at a charge of 5, and exponential by 1.45 a charge (design 4.1)', () => {
    const f = (channel: 'linear' | 'exponential'): number[] => [0, 5].map(c => average(recommended('strike', { ...defaultTicks('strike'), channel }, RULES).formula, at(c)));
    const [lin0, lin5] = f('linear'), [exp0, exp5] = f('exponential');
    expect(lin5! / lin0!).toBeCloseTo(3.5, 10);
    expect(exp5! / exp0!).toBeCloseTo(1.45 ** 5, 10);
  });

  test('a stat gap adds 10% a point the user is over the target, up to double (the owner\'s example)', () => {
    const gap = recommended('strike', { ...defaultTicks('strike'), scale: null, gap: gapOf('physical') }, RULES).formula;
    const over = (str: number): number => average(gap, { user: { ...user, stats: { ...user.stats, str } }, target, charge: 0 });
    expect([over(5), over(10), over(13), over(20), over(60)]).toEqual([4.5, 4.5, 4.5 * 1.3, 9, 9]);
  });
});

describe('the ticks of the formula field', () => {
  const text = (kind: AbilityKind, t: Partial<Ticks> = {}): string => recommended(kind, { ...defaultTicks(kind, t.type), ...t }, RULES).text;

  test('scaling with another of the eight stats writes the power curve out, so a point of it buys what a point of the type\'s own stat buys', () => {
    expect(text('strike', { scale: 'ins' })).toBe('1d8 + 6 * (ins / 10)^0.8');
    expect(text('curse', { scale: 'pow' })).toBe('1d8 + mag');
    // phys is 0.6 * eff(str) (design 2.2): the same body with its points in Instinct deals the same with the Instinct formula
    const byIns = average(recommended('strike', { ...defaultTicks('strike'), scale: 'ins' }, RULES).formula, { user: sampleBody('C', 'ins', RULES), target, charge: 0 });
    const byStr = average(recommended('strike', defaultTicks('strike'), RULES).formula, { user: sampleBody('C', 'str', RULES), target, charge: 0 });
    expect(byIns).toBeCloseTo(byStr, 10);
  });

  test('arcane damage is aimed at Resist and reads mag; the picked pace sets the share of the budget and the time', () => {
    expect(text('strike', { type: 'arcane' })).toBe('1d8 + mag');
    expect(text('strike', { pace: 'heavy' })).toBe('1.5 * (1d8 + phys)');
    expect(abilityOf('strike', { id: abilityId('s'), name: 's', ticks: { pace: 'quick' } }, RULES).cost.time as number).toBe(70);
  });

  test('the ticks of every recommended formula read back from the ability it makes; a typed one has none', () => {
    const missed: string[] = [];
    for (const kind of KIND_LIST) for (const type of TYPES) for (const scale of [null, 'str', 'agi', 'pow', 'pre'] as const)
      for (const gap of [null, { ...gapOf(type), cap: 0.5 }]) for (const channel of [null, 'exponential'] as const) for (const pace of ['quick', 'heavy'] as const)
      for (const scalers of SCALER_SETS) {
        const ticks: Ticks = { scale, type, pace, gap, channel, scalers };
        const a = abilityOf(kind, { id: abilityId('x'), name: 'x', ticks }, RULES);
        const back = ticksOf(a, RULES);
        if (recommended(kind, back ?? defaultTicks(kind), RULES).text !== recommended(kind, ticks, RULES).text) missed.push(`${kind} ${JSON.stringify(ticks)}`);
      }
    expect(missed).toEqual([]);
    const typed = abilityOf('strike', { id: abilityId('x'), name: 'x', effect: { type: 'physical', by: 'hand', formula: recommended('strike', { ...defaultTicks('strike'), scale: null }, RULES).formula } }, RULES);
    expect(ticksOf({ ...typed, effect: { type: 'physical', by: 'hand', formula: { kind: 'number', value: 7 } } }, RULES)).toBeNull();
  });

  test('an ability whose time no pace has reads one pace on the maker\'s chip and in its ticks: the chip\'s (paceOf)', () => {
    let read = 0;
    for (const kind of KIND_LIST) {
      const a = abilityOf(kind, { id: abilityId('x'), name: 'x', ticks: defaultTicks(kind) }, RULES), odd = { ...a, cost: { ...a.cost, time: cost(a.cost.time + 7) } };
      const back = ticksOf(odd, RULES);
      if (back) { read++; expect(back.pace, kind).toBe(paceOf(odd.cost.time, RULES)); }
    }
    expect(read, 'some kind\'s ticks still read back').toBeGreaterThan(0);
  });

  test('a gap insists on a cap above 0 and two different stats', () => {
    expect(checkGap(gapOf('arcane'))).toBeNull();
    expect(checkGap({ ...gapOf('arcane'), cap: 0 })).toContain('needs a cap');
    expect(checkGap({ ...gapOf('arcane'), cap: Number.NaN })).toContain('needs a cap');
    expect(checkGap({ ...gapOf('arcane'), theirs: 'pow' })).toContain('two different stats');
  });

  test('the preview\'s averages are at E, C and S on a normal brute, grow with rank, and a hit loses some to Armor', () => {
    const rows = averages(recommended('strike', defaultTicks('strike'), RULES).formula, 'physical', 'str', RULES);
    expect(rows.map(r => r.rank)).toEqual(['E', 'C', 'S']);
    // 1d8 averages 4.5; the rest is the sample body's phys
    expect(rows[1]!.average).toBeCloseTo(4.5 + sampleBody('C', 'str', RULES).sheet.phys, 10);
    expect(rows[0]!.average < rows[1]!.average && rows[1]!.average < rows[2]!.average).toBe(true);
    for (const r of rows) expect(r.dealt! >= 1 && r.dealt! < r.average).toBe(true);
    expect(averages(recommended('support', defaultTicks('support'), RULES).formula, 'shield', 'pre', RULES)[0]!.dealt).toBeNull();
  });
});

describe('an ability that follows the recommended formula (implicit audit 3, M2)', () => {
  // a stat that is not the type's own is written out as `powerK * statBase * (stat / statBase)^effExp` (scaleTerm)
  const agile = abilityOf('strike', { id: abilityId('x'), name: 'Lunge', ticks: { ...defaultTicks('strike'), scale: 'agi' } }, RULES);
  const typed = { ...agile, effect: { type: 'physical', by: 'hand', formula: formulaOf(agile, RULES)! } } as const;
  const keener = rulesOf({ fight: { powerK: 0.9 } });

  test('a GM\'s change of a rule the recommendation reads reaches an ability by the rule; one typed by hand stays as typed', () => {
    expect(agile.effect?.by).toBe('rule');
    expect(printFormula(formulaOf(agile, RULES)!)).toBe('1d8 + 6 * (agi / 10)^0.8');
    expect(printFormula(formulaOf(agile, keener)!)).toBe('1d8 + 9 * (agi / 10)^0.8');
    expect(printFormula(formulaOf(typed, keener)!)).toBe('1d8 + 6 * (agi / 10)^0.8');
  });

  test('a saved ability by the rule reads back with its ticks, so the maker opens it unmarked under any rules; one from before `by` reads as typed', () => {
    const back = parseAbility(JSON.parse(JSON.stringify(agile)), RULES)!;
    expect(back.effect).toEqual({ type: 'physical', by: 'rule', ticks: { scale: 'agi', gap: null, scalers: [] } });
    expect(ticksOf(back, keener)).toEqual({ ...defaultTicks('strike'), scale: 'agi' });
    const old = { ...JSON.parse(JSON.stringify(typed)), effect: { type: 'physical', formula: JSON.parse(JSON.stringify(typed.effect.formula)) } };
    expect(parseAbility(old, RULES)!.effect).toEqual(typed.effect);
  });
});

describe('each kind\'s defaults (design 3.3)', () => {
  const of = (kind: AbilityKind) => abilityOf(kind, { id: abilityId(kind), name: kind }, RULES);

  test('a strike is a touch of reach 1, wound up 100 ticks and instant, physical and standard', () => {
    const a = of('strike');
    expect([a.shape, a.delivery, a.effect?.type, a.cost.time, a.range]).toEqual([{ kind: 'touch', reach: 1 }, { kind: 'travel', windup: 100, speed: 'instant' }, 'physical', 100, 1]);
  });

  test('a shot is a line of width 0, wound up 100 ticks, travelling 80 tiles a round, range 12 and quick', () => {
    const a = of('shot');
    expect([a.shape, a.delivery, a.range, a.cost.time]).toEqual([{ kind: 'line', width: 0, pierce: false }, { kind: 'travel', windup: 100, speed: 80 }, 12, 70]);
  });

  test('a blast is a radius 2 with a ring to 3 at 50%, wound up 1000 ticks and instant, range 10 and heavy', () => {
    const a = of('blast');
    expect([a.shape, a.delivery, a.range, a.cost.time]).toEqual([{ kind: 'radius', radius: 2, ring: { outer: 3, share: 50 } }, { kind: 'travel', windup: 1000, speed: 'instant' }, 10, 150]);
  });

  test('a curse is direct, range 8 and arcane', () => {
    const a = of('curse');
    expect([a.delivery, a.range, a.effect?.type]).toEqual([{ kind: 'direct' }, 8, 'arcane']);
  });

  test('a support aims at an ally, is sure and deals no damage', () => {
    const a = of('support');
    expect([a.aim, a.delivery, a.effect?.type === 'heal' || a.effect?.type === 'shield']).toEqual(['ally', { kind: 'sure' }, true]);
  });

  test('an ability keeps what its maker set and marks a typed formula as edited', () => {
    const typed = { type: 'physical', by: 'hand', formula: recommended('strike', { ...defaultTicks('strike'), scale: null }, RULES).formula } as const;
    const a = abilityOf('strike', { id: abilityId('x'), name: 'Jab', range: 2 as never, effect: typed }, RULES);
    expect([a.range, a.effect, a.effect?.by, of('strike').effect?.by]).toEqual([2, typed, 'hand', 'rule']);
  });

  test('a GM\'s override of a kind\'s numbers reaches the ability the maker starts', () => {
    const { overrides, refused } = parseOverrides({ fight: { abilityKinds: { blast: { windup: 400, radius: 3, ring: 4, mana: 8 } } } });
    const a = abilityOf('blast', { id: abilityId('b'), name: 'Blast' }, rulesOf(overrides));
    expect(refused).toEqual([]);
    expect([a.delivery, a.shape, a.cost.mana]).toEqual([{ kind: 'travel', windup: 400, speed: 'instant' }, { kind: 'radius', radius: 3, ring: { outer: 4, share: 50 } }, 8]);
  });

  test('ticking a channel makes a channel that grows to the rules\' cap of 5', () => {
    expect(abilityOf('blast', { id: abilityId('m'), name: 'Meteor', ticks: { channel: 'exponential' } }, RULES).channel).toEqual({ growth: 'exponential', max: 5 });
  });
});

describe('what an ability is, as tags (keystones K0)', () => {
  const of = (kind: AbilityKind, o: Partial<Ability> = {}): Ability => ({ ...abilityOf(kind, { id: abilityId(kind), name: kind }, RULES), ...o });

  test('an ability\'s kind is one of its tags', () => {
    for (const kind of Object.keys(KINDS) as AbilityKind[]) expect([kind, tagsOf(of(kind)).includes(tag(kind))]).toEqual([kind, true]);
  });

  test('a blast and a curse are spells; a strike, a shot and a support are not', () => {
    const spells = (Object.keys(KINDS) as AbilityKind[]).filter(k => tagsOf(of(k)).includes(tag('spell')));
    expect(spells).toEqual(['blast', 'curse']);
  });

  test('a channelled ability is a channel; the same ability unchannelled is not', () => {
    const meteor = abilityOf('blast', { id: abilityId('m'), name: 'Meteor', ticks: { channel: 'linear' } }, RULES);
    expect([tagsOf(meteor).includes(tag('channel')), tagsOf({ ...meteor, channel: null }).includes(tag('channel'))]).toEqual([true, false]);
  });

  test('the GM\'s own tags follow what the ability is, each once, and none is stored on the ability', () => {
    const a = of('strike', { tags: [tag('sword'), tag('strike')] });
    expect([tagsOf(a), a.tags]).toEqual([[tag('strike'), tag('sword')], [tag('sword'), tag('strike')]]);
    expect(of('strike').tags).toBeUndefined();
  });
});

describe('an ability in sentences (the ability maker\'s preview)', () => {
  const of = (kind: AbilityKind, ticks: Partial<Ticks> = {}) => abilityOf(kind, { id: abilityId(kind), name: kind, ticks }, RULES);

  test('a blast says its area and ring and that a target can move out of it in the round it takes to land', () => {
    // RULES.fight.abilityKinds.blast: radius 2, ring to 3 at 50%, range 10, wound up 1000 ticks (a round)
    expect(describeAbility(of('blast'), RULES)).toEqual([
      'Hits everyone within 2 tiles of a point up to 10 tiles away, and for 50% effect in an outer ring out to 3 tiles.',
      'Can be dodged. It lands 1 round after use. The target can move as far as its speed allows before it hits.',
    ]);
  });

  test('a curse is resisted by Discipline, a support is not avoided, and a channel says how it grows and breaks', () => {
    expect(describeAbility(of('curse'), RULES)[1]).toBe('Resisted by Discipline. It does not travel, so the target cannot dodge it. The roll compares the target\'s Will with the user\'s Accuracy.');
    expect(describeAbility(of('support'), RULES)[1]).toBe('An ally does not avoid it.');
    expect(describeAbility({ ...of('shot'), delivery: { kind: 'sure' } }, RULES)[1]).toBe('Cannot be avoided.');
    // channelExp 1.45, channelMax 5, breakShare 0.5 (RULES.fight)
    expect(describeAbility(of('blast', { channel: 'exponential' }), RULES)[2]).toBe('Can be channeled. It grows 1.45 times a turn, up to 5 charge. A stun, root, taunt, or hard hit fires it early at 50% charge.');
  });

  test('a kit\'s prices, gates, tags and summon each say what they ask (kits design 5.1)', () => {
    const pact = statusKey('crimson-pact'), pain = statusKey('pain');
    const a = { ...of('curse'), tags: [tag('blood'), tag('ultimate')],
      prices: [{ kind: 'hp', amount: { kind: 'share', share: 0.1 } }, { kind: 'stacks', key: pain, from: 'self', take: { kind: 'all' } }] as const,
      gates: [{ kind: 'holds', key: pact, on: 'self', atLeast: 1 }, { kind: 'uses', per: 'gate', n: 1 }] as const,
      summon: { name: 'Sprite', archetype: 'skirmisher', rounds: 2, statuses: [] } as const };
    expect(describeAbility(a, RULES).slice(2)).toEqual([
      'Costs 10% of your max HP. Cannot be used at that HP or less.', 'Costs all pain stacks from you.', 'Usable only while you have crimson pact.', '1 use per gate.',
      'Tags: blood, ultimate.', `Summons a Sprite (skirmisher, your rank) for 2 rounds. At most ${RULES.fight.kit.summons} active at once.`,
    ]);
  });
});

describe('the conditional scalers, in place of the execute (kits design 8.0)', () => {
  const EXECUTE: Scaler = { measure: 'target', dir: 'under', start: 0.5, scale: 1 };
  const kit = (target: number, mine = 0) => ({ stacks: { user: {}, target: {} }, field: {}, missing: { user: mine, target }, held: {}, hits: 0, kills: 0, spent: 0 });

  test('an execute from half HP at scale 1 is the design\'s text with the rest cut to 0.8, and adds up to +100% at 0 HP, linear from half', () => {
    const r = recommended('strike', { ...defaultTicks('strike'), scale: null, scalers: [EXECUTE] }, RULES);
    expect(r.text).toBe('1d8 * 0.8 * (1 + 1 * max(0, min(1, (target.missing - 0.5) / 0.5)))');
    const at = (missing: number) => average(r.formula, { user, target, charge: 0, kit: kit(missing) });
    expect([0, 0.5, 0.75, 1].map(at)).toEqual([4.5 * 0.8, 4.5 * 0.8, 4.5 * 0.8 * 1.5, 4.5 * 0.8 * 2]);
  });

  test('the suggestion starts at half and its scale is table 8.0.2\'s: 1 for a share, 0.25 a giant slayer, 0.30 or 0.35 a cull, 0.5 an underdog, 0.30 or 0.35 a bully (0.30 on a strike at a tolerance of 0.08)', () => {
    const want: Record<ScalerName, Record<'strike' | 'shot' | 'curse' | 'blast', number>> = {
      execute: { strike: 1, shot: 1, curse: 1, blast: 1 }, opener: { strike: 1, shot: 1, curse: 1, blast: 1 },
      desperate: { strike: 1, shot: 1, curse: 1, blast: 1 }, steady: { strike: 1, shot: 1, curse: 1, blast: 1 },
      giantSlayer: { strike: 0.25, shot: 0.25, curse: 0.25, blast: 0.25 }, cull: { strike: 0.3, shot: 0.35, curse: 0.35, blast: 0.35 },
      underdog: { strike: 0.5, shot: 0.5, curse: 0.5, blast: 0.5 }, bully: { strike: 0.3, shot: 0.35, curse: 0.35, blast: 0.35 },
    };
    for (const name of SCALER_NAMES) for (const kind of ['strike', 'shot', 'curse', 'blast'] as const) {
      const s = suggestScaler(kind, name, RULES);
      expect([name, kind, s.start, s.scale]).toEqual([name, kind, 0.5, want[name][kind]]);
    }
  });

  test('the base cut keeps a use at its plain budget over the reference dungeon: table 8.0.2\'s means at C', () => {
    const mean = (kind: AbilityKind, name: ScalerName) => scalerMean(suggestScaler(kind, name, RULES), kind, 'C', RULES).mean;
    expect(mean('strike', 'execute')).toBeCloseTo(0.25, 10);
    expect(mean('strike', 'giantSlayer')).toBeCloseTo(0.14, 2);
    expect(mean('strike', 'cull')).toBeCloseTo(0.04, 2);
    expect(mean('shot', 'underdog')).toBeCloseTo(0.28, 2);
    expect(mean('curse', 'bully')).toBeCloseTo(0.06, 2);
    expect(recommended('strike', { ...defaultTicks('strike'), scalers: [suggestScaler('strike', 'giantSlayer', RULES)] }, RULES).text).toContain('* 0.88 *');
  });

  test('a suggested scaler stays within the tolerance against a pack and a boss alone at E, C and S; a GM\'s past it does not', () => {
    for (const name of SCALER_NAMES) for (const kind of ['strike', 'shot', 'curse', 'blast'] as const) for (const rank of ['E', 'C', 'S'] as const) {
      const e = againstEach([suggestScaler(kind, name, RULES)], kind, rank, RULES);
      expect([name, kind, rank, Math.max(e.normal, e.boss) <= 1 + RULES.fight.kit.tolerance + 1e-9]).toEqual([name, kind, rank, true]);
    }
    const hot = againstEach([{ measure: 'maxPair', dir: 'over', start: 0.5, scale: 1 }], 'strike', 'C', RULES);
    expect(hot.boss).toBeGreaterThan(1 + RULES.fight.kit.tolerance);
  });

  test('a stored ability with scalers and the kits\' names reads back through the fight\'s parser as it was', () => {
    const a = abilityOf('curse', { id: abilityId('x'), name: 'x', ticks: { scalers: [EXECUTE, { measure: 'hpPair', dir: 'under', start: 0.5, scale: 0.35 }] } }, RULES);
    const named = { ...a, effect: { type: 'arcane' as const, by: 'hand', formula: { kind: 'binary' as const, op: '*' as const, left: formulaOf(a, RULES)!, right: { kind: 'stacks' as const, whose: 'target' as const, key: statusKey('hemo-plague') } } } };
    for (const x of [a, named]) expect(parseAbility(JSON.parse(JSON.stringify(x)), RULES)).toEqual(x);
  });

  test('wave 2\'s parts of an ability read back as written: a blink, a reaction, a zone act, a gate inside a zone (kits design 8.3 to 8.8)', () => {
    const a = { ...abilityOf('strike', { id: abilityId('parry'), name: 'Parry' }, RULES), move: { kind: 'blink' as const }, react: { when: 'before' as const, reach: tiles(1) },
      zoneAct: { act: 'shift' as const, name: 'Aura', by: 4 }, gates: [{ kind: 'inside' as const, zone: 'Aura' }] };
    expect(parseAbility(JSON.parse(JSON.stringify(a)), RULES)).toEqual(a);
    expect(parseAbility({ ...JSON.parse(JSON.stringify(a)), zoneAct: { act: 'grow', name: null, by: 9 } }, RULES)?.zoneAct).toEqual({ act: 'grow', name: null, by: RULES.fight.kit.zoneGrow });
    expect(parseAbility({ ...JSON.parse(JSON.stringify(a)), react: { when: 'sometimes', reach: 1 } }, RULES)).toBeNull();
  });

  test('a scale typed past the cap is held at the cap, and a start at an end moves inside it', () => {
    const r = recommended('strike', { ...defaultTicks('strike'), scale: null, scalers: [{ ...EXECUTE, scale: 3, start: 1 }] }, RULES);
    expect(r.text).toContain(`${RULES.fight.kit.scaleCap} * max(0, min(1,`);
    expect(r.text).not.toContain('/ 1)');
  });

  test('the preview says each scaler: up to +100% against a target under half its HP; a giant slayer whole at 4 times yours', () => {
    const a = abilityOf('strike', { id: abilityId('x'), name: 'x', ticks: { scalers: [EXECUTE, { measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.25 }] } }, RULES);
    expect(describeAbility(a, RULES).slice(-2)).toEqual([
      'Up to +100% against a target under half of its HP.', 'Up to +25% against a target with more max HP than yours, reaching max at 4 times yours.',
    ]);
  });
});

describe('wave 2\'s parts of an ability in sentences (kits design 8.12)', () => {
  test('a blink, a reaction with its guard and a zone act each say what they do', () => {
    const of = (kind: AbilityKind) => abilityOf(kind, { id: abilityId(kind), name: kind }, RULES);
    expect(describeAbility({ ...of('support'), aim: 'place', range: tiles(12), move: { kind: 'blink' } }, RULES)).toContain(`Teleports to a tile you can see within ${RULES.fight.kit.blinkMax} tiles.`);
    expect(describeAbility({ ...of('strike'), react: { when: 'before', reach: tiles(0) }, ops: [{ op: 'guard', share: 0.3 }] }, RULES))
      .toContain('Reaction (before a foe\'s ability lands on you, reducing strike damage by 30%). Its action time delays your next turn.');
    expect(describeAbility({ ...of('blast'), zoneAct: { act: 'grow', name: 'Aura', by: 2 } }, RULES)).toContain('Widens your Aura by 2 tiles.');
  });
});
