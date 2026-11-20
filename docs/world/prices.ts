// prices.ts: every number of docs/world/economy.md (and the lifespan and XP tables of power.md), from the shipped RULES,
// the economy design's ruled numbers, and the world's own assumptions, each named below with its reason.
// Print:  bun docs/world/prices.ts            (every block, as markdown)
// Write:  bun docs/world/prices.ts --write    (replaces each <!-- prices:NAME --> block of economy.md and power.md)
// When the anchor moves (RULES.loot, or a number of WORLD), rerun with --write and read the prose beside each table.
import { RANKS, RULES } from '../../src/core/rules.ts';
import type { Rank } from '../../src/core/rules.ts';

// ── the game's numbers ──
/** One Clear: the mean gold one hunter of a party of four takes from a world gate of the rank (design.md section 0). */
const clear = (r: Rank): number => { const [lo = 0, hi = lo] = RULES.loot[r].gold; return (lo + hi) / 2; };
/** The economy design's ruled numbers (docs/agent-handoff/features/economy/design.md sections 7.1 and 10), not yet in RULES. */
const DESIGN = { gradeStep: 1.5, saleShare: 0.25, usedUpShare: 0.5, soloLootShare: 0.25, goldParty: 4, reviveClears: 10 } as const;
/**
 * The design's measured shares a hunter takes besides a Clear's gold (design.md section 4.3, block `[1.3 / 4.2] design`):
 * a Clear's items at their sale price, one personal run's gold and its item. Copied, because measure.ts computes them
 * from the item tables; when that table moves, copy it again.
 */
const MEASURED: Record<Rank, { clearItems: number; runGold: number; runItem: number }> = {
  E: { clearItems: 23, runGold: 17, runItem: 7 }, D: { clearItems: 47, runGold: 51, runItem: 12 },
  C: { clearItems: 81, runGold: 198, runItem: 25 }, B: { clearItems: 257, runGold: 770, runItem: 71 },
  A: { clearItems: 734, runGold: 1938, runItem: 154 }, S: { clearItems: 2249, runGold: 2375, runItem: 183 },
};
const RARITY_OF: Record<Rank, string> = { E: 'common', D: 'uncommon', C: 'rare', B: 'epic', A: 'legendary', S: 'mythic' };

// ── the world's assumptions: every one is a choice of the world bible, stated with its reason ──
const WORLD = {
  // THE ANCHOR. An unskilled labourer's day is 0.3 of an E Clear: an E-rank earns three labourer-days for one gate that
  // may kill them, and an E-rank who gets one gate a month earns less than the labourer (economy.md section 1).
  dayWageOfEClear: 0.3,
  mealsADay: 30,          // a labourer's day buys 30 plain street meals' worth: so one meal is one gold at the shipped rules
  workDaysAMonth: 25,
  medianOverUnskilled: 4 / 3, // the median wage over the unskilled one
  // The city of Carrow (history.md section 6).
  cityPeople: 6_000_000, awakenedOneIn: 500,
  rankShare: { E: 0.40, D: 0.33, C: 0.18, B: 0.07, A: 0.0199, S: 0.0001 } as Record<Rank, number>,
  worldGatesAMonth: 600,
  worldGateShare: { E: 0.45, D: 0.30, C: 0.155, B: 0.07, A: 0.02495, S: 0.00005 } as Record<Rank, number>,
  // Gates (economy.md section 8).
  entryFee: 0.1,           // a public gate's fee a head, of the gate's Clear
  harvestOfPot: 1.5,      // what the crystal and carcass of a cleared gate sell for, over the gate's gold pot
  crewLay: 0.25,          // the reclaimers' share of the harvest (the quarter lay)
  gateLevy: 0.20,         // the state's share of the harvest
  rightsBid: 0.6,         // what a winning bid pays, of the holder's expected net: the rest is the margin for a failed raid
  ripeBonus: 0.5,         // a harvest taken on the gate's last day over one taken on its first
  hunterLevy: 0.10,       // the state's share of a hunter's System gold
  // The market between the Shop's price and its quarter (economy.md section 3).
  fencePays: 0.40, usedSells: 0.70, runnerMarkup: 0.20, crystalBuyers: { helix: 0.90, exchange: 0.85, fence: 0.70 },
  // Guild pay (economy.md section 11), in Clears of the hunter's rank.
  retainerClears: 1.5, houseShare: 0.25, signingClears: 10, signingClearsLow: 2, deathClears: 20, transferClears: 20,
  roles: { 'Raid leader': 1.5, 'Healer': 1.5, 'Tanker': 1.2, 'Licensed extractor (Necromancer)': 1.3, 'Line hunter': 1, 'Bench': 0.5 } as Record<string, number>,
  // Mercenaries (section 10), in Clears of the mercenary's rank.
  mercDay: 0.5, mercRetainerDays: 12, redGateFactor: 2,
  // Insurance (section 12).
  crystalCover: 0.05, crystalLoanMonthly: 0.03,
  // What a working hunter spends: one potion of the hunter's rank every two world gates.
  potionsAGate: 0.5,
} as const;

