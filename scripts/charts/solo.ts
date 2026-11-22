// The charts of a hunter's personal gates (src/core/gates/solo.ts `soloTick`, personal.ts) and of a player's ask that waits
// for the GM's phone's answer (src/core/sync/asked.ts), walked with a won run of a room's solo gate; each with the events
// of tests/models/solo-events.ts.
import { ASKED_STATES, askedOf, shownOf } from '../../src/core/sync/asked.ts';
import type { AskedState } from '../../src/core/sync/asked.ts';
import { CLOCK_EVENTS, CLOCK_START, WAIT_EVENTS, WAIT_START, clockKey, clockStep, waitModelStep } from '../../tests/models/solo-events.ts';
import type { ClockEvent, ClockWorld, WaitModelEvent, WaitWorld } from '../../tests/models/solo-events.ts';
import { bfs, machine } from '../statecharts.ts';

const clockOf = (w: ClockWorld) => w.save.hunters[0]!.solo;
const clockLabel = (w: ClockWorld): string => {
  const s = clockOf(w), n = s.gates.length, held = n === 0 ? 'no gate open' : `${n} gate${n === 1 ? '' : 's'} open`;
  return s.clock.at === 'off' ? `Off, ${held}` : `On, ${held}`;
};
function clockArrow(e: ClockEvent, from: ClockWorld, to: ClockWorld): string | null {
  if (clockLabel(from) === clockLabel(to)) return null;
  switch (e.type) {
    case 'time': return clockOf(to).gates.length > clockOf(from).gates.length ? 'a spawn time comes [fewer than the cap open]' : 'a gate\'s time is up, it closes';
    case 'switch': return e.personal ? 'personal gates turned on: a gate at once' : 'personal gates turned off';
    case 'die': return 'the hunter dies';
    case 'revive': return 'the hunter is revived: a gate at once';
  }
}

export const soloClock = machine<ClockWorld, ClockEvent>({
  name: 'A hunter\'s personal gates',
  walked: `Every state reachable from a new hunter with its clock off, under the ${CLOCK_EVENTS.length} events of tests/models/solo-events.ts (time, the switch, a death and a revive, each followed by the tick the one timer runs), breadth first, the clock's next spawn read from now.`,
  walk: () => bfs<ClockWorld, ClockEvent>([CLOCK_START], w => CLOCK_EVENTS.map(event => ({ event, to: clockStep(w, event) })), clockKey),
  kinds: ['off', 'on'],
  kindsOf: w => [clockOf(w).clock.at],
  views: [{
    title: 'The System\'s clock and the gates it opens for one hunter',
    note: 'The clock runs while personal gates are on (the rules, with the room\'s switch over them) and the hunter may have them: not the starter hunter, not a dead one, and on a GM\'s phone only one that has completed a daily. The gate opened as the clock turns on is the even one (one monster of the hunter\'s own rank, `EVEN_PACK`); on, it opens a gate every `RULES.solo.hours`, at most `held` at once, each open `stays` hours; a phone closed for days opens to the gates still open now, each at its own time. A run that clears a gate takes it out of the list (`soloRan`, not drawn). Every tick is one write, and a tick at the same moment again writes nothing.',
    hides: 'A tick that changes neither the clock nor the number of gates (an arrow to the same state).',
    state: clockLabel,
    step: clockArrow,
  }],
  where: [
    ['The union', '`SoloClock`, `PersonalGate` and `Solo` in `src/core/gates/personal.ts`, the hunter\'s `solo`'],
    ['What changes it', '`soloTick` in `src/core/gates/solo.ts`, and `soloRan` for a cleared gate; `soloWake` is its term of the one timer (`nextWake`)'],
    ['Who calls it', '`tick` in `src/views/gates.js`, run by the one timer in `src/views/quests.js` (`checkDaily`, on the app\'s ready and at each wake)'],
    ['The test to copy', '`tests/solo.test.ts`; the walk\'s events are in `tests/models/solo-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "A rule of the day\'s time"; docs/guide/save-store.md, "A field of a saved thing"'],
  ],
});

