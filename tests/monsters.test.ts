// Every seeded monster in src/core/registry/monsters.ts must pass these. A new monster is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { ARCHETYPES, kitGear, monsterSheet, pointsAt, split } from '../src/core/hunter/derive.ts';
import { diceOf, mean, printFormula } from '../src/core/formula.ts';
import { openGrid, place } from '../src/core/combat/space.ts';
import type { Place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, Origin } from '../src/core/combat/effect-ops.ts';
import { parseAbility } from '../src/core/combat/fight-parse.ts';
import { resolve } from '../src/core/combat/resolve.ts';
import { monsterRows } from '../src/core/combat/rows.ts';
import type { RowMonster } from '../src/core/combat/rows.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { TIER_BUDGET } from '../src/core/registry/paths.ts';
import { ARCHETYPE_ATTACKS, ATTACK_ID } from '../src/core/registry/abilities.ts';
import { ARCHETYPE_LIST, MONSTER_BOUNDS, MONSTER_KINDS, MONSTER_TRAITS, SEEDS, copiesOf, lootOf, monsterScript, monsterSheetOf, parseMonster, seedMonsters, statBlock, monsterXp, xpOf } from '../src/core/registry/monsters.ts';
import { mythicScriptOf, scriptFits } from '../src/core/registry/mythics.ts';
import type { Monster, MonsterTemplate } from '../src/core/registry/monsters.ts';
import type { MonsterTrait, StatusMod } from '../src/core/hunter/derive.ts';
import { parseItem } from '../src/core/registry/items.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const MONSTERS = seedMonsters(RULES);
const seed = (slug: string): Monster => MONSTERS.find(m => m.id === `seed:${slug}`)!;
const named = (m: Monster, name: string): Ability => m.abilities.find(a => a.name === name)!;
const text = (a: Ability): string => (a.effect ? printFormula(formulaOf(a, RULES)!) : '');
const round = RULES.fight.round;

// The single-hit bound of design section 6, as tests/abilities.test.ts reads it: a use deals at most 60% of a same-rank
// tank's max HP at mean dice, on a caught target, no crit. The tank is design 2.2's: Vitality 2 to Strength 1, every perk
// on Vitality, in the heavy kit. The user is the seed itself, with its kind and tweak.
const GRID = openGrid(20, 14), NOW = tick(5000), D20 = 7;
const tankOf = (rank: Rank): Origin => {
  const level = RULES.rankLevels[rank], stats = split('vit', 'str', pointsAt(level, RULES), RULES);
  const perks = TIER_BUDGET.slice(0, RANKS.indexOf(rank) + 1).reduce((s, v) => s + v, 0);
  return { kind: 'hunter', build: { stats: { ...stats, vit: stats.vit + perks }, level, gear: kitGear('heavy', RULES), perks: {} } };
};
const body = (id: string, origin: Origin, at: Place, side: Body['side'], rank: Rank): Body => {
  const m = modified(origin, [], RULES);
  return {
    id: combatantId(id), name: id, side, kind: origin.kind === 'hunter' ? 'hunter' : 'monster', origin, tier: RANKS.indexOf(rank), stats: m.stats, sheet: m.sheet,
    place: at, life: { at: 'up', hp: m.sheet.hpMax }, mana: m.sheet.manaMax, fatigue: 0, shield: null, stagger: null, channel: null, threat: origin.kind === 'monster' ? {} : null,
    statuses: [], readyAt: {}, abilities: [], intent: null, holder: null, at: NOW, speed: m.sheet.speed, tie: 0, xp: 0, mythic: null,
  } as Body;
};

