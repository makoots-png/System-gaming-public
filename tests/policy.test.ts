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
import { NPC_AUTO_MS, autoDue, autoMonsterTurn, autoTurnOf, sensible, skilled } from '../src/core/combat/policy.ts';
import { playBegin, playStep, policySource } from '../src/core/combat/play.ts';
import type { Play } from '../src/core/combat/play.ts';
import { newNpc } from '../src/core/registry/npcs.ts';
import type { NpcSkill } from '../src/core/registry/npcs.ts';
import { npcRows } from '../src/core/combat/rows.ts';
import { SKILL_ABILITIES } from '../src/core/registry/abilities.ts';
import { openGrid, percent, place, tiles } from '../src/core/combat/space.ts';
import type { Place, Terrain } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { cost } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { parseFormula } from '../src/core/formula.ts';
import { statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
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
    const f = omened(begun('X', mythic('the-fourth-rider', place(5, 5)), party('tank', 'T', place(6, 5)), party('cannon', 'C', place(12, 5))), 'named', 'C');
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

    // Dodgeable omen blast (The First Breath) opens dodge prompt
    const fBreath = omened(begun('X', mythic('angel-of-the-last-trumpet', place(5, 5)), party('bruiser', 'A', place(8, 5)), party('cannon', 'C', place(11, 5))), 'breath', 'X');
    const planBreath = autoMonsterTurn(fBreath, X, ON, fBreath.now);
    if (planBreath.kind !== 'roll') throw new Error(`expected roll, got ${planBreath.kind}`);
    const rBreath = reduce(fBreath, planBreath.command({
      dice: Object.fromEntries(Object.entries(planBreath.needs.dice).map(([k, ds]) => [k, ds.map(() => 1)])),
      react: Object.fromEntries(planBreath.needs.react.map(id => [id, 20])),
    }), ctx);
    expect(rBreath.effects.some(e => e.type === 'dodgeAsked')).toBe(true);

    // Undodgeable omen blast (Stars Fall) lands directly with no dodge prompt
    const fStars = omened(begun('X', mythic('angel-of-the-last-trumpet', place(5, 5)), party('bruiser', 'A', place(8, 5)), party('cannon', 'C', place(11, 5))), 'stars', place(8, 5));
    const planStars = autoMonsterTurn(fStars, X, ON, fStars.now);
    if (planStars.kind !== 'roll') throw new Error(`expected roll, got ${planStars.kind}`);
    expect(planStars.needs.react).toEqual([]);
    const rStars = reduce(fStars, planStars.command({
      dice: Object.fromEntries(Object.entries(planStars.needs.dice).map(([k, ds]) => [k, ds.map(() => 1)])),
      react: {},
    }), ctx);
    expect(rStars.effects.some(e => e.type === 'dodgeAsked')).toBe(false);
    expect(rowHp(body(rStars.fight as Running, 'A'))).toBeLessThan(rowHp(body(fStars, 'A')));
  });

  test('taunt forces autoMonsterTurn to step toward an out-of-reach taunter, drops a conflicting stale intent, and frees the monster when the taunter hides', () => {
    const T = combatantId('T'), C = combatantId('C');

    // Melee monster taunted by Tank at dist 4 while Mage stands adjacent (dist 1): steps toward Tank instead of hitting Mage.
    const fBase = begun('M', brute(M, place(5, 5)), party('cannon', 'C', place(5, 6)), party('tank', 'T', place(5, 9)));
    const tauntStatus = statusOn(ON.conditions.taunted!, { key: 'taunted' as StatusKey, source: { id: T, tier: 0 }, until: tick(fBase.now + 2 * ON.fight.round), since: fBase.now, settledAt: fBase.now });
    const fTaunt: Running = {
      ...fBase,
      rows: fBase.rows.map(r => (r.id === M ? { ...r, statuses: [...r.statuses, tauntStatus] } : r)),
    };
    const walked = runAuto(fTaunt, M, 1, fTaunt.now);
    expect(walked.plan.kind).toBe('ready');
    expect(walked.cmd.type).toBe('move');
    expect(walked.result.effects.some(e => e.type === 'refused')).toBe(false);
    if (walked.cmd.type === 'move') expect(walked.cmd.to.y).toBeGreaterThan(5);

    // Stale intent aimed at adjacent Mage is dropped while taunted by Tank at dist 4.
    const strikeId = body(fTaunt, 'M').abilities[0]!.id;
    const fIntent: Running = {
      ...fTaunt,
      rows: fTaunt.rows.map(r => (r.id === M && r.kind === 'monster' ? { ...r, intent: { ability: strikeId, aim: C, revealed: true } } : r)),
    };
    const dropped = runAuto(fIntent, M, 2, fIntent.now);
    expect(dropped.plan.kind).toBe('ready');
    expect(dropped.cmd.type).toBe('move');
    expect(dropped.result.effects.some(e => e.type === 'refused')).toBe(false);

    // Hidden taunter (not perceived by monster) leaves the monster free to attack adjacent visible Mage.
    const hideStatus = statusOn({ label: 'Deep Hide', desc: '', ops: [{ op: 'hidden', level: 5, start: 'anywhere', ends: { hurt: false, revealed: false, dealt: false } }] },
      { key: 'deep-hide' as StatusKey, source: { id: T, tier: 5 }, until: null, since: fBase.now, settledAt: fBase.now });
    const fHidden: Running = {
      ...fTaunt,
      rows: fTaunt.rows.map(r => (r.id === T ? { ...r, statuses: [...r.statuses, hideStatus] } : r)),
    };
    const free = runAuto(fHidden, M, 3, fHidden.now);
    expect(free.plan.kind).toBe('roll');
    expect(free.cmd.type === 'act' && free.cmd.aim).toBe(C);
    expect(free.result.effects.some(e => e.type === 'refused')).toBe(false);
  });
});

