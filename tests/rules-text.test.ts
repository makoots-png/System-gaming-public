import { describe, expect, test } from 'bun:test';
import { mythicLines, mythicCodexLines, armorCutPct, checkExample, dailyPointsLine, deathLine, gatePayLines, iconCreditLine, ICON_CREDIT, naturalLines, pointsLine, saleLine, saleRows, soloLines, statBonusLine, stealthLines } from '../src/core/rules-text.ts';
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
import { REVIVE_HP, WAYS_BACK, lifeAfter } from '../src/core/hunter/vitals.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { useItem } from '../src/core/hunter/use.ts';
import { sheetEdit } from '../src/core/hunter/grant.ts';
import { buy, putItem, sell } from '../src/core/hunter/inventory.ts';
import { RARITIES, SHOP_ITEMS, itemOf, parseItem, priceOf, valueOf } from '../src/core/registry/items.ts';
import { newHunter } from '../src/core/save.ts';
import { isRefused as refused } from '../src/core/save-step.ts';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import type { Stats } from '../src/core/stats.ts';
import { MYTHICS } from '../src/core/registry/mythics.ts';

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
      const clause = `On a ${face}, a right call is ${VERDICT_WORDS[verdict(face, 'heads', 'heads')]} and a wrong call is ${VERDICT_WORDS[verdict(face, 'heads', 'tails')]}`;
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
    expect(line).toContain('Tap Confirm allocation to lock');
    expect(line).toContain('even if you leave the Status view');
    expect(line).not.toMatch(/leave the Status view,? to lock/);
  });
});

