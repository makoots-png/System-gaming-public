// measure.ts: the sweep of the enemy balance plan (balance-plan.md, "The measures", sections 1 and 2). For every row of
// draft.json and mythic.json it builds the monster as check.ts does (the row's specs through `monsterAbility`, then
// `monsterRows` as a gate's fight would), measures it with the game's own functions, and prints one line a row: its
// numbers, then OK or OUT with the checks it fails. A row outside its bounds that README.md lists as an exception
// (a bullet "- `key`: reason" under a heading that starts "Exceptions") prints EXC. The exit code is 1 when a row is
// OUT and not an exception.
//
// What is measured, all by code that exists (no fight number is worked out here):
//   worth  `abilityWorth` (registry/worth.ts) of each ability at the row's rank: over when it passes `1 + kit.tolerance`
//          times its budget (section 2, check 1).
//   hit    the single-hit bound of tests/abilities.test.ts (section 2, check 2): each damaging ability at mean dice on a
//          same-rank tank, caught, no crit, through `resolve`; a blast's field adds its per-round damage.
//   fight  the odds engine (combat/odds.ts, `sensible` for every row) plays the simulation's party (tests/models/
//          fight-sim.ts `hunter`) against the row's kind's fight (section 2, check 3), `RUNS` times.
//
// What changes when units 2 and 3 land (today the script runs on the draft as it stands):
//   unit 2 (traits, kind armor and resist): the row's `traits` (printed now, applied nowhere) go into `RowMonster` in
//          `monsterOf`, and `monsterRows` gives the body its trait factors. No bound changes.
//   unit 3 (the mythic kind): `kind: 'mythic'` becomes a legal kind; `fightKindOf` already reads it, and `bodyKindOf`
//          then returns it in place of 'boss'. Remove the `mythic: true` test.
//   unit 4 (the simulation) moves numbers in rules.ts, not the bounds below, unless it logs a bound moved.
// Not measured: section 3's per-status odds change, section 4's M2 (level 100), and the mythic's own win-share bound
// at kinds other than its row alone. The elite and mythic bounds below are the plan's defaults, not the owner's.
//
// Run: flock /tmp/box.lock bun docs/agent-handoff/features/enemies/measure.ts [--rank=C] [--kind=boss] [--key=slug] [--runs=150] [--quiet]
import { readFileSync } from 'node:fs';
import { RANKS, RULES } from '../../../../src/core/rules.ts';
import type { Rank } from '../../../../src/core/rules.ts';
import type { MonsterKind } from '../../../../src/core/hunter/derive.ts';
import { diceOf, mean } from '../../../../src/core/formula.ts';
import { openGrid, place } from '../../../../src/core/combat/space.ts';
import { tick } from '../../../../src/core/combat/timeline.ts';
import { atTier } from '../../../../src/core/combat/op-amount.ts';
import { combatantId } from '../../../../src/core/combat/ability-types.ts';
import type { Ability } from '../../../../src/core/combat/ability-types.ts';
import { modified } from '../../../../src/core/combat/effect-ops.ts';
import type { Body, Origin } from '../../../../src/core/combat/effect-ops.ts';
import { resolve } from '../../../../src/core/combat/resolve.ts';
import { fightId, reduce } from '../../../../src/core/combat/fight.ts';
import type { NewRow } from '../../../../src/core/combat/fight-types.ts';
import { monsterRows } from '../../../../src/core/combat/rows.ts';
import type { RowMonster } from '../../../../src/core/combat/rows.ts';
import { IDLE, oddsStep } from '../../../../src/core/combat/odds.ts';
import type { Odds } from '../../../../src/core/combat/odds.ts';
import { abilityWorth } from '../../../../src/core/registry/worth.ts';
import { NO_TWEAK } from '../../../../src/core/hunter/derive.ts';
import { formulaOf } from '../../../../src/core/registry/ability-kinds.ts';
import { monsterAbility } from '../../../../src/core/registry/abilities.ts';
import type { MonsterSpec } from '../../../../src/core/registry/abilities.ts';
import { buildOf, hunter } from '../../../../tests/models/fight-sim.ts';
import type { Archetype as BuildName } from '../../../../tests/models/fight-sim.ts';

