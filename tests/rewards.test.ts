// What a reward may hold (src/core/rewards.ts): one reader for a save's quest, a bundle, a room's award and a form.
import { describe, expect, test } from 'bun:test';
import { grantLines, newRewards, parseRewards, rewardLines, saveBundle, titleReward } from '../src/core/rewards.ts';
import type { Rewards } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import { SHOP_ITEMS, itemOf } from '../src/core/registry/items.ts';
import type { ItemTemplate } from '../src/core/registry/items.ts';
import { SKILL_SEEDS, skillOf } from '../src/core/registry/skills.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { finishQuest, grant, sheetEdit } from '../src/core/hunter/grant.ts';
import { useItem } from '../src/core/hunter/use.ts';
import { settleClear } from '../src/core/gates/pay.ts';
import { questIn } from './models/quest-events.ts';
import { den } from './models/gate-events.ts';
import type { Granted } from '../src/core/hunter/grant.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { hpOf } from '../src/core/hunter/vitals.ts';
import { available, levelPoints, pendingTotal } from '../src/core/hunter/progress.ts';
import { freshSave } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { day, dev } from './fixtures/ids.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
const BIG = 'x'.repeat(100_000);
const POTION: ItemTemplate = { ...itemOf(RULES, SHOP_ITEMS.find(i => i.name === 'Health Potion')!), qty: 2 };
const SLASH = { ...skillOf(SKILL_SEEDS.find(k => k.name === 'Mutilation')!, RULES), name: 'Slash' };
/** A reward that uses every field, as a GM would build one. */
const FULL: Rewards = {
  xp: 250, points: 2, gold: -40, items: [POTION], title: { name: 'Gatebreaker', desc: 'Broke a red gate.', bonus: { str: 2, hpMax: 10 } }, job: 'Ranger',
  skills: [SLASH], statuses: [{ key: statusKey('hasted'), rounds: 3 }, { key: statusKey('blessed-by-gm'), rounds: null, def: { label: 'Blessed', desc: 'The GM smiles.', ops: [] } }],
  boons: [{ name: 'Free resurrection', text: 'Once, the GM brings you back at 1 HP.' }],
};
const read = (fields: Record<string, unknown>): Rewards => parseRewards({ ...copy(FULL), ...fields })!;

describe('a reward read back', () => {
  test('a reward with every field comes through as it was written', () => {
    expect(parseRewards(copy(FULL))).toEqual(FULL);
  });

  test('an empty object is the empty reward, and each list is its own', () => {
    const a = parseRewards({})!, b = newRewards();
    expect(a).toEqual(b);
    a.items.push(POTION);
    expect(newRewards().items).toEqual([]);
  });

  test('the daily quest\'s rewards in the rules pass unchanged', () => {
    expect(parseRewards(copy(RULES.dailyTemplate.rewards))).toEqual(copy(RULES.dailyTemplate.rewards));
  });

  test('a reward read twice is the same as read once', () => {
    const once = read({ xp: 1e12, items: many(30, () => POTION), job: '  Mage  ' });
    expect(parseRewards(copy(once))).toEqual(once);
  });
});