describe('policy Wave 2 PR 2 updates (timed summon lane, corpse aim, and kitOf/spent in damageOf)', () => {
  const H = combatantId('H'), M = combatantId('M');
  const brute = (id = M, at = place(5, 5), kind: 'normal' | 'elite' = 'normal'): Extract<NewRow, { kind: 'monster' }> => ({
    ...(monsterRows(statBlock(ON, 'C', { name: 'Goblin', archetype: 'brute', kind }), [id], ON)[0]! as Extract<NewRow, { kind: 'monster' }>),
    place: at,
  });

  test('calls up to kit.summons timed summons even when 1 timed summon or a risen row is up, and stops at kit.summons', () => {
    const call: Ability = {
      ...abilityOf('support', { id: abilityId('call-pack'), name: 'Call the Pack', range: tiles(0), shape: { kind: 'self' } }, ON),
      cost: { fatigue: 2, mana: 4, time: cost(ON.fight.cost.standard), cooldown: tick(0) },
      aim: 'self', delivery: { kind: 'sure' }, effect: null, ops: [],
      summon: { name: 'Spirit Hound', archetype: 'brute', rounds: 5, statuses: [] },
    };
    const h = { ...party('support', 'H', place(2, 2)), abilities: [call, ...party('support', 'H', place(2, 2)).abilities] };
    const b0 = brute(combatantId('R1'), place(2, 3));
    const risen: NewRow = {
      id: b0.id, name: b0.name, side: 'party', kind: 'summon', origin: b0.origin, tier: b0.tier, place: b0.place,
      life: b0.life, mana: b0.mana, fatigue: 0, shield: null, stagger: null, channel: null, threat: null,
      statuses: [], readyAt: {}, abilities: b0.abilities, intent: null, holder: null, xp: 0, mythic: null,
      owner: H, until: null, rose: combatantId('dead-0'),
    };
    const f0 = begun('H', h, risen, brute(M, place(10, 10)));
    // With 1 risen row and 0 timed summons -> calls first hound
    const c1 = sensible(f0, body(f0, 'H'), ON);
    expect(c1.type === 'act' && c1.ability.id).toBe(call.id);
    const f1 = sent(f0, { type: 'act', by: H, ability: call.id, aim: H, rolls: { dice: {}, react: {} } });
    // Advance back to H's turn -> 1 timed summon < kit.summons (2) -> calls second hound
    let f2 = f1;
    while (f2.currentId !== H) f2 = sent(f2, { type: 'endTurn', by: f2.currentId });
    const c2 = sensible(f2, body(f2, 'H'), ON);
    expect(c2.type === 'act' && c2.ability.id).toBe(call.id);
    const f3 = sent(f2, { type: 'act', by: H, ability: call.id, aim: H, rolls: { dice: {}, react: {} } });
    // Advance back to H's turn -> 2 timed summons === kit.summons -> stops calling
    let f4 = f3;
    while (f4.currentId !== H) f4 = sent(f4, { type: 'endTurn', by: f4.currentId });
    const c3 = sensible(f4, body(f4, 'H'), ON);
    expect(c3.type === 'act' && c3.ability.id === call.id).toBe(false);
  });

  test('aims Arise at an eligible corpse by id (elites first) while under maxRisen and stops at maxRisen', () => {
    const arise: Ability = {
      id: abilityId('arise'), name: 'Arise', kind: 'support',
      cost: { fatigue: 4, mana: 10, time: cost(ON.fight.cost.standard), cooldown: tick(0) },
      aim: 'corpse', range: tiles(6), shape: { kind: 'touch', reach: tiles(6) },
      delivery: { kind: 'sure' }, foesOnly: false, effect: null, ops: [], channel: null,
      raise: { bonus: 4, maxRisen: 1, elitePerFight: 1 },
    };
    const h = { ...party('support', 'H', place(2, 2)), abilities: [arise, ...party('support', 'H', place(2, 2)).abilities] };
    const norm: NewRow = { ...brute(combatantId('C1'), place(3, 2), 'normal'), life: { at: 'dead' } };
    const elite: NewRow = { ...brute(combatantId('C2'), place(5, 2), 'elite'), life: { at: 'dead' } };
    const f0 = begun('H', h, norm, elite, brute(M, place(10, 10)));
    // Picks elite corpse C2 ahead of closer normal corpse C1
    const c1 = sensible(f0, body(f0, 'H'), ON);
    expect(c1.type === 'act' && [c1.ability.id, c1.aim]).toEqual([arise.id, combatantId('C2')]);

    // Raise C2 -> at maxRisen (1), sensible no longer picks Arise on C1
    const f1 = sent(f0, { type: 'act', by: H, ability: arise.id, aim: combatantId('C2'), rolls: { dice: { [combatantId('C2')]: [20] }, react: {} } });
    let f2 = f1;
    while (f2.currentId !== H) f2 = sent(f2, { type: 'endTurn', by: f2.currentId });
    const c2 = sensible(f2, body(f2, 'H'), ON);
    expect(c2.type === 'act' && c2.ability.id === arise.id).toBe(false);
  });

  test('damageOf reads kitOf and spent stacks so an execute finisher beats a plain strike on a wounded marked target', () => {
    const markDef = { label: 'Mark', desc: '', ops: [], stack: { cap: 3, leave: { kind: 'never' as const }, keep: 'fight' as const, threshold: null } };
    const pf = (src: string) => { const r = parseFormula(src, ON); if (!r.ok) throw new Error(r.error); return r.formula; };
    const plain: Ability = {
      ...abilityOf('strike', { id: abilityId('reap'), name: 'Reap', range: tiles(1) }, ON),
      effect: { type: 'physical', by: 'hand', formula: pf('10') },
    };
    const finisher: Ability = {
      ...abilityOf('strike', { id: abilityId('guillotine'), name: 'Guillotine', range: tiles(1) }, ON),
      effect: { type: 'true', by: 'hand', formula: pf('(5 + 10 * spent) * (1 + target.missing)') },
      gates: [{ kind: 'holds', key: statusKey('mark'), on: 'target', atLeast: 1 }],
      prices: [{ kind: 'stacks', key: statusKey('mark'), from: 'target', take: { kind: 'all' } }],
    };
    const h: NewRow = { ...party('bruiser', 'H', place(5, 4)), abilities: [plain, finisher] };
    const marked = statusOn(markDef, { key: statusKey('mark'), source: { id: H, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) }, 3);
    const foe: NewRow = atHp({ ...brute(M, place(5, 5)), statuses: [marked] }, 10);
    const f = begun('H', h, foe);
    const choice = sensible(f, body(f, 'H'), ON);
    expect(choice.type === 'act' && choice.ability.id).toBe(finisher.id);
  });
});