// ── the bounds: every number the verdict reads, with the plan's section beside it ──
type FightBound = {
  /** The plan's section and what the fight is. */ readonly section: string; readonly fight: string;
  /** The party's builds (the simulation's). */ readonly party: readonly BuildName[];
  /** Mean rounds, low and high (inclusive); null: not bounded. */ readonly rounds: readonly [number, number] | null;
  /** The most that may share a fight with a hunter down; null: not bounded. */ readonly downMax: number | null;
  /** The most that may share a fight with a hunter dead (death saves after it); null: not bounded. */ readonly deadMax: number | null;
  /** The most the party may win; null: not bounded. */ readonly wonMax: number | null;
  /** The least the party must win (a mythic is near impossible, not impossible); absent: not bounded. */ readonly wonMin?: number;
};
const MIXED: readonly BuildName[] = ['tank', 'bruiser', 'cannon'];
const BOUNDS = {
  /** Section 2, check 3: the runs of a fight (fight-sim.test.ts's noise floor for a share near 0.1). */
  runs: 150,
  /** Section 2, check 1: `abilityWorth(...).over` (worth past `1 + kit.tolerance` times its budget); the game's own flag. */
  worth: { section: '2 check 1', tolerance: RULES.fight.kit.tolerance },
  /** Section 2, check 2: the most one hit may take of a same-rank tank's max HP (tests/abilities.test.ts, design section 6). */
  hit: { section: '2 check 2', tankShare: 0.6 },
  fights: {
    normal: { section: '2 check 3', fight: 'a pack of three of the row', party: MIXED, rounds: [2, 5], downMax: 0.1, deadMax: null, wonMax: null },
    elite: { section: '2 check 3 (default)', fight: 'the row and two normal skirmishers', party: MIXED, rounds: [3, 6], downMax: 1 / 6, deadMax: null, wonMax: null },
    boss: { section: '2 check 3', fight: 'the row alone', party: MIXED, rounds: [4, 8], downMax: 0.25, deadMax: 0.05, wonMax: null },
    /** Section 4, M1: four hunters at S's first level win under 1 fight in 20 (the fourth is the support, the simulation's fifth build less the speed). */
    mythic: { section: '4 (M1), the owner: 5 to 10% for a party of 3', fight: 'the row alone, three hunters at S', party: MIXED, rounds: null, downMax: null, deadMax: null, wonMin: 0.05, wonMax: 0.1 },
  } satisfies Record<FightKindName, FightBound>,
} as const;
type FightKindName = 'normal' | 'elite' | 'boss' | 'mythic';

// ── the rows ──
type Rec = Record<string, unknown>;
type Row = {
  readonly key: string; readonly name: string; readonly rank: Rank; readonly type: string; readonly archetype: RowMonster['archetype'];
  readonly kind: string; readonly specs: readonly MonsterSpec[]; readonly mythic: boolean; readonly traits: readonly string[]; readonly file: string;
};
const DIR = new URL('./', import.meta.url);
function rowsOf(file: string): Row[] {
  const v: unknown = JSON.parse(readFileSync(new URL(file, DIR).pathname, 'utf8'));
  if (!Array.isArray(v)) throw new Error(`${file} is not a list`);
  return (v as Rec[]).map(r => ({
    key: String(r.key), name: String(r.name), rank: r.rank as Rank, type: String(r.type), archetype: r.archetype as Row['archetype'], kind: String(r.kind),
    specs: r.abilities as MonsterSpec[], mythic: r.mythic === true, traits: Array.isArray(r.traits) ? (r.traits as unknown[]).map(String) : [], file,
  }));
}
/** The fight a row is weighed in: a mythic row (the data's `mythic: true`, or the kind once unit 3 adds it) is the mythic's. */
const fightKindOf = (r: Row): FightKindName => (r.mythic || r.kind === 'mythic' ? 'mythic' : (r.kind as FightKindName));
/** The kind of body: today a mythic row keeps its boss or elite body (unit 3 adds the kind). */
const bodyKindOf = (r: Row): MonsterKind => (r.kind === 'elite' ? 'elite' : r.kind === 'normal' ? 'normal' : 'boss');

