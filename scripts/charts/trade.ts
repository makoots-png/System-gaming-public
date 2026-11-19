// The charts of an offer between two hunters (src/core/trade/offer.ts): the offer in the room, the giver's record, the
// taker's record and the GM's phone's, each walked with the events of tests/models/trade-events.ts.
import { GIVER_ROWS, OFFER_OUTCOMES, TAKER_ROWS, WATCH_ROWS } from '../../src/core/trade/offer.ts';
import type { GiverRow, OfferClose, OfferOutcome, TakerRow, WatchRow } from '../../src/core/trade/offer.ts';
import { GIVER_START, RECORD_EVENTS, ROOM_EVENTS, ROOM_START, TAKER_START, WATCH_START, recordKey, recordWalkStep, roomStep } from '../../tests/models/trade-events.ts';
import type { RecordWorld, RoomEvent, RoomWorld } from '../../tests/models/trade-events.ts';
import type { RecordEvent } from '../../src/core/trade/offer.ts';
import { bfs, machine } from '../statecharts.ts';

const OUTCOME_LABEL: { readonly [K in OfferOutcome]: string } = {
  settled: 'Settled: the goods change hands',
  refused: 'Refused: each side\'s goods go back',
  withdrawn: 'Taken back: each side\'s goods go back',
  stopped: 'Stopped by the GM: each side\'s goods go back',
  void: 'Void: an end that does not fit; nothing moves',
};
const ROOM_LABEL: { readonly [K in 'none' | 'open']: string } = { none: 'No offer', open: 'Open: the room holds the offer' };
const roomLabel = (w: RoomWorld): string => (w.at === 'none' || w.at === 'open' ? ROOM_LABEL[w.at] : OUTCOME_LABEL[w.at]);
function roomArrow(e: RoomEvent, from: RoomWorld, to: RoomWorld): string | null {
  if (roomLabel(from) === roomLabel(to)) return null;
  if (e.type === 'offer') return 'the giver offers [the room takes the offer]';
  switch (e.end.how) {
    case 'accept': return to.at === 'settled' ? 'the first end: the taker accepts with the asked goods' : 'the first end: an accept that does not fit (another hunter, other goods)';
    case 'refuse': return 'the first end: the taker refuses';
    case 'withdraw': return 'the first end: the giver takes it back';
    case 'stop': return 'the first end: the GM stops it';
  }
}

export const offerRoom = machine<RoomWorld, RoomEvent>({
  name: 'An offer in the room',
  walked: `Every state reachable from no offer, under the ${ROOM_EVENTS.length} events of tests/models/trade-events.ts (the offer, and one of each kind of end), breadth first.`,
  walk: () => bfs<RoomWorld, RoomEvent>([ROOM_START], w => ROOM_EVENTS.map(event => ({ event, to: roomStep(w, event) })), w => w.at),
  kinds: ['none', 'open', ...OFFER_OUTCOMES],
  kindsOf: w => [w.at],
  views: [{
    title: 'An offer between two hunters, as the room holds it',
    note: 'Every end of an offer (an accept, a refuse, a take back, the GM\'s stop) carries one event id made from the offer\'s (`endIdOf`), and the room keeps the first event of an id and answers a later one with its seq, storing nothing (server.ts `addEvent`). So the only branch is which end the room took first, and every phone reads the same end. How it came out is `outcomeOf`, a pure function of the offer and that end. Every end state is final.',
    hides: 'A second end (the room answers it with the first\'s seq) and an end before the offer.',
    state: roomLabel,
    step: roomArrow,
  }],
  where: [
    ['The union', '`Offer`, `OfferEnd`, `OfferOutcome` and `OFFER_OUTCOMES` in `src/core/trade/offer.ts`; the messages `offer`, `offerEnd` and `offerStop` in `src/core/protocol.ts`'],
    ['What changes it', 'The room\'s rule that an event id is taken once (`addEvent` in `server.ts`); `outcomeOf` reads the end'],
    ['Who calls it', 'The taps of `src/core/trade/offer.ts` post the letters; the fold `offersSeen` reads the end on every phone (sync.ts, unit 2)'],
    ['The test to copy', '`tests/offer.test.ts` ("how an offer came out"), `tests/server-rooms.test.ts` ("an offer ends once")'],
    ['The recipe', 'AGENTS.md, "A room message"; notes-5-trade.md 1.5'],
  ],
});