describe('the death line', () => {
  const line = deathLine(RULES);

  test('at 0 HP a hunter is dead, as the machine plays it: no death saves, no getting up', () => {
    expect(line.startsWith('At 0 HP, a hunter is dead.')).toBe(true);
    expect(line).not.toMatch(/death save|stable|stabiliz/i);
    expect(lifeAfter({ at: 'up', hp: 5 }, { type: 'damage', amount: 5 }, 20)).toEqual({ at: 'dead' });
  });

  test('healing and rest do not raise the dead; Revive and a crystal do, at the revive HP, with every status taken off', () => {
    expect(line).toContain(`Healing and resting cannot revive a dead hunter. ${WAYS_BACK} revives them with ${REVIVE_HP} HP and removes every status, so poison does not kill them again.`);
    expect(lifeAfter({ at: 'dead' }, { type: 'heal', amount: 10 }, 20)).toEqual({ at: 'dead' });
    expect(lifeAfter({ at: 'dead' }, { type: 'revive' }, 20)).toEqual({ at: 'up', hp: REVIVE_HP });
    const poisoned = { key: statusKey('poisoned'), def: RULES.conditions.poisoned!, source: { id: null, tier: 0 }, rounds: null };
    const up = sheetEdit({ ...newHunter(RULES), life: { at: 'dead' as const }, conditions: [poisoned] }, { type: 'life', event: { type: 'revive' } }, RULES);
    expect(refused(up) ? up : up.conditions).toEqual([]);
  });

  test('the Resurrection Crystal the line names raises the dead at the HP it states, as the GM\'s Revive does', () => {
    const crystal = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (E)')!);
    expect(crystal.name.startsWith('Resurrection Crystal'), 'the shop\'s crystals carry the name the line says, and their rank').toBe(true);
    expect(WAYS_BACK).toContain('Resurrection Crystal');
    expect(line).toContain('Use a Resurrection Crystal from your bag outside a fight.');
    const h = { ...putItem(newHunter(RULES), crystal, 'i1' as never), life: { at: 'dead' as const } }, u = useItem(h, 'i1', [], RULES);
    expect(refused(u) ? u : u.hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
  });

  test('a raising costs levels, as the machine plays it: 3.33% of the level, rounded up, so level 31 comes back at 29', () => {
    expect(line).toContain('Reviving costs 3.33% of the hunter\'s level, rounded up (at least 1 level, never below level 1). For example, a hunter who died at level 31 comes back at level 29.');
    const at31 = { ...newHunter(RULES), level: 31, peakLevel: 31, life: { at: 'dead' as const } };
    const up = sheetEdit(at31, { type: 'life', event: { type: 'revive' } }, RULES);
    expect(refused(up) ? up : up.level).toBe(29);
  });

  test('the raising\'s line follows a GM\'s share: a tenth takes 4 of level 31', () => {
    expect(deathLine({ ...RULES, reviveLevelShare: 0.1 })).toContain('Reviving costs 10% of the hunter\'s level, rounded up (at least 1 level, never below level 1). For example, a hunter who died at level 31 comes back at level 27.');
  });

  test('the death line states the System revive debt clears and payoff share, and follows GM overrides', () => {
    expect(line).toContain('A System revive on debt costs 10 same-rank gate clears. 50% of your gate clear gold goes toward that debt until it is paid off.');
    expect(deathLine({ ...RULES, reviveDebtClears: 6, reviveDebtShare: 0.25 })).toContain('A System revive on debt costs 6 same-rank gate clears. 25% of your gate clear gold goes toward that debt until it is paid off.');
    const zero = deathLine({ ...RULES, reviveDebtShare: 0 });
    expect(zero).toContain('A System revive on debt costs 10 same-rank gate clears.');
    expect(zero).not.toContain('goes toward that debt');
  });

  test('the shop is closed to the dead, as the line says: a dead hunter\'s purchase and sale are refused, a living one\'s are not', () => {
    expect(line).toContain('A dead hunter cannot buy or sell in the shop. The GM or another hunter can still give a dead hunter a Resurrection Crystal.');
    const potion = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Health Potion')!);
    const rich = { ...putItem(newHunter(RULES), potion, 'i1' as never), gold: 1000 };
    expect(buy({ ...rich, life: { at: 'dead' } }, potion, 'i2' as never, RULES)).toEqual({ ok: false, why: 'dead' });
    expect(sell({ ...rich, life: { at: 'dead' } }, 'i1', 1, RULES)).toEqual({ ok: false, why: 'dead' });
    expect(refused(buy({ ...rich, life: { at: 'up', hp: 1 } }, potion, 'i2' as never, RULES))).toBe(false);
  });
});

describe('the solo run\'s lines', () => {
  test('state the odds\' count, the time cap and the personal gates\' numbers as the rules hold them', () => {
    const [run, gates] = soloLines(RULES);
    expect(run).toContain(`results of ${ODDS_RUNS} simulated fights`);
    expect(run).toContain(`neither side wins by round ${CAP_ROUNDS}, you retreat`);
    expect(run).toContain('your hunter can die.');
    expect(gates).toBe(`The System opens a personal gate every ${RULES.solo.hours} hours, up to ${RULES.solo.held} at a time. Each gate closes ${RULES.solo.stays} hours after opening, whether cleared or not.`);
  });

  test('say that the first gate after personal gates start is one monster of the hunter\'s own rank, and the rest the rule\'s pack', () => {
    expect(soloLines(RULES)[2]).toBe(`Your first personal gate (as a new hunter, after reviving, or after personal gates turn back on) has one monster of your rank. Later personal gates have ${RULES.solo.pack[0]} to ${RULES.solo.pack[1]} monsters, ranging from one rank below yours to one rank above.`);
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, pack: [2, 4] } })[2]).toContain('Later personal gates have 2 to 4 monsters');
  });

  test('follow a GM\'s change of the numbers, and say when personal gates are off', () => {
    const R = { ...RULES, solo: { ...RULES.solo, hours: 4, held: 6 } };
    expect(soloLines(R)[1]).toContain('every 4 hours, up to 6 at a time');
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, personal: false } })[1]).toBe('Personal gates are off.');
  });

  test('say how much harder a run\'s foes are, and on what: the square root of the rule on their HP and on their damage', () => {
    const root = Math.round(Math.sqrt(RULES.solo.autoHarder) * 100) / 100, pct = `${Math.round((RULES.solo.autoHarder - 1) * 1000) / 10}%`;
    expect(soloLines(RULES)[0]).toContain(`Foes in a solo run are ${pct} stronger than in table play. Each has ${root} times its normal HP and deals ${root} times its normal damage.`);
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, autoHarder: 1.44 } })[0]).toContain('44% stronger than in table play. Each has 1.2 times its normal HP and deals 1.2 times its normal damage');
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, autoHarder: 1 } })[0]).not.toContain('stronger');
  });

  test('say what share of a world gate\'s loot a cleared personal gate pays, and that a world gate run alone pays in full', () => {
    const pct = `${RULES.solo.lootShare * 100}%`;
    expect(soloLines(RULES)[3]).toBe(`Clearing a personal gate gives ${pct} of the loot of a same-rank world gate. You get ${pct} of the gold, rounded down, and a ${pct} chance for an item. Running a world gate solo gives full world-gate loot.`);
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, lootShare: 0.5 } })[3]).toContain('gives 50% of the loot');
    expect(soloLines({ ...RULES, solo: { ...RULES.solo, personal: false } }).join(' ')).not.toContain('Clearing a personal gate');
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
    expect(line).toContain('A consumable costs 50% of that amount');
    expect(line).toContain('sell items back to the Association for 25% of their price');
    expect(saleLine({ ...RULES, saleShare: 0.4, usedUpShare: 0.3 })).toContain('costs 30% of that amount');
    expect(saleLine({ ...RULES, saleShare: 0.4, usedUpShare: 0.3 })).toContain('for 40% of their price');
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
  expect(armorCutPct(R, armor)).toBe(100 - Math.round(100 * afterDefence(hit, 'physical', { armorPen: 0, resistPen: 0, armorPenFlat: 0, resistPenFlat: 0 }, { armor, resist: 0 }, R) / hit));
});

