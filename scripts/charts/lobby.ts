// The charts of the Room view's lobby (src/core/sync/lobby.ts, audits SMX-sync-11 and SMX-views-10): a code check
// (`checkStep`) walked with one room code, and a GM's seat action on one key (`seatStep`) walked in two rooms.
import { LOBBY_CHECK_STATES, LOBBY_NOT_FOUND, LOBBY_SEAT_STATES, checkStep, seatStep } from '../../src/core/sync/lobby.ts';
import type { LobbyAnswer, LobbyCheck, LobbyCheckEvent, LobbySeatEvent, LobbySeats } from '../../src/core/sync/lobby.ts';
import { room } from '../../tests/fixtures/ids.ts';
import { bfs, machine } from '../statecharts.ts';

const A = room('ABC234'), B = room('XYZ789');
const FOUND: LobbyAnswer = { ok: true, exists: true, gm: false };
const NO_SERVER: LobbyAnswer = { ok: false };

/** Every event of a check on code A. */
const CHECK_WALK: readonly LobbyCheckEvent[] = [
  { type: 'typed', code: A }, { type: 'typed', code: null }, { type: 'paused', code: A }, { type: 'ask', code: A },
  { type: 'answered', code: A, answer: FOUND }, { type: 'answered', code: A, answer: LOBBY_NOT_FOUND }, { type: 'answered', code: A, answer: NO_SERVER },
  { type: 'notFound', code: A }, { type: 'cancel' }, { type: 'reset' }, { type: 'serverBack' },
];

function checkWords(s: LobbyCheck): string {
  switch (s.at) {
    case 'idle': return 'No line';
    case 'waiting': return 'Typed, the pause running';
    case 'asking': return 'Checking...';
    case 'known': return s.answer.ok !== true ? 'The server did not answer' : s.answer.exists ? 'The room is there' : 'No such room';
  }
}
function checkArrow(e: LobbyCheckEvent): string | null {
  switch (e.type) {
    case 'typed': return e.code ? 'a whole code is typed' : null;
    case 'paused': return 'typing stops for the pause';
    case 'ask': return 'the page opens on an invite link';
    case 'answered': return e.answer.ok !== true ? 'the server does not answer' : e.answer.exists ? 'the server finds the room' : 'the server finds no room';
    case 'notFound': return 'a join is refused as no such room';
    case 'cancel': return 'Join, Create or Rejoin is tapped, or the room changes';
    case 'reset': return null;
    case 'serverBack': return 'the server answers again';
  }
}

export const lobbyCheck = machine<LobbyCheck, LobbyCheckEvent>({
  name: 'A code check in the Room view',
  walked: `Every state reachable from no code, under the ${CHECK_WALK.length} events of a check on one code, breadth first.`,
  walk: () => bfs<LobbyCheck, LobbyCheckEvent>([{ at: 'idle' }], s => CHECK_WALK.flatMap(event => { const to = checkStep(s, event).state; return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: LOBBY_CHECK_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'The line under a room code',
    note: 'Two checks run this machine: the code typed under Join a room and the code of an invite link. The typed code is asked after a pause (`LOBBY_PAUSE_MS`), the invite\'s at once. A pause\'s end or an answer for a code other than the one waited on or asked is late and changes nothing; a new code typed starts its own pause. The invite\'s check is asked again when the server answers only while that invite is still pending. What the server said stays until a new code, a join or a dropped invite.',
    hides: 'The field cut to less than a code, and a join made or the invite dropped: each goes back to no line from wherever it is.',
    state: checkWords,
    step: checkArrow,
  }],
  where: [
    ['The union', '`LobbyCheck`, `LobbyCheckEvent`, `LobbyCheckEffect`, `LOBBY_CHECK_STATES` and `LOBBY_CHECK_EVENTS` in `src/core/sync/lobby.ts`'],
    ['What changes it', '`checkStep(check, event)` and its `CHECK` table, through `lobbyStep` (the join field\'s and the invite\'s check in one `Lobby`)'],
    ['Who calls it', '`src/views/room.js`, which keeps the one `lobbyNow`, moves it only through `lobbyStep` and carries out its effects (the pause\'s one timer, the question to `sync.check`)'],
    ['The test to copy', '`tests/lobby.test.ts`'],
    ['The recipe', 'docs/guide/room-sync.md, the lobby\'s row'],
  ],
});

/** Every event on one key's seat in rooms A and B. */
const SEAT_WALK: readonly LobbySeatEvent[] = [
  ...(['remove', 'release'] as const).map(act => ({ type: 'seatTapped', act, key: 'k1', name: 'Jin', room: A }) as const),
  { type: 'confirmed', key: 'k1', room: A, yes: true },
  { type: 'confirmed', key: 'k1', room: A, yes: false },
  ...(['remove', 'release'] as const).map(act => ({ type: 'seatAnswered', act, key: 'k1', room: A, call: { ok: true, data: null } }) as const),
  { type: 'room', code: A },
  { type: 'room', code: B },
];

function seatWords(s: LobbySeats): string {
  const a = s[0];
  if (!a) return 'No action out';
  return a.at === 'confirming' ? 'Remove\'s confirm window open' : 'Sent, its buttons waiting';
}
function seatArrow(e: LobbySeatEvent): string {
  switch (e.type) {
    case 'seatTapped': return e.act === 'remove' ? 'the GM taps Remove' : 'the GM taps Release or Allow back';
    case 'confirmed': return e.yes ? 'the GM confirms' : 'the GM cancels';
    case 'seatAnswered': return 'the server answers (the GM is told)';
    case 'room': return 'the phone\'s room changes';
  }
}

export const lobbySeat = machine<LobbySeats, LobbySeatEvent>({
  name: 'A GM\'s seat action',
  walked: `Every state of one key's seat reachable from none out, under the ${SEAT_WALK.length} events of the seat in its room and a room change, breadth first.`,
  walk: () => bfs<LobbySeats, LobbySeatEvent>([[]], s => SEAT_WALK.flatMap(event => { const to = seatStep(s, event).state; return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: LOBBY_SEAT_STATES,
  kindsOf: s => [s[0]?.at ?? 'none'],
  views: [{
    title: 'Remove, Release or Allow back on one seat',
    note: 'One action a key and room is out at a time: a second tap while one is out sends nothing. An action is tied to the room it was tapped in, so a room change drops it, and a confirm or an answer that comes back for it then does nothing (a Remove confirmed after the room changed removes nobody in the new room). A Remove the server took also takes the hunter out of the fight.',
    hides: '',
    state: seatWords,
    step: seatArrow,
  }],
  where: [
    ['The union', '`LobbySeat`, `LobbySeats`, `LobbySeatEvent`, `LobbySeatEffect`, `LOBBY_SEAT_STATES` and `LOBBY_SEAT_EVENTS` in `src/core/sync/lobby.ts`'],
    ['What changes it', '`seatStep(seats, event)`, through `lobbyStep`; `seatBusy` says whether a key\'s buttons wait'],
    ['Who calls it', '`src/views/room.js` (the seat buttons, the confirm window, the server\'s answer, `sync:room`)'],
    ['The test to copy', '`tests/lobby.test.ts`'],
    ['The recipe', 'docs/guide/room-sync.md, the lobby\'s row'],
  ],
});
