import { describe, expect, test } from 'bun:test';
import { armorCutPct, checkExample, dailyPointsLine, downLine, gatePayLines, naturalLines, pointsLine, saleLine, saleRows, soloLines, statBonusLine } from '../src/core/rules-text.ts';
import { afterDefence } from '../src/core/combat/land.ts';
import { sellPrice } from '../src/core/hunter/inventory.ts';
import { CAP_ROUNDS } from '../src/core/combat/play.ts';
import { ODDS_RUNS } from '../src/core/combat/odds.ts';
import { checkBonus } from '../src/core/hunter/sheet.ts';
import type { SheetHunter } from '../src/core/hunter/sheet.ts';
import { checkResult } from '../src/core/roll.ts';
import { VERDICT_WORDS, verdict } from '../src/core/coin.ts';
import { SIDES } from '../src/core/coin.ts';
import { allocated, confirm, lower, newProgress, raise } from '../src/core/hunter/progress.ts';
import type { Allocating } from '../src/core/hunter/progress.ts';
import { isRefused } from '../src/core/save-step.ts';
import { FUMBLE_FAILURES, REVIVE_HP, SAVES_TO_END, SAVE_FUMBLE, SAVE_SUCCESS, SAVE_UP, SAVE_UP_HP, WAYS_BACK, lifeAfter } from '../src/core/hunter/vitals.ts';
import { useItem } from '../src/core/hunter/use.ts';
import { sheetEdit } from '../src/core/hunter/grant.ts';
import { buy, putItem, sell } from '../src/core/hunter/inventory.ts';
import { RARITIES, SHOP_ITEMS, itemOf, parseItem, priceOf, valueOf } from '../src/core/registry/items.ts';
import { newHunter } from '../src/core/save.ts';
import { isRefused as refused } from '../src/core/save-step.ts';
import type { Life } from '../src/core/hunter/vitals.ts';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import type { Stats } from '../src/core/stats.ts';

const BASE = Object.fromEntries(STAT_KEYS.map(k => [k, 10])) as Stats;
const striker = (R: Rules, str: number): SheetHunter => ({
  stats: { ...BASE, str }, level: 1, rank: 'E', fatigue: 0, penalty: null, hpAdj: 0, manaAdj: 0, titleId: null, titles: [],
  items: [], equipped: {}, build: { path: null, picks: [] }, skills: [], conditions: [],
});
const curved = (fight: Partial<Rules['fight']>): Rules => ({ ...RULES, fight: { ...RULES.fight, ...fight } });
const sign = (n: number): string => (n >= 0 ? '+' : '') + n;

describe('the check example and the stat line', () => {
  for (const [name, R] of [['the rules', RULES], ['a steeper curve', curved({ effExp: 1.2 })], ['a flatter curve', curved({ effExp: 0.5 })], ['a higher base', curved({ statBase: 12 })]] as const) {
    test(`the example's bonus is what the sheet adds for Strength 14 (${name}), and the line states it`, () => {
      const x = checkExample(R);
      expect(x.stat + x.rankBonus).toBe(checkBonus(striker(R, x.score), 'str', R));
      expect(statBonusLine(R)).toContain(`adds ${sign(x.stat)}.`);
      expect(x.need).toBeGreaterThanOrEqual(1);
    });
  }

  test('under the rules as shipped a score of 14 adds +1, not +2', () => {
    expect(checkExample(RULES).stat).toBe(1);
    expect(statBonusLine(RULES)).not.toContain('+2');
  });

  test('a different curve moves the example and its line together', () => {
    const a = checkExample(RULES), b = checkExample(curved({ effExp: 1.5 }));
    expect(b.stat).not.toBe(a.stat);
    expect(statBonusLine(curved({ effExp: 1.5 }))).toContain(`adds ${sign(b.stat)}.`);
  });
});

