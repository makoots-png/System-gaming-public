// prices.ts: every number of docs/world/economy.md (and the lifespan and XP tables of power.md, and the crafting tables
// of items.md), from the shipped RULES, the economy design's ruled numbers, and the world's own assumptions, each named
// below with its reason.
// Print:  bun docs/world/prices.ts            (every block, as markdown)
// Write:  bun docs/world/prices.ts --write    (replaces each <!-- prices:NAME --> block of economy.md, power.md, items.md)
// When the anchor moves (RULES.loot, or a number of WORLD), rerun with --write and read the prose beside each table.
import { RANKS, RULES } from '../../src/core/rules.ts';
import type { Rank } from '../../src/core/rules.ts';
import { WEAR_LIMIT } from '../../src/core/registry/items.ts';

// ── the game's numbers ──
/** One Clear: the mean gold one hunter of a party of four takes from a world gate of the rank (design.md section 0). */
const clear = (r: Rank): number => { const [lo = 0, hi = lo] = RULES.loot[r].gold; return (lo + hi) / 2; };
/** The economy design's ruled numbers (docs/agent-handoff/features/economy/design.md sections 7.1 and 10), not yet in RULES. */
const DESIGN = { gradeStep: 1.5, saleShare: 0.25, soloLootShare: 0.25, goldParty: 4, reviveClears: 10 } as const;
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
  // THE ANCHOR (the owner, Nov 20): gold replaced the dollar, hunters tend to be richer, and an E-rank is only a bit richer
  // than a day labourer despite working less often. At 0.12 of an E Clear a day, an E-rank with four gates a month nets
  // about 1.4 labourer's months, and the gold the gates have minted in 20 years is a sound reserve for the city's money.
  dayWageOfEClear: 0.12,
  mealsADay: 30,          // a labourer's day buys 30 plain street meals' worth: so one meal is one gold at the shipped rules
  workDaysAMonth: 25,
  medianOverUnskilled: 4 / 3, // the median wage over the unskilled one
  // The city of Carrow (history.md section 6).
  cityPeople: 6_000_000, awakenedOneIn: 500,
  rankShare: { E: 0.40, D: 0.33, C: 0.18, B: 0.07, A: 0.0199, S: 0.0001 } as Record<Rank, number>,
  worldGatesAMonth: 3000, // 100 a day: set so that the guilds' members can be seated (the check `Guild seats`)
  auctionedShare: 0.5,    // the share of world gates whose rights the Bureau sells; the rest are public
  workersShare: 0.5, peopleAHousehold: 2.5, labourShare: 0.6, // workers of the people; people a home; wages of all income
  // Carrow's guilds that raid (factions.md): their members. Redline's mercenaries are counted with the unsigned.
  guildMembers: { Ironwake: 500, 'Lantern Company': 1000, Aurelian: 60, 'Ninth Hour': 40 } as Record<string, number>,
  linerGates: 4, freelancerGates: 1, occasionalGates: 0.25,           // world gates a month, by way of working
  // PERSONAL GATES (the owner, Nov 20): the System opens none on a timer. One opens when a gate key is used, or when the GM says so.
  keyAClear: 1 / 200,       // gate keys a cleared world gate drops
  // DEATH AND THE REVIVE LADDER (the owner, Nov 20): first revive free, second on debt, third+ only by pre-bought crystal or GM grant.
  deathAWorldSeat: 0.001,   // fatal downs per seat in an own-rank world gate
  unrecoverableShare: 0.25, // share of gate deaths that cannot be raised within the hour (red-gate wipes, double-gate ambushes, lost bodies)
  reviveStage: { firstFree: 0.30, secondDebt: 0.25, thirdPlus: 0.45 }, // share of recoverable deaths by how many times the hunter has died
  carriesCrystal: { liner: 1.0, freelancer: 0.2, occasional: 0.05 }, // share carrying a pre-bought crystal on a 3rd+ death, by work type
  insurerLoad: 1.1,         // an insurer's premium over the expected claim
  // WHAT HUNTERS SPEND AT THE SHOP (bought new, or as a crafter's catalyst).
  gearSetsAYear: { regular: 0.5, occasional: 0.05 }, // share of a ten-piece own-rank set bought new/crafted a year; used gear fills the rest
  seedsAYear: 2,            // own-rank seeds bought a year per regular hunter (proposed, needs the owner)
  booksAYear: 0.25,         // own-rank skill books bought a year per regular hunter (about one every four years)
  foodPerGate: 0.5,         // share of world gates where the party buys a cooked meal (destroys catalyst only)
  escapePerGate: 0.02,      // share of world gates where a party burns a Shop escape stone to get out
  // WHAT RESIDENTS BUY THROUGH RUNNERS (derived from medical demand, not fitted to city income).
  erVisitsPerPersonAYear: 0.25,  // emergency room visits per resident a year
  erPotionShare: 0.25,           // share of ER visits that use an E Health Potion (10 gold Shop price)
  householdPotionsAYear: 1.0,    // E Health Potions a household buys a year (accidents, workplace injuries, go-bag rotation)
  severeTraumaPerPersonAYear: 0.005, // severe injuries a year using a D Greater Health Potion (32.5 gold Shop price)
  criticalIllnessPerPersonAYear: 0.005, // cancers and life-threatening crises a year
  elixirUptake: 1 / 3,           // share of critical cases that buy one B Elixir of Life (500 gold Shop price)
  // MONEY SUPPLY AND THE 20-YEAR STOCK (history.md: Day Zero was 20 years ago; Tide started Year 5).
  yearsSinceDayZero: 20,
  breakYears: 4,            // Years 0 to 3: clearing ran at a lower share of Year 4's rate
  breakYearsShare: 0.4,     // share of Year-4 clearing achieved per year during the Break Years
  growthAYear: 0.03,        // the Tide: gates, and the gold they mint, grow 3% a year
  moneyTurnsAYear: 2.5,     // how often broad money (gold, notes and deposits) changes hands for final goods in a year
  // Power. The city's fuel is its harvest: households and industry burn all of it.
  powerBillOfWage: 1.5,     // a household's monthly power bill, in labourer-days
  industryPower: 1,         // industry's power use over all households'
  // Breaks.
  breakShare: 0.001,        // the share of world gates that break: nobody found them, or the raid failed
  homesLostABreak: 300, breakZone: { Green: 0.3, Amber: 1, Red: 4 } as Record<string, number>, breakLoad: 1.5,
  // Law: the chance an offence is found, which a fine must outweigh.
  caught: { unlicensed: 0.5, underDeclared: 0.4 },
  worldGateShare: { E: 0.45, D: 0.30, C: 0.155, B: 0.07, A: 0.02495, S: 0.00005 } as Record<Rank, number>,
  // Gates (economy.md section 8).
  entryFee: 0.1,            // a public gate's fee a head, of the gate's Clear
  harvestOfPot: 1.5,        // what the crystal and carcass of a cleared gate sell for, over the gate's gold pot
  crewLay: 0.25,            // the reclaimers' share of the harvest (the quarter lay)
  gateLevy: 0.20,           // the state's share of the harvest
  rightsBid: 0.6,           // what a winning bid pays, of the holder's expected net: the rest is the margin for a failed raid
  ripeBonus: 0.5,           // a harvest taken on the gate's last day over one taken on its first
  hunterLevy: 0.10,         // the state's share of a hunter's System gold
  // The market between the Shop's price and its quarter (economy.md section 3).
  fencePays: 0.40, usedSells: 0.70, runnerMarkup: 0.20, crystalBuyers: { helix: 0.90, exchange: 0.85, fence: 0.70 },
  // Guild pay (economy.md section 11), in Clears of the hunter's rank.
  retainerClears: 1.5, houseShare: 0.25, signingClears: 10, signingClearsLow: 2, deathClears: 20, transferClears: 20,
  roles: { 'Raid leader': 1.5, 'Healer': 1.5, 'Tanker': 1.2, 'Licensed extractor (Necromancer)': 1.3, 'Line hunter': 1, 'Bench': 0.5 } as Record<string, number>,
  // Mercenaries (section 10), in Clears of the mercenary's rank.
  mercDay: 0.5, mercRetainerDays: 12, redGateFactor: 2,
  // Insurance (section 12).
  crystalLoanMonthly: 0.03, // crystal cover is derived: see `coverRate`
  // CONSUMABLES (the owner, Nov 20: the half rule is wrong; cheap staples, dear things that punch above their rank).
  // A consumable's price is the Clear of the rank whose power it delivers, times a share by how long it lasts.
  lasts: { moment: 0.1, fight: 0.5, gate: 1, run: 2, forever: 10 },
  seedClears: 1,            // a seed: permanent stat points (scaling with rank; proposed, needs the owner)
  // What a working hunter uses per world gate: staples (heal, mana, stamina, status remover) and fight tonics.
  staplesAGate: 1, tonicsAGate: 0.2,
  // CRAFTING. A crafted item is made of materials and one catalyst bought from the Shop, and sells under the Shop's price.
  craftMaterials: 0.45,     // materials, of the Shop's price of the thing made
  craftCatalyst: 0.2,       // the Shop's catalyst, of the same: the gold a craft destroys
  craftSells: 0.85,         // what a crafter charges, of the Shop's price
  craftedShare: 0.5,        // the share of hunters' consumables and gear that crafters supply
  // ENHANCEMENT. A stone raises one piece of gear one grade, or fails and is lost.
  stoneClears: 0.5, stoneWorks: 0.5,
  stonesAYear: 4,           // enhancement stones a hunter with a regular seat buys in a year
} as const;