const CLOSE_LABEL: { readonly [K in OfferClose]: string } = {
  settled: 'Ended: settled',
  refused: 'Ended: refused, goods back',
  withdrawn: 'Ended: taken back, goods back',
  stopped: 'Ended: stopped, goods back',
  void: 'Ended: void, goods back',
  recalled: 'Ended: taken back before it was sent, goods back',
  unsent: 'Ended: never sent, goods back',
  gone: 'Ended: the room closed first, goods back',
  reclaimed: 'Ended: stranded and taken back, goods back',
};
const GIVER_LABEL: { readonly [K in GiverRow]: string } = {
  'posting-queued': 'Posting: never sent (goods aside)',
  'posting-tried': 'Posting: sent once (goods aside)',
  open: 'Open: the room has it (goods aside)',
  'withdrawing-queued': 'Taking back: never sent',
  'withdrawing-tried': 'Taking back: sent once',
  'withdrawing-taken': 'Taking back: the room has it',
  stranded: 'Stranded: the room closed first (goods aside)',
};
const TAKER_LABEL: { readonly [K in TakerRow]: string } = {
  offered: 'Offered',
  'accepting-queued': 'Accepting: never sent (asked goods aside)',
  'accepting-tried': 'Accepting: sent once (asked goods aside)',
  'accepting-taken': 'Accepting: the room has it (asked goods aside)',
  'refusing-queued': 'Refusing: never sent',
  'refusing-tried': 'Refusing: sent once',
  'refusing-taken': 'Refusing: the room has it',
  stranded: 'Stranded: the room closed first (asked goods aside)',
};
const WATCH_LABEL: { readonly [K in WatchRow]: string } = {
  open: 'Open: shown with Stop',
  'stopping-queued': 'Stopping: never sent',
  'stopping-tried': 'Stopping: sent once',
  'stopping-taken': 'Stopping: the room has it',
};
const recordLabel = (w: RecordWorld): string => ('closed' in w ? CLOSE_LABEL[w.closed] : w.side === 'giver' ? GIVER_LABEL[w.state] : w.side === 'taker' ? TAKER_LABEL[w.state] : WATCH_LABEL[w.state]);
function recordArrow(e: RecordEvent, from: RecordWorld, to: RecordWorld): string | null {
  if (recordLabel(from) === recordLabel(to)) return null;
  switch (e.type) {
    case 'takeBack': return 'the player taps Take back';
    case 'accept': return 'the player taps Accept [the asked goods go aside]';
    case 'refuse': return 'the player taps Refuse';
    case 'stop': return 'the GM taps Stop';
    case 'tried': return 'its letter leaves once';
    case 'taken': return !('closed' in from) && from.side === 'giver' && from.state.startsWith('posting') ? 'the room takes its offer, or a page shows it' : 'the room takes its letter';
    case 'unsent': return !('closed' in from) && from.state.endsWith('queued') ? 'its letter is let go before it left' : 'its letter is refused or let go after it left';
    case 'roomGone': return 'the room is gone';
    case 'end': return 'closed' in to ? `its end is read: ${to.closed}` : 'its end is read';
  }
}
const recordWalk = (start: RecordWorld) => () => bfs<RecordWorld, RecordEvent>([start], w => ('closed' in w ? [] : RECORD_EVENTS.map(event => ({ event, to: recordWalkStep(w, event) }))), recordKey);
const kindOf = (w: RecordWorld): string => ('closed' in w ? 'ended' : w.state);
const whereOf = (side: string, table: string): (readonly [string, string])[] => [
  ['The union', `\`OfferRecord\` (its ${side} arm) and its rows in \`src/core/trade/offer.ts\`; the save's \`settings.sync.offers\``],
  ['What changes it', `\`recordStep\` and its \`${table}\`; the taps \`offerPosted\`, \`offerAnswered\`, \`offerTakenBack\`, \`offerStopped\`; \`offersHeard\`, \`lettersKept\`, \`offersGone\`, \`offersSeen\``],
  ['Who calls it', 'The trade view (unit 4) for the taps; sync.ts (unit 2) for what the box heard, the fold of each page and a join\'s history, and the room gone; the store runs `lettersKept` after every step (unit 2)'],
  ['The test to copy', '`tests/offer.test.ts` ("every cell of the three records", the walk of two players and the GM); the walk\'s events are in `tests/models/trade-events.ts`'],
  ['The recipe', 'AGENTS.md, "A room message"; notes-5-trade.md 1.6 and 12.1'],
];
const recordNote = 'Its goods wait aside in the record from the tap\'s write until its phone reads the offer\'s one end: settled drops them and gains the other side\'s, every other close gives them back, in the write that ends the record, so a second read finds nothing to move. What the box heard of its current letter is stored in the row (never sent, sent once, taken): only a letter never sent is provably not in the room, so only it gives the goods back when let go.';