for (const [i, m] of MONSTERS.entries()) {
  const [, , , , archetype, kind, tweak] = SEEDS[i]!;
  group(`the seeded monster ${m.name}`, () => {
    test('has an id, name, type and description the bestiary and the save keep whole', () => {
      expect(m.id).toMatch(/^seed:[a-z0-9-]+$/);
      expect(m.name.trim()).toBe(m.name);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.name.length).toBeLessThanOrEqual(MONSTER_BOUNDS.name);
      expect(m.type.length).toBeLessThanOrEqual(MONSTER_BOUNDS.type);
      expect(m.desc.trim()).not.toBe('');
      expect(m.desc.length).toBeLessThanOrEqual(MONSTER_BOUNDS.desc);
      expect(RANKS).toContain(m.rank);
    });

    test('is an archetype and a kind the fight builds a body from, as its row says', () => {
      expect(ARCHETYPE_LIST).toContain(m.archetype);
      expect(MONSTER_KINDS).toContain(m.kind);
      expect([m.archetype, m.kind]).toEqual([archetype, kind]);
    });

    test('its XP is its rank\'s, times its kind\'s factor, its traits\' and its own, rounded', () => {
      const traits = (tweak.traits ?? []).reduce((p, t) => p * RULES.fight.traits[t].xp, 1);
      expect(m.xp).toBe(Math.round(RULES.rankTable[m.rank].xp * RULES.fight.kinds[m.kind].xp * traits * (tweak.xp ?? 1)));
    });

    test('reads back unchanged through parseMonster, the reader the save, a pack and the bestiary editor use', () => {
      const { id, ...rest } = m;
      expect({ ...parseMonster(copy(m)), id }).toEqual({ ...rest, id });
    });

    test('its abilities fit a fight row beside its archetype\'s attack, each with its own id, and each reads back through the fight\'s reader', () => {
      expect(m.abilities.length).toBeLessThanOrEqual(MONSTER_BOUNDS.abilities);
      const ids = [ATTACK_ID, ...m.abilities.map(a => a.id)];
      expect(new Set(ids).size).toBe(ids.length);
      for (const a of m.abilities) expect(parseAbility(copy(a), RULES)).toEqual(a);
    });

    test('every status it applies or starts with is a built-in, with the rules\' def', () => {
      for (const a of m.abilities) for (const o of a.ops) if (o.op === 'applyStatus') {
        expect(Object.keys(BUILT_IN_STATUSES)).toContain(o.key);
        expect(o.def).toEqual(RULES.conditions[o.key as keyof typeof BUILT_IN_STATUSES]);
      }
      for (const s of m.statuses) expect(Object.keys(BUILT_IN_STATUSES)).toContain(s.key);
    });

    test('its notes are text a card draws: 20 at most, 500 characters each', () => {
      expect(m.notes.length).toBeLessThanOrEqual(MONSTER_BOUNDS.notes);
      for (const n of m.notes) { expect(n.trim()).toBe(n); expect(n.length).toBeLessThanOrEqual(MONSTER_BOUNDS.note); }
    });

    test('no ability of its own deals more than 60% of a same-rank tank\'s max HP at mean dice, caught, without a crit', () => {
      const user: Origin = { kind: 'monster', name: 'Monster', rank: m.rank, archetype: m.archetype, monsterKind: m.kind, tweak: { hp: m.tweak.hp ?? 1, dealt: 1, stats: m.tweak.stats ?? {}, traits: m.tweak.traits ?? [] } };
      const u = body('user', user, place(5, 5), 'foe', m.rank), tank = body('tank', tankOf(m.rank), place(6, 5), 'party', m.rank);
      for (const a of m.abilities) {
        if (a.effect?.type !== 'physical' && a.effect?.type !== 'magical') continue;
        const aim = a.aim === 'place' ? tank.place! : tank.id;
        // A blast catches its user too when it stands inside it, so both roll.
        const dice = diceOf(formulaOf(a, RULES)!).map(mean);
        const r = resolve(a, u, [u, tank], aim, GRID, { dice: { [tank.id]: dice, [u.id]: dice }, react: { [tank.id]: D20, [u.id]: D20 } }, NOW, RULES);
        expect([a.name, r.ok ? 'ok' : r.reason]).toEqual([a.name, 'ok']);
        if (!r.ok) continue;
        const o = r.outcomes.find(x => x.target === tank.id)!;
        expect([a.name, o.avoid, o.crit]).toEqual([a.name, 'caught', false]);
        expect([a.name, o.dealt <= 0.6 * tank.sheet.hpMax]).toEqual([a.name, true]);
      }
    });
  });
}

test('no two seeds share an id', () => {
  expect(new Set(MONSTERS.map(m => m.id)).size).toBe(MONSTERS.length);
});