const abilitiesOf = (r: Row): Ability[] => r.specs.map(s => monsterAbility(s, RULES));
const monsterOf = (r: Row): RowMonster =>
  ({ name: r.name, rank: r.rank, archetype: r.archetype, kind: bodyKindOf(r), type: r.type, tweak: {}, abilities: abilitiesOf(r), statuses: [] });

// ── check 1: the worth of each ability ──
type Worthy = { readonly worst: number; readonly by: string; readonly over: readonly string[] };
function worthOf(r: Row): Worthy {
  let worst = 0, by = '-';
  const over: string[] = [];
  for (const a of abilitiesOf(r)) {
    const w = abilityWorth(a, RULES, { rank: r.rank }), ratio = w.budget > 0 ? w.worth / w.budget : 0;
    if (ratio > worst) { worst = ratio; by = a.name; }
    if (w.over) over.push(a.name);
  }
  return { worst, by, over };
}

// ── check 2: the single hit ──
const GRID = openGrid(20, 14), NOW = tick(5000), D20 = 7;
const bodyOf = (id: string, origin: Origin, at: ReturnType<typeof place>, side: Body['side'], rank: Rank): Body => {
  const m = modified(origin, [], RULES);
  return {
    id: combatantId(id), name: id, side, kind: origin.kind === 'hunter' ? 'hunter' : 'monster', origin, tier: RANKS.indexOf(rank), stats: m.stats, sheet: m.sheet,
    place: at, life: { at: 'up', hp: m.sheet.hpMax }, mana: m.sheet.manaMax, fatigue: 0, shield: null, stagger: null, channel: null, threat: origin.kind === 'monster' ? {} : null,
    statuses: [], readyAt: {}, abilities: [], intent: null, holder: null, at: NOW, speed: m.sheet.speed, tie: 0, xp: 0,
  } as Body;
};
type Hit = { readonly worst: number; readonly by: string; readonly refused: readonly string[] };
/** The most one damaging ability takes of a same-rank tank at mean dice (a blast with a round of its field), as a share of its max HP. */
function hitOf(r: Row): Hit {
  let worst = 0, by = '-';
  const refused: string[] = [];
  const tank = bodyOf('tank', { kind: 'hunter', build: buildOf('tank', r.rank) }, place(6, 5), 'foe', r.rank);
  const origin: Origin = { kind: 'monster', name: 'Monster', rank: r.rank, archetype: r.archetype, monsterKind: bodyKindOf(r), tweak: NO_TWEAK };
  for (const a of abilitiesOf(r)) {
    if (a.effect?.type !== 'physical' && a.effect?.type !== 'magical') continue;
    const blast = a.shape.kind === 'radius';
    const u = bodyOf('user', origin, blast ? place(0, 5) : place(5, 5), 'party', r.rank);
    // a wide blast may reach its own user: its rolls are given too, and only the tank's outcome is read
    const dice = diceOf(formulaOf(a, RULES)!).map(mean);
    const res = resolve(a, u, [u, tank], blast ? tank.place : tank.id, GRID, { dice: { [tank.id]: dice, [u.id]: dice }, react: { [tank.id]: D20, [u.id]: D20 } }, NOW, RULES);
    if (!res.ok) { refused.push(`${a.name}: ${res.reason}`); continue; }
    const field = a.zone ? a.zone.ops.reduce((n, o) => o.op === 'damage' && (o.when ?? 'turn') === 'turn' ? n + diceOf(atTier(o.amount, u.tier)).reduce((t, d) => t + mean(d), 0) : n, 0) : 0;
    const share = ((res.outcomes.find(o => o.target === tank.id)?.dealt ?? 0) + field) / tank.sheet.hpMax;
    if (share > worst) { worst = share; by = a.name; }
  }
  return { worst, by, refused };
}

