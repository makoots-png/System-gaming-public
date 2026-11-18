// The chart of the app update (src/core/upgrade.ts), walked with every event of tests/models/upgrade-events.ts.
import { UPDATE_QUIET_MS, UPDATE_STATES, installOf, updateStep } from '../../src/core/upgrade.ts';
import type { Update, UpdateEvent, UpdateState } from '../../src/core/upgrade.ts';
import { STARTS, WALK_EVENTS } from '../../tests/models/upgrade-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** What the tab shows or does in each state; the pill's words in brackets. */
const LABEL: { readonly [S in UpdateState]: string } = {
  none: 'Runs its build',
  installing: 'The new worker caches the app (Updating 40%)',
  ready: 'Every file cached, the new worker takes over (Updating 100%)',
  reloading: 'Reloads into the new build',
  stuck: 'Says it is out of date, never reloads',
};

function step(e: UpdateEvent): string | null {
  switch (e.type) {
    case 'refused': return e.decision.to === 'reload' ? 'the room server runs another build' : 'refused again for the build it reloaded for, or it cannot note the reload';
    case 'looked': return e.installing ? null : 'no new worker installs (none, blocked, the same build, or it already took over)';
    case 'caching': {
      const install = installOf(e.count);
      return install === 'failed' ? 'a file does not cache' : install === 'cached' ? 'the last file is cached' : null;
    }
    case 'controlled': return 'the new worker takes control';
    case 'quiet': return `no word from the worker for ${UPDATE_QUIET_MS / 1000} s`;
  }
}

export const upgrade = machine<Update, UpdateEvent>({
  name: 'The app update',
  walked: `Every state reachable from a tab running its build under the ${WALK_EVENTS.length} events of tests/models/upgrade-events.ts (a worker of two files), breadth first.`,
  walk: () => bfs(STARTS, u => WALK_EVENTS.map(event => ({ event, to: updateStep(u, event).state })), u => JSON.stringify(u)),
  kinds: UPDATE_STATES,
  kindsOf: u => [u.at],
  views: [{
    title: 'The app update, from a refusal to the new build',
    note: 'The chart shows one tab. A worker installing while no server refused the tab changes nothing on it, so those arrows are not drawn. The quiet time starts again at each word of the worker, so a phone still counting is never reloaded mid-count. After a reload the page is the new build and its update starts again at "Runs its build"; a tab refused again for the build it reloaded for is stuck. What the worker does with a file that fails (it drops its cache and never takes over) is in src/sw.js.',
    hides: '',
    state: u => LABEL[u.at],
    step: e => step(e),
  }],
  where: [
    ['The union', '`Update`, `UpdateEvent` and `UPDATE_STATES` in `src/core/upgrade.ts`; the worker\'s `Count`, `counted` and `installOf` beside them'],
    ['What changes it', '`updateStep(update, event)` and its `TABLE`; `decideUpgrade` is the refusal\'s decision'],
    ['Who calls it', '`src/edge/upgrade.ts` (`upgradeRefused`, called by `src/edge/sync.ts` on a 426), the one writer; `src/edge/room-pill.ts` reads it; `src/sw.js` posts the count'],
    ['The test to copy', '`tests/upgrade.test.ts`, `tests/sw.test.ts`; the walk\'s events are in `tests/models/upgrade-events.ts`'],
    ['The recipe', 'AGENTS.md, "A state or event of the ... machine"'],
  ],
});