// ── helpers ──
const WAGE = WORLD.dayWageOfEClear * clear('E');            // an unskilled day, gold
const MEAL = WAGE / WORLD.mealsADay;                         // a plain meal, gold
const MEDIAN = WAGE * WORLD.workDaysAMonth * WORLD.medianOverUnskilled; // the median month, gold
const WEEKS = 52 / 12;
/** A price for a table: two significant figures above 100, whole above 10, one decimal under. */
const nice = (n: number): string => {
  if (n >= 100) { const p = 10 ** (Math.floor(Math.log10(n)) - 1); return (Math.round(n / p) * p).toLocaleString('en-US'); }
  if (n >= 10) return String(Math.round(n));
  return n.toFixed(1).replace(/\.0$/, '');
};
const whole = (n: number): string => Math.round(n).toLocaleString('en-US');
const table = (head: string[], rows: (string | number)[][]): string =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const blocks = new Map<string, string>();
const block = (name: string, body: string): void => { blocks.set(name, body); };
const potion = (r: Rank): number => clear(r) * DESIGN.usedUpShare;
const crystal = (r: Rank): number => clear(r) * DESIGN.reviveClears;
const pot = (r: Rank): number => clear(r) * DESIGN.goldParty;

// ── 1. the anchor ──
block('anchor', table(['What', 'Gold', 'How it is derived'], [
  ['One E-rank Clear', whole(clear('E')), 'the middle of `RULES.loot.E.gold`: the game\'s number'],
  ['An unskilled labourer\'s day', nice(WAGE), `${WORLD.dayWageOfEClear} of an E Clear`],
  ['A plain street meal', nice(MEAL), `a labourer's day buys ${WORLD.mealsADay}`],
  ['An unskilled month', nice(WAGE * WORLD.workDaysAMonth), `${WORLD.workDaysAMonth} working days`],
  ['The median month\'s wage', nice(MEDIAN), 'four thirds of the unskilled month'],
  ['The median year', nice(MEDIAN * 12), 'twelve months'],
]));

