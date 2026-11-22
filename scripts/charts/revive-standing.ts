// The chart of a hunter's revive ladder (src/core/hunter/revive-standing.ts `standingStep`), walked with its one event.
import { REVIVE_STANDINGS, STANDING_EVENT_TYPES, standingStep } from '../../src/core/hunter/revive-standing.ts';
import type { ReviveStanding, StandingEvent } from '../../src/core/hunter/revive-standing.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { bfs, machine } from '../statecharts.ts';

const EVENTS: readonly StandingEvent[] = STANDING_EVENT_TYPES.map(type => ({ type }));
/** The words of docs/world/machines.md "Revive standing". */
const LABEL: { readonly [S in ReviveStanding]: string } = { free: 'Free revive left', debt: 'Debt revive left', none: 'Crystal or GM only' };
const STEP: { readonly [S in ReviveStanding]: string } = {
  free: 'the System raises the dead hunter for free',
  debt: 'the System raises the dead hunter on debt',
  none: '',
};

export const reviveStanding = machine<ReviveStanding, StandingEvent>({
  name: 'A hunter\'s revive ladder',
  walked: `Every standing reachable from a new hunter's (\`free\`) under the events of \`STANDING_EVENT_TYPES\` (${STANDING_EVENT_TYPES.join(', ')}), breadth first.`,
  walk: () => bfs<ReviveStanding, StandingEvent>(['free'], s => EVENTS.flatMap(event => { const to = standingStep(s, event); return isRefused(to) ? [] : [{ event, to }]; }), s => s),
  kinds: REVIVE_STANDINGS,
  kindsOf: s => [s],
  views: [{
    title: 'The System raises a dead hunter twice: once free, once on debt',
    note: 'World rule 6: "the first revive is free; after that, one revive on debt; after that none, unless the GM grants one or the hunter uses a revive item bought before death." The owner, Nov 22: the free revive and the revive on debt are a "System raise", with no GM button. Only a System raise moves the standing; the GM\'s Revive and a Resurrection Crystal raise the hunter and leave the standing as it is. In Crystal or GM only a raise is refused (`spent`).',
    hides: '',
    state: s => LABEL[s],
    step: (_e, from) => STEP[from],
  }],
  where: [
    ['The union', '`ReviveStanding`, `StandingEvent` and `REVIVE_STANDINGS` in `src/core/hunter/revive-standing.ts`; the standing is `Hunter.reviveLeft`, repaired to `free`'],
    ['What changes it', '`standingStep(standing, event)` and its `TABLE`; `canRaise(standing)` for a view'],
    ['Who calls it', '`systemRaise` in `src/core/hunter/grant.ts`, its one writer, which steps the standing, the life (`sheetEdit`, a revive by the System) and the debt (`raiseOwes`, `RULES.reviveDebtClears` Clears of the rank) in one write; `api.systemRaise` and `offerRaise` in `src/views/hunter.js`, the window THE SYSTEM CAN RAISE YOU on the dead hunter\'s own phone once no fight holds it'],
    ['The test to copy', '`tests/revive-standing.test.ts`'],
    ['The recipe', 'docs/guide/save-store.md, "A field of a saved thing"'],
  ],
});