test('a seed makes fight rows: its archetype\'s attack first, then its own abilities', () => {
  const kasaka: RowMonster = seed('kasaka');
  const [row] = monsterRows(kasaka, [combatantId('c1')], RULES);
  expect(row!.abilities.map(a => a.name)).toEqual(['Strike', 'Blue Venom Fangs', 'Serpentine Coil']);
});

group('the seeds as plan section 3.2 restates them', () => {
  test('the Goblin is a normal skirmisher with no ability past its Shot; Nimble Escape and Pack Tactics are notes', () => {
    const g = seed('goblin');
    expect([g.archetype, g.kind, g.abilities, g.notes.map(n => n.split(':')[0])]).toEqual(['skirmisher', 'normal', [], ['Nimble Escape', 'Pack Tactics']]);
    expect(ARCHETYPE_ATTACKS[g.archetype](RULES).kind).toBe('shot');
  });

  test('the Goblin Shaman is a normal caster at 0.7 HP whose Hex Bolt curses 30 feet away, 6 tiles; Rally is a note', () => {
    const g = seed('goblin-shaman'), hex = named(g, 'Hex Bolt');
    expect([g.archetype, g.kind, g.tweak, hex.kind, hex.range]).toEqual(['caster', 'normal', { hp: 0.7 }, 'curse', 6]);
    expect(g.notes[0]?.startsWith('Rally')).toBe(true);
  });

  test('the Ice Elf is a skirmisher at 0.8 HP and Instinct +8 (old initiative +2); its Frost Arrow shoots 120 feet, 24 tiles, and slows for 1 round', () => {
    const e = seed('ice-elf'), arrow = named(e, 'Frost Arrow');
    expect([e.archetype, e.kind, e.tweak, arrow.kind, arrow.range]).toEqual(['skirmisher', 'normal', { hp: 0.8, stats: { ins: 8 } }, 'shot', 24]);
    expect(arrow.ops).toEqual([{ op: 'applyStatus', key: statusKey('slowed'), def: RULES.conditions.slowed, duration: tick(round) }]);
    expect(e.notes.map(n => n.split(':')[0])).toEqual(['Ice Veil']);
  });

  test('Kasaka is a D boss brute at 0.9 HP whose fangs poison and whose coil restrains; the fang it drops is a note', () => {
    const k = seed('kasaka');
    expect([k.rank, k.archetype, k.kind, k.tweak.hp]).toEqual(['D', 'brute', 'boss', 0.9]);
    const applies = (name: string) => named(k, name).ops.flatMap(o => (o.op === 'applyStatus' ? [o.key] : []));
    expect([named(k, 'Blue Venom Fangs').kind, applies('Blue Venom Fangs'), named(k, 'Serpentine Coil').kind, applies('Serpentine Coil')]).toEqual(['curse', ['poisoned'], 'curse', ['restrained']]);
    expect(k.notes).toEqual(['Venom Fang: drops the Kasaka fang']);
  });

  test('Kamish breathes a magical blast of radius 9 (90 feet), frightens with a curse and knocks Prone with a blast of radius 4', () => {
    const k = seed('kamish'), breath = named(k, 'Dragon Breath'), gust = named(k, 'Wing Gust');
    expect([k.archetype, k.kind, k.tweak]).toEqual(['brute', 'boss', { hp: 1.5, stats: { ins: 8 } }]);
    expect([breath.kind, breath.effect?.type, breath.shape.kind === 'radius' && breath.shape.radius]).toEqual(['blast', 'magical', 9]);
    expect(named(k, 'Frightful Presence').ops.map(o => o.op === 'applyStatus' && o.key)).toEqual(['frightened']);
    expect([gust.kind, gust.shape.kind === 'radius' && gust.shape.radius, gust.ops.map(o => o.op === 'applyStatus' && o.key)]).toEqual(['blast', 4, ['prone']]);
  });

  test('a multi-attack is one heavy strike: Three Heads costs one and a half actions at one and a half times the damage', () => {
    const heads = named(seed('cerberus'), 'Three Heads');
    expect([heads.kind, heads.cost.time, text(heads)]).toEqual(['strike', RULES.fight.cost.heavy, '1.5 * (1d8 + phys)']);
  });

  test('"+N AC" is a shield on itself: the Hobgoblin\'s Shield Wall', () => {
    const wall = named(seed('hobgoblin'), 'Shield Wall');
    expect([wall.kind, wall.aim, wall.effect?.type]).toEqual(['support', 'self', 'shield']);
  });

  test('the Gate Troll and Beru start a fight Regenerating, which heals 10 HP a round at B and 25 at S', () => {
    expect([seed('gate-troll').statuses, seed('beru').statuses]).toEqual([[{ key: 'regenerating', rounds: null }], [{ key: 'regenerating', rounds: null }]]);
    const heal = BUILT_IN_STATUSES.regenerating.ops[0]!;
    if (heal.op !== 'heal' || !Array.isArray(heal.amount)) throw new Error('Regenerating heals by rank');
    expect([heal.when, heal.amount[RANKS.indexOf('B')], heal.amount[RANKS.indexOf('S')]]).toEqual(['turn', { kind: 'number', value: 10 }, { kind: 'number', value: 25 }]);
  });

  test('Igris may be extracted and gives 1.2 times an A boss\'s XP', () => {
    const ig = seed('igris');
    expect([ig.extractable, ig.xp]).toEqual([true, Math.round(2500 * 3 * 1.2)]);
  });
});