// ── 4. everyday prices: each a count of labourer-days (W) so it moves with the anchor ──
const W = WAGE;
const everyday: [string, [string, number, string][]][] = [
  ['Food and drink', [
    ['A plain street meal (noodles, a filled bread)', 1 / 30, 'the anchor'], ['Tea or coffee', 1 / 60, ''], ['A loaf of bread', 1 / 75, ''],
    ['A beer in a bar', 1 / 25, ''], ['A week of groceries, one adult', 0.75, 'a quarter of an unskilled week'],
    ['Dinner for two, a Saltmarket restaurant', 0.5, ''], ['Dinner for two in the Crown', 3, ''],
    ['A plate of monster meat (D-rank boar, from a licensed butcher)', 0.6, 'reclaimers sell carcasses to butchers'],
  ]],
  ['Home', [
    ['Stone-grid power, a household, a month', 1, ''], ['Water and waste, a month', 0.35, ''], ['A phone plan with Doorwatch alerts, a month', 0.3, ''],
    ['A phone', 12, ''], ['Work boots', 1, ''], ['A good suit or dress', 5, ''], ['A go-bag, packed to the Bureau\'s list', 2, 'a household in an Amber zone keeps one for each person'],
  ]],
  ['Getting around', [
    ['A tram or bus ride', 1 / 100, ''], ['A month\'s pass', 0.5, ''], ['A taxi across town', 0.2, ''], ['Rail to the next city', 1, 'trains between cities run armoured and escorted'],
    ['A flight inside the country', 4, ''], ['A flight abroad', 20, 'few routes, each with a hunter escort'], ['A bicycle', 2, ''],
    ['A used car', 80, ''], ['A new car, stone cell', 300, 'about ten median months'], ['A hired escort car with a D-rank guard, a day', 8, ''],
  ]],
  ['Health (the unawakened)', [
    ['A clinic visit', 0.4, ''], ['A night in a trauma ward', 3, ''], ['A birth, with a week\'s care', 10, ''], ['A year of health cover, one adult', 20, ''],
    ['A funeral', 18, ''],
  ]],
  ['School and services', [
    ['A year at a private school', 100, ''], ['A year at university', 130, ''], ['A year at a hunter academy (unsponsored)', 300, 'nine median months; a guild sponsors most students'],
    ['A lawyer, an hour', 1.3, ''], ['A lawyer who specialises in guild contracts, an hour', 4, ''], ['A wedding, Saltmarket', 130, ''],
  ]],
  ['Wages (a month unless said)', [
    ['An unskilled labourer, a day', 1, 'the anchor'], ['The median wage', WORLD.workDaysAMonth * WORLD.medianOverUnskilled, ''], ['A teacher', 37, ''], ['A nurse', 40, ''],
    ['A Bureau clerk', 38, ''], ['A soldier of the cordon', 30, ''], ['A doctor', 130, ''], ['A crystal cutter at Helix', 55, ''],
    ['A guild analyst', 85, ''], ['A reclaimer (carcass crew), a day in a gate', 2.5, 'when paid a wage; most crews take a quarter of the harvest'],
  ]],
];
block('everyday', everyday.map(([title, rows]) => `**${title}**\n\n` + table(['Thing', 'Gold', 'Labourer-days', 'Note'],
  rows.map(([what, w, note]) => [what, nice(w * W), w >= 1 ? nice(w) : w.toFixed(2), note]))).join('\n\n'));

// ── 5. housing by district: a family flat's monthly rent in labourer-days; one room is 40% of it; a price is 200 rents ──
const districts: [string, string, number][] = [
  ['The Crown', 'Green. The city centre. Response time four minutes', 80],
  ['Ledger Row', 'Green. The guild halls and the Bureau are here', 55],
  ['Saltmarket', 'Amber. Where most of the city lives', 20],
  ['Northfield', 'Amber. A suburb of houses, forty minutes by tram', 17],
  ['Tidewall', 'Amber. The port and its warehouses', 15],
  ['Scarside', 'Red. Beside the Scar. No insurer sells break cover here', 6],
];
const PRICE_RENTS = 200, ROOM = 0.4;
block('housing', table(['District', 'What it is', 'One room, a month', 'Family flat, a month', 'Family flat, to buy', 'Median years of wage to buy'],
  districts.map(([d, what, w]) => [d, what, nice(w * W * ROOM), nice(w * W), nice(w * W * PRICE_RENTS), (w * W * PRICE_RENTS / (MEDIAN * 12)).toFixed(1)]))
  + `\n\nA floor of a guild tower in Ledger Row rents for ${nice(1300 * W)} a month. The last S-rank's estate sold in the Crown went for ${nice(1_000_000 * W)}.`);