describe('skilled NPC policy: determinism, fudge isolation, dice-stream isolation, and slider curve (NPC unit 4 Row 5)', () => {
  const N = combatantId('N'), A = combatantId('A'), M1 = combatantId('M1'), M2 = combatantId('M2');
  const pf = (src: string) => { const r = parseFormula(src, ON); if (!r.ok) throw new Error(r.error); return r.formula; };
  const weakHit: Ability = {
    ...abilityOf('strike', { id: abilityId('poke'), name: 'Poke', range: tiles(6), shape: { kind: 'touch', reach: tiles(6) } }, ON),
    effect: { type: 'physical', by: 'hand', formula: pf('4') },
  };
  const strongHit: Ability = {
    ...abilityOf('strike', { id: abilityId('smash'), name: 'Smash', range: tiles(6), shape: { kind: 'touch', reach: tiles(6) } }, ON),
    effect: { type: 'physical', by: 'hand', formula: pf('24') },
  };
  const heal: Ability = {
    ...abilityOf('support', { id: abilityId('mend'), name: 'Mend', range: tiles(6), shape: { kind: 'touch', reach: tiles(6) } }, ON),
    effect: { type: 'heal', by: 'hand', formula: pf('20') },
  };
  const npcWith = (skill: NpcSkill, extra: readonly Ability[] = [strongHit, weakHit, heal]): NewRow => {
    const base = npcRows(newNpc({ name: 'Mira', rank: 'C', archetype: 'caster', defaultSide: 'party', skill }), [N], ON)[0]!;
    return { ...base, abilities: [...extra], place: place(5, 5) };
  };
  const brute = (id: ReturnType<typeof combatantId>, at: Place): NewRow => ({
    ...monsterRows(statBlock(ON, 'C', { name: 'Goblin', archetype: 'brute', kind: 'normal' }), [id], ON)[0]!,
    place: at,
  });

  test('same (fight, policySource) yields identical choices across repeated calls', () => {
    const f = begun('N', npcWith(1), atHp(party('bruiser', 'A', place(5, 4)), 10), brute(M1, place(5, 6)), brute(M2, place(5, 7)));
    const me = body(f, 'N');
    const best = sensible(f, me, ON);
    for (let step = 0; step < 30; step++) {
      const c1 = skilled(f, me, ON, best, policySource(98765, step));
      const c2 = skilled(f, me, ON, best, policySource(98765, step));
      expect(c1).toEqual(c2);
    }
  });

  test('extreme f.fudge yields 0 change in skilled choices', () => {
    const base = begun('N', npcWith(1), atHp(party('bruiser', 'A', place(5, 4)), 10), brute(M1, place(5, 6)), brute(M2, place(5, 7)));
    let fudged: Running = sent(base, { type: 'fudge', set: { kind: 'weight', scope: { kind: 'side', side: 'party' }, n: 19 } });
    fudged = sent(fudged, { type: 'fudge', set: { kind: 'weight', scope: { kind: 'side', side: 'foe' }, n: -19 } });
    fudged = sent(fudged, { type: 'fudge', set: { kind: 'force', id: N, face: 20 } });
    fudged = sent(fudged, { type: 'fudge', set: { kind: 'force', id: M1, face: 1 } });

    const meBase = body(base, 'N'), meFudged = body(fudged, 'N');
    const bestBase = sensible(base, meBase, ON), bestFudged = sensible(fudged, meFudged, ON);
    expect(bestFudged).toEqual(bestBase);
    for (let step = 0; step < 50; step++) {
      expect(skilled(fudged, meFudged, ON, bestFudged, policySource(4242, step)))
        .toEqual(skilled(base, meBase, ON, bestBase, policySource(4242, step)));
    }
  });

  test('moving skill 5 -> 1 leaves weightsFor and Play.source untouched on identical dice needs', () => {
    // Only damaging moves (no heal skip) so both skill 5 and skill 1 pick a damaging attack with identical dice needs (0 dice terms, 1 react d20).
    const setup5 = reduce(null, {
      type: 'add', fightId: fightId('f-iso-5'),
      rows: [npcWith(5, [strongHit, weakHit]), brute(M1, place(5, 6)), brute(M2, place(5, 7))],
      openings: [],
    }, ctx).fight!;
    const s5 = sent(setup5, { type: 'start', openings: [{ id: N, d20: 20, tie: 3 }, { id: M1, d20: 1, tie: 2 }, { id: M2, d20: 1, tie: 1 }] });
    const s1 = sent(s5, { type: 'setNpcSkill', id: N, skill: 1 });

    // weightsFor is identical between skill 5 and skill 1 (even under fudge).
    const w5f = sent(s5, { type: 'fudge', set: { kind: 'weight', scope: { kind: 'row', id: N }, n: 3 } });
    const w1f = sent(s1, { type: 'fudge', set: { kind: 'weight', scope: { kind: 'row', id: N }, n: 3 } });
    const sampleNeeds = { dice: { [M1]: [] }, react: [M1], refund: false };
    expect(weightsFor(w1f, N, sampleNeeds)).toEqual(weightsFor(w5f, N, sampleNeeds));

    // Stepping playStep at skill 5 vs skill 1 leaves the dice stream state (Play.source) identical when both roll 1 reaction die,
    // and leaves Play.source completely unchanged on a non-rolling move/pass.
    const p5 = playBegin(s5, 777, ON).play as Play & { readonly fight: Running };
    const p1 = playBegin(s1, 777, ON).play as Play & { readonly fight: Running };
    expect(p1.source).toBe(p5.source);
    const step5 = playStep(p5, () => sensible, { capRounds: 40, endAtRounds: null }, ON);
    const step1 = playStep(p1, () => sensible, { capRounds: 40, endAtRounds: null }, ON);
    expect(step1.play.source, 'skilled forked policySource never advances Play.source').toBe(step5.play.source);
    // And verify Play.source is completely unchanged on a non-rolling move step.
    const fMove = begun('N', npcWith(1, [strongHit]), brute(M1, place(5, 16)));
    const pMove = playBegin(fMove, 777, ON).play as Play & { readonly fight: Running };
    const stepMove = playStep(pMove, () => sensible, { capRounds: 40, endAtRounds: null }, ON);
    expect(stepMove.choice?.type).toBe('move');
    expect(stepMove.play.source, 'move step leaves Play.source untouched').toBe(pMove.source);
    // And verify skill 1 actually differs from skill 5 across seeds on this choice.
    const diffs = Array.from({ length: 40 }, (_, k) =>
      JSON.stringify(skilled(s1, body(s1, 'N'), ON, sensible(s1, body(s1, 'N'), ON), policySource(k, k)))
      !== JSON.stringify(skilled(s5, body(s5, 'N'), ON, sensible(s5, body(s5, 'N'), ON), policySource(k, k))),
    ).filter(Boolean).length;
    expect(diffs).toBeGreaterThan(0);
  });

  test('skill 5 returns best without drawing; Sharp (4) never skips heals or omen answers; Sloppy (1) skips ~65% and softens hits; non-act choices stay unchanged', () => {
    let drawn = 0;
    const counting = () => { drawn++; return 0.01; };
    const f5 = begun('N', npcWith(5), atHp(party('bruiser', 'A', place(5, 4)), 10), brute(M1, place(5, 6)));
    const b5 = sensible(f5, body(f5, 'N'), ON);
    expect(b5.type === 'act' && b5.ability.id).toBe(heal.id);
    expect(skilled(f5, body(f5, 'N'), ON, b5, counting)).toBe(b5);
    expect(drawn, 'skill 5 never calls random').toBe(0);

    // Sharp (skill 4) has skip = 0 -> never skips heal even at u = 0, and never skips stun omen answer.
    const f4 = sent(f5, { type: 'setNpcSkill', id: N, skill: 4 });
    expect(skilled(f4, body(f4, 'N'), ON, b5, () => 0)).toBe(b5);
    const stun = SKILL_ABILITIES.Stun(ON)!;
    const fOmen = omened(begun('N', npcWith(4, [strongHit, weakHit, stun]), mythic('the-fourth-rider', place(5, 6)), party('cannon', 'C', place(12, 5))), 'named', 'C');
    const bOmen = sensible(fOmen, body(fOmen, 'N'), ON);
    expect(bOmen.type === 'act' && bOmen.ability.id).toBe(stun.id);
    expect(skilled(fOmen, body(fOmen, 'N'), ON, bOmen, () => 0)).toBe(bOmen);

    // Sloppy (skill 1) has skip = 0.65 -> u < 0.65 skips heal and falls through to hits; u >= 0.65 keeps heal.
    const f1 = sent(f5, { type: 'setNpcSkill', id: N, skill: 1 });
    expect(skilled(f1, body(f1, 'N'), ON, b5, () => 0.70)).toBe(b5);
    const skipped = skilled(f1, body(f1, 'N'), ON, b5, () => 0.10);
    expect(skipped.type === 'act' && skipped.ability.id !== heal.id).toBe(true);

    // Non-act choices (move, pass, release) are never altered even at skill 1.
    const moveChoice = { type: 'move' as const, to: place(5, 4) };
    expect(skilled(f1, body(f1, 'N'), ON, moveChoice, () => 0)).toBe(moveChoice);
    expect(skilled(f1, body(f1, 'N'), ON, { type: 'pass' }, () => 0)).toEqual({ type: 'pass' });

    // autoTurnOf passes random into skilled for NPCs and refuses when random is omitted.
    expect(autoTurnOf(f1, N, ON, f1.now)).toEqual({ kind: 'refused', reason: 'needsRandom' });
    const planSkipped = autoTurnOf(f1, N, ON, f1.now, () => 0.05);
    expect(planSkipped.kind !== 'refused' && planSkipped.choice.type === 'act' && planSkipped.choice.ability.id !== heal.id).toBe(true);
    const planKept = autoTurnOf(f1, N, ON, f1.now, () => 0.90);
    expect(planKept.kind !== 'refused' && planKept.choice.type === 'act' && planKept.choice.ability.id === heal.id).toBe(true);
  });

  test('skilled anchors on best target with offTargetPenalty so Sharp rarely goes off-target and softmax weights rise with skill', () => {
    const M3 = combatantId('M3');
    // One ranged attack and three foes in range: M1 is nearest (`best`), M2 and M3 are off-target with identical damage.
    const fBase = begun('N', npcWith(5, [strongHit]), brute(M1, place(5, 6)), brute(M2, place(5, 7)), brute(M3, place(5, 8)));
    const rateOnTarget = (skill: NpcSkill, R = ON): number => {
      const f = skill === 5 ? fBase : sent(fBase, { type: 'setNpcSkill', id: N, skill });
      const me = body(f, 'N');
      const best = sensible(f, me, R);
      let onBest = 0;
      for (let i = 0; i < 400; i++) {
        const c = skilled(f, me, R, best, policySource(12345, i));
        if (c.type === 'act' && c.aim === M1) onBest++;
      }
      return onBest / 400;
    };
    const r5 = rateOnTarget(5);
    const r4 = rateOnTarget(4);
    const r3 = rateOnTarget(3);
    const r2 = rateOnTarget(2);
    const r1 = rateOnTarget(1);
    expect(r5).toBe(1);
    expect(r4, 'Sharp stays on target > 80% (rarely off-target)').toBeGreaterThan(0.80);
    expect(r3).toBeLessThan(r4);
    expect(r2).toBeLessThan(r3);
    expect(r1).toBeLessThan(r2);
    // Setting offTargetPenalty = 0 collapses Sharp back toward uniform (~1/3) across equal-damage targets.
    const noPenalty = { ...ON, fight: { ...ON.fight, npc: { ...ON.fight.npc, offTargetPenalty: 0 } } };
    expect(rateOnTarget(4, noPenalty)).toBeLessThan(0.5);

    // On a single target with strongHit (24) vs weakHit (4), softmax always favors strongHit and tightens with skill.
    const fSingle = begun('N', npcWith(5, [strongHit, weakHit]), brute(M1, place(5, 6)));
    const strongRate = (skill: NpcSkill): number => {
      const f = skill === 5 ? fSingle : sent(fSingle, { type: 'setNpcSkill', id: N, skill });
      const me = body(f, 'N'), best = sensible(f, me, ON);
      let top = 0;
      for (let i = 0; i < 400; i++) {
        const c = skilled(f, me, ON, best, policySource(54321, i));
        if (c.type === 'act' && c.ability.id === strongHit.id) top++;
      }
      return top / 400;
    };
    const s1 = strongRate(1), s2 = strongRate(2), s3 = strongRate(3), s4 = strongRate(4), s5 = strongRate(5);
    expect(s1).toBeGreaterThan(0.5);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
    expect(s4).toBeGreaterThanOrEqual(s3);
    expect(s5).toBe(1);
  });

  test('Sharp never abandons a damaging omen answer on a mythic when adds are on the map, while Sloppy skips it on skip', () => {
    // Damaging stun strike cancels The Fourth Rider's Named in the Book (`interrupt` by `hold`), while adds stand closer.
    const damagingStun: Ability = {
      ...abilityOf('strike', { id: abilityId('concussive-shot'), name: 'Concussive Shot', range: tiles(8), shape: { kind: 'touch', reach: tiles(8) } }, ON),
      effect: { type: 'physical', by: 'hand', formula: pf('12') },
      ops: [{ op: 'applyStatus', key: statusKey('stunned'), def: ON.conditions.stunned, duration: tick(ON.fight.round) }],
    };
    const f4 = omened(
      begun(
        'N',
        npcWith(4, [strongHit, damagingStun]),
        mythic('the-fourth-rider', place(5, 10)),
        brute(M1, place(5, 6)),
        brute(M2, place(5, 7)),
        party('cannon', 'C', place(12, 5)),
      ),
      'named',
      'C',
    );
    const me4 = body(f4, 'N');
    const best = sensible(f4, me4, ON);
    expect(best.type === 'act' && best.ability.id === damagingStun.id && best.aim === X).toBe(true);

    // Sharp (skill 4, skip = 0) never abandons the damaging omen answer for an add, across every draw.
    for (let i = 0; i < 100; i++) {
      expect(skilled(f4, me4, ON, best, policySource(777, i))).toBe(best);
    }

    // Sloppy (skill 1, skip = 0.65) keeps it when u >= 0.65 and skips it to hit an add when u < 0.65.
    const f1 = sent(f4, { type: 'setNpcSkill', id: N, skill: 1 });
    const me1 = body(f1, 'N');
    expect(skilled(f1, me1, ON, best, () => 0.80)).toBe(best);
    const skipped = skilled(f1, me1, ON, best, () => 0.05);
    expect(skipped.type === 'act' && skipped.aim !== X).toBe(true);
  });
});

