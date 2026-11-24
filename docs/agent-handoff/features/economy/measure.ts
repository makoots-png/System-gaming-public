// measure.ts: the numbers of design.md, from the shipped rules and the built-in items: today's income, the price ladder
// with grades, each built-in item's spend and grade, the world gate's shared gold and XP, income after the change, the
// tiered crystal, sessions to afford, and the pace of ranks by party size. Run: bun docs/agent-handoff/features/economy/measure.ts
import { RANKS, RULES, clearOf, priceBaseOf } from '../../../../src/core/rules.ts';
import type { Rank } from '../../../../src/core/rules.ts';
import { LOOT_ITEMS, RARITIES, SAMPLE_WEARER, SHOP_ITEMS, STARTER_GEAR, isFullHealItem, itemOf } from '../../../../src/core/registry/items.ts';
import type { ItemDef, Rarity } from '../../../../src/core/registry/items.ts';
import { kitGear, pointsAt, sheetOf, split } from '../../../../src/core/hunter/derive.ts';
import { referenceBody } from '../../../../src/core/registry/worth.ts';
import { itemSpend } from '../../../../src/core/registry/item-budget.ts';

const r0 = (n: number): number => Math.round(n);
const f1 = (n: number): string => n.toFixed(1);
const goldMean = (r: Rank): number => clearOf(RULES, r);
const rankOf = (rar: Rarity): Rank => RULES.rarities[rar].rank;
const clear = (rar: Rarity): number => priceBaseOf(RULES, rankOf(rar));
const gearOf = (d: ItemDef): boolean => d.type === 'weapon' || d.type === 'armor' || d.type === 'accessory';
const ALL: readonly ItemDef[] = [...SHOP_ITEMS, ...LOOT_ITEMS];
const pool: readonly ItemDef[] = ALL.filter(d => !(d.type === 'consumable' && (d.revive || d.rankCap)));

// ── 2. the item's spend (design section 2.3): points, read on the item maker's sample wearer at the tier's rank ──
type Conv = { hp: number; mana: number; phys: number; armor: number; sa: number };
function conv(rank: Rank): Conv {
  const level = RULES.rankLevels[rank], stats = split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, RULES), RULES);
  const sheet = (perks: Record<string, number>) => sheetOf({ stats, level, gear: kitGear(SAMPLE_WEARER.kit, RULES), perks }, RULES);
  const b = sheet({}), per = (k: string, f: (s: ReturnType<typeof sheet>) => number) => (f(sheet({ [k]: 10 })) - f(b)) / 10;
  // one standard action a round, in damage: the bruiser's reference strike, 1d8 + phys (worth.ts header)
  const sa = 4.5 + referenceBody('bruiser', rank, RULES).sheet.phys;
  return { hp: per('vit', s => s.hpMax), mana: per('pow', s => s.manaMax), phys: per('str', s => s.phys), armor: per('vit', s => s.armor), sa };
}
/** The points an item spends beyond its slot's free base, from the game's own `itemSpend`; `unweighed` names what it carries and the budget cannot weigh. */
function spend(d: ItemDef): { pts: number; unweighed: string[] } {
  const sp = itemSpend(itemOf(RULES, d), RULES);
  return { pts: sp?.points ?? 0, unweighed: [...(sp?.unweighed ?? [])] };
}
/** Each tier's middle budget: `itemShare` of the points a hunter of its rank has at the rank's first level, over the slots. */
const budget = (r: Rank): number => RULES.itemBudget.share * pointsAt(RULES.rankLevels[r], RULES) / RULES.slots.length;
/** Each tier's span on a log scale (halfway to its neighbours; E and S mirrored), cut in three: [lo, edge1, edge2, hi]. */
function span(r: Rank): [number, number, number, number] {
  const i = RANKS.indexOf(r), B = budget(r), prev = i > 0 ? budget(RANKS[i - 1]!) : B * B / budget(RANKS[1]!), next = i < 5 ? budget(RANKS[i + 1]!) : B * B / budget(RANKS[4]!);
  const lo = Math.sqrt(prev * B), hi = Math.sqrt(B * next), k = (hi / lo) ** (1 / 3);
  return [lo, lo * k, lo * k * k, hi];
}
type Verdict = { grade: -1 | 0 | 1; over: boolean };
/** A grade a built-in claims above its spend, allowed only for what the budget cannot weigh (design section 2.5). */
const CLAIMED: Readonly<Record<string, -1 | 0 | 1>> = { 'Knight Killer': 1 };
function gradeOf(d: ItemDef): Verdict {
  const [, e1, e2, hi] = span(rankOf(d.rar)), p = spend(d).pts;
  return { grade: CLAIMED[d.name] ?? (p < e1 ? -1 : p < e2 ? 0 : 1), over: p > hi };
}