// ── 6. medicine and potions ──
const consumableNames: Record<Rank, string> = { E: 'Health Potion, Mana Potion, Stamina Tonic', D: 'Greater Health Potion', C: '(none built in)', B: 'Elixir of Life', A: '(none built in)', S: '(none built in)' };
block('potions', table(['Tier (rank)', 'Built-in', 'Shop price', 'Sells to the Shop', 'A runner\'s price to the unawakened', 'Labourer-days'],
  RANKS.map(r => [`${RARITY_OF[r]} (${r})`, consumableNames[r], whole(potion(r)), whole(Math.max(1, Math.floor(potion(r) * DESIGN.saleShare))), nice(potion(r) * (1 + WORLD.runnerMarkup)), nice(potion(r) / W)])));

// ── 7. gear ──
block('gear', table(['Tier (rank)', 'Minus', 'Middle', 'Plus', 'The Shop buys at', 'A fence pays', 'Used, at a stall', 'A set of ten, middle', 'Median months for the set'],
  RANKS.map(r => { const c = clear(r); return [`${RARITY_OF[r]} (${r})`, whole(c / DESIGN.gradeStep), whole(c), whole(c * DESIGN.gradeStep), whole(Math.floor(c * DESIGN.saleShare)), whole(c * WORLD.fencePays), whole(c * WORLD.usedSells), whole(c * RULES.slots.length), (c * RULES.slots.length / MEDIAN).toFixed(1)]; })));

// ── 8. gates ──
const harvest = (r: Rank): number => pot(r) * WORLD.harvestOfPot;
const holderNet = (r: Rank): number => harvest(r) * (1 - WORLD.crewLay - WORLD.gateLevy);
const rights = (r: Rank): number => holderNet(r) * WORLD.rightsBid;
block('gates', table(['Gate', 'Breaks on day', 'Gold pot (party of 4)', 'One Clear', 'Entry fee for each hunter', 'Harvest', 'Crew\'s share', 'State levy', 'Holder nets', 'Rights at auction', 'Harvest if ripe (last day)'],
  RANKS.map(r => [r, RULES.rankTable[r].breakDays, whole(pot(r)), whole(clear(r)), nice(clear(r) * WORLD.entryFee), whole(harvest(r)), whole(harvest(r) * WORLD.crewLay), whole(harvest(r) * WORLD.gateLevy), whole(holderNet(r)), nice(rights(r)), whole(harvest(r) * (1 + WORLD.ripeBonus))])));
block('gate-count', table(['Rank', 'Hunters in Carrow', 'World gates a month', 'Seats a month (parties of 4)', 'Seats a hunter of the rank a month'],
  RANKS.map(r => { const h = WORLD.cityPeople / WORLD.awakenedOneIn * WORLD.rankShare[r], g = WORLD.worldGatesAMonth * WORLD.worldGateShare[r]; return [r, nice(h), g >= 1 ? nice(g) : g.toFixed(2), g * 4 >= 1 ? nice(g * 4) : (g * 4).toFixed(2), (g * 4 / h).toFixed(2)]; })));

// ── 9. mana crystal ──
block('crystal-trade', table(['Crystal of a gate', 'Assay value of one boss core', 'Helix pays', 'The Bureau exchange pays', 'A fence pays', 'The Shop pays', 'Households it powers for a month'],
  RANKS.map(r => { const c = clear(r); return [r, whole(c), whole(c * WORLD.crystalBuyers.helix), whole(c * WORLD.crystalBuyers.exchange), whole(c * WORLD.crystalBuyers.fence), whole(Math.floor(c * DESIGN.saleShare)), nice(c * 1.5 / W)]; })));