describe('autoDue table: decides when an NPC turn plays itself on the GM phone (NPC unit 5)', () => {
  const N_ALLY = combatantId('N_ALLY'), N_FOE = combatantId('N_FOE');
  const H = combatantId('H'), M = combatantId('M'), SH = combatantId('SH'), SU = combatantId('SU');
  const allyNpc = (at: Place = place(5, 5)): NewRow => ({
    ...npcRows(newNpc({ name: 'Mira', rank: 'E', archetype: 'skirmisher', defaultSide: 'party', skill: 3 }), [N_ALLY], ON)[0]!,
    place: at,
  });
  const foeNpc = (at: Place = place(5, 6), extra?: readonly Ability[]): NewRow => {
    const base = npcRows(newNpc({ name: 'Vance', rank: 'E', archetype: 'caster', defaultSide: 'foe', skill: 3 }), [N_FOE], ON)[0]!;
    return { ...base, ...(extra ? { abilities: [...extra] } : {}), place: at };
  };
  const brute = (id = M, at: Place = place(6, 6)): Extract<NewRow, { kind: 'monster' }> => ({
    ...(monsterRows(statBlock(ON, 'E', { name: 'Goblin', archetype: 'brute', kind: 'normal' }), [id], ON)[0]! as Extract<NewRow, { kind: 'monster' }>),
    place: at,
  });
  const shadow = (at: Place = place(4, 5)): NewRow => {
    const b = brute(SH, at);
    return {
      id: SH, name: 'Igris', side: 'party', kind: 'shadow', origin: b.origin, tier: b.tier, place: at,
      life: b.life, mana: b.mana, fatigue: 0, shield: null, stagger: null, channel: null, threat: null,
      statuses: [], readyAt: {}, abilities: b.abilities, intent: null, holder: null, xp: 0, mythic: null, owner: H,
    };
  };
  const summon = (at: Place = place(4, 6)): NewRow => {
    const b = brute(SU, at);
    return {
      id: SU, name: 'Hound', side: 'party', kind: 'summon', origin: b.origin, tier: b.tier, place: at,
      life: b.life, mana: b.mana, fatigue: 0, shield: null, stagger: null, channel: null, threat: null,
      statuses: [], readyAt: {}, abilities: b.abilities, intent: null, holder: null, xp: 0, mythic: null, owner: H, until: tick(500),
    };
  };

  test('phase table: null, setup, and ended return null; running acting returns currentId for up ally and foe NPCs', () => {
    const setup = reduce(null, { type: 'add', fightId: fightId('f-autodue'), rows: [allyNpc(), foeNpc()], openings: [] }, ctx).fight!;
    const ended = reduce(setup, { type: 'end' }, ctx).fight!;
    const runAlly = begun(N_ALLY, allyNpc(), foeNpc());
    const runFoe = begun(N_FOE, allyNpc(), foeNpc());

    expect(autoDue(null)).toBeNull();
    expect(autoDue(setup)).toBeNull();
    expect(autoDue(ended)).toBeNull();
    expect(autoDue(runAlly)).toBe(N_ALLY);
    expect(autoDue(runFoe)).toBe(N_FOE);
    expect(NPC_AUTO_MS).toBeGreaterThan(0);
  });

  test('row kind table: monsters, player hunters, shadows, summons, dead NPCs, and missing ids return null', () => {
    const fHunter = begun(H, party('bruiser', 'H', place(5, 5)), allyNpc(place(5, 4)), foeNpc(place(5, 6)));
    const fMonster = begun(M, brute(M, place(5, 6)), party('bruiser', 'H', place(5, 5)));
    const fSummon = begun(SU, party('bruiser', 'H', place(5, 5)), summon(), foeNpc(place(5, 6)));
    const shRow = shadow();
    const fShadow: Running = {
      ...fSummon,
      currentId: SH,
      rows: fSummon.rows.map(r => (r.id === SU ? { ...r, ...shRow, kind: 'shadow' as const, owner: H, holder: null } as Body : r)),
    };
    const fAlly = begun(N_ALLY, allyNpc(), foeNpc());
    const fDead: Running = { ...fAlly, rows: fAlly.rows.map(r => (r.id === N_ALLY ? { ...r, life: { at: 'dead' as const } } : r)) };
    const fMissing: Running = { ...fAlly, currentId: combatantId('NO_SUCH_ROW') };

    expect(autoDue(fHunter)).toBeNull();
    expect(autoDue(fMonster)).toBeNull();
    expect(autoDue(fShadow)).toBeNull();
    expect(autoDue(fSummon)).toBeNull();
    expect(autoDue(fDead)).toBeNull();
    expect(autoDue(fMissing)).toBeNull();
  });

  test('runningState table: pauses on dodging, owing (settle dice and broken channel), and mythic landing; runs while holding a channel', () => {
    // 1. Dodging: foe NPC casts a dodgeable blast on a player hunter -> dodging pauses autoDue.
    const nova = abilityOf('blast', {
      id: abilityId('npc-due-nova'), name: 'Frost Nova', range: tiles(8), foesOnly: true,
      shape: { kind: 'radius', radius: tiles(1), ring: { outer: tiles(2), share: percent(50) } },
    }, ON);
    const fBlast = begun(N_FOE, foeNpc(place(5, 2), [nova]), party('bruiser', 'H', place(5, 5)));
    expect(autoDue(fBlast)).toBe(N_FOE);
    const plan = autoTurnOf(fBlast, N_FOE, ON, fBlast.now, () => 0.5);
    if (plan.kind !== 'roll') throw new Error(`expected roll, got ${plan.kind}`);
    const rDodge = reduce(fBlast, plan.command({
      dice: Object.fromEntries(Object.entries(plan.needs.dice).map(([k, ds]) => [k, ds.map(() => 1)])),
      react: Object.fromEntries(plan.needs.react.map(id => [id, 20])),
    }), ctx);
    const dodging = rDodge.fight as Running;
    expect(runningState(dodging).at).toBe('dodging');
    expect(autoDue(dodging)).toBeNull();

    // 2. Owing (pending settle dice while NPC is current) -> autoDue returns null.
    const fBurnBase = sent(begun(N_ALLY, allyNpc(place(1, 1)), foeNpc(place(10, 10))), {
      type: 'status', id: N_ALLY,
      add: { key: 'burning' as StatusKey, def: ON.conditions.burning!, duration: null, tier: 0 },
    });
    let owing = fBurnBase;
    for (let i = 0; i < 8 && runningState(owing).at !== 'owing'; i++) owing = sent(owing, { type: 'endTurn', by: owing.currentId });
    expect(runningState(owing).at).toBe('owing');
    expect(autoDue(owing)).toBeNull();

    // 3. Holding channel -> runningState is acting, so autoDue returns the NPC id; broken channel -> owing, returns null.
    const chAb: Ability = {
      ...abilityOf('blast', { id: abilityId('npc-chan'), name: 'Charge', range: tiles(8), foesOnly: true }, ON),
      channel: { max: 2, growth: 'linear' },
    };
    const fHolding: Running = {
      ...begun(N_FOE, foeNpc(place(5, 2), [chAb]), party('bruiser', 'H', place(5, 5))),
    };
    const withHold: Running = {
      ...fHolding,
      rows: fHolding.rows.map(r => (r.id === N_FOE ? { ...r, channel: { ability: chAb.id, aim: H, charge: 1, spent: 0, state: 'holding' as const } } : r)),
    };
    expect(runningState(withHold).at).toBe('acting');
    expect(autoDue(withHold)).toBe(N_FOE);
    const withBroken: Running = {
      ...fHolding,
      rows: fHolding.rows.map(r => (r.id === N_FOE ? { ...r, channel: { ability: chAb.id, aim: H, charge: 1, spent: 0, state: 'broken' as const } } : r)),
    };
    expect(runningState(withBroken).at).toBe('owing');
    expect(autoDue(withBroken)).toBeNull();

    // 4. Mythic landing -> returns null.
    const fLanding = omened(begun('X', mythic('the-fourth-rider', place(5, 5)), party('tank', 'T', place(6, 5)), party('cannon', 'C', place(12, 5))), 'named', 'C');
    expect(runningState(fLanding).at).toBe('landing');
    expect(autoDue(fLanding)).toBeNull();
  });
});
