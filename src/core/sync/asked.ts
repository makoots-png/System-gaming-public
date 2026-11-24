// asked.ts: a player's letter that waits for the GM's phone's answer (notes-2-solo.md section 5, notes-5-trade.md 3.3).
// Pure; the save holds the list (`settings.sync.asked`). What it asks is a union of kinds: a won run of a room's solo
// gate (`solo`), or a put into or a take from the party stash (`stash`). The answer is the GM's phone's alone: this phone
// keeps only its claim, by the letter's event id, so it never shows the answer on its own word and never lands one twice.
//
// Delivery is the outbox's (src/core/sync/outbox.ts): the ask's message is a letter there until the room takes it. What
// the outbox cannot show is stored here: that the room took it (`taken`, heard by sync.ts in the write that steps the
// letter `sent`, before the letter leaves the box), and that the room is gone (`gone`). A posted ask whose letter the box
// no longer holds on its way (let go, or refused) reads as lost, from the box itself: the evidence stays true wherever a
// write stopped (a letter leaves the box as sent only in the write that marks the ask taken).
//
// One ask's life is a machine over what the player sees (`shownOf`): posted, taken, lost, and the end (answered or
// dismissed: out of the list). Its `TABLE` has every cell; docs/state-machines.md draws it ("An ask waiting for the GM's
// phone"). An ask the room took may be put away too: a GM's phone that missed it (a read-only tab, a gate cleared by hand)
// never answers it, and a solo run would hold its gate for good (audit SMX-gates-2.4). An answer after that lands nothing.

import type { Save } from '../save.ts';
import type { Outbox } from './outbox.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { parseEventId, parseGateId, parseRoomCode, parseSaveId } from '../ids.ts';
import type { EventId, GateId, HunterId, RoomCode } from '../ids.ts';
import { timeOf } from '../day.ts';
import type { StashAsk } from '../trade/goods.ts';

/** What is stored of a waiting ask: posted (its letter in the outbox or let go), taken (the room has it), gone (the room is gone). */
export const ASKED_STORED = ['posted', 'taken', 'gone'] as const;
export type AskedStored = (typeof ASKED_STORED)[number];
/** What an ask asks: a solo run of a room's gate to be paid, or the party stash to take or keep goods. */
export type AskedKind =
  | { readonly kind: 'solo'; readonly gate: GateId; readonly name: string }
  | { readonly kind: 'stash'; readonly ask: StashAsk };
/**
 * A player's letter to the GM's phone, until that phone's answer lands: its id is the letter's event id. `sent`: the
 * letter went out at least once (`askSent`), so the room may have it even when the box no longer holds it.
 */
export type Asked = {
  readonly id: EventId; readonly room: RoomCode; readonly hid: HunterId; readonly at: string; readonly state: AskedStored; readonly sent: boolean;
} & AskedKind;
/** What the player sees of a waiting ask. */
export const ASKED_STATES = ['posted', 'taken', 'lost'] as const;
export type AskedState = (typeof ASKED_STATES)[number];
/** Why a lost ask is lost: the room refused its message, the outbox let it go, or the room is gone. */
export type LostWhy = 'refused' | 'dropped' | 'gone';
export const ASKED_EVENTS = ['taken', 'answered', 'roomGone', 'dismiss'] as const;
/**
 * What happens to a waiting ask: the room took its message (sync.ts, with the outbox's `sent`); the GM's answer landed
 * (any verdict); the room no longer exists (the link's `gone`); the player put a lost or taken ask away.
 */
export type AskedEvent = { readonly type: (typeof ASKED_EVENTS)[number] };
/** An ask's next stored state, or `end` when it leaves the list; null where the event does not apply. */
type Cell = AskedStored | 'end' | null;

type Table = { readonly [S in AskedState]: { readonly [E in AskedEvent['type']]: Cell } };
/**
 * Each kind's answer, in each shown state, to each event (notes-2-solo.md section 5: 3 states by 4 events, every cell).
 * A posted ask cannot be put away: its letter is still queued or on its way, and the outbox makes it taken or lost. A
 * solo run the room took can be put away (a GM's phone that missed it would hold its gate for good); a stash ask the room
 * took cannot: the GM's phone moves the stash when it answers, so a put away take would leave the stash for nobody and a
 * put away put is the stash's already. It waits for the GM's phone, which holds the stash.
 */