// ── 10. mercenaries ──
block('mercs', table(['Mercenary\'s rank', 'A day (guard, escort, standby)', 'A gate of their rank (fee, plus an equal share)', 'A gate, flat (no share, drops to the hirer)', 'A red gate, flat', 'A month\'s retainer', 'A healer, a day'],
  RANKS.map(r => { const d = clear(r) * WORLD.mercDay; return [r, whole(d), whole(d), whole(d * 2 + clear(r)), whole((d * 2 + clear(r)) * WORLD.redGateFactor), whole(d * WORLD.mercRetainerDays), whole(d * 1.5)]; })));

// ── 11. guild pay ──
block('guild-pay', table(['Rank', 'Retainer a month (line hunter)', 'House share of gate gold', 'Signing bonus', 'Death benefit', 'Transfer fee', 'Pension a month (after ten years)'],
  RANKS.map(r => { const c = clear(r); const sign = (r === 'E' || r === 'D') ? WORLD.signingClearsLow : WORLD.signingClears; return [r, whole(c * WORLD.retainerClears), `${WORLD.houseShare * 100}%`, whole(c * sign), whole(c * WORLD.deathClears), whole(c * WORLD.transferClears), whole(c * WORLD.retainerClears / 2)]; })));
block('guild-roles', table(['Role', 'Retainer, times the line hunter\'s', ...RANKS], Object.entries(WORLD.roles).map(([role, f]) => [role, f, ...RANKS.map(r => whole(clear(r) * WORLD.retainerClears * f))])));
const staff: [string, number][] = [['Gate porter (unawakened), for one gate: 0.3 of the gate\'s Clear', 0], ['Reclaimer on a share: the crew splits a quarter of the harvest', 0], ['Guild clerk, a month', 36], ['Analyst, a month', 85], ['Scout (a retired C-rank), a month', 150], ['Contract lawyer, a month', 260], ['Press officer, a month', 110]];
block('guild-staff', table(['Staff', 'Gold'], staff.map(([s, w]) => [s, w ? nice(w * W) : 'as described'])));
// A guild's books on one gate it holds the rights to, cleared by four of its line hunters on a four-gate month.
block('guild-books', table(['Gate', 'Harvest net', 'House share', 'Rights paid', 'Retainers (4 hunters, a quarter of a month)', 'Left for the house'],
  RANKS.map(r => { const c = clear(r), inn = holderNet(r) + pot(r) * WORLD.houseShare, out = rights(r) + 4 * c * WORLD.retainerClears / 4; return [r, whole(holderNet(r)), whole(pot(r) * WORLD.houseShare), whole(rights(r)), whole(4 * c * WORLD.retainerClears / 4), whole(inn - out)]; })));

// ── 12. bribes, fines, insurance: in Clears of the rank named ──
const law: [string, number, string][] = [
  ['Bribe: a clerk moves your party up a gate\'s queue', 0.5, 'the gate\'s'], ['Bribe: an assessor "rounds down" a gate\'s rank', 4, 'the gate\'s true'],
  ['Bribe: an assessor files a reading one rank low (to avoid the call-up)', 5, 'the hunter\'s true'], ['A forged licence', 3, 'the licence\'s'],
  ['An unlicensed seat in a gate, bought from the Stair', 0.5, 'the gate\'s'], ['Smuggling a hunter over a border', 10, 'the hunter\'s'],
  ['Fine: entering a gate without licence or fee', 2, 'the gate\'s'], ['Fine: selling an unlicensed seat', 10, 'the gate\'s'],
  ['Fine: a gate declared late (found, not reported in a day)', 5, 'the gate\'s'], ['Fine: a hunter unregistered past the 72 hours', 3, 'the hunter\'s'],
  ['Fine: under-declared gold', 0.3, 'three times the levy dodged, on each Clear of the hunter\'s'], ['Bail for a hunter', 8, 'the hunter\'s'],
];
block('law', table(['What', 'Clears', 'Of which rank', ...RANKS], law.map(([what, n, of]) => [what, n, of, ...RANKS.map(r => nice(clear(r) * n))])));
block('insurance', table(['Rank', 'Crystal cover, a year', 'A crystal on credit: interest a month'],
  RANKS.map(r => [r, whole(crystal(r) * WORLD.crystalCover), whole(crystal(r) * WORLD.crystalLoanMonthly)])));