// ── helpers ──
const WAGE = WORLD.dayWageOfEClear * clear('E');            // an unskilled day, gold
const MEAL = WAGE / WORLD.mealsADay;                         // a plain meal, gold
const MEDIAN = WAGE * WORLD.workDaysAMonth * WORLD.medianOverUnskilled; // the median month, gold
const WEEKS = 52 / 12;
/** Crystal cover's yearly premium over the crystal's price: the chance of a covered death in a liner's year, times the insurer's load. */
const coverRate = WORLD.deathAWorldSeat * WORLD.linerGates * 12 * WORLD.insurerLoad;
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
/** A staple consumable of a rank: a heal, mana, stamina or a status remover. */
const potion = (r: Rank): number => clear(r) * WORLD.lasts.moment;
/** What a hunter spends on consumables for one world gate of their rank. */
const gateKit = (r: Rank): number => clear(r) * (WORLD.staplesAGate * WORLD.lasts.moment + WORLD.tonicsAGate * WORLD.lasts.fight);
/** The share of a hunter's spending on craftable things that the Shop destroys: bought new, or as a crafter's catalyst. */
const shopDestroys = (1 - WORLD.craftedShare) + WORLD.craftedShare * WORLD.craftCatalyst;
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
    ['Crystal-grid power, a household, a month', WORLD.powerBillOfWage, 'fuel is under a fifth of the bill; the rest is the grid and Helix'], ['Water and waste, a month', 0.35, ''], ['A phone plan with Doorwatch alerts, a month', 0.3, ''],
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
const LASTS: [keyof typeof WORLD.lasts, string][] = [['moment', 'A moment: a staple'], ['fight', 'One fight: a tonic or a thrown item'], ['gate', 'One gate: food'], ['run', 'Gets the party out: an escape stone'], ['forever', 'For good: a skill book']];
block('potions', table(['Rank of the power it gives', ...LASTS.map(([, label]) => label), 'A seed', 'A staple through a runner', 'A staple, labourer-days'],
  RANKS.map(r => [r, ...LASTS.map(([k]) => whole(clear(r) * WORLD.lasts[k])), whole(clear(r) * WORLD.seedClears), nice(potion(r) * (1 + WORLD.runnerMarkup)), nice(potion(r) / W)])));
block('crafting', table(['Tier (rank)', 'Shop price, a middle item', 'Materials', 'Catalyst from the Shop', 'What the crafter charges', 'The crafter keeps', 'A used one at a stall'],
  RANKS.map(r => { const c = clear(r); return [`${RARITY_OF[r]} (${r})`, whole(c), whole(c * WORLD.craftMaterials), whole(c * WORLD.craftCatalyst), whole(c * WORLD.craftSells), whole(c * (WORLD.craftSells - WORLD.craftMaterials - WORLD.craftCatalyst)), whole(c * WORLD.usedSells)]; })));