export const TABLES: { readonly [K in Asked['kind']]: Table } = {
  solo: {
    posted: { taken: 'taken', answered: 'end', roomGone: 'gone', dismiss: null },
    taken: { taken: null, answered: 'end', roomGone: 'gone', dismiss: 'end' },
    lost: { taken: null, answered: null, roomGone: null, dismiss: 'end' },
  },
  stash: {
    posted: { taken: 'taken', answered: 'end', roomGone: 'gone', dismiss: null },
    taken: { taken: null, answered: 'end', roomGone: 'gone', dismiss: null },
    lost: { taken: null, answered: null, roomGone: null, dismiss: 'end' },
  },
};

/** What the player sees of `w` with the outbox `box`: a posted ask whose letter is no longer queued or on its way is lost. */
export function shownOf(w: Asked, box: Outbox): { readonly state: AskedState; readonly why: LostWhy | null } {
  if (w.state === 'gone') return { state: 'lost', why: 'gone' };
  if (w.state === 'taken') return { state: 'taken', why: null };
  const letter = box.find(e => e.id === w.id);
  if (letter && (letter.at === 'queued' || letter.at === 'sending')) return { state: 'posted', why: null };
  return { state: 'lost', why: letter ? 'refused' : 'dropped' };
}

/** `w` after `e`: the next ask, `end` when it leaves the list, or `w` itself where the event does not apply. */
export function askedStep(w: Asked, box: Outbox, e: AskedEvent): Asked | 'end' {
  const to = TABLES[w.kind][shownOf(w, box).state][e.type];
  return to === null ? w : to === 'end' ? 'end' : to === w.state ? w : { ...w, state: to };
}

/** At most this many asks wait at once: far past the gates a player can see (`WORLD_GATES`, 40, of which it wins each once). */
export const ASKED_MAX = 20;
/** The asks the save holds. */
export const askedOf = (s: Pick<Save, 'settings'>): readonly Asked[] => s.settings.sync.asked ?? [];
const withAsked = <S extends Pick<Save, 'settings'>>(s: S, asked: readonly Asked[]): S =>
  ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, asked: [...asked] } } });

/** Whether ask `w` holds goods aside: a stash put, whose goods are in no bag until the answer lands or they come back. */
export const holdsGoods = (w: Asked): boolean => w.kind === 'stash' && w.ask.kind === 'put';
/**
 * Ask `w` waiting: added last; past `ASKED_MAX` the oldest lost one goes, else the oldest, never one that holds goods (the
 * stash's own cap, `STASH_WAITING`, bounds those). One per id.
 */
export function askPosted<S extends Pick<Save, 'settings'>>(s: S, w: Asked): S {
  const asked = askedOf(s), box = s.settings.sync.outbox ?? [];
  if (asked.some(x => x.id === w.id)) return s;
  let next = [...asked, w];
  while (next.length > ASKED_MAX) {
    const loose = next.filter(x => !holdsGoods(x) && x !== w), out = loose.find(x => shownOf(x, box).state === 'lost') ?? loose[0];
    if (!out) break;
    next = next.filter(x => x !== out);
  }
  return withAsked(s, next);
}
/** Each ask `pick` holds after `e`; refused (`no-ask`) when none was there to take it. */
function stepAsked<S extends Pick<Save, 'settings'>>(s: S, pick: (w: Asked) => boolean, e: AskedEvent): S | Refused<'no-ask'> {
  const asked = askedOf(s), box = s.settings.sync.outbox ?? [];
  let hit = false;
  const next = asked.flatMap(w => {
    if (!pick(w)) return [w];
    const out = askedStep(w, box, e);
    if (out !== w) hit = true;
    return out === 'end' ? [] : [out];
  });
  return hit ? withAsked(s, next) : refuse('no-ask');
}
/** The room took letter `id` (sync.ts, in the write that steps it `sent`). A letter that is no ask changes nothing. */
export const askTaken = <S extends Pick<Save, 'settings'>>(s: S, id: string): S => { const r = stepAsked(s, w => w.id === id, { type: 'taken' }); return 'ok' in r ? s : r; };
/**
 * Letter `id` is on its way: its ask was sent once, so the room may have it from now on. Heard by the store's every-write
 * step (trade/stash.ts `asksKept`) in the write that put the letter on its way.
 */
