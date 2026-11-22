// The policy's play of a mythic's omen (src/core/combat/policy.ts, notes-11-keystones.md design B.4): the party's
// answers (`answerChoice`, tried by `sensible` before its own play) and the mythic's landing. Each fight is built on the
// reducer with a seed mythic's row as the table makes it (scripts on) and the simulation's hunters, an omen announced on
// it by its own machine (`mythicStepped`); what each test expects is the script's words: Stars Fall lands on the tiles
// within 2 of its aim and its ring a tile past them (3 tiles, a bruiser's stride: one beside its aim steps out), Named in the Book is a sure curse of 1.1 sample hunters cancelled by a hold, and an omen lands
// on its mythic's next turn.
import { describe, expect, test } from 'bun:test';
import { fightId, reduce, runningState } from '../src/core/combat/fight.ts';
import type { Command, Fight, NewRow, Running } from '../src/core/combat/fight.ts';
import { omenMove, omenNeeds } from '../src/core/combat/fight-turn.ts';
import { mythicStepped } from '../src/core/combat/mythic.ts';
import type { OmenKey } from '../src/core/combat/mythic-types.ts';
import { sensible } from '../src/core/combat/policy.ts';
import { place } from '../src/core/combat/space.ts';
import type { Place } from '../src/core/combat/space.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { isRefused } from '../src/core/save-step.ts';
import { monsterRows } from '../src/core/combat/rows.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { abilities, hunter, scriptsOn } from './models/fight-sim.ts';
import type { Archetype } from './models/fight-sim.ts';
import { atHp } from './fixtures/life.ts';

const ON = scriptsOn();
const ctx = { rules: ON };
const X = combatantId('X');
const mythic = (script: string, at: Place): NewRow => ({ ...monsterRows(seedMonsters(ON).find(m => m.script === script)!, [X], ON)[0]!, place: at });
const party = (a: Archetype, id: string, at: Place): NewRow => ({ ...hunter(a, 'S', id, ON).row, place: at });
const body = (f: Fight, id: string): Body => f.rows.find(r => r.id === id)!;
function sent(f: Fight, cmd: Command): Running {
  const r = reduce(f, cmd, ctx), no = r.effects.find(e => e.type === 'refused');
  if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
  if (r.fight?.phase !== 'running') throw new Error(`not running after ${cmd.type}`);
  return r.fight;
}
/** A fight of `rows` begun with `first` acting first. */
function begun(first: string, ...rows: NewRow[]): Running {
  const made = reduce(null, { type: 'add', fightId: fightId('f-policy'), rows, openings: [] }, ctx).fight!;
  return sent(made, { type: 'start', openings: rows.map(r => ({ id: r.id, d20: r.id === first ? 20 : 1, tie: r.id === first ? 2 : 1 })) });
}
/** `f` with the mythic's omen `omen` announced at `aim`, by its machine. */
function omened(f: Running, omen: string, aim: Place | string): Running {
  const x = body(f, 'X') as Body & { mythic: NonNullable<Body['mythic']> };
  const next = mythicStepped<Body>(x, { type: 'announce', omen: omen as OmenKey, aim: typeof aim === 'string' ? combatantId(aim) : aim, hpAt: rowHp(x), barAt: x.stagger && { fill: x.stagger.fill, max: x.stagger.max } });
  if (isRefused(next)) throw new Error(next.why);
  return { ...f, rows: f.rows.map(r => (r.id === X ? next : r)) };
}
/** Each turn passed until the mythic's landing comes. */
function toLanding(f: Running): Running {
  let g = f;
  for (let i = 0; i < 20 && runningState(g).at !== 'landing'; i++) g = sent(g, { type: 'endTurn', by: g.currentId! });
  expect(runningState(g)).toEqual({ at: 'landing', id: X });
  return g;
}
/** The mythic's landing with every die at its middle face and every reaction d20 a 1, so nothing dodges it. */
function landing(f: Running): Command {
  const u = body(f, 'X'), m = omenMove(u, ON)!, n = omenNeeds(f, u, ON)!;
  const dice = Object.fromEntries(Object.entries(n.dice).map(([k, ds]) => [k, ds.map(d => Math.ceil(d.sides / 2))]));
  return { type: 'act', by: X, ability: m.ability.id, aim: m.aim, rolls: { dice, react: Object.fromEntries(n.react.map(r => [r, 1])) } as Rolls };
}

describe('the policy answers a mythic\'s omen (design B.4)', () => {
  test('a hunter in an omen\'s tiles steps out', () => {
    const f = omened(begun('A', mythic('angel-of-the-last-trumpet', place(5, 5)), party('bruiser', 'A', place(10, 5))), 'stars', place(11, 5));
    const stood = toLanding(f), hp = rowHp(body(stood, 'A'));
    expect(rowHp(body(sent(stood, landing(stood)), 'A')), 'Stars Fall lands on a hunter who stays').toBeLessThan(hp);
    const choice = sensible(f, body(f, 'A'), ON);
    if (choice.type !== 'move') throw new Error(`the hunter chose ${choice.type}`);
    const out = toLanding(sent(f, { type: 'move', by: combatantId('A'), to: choice.to }));
    expect(rowHp(body(sent(out, landing(out)), 'A')), 'and on no hunter who stepped out').toBe(hp);
  });

  test('a hunter with a stun uses it on a mythic whose omen a stun cancels', () => {
    const tank = party('tank', 'T', place(6, 5));
    const f = omened(begun('T', mythic('the-fourth-rider', place(5, 5)), { ...tank, abilities: [...tank.abilities, abilities(ON).stun] }, party('cannon', 'C', place(12, 5))), 'named', 'C');
    const choice = sensible(f, body(f, 'T'), ON);
    expect(choice.type === 'act' && [choice.ability.id, choice.aim]).toEqual(['stun', X]);
    if (choice.type !== 'act') return;
    const stunned = sent(f, { type: 'act', by: combatantId('T'), ability: choice.ability.id, aim: choice.aim, rolls: { dice: {}, react: { [X]: 1 } } });
    expect(body(stunned, 'X').mythic?.at, 'the stun cancels Named in the Book').toBe('calm');
  });

  test('a support shields the hunter an omen names', () => {
    const cannon = party('cannon', 'C', place(12, 5));
    const f = omened(begun('S', mythic('the-fourth-rider', place(5, 5)), party('support', 'S', place(12, 6)), atHp(cannon, 1)), 'named', 'C');
    const choice = sensible(f, body(f, 'S'), ON);
    expect(choice.type === 'act' && [choice.ability.id, choice.aim]).toEqual(['shield-wall', combatantId('C')]);
  });

  test('a mythic with an omen standing lands it', () => {
    const f = omened(begun('X', mythic('the-fourth-rider', place(5, 5)), party('cannon', 'C', place(12, 5))), 'named', 'C');
    expect(runningState(f)).toEqual({ at: 'landing', id: X });
    const choice = sensible(f, body(f, 'X'), ON);
    expect(choice.type === 'act' && [choice.ability.id, choice.aim]).toEqual(['mythic-named', combatantId('C')]);
    const hp = rowHp(body(f, 'C')), landed = sent(f, landing(f));
    expect(rowHp(body(landed, 'C')), 'Named in the Book lands on the hunter it named').toBeLessThan(hp);
    expect(body(landed, 'X').mythic?.at).toBe('calm');
  });
});