export const offerGiver = machine<RecordWorld, RecordEvent>({
  name: 'The giver\'s side of an offer',
  walked: `Every state reachable from an offer just posted, under the ${RECORD_EVENTS.length} events of tests/models/trade-events.ts, breadth first.`,
  walk: recordWalk(GIVER_START),
  kinds: [...GIVER_ROWS, 'ended'],
  kindsOf: w => [kindOf(w)],
  views: [{
    title: 'The giving phone\'s record of its offer',
    note: `${recordNote} Take back works whether or not the room has the offer: it posts the end under the offer's end id, which races any accept for the one end. Stranded (the room gone after a send) keeps the goods aside until the player takes them back after a window that says what the app cannot know.`,
    hides: 'Events a row does not take.',
    state: recordLabel,
    step: recordArrow,
  }],
  where: whereOf('giver', 'GIVER'),
});
export const offerTaker = machine<RecordWorld, RecordEvent>({
  name: 'The taker\'s side of an offer',
  walked: `Every state reachable from an offer just read, under the ${RECORD_EVENTS.length} events of tests/models/trade-events.ts, breadth first.`,
  walk: recordWalk(TAKER_START),
  kinds: [...TAKER_ROWS, 'ended'],
  kindsOf: w => [kindOf(w)],
  views: [{
    title: 'The taking phone\'s record of an offer to its hunter',
    note: `${recordNote} An accept cannot be taken back, since it may already be the end; the giver's Take back or the GM's Stop ends a stuck one. A taker that was only offered gains nothing from any end.`,
    hides: 'Events a row does not take.',
    state: recordLabel,
    step: recordArrow,
  }],
  where: whereOf('taker', 'TAKER'),
});
export const offerWatch = machine<RecordWorld, RecordEvent>({
  name: 'The GM\'s record of an offer',
  walked: `Every state reachable from an offer the GM's phone just read, under the ${RECORD_EVENTS.length} events of tests/models/trade-events.ts, breadth first.`,
  walk: recordWalk(WATCH_START),
  kinds: [...WATCH_ROWS, 'ended'],
  kindsOf: w => [kindOf(w)],
  views: [{
    title: 'The GM\'s phone\'s record of an open offer, to show and stop it',
    note: 'It holds no goods. A stop is the offer\'s end letter under the end id, so it races an accept and a take back; two GM phones\' stops are one. Each end it reads is a line of the session log.',
    hides: 'Events a row does not take.',
    state: recordLabel,
    step: recordArrow,
  }],
  where: whereOf('GM', 'WATCH'),
});