group('a monster made from its rank', () => {
  test('its XP is the rank table\'s, times 3 for a boss and 1.5 for an elite: E is 25, 75 and 38 (37.5 rounded)', () => {
    expect(monsterXp(statBlock(RULES, 'E'), RULES)).toBe(25);
    expect(monsterXp(statBlock(RULES, 'E', { kind: 'boss' }), RULES)).toBe(75);
    expect(monsterXp(statBlock(RULES, 'E', { kind: 'elite' }), RULES)).toBe(38);
    expect(statBlock(RULES, 'E', { kind: 'boss' })).toMatchObject({ name: 'E-rank Boss', kind: 'boss' });
  });

  test('a monster without an XP of its own gets the XP table as it is now; a typed XP is kept (B1)', () => {
    const golem = parseMonster({ name: 'Golem', rank: 'C', kind: 'boss' })!, rich = { ...RULES, rankTable: { ...RULES.rankTable, C: { ...RULES.rankTable.C, xp: RULES.rankTable.C.xp * 2 } } };
    expect(golem.xp, 'the rule\'s is read, not stored').toBeUndefined();
    expect(monsterXp(golem, rich)).toBe(monsterXp(golem, RULES) * 2);
    expect(monsterXp(parseMonster({ name: 'Golem', rank: 'C', xp: 999 })!, rich)).toBe(999);
    expect(monsterXp(parseMonster({ name: 'Golem', xp: '9' })!, RULES), 'not a number: the rule\'s').toBe(xpOf(RULES, 'E', 'normal'));
  });

  test('a rank the rules do not have is E', () => {
    expect(statBlock(RULES, 'Z' as Rank).rank).toBe('E');
  });

  test('its sheet is its rank, archetype and kind\'s, with its tweak: Kasaka has 0.9 of a D boss brute\'s HP', () => {
    const plain = monsterSheet('D', 'brute', 'boss', RULES).hpMax, k = monsterSheetOf(seed('kasaka'), RULES).hpMax;
    expect(Math.abs(k - 0.9 * plain)).toBeLessThanOrEqual(1);
  });

  test('a tweak\'s stats reach the sheet: the Ice Elf\'s Instinct +8 is 8 more Instinct than a plain C skirmisher', () => {
    const elf = seed('ice-elf'), base = ARCHETYPES.skirmisher;
    const with8 = modified({ kind: 'monster', name: 'Monster', rank: 'C', archetype: 'skirmisher', monsterKind: 'normal', tweak: { hp: 0.8, dealt: 1, stats: { ins: 8 }, traits: [] } }, [], RULES).stats.ins;
    const plain = modified({ kind: 'monster', name: 'Monster', rank: 'C', archetype: 'skirmisher', monsterKind: 'normal', tweak: { hp: 0.8, dealt: 1, stats: {}, traits: [] } }, [], RULES).stats.ins;
    expect([elf.tweak.stats?.ins, with8 - plain, base.main]).toEqual([8, 8, 'agi']);
  });
});

