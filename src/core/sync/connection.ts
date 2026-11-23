// connection.ts: what the room pill and the Room view show, from the link, the push, whether the room refused the
// GM's fight doc as too big, and how many posted messages the room does not have yet (src/core/sync/outbox.ts). Pure. The one place that merges them, so a sheet the server would not take reads as that,
// never as "reconnecting".
import type { Link } from './link.ts';
import type { Push } from './push.ts';

export type Connection =
  | 'off' | 'ready' | 'unreachable' | 'creating' | 'joining' | 'connecting' | 'live' | 'reconnecting'
  /** In the room and polling fine, but the server has not taken this phone's latest sheet. */
  | 'notSent'
  /** In the room and polling fine, but this phone's sheet is longer than the room takes (`SHEET_MAX`): the GM does not see its changes. */
  | 'sheetTooBig'
  /** Another phone owns this player's sheet in the room. */
  | 'locked'
  /** In the room as GM, but the room refused the fight doc as too big, even without its log: the players do not see the fight. */
  | 'tooBig'
  /** In the room and polling, but a message this phone posted got no answer: it waits for the next good poll. */
  | 'waiting'
  | 'upgrading';

export function connection(link: Link, push: Push, tooBig = false, stalled = false): Connection {
  switch (link.at) {
    case 'off': return 'off';
    case 'upgrading': return 'upgrading';
    case 'creating': return 'creating';
    case 'joining': return 'joining';
    case 'idle': return typeof link.server === 'object' ? 'unreachable' : 'ready';
    case 'live':
      if (link.health === 'connecting') return 'connecting';
      if (typeof link.health === 'object') return 'reconnecting';
      if (push.at === 'locked' || (push.at === 'sending' && push.locked)) return 'locked';
      if (push.at === 'rejected' && push.why === 'too-large') return 'sheetTooBig';
      if (push.at === 'rejected' || push.at === 'backoff' || (push.at === 'sending' && push.fails > 0)) return 'notSent';
      return tooBig ? 'tooBig' : stalled ? 'waiting' : 'live';
  }
}

/**
 * What a phone may say of a message it just posted: `sent` when the room is answering this phone's polls and nothing it
 * posted is stuck, so the outbox sends it with this poll; `waits` when it sits in the outbox for a room not answering now
 * (offline, reconnecting, a send with no answer), to go at the next good poll; `noRoom` or `refused` when nothing was
 * posted. `posted` is what `post` answered: made, or why not.
 */
export type PostNews = 'sent' | 'waits' | 'noRoom' | 'refused';
/** Whether a message posted while the link is in this state goes now. The typecheck asks for every state. */
const GOES: Record<Connection, boolean> = {
  live: true, notSent: true, sheetTooBig: true, locked: true, tooBig: true,
  waiting: false, reconnecting: false, connecting: false, upgrading: false, unreachable: false, ready: false, off: false, creating: false, joining: false,
};
export type PostAnswer = { readonly ok: true } | { readonly ok: false; readonly why: 'noRoom' | 'notEvent' };
export function postNews(posted: PostAnswer, conn: Connection): PostNews {
  if ('why' in posted) return posted.why === 'noRoom' ? 'noRoom' : 'refused';
  return GOES[conn] ? 'sent' : 'waits';
}
/** The words after a use reported to the GM was posted (`uses.told`'s `sent`): going now, or waiting for the room. */
export const reportWords = (conn: Connection): string => (postNews({ ok: true }, conn) === 'sent' ? 'Sent to the GM.' : conn === 'waiting' ? 'Saved. The GM gets it once the room server confirms it.' : 'Saved. The GM gets it when your phone reconnects to the room server.');
