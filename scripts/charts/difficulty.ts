// The chart of a gate's difficulty (src/core/gates/difficulty.ts `difficultyStep`), walked with every event.
import {
  BOSS_DIFFICULTY_STATES,
  DEFAULT_DIFFICULTY,
  GATE_DIFFICULTY_STATES,
  difficultyStep,
} from '../../src/core/gates/difficulty.ts';
import type {
  BossDifficultyState,
  DifficultyEvent,
  GateDifficulty,
  GateDifficultyState,
} from '../../src/core/gates/difficulty.ts';
import { bfs, machine } from '../statecharts.ts';

const EVENTS: readonly DifficultyEvent[] = [
  { type: 'setGate', level: 7 },
  { type: 'resetGate' },
  { type: 'setBoss', level: 8 },
  { type: 'followGate' },
  { type: 'bossRemoved' },
];

const GATE_LABEL: { readonly [S in GateDifficultyState]: string } = {
  default: 'Uses rule default (5 of 10)',
  set: 'Pinned by the GM (1 to 10)',
};

const BOSS_LABEL: { readonly [S in BossDifficultyState]: string } = {
  follows: 'Follows gate difficulty',
  own: 'Boss has its own difficulty (1 to 10)',
};

function stepLabel(e: DifficultyEvent): string {
  switch (e.type) {
    case 'setGate': return 'the GM moves the gate slider';
    case 'resetGate': return 'the GM resets the gate to default';
    case 'setBoss': return 'the GM sets a boss difficulty';
    case 'followGate': return 'the GM turns off the boss override';
    case 'bossRemoved': return 'the GM removes the gate boss';
  }
}

export const gateDifficultyChart = machine<GateDifficulty, DifficultyEvent>({
  name: 'A gate\'s difficulty',
  walked: 'Every state reachable from a gate at default difficulty (`default` / `follows`) under the 5 events of `DIFFICULTY_EVENTS`, breadth first.',
  walk: () => bfs<GateDifficulty, DifficultyEvent>([DEFAULT_DIFFICULTY], s => EVENTS.flatMap(event => {
    const to = difficultyStep(s, event);
    return to ? [{ event, to }] : [];
  }), s => `${s.gate.at}/${s.boss.at}`),
  kinds: [...GATE_DIFFICULTY_STATES, ...BOSS_DIFFICULTY_STATES],
  kindsOf: s => [s.gate.at, s.boss.at],
  views: [{
    title: 'A gate\'s difficulty and optional boss override',
    note: 'Stored on `Gate.difficulty` on the GM\'s save and omitted from the room\'s world doc so players never see the level. Two independent tracks: the gate tracks either the rule default (`RULES.fight.difficulty.default`) or a pinned level, while the boss either follows the gate or holds its own override. Removing the gate\'s boss resets any boss override back to `follows`.',
    hides: '',
    state: s => ({ 'Gate difficulty': GATE_LABEL[s.gate.at], 'Boss difficulty': BOSS_LABEL[s.boss.at] }),
    step: e => stepLabel(e),
  }],
  where: [
    ['The union', '`GateDifficulty`, `GateTrack`, `BossTrack`, and `DifficultyEvent` in `src/core/gates/difficulty.ts`; stored on `Gate.difficulty`'],
    ['What changes it', '`difficultyStep(state, event)` (`GATE_TABLE` and `BOSS_TABLE`); `withDifficulty` and `gateDifficulty`'],
    ['Who calls it', '`src/views/gates.js` (spawn and edit), `src/views/gm.js` (spawn shortcut), and `editGate` (`src/core/gates/world.ts`)'],
    ['The test to copy', '`tests/difficulty.test.ts`'],
    ['The recipe', 'docs/guide/gates-solo.md, "Where things live"'],
  ],
});
