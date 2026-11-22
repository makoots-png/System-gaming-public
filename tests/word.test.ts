// A private word to the GM (src/core/sync/word.ts, notes-5-trade.md section 4): every cell of the player's and the GM's
// machine, the taps that write a letter and its record in one write, an answer that lands once, and the save's reader.
import { describe, expect, test } from 'bun:test';
import { freshSave } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { RULES } from '../src/core/rules.ts';
import { WORD_MAX } from '../src/core/protocol.ts';
import type { RoomEvent, WordBackPayload, WordPayload } from '../src/core/protocol.ts';
import { step } from '../src/core/sync/outbox.ts';
import type { Outbox } from '../src/core/sync/outbox.ts';
import {
  GM, GM_STATES, MINE, MINE_SHOWN, WORDS_KEPT, WORD_EVENTS, WORD_THREAD, WORD_WORDS, gmWords, mineThread, owedAnswer, parseWords, shownOf, unseenWords,
  wordAnswered, wordBackHeard, wordHeard, wordLanded, wordRead, wordSent, wordStep, wordTaken, wordsOf, wordsSeen,
} from '../src/core/sync/word.ts';
import type { GmWord, MineWord, WordEvent } from '../src/core/sync/word.ts';
import { dev, room } from './fixtures/ids.ts';

const AT = '2026-11-22T21:04:00.000Z', T = Date.parse(AT), ROOM = room('ABCD23'), LOG = { at: AT, cap: RULES.logCap };
const env = (d: string) => ({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev(d) });
/** Mira's phone, playing her in room ABCD23. */
function mira(): Save {
  const s = freshSave(env('d-mira'), { onboarded: true }), h = s.hunters[0]!;
  return { ...s, hunters: [{ ...h, name: 'Mira' }], settings: { ...s.settings, sync: { ...s.settings.sync, room: ROOM, boundHunterId: h.id } } };
}
/** The GM's phone in room ABCD23. */
const gmPhone = (): Save => { const s = freshSave(env('d-gm'), { onboarded: true }); return { ...s, settings: { ...s.settings, sync: { ...s.settings.sync, room: ROOM } } }; };
const ok = <T>(r: T): Exclude<T, Refused<string>> => { if (isRefused(r as never)) throw new Error(`refused: ${(r as { why: string }).why}`); return r as Exclude<T, Refused<string>>; };
const letters = (s: Save): RoomEvent[] => (s.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' ? [e.letter.event] : []));
const withBox = (s: Save, f: (b: Outbox) => Outbox): Save => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, outbox: f(s.settings.sync.outbox ?? []) } } });
const stamp = (s: Save, n: number) => ({ device: s.settings.deviceId, now: T + n, rand: 0.5 });
/** Mira sends `text`: her save and the word as the GM's phone reads it. */
function send(s: Save, text: string, n = 1): { save: Save; p: WordPayload } {
  const save = ok(wordSent(s, { hid: s.hunters[0]!.id, text, at: AT, stamp: stamp(s, n) })), ev = letters(save).at(-1)!;
  if (ev.type !== 'word') throw new Error('no word posted');
  return { save, p: ev.payload };
}
const mine = (s: Save): MineWord[] => wordsOf(s).filter((w): w is MineWord => w.side === 'mine');
const shown = (s: Save) => mine(s).map(w => shownOf(w, s.settings.sync.outbox ?? []));
const ANSWER = { id: 'd-gm-mabc1zzzz' as never, at: AT, text: 'Yes.' };

describe('every cell of the player\'s word and the GM\'s', () => {
  const EVENT: { readonly [E in WordEvent['type']]: WordEvent } = { taken: { type: 'taken' }, answer: { type: 'answer', answer: ANSWER }, read: { type: 'read' }, seen: { type: 'seen' } };
  test('the player\'s: the room takes a waiting word; any answer lands on a word not yet answered; only an answered word is read; the GM\'s seen is not the player\'s', () => {
    expect(MINE).toEqual({
      waiting: { taken: 'landed', answer: 'answered', read: null, seen: null },
      lost: { taken: null, answer: 'answered', read: null, seen: null },
      landed: { taken: null, answer: 'answered', read: null, seen: null },
      answered: { taken: null, answer: null, read: 'read', seen: null },
      read: { taken: null, answer: null, read: null, seen: null },
    });
    expect(Object.keys(MINE)).toEqual([...MINE_SHOWN]);
  });
  test('the GM\'s: a new word is seen or answered; a seen one answered; an answered one takes nothing more', () => {
    expect(GM).toEqual({
      new: { taken: null, answer: 'answered', read: null, seen: 'seen' },
      seen: { taken: null, answer: 'answered', read: null, seen: null },
      answered: { taken: null, answer: null, read: null, seen: null },
    });
    expect(Object.keys(GM)).toEqual([...GM_STATES]);
  });
  test('wordStep follows each cell, keeps the answer it is given and changes nothing where a cell is empty', () => {
    const base = { id: 'd-mira-m1aaaa' as never, room: ROOM, at: AT, text: 'Hi' };
    const MINE_AT: { readonly [S in Exclude<(typeof MINE_SHOWN)[number], 'waiting' | 'lost'>]: MineWord['state'] } = { landed: { is: 'landed' }, answered: { is: 'answered', answer: ANSWER }, read: { is: 'read', answer: ANSWER } };
    for (const [is, state] of Object.entries(MINE_AT)) {
      const w: MineWord = { ...base, side: 'mine', hid: 'h1' as never, state };
      for (const e of WORD_EVENTS) {
        const to = wordStep(w, [], EVENT[e]), cell = MINE[is as keyof typeof MINE_AT][e];
        expect(to.state.is, `${is} + ${e}`).toBe(cell ?? state.is);
        if (cell === 'answered' || cell === 'read') expect('answer' in to.state && to.state.answer).toEqual(ANSWER);
      }
    }
    for (const is of GM_STATES) {
      const w: GmWord = { ...base, side: 'gm', by: 'd-mira:h1' as never, name: 'Mira', state: is === 'answered' ? { is, answer: ANSWER } : { is } };
      for (const e of WORD_EVENTS) expect(wordStep(w, [], EVENT[e]).state.is, `${is} + ${e}`).toBe(GM[is][e] ?? is);
    }
  });
});