describe('the natural 20 and 1', () => {
  const text = naturalLines().join(' ');
  test('a natural 1 fails and a natural 20 succeeds whatever the total, as the lines say', () => {
    expect(checkResult(1, 999, 10).success).toBe(false);
    expect(checkResult(20, -999, 10).success).toBe(true);
    expect(naturalLines()[0]).toContain('natural 20');
    expect(naturalLines()[0]).toContain('succeeds whatever the total');
    expect(naturalLines()[0]).toContain('fails whatever the total');
  });

  test('each of the four coin cases reads the coin\'s own word', () => {
    for (const face of [1, 20] as const) for (const landed of SIDES) {
      const word = VERDICT_WORDS[verdict(face, 'heads', landed)];
      const clause = `On a ${face}, a right call reads ${VERDICT_WORDS[verdict(face, 'heads', 'heads')]} and a wrong one ${VERDICT_WORDS[verdict(face, 'heads', 'tails')]}`;
      expect(text).toContain(clause);
      expect(text).toContain(word);
    }
  });
});

describe('the points line', () => {
  const R: Rules = { ...RULES, xpPerLevel: 100, pointsPerLevel: 3 };
  const fresh = (): Allocating => ({ ...newProgress(), level: 3, peakLevel: 3, stats: { ...BASE } });
  test('a raised point comes back with minus before Confirm, and is refused to a player after it', () => {
    const raised = raise(fresh(), 'str', 'player', R);
    if (isRefused(raised)) throw new Error('refused');
    const back = lower(raised, 'str', 'player');
    if (isRefused(back)) throw new Error('refused');
    expect(allocated(back).str).toBe(10);
    const done = confirm(raised);
    expect(lower(done, 'str', 'player')).toEqual({ ok: false, why: 'confirmed' });
  });
  test('the sentence names Confirm as the lock and leaving the view as no lock', () => {
    const line = pointsLine();
    expect(line).toContain('Confirm locks');
    expect(line).toContain('also after you leave the Status view');
    expect(line).not.toMatch(/leave the Status view,? to lock/);
  });
});

