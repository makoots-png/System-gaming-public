// Proactive ability copy (Wave 5 Hook H3: src/core/combat/usurp.ts, fight.ts:landed, fight-parse.ts,
// ability-kinds.ts, worth.ts). Every expected damage number, status duration, log line, parser round-trip, and
// description/worth line is derived independently from the rules so any mutation breaks a pin.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import type { Stats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { average, parseFormula } from '../src/core/formula.ts';
import type { Formula } from '../src/core/formula.ts';
import { fightId } from '../src/core/ids.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import type { Ability, AbilityKind, CombatantId } from '../src/core/combat/ability-types.ts';
import { lasting, modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, Op, Origin, Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { afterDefence, kitOf } from '../src/core/combat/land.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { tallyOf } from '../src/core/combat/row-tally.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import type { Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { reduce, reduceAll } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow, Opening, Running } from '../src/core/combat/fight.ts';
import { needs } from '../src/core/combat/resolve.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { parseAbility, parseFight } from '../src/core/combat/fight-parse.ts';
import { monsterRows } from '../src/core/combat/rows.ts';
import { landingMove, mythicStep } from '../src/core/combat/mythic.ts';
import type { MythicStanding, OmenKey } from '../src/core/combat/mythic-types.ts';
import { isRefused } from '../src/core/save-step.ts';
import { USURP_AMP_MIN, usurpCopy } from '../src/core/combat/usurp.ts';
import { abilityOf, describeAbility, formulaOf } from '../src/core/registry/ability-kinds.ts';
import { SKILL_ABILITIES } from '../src/core/registry/abilities.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { mythicMove } from '../src/core/registry/mythic-moves.ts';
import { abilityWorth, worthLine } from '../src/core/registry/worth.ts';
import { lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';

const ctx: Ctx = { rules: RULES };
const ROUND = RULES.fight.round;
const f = (text: string): Formula => {
  const p = parseFormula(text, RULES);
  if (!p.ok) throw new Error(p.error);
  return p.formula;
};
const id = combatantId;
const FAR = { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as const;

const ability = (kind: AbilityKind, name: string, text: string | null, o: Partial<Ability> = {}): Ability => {
  const a = abilityOf(kind, { id: abilityId(name), name }, RULES);
  return {
    ...a,
    effect: text === null ? null : { type: a.effect!.type, by: 'hand', formula: f(text) },
    ...o,
  };
};

const hunterOrigin = (o: Partial<Stats> = {}, level = 1): Origin => ({
  kind: 'hunter',
  build: { stats: { ...baseStats(RULES.fight), ...o }, level, gear: kitGear('light', RULES), perks: {} },
});

function makeNewRow(name: string, side: Side, o: RowPatch<NewRow> = {}): NewRow {
  const { kind: k, hp, ...rest } = o;
  const origin = o.origin ?? hunterOrigin();
  const hpMax = modified(origin, o.statuses ?? [], RULES).sheet.hpMax;
  const kind = k ?? (side === 'party' ? 'hunter' : 'monster');
  return {
    id: id(name), name, side, ...lifeAt(kind, hp ?? hpMax), origin, tier: 0, place: null, mana: 50, fatigue: 0,
    shield: null, stagger: null, channel: null, threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {},
    abilities: [], intent: null, holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null,
    xp: 0, mythic: null, ...rest,
  } as NewRow;
}

function makeBody(name: string, side: Side, o: RowPatch<NewRow> = {}, at = place(0, 0)): Body {
  const nr = makeNewRow(name, side, o);
  const { stats, sheet } = modified(nr.origin, nr.statuses, RULES);
  return { ...nr, place: at, stats, sheet, speed: sheet.speed, at: tick(0), tie: 0 };
}

const openings = (...list: [string, number][]): Opening[] => list.map(([name, d20]) => ({ id: id(name), d20, tie: 0 }));
const rolls = (react: Record<string, number> = {}, dice: Record<string, number[]> = {}): Rolls =>
  ({ dice: dice as Rolls['dice'], react: react as Rolls['react'] });

function angelBody(at: 'calm' | 'omen' | 'faltering', omenName?: 'weighed' | 'stars' | 'note'): Body {
  const seed = seedMonsters(RULES).find(m => m.script === 'angel-of-the-last-trumpet')!;
  const nr = monsterRows(seed, [id('angel')], RULES)[0]!;
  if (nr.kind !== 'monster') throw new Error('expected monster row');
  const { stats, sheet } = modified(nr.origin, nr.statuses, RULES);
  let mythic: MythicStanding | null = nr.mythic;
  if (mythic && at !== 'calm') {
    const ann = mythicStep(mythic, { type: 'announce', omen: (omenName ?? 'weighed') as OmenKey, aim: id('U'), hpAt: sheet.hpMax, barAt: nr.stagger });
    if (isRefused(ann)) throw new Error(ann.why);
    mythic = ann;
    if (at === 'faltering') {
      const weak = mythicStep(mythic, { type: 'weaken', how: 'burst', back: tick(0) });
      if (isRefused(weak)) throw new Error(weak.why);
      mythic = weak;
    }
  }
  return { ...nr, place: place(5, 5), stats, sheet, speed: sheet.speed, at: tick(0), tie: 0, mythic };
}

function expectedDealt(user: Body, target: Body, copied: Ability, amp: number, R: Rules = RULES): number {
  const form = formulaOf(copied, R)!;
  const scope = { user: { stats: user.stats, sheet: user.sheet }, target: { stats: target.stats, sheet: target.sheet }, charge: 0, kit: kitOf(user, target, R) };
  const clampedAmp = Math.min(R.fight.kit.critSizeMax, Math.max(USURP_AMP_MIN, amp));
  const raw = average(form, scope) * clampedAmp;
  const type = copied.effect!.type;
  if (type === 'heal' || type === 'shield') return 0;
  return afterDefence(raw, type, user.sheet, target.sheet, R);
}

describe('usurpCopy: target move selection and exact scaled damage', () => {
  test('selects the foe damaging ability with the highest average on the user body, not the foe body, and deals exact amp-scaled damage', () => {
    const user = makeBody('Usurper', 'party', { origin: hunterOrigin({ pow: 40, str: 10 }, 20) });
    const physStrike = ability('strike', 'Heavy Bash', '1d8 + phys');
    const arcCurse = ability('curse', 'Void Bolt', '1d8 + mag');
    const healMove = ability('support', 'Mend', '999', { effect: { type: 'heal', by: 'hand', formula: f('999') } });
    const nullMove = ability('support', 'Roar', null);
    const foe = makeBody('Brute', 'foe', {
      origin: hunterOrigin({ str: 50, pow: 10 }, 20),
      abilities: [healMove, physStrike, nullMove, arcCurse],
    });

    const res = usurpCopy(user, foe, 1.25, tick(500), RULES)!;
    expect(res).not.toBeNull();
    expect(res.fromOmen).toBe(false);
    expect(res.copied.id).toBe(arcCurse.id);
    const want = expectedDealt(user, foe, arcCurse, 1.25);
    expect(res.dealt).toBe(want);
    expect(rowHp(res.target)).toBe(Math.max(0, rowHp(foe) - want));
  });

  test('breaks equal formula averages by list order and evaluates by-rule formulas', () => {
    const user = makeBody('Usurper', 'party', { origin: hunterOrigin({ str: 20, pow: 20 }, 10) });
    const first = abilityOf('curse', { id: abilityId('first-bolt'), name: 'First Bolt' }, RULES);
    const second = abilityOf('curse', { id: abilityId('second-bolt'), name: 'Second Bolt' }, RULES);
    const foe = makeBody('Caster', 'foe', { abilities: [first, second] });

    const res = usurpCopy(user, foe, 1, tick(0), RULES)!;
    expect(res.copied.id).toBe(first.id);
    expect(res.dealt).toBe(expectedDealt(user, foe, first, 1));
  });

  test('returns null when the foe has no damaging ability and no standing omen', () => {
    const user = makeBody('Usurper', 'party');
    const healOnly = makeBody('Healer', 'foe', {
      abilities: [
        ability('support', 'Heal', '30', { effect: { type: 'heal', by: 'hand', formula: f('30') } }),
        ability('support', 'Shield', '30', { effect: { type: 'shield', by: 'hand', formula: f('30') } }),
        ability('support', 'Wait', null),
      ],
    });
    const empty = makeBody('Empty', 'foe', { abilities: [] });
    expect(usurpCopy(user, healOnly, 1.25, tick(0), RULES)).toBeNull();
    expect(usurpCopy(user, empty, 1.25, tick(0), RULES)).toBeNull();
  });

  test('clamps amp to USURP_AMP_MIN (0.1) .. R.fight.kit.critSizeMax', () => {
    const user = makeBody('Usurper', 'party', { origin: hunterOrigin({ pow: 30 }, 20) });
    const bolt = ability('curse', 'Bolt', '100');
    const foe = makeBody('Target', 'foe', { hp: 500, abilities: [bolt] });

    const low = usurpCopy(user, foe, 0.01, tick(0), RULES)!;
    const atMin = usurpCopy(user, foe, USURP_AMP_MIN, tick(0), RULES)!;
    expect(low.dealt).toBe(atMin.dealt);
    expect(low.dealt).toBe(expectedDealt(user, foe, bolt, 0.1));

    const high = usurpCopy(user, foe, 9, tick(0), RULES)!;
    const atMax = usurpCopy(user, foe, RULES.fight.kit.critSizeMax, tick(0), RULES)!;
    expect(high.dealt).toBe(atMax.dealt);
    expect(high.dealt).toBe(expectedDealt(user, foe, bolt, RULES.fight.kit.critSizeMax));
    expect(high.dealt).toBeGreaterThan(low.dealt);
  });
});

describe('usurpCopy: mythic standing omen, faltering omen, calm fallback, and sanitization', () => {
  test('copies the standing omen full move via mythicMove and hard-caps its 2-round control status to kit.wardRounds even with high potency', () => {
    const user = makeBody('Usurper', 'party', { origin: hunterOrigin({ pow: 60, agi: 40, ctl: 80, pre: 80 }, 70), tier: 5 });
    const angel = angelBody('omen', 'weighed');
    const now = tick(2000);
    const maxTicks = RULES.fight.kit.wardRounds * ROUND;
    const res = usurpCopy(user, angel, 1.25, now, RULES)!;

    expect(res.fromOmen).toBe(true);
    expect(res.copied.name).toBe('Weighed and Found Wanting');

    const lm = landingMove(angel.mythic!)!;
    const o = angel.origin as Extract<Origin, { kind: 'monster' }>;
    const built = mythicMove(lm.key, lm.move, { rank: o.rank, archetype: o.archetype, kind: o.monsterKind, tweak: o.tweak }, RULES);
    expect(res.dealt).toBe(expectedDealt(user, angel, built, 1.25));
    expect(rowHp(res.target)).toBe(Math.max(Math.ceil(0.65 * angel.sheet.hpMax), rowHp(angel) - res.dealt));

    const para = res.target.statuses.find(s => s.key === statusKey('paralyzed'));
    expect(para).toBeDefined();
    expect(para!.until).not.toBeNull();
    expect(para!.until! - now).toBeLessThanOrEqual(maxTicks);
  });

  test('hard-caps stolen control statuses at kit.wardRounds even when user potency exceeds target tenacity', () => {
    const user = makeBody('Usurper', 'party', { origin: hunterOrigin({ pow: 40, ctl: 90, pre: 90 }, 70), tier: 5 });
    const foe = makeBody('Caster', 'foe', {
      origin: hunterOrigin({ pow: 30, str: 10, dis: 10 }, 40),
      abilities: [
        ability('curse', 'Mind Lock', '30', {
          ops: [{ op: 'applyStatus', key: statusKey('paralyzed'), def: RULES.conditions.paralyzed, duration: tick(2 * ROUND) }],
        }),
      ],
    });
    const maxTicks = RULES.fight.kit.wardRounds * ROUND;
    // Prove potency > tenacity so an unscaled base clamp of 1 round would exceed wardRounds after landStatus.
    expect(user.sheet.potency).toBeGreaterThan(foe.sheet.tenacity);
    expect(lasting(RULES.conditions.paralyzed, tick(maxTicks), user.tier, user.sheet.potency, foe.sheet.tenacity)).toBeGreaterThan(maxTicks);

    const now = tick(1000);
    const res = usurpCopy(user, foe, 1, now, RULES)!;
    const para = res.target.statuses.find(s => s.key === statusKey('paralyzed'));
    expect(para).toBeDefined();
    expect(para!.until).not.toBeNull();
    expect(para!.until! - now).toBeLessThanOrEqual(maxTicks);
    expect(para!.until! - now).toBeGreaterThan(0);
  });

  test('copies the weakened move when the standing omen is faltering, and falls back to abilities when calm', () => {
    const user = makeBody('Usurper', 'party', { origin: hunterOrigin({ pow: 60 }, 70), tier: 5 });
    const faltering = angelBody('faltering', 'weighed');
    const weakRes = usurpCopy(user, faltering, 1, tick(0), RULES)!;
    expect(weakRes.fromOmen).toBe(true);
    expect(weakRes.copied.name).toBe('Found Wanting');
    expect(weakRes.gained).toContain(statusKey('slowed'));

    const calm = angelBody('calm');
    const calmRes = usurpCopy(user, calm, 1, tick(0), RULES)!;
    expect(calmRes.fromOmen).toBe(false);
    expect(calm.abilities.map(a => a.id)).toContain(calmRes.copied.id);
  });

  test('strips mythic-* statuses (Crescendo and boss phase passives) from copied ops while keeping normal statuses', () => {
    const user = makeBody('Usurper', 'party', { origin: hunterOrigin({ pow: 60 }, 70), tier: 5 });
    const crescendoDef: StatusDef = { label: 'Crescendo', desc: '', ops: [{ op: 'share', on: 'dealt', pct: 50 }] };
    const shellDef: StatusDef = { label: 'Shell of a Thousand Years', desc: '', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 15 } }] };
    const toxicAbility = ability('curse', 'Fake Doom', '40', {
      ops: [
        { op: 'applyStatus', key: statusKey('mythic-crescendo'), def: crescendoDef, duration: tick(5 * ROUND) },
        { op: 'applyStatus', key: statusKey('mythic-shell'), def: shellDef, duration: tick(5 * ROUND) },
        { op: 'applyStatus', key: statusKey('burning'), def: RULES.conditions.burning, duration: tick(3 * ROUND) },
      ],
    });
    const foe = makeBody('Boss', 'foe', { origin: hunterOrigin({ vit: 40 }, 70), abilities: [toxicAbility] });
    const res = usurpCopy(user, foe, 1, tick(1000), RULES)!;
    expect(res.gained).toEqual([statusKey('burning')]);
    expect(res.target.statuses.some(s => s.key === statusKey('mythic-crescendo'))).toBe(false);
    expect(res.target.statuses.some(s => s.key === statusKey('mythic-shell'))).toBe(false);
    expect(res.target.statuses.find(s => s.key === statusKey('burning'))?.until).toBe(tick(1000 + RULES.fight.kit.wardRounds * ROUND));
  });

  test('clamps long, indefinite (null), and tiered durations to kit.wardRounds without extending shorter durations', () => {
    const userT0 = makeBody('Usurper', 'party', { tier: 0 });
    const userT3 = makeBody('Usurper', 'party', { tier: 3 });
    const burnDef = RULES.conditions.burning;
    const tieredAb = ability('curse', 'Layered Flame', '20', {
      ops: [
        { op: 'applyStatus', key: statusKey('short-burn'), def: burnDef, duration: tick(500) },
        { op: 'applyStatus', key: statusKey('eternal-burn'), def: burnDef, duration: null },
        { op: 'applyStatus', key: statusKey('tiered-burn'), def: burnDef, duration: [tick(400), tick(800), tick(1500), tick(2500), tick(3000), tick(4000)] },
      ],
    });
    const foe = makeBody('Target', 'foe', { hp: 400, abilities: [tieredAb] });
    const now = tick(1000);

    const r0 = usurpCopy(userT0, foe, 1, now, RULES)!;
    expect(r0.target.statuses.find(s => s.key === statusKey('short-burn'))?.until).toBe(tick(1500));
    expect(r0.target.statuses.find(s => s.key === statusKey('eternal-burn'))?.until).toBe(tick(2000));
    expect(r0.target.statuses.find(s => s.key === statusKey('tiered-burn'))?.until).toBe(tick(1400));

    const r3 = usurpCopy(userT3, foe, 1, now, RULES)!;
    expect(r3.target.statuses.find(s => s.key === statusKey('tiered-burn'))?.until).toBe(tick(2000));

    const twoRounds: Rules = { ...RULES, fight: { ...RULES.fight, kit: { ...RULES.fight.kit, wardRounds: 2 } } };
    const rTwo = usurpCopy(userT3, foe, 1, now, twoRounds)!;
    expect(rTwo.target.statuses.find(s => s.key === statusKey('eternal-burn'))?.until).toBe(tick(3000));
    expect(rTwo.target.statuses.find(s => s.key === statusKey('tiered-burn'))?.until).toBe(tick(3000));
  });
});

