// The charts of a player's bind (src/core/sync/bind.ts, audits SMX-sync-2 and SMX-sync-8): the hunter this phone sends
// and its join of the room, walked over a save of two hunters with joins of rooms A and B and "Play as"; and the
// REMOVED FROM ROOM notice (`removedStep`), walked in rooms A and B with every answer of a Rejoin.
import { NO_REMOVAL, REMOVED_STATES, boundTo, playAs, removedStep } from '../../src/core/sync/bind.ts';
import type { RemovedEvent, RemovedNotice } from '../../src/core/sync/bind.ts';
import { freshSave, newHunter } from '../../src/core/save.ts';
import type { ParseEnv, Save } from '../../src/core/save.ts';
import { RULES } from '../../src/core/rules.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { TAP_KINDS } from '../../src/core/sync/taps.ts';
import { dev, hid, room } from '../../tests/fixtures/ids.ts';
import { bfs, machine } from '../statecharts.ts';

const A = room('AAAA22'), B = room('BBBB33'), H1 = hid('h1'), H2 = hid('h2');
const T0 = '2026-11-15T09:00:00.000Z', T1 = '2026-11-15T10:00:00.000Z';
const ENV: ParseEnv = { now: new Date(T0), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') };

/** A player's save with hunters h1 (active) and h2, in no room. */
function player(): Save {
  const s = freshSave(ENV, { onboarded: true });
  return { ...s, hunters: [{ ...s.hunters[0]!, id: H1 }, { ...newHunter(RULES), id: H2 }], settings: { ...s.settings, activeHunterId: H1 } };
}

/** What moves the bind: a join (from the Room view, an invite or a Rejoin) with a hunter, or "Play as". */
type BindMove = { readonly type: 'join'; readonly room: typeof A; readonly at: string; readonly hunter: typeof H1 } | { readonly type: 'playAs'; readonly hunter: typeof H1 };
const BIND_WALK: readonly BindMove[] = [
  { type: 'join', room: A, at: T0, hunter: H1 },
  { type: 'join', room: A, at: T1, hunter: H2 },
  { type: 'join', room: B, at: T1, hunter: H1 },
  { type: 'playAs', hunter: H1 },
  { type: 'playAs', hunter: H2 },
];
function bindMove(s: Save, e: BindMove): Save | null {
  if (e.type === 'join') return boundTo(s, e.hunter, { room: e.room, at: e.at });
  const r = playAs(s, e.hunter);
  return isRefused(r) ? null : r;
}
/** Whether the save holds a join: the bind's two kinds. */
const JOIN_KINDS = { none: 'No join', joined: 'A join of a room' } as const satisfies Record<'none' | 'joined', string>;
const nameOf = (h: string | undefined): string => (h === H1 ? 'h1' : h === H2 ? 'h2' : 'no hunter');
const bindKey = (s: Save): string => JSON.stringify([s.settings.sync.joined ?? null, s.settings.sync.boundHunterId ?? null, s.settings.activeHunterId]);

export const bind = machine<Save, BindMove>({
  name: 'A player\'s bind',
  walked: `Every bind reachable from a player's save of two hunters in no room, under the ${BIND_WALK.length} moves of a join (room A at two times, room B) and "Play as" each hunter, breadth first.`,
  walk: () => bfs([player()], s => BIND_WALK.flatMap(event => { const to = bindMove(s, event); return to === null || bindKey(to) === bindKey(s) ? [] : [{ event, to }]; }), bindKey),
  kinds: Object.keys(JOIN_KINDS),
  kindsOf: s => [s.settings.sync.joined ? 'joined' : 'none'],
  views: [{
    title: 'The hunter this phone sends, and its join of the room',
    note: 'A join writes both the hunter bound and the join (its room and the server\'s time); "Play as" and a delete of the bound hunter (party.ts `removeHunter`, which binds the active one) move the hunter and never the join, so a message the room took while this phone was in it is never told as one sent while it was away. A join counts only for its own room: a save swapped in with another room reads no join. The "Play as" window\'s answer is read where the phone is when it comes (`playAsAnswered`): once the phone has left the room or another hunter is bound there, it only shows the hunter.',
    hides: '',
    state: s => {
      const j = s.settings.sync.joined;
      return { 'The join': j ? `${j.room === A ? (j.at === T0 ? 'Joined A, first' : 'Joined A again, later') : 'Joined B'}` : JOIN_KINDS.none, 'The hunter bound': `${nameOf(s.settings.sync.boundHunterId)} bound` };
    },
    step: e => (e.type === 'join' ? `${e.room === A ? (e.at === T0 ? 'the first join of A' : 'a later join of A') : 'a join of B'} with ${nameOf(e.hunter)}` : `Play as ${nameOf(e.hunter)}`),
  }],
  where: [
    ['The fields', '`boundHunterId` and `joined` (`BindJoin`) of the save\'s sync settings (`src/core/save.ts`)'],
    ['What changes it', '`boundTo` (a join), `playAs` and `rebindTo` in `src/core/sync/bind.ts`; `joinedAt` reads the join for its room only'],
    ['Who calls it', '`src/edge/sync.ts` (a join answered, the "Play as" window through `playAsAnswered`), `src/core/party.ts` `removeHunter` (a delete of the bound hunter)'],
    ['The test to copy', '`tests/bind.test.ts`, "a player\'s hunter bound to the room"'],
    ['The recipe', 'docs/guide/room-sync.md, the bind\'s row'],
  ],
});

/** Every event of the notice in rooms A and B: a removal, each answer of the window, each answer of a Rejoin, a room entered, a campaign replaced. */
const REMOVED_WALK: readonly RemovedEvent[] = [
  ...[A, B].flatMap((r): RemovedEvent[] => [
    { type: 'removed', room: r, hunter: H1 },
    { type: 'answered', room: r, rejoin: true },
    { type: 'answered', room: r, rejoin: false },
    { type: 'tapped', room: r, answer: { ok: true, value: 'player' } },
    ...TAP_KINDS.map((kind): RemovedEvent => ({ type: 'tapped', room: r, answer: { ok: false, kind } })),
    { type: 'entered', room: r },
  ]),
  { type: 'replaced' },
];
const REMOVED_WORDS: { readonly [S in RemovedNotice['at']]: string } = {
  none: 'No notice',
  told: 'REMOVED FROM ROOM open',
  rejoining: 'Rejoin on its way',
};
function removedArrow(e: RemovedEvent, from: RemovedNotice): string {
  switch (e.type) {
    case 'removed': return 'the GM removes this phone';
    case 'answered': return e.rejoin ? 'Rejoin is tapped' : 'OK is tapped';
    case 'tapped': {
      const a = e.answer;
      if (a.ok === true) return 'the Rejoin is taken';
      return from.at === 'rejoining' && (a.kind === 'removed' || a.kind === 'net') ? 'not allowed back yet, or no server: the window again' : 'the Rejoin fails for good (no room, campaign replaced, busy, bad code or key)';
    }
    case 'entered': return 'the phone is in a room (Room view, invite, another tab)';
    case 'replaced': return 'an import, a restore or a reset';
  }
}

export const removedNotice = machine<RemovedNotice, RemovedEvent>({
  name: 'The REMOVED FROM ROOM notice',
  walked: `Every state reachable from no notice, under the ${REMOVED_WALK.length} events of the notice in two rooms, breadth first.`,
  walk: () => bfs([NO_REMOVAL], s => REMOVED_WALK.flatMap(event => { const to = removedStep(s, event).state; return JSON.stringify(to) === JSON.stringify(s) ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: REMOVED_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'The notice that the GM removed this phone',
    note: 'The notice names its room and the hunter that was bound, so an answer of an old window, or a Rejoin\'s answer for another room, changes nothing. A removal from another room opens that room\'s window in place of the one up. A Rejoin that fails tells its words: where a second try can work (not allowed back yet, the server not reached) the window opens again; otherwise the notice ends.',
    hides: '',
    state: s => REMOVED_WORDS[s.at],
    step: removedArrow,
  }],
  where: [
    ['The union', '`RemovedNotice`, `RemovedEvent`, `RemovedEffect`, `REMOVED_STATES` and `REMOVED_EVENTS` in `src/core/sync/bind.ts`'],
    ['What changes it', '`removedStep(notice, event)` and its `AGAIN` table'],
    ['Who calls it', '`src/edge/sync.ts`, which keeps the one notice and carries out its effects (the window, the Rejoin, the toast)'],
    ['The test to copy', '`tests/bind.test.ts`, "the REMOVED FROM ROOM notice"'],
    ['The recipe', 'docs/guide/room-sync.md, the bind\'s row'],
  ],
});