block('enhancement', table(['Tier (rank)', 'A stone', 'Chance it works', 'Expected cost of one grade', 'What a grade adds to the Shop price (middle to plus)'],
  RANKS.map(r => { const c = clear(r); return [`${RARITY_OF[r]} (${r})`, whole(c * WORLD.stoneClears), `${WORLD.stoneWorks * 100}%`, whole(c * WORLD.stoneClears / WORLD.stoneWorks), whole(c * (DESIGN.gradeStep - 1))]; })));

// ── 7. gear ──
block('gear', table(['Tier (rank)', 'Minus', 'Middle', 'Plus', 'The Shop buys at', 'A fence pays', 'Used, at a stall', 'A set of six, middle', 'Median months for the set'],
  RANKS.map(r => { const c = clear(r); return [`${RARITY_OF[r]} (${r})`, whole(c / DESIGN.gradeStep), whole(c), whole(c * DESIGN.gradeStep), whole(Math.floor(c * DESIGN.saleShare)), whole(c * WORLD.fencePays), whole(c * WORLD.usedSells), whole(c * WEAR_LIMIT), (c * WEAR_LIMIT / MEDIAN).toFixed(1)]; })));

// ── 8. gates ──
const harvest = (r: Rank): number => pot(r) * WORLD.harvestOfPot;
const holderNet = (r: Rank): number => harvest(r) * (1 - WORLD.crewLay - WORLD.gateLevy);
const rights = (r: Rank): number => holderNet(r) * WORLD.rightsBid;
block('gates', table(['Gate', 'Breaks on day', 'Gold pot (party of 4)', 'One Clear', 'Entry fee for each hunter', 'Harvest', 'Crew\'s share', 'State levy', 'Holder nets', 'Rights at auction', 'Harvest if ripe (last day)'],
  RANKS.map(r => [r, RULES.rankTable[r].breakDays, whole(pot(r)), whole(clear(r)), whole(clear(r) * WORLD.entryFee), whole(harvest(r)), whole(harvest(r) * WORLD.crewLay), whole(harvest(r) * WORLD.gateLevy), whole(holderNet(r)), whole(rights(r)), whole(harvest(r) * (1 + WORLD.ripeBonus))])));
block('gate-count', table(['Rank', 'Hunters in Carrow', 'World gates a month', 'Seats a month (parties of 4)', 'Seats a hunter of the rank a month'],
  RANKS.map(r => { const h = WORLD.cityPeople / WORLD.awakenedOneIn * WORLD.rankShare[r], g = WORLD.worldGatesAMonth * WORLD.worldGateShare[r]; return [r, nice(h), g >= 1 ? nice(g) : g.toFixed(2), g * 4 >= 1 ? nice(g * 4) : (g * 4).toFixed(2), (g * 4 / h).toFixed(2)]; })));

// ── 9. mana crystal ──
const gatesOf = (r: Rank): number => WORLD.worldGatesAMonth * WORLD.worldGateShare[r];
const HARVEST_TOTAL = RANKS.reduce((n, r) => n + gatesOf(r) * harvest(r), 0); // the city's fuel a month, gold
/** Households one gold of crystal powers for a month: the city burns its whole harvest, industry included. */
const HOMES_A_GOLD = (WORLD.cityPeople / WORLD.peopleAHousehold) * (1 + WORLD.industryPower) / HARVEST_TOTAL;
block('crystal-trade', table(['Crystal of a gate', 'Assay value of one boss core', 'Helix pays', 'The Bureau exchange pays', 'A fence pays', 'The Shop pays', 'Households it powers for a month'],
  RANKS.map(r => { const c = clear(r); return [r, whole(c), whole(c * WORLD.crystalBuyers.helix), whole(c * WORLD.crystalBuyers.exchange), whole(c * WORLD.crystalBuyers.fence), whole(Math.floor(c * DESIGN.saleShare)), nice(c * HOMES_A_GOLD)]; })));

// ── 10. mercenaries ──
block('mercs', table(['Mercenary\'s rank', 'A day (guard, escort, standby)', 'A gate of their rank (fee, plus an equal share)', 'A gate, flat (no share, drops to the hirer)', 'A red gate, flat', 'A month\'s retainer', 'A healer, a day'],
  RANKS.map(r => { const d = clear(r) * WORLD.mercDay; return [r, whole(d), whole(d), whole(d * 2 + clear(r)), whole((d * 2 + clear(r)) * WORLD.redGateFactor), whole(d * WORLD.mercRetainerDays), whole(d * 1.5)]; })));

// ── 11. guild pay ──
block('guild-pay', table(['Rank', 'Retainer a month (line hunter)', 'House share of gate gold', 'Signing bonus', 'Death benefit', 'Transfer fee', 'Pension a month (after ten years)'],
  RANKS.map(r => { const c = clear(r); const sign = (r === 'E' || r === 'D') ? WORLD.signingClearsLow : WORLD.signingClears; return [r, whole(c * WORLD.retainerClears), `${WORLD.houseShare * 100}%`, whole(c * sign), whole(c * WORLD.deathClears), whole(c * WORLD.transferClears), whole(c * WORLD.retainerClears / 2)]; })));
block('guild-roles', table(['Role', 'Retainer, times the line hunter\'s', ...RANKS], Object.entries(WORLD.roles).map(([role, f]) => [role, f, ...RANKS.map(r => whole(clear(r) * WORLD.retainerClears * f))])));
const SCOUT_DAYS = 100; // 3,000 gold a month: three median wages, below an active C-rank liner's net
const staff: [string, number][] = [['Gate porter (unawakened), for one gate: 0.3 of the gate\'s Clear', 0], ['Reclaimer on a share: the crew splits a quarter of the harvest', 0], ['Guild clerk, a month', 36], ['Analyst, a month', 85], ['Scout (a retired C-rank), a month', SCOUT_DAYS], ['Contract lawyer, a month', 260], ['Press officer, a month', 110]];
block('guild-staff', table(['Staff', 'Gold'], staff.map(([s, w]) => [s, w ? nice(w * W) : 'as described'])));
// A guild's books on one gate it holds the rights to, cleared by four of its line hunters on a four-gate month.
block('guild-books', table(['Gate', 'Harvest net', 'House share', 'Rights paid', 'Retainers (4 hunters, a quarter of a month)', 'Left for the house'],
  RANKS.map(r => { const c = clear(r), inn = holderNet(r) + pot(r) * WORLD.houseShare, out = rights(r) + 4 * c * WORLD.retainerClears / 4; return [r, whole(holderNet(r)), whole(pot(r) * WORLD.houseShare), whole(rights(r)), whole(4 * c * WORLD.retainerClears / 4), whole(inn - out)]; })));

