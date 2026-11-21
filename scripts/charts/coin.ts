// The charts of a coin call (src/core/coin.ts) and of the GM's window for the calls (`CoinPrompt`), walked with the
// events of tests/models/coin-events.ts.
import { COIN_PROMPT_IDLE, COIN_PROMPT_STATES, COIN_STATES, coinPromptStep, transition } from '../../src/core/coin.ts';
import type { Coin, CoinEvent, CoinPrompt, CoinPromptEvent, CoinState } from '../../src/core/coin.ts';
import { PROMPT_WALK, WALK_EVENTS, coinIn } from '../../tests/models/coin-events.ts';
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
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});

/** The GM's window in the GM's words: what is on screen, and whether a call waits in the coin card. */
function promptLabel(p: CoinPrompt): string {
  switch (p.at) {
    case 'idle': return 'No call to rule';
    case 'asking': return p.later.length ? 'A call\'s window open, a call put off' : 'A call\'s window open';
    case 'deferred': return 'Calls put off (the coin card offers Rule)';
  }
}
function promptStep(e: CoinPromptEvent, from: CoinPrompt, to: CoinPrompt): string {
  switch (e.type) {
    case 'seen':
      if (from.at === 'asking') return 'a put-off call is ruled elsewhere or leaves';
      return to.at === 'asking' ? 'a call arrives (or the page opens with calls in the air)' : 'the put-off calls are ruled elsewhere or leave';
    case 'ruled': return 'the GM taps Right, Wrong or Let the coin decide';
    case 'putOff': return 'the GM taps Later, presses Escape or taps beside the window';
    case 'reopen': return 'the GM taps Rule on a put-off call';
  }
}

export const coinPrompt = machine<CoinPrompt, CoinPromptEvent>({
  name: 'The GM\'s window for the coin calls',
  walked: `Every state reachable from no call to rule, over two calls, under the ${PROMPT_WALK.length} events of tests/models/coin-events.ts, breadth first.`,
  walk: () => bfs([COIN_PROMPT_IDLE], p => PROMPT_WALK.flatMap(event => { const to = coinPromptStep(p, event); return to === p ? [] : [{ event, to }]; }), p => JSON.stringify(p)),
  kinds: COIN_PROMPT_STATES,
  kindsOf: p => [p.at],
  views: [{
    title: 'The GM\'s window for the coin calls, one at a time',
    note: 'The GM\'s phone only. Two calls, the older asked first; which call and in what order the GM put them off is left out. A change of the save never asks a put-off call again (audit SMX-views-7: closing the window once opened it again at once); only a tap on Rule in the coin card does, and a newer call opens its own window. An open window stays on screen whatever the save does, so the GM answers it. The prompt lives on the page: a new page asks each call in the air again. A ruling the save refuses is put off like Later.',
    hides: '',
    state: promptLabel,
    step: promptStep,
  }],
  where: [
    ['The union', '`CoinPrompt`, `CoinPromptEvent`, `COIN_PROMPT_STATES` and `COIN_PROMPT_EVENTS` in `src/core/coin.ts`'],
    ['What changes it', '`coinPromptStep(prompt, event)` and its `PROMPT_TABLE`, through `prompted` in `src/views/coin.js`, which keeps the value, opens the window on entering asking and draws the put-off calls'],
    ['Who calls it', '`src/views/coin.js`: every change of the save (`seen`), the window\'s answer (`ruled`, `putOff`), the coin card\'s Rule (`reopen`)'],
    ['The test to copy', '`tests/coin.test.ts` ("the GM\'s window for the calls"); the walk\'s events are in `tests/models/coin-events.ts`; on screen, `tests/e2e/coin.e2e.ts` ("is not asked again")'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});