describe('the world gate\'s lines', () => {
  test('say the gate is made for a party of 4 whose gold and XP are one pot, and each share of 100 from 1 to 6 hunters', () => {
    const [pot, shares] = gatePayLines(RULES);
    expect(pot).toBe('A world gate is sized for a party of 4. Its total gold and XP equal 4 shares split evenly among the hunters in the gate, rounded down. Fewer hunters get more each. With more than 4 hunters, the total reward shrinks.');
    expect(shares).toBe('Each hunter\'s share of 100: 400 alone, 200 of 2, 133 of 3, 100 of 4, 64 of 5, 44 of 6.');
  });

  test('say a fight started from a gate pays its XP the same way and a fight from no gate pays each the whole, and a solo run is a party of one', () => {
    expect(gatePayLines(RULES).slice(2)).toEqual([
      'A fight inside a gate splits monster XP the same way from the gate total, and clearing the gate awards the rest. A fight outside a gate gives each hunter the full XP for every defeated monster.',
      'Running a world gate solo counts as a party of one, giving 4 times the gold roll and 4 times the XP.',
    ]);
  });

  test('follow a GM\'s change of the party', () => {
    const R = { ...RULES, gateParty: 2 };
    expect(gatePayLines(R)[0]).toContain('sized for a party of 2');
    expect(gatePayLines(R)[1]).toBe('Each hunter\'s share of 100: 200 alone, 100 of 2, 44 of 3, 25 of 4.');
    expect(gatePayLines(R)[3]).toContain('2 times the gold roll and 2 times the XP');
  });
});

