// The reward editor's form (src/core/reward-rows.ts): a reward opened into rows and written back. What the editor does
// not edit of a thing it opens goes back as it came, so a feat opened in the feat maker and saved unchanged is the feat
// as it shipped, and the library keeps no entry for it (library.ts `saveFeat`).
import { describe, expect, test } from 'bun:test';
import { blankRow, pickTitle, rewardForm, rewardOfForm } from '../src/core/reward-rows.ts';
import type { RewardRow } from '../src/core/reward-rows.ts';
import { parseRewards } from '../src/core/rewards.ts';
import type { Rewards } from '../src/core/rewards.ts';
import { BUILT_IN_FEATS } from '../src/core/registry/feats.ts';
import { parseFeat } from '../src/core/hunter/feats.ts';
import { saveFeat } from '../src/core/library.ts';
import { newSave } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { RULES } from '../src/core/rules.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import { tiles } from '../src/core/combat/space.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { dev } from './fixtures/ids.ts';

/** `rw` as the editor opens it (`parseRewards` of its initial value, then its rows) and writes it back, read again. */
const roundTrip = (rw: unknown): Rewards | null => parseRewards(rewardOfForm(rewardForm(parseRewards(rw)!), RULES));
const titleOf = (rows: RewardRow[]) => {
  const t = rows.find(r => r.kind === 'title');
  if (t?.kind !== 'title') throw new Error('no title row');
  return t;
};
const SHIELD_UP = abilityOf('support', { id: abilityId('shield-up'), name: 'Shield Up', aim: 'self', shape: { kind: 'self' }, range: tiles(0) }, RULES);

describe('a reward opened in the editor and saved unchanged', () => {
  test('every built-in feat\'s reward comes back as it shipped, and saving the feat leaves the library without an entry for it', () => {
    expect(BUILT_IN_FEATS.some(([, d]) => d.rewards.title?.band && d.rewards.title.band !== 'E'), 'a built-in title has a band past E').toBe(true);
    const lib = newSave(dev('d')).library;
    for (const [key, def] of BUILT_IN_FEATS) {
      const rewards = roundTrip(def.rewards);
      expect(rewards, key).toEqual(def.rewards);
      const saved = saveFeat(lib, key, parseFeat({ ...def, rewards })!);
      expect(isRefused(saved) ? saved : Object.hasOwn(saved.feats, key), key).toBe(false);
    }
  });

  test('a title keeps its band and its active', () => {
    const rw = parseRewards({ title: { name: 'Last Light', desc: 'Held the door.', bonus: { vit: 2 }, band: 'C', active: SHIELD_UP } })!;
    expect(rw.title?.active, 'the title reads with its active').toBeDefined();
    expect(roundTrip(rw)).toEqual(rw);
  });
});

describe('a title row the GM changes', () => {
  test('renamed, it keeps its band and its active and is no longer the rule title it copied', () => {
    const rw = parseRewards({ title: { name: 'Wolf Slayer', key: 'wolf-slayer', desc: '', bonus: { str: 2 }, band: 'D', active: SHIELD_UP } })!;
    const form = rewardForm(rw);
    const row = titleOf(form.rows);
    row.name = 'Pack Breaker'; row.pick = '';
    const out = parseRewards(rewardOfForm(form, RULES))!;
    expect(out.title).toEqual({ name: 'Pack Breaker', desc: '', bonus: { str: 2 }, band: 'D', active: rw.title!.active });
  });

  test('picking a rule title takes its words, bonus and band; picking a new title starts from nothing, with no band', () => {
    const seed = RULES.titles.find(t => t.key === 'king-of-shadows')!;
    const picked = pickTitle(titleOf([blankRow('title', [])]), RULES, seed.key);
    expect(parseRewards(rewardOfForm({ nums: { xp: 0, gold: 0, points: 0 }, rows: [picked] }, RULES))!.title)
      .toEqual({ name: seed.name, desc: seed.desc, bonus: seed.bonus, key: seed.key, band: seed.band });
    const fresh = { ...pickTitle(picked, RULES, ''), name: 'Odd' };
    expect(parseRewards(rewardOfForm({ nums: { xp: 0, gold: 0, points: 0 }, rows: [fresh] }, RULES))!.title).toEqual({ name: 'Odd', desc: '', bonus: {} });
  });

  test('a band and an active set on a new title row are written, and E and none leave them out', () => {
    const row = { ...titleOf([blankRow('title', [])]), name: 'Last Light', band: 'C' as const, active: SHIELD_UP };
    const out = parseRewards(rewardOfForm({ nums: { xp: 0, gold: 0, points: 0 }, rows: [row] }, RULES))!;
    expect(out.title, 'the band and the active the GM chose').toEqual({ name: 'Last Light', desc: '', bonus: {}, band: 'C', active: SHIELD_UP });
    const plain = parseRewards(rewardOfForm({ nums: { xp: 0, gold: 0, points: 0 }, rows: [{ ...row, band: null, active: null }] }, RULES))!;
    expect(plain.title, 'cleared, the title has neither').toEqual({ name: 'Last Light', desc: '', bonus: {} });
  });
});
