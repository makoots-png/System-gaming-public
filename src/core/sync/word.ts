// word.ts: a player's private word to the GM and the GM's answer (notes-5-trade.md section 4). Pure; the save holds
// this phone's words (`settings.sync.words`): on a player's phone its own (side `mine`), on the GM's phone each it heard
// (side `gm`). The room carries them as the sealed messages `word` and `wordBack` (protocol.ts), so no other player's
// phone ever gets either.
//
// One word's life is a machine, a table for each side with every cell (docs/state-machines.md, "A word to the GM").
// The player's: sent (its letter in the outbox), landed (the room took it), answered (the GM's answer landed, its window
// still owed), read (the player closed the answer's window). A sent word whose letter the box no longer holds on its
// way reads as lost, from the box itself (`shownOf`), as an ask does (sync/asked.ts). The GM's: new, seen (the GM opened
// or closed its section), answered. A word takes one answer: a second (another GM phone's, a replay) lands nothing.
//
// Delivery is the outbox's: `wordSent` and `wordAnswered` post the letter in the write of the tap. sync.ts hears the room
// take a player's letter (`wordTaken`) in the write that takes it out of the box.

import { WORD_MAX, newEvent } from '../protocol.ts';
import type { EventStamp, WordBackPayload, WordPayload } from '../protocol.ts';
import { parseEventId, parseRoomCode, parseSaveId, parseSheetKey, sheetKeyOf } from '../ids.ts';
import type { EventId, HunterId, RoomCode, SheetKey } from '../ids.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { atOutbox, post } from './outbox.ts';
import type { Outbox } from './outbox.ts';
import { told } from '../session-log.ts';
import type { Stamp } from '../session-log.ts';
import { timeOf } from '../day.ts';
import type { Save } from '../save.ts';

/** The GM's answer to a word: its event id, when this phone wrote or read it, its text. */
export type WordAnswer = { readonly id: EventId; readonly at: string; readonly text: string };
/** What a player's phone stores of its word: sent, landed (the room took it), answered (window owed), read. */
export type MineStored = { readonly is: 'sent' } | { readonly is: 'landed' } | { readonly is: 'answered'; readonly answer: WordAnswer } | { readonly is: 'read'; readonly answer: WordAnswer };
/** What the GM's phone stores of a word it heard: new, seen, answered. */
export type GmStored = { readonly is: 'new' } | { readonly is: 'seen' } | { readonly is: 'answered'; readonly answer: WordAnswer };
type WordBase = { readonly id: EventId; readonly room: RoomCode; readonly at: string; readonly text: string };
/** A player's own word, by hunter `hid` of this phone. */
export type MineWord = WordBase & { readonly side: 'mine'; readonly hid: HunterId; readonly state: MineStored };
/** A word the GM's phone heard from the room's hunter `by` (`name`). */
export type GmWord = WordBase & { readonly side: 'gm'; readonly by: SheetKey; readonly name: string; readonly state: GmStored };
/** A word in this phone's threads; its id is the `word` message's event id. */
export type Word = MineWord | GmWord;

/** What the player sees of its word: waiting for the room (letter queued or on its way), lost (refused or let go), and the stored three. */
export const MINE_SHOWN = ['waiting', 'lost', 'landed', 'answered', 'read'] as const;
export type MineShown = (typeof MINE_SHOWN)[number];
export const GM_STATES = ['new', 'seen', 'answered'] as const satisfies readonly GmStored['is'][];
export type GmState = (typeof GM_STATES)[number];
export const WORD_EVENTS = ['taken', 'answer', 'read', 'seen'] as const;
/**
 * What happens to a word: the room took the player's letter (sync.ts); an answer landed or was sent (`answer`); the
 * player closed the answer's window (`read`); the GM opened or closed the section (`seen`).
 */
export type WordEvent = { readonly type: 'taken' } | { readonly type: 'answer'; readonly answer: WordAnswer } | { readonly type: 'read' } | { readonly type: 'seen' };

/** The player's word after each event, by what the player sees of it; null where the event does not apply. */
export const MINE: { readonly [S in MineShown]: { readonly [E in WordEvent['type']]: Exclude<MineStored['is'], 'sent'> | null } } = {
  waiting: { taken: 'landed', answer: 'answered', read: null, seen: null },
  // a letter let go after it left may still be in the room: an answer to it proves it was
  lost: { taken: null, answer: 'answered', read: null, seen: null },
  landed: { taken: null, answer: 'answered', read: null, seen: null },
  answered: { taken: null, answer: null, read: 'read', seen: null },
  read: { taken: null, answer: null, read: null, seen: null },
};
/** The GM's word after each event; null where the event does not apply. */
export const GM: { readonly [S in GmState]: { readonly [E in WordEvent['type']]: Exclude<GmState, 'new'> | null } } = {
  new: { taken: null, answer: 'answered', read: null, seen: 'seen' },
  seen: { taken: null, answer: 'answered', read: null, seen: null },
  answered: { taken: null, answer: null, read: null, seen: null },
};