group('a trait changes a monster\'s body by its rule (RULES.fight.traits, balance plan section 1)', () => {
  const T = RULES.fight.traits;
  const tweak = (traits: readonly MonsterTrait[], hp = 1) => ({ hp, dealt: 1, stats: {}, traits });
  const sheet = (traits: readonly MonsterTrait[], mods: readonly StatusMod[] = [], hp = 1) => monsterSheet('C', 'brute', 'boss', RULES, mods, tweak(traits, hp));
  const plain = sheet([]);

  test('the six traits the draft\'s words ask for, each with its starting numbers', () => {
    expect(MONSTER_TRAITS).toEqual(['frail', 'tough', 'slow', 'fast', 'armored', 'warded']);
    expect(MONSTER_TRAITS.map(t => [T[t].hp, T[t].armor, T[t].resist, T[t].speed, T[t].xp])).toEqual([
      [0.8, 1, 1, 0, 1], [1.3, 1, 1, 0, 1], [1, 1, 1, -30, 1], [1, 1, 1, 30, 1], [1, 1.5, 1, 0, 1], [1, 1, 1.5, 0, 1],
    ]);
  });

  test('frail and tough multiply max HP as a seed\'s HP factor of their number does, and change nothing else', () => {
    for (const t of ['frail', 'tough'] as const) {
      const with_ = sheet([t]);
      expect(with_.hpMax, t).toBe(sheet([], [], T[t].hp).hpMax);
      expect(Object.keys(plain).filter(k => k !== 'hpMax' && with_[k as keyof typeof plain] !== plain[k as keyof typeof plain]), t).toEqual([]);
    }
  });

  test('slow and fast change speed as a status of their percent does: slow is 30% slower, fast 30% faster', () => {
    expect(sheet(['slow']).speed).toBe(sheet([], [{ op: 'speed', pct: T.slow.speed }]).speed);
    expect(sheet(['fast']).speed).toBe(sheet([], [{ op: 'speed', pct: T.fast.speed }]).speed);
    expect([sheet(['slow']).speed, plain.speed, sheet(['fast']).speed]).toEqual([Math.round(plain.speed * 0.7), plain.speed, Math.round(plain.speed * 1.3)]);
    expect(sheet(['slow'], [{ op: 'speed', pct: -20 }]).speed, 'a slow status adds its percent to the trait\'s').toBe(sheet([], [{ op: 'speed', pct: -50 }]).speed);
  });

  test('armored multiplies armor and warded resist by 1.5 on top of the kind\'s factor, to the rounding', () => {
    expect(Math.abs(sheet(['armored']).armor - T.armored.armor * plain.armor)).toBeLessThanOrEqual(1);
    expect(sheet(['armored']).resist).toBe(plain.resist);
    expect(Math.abs(sheet(['warded']).resist - T.warded.resist * plain.resist)).toBeLessThanOrEqual(1);
    expect(sheet(['warded']).armor).toBe(plain.armor);
  });

  test('two traits multiply: tough and frail together are 1.04 of the HP', () => {
    expect(sheet(['frail', 'tough']).hpMax).toBe(sheet([], [], T.frail.hp * T.tough.hp).hpMax);
  });

  test('a monster\'s traits reach its sheet, its fight row and its XP', () => {
    const m = parseMonster({ name: 'Golem', rank: 'C', kind: 'boss', tweak: { traits: ['slow', 'armored'] } })!;
    expect(monsterSheetOf(m, RULES)).toEqual(sheet(['slow', 'armored']));
    const [row] = monsterRows(m, [combatantId('g1')], RULES);
    expect(row!.origin).toMatchObject({ tweak: { traits: ['slow', 'armored'] } });
    expect(monsterXp(m, RULES)).toBe(Math.round(RULES.rankTable.C.xp * RULES.fight.kinds.boss.xp * T.slow.xp * T.armored.xp));
  });
});