export const askSent = <S extends Pick<Save, 'settings'>>(s: S, id: string): S =>
  (askedOf(s).some(w => w.id === id && !w.sent) ? withAsked(s, askedOf(s).map(w => (w.id === id ? { ...w, sent: true } : w))) : s);
/** Room `room` is gone: each of its asks is lost. */
export const askedGone = <S extends Pick<Save, 'settings'>>(s: S, room: RoomCode): S => { const r = stepAsked(s, w => w.room === room, { type: 'roomGone' }); return 'ok' in r ? s : r; };
/**
 * The GM's answer to ask `id` landed: it leaves the list. Refused (`no-ask`) when no ask of that id waits to be
 * answered, so a second answer (a second GM phone, a replay) lands nothing: the ask's id is the player's guard.
 */
export const askAnswered = <S extends Pick<Save, 'settings'>>(s: S, id: string): S | Refused<'no-ask'> => stepAsked(s, w => w.id === id, { type: 'answered' });
/**
 * The player put ask `id` away: a lost one, or a taken one it stops waiting for (`mayDismiss`). Refused (`no-ask`) for
 * an ask still posted.
 */
export const askDismissed = <S extends Pick<Save, 'settings'>>(s: S, id: string): S | Refused<'no-ask'> => stepAsked(s, w => w.id === id, { type: 'dismiss' });
/** Whether the player may put `w` away now (the table's `dismiss` cell): its card's Dismiss. */
export const mayDismiss = (w: Asked, box: Outbox): boolean => TABLES[w.kind][shownOf(w, box).state].dismiss !== null;
/** The gates hunter `hid` has a run of waiting in room `room` (soloReady's `waiting`: no second run of one gate before its answer). */
export const waitingGates = (s: Pick<Save, 'settings'>, room: RoomCode, hid: string): GateId[] => {
  const box = s.settings.sync.outbox ?? [];
  return askedOf(s).flatMap(w => (w.kind === 'solo' && w.room === room && w.hid === hid && shownOf(w, box).state !== 'lost' ? [w.gate] : []));
};

/** What a waiting run says on its gate's card. */
export const WAIT_WORDS: { readonly [S in AskedState]: string } & { readonly lost: string; readonly gone: string } = {
  posted: 'Cleared. Waiting for the room server.',
  taken: 'Cleared. Waiting for the GM to confirm it.',
  lost: 'This run did not reach the room server, so you got no reward. Its cost is not refunded.',
  gone: 'This room no longer exists, so you got no reward. Its cost is not refunded.',
};
/** The question before a taken run is put away: it gives up the pay. */
export const STOP_WAITING = {
  title: 'Stop waiting?',
  body: 'If the GM confirms this run later, you will get no reward. Its cost is not refunded, and you can enter the gate again.',
  confirm: 'Stop waiting',
} as const;
/** The words of run `w` as the player sees it. */
export const waitWords = (w: Asked, box: Outbox): string => { const s = shownOf(w, box); return s.why === 'gone' ? WAIT_WORDS.gone : WAIT_WORDS[s.state]; };

// ── the save's reader ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** What a stored ask asks, read by its kind; else null. */
function kindOf(o: Rec, readStash: (v: unknown) => StashAsk | null): AskedKind | null {
  if (o.kind === 'solo') { const gate = parseGateId(o.gate); return gate ? { kind: 'solo', gate, name: typeof o.name === 'string' ? o.name.slice(0, 60) : '' } : null; }
  if (o.kind === 'stash') { const ask = readStash(o.ask); return ask ? { kind: 'stash', ask } : null; }
  return null;
}
/**
 * The stored asks, each read whole or dropped; one per id. None is dropped for a count: a stash put holds goods aside,
 * and `askPosted` keeps the count.
 */
export function parseAsked(v: unknown, readStash: (v: unknown) => StashAsk | null): Asked[] {
  const out: Asked[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (!isObj(raw)) continue;
    const id = parseEventId(raw.id), room = parseRoomCode(raw.room), hid = parseSaveId<'h'>(raw.hid), at = timeOf(raw.at), kind = kindOf(raw, readStash);
    const state = ASKED_STORED.find(x => x === raw.state);
    if (!id || !room || !hid || !at || !state || !kind || out.some(w => w.id === id)) continue;
    out.push({ id, room, hid, at, state, sent: raw.sent === true, ...kind });
  }
  return out;
}
