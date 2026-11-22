// The fight rows of src/core/combat/rows.ts. Expected values come from the rules by name and the plan's decisions
// (docs/agent-handoff/rw/m2-plan.md 1.2 for a shadow's grade, 3.2 for a monster's attacks, 3.3 for a weapon, design.md 4.3
// for the stagger bar): a base hunter of level 1 has `hpBase` 45 HP, `manaBase` mana and `fatigueBase` capacity, and
// speed `speedBase` 100. The same-rank hit is the simulation's own, from tests/models/fight-sim.ts.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { SHADOW_GRADES } from '../src/core/save.ts';
import type { ShadowGrade } from '../src/core/save.ts';
import type { Stats } from '../src/core/stats.ts';
import { buildOf } from '../src/core/hunter/sheet.ts';
import { MAX_LEVEL } from '../src/core/hunter/level.ts';
import { monsterSheet, NO_TWEAK } from '../src/core/hunter/derive.ts';
import type { MonsterKind } from '../src/core/hunter/derive.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import { parseSheetKey } from '../src/core/ids.ts';
import type { Ability, AbilityKind } from '../src/core/combat/ability-types.ts';
import { onSheet, shadowId, statusKey } from '../src/core/combat/effect-ops.ts';
import type { SheetStatus, StackDef, StatusDef } from '../src/core/combat/effect-ops.ts';
import { parseFormula } from '../src/core/formula.ts';
import { tiles } from '../src/core/combat/space.ts';
import { afterDefence } from '../src/core/combat/land.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { fightId, reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight } from '../src/core/combat/fight.ts';
import type { NewRow } from '../src/core/combat/fight-types.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { mythicStep } from '../src/core/combat/mythic.ts';
import { MYTHICS } from '../src/core/registry/mythics.ts';
import type { OmenKey } from '../src/core/combat/mythic-types.ts';
import { isRefused } from '../src/core/save-step.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { ARCHETYPE_ATTACKS, ATTACK_ID, itemAbility, itemOfAbility, weaponAttack, wornAbilityId } from '../src/core/registry/abilities.ts';
import { hunterAbilities, hunterRow, monsterRows, remoteRow, sameRankHit, shadowRow, shadowSheet, staggerOf, summonRow } from '../src/core/combat/rows.ts';
import { pinKeyOf } from '../src/core/combat/map-view.ts';
import { codexKey } from '../src/core/bestiary.ts';
import type { RowHunter, RowMonster, RowShadow } from '../src/core/combat/rows.ts';
import { sameRankHit as simHit } from './models/fight-sim.ts';
import { iid, jcid, qid } from './fixtures/ids.ts';
import { withKeystones } from './fixtures/keystone-rules.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { stepQuest } from '../src/core/hunter/job-chain.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
const sheetKey = (s: string) => parseSheetKey(s) ?? (() => { throw new Error(`not a sheet key: ${s}`); })();

const F = RULES.fight;
const id = combatantId;
const stats = (o: Partial<Stats> = {}): Stats => ({ str: 10, agi: 10, vit: 10, ins: 10, dis: 10, pre: 10, pow: 10, ctl: 10, ...o });
const hunter = (o: Partial<RowHunter> = {}): RowHunter => ({
  id: 'h1', name: 'Brakk', stats: stats(), level: 1, rank: 'E', life: { at: 'up', hp: 30 }, mana: 5, fatigue: 0, penalty: null,
  hpAdj: 0, manaAdj: 0, titleId: null, titles: [], items: [], equipped: { weapon: null }, build: { path: null, picks: [] }, skills: [],
  conditions: [], ...o,
});
const skill = (kind: AbilityKind, name: string): Ability => abilityOf(kind, { id: abilityId(name.toLowerCase().replace(/ /g, '-')), name }, RULES);
const active = (a: Ability | null) => ({ type: 'active', ability: a }) as const;

const SLOWED: StatusDef = { label: 'Slowed', desc: '', ops: [{ op: 'speed', pct: [-20, -25, -30, -35, -40, -50] }] };
const STEALTH: StatusDef = { label: 'Stealth', desc: '', ops: [] };
const REGEN: StatusDef = { label: 'Regenerating', desc: '', ops: [{ op: 'heal', amount: { kind: 'number', value: 10 } }] };
const POISONED: StatusDef = { label: 'Poisoned', desc: '', ops: [{ op: 'stat', key: 'ctl', amount: { kind: 'number', value: -8 } }] };
const condition = (key: string, def: StatusDef, rounds: number | null): SheetStatus => ({ key: statusKey(key), def, source: { id: null, tier: 1 }, rounds });
/** The rules with the new status defs a monster's start statuses are looked up in (W1a puts them in `RULES.conditions`). */
const R = { ...RULES, conditions: { regenerating: REGEN, poisoned: POISONED } };

const monster = (o: Partial<RowMonster> = {}): RowMonster =>
  ({ name: 'Goblin', rank: 'E', archetype: 'skirmisher', kind: 'normal', tweak: {}, abilities: [], xp: 10, statuses: [], ...o });
const shadow = (o: Partial<RowShadow> = {}): RowShadow => ({ id: 's1', name: 'Igris', rank: 'C', archetype: 'brute', grade: 'Knight', hp: 12, ...o });