group('parseMonster: a monster from a save, a pack or the bestiary editor', () => {
  const blank: MonsterTemplate = {
    name: 'Monster', rank: 'E', type: '', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], notes: [], extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] },
  };
  const base = { ...blank, name: 'Wolf' };

  test('what is not an object is not a monster; a blank name is Monster', () => {
    for (const v of [null, 5, 'Wolf', []]) expect(parseMonster(v)).toBeNull();
    expect(parseMonster({ name: '  ' })).toEqual(blank);
  });

  test('a field of the wrong type or an unknown value takes its default, and unknown and old keys are dropped', () => {
    const m = parseMonster({ name: 'Wolf', rank: 'Z', type: 5, archetype: 'tank', kind: 'king', tweak: 'big', abilities: 'Bite', notes: 'Howl', xp: '9',
      extractable: 0, desc: [], auto: 'true', boss: true, elite: true, hp: 30, ac: 14, atk: 4, dmg: '1d6', init: 2, stats: { str: 14 }, skills: [{ name: 'Bite' }], lair: 'cave', id: 'm9' });
    expect(m).toEqual(base);
  });

  test('a rank, an archetype and a kind are kept when the rules have them', () => {
    expect(parseMonster({ name: 'Wolf', rank: 'C', archetype: 'skirmisher', kind: 'elite' })).toEqual({ ...base, rank: 'C', archetype: 'skirmisher', kind: 'elite' });
  });

  test('a tweak keeps an HP factor above 0 (at most 10) and whole stat points from -999 to 999 that are not 0', () => {
    expect(parseMonster({ name: 'Wolf', tweak: { hp: 1.25, stats: { ins: 8, str: 2.7, agi: 0, vit: 5000, pow: -5000, luck: 3, dex: 4 } } })!.tweak)
      .toEqual({ hp: 1.25, stats: { ins: 8, str: 2, vit: 999, pow: -999 } });
    expect(parseMonster({ name: 'Wolf', tweak: { hp: 40 } })!.tweak).toEqual({ hp: 10 });
    for (const hp of [0, -1, '2', Infinity]) expect(parseMonster({ name: 'Wolf', tweak: { hp } })!.tweak).toEqual({});
  });

  test('a tweak keeps the traits the rules hold, each once, in the rules\' order; none is no traits field', () => {
    expect(parseMonster({ name: 'Wolf', tweak: { traits: ['armored', 'huge', 'slow', 'armored', 5, null] } })!.tweak).toEqual({ traits: ['slow', 'armored'] });
    for (const traits of [[], 'slow', { slow: true }, ['Slow']]) expect(parseMonster({ name: 'Wolf', tweak: { traits } })!.tweak, JSON.stringify(traits)).toEqual({});
  });

  test('numbers are whole and bounded: XP from 0 to a billion', () => {
    expect([-1, 9.6, 5e12].map(xp => parseMonster({ name: 'Wolf', xp })!.xp)).toEqual([0, 9, 1e9]);
  });

  test('abilities are read by the fight\'s reader: one it refuses is dropped, at most 11 beside the archetype\'s attack', () => {
    const fangs = named(seed('kasaka'), 'Blue Venom Fangs');
    const m = parseMonster({ name: 'Wolf', abilities: [copy(fangs), { ...copy(fangs), kind: 'laser' }, 'Bite: 1d6', ...Array(20).fill(copy(fangs))] })!;
    expect(m.abilities).toHaveLength(11);
    expect(m.abilities[0]).toEqual(fangs);
  });

  test('notes are the non-blank lines of text, trimmed: 20 at most, 500 characters each', () => {
    const m = parseMonster({ name: 'Wolf', notes: ['  Howl: loud  ', '', 7, null, 'x'.repeat(600), ...Array(30).fill('Pack')] })!;
    expect(m.notes).toHaveLength(20);
    expect(m.notes.slice(0, 2)).toEqual(['Howl: loud', 'x'.repeat(500)]);
  });

  test('a monster that may not be extracted keeps it; one added on its first defeat keeps its mark', () => {
    expect(parseMonster({ name: 'Wolf', extractable: false, auto: true })).toEqual({ ...base, extractable: false, auto: true });
  });

  test('a monster a gate\'s spawn made keeps that mark; any other value of it is none', () => {
    expect(parseMonster({ name: 'Wolf', placeholder: true })).toEqual({ ...base, placeholder: true });
    expect(parseMonster({ name: 'Wolf', placeholder: 'yes' })).toEqual(base);
  });

  test('a starting status is a status key with whole rounds from 1 to 999, or until removed; at most 8, each key once', () => {
    const m = parseMonster({ name: 'Wolf', statuses: [
      { key: 'poisoned', rounds: 3 }, { key: 'hasted', rounds: null }, { key: 'burning', rounds: 5000 }, { key: 'slowed', rounds: 0 }, { key: 'prone', rounds: 2.6 },
      { key: 'poisoned', rounds: 1 }, { key: 'Not A Key', rounds: 1 }, { key: 'dead', rounds: 1 }, { key: 'exhausted', rounds: null }, 'stunned', { rounds: 2 },
      { key: 'blinded', rounds: 'two' }, { key: 'my-curse', rounds: 4 }, { key: 'stunned', rounds: 1 }, { key: 'frightened', rounds: 1 }, { key: 'invisible', rounds: 1 },
    ] })!;
    expect(m.statuses).toEqual([
      { key: 'poisoned', rounds: 3 }, { key: 'hasted', rounds: null }, { key: 'burning', rounds: 999 }, { key: 'slowed', rounds: 1 }, { key: 'prone', rounds: 2 },
      { key: 'blinded', rounds: 1 }, { key: 'my-curse', rounds: 4 }, { key: 'stunned', rounds: 1 }]);
  });

  test('a starting status keeps a count of 2 to 20 stacks, whole; 1, a wrong value or none leaves it out ("Starts with 3 Pain")', () => {
    const m = parseMonster({ name: 'Einar', statuses: [
      { key: 'pain', rounds: null, stacks: 3 }, { key: 'cold', rounds: 2, stacks: 40 }, { key: 'rot', rounds: 1, stacks: 1 },
      { key: 'vision', rounds: 1, stacks: 'many' }, { key: 'mark', rounds: 1, stacks: 2.7 }] })!;
    expect(m.statuses).toEqual([
      { key: 'pain', rounds: null, stacks: 3 }, { key: 'cold', rounds: 2, stacks: RULES.fight.kit.stackCap }, { key: 'rot', rounds: 1 },
      { key: 'vision', rounds: 1 }, { key: 'mark', rounds: 1, stacks: 2 }]);
  });

  test('loot is gold from 0 to 1e9 and at most 20 items read by parseItem', () => {
    const m = parseMonster({ name: 'Wolf', loot: { gold: 12.7, items: [{ name: 'Fang', rar: 'rare', qty: 2, glow: 1 }, { qty: 3 }, ...Array(30).fill({ name: 'Pelt' })] } })!;
    expect(m.loot.gold).toBe(12);
    expect(m.loot.items).toHaveLength(20);
    expect(m.loot.items[0]).toEqual(parseItem({ name: 'Fang', rar: 'rare', qty: 2 })!);
    expect(parseMonster({ name: 'Wolf', loot: { gold: -5 } })!.loot).toEqual({ gold: 0, items: [] });
    expect(parseMonster({ name: 'Wolf', loot: { gold: 5e12, items: 'all' } })!.loot).toEqual({ gold: 1e9, items: [] });
    expect(parseMonster({ name: 'Wolf', loot: 'gold' })!.loot).toEqual({ gold: 0, items: [] });
  });
});