// ── 12. bribes, fines, insurance: in Clears of the rank named ──
const FINES = { unlicensedEntry: 2, underDeclaredMult: 3 } as const;
const law: [string, number, string][] = [
  ['Bribe: a clerk moves your party up a gate\'s queue', 0.5, 'the gate\'s'], ['Bribe: an assessor "rounds down" a gate\'s rank', 4, 'the gate\'s true'],
  ['Bribe: an assessor files a reading one rank low (to avoid the call-up)', 5, 'the hunter\'s true'], ['A forged licence', 3, 'the licence\'s'],
  ['An unlicensed seat in a gate, bought from the Stair', 0.5, 'the gate\'s'], ['Smuggling a hunter over a border', 10, 'the hunter\'s'],
  ['Fine: entering a gate without licence or fee', FINES.unlicensedEntry, 'the gate\'s'], ['Fine: selling an unlicensed seat', 10, 'the gate\'s'],
  ['Fine: a gate declared late (found, not reported in a day)', 5, 'the gate\'s'], ['Fine: a hunter unregistered past the 72 hours', 3, 'the hunter\'s'],
  ['Fine: under-declared gold', FINES.underDeclaredMult * WORLD.hunterLevy, 'three times the levy dodged, on each Clear of the hunter\'s'], ['Bail for a hunter', 8, 'the hunter\'s'],
];
block('law', table(['What', 'Clears', 'Of which rank', ...RANKS], law.map(([what, n, of]) => [what, n, of, ...RANKS.map(r => nice(clear(r) * n))])));
block('insurance', table(['Rank', 'Crystal cover, a year', 'A crystal on credit: interest a month'],
  RANKS.map(r => [r, whole(crystal(r) * coverRate), whole(crystal(r) * WORLD.crystalLoanMonthly)])));
const HOMES = WORLD.cityPeople / WORLD.peopleAHousehold;
const breaksAYear = WORLD.worldGatesAMonth * 12 * WORLD.breakShare;
const lossAYear = breaksAYear * WORLD.homesLostABreak / HOMES; // the share of the city's homes lost to breaks in a year
const ZONE: Record<string, string> = { 'The Crown': 'Green', 'Ledger Row': 'Green', 'Saltmarket': 'Amber', 'Northfield': 'Amber', 'Tidewall': 'Amber', 'Scarside': 'Red' };
block('break-cover', table(['District', 'Zone', 'Chance a home is lost in a year', 'Premium, of the flat\'s price', 'Break cover a year, a family flat'],
  districts.map(([d, , w]) => { const z = ZONE[d]!, risk = lossAYear * WORLD.breakZone[z]!, rate = risk * WORLD.breakLoad;
    return [d, z, `${(risk * 100).toFixed(2)}%`, z === 'Red' ? 'refused' : `${(rate * 100).toFixed(2)}%`, z === 'Red' ? 'none sold' : nice(w * W * PRICE_RENTS * rate)]; })));

// ── 14. incomes ──
type Profile = { name: string; gates: number; guild: boolean; what: string };
const PROFILES: Profile[] = [
  { name: 'Occasional freelancer', gates: WORLD.occasionalGates, guild: false, what: 'one world gate every four months, and a day job' },
  { name: 'Freelancer', gates: WORLD.freelancerGates, guild: false, what: 'one public gate a month' },
  { name: 'Guild liner', gates: WORLD.linerGates, guild: true, what: 'four guild gates a month (S-ranks clear A gates locally; the S row shows the rate when an S gate opens)' },
  { name: 'A table\'s party', gates: WEEKS, guild: false, what: 'one own-rank gate a week, unsigned. Personal gates the GM grants are extra' },
];
/** A month of one hunter: gross, what goes out for the work, and what is left. */
function month(r: Rank, p: Profile): { gross: number; out: number; net: number } {
  const c = clear(r), m = MEASURED[r];
  const gateGold = p.gates * c;
  const gross = gateGold * (p.guild ? 1 - WORLD.houseShare : 1) + p.gates * m.clearItems + (p.guild ? c * WORLD.retainerClears : 0);
  const out = gateGold * WORLD.hunterLevy + p.gates * gateKit(r) + (p.guild ? 0 : p.gates * c * WORLD.entryFee) + crystal(r) * coverRate / 12;
  return { gross, out, net: gross - out };
}
block('incomes', PROFILES.map(p => `**${p.name}** (${p.what})\n\n` + table(['Rank', 'Gross a month', 'Levy, consumables, entry fees, crystal cover', 'Net a month', 'Times the median wage', 'Months of net for a set of own-rank gear', 'Years of net for a Saltmarket flat'],
  RANKS.map(r => { const x = month(r, p); return [r, whole(x.gross), whole(x.out), whole(x.net), (x.net / MEDIAN).toFixed(1), (clear(r) * WEAR_LIMIT / x.net).toFixed(1), (20 * W * PRICE_RENTS / x.net / 12).toFixed(1)]; }))).join('\n\n'));

// ── 13. crystals ──
const liner = PROFILES[2]!;
block('crystals', table(['Crystal', 'Shop price', 'Median months of wage', 'A clinic\'s price to raise a hunter', 'From the Stair, with no record', 'Months of a guild liner\'s net income', 'Months of a freelancer\'s'],
  RANKS.map(r => [r, whole(crystal(r)), (crystal(r) / MEDIAN).toFixed(1), whole(crystal(r) * 1.1), whole(crystal(r) * 1.5), (crystal(r) / month(r, liner).net).toFixed(1), (crystal(r) / month(r, PROFILES[1]!).net).toFixed(1)])));