const BREAK_RATE: Record<string, number> = { 'The Crown': 0.004, 'Ledger Row': 0.004, 'Saltmarket': 0.015, 'Northfield': 0.015, 'Tidewall': 0.02, 'Scarside': 0 };
block('break-cover', table(['District', 'Rate a year, of the flat\'s price', 'Break cover a year, a family flat'],
  districts.map(([d, , w]) => [d, BREAK_RATE[d] ? `${(BREAK_RATE[d]! * 100).toFixed(1)}%` : 'refused', BREAK_RATE[d] ? nice(w * W * PRICE_RENTS * BREAK_RATE[d]!) : 'none sold'])));

// ── 13. crystals ──
block('crystals', table(['Crystal', 'Shop price', 'Median months of wage', 'A clinic\'s price to raise a hunter', 'From the Stair, with no record', 'Months of a guild liner\'s net income'],
  RANKS.map(r => [r, whole(crystal(r)), (crystal(r) / MEDIAN).toFixed(1), whole(crystal(r) * 1.1), whole(crystal(r) * 1.5), '']))); // the last column is filled after incomes

// ── 14. incomes ──
type Profile = { name: string; gates: number; personalAWeek: number; guild: boolean; what: string };
const PROFILES: Profile[] = [
  { name: 'Occasional freelancer', gates: 0.25, personalAWeek: 1, guild: false, what: 'one world gate every four months, one personal gate a week, and a day job' },
  { name: 'Freelancer', gates: 1, personalAWeek: 5, guild: false, what: 'one public gate a month and five personal gates a week' },
  { name: 'Guild liner', gates: 4, personalAWeek: 5, guild: true, what: 'four guild gates a month and five personal gates a week' },
  { name: 'A table\'s party', gates: 4.33, personalAWeek: 3, guild: false, what: 'one own-rank gate a week and three personal gates a week, the design\'s table player' },
];
/** A month of one hunter: gross, what goes out for the work, and what is left. An S-rank's personal gates are A gates (the design's table). */
function month(r: Rank, p: Profile): { gross: number; out: number; net: number } {
  const c = clear(r), m = MEASURED[r], runs = p.personalAWeek * WEEKS;
  const gateGold = p.gates * c, personalGold = runs * m.runGold;
  const gross = gateGold * (p.guild ? 1 - WORLD.houseShare : 1) + p.gates * m.clearItems + runs * (m.runGold + m.runItem) + (p.guild ? c * WORLD.retainerClears : 0);
  const out = (gateGold + personalGold) * WORLD.hunterLevy + p.gates * WORLD.potionsAGate * potion(r) + (p.guild ? 0 : p.gates * c * WORLD.entryFee) + crystal(r) * WORLD.crystalCover / 12;
  return { gross, out, net: gross - out };
}
block('incomes', PROFILES.map(p => `**${p.name}** (${p.what})\n\n` + table(['Rank', 'Gross a month', 'Levy, potions, entry fees, crystal cover', 'Net a month', 'Times the median wage', 'Months of net for a set of own-rank gear', 'Years of net for a Saltmarket flat'],
  RANKS.map(r => { const x = month(r, p); return [r, whole(x.gross), whole(x.out), whole(x.net), (x.net / MEDIAN).toFixed(1), (clear(r) * 10 / x.net).toFixed(1), (20 * W * PRICE_RENTS / x.net / 12).toFixed(1)]; }))).join('\n\n'));