describe('a hunter on this phone', () => {
  test('joins on the party side with its HP, mana and fatigue as its sheet holds them, written back to it', () => {
    const h = hunter({ rank: 'C', fatigue: 7 });
    const r = hunterRow(h, id('c1'), RULES);
    expect([r.id, r.name, r.side, r.kind, r.tier, rowHp(r), r.mana, r.fatigue, r.xp, r.place]).toEqual([id('c1'), 'Brakk', 'party', 'hunter', 2, 30, 5, 7, 0, null]);
    expect(r.holder).toEqual({ kind: 'local', hunterId: hunterId('h1') });
    expect(r.origin).toEqual({ kind: 'hunter', build: buildOf(h, RULES) });
    expect([r.threat, r.stagger, r.shield, r.channel, r.intent, r.readyAt]).toEqual([null, null, null, null, null, {}]);
  });

  test('a dead hunter joins at 0 HP, and HP, mana and fatigue above the maxima join at the maxima', () => {
    expect(rowHp(hunterRow(hunter({ life: { at: 'dead' } }), id('c1'), RULES))).toBe(0);
    const r = hunterRow(hunter({ life: { at: 'up', hp: 999 }, mana: 999, fatigue: 999, hpAdj: 5 }), id('c1'), RULES);
    expect([rowHp(r), r.mana, r.fatigue]).toEqual([F.hpBase + 5, F.manaBase, F.fatigueBase]);
  });

  test('attacks with its worn weapon, then each active skill in order; a passive and a skill with no ability add nothing', () => {
    const bow = { id: 'bow', name: 'Hunting Bow', dice: '1d8', attack: 'shot', weight: 1 } as const;
    const rush = skill('strike', 'Dagger Rush'), marked = skill('shot', 'Marked Shot');
    const h = hunter({ items: [bow], equipped: { weapon: 'bow' }, skills: [active(rush), { type: 'passive', bonus: { str: 1 } }, active(null), active(marked)] });
    const r = hunterRow(h, id('c1'), RULES);
    expect(r.abilities).toEqual([weaponAttack({ name: 'Hunting Bow', dice: '1d8', attack: 'shot' }, RULES), rush, marked]);
    expect([r.abilities[0]!.id, r.abilities[0]!.name, r.abilities[0]!.kind]).toEqual([ATTACK_ID, 'Hunting Bow', 'shot']);
  });

  test('with no weapon worn, or a worn item that is no weapon, strikes with Strike', () => {
    const vest = { id: 'vest', name: 'Hunter\'s Leather', weight: 3, armor: 4, resist: 5 };
    for (const h of [hunter(), hunter({ items: [vest], equipped: { weapon: 'vest' } })]) {
      const first = hunterAbilities(h, RULES)[0]!;
      expect(first).toEqual(weaponAttack(null, RULES));
      expect([first.name, first.kind]).toEqual(['Strike', 'strike']);
    }
  });

  test('each consumable in the bag follows the skills as an ability, for another or for its user; a used-up one does not', () => {
    const num = (value: number) => ({ kind: 'number', value }) as const;
    const bomb = { id: iid('b1'), name: 'Flash Bomb', type: 'consumable', rar: 'common', qty: 2, target: 'other', effects: [{ op: 'damage', type: 'magical', amount: num(5), when: 'use' }] } as const;
    const potion = { id: iid('p1'), name: 'Health Potion', type: 'consumable', rar: 'common', qty: 1, effects: [{ op: 'heal', amount: num(30), when: 'use' }] } as const;
    const items = [bomb, { ...bomb, id: iid('b0'), qty: 0 }, potion];
    const all = hunterAbilities(hunter({ items, skills: [active(skill('strike', 'Move 0'))] }), RULES);
    expect(all.map(a => a.name)).toEqual(['Strike', 'Move 0', 'Flash Bomb', 'Health Potion']);
    expect(all[2]).toEqual(itemAbility(bomb, RULES)!);
    expect([all[3]!.aim, all[3]!.effect]).toEqual(['self', { type: 'heal', by: 'hand', formula: num(30) }]);
  });

  test('never holds two abilities of one id, and holds at most 12', () => {
    const clash = { ...skill('curse', 'Clash'), id: ATTACK_ID };
    const many = Array.from({ length: 15 }, (_, i) => active(skill('strike', `Move ${i}`)));
    expect(hunterAbilities(hunter({ skills: [active(clash), active(skill('strike', 'Move 0'))] }), RULES).map(a => a.name)).toEqual(['Strike', 'Move 0']);
    const all = hunterAbilities(hunter({ skills: [active(skill('strike', 'Move 0')), ...many] }), RULES);
    expect([all.length, new Set(all.map(a => a.id)).size, all[11]!.name]).toEqual([12, 12, 'Move 10']);
  });

  test('its conditions start at its joining with the rounds each has left, and change its sheet in the fight', () => {
    const now = tick(0);
    const h = hunter({ conditions: [condition('slowed', SLOWED, 2.5), condition('stealth', STEALTH, null)] });
    const r = hunterRow(h, id('c1'), RULES);
    expect(r.statuses).toEqual([
      { key: statusKey('slowed'), def: SLOWED, source: { id: null, tier: 1 }, until: tick(2500), since: now, settledAt: now },
      { key: statusKey('stealth'), def: STEALTH, source: { id: null, tier: 1 }, until: null, since: now, settledAt: now },
    ]);
    const plain = hunterRow({ ...hunter(), id: 'h2' }, id('c2'), RULES);
    const f = reduce(null, { type: 'add', fightId: fightId('f'), rows: [r, plain], openings: [] }, { rules: RULES }).fight!;
    // Slowed at the source's tier 1 is -25%: 100 * 0.75.
    expect(f.rows.map(x => x.speed)).toEqual([F.speedBase * 0.75, F.speedBase]);
  });
});

