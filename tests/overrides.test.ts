// The GM's rule overrides: each list, null and open map of the rules is read entry by entry by its rule's reader
// (src/core/overrides.ts), so an entry that is not the rule's shape is refused by its path, and real data that leaves out
// an optional field still loads. The other cases (unknown rules, a value of the wrong type) are in tests/rules.test.ts.
import { describe, expect, test } from 'bun:test';
import { parseOverrides, readerOf } from '../src/core/overrides.ts';
import { RULES, clearOf, rulesOf } from '../src/core/rules.ts';
import { priceOf } from '../src/core/registry/items.ts';

/** Each path of RULES whose shipped value cannot read an override: a list, a null, or a map the GM may add to. */
function unreadable(v: unknown, path: string, out: string[]): string[] {
  if (path === 'conditions') return out;
  if (Array.isArray(v) || v === null || path === 'rarities') out.push(path);
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) unreadable(x, path ? `${path}.${k}` : k, out);
  return out;
}

describe('every list rule has a reader', () => {
  test('each list, null and open map of the rules has the reader of its entries', () => {
    const paths = unreadable(RULES, '', []);
    expect(paths.length, 'the walk finds the lists').toBeGreaterThan(20);
    expect(paths.filter(p => !readerOf(p))).toEqual([]);
  });
});