/** What the player sees of `w` with the outbox `box`: a sent word whose letter is no longer queued or on its way is lost. */
export function shownOf(w: MineWord, box: Outbox): MineShown {
  if (w.state.is !== 'sent') return w.state.is;
  const letter = box.find(e => e.id === w.id);
  return letter && (letter.at === 'queued' || letter.at === 'sending') ? 'waiting' : 'lost';
}
/** `w` after `e`: the next word, or `w` itself where the event does not apply. */
export function wordStep<W extends Word>(w: W, box: Outbox, e: WordEvent): W {
  if (w.side === 'mine') {
    const to = MINE[shownOf(w, box)][e.type];
    if (to === null) return w;
    const state: MineStored | null = to === 'landed' ? { is: 'landed' } : to === 'answered' ? (e.type === 'answer' ? { is: 'answered', answer: e.answer } : null)
      : w.state.is === 'answered' ? { is: 'read', answer: w.state.answer } : null;
    return state ? { ...w, state } : w;
  }
  const to = GM[w.state.is][e.type];
  if (to === null) return w;
  const state: GmStored | null = to === 'seen' ? { is: 'seen' } : e.type === 'answer' ? { is: 'answered', answer: e.answer } : null;
  return state ? { ...w, state } : w;
}

/** The newest words one thread (a hunter in a room) keeps: a session's talk, a screen of it. */
export const WORD_THREAD = 20;
/** The most words a phone keeps across its threads: five threads full, a party's; past it the oldest goes. */
export const WORDS_KEPT = 100;
/** The words the save holds, oldest first. */
export const wordsOf = (s: Pick<Save, 'settings'>): readonly Word[] => s.settings.sync.words ?? [];
const withWords = <S extends Pick<Save, 'settings'>>(s: S, words: readonly Word[]): S =>
  ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, words: [...words] } } });
/** Whose thread a word is in: its room and its hunter. */
const threadOf = (w: Word): string => `${w.room} ${w.side === 'mine' ? `h ${w.hid}` : `k ${w.by}`}`;
/** `words` with `w` last: one per id; past `WORD_THREAD` its thread's oldest goes, past `WORDS_KEPT` the oldest. */
function added(words: readonly Word[], w: Word): readonly Word[] {
  if (words.some(x => x.id === w.id)) return words;
  const thread = threadOf(w), mine = words.filter(x => threadOf(x) === thread), over = new Set(mine.slice(0, Math.max(0, mine.length + 1 - WORD_THREAD)));
  const next = [...words.filter(x => !over.has(x)), w];
  return next.slice(Math.max(0, next.length - WORDS_KEPT));
}
/** The save with word `id` of side `side` after `e`; refused (`no-word`) when no such word took it. */
function stepWord<S extends Pick<Save, 'settings'>>(s: S, id: string, side: Word['side'], e: WordEvent): S | Refused<'no-word'> {
  const words = wordsOf(s), box = s.settings.sync.outbox ?? [], at = words.findIndex(w => w.id === id && w.side === side);
  const w = words[at];
  if (!w) return refuse('no-word');
  const next = wordStep(w, box, e);
  return next === w ? refuse('no-word') : withWords(s, words.map((x, i) => (i === at ? next : x)));
}

/** The thread of hunter `hid` of this phone in room `room`, oldest first: at most `WORD_THREAD` words. */
export const mineThread = (s: Pick<Save, 'settings'>, room: RoomCode, hid: string): MineWord[] =>
  wordsOf(s).flatMap(w => (w.side === 'mine' && w.room === room && w.hid === hid ? [w] : [])).slice(-WORD_THREAD);
/** The words the GM's phone heard in room `room`, newest first. */
export const gmWords = (s: Pick<Save, 'settings'>, room: RoomCode): GmWord[] =>
  wordsOf(s).flatMap(w => (w.side === 'gm' && w.room === room ? [w] : [])).reverse();
/** The player's first word whose answer's window is owed (answered, not read), on any hunter or room of this phone. */
export const owedAnswer = (s: Pick<Save, 'settings'>): MineWord | null =>
  wordsOf(s).find((w): w is MineWord => w.side === 'mine' && w.state.is === 'answered') ?? null;

// ── the player's phone ──
/** Why a word was not sent: no room, no such hunter, not the hunter this phone plays in the room, nothing written. */
export type WordRefusal = 'no-room' | 'no-hunter' | 'not-played' | 'empty';
/**
 * Hunter `hid` sends the GM `text` (trimmed, cut at `WORD_MAX`): the `word` letter in the outbox and the word in the
 * thread, one write.
 */
