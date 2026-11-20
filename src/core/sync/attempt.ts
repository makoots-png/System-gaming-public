// attempt.ts: a Create or Join tap, from the tap until its promise answers the view that made it, as one machine. Pure.
// `attemptStep(attempt, event)` answers the next state and the effects src/edge/sync.ts carries out; sync.ts keeps the
// one state (`attempt`) and moves it only through this step. The link (link.ts) does the room's side: the requests, the
// gen, where a failed tap returns to. This machine holds what the link does not: whose promise to answer, and who a
// player's join is for (`joinBinds`).
//
// Before, the tap was an object of nullable fields beside the link (`made`, `notice`, `prevActive`), and a second tap
// while one was out got the first tap's promise: a GM who tapped New room while Open as GM waited on the server was
// told nothing, and the New room tap answered with the other room. A join for a typed name made its hunter as soon as
// the room was found, before the room's head answered, and took it away again when the head failed: the new hunter's
// first gate window stayed on the screen for a hunter the phone no longer had (audit SM-sync-2). Now a tap while one
// is out is answered at once as `busy`; how a tap ended is read from the link step that ended it, not from a field a
// notice wrote earlier; and a typed name's hunter is made in the same write that binds it, once the phone is in the
// room, so a join that fails has made nothing.
//
// `R` is the edge's way to answer the tap's promise. The machine only carries it to the `answer` effect.
import type { HunterId } from '../ids.ts';
import type { Gen, Link, LinkEvent, LinkNotice } from './link.ts';
import type { TapKind } from './taps.ts';

/** A Create or Join tap, as the link takes it. */
export type RoomTap = Extract<LinkEvent, { type: 'create' | 'join' }>;
/** Who a player's join is for, as the view asked: a hunter picked (null: the active one), or a name for a new hunter ('' for none). */
export type JoinFor = { readonly hunterId: string | null; readonly name: string };
export const NOBODY: JoinFor = { hunterId: null, name: '' };
/** Who a join is for: the room's GM (the join sends its key), a hunter picked, or a new hunter of a typed name. */
export type JoinsAs =
  | { readonly as: 'gm' }
  | { readonly as: 'picked'; readonly hunterId: string | null }
  | { readonly as: 'named'; readonly name: string };

/**
 * `none`: no tap is out. `handed`: the tap is handed to the link, which has not taken it yet. `creating`, `joining`:
 * the link took it and is in that state in the stretch `gen`; the tap ends when the link leaves that stretch.
 */
export type Attempt<R> =
  | { readonly at: 'none' }
  | { readonly at: 'handed'; readonly tap: RoomTap; readonly who: JoinFor; readonly reply: R }
  | { readonly at: 'creating'; readonly gen: Gen; readonly reply: R }
  | { readonly at: 'joining'; readonly gen: Gen; readonly joins: JoinsAs; readonly reply: R };
export const ATTEMPT_STATES = ['none', 'handed', 'creating', 'joining'] as const satisfies readonly Attempt<unknown>['at'][];
export const NO_ATTEMPT: Attempt<never> = { at: 'none' };

/** `tap`: a Create or Join tap, with the way to answer it. `linked`: the link took the event `took` and is now `link`; `notices` are the notices of that same step. */
export type AttemptEvent<R> =
  | { readonly type: 'tap'; readonly tap: RoomTap; readonly who: JoinFor; readonly reply: R }
  | { readonly type: 'linked'; readonly took: LinkEvent; readonly link: Link; readonly notices: readonly LinkNotice[] };
export const ATTEMPT_EVENTS = ['tap', 'linked'] as const satisfies readonly AttemptEvent<unknown>['type'][];

/** What a tap answers: the room's code for a create, `gm` or `player` for a join; or why it failed. */
export type TapAnswer = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly kind: TapKind };
/** `link`: hand the tap to the link. `answer`: answer a tap's promise. */
export type AttemptEffect<R> =
  | { readonly type: 'link'; readonly tap: RoomTap }
  | { readonly type: 'answer'; readonly reply: R; readonly answer: TapAnswer };
export type AttemptResult<R> = { readonly state: Attempt<R>; readonly effects: readonly AttemptEffect<R>[] };

/** The link's notices that end a tap, and the kind each fails it as. A tap that ends with none of them out of a room fails as `net`. */
const TAP_OF: { readonly [N in LinkNotice]: TapKind | null } = {
  notFound: 'notfound', keyRefused: 'keyRefused', notAllowedBack: 'removed', replaced: 'replaced', unreachable: 'net', serverError: 'net',
  gone: null, removed: null, keyLost: null, upgradeStuck: null,
};