describe('hostile input', () => {
  test('a value that is not an object is refused', () => {
    for (const v of [null, undefined, 'xp', 5, [FULL]]) expect(parseRewards(v)).toBeNull();
  });

  test('a field of the wrong type takes its default instead of refusing the reward', () => {
    const r = parseRewards({ xp: '50', gold: null, points: NaN, items: 'potion', title: 'Wolf Slayer', job: 7, skills: {}, statuses: 'x', boons: 3 })!;
    expect(r).toEqual(newRewards());
  });

  test('an unknown key and a __proto__ key are dropped, and no prototype changes', () => {
    const r = parseRewards(JSON.parse(`{"__proto__": {"polluted": 1}, "titleName": "Wolf Slayer", "stray": "${'y'.repeat(1000)}", "xp": 5}`))!;
    expect(r).toEqual({ ...newRewards(), xp: 5 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test('an entry its kind refuses is dropped: an item or skill or boon without a name, a status with a bad key', () => {
    const r = read({ items: [{ name: '' }, 4, POTION], skills: [{ name: '   ' }, SLASH], boons: [{ text: 'no name' }, null], statuses: [{ key: 'Bad Key' }, { key: 'hasted', rounds: 3 }] });
    expect([r.items, r.skills, r.boons, r.statuses]).toEqual([[POTION], [SLASH], [], [{ key: 'hasted', rounds: 3 }]]);
  });

  test('a status drawn from a hunter\'s state (Dead, Exhausted, Penalized) cannot be given', () => {
    expect(read({ statuses: ['dead', 'exhausted', 'penalized', 'hasted'].map(key => ({ key, rounds: 1 })) }).statuses).toEqual([{ key: 'hasted', rounds: 1 }]);
  });

  test('a title without a name is none; its bonus keeps the eight stats, max HP and max mana where they are not 0', () => {
    expect(read({ title: { name: '  ', bonus: { str: 2 } } }).title).toBeNull();
    const bonus = JSON.parse('{"__proto__": 5, "str": 2, "agi": 0, "ctl": "3", "atk": 4, "hpMax": 20, "manaMax": 2, "ac": 1, "dex": 3, "mpMax": 5}');
    expect(read({ title: { name: 'T', bonus } }).title).toEqual({ name: 'T', desc: '', bonus: { str: 2, hpMax: 20, manaMax: 2 } });
  });

  test('a reward skill is never the build path\'s skill', () => {
    expect(read({ skills: [{ ...SLASH, perk: 'vanguard' }] }).skills).toEqual([SLASH]);
  });

  test('a status def that cannot be read is left out; the key stays', () => {
    expect(read({ statuses: [{ key: 'hasted', rounds: 2, def: { desc: 'no label' } }] }).statuses).toEqual([{ key: 'hasted', rounds: 2 }]);
    // a def of the old fight, a d20 modifier, is not a def of this one
    const old = { label: 'Cursed', desc: '', ops: [{ op: 'mod', stat: 'atk', value: -2 }] };
    expect(read({ statuses: [{ key: 'cursed', rounds: 2, def: old }] }).statuses).toEqual([{ key: 'cursed', rounds: 2 }]);
  });

  test('a status def of the fight\'s ops comes through as it was written', () => {
    const def: StatusDef = { label: 'Chilled', desc: 'Slower in the cold.', ops: [{ op: 'speed', pct: -20 }, { op: 'stat', key: 'agi', amount: [{ kind: 'number', value: -4 }, { kind: 'number', value: -6 }, { kind: 'number', value: -8 }, { kind: 'number', value: -10 }, { kind: 'number', value: -12 }, { kind: 'number', value: -16 }] }] };
    expect(read({ statuses: [{ key: 'chilled', rounds: 2, def }] }).statuses).toEqual([{ key: statusKey('chilled'), rounds: 2, def }]);
  });

  test('a reward status names its own def\'s label first, then the rules\' status of its key, then the key', () => {
    const r = { ...newRewards(), statuses: [
      { key: statusKey('hasted'), rounds: null, def: { label: 'Quickened', desc: '', ops: [] } }, { key: statusKey('hasted'), rounds: null }, { key: statusKey('mystery'), rounds: null },
    ] };
    expect(rewardLines(RULES, r)).toEqual(['Status: Quickened', 'Status: Hasted', 'Status: mystery']);
  });
});

describe('the bounds', () => {
  test('XP and gold are a billion either way, points 999 either way, each a whole number', () => {
    expect(read({ xp: 1e12, gold: -1e12, points: -5000 })).toMatchObject({ xp: 1e9, gold: -1e9, points: -999 });
    expect(read({ xp: 12.9, gold: -3.7, points: 1.5 })).toMatchObject({ xp: 12, gold: -3, points: 1 });
  });

  test('at most 20 items, 8 skills, 8 statuses and 8 boons: the first ones are kept', () => {
    const r = read({ items: many(10_000, i => ({ ...POTION, name: `P${i}` })), skills: many(50, i => ({ name: `S${i}` })),
      statuses: many(50, i => ({ key: `s${i}`, rounds: 1 })), boons: many(50, i => ({ name: `B${i}` })) });
    expect([r.items.length, r.skills.length, r.statuses.length, r.boons.length]).toEqual([20, 8, 8, 8]);
    expect([r.items[0]!.name, r.skills[7]!.name, r.statuses[7]!.key, r.boons[7]!.name]).toEqual(['P0', 'S7', 's7', 'B7']);
  });

  test('a title\'s name is 60, its description 200, its bonus 999 either way', () => {
    const t = read({ title: { name: BIG, desc: BIG, bonus: { str: 5000, agi: -5000 } } }).title!;
    expect([t.name.length, t.desc.length, t.bonus]).toEqual([60, 200, { str: 999, agi: -999 }]);
  });

  test('a job is 60 and trimmed, a blank job is none', () => {
    expect(read({ job: BIG }).job).toHaveLength(60);
    expect(read({ job: '   ' }).job).toBeNull();
  });

  test('a boon\'s name is 60 and its text 200', () => {
    const [b] = read({ boons: [{ name: BIG, text: BIG }] }).boons;
    expect([b!.name.length, b!.text.length]).toEqual([60, 200]);
  });

  test('a status lasts 1 to 999 rounds, and none (or no number) means until removed', () => {
    const r = read({ statuses: [{ key: 'a', rounds: 5000 }, { key: 'b', rounds: 0 }, { key: 'c', rounds: null }, { key: 'd' }, { key: 'e', rounds: 'x' }] });
    expect(r.statuses.map(s => s.rounds)).toEqual([999, 1, null, null, 1]);
  });
});

describe('a title in another\'s place', () => {
  const SQUARE = { name: 'Square', desc: 'Paid in full.', bonus: { vit: 2 }, replaces: 'Owed to the Deep' };
  test('the name it takes the place of is read, trimmed and cut to a title\'s 60; a blank one, a wrong type and its own name are none', () => {
    expect(read({ title: SQUARE }).title).toEqual(SQUARE);
    expect(read({ title: { ...SQUARE, replaces: `  ${'x'.repeat(80)} ` } }).title!.replaces).toBe('x'.repeat(60));
    for (const replaces of ['   ', 7, null, ['Owed to the Deep'], 'Square', ' Square ']) expect(read({ title: { ...SQUARE, replaces } }).title).toEqual({ name: 'Square', desc: 'Paid in full.', bonus: { vit: 2 } });
    expect(newRewards().title, 'a reward starts with no title, so with nothing to replace').toBeNull();
  });

  test('the quest card and the reward window name both titles', () => {
    const r = { ...newRewards(), title: SQUARE };
    expect(rewardLines(RULES, r)).toEqual(['Title: Square (in place of Owed to the Deep)']);
    expect(grantLines(RULES, r)).toEqual(['Title acquired: Square (in place of Owed to the Deep)']);
  });
});

describe('a title\'s worn status in a reward', () => {
  const STEADY = { label: 'Steady', desc: 'Holds the line.', ops: [] };
  test('the reader keeps a worn status a title carries and drops one that does not read; the lines name it', () => {
    const r = parseRewards({ title: { name: 'Iron Nerve', desc: '', bonus: { dis: 1 }, worn: STEADY } })!;
    expect(r.title!.worn).toMatchObject({ label: 'Steady' });
    expect(parseRewards({ title: { name: 'Iron Nerve', worn: 'junk' } })!.title).toEqual({ name: 'Iron Nerve', desc: '', bonus: {} });
    expect(rewardLines(RULES, r)).toContain('Title: Iron Nerve, worn in fights: Steady');
  });
});

describe('a title by name', () => {
  test('a built-in title brings its description and bonus from the sender\'s rules', () => {
    const wolf = RULES.titles.find(t => t.name === 'Wolf Slayer')!;
    expect(titleReward(RULES, ' Wolf Slayer ')).toEqual({ name: 'Wolf Slayer', desc: wolf.desc, bonus: { ...wolf.bonus }, key: 'wolf-slayer' });
  });

  test('another name is a title without a bonus; a blank name is none', () => {
    expect(titleReward(RULES, 'Gate Crasher')).toEqual({ name: 'Gate Crasher', desc: '', bonus: {} });
    expect(titleReward(RULES, '  ')).toBeNull();
  });
});

describe('a reward in words', () => {
  test('one line a part, a gain with a plus and a cost in words, a status by its label and how long it lasts', () => {
    expect(rewardLines(RULES, FULL)).toEqual([
      '+250 XP', '+2 ability points', 'Loses 40 gold', 'Item: Health Potion ×2', 'Title: Gatebreaker', 'Job: Ranger', 'Skill: Slash',
      'Status: Hasted (3 rounds)', 'Status: Blessed', 'Boon: Free resurrection',
    ]);
  });
  test('the reward window says what was acquired, with a build change after the items', () => {
    expect(grantLines(RULES, { ...FULL, xp: 1500 }, { build: 'Path: Vanguard' })).toEqual([
      '+1,500 XP', 'Loses 40 gold', '+2 ability points', 'Item acquired: Health Potion ×2', 'Path: Vanguard', 'Title acquired: Gatebreaker', 'Job: Ranger',
      'Skill acquired: Slash', 'Status: Hasted (3 rounds)', 'Status: Blessed', 'Boon: Free resurrection',
    ]);
    expect(grantLines(RULES, { ...newRewards(), points: 1, statuses: [{ key: statusKey('hasted'), rounds: 1 }] })).toEqual(['+1 ability point', 'Status: Hasted (1 round)']);
  });
});

describe('a reward given (src/core/hunter/grant.ts)', () => {
  const AT = '2026-11-14T12:00:00.000Z';
  const fresh = (): Save => freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') }, { onboarded: true });
  const given = (save: Save, r: Rewards, vitals: 'sheet' | 'fight' = 'sheet'): Granted => {
    const g = grant(save, 'h1', r, null, { at: AT, today: day(AT.slice(0, 10)), R: RULES, vitals });
    if (isRefused(g)) throw new Error(g.why);
    return g;
  };
  const hunter = (s: Save): Hunter => s.hunters[0]!;
  const potions = (h: Hunter): number => h.items.filter(i => i.name === 'Health Potion').reduce((n, i) => n + i.qty, 0);

  test('every part of a reward is on the hunter in the one save it answers, and the save it was given is unchanged', () => {
    const save = fresh(), before = JSON.stringify(save), h = hunter(save);
    const g = given(save, { ...FULL, gold: 40, xp: 30 });
    const after = hunter(g.save);
    expect(JSON.stringify(save)).toBe(before);
    expect({
      xp: after.xp, bonus: after.bonusPoints, gold: after.gold, job: after.job, titles: after.titles.map(t => t.name), skills: after.skills.map(k => k.name),
      statuses: after.conditions.map(c => c.key), boons: after.boons.map(b => b.name), potions: potions(after),
    }).toEqual({
      xp: h.xp + 30, bonus: h.bonusPoints + 2, gold: h.gold + 40, job: 'Ranger', titles: [...h.titles.map(t => t.name), 'Gatebreaker'], skills: [...h.skills.map(k => k.name), 'Slash'],
      statuses: ['hasted', 'blessed-by-gm'], boons: ['Free resurrection'], potions: potions(h) + 2,
    });
  });

  test('the ids it gives come from the save\'s seq, each new, and the seq moves past them', () => {
    const save = fresh(), g = given(save, FULL), after = hunter(g.save), old = JSON.stringify(save);
    const made = [...after.titles, ...after.skills, ...after.boons].map(x => x.id).filter(id => !old.includes(`"${id}"`));
    expect(made).toHaveLength(3);
    expect(new Set(made).size).toBe(3);
    expect(g.save.seq).toBeGreaterThanOrEqual(save.seq + 3);
  });

  test('a title the hunter holds is not given twice and is not in the window\'s lines', () => {
    const once = given(fresh(), { ...newRewards(), title: FULL.title }).save, twice = given(once, { ...newRewards(), title: FULL.title });
    expect(hunter(twice.save).titles.filter(t => t.name === 'Gatebreaker')).toHaveLength(1);
    expect(twice.lines).toEqual([]);
  });

  test('a title in place of the active one: the hunter keeps one title, still active, its bonus on the sheet, and the window says which it replaced', () => {
    const debt = given(fresh(), { ...newRewards(), title: { name: 'Owed to the Deep', desc: '', bonus: { hpMax: -10 } } }).save;
    const h0 = hunter(debt), held = h0.titles.find(t => t.name === 'Owed to the Deep')!;
    const active = { ...debt, hunters: [{ ...h0, titleId: held.id }] };
    const g = given(active, parseRewards({ title: { name: 'Square', desc: 'Paid in full.', bonus: { hpMax: 10 }, replaces: 'Owed to the Deep' } })!);
    const h = hunter(g.save);
    expect(h.titles.map(t => t.name)).toEqual([...h0.titles.filter(t => t !== held).map(t => t.name), 'Square']);
    expect([h.titleId, h.titles.find(t => t.name === 'Square')!.id]).toEqual([held.id, held.id]);
    expect(g.lines).toEqual(['Title acquired: Square (in place of Owed to the Deep)']);
    const max = (s: Save) => hunterSheet(hunter(s), RULES).sheet.hpMax;
    expect(max(g.save) - max(active), 'the active title went from 10 less max HP to 10 more').toBe(20);
  });

  test('a title that names one the hunter does not hold is given as new, and the window does not say "in place of"; held already, it gives nothing', () => {
    const square = parseRewards({ title: { name: 'Square', desc: '', bonus: {}, replaces: 'Owed to the Deep' } })!;
    const g = given(fresh(), square), before = hunter(fresh()).titles.length;
    expect(hunter(g.save).titles).toHaveLength(before + 1);
    expect(g.lines).toEqual(['Title acquired: Square']);
    const twice = given(g.save, square);
    expect([hunter(twice.save).titles, twice.lines]).toEqual([hunter(g.save).titles, []]);
  });

  test('a rule title the hunter renamed is replaced, and the window names it as the hunter holds it', () => {
    const once = given(fresh(), { ...newRewards(), title: titleReward(RULES, 'Wolf Slayer')! }).save, h = hunter(once);
    const renamed = { ...once, hunters: [{ ...h, titles: h.titles.map(t => (t.seedKey ? { ...t, name: 'Pack Breaker' } : t)) }] };
    const g = given(renamed, parseRewards({ title: { name: 'Alpha', desc: '', bonus: {}, replaces: 'Wolf Slayer' } })!);
    expect(hunter(g.save).titles.map(t => t.name)).toEqual(h.titles.map(t => (t.seedKey ? 'Alpha' : t.name)));
    expect(g.lines).toEqual(['Title acquired: Alpha (in place of Pack Breaker)']);
  });

  test('a rule title the hunter holds under a name the GM gave it is not given again', () => {
    const wolf = titleReward(RULES, 'Wolf Slayer')!, once = given(fresh(), { ...newRewards(), title: wolf }).save;
    const h = hunter(once), renamed = { ...once, hunters: [{ ...h, titles: h.titles.map(t => (t.seedKey ? { ...t, name: 'Pack Breaker' } : t)) }] };
    expect(hunter(renamed).titles.filter(t => t.seedKey === 'wolf-slayer').map(t => t.name)).toEqual(['Pack Breaker']);
    const twice = given(renamed, { ...newRewards(), title: parseRewards({ title: wolf })!.title });
    expect(hunter(twice.save).titles).toEqual(hunter(renamed).titles);
    expect(twice.lines).toEqual([]);
  });

  test('a level-up above the peak refills HP and mana on the sheet', () => {
    const save = fresh(), h = hunter(save), hurt = { ...save, hunters: [{ ...h, life: { at: 'up' as const, hp: 1 }, mana: 0 }] };
    // level 1 costs 100 XP (xpPerLevel 100 times the level)
    const g = given(hurt, { ...newRewards(), xp: 100 });
    const after = hunter(g.save), max = hunterSheet(after, RULES).sheet;
    expect(g.levelup).toEqual({ hunterId: 'h1', from: 1, to: 2, points: RULES.pointsPerLevel, refill: true });
    expect([after.life, after.mana]).toEqual([{ at: 'up', hp: max.hpMax }, max.manaMax]);
  });

  test('a dead hunter\'s level-up fills mana and leaves the hunter dead, and does not say HP and mana were restored (SMX-rules-1.2)', () => {
    const save = fresh(), h = hunter(save), dead = { ...save, hunters: [{ ...h, life: { at: 'dead' as const }, mana: 0 }] };
    const g = given(dead, { ...newRewards(), xp: 100 });
    const after = hunter(g.save), max = hunterSheet(after, RULES).sheet;
    // whether a dead hunter is refilled at all waits on the owner; today the mana fills
    expect([after.life, after.mana]).toEqual([{ at: 'dead' }, max.manaMax]);
    expect(g.levelup).toEqual({ hunterId: 'h1', from: 1, to: 2, points: RULES.pointsPerLevel, refill: false });
  });

  test('while a fight holds the hunter\'s vitals, a status and the refill are left for the fight, and the rest lands', () => {
    const save = fresh(), h = hunter(save), hurt = { ...save, hunters: [{ ...h, life: { at: 'up' as const, hp: 1 } }] };
    const g = given(hurt, { ...newRewards(), xp: 100, gold: 5, statuses: [{ key: statusKey('hasted'), rounds: 3 }] }, 'fight');
    const after = hunter(g.save);
    expect([after.conditions, after.life, after.gold, after.level]).toEqual([[], { at: 'up', hp: 1 }, h.gold + 5, 2]);
    expect(g.fight).toEqual({ statuses: [{ key: 'hasted', rounds: 3, source: { id: null, tier: 0 } }], refill: true });
    expect(g.levelup?.refill).toBe(false);
    expect(g.lines).toEqual(['+100 XP', '+5 gold']);
  });

  test('a hunter that is not there is refused', () => {
    expect(grant(fresh(), 'h9', FULL, null, { at: AT, today: day(AT.slice(0, 10)), R: RULES, vitals: 'sheet' })).toEqual({ ok: false, why: 'no-hunter' });
  });
});

describe('a cost a reward takes away (a story\'s chapter, stories ruling 2)', () => {
  const AT = '2026-11-19T12:00:00.000Z';
  const fresh = (): Save => freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') }, { onboarded: true });
  const given = (save: Save, r: Rewards): Granted => {
    const g = grant(save, 'h1', r, null, { at: AT, today: day(AT.slice(0, 10)), R: RULES, vitals: 'sheet' });
    if (isRefused(g)) throw new Error(g.why);
    return g;
  };
  /** The first hunter at `level` with `xp` inside it, `gold`, and `points` free to spend. */
  const holding = (o: { level: number; xp: number; gold: number; points: number }): Save => {
    const save = fresh(), h = save.hunters[0]!;
    const bonusPoints = o.points - levelPoints(RULES, o.level) + h.spent + pendingTotal(h);
    return { ...save, hunters: [{ ...h, level: o.level, peakLevel: o.level, xp: o.xp, gold: o.gold, bonusPoints }] };
  };
  const cost = { ...newRewards(), xp: -50, gold: -40, points: -1 };
  const after = (g: Granted) => { const h = g.save.hunters[0]!; return { level: h.level, xp: h.xp, gold: h.gold, points: available(h, RULES) }; };

  test('the one reader keeps a negative XP, gold and points', () => {
    expect(parseRewards({ xp: -50, gold: -40, points: -1 })).toEqual(cost);
  });

  test('a hunter who holds enough loses each amount, and the window says so in words', () => {
    const g = given(holding({ level: 1, xp: 80, gold: 100, points: 2 }), cost);
    expect(after(g)).toEqual({ level: 1, xp: 30, gold: 60, points: 1 });
    expect(g.lines).toEqual(['Loses 50 XP', 'Loses 40 gold', 'Loses 1 ability point']);
  });

  test('a cost larger than what the hunter holds stops at 0, and the window says what was taken', () => {
    const g = given(holding({ level: 1, xp: 20, gold: 25, points: 1 }), { ...cost, points: -3 });
    expect(after(g)).toEqual({ level: 1, xp: 0, gold: 0, points: 0 });
    expect(g.lines).toEqual(['Loses 20 XP', 'Loses 25 gold', 'Loses 1 ability point']);
  });

  test('a hunter with nothing to lose loses nothing, and the window has no line for it', () => {
    const g = given(holding({ level: 1, xp: 0, gold: 0, points: 0 }), cost);
    expect(after(g)).toEqual({ level: 1, xp: 0, gold: 0, points: 0 });
    expect(g.lines).toEqual([]);
  });

  test('XP taken below the level\'s start takes the level away, the window says so after the XP, and no level-up is told', () => {
    // level 2 costs 200 XP (xpPerLevel 100 times the level): level 3 with 10 XP, less 50, is level 2 with 160
    const g = given(holding({ level: 3, xp: 10, gold: 0, points: 0 }), { ...newRewards(), xp: -50 });
    expect([after(g).level, after(g).xp, g.levelup, g.lines]).toEqual([2, 160, null, ['Loses 50 XP', 'Loses 1 level: now level 2']]);
  });

  test('XP taken past two levels\' starts says both levels', () => {
    // level 3 with 10 XP holds 100 + 200 + 10 = 310 XP since level 1; less 250 is 60, level 1 with 60
    const g = given(holding({ level: 3, xp: 10, gold: 0, points: 0 }), { ...newRewards(), xp: -250 });
    expect([after(g).level, after(g).xp, g.lines]).toEqual([1, 60, ['Loses 250 XP', 'Loses 2 levels: now level 1']]);
  });

  test('XP taken inside the level keeps the level, and the window has no level line', () => {
    const g = given(holding({ level: 3, xp: 80, gold: 0, points: 0 }), { ...newRewards(), xp: -50 });
    expect([after(g).level, after(g).xp, g.lines]).toEqual([3, 30, ['Loses 50 XP']]);
  });

  test('the reward editor\'s preview, the quest card and the log say a cost in the same words', () => {
    expect(grantLines(RULES, { ...cost, points: -2 })).toEqual(['Loses 50 XP', 'Loses 40 gold', 'Loses 2 ability points']);
    expect(rewardLines(RULES, { ...cost, points: -2 })).toEqual(['Loses 50 XP', 'Loses 2 ability points', 'Loses 40 gold']);
  });
});

describe('a Resurrection Crystal given in a reward, with no code of its own (notes-2b-crystal.md section 4)', () => {
  // Each way a GM gives an item is read through its own step, then the hunter it was given is killed and uses it from
  // the bag: the crystal arrived whole, its revive with it.
  const AT = '2026-11-18T12:00:00.000Z', DAY = { at: AT, today: day(AT.slice(0, 10)), R: RULES, vitals: 'sheet' as const };
  const CRYSTAL: ItemTemplate = itemOf(RULES, SHOP_ITEMS.find(i => i.name === 'Resurrection Crystal (S)')!);
  const WITH: Rewards = { ...newRewards(), items: [CRYSTAL] };
  const fresh = (): Save => freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') }, { onboarded: true });
  /** Hunter h1 of `s` dies, then uses the crystal it holds: up at 1 HP with none left. */
  const raised = (s: Save): void => {
    const h = { ...s.hunters[0]!, life: { at: 'dead' as const } }, it = h.items.find(i => i.revive)!;
    expect(it).toMatchObject({ name: 'Resurrection Crystal (S)', revive: true });
    const u = useItem(h, it.id, [], RULES);
    if (isRefused(u)) throw new Error(u.why);
    expect([u.hunter.life, u.hunter.items.some(i => i.revive)]).toEqual([{ at: 'up', hp: 1 }, false]);
  };
  const granted = (s: Save, r: Rewards): Save => { const g = grant(s, 'h1', r, null, DAY); if (isRefused(g)) throw new Error(g.why); return g.save; };

  test('read by the one reader every reward goes through, it keeps its revive', () => {
    expect(parseRewards(copy(WITH))!.items).toEqual([CRYSTAL]);
  });

  test('an award, and a title\'s reward: the title and the crystal in one grant', () => {
    raised(granted(fresh(), parseRewards(copy(WITH))!));
    const s = granted(fresh(), parseRewards(copy({ ...WITH, title: { name: 'Twice Born', desc: 'Came back.', bonus: {} } }))!);
    expect(s.hunters[0]!.titles.map(t => t.name)).toContain('Twice Born');
    raised(s);
  });

  test('a bundle saved in the library, then awarded', () => {
    const lib = saveBundle(fresh().library, 'rb1', 'Second life', parseRewards(copy(WITH))!, 10);
    if (isRefused(lib)) throw new Error(lib.why);
    raised(granted(fresh(), parseRewards(copy(lib.rewards[0]!.rewards))!));
  });

  test('a quest\'s reward, given as the quest is finished', () => {
    const s = fresh(), q = { ...questIn('active', 'side'), rewards: parseRewards(copy(WITH))! };
    const r = finishQuest({ ...s, hunters: [{ ...s.hunters[0]!, quests: [q] }] }, 'h1', q.id, DAY);
    if (isRefused(r)) throw new Error(r.why);
    raised(r.save);
  });

  test('a gate\'s Clear, with the crystal as the item the GM put in its share', () => {
    const s = { ...fresh(), gates: [den('raiding')] };
    const out = settleClear(s, 'g-den', { due: 0, xp: 0, gold: 0, items: ['Resurrection Crystal (S)'], payees: ['Hunter'] }, [{ hid: 'h1', rewards: parseRewards(copy(WITH))! }], null, DAY);
    if (isRefused(out)) throw new Error(out.why);
    expect(out.save.gates[0]!.status).toBe('cleared');
    raised(out.save);
  });
});

describe('a status put on or taken off the sheet (grant.ts sheetEdit)', () => {
  const WEAK: StatusDef = { label: 'Weakened', desc: '', ops: [{ op: 'stat', key: 'vit', amount: { kind: 'number', value: -20 } }] };
  test('a status that lowers max HP leaves the stored HP above it, which the sheet shows at the maximum (SMX-rules-1.3, today)', () => {
    const h = freshSave({ now: new Date(0), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') }, { onboarded: true }).hunters[0]!;
    const full = hunterSheet(h, RULES).sheet.hpMax;
    const put = sheetEdit(h, { type: 'put', status: { key: statusKey('weakened'), def: WEAK, rounds: null, source: { id: null, tier: 0 } } }, RULES);
    if (isRefused(put)) throw new Error(put.why);
    const lower = hunterSheet(put, RULES).sheet.hpMax;
    expect(lower).toBeLessThan(full);
    // whether a status change fits HP to the new maximum at once waits on the owner; today it does not
    expect(put.life).toEqual({ at: 'up', hp: full });
    expect(hpOf(put.life, lower), 'the sheet shows the maximum').toBe(lower);
  });
});