group('what a fight\'s defeated monsters dropped', () => {
  const shard = parseItem({ name: 'Frost Shard', rar: 'rare', type: 'material', qty: 1 })!;
  const potion = parseItem({ name: 'Potion', type: 'consumable', effects: [{ op: 'heal', amount: { kind: 'number', value: 10 }, when: 'use' }], qty: 2 })!;

  test('gold is summed and the same item is one stack of the counts together', () => {
    expect(lootOf([{ gold: 50, items: [shard] }, { gold: 50, items: [shard, potion] }, { gold: 0, items: [] }]))
      .toEqual({ gold: 100, items: [{ ...shard, qty: 2 }, potion] });
  });

  test('items that differ in anything but their count stay apart', () => {
    const epic = { ...shard, rar: 'epic' as const };
    expect(lootOf([{ gold: 0, items: [shard] }, { gold: 0, items: [epic] }]).items).toEqual([shard, epic]);
  });

  test('a stack stops at 9999 and gold at a billion, the bounds a monster\'s loot has', () => {
    const big = { ...shard, qty: 9000 };
    expect(lootOf([{ gold: 1e9, items: [big] }, { gold: 5, items: [big] }])).toEqual({ gold: 1e9, items: [{ ...shard, qty: 9999 }] });
  });

  test('no drops is no loot', () => {
    expect(lootOf([])).toEqual({ gold: 0, items: [] });
  });
});

