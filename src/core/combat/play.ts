// play.ts: the one loop that plays a fight to its end on the real reducer, a command at a time, with seeded dice. Its
// callers are the odds engine (odds.ts, every row on `sensible`) and the balance simulator (tests/models/fight-sim.ts,
// its archetype policies). Nothing here works out a rule: each turn the row's policy chooses, `needs` says what dice
// the choice asks for, the seeded source rolls them (draws.ts) with the fight's own weights (fudge.ts), `reduce`
// decides, and every die the fight then waits for (`owed`) is paid at once, as the GM's phone does. A refusal throws: a
// policy asks the rules' own checks first, so a refusal is a bug in the policy. Pure: the whole state of a play, the
// dice source's included, is the `Play` value.
import type { Rules } from '../rules.ts';
import type { CombatantId } from './ability-types.ts';
import type { ItemId } from '../ids.ts';
import { itemOfAbility } from '../registry/abilities.ts';
import { rowHp } from './row-hp.ts';
import type { Body } from './effect-ops.ts';
import { owed, reduce, runningState } from './fight.ts';
import { omenNeeds } from './fight-turn.ts';
import type { Command, Ctx, Effect, Ended, Fight, Refusal, Running, Setup } from './fight-types.ts';
import { needs } from './resolve.ts';
import type { Aim, Needs, Rolls } from './resolve.ts';
import { drawNeeds, drawOpenings, drawSettle, seededSource } from '../draws.ts';
import { openingWeights, settleWeights, weightsFor } from './fudge.ts';
import type { Random } from './../gates/spawn.ts';
import type { TurnChoice, Policy } from './policy.ts';

/** When a play stops besides a side having nobody up: the time cap (a stalemate) and the GM's end, both in rounds. */
export type Limits = { readonly capRounds: number; readonly endAtRounds: number | null };
/** The sim's and the odds' cap: a fight still going at 40 rounds is a stalemate. */
export const CAP_ROUNDS = 40;
/** At most this many commands a play: past it the fight is ended as a stalemate (a fight whose time stops moving). */
export const PLAY_STEPS_MAX = 5000;

/** An item a row used up in a played fight: the row, and the item its ability was (`itemOfAbility`). */
export type UsedUp = { readonly by: CombatantId; readonly item: ItemId };
/**
 * A fight being played: the fight, the dice source's state, the hunters that have died in the order they died, whether it ended at its cap, the commands played, and the items used up, one per use, in order.
 */
export type Play = {
  readonly fight: Running | Ended; readonly source: number; readonly down: readonly CombatantId[]; readonly capped: boolean; readonly steps: number;
  readonly spent: readonly UsedUp[];
};
/**
 * One step of a play: the fight before it, the row whose turn it was and what it chose with its dice (null when the
 * step was the cap's end), and every effect the step and the dice paid after it had.
 */
export type Played = {
  readonly play: Play; readonly before: Running; readonly me: Body | null; readonly choice: TurnChoice | null; readonly rolls: Rolls | null; readonly effects: readonly Effect[];
};

const ctxOf = (R: Rules): Ctx => ({ rules: R });

/** `cmd` reduced, or a throw naming it: the policy chose what the rules refuse. */
function sent(f: Fight, cmd: Command, R: Rules): { fight: Fight; effects: readonly Effect[] } {
  const r = reduce(f, cmd, ctxOf(R));
  const no = r.effects.find((e): e is Extract<Effect, { type: 'refused' }> => e.type === 'refused');
  if (no) throw new Error(`a played fight refused ${cmd.type}${'by' in cmd ? ` by ${cmd.by}` : ''}${cmd.type === 'act' ? ` (${cmd.ability})` : ''}: ${no.reason as Refusal}`);
  if (!r.fight || r.fight.phase === 'setup') throw new Error(`a played fight left no fight after ${cmd.type}`);
  return { fight: r.fight, effects: r.effects };
}
/**
 * The dice `me`'s use of `ability` at `aim` asks for, drawn with the fight's weights (fudge.ts `weightsFor`), as the GM's
 * phone draws them. On a mythic's landing turn the use is its omen's move, which is not one of its row's abilities and
 * no taunt binds: its dice are fight-turn.ts `omenNeeds`'s.
 */
function rollsFor(f: Running, me: Body, ability: string, aim: Aim, R: Rules, random: Random): Rolls {
  const state = runningState(f);
  const n: Needs | null = state.at === 'landing' && state.id === me.id ? omenNeeds(f, me, R)
    : needs(me.abilities.find(a => a.id === ability)!, me, f.rows, aim, f.grid, f.now, R);
  if (!n) throw new Error(`${me.name} has no omen to land`);
  return drawNeeds(n, random, weightsFor(f, me.id, n));
}

