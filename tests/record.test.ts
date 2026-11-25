import { jobOf } from '../src/core/save.ts';
import { describe, expect, test } from 'bun:test';
import type { Powers } from '../src/core/registry/powers.ts';
import { cleanName, dropBoon, giveBoons, giveTitle, holdsTitle, nameActiveTitle, rankStanding, rankStep, titleNamed, reevaluate, removeTitle, rename, setRank, toggleTitle, writeTitle } from '../src/core/hunter/record.ts';
import { setJob } from '../src/core/hunter/classes.ts';
import type { ProgressRank, ProgressRankEvent } from '../src/core/hunter/record.ts';
import { atLevel } from '../src/core/hunter/progress.ts';
import { levelled } from '../src/core/hunter/grant.ts';
import { record } from '../src/core/hunter/chronicle.ts';
import { saveId } from '../src/core/ids.ts';
import { day } from './fixtures/ids.ts';
import type { Rank } from '../src/core/rules.ts';
import { RULES, rankForLevel } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import { parseSheetHunter } from '../src/core/hunter/hunter.ts';
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
    expect(ok(setJob(ok(setJob(h, 'Tanker')), h.job))).toEqual(h);
    expect(ok(setJob(ok(setJob(h, 'Tanker')), ' ')).job).toBeNull();
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

describe('the rank, a machine: where it stands against the rank the level earns (SMX-rules-7)', () => {
  // The shipped rules: rank D from level 10, A from level 50 (RULES.rankLevels), read here so a change to them moves
  // the cases with it.
  const D = RULES.rankLevels.D, A = RULES.rankLevels.A;
  const ranked = (rank: Rank, level: number, rankBy: Hunter['rankBy'] = 'level'): Hunter => ({ ...hunter(), rank, level, rankBy });
  // `above` is a rank kept from levels now lost (the level's); `aboveByHand` the GM's, set by hand
  const follows = () => ranked('E', 1), behind = () => ranked('E', D), above = () => ranked('A', 1), aboveByHand = () => ranked('A', 1, 'gm');
  const facts = (h: Hunter) => h.chronicle.inbox.filter(f => f.kind === 'rank');
  type Row = [name: string, from: () => Hunter, event: ProgressRankEvent, after: { rank: Rank; at: ProgressRank['at']; by: Hunter['rankBy'] } | Refused];

  const ROWS: Row[] = [
    ['follows × re-evaluate: refused, the level earns no higher rank', follows, { type: 'reevaluate' }, { ok: false, why: 'not-eligible' }],
    ['follows × the GM sets B: rank B, above its level, set by hand', follows, { type: 'set', rank: 'B' }, { rank: 'B', at: 'above', by: 'gm' }],
    ['follows × the level moved: the rank stays', follows, { type: 'levelMoved' }, { rank: 'E', at: 'follows', by: 'level' }],
    ['behind × re-evaluate: the rank its level earns', behind, { type: 'reevaluate' }, { rank: 'D', at: 'follows', by: 'level' }],
    ['behind × the GM sets C: rank C, set by hand', behind, { type: 'set', rank: 'C' }, { rank: 'C', at: 'above', by: 'gm' }],
    ['behind × the level moved: the rank stays, re-evaluation still offered', behind, { type: 'levelMoved' }, { rank: 'E', at: 'behind', by: 'level' }],
    ['above × re-evaluate: refused, the level earns a lower rank', above, { type: 'reevaluate' }, { ok: false, why: 'not-eligible' }],
    ['above × the GM sets E: the rank its level earns, set by hand', above, { type: 'set', rank: 'E' }, { rank: 'E', at: 'follows', by: 'gm' }],
    // SMX-rules-7.2: the rank follows a level lost unless the GM set it by hand (the owner, Nov 22: "Yes")
    ['above, the level\'s × the level moved: the rank its level earns (SMX-rules-7.2)', above, { type: 'levelMoved' }, { rank: 'E', at: 'follows', by: 'level' }],
    ['above, set by hand × the level moved: the rank stays (SMX-rules-7.2)', aboveByHand, { type: 'levelMoved' }, { rank: 'A', at: 'above', by: 'gm' }],
    ['above, set by hand × re-evaluate: refused', aboveByHand, { type: 'reevaluate' }, { ok: false, why: 'not-eligible' }],
  ];

  test('the standing is read from the rank and the level: follows, behind (with the rank it earns) or above', () => {
    expect(rankStanding(follows(), RULES)).toEqual({ at: 'follows' });
    expect(rankStanding(behind(), RULES)).toEqual({ at: 'behind', earns: 'D' });
    expect(rankStanding(above(), RULES)).toEqual({ at: 'above', earns: 'E' });
  });

  for (const [name, from, event, after] of ROWS) {
    test(name, () => {
      const h = from(), got = rankStep(h, event, RULES);
      if (isRefused(after)) return void expect(got).toEqual(after);
      const next = ok(got);
      expect(next.rank).toBe(after.rank);
      expect(rankStanding(next, RULES).at).toBe(after.at);
      expect(next.rankBy).toBe(after.by);
      expect(facts(next), 'a new rank is a fact of the chronicle, an unmoved one is not').toEqual(after.rank === h.rank ? [] : [{ kind: 'rank', rank: after.rank }]);
    });
  }

  test('a level change goes through rankStep: levelled gives what the rank machine gives for a moved level, from each standing', () => {
    const at = '2026-01-01T00:00:00.000Z', today = { at, today: day(at.slice(0, 10)), R: RULES };
    for (const from of [follows, behind, above]) {
      const before = from(), moved = { ...before, level: before.level + 1 };
      const got = levelled(before.level, moved, today, p => saveId(p, 1)).hunter;
      expect(got).toEqual(ok(rankStep(record(moved, { kind: 'level', level: moved.level }), { type: 'levelMoved' }, RULES)));
    }
  });

  test('the GM\'s word that is not a rank keeps the rank and records nothing', () => {
    for (const from of [follows, behind, above]) expect(ok(rankStep(from(), { type: 'set', rank: 'Z' }, RULES))).toEqual(from());
  });

  test('SMX-rules-7.2: a rank A hunter taken from level 50 to 1 by the GM\'s level edit is rank E; one whose rank the GM set by hand keeps rank A', () => {
    const lost = levelled(A, atLevel(ranked('A', A), 1, 0, RULES), { at: '2026-01-01T00:00:00.000Z', today: day('2026-01-01'), R: RULES }, p => saveId(p, 1)).hunter;
    expect([lost.level, lost.rank, rankStanding(lost, RULES)]).toEqual([1, 'E', { at: 'follows' }]);
    const kept = levelled(A, atLevel(setRank(ranked('A', A), 'A'), 1, 0, RULES), { at: '2026-01-01T00:00:00.000Z', today: day('2026-01-01'), R: RULES }, p => saveId(p, 1)).hunter;
    expect([kept.level, kept.rank, rankStanding(kept, RULES)]).toEqual([1, 'A', { at: 'above', earns: 'E' }]);
    expect(reevaluate(kept, RULES)).toEqual({ ok: false, why: 'not-eligible' });
  });
});