describe('fight.ts:landed wiring, stripping, log format, triggers, and replay determinism', () => {
  const hijack = (o: Partial<Ability> = {}): Ability => ability('curse', 'Hijack', '10', {
    ...FAR,
    delivery: { kind: 'direct' },
    usurp: { amp: 1.25 },
    ...o,
  });

  test('lands copied damage and status on caught foe, logs one usurp line, emits only one used effect, strips zone/summon/move/zoneAct/raise, and replays deterministically', () => {
    const H = hijack();
    const loadedFoeMove = ability('blast', 'Cataclysmic Rite', '40', {
      ...FAR,
      ops: [
        { op: 'applyStatus', key: statusKey('burning'), def: RULES.conditions.burning, duration: tick(3 * ROUND) },
        { op: 'shove', dir: 'away', from: 'user', tiles: 2 },
        { op: 'delay', ticks: tick(500) },
      ],
      zone: { name: 'Scorched Ground', duration: tick(3 * ROUND), ops: RULES.conditions.burning.ops, endsWithOwner: false, around: null, grow: null },
      summon: { name: 'Imp', archetype: 'skirmisher', rounds: 2, statuses: [] },
      move: { kind: 'blink' },
      zoneAct: { act: 'erase', name: null, by: 1 },
      raise: { bonus: 5, maxRisen: 2, elitePerFight: 1 },
    });

    const setupCmds: Command[] = [
      {
        type: 'add', fightId: fightId('f-usurp'), openings: [],
        rows: [
          makeNewRow('Usurper', 'party', { origin: hunterOrigin({ pow: 30 }, 15), place: place(2, 2), abilities: [H] }),
          makeNewRow('Warlock', 'foe', { origin: hunterOrigin({ vit: 40 }, 70), place: place(6, 2), abilities: [loadedFoeMove] }),
        ],
      },
      { type: 'start', openings: openings(['Usurper', 20], ['Warlock', 1]) },
    ];
    // Roll react = 5 so Warlock is caught without critting (1 < 5 < resistDc 12).
    const actCmd: Command = { type: 'act', by: id('Usurper'), ability: H.id, aim: id('Warlock'), rolls: rolls({ Warlock: 5 }) };

    const setupFight = reduceAll(null, setupCmds, ctx).fight as Running;
    const parsedSetup = parseFight(JSON.parse(JSON.stringify(setupFight)), RULES) as Running;
    const run1 = reduce(setupFight, actCmd, ctx);
    expect(reduce(parsedSetup, actCmd, ctx)).toEqual(run1);

    const f1 = run1.fight as Running;
    expect(f1.phase).toBe('running');
    // Zero extra rolls asked for the copied ability.
    const needed = needs(H, setupFight.rows[0]!, setupFight.rows, id('Warlock'), setupFight.grid, setupFight.now, RULES);
    expect(needed.dice[id('Warlock')]).toEqual([]);
    expect(needed.react).toEqual([id('Warlock')]);

    // Exactly one `used` effect (no second toast on combat.js).
    expect(run1.effects.filter(e => e.type === 'used')).toHaveLength(1);

    // Stripped: no zones placed, no summon created, neither combatant moved.
    expect(f1.zones).toEqual([]);
    expect(f1.rows).toHaveLength(2);
    expect(f1.rows.find(r => r.id === id('Usurper'))!.place).toEqual(place(2, 2));
    expect(f1.rows.find(r => r.id === id('Warlock'))!.place).toEqual(place(6, 2));

    // Exact damage = Hijack's own 10 (after resist) + usurpCopy's 1.25 * 40 (after resist).
    const uBefore = setupFight.rows.find(r => r.id === id('Usurper'))!;
    const wBefore = setupFight.rows.find(r => r.id === id('Warlock'))!;
    const hijackDealt = afterDefence(10, 'arcane', uBefore.sheet, wBefore.sheet, RULES);
    const usurpDealt = expectedDealt(uBefore, wBefore, loadedFoeMove, 1.25);
    const uAfter = f1.rows.find(r => r.id === id('Usurper'))!;
    const wAfter = f1.rows.find(r => r.id === id('Warlock'))!;
    expect(rowHp(wAfter)).toBe(rowHp(wBefore) - hijackDealt - usurpDealt);

    // Event ruling: copy adds nothing to tally.dealt (only Hijack's own hit counts) and no extra threat beyond Hijack's decayed 10.
    expect(tallyOf(uAfter).dealt).toBe(hijackDealt);
    const expectedThreat = 10 * uBefore.sheet.threat * Math.pow(1 - RULES.fight.threatDecay, (f1.now - setupFight.now) / ROUND);
    expect(wAfter.threat?.[id('Usurper')]).toBeCloseTo(expectedThreat, 6);

    // Burning applied and clamped to 1 round; no delay/shove applied.
    const burn = wAfter.statuses.find(s => s.key === statusKey('burning'));
    expect(burn?.until).toBe(tick(setupFight.now + RULES.fight.kit.wardRounds * ROUND));

    // Log contains the exact usurp phrase.
    expect(f1.log.some(l => l.text.includes(`Usurper usurps Cataclysmic Rite (Warlock ${usurpDealt})`))).toBe(true);

    // Real replay pin: serialized post-usurp fight round-trips through parseFight identically.
    expect(parseFight(JSON.parse(JSON.stringify(f1)), RULES)).toEqual(f1);
  });

  test('does not fire when the foe resists, dodges, or dies to the initial hit', () => {
    const H = hijack();
    const foeHit = ability('curse', 'Doom Ray', '80');

    // Case 1: direct curse resisted (d20 = 20 always resists).
    const resisted = reduceAll(null, [
      {
        type: 'add', fightId: fightId('f-res'), openings: [],
        rows: [
          makeNewRow('Usurper', 'party', { abilities: [H] }),
          makeNewRow('Mage', 'foe', { hp: 200, abilities: [foeHit] }),
        ],
      },
      { type: 'start', openings: openings(['Usurper', 20], ['Mage', 1]) },
      { type: 'act', by: id('Usurper'), ability: H.id, aim: id('Mage'), rolls: rolls({ Mage: 20 }) },
    ], ctx);
    expect((resisted.fight as Running).log.some(l => l.text.includes('usurps'))).toBe(false);

    // Case 2: target dies to Hijack's own initial hit (1 HP foe).
    const killedFirst = reduceAll(null, [
      {
        type: 'add', fightId: fightId('f-dead'), openings: [],
        rows: [
          makeNewRow('Usurper', 'party', { abilities: [H] }),
          makeNewRow('Imp', 'foe', { hp: 1, abilities: [foeHit] }),
        ],
      },
      { type: 'start', openings: openings(['Usurper', 20], ['Imp', 1]) },
      { type: 'act', by: id('Usurper'), ability: H.id, aim: id('Imp'), rolls: rolls({ Imp: 1 }) },
    ], ctx);
    expect(killedFirst.fight!.phase).toBe('ended');
    expect(killedFirst.fight!.log.some(l => l.text.includes('usurps'))).toBe(false);
  });

  test('fires kill and imposed triggers when usurp finishes off a foe or applies a harmful status', () => {
    const H = hijack({ effect: { type: 'arcane', by: 'hand', formula: f('5') }, delivery: { kind: 'sure' } });
    const crownDef: StatusDef = {
      label: 'Stolen Crown', desc: '', ops: [],
      triggers: [
        { on: 'kill', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'heal', amount: f('20'), when: 'use' }] },
        { on: 'imposed', tag: null, to: 'self', limit: { kind: 'round' }, ops: [{ op: 'shield', amount: f('15') }] },
      ],
    };
    const crown: Status = { key: statusKey('usurp-crown'), def: crownDef, source: { id: id('Usurper'), tier: 0 }, until: null, since: tick(0), settledAt: tick(0), worn: true };
    const foeBurn = ability('curse', 'Searing Hex', '60', {
      ops: [{ op: 'applyStatus', key: statusKey('burning'), def: RULES.conditions.burning, duration: tick(2 * ROUND) }],
    });

    // Foe at 30 HP survives Hijack's 5 dmg, then dies to usurp's 1.25 * 60 dmg -> triggers kill heal on wounded Usurper.
    const killRun = reduceAll(null, [
      {
        type: 'add', fightId: fightId('f-kill'), openings: [],
        rows: [
          makeNewRow('Usurper', 'party', { hp: 20, statuses: [crown], abilities: [H] }),
          makeNewRow('Foe', 'foe', { hp: 30, abilities: [foeBurn] }),
        ],
      },
      { type: 'start', openings: openings(['Usurper', 20], ['Foe', 1]) },
      { type: 'act', by: id('Usurper'), ability: H.id, aim: id('Foe'), rolls: rolls() },
    ], ctx);
    expect(killRun.fight!.phase).toBe('ended');
    expect(rowHp(killRun.fight!.rows.find(r => r.id === id('Usurper'))!)).toBe(40);

    // Foe with high max HP survives both and receives burning -> triggers imposed shield on Usurper.
    const impRun = reduceAll(null, [
      {
        type: 'add', fightId: fightId('f-imp'), openings: [],
        rows: [
          makeNewRow('Usurper', 'party', { statuses: [crown], abilities: [H] }),
          makeNewRow('Foe', 'foe', { origin: hunterOrigin({ vit: 40 }, 70), abilities: [foeBurn] }),
        ],
      },
      { type: 'start', openings: openings(['Usurper', 20], ['Foe', 1]) },
      { type: 'act', by: id('Usurper'), ability: H.id, aim: id('Foe'), rolls: rolls() },
    ], ctx);
    const uAfter = (impRun.fight as Running).rows.find(r => r.id === id('Usurper'))!;
    expect(uAfter.shield?.amount).toBe(15);
  });

  test('usurps every caught foe in an AoE while sparing allies and dodging foes', () => {
    const aoeHijack = ability('blast', 'Mass Hijack', '5', {
      aim: 'place',
      range: tiles(12),
      shape: { kind: 'radius', radius: tiles(2), ring: null },
      delivery: { kind: 'sure' },
      foesOnly: false,
      usurp: { amp: 1 },
    });
    const f1Move = ability('curse', 'Hex A', '30');
    const f2Move = ability('curse', 'Hex B', '40');
    const allyMove = ability('curse', 'Ally Blast', '90');

    const run = reduceAll(null, [
      {
        type: 'add', fightId: fightId('f-aoe'), openings: [],
        rows: [
          makeNewRow('Usurper', 'party', { origin: hunterOrigin({ pow: 20 }, 20), place: place(1, 1), abilities: [aoeHijack] }),
          makeNewRow('Ally', 'party', { origin: hunterOrigin({ vit: 40 }, 70), place: place(6, 5), abilities: [allyMove] }),
          makeNewRow('FoeA', 'foe', { origin: hunterOrigin({ vit: 40 }, 70), place: place(5, 5), abilities: [f1Move] }),
          makeNewRow('FoeB', 'foe', { origin: hunterOrigin({ vit: 40 }, 70), place: place(7, 5), abilities: [f2Move] }),
        ],
      },
      { type: 'start', openings: openings(['Usurper', 20], ['Ally', 10], ['FoeA', 2], ['FoeB', 1]) },
      { type: 'act', by: id('Usurper'), ability: aoeHijack.id, aim: place(6, 5), rolls: rolls() },
    ], ctx);

    const f1 = run.fight as Running;
    expect(run.effects.filter(e => e.type === 'used')).toHaveLength(1);
    expect(f1.log.some(l => l.text.includes('Usurper usurps Hex A (FoeA'))).toBe(true);
    expect(f1.log.some(l => l.text.includes('Usurper usurps Hex B (FoeB'))).toBe(true);
    expect(f1.log.some(l => l.text.includes('Usurper usurps Ally Blast'))).toBe(false);

    // A travel blast that a fast foe dodges (avoid === 'out') does not usurp.
    const dodgable = ability('blast', 'Slow Hijack', '5', {
      aim: 'place',
      range: tiles(12),
      shape: { kind: 'radius', radius: tiles(1), ring: null },
      delivery: { kind: 'travel', windup: tick(ROUND), speed: 'instant' },
      foesOnly: true,
      usurp: { amp: 1 },
    });
    const dodgeRun = reduceAll(null, [
      {
        type: 'add', fightId: fightId('f-dodge'), openings: [],
        rows: [
          makeNewRow('Usurper', 'party', { place: place(1, 1), abilities: [dodgable] }),
          makeNewRow('Runner', 'foe', { origin: hunterOrigin({ agi: 40, vit: 40 }, 70), place: place(6, 5), abilities: [f1Move] }),
        ],
      },
      { type: 'start', openings: openings(['Usurper', 20], ['Runner', 1]) },
      { type: 'act', by: id('Usurper'), ability: dodgable.id, aim: place(6, 5), rolls: rolls({ Runner: 20 }) },
    ], ctx);
    expect((dodgeRun.fight as Running).log.some(l => l.text.includes('usurps'))).toBe(false);
  });

  test('usurps a mythic boss standing omen in a real fight without creating its zone or copying Crescendo', () => {
    const H = hijack({ delivery: { kind: 'sure' } });
    const seed = seedMonsters(RULES).find(m => m.script === 'angel-of-the-last-trumpet')!;
    const angelRow = monsterRows(seed, [id('angel')], RULES)[0]!;
    if (angelRow.kind !== 'monster') throw new Error('expected monster row');
    // Advance angel standing to `stars` (has Fallen stars zone + 2r burning).
    const ann = mythicStep(angelRow.mythic!, { type: 'announce', omen: 'stars' as OmenKey, aim: place(2, 2), hpAt: 500, barAt: angelRow.stagger });
    if (isRefused(ann)) throw new Error(ann.why);

    const setup = reduceAll(null, [
      {
        type: 'add', fightId: fightId('f-angel'), openings: [],
        rows: [
          makeNewRow('Usurper', 'party', { origin: hunterOrigin({ pow: 50 }, 70), tier: 5, place: place(2, 2), abilities: [H] }),
          { ...angelRow, place: place(4, 2), mythic: ann },
        ],
      },
      { type: 'start', openings: openings(['Usurper', 20], [angelRow.id, 1]) },
    ], ctx);
    const f0 = setup.fight as Running;
    const after = reduce(f0, { type: 'act', by: id('Usurper'), ability: H.id, aim: angelRow.id, rolls: rolls() }, ctx);
    const f1 = after.fight as Running;
    expect(f1.zones).toEqual([]);
    expect(f1.log.some(l => l.text.includes('Usurper usurps Stars Fall'))).toBe(true);
    expect(after.effects.filter(e => e.type === 'used')).toHaveLength(1);
    const angelAfter = f1.rows.find(r => r.id === angelRow.id)!;
    const burn = angelAfter.statuses.find(s => s.key === statusKey('burning'));
    expect(burn?.until).toBe(tick(f0.now + RULES.fight.kit.wardRounds * ROUND));
  });
});