// ── 14b. sessions to afford per rank (a table's party) ──
const tableParty = PROFILES[3]!;
const sessNet = (r: Rank): number => month(r, tableParty).net / WEEKS;
const GOALS: [string, number][] = [
  ['A staple potion', WORLD.lasts.moment],
  ['An enhancement stone (one try)', WORLD.stoneClears],
  ['A tonic or thrown item', WORLD.lasts.fight],
  ['A used middle item', WORLD.usedSells],
  ['A crafted middle item', WORLD.craftSells],
  ['A Shop middle item, or a seed', 1],
  ['Party food (one hunter\'s quarter share)', WORLD.lasts.gate / DESIGN.goldParty],
  ['A crafted plus item', DESIGN.gradeStep * WORLD.craftSells],
  ['An escape stone (one hunter\'s quarter share)', WORLD.lasts.run / DESIGN.goldParty],
  ['A Resurrection Crystal (party of 4 pooling one)', DESIGN.reviveClears / DESIGN.goldParty],
  ['A full set of six middle items', WEAR_LIMIT],
  ['A skill book (solo)', WORLD.lasts.forever],
  ['A Resurrection Crystal (solo)', DESIGN.reviveClears],
];
block('party-goals', table(['What the party member wants', 'Clears', ...RANKS.map(r => `${r} (${whole(sessNet(r))}/sess)`)],
  GOALS.map(([label, clears]) => [label, clears, ...RANKS.map(r => (clear(r) * clears / sessNet(r)).toFixed(1))])));

// ── power.md: levels, XP, the three roads, lifespan ──
const xpTo = (level: number): number => RULES.xpPerLevel * level * (level - 1) / 2; // total XP to reach a level from 1
const gateXp = (r: Rank): number => RULES.rankTable[r].xp * (4 * RULES.fight.kinds.normal.xp + RULES.fight.kinds.boss.xp); // four normals and a boss: one hunter's share in a party of four (XP is split as gold is)
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

// ── the model: the city's people, its gold a month, and the checks every table must pass ──
const HUNTERS = WORLD.cityPeople / WORLD.awakenedOneIn;
const SEATS = WORLD.worldGatesAMonth * DESIGN.goldParty;
const guildSeats = SEATS * WORLD.auctionedShare, publicSeats = SEATS - guildSeats;
const members = Object.values(WORLD.guildMembers).reduce((a, b) => a + b, 0);
const liners = guildSeats / WORLD.linerGates;                       // the guild hunters a month's guild gates can seat at a liner's pace
const unsigned = HUNTERS - members;
// Seat conservation among the unsigned: freelancers and occasional hunters fill the public seats exactly.
const freelancers = (publicSeats - unsigned * WORLD.occasionalGates) / (WORLD.freelancerGates - WORLD.occasionalGates);
const occasional = unsigned - freelancers;
const bench = members - liners;                                     // guild members with no regular seat: they work as occasional hunters do
const regulars = liners + freelancers;                              // hunters with a regular seat
const nonRegulars = HUNTERS - regulars;
const huntersOf = (r: Rank): number => HUNTERS * WORLD.rankShare[r];
const sum = (f: (r: Rank) => number): number => RANKS.reduce((n, r) => n + f(r), 0);

// Gold minted a month.
const mintWorld = sum(r => gatesOf(r) * pot(r));
const keysAMonth = WORLD.worldGatesAMonth * WORLD.keyAClear;
const mintPersonal = sum(r => gatesOf(r) * WORLD.keyAClear * MEASURED[r].runGold);

// Gold destroyed by hunters a month (Shop purchases + crafters' catalysts).
const sinkStaplesTonics = shopDestroys * sum(r => gatesOf(r) * DESIGN.goldParty * gateKit(r));
const sinkFood = WORLD.craftCatalyst * sum(r => gatesOf(r) * WORLD.foodPerGate * clear(r) * WORLD.lasts.gate);
const sinkEscape = sum(r => gatesOf(r) * WORLD.escapePerGate * clear(r) * WORLD.lasts.run);
const sinkConsumables = sinkStaplesTonics + sinkFood + sinkEscape;
const weightedGearSets = (regulars * WORLD.gearSetsAYear.regular + nonRegulars * WORLD.gearSetsAYear.occasional) / HUNTERS;
const sinkGear = shopDestroys * sum(r => huntersOf(r) * weightedGearSets * clear(r) * WEAR_LIMIT / 12);
const sinkStones = shopDestroys * (regulars / HUNTERS) * sum(r => huntersOf(r) * WORLD.stonesAYear * clear(r) * WORLD.stoneClears / 12);
const sinkProgression = shopDestroys * (regulars / HUNTERS) * sum(r => huntersOf(r) * (WORLD.seedsAYear * WORLD.seedClears + WORLD.booksAYear * WORLD.lasts.forever) * clear(r) / 12);

// Deaths a month and the revive ladder: 1st free (0 gold), 2nd debt (10 Clears), 3rd+ pre-bought crystal (10 Clears) if carried.
const recoverable = 1 - WORLD.unrecoverableShare;
const linerSeats = liners * WORLD.linerGates;
const freelancerSeats = freelancers * WORLD.freelancerGates;
const occasionalSeats = occasional * WORLD.occasionalGates;
const paidRaiseShare = (carry: number): number => recoverable * (WORLD.reviveStage.secondDebt + WORLD.reviveStage.thirdPlus * carry);
const permDeathShare = (carry: number): number => WORLD.unrecoverableShare + recoverable * WORLD.reviveStage.thirdPlus * (1 - carry);
const sinkCrystals = sum(r => {
  const share = WORLD.worldGateShare[r];
  const paidRaises = WORLD.deathAWorldSeat * share * (
    linerSeats * paidRaiseShare(WORLD.carriesCrystal.liner)
    + freelancerSeats * paidRaiseShare(WORLD.carriesCrystal.freelancer)
    + occasionalSeats * paidRaiseShare(WORLD.carriesCrystal.occasional)
  );
  return paidRaises * crystal(r);
});
const regularFinalDeathsAYear = 12 * WORLD.deathAWorldSeat * (
  linerSeats * permDeathShare(WORLD.carriesCrystal.liner)
  + freelancerSeats * permDeathShare(WORLD.carriesCrystal.freelancer)
);
const occasionalFinalDeathsAYear = 12 * WORLD.deathAWorldSeat * occasionalSeats * permDeathShare(WORLD.carriesCrystal.occasional);
const totalFinalDeathsAYear = regularFinalDeathsAYear + occasionalFinalDeathsAYear;

