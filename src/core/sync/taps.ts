// taps.ts: why a Create or Join tap failed, and the one set of words for it. Pure.
//
// src/edge/sync.ts rejects a tap's promise with a `TapError` of one of these kinds; the Room view, the GM view and
// onboarding say it with `tapWords`. Before, the kind was a bare string and each view had its own words, two of them
// read by HTTP status, so one failure read three ways and the GM view said "Could not reach the server" for every kind,
// another tab's takeover included (implicit audit 2, N9).

/**
 * Why a tap failed. `busy`: the link was not ready for a create or a join (it was leaving or held another). `replaced`:
 * an import, a restore or a reset replaced the campaign while it waited (no words: the new campaign is the answer).
 */
export const TAP_KINDS = ['badcode', 'notfound', 'keyRefused', 'removed', 'busy', 'replaced', 'net'] as const;
export type TapKind = (typeof TAP_KINDS)[number];

const WORDS: { readonly [K in TapKind]: ((code: string, typed: boolean) => string) | null } = {
  badcode: () => 'Enter the 6-character room code.',
  notfound: code => (code ? `There is no room ${code}.` : 'There is no room with that code.'),
  // a key the GM typed that the room refuses does not match it; a kept one is no longer valid
  keyRefused: (code, typed) => (typed ? 'That GM key does not match this room.' : `The GM key for ${code || 'that room'} is no longer valid.`),
  removed: () => 'The GM removed you from that room. Ask the GM to allow you back.',
  busy: () => 'Another create or join is under way. Try again in a moment.',
  replaced: null,
  net: () => 'Could not reach the server. Try again in a moment.',
};
/**
 * The words for a tap that failed as `kind` for room `code` (empty when none was typed); null when there is nothing to
 * say. `typed`: the GM typed the key the tap sent (the Room view's Rejoin as GM), rather than one this phone kept.
 */
export const tapWords = (kind: TapKind, code: string, typed = false): string | null => WORDS[kind]?.(code, typed) ?? null;
