// measure.ts: the numbers of design.md, from the shipped rules and the built-in items: today's income, the price ladder
// with grades, each built-in item's spend and grade, the world gate's shared gold, income after the change, the tiered
// crystal, and sessions to afford. Run: bun docs/agent-handoff/features/economy/measure.ts
import { RANKS, RULES } from '../../../../src/core/rules.ts';
import type { Rank } from '../../../../src/core/rules.ts';
import { LOOT_ITEMS, RARITIES, SAMPLE_WEARER, SHOP_ITEMS, STARTER_GEAR } from '../../../../src/core/registry/items.ts';
import type { ItemDef, Rarity } from '../../../../src/core/registry/items.ts';
import { kitGear, pointsAt, sheetOf, split } from '../../../../src/core/hunter/derive.ts';
import { referenceBody } from '../../../../src/core/registry/worth.ts';

// The design's numbers, which the build units put in RULES (design.md section 7.1).
const DESIGN = {
  common: 0, // set below: the middle of loot.E.gold
  gradeStep: 1.5, saleShare: 0.25, usedUpShare: 0.5, soloLootShare: 0.25, goldParty: 4, reviveClears: 10,
  itemShare: 0.5, weaponStep: 1, refDie: '1d8',
} as const;

const r0 = (n: number): number => Math.round(n);
const f1 = (n: number): string => n.toFixed(1);
const goldMean = (r: Rank): number => { const [lo = 0, hi = lo] = RULES.loot[r].gold; return (lo + hi) / 2; };
const rankOf = (rar: Rarity): Rank => RANKS[RARITIES.indexOf(rar)]!;
const clear = (rar: Rarity): number => goldMean(rankOf(rar));
const gearOf = (d: ItemDef): boolean => d.type === 'weapon' || d.type === 'armor' || d.type === 'accessory';
const ALL: readonly ItemDef[] = [...SHOP_ITEMS, ...LOOT_ITEMS];
const pool: readonly ItemDef[] = ALL.filter(d => !(d.type === 'consumable' && d.revive));

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
const diceMean = (dice: string): number => { const m = /^(\d+)d(\d+)/.exec(dice); return m ? Number(m[1]) * (Number(m[2]) + 1) / 2 : 0; };
const STATS = ['str', 'agi', 'vit', 'pow', 'ins', 'pre', 'ctl', 'dis'] as const;
/** The points an item spends beyond its slot's free base; `unweighed` names what it carries and the budget cannot weigh. */
function spend(d: ItemDef): { pts: number; unweighed: string[] } {
  const rar = d.rar, c = conv(rankOf(rar)), b: Record<string, number> = ('bonus' in d && d.bonus) || {}, unweighed: string[] = [];
  let pts = STATS.reduce((s, k) => s + (b[k] ?? 0), 0) + (b.hpMax ?? 0) / c.hp + (b.manaMax ?? 0) / c.mana;
  if (d.type === 'weapon') {
    const free = diceMean(DESIGN.refDie) + DESIGN.weaponStep * RARITIES.indexOf(rar);
    pts += (diceMean(d.dice) - free) / c.phys;
    if (d.penFlat) unweighed.push('armor ignored');
  }
  return { pts, unweighed };
}
/** Each tier's middle budget: `itemShare` of the points a hunter of its rank has at the rank's first level, over the slots. */
const budget = (r: Rank): number => DESIGN.itemShare * pointsAt(RULES.rankLevels[r], RULES) / RULES.slots.length;
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
/** The design's fix of each built-in past its tier's top (section 2.5): a tier up, or numbers cut. */
const FIXES: readonly ItemDef[] = [
  { name: 'Mage Circlet', rar: 'epic', type: 'armor', slot: 'head', kit: 'light', bonus: { pow: 2, manaMax: 2 }, desc: '' },
  { name: "Baruka's Mana Ring", rar: 'epic', type: 'accessory', slot: 'ring2', bonus: { manaMax: 3 }, desc: '' },
  { name: 'Orb of Avarice', rar: 'legendary', type: 'accessory', slot: 'neck', bonus: { pow: 4, manaMax: 2 }, desc: '' },
  { name: "Kamish's Wrath", rar: 'legendary', type: 'weapon', slot: 'weapon', dice: '2d8', attack: 'strike', bonus: { str: 4, agi: 2 }, desc: '' },
  { name: "Monarch's Scepter", rar: 'mythic', type: 'weapon', slot: 'weapon', dice: '2d8', attack: 'strike', bonus: { pow: 6, manaMax: 4 }, desc: '' },
  { name: 'Armor of the Absolute Being', rar: 'mythic', type: 'armor', slot: 'chest', kit: 'heavy', bonus: { vit: 5, hpMax: 15 }, desc: '' },
];