/** Pays every die and open dodge `f` waits for (open dodges with the automatic nearest tile, then `owed` in order). */
function paid(f: Running | Ended, R: Rules, random: Random): { fight: Running | Ended; effects: Effect[] } {
  let at: Running | Ended = f;
  const effects: Effect[] = [];
  while (at.phase === 'running') {
    const now: Running = at;
    if (now.dodge) {
      const r = sent(now, { type: 'dodge', id: null, to: null }, R);
      at = r.fight as Running | Ended;
      effects.push(...r.effects);
      continue;
    }
    const o = owed(now)[0];
    if (!o) break;
    let cmd: Command;
    if (o.kind === 'settle') cmd = { type: 'settle', id: o.id, key: o.key, dice: drawSettle(o.dice, random, settleWeights(now, o.id, o.key)) };
    else {
      const row = now.rows.find(r => r.id === o.id)!, c = row.channel!;
      cmd = { type: 'release', by: row.id, rolls: rollsFor(now, row, c.ability, c.aim, R, random) };
    }
    const r = sent(now, cmd, R);
    at = r.fight as Running | Ended;
    effects.push(...r.effects);
  }
  return { fight: at, effects };
}
const downOf = (f: Fight, was: readonly CombatantId[]): readonly CombatantId[] => {
  const more = f.rows.filter(r => r.kind === 'hunter' && r.side === 'party' && rowHp(r) === 0 && !was.includes(r.id)).map(r => r.id);
  return more.length ? [...was, ...more] : was;
};

/**
 * A play of `f` from seed `seed`: a fight in setup starts with each row's opening drawn from the seed; a running one is
 * taken as it stands. Either then pays the dice it waits for. Answers the play and the effects of the start and the dice.
 */
export function playBegin(f: Setup | Running, seed: number, R: Rules): { readonly play: Play; readonly effects: readonly Effect[] } {
  const src = seededSource(seed);
  const start = f.phase === 'setup' ? sent(f, { type: 'start', openings: drawOpenings(f.rows.map(r => r.id), src.random, openingWeights(f, f.rows)) }, R) : { fight: f, effects: [] };
  const p = paid(start.fight as Running | Ended, R, src.random);
  return { play: { fight: p.fight, source: src.state(), down: downOf(p.fight, []), capped: false, steps: 0, spent: [] }, effects: [...start.effects, ...p.effects] };
}

/** Whether the play is over: its fight has ended. */
export const playOver = (p: Play): p is Play & { readonly fight: Ended } => p.fight.phase === 'ended';

/**
 * One turn of a running play: the GM's end at `endAtRounds`, the cap's at `capRounds` (or past `PLAY_STEPS_MAX`
 * commands), else the current row's choice by `policyOf(row)`, its dice, the command, and the dice the fight then waits for.
 */
export function playStep(p: Play & { readonly fight: Running }, policyOf: (me: Body) => Policy, limits: Limits, R: Rules): Played {
  const src = seededSource(p.source), f = p.fight, down = downOf(f, p.down);
  const ending = limits.endAtRounds !== null && f.now >= limits.endAtRounds * R.fight.round ? 'end'
    : f.now >= limits.capRounds * R.fight.round || p.steps >= PLAY_STEPS_MAX ? 'cap' : null;
  if (ending) {
    const r = sent(f, { type: 'end' }, R);
    return { play: { fight: r.fight as Ended, source: src.state(), down, capped: ending === 'cap', steps: p.steps + 1, spent: p.spent }, before: f, me: null, choice: null, rolls: null, effects: r.effects };
  }
  const me = f.rows.find(r => r.id === f.currentId)!;
  const choice = policyOf(me)(f, me, R);
  let cmd: Command, rolls: Rolls | null = null;
  switch (choice.type) {
    case 'act': rolls = rollsFor(f, me, choice.ability.id, choice.aim, R, src.random); cmd = { type: 'act', by: me.id, ability: choice.ability.id, aim: choice.aim, rolls }; break;
    case 'move': cmd = { type: 'move', by: me.id, to: choice.to, ...(choice.dash ? { dash: true } : {}) }; break;
    case 'pass': cmd = { type: 'endTurn', by: me.id }; break;
    case 'release': { const c = me.channel!; rolls = rollsFor(f, me, c.ability, c.aim, R, src.random); cmd = { type: 'release', by: me.id, rolls }; break; }
  }
  const r = sent(f, cmd, R);
  const after = paid(r.fight as Running | Ended, R, src.random);
  const item = choice.type === 'act' ? itemOfAbility(choice.ability) : null;
  return {
    play: { fight: after.fight, source: src.state(), down: downOf(after.fight, down), capped: false, steps: p.steps + 1, spent: item ? [...p.spent, { by: me.id, item }] : p.spent },
    before: f, me, choice, rolls, effects: [...r.effects, ...after.effects],
  };
}