// ── prices ──
type Econ = { name: string; price: (d: ItemDef) => number; sale: number; soloShare: number; goldEach: (r: Rank, n: number) => number };
// Today's prices, before economy unit 1 took them out of RULES and items.ts: a base value of 10 × a rarity's factor ×
// 10, and the hand prices the built-in items carried.
const TODAY_MULT: Readonly<Record<Rarity, number>> = { common: 1, uncommon: 2, rare: 5, epic: 15, legendary: 50, mythic: 200 };
const TODAY_HAND: Readonly<Record<string, number>> = {
  'Health Potion': 50, 'Greater Health Potion': 300, 'Mana Potion': 50, 'Elixir of Life': 2000, 'Stamina Tonic': 30, 'Iron Dagger': 100,
  "Hunter's Leather": 150, 'Steel Longsword': 400, 'Knight Killer': 5000, 'Ring of Vitality': 20000, 'Resurrection Crystal': 100000, 'Mana Crystal Shard': 40,
};
const TODAY: Econ = {
  name: 'today', sale: 0.5, soloShare: 1, goldEach: r => goldMean(r),
  price: d => TODAY_HAND[d.name] ?? 10 * 10 * TODAY_MULT[d.rar],
};
const gradeFactor = (g: number): number => RULES.gradeStep ** g;
/** A design price: the Clear of the rarity's rank, times the grade's factor, times `usedUpShare` (or `elixirPrices` for full-heal) for a consumable. */
const designPrice = (rar: Rarity, g: number, consumable: boolean, fullHeal = false): number =>
  r0(clear(rar) * gradeFactor(g) * (consumable ? (fullHeal ? RULES.elixirPrices : RULES.usedUpShare) : 1));
/** What each of `n` hunters takes of a world gate's `amount` (a gold roll or its XP): the pot is `gateParty` times it, cut by party / n past the party. */
const shareEach = (amount: number, n: number): number => Math.floor(amount * RULES.gateParty * Math.min(1, RULES.gateParty / n) / n);
const goldEach = (r: Rank, n: number): number => shareEach(goldMean(r), n);
const DESIGN_ECON: Econ = {
  name: 'design', sale: RULES.saleShare, soloShare: RULES.solo.lootShare, goldEach,
  price: d => designPrice(d.rar, gearOf(d) ? gradeOf(d).grade : 0, d.type === 'consumable', d.type === 'consumable' && isFullHealItem({ rar: d.rar, effects: d.effects })),
};

/** The mean price of one pick of rank `r`'s loot table: a rarity by its weight, then an item of it, each as likely. */
function itemMean(r: Rank, e: Econ): number {
  const w = RULES.loot[r].weights as Readonly<Record<string, number>>, tot = Object.values(w).reduce((a, b) => a + b, 0);
  return Object.entries(w).reduce((s, [rar, n]) => { const of = pool.filter(d => d.rar === rar); return s + (of.length ? n / tot * of.reduce((a, d) => a + e.price(d), 0) / of.length : 0); }, 0);
}
/** A personal gate's rank for a hunter of `r`: one below, at, one above by `solo.ranks`, E's below is E, an S gate is an A gate (solo.ts `pooled`). */
function mix(r: Rank): [Rank, number][] {
  const at = RANKS.indexOf(r), o = RULES.solo.ranks, out = new Map<Rank, number>();
  const add = (i: number, n: number) => { const k = RANKS[Math.max(0, Math.min(5, i))]!, p: Rank = k === 'S' ? 'A' : k; out.set(p, (out.get(p) ?? 0) + n / 100); };
  add(at - 1, o.below); add(at, o.same); add(at + 1, o.above);
  return [...out];
}
// The session model (design.md section 1.2): a party of 4 clears one world gate (2 item picks to one taker); a personal
// gate is cleared half the time (notes-2b-crystal.md section 3) and picks 1 item. A personal gate pays `soloShare` of one
// hunter's share at the gate's party (the loot table's gold), and draws its pick with that chance.
const CLEAR_SHARE = 0.5, PARTY = 4, RUNS = { table: 3, daily: 21 } as const;
type Session = { world: number; worldItems: number; run: number; runItems: number; table: number; daily: number };
function session(r: Rank, e: Econ): Session {
  const world = e.goldEach(r, PARTY), worldItems = 2 / PARTY * itemMean(r, e) * e.sale;
  const run = CLEAR_SHARE * e.soloShare * mix(r).reduce((s, [k, n]) => s + n * goldMean(k), 0);
  const runItems = CLEAR_SHARE * e.soloShare * mix(r).reduce((s, [k, n]) => s + n * itemMean(k, e), 0) * e.sale;
  return { world, worldItems, run, runItems, table: world + worldItems + RUNS.table * (run + runItems), daily: world + worldItems + RUNS.daily * (run + runItems) };
}

