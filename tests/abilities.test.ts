import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { RANKS, RULES, rulesOf } from '../src/core/rules.ts';
import { parseOverrides } from '../src/core/overrides.ts';
import type { Rank } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import type { StatKey } from '../src/core/stats.ts';
import { ARCHETYPES, NO_TWEAK, kitGear, pointsAt, split } from '../src/core/hunter/derive.ts';
import type { Archetype, Kit, MonsterKind } from '../src/core/hunter/derive.ts';
import { diceOf, mean, parseFormula, printFormula } from '../src/core/formula.ts';
import { openGrid, place } from '../src/core/combat/space.ts';
import type { Place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import { atTier } from '../src/core/combat/op-amount.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import type { Body, Origin, Status, StatusDef, UseOp } from '../src/core/combat/effect-ops.ts';
import { diceFor, resolve } from '../src/core/combat/resolve.ts';
import { formulaOf, abilityOf, kindDefaults } from '../src/core/registry/ability-kinds.ts';
import { TIER_BUDGET } from '../src/core/registry/paths.ts';
import { LOOT_ITEMS, SHOP_ITEMS, STARTER_GEAR } from '../src/core/registry/items.ts';
import type { ItemDef } from '../src/core/registry/items.ts';
import { SKILL_SEEDS } from '../src/core/registry/skills.ts';
import { iid } from './fixtures/ids.ts';
import { ARCHETYPE_ATTACKS, ATTACK_ID, SKILL_ABILITIES, itemAbility, itemAbilityId, itemOfAbility, weaponAttack } from '../src/core/registry/abilities.ts';
import type { BuiltInSkill, SkillRules, Weapon } from '../src/core/registry/abilities.ts';
import { parseAbility, parseFight } from '../src/core/combat/fight-parse.ts';
import { reduce } from '../src/core/combat/fight.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { newHunter } from '../src/core/save.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';

// Hasted and Stealth as plan section 3.1 restates them; W1a puts them in RULES.conditions.
const CONDITIONS: SkillRules['conditions'] = {
  hasted: { label: 'Hasted', desc: 'Faster, with a chance of a turn back.', ops: [{ op: 'speed', pct: [20, 25, 30, 35, 40, 50] }, { op: 'refund', pct: 50, chance: 25 }] },
  stealth: { label: 'Stealth', desc: 'Hidden from view.', ops: [] },
};
const R = { ...RULES, conditions: CONDITIONS };

const WEAPONS: Weapon[] = [...SHOP_ITEMS, ...LOOT_ITEMS, ...Object.values(STARTER_GEAR) as ItemDef[]]
  .flatMap(i => i.type === 'weapon' ? [{ name: i.name, dice: i.dice, attack: /bow\b/i.test(i.name) ? 'shot' as const : 'strike' as const }] : []);
const SKILLS = Object.keys(SKILL_ABILITIES) as BuiltInSkill[];
const ARCHETYPE_LIST = Object.keys(ARCHETYPES) as Archetype[];

/** Every built-in ability with who may use it: a hunter, or a monster of one archetype. */
type Entry = { readonly label: string; readonly ability: Ability; readonly user: 'hunter' | Archetype };
const ENTRIES: Entry[] = [
  ...ARCHETYPE_LIST.map(a => ({ label: `the ${a}'s attack`, ability: ARCHETYPE_ATTACKS[a](R), user: a })),
  ...[null, ...WEAPONS].map(w => ({ label: `the attack with ${w?.name ?? 'no weapon'}`, ability: weaponAttack(w, R), user: 'hunter' as const })),
  ...SKILLS.flatMap(s => { const a = SKILL_ABILITIES[s](R); return a ? [{ label: s, ability: a, user: 'hunter' as const }] : []; }),
];
const skill = (name: BuiltInSkill): Ability => { const a = SKILL_ABILITIES[name](R); if (!a) throw new Error(`${name} has no ability`); return a; };
const text = (a: Ability): string => a.effect ? printFormula(formulaOf(a, RULES)!) : '';

describe('every built-in ability', () => {
  test('has every field of an ability of its kind, the kind\'s fatigue and mana, a pace\'s time and a cooldown in whole rounds', () => {
    const wrong: string[] = [];
    for (const { label, ability: a } of ENTRIES) {
      const of = abilityOf(a.kind, { id: a.id, name: a.name }, R), k = kindDefaults(a.kind, R);
      // a field it leaves (`zone`) is the one optional field an ability has
      const keys = Object.keys(a).filter(k => k !== 'zone').sort();
      if (JSON.stringify(keys) !== JSON.stringify(Object.keys(of).sort()) || Object.values(a).some(v => v === undefined)) wrong.push(`${label}: fields`);
      if (a.cost.fatigue !== k.fatigue || a.cost.mana !== k.mana) wrong.push(`${label}: cost`);
      if (!Object.values(R.fight.cost).includes(a.cost.time)) wrong.push(`${label}: time ${a.cost.time}`);
      if (a.cost.cooldown % R.fight.round !== 0) wrong.push(`${label}: cooldown ${a.cost.cooldown}`);
    }
    expect(wrong).toEqual([]);
  });

  test('has a formula that reads back as the same tree from its text, as a save stores it', () => {
    const wrong = ENTRIES.filter(({ ability: a }) => {
      if (!a.effect) return false;
      const p = parseFormula(printFormula(formulaOf(a, RULES)!), R);
      return !p.ok || JSON.stringify(p.formula) !== JSON.stringify(formulaOf(a, RULES)!);
    }).map(e => e.label);
    expect(wrong).toEqual([]);
  });

  test('a hunter\'s skills have ids apart from each other and from the default attack', () => {
    const ids = [ATTACK_ID, ...SKILLS.flatMap(s => SKILL_ABILITIES[s](R)?.id ?? [])];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every active built-in skill and starter skill has its entry, and no passive one has', () => {
    const active = [...SKILL_SEEDS.filter(s => s.type === 'active').map(s => s.name), 'Shield Wall', 'Marked Shot', 'Arc Bolt'];
    expect(SKILLS.slice().sort()).toEqual(active.sort());
  });
});

// Design section 6, "the best single use with no channel": at most 60% of a same-rank tank's max HP in expectation, read
// as table 6.6 reads it: the dice at their mean, on a caught target, no crit. The builds are design 2.2's: points split 2:1
// (`split`), every perk on the main stat, in the build's kit. A hunter's ability is tried by each of the five builds; a
// monster's attack by its archetype at each kind.
describe('the single-hit bound of design section 6', () => {
  const GRID = openGrid(20, 14), NOW = tick(5000);
  const BUILDS: Record<string, readonly [StatKey, StatKey, Kit]> = {
    speed: ['agi', 'str', 'light'], tank: ['vit', 'str', 'heavy'], cannon: ['pow', 'ctl', 'light'], bruiser: ['str', 'vit', 'medium'], support: ['pre', 'dis', 'light'],
  };
  const KINDS_OF_MONSTER: MonsterKind[] = ['normal', 'elite', 'boss'];
  const tier = (rank: Rank): number => RANKS.indexOf(rank);
  const perks = (rank: Rank): number => TIER_BUDGET.slice(0, tier(rank) + 1).reduce((s, v) => s + v, 0);
  const hunter = (build: string, rank: Rank): Origin => {
    const [main, second, kit] = BUILDS[build]!, level = R.rankLevels[rank];
    const stats = split(main, second, pointsAt(level, R), R);
    return { kind: 'hunter', build: { stats: { ...stats, [main]: stats[main] + perks(rank) }, level, gear: kitGear(kit, R), perks: {} } };
  };
  const body = (id: string, origin: Origin, at: Place, side: Body['side'], rank: Rank): Body => {
    const m = modified(origin, [], R);
    return {
      id: combatantId(id), name: id, side, kind: origin.kind === 'hunter' ? 'hunter' : 'monster', origin, tier: tier(rank), stats: m.stats, sheet: m.sheet,
      place: at, life: { at: 'up', hp: m.sheet.hpMax }, mana: m.sheet.manaMax, fatigue: 0, shield: null, stagger: null, channel: null, threat: origin.kind === 'monster' ? {} : null,
      statuses: [], readyAt: {}, abilities: [], intent: null, holder: null, at: NOW, speed: m.sheet.speed, tie: 0, xp: 0, mythic: null,
    } as Body;
  };
  // A d20 of 7 is past every crit face (at most 6) and, with the edge capped at 6, under the resist roll of 15; adjacent,
  // nothing lands slowly enough to step out of.
  const D20 = 7;

  test('the tank of the bound is the paper\'s C tank of table 2.1: Vitality 63, Strength 33, others 10, in the heavy kit', () => {
    const t = modified(hunter('tank', 'C'), [], R);
    expect([t.stats.vit, t.stats.str, t.stats.agi, t.sheet.weight]).toEqual([63, 33, baseStats(R.fight).agi, R.fight.kits.heavy.weight]);
  });

  test('no damaging built-in deals more than 60% of a same-rank tank\'s max HP at mean dice, caught, without a crit', () => {
    const over: string[] = [];
    let tried = 0;
    for (const { label, ability: a, user } of ENTRIES) {
      if (a.effect?.type !== 'physical' && a.effect?.type !== 'magical') continue;
      for (const rank of RANKS) {
        const tank = body('tank', hunter('tank', rank), place(6, 5), 'foe', rank);
        const users = user === 'hunter'
          ? Object.keys(BUILDS).map(b => [b, hunter(b, rank)] as const)
          : KINDS_OF_MONSTER.map(k => [`${user} ${k}`, { kind: 'monster', name: 'Monster', rank, archetype: user, monsterKind: k, tweak: NO_TWEAK } satisfies Origin] as const);
        for (const [who, origin] of users) {
          const u = body('user', origin, place(5, 5), 'party', rank);
          const r = resolve(a, u, [u, tank], tank.id, GRID, { dice: { [tank.id]: diceOf(formulaOf(a, RULES)!).map(mean) }, react: { [tank.id]: D20 } }, NOW, R);
          tried++;
          if (!r.ok) { over.push(`${label} by a ${rank} ${who}: refused, ${r.reason}`); continue; }
          const o = r.outcomes[0]!;
          if (o.avoid !== 'caught' || o.crit) over.push(`${label} by a ${rank} ${who}: ${o.avoid}${o.crit ? ', crit' : ''}`);
          if (o.dealt > 0.6 * tank.sheet.hpMax) over.push(`${label} by a ${rank} ${who}: ${o.dealt} of ${tank.sheet.hpMax}`);
        }
      }
    }
    expect(tried).toBeGreaterThan(0);
    expect(over).toEqual([]);
  });

  test('every built-in blast that leaves a field stays inside the bound with one round of its field: the hit and the field\'s per-round damage at mean dice', () => {
    const lines: string[] = [], over: string[] = [];
    for (const m of seedMonsters(RULES)) for (const a of m.abilities) {
      if (!a.zone || (a.effect?.type !== 'physical' && a.effect?.type !== 'magical')) continue;
      const tank = body('tank', hunter('tank', m.rank), place(6, 5), 'foe', m.rank);
      // the user out of its own blast's ring, the tank at its centre
      const u = body('user', { kind: 'monster', name: 'Monster', rank: m.rank, archetype: m.archetype, monsterKind: m.kind, tweak: { ...NO_TWEAK, ...m.tweak, stats: { ...NO_TWEAK.stats, ...m.tweak.stats } } }, place(0, 5), 'party', m.rank);
      const r = resolve(a, u, [u, tank], tank.place, GRID, { dice: { [tank.id]: diceOf(formulaOf(a, RULES)!).map(mean) }, react: { [tank.id]: D20 } }, NOW, RULES);
      if (!r.ok) { over.push(`${m.name}'s ${a.name}: refused, ${r.reason}`); continue; }
      // a body in the field pays its per-round ops at the zone's tier (the user's) for the round until its next turn
      const field = a.zone.ops.reduce((n, o) => o.op === 'damage' && (o.when ?? 'turn') === 'turn' ? n + diceOf(atTier(o.amount, u.tier)).reduce((t, d) => t + mean(d), 0) : n, 0);
      const hit = r.outcomes[0]!.dealt, share = (hit + field) / tank.sheet.hpMax;
      lines.push(`${m.name}'s ${a.name} at ${m.rank}: ${hit} + ${field} of ${tank.sheet.hpMax} (${Math.round(share * 100)}%)`);
      if (share > 0.6) over.push(lines.at(-1)!);
    }
    expect(over).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
  });

  test('the bound sees an ability over it: a strike of 20d12 by a C bruiser', () => {
    const tank = body('tank', hunter('tank', 'C'), place(6, 5), 'foe', 'C'), u = body('user', hunter('bruiser', 'C'), place(5, 5), 'party', 'C');
    const heavy = weaponAttack({ name: 'Heavy', dice: '20d12', attack: 'strike' }, R);
    const r = resolve(heavy, u, [u, tank], tank.id, GRID, { dice: { [tank.id]: [130] }, react: { [tank.id]: D20 } }, NOW, R);
    expect(r.ok && r.outcomes[0]!.dealt > 0.6 * tank.sheet.hpMax).toBe(true);
  });
});

describe('each entry as plan section 3.5 and 3.3 restate it', () => {
  const round = R.fight.round;

  test('Dagger Rush is a quick strike of 2d4 at the quick share, ready again 2 rounds later', () => {
    const a = skill('Dagger Rush');
    expect([a.kind, a.cost.time, text(a), a.cost.cooldown]).toEqual(['strike', R.fight.cost.quick, '0.7 * (2d4 + phys)', 2 * round]);
  });

  test('Mutilation is a standard strike of 2d6, ready again 3 rounds later', () => {
    const a = skill('Mutilation');
    expect([a.kind, a.cost.time, text(a), a.cost.cooldown]).toEqual(['strike', R.fight.cost.standard, '2d6 + phys', 3 * round]);
  });

  test('Sprint is a quick support on its user that puts Hasted on it for 1 round and deals nothing', () => {
    const a = skill('Sprint');
    expect([a.kind, a.aim, a.shape, a.cost.time, a.effect]).toEqual(['support', 'self', { kind: 'self' }, R.fight.cost.quick, null]);
    expect(a.ops).toEqual([{ op: 'applyStatus', key: statusKey('hasted'), def: CONDITIONS.hasted, duration: tick(round) }]);
  });

  test('Stealth is a support on its user that puts Stealth on it until removed', () => {
    const a = skill('Stealth');
    expect([a.kind, a.aim, a.effect, a.ops]).toEqual(['support', 'self', null, [{ op: 'applyStatus', key: statusKey('stealth'), def: CONDITIONS.stealth, duration: null }]]);
  });

  test('Ruler\'s Authority is a physical curse that reaches 30 feet, 6 tiles', () => {
    const a = skill("Ruler's Authority");
    expect([a.kind, a.effect?.type, text(a), a.range, a.shape, a.delivery]).toEqual(['curse', 'physical', '1d8 + phys', 6, { kind: 'touch', reach: 6 }, { kind: 'direct' }]);
  });

  test('Mending Aura is a support on its user that leaves an aura of Regenerating\'s heal a round around it for 3 rounds, gone when its user goes down', () => {
    const a = skill('Mending Aura');
    expect([a.kind, a.aim, a.shape, a.effect, a.ops]).toEqual(['support', 'self', { kind: 'self' }, null, []]);
    expect(a.zone).toEqual({ name: 'Mending aura', duration: tick(3 * round), endsWithOwner: true, around: R.fight.auraRadius, grow: null, ops: [RULES.conditions.regenerating.ops[0]] });
  });

  test('Arise and Shadow Exchange have no fight ability in M2', () => {
    expect([SKILL_ABILITIES.Arise(R), SKILL_ABILITIES['Shadow Exchange'](R)]).toEqual([null, null]);
  });

  test('Shield Wall is a support with the kind\'s shield; Marked Shot a shot of 1d6; Arc Bolt a curse of 2d6', () => {
    const [wall, mark, bolt] = [skill('Shield Wall'), skill('Marked Shot'), skill('Arc Bolt')];
    expect([wall.kind, wall.effect?.type, text(wall), (wall.effect?.by === 'hand')]).toEqual(['support', 'shield', '1.5 * sup', false]);
    expect([mark.kind, text(mark), mark.cost.cooldown]).toEqual(['shot', '0.7 * (1d6 + phys)', 2 * round]);
    expect([bolt.kind, text(bolt), bolt.cost.cooldown]).toEqual(['curse', '2d6 + mag', 0]);
  });

  test('a brute strikes, a skirmisher shoots and a caster curses, each with its kind\'s own formula', () => {
    const a = ARCHETYPE_LIST.map(k => ARCHETYPE_ATTACKS[k](R));
    expect(a.map(x => [x.id, x.kind, text(x), (x.effect?.by === 'hand')])).toEqual([
      [ATTACK_ID, 'strike', '1d8 + phys', false], [ATTACK_ID, 'shot', '0.7 * (1d8 + phys)', false], [ATTACK_ID, 'curse', '1d8 + mag', false],
    ]);
  });

  test('a weapon attacks with its dice plus physical power; a bow shoots at the quick share; no weapon strikes with 1d8', () => {
    const of = (name: string): Ability => weaponAttack(WEAPONS.find(w => w.name === name)!, R);
    const dagger = of('Iron Dagger'), bow = of('Hunting Bow'), sword = of('Steel Longsword'), fist = weaponAttack(null, R);
    expect([dagger.name, dagger.kind, text(dagger), (dagger.effect?.by === 'hand')]).toEqual(['Iron Dagger', 'strike', '1d4 + phys', true]);
    expect([bow.kind, text(bow)]).toEqual(['shot', '0.7 * (1d8 + phys)']);
    expect([sword.kind, text(sword), (sword.effect?.by === 'hand')]).toEqual(['strike', '1d8 + phys', false]);
    expect([fist.name, fist.kind, text(fist)]).toEqual(['Strike', 'strike', '1d8 + phys']);
  });

  test('a weapon whose dice the rules refuse attacks with its kind\'s dice', () => {
    expect(text(weaponAttack({ name: 'Odd', dice: '', attack: 'strike' }, R))).toBe('1d8 + phys');
    expect(text(weaponAttack({ name: 'Huge', dice: '2d5000', attack: 'shot' }, R))).toBe('0.7 * (1d8 + phys)');
  });

  test('a GM\'s override of a kind\'s numbers reaches the built-in abilities', () => {
    const { overrides, refused } = parseOverrides({ fight: { abilityKinds: { strike: { fatigue: 5 }, curse: { range: 10 } } } });
    const G = { ...rulesOf(overrides), conditions: CONDITIONS };
    expect(refused).toEqual([]);
    expect([skill('Mutilation').cost.fatigue, SKILL_ABILITIES.Mutilation(G)!.cost.fatigue, ARCHETYPE_ATTACKS.caster(G).range]).toEqual([8, 5, 10]);
  });
});

describe('a consumable used in a fight', () => {
  const num = (value: number) => ({ kind: 'number', value }) as const;
  const FROSTBITE: StatusDef = { label: 'Frostbite', desc: '', ops: [{ op: 'damage', type: 'magical', amount: num(3) }] };
  const item = (name: string): ItemDef => [...SHOP_ITEMS, ...LOOT_ITEMS].find(i => i.name === name)!;
  const NOW = tick(5000);
  /** A level 1 hunter at (5, 5) with `hp`, `mana` and `fatigue`. */
  const hunterBody = (hp: number, mana: number, fatigue: number): Body => {
    const origin: Origin = { kind: 'hunter', build: { stats: baseStats(R.fight), level: 1, gear: [], perks: {} } }, m = modified(origin, [], R);
    return {
      id: combatantId('me'), name: 'Me', side: 'party', kind: 'hunter', origin, tier: 0, stats: m.stats, sheet: m.sheet, place: place(5, 5),
      life: hp >= 1 ? { at: 'up', hp } : { at: 'dead' }, mana, fatigue, shield: null, stagger: null, channel: null, threat: null, statuses: [], readyAt: {}, abilities: [], intent: null, holder: null,
      at: NOW, speed: m.sheet.speed, tie: 0, xp: 0, mythic: null,
    };
  };
  const drink = (name: string, u: Body): Body => {
    const def = item(name), a = itemAbility({ id: iid('p0'), name, rar: def.rar, ...(def.type === 'consumable' && def.rankCap ? { rankCap: true as const } : {}), effects: def.type === 'consumable' ? def.effects : [] }, R)!;
    const r = resolve(a, u, [u], u.id, openGrid(20, 14), { dice: { [u.id]: [] }, react: {} }, NOW, R);
    if (!r.ok) throw new Error(r.reason);
    return r.bodies.find(b => b.id === u.id)!;
  };

  test('a bomb is a curse on a foe that nothing avoids, deals its damage at the item\'s rarity and lands its status', () => {
    const tiered = { op: 'damage', type: 'physical', amount: [num(4), num(5), num(6), num(7), num(8), num(9)], when: 'use' } as const;
    const frost = { op: 'applyStatus', key: statusKey('frostbite'), def: FROSTBITE, duration: tick(2000) } as const;
    const a = itemAbility({ id: iid('i7'), name: 'Frost Bomb', rar: 'rare', target: 'other', effects: [tiered, frost] }, RULES)!;
    // rare is the third rarity, tier 2 (common 0 to mythic 5, design 2.3), so the tiered damage is its third value, 6
    expect([a.id, a.name, a.kind, a.aim, a.delivery, a.effect, a.ops]).toEqual([itemAbilityId('i7'), 'Frost Bomb', 'curse', 'foe', { kind: 'sure' }, { type: 'physical', by: 'hand', formula: num(6) }, [frost]]);
    expect([a.cost.fatigue, a.cost.mana, a.cost.cooldown]).toEqual([0, 0, 0]);
    expect(itemOfAbility(a)).toBe(iid('i7'));
  });

  test('an ability read from a skill or a monster is never a bag item\'s use, whatever it claims; a fight row keeps the item its use spends (implicit audit 2, N16)', () => {
    const potion = itemAbility({ id: iid('i7'), name: 'Health Potion', rar: 'common', effects: [{ op: 'heal', amount: num(30), when: 'use' }] }, RULES)!;
    const claimed = JSON.parse(JSON.stringify(potion));
    expect(parseAbility(claimed, RULES)!.item).toBeUndefined();
    const f = parseFight(JSON.parse(JSON.stringify(reduce(null, { type: 'add', fightId: fightId('f1'), rows: [{ ...hunterRow({ ...newHunter(RULES), id: 'h1', name: 'Kai' }, combatantId('c1'), RULES), abilities: [potion] }], openings: [] }, { rules: RULES }).fight)), RULES);
    expect(f!.rows[0]!.abilities[0]!.item).toBe(iid('i7'));
  });

  test('a healing salve thrown to another is a support on an ally; one that only restores its user\'s mana is no ability on another', () => {
    const salve = itemAbility({ id: iid('i8'), name: 'Salve', rar: 'common', target: 'other', effects: [{ op: 'heal', amount: num(20), when: 'use' }] }, RULES)!;
    expect([salve.kind, salve.aim, salve.effect]).toEqual(['support', 'ally', { type: 'heal', by: 'hand', formula: num(20) }]);
    expect(itemAbility({ id: iid('i9'), name: 'Mana Potion', rar: 'common', target: 'other', effects: [{ op: 'mana', amount: num(4), when: 'use' }] }, RULES)).toBeNull();
    expect(itemOfAbility(salve)).toBe(iid('i8'));
    expect(itemOfAbility({})).toBeNull();
  });

  test('a potion for its user is a support on itself that costs nothing and is ready again at once', () => {
    const a = itemAbility({ id: iid('p1'), name: 'Health Potion', rar: 'common', effects: [{ op: 'heal', amount: num(30), when: 'use' }] }, RULES)!;
    expect([a.kind, a.aim, a.shape, a.range, a.effect]).toEqual(['support', 'self', { kind: 'self' }, 0, { type: 'heal', by: 'hand', formula: num(30) }]);
    expect([a.cost.fatigue, a.cost.mana, a.cost.cooldown]).toEqual([0, 0, 0]);
  });

  test('a consumable used in a fight costs time, less than a full turn: half a standard action (the owner, Nov 22)', () => {
    const potion = itemAbility({ id: iid('p2'), name: 'Health Potion', rar: 'common', effects: [{ op: 'heal', amount: num(30), when: 'use' }] }, RULES)!;
    const bomb = itemAbility({ id: iid('p3'), name: 'Frost Bomb', rar: 'rare', target: 'other', effects: [{ op: 'damage', type: 'physical', amount: num(6), when: 'use' }] }, RULES)!;
    for (const a of [potion, bomb]) {
      expect(a.cost.time).toBeGreaterThan(0);
      expect(a.cost.time).toBeLessThan(RULES.fight.cost.standard);
      expect(a.cost.time as number).toBe(RULES.fight.cost.standard / 2);
    }
  });

  test('drunk in a fight, the shop\'s potions do what their text says to the drinker\'s row', () => {
    const me = hunterBody(10, 0, 40);
    // Health Potion heals 50% of max HP (round(0.5 * 45) = 23 -> 33), Mana Potion +4 mana, Stamina Tonic -25 fatigue, Elixir full HP
    expect(rowHp(drink('Health Potion (E)', me))).toBe(10 + Math.round(0.5 * me.sheet.hpMax));
    expect(drink('Mana Potion (E)', me).mana).toBe(Math.min(4, me.sheet.manaMax));
    expect(drink('Stamina Tonic (E)', me).fatigue).toBe(15);
    expect(drink('Stamina Tonic (E)', hunterBody(10, 0, 5)).fatigue).toBe(0);
    expect(rowHp(drink('Elixir of Life (E)', me))).toBe(me.sheet.hpMax);
  });

  test('a rank-capped self consumable carries maxTier from its rarity rank, stripped by parseAbility, and reduce refuses a higher-rank drinker with tooLow', () => {
    const capped = itemAbility({ id: iid('p9'), name: 'Health Potion (D)', rar: 'uncommon', rankCap: true, effects: [{ op: 'heal', amount: num(30), when: 'use' }] }, RULES)!;
    expect(capped.maxTier).toBe(1);
    expect(parseAbility(JSON.parse(JSON.stringify(capped)), RULES)!.maxTier).toBeUndefined();
    const bomb = itemAbility({ id: iid('b9'), name: 'Bomb', rar: 'common', rankCap: true, target: 'other', effects: [{ op: 'damage', type: 'physical', amount: num(6), when: 'use' }] }, RULES)!;
    expect(bomb.maxTier).toBeUndefined();
    const legacy = itemAbility({ id: iid('p8'), name: 'Health Potion', rar: 'common', effects: [{ op: 'heal', amount: num(30), when: 'use' }] }, RULES)!;
    expect(legacy.maxTier).toBeUndefined();

    const high = { ...hunterRow({ ...newHunter(RULES), id: 'h1', name: 'Mina', rank: 'B', life: { at: 'up', hp: 10 } }, combatantId('c1'), RULES), abilities: [capped] };
    const foe = monsterRows(seedMonsters(RULES)[0]!, [combatantId('c2')], RULES)[0]!;
    const setup = reduce(null, { type: 'add', fightId: fightId('f-cap'), rows: [high, foe], openings: [] }, { rules: RULES }).fight!;
    const running = reduce(setup, { type: 'start', openings: [{ id: combatantId('c1'), d20: 20, tie: 0 }, { id: combatantId('c2'), d20: 1, tie: 0 }] }, { rules: RULES }).fight!;
    const res = reduce(running, { type: 'act', by: combatantId('c1'), ability: capped.id, aim: combatantId('c1'), rolls: { dice: {}, react: {} } }, { rules: RULES });
    expect(res.effects).toEqual([{ type: 'refused', reason: 'tooLow' }]);
    expect(rowHp(res.fight!.rows.find(r => r.id === combatantId('c1'))!)).toBe(10);
  });

  test('a consumable whose effects are only the kits\' newer use ops is still usable in a fight, and carries each of them', () => {
    // the use ops of kits design 8.3 to 8.6, each written as the item maker saves it; none is a hit or a heal
    const newer: UseOp[] = [
      { op: 'shove', dir: 'away', from: 'user', tiles: 2 }, { op: 'move', key: 'harmful', take: 1, from: 'user', as: null },
      { op: 'hasten', share: 0.5 }, { op: 'extra' }, { op: 'guard', share: 0.5 }, { op: 'negate' }, { op: 'dispel', which: 'all' },
    ];
    for (const target of ['self', 'other'] as const) for (const op of newer) {
      const a = itemAbility({ id: iid('i3'), name: 'Odd Draught', rar: 'common', target, effects: [op] }, RULES);
      expect([target, op.op, a?.ops], 'the item is an ability holding its op').toEqual([target, op.op, [op]]);
    }
  });

  test('drunk in a fight, a draught that only dispels cures every harmful status of its drinker', () => {
    const burn: Status = { key: statusKey('burn'), def: { label: 'Burn', desc: '', ops: [{ op: 'damage', type: 'magical', amount: num(5), when: 'turn' }] }, source: { id: null, tier: 0 }, until: null, since: NOW, settledAt: NOW };
    const me = { ...hunterBody(30, 0, 0), statuses: [burn] };
    const a = itemAbility({ id: iid('p3'), name: 'Cleansing Draught', rar: 'common', effects: [{ op: 'dispel', which: 'all' }] }, R)!;
    const r = resolve(a, me, [me], me.id, openGrid(20, 14), { dice: { [me.id]: [] }, react: {} }, NOW, R);
    expect(r.ok && r.bodies[0]!.statuses).toEqual([]);
  });

  test('a potion with dice asks a player\'s phone for them, and the row gains what they rolled', () => {
    const p = parseFormula('2d4', R); if (!p.ok) throw new Error(p.error);
    const a = itemAbility({ id: iid('p2'), name: 'Mana Draught', rar: 'common', effects: [{ op: 'mana', amount: p.formula, when: 'use' }] }, R)!, me = hunterBody(10, 0, 0);
    expect(diceFor(a, me.tier, RULES)).toEqual(diceOf(p.formula));
    const r = resolve(a, me, [me], me.id, openGrid(20, 14), { dice: { [me.id]: [3] }, react: {} }, NOW, R);
    expect(r.ok && r.bodies[0]!.mana).toBe(Math.min(3, me.sheet.manaMax));
  });
});