describe('a player sends the GM a word', () => {
  test('the letter and the word in the thread are one write; the word waits for the room while its letter is queued or on its way', () => {
    const { save, p } = send(mira(), '  Can my shadow scout the gate?  ');
    expect(p).toMatchObject({ by: `d-mira:${save.hunters[0]!.id}`, name: 'Mira', text: 'Can my shadow scout the gate?' });
    expect(mineThread(save, ROOM, save.hunters[0]!.id).map(w => [w.id, w.text, w.state.is])).toEqual([[p.eid, 'Can my shadow scout the gate?', 'sent']]);
    expect(shown(save)).toEqual(['waiting']);
    expect(shown(withBox(save, b => step(b, p.eid, { type: 'send' })))).toEqual(['waiting']);
  });
  test('landed once the room took it, in the write that takes the letter out of the box; lost when the room refused it or the box let it go', () => {
    const { save, p } = send(mira(), 'Hello');
    const landed = wordTaken(withBox(save, b => step(b, p.eid, { type: 'sent' })), p.eid);
    expect(shown(landed)).toEqual(['landed']);
    expect(WORD_WORDS.shown[shown(landed)[0]!]).toBe('Sent.');
    expect(shown(withBox(save, b => step(b, p.eid, { type: 'refused', why: 'bad event' })))).toEqual(['lost']);
    expect(shown(withBox(save, b => step(b, p.eid, { type: 'drop' })))).toEqual(['lost']);
    expect(wordTaken(save, 'd-other-m1zzzz')).toBe(save);
  });
  test('refused with nothing written, outside a room, or for a hunter this phone does not play there; the text is cut at WORD_MAX', () => {
    const s = mira(), hid = s.hunters[0]!.id, at = { at: AT, stamp: stamp(s, 1) };
    expect([wordSent(s, { hid, text: '   ', ...at }), wordSent({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, room: null } } }, { hid, text: 'Hi', ...at }),
      wordSent({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, boundHunterId: 'h99' as never } } }, { hid, text: 'Hi', ...at }), wordSent(s, { hid: 'h77' as never, text: 'Hi', ...at })])
      .toEqual([{ ok: false, why: 'empty' }, { ok: false, why: 'no-room' }, { ok: false, why: 'not-played' }, { ok: false, why: 'no-hunter' }]);
    expect(send(s, 'z'.repeat(WORD_MAX + 9)).p.text).toHaveLength(WORD_MAX);
  });
  test('a thread keeps its newest WORD_THREAD words, and the phone its newest WORDS_KEPT', () => {
    let s = mira();
    for (let n = 0; n < WORD_THREAD + 3; n++) s = send(s, `w${n}`, n).save;
    expect(mineThread(s, ROOM, s.hunters[0]!.id).map(w => w.text)).toEqual(Array.from({ length: WORD_THREAD }, (_, i) => `w${i + 3}`));
    expect(wordsOf(s)).toHaveLength(WORD_THREAD);
    expect(WORDS_KEPT).toBe(5 * WORD_THREAD);
  });
});