describe('the down line', () => {
  const dying = (successes: 0 | 1 | 2, failures: 0 | 1 | 2): Life => ({ at: 'dying', successes, failures });
  const save = (life: Life, roll: number): Life => lifeAfter(life, { type: 'deathSave', roll }, 20);
  const line = downLine(RULES);

  test('its numbers are the ones the machine plays', () => {
    expect(line).toContain(`${SAVE_SUCCESS} or higher succeeds`);
    expect(save(dying(0, 0), SAVE_SUCCESS)).toEqual(dying(1, 0));
    expect(save(dying(0, 0), SAVE_SUCCESS - 1)).toEqual(dying(0, 1));
    expect(line).toContain(`A ${SAVE_UP} gets up at ${SAVE_UP_HP} HP`);
    expect(save(dying(1, 1), SAVE_UP)).toEqual({ at: 'up', hp: SAVE_UP_HP });
    expect(line).toContain(`a ${SAVE_FUMBLE} counts as ${FUMBLE_FAILURES} failures`);
    expect(save(dying(0, 0), SAVE_FUMBLE)).toEqual(dying(0, FUMBLE_FAILURES as 2));
  });

  test('three successes make it stable and three failures dead, and Revive brings the dead back at its HP', () => {
    expect(SAVES_TO_END).toBe(3);
    expect(line).toContain(`${SAVES_TO_END} successes make the hunter stable`);
    expect(line).toContain(`${SAVES_TO_END} failures are fatal`);
    let life: Life = dying(0, 0);
    for (let i = 0; i < SAVES_TO_END; i++) life = save(life, SAVE_SUCCESS);
    expect(life).toEqual({ at: 'stable' });
    life = dying(0, 0);
    for (let i = 0; i < SAVES_TO_END; i++) life = save(life, SAVE_SUCCESS - 1);
    expect(life).toEqual({ at: 'dead' });
    expect(lifeAfter(life, { type: 'revive' }, 20)).toEqual({ at: 'up', hp: REVIVE_HP });
    expect(line).toContain(`Healing and rest do not raise the dead: ${WAYS_BACK} from the bag does, at ${REVIVE_HP} HP, outside a fight.`);
  });

  test('the Resurrection Crystal the line names raises the dead at the HP it states, as the GM\'s Revive does', () => {
    const crystal = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (E)')!);
    expect(crystal.name.startsWith('Resurrection Crystal'), 'the shop\'s crystals carry the name the line says, and their rank').toBe(true);
    expect(WAYS_BACK).toContain('Resurrection Crystal');
    const h = { ...putItem(newHunter(RULES), crystal, 'i1' as never), life: { at: 'dead' as const } }, u = useItem(h, 'i1', [], RULES);
    expect(refused(u) ? u : u.hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
  });

  test('a raising costs levels, as the machine plays it: 3.33% of the level, rounded up, so level 31 comes back at 29', () => {
    expect(line).toContain('A raising costs levels: 3.33% of the hunter\'s level, rounded up, at least one and never below level 1, so a hunter who died at level 31 comes back at level 29.');
    const at31 = { ...newHunter(RULES), level: 31, peakLevel: 31, life: { at: 'dead' as const } };
    const up = sheetEdit(at31, { type: 'life', event: { type: 'revive' } }, RULES);
    expect(refused(up) ? up : up.level).toBe(29);
  });

  test('the raising\'s line follows a GM\'s share: a tenth takes 4 of level 31', () => {
    expect(downLine({ ...RULES, reviveLevelShare: 0.1 })).toContain('A raising costs levels: 10% of the hunter\'s level, rounded up, at least one and never below level 1, so a hunter who died at level 31 comes back at level 27.');
  });

  test('the shop is closed to the dead, as the line says: a dead hunter\'s purchase and sale are refused, a stable one\'s are not', () => {
    expect(line).toContain('The shop is closed to a dead hunter, who can neither buy nor sell. The GM or another hunter can still give a dead hunter a Resurrection Crystal.');
    const potion = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Health Potion')!);
    const rich = { ...putItem(newHunter(RULES), potion, 'i1' as never), gold: 1000 };
    expect(buy({ ...rich, life: { at: 'dead' } }, potion, 'i2' as never, RULES)).toEqual({ ok: false, why: 'dead' });
    expect(sell({ ...rich, life: { at: 'dead' } }, 'i1', 1, RULES)).toEqual({ ok: false, why: 'dead' });
    expect(refused(buy({ ...rich, life: { at: 'stable' } }, potion, 'i2' as never, RULES))).toBe(false);
  });

  test('healing does not raise the dead', () => {
    expect(lifeAfter({ at: 'dead' }, { type: 'heal', amount: 10 }, 20)).toEqual({ at: 'dead' });
  });

  test('a stable hunter makes no more saves', () => {
    expect(save({ at: 'stable' }, SAVE_UP)).toEqual({ at: 'stable' });
  });
});

describe('the solo run\'s lines', () => {
  test('state the odds\' count, the time cap and the personal gates\' numbers as the rules hold them', () => {
    const [run, gates] = soloLines(RULES);
    expect(run).toContain(`how ${ODDS_RUNS} plays`);
    expect(run).toContain(`no winner by round ${CAP_ROUNDS} is a retreat`);
    expect(run).toContain('A hunter can die alone.');
    expect(gates).toBe(`The System opens a personal gate every ${RULES.solo.hours} hours, at most ${RULES.solo.held} at once. Each closes ${RULES.solo.stays} hours after it opens, cleared or not.`);
  });

  test('say that the first gate after personal gates start is one monster of the hunter\'s own rank, and the rest the rule\'s pack', () => {
    expect(soloLines(RULES)[2]).toBe(`The first gate after personal gates start for a hunter (a new hunter, one revived, or personal gates turned back on) holds one monster of the hunter's own rank. The rest hold ${RULES.solo.pack[0]} to ${RULES.solo.pack[1]}, one rank below the hunter's to one above.`);
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, pack: [2, 4] } })[2]).toContain('The rest hold 2 to 4');
  });

  test('follow a GM\'s change of the numbers, and say when personal gates are off', () => {
    const R = { ...RULES, solo: { ...RULES.solo, hours: 4, held: 6 } };
    expect(soloLines(R)[1]).toContain('every 4 hours, at most 6 at once');
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, personal: false } })[1]).toBe('Personal gates are off.');
  });

  test('say what share of a world gate\'s loot a cleared personal gate pays, and that a world gate run alone pays in full', () => {
    const pct = `${RULES.solo.lootShare * 100}%`;
    expect(soloLines(RULES)[3]).toBe(`A cleared personal gate pays ${pct} of the loot a world gate of its rank rolls: ${pct} of the gold, rounded down, and an item ${pct} of the time. A world gate run alone pays as a world gate.`);
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, lootShare: 0.5 } })[3]).toContain('pays 50% of the loot');
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, personal: false } }).join(' ')).not.toContain('A cleared personal gate');
  });
});

