import { CODE_CHARS, CODE_LEFT_OUT, CODE_LEN, parseRoomCode } from '../src/core/ids.ts';
// Reading a room code out of what a player pastes or types into the Join field (src/core/sync/invite.ts).
import { describe, expect, test } from 'bun:test';
import { parseInvite } from '../src/core/sync/invite.ts';

const read = (text: string): string | null => parseInvite(text);

describe('the code a player pastes or types', () => {
  test('an invite link gives its room code, in any case and with a full stop after it', () => {
    expect(read('Join here: http://localhost:3217/?room=abc234.')).toBe('ABC234');
    expect(read('https://hunter.example/app/?x=1&room=XYZ789')).toBe('XYZ789');
  });

  test('a code typed by hand is read in any case, with or without a dash or a space', () => {
    expect(read('abc234')).toBe('ABC234');
    expect(read(' ABC-234 ')).toBe('ABC234');
    expect(read('ABC 234')).toBe('ABC234');
  });

  test('a message with one code written like a code gives that code, past six-letter words', () => {
    expect(read('Hunter, join room QWERTY please')).toBe('QWERTY');
    expect(read('the room is xyz789, thanks')).toBe('XYZ789');
  });

  test('"thanks buddy" is no code', () => {
    expect(read('thanks buddy')).toBeNull();
  });

  test('two different codes in one message are no code', () => {
    expect(read('ABC234 or XYZ789')).toBeNull();
  });

  test('a code with a 0, 1, I or O, or of the wrong length, is no code', () => {
    expect(read('ABC230')).toBeNull();
    expect(read('ABCD234')).toBeNull();
    expect(read('')).toBeNull();
  });
});

describe('the room code\'s alphabet, written once (src/core/ids.ts)', () => {
  test('letters and digits without 0, 1, I and O, six of them: every code of it parses and nothing else does', () => {
    expect(CODE_LEFT_OUT).toEqual(['0', '1', 'I', 'O']);
    expect(CODE_LEN).toBe(6);
    for (const c of CODE_CHARS) expect(parseRoomCode(c.repeat(CODE_LEN)) as string | null).toBe(c.repeat(CODE_LEN));
    for (const c of CODE_LEFT_OUT) expect(parseRoomCode(`ABCDE${c}`)).toBeNull();
    expect(parseRoomCode('ABCD2')).toBeNull();
  });
});