const liner = PROFILES[2]!;
blocks.set('crystals', table(['Crystal', 'Shop price', 'Median months of wage', 'A clinic\'s price to raise a hunter', 'From the Stair, with no record', 'Months of a guild liner\'s net income', 'Months of a freelancer\'s'],
  RANKS.map(r => [r, whole(crystal(r)), (crystal(r) / MEDIAN).toFixed(1), whole(crystal(r) * 1.1), whole(crystal(r) * 1.5), (crystal(r) / month(r, liner).net).toFixed(1), (crystal(r) / month(r, PROFILES[1]!).net).toFixed(1)])));

// ── power.md: levels, XP, the three roads, lifespan ──
const xpTo = (level: number): number => RULES.xpPerLevel * level * (level - 1) / 2; // total XP to reach a level from 1
const gateXp = (r: Rank): number => RULES.rankTable[r].xp * (4 * RULES.fight.kinds.normal.xp + RULES.fight.kinds.boss.xp); // four normals and a boss: one hunter's share in a party of four (XP is split as gold is, design.md section 10 ruling 7)
const dailyXp = RULES.dailyTemplate.rewards.xp;
const next = (r: Rank): Rank | null => RANKS[RANKS.indexOf(r) + 1] ?? null;
block('roads', table(['Step', 'XP needed', 'The daily quest alone', 'Own-rank world gates in a party of four', 'Own-rank world gates alone (four shares)', 'One own-rank gate a week in a party of four, and the daily quest'],
  RANKS.filter(r => next(r)).map(r => { const n = next(r)!, need = xpTo(RULES.rankLevels[n]) - xpTo(RULES.rankLevels[r]);
    const tableMonth = WEEKS * gateXp(r) + dailyXp * 30.4;
    return [`${r} to ${n} (level ${RULES.rankLevels[r]} to ${RULES.rankLevels[n]})`, whole(need), `${(need / dailyXp / 365).toFixed(1)} years`, Math.ceil(need / gateXp(r)), Math.ceil(need / gateXp(r) / DESIGN.goldParty), `${(need / tableMonth).toFixed(1)} months`]; }))
  + `\n\nE to S takes ${whole(xpTo(RULES.rankLevels.S))} XP. By the daily quest alone that is ${(xpTo(RULES.rankLevels.S) / dailyXp / 365).toFixed(1)} years.`);
const growth = (level: number): number => 1 + (level - 1) / RULES.fight.growthDiv;
const BASE_LIFE = 80, AWAKE_AT = 25;
block('lifespan', table(['Rank', 'First level', 'Growth (the game\'s g)', 'Time to age one year', 'Awakened at 25 and at this rank from then on: lives to about', 'Ageing over ten years at this rank'],
  RANKS.map(r => { const g = growth(RULES.rankLevels[r]); return [r, RULES.rankLevels[r], g.toFixed(2), `${g.toFixed(1)} years`, Math.round(AWAKE_AT + (BASE_LIFE - AWAKE_AT) * g), `${(10 / g).toFixed(1)} years`]; })));
// ── print or write ──
if (process.argv.includes('--write')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const used = new Set<string>();
  let missing = false;
  for (const file of ['economy.md', 'power.md']) {
    const path = new URL(file, import.meta.url).pathname;
    const text = readFileSync(path, 'utf8').replace(/<!-- prices:([\w-]+) -->[\s\S]*?<!-- \/prices:\1 -->/g, (all, name: string) => {
      const body = blocks.get(name);
      if (body === undefined) { console.error(`${file}: no block named ${name}`); missing = true; return all; }
      used.add(name);
      return `<!-- prices:${name} -->\n${body}\n<!-- /prices:${name} -->`;
    });
    writeFileSync(path, text);
  }
  for (const name of blocks.keys()) if (!used.has(name)) console.error(`block ${name} is in no file`);
  if (missing) process.exit(1);
} else {
  for (const [name, body] of blocks) console.log(`\n[${name}]\n\n${body}`);
}
