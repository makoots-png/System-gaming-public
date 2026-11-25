// A hunter added to a fight and removed again (brief-roundtrip step 2): the fight's rows come back as they were, the
// log keeps a line for each, and the hunter's sheet heard of every HP change while it stood in the fight (the `vitals`
// effect), so nothing is owed to it when it leaves. Helpers as tests/fight.test.ts's.
import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { tiles } from '../src/core/combat/space.ts';
import type { Side } from '../src/core/combat/space.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import { modified } from '../src/core/combat/effect-ops.ts';
import type { Origin } from '../src/core/combat/effect-ops.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { parseAbility } from '../src/core/combat/fight-parse.ts';
import { parseSkill, SKILL_SEEDS, skillOf } from '../src/core/registry/skills.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Effect, Fight, NewRow } from '../src/core/combat/fight.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';

const ctx: Ctx = { rules: RULES };
const id = combatantId;
const formula = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const base = abilityOf('strike', { id: abilityId('hit'), name: 'hit' }, RULES);
const HIT = { ...base, effect: { type: base.effect!.type, by: 'hand', formula: formula('10') }, range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as typeof base;
const origin: Origin = { kind: 'hunter', build: { stats: { ...baseStats(RULES.fight) }, level: 1, gear: kitGear('light', RULES), perks: {} } };
function row(name: string, side: Side): NewRow {
  const kind = side === 'party' ? 'hunter' : 'monster';
  return {
    id: id(name), name, side, kind, origin, tier: 0, place: null, life: { at: 'up', hp: modified(origin, [], RULES).sheet.hpMax }, mana: 10, fatigue: 0, shield: null, stagger: null,
    channel: null, threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: [HIT], intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0, mythic: null,
  } as NewRow;
}
function play(fight: Fight | null, ...commands: Command[]): { fight: Fight | null; effects: Effect[] } {
  const effects: Effect[] = [];
  for (const cmd of commands) {
    const r = reduce(fight, cmd, ctx);
    const no = r.effects.find(e => e.type === 'refused');
    if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
    effects.push(...r.effects); fight = r.fight;
  }
  return { fight, effects };
}
const add = (rows: NewRow[], opens: { id: string; d20: number }[] = []): Command => ({ type: 'add', fightId: fightId('f-1'), rows, openings: opens.map(o => ({ id: id(o.id), d20: o.d20, tie: 0 })) });

describe('a hunter added to a fight and removed', () => {
  test('before the start: the rows are as they were, and the log says who joined and left', () => {
    const before = play(null, add([row('A', 'party'), row('M', 'foe')])).fight!;
    const after = play(before, add([row('B', 'party')]), { type: 'remove', id: id('B') }).fight!;
    expect(after.rows).toEqual(before.rows);
    expect(after.log.slice(0, after.log.length - before.log.length).map(l => l.text), 'newest first').toEqual(['B leaves the fight.', 'B joins.']);
  });
  test('while running: the rows are as they were and the turn did not move', () => {
    const before = play(null, add([row('A', 'party'), row('M', 'foe')]), { type: 'start', openings: [{ id: id('A'), d20: 20, tie: 0 }, { id: id('M'), d20: 10, tie: 0 }] }).fight!;
    const after = play(before, add([row('B', 'party')], [{ id: 'B', d20: 5 }]), { type: 'remove', id: id('B') }).fight!;
    if (before.phase !== 'running' || after.phase !== 'running') throw new Error('not running');
    expect(after.rows).toEqual(before.rows);
    expect(after.currentId).toBe(before.currentId);
    expect(after.now).toBe(before.now);
  });
  test('a hunter hit then removed: its sheet heard the hit as it landed, so leaving owes it nothing', () => {
    const f0 = play(null, add([row('A', 'party'), row('M', 'foe')]), { type: 'start', openings: [{ id: id('M'), d20: 20, tie: 0 }, { id: id('A'), d20: 1, tie: 0 }] }).fight!;
    const hit = play(f0, { type: 'act', by: id('M'), ability: HIT.id, aim: id('A'), rolls: { dice: {}, react: { A: 10 } } as never });
    const hp = rowHp(hit.fight!.rows.find(r => r.id === id('A'))!);
    expect(hp).toBeLessThan(rowHp(f0.rows.find(r => r.id === id('A'))!));
    expect(hit.effects.filter(e => e.type === 'vitals').map(e => (e as Extract<Effect, { type: 'vitals' }>).life)).toContainEqual({ at: 'up', hp });
    const gone = play(hit.fight, { type: 'remove', id: id('A') });
    expect(gone.effects.filter(e => e.type === 'vitals')).toEqual([]);
  });
});

describe('move abilities round-trip through parseAbility and parseSkill (unit A4)', () => {
  test('Shadow Exchange keeps move.only === "shadow" through JSON serialization, rejects unknown only, and rejects move with channel', () => {
    const seed = SKILL_SEEDS.find(s => s.name === 'Shadow Exchange')!;
    const sk = skillOf(seed, RULES);
    expect(sk.type === 'active' && sk.ability?.move).toEqual({ kind: 'swap', only: 'shadow' });
    expect(parseSkill(JSON.parse(JSON.stringify(sk)))).toEqual(sk);

    const ab = sk.type === 'active' ? sk.ability! : null;
    expect(parseAbility({ ...ab, move: { kind: 'swap', only: 'summon' } }, RULES)).toBeNull();
    expect(parseAbility({ ...ab, move: { kind: 'blink', only: 'shadow' } }, RULES)).toBeNull();
    expect(parseAbility({ ...ab, channel: { growth: 'linear', max: 2 } }, RULES)).toBeNull();
    expect(parseAbility({ ...ab, move: { kind: 'blink' }, channel: { growth: 'linear', max: 2 } }, RULES)).toBeNull();
  });
});
