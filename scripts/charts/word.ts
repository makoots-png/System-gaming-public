// The charts of a private word to the GM (src/core/sync/word.ts): the player's word from the tap to the answer's
// window, and the GM's phone's record of a word it heard, each walked with the real `wordStep`.
import { GM_STATES, MINE_SHOWN, shownOf, wordStep } from '../../src/core/sync/word.ts';
import type { GmState, GmWord, MineShown, MineWord, WordAnswer, WordEvent } from '../../src/core/sync/word.ts';
import type { Outbox } from '../../src/core/sync/outbox.ts';
import { parseEvent } from '../../src/core/protocol.ts';
import { bfs, machine } from '../statecharts.ts';

const ID = 'd-mira-m1aaaa', ROOM = 'ABCD23';
const ANSWER: WordAnswer = { id: 'd-gm-m1bbbb' as never, at: '2026-11-22T21:06:00.000Z', text: 'Yes.' };
/** The word's letter as the outbox holds it: queued (or on its way), refused by the room, or out of the box. */
type Letter = 'queued' | 'refused' | 'out';
type MineWorld = { readonly w: MineWord; readonly letter: Letter };
/** What moves a player's word: its letter taken or refused by the room, let go by the box, an answer, the window closed. */
type MineEvent = { readonly type: 'taken' | 'refused' | 'dropped' | 'answer' | 'read' };
const MINE_EVENTS: readonly MineEvent[] = [{ type: 'taken' }, { type: 'refused' }, { type: 'dropped' }, { type: 'answer' }, { type: 'read' }];
const letterEvent = parseEvent('word', { eid: ID, by: 'd-mira:h1', name: 'Mira', text: 'Hi' })!;
const boxOf = (l: Letter): Outbox => (l === 'out' ? [] : [{ id: ID, room: ROOM as never, letter: { kind: 'event', event: letterEvent }, key: null, ...(l === 'queued' ? { at: 'queued' as const } : { at: 'refused' as const, why: 'bad event' }) }]);
const WORD_EVENT: { readonly [K in 'answer' | 'read']: WordEvent } = { answer: { type: 'answer', answer: ANSWER }, read: { type: 'read' } };
function mineStep(s: MineWorld, e: MineEvent): MineWorld {
  if (e.type === 'refused' || e.type === 'dropped') return s.letter === 'queued' ? { ...s, letter: e.type === 'refused' ? 'refused' : 'out' } : s;
  if (e.type === 'taken') return s.letter === 'queued' ? { letter: 'out', w: wordStep(s.w, boxOf('queued'), { type: 'taken' }) } : s;
  return { ...s, w: wordStep(s.w, boxOf(s.letter), WORD_EVENT[e.type]) };
}
const MINE_START: MineWorld = { letter: 'queued', w: { side: 'mine', id: ID as never, room: ROOM as never, hid: 'h1' as never, at: '2026-11-22T21:04:00.000Z', text: 'Hi', state: { is: 'sent' } } };
const shown = (s: MineWorld): MineShown => shownOf(s.w, boxOf(s.letter));
const MINE_LABEL: { readonly [S in MineShown]: string } = {
  waiting: 'Waiting for the room (its letter in the outbox)',
  lost: 'Lost: the room refused it or the box let it go',
  landed: 'Sent: the room has it',
  answered: 'Answered: the window owed',
  read: 'Read: the window closed',
};
function mineArrow(e: MineEvent, from: MineWorld, to: MineWorld): string | null {
  if (shown(from) === shown(to)) return null;
  switch (e.type) {
    case 'taken': return 'the room takes its letter';
    case 'refused': return 'the room refuses its letter';
    case 'dropped': return 'the box lets its letter go';
    case 'answer': return 'the GM\'s answer lands';
    case 'read': return 'the player closes the answer\'s window';
  }
}