describe('the Rules page states what the game pays', () => {
  test('the sale table has a row for each rarity an item can carry: its shop price and what the Bag pays for an unpriced item of it', () => {
    expect(saleRows(RULES).map(r => r.rar)).toEqual([...RARITIES]);
    for (const row of saleRows(RULES)) {
      const it = parseItem({ name: 'Relic', rar: row.rar })!;
      expect([row.rar, row.price, row.sell]).toEqual([row.rar, valueOf(it, RULES), sellPrice(it, RULES)]);
    }
    expect(saleRows(RULES).find(r => r.rar === 'common')!.sell, 'a quarter of one E Clear, 100').toBe(25);
  });
  test('the sale line names the rank that prices each rarity and the shares a consumable costs and a sale pays, and follows a GM\'s change', () => {
    const line = saleLine(RULES);
    expect(line).toContain('common E, uncommon D, rare C, epic B, legendary A, mythic S');
    expect(line).toContain('a consumable costs 50% of that');
    expect(line).toContain('buys an item back at 25% of its price');
    expect(saleLine({ ...RULES, saleShare: 0.4, usedUpShare: 0.3 })).toContain('costs 30% of that');
    expect(saleLine({ ...RULES, saleShare: 0.4, usedUpShare: 0.3 })).toContain('back at 40% of its price');
    const potion = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Greater Health Potion')!);
    expect(valueOf(potion, RULES), 'what the line says of a consumable is what the shop asks').toBe(Math.round(priceOf(RULES, 'uncommon') * 0.5));
  });
  test('the daily line gives the points the daily quest template pays, and follows a changed template', () => {
    const R = { ...RULES, dailyTemplate: { ...RULES.dailyTemplate, rewards: { ...RULES.dailyTemplate.rewards, points: 4 } } };
    expect(dailyPointsLine(R)).toContain('+4');
    expect(dailyPointsLine(RULES)).toContain(`+${RULES.dailyTemplate.rewards.points}`);
  });
  test('the rules hold no dailyRewardPoints, which nothing in the game paid', () => {
    expect('dailyRewardPoints' in RULES).toBe(false);
  });
});

test('the armor cut the Rules page states is what afterDefence takes off a hit when no flat part is taken first', () => {
  const R = { ...RULES, fight: { ...RULES.fight, armorFlat: 0 as typeof RULES.fight.armorFlat } };
  const armor = 40, hit = 10_000;
  expect(armorCutPct(R, armor)).toBe(100 - Math.round(100 * afterDefence(hit, 'physical', { pen: 0 as never, penFlat: 0 }, { armor, resist: 0 }, R) / hit));
});

describe('the world gate\'s lines', () => {
  test('say the gate is made for a party of 4 whose gold and XP are one pot, and each share of 100 from 1 to 6 hunters', () => {
    const [pot, shares] = gatePayLines(RULES);
    expect(pot).toBe('A world gate is made for a party of 4. What it pays, its gold roll and its XP alike, is a pot of 4 shares split evenly among the hunters it pays, rounded down: the fewer hunters, the more each, and past 4 hunters the pot itself shrinks.');
    expect(shares).toBe('Each hunter\'s share of 100: 400 alone, 200 of 2, 133 of 3, 100 of 4, 64 of 5, 44 of 6.');
  });

  test('say a fight started from a gate pays its XP the same way and a fight from no gate pays each the whole, and a solo run is a party of one', () => {
    expect(gatePayLines(RULES).slice(2)).toEqual([
      'A fight started from a gate pays its XP the same way, out of the gate\'s XP; its Clear pays the rest. A fight started from no gate pays each hunter the whole XP of what went down.',
      'A solo run of a world gate is a party of one: 4 times the gold roll and 4 times the XP.',
    ]);
  });

  test('follow a GM\'s change of the party', () => {
    const R = { ...RULES, gateParty: 2 };
    expect(gatePayLines(R)[0]).toContain('made for a party of 2');
    expect(gatePayLines(R)[1]).toBe('Each hunter\'s share of 100: 200 alone, 100 of 2, 44 of 3, 25 of 4.');
    expect(gatePayLines(R)[3]).toContain('2 times the gold roll and 2 times the XP');
  });
});