describe('parseAbility, describeAbility, and abilityWorth for usurp', () => {
  test('parseAbility round-trips usurp with toEqual, clamps amp bounds, refuses malformed usurp, and omits key when absent', () => {
    const withUsurp = ability('curse', 'Hijack', '1d8 + mag', { usurp: { amp: 1.25 } });
    const parsed = parseAbility(JSON.parse(JSON.stringify(withUsurp)), RULES);
    expect(parsed).toEqual(withUsurp);

    const low = parseAbility({ ...withUsurp, usurp: { amp: 0.01 } }, RULES);
    expect(low?.usurp).toEqual({ amp: USURP_AMP_MIN });
    const high = parseAbility({ ...withUsurp, usurp: { amp: 10 } }, RULES);
    expect(high?.usurp).toEqual({ amp: RULES.fight.kit.critSizeMax });

    expect(parseAbility({ ...withUsurp, usurp: null }, RULES)).toBeNull();
    expect(parseAbility({ ...withUsurp, usurp: {} }, RULES)).toBeNull();
    expect(parseAbility({ ...withUsurp, usurp: { amp: 'fast' } }, RULES)).toBeNull();
    expect(parseAbility({ ...withUsurp, usurp: { amp: Number.NaN } }, RULES)).toBeNull();

    const plain = ability('curse', 'Plain Bolt', '1d8 + mag');
    // A reaction without usurp parses; pairing react + usurp is refused (`fight-react.ts` never copies).
    expect(parseAbility({ ...plain, react: { when: 'after', reach: tiles(0) } }, RULES)).not.toBeNull();
    expect(parseAbility({ ...withUsurp, react: { when: 'after', reach: tiles(0) } }, RULES)).toBeNull();
    const plainParsed = parseAbility(JSON.parse(JSON.stringify(plain)), RULES)!;
    expect(plainParsed).toEqual(plain);
    expect('usurp' in plainParsed).toBe(false);

    // Shipped built-in skills round-trip identically with no usurp key added.
    for (const make of Object.values(SKILL_ABILITIES)) {
      const a = make(RULES);
      if (!a) continue;
      const rt = parseAbility(JSON.parse(JSON.stringify(a)), RULES)!;
      expect('usurp' in rt).toBe(false);
      expect(Object.keys(rt)).toEqual(Object.keys(a));
      expect(rt).toEqual(a);
    }
  });

  test('describeAbility adds the exact usurp sentence in wave2Lines and omits it when absent', () => {
    const a = ability('curse', 'Hijack', '1d8 + mag', { usurp: { amp: 1.25 } });
    expect(describeAbility(a, RULES)).toContain("Copies and unleashes the foe's omen or strongest attack at 125% power.");
    const plain = ability('curse', 'Bolt', '1d8 + mag');
    expect(describeAbility(plain, RULES).some(l => l.includes('Copies and unleashes'))).toBe(false);
  });

  test('abilityWorth names usurp in unweighed and worthLine names copying a foe ability', () => {
    const a = ability('curse', 'Hijack', '1d8 + mag', { usurp: { amp: 1.25 } });
    const w = abilityWorth(a, RULES);
    expect(w.unweighed).toEqual(['usurp']);
    expect(worthLine(w)).toContain('Not estimated: copying a foe ability. Test it in a fight.');
    const plain = ability('curse', 'Bolt', '1d8 + mag');
    expect(abilityWorth(plain, RULES).unweighed).toEqual([]);
  });
});
