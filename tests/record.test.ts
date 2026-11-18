import { jobOf } from '../src/core/save.ts';
import { describe, expect, test } from 'bun:test';
import { cleanName, dropBoon, giveBoons, giveTitle, holdsTitle, nameActiveTitle, reevaluate, removeTitle, rename, setJob, setRank, toggleTitle, writeTitle } from '../src/core/hunter/record.ts';
import { RULES, rankForLevel } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import type { Hunter } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';

const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const hunter = (): Hunter => newHunter(RULES);
const SEEDS = [{ key: 'wolf-slayer', name: 'Wolf Slayer', desc: 'Felled the pack leader.', bonus: { str: 1 } }];

describe('name, job and rank', () => {
  test('a name is cleaned and cut to 60 characters; a blank one is refused', () => {
    expect(ok(rename(hunter(), '  Mira   Vale ')).name).toBe('Mira Vale');
    expect(ok(rename(hunter(), 'x'.repeat(80))).name).toHaveLength(60);
    expect(rename(hunter(), '   ')).toEqual({ ok: false, why: 'blank' });
    expect(cleanName(null)).toBe('');
  });

  test('round trip: a job set and set back is what it was; no job is null, from a blank or the old word "None"', () => {
    const h = hunter();
    expect(h.job, 'a new hunter has none').toBeNull();
    expect(setJob(setJob(h, 'Tanker'), h.job)).toEqual(h);
    expect(setJob(setJob(h, 'Tanker'), ' ').job).toBeNull();
    expect([jobOf('None'), jobOf('  Shadow  Monarch '), jobOf(7)]).toEqual([null, 'Shadow Monarch', null]);
  });

  test('the GM\'s rank is a rank or stays; re-evaluation raises the rank to what the level earns, never lowers it', () => {
    expect(setRank(hunter(), 'B').rank).toBe('B');
    expect(setRank(hunter(), 'Z').rank).toBe('E');
    // The level that earns the next rank is read from the rules, not written here.
    const level = Array.from({ length: 200 }, (_, i) => i + 1).find(l => rankForLevel(RULES, l) !== 'E')!;
    const up = ok(reevaluate({ ...hunter(), level }, RULES));
    expect(up.rank).toBe(rankForLevel(RULES, level));
    expect(reevaluate(hunter(), RULES)).toEqual({ ok: false, why: 'not-eligible' });
    expect(reevaluate({ ...hunter(), level, rank: 'S' }, RULES)).toEqual({ ok: false, why: 'not-eligible' });
  });
});

describe('titles', () => {
  test('a rule title by its key takes its words, bonus and key; one already held is not given twice, even renamed', () => {
    const h = giveTitle(hunter(), { key: 'wolf-slayer' }, 't1', SEEDS);
    expect(h.titles).toEqual([{ id: 't1', name: 'Wolf Slayer', desc: 'Felled the pack leader.', bonus: { str: 1 }, seedKey: 'wolf-slayer' }]);
    expect(giveTitle(h, { key: 'wolf-slayer' }, 't2', SEEDS)).toBe(h);
    const renamed = ok(writeTitle(h, 't1', { name: 'Pack Breaker', desc: '', bonus: {} }));
    expect(holdsTitle(renamed, { key: 'wolf-slayer' }, SEEDS), 'the GM renamed it: still held').toBe(true);
    const own = giveTitle(hunter(), 'Wolf Slayer', 't9', SEEDS);
    expect(holdsTitle(own, { key: 'wolf-slayer' }, SEEDS), 'a bare title of the same name is another title').toBe(false);
    expect(giveTitle(hunter(), { name: 'Own', desc: 'mine' }, 't3', SEEDS).titles[0]).toEqual({ id: 't3', name: 'Own', desc: 'mine', bonus: {} });
  });

  test('round trip: a title given then removed leaves the hunter as it was, even when it was active', () => {
    const h = hunter();
    const given = giveTitle(h, { key: 'wolf-slayer' }, 't1', SEEDS);
    // but for what the System remembers: the title given stays a fact of the chronicle
    const same = (x: typeof h) => ({ ...x, chronicle: h.chronicle });
    expect(same(ok(removeTitle(given, 't1')))).toEqual(h);
    expect(same(ok(removeTitle(ok(toggleTitle(given, 't1')), 't1')))).toEqual(h);
    expect(given.chronicle.inbox).toEqual([{ kind: 'title', name: 'Wolf Slayer' }]);
  });

  test('round trip: set active then unset is where it started', () => {
    const given = giveTitle(hunter(), { key: 'wolf-slayer' }, 't1', SEEDS);
    expect(ok(toggleTitle(ok(toggleTitle(given, 't1')), 't1'))).toEqual(given);
    expect(toggleTitle(given, 'nope')).toEqual({ ok: false, why: 'no-title' });
  });

  test('the GM\'s form writes a new title or edits one in place; the identity box names the active title or makes one', () => {
    const h = ok(writeTitle(hunter(), 't1', { name: ' Hero ', desc: 'd', bonus: { vit: 2 } }));
    expect(h.titles).toEqual([{ id: 't1', name: 'Hero', desc: 'd', bonus: { vit: 2 } }]);
    expect(ok(writeTitle(h, 't1', { name: 'Hero II', desc: '', bonus: {} })).titles).toEqual([{ id: 't1', name: 'Hero II', desc: '', bonus: {} }]);
    expect(writeTitle(h, 't1', { name: '', desc: '', bonus: {} })).toEqual({ ok: false, why: 'blank' });
    const made = nameActiveTitle(hunter(), 'Nameless', 't9');
    expect(made).toMatchObject({ titleId: 't9', titles: [{ id: 't9', name: 'Nameless' }] });
    expect(nameActiveTitle(made, 'Named', 'unused').titles).toEqual([{ id: 't9', name: 'Named', desc: '', bonus: {} }]);
    expect(nameActiveTitle(made, '', 'unused').titleId).toBeNull();
  });
});

describe('boons', () => {
  test('round trip: a boon given then taken back leaves the hunter as it was; one not held is refused', () => {
    const h = hunter();
    const given = giveBoons(h, [{ id: 'bn1', name: 'Favor', text: 'Ask once' }], '2026-11-14T10:00:00Z');
    expect(given.boons).toEqual([{ id: 'bn1', name: 'Favor', text: 'Ask once', at: '2026-11-14T10:00:00Z' }]);
    expect(ok(dropBoon(given, 'bn1'))).toEqual(h);
    expect(dropBoon(h, 'bn1')).toEqual({ ok: false, why: 'no-boon' });
  });
});