describe('the GM hears a word and answers it', () => {
  const heard = (p: WordPayload) => wordHeard(gmPhone(), p, { room: ROOM, log: LOG });
  test('a word heard is new in the GM\'s list and a line of kind word in the session log, one write; heard again it changes nothing', () => {
    const { p } = send(mira(), 'Can my shadow scout the gate?'), s = heard(p);
    expect(gmWords(s, ROOM).map(w => [w.name, w.text, w.state.is])).toEqual([['Mira', 'Can my shadow scout the gate?', 'new']]);
    expect(s.log.slice(0, 1).map(l => [l.kind, l.text])).toEqual([['word', 'Mira: Can my shadow scout the gate?']]);
    expect([unseenWords(s, ROOM), WORD_WORDS.gm.summary(unseenWords(s, ROOM))]).toEqual([1, '1 new']);
    expect(wordHeard(s, p, { room: ROOM, log: LOG })).toBe(s);
    const seen = wordsSeen(s, ROOM);
    expect([unseenWords(seen, ROOM), gmWords(seen, ROOM)[0]!.state.is, wordsSeen(seen, ROOM)]).toEqual([0, 'seen', seen]);
  });
  test('the answer is the wordBack letter, the word answered and a line of kind answer, one write; a second answer is refused', () => {
    const { p } = send(mira(), 'Can my shadow scout the gate?'), s = heard(p);
    const a = ok(wordAnswered(s, p.eid, ' Yes. Roll Perception. ', { stamp: stamp(s, 9), log: LOG }));
    const back = letters(a).at(-1)!;
    expect(back.type === 'wordBack' && back.payload).toMatchObject({ to: [p.by], re: p.eid, text: 'Yes. Roll Perception.' });
    expect(gmWords(a, ROOM)[0]!.state).toEqual({ is: 'answered', answer: { id: back.payload.eid, at: AT, text: 'Yes. Roll Perception.' } });
    expect(a.log[0]!).toMatchObject({ kind: 'answer', text: 'You to Mira: Yes. Roll Perception.' });
    expect([wordAnswered(a, p.eid, 'Again', { stamp: stamp(a, 10), log: LOG }), wordAnswered(s, p.eid, '  ', { stamp: stamp(s, 10), log: LOG }), wordAnswered(s, 'd-x-m1zzzz', 'Hi', { stamp: stamp(s, 10), log: LOG })])
      .toEqual([{ ok: false, why: 'answered' }, { ok: false, why: 'empty' }, { ok: false, why: 'no-word' }]);
    const away = { ...s, settings: { ...s.settings, sync: { ...s.settings.sync, room: room('WXYZ45') } } };
    expect(wordAnswered(away, p.eid, 'Hi', { stamp: stamp(s, 10), log: LOG })).toEqual({ ok: false, why: 'no-room' });
  });
  test('another GM phone\'s answer heard here marks the word answered, so this phone does not answer it twice', () => {
    const { p } = send(mira(), 'Hi'), s = heard(p), b: WordBackPayload = { eid: 'd-gm2-m1aaaa' as never, to: [p.by], re: p.eid, text: 'No.' };
    const a = wordBackHeard(s, b, AT);
    expect(wordAnswered(a, p.eid, 'Yes', { stamp: stamp(a, 3), log: LOG })).toEqual({ ok: false, why: 'answered' });
    expect(wordBackHeard(a, b, AT)).toBe(a);
  });
});

describe('the GM\'s answer on the player\'s phone', () => {
  test('lands once on the word it answers: its window is owed until the player closes it, then read; a second answer lands nothing', () => {
    const { save, p } = send(mira(), 'Hi'), b: WordBackPayload = { eid: 'd-gm-m1aaaa' as never, to: [p.by], re: p.eid, text: 'Yes.' };
    const landed = ok(wordLanded(save, b, AT));
    expect([shown(landed), owedAnswer(landed)?.id]).toEqual([['answered'], p.eid]);
    expect(wordLanded(landed, { ...b, eid: 'd-gm2-m1bbbb' as never, text: 'No.' }, AT)).toEqual({ ok: false, why: 'no-word' });
    const read = ok(wordRead(landed, p.eid));
    expect([shown(read), owedAnswer(read), mine(read)[0]!.state]).toEqual([['read'], null, { is: 'read', answer: { id: b.eid, at: AT, text: 'Yes.' } }]);
    expect([wordRead(read, p.eid), wordRead(save, p.eid)]).toEqual([{ ok: false, why: 'no-word' }, { ok: false, why: 'no-word' }]);
    expect(wordLanded(mira(), b, AT), 'no word of this phone: nothing lands').toEqual({ ok: false, why: 'no-word' });
  });
});

describe('the save\'s words', () => {
  test('each word reads whole or is dropped: an answered word without its answer, a word without text, a second of one id', () => {
    const { save, p } = send(mira(), 'Hi'), w = wordsOf(save)[0]!;
    expect(parseWords(JSON.parse(JSON.stringify(wordsOf(save))))).toEqual([w]);
    expect(parseWords([w, w, { ...w, id: 'd-a-m1aaaa', state: { is: 'answered' } }, { ...w, id: 'd-b-m1aaaa', text: '' }, { ...w, id: 'd-c-m1aaaa', side: 'both' }, 7])).toEqual([w]);
    expect(parseWords(Array.from({ length: WORDS_KEPT + 2 }, (_, i) => ({ ...w, id: `d-mira-m${i}zzzz` })))).toHaveLength(WORDS_KEPT);
    expect(p.eid).toBe(w.id);
  });
});