describe('a title\'s worn status (feature 1\'s notes 17.14)', () => {
  const STEADY = { label: 'Steady', desc: '', ops: [] };
  const IRON = { label: 'Iron', desc: '', ops: [] };
  test('a written title keeps its worn status; given in another\'s place it takes the new one\'s; the GM\'s edit keeps it', () => {
    const h = giveTitle(hunter(), { name: 'Iron Nerve', desc: '', worn: STEADY }, 't1', SEEDS);
    expect(h.titles[0]!.worn).toEqual(STEADY);
    const grown = giveTitle({ ...h, titleId: 't1' }, { name: 'Iron Will', worn: IRON, replaces: 'Iron Nerve' }, 't2', SEEDS);
    expect(grown.titles.map(t => [t.id, t.name, t.worn])).toEqual([['t1', 'Iron Will', IRON]]);
    expect(grown.titleId).toBe('t1');
    expect(giveTitle(h, { name: 'Plain', replaces: 'Iron Nerve' }, 't3', SEEDS).titles[0]!.worn, 'a title with none in another\'s place leaves none').toBeUndefined();
    expect(ok(writeTitle(h, 't1', { name: 'Renamed', desc: '', bonus: {} })).titles[0]!.worn).toEqual(STEADY);
  });
  test('a written title keeps its active too, when given and through the GM\'s edit', () => {
    const ACTIVE = { id: 'a1', name: 'Bulwark' } as unknown as NonNullable<Powers['active']>;
    const h = giveTitle(hunter(), { name: 'Last Light', desc: '', active: ACTIVE }, 't1', SEEDS);
    expect(h.titles[0]!.active).toEqual(ACTIVE);
    expect(ok(writeTitle(h, 't1', { name: 'Renamed', desc: '', bonus: {} })).titles[0]!.active).toEqual(ACTIVE);
  });
});