describe('what a hunter wears into a fight (kits design 1.3.2)', () => {
  const PAIN_IS_POWER: StatusDef = { label: 'Pain is Power', desc: '', ops: [], triggers: [{ on: 'struck', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'note', text: 'pain' }] }] };
  const THORNS: StatusDef = { label: 'Thorns', desc: '', ops: [] };
  const ring = { id: 'i1', name: 'Thorn Ring', rar: 'rare', bonus: {}, worn: THORNS };
  test('a passive skill\'s worn status is on its row until removed, the row its source at the hunter\'s rank', () => {
    const h = hunter({ rank: 'C', skills: [{ type: 'passive', bonus: {}, worn: PAIN_IS_POWER }, { type: 'passive', bonus: { str: 1 } }] });
    const r = hunterRow(h, id('c1'), RULES);
    expect(r.statuses).toEqual([{ key: statusKey('pain-is-power'), def: PAIN_IS_POWER, source: { id: id('c1'), tier: 2 }, until: null, since: tick(0), settledAt: tick(0), worn: true }]);
  });
  test('a worn item\'s status comes at the item\'s rarity (rare is C, tier 2) from its wearer\'s row; the same item in the bag gives none', () => {
    const worn = hunterRow(hunter({ items: [ring], equipped: { weapon: null, ring1: 'i1' } }), id('c1'), RULES);
    expect(worn.statuses.map(s => [s.key, s.source, s.worn])).toEqual([[statusKey('thorns'), { id: id('c1'), tier: 2 }, true]]);
    expect(hunterRow(hunter({ items: [ring] }), id('c1'), RULES).statuses).toEqual([]);
  });
  test('a worn status takes a key no condition holds, so both stay', () => {
    const h = hunter({ conditions: [condition('thorns', STEALTH, null)], items: [ring], equipped: { weapon: null, ring1: 'i1' } });
    expect(hunterRow(h, id('c1'), RULES).statuses.map(s => s.key)).toEqual([statusKey('thorns'), statusKey('thorns-2')]);
  });
  test('the active title\'s worn status is on its hunter\'s row at the hunter\'s rank; another title\'s is not', () => {
    const titles = [{ id: 't1', bonus: {}, worn: PAIN_IS_POWER }, { id: 't2', bonus: {}, worn: THORNS }];
    const r = hunterRow(hunter({ rank: 'C', titles, titleId: 't1' }), id('c1'), RULES);
    expect(r.statuses).toEqual([{ key: statusKey('pain-is-power'), def: PAIN_IS_POWER, source: { id: id('c1'), tier: 2 }, until: null, since: tick(0), settledAt: tick(0), worn: true }]);
    expect(hunterRow(hunter({ titles, titleId: null }), id('c1'), RULES).statuses, 'no active title, no worn status').toEqual([]);
  });
  test('an item\'s threshold damage of 0.5 * str reads its wearer\'s Strength, not the Strength of the foe it lands on (item-stats 6.3)', () => {
    const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
    const reach = { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as const;
    const strike = skill('strike', 'Hit');
    const hit: Ability = { ...strike, ...reach, effect: { type: strike.effect!.type, by: 'hand', formula: f('10') } as Ability['effect'] };
    const mark = (threshold: StackDef['stack']['threshold']): StackDef => ({ label: 'Mark', desc: '', ops: [], stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight', threshold } });
    const brand = (m: StackDef): StatusDef => ({ label: 'Brand', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: statusKey('mark'), def: m, duration: null }] }] });
    const fought = (m: StackDef) => {
      const ring = { id: 'i1', name: 'Brand Ring', rar: 'rare', bonus: {}, worn: brand(m) };
      const rows = [hunterRow(hunter({ stats: stats({ str: 30 }), items: [ring], equipped: { weapon: null, ring1: 'i1' }, skills: [active(hit)] }), id('c1'), RULES), ...monsterRows(monster(), [id('m1')], R)];
      const commands: Command[] = [
        { type: 'add', fightId: fightId('f'), rows, openings: [] },
        { type: 'start', openings: [{ id: id('c1'), d20: 20, tie: 0 }, { id: id('m1'), d20: 1, tie: 0 }] },
        { type: 'act', by: id('c1'), ability: hit.id, aim: id('m1'), rolls: { dice: {}, react: { [id('m1')]: 10 } } as Rolls },
      ];
      return commands.reduce<Fight | null>((g, cmd) => reduce(g, cmd, { rules: RULES }).fight, null)!;
    };
    const plain = fought(mark(null)), burst = fought(mark({ at: { kind: 'count', n: 1 }, to: { kind: 'bearer' }, then: 'spend', ops: [{ op: 'damage', type: 'physical', amount: f('0.5 * str'), when: 'use' }] }));
    const wearer = burst.rows.find(r => r.id === id('c1'))!, foe = burst.rows.find(r => r.id === id('m1'))!;
    expect(foe.stats.str, 'the foe\'s Strength is not the wearer\'s').not.toBe(30);
    expect(rowHp(plain.rows.find(r => r.id === id('m1'))!) - rowHp(foe)).toBe(afterDefence(0.5 * 30, 'physical', wearer.sheet, foe.sheet, RULES));
  });
  test('a worn item\'s shield of 10 + 0.2 * hpmax is on its wearer\'s row as the fight starts: at max HP 120, 34 times its shields received share', () => {
    const p = parseFormula('10 + 0.2 * hpmax', RULES);
    if (!p.ok) throw new Error(p.error);
    // +50% shields received, within `kit.shareCap`: 34 * 1.5 = 51
    const BULWARK: StatusDef = { label: 'Bulwark', desc: '', ops: [{ op: 'shield', amount: p.formula }, { op: 'share', on: 'shielded', pct: 50 }] };
    const ring = { id: 'i1', name: 'Bulwark Ring', rar: 'rare', bonus: {}, worn: BULWARK };
    // a level 1 hunter of base stats has `hpBase` max HP; the GM's adjustment brings it to 120
    const r = hunterRow(hunter({ hpAdj: 120 - F.hpBase, life: { at: 'up', hp: 999 }, items: [ring], equipped: { weapon: null, ring1: 'i1' } }), id('c1'), RULES);
    expect(r.life, 'max HP 120').toEqual({ at: 'up', hp: 120 });
    expect(r.shield).toEqual({ amount: 51, until: tick(RULES.fight.shieldLife * F.round) });
    expect(hunterRow(hunter({ items: [ring] }), id('c1'), RULES).shield, 'in the bag, no shield').toBeNull();
  });
  test('a worn status never goes back to the sheet when the fight writes its statuses back', () => {
    const r = hunterRow(hunter({ skills: [{ type: 'passive', bonus: {}, worn: PAIN_IS_POWER }], conditions: [condition('stealth', STEALTH, null)] }), id('c1'), RULES);
    expect(r.statuses.filter(onSheet).map(s => s.key)).toEqual([statusKey('stealth')]);
  });
});

