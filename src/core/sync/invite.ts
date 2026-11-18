// invite.ts: a room code out of what a player pastes or types (an invite link, a message, a code). Pure.
import type { RoomCode } from '../protocol.ts';
import { parseRoomCode } from '../ids.ts';


/** `abc-234` and `ABC234` are the same code. Anything else is no code. */
export function codeOf(text: string): RoomCode | null {
  const c = text.toUpperCase().replace(/-/g, '');
  return parseRoomCode(c);
}

/**
 * The room code in a pasted or typed text, or null. In order:
 * - an invite link's `room=` parameter;
 * - the text is one word: that word, in any case (a code typed by hand);
 * - in a longer text, the one word written like a code, in capitals or with a digit. Many six-letter words ("thanks",
 *   "Hunter", "please") fit the code alphabet, so a word in lower or mixed case without a digit is never a code there.
 *   The server puts a digit in every code it makes (server.ts `newCode`), so a pasted code is always found;
 * - the text without its spaces (`ABC 234`).
 * Two different codes in one text are ambiguous: null.
 */
export function parseInvite(input: unknown): RoomCode | null {
  const text = String(input ?? '');
  const link = /[?&#]room=([A-Za-z0-9%-]+)/i.exec(text); // code characters only: a link ending a sentence keeps its . ) , !
  if (link?.[1]) {
    let c: RoomCode | null = null;
    try { c = codeOf(decodeURIComponent(link[1])); } catch { /* a bad escape is no code */ }
    if (c) return c;
  }
  const words = text.split(/\s+/).map(w => w.replace(/^[^\w-]+|[^\w-]+$/g, '')).filter(w => codeOf(w));
  if (text.trim().split(/\s+/).length === 1 && words.length === 1) return codeOf(words[0]!);
  const shown = [...new Set(words.filter(w => /\d/.test(w) || w === w.toUpperCase()).map(w => codeOf(w)))];
  if (shown.length === 1) return shown[0]!;
  if (shown.length > 1 || words.length) return null;
  return codeOf(text.replace(/\s+/g, ''));
}
