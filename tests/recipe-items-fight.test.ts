// The recipe items in a fight (item-stats units 3 and 10): each worn status or active is put on a row as an item gives it
// and driven through the fight reducer, as tests/triggers.test.ts does. Each expected number is worked from the item's rule.
import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { tiles } from '../src/core/combat/space.ts';
import type { Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId, tag } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, Origin, Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { afterDefence } from '../src/core/combat/land.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow } from '../src/core/combat/fight.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { RECIPE_ITEMS, itemOf } from '../src/core/registry/items.ts';
import { lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';

const ctx: Ctx = { rules: RULES };
const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const id = combatantId;
const origin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
const FAR = { range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as const;
const strike = (name: string, text: string, o: Partial<Ability> = {}): Ability =>
  ({ ...abilityOf('strike', { id: abilityId(name), name }, RULES), ...FAR, effect: { type: 'physical', by: 'hand', formula: f(text) }, ...o });
const HIT = strike('hit', '10');
const SPELL = strike('spell', '10', { tags: [tag('spell')] });
const BIG = strike('big', '999');
const MEND: Ability = abilityOf('support', {
  id: abilityId('mend'), name: 'Mend', aim: 'self', shape: { kind: 'self' }, range: tiles(0), delivery: { kind: 'sure' },
  effect: { type: 'heal', by: 'hand', formula: f('20') },
}, RULES);
const heavyOrigin: Origin = { kind: 'hunter', build: { stats: { ...baseStats(RULES.fight), vit: 80 }, level: 20, gear: kitGear('heavy', RULES), perks: {} } };
const item = (name: string) => itemOf(RULES, RECIPE_ITEMS.find(d => d.name === name)!);
const wornOf = (name: string): Status => {
  const def: StatusDef = item(name).worn!;
  return { key: statusKey(name), def, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) } as Status;
};
function row(name: string, side: Side, statuses: Status[] = [], o: RowPatch<NewRow> = {}): NewRow {
  const { kind, hp, ...rest } = o;
  const hpMax = modified(rest.origin ?? origin, statuses, RULES).sheet.hpMax;
  return {
    id: id(name), name, side, ...lifeAt(kind ?? (side === 'party' ? 'hunter' : 'monster'), hp ?? hpMax), origin, tier: 0, place: null, mana: 10, fatigue: 0, shield: null, stagger: null,
    channel: null, threat: side === 'foe' ? {} : null, statuses, readyAt: {}, abilities: [HIT, SPELL, BIG], intent: null, holder: null, xp: 0, mythic: null, ...rest,
  } as NewRow;
}
function step(fight: Fight | null, cmd: Command): { fight: Fight; refused: string | null } {
  const r = reduce(fight, cmd, ctx);
  const no = r.effects.find(e => e.type === 'refused');
  return { fight: r.fight!, refused: no && no.type === 'refused' ? no.reason : null };
}
function play(...commands: Command[]): Fight {
  let fight: Fight | null = null;
  for (const cmd of commands) {
    const s = step(fight, cmd);
    if (s.refused) throw new Error(`${cmd.type} refused: ${s.refused}`);
    fight = s.fight;
  }
  return fight!;
}
const body = (fight: Fight, name: string): Body => fight.rows.find(r => r.id === name)!;
const duel = (a: NewRow, m: NewRow): Command[] => [
  { type: 'add', fightId: fightId('f'), rows: [a, m], openings: [] },
  { type: 'start', openings: [a, m].map((r, i) => ({ id: r.id, d20: i === 0 ? 20 : 1, tie: 0 })) },
];
const use = (by: string, at: string, a: Ability = HIT, react = 10): Command => ({ type: 'act', by: id(by), ability: a.id, aim: id(at), rolls: { dice: {}, react: { [at]: react } }, force: true });
const lost = (fight: Fight, name: string): number => { const b = body(fight, name); return b.sheet.hpMax - rowHp(b); };
const sheetOf = (statuses: Status[]) => modified(origin, statuses, RULES).sheet;

describe('the recipe items in a fight', () => {
  test('Thornmail: a foe that strikes its wearer takes magic damage of 3% of the wearer\'s armor and gets Grievous Wounds for 2 rounds', () => {
    const thorn = wornOf('Thornmail');
    const armor = modified(heavyOrigin, [thorn], RULES).sheet.armor;
    const afterHit = play(...duel(row('A', 'party', [], { abilities: [HIT, MEND] }), row('M', 'foe', [thorn], { origin: heavyOrigin })), use('A', 'M'));
    const reflected = afterDefence(0.03 * armor, 'arcane', sheetOf([]), sheetOf([]), RULES);
    expect(lost(afterHit, 'A')).toBe(reflected);
    expect(reflected).toBeGreaterThan(1);
    const gw = body(afterHit, 'A').statuses.find(s => s.key === statusKey('grievous'));
    expect(gw).toBeDefined();
    expect(gw!.until).toBe(tick(gw!.since + 2 * RULES.fight.round));
    // A subsequent heal on A is cut by 40% while Grievous Wounds holds
    const hurtA = row('A', 'party', [], { hp: 10, abilities: [HIT, MEND] });
    const afterHeal = play(...duel(hurtA, row('M', 'foe', [thorn], { origin: heavyOrigin })), use('A', 'M'), use('A', 'A', MEND));
    expect(rowHp(body(afterHeal, 'A'))).toBe(10 - reflected + Math.round(20 * 0.6));
  });

  test('Spellblade: the next hit after a "spell" use deals 10% of physical power more, and the hit after that does not', () => {
    const blade = wornOf('Spellblade');
    const base = afterDefence(10, 'physical', sheetOf([blade]), sheetOf([]), RULES);
    const bonus = afterDefence(0.1 * sheetOf([blade]).phys, 'physical', sheetOf([blade]), sheetOf([]), RULES);
    const setup = duel(row('A', 'party', [blade]), row('M', 'foe', []));
    const first = play(...setup, use('A', 'M', SPELL));
    expect(lost(first, 'M')).toBe(base);
    const second = play(...setup, use('A', 'M', SPELL), use('A', 'M'));
    expect(lost(second, 'M') - lost(first, 'M')).toBe(base + bonus);
    const third = play(...setup, use('A', 'M', SPELL), use('A', 'M'), use('A', 'M'));
    expect(lost(third, 'M') - lost(second, 'M')).toBe(base);
  });

  test('Healer\'s Charm: a kill heals its wearer by 5% of its heal power and its bonus adds Presence and healPower', () => {
    const charmItem = item("Healer's Charm");
    expect(charmItem.bonus).toEqual({ pre: 2, healPower: 4 });
    const charm = wornOf("Healer's Charm");
    const sheet = sheetOf([charm]);
    const hurt = 5;
    const fight = play(...duel(row('A', 'party', [charm], { hp: hurt }), row('M', 'foe')), use('A', 'M', BIG));
    expect(rowHp(body(fight, 'M'))).toBe(0);
    expect(rowHp(body(fight, 'A'))).toBe(hurt + Math.round(0.05 * sheet.sup));
  });

  test('Bulwark Ring: its wearer shields itself for 10 + 10% of max HP, and cannot use it again for 8 rounds', () => {
    const bulwark = item('Bulwark Ring').active!;
    const start = duel(row('A', 'party', [], { abilities: [HIT, bulwark] }), row('M', 'foe'));
    const ready = play(...start);
    const usedAt = body(ready, 'A').at;
    const first = step(ready, use('A', 'A', bulwark));
    expect(first.refused).toBeNull();
    const a = body(first.fight, 'A');
    expect(a.shield?.amount).toBe(Math.round(10 + 0.1 * a.sheet.hpMax));
    expect(a.readyAt[bulwark.id]).toBe(tick(usedAt + 8 * RULES.fight.round));
    expect(step(first.fight, use('A', 'A', bulwark)).refused).toBe('cooldown');
  });

  test('Lifeline Locket: a hit that takes its wearer under 30% HP gives it a shield of 16% of its max HP, and a hit that leaves it at 30% does not', () => {
    const locket = wornOf('Lifeline Locket');
    const hpMax = sheetOf([locket]).hpMax, at30 = Math.ceil(RULES.fight.kit.lowHpAt * hpMax), d = afterDefence(10, 'physical', sheetOf([]), sheetOf([locket]), RULES);
    const under = body(play(...duel(row('A', 'party'), row('M', 'foe', [locket], { hp: at30 })), use('A', 'M')), 'M');
    expect([rowHp(under), under.shield?.amount]).toEqual([at30 - d, Math.round(0.16 * hpMax)]);
    const stays = body(play(...duel(row('A', 'party'), row('M', 'foe', [locket], { hp: at30 + d })), use('A', 'M')), 'M');
    expect([rowHp(stays), stays.shield]).toEqual([at30, null]);
  });

  test('Warden\'s Plate: its wearer has 3% of max HP more armor', () => {
    const plate = wornOf("Warden's Plate");
    const without = sheetOf([]), within = sheetOf([plate]);
    expect(within.armor - without.armor).toBeCloseTo(0.03 * within.hpMax, 9);
    const fight = play(...duel(row('A', 'party', [plate]), row('M', 'foe')));
    expect(body(fight, 'A').sheet.armor).toBeCloseTo(without.armor + 0.03 * within.hpMax, 9);
  });
});