// Gold destroyed by Residents a month, derived bottom-up from medical demand.
const sinkErPotions = (WORLD.cityPeople * WORLD.erVisitsPerPersonAYear * WORLD.erPotionShare / 12) * potion('E');
const sinkHouseholdPotions = (HOMES * WORLD.householdPotionsAYear / 12) * potion('E');
const sinkGreaterPotions = (WORLD.cityPeople * WORLD.severeTraumaPerPersonAYear / 12) * potion('D');
const sinkElixirs = (WORLD.cityPeople * WORLD.criticalIllnessPerPersonAYear * WORLD.elixirUptake / 12) * potion('B');
const sinkResidents = sinkErPotions + sinkHouseholdPotions + sinkGreaterPotions + sinkElixirs;

const workers = WORLD.cityPeople * WORLD.workersShare;
const wageBill = workers * MEDIAN;                                   // a month
const income = wageBill / WORLD.labourShare;                         // all income a month
const mint = mintWorld + mintPersonal;
const hunterSinks = sinkConsumables + sinkGear + sinkStones + sinkProgression + sinkCrystals;
const sinks = hunterSinks + sinkResidents;
const net = mint - sinks;

// 20-year cumulative gold stock: 16 years of Tide growth (Years 4 to 20) plus 4 Break Years at a reduced clearing share.
const tideYears = WORLD.yearsSinceDayZero - WORLD.breakYears;
const g = WORLD.growthAYear;
const eqTideYears = (1 - (1 + g) ** -tideYears) / (1 - (1 + g) ** -1);
const eqBreakYears = WORLD.breakYears * WORLD.breakYearsShare * ((1 + g) ** -tideYears);
const cumulativeNetYears = eqTideYears + eqBreakYears;
const goldStock = net * 12 * cumulativeNetYears;                     // gold accumulated in Carrow over 20 years
const broadMoney = income * 12 / WORLD.moneyTurnsAYear;
const derivedReserveRatio = goldStock / broadMoney;
const stockGrowthAYear = (net * 12) / goldStock;                     // annual growth of the 20-year gold stock
const reserveAndPriceDrift = stockGrowthAYear - WORLD.growthAYear;   // gold growth above the Tide: absorbed by banks rebuilding reserves and mild inflation
const neededForTide = goldStock * WORLD.growthAYear / 12;

/**
 * The labourer's wage that keeps today's Shop-to-circulation split steady if one input moves:
 * Resident medicine demand scales with Resident purchasing power (WAGE), while gate gold and hunter sinks stay fixed in gold.
 */
const wageBalanced = (f: { mint?: number; residents?: number; growth?: number } = {}): number =>
  WAGE * (mint * (f.mint ?? 1) - hunterSinks) / (sinkResidents * (f.residents ?? 1) + net * (f.growth ?? 1));

// An E-rank's day in a public E gate against a labourer's day: the Clear and its items, less levy, fee, kit and expected crystal cover.
const eDay = clear('E') + MEASURED.E.clearItems - clear('E') * (WORLD.hunterLevy + WORLD.entryFee) - gateKit('E') - WORLD.deathAWorldSeat * crystal('E');
const reclaimers = HARVEST_TOTAL * WORLD.crewLay / (2.5 * W * 20);   // crews who live on the lay at a reclaimer's wage, 20 days a month
const runners = sinkResidents * WORLD.runnerMarkup / (W * WORLD.workDaysAMonth); // full-time runners earning an unskilled month from the 20% markup
const fuelShare = HARVEST_TOTAL / (HOMES * WORLD.powerBillOfWage * W * (1 + WORLD.industryPower));
// Boss cores used by crafting: only epic, legendary and mythic crafted gear require a boss core (proposed, needs the owner).
const highRanks: Rank[] = ['B', 'A', 'S'];
const craftedHighGearAMonth = highRanks.reduce((n, r) => n + WORLD.craftedShare * huntersOf(r) * weightedGearSets * WEAR_LIMIT / 12, 0);
const highRankCoresAMonth = highRanks.reduce((n, r) => n + gatesOf(r), 0);
const bossCoreCraftShare = craftedHighGearAMonth / WORLD.worldGatesAMonth;

