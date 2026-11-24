// The chart of a fight (src/core/combat/fight.ts), from the random play of tests/fight-model.test.ts. A fight
// has no end of states (HP, time, places), so the chart replays the model test's seeds rather than a breadth-first walk.
import { FIGHT_STATES, reduce, stateOf } from '../../src/core/combat/fight.ts';
import type { Command, Fight, FightState } from '../../src/core/combat/fight.ts';
import { SEEDS, ctx, lengthOf, randomCommand, rng } from '../../tests/models/fight-play.ts';
import { machine } from '../statecharts.ts';
import type { Step, Walk } from '../statecharts.ts';

type State = Fight | null;
/** The words of the fight screen. */
const LABEL: { readonly [S in FightState]: string } = { none: 'No fight', setup: 'Building the fight', running: 'Fighting', ended: 'Fight over' };

function step(cmd: Command, from: State, to: State): string | null {
  switch (cmd.type) {
    case 'add': return 'the GM adds combatants';
    case 'start': return 'the GM starts it, everyone rolls an opening';
    case 'end': return from?.phase === 'running' ? 'the GM ends it' : 'the GM ends it before it starts';
    case 'clear': return 'the GM closes it';
    case 'act': case 'move': case 'endTurn': case 'release': case 'settle': case 'remove': case 'adjust': case 'refill': case 'revive': case 'status': case 'paint': case 'zoneAdd': case 'zoneRemove': case 'resize': case 'arm': case 'extract': case 'mythic': case 'dodge':
      if (to?.phase === 'ended') return 'a side has nobody standing';
      throw new Error(`${cmd.type} moved the fight from ${stateOf(from)} to ${stateOf(to)} with no label`);
    default: throw new Error(`${cmd.type} moved the fight from ${stateOf(from)} to ${stateOf(to)} with no label`);
  }
}

function walk(): Walk<State, Command> {
  const steps: Step<State, Command>[] = [], seen = new Set<Fight>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = rng(seed);
    let fight: State = null, n = 0;
    const fresh = (): string => `x${seed}-${n++}`;
    for (let i = 0; i < lengthOf(seed); i++) {
      const cmd = randomCommand(g, fight, fresh), out = reduce(fight, cmd, ctx);
      steps.push({ from: fight, event: cmd, to: out.fight });
      fight = out.fight;
      if (fight) seen.add(fight);
    }
  }
  return { starts: [null], states: [null, ...seen], steps };
}

export const fight = machine<State, Command>({
  name: 'A fight',
  walked: `The ${SEEDS.toLocaleString('en')} random fights of tests/fight-model.test.ts, each of 10 to 49 commands from no fight.`,
  walk,
  kinds: FIGHT_STATES,
  kindsOf: f => [stateOf(f)],
  views: [{
    title: 'A fight, from building it to its summary',
    note: 'The chart shows the phase of the fight on the GM\'s screen. Everything inside a running fight stays in Fighting: turns and time, uses, walks, channels, statuses settling, staggers, shields, threat, intents, combatants who join or leave, the GM\'s hand edits, Status window and fudge, and a mythic\'s phases, its omens, the party\'s answers and the GM\'s Drop the omen and Next phase (its own chart, a mythic\'s standing in its script). The fudge goes with the fight when it ends. A fight ends by itself when one side has nobody up, after a use, a status, a channel going off, a hand edit or the last of a side leaving; the summary stays on screen until the GM closes it. A command the fight refuses changes nothing.',
    hides: '',
    state: f => LABEL[stateOf(f)],
    step,
  }],
  where: [
    ['The union', '`Fight` (`setup`, `running` or `ended`; no fight is null) and `Command` in `src/core/combat/fight-types.ts`'],
    ['What changes it', '`reduce(fight, cmd, ctx)` and its `TABLE` in `src/core/combat/fight.ts`; turns in `src/core/combat/fight-turn.ts`'],
    ['Who calls it', '`send()` in `src/views/combat.js` on the GM\'s phone, which stores what it answers'],
    ['The test to copy', '`tests/fight.test.ts`; random play in `tests/fight-model.test.ts` and `tests/models/fight-play.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A combat command"'],
  ],
});