// ── prices ──
type Econ = { name: string; price: (d: ItemDef) => number; sale: number; soloShare: number; goldEach: (r: Rank, n: number) => number };
const TODAY: Econ = {
  name: 'today', sale: 0.5, soloShare: 1, goldEach: r => goldMean(r),
  price: d => d.value ?? RULES.baseValue * 10 * RULES.rarities[d.rar].mult,
};
const gradeFactor = (g: number): number => DESIGN.gradeStep ** g;
/** A design price: the Clear of the rarity's rank, times the grade's factor, times `usedUpShare` for a consumable. */
const designPrice = (rar: Rarity, g: number, consumable: boolean): number => r0(clear(rar) * gradeFactor(g) * (consumable ? DESIGN.usedUpShare : 1));
/** A world gate's gold for each of `n` hunters: the pot is `goldParty` rolls, cut by party / n past the party. */
const potOf = (r: Rank, n: number): number => goldMean(r) * DESIGN.goldParty * Math.min(1, DESIGN.goldParty / n);
const goldEach = (r: Rank, n: number): number => Math.floor(potOf(r, n) / n);
const DESIGN_ECON: Econ = {
  name: 'design', sale: DESIGN.saleShare, soloShare: DESIGN.soloLootShare, goldEach,
  price: d => designPrice(d.rar, gearOf(d) ? gradeOf(d).grade : 0, d.type === 'consumable'),
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
  console.log(`${rar} (${rankOf(rar)}) | ${p.join(' | ')} | sells ${p.map(x => Math.floor(x * DESIGN.saleShare)).join(' / ')} | today ${TODAY.price({ name: '', rar, type: 'misc', desc: '' })}`);
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
console.log('\n[2.5] the fixes: name | rarity | spend | grade | over | design price');
for (const d of FIXES) { const v = gradeOf(d); console.log(`${d.name} | ${d.rar} | ${f1(spend(d).pts)} | ${['-', 'mid', '+'][v.grade + 1]} | ${v.over ? 'OVER' : ''} | ${DESIGN_ECON.price(d)}`); }
console.log('\n[2.2] shop', SHOP_ITEMS.map(d => `${d.name}: ${TODAY.price(d)} -> ${d.type === 'consumable' && d.revive ? 'by its rank' : DESIGN_ECON.price(d)}`).join('; '));

console.log('\n[3] an E pick sold, against E\'s gold each at a party of 4: today half', r0(itemMean('E', TODAY) * 0.5), 'design quarter', r0(itemMean('E', DESIGN_ECON) * DESIGN.saleShare), 'of', goldMean('E'));
console.log('[3] a pick sold over the gold each, design:', RANKS.map(r => `${r} ${(itemMean(r, DESIGN_ECON) * DESIGN.saleShare / goldMean(r)).toFixed(2)}`).join(', '));

console.log('\n[4.1] world gate gold: rank | each, 1 to 6 hunters | total, 1 to 6 hunters');
for (const r of RANKS) console.log(`${r} | ${[1, 2, 3, 4, 5, 6].map(n => goldEach(r, n)).join(' / ')} | ${[1, 2, 3, 4, 5, 6].map(n => goldEach(r, n) * n).join(' / ')}`);

console.log('\n[5] crystal by its rank: rank | price | table sessions at its rank | daily sessions | today 100000 in table sessions');
for (const r of RANKS) { const p = DESIGN.reviveClears * goldMean(r), s = session(r, DESIGN_ECON), t = session(r, TODAY); console.log(`${r} | ${p} | ${f1(p / s.table)} | ${f1(p / s.daily)} | ${f1(100000 / t.table)}`); }

console.log('\n[6] sessions to afford (table player): rank | own-rank middle item | next rank middle item | two own-rank potions | own-rank crystal | respec at the rank\'s first level | daily/table');
for (const [i, r] of RANKS.entries()) {
  const s = session(r, DESIGN_ECON), own = goldMean(r), next = goldMean(RANKS[Math.min(5, i + 1)]!), crystal = DESIGN.reviveClears * own, respec = RULES.build.respecGold * RULES.rankLevels[r] ** 2;
  console.log(`${r} | ${f1(own / s.table)} | ${i < 5 ? f1(next / s.table) : '-'} | ${f1(own / s.table)} | ${f1(crystal / s.table)} | ${respec} = ${f1(respec / s.table)} | ${f1(s.daily / s.table)}`);
}

// XP a session and the sessions a hunter spends at a rank (each payee gets the whole XP, xpSplit false). A world gate
// holds the rank's mean pack of normals (E 1 to 3, else 2 to 6) and a boss worth `fight.kinds.boss.xp` normals.
console.log('\n[4.2] rank | world gate XP | personal run XP | XP to cross | table sessions | daily sessions');
const xpOf = (r: Rank): number => RULES.rankTable[r].xp, lv = RULES.rankLevels, PACK = (r: Rank): number => (r === 'E' ? 2 : 4);
for (const [i, r] of RANKS.entries()) {
  const world = (PACK(r) + RULES.fight.kinds.boss.xp) * xpOf(r), run = CLEAR_SHARE * 1.5 * mix(r).reduce((s, [k, n]) => s + n * xpOf(k), 0), daily = RULES.dailyTemplate.rewards.xp;
  const next = RANKS[i + 1], cross = next ? Array.from({ length: lv[next] - lv[r] }, (_, j) => RULES.xpPerLevel * (lv[r] + j)).reduce((a, b) => a + b, 0) : 0;
  const tbl = world + RUNS.table * run + daily, dly = world + RUNS.daily * run + 7 * daily;
  console.log(`${r} | ${world} | ${r0(run)} | ${cross} | ${cross ? f1(cross / tbl) : '-'} | ${cross ? f1(cross / dly) : '-'}`);
}
