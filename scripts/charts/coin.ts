// The chart of a coin call (src/core/coin.ts), walked with the events of the walk in tests/coin.test.ts.
import { COIN_STATES, transition } from '../../src/core/coin.ts';
import type { Coin, CoinEvent, CoinState } from '../../src/core/coin.ts';
import { WALK_EVENTS, coinIn } from '../../tests/models/coin-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** The words of the coin on the player's phone and of the GM's window. */
const LABEL: { readonly [S in CoinState]: string } = {
  uncalled: 'Heads or tails? (no call yet)', called: 'In the air (the GM is asked)', landed: 'Landed',
};

function step(e: CoinEvent): string {
  switch (e.type) {
    case 'call': return 'the player taps Heads or Tails';
    case 'land': return 'the landing arrives (the GM\'s Right, Wrong or coin, or a flip when alone)';
  }
}

export const coin = machine<Coin, CoinEvent>({
  name: 'A coin call',
  walked: `Every coin reachable from a natural 20 that called the coin (tests/models/coin-events.ts) under the ${WALK_EVENTS.length} events of the walk in tests/coin.test.ts, breadth first.`,
  walk: () => bfs([coinIn('uncalled')], c => WALK_EVENTS.map(event => ({ event, to: transition(c, event) })), c => JSON.stringify(c)),
  kinds: COIN_STATES,
  kindsOf: c => [c.at],
  views: [{
    title: 'A coin, from the natural 1 or 20 to its landing',
    note: 'The chart shows the coin on the player\'s phone; the GM\'s phone holds the same coin from the call on. It leaves out which side was called and which side it landed on: both sides move the same. A second call, a landing before the call and a second landing change nothing, so a replayed message is not drawn. The coin does not land by itself: a coin the GM never answers stays in the air.',
    hides: '',
    state: c => LABEL[c.at],
    step,
  }],
  where: [
    ['The union', '`Coin`, `CoinEvent` and `COIN_STATES` in `src/core/coin.ts`'],
    ['What changes it', '`transition(coin, event)` and its `TABLE`; `stepCoin` for a phone\'s list'],
    ['Who calls it', '`src/views/coin.js` (the player\'s call and coin, the GM\'s window) and the `coinLand` applier in `src/edge/room-events.ts`'],
    ['The test to copy', '`tests/coin.test.ts`; the walk\'s events are in `tests/models/coin-events.ts`'],
    ['The recipe', 'AGENTS.md, "A state or event of the ... machine"'],
  ],
});
