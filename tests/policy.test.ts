// The policy's play of a mythic's omen (src/core/combat/policy.ts, notes-11-keystones.md design B.4): the party's
// answers (`answerChoice`, tried by `sensible` before its own play) and the mythic's landing. Each fight is built on the
// reducer with a seed mythic's row as the table makes it (scripts on) and the simulation's hunters, an omen announced on
// it by its own machine (`mythicStepped`); what each test expects is the script's words: Stars Fall lands on the tiles
// within 2 of its aim and its ring a tile past them (3 tiles, a bruiser's stride: one beside its aim steps out), Named in the Book is a sure curse of 1.1 sample hunters cancelled by a hold, and an omen lands
// on its mythic's next turn.
import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { reduce, runningState } from '../src/core/combat/fight.ts';
import type { Command, Fight, NewRow, Running } from '../src/core/combat/fight.ts';
import { omenMove, omenNeeds } from '../src/core/combat/fight-turn.ts';
import { weightsFor } from '../src/core/combat/fudge.ts';
import { drawNeeds, seededSource } from '../src/core/draws.ts';
import { mythicStepped } from '../src/core/combat/mythic.ts';
import type { OmenKey } from '../src/core/combat/mythic-types.ts';
import { autoMonsterTurn, sensible } from '../src/core/combat/policy.ts';
import { openGrid, percent, place, tiles } from '../src/core/combat/space.ts';
import type { Place, Terrain } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Body, StatusKey } from '../src/core/combat/effect-ops.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { isRefused } from '../src/core/save-step.ts';
import { monsterRows } from '../src/core/combat/rows.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { seedMonsters, statBlock } from '../src/core/registry/monsters.ts';
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
  test('a hunter in an omen\'s tiles that the omen would drop steps out', () => {
    // at 1 HP Stars Fall drops it; the cannon far off keeps the party in the fight
    const f = omened(begun('A', mythic('angel-of-the-last-trumpet', place(5, 5)), atHp(party('bruiser', 'A', place(10, 5)), 1), party('cannon', 'C', place(20, 5))), 'stars', place(11, 5));
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

  test('the hunter on the tile an omen aims at steps off it, when leaving the tile answers the omen (decision 43)', () => {
    // Stars Fall's step answer cancels it: the bruiser on its aimed tile steps one tile and nothing lands
    const f = omened(begun('A', mythic('angel-of-the-last-trumpet', place(5, 5)), party('bruiser', 'A', place(6, 5))), 'stars', place(6, 5));
    const choice = sensible(f, body(f, 'A'), ON);
    if (choice.type !== 'move') throw new Error(`the hunter chose ${choice.type}`);
    expect(choice.to, 'off the aimed tile').not.toEqual(place(6, 5));
    const off = sent(f, { type: 'move', by: combatantId('A'), to: choice.to });
    expect(body(off, 'X').mythic?.at, 'Stars Fall is cancelled').toBe('calm');
  });

  test('a tank shields the hunter an omen names when a shield on that hunter answers the omen (decision 43)', () => {
    // Named in the Book's shield answer cancels it; the cannon it names is at full HP, so no shield would spare its HP
    const f = omened(begun('T', mythic('the-fourth-rider', place(5, 5)), party('tank', 'T', place(6, 5)), party('cannon', 'C', place(9, 5))), 'named', 'C');
    const choice = sensible(f, body(f, 'T'), ON);
    expect(choice.type === 'act' && [choice.ability.id, choice.aim]).toEqual(['shield-wall', combatantId('C')]);
    if (choice.type !== 'act') return;
    const r = reduce(f, { type: 'act', by: combatantId('T'), ability: choice.ability.id, aim: choice.aim, rolls: { dice: {}, react: {} } }, ctx);
    const answered = r.effects.find(e => e.type === 'omenAnswered');
    expect(answered, 'Named in the Book is cancelled').toMatchObject({ type: 'omenAnswered', id: X, omen: 'named', how: 'shield', outcome: 'cancel' });
    expect(answered?.type === 'omenAnswered' ? answered.line : '').toContain('Named in the Book is canceled.');
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

describe('autoMonsterTurn builds a legal command and its dice needs for a monster turn (unit A6)', () => {
  const M = combatantId('M'), M2 = combatantId('M2'), H = combatantId('H');
  const brute = (id = M, at = place(5, 5)): NewRow => ({
    ...monsterRows(statBlock(ON, 'E', { name: 'Goblin', archetype: 'brute', kind: 'normal' }), [id], ON)[0]!,
    place: at,
  });
  const runAuto = (f: Running, by = M, seed = 11, at?: ReturnType<typeof tick>) => {
    const plan = autoMonsterTurn(f, by, ON, at);
    if (plan.kind === 'refused') throw new Error(`autoMonsterTurn refused: ${plan.reason}`);
    const src = seededSource(seed);
    const cmd = plan.kind === 'ready' ? plan.command : plan.command(drawNeeds(plan.needs, src.random, weightsFor(f, plan.by, plan.needs)));
    return { plan, cmd, result: reduce(f, cmd, ctx) };
  };

  test('refuses non-running fights, open dodges, pending settle dice, stale turns, and non-monsters', () => {
    const setup = reduce(null, { type: 'add', fightId: fightId('f-auto-guard'), rows: [brute(), party('bruiser', 'H', place(5, 6))], openings: [] }, ctx).fight!;
    expect(autoMonsterTurn(null, M, ON)).toEqual({ kind: 'refused', reason: 'notNow' });
    expect(autoMonsterTurn(setup, M, ON)).toEqual({ kind: 'refused', reason: 'notNow' });

    const ended = reduce(setup, { type: 'end' }, ctx).fight!;
    expect(autoMonsterTurn(ended, M, ON)).toEqual({ kind: 'refused', reason: 'notNow' });

    const fHunter = begun('H', brute(), party('bruiser', 'H', place(5, 6)));
    expect(autoMonsterTurn(fHunter, M, ON)).toEqual({ kind: 'refused', reason: 'notYourTurn' });
    expect(autoMonsterTurn(fHunter, H, ON)).toEqual({ kind: 'refused', reason: 'notMonster' });

    const fMonster = begun('M', brute(M, place(2, 2)), brute(M2, place(2, 4)), party('bruiser', 'H', place(10, 10)));
    expect(autoMonsterTurn(fMonster, M, ON, tick(fMonster.now - 1))).toEqual({ kind: 'refused', reason: 'notYourTurn' });
    expect(autoMonsterTurn(fMonster, M2, ON, fMonster.now)).toEqual({ kind: 'refused', reason: 'notYourTurn' });

    // Pending settle dice put the fight in `owing`, which refuses auto turn until settled.
    let owing = sent(fMonster, {
      type: 'status', id: M,
      add: { key: 'burning' as StatusKey, def: ON.conditions.burning!, duration: null, tier: 0 },
    });
    for (let i = 0; i < 6 && runningState(owing).at !== 'owing'; i++) owing = sent(owing, { type: 'endTurn', by: owing.currentId });
    expect(runningState(owing).at).toBe('owing');
    expect(autoMonsterTurn(owing, owing.currentId, ON)).toEqual({ kind: 'refused', reason: 'notNow' });
  });

  test('executes melee attacks with fudge weights and forced d20 parity, and moves when out of range', () => {
    const fFar = begun('M', brute(M, place(1, 1)), party('bruiser', 'H', place(8, 1)));
    const moved = runAuto(fFar, M, 3, fFar.now);
    expect(moved.plan.kind).toBe('ready');
    expect(moved.cmd.type).toBe('move');
    expect(moved.result.effects.some(e => e.type === 'refused')).toBe(false);
    // A stale tap carrying the old tick is rejected even if the same monster still acts next.
    if (moved.result.fight?.phase === 'running' && moved.result.fight.currentId === M) {
      expect(autoMonsterTurn(moved.result.fight, M, ON, fFar.now)).toEqual({ kind: 'refused', reason: 'notYourTurn' });
    }

    // Adjacent melee attack with forced d20 = 20 on the monster (forces target reaction d20 to 1 -> crit).
    const fClose = sent(
      begun('M', brute(M, place(5, 5)), party('bruiser', 'H', place(5, 6))),
      { type: 'fudge', set: { kind: 'force', id: M, face: 20 } },
    );
    const hit = runAuto(fClose, M, 42, fClose.now);
    expect(hit.plan.kind).toBe('roll');
    expect(hit.cmd.type).toBe('act');
    expect(hit.result.effects.some(e => e.type === 'refused')).toBe(false);
    expect(hit.result.effects.some(e => e.type === 'crit' && e.id === H), 'forced 20 on monster forces crit').toBe(true);
    expect(hit.result.fight?.phase === 'running' ? hit.result.fight.fudge.forced[M] : null, 'forced d20 is spent').toBeUndefined();
  });

  test('begins a channel without burning a forced d20, waits while charging, and releases at max charge', () => {
    const chAb = {
      ...abilityOf('blast', { id: abilityId('chan-blast'), name: 'Charge Blast', range: tiles(8), foesOnly: true }, ON),
      channel: { max: 2, growth: 'linear' as const },
    };
    const m: NewRow = { ...brute(M, place(5, 5)), abilities: [chAb] };
    const f0 = sent(begun('M', m, party('bruiser', 'H', place(5, 7))), { type: 'fudge', set: { kind: 'force', id: M, face: 20 } });

    const begin = runAuto(f0, M, 5, f0.now);
    expect(begin.plan.kind).toBe('ready');
    expect(begin.plan.needs).toBeNull();
    expect(begin.cmd.type).toBe('act');
    const f1 = begin.result.fight as Running;
    expect(body(f1, 'M').channel?.state).toBe('holding');
    expect(f1.fudge.forced[M], 'channel begin preserves forced d20').toBe(20);

    // Advance to M's next turn at charge 1 (below max 2) -> keeps channeling via endTurn.
    let atHold = f1;
    for (let i = 0; i < 6 && atHold.currentId !== M; i++) atHold = sent(atHold, { type: 'endTurn', by: atHold.currentId });
    expect(body(atHold, 'M').channel?.charge).toBe(1);
    const keep = runAuto(atHold, M, 6, atHold.now);
    expect(keep.cmd).toEqual({ type: 'endTurn', by: M });
    expect(keep.plan.note).toBe('Goblin keeps channeling.');

    // Advance to M's next turn at max charge (2) -> releases with dice needs and spends forced d20.
    let atMax = keep.result.fight as Running;
    for (let i = 0; i < 6 && atMax.currentId !== M; i++) atMax = sent(atMax, { type: 'endTurn', by: atMax.currentId });
    expect(body(atMax, 'M').channel?.charge).toBe(2);
    const rel = runAuto(atMax, M, 7, atMax.now);
    expect(rel.plan.kind).toBe('roll');
    expect(rel.cmd.type).toBe('release');
    expect(rel.result.effects.some(e => e.type === 'refused')).toBe(false);
  });

  test('falls back cleanly to endTurn when a monster has no legal move (rooted, boxed in, zero abilities, hidden foes)', () => {
    // Rooted out of melee range
    const fRoot = sent(begun('M', brute(M, place(1, 1)), party('bruiser', 'H', place(10, 10))), {
      type: 'status', id: M, add: { key: 'rooted' as StatusKey, def: { label: 'Rooted', desc: '', ops: [{ op: 'root' }] }, duration: null, tier: 0 },
    });
    const rRoot = runAuto(fRoot, M);
    expect(rRoot.cmd).toEqual({ type: 'endTurn', by: M });
    expect(rRoot.result.effects.some(e => e.type === 'refused')).toBe(false);

    // Completely surrounded by walls
    const w = 12, h = 12;
    const wallTiles: Terrain[] = Array.from({ length: w * h }, () => 'floor');
    for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) wallTiles[y! * w + x!] = 'wall';
    const setupWall = reduce(null, { type: 'add', fightId: fightId('f-wall'), rows: [brute(M, place(1, 1)), party('bruiser', 'H', place(10, 10))], openings: [], grid: { w, h, tiles: wallTiles } }, ctx).fight!;
    const fWall = sent(setupWall, { type: 'start', openings: [{ id: M, d20: 20, tie: 2 }, { id: H, d20: 1, tie: 1 }] });
    expect(runAuto(fWall, M).cmd).toEqual({ type: 'endTurn', by: M });

    // Zero abilities adjacent to hunter
    const fEmpty = begun('M', { ...brute(M, place(5, 5)), abilities: [] }, party('bruiser', 'H', place(5, 6)));
    expect(runAuto(fEmpty, M).cmd).toEqual({ type: 'endTurn', by: M });

    // All foes hidden past monster sight
    const fHid = sent(begun('M', brute(M, place(5, 5)), party('bruiser', 'H', place(5, 6))), {
      type: 'status', id: H, add: { key: 'deep-hide' as StatusKey, def: { label: 'Deep Hide', desc: '', ops: [{ op: 'hidden', level: 5, start: 'anywhere', ends: { hurt: false, revealed: false, dealt: false } }] }, duration: null, tier: 5 },
    });
    expect(runAuto(fHid, M).cmd).toEqual({ type: 'endTurn', by: M });
  });

  test('pauses for the dodge picker when the monster uses a dodgeable blast and refuses auto turn while dodging', () => {
    const nova = abilityOf('blast', {
      id: abilityId('frost-nova'), name: 'Frost Nova', range: tiles(8), foesOnly: true,
      shape: { kind: 'radius', radius: tiles(1), ring: { outer: tiles(2), share: percent(50) } },
    }, ON);
    const m: NewRow = { ...monsterRows(statBlock(ON, 'E', { name: 'Frost Imp', archetype: 'caster', kind: 'normal' }), [M], ON)[0]!, abilities: [nova], place: place(5, 5) };
    const f = begun('M', m, party('bruiser', 'H', place(5, 8)));
    const plan = autoMonsterTurn(f, M, ON, f.now);
    if (plan.kind !== 'roll') throw new Error(`expected roll, got ${plan.kind}`);
    const highRolls: Rolls = {
      dice: Object.fromEntries(Object.entries(plan.needs.dice).map(([k, ds]) => [k, ds.map(() => 1)])),
      react: Object.fromEntries(plan.needs.react.map(id => [id, 20])),
    };
    const r = reduce(f, plan.command(highRolls), ctx);
    expect(r.effects.some(e => e.type === 'dodgeAsked')).toBe(true);
    const waiting = r.fight as Running;
    expect(runningState(waiting).at).toBe('dodging');
    expect(autoMonsterTurn(waiting, M, ON)).toEqual({ kind: 'refused', reason: 'dodging' });
  });

  test('lands a mythic omen even when taunted by another hunter, handles fizzling omens, and opens dodge for dodgeable omen blasts', () => {
    const A = combatantId('A'), C = combatantId('C');
    // Taunted by A while Named in the Book aims at C
    const fBase = omened(begun('X', mythic('the-fourth-rider', place(5, 5)), party('bruiser', 'A', place(8, 5)), party('cannon', 'C', place(10, 5))), 'named', 'C');
    const tauntedX: Body = {
      ...body(fBase, 'X'),
      statuses: [...body(fBase, 'X').statuses, { key: 'taunted' as StatusKey, def: { label: 'Taunted', desc: '', ops: [{ op: 'taunt' }] }, source: { id: A, tier: 0 }, until: null, since: fBase.now, settledAt: fBase.now }],
    };
    const fTaunt: Running = { ...fBase, rows: fBase.rows.map(r => (r.id === X ? tauntedX : r)) };
    const landed = runAuto(fTaunt, X, 9, fTaunt.now);
    expect(landed.plan.kind).toBe('roll');
    expect(landed.result.effects.some(e => e.type === 'refused')).toBe(false);
    expect(body(landed.result.fight as Running, 'X').mythic?.at).toBe('calm');
    expect(rowHp(body(landed.result.fight as Running, 'C'))).toBeLessThan(rowHp(body(fTaunt, 'C')));

    // Fizzling omen (aimed target died before landing)
    const fDead = sent(fBase, { type: 'adjust', id: C, hp: -9999 });
    const fizz = runAuto(fDead, X, 9, fDead.now);
    expect(fizz.result.effects.some(e => e.type === 'refused')).toBe(false);
    expect(body(fizz.result.fight as Running, 'X').mythic?.at).toBe('calm');

    // Dodgeable omen blast (Stars Fall) opens dodge prompt
    const fStars = omened(begun('X', mythic('angel-of-the-last-trumpet', place(5, 5)), party('bruiser', 'A', place(8, 5)), party('cannon', 'C', place(11, 5))), 'stars', place(8, 5));
    const planStars = autoMonsterTurn(fStars, X, ON, fStars.now);
    if (planStars.kind !== 'roll') throw new Error(`expected roll, got ${planStars.kind}`);
    const rStars = reduce(fStars, planStars.command({
      dice: Object.fromEntries(Object.entries(planStars.needs.dice).map(([k, ds]) => [k, ds.map(() => 1)])),
      react: Object.fromEntries(planStars.needs.react.map(id => [id, 20])),
    }), ctx);
    expect(rStars.effects.some(e => e.type === 'dodgeAsked')).toBe(true);
  });
});
