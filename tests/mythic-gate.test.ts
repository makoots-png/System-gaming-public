// A mythic's gate, in the one writer of a row's life (src/core/combat/row-life.ts; notes-11-keystones.md, design B.3,
// "The gate, in the one writer of a row's life"). Every expected HP is read from the Angel's own words in
// registry/mythics.ts: its First Breath begins at 65% of its max HP and its Note at 30%, so in its first phase it is held
// at 65% (rounded up to a whole HP) and in its second at 30%; its Note is its last phase, which ends at 0 HP.
import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { isRefused } from '../src/core/save-step.ts';
import { share } from '../src/core/hunter/derive.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight } from '../src/core/combat/fight.ts';
import { parseFormula } from '../src/core/formula.ts';
import { staggerOp } from '../src/core/combat/land.ts';
import { mythicStep } from '../src/core/combat/mythic.ts';
import type { MythicEvent } from '../src/core/combat/mythic.ts';
import type { MythicStanding } from '../src/core/combat/mythic-types.ts';
import { resolve } from '../src/core/combat/resolve.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { rowLifeAfter } from '../src/core/combat/row-life.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import type { RowHunter } from '../src/core/combat/rows.ts';
import { place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';

/** The rules as shipped, with mythic scripts on by default. */
const ON: Rules = RULES;
const ANGEL = seedMonsters(RULES).find(m => m.script === 'angel-of-the-last-trumpet')!;
const HUNTER: RowHunter = {
  id: 'h1', name: 'Brakk', stats: { str: 30, agi: 10, vit: 10, ins: 10, dis: 10, pre: 10, pow: 10, ctl: 10 }, level: 1, rank: 'E', life: { at: 'up', hp: 30 },
  mana: 5, fatigue: 0, penalty: null, hpAdj: 0, manaAdj: 0, titleId: null, titles: [], items: [], equipped: { weapon: null }, build: { path: null, picks: [] },
  skills: [], conditions: [],
};
const ctx = { rules: ON };

/** A fight in setup holding Brakk beside the Angel, which stands calm in its first phase. */
function angelFight(): Fight {
  const rows = [{ ...hunterRow(HUNTER, combatantId('h'), ON), place: place(5, 5) }, { ...monsterRows(ANGEL, [combatantId('m')], ON)[0]!, place: place(6, 5) }];
  return reduce(null, { type: 'add', fightId: fightId('f'), rows, openings: [] }, ctx).fight!;
}
const rowOf = (f: Fight, id: string): Body => f.rows.find(r => r.id === id)!;
const angel = (): Body => rowOf(angelFight(), 'm');
/** The Angel's standing after `events`, each taken. */
function after(s: MythicStanding, ...events: MythicEvent[]): MythicStanding {
  return events.reduce((at, e) => { const n = mythicStep(at, e); if (isRefused(n)) throw new Error(n.why); return n; }, s);
}
/** `b` in phase `phase` of its script (by the GM's Next phase), at `hp` HP. */
function inPhase(b: Body, phase: number, hp: number): Body {
  const s = after(b.mythic!, ...Array.from({ length: phase }, (): MythicEvent => ({ type: 'next', now: tick(0), by: 'gm' })));
  return { ...rowLifeAfter(b, { type: 'setHp', hp }), mythic: s } as Body;
}
const atGate = (b: Body, share: number) => Math.ceil(share * b.sheet.hpMax);

/** A strike that deals `text` before armor, never avoided, and the dice that land it plain. */
function strike(text: string): Ability {
  const p = parseFormula(text, RULES);
  if (!p.ok) throw new Error(p.error);
  return { ...abilityOf('strike', { id: abilityId('blow'), name: 'Blow' }, RULES), effect: { type: 'physical', by: 'hand', formula: p.formula }, delivery: { kind: 'sure' } };
}
const PLAIN: Rolls = { dice: { [combatantId('m')]: [] }, react: { [combatantId('m')]: 10 } };
/** Brakk's blow on `target`, as resolve.ts lands it: the bodies after it and what it drained. */
function blow(user: Body, target: Body, text: string) {
  const r = resolve(strike(text), user, [user, target], target.id, angelFight().grid, PLAIN, tick(0), ON);
  if (!r.ok) throw new Error(r.reason);
  return { user: r.bodies.find(b => b.id === user.id)!, target: r.bodies.find(b => b.id === target.id)!, drained: r.drained };
}

describe('the gate', () => {
  test('a hit of ten times its max HP leaves a mythic at its gate', () => {
    const m = angel(), u = rowOf(angelFight(), 'h');
    const hit = blow(u, m, `${10 * m.sheet.hpMax}`).target;
    expect(rowHp(hit), 'its first phase holds it at 65%').toBe(atGate(m, 0.65));
    const second = blow(u, inPhase(m, 1, m.sheet.hpMax), `${10 * m.sheet.hpMax}`).target;
    expect(rowHp(second), 'its second at 30%').toBe(atGate(m, 0.3));
    expect(rowHp(blow(u, hit, `${10 * m.sheet.hpMax}`).target), 'a mythic at its gate takes no more').toBe(atGate(m, 0.65));
  });

  test('a mythic in its last phase falls at 0 HP', () => {
    const m = angel(), last = inPhase(m, 2, 100);
    const hit = blow(rowOf(angelFight(), 'h'), last, `${10 * m.sheet.hpMax}`).target;
    expect([rowHp(hit), hit.life.at]).toEqual([0, 'dead']);
  });

  test('the GM\'s hand edit stops at the gate', () => {
    const f = angelFight(), m = rowOf(f, 'm');
    const cut = reduce(f, { type: 'adjust', id: m.id, hp: -m.sheet.hpMax }, ctx).fight!;
    expect(rowHp(rowOf(cut, 'm'))).toBe(atGate(m, 0.65));
    const raised = reduce(cut, { type: 'adjust', id: m.id, hp: 50 }, ctx).fight!;
    expect(rowHp(rowOf(raised, 'm')), 'and raises it as it raises any row').toBe(atGate(m, 0.65) + 50);
  });

  test('a heal lifts a mythic off its gate', () => {
    const m = angel(), held = rowLifeAfter(m, { type: 'damage', amount: m.sheet.hpMax });
    const healed = rowLifeAfter(held, { type: 'heal', amount: 50 });
    expect(rowHp(healed)).toBe(atGate(m, 0.65) + 50);
    expect(rowHp(rowLifeAfter(healed, { type: 'damage', amount: 20 })), 'and damage takes it back down').toBe(atGate(m, 0.65) + 30);
    expect(rowHp(rowLifeAfter(healed, { type: 'damage', amount: 80 })), 'to its gate and no further').toBe(atGate(m, 0.65));
  });

  test('every other row\'s life is as it was: a monster with no script falls at 0 HP', () => {
    const m = angel(), plain = { ...m, mythic: null } as Body;
    expect(rowLifeAfter(plain, { type: 'damage', amount: 10 * m.sheet.hpMax }).life).toEqual({ at: 'dead' });
  });
});

describe('what follows from the HP a hit took', () => {
  /** Brakk with 10% lifesteal. */
  const drinker = (): Body => { const u = rowOf(angelFight(), 'h'); return { ...u, sheet: { ...u.sheet, drain: share(0.1) } }; };

  test('lifesteal drains nothing the gate held', () => {
    const m = angel(), gate = atGate(m, 0.65);
    const held = blow(drinker(), rowLifeAfter(m, { type: 'damage', amount: m.sheet.hpMax }), '1000');
    expect([rowHp(held.target), held.drained], 'at its gate it loses no HP, so nothing drains').toEqual([gate, 0]);
    const ten = blow(drinker(), rowLifeAfter(m, { type: 'setHp', hp: gate + 10 }), '1000');
    expect([rowHp(ten.target), ten.drained], '10 HP above it, 10% of 10 drains').toEqual([gate, 1]);
  });

  test('a hit on a mythic held at its gate still fills its stagger bar', () => {
    const m = { ...angel(), stagger: { fill: 0, max: 10000, hit: 1 } } as Body, u = rowOf(angelFight(), 'h');
    const free = blow(u, m, '400').target, held = blow(u, rowLifeAfter(m, { type: 'damage', amount: m.sheet.hpMax }), '400').target;
    expect(rowHp(held), 'held at its gate it loses no HP').toBe(atGate(m, 0.65));
    expect(free.stagger!.fill, 'off its gate the blow takes HP and fills the bar by it').toBe(rowHp(m) - rowHp(free));
    expect(held.stagger!.fill, 'at its gate the bar fills as much').toBe(free.stagger!.fill);
  });

  test('a stagger op fills a mythic\'s bar by mythic.staggerTaken of what it fills on another monster', () => {
    const m = { ...angel(), stagger: { fill: 0, max: 1000, hit: 100 } } as Body, opShare = RULES.fight.kit.staggerOpMax / 2;
    const plain = staggerOp({ ...m, mythic: null } as Body, opShare, tick(0), ON).fill;
    expect(plain, 'on another monster the op fills its share of the bar').toBe(opShare * 1000);
    expect(staggerOp(m, opShare, tick(0), ON).fill).toBe(opShare * 1000 * RULES.fight.mythic.staggerTaken);
  });
});