// ── print ──
for (const e of [TODAY, DESIGN_ECON]) {
  console.log(`\n[1.3 / 4.2] ${e.name}: rank | Clear gold each (party of 4) | Clear items sold, a hunter's share | a personal run's gold | its item sold | table player | daily player | daily/table | item pick mean price`);
  for (const r of RANKS) { const s = session(r, e); console.log(`${r} | ${r0(s.world)} | ${r0(s.worldItems)} | ${r0(s.run)} | ${r0(s.runItems)} | ${r0(s.table)} | ${r0(s.daily)} | ${f1(s.daily / s.table)} | ${r0(itemMean(r, e))}`); }
}

console.log('\n[2.1] price by rarity and grade (minus | middle | plus), sale at a quarter of each; today\'s price');
for (const rar of RARITIES) {
  const p = [-1, 0, 1].map(g => designPrice(rar, g, false));
  console.log(`${rar} (${rankOf(rar)}) | ${p.join(' | ')} | sells ${p.map(x => Math.floor(x * RULES.saleShare)).join(' / ')} | today ${TODAY.price({ name: '', rar, type: 'misc', desc: '' })}`);
}

console.log('\n[2.3] conversions on the sample wearer: rank | max HP a Vit point | max mana a Pow point | phys a Str point | one SA a round in damage | so 1 max HP, 1 max mana, 1 mean damage, a worn status at the tolerance cost (points)');
for (const r of RANKS) { const c = conv(r); console.log(`${r} | ${c.hp.toFixed(2)} | ${c.mana.toFixed(2)} | ${c.phys.toFixed(3)} | ${f1(c.sa)} | ${(1 / c.hp).toFixed(2)} | ${(1 / c.mana).toFixed(2)} | ${(1 / c.phys).toFixed(2)} | ${f1(RULES.fight.kit.tolerance * c.sa / c.phys)}`); }

console.log('\n[2.4] budget: rank | hunter points at the first level | middle budget | minus below | middle | plus | top');
for (const r of RANKS) { const [lo, e1, e2, hi] = span(r); console.log(`${r} | ${pointsAt(RULES.rankLevels[r], RULES)} | ${f1(budget(r))} | ${f1(lo)} | ${f1(e1)} to ${f1(e2)} | ${f1(e2)} to ${f1(hi)} | ${f1(hi)}`); }

console.log('\n[2.5] built-in gear: name | rarity | spend | grade | over the tier | not weighed | price today -> design');
for (const d of [...ALL, ...Object.values(STARTER_GEAR)].filter(gearOf)) {
  const s = spend(d), v = gradeOf(d);
  console.log(`${d.name} | ${d.rar} | ${f1(s.pts)} | ${['-', 'mid', '+'][v.grade + 1]} | ${v.over ? 'OVER' : ''} | ${s.unweighed.join(', ')} | ${TODAY.price(d)} -> ${DESIGN_ECON.price(d)}`);
}
console.log('\n[2.5] kept past the tier\'s top (ruling 6), priced as the tier\'s plus: name | rarity | spend | price');
for (const d of ALL.filter(d => gearOf(d) && gradeOf(d).over)) console.log(`${d.name} | ${d.rar} | ${f1(spend(d).pts)} | ${DESIGN_ECON.price(d)}`);
console.log('\n[2.2] shop', SHOP_ITEMS.map(d => `${d.name}: ${TODAY.price(d)} -> ${d.type === 'consumable' && d.revive ? 'by its rank' : DESIGN_ECON.price(d)}`).join('; '));

console.log('\n[3] an E pick sold, against E\'s gold each at a party of 4: today half', r0(itemMean('E', TODAY) * 0.5), 'design quarter', r0(itemMean('E', DESIGN_ECON) * RULES.saleShare), 'of', goldMean('E'));
console.log('[3] a pick sold over the gold each, design:', RANKS.map(r => `${r} ${(itemMean(r, DESIGN_ECON) * RULES.saleShare / goldMean(r)).toFixed(2)}`).join(', '));

console.log('\n[4.1] world gate gold: rank | each, 1 to 6 hunters | total, 1 to 6 hunters');
for (const r of RANKS) console.log(`${r} | ${[1, 2, 3, 4, 5, 6].map(n => goldEach(r, n)).join(' / ')} | ${[1, 2, 3, 4, 5, 6].map(n => goldEach(r, n) * n).join(' / ')}`);

