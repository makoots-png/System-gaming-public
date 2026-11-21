// The chart of the campaign's told memory (src/core/told.ts `toldStep`, audit SMX-gates-8), walked with one hunter's
// feat and one room's gate under the events of tests/models/told-events.ts.
import { TOLD_STATES, toldAt, toldFor, toldStep } from '../../src/core/told.ts';
import type { ToldAt, ToldEvent, ToldMemory } from '../../src/core/told.ts';
import { FEAT, PIECE, ROOM, hunterH1, toldEvents } from '../../tests/models/told-events.ts';
import { bfs, machine } from '../statecharts.ts';

const WORDS: { readonly [A in ToldAt]: string } = {
  unseen: 'The room never looked at',
  untold: 'Not told: its window shows',
  told: 'Told',
};

function step(e: ToldEvent, from: ToldMemory): string {
  switch (e.type) {
    case 'looked': return e.gates.length ? 'a first look at the room, showing it' : 'a first look at the room, before it appears';
    case 'answered': return e.campaign === from.campaign ? 'its window is answered' : 'a window of the campaign before is answered';
    case 'replaced': return e.hunters.some(h => h.chronicle.feats[PIECE]) ? 'a reset, an import or a restore, its hunter holding the feat' : 'a reset, an import or a restore, its hunter without the feat';
  }
}

/** Records of two campaigns that hold the same pieces act the same, so the walk keys a record without its token. */
const key = (m: ToldMemory): string => JSON.stringify({ ...m, campaign: '' });

export const told = machine<ToldMemory, ToldEvent>({
  name: 'The campaign\'s told memory',
  walked: 'Every state of one hunter\'s feat and one room\'s gate reachable from a campaign opened with the hunter holding no feat, under the events of tests/models/told-events.ts (the room looked at, each piece answered in this campaign and the one before, the campaign replaced), breadth first; two campaigns\' records holding the same pieces are one state.',
  walk: () => bfs([toldFor('c1', [hunterH1(false)])], s => toldEvents(s).flatMap(event => { const to = toldStep(s, event); return to === s ? [] : [{ event, to }]; }), key),
  kinds: TOLD_STATES,
  kindsOf: s => [toldAt(s, FEAT, PIECE), toldAt(s, ROOM, PIECE)],
  views: [{
    title: 'A piece of news, from its window to told',
    note: 'A hunter\'s personal gate is told as its feat is. A record belongs to one campaign: a reset, an import or a restore starts a new one that takes what its hunters hold as told and has seen no room, and a window answered in the campaign before changes nothing. A room\'s first look tells every gate it shows (a broken one as broken too), so joining replays nothing. A gate\'s break is a second piece of the same gate, told the same way; the chart leaves it out. A phone that could keep no record (blocked storage) tells nothing and asks nothing.',
    hides: '',
    state: s => ({ 'A hunter\'s feat': WORDS[toldAt(s, FEAT, PIECE)], 'A room\'s gate': WORDS[toldAt(s, ROOM, PIECE)] }),
    step,
  }],
  where: [
    ['The union', '`ToldMemory`, `ToldEvent`, `ToldAt` and `TOLD_STATES` in `src/core/told.ts`'],
    ['What changes it', '`toldStep(memory, event)` in `src/core/told.ts`, through `store.tell(event)` in `src/edge/store.ts`, its one writer (a replace on the store\'s own `replaced`); read by `store.told()` with `hunterNews` and `gateNews`'],
    ['Who calls it', '`src/views/feats.js` (a feat\'s window answered) and `src/views/gates.js` (a room\'s world doc looked at, a room gate\'s window answered through `gateTold`, a personal gate\'s window answered)'],
    ['The test to copy', '`tests/told.test.ts`, "the told memory of one piece of news"'],
    ['The recipe', 'docs/guide/gates-solo.md and docs/guide/feats-stories.md, the told rows'],
  ],
});