describe('a title\'s band (item-stats 6.7)', () => {
  test('a written title keeps its band, in another\'s place too; a rule title by its key takes the rule\'s', () => {
    const h = giveTitle(hunter(), { name: 'Last Light', desc: '', band: 'C' }, 't1', SEEDS);
    expect(h.titles[0]!.band).toBe('C');
    expect(giveTitle(h, { name: 'Last Light II', band: 'B', replaces: 'Last Light' }, 't2', SEEDS).titles.map(t => [t.id, t.band])).toEqual([['t1', 'B']]);
    expect(giveTitle(hunter(), { key: 'wolf-slayer' }, 't1', [{ ...SEEDS[0]!, band: 'D' as Rank }]).titles[0]!.band).toBe('D');
    expect(giveTitle(hunter(), { name: 'Plain' }, 't1', SEEDS).titles[0], 'none given, none held: read as E').not.toHaveProperty('band');
  });

  test('a held title keeps a band that is a rank through the hunter\'s repair, and loses one that is not', () => {
    const held = (band: unknown) => parseSheetHunter(JSON.parse(JSON.stringify({ ...hunter(), id: 'h1', titles: [{ id: 't1', name: 'Last Light', desc: '', bonus: {}, band }] })))!.titles[0]!;
    expect(held('C').band).toBe('C');
    for (const band of ['c', 'X', 3, null]) expect(held(band), String(band)).not.toHaveProperty('band');
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

  test('a title given in place of the active one keeps its id, its place in the list and stays active, with the new words and bonus', () => {
    const debt = giveTitle(giveTitle(hunter(), { name: 'First', desc: '', bonus: {} }, 't1', SEEDS), { name: 'Owed to the Deep', desc: 'It is owed.', bonus: { vit: -1 } }, 't2', SEEDS);
    const active = ok(toggleTitle(giveTitle(debt, { name: 'Last', desc: '', bonus: {} }, 't3', SEEDS), 't2'));
    const h = giveTitle(active, { name: 'Square', desc: 'Paid in full.', bonus: { vit: 2 }, replaces: 'Owed to the Deep' }, 't9', SEEDS);
    expect(h.titles).toEqual([
      { id: 't1', name: 'First', desc: '', bonus: {} }, { id: 't2', name: 'Square', desc: 'Paid in full.', bonus: { vit: 2 } }, { id: 't3', name: 'Last', desc: '', bonus: {} },
    ]);
    expect(String(h.titleId)).toBe('t2');
    expect(h.chronicle.inbox.at(-1), 'a title given in another\'s place is a title given').toEqual({ kind: 'title', name: 'Square' });
  });

  test('a title that names one the hunter does not hold is given beside the rest; one the hunter already holds gives nothing', () => {
    const own = giveTitle(hunter(), { name: 'Own', desc: '', bonus: {} }, 't1', SEEDS);
    const beside = giveTitle(own, { name: 'Square', desc: '', bonus: {}, replaces: 'Owed to the Deep' }, 't2', SEEDS);
    expect(beside.titles.map(t => [t.id, t.name])).toEqual([['t1', 'Own'], ['t2', 'Square']]);
    const again = giveTitle(beside, { name: 'Square', desc: 'other words', bonus: { str: 9 }, replaces: 'Own' }, 't3', SEEDS);
    expect(again, 'Square is held, so Own stays and nothing is recorded').toEqual(beside);
  });

  test('a rule title is replaced by its key, under whatever name the hunter gave it; a rule title given in another\'s place records its key', () => {
    const wolf = giveTitle(hunter(), { key: 'wolf-slayer' }, 't1', SEEDS), renamed = { ...wolf, titles: wolf.titles.map(t => ({ ...t, name: 'Pack Breaker' })) };
    expect(String(titleNamed(renamed, 'Wolf Slayer', SEEDS)?.id)).toBe('t1');
    expect(String(titleNamed(renamed, 'Pack Breaker', SEEDS)?.id), 'the name it shows finds it too').toBe('t1');
    expect(titleNamed(renamed, 'Unheld', SEEDS)).toBeUndefined();
    const grown = giveTitle(renamed, { name: 'Alpha', desc: '', bonus: {}, replaces: 'Wolf Slayer' }, 't2', SEEDS);
    expect(grown.titles, 'a title of the GM\'s own keeps no rule key').toEqual([{ id: 't1', name: 'Alpha', desc: '', bonus: {} }]);
    const back = giveTitle(grown, { name: 'Wolf Slayer', desc: 'Felled the pack leader.', bonus: { str: 1 }, key: 'wolf-slayer', replaces: 'Alpha' }, 't3', SEEDS);
    expect(back.titles).toEqual([{ id: 't1', name: 'Wolf Slayer', desc: 'Felled the pack leader.', bonus: { str: 1 }, seedKey: 'wolf-slayer' }]);
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