describe('an override of a list rule', () => {
  test('a title that is not a title is refused by its index, and the GM\'s titles around it are kept', () => {
    const { overrides, refused } = parseOverrides({ titles: [{ name: 'Gatebreaker', desc: 'Broke a red gate.', bonus: { str: 3 } }, { desc: 'no name' }, 'Slayer', { name: 'Odd', bonus: { luck: 2 } }] });
    expect(overrides).toEqual({ titles: [{ key: 'gatebreaker', name: 'Gatebreaker', desc: 'Broke a red gate.', bonus: { str: 3 } }] });
    expect(refused).toEqual([{ path: 'titles.1', reason: 'entry' }, { path: 'titles.2', reason: 'entry' }, { path: 'titles.3', reason: 'entry' }]);
  });

  test('a title renamed by an override keeps the key it gives, and a GM-only title stays GM-only', () => {
    const { overrides } = parseOverrides({ titles: [{ key: 'wolf-slayer', name: 'Pack Breaker', gmOnly: true }] });
    expect(overrides.titles).toEqual([{ key: 'wolf-slayer', name: 'Pack Breaker', desc: '', bonus: {}, gmOnly: true }]);
  });

  test('a GM\'s title without a description or a bonus, and an objective without its progress, still load', () => {
    const { overrides, refused } = parseOverrides({ titles: [{ name: 'Survivor' }], dailyTemplate: { objectives: [{ label: 'Laps', target: 5 }] } });
    expect(refused).toEqual([]);
    expect(overrides).toEqual({ titles: [{ key: 'survivor', name: 'Survivor', desc: '', bonus: {} }], dailyTemplate: { objectives: [{ label: 'Laps', target: 5, progress: 0 }] } });
    expect(rulesOf(overrides).dailyTemplate.objectives).toEqual([{ label: 'Laps', target: 5, progress: 0 }]);
  });

  test('a daily objective with no label or a target of 0 is refused by its index', () => {
    const { overrides, refused } = parseOverrides({ dailyTemplate: { objectives: [{ label: 'Push-ups', target: 50 }, { target: 3 }, { label: 'Rest', target: 0 }] } });
    expect(overrides).toEqual({ dailyTemplate: { objectives: [{ label: 'Push-ups', target: 50, progress: 0 }] } });
    expect(refused).toEqual([{ path: 'dailyTemplate.objectives.1', reason: 'entry' }, { path: 'dailyTemplate.objectives.2', reason: 'entry' }]);
  });

  test('a path tier holds perks: a tier with an unknown bonus key is refused, the others kept', () => {
    const { overrides, refused } = parseOverrides({ paths: { vanguard: { tiers: [[{ str: 3 }, { hpMax: 25 }], [{ charm: 2 }]] } } });
    expect(overrides).toEqual({ paths: { vanguard: { tiers: [[{ str: 3 }, { hpMax: 25 }]] } } });
    expect(refused).toEqual([{ path: 'paths.vanguard.tiers.1', reason: 'entry' }]);
  });

  test('the daily reward\'s items, skills and title are read as a reward\'s are', () => {
    const { overrides, refused } = parseOverrides({ dailyTemplate: { rewards: { items: [{ name: 'Ration' }, 7], skills: [{ name: 'Second Wind' }], title: { name: 'Early Riser' }, job: 'Monk' } } });
    expect(refused).toEqual([{ path: 'dailyTemplate.rewards.items.1', reason: 'entry' }]);
    const r = rulesOf(overrides).dailyTemplate.rewards;
    expect([r.items.map(i => i.name), r.skills.map(k => k.name), r.title?.name, r.job]).toEqual([['Ration'], ['Second Wind'], 'Early Riser', 'Monk']);
    expect(parseOverrides({ dailyTemplate: { rewards: { title: 5, job: null } } }).refused).toEqual([{ path: 'dailyTemplate.rewards.title', reason: 'entry' }]);
  });

  test('jobs, gate names and slots are text: an entry that is not is refused by its index', () => {
    const { overrides, refused } = parseOverrides({ jobs: ['Fighter', 3, ''], gateNames: ['Hollow Keep'] });
    expect(overrides).toEqual({ jobs: ['Fighter'], gateNames: ['Hollow Keep'] });
    expect(refused).toEqual([{ path: 'jobs.1', reason: 'entry' }, { path: 'jobs.2', reason: 'entry' }]);
  });

  test('a rank\'s three DCs and a range\'s two ends keep their length', () => {
    const { overrides, refused } = parseOverrides({ rankTable: { E: { dc: [10, 12] }, D: { dc: [12, 14, 'x'] }, C: { dc: [18, 20, 22] } }, loot: { E: { gold: [10, 60, 90] } }, gateSpawn: { regulars: { E: [2, 4] } } });
    expect(overrides).toEqual({ rankTable: { E: {}, D: {}, C: { dc: [18, 20, 22] } }, loot: { E: {} }, gateSpawn: { regulars: { E: [2, 4] } } });
    expect(refused).toEqual([{ path: 'rankTable.E.dc', reason: 'length' }, { path: 'rankTable.D.dc.2', reason: 'number' }, { path: 'loot.E.gold', reason: 'length' }]);
  });

  test('a new rarity needs its color and its rank; a shipped one may change either alone; a price factor is no rule', () => {
    const { overrides, refused } = parseOverrides({ rarities: { common: { color: '#ffffff' }, rare: { rank: 'B' }, epic: { mult: 2 }, relic: { color: '#000000', rank: 'S' }, cursed: { color: '#330000' }, broken: { color: '#111111', rank: 'Z' } } });
    expect(overrides).toEqual({ rarities: { common: { color: '#ffffff' }, rare: { rank: 'B' }, epic: {}, relic: { color: '#000000', rank: 'S' } } });
    expect(refused.map(r => [r.path, r.reason])).toEqual([['rarities.epic.mult', 'unknown'], ['rarities.cursed', 'entry'], ['rarities.broken.rank', 'entry']]);
    const R = rulesOf(overrides);
    expect(R.rarities.rare).toEqual({ color: RULES.rarities.rare.color, rank: 'B' });
    expect(priceOf(R, 'rare')).toBe(clearOf(R, 'B'));
  });

  // A number of the System's clock that would break it (0 hours spawns without end) is refused at the boundary, by its path.
  test('the personal gates\' numbers keep their bounds: hours and the stay 1 to 168, held 1 to 10, a share 0 to 100, a pack of 1 to 12 low to high', () => {
    const { overrides, refused } = parseOverrides({ solo: { hours: 0, held: 11, stays: 169, ranks: { below: 101, same: 50 }, pack: [3, 2], personal: false } });
    expect(overrides).toEqual({ solo: { ranks: { same: 50 }, personal: false } });
    expect(refused.map(r => [r.path, r.reason])).toEqual([['solo.hours', 'range'], ['solo.held', 'range'], ['solo.stays', 'range'], ['solo.ranks.below', 'range'], ['solo.pack', 'order']]);
    const kept = parseOverrides({ solo: { hours: 4, held: 6, stays: 48, pack: [2, 4] } });
    expect(kept.refused).toEqual([]);
    expect(rulesOf(kept.overrides).solo).toEqual({ ...RULES.solo, hours: 4, held: 6, stays: 48, pack: [2, 4] });
  });
  test('the trading switch is true or false: anything else is refused and trading stays on', () => {
    expect(parseOverrides({ trade: { on: false } })).toEqual({ overrides: { trade: { on: false } }, refused: [] });
    expect(rulesOf(parseOverrides({ trade: { on: false } }).overrides).trade.on).toBe(false);
    const bad = parseOverrides({ trade: { on: 'no', limit: 3 } });
    expect(bad.refused.map(r => [r.path, r.reason])).toEqual([['trade.on', 'boolean'], ['trade.limit', 'unknown']]);
    expect(rulesOf(bad.overrides).trade.on).toBe(true);
  });
});