// ── check 3: the fight ──
const hash = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const skirmisher = (rank: Rank): RowMonster => ({ name: 'Skirmisher', rank, archetype: 'skirmisher', kind: 'normal', tweak: {}, abilities: [], statuses: [] });
const idsOf = (p: string, n: number) => Array.from({ length: n }, (_, i) => combatantId(`${p}-${i + 1}`));
function foesOf(r: Row, k: FightKindName): NewRow[] {
  const m = monsterOf(r);
  if (k === 'normal') return monsterRows(m, idsOf('foe', 3), RULES);
  if (k === 'elite') return [...monsterRows(m, idsOf('foe', 1), RULES), ...monsterRows(skirmisher(r.rank), idsOf('skirmisher', 2), RULES)];
  return monsterRows(m, idsOf('foe', 1), RULES);
}
type Fought = { readonly rounds: number; readonly won: number; readonly down: number; readonly dead: number };
function fightOf(r: Row, k: FightKindName, runs: number): Fought {
  const b: FightBound = BOUNDS.fights[k], rank = k === 'mythic' ? 'S' : r.rank;
  const party = b.party.map((a, i) => hunter(a, rank, b.party.indexOf(a) === i ? a : `${a}-${i}`).row);
  const added = reduce(null, { type: 'add', fightId: fightId(`sweep-${r.key}`), rows: [...party, ...foesOf(r, k)], openings: [] }, { rules: RULES }).fight;
  if (added?.phase !== 'setup') throw new Error(`${r.key}: the rows did not make a fight`);
  let run = oddsStep(IDLE, { type: 'ask', fight: added, seed: hash(r.key), of: runs }, RULES);
  while (run.state === 'running') run = oddsStep(run, { type: 'step', commands: 5000 }, RULES);
  if (run.state !== 'done') throw new Error(`${r.key}: the odds did not finish`);
  const o: Odds = run.odds, n = o.ends.length, share = (p: (e: Odds['ends'][number]) => boolean): number => o.ends.filter(p).length / n;
  return {
    rounds: o.ends.reduce((s, e) => s + e.rounds, 0) / n, won: share(e => e.outcome === 'won'),
    down: share(e => Object.values(e.party).some(x => x.down)), dead: share(e => Object.values(e.party).some(x => x.life === 'dead')),
  };
}

// ── the verdict ──
type Line = { readonly row: Row; readonly k: FightKindName; readonly w: Worthy; readonly h: Hit; readonly f: Fought; readonly out: readonly string[] };
function verdict(row: Row, runs: number): Line {
  const k = fightKindOf(row), b: FightBound = BOUNDS.fights[k], w = worthOf(row), h = hitOf(row), f = fightOf(row, k, runs), out: string[] = [];
  if (w.over.length) out.push(`worth over: ${w.over.join(', ')}`);
  if (h.worst > BOUNDS.hit.tankShare) out.push(`hit ${Math.round(100 * h.worst)}% of a tank (${h.by})`);
  if (b.rounds && f.rounds < b.rounds[0]) out.push(`rounds ${f.rounds.toFixed(1)} under ${b.rounds[0]}: too weak`);
  if (b.rounds && f.rounds > b.rounds[1]) out.push(`rounds ${f.rounds.toFixed(1)} over ${b.rounds[1]}`);
  if (b.downMax !== null && f.down > b.downMax) out.push(`a hunter down in ${pct(f.down)} over ${pct(b.downMax)}`);
  if (b.deadMax !== null && f.dead > b.deadMax) out.push(`a death in ${pct(f.dead)} over ${pct(b.deadMax)}`);
  if (b.wonMax !== null && f.won > b.wonMax) out.push(`the party wins ${pct(f.won)} over ${pct(b.wonMax)}`);
  if (b.wonMin !== undefined && f.won < b.wonMin) out.push(`the party wins ${pct(f.won)} under ${pct(b.wonMin)}`);
  return { row, k, w, h, f, out };
}
const pct = (n: number): string => `${Math.round(100 * n)}%`;