const waitingOf = (s: WaitWorld) => askedOf(s)[0] ?? null;
const shownState = (s: WaitWorld): AskedState | 'end' => { const w = waitingOf(s); return w ? shownOf(w, s.settings.sync.outbox ?? []).state : 'end'; };
const WAIT_LABEL: { readonly [K in AskedState | 'end']: string } = {
  posted: 'Cleared. Waiting for the room',
  taken: 'Cleared. Waiting for the GM\'s phone',
  lost: 'Lost: the cost stays, nothing paid',
  end: 'Answered or put away',
};
function waitArrow(e: WaitModelEvent, from: WaitWorld, to: WaitWorld): string | null {
  if (shownState(from) === shownState(to)) return null;
  switch (e.type) {
    case 'sent': return 'the room takes the run';
    case 'answered': return 'the GM\'s phone answers: paid, or taken';
    case 'refused': return 'the room refuses the run';
    case 'drop': return 'the outbox lets it go';
    case 'roomGone': return 'the room is gone';
    case 'dismiss': return shownState(from) === 'taken' ? 'the player stops waiting' : 'the player puts it away';
    default: return null;
  }
}
export const soloWait = machine<WaitWorld, WaitModelEvent>({
  name: 'An ask waiting for the GM\'s phone',
  walked: `Every state reachable from a player's won run just written, under the ${WAIT_EVENTS.length} events of tests/models/solo-events.ts (the outbox's steps of its letter, the GM's answer, the room gone, a dismissal), breadth first.`,
  walk: () => bfs<WaitWorld, WaitModelEvent>([WAIT_START], s => WAIT_EVENTS.map(event => ({ event, to: waitModelStep(s, event) })), s => JSON.stringify([shownState(s), (s.settings.sync.outbox ?? []).map(x => x.at), waitingOf(s)?.state ?? null])),
  kinds: [...ASKED_STATES, 'end'],
  kindsOf: s => [shownState(s)],
  views: [{
    title: 'A player\'s ask, walked as a won run of a room\'s solo gate, until the GM\'s phone answers',
    note: 'The gate is the GM\'s phone\'s alone: the player\'s phone keeps only its claim, by the run\'s event id, and pays the answer only while the run waits, so a second answer pays nothing. Its cost was written with the run. Posted and lost are read from the outbox (the letter queued or on its way; refused or let go), taken and gone are stored; a reload changes nothing, and leaving the room only makes it wait. A run the room took can be put away after a question (a GM\'s phone that missed it would hold it and its gate for good); an answer after that pays nothing. A stash ask (kind `stash`) has the same states and cells, but one the room took is not put away (`TABLES.stash`): the GM\'s phone holds the stash and answers it.',
    hides: 'The letter\'s own sends and failed sends (they stay in Waiting for the room), and each event that does not apply.',
    state: s => WAIT_LABEL[shownState(s)],
    step: waitArrow,
  }],
  where: [
    ['The union', '`Asked` (its kinds `solo` and `stash`), `AskedState`, `AskedEvent`, `ASKED_STATES` and `ASKED_EVENTS` in `src/core/sync/asked.ts`; the list is the save\'s `settings.sync.asked`'],
    ['What changes it', '`askedStep` and its `TABLE`; `askPosted`, `askTaken`, `askedGone`, `askAnswered`, `askDismissed`'],
    ['Who calls it', '`soloRan` (gates/solo.ts) writes it; `boxDo` in `src/edge/sync.ts` hears the room take it or the room gone; `landSoloAnswer` in `src/edge/room-events.ts` answers it; `src/views/gates.js` puts a lost or taken one away (`mayDismiss`)'],
    ['The test to copy', '`tests/asked.test.ts`; the walk\'s events are in `tests/models/solo-events.ts`; two players in `tests/room-system-model.test.ts`'],
    ['The recipe', 'docs/guide/room-sync.md, "A room message"'],
  ],
});