describe('what a held thing lets its holder use in a fight (item-stats 6.1)', () => {
  const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
  const ROUNDS = 3;
  /** Bulwark: a shield of 10 + 20% of max HP on its user, ready again `ROUNDS` rounds later. */
  const support = skill('support', 'Bulwark');
  const BULWARK: Ability = {
    ...support, aim: 'self', shape: { kind: 'self' }, range: tiles(0), delivery: { kind: 'sure' },
    effect: { type: 'shield', by: 'hand', formula: f('10 + 0.2 * hpmax') }, cost: { ...support.cost, cooldown: tick(ROUNDS * F.round) },
  };
  const LAST_LIGHT: Ability = { ...skill('support', 'Last Light'), aim: 'self', shape: { kind: 'self' }, range: tiles(0) };
  const ring = (n: number, o: object = {}) => ({ id: `i${n}`, name: 'Bulwark Ring', rar: 'rare', bonus: {}, active: BULWARK, ...o });
  const worn = wornAbilityId(BULWARK.id);
  const names = (h: RowHunter) => hunterAbilities(h, RULES).map(a => a.id);

  test('a worn item\'s active follows the skills, under its own id; the same item in the bag gives none', () => {
    const h = hunter({ items: [ring(1)], equipped: { weapon: null, ring1: 'i1' }, skills: [active(skill('strike', 'Move 0'))] });
    expect(names(h)).toEqual([ATTACK_ID, abilityId('move-0'), worn]);
    expect(hunterAbilities(h, RULES)[2]).toEqual({ ...BULWARK, id: worn });
    expect(names(hunter({ items: [ring(1)] })), 'in the bag').toEqual([ATTACK_ID]);
  });

  test('the active title\'s active is its hunter\'s; another title\'s is not', () => {
    const titles = [{ id: 't1', bonus: {}, active: LAST_LIGHT }, { id: 't2', bonus: {}, active: BULWARK }];
    expect(names(hunter({ titles, titleId: 't1' }))).toEqual([ATTACK_ID, wornAbilityId(LAST_LIGHT.id)]);
    expect(names(hunter({ titles, titleId: 't2' }))).toEqual([ATTACK_ID, worn]);
    expect(names(hunter({ titles, titleId: null })), 'no active title').toEqual([ATTACK_ID]);
  });

  test('two worn rings of one active give it once, and a skill of the same id keeps both', () => {
    const h = hunter({ items: [ring(1), ring(2)], equipped: { weapon: null, ring1: 'i1', ring2: 'i2' }, skills: [active(BULWARK)] });
    expect(names(h)).toEqual([ATTACK_ID, BULWARK.id, worn]);
  });

  test('a player uses a worn Bulwark in a fight: it shields 34 at max HP 120, spends nothing in the bag, and waits its cooldown, shortened by ability haste', () => {
    // a level 1 hunter of base stats has `hpBase` max HP; the GM's adjustment brings it to 120
    const fought = (haste: number) => {
      const h = hunter({ hpAdj: 120 - F.hpBase, life: { at: 'up', hp: 120 }, items: [ring(1, { bonus: { haste } })], equipped: { weapon: null, ring1: 'i1' } });
      const commands: Command[] = [
        { type: 'add', fightId: fightId('f'), rows: [hunterRow(h, id('c1'), RULES), ...monsterRows(monster(), [id('m1')], R)], openings: [] },
        { type: 'start', openings: [{ id: id('c1'), d20: 20, tie: 0 }, { id: id('m1'), d20: 1, tie: 0 }] },
      ];
      const started = commands.reduce<Fight | null>((g, cmd) => reduce(g, cmd, { rules: RULES }).fight, null)!;
      const now = started.phase === 'running' ? started.now : tick(-1);
      const used = reduce(started, { type: 'act', by: id('c1'), ability: worn, aim: id('c1'), rolls: { dice: {}, react: {} } as Rolls }, { rules: RULES });
      return { now, used, row: used.fight!.rows.find(r => r.id === id('c1'))! };
    };
    const plain = fought(0);
    expect(plain.used.effects.filter(e => e.type === 'refused')).toEqual([]);
    expect(plain.row.shield?.amount, '10 + 0.2 * 120').toBe(34);
    expect(itemOfAbility(plain.row.abilities.find(a => a.id === worn)!), 'no bag item is its use').toBeNull();
    expect(plain.row.readyAt[worn]).toBe(tick(plain.now + ROUNDS * F.round));
    // ability haste 50: the cooldown times 100 / 150, rounded up in ticks (League's formula)
    const hasted = fought(50);
    expect(hasted.row.readyAt[worn]).toBe(tick(hasted.now + Math.ceil(ROUNDS * F.round * 100 / 150)));
  });

  test('a held active limited to once a fight is refused the second time in that fight', () => {
    const once: Ability = { ...BULWARK, cost: { ...BULWARK.cost, cooldown: tick(0) }, gates: [{ kind: 'uses', per: 'fight', n: 1 }] };
    const h = hunter({ items: [ring(1, { active: once })], equipped: { weapon: null, ring1: 'i1' } });
    const commands: Command[] = [
      { type: 'add', fightId: fightId('f'), rows: [hunterRow(h, id('c1'), RULES), ...monsterRows(monster(), [id('m1')], R)], openings: [] },
      { type: 'start', openings: [{ id: id('c1'), d20: 20, tie: 0 }, { id: id('m1'), d20: 1, tie: 0 }] },
    ];
    const started = commands.reduce<Fight | null>((g, cmd) => reduce(g, cmd, { rules: RULES }).fight, null)!;
    const use: Command = { type: 'act', by: id('c1'), ability: worn, aim: id('c1'), rolls: { dice: {}, react: {} } as Rolls };
    const first = reduce(started, use, { rules: RULES });
    expect(first.effects.filter(e => e.type === 'refused')).toEqual([]);
    expect(first.fight!.rows.find(r => r.id === id('c1'))!.used?.[worn], 'its one use a fight spent').toBe(1);
    let g = first.fight!;
    for (let turns = 0; g.phase === 'running' && g.currentId !== id('c1') && turns < 10; turns++) g = reduce(g, { type: 'endTurn', by: g.currentId }, { rules: RULES }).fight!;
    expect(g.phase === 'running' && g.currentId, 'its holder\'s next turn').toBe(id('c1'));
    expect(reduce(g, use, { rules: RULES }).effects).toContainEqual({ type: 'refused', reason: 'noUses' });
  });
});

test('a hunter on another phone joins as a hunter here does, written back to its room key', () => {
  const h = hunter({ conditions: [condition('slowed', SLOWED, 1)], rank: 'B' });
  const remote = remoteRow(h, sheetKey('dev-1:h1'), id('c1'), RULES);
  expect(remote.holder).toEqual({ kind: 'remote', remote: sheetKey('dev-1:h1') });
  expect({ ...remote, holder: null }).toEqual({ ...hunterRow(h, id('c1'), RULES), holder: null });
});

