// The chart of the store's life (src/core/store-life.ts), walked with every event of tests/models/store-events.ts.
import { STORE_STATES, WRITES, storeStep } from '../../src/core/store-life.ts';
import type { StoreEvent, StoreLife } from '../../src/core/store-life.ts';
import { STARTS, WALK_EVENTS } from '../../tests/models/store-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** What the player sees in each state; the banner's gist in brackets. */
function label(l: StoreLife): string {
  switch (l.at) {
    case 'noStorage': return 'Plays in memory (Storage is unavailable)';
    case 'keeping': return 'Puts its own save in Backups before it shows another tab\'s';
    case 'readOnly': switch (l.why) {
      case 'newer': return 'Shows a newer app\'s save, refuses every change (Newer version)';
      case 'otherTab': return 'Refuses every change, its own kept in Backups (Another tab saved)';
      case 'mineUnkept': return 'Still shows its own save, refuses every change (Another tab saved; storage too full to keep yours: export it)';
      case 'loadUnkept': return 'Will not write over a save it could not open nor back up (Storage too full)';
    }
    case 'ready': switch (l.write) {
      case 'clean': return 'Saved';
      case 'dirty': return 'A change waits for its write, a frame later';
      case 'failing': return 'A change is not saved (Saving failed)';
      case 'retrying': return 'A newer change waits for its write (Saving failed)';
    }
  }
}

function step(e: StoreEvent, from: StoreLife): string | null {
  switch (e.type) {
    case 'changed': return 'the player changes something';
    case 'due': return 'the next frame comes and the save is written';
    case 'leaving': return from.at === 'ready' && from.write === 'failing' ? 'the page is hidden or left and the save is written again' : 'the page is hidden or left and the save is written';
    case 'wrote': return 'storage takes the write';
    case 'writeFailed': return 'storage is full or blocked';
    case 'otherTab':
      if (from.at === 'ready' && from.write !== 'clean') return 'another tab saves, whatever it stores';
      return e.theirs === 'save' ? 'another tab saves' : e.theirs === 'newer' ? 'another tab of a newer app saves' : 'another tab stores what this app cannot read';
    case 'replaced': return 'a backup is restored, a file imported or the campaign reset';
    case 'kept': return 'the backups take this tab\'s save';
    case 'keepFailed': return 'storage is too full to back it up';
  }
}

export const store = machine<StoreLife, StoreEvent>({
  name: 'The store',
  walked: `Every state reachable from the four lives a load opens in (no storage, a newer app's save, this app's, a text storage was too full to back up) under the ${WALK_EVENTS.length} events of tests/models/store-events.ts, breadth first.`,
  walk: () => bfs(STARTS, l => WALK_EVENTS.map(event => ({ event, to: storeStep(l, event).life })), l => JSON.stringify(l)),
  kinds: [...STORE_STATES, ...WRITES],
  kindsOf: l => (l.at === 'ready' ? [l.at, l.write] : [l.at]),
  views: [{
    title: 'The store, from the load to a save written',
    note: 'The chart shows one tab. A write is an effect the store carries out at once; its answer is the arrow after it ("storage takes the write", "storage is full or blocked"). In "Refuses every change" a player\'s change is refused with the banner\'s words; the room link\'s own bookkeeping, and the GM\'s fight until combat.js `send` is one step, still change memory and are dropped at the reload. A reload opens the tab again from the load.',
    hides: '',
    state: label,
    step: (e, from) => step(e, from),
  }],
  where: [
    ['The union', '`StoreLife`, `StoreEvent`, `STORE_STATES` and `WRITES` in `src/core/store-life.ts`'],
    ['What changes it', '`storeStep(life, event)` and its `TABLE`; `opened` is the load\'s'],
    ['Who calls it', '`src/edge/store.ts` (`carry`, `run`): its writes, the frame\'s timer, the page hidden or left, the `storage` event, a replace; `noticesOf` is what the banners say, `mayChange` what `store.apply` refuses'],
    ['The test to copy', '`tests/store-life.test.ts`, `tests/e2e/save.e2e.ts`; the walk\'s events are in `tests/models/store-events.ts`'],
    ['The recipe', 'AGENTS.md, "A state or event of the ... machine"'],
  ],
});