export const wordMine = machine<MineWorld, MineEvent>({
  name: 'A word to the GM',
  walked: `Every state reachable from a word just sent, under the ${MINE_EVENTS.length} events of this chart (the room takes or refuses its letter, the box lets it go, an answer, the window closed), breadth first.`,
  walk: () => bfs<MineWorld, MineEvent>([MINE_START], s => MINE_EVENTS.map(event => ({ event, to: mineStep(s, event) })), s => JSON.stringify([shown(s), s.letter])),
  kinds: MINE_SHOWN,
  kindsOf: s => [shown(s)],
  views: [{
    title: 'A player\'s word to the GM, on its phone, until the answer is read',
    note: 'Waiting and lost are read from the outbox (the letter queued or on its way; refused or let go), the rest are stored. The room taking the letter is heard in the write that takes it out of the box (sync.ts `wordTaken`). An answer lands once, by its id and only on a word not yet answered, so a second GM phone\'s answer or a replay adds nothing; an answer to a lost word lands too, since it proves the room had it. The answer\'s window is owed while the word is answered: src/views/words.js opens it on any change of the save, a reload too, and its close writes read.',
    hides: 'The letter\'s own sends and failed sends (they stay in Waiting for the room), and each event that does not apply.',
    state: s => MINE_LABEL[shown(s)],
    step: mineArrow,
  }],
  where: [
    ['The union', '`MineWord`, `MineStored`, `MineShown`, `WordEvent`, `MINE_SHOWN` and `WORD_EVENTS` in `src/core/sync/word.ts`; the list is the save\'s `settings.sync.words`'],
    ['What changes it', '`wordStep` and its `MINE` table; `wordSent`, `wordTaken`, `wordLanded`, `wordRead`'],
    ['Who calls it', '`src/views/words.js` (Send to the GM, the answer\'s window); `answered` in `src/edge/sync.ts` (`wordTaken`); the `wordBack` applier in `src/edge/room-events.ts` (`wordLanded`)'],
    ['The test to copy', '`tests/word.test.ts` ("every cell of the player\'s word and the GM\'s"), `tests/applied.test.ts` ("an answer lands once in the thread"), `tests/e2e/words.e2e.ts`'],
    ['The recipe', 'docs/guide/room-sync.md, "A room message"'],
  ],
});

/** What moves the GM's record: the GM opens or closes the section, or an answer is sent here or heard from another GM phone. */
type GmEvent = { readonly type: 'seen' | 'answer' };
const GM_EVENTS: readonly GmEvent[] = [{ type: 'seen' }, { type: 'answer' }];
const GM_START: GmWord = { side: 'gm', id: ID as never, room: ROOM as never, by: 'd-mira:h1' as never, name: 'Mira', at: '2026-11-22T21:04:00.000Z', text: 'Hi', state: { is: 'new' } };
const GM_LABEL: { readonly [S in GmState]: string } = { new: 'New: counted in the head\'s "1 new"', seen: 'Seen', answered: 'Answered: no Answer button' };

export const wordGm = machine<GmWord, GmEvent>({
  name: 'The GM\'s record of a word',
  walked: `Every state reachable from a word the GM's phone just heard, under the ${GM_EVENTS.length} events of this chart, breadth first.`,
  walk: () => bfs<GmWord, GmEvent>([GM_START], s => GM_EVENTS.map(event => ({ event, to: wordStep(s, [], event.type === 'seen' ? { type: 'seen' } : { type: 'answer', answer: ANSWER }) })), s => s.state.is),
  kinds: GM_STATES,
  kindsOf: s => [s.state.is],
  views: [{
    title: 'A word on the GM\'s phone, from heard to answered',
    note: 'Heard once by its id (`wordHeard` through `sync.once`), in the write of its session log line of kind `word`. Opening or closing the GM view\'s "Words from players" sees every new word of the room. An answer is the `wordBack` letter, the record and a log line of kind `answer` in one write (`wordAnswered`); another GM phone\'s answer heard from the room marks it answered too (`wordBackHeard`), so the word takes one answer.',
    hides: 'Each event that does not apply.',
    state: s => GM_LABEL[s.state.is],
    step: (e, from, to) => (from.state.is === to.state.is ? null : e.type === 'seen' ? 'the GM opens or closes the section' : 'the GM answers it (on this phone or another)'),
  }],
  where: [
    ['The union', '`GmWord`, `GmStored`, `GM_STATES` in `src/core/sync/word.ts`; the save\'s `settings.sync.words`'],
    ['What changes it', '`wordStep` and its `GM` table; `wordHeard`, `wordsSeen`, `wordAnswered`, `wordBackHeard`'],
    ['Who calls it', '`src/views/words.js`: its `sync:event` handler, the section\'s Answer and Send answer, and gm.js\'s section toggle (`words.seen`)'],
    ['The test to copy', '`tests/word.test.ts` ("the GM hears a word and answers it")'],
    ['The recipe', 'docs/guide/room-sync.md, "A room message"'],
  ],
});