describe('a monster', () => {
  test('a pack of three goblins is Goblin A, B and C, each a foe with full HP and mana, its XP and a threat table', () => {
    const rows = monsterRows(monster(), [id('m1'), id('m2'), id('m3')], R);
    const sheet = monsterSheet('E', 'skirmisher', 'normal', RULES);
    expect(rows.map(r => r.name)).toEqual(['Goblin A', 'Goblin B', 'Goblin C']);
    for (const r of rows) {
      expect([r.side, r.kind, r.tier, rowHp(r), r.mana, r.fatigue, r.xp, r.threat, r.holder, r.stagger]).toEqual(['foe', 'monster', 0, sheet.hpMax, sheet.manaMax, 0, 10, {}, null, null]);
    }
    expect(monsterRows(monster(), [id('m1')], R).map(r => r.name)).toEqual(['Goblin']);
  });

  test('its seed\'s tweak scales its HP, adds to its stats and carries its traits', () => {
    const tweak = { hp: 0.7, stats: { ins: 8 }, traits: ['slow' as const] };
    const [r] = monsterRows(monster({ archetype: 'caster', tweak }), [id('m1')], R);
    expect(r!.origin).toEqual({ kind: 'monster', name: 'Goblin', rank: 'E', archetype: 'caster', monsterKind: 'normal', tweak: { ...tweak, dealt: 1 } });
    expect(rowHp(r!)).toBe(monsterSheet('E', 'caster', 'normal', RULES, [], { ...tweak, dealt: 1 }).hpMax);
    expect(rowHp(r!)).toBeLessThan(monsterSheet('E', 'caster', 'normal', RULES).hpMax);
  });

  test('a picture its GM picked rides on every row of its pack, and a saved fight reads it back; one never picked is not stored', () => {
    const picked = monsterRows(monster({ icon: 'raven' }), [id('m1'), id('m2')], R);
    expect(picked.map(r => r.origin.kind === 'monster' ? r.origin.icon : null)).toEqual(['raven', 'raven']);
    expect(monsterRows(monster(), [id('m1')], R)[0]!.origin, 'the default is never stored').not.toHaveProperty('icon');
    const f = reduce(null, { type: 'add', fightId: fightId('f'), rows: picked, openings: [] }, { rules: RULES }).fight!;
    const read = parseFight(JSON.parse(JSON.stringify(f)), RULES)!;
    expect(read.rows.map(r => r.origin.kind === 'monster' ? r.origin.icon : null)).toEqual(['raven', 'raven']);
    const stale = JSON.parse(JSON.stringify(f));
    stale.rows[0].origin.icon = 'no-such-icon';
    expect(parseFight(stale, RULES)!.rows[0]!.origin, 'a key this build lacks is read as none').not.toHaveProperty('icon');
  });

  test('attacks with its archetype\'s attack first, then its own; its own of the same id is left out', () => {
    const bite = skill('strike', 'Bite'), clash = { ...skill('shot', 'Clash'), id: ATTACK_ID };
    const names = (archetype: RowMonster['archetype']) =>
      monsterRows(monster({ archetype, abilities: [clash, bite] }), [id('m1')], R)[0]!.abilities.map(a => a.name);
    expect([names('brute'), names('skirmisher'), names('caster')]).toEqual([['Strike', 'Bite'], ['Shot', 'Bite'], ['Curse', 'Bite']]);
    expect(monsterRows(monster({ archetype: 'brute' }), [id('m1')], R)[0]!.abilities).toEqual([ARCHETYPE_ATTACKS.brute(RULES)]);
  });

  test('starts with its statuses from the rules\' defs at its joining, itself their source at its rank\'s tier; a key the rules lack is left out', () => {
    const m = monster({ rank: 'B', statuses: [{ key: 'regenerating', rounds: null }, { key: 'nothing-known', rounds: 1 }, { key: 'poisoned', rounds: 2 }] });
    const [a, b] = monsterRows(m, [id('m1'), id('m2')], R);
    expect(a!.statuses).toEqual([
      { key: statusKey('regenerating'), def: REGEN, source: { id: id('m1'), tier: 3 }, until: null, since: tick(0), settledAt: tick(0) },
      { key: statusKey('poisoned'), def: POISONED, source: { id: id('m1'), tier: 3 }, until: tick(2000), since: tick(0), settledAt: tick(0) },
    ]);
    expect(b!.statuses.map(s => s.source.id)).toEqual([id('m2'), id('m2')]);
  });

  test('starts with the stacks its sheet names of a stacking status, cut to the def\'s cap; a plain status holds no count', () => {
    const PAIN: StatusDef = { label: 'Pain', desc: '', ops: [], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
    const m = monster({ statuses: [{ key: 'pain', rounds: null, stacks: 3 }, { key: 'regenerating', rounds: null, stacks: 3 }] });
    const [a] = monsterRows(m, [id('m1')], { ...R, conditions: { ...R.conditions, pain: PAIN } });
    expect(a!.statuses.map(s => [s.key, s.stacks])).toEqual([[statusKey('pain'), 3], [statusKey('regenerating'), undefined]]);
    const [b] = monsterRows(monster({ statuses: [{ key: 'pain', rounds: null, stacks: 15 }] }), [id('m1')], { ...R, conditions: { pain: PAIN } });
    expect(b!.statuses[0]!.stacks).toBe(10);
  });

  test('an elite carries a stagger bar of 2.5 same-rank hits on its own body and a boss one of 4; a normal monster has none', () => {
    const body = (rank: 'E' | 'C' | 'S', kind: 'normal' | 'elite' | 'boss', archetype: 'brute' | 'caster' = 'brute') => ({ rank, archetype, kind, tweak: NO_TWEAK });
    for (const rank of ['E', 'C', 'S'] as const) {
      for (const [kind, bar] of [['elite', 2.5], ['boss', 4]] as const) {
        const hit = simHit(rank, RULES, 'brute', kind);
        expect(sameRankHit(body(rank, kind), RULES)).toBe(hit);
        expect(staggerOf(body(rank, kind), RULES)).toEqual({ fill: 0, max: bar * hit, hit });
      }
      expect(staggerOf(body(rank, 'normal'), RULES)).toBeNull();
      // the boss's armor is 1.5 times a normal brute's, so a same-rank hit on it is smaller
      expect(sameRankHit(body(rank, 'boss'), RULES)).toBeLessThan(sameRankHit(body(rank, 'normal'), RULES));
    }
    const hit = simHit('C', RULES, 'caster', 'boss');
    expect(monsterRows(monster({ rank: 'C', archetype: 'caster', kind: 'boss' }), [id('m1')], R)[0]!.stagger).toEqual({ fill: 0, max: 4 * hit, hit });
  });
});

describe('a mythic (notes-11-keystones.md, design B.3)', () => {
  // Zaratan's words (registry/mythics.ts): on the Shore, its first phase, it wears the Shell of a Thousand Years.
  const ON_RULES: Rules = { ...RULES, fight: { ...RULES.fight, mythic: { ...RULES.fight.mythic, scripts: true } } };
  const ON = { ...ON_RULES, conditions: R.conditions };
  const zaratan = (o: Partial<RowMonster> = {}) => monster({ name: 'Zaratan', rank: 'S', archetype: 'brute', kind: 'mythic', script: 'zaratan-the-island-that-wakes', ...o });
  const angelWeighed = (f: Fight): Fight => {
    const s = mythicStep(f.rows[1]!.mythic!, { type: 'announce', omen: 'weighed' as OmenKey, aim: f.rows[0]!.id, hpAt: rowHp(f.rows[1]!) });
    if (isRefused(s)) throw new Error(s.why);
    return { ...f, rows: f.rows.map((r, i) => (i === 1 ? { ...r, mythic: s } as Body : r)) };
  };

  test('a mythic row starts calm in its first phase wearing its statuses', () => {
    const [r] = monsterRows(zaratan({ statuses: [{ key: 'regenerating', rounds: null }] }), [id('m1')], ON);
    expect(r!.mythic).toEqual({ at: 'calm', script: 'zaratan-the-island-that-wakes', phase: 0, beat: 0, since: tick(0) });
    expect(r!.statuses.map(s => [s.key, s.def.label, s.source, s.until])).toEqual([
      [statusKey('regenerating'), 'Regenerating', { id: id('m1'), tier: 5 }, null],
      [statusKey('mythic-shell'), 'Shell of a Thousand Years', { id: id('m1'), tier: 5 }, null],
    ]);
    const add = (rows: NewRow[]) => reduce(null, { type: 'add', fightId: fightId('f'), rows, openings: [] }, { rules: ON_RULES }).fight!.rows[0]!;
    const off = add(monsterRows(zaratan(), [id('m1')], R));
    expect(add([r!]).sheet.armor, 'the shell is 30 more armor').toBe(off.sheet.armor + 30);
    expect(monsterRows(monster({ kind: 'boss' }), [id('m1')], ON)[0]!.mythic, 'a monster of another kind plays no script').toBeNull();
    const { script: _named, ...unnamed } = zaratan();
    expect(monsterRows(unnamed, [id('m1')], ON)[0]!.mythic, 'a mythic that names none plays plain').toMatchObject({ script: 'plain' });
  });

  // A script's `hp` is a factor on its seed's max HP (registry/mythics.ts); the Fourth Rider's is not 1.
  test('a mythic row\'s max HP is its seed\'s times its script\'s hp, and its seed\'s with mythic phases off', () => {
    const rider = monster({ name: 'The Fourth Rider', rank: 'S', archetype: 'caster', kind: 'mythic', script: 'the-fourth-rider', tweak: { hp: 1.5 } });
    const factor = MYTHICS['the-fourth-rider'].hp;
    expect(factor).not.toBe(1);
    const hpOf = (tweakHp: number) => monsterSheet('S', 'caster', 'mythic', RULES, [], { ...NO_TWEAK, hp: tweakHp }).hpMax;
    const [on] = monsterRows(rider, [id('m1')], ON), [off] = monsterRows(rider, [id('m1')], R);
    expect([on!.life, off!.life]).toEqual([{ at: 'up', hp: hpOf(1.5 * factor) }, { at: 'up', hp: hpOf(1.5) }]);
  });

  test('a mythic joining a running fight counts its phase\'s clock from its joining', () => {
    const ctx: Ctx = { rules: ON_RULES };
    const rows = [hunterRow(hunter(), id('c1'), RULES), ...monsterRows(monster(), [id('g1')], R)];
    const setup = reduce(null, { type: 'add', fightId: fightId('f'), rows, openings: [] }, ctx).fight;
    const running = reduce(setup, { type: 'start', openings: rows.map((r, i) => ({ id: r.id, d20: 10, tie: i })) }, ctx).fight!;
    expect(running.phase).toBe('running');
    const later = { ...running, now: tick(4000) } as Fight;
    const joined = reduce(later, { type: 'add', fightId: fightId('f'), rows: monsterRows(zaratan(), [id('m1')], ON), openings: [{ id: id('m1'), d20: 10, tie: 2 }] }, ctx).fight!;
    expect(joined.rows.find(r => r.id === id('m1'))!.mythic?.since).toBe(tick(4000));
  });

  test('with mythic phases off a mythic row holds no standing', () => {
    const [r] = monsterRows(zaratan(), [id('m1')], R);
    expect([r!.mythic, r!.statuses]).toEqual([null, []]);
    expect([hunterRow(hunter(), id('c1'), RULES).mythic, shadowRow(shadow(), 'h1', id('x1'), RULES).mythic]).toEqual([null, null]);
  });

  test('a stored mythic row reads back', () => {
    const ctx: Ctx = { rules: ON_RULES };
    const rows = [hunterRow(hunter(), id('c1'), RULES), ...monsterRows(monster({ name: 'Angel', rank: 'S', kind: 'mythic', script: 'angel-of-the-last-trumpet' }), [id('m1')], ON)];
    const f = angelWeighed(reduce(null, { type: 'add', fightId: fightId('f'), rows, openings: [] }, ctx).fight!);
    expect(f.rows[1]!.mythic).toMatchObject({ at: 'omen', omen: 'weighed', aim: id('c1') });
    const stored = JSON.parse(JSON.stringify(f));
    expect(parseFight(stored, RULES), 'it reads back with the switch off too: the switch makes rows, it does not read them').toEqual(f);
    const broken = (change: (m: Record<string, unknown>) => void) => { const v = JSON.parse(JSON.stringify(f)); change(v.rows[1].mythic); return parseFight(v, RULES); };
    expect(broken(m => { m.script = 'no-such-script'; }), 'a script the registry lacks').toBeNull();
    expect(broken(m => { m.phase = 3; }), 'a phase past its script\'s last').toBeNull();
    expect(broken(m => { m.omen = 'note-of-another'; }), 'an omen its script lacks').toBeNull();
    expect(broken(m => { m.omen = 'stars'; m.at = 'faltering'; }), 'a faltering omen that cannot be weakened').toBeNull();
    const hunterWithOne = JSON.parse(JSON.stringify(f));
    hunterWithOne.rows[0].mythic = hunterWithOne.rows[1].mythic;
    expect(parseFight(hunterWithOne, RULES), 'a hunter holds none').toBeNull();
  });
});

describe('a shadow', () => {
  test('has the body of its grade\'s kind: Normal a normal, Elite, Knight and Elite Knight an elite, Commander and Marshal a boss', () => {
    const KIND: Record<ShadowGrade, MonsterKind> = { Normal: 'normal', Elite: 'elite', Knight: 'elite', 'Elite Knight': 'elite', Commander: 'boss', Marshal: 'boss' };
    for (const grade of SHADOW_GRADES) {
      const r = shadowRow(shadow({ grade, hp: 1e9 }), 'h1', id('x1'), RULES);
      expect([grade, rowHp(r)]).toEqual([grade, monsterSheet('C', 'brute', KIND[grade], RULES).hpMax]);
      expect([grade, shadowSheet(shadow({ grade }), RULES).hpMax]).toEqual([grade, monsterSheet('C', 'brute', KIND[grade], RULES).hpMax]);
    }
  });

  test('joins on the party side with its HP as its hunter keeps it and its archetype\'s attack, written back to its hunter', () => {
    const r = shadowRow(shadow({ archetype: 'caster' }), 'h1', id('x1'), RULES);
    expect([r.side, r.kind, r.name, r.tier, rowHp(r), r.xp, r.threat, r.stagger, r.statuses]).toEqual(['party', 'shadow', 'Igris', 2, 12, 0, null, null, []]);
    expect(r.holder).toEqual({ kind: 'shadow', hunterId: hunterId('h1'), shadowId: shadowId('s1') });
    expect(r.abilities).toEqual([ARCHETYPE_ATTACKS.caster(RULES)]);
  });
});

test('a name past 60 characters is cut, and a pack keeps its letter', () => {
  const long = 'x'.repeat(70);
  expect(hunterRow(hunter({ name: long }), id('c1'), RULES).name).toBe('x'.repeat(60));
  expect(shadowRow(shadow({ name: long }), 'h1', id('x1'), RULES).name).toBe('x'.repeat(60));
  expect(monsterRows(monster({ name: long }), [id('m1'), id('m2')], R).map(r => r.name)).toEqual([`${'x'.repeat(58)} A`, `${'x'.repeat(58)} B`]);
});

test('every kind of row joins one fight, which starts and stores and reads back as it was', () => {
  const ctx: Ctx = { rules: RULES };
  const rows = [
    hunterRow(hunter({ conditions: [condition('slowed', SLOWED, 2)] }), id('c1'), RULES),
    remoteRow(hunter({ id: 'h2', name: 'Mira' }), sheetKey('dev-2:h2'), id('c2'), RULES),
    shadowRow(shadow(), 'h1', id('x1'), RULES),
    ...monsterRows(monster(), [id('m1'), id('m2')], R),
    ...monsterRows(monster({ name: 'Kasaka', rank: 'D', archetype: 'brute', kind: 'boss', statuses: [{ key: 'regenerating', rounds: null }] }), [id('m3')], R),
  ];
  const commands: Command[] = [
    { type: 'add', fightId: fightId('f'), rows, openings: [] },
    { type: 'start', openings: rows.map((r, i) => ({ id: r.id, d20: 10, tie: i })) },
  ];
  let f: Fight | null = null;
  for (const cmd of commands) {
    const r = reduce(f, cmd, ctx);
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    f = r.fight;
  }
  expect(f!.phase).toBe('running');
  expect(f!.rows.map(r => r.name)).toEqual(['Brakk', 'Mira', 'Igris', 'Goblin A', 'Goblin B', 'Kasaka']);
  expect(parseFight(JSON.parse(JSON.stringify(f)), RULES)).toEqual(f);
});

test('a running fight holding a hunter of any level a hunter can hold reads back as it was: the game has no top level (BUG-rules-18)', () => {
  const ctx: Ctx = { rules: RULES };
  for (const level of [201, MAX_LEVEL]) {
    const rows = [hunterRow(hunter({ level }), id('c1'), RULES), ...monsterRows(monster(), [id('m1')], R)];
    const added = reduce(null, { type: 'add', fightId: fightId('f'), rows, openings: [] }, ctx).fight;
    const f = reduce(added, { type: 'start', openings: rows.map((r, i) => ({ id: r.id, d20: 10, tie: i })) }, ctx).fight;
    expect(f!.phase, `level ${level}`).toBe('running');
    expect(parseFight(JSON.parse(JSON.stringify(f)), RULES), `level ${level}`).toEqual(f);
  }
});

describe('a summon (kits design 1.9)', () => {
  const R = { ...RULES, conditions: { slowed: SLOWED } };
  const spec = { name: 'Sprite', archetype: 'skirmisher', rounds: 9, statuses: [{ key: statusKey('slowed'), rounds: 2 }, { key: statusKey('nowhere'), rounds: 1 }] } as const;
  const row = summonRow({ id: id('c-hwei'), side: 'party', tier: 2 }, spec, id('c-sprite'), tick(3000), R);

  test('is a normal monster\'s body of its archetype at its user\'s rank, with the archetype\'s attack, on its user\'s side', () => {
    expect([row.kind, row.side, row.tier, row.origin]).toEqual(['summon', 'party', 2, { kind: 'monster', name: 'Sprite', rank: 'C', archetype: 'skirmisher', monsterKind: 'normal', tweak: { hp: 1, dealt: 1, stats: {}, traits: [] } }]);
    expect(row.abilities.map(a => a.id)).toEqual([ARCHETYPE_ATTACKS.skirmisher(RULES).id]);
    expect([rowHp(row), row.xp, row.holder, row.threat, row.stagger]).toEqual([monsterSheet('C', 'skirmisher', 'normal', RULES, [{ op: 'speed', pct: -30 }]).hpMax, 0, null, null, null]);
  });

  test('is owned by its user and leaves after its rounds, at most `summonRounds`; its statuses the rules know come with it from now', () => {
    expect([row.owner, row.until]).toEqual([id('c-hwei'), tick(3000 + F.kit.summonRounds * F.round)]);
    expect(row.statuses.map(s => [s.key, s.until, s.source])).toEqual([['slowed', tick(3000 + 2 * F.round), { id: id('c-sprite'), tier: 2 }]]);
  });

  test('on the foes\' side keeps a threat table, as a monster does', () => {
    expect(summonRow({ id: id('m'), side: 'foe', tier: 0 }, spec, id('s'), tick(0), R).threat).toEqual({});
  });
});

describe('uses spent this gate (kits table 2.3)', () => {
  test('a hunter\'s row starts with the uses its sheet spent of an ability limited a gate, and none of any other', () => {
    const daily = { ...skill('strike', 'Daily'), gates: [{ kind: 'uses', per: 'gate', n: 1 }] } as Ability;
    const row = hunterRow(hunter({ skills: [active(daily), active(skill('shot', 'Plain'))], used: { daily: 1, plain: 3 } }), id('c1'), RULES);
    expect(row.used).toEqual({ daily: 1 });
    expect(hunterRow(hunter(), id('c1'), RULES).used).toBeUndefined();
  });
});

describe('a row knows its monster by a field, not by its name (implicit audit 3, B2 and C2)', () => {
  test('a pack\'s rows carry their monster\'s own name in their origin, letters aside: "Type A" stays "Type A" for the codex', () => {
    const rows = monsterRows(monster({ name: 'Type A' }), [id('m1'), id('m2')], R);
    expect(rows.map(r => [r.name, r.origin.kind === 'monster' ? r.origin.name : null])).toEqual([['Type A A', 'Type A'], ['Type A B', 'Type A']]);
    expect(codexKey(rows[1]!.origin.kind === 'monster' ? rows[1]!.origin.name : '', 'E')).toBe(codexKey('type a', 'E'));
  });
  test('a hotbar\'s pins key on a hunter\'s id and a monster\'s own name: one pack shares them, two hunters of one name do not', () => {
    const [a, b] = monsterRows(monster({ name: 'Unit X' }), [id('m1'), id('m2')], R);
    expect([pinKeyOf(a!), pinKeyOf(b!)]).toEqual(['monster:Unit X', 'monster:Unit X']);
    const one = hunterRow(hunter({ id: 'h1', name: 'Kai' }), id('c1'), RULES), two = hunterRow(hunter({ id: 'h2', name: 'Kai' }), id('c2'), RULES);
    expect([pinKeyOf(one), pinKeyOf(two)]).toEqual(['hunter:h1', 'hunter:h2']);
  });
});

describe('keystones on a fight\'s rows (notes-11-keystones.md, design A.5)', () => {
  const on = withKeystones(R), off = R;
  const labels = (r: NewRow) => r.statuses.filter(s => s.worn).map(s => s.def.label);
  const markOf = keystoneOf({ tier: 'mark', stat: 'str' }, RULES), apexOf = keystoneOf({ tier: 'apex', stat: 'str' }, RULES);

  test('a hunter\'s row wears its keystones: the worn status of each, the active of each after the hunter\'s own', () => {
    const focused = hunter({ rank: 'B', level: 20, stats: stats({ str: 50, vit: 12 }) });
    const r = hunterRow(focused, id('c1'), on);
    expect(labels(r)).toEqual([markOf.worn!.label]);
    expect(r.abilities.map(a => a.id)).toEqual([ATTACK_ID, wornAbilityId(apexOf.active!.id)]);
    expect(r.statuses.every(s => s.source.tier === 3 && s.until === null), 'at the hunter\'s rank, until removed').toBe(true);
    expect(labels(remoteRow(focused, sheetKey('room:h1'), id('c2'), on)), 'a hunter on another phone is read the same').toEqual([markOf.worn!.label]);
  });

  test('with keystones off no row wears one', () => {
    const focused = hunter({ rank: 'B', level: 20, stats: stats({ str: 50, vit: 12 }) });
    expect(RULES.fight.keystone.on, 'the shipped rules').toBe(false);
    expect(labels(hunterRow(focused, id('c1'), R))).toEqual([]);
    expect(labels(monsterRows(monster({ rank: 'B', archetype: 'brute', kind: 'boss' }), [id('m1')], R)[0]!)).toEqual([]);
  });

  test('a hunter under the share, a hunter below the rank and a room with the switch off hold none', () => {
    expect(labels(hunterRow(hunter({ rank: 'B', level: 20, stats: stats({ str: 14, agi: 14, vit: 14, ins: 14, dis: 14, pre: 14, pow: 14, ctl: 14 }) }), id('c1'), on)), 'an even spread').toEqual([]);
    expect(labels(hunterRow(hunter({ rank: 'E', stats: stats({ str: 40 }) }), id('c1'), on)), 'rank E').toEqual([]);
    const [r] = [hunterRow(hunter({ rank: 'B', level: 20, stats: stats({ str: 50, vit: 12 }) }), id('c1'), off)];
    expect([labels(r!), r!.abilities.length]).toEqual([[], 1]);
  });

  test('a gear bonus never earns one, and a fight status never takes one away', () => {
    const plain = hunter({ rank: 'B', level: 20, items: [{ id: 'g', name: 'Belt', bonus: { str: 40 } }], equipped: { belt: 'g' } });
    expect(labels(hunterRow(plain, id('c1'), on))).toEqual([]);
    const fear: StatusDef = { label: 'Frightened', desc: '', ops: [{ op: 'stat', key: 'str', amount: { kind: 'number', value: -20 } }] };
    const marked = hunter({ rank: 'D', level: 12, stats: stats({ str: 30, vit: 15 }), conditions: [condition('frightened', fear, null)] });
    expect(labels(hunterRow(marked, id('c1'), on))).toEqual([markOf.worn!.label]);
  });

  test('a finished Job Change adds the confluence\'s awakened powers after it, and only then', () => {
    const last = { ...stepQuest('Mage', 3, { chainId: jcid('jc1'), questId: qid('q3'), at: '2026-01-01', level: 10 }), status: 'done' as const, doneAt: '2026-01-01', told: true };
    const mage = hunter({ rank: 'C', level: 14, stats: stats({ pow: 30, ctl: 24 }), job: 'Mage' });
    const confluence = keystoneOf({ tier: 'confluence', pair: 'pow+ctl' }, RULES);
    const before = hunterRow(mage, id('c1'), on), after = hunterRow({ ...mage, jobDone: 'Mage' }, id('c1'), on);
    expect(labels(before)).toContain(confluence.worn!.label);
    expect(labels(before)).not.toContain(confluence.awakened!.worn!.label);
    expect(labels(after)).toContain(confluence.awakened!.worn!.label);
    expect(labels(after).indexOf(confluence.worn!.label)).toBeLessThan(labels(after).indexOf(confluence.awakened!.worn!.label));
  });

  test('a normal monster holds none; an elite, a boss and a mythic hold what their stats earn', () => {
    const rank = 'B' as const, archetype = 'brute' as const;
    const stand = (kind: RowMonster['kind']) => monsterRows(monster({ rank, archetype, kind }), [id('m1')], on)[0]!;
    expect(labels(stand('normal'))).toEqual([]);
    expect(stand('normal').abilities.map(a => a.id)).toEqual([ATTACK_ID]);
    for (const kind of ['elite', 'boss', 'mythic'] as const) {
      expect(labels(stand(kind)), kind).toContain(markOf.worn!.label);
      expect(stand(kind).abilities.map(a => a.id), kind).toContain(wornAbilityId(apexOf.active!.id));
    }
    expect(labels(monsterRows(monster({ rank, archetype, kind: 'boss' }), [id('m1')], off)[0]!), 'switch off').toEqual([]);
  });

  test('a monster below rank D holds none, and a shadow holds none at any kind', () => {
    expect(labels(monsterRows(monster({ rank: 'E', archetype: 'brute', kind: 'boss' }), [id('m1')], on)[0]!)).toEqual([]);
    expect(labels(shadowRow(shadow({ rank: 'S', grade: 'Marshal' }), 'h1', id('s1'), on))).toEqual([]);
  });
});