const mil = (n: number): string => `${(n / 1e6).toFixed(1)} million`;
block('model-people', table(['Who', 'How many', 'How the number is found'], [
  ['Hunters in Carrow', whole(HUNTERS), `one person in ${WORLD.awakenedOneIn}`],
  ['Seats in world gates a month', whole(SEATS), `${whole(WORLD.worldGatesAMonth)} gates, four seats each`],
  ['Guild members', whole(members), 'the four raiding guilds of `factions.md`'],
  ['Liners (a guild\'s first teams)', whole(liners), `the guilds' half of the seats, at ${WORLD.linerGates} gates a month each`],
  ['Guild members on the bench', whole(bench), 'members less liners'],
  ['Unsigned hunters with a public gate a month', whole(freelancers), 'what the public seats allow, after the rest take one gate in four months'],
  ['Unsigned hunters with one gate in four months', whole(occasional), 'the rest'],
  ['Gate keys dropped a month', nice(keysAMonth), `one cleared gate in ${1 / WORLD.keyAClear}; each opens one personal gate`],
  ['Reclaimers', whole(reclaimers), 'a quarter of the harvest, at a reclaimer\'s wage'],
  ['Full-time runners', whole(runners), 'the 20% markup on Residents\' Shop medicine, at an unskilled month\'s wage'],
  ['Regular hunters who die for good in a year', `${whole(regularFinalDeathsAYear)} (${(regularFinalDeathsAYear / regulars * 100).toFixed(1)}% of regulars)`, 'red-gate wipes, lost bodies, and 3rd+ deaths without a crystal'],
  ['All hunters who die for good in a year', `${whole(totalFinalDeathsAYear)} (${whole(occasionalFinalDeathsAYear)} occasional)`, 'regulars plus occasional hunters'],
  ['Breaks a year', nice(breaksAYear), `${WORLD.breakShare * 100}% of world gates`],
]));
block('model-flows', table(['Gold a month in Carrow', 'Gold', 'Share'], [
  ['Minted: world gates', mil(mintWorld), `${(mintWorld / mint * 100).toFixed(0)}% of the mint`],
  ['Minted: personal gates (from keys)', mil(mintPersonal), `${(mintPersonal / mint * 100).toFixed(0)}% of the mint`],
  ['Destroyed: hunters\' staples, tonics, food catalysts and escape stones', mil(sinkConsumables), `${(sinkConsumables / mint * 100).toFixed(0)}% of the mint`],
  ['Destroyed: hunters\' gear, bought new or as catalysts', mil(sinkGear), `${(sinkGear / mint * 100).toFixed(0)}% of the mint`],
  ['Destroyed: enhancement stones (Shop and catalysts)', mil(sinkStones), `${(sinkStones / mint * 100).toFixed(0)}% of the mint`],
  ['Destroyed: seeds and skill books (Shop and catalysts)', mil(sinkProgression), `${(sinkProgression / mint * 100).toFixed(0)}% of the mint`],
  ['Destroyed: debt revives and pre-bought crystals used', mil(sinkCrystals), `${(sinkCrystals / mint * 100).toFixed(0)}% of the mint`],
  ['Destroyed: Residents\' medicine through runners (ER, homes, trauma, Elixirs)', mil(sinkResidents), `${(sinkResidents / mint * 100).toFixed(0)}% of the mint`],
  ['Left in circulation', mil(net), `${(net / mint * 100).toFixed(0)}% of the mint`],
  ['All income in the city', mil(income), 'for scale: the mint is ' + (mint / income * 100).toFixed(1) + '% of it'],
  ['The harvest (crystal and carcass)', mil(HARVEST_TOTAL), `${(fuelShare * 100).toFixed(0)}% of the city's power bill`],
  ['Gold accumulated in Carrow over 20 years', `${(goldStock / 1e6).toFixed(0)} million`, `${(derivedReserveRatio * 100).toFixed(1)}% of notes and deposits`],
  ['Gold needed for the 3% Tide alone', mil(neededForTide), `the rest (${(reserveAndPriceDrift * 100).toFixed(1)}%/yr) rebuilds thin bank reserves and adds mild inflation`],
  ['Notes and deposits, with the gold', `${(broadMoney / 1e9).toFixed(0)} billion`, `a year's income changes hands ${WORLD.moneyTurnsAYear} times`],
]));