group('how many copies of one monster join at once (implicit audit 3, B5)', () => {
  test('a typed count is 1 to 26, one row letter each from A to Z, and anything else is 1', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.length;
    expect<number>(MONSTER_BOUNDS.copies).toBe(letters);
    expect([copiesOf('3'), copiesOf(26), copiesOf(27), copiesOf('99'), copiesOf(0), copiesOf(-4), copiesOf('2.7'), copiesOf(''), copiesOf('x'), copiesOf(null)])
      .toEqual([3, 26, 26, 26, 1, 1, 2, 1, 1, 1]);
  });
});

group('a monster\'s icon', () => {
  test('a key of the registry is read back, whatever the monster (a GM may give any icon to anything)', () => {
    expect(parseMonster({ name: 'Rat King', icon: 'rat' })!.icon).toBe('rat');
    expect(parseMonster({ name: 'Rat King', type: 'Beast', icon: 'potion' })!.icon).toBe('potion');
  });
  test('a key the registry lacks, or no string at all, is dropped: the monster keeps no icon, so its default shows', () => {
    for (const icon of ['nope', '', 'RAT', 7, null, {}]) expect(parseMonster({ name: 'Rat King', icon })!, String(icon)).not.toHaveProperty('icon');
  });
  test('a loot item keeps its icon through the monster\'s reader', () => {
    expect(parseMonster({ name: 'Rat King', loot: { gold: 1, items: [{ name: 'Tail', icon: 'ore' }] } })!.loot.items[0]!.icon).toBe('ore');
  });
});

group('a mythic and its script (notes-11-keystones.md, design B.3 and B.6)', () => {
  const mythics = MONSTERS.filter(m => m.kind === 'mythic');

  test('every mythic seed\'s script fits it', () => {
    expect(mythics.map(m => [m.name, monsterScript(m)])).toEqual([
      ['The Angel of the Last Trumpet', 'angel-of-the-last-trumpet'], ['Zaratan, the Island That Wakes', 'zaratan-the-island-that-wakes'], ['The Fourth Rider', 'the-fourth-rider'],
    ]);
    for (const m of mythics) expect([m.name, scriptFits(mythicScriptOf(monsterScript(m)!), m)], 'every act its phases name is one of its abilities').toEqual([m.name, []]);
    expect(scriptFits(mythicScriptOf('the-fourth-rider'), seed('beru')), 'a monster without the Rider\'s abilities lacks both, each once').toEqual(['Reaping Stroke', 'Not Yet']);
  });

  test('a mythic made with no script plays plain', () => {
    expect(parseMonster({ name: 'Leviathan', kind: 'mythic' })!.script).toBe('plain');
    expect(parseMonster({ name: 'Leviathan', kind: 'mythic', script: 'the-fifth-rider' })!.script, 'a script the registry lacks').toBe('plain');
    expect(parseMonster({ name: 'Leviathan', kind: 'mythic', script: 'the-fourth-rider' })!.script).toBe('the-fourth-rider');
    expect(statBlock(RULES, 'S', { kind: 'mythic' }).script).toBe('plain');
    expect(monsterScript({ kind: 'mythic' }), 'an old mythic that names none').toBe('plain');
  });

  test('a monster of any other kind plays no script, whatever it names', () => {
    expect(parseMonster({ name: 'Wolf', kind: 'boss', script: 'the-fourth-rider' })).not.toHaveProperty('script');
    expect(monsterScript(seed('beru'))).toBeNull();
  });

  test('a mythic cannot be extracted', () => {
    expect(mythics.map(m => [m.type, m.extractable]), 'not the Celestial or the Aquatic one, whose types may be').toEqual([['Celestial', false], ['Aquatic', false], ['Spirit', false]]);
    expect(parseMonster({ name: 'Leviathan', kind: 'mythic', type: 'Beast', extractable: true })!.extractable).toBe(false);
    expect(statBlock(RULES, 'S', { kind: 'mythic', type: 'Beast' }).extractable).toBe(false);
    expect(parseMonster({ name: 'Wolf', kind: 'boss', type: 'Beast', extractable: true })!.extractable, 'a boss still may').toBe(true);
  });
});