export function wordSent(save: Save, a: { readonly hid: HunterId; readonly text: string; readonly at: string; readonly stamp: EventStamp }): Save | Refused<WordRefusal> {
  const room = save.settings.sync.room, h = save.hunters.find(x => x.id === a.hid), text = a.text.trim().slice(0, WORD_MAX);
  if (!room) return refuse('no-room');
  if (!h) return refuse('no-hunter');
  if (save.settings.sync.boundHunterId !== a.hid) return refuse('not-played');
  const ev = text ? newEvent('word', { by: sheetKeyOf(save.settings.deviceId, a.hid), name: h.name, text }, a.stamp) : null;
  if (!ev || ev.type !== 'word') return refuse('empty');
  const s = atOutbox(box => post(box, room, { kind: 'event', event: ev }).box)(save);
  return withWords(s, added(wordsOf(s), { side: 'mine', id: ev.payload.eid, room, hid: a.hid, at: a.at, text: ev.payload.text, state: { is: 'sent' } }));
}
/** The room took letter `id` (sync.ts, in the write that steps it `sent`). A letter that is no word changes nothing. */
export const wordTaken = <S extends Pick<Save, 'settings'>>(s: S, id: string): S => { const r = stepWord(s, id, 'mine', { type: 'taken' }); return 'ok' in r ? s : r; };
/**
 * The GM's answer `p` landed at `at`: its word is answered and the answer's window owed. Refused (`no-word`) when no word
 * of this phone waits for an answer to it, so a second answer lands nothing.
 */
export const wordLanded = (s: Save, p: WordBackPayload, at: string): Save | Refused<'no-word'> =>
  stepWord(s, p.re, 'mine', { type: 'answer', answer: { id: p.eid, at, text: p.text } });
/** The player closed the window of word `id`'s answer. */
export const wordRead = (s: Save, id: string): Save | Refused<'no-word'> => stepWord(s, id, 'mine', { type: 'read' });

// ── the GM's phone ──
/**
 * Word `p`, heard in room `room` (sync.ts's `sync:event`, written once by its id): new in the GM's list, and a line of
 * kind `word` in the session log, one write.
 */
export function wordHeard(s: Save, p: WordPayload, ctx: { readonly room: RoomCode; readonly log: Stamp }): Save {
  if (wordsOf(s).some(w => w.id === p.eid)) return s;
  const name = p.name || 'A hunter';
  const w: GmWord = { side: 'gm', id: p.eid, room: ctx.room, at: ctx.log.at, text: p.text, by: p.by, name, state: { is: 'new' } };
  return told(withWords(s, added(wordsOf(s), w)), ctx.log, { kind: 'word', hunterId: null, title: WORD_WORDS.gm.logTitle, text: WORD_WORDS.gm.log(name, p.text) });
}
/** Why the GM's answer was not sent: no such word, one answered already, nothing written, not in the word's room. */
export type AnswerRefusal = 'no-word' | 'answered' | 'empty' | 'no-room';
/**
 * The GM answers word `id` with `text` (trimmed, cut at `WORD_MAX`): the `wordBack` letter in the outbox, the word
 * answered and a line of kind `answer` in the session log, one write.
 */
export function wordAnswered(s: Save, id: string, text: string, ctx: { readonly stamp: EventStamp; readonly log: Stamp }): Save | Refused<AnswerRefusal> {
  const w = wordsOf(s).find((x): x is GmWord => x.side === 'gm' && x.id === id), said = text.trim().slice(0, WORD_MAX);
  if (!w) return refuse('no-word');
  if (w.state.is === 'answered') return refuse('answered');
  if (s.settings.sync.room !== w.room) return refuse('no-room');
  const ev = said ? newEvent('wordBack', { to: [w.by], re: w.id, text: said }, ctx.stamp) : null;
  if (!ev || ev.type !== 'wordBack') return refuse('empty');
  const posted = atOutbox(box => post(box, w.room, { kind: 'event', event: ev }).box)(s);
  const r = stepWord(posted, w.id, 'gm', { type: 'answer', answer: { id: ev.payload.eid, at: ctx.log.at, text: said } });
  return 'ok' in r ? r : told(r, ctx.log, { kind: 'answer', hunterId: null, title: WORD_WORDS.gm.answerTitle, text: WORD_WORDS.gm.answerLog(w.name, said) });
}
/** Another GM phone's answer `p` heard at `at`: the word is answered here too, so this phone does not answer it again. */
export const wordBackHeard = (s: Save, p: WordBackPayload, at: string): Save => {
  const r = stepWord(s, p.re, 'gm', { type: 'answer', answer: { id: p.eid, at, text: p.text } });
  return 'ok' in r ? s : r;
};
/** The GM opened or closed the section: each new word of room `room` is seen. */
export const wordsSeen = (s: Save, room: RoomCode): Save => {
  const box = s.settings.sync.outbox ?? [], words = wordsOf(s);
  const next = words.map(w => (w.side === 'gm' && w.room === room ? wordStep(w, box, { type: 'seen' }) : w));
  return next.some((w, i) => w !== words[i]) ? withWords(s, next) : s;
};
/** How many words of room `room` the GM has not seen. */
export const unseenWords = (s: Pick<Save, 'settings'>, room: RoomCode): number => wordsOf(s).filter(w => w.side === 'gm' && w.room === room && w.state.is === 'new').length;

