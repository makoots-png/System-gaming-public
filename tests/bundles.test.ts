// The GM's awards for roleplay (src/core/registry/bundles.ts): the shelf a GM gives from in two taps.
import { describe, expect, test } from 'bun:test';
import { BUILT_IN_BUNDLES, MOMENTS, MOMENT_CHIPS, MOMENT_WORDS, givesLine } from '../src/core/registry/bundles.ts';
import { WORDS_BOUNDS, isEmptyReward, newRewards, parseBundle, parseWords } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import type { Rewards } from '../src/core/rewards.ts';

/** A reward's worth in points, by the idea shelf's yardstick (a title's stat point, 10 max HP, an ability point; 25 XP is a daily). */
const worth = (r: Rewards): number => r.points + r.xp / 50 + Object.entries(r.title?.bonus ?? {}).reduce((n, [k, v]) => n + (k === 'hpMax' ? v / 10 : v), 0);

describe('the shelf of awards for roleplay', () => {
  test('at least 24, each with its own key, read back whole as a bundle', () => {
    expect(BUILT_IN_BUNDLES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(BUILT_IN_BUNDLES.map(b => b.key)).size).toBe(BUILT_IN_BUNDLES.length);
    expect(new Set(BUILT_IN_BUNDLES.map(b => b.name)).size, 'one name each').toBe(BUILT_IN_BUNDLES.length);
    for (const b of BUILT_IN_BUNDLES) {
      expect(b.key.startsWith('seed-')).toBe(true);
      expect(parseBundle(JSON.parse(JSON.stringify(b)))).toEqual({ name: b.name, rewards: b.rewards, window: b.window });
    }
  });

  test('every moment has awards, each with a window the System says, a plain line and a few words of when', () => {
    for (const m of MOMENTS) expect(BUILT_IN_BUNDLES.filter(b => b.moment === m).length, MOMENT_WORDS[m]).toBeGreaterThanOrEqual(m === 'any' ? 1 : 2);
    for (const m of MOMENTS) expect(MOMENT_CHIPS[m].length, `${m}: a chip fits a phone`).toBeLessThanOrEqual(22);
    for (const b of BUILT_IN_BUNDLES) {
      expect(b.when.length, `${b.name}: a few words of when`).toBeGreaterThan(0);
      expect(b.when.length, `${b.name}: one line under its name`).toBeLessThanOrEqual(70);
      expect(b.when, b.name).not.toMatch(/[!—;.]$/);
      expect(b.window.title, b.name).toBe(b.window.title.toUpperCase());
      expect(parseWords(b.window)).toEqual(b.window);
      expect(b.window.title.length).toBeLessThanOrEqual(WORDS_BOUNDS.title);
      for (const t of [b.window.title, b.window.line, b.name, b.when]) expect(t, `${b.name}: no exclamation mark, em dash or semicolon (copy-tasks.md)`).not.toMatch(/[!—;]/);
    }
  });

  test('most are small; a few are rare and large, and only a rare one is large', () => {
    const small = BUILT_IN_BUNDLES.filter(b => worth(b.rewards) <= 1), rare = BUILT_IN_BUNDLES.filter(b => b.rare);
    expect(small.length, 'a line, a boon, a point or an E-rank title').toBeGreaterThanOrEqual(BUILT_IN_BUNDLES.length * 3 / 4);
    expect(rare.length).toBeGreaterThanOrEqual(2);
    expect(rare.length, 'once an arc: a few').toBeLessThanOrEqual(BUILT_IN_BUNDLES.length / 6);
    for (const b of BUILT_IN_BUNDLES) {
      expect(worth(b.rewards), `${b.name}: past a B-rank title and 3 points`).toBeLessThanOrEqual(6);
      if (!b.rare) expect(worth(b.rewards), `${b.name}: past a D-rank title, so rare`).toBeLessThanOrEqual(2);
    }
    expect(BUILT_IN_BUNDLES.some(b => isEmptyReward(b.rewards)), 'some are only the System\'s line').toBe(true);
  });

  test('the shelf says what each gives in one line: a title with its bonus, a boon with what it lets the player do', () => {
    expect(givesLine(newRewards(), RULES)).toBe('Only the System\'s line.');
    const scar = BUILT_IN_BUNDLES.find(b => b.key === 'seed-scar-tissue')!, steady = BUILT_IN_BUNDLES.find(b => b.key === 'seed-steady-under-weight')!;
    expect(givesLine(scar.rewards, RULES)).toBe('Title: Scar Tissue (+1 DIS)');
    expect(givesLine(steady.rewards, RULES)).toBe('Boon: Once, roll one of your d20s again and keep the second roll.');
    expect(givesLine({ ...newRewards(), points: 1, xp: 50 }, RULES)).toBe('+50 XP · +1 ability point');
    for (const b of BUILT_IN_BUNDLES) expect(givesLine(b.rewards, RULES), b.name).not.toContain('acquired');
  });
});

describe('a bundle\'s window words', () => {
  test('read with a title or not at all; cut to their bounds and in the System\'s voice', () => {
    expect(parseWords({ title: 'the system took note', line: 'Seen.' })).toEqual({ title: 'THE SYSTEM TOOK NOTE', line: 'Seen.' });
    expect(parseWords({ title: '  ', line: 'x' })).toBeNull();
    expect(parseWords('junk')).toBeNull();
    expect(parseWords({ title: 'X'.repeat(90), line: 'y'.repeat(300) })).toEqual({ title: 'X'.repeat(WORDS_BOUNDS.title), line: 'y'.repeat(WORDS_BOUNDS.line) });
    expect(parseBundle({ name: 'Plain', rewards: {}, window: { title: '' } })).not.toHaveProperty('window');
  });
});
