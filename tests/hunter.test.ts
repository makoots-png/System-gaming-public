// hunter.test.ts: per-hunter display-only capDisplay, live rankLevels derivation, and non-enforcement in gainXp.
import { describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import {
  CAP_DISPLAY_RANKS,
  addXp,
  atLevel,
  capDisplayChip,
  capDisplayLevel,
  capDisplayOptionLabel,
  gainXp,
  parseCapDisplay,
  parseCapDisplayStrict,
  setCapDisplay,
} from '../src/core/hunter/progress.ts';

describe('per-hunter display-only capDisplay', () => {
  test('newHunter defaults capDisplay to null and renders no cap chip', () => {
    const h = newHunter(RULES);
    expect(h.capDisplay).toBeNull();
    expect(capDisplayLevel(h.capDisplay, RULES)).toBeNull();
    expect(capDisplayChip(h.capDisplay, RULES)).toBeNull();
  });

  test('setCapDisplay updates capDisplay and honors onlyIfNull without overwriting existing values', () => {
    const h0 = newHunter(RULES);
    expect(setCapDisplay(h0, null)).toBe(h0);

    const hE = setCapDisplay(h0, 'E', { onlyIfNull: true });
    expect(hE.capDisplay).toBe('E');
    expect(setCapDisplay(hE, 'D', { onlyIfNull: true })).toBe(hE);

    const hD = setCapDisplay(hE, 'D');
    expect(hD.capDisplay).toBe('D');

    const hNone = setCapDisplay(hD, 'none');
    expect(hNone.capDisplay).toBe('none');
    expect(setCapDisplay(hNone, 'E', { onlyIfNull: true })).toBe(hNone);

    const hHidden = setCapDisplay(hNone, null);
    expect(hHidden.capDisplay).toBeNull();
  });

  test('gainXp, addXp, and atLevel ignore capDisplay past level 9', () => {
    const h = setCapDisplay(newHunter(RULES), 'E');
    expect(capDisplayChip(h.capDisplay, RULES)).toBe('Cap: 9');

    // Enough XP from level 1 to cross well past level 9 (levels 1..11 total 6,600 XP at default xpPerLevel = 100).
    const xpNeededFor12 = RULES.xpPerLevel * 12 * 11 / 2;
    const raw = gainXp(h, xpNeededFor12, RULES);
    expect(raw.to).toBe(12);
    expect('capDisplay' in raw.progress).toBe(false);

    const leveled = addXp(h, xpNeededFor12, RULES);
    expect(leveled.level).toBe(12);
    expect(leveled.capDisplay).toBe('E');

    const edited = atLevel(h, 25, 0, RULES);
    expect(edited.level).toBe(25);
    expect(edited.capDisplay).toBe('E');
  });

  test('capDisplayChip and capDisplayLevel derive live from RULES.rankLevels and update on rankLevels edits', () => {
    expect(CAP_DISPLAY_RANKS.map(r => [r, capDisplayLevel(r, RULES), capDisplayChip(r, RULES)])).toEqual([
      ['E', 9, 'Cap: 9'],
      ['D', 19, 'Cap: 19'],
      ['C', 34, 'Cap: 34'],
      ['B', 49, 'Cap: 49'],
      ['A', 69, 'Cap: 69'],
    ]);
    expect(capDisplayChip('S', RULES)).toBe('Cap: none');
    expect(capDisplayChip('none', RULES)).toBe('Cap: none');
    expect(capDisplayChip(null, RULES)).toBeNull();

    const edited = rulesOf({ rankLevels: { D: 12, C: 25 } });
    expect(capDisplayLevel('E', edited)).toBe(11);
    expect(capDisplayChip('E', edited)).toBe('Cap: 11');
    expect(capDisplayLevel('D', edited)).toBe(24);
    expect(capDisplayChip('D', edited)).toBe('Cap: 24');
    expect(capDisplayOptionLabel('E', edited)).toBe('E (Cap: 11)');
    expect(capDisplayOptionLabel(null, edited)).toBe('Hidden');
    expect(capDisplayOptionLabel('none', edited)).toBe('None (Cap: none)');
  });

  test('parseCapDisplay repairs unknown values to null while parseCapDisplayStrict refuses invalid wire values', () => {
    for (const v of ['E', 'D', 'C', 'B', 'A', 'S', 'none', null] as const) {
      expect(parseCapDisplay(v)).toBe(v);
      expect(parseCapDisplayStrict(v)).toBe(v);
    }
    for (const bad of ['', 'X', 'hidden', 9, true, undefined, {}]) {
      expect(parseCapDisplay(bad)).toBeNull();
      expect(parseCapDisplayStrict(bad)).toBeUndefined();
    }
  });
});