// ── words ──
/** Every line the player and the GM read of a word (notes-5-trade.md section 7). */
export const WORD_WORDS = {
  title: 'Word to the GM',
  privacy: 'Only the GM sees these. The room\'s server stores them.',
  field: 'Your word',
  send: 'Send to the GM',
  none: 'Nothing sent yet.',
  you: (time: string): string => `You, ${time}`,
  gmAt: (time: string): string => `GM, ${time}`,
  shown: { waiting: 'Waiting for the room.', lost: 'The room did not take this word.', landed: 'Sent.', answered: '', read: '' } satisfies { readonly [S in MineShown]: string },
  refusals: {
    'no-room': 'Words to the GM need a room.', empty: 'Write something first.', 'no-hunter': 'This hunter is no longer on this phone.',
    'not-played': 'Only the hunter you play in this room can send a word.',
  } satisfies { readonly [W in WordRefusal]: string },
  windowTag: '! GM',
  windowTitle: 'FROM THE GM',
  gm: {
    tag: 'Word',
    title: 'Words from players',
    summary: (n: number): string => (n ? `${n} new` : ''),
    line: (name: string, time: string): string => `${name}, ${time}`,
    answer: 'Answer',
    field: 'Your answer',
    send: 'Send answer',
    sent: (name: string): string => `Sent to ${name}.`,
    none: 'No words yet.',
    notify: (name: string): string => `${name} sent you a word.`,
    notifyBody: 'Open the GM view to read it.',
    logTitle: 'Word to the GM',
    log: (name: string, text: string): string => `${name}: ${text}`,
    answerTitle: 'Answer to a word',
    answerLog: (name: string, text: string): string => `You to ${name}: ${text}`,
    refusals: {
      'no-word': 'This word is no longer on this phone.', answered: 'This word has an answer already.', empty: 'Write something first.',
      'no-room': 'Answers go in the room the word came from. Go back to that room first.',
    } satisfies { readonly [W in AnswerRefusal]: string },
  },
} as const;

// ── the save's reader ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const said = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, WORD_MAX) : null);
function answerOf(v: unknown): WordAnswer | null {
  if (!isObj(v)) return null;
  const id = parseEventId(v.id), at = timeOf(v.at), text = said(v.text);
  return id && at && text ? { id, at, text } : null;
}
function mineState(v: Rec): MineStored | null {
  if (v.is === 'sent' || v.is === 'landed') return { is: v.is };
  const answer = answerOf(v.answer);
  return answer && (v.is === 'answered' || v.is === 'read') ? { is: v.is, answer } : null;
}
function gmState(v: Rec): GmStored | null {
  if (v.is === 'new' || v.is === 'seen') return { is: v.is };
  const answer = answerOf(v.answer);
  return answer && v.is === 'answered' ? { is: 'answered', answer } : null;
}
/** The stored words, each read whole or dropped; one per id, at most `WORDS_KEPT`, the newest kept. */
export function parseWords(v: unknown): Word[] {
  const out: Word[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (!isObj(raw) || !isObj(raw.state)) continue;
    const id = parseEventId(raw.id), room = parseRoomCode(raw.room), at = timeOf(raw.at), text = said(raw.text);
    if (!id || !room || !at || !text || out.some(w => w.id === id)) continue;
    if (raw.side === 'mine') {
      const hid = parseSaveId<'h'>(raw.hid), state = mineState(raw.state);
      if (hid && state) out.push({ side: 'mine', id, room, at, text, hid, state });
    } else if (raw.side === 'gm') {
      const by = parseSheetKey(raw.by), state = gmState(raw.state);
      if (by && state) out.push({ side: 'gm', id, room, at, text, by, name: typeof raw.name === 'string' ? raw.name.slice(0, 60) : '', state });
    }
  }
  return out.slice(Math.max(0, out.length - WORDS_KEPT));
}