/** The exceptions README.md lists: a bullet "- `key`: reason" under a heading that starts "Exceptions". */
function exceptions(): Map<string, string> {
  const out = new Map<string, string>();
  let under = false;
  for (const line of readFileSync(new URL('README.md', DIR).pathname, 'utf8').split('\n')) {
    if (/^#{1,6} /.test(line)) under = /^#{1,6} Exceptions/i.test(line);
    const m = under ? /^- `([a-z0-9-]+)`: (.+)$/.exec(line) : null;
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}

// ── run ──
const flag = (name: string): string | undefined => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = { rank: flag('rank'), kind: flag('kind'), key: flag('key') }, runs = Number(flag('runs') ?? BOUNDS.runs), quiet = process.argv.includes('--quiet');
const rows = [...rowsOf('draft.json'), ...rowsOf('mythic.json')].filter(r =>
  (!only.rank || r.rank === only.rank) && (!only.kind || fightKindOf(r) === only.kind) && (!only.key || r.key === only.key));
const excepted = exceptions(), started = Date.now(), lines: Line[] = [];
console.log('key | rank kind archetype | traits | worth worst (ability) | hit worst of a tank (ability) | fight | rounds | won | down | dead | verdict');
for (const row of rows) {
  const l = verdict(row, runs);
  lines.push(l);
  const v = l.out.length === 0 ? 'OK' : excepted.has(row.key) ? `EXC (${excepted.get(row.key)})` : `OUT: ${l.out.join('; ')}`;
  if (!quiet || v.startsWith('OUT')) {
    console.log(`${row.key} | ${row.rank} ${l.k} ${row.archetype} | ${row.traits.join(',') || '-'} | ${l.w.worst.toFixed(2)} (${l.w.by}) | ${pct(l.h.worst)} (${l.h.by}) | ${BOUNDS.fights[l.k].fight} | ${l.f.rounds.toFixed(1)} | ${pct(l.f.won)} | ${pct(l.f.down)} | ${pct(l.f.dead)} | ${v}`);
  }
}

const state = (l: Line): 'in' | 'exc' | 'out' => (l.out.length === 0 ? 'in' : excepted.has(l.row.key) ? 'exc' : 'out');
const tally = (label: string, group: (l: Line) => string, order: readonly string[]): void => {
  console.log(`\nBy ${label}: inside | excepted | outside`);
  for (const g of order) {
    const of = lines.filter(l => group(l) === g);
    if (of.length) console.log(`  ${g}: ${of.filter(l => state(l) === 'in').length} | ${of.filter(l => state(l) === 'exc').length} | ${of.filter(l => state(l) === 'out').length}`);
  }
};
tally('rank', l => l.row.rank, RANKS);
tally('kind', l => l.k, ['normal', 'elite', 'boss', 'mythic']);
const outside = lines.filter(l => state(l) === 'out'), reasons = new Map<string, number>();
for (const l of outside) for (const o of l.out) { const why = o.replace(/[0-9.]+/g, '#').replace(/: .*/, ''); reasons.set(why, (reasons.get(why) ?? 0) + 1); }
console.log(`\nWhy rows are outside (a row may fail more than one): ${[...reasons].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ') || 'none'}`);
const refused = lines.filter(l => l.h.refused.length);
if (refused.length) console.log(`Hit check refused by resolve (not counted as outside): ${refused.length} rows, first: ${refused[0]!.row.key}: ${refused[0]!.h.refused[0]}`);
console.log(`\n${lines.length} rows, ${lines.length - outside.length} inside or excepted, ${outside.length} outside, ${runs} runs a fight, ${((Date.now() - started) / 1000).toFixed(0)} s.`);
if (outside.length) process.exit(1);
