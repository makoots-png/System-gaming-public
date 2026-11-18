// A check's result and a roll's stored facts (src/core/roll.ts). The rule: a natural 20 succeeds and a natural 1 fails
// whatever the total; any other roll succeeds when its total meets the DC.
import { describe, expect, test } from 'bun:test';
import { DC_MAX, checkResult, parseCheck, parseRollKind } from '../src/core/roll.ts';

describe('a check against a DC', () => {
  test('a total that meets the DC succeeds; one below it fails', () => {
    expect(checkResult(12, 15, 15)).toEqual({ dc: 15, success: true });
    expect(checkResult(12, 14, 15)).toEqual({ dc: 15, success: false });
  });

  test('a natural 20 succeeds below the DC, and a natural 1 fails above it', () => {
    expect(checkResult(20, 18, 25)).toEqual({ dc: 25, success: true });
    expect(checkResult(1, 30, 10)).toEqual({ dc: 10, success: false });
  });

  test('a roll with no single d20 is judged by its total', () => {
    expect(checkResult(null, 10, 10)).toEqual({ dc: 10, success: true });
  });
});

describe('a stored roll\'s kind and check', () => {
  test('a kind not in the list is a rule\'s own roll', () => {
    expect(['check', 'die', 'other', 'damage', 7].map(parseRollKind)).toEqual(['check', 'die', 'other', 'other', 'other']);
  });

  test('a check keeps a whole DC up to the bound and a yes or no; anything else is none', () => {
    expect(parseCheck({ dc: 15, success: false })).toEqual({ dc: 15, success: false });
    expect(parseCheck({ dc: DC_MAX, success: true })).toEqual({ dc: DC_MAX, success: true });
    for (const v of [null, 'yes', [], { dc: 15 }, { dc: 15.5, success: true }, { dc: -1, success: true }, { dc: DC_MAX + 1, success: true }, { dc: 15, success: 'yes' }]) {
      expect(parseCheck(v)).toBeNull();
    }
  });
});