console.log('\n[5] crystal by its rank: rank | price | table sessions at its rank | daily sessions | today 100000 in table sessions');
for (const r of RANKS) { const p = RULES.revivePrices * priceBaseOf(RULES, r), s = session(r, DESIGN_ECON), t = session(r, TODAY); console.log(`${r} | ${p} | ${f1(p / s.table)} | ${f1(p / s.daily)} | ${f1(100000 / t.table)}`); }

console.log('\n[6] sessions to afford (table player): rank | own-rank middle item | next rank middle item | two own-rank potions | own-rank crystal | daily/table');
for (const [i, r] of RANKS.entries()) {
  const s = session(r, DESIGN_ECON), own = priceBaseOf(RULES, r), next = priceBaseOf(RULES, RANKS[Math.min(5, i + 1)]!), crystal = RULES.revivePrices * own;
  console.log(`${r} | ${f1(own / s.table)} | ${i < 5 ? f1(next / s.table) : '-'} | ${f1(own / s.table)} | ${f1(crystal / s.table)} | ${f1(s.daily / s.table)}`);
}

// XP a session and the sessions a hunter spends at a rank. A world gate holds the rank's mean pack of normals (E 1 to 3,
// else 2 to 6) and a boss worth `fight.kinds.boss.xp` normals; its XP is shared as its gold is (ruling 7), so each of
// the party of 4 takes it whole, as each payee does today (xpSplit false). A personal run's XP stays whole to its hunter.
console.log('\n[4.2] rank | world gate XP | personal run XP | XP to cross | table sessions | daily sessions');
const xpOf = (r: Rank): number => RULES.rankTable[r].xp, lv = RULES.rankLevels, PACK = (r: Rank): number => (r === 'E' ? 2 : 4);
const worldXp = (r: Rank): number => (PACK(r) + RULES.fight.kinds.boss.xp) * xpOf(r);
const runXp = (r: Rank): number => CLEAR_SHARE * 1.5 * mix(r).reduce((s, [k, n]) => s + n * xpOf(k), 0);
const crossXp = (i: number): number => { const r = RANKS[i]!, next = RANKS[i + 1]; return next ? Array.from({ length: lv[next] - lv[r] }, (_, j) => RULES.xpPerLevel * (lv[r] + j)).reduce((a, b) => a + b, 0) : 0; };
/** Sessions at rank `r` for a hunter whose world gate is cleared by `n` hunters: `runs` personal runs and `dailies` dailies a session. */
const sessionsAt = (i: number, n: number, runs: number, dailies: number): number => crossXp(i) / (shareEach(worldXp(RANKS[i]!), n) + runs * runXp(RANKS[i]!) + dailies * RULES.dailyTemplate.rewards.xp);
for (const [i, r] of RANKS.entries()) {
  const cross = crossXp(i);
  console.log(`${r} | ${worldXp(r)} | ${r0(runXp(r))} | ${cross} | ${cross ? f1(sessionsAt(i, PARTY, RUNS.table, 1)) : '-'} | ${cross ? f1(sessionsAt(i, PARTY, RUNS.daily, 7)) : '-'}`);
}

console.log('\n[4.4] table sessions at a rank when the world gate is cleared by 1 | 2 | 3 | 4 | 5 | 6 hunters (XP shared as gold)');
for (const [i, r] of RANKS.entries()) if (crossXp(i)) console.log(`${r} | ${[1, 2, 3, 4, 5, 6].map(n => f1(sessionsAt(i, n, RUNS.table, 1))).join(' | ')}`);

// A raising at level L takes ceil(L × reviveLevelShare) levels, never below level 1 (ruling 9). Its cost in table
// sessions of XP at the party of 4: the XP of the lost levels over the XP a table session pays at the level's rank.
console.log('\n[4.4] a raising: level | rank | levels lost | XP lost | table sessions of XP | share of the XP earned');
const lifetime = (L: number): number => RULES.xpPerLevel * L * (L - 1) / 2;
const rankAt = (L: number): number => RANKS.reduce((at, r, i) => (L >= lv[r] ? i : at), 0);
for (const L of [5, 10, 20, 30, 35, 50, 60]) {
  const i = rankAt(L), lost = Math.min(L - 1, Math.ceil(L * RULES.reviveLevelShare)), xp = lifetime(L) - lifetime(L - lost), perSession = crossXp(i) / sessionsAt(i, PARTY, RUNS.table, 1);
  console.log(`${L} | ${RANKS[i]} | ${lost} | ${xp} | ${f1(xp / perSession)} | ${(100 * xp / lifetime(L)).toFixed(1)}%`);
}