type Out<R> = AttemptResult<R>;
const same = <R>(s: Attempt<R>): Out<R> => ({ state: s, effects: [] });
const answer = <R>(reply: R, a: TapAnswer): Out<R> => ({ state: NO_ATTEMPT, effects: [{ type: 'answer', reply, answer: a }] });
/** A tap while one is out starts nothing and is answered at once: another is under way. */
const busy = <R>(s: Attempt<R>, e: Extract<AttemptEvent<R>, { type: 'tap' }>): Out<R> =>
  ({ state: s, effects: [{ type: 'answer', reply: e.reply, answer: { ok: false, kind: 'busy' } }] });

/** The link took the tap, or did not: a create or a join under way, a join of the place the phone is live in (answers its role), or the tap fails (`busy` while the link holds another, `net` with no server or an update coming). */
function taken<R>(s: Extract<Attempt<R>, { at: 'handed' }>, link: Link): Out<R> {
  const { tap, who, reply } = s;
  if (tap.type === 'create' && link.at === 'creating') return { state: { at: 'creating', gen: link.gen, reply }, effects: [] };
  if (tap.type === 'join' && link.at === 'joining') {
    const joins: JoinsAs = tap.key !== null ? { as: 'gm' } : who.name ? { as: 'named', name: who.name } : { as: 'picked', hunterId: who.hunterId };
    return { state: { at: 'joining', gen: link.gen, joins, reply }, effects: [] };
  }
  if (tap.type === 'join' && link.at === 'live' && link.code === tap.code && link.key === tap.key) return answer(reply, { ok: true, value: link.key !== null ? 'gm' : 'player' });
  return answer(reply, { ok: false, kind: link.at === 'upgrading' || link.at === 'off' ? 'net' : 'busy' });
}

/** After each link step while a create or join is under way: nothing while the link stays in its stretch; out of it, the tap answers, live with no notice of its own as a success, else as the notice says. */
function followed<R>(s: Extract<Attempt<R>, { at: 'creating' | 'joining' }>, link: Link, notices: readonly LinkNotice[]): Out<R> {
  if (link.at === s.at && link.gen === s.gen) return same(s);
  const told = notices.map(n => TAP_OF[n]).find((k): k is TapKind => k !== null);
  if (link.at === 'live' && told === undefined) return answer(s.reply, { ok: true, value: s.at === 'creating' ? link.code : link.key !== null ? 'gm' : 'player' });
  return answer(s.reply, { ok: false, kind: told ?? 'net' });
}

type Cell<R, S extends Attempt<R>['at'], E extends AttemptEvent<R>['type']> = (s: Extract<Attempt<R>, { at: S }>, e: Extract<AttemptEvent<R>, { type: E }>) => Out<R>;
type Table<R> = { readonly [S in Attempt<R>['at']]: { readonly [E in AttemptEvent<R>['type']]: Cell<R, S, E> } };
/** What each event does from each state. A `linked` for another event than the tap handed (one queued before it) changes nothing. */
const TABLE: Table<unknown> = {
  none: { tap: (_, e) => ({ state: { at: 'handed', tap: e.tap, who: e.who, reply: e.reply }, effects: [{ type: 'link', tap: e.tap }] }), linked: same },
  handed: { tap: busy, linked: (s, e) => (e.took === s.tap ? taken(s, e.link) : same(s)) },
  creating: { tap: busy, linked: (s, e) => followed(s, e.link, e.notices) },
  joining: { tap: busy, linked: (s, e) => followed(s, e.link, e.notices) },
};

/** One event. A state answered unchanged is an event that changes nothing. */
export function attemptStep<R>(s: Attempt<R>, e: AttemptEvent<R>): AttemptResult<R> {
  // The table's type pairs each state with its own cells, and each cell with its own event, so the cell for `s.at` and
  // `e.type` takes them. The cells only carry `R`, so the table for `unknown` is the table for every `R`.
  const row = (TABLE as unknown as Table<R>)[s.at] as { readonly [E in AttemptEvent<R>['type']]: (s: Attempt<R>, e: AttemptEvent<R>) => Out<R> };
  return row[e.type](s, e);
}

/** What a player's join binds: a hunter of the party, or a new hunter of the typed name, made in the same write that binds it. */
export type JoinBinds = { readonly hunter: HunterId } | { readonly make: string };
/**
 * What a player's join binds, and so whose removal its head checks (a new hunter was never in the room): the one picked
 * (`has` answers it while it is in the party), a new one of the typed name, or else the active one.
 */
export function joinBinds(a: Attempt<unknown>, has: (id: string) => HunterId | null, active: HunterId): JoinBinds {
  if (a.at !== 'joining') return { hunter: active };
  const j = a.joins;
  switch (j.as) {
    case 'gm': return { hunter: active };
    case 'picked': return { hunter: (j.hunterId !== null ? has(j.hunterId) : null) ?? active };
    case 'named': return { make: j.name };
  }
}