describe('the lines on hiding', () => {
  const withStealth = (o: Partial<Rules['fight']['stealth']>): Rules => ({ ...RULES, fight: { ...RULES.fight, stealth: { ...RULES.fight.stealth, ...o } } });

  test('say that a foe with no sight content sees no hide, and that sight 2 sees a hide at 1 and not at 2: stealth beats sight at the same level (the owner, Nov 22)', () => {
    expect(stealthLines(RULES)[0]).toBe('A foe cannot see a hidden target if the foe\'s sight level is equal to or lower than the target\'s stealth level. Everyone starts at sight level 0. A foe with no extra sight from skills, items, or statuses sees no hidden targets. A foe with sight level 2 sees targets hidden at level 1 or lower. Allies always see hidden allies.');
  });

  test('follow a GM\'s change of everyone\'s sight', () => {
    expect(stealthLines(withStealth({ sightBase: 1 }))[0]).toContain('starts at sight level 1. A foe with no extra sight from skills, items, or statuses sees targets hidden at level 0 or lower');
  });

  test('say the ambush\'s share of the rules, and follow a GM\'s change of it', () => {
    expect(stealthLines(RULES)[2]).toBe(`Hitting a foe that cannot see you from hiding deals ×${RULES.fight.stealth.ambush} damage. This does not stack with other damage multipliers. Only the largest multiplier applies.`);
    expect(stealthLines(withStealth({ ambush: 1.25 }))[2]).toContain('deals ×1.25 damage');
  });

  test('say a hide\'s time, a cure, and each of the three events a status may end it on', () => {
    expect(stealthLines(RULES)[3]).toBe('Hiding ends when its duration runs out, when a cure removes it, or when one of its status triggers happens: the hidden target loses HP, a reveal ability (like Flare), an area effect, or a targeted tile hit reveals it, or the hidden target deals damage to a foe with an ability or reaction (not from an earlier field or status).');
  });
});

describe('the icons\' credit', () => {
  test('say who made the icons, where from and under which licence, as the owner asked for', () => {
    expect(iconCreditLine()).toBe('Icons made by Lorc and Delapouite, from game-icons.net, under CC BY 3.0.');
  });

  test('name every author icons-credit.md names', async () => {
    const credit = await Bun.file(`${import.meta.dir}/../src/core/registry/icons-credit.md`).text();
    const named = new Set([...credit.matchAll(/^\| \S+ \| (\S+) \|/gm)].map(m => m[1]).filter(a => a !== 'Author' && a !== 'drawn'));
    expect([...named].sort()).toEqual([...ICON_CREDIT.authors].sort());
  });
});

describe('how a mythic fights (unit MY7)', () => {
  test('the Rules page states how a mythic fights, with the rounds an answer buys read from the rules', () => {
    const text = mythicLines(RULES).join(' ');
    for (const word of ['phases', 'omen', 'A single ordinary hit does not answer an omen', 'stun', 'shielding', 'stepping off', 'stagger bar', 'burst damage', 'enraged']) expect(text).toContain(word);
    expect(text).toContain(`extends the phase timer by ${RULES.fight.mythic.answerTime.cancel} rounds if canceled`);
    const slower = { fight: { ...RULES.fight, mythic: { ...RULES.fight.mythic, answerTime: { cancel: 1, weaken: 2 } } } };
    expect(mythicLines(slower).join(' ')).toContain('by 1 round if canceled or 2 rounds if weakened');
  });
  test('a mythic\'s codex entry gives its shape and each phase by number', () => {
    const script = MYTHICS['angel-of-the-last-trumpet'];
    const lines = mythicCodexLines(script);
    expect(lines[0]).toBe(`The fight: ${script.shape}`);
    expect(lines).toHaveLength(1 + script.phases.length);
    expect(lines[1]).toBe(`Phase 1: ${script.phases[0]!.name}. ${script.phases[0]!.line}`);
  });
  test('the GM\'s switch writes fight.mythic.scripts and keeps the other overrides', async () => {
    const { mythicSwitched } = await import('../src/core/mythic-switch.ts');
    const { parseOverrides } = await import('../src/core/overrides.ts');
    const off = mythicSwitched({ rulesOverrides: { trade: { on: false }, fight: { mythic: { answerTime: { cancel: 2 } } } } }, false).rulesOverrides;
    expect(parseOverrides(off).refused).toEqual([]);
    expect(off).toEqual({ trade: { on: false }, fight: { mythic: { answerTime: { cancel: 2 }, scripts: false } } });
    const on = mythicSwitched({ rulesOverrides: off }, true).rulesOverrides;
    expect(parseOverrides(on).refused).toEqual([]);
    expect(on).toEqual({ trade: { on: false }, fight: { mythic: { answerTime: { cancel: 2 }, scripts: true } } });
  });
});
