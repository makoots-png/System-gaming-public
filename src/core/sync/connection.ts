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

// ── GM roster presence age and formatting ──
/** Whether a player on the GM's roster polled recently, is away, or has no presence data from the server. */
export type RosterState = 'online' | 'away' | 'unknown';
/** Structured age bucket for a player's last poll or sheet push. */
export type PresenceAge =
  | { readonly unit: 'now' }
  | { readonly unit: 'min'; readonly value: number }
  | { readonly unit: 'hour'; readonly value: number }
  | { readonly unit: 'day'; readonly value: number };
/** One player row on the GM's Room view roster. `seenMs` is milliseconds since the player's last poll or sheet push, or null. */
export type RosterEntry = {
  readonly key: string; readonly name: string; readonly level: number; readonly job: string;
  readonly state: RosterState; readonly seenMs: number | null;
};

/** Buckets an elapsed duration in ms into the display unit (`now`, minutes, hours, days), or null when missing. */
export function presenceAge(ageMs: number | null): PresenceAge | null {
  if (ageMs === null || !Number.isFinite(ageMs)) return null;
  const m = Math.round(Math.max(0, ageMs) / 60_000);
  if (m < 1) return { unit: 'now' };
  if (m < 60) return { unit: 'min', value: m };
  if (m < 1440) return { unit: 'hour', value: Math.round(m / 60) };
  return { unit: 'day', value: Math.round(m / 1440) };
}
const ageWords = (age: Exclude<PresenceAge, { unit: 'now' }>): string =>
  age.unit === 'min' ? `${age.value} min` : age.unit === 'hour' ? `${age.value} h` : `${age.value} d`;

/** Status text drawn beside a roster entry in the GM's Room view from structured state and elapsed ms. */
export function rosterStatus(state: RosterState, ageMs: number | null): string {
  if (state === 'online') return 'online';
  const age = presenceAge(ageMs);
  if (state === 'away') return !age || age.unit === 'now' ? 'away' : `away ${ageWords(age)}`;
  if (!age) return '';
  return age.unit === 'now' ? 'last sync a moment ago' : `last sync ${ageWords(age)} ago`;
}

/** Stable DOM cache key for the Room view's roster: changes only when drawn fields or age buckets change. */
export function rosterSignature(rows: readonly RosterEntry[], open: Iterable<string>, busy: (key: string) => boolean): string {
  return rows.map(r => `${r.key}\0${r.name}\0${r.level}\0${r.job}\0${r.state}\0${rosterStatus(r.state, r.seenMs)}\0${busy(r.key) ? 1 : 0}`).join('\n')
    + '\x01' + [...open].join('\0');
}
