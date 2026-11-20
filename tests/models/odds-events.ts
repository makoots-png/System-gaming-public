// A run of the odds engine (src/core/combat/odds.ts) on a small fight, and every event of its life, walked by the state
// chart (scripts/charts/odds.ts); tests/statecharts.test.ts checks the walk reaches every state. tests/odds.test.ts
// checks the cells and the odds themselves.
import { RULES } from '../../src/core/rules.ts';
import { fightId, reduce } from '../../src/core/combat/fight.ts';
import type { Setup } from '../../src/core/combat/fight.ts';
import { IDLE, oddsKey } from '../../src/core/combat/odds.ts';
import type { OddsEvent, OddsRun } from '../../src/core/combat/odds.ts';
import { hunter, monster } from './fight-sim.ts';

const added = reduce(null, { type: 'add', fightId: fightId('f-chart'), rows: [hunter('tank', 'C').row, monster('E', 'brute', 'normal', 'm').row], openings: [] }, { rules: RULES }).fight;
/** A tank against one E-rank brute, in setup. */
export const FIGHT = added as Setup;
export const START: OddsRun = IDLE;
/** One of each event: asked for one fight, enough commands to finish it, the same fight on screen, another, a stop. */
export const WALK_EVENTS: readonly OddsEvent[] = [
  { type: 'ask', fight: FIGHT, seed: 1, of: 1 }, { type: 'step', commands: 10_000 },
  { type: 'changed', from: oddsKey(FIGHT) }, { type: 'changed', from: 'another fight' }, { type: 'cancel' },
];