type Check = [name: string, value: string, rule: string, ok: boolean];
const within = (x: number, lo: number, hi: number): boolean => x >= lo && x <= hi;
const linerNet = (r: Rank): number => month(r, PROFILES[2]!).net, freeNet = (r: Rank): number => month(r, PROFILES[1]!).net;
const guildLeft = (r: Rank): number => holderNet(r) + pot(r) * WORLD.houseShare - rights(r) - 4 * clear(r) * WORLD.retainerClears / WORLD.linerGates;
const CHECKS: Check[] = [
  ['The anchor: the owner\'s rule for an E-rank', `${whole(linerNet('E'))} gold a month against a labourer\'s ${whole(W * WORLD.workDaysAMonth)}`, 'an E-rank with a regular seat nets 1.1 to 1.6 times a labourer\'s month for four gates: "only a bit richer than a day laborer despite not having to work as often" (the owner, Nov 20)', within(linerNet('E') / (W * WORLD.workDaysAMonth), 1.1, 1.6)],
  ['Shop sinks leave healthy growth', `${(net / mint * 100).toFixed(0)}% of the mint left`, 'bottom-up hunter and Resident sinks leave 15% to 40% of minted gold in circulation, with no fitted GDP share', within(net / mint, 0.15, 0.40)],
  ['Twenty-year gold stock is sound', `${(goldStock / 1e6).toFixed(0)}M gold (${(derivedReserveRatio * 100).toFixed(1)}% reserve, +${(reserveAndPriceDrift * 100).toFixed(1)}%/yr above Tide)`, 'gold is money: 20 years of net minting is 5% to 40% of notes and deposits (under 5% a bank run empties the vaults, over 40% no bank is needed), and it grows under 5% a year faster than the Tide', within(derivedReserveRatio, 0.05, 0.4) && within(reserveAndPriceDrift, 0, 0.05)],
  ['Guild seats', `${whole(liners)} liners of ${whole(members)} members`, 'the guilds\' seats give at least a third and at most all of the members a liner\'s gates', within(liners / members, 1 / 3, 1)],
  ['Public seats', `${whole(freelancers)} of ${whole(unsigned)} unsigned`, 'the public seats are neither oversubscribed nor left empty', freelancers > 0 && freelancers < unsigned],
  ['Signing pays', RANKS.map(r => (linerNet(r) / freeNet(r)).toFixed(1)).join(', '), 'a liner nets more than a freelancer at every rank, or nobody signs', RANKS.every(r => linerNet(r) > freeNet(r))],
  ['A guild survives', `${(guildLeft('E') / clear('E')).toFixed(2)} Clears a gate (same at every rank)`, 'a guild keeps something from a gate, and under two Clears, or a rival bids rights up', within(guildLeft('E') / clear('E'), 0, 2)],
  ['A mercenary\'s day', RANKS.filter(r => r !== 'S').map(r => (clear(r) * WORLD.mercDay / (linerNet(r) / 20)).toFixed(1)).join(', '), 'from E to A, a day rate is 1 to 3 times a liner\'s net working day', RANKS.filter(r => r !== 'S').every(r => within(clear(r) * WORLD.mercDay / (linerNet(r) / 20), 1, 3))],
  ['Retired scouts do not out-earn liners', `${nice(SCOUT_DAYS * W)} against ${whole(linerNet('C'))} net`, 'a retired C-rank scout earns less than an active C-rank liner nets', SCOUT_DAYS * W < linerNet('C')],
  ['Regular hunters die', `${(regularFinalDeathsAYear / regulars * 100).toFixed(1)}% a year (${whole(regularFinalDeathsAYear)} of ${whole(regulars)})`, 'between 0.5% and 3% of regular hunters die for good in a year, matching numerator and denominator', within(regularFinalDeathsAYear / regulars, 0.005, 0.03)],
  ['The harvest powers the city', `${(fuelShare * 100).toFixed(0)}% of the power bill`, 'fuel is 5% to 40% of what the city pays for power', within(fuelShare, 0.05, 0.4)],
  ['Boss cores leave Helix its share', `${whole(craftedHighGearAMonth)} of ${whole(highRankCoresAMonth)} B/A/S cores (${(bossCoreCraftShare * 100).toFixed(1)}% of all gates)`, 'high-tier crafted gear uses fewer cores than B/A/S gates supply and under 10% of Carrow\'s total cores', craftedHighGearAMonth < highRankCoresAMonth && bossCoreCraftShare < 0.10],
  ['Reclaimers can live', `${whole(reclaimers)} crew`, 'the quarter of the harvest pays at least a few hundred reclaimers a reclaimer\'s wage', reclaimers >= 300],
  ['Fines deter: unlicensed entry', `${(FINES.unlicensedEntry * WORLD.caught.unlicensed).toFixed(1)} Clears expected`, 'the law table\'s fine times the catch chance is at least the Clear gained', FINES.unlicensedEntry * WORLD.caught.unlicensed >= 1],
  ['Fines deter: under-declared gold', `${(FINES.underDeclaredMult * WORLD.caught.underDeclared).toFixed(1)} times the levy`, 'the law table\'s fine multiple times the catch chance exceeds the levy dodged', FINES.underDeclaredMult * WORLD.caught.underDeclared > 1],
  ['Table party pace', `${(clear('E') / sessNet('E')).toFixed(1)} to ${(clear('S') / sessNet('S')).toFixed(1)} sessions per item; ${(crystal('E') / 4 / sessNet('E')).toFixed(1)} to ${(crystal('S') / 4 / sessNet('S')).toFixed(1)} per pooled crystal`, 'at every rank, an own-rank item takes 0.5 to 2 sessions and a 4-way pooled crystal takes 2 to 6 sessions', RANKS.every(r => within(clear(r) / sessNet(r), 0.5, 2) && within(crystal(r) / 4 / sessNet(r), 2, 6))],
  ['The Shop\'s band (guard)', `${DESIGN.saleShare} < ${WORLD.fencePays} < ${WORLD.usedSells} < 1`, 'a fence pays more than the Shop, a stall sells for more than a fence pays, and both stay under the Shop', DESIGN.saleShare < WORLD.fencePays && WORLD.fencePays < WORLD.usedSells && WORLD.usedSells < 1],
  ['A crafter undercuts the Shop (guard)', `${WORLD.usedSells} < ${WORLD.craftSells} < 1`, 'a crafted item sells under the Shop and above used gear', WORLD.usedSells < WORLD.craftSells && WORLD.craftSells < 1],
  ['A crafter can live (guard)', `${((WORLD.craftSells - WORLD.craftMaterials - WORLD.craftCatalyst) * 100).toFixed(0)}% of the Shop price`, 'a crafter keeps 10% to 30% of the Shop price after materials and catalyst', within(WORLD.craftSells - WORLD.craftMaterials - WORLD.craftCatalyst, 0.1, 0.3)],
  ['Materials are worth selling (guard)', `${WORLD.craftMaterials} of the Shop price`, 'materials are worth more than the Shop buys finished gear for', WORLD.craftMaterials > DESIGN.saleShare],
  ['A stone is not a bargain (guard)', `${(WORLD.stoneClears / WORLD.stoneWorks).toFixed(1)} Clears a grade`, 'raising a grade with stones costs at least what the grade adds to the Shop price', WORLD.stoneClears / WORLD.stoneWorks >= DESIGN.gradeStep - 1],
  ['Staples are cheap, lasting things dear (guard)', Object.values(WORLD.lasts).join(' < '), 'each longer-lasting consumable costs more than the one before', Object.values(WORLD.lasts).every((v, i, a) => i === 0 || v > a[i - 1]!)],
  ['Crystal buyers (guard)', `${WORLD.crystalBuyers.fence} < ${WORLD.crystalBuyers.exchange} < ${WORLD.crystalBuyers.helix} < 1`, 'each buyer pays less than the one that asks more questions, and all beat the Shop', DESIGN.saleShare < WORLD.crystalBuyers.fence && WORLD.crystalBuyers.fence < WORLD.crystalBuyers.exchange && WORLD.crystalBuyers.exchange < WORLD.crystalBuyers.helix && WORLD.crystalBuyers.helix < 1],
];
block('model-sensitivity', table(['If this changed, and nothing else', 'The wage that holds today\'s balance', 'Against today\'s'], ([
  ['Nothing', {}], ['Every hunter is given one personal gate a week', { mint: 1 + sum(r => huntersOf(r) * WEEKS * MEASURED[r].runGold) / mint }],
  ['Residents buy twice the medicine', { residents: 2 }], ['Residents buy half the medicine', { residents: 0.5 }],
  ['The Tide doubles to ' + WORLD.growthAYear * 200 + '% a year', { growth: 2, mint: 1 }],
  ['A tenth of hunters stop hunting', { mint: 0.9 }],
] as [string, Parameters<typeof wageBalanced>[0]][]).map(([what, f]) => [what, nice(wageBalanced(f)), `${(wageBalanced(f) / wageBalanced()).toFixed(2)} times`])));
block('model-checks', table(['Check', 'Value', 'The rule', 'Holds'], CHECKS.map(([n, v, rule, ok]) => [n, v, rule, ok ? 'yes' : '**NO**'])));
const failed = CHECKS.filter(c => !c[3]);
for (const c of failed) console.error(`CHECK FAILED: ${c[0]}: ${c[1]} (${c[2]})`);

// ── print or write ──
if (process.argv.includes('--write')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const used = new Set<string>();
  let missing = false;
  for (const file of ['economy.md', 'power.md', 'items.md']) {
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
if (failed.length) process.exit(1);
