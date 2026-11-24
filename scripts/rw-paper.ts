// rw-paper.ts: every number in docs/agent-handoff/rw/design.md, printed under its section. Run: bun scripts/rw-paper.ts
// The rule numbers are RULES.fight (src/core/rules.ts); a sheet comes from src/core/hunter/derive.ts, a turn from
// src/core/combat/timeline.ts and a distance or a default place from src/core/combat/space.ts. What has no home in
// src/core yet (the reaction roll, defence, the paper check's attacks) is worked out here. Dice in the sample fights
// come from a seeded generator, so every run prints the same.

import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { above, capped, eff } from '../src/core/stats.ts';
import type { StatKey, Stats } from '../src/core/stats.ts';
import { kitGear, monsterSheet as monsterOf, pointsAt, referenceBonus, SHEET_LABELS, sheetOf as derive, split } from '../src/core/hunter/derive.ts';
import type { Archetype, Kit, MonsterKind, Sheet, SheetNumber } from '../src/core/hunter/derive.ts';
import { before, cost, interval as ticks, opening, stunned, tick, walkCost, withSpeed } from '../src/core/combat/timeline.ts';
import type { Clock, Tick } from '../src/core/combat/timeline.ts';
import { defaultPlace, dist as dist505, feet, openGrid, place } from '../src/core/combat/space.ts';
import type { Place, Side } from '../src/core/combat/space.ts';

const F = RULES.fight;

// ── the numbers only the paper uses: a variant the design dropped, the server's cap and the balance check's reference fight ──
const PAPER = {
  GAUGE_STEP: 100, // variant (a): ticks per gauge step
  DOC_MAX: 16384, // the server's cap on a room doc, server.ts:200
  FIGHT_ROUNDS: 6, // the reference fight the paper check spreads a cannon's mana casts over
  TARGET_SHARE: 1 / 3, // a boss's chance of aiming at one named hunter of a party of three, with no taunt
} as const;

const { round: ROUND, cost: COST } = F;

// ── printing ──
const out = (s = ''): void => { console.log(s); };
const section = (title: string): void => { out(); out(`## ${title}`); out(); };
const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]): void => {
  const cell = (v: string | number): string => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
  out(`| ${head.join(' | ')} |`);
  out(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) out(`| ${r.map(cell).join(' | ')} |`);
  out();
};
const pct = (x: number): string => `${Math.round(x * 100)}%`;

// ── a seeded generator (mulberry32, the one tests/models/fight-play.ts uses) ──
const rng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const d = (r: () => number, sides: number): number => 1 + Math.floor(r() * sides);

// ════════════════════════════════════════════════════════════════════════════
// 1. The timeline
// ════════════════════════════════════════════════════════════════════════════

/** Variant (b): the ticks one action of cost `c` takes at `speed` (timeline.ts). */
const interval = (speed: number, c: number = COST.standard): number => ticks(speed, cost(c), F);
/** Variant (b): the first `at` from a d20 (plus an Instinct edge): a 20 acts at once, a 1 after 19/20 of an interval (timeline.ts). */
const openingAt = (speed: number, d20: number): number => opening(tick(0), speed, d20, F);

type Row = Clock & { speed: number; at: Tick };
const row = (id: string, speed: number, at: number, tie: number): Row => ({ id, speed, at: tick(at), tie });

/** Variant (b): the turns that start before `span`, as [time, id]. `hook` may change rows after each turn and returns its cost. */
function timelineB(rows: Row[], span: number, maxTurns = 1e9, hook?: (actor: Row, now: Tick, rows: Row[]) => number): [number, string][] {
  const rs = rows.map(r => ({ ...r })), seq: [number, string][] = [];
  for (;;) {
    const next = rs.reduce<Row | undefined>((best, r) => best === undefined || before(r, best) ? r : best, undefined);
    if (!next || next.at >= span || seq.length >= maxTurns) return seq;
    const now = next.at;
    seq.push([now, next.id]);
    const c = hook ? hook(next, now, rs) : COST.standard;
    next.at = tick(now + interval(next.speed, c));
  }
}

/** Variant (a): a gauge filled by `speed` every GAUGE_STEP ticks, acting at 1000. `carry` keeps the overflow. */
function timelineA(rows: { name: string; speed: number }[], span: number, carry: boolean, maxTurns = 1e9): [number, string][] {
  const g = rows.map(r => ({ ...r, gauge: 0 })), seq: [number, string][] = [];
  for (let t = PAPER.GAUGE_STEP; t <= span; t += PAPER.GAUGE_STEP) {
    for (const r of g) r.gauge += r.speed;
    const ready = g.filter(r => r.gauge >= 1000).sort((x, y) => y.gauge - x.gauge || y.speed - x.speed);
    for (const r of ready) {
      if (seq.length >= maxTurns) return seq;
      seq.push([t, r.name]);
      r.gauge = carry ? r.gauge - 1000 : 0;
    }
  }
  return seq;
}

/** Variant (c): every round each combatant rolls d20 + (speed - 100) / 10 and acts once, high to low. */
function timelineC(rows: { name: string; speed: number }[], rounds: number, r: () => number, maxTurns = 1e9): [number, string][] {
  const seq: [number, string][] = [];
  for (let k = 0; k < rounds; k++) {
    const rolled = rows.map(x => ({ ...x, init: d(r, 20) + Math.floor((x.speed - 100) / 10) })).sort((x, y) => y.init - x.init || y.speed - x.speed);
    for (const x of rolled) { if (seq.length >= maxTurns) return seq; seq.push([k * ROUND, x.name]); }
  }
  return seq;
}

const fmtT = (t: number): string => (t / ROUND).toFixed(2);
const countBy = (seq: [number, string][], name: string): number => seq.filter(s => s[1] === name).length;

function part1(): void {
  section('1. The timeline');
  const speeds = [80, 100, 130, 200];
  const span = 10 * ROUND;
  out('Table 1.1: turns taken in 10 rounds (10,000 ticks) by four combatants alone, everyone starting at time 0.');
  out();
  const one = speeds.map(s => ({ name: `s${s}`, speed: s }));
  const a0 = timelineA(one, span, false), a1 = timelineA(one, span, true);
  const b = timelineB(one.map(x => row(x.name, x.speed, 0, 0)), span);
  const c = timelineC(one, 10, rng(1));
  const long = timelineB(one.map(x => row(x.name, x.speed, 0, 0)), 100 * ROUND);
  table(['Speed', '(a) gauge, reset at 1000', '(a) gauge, overflow kept', '(b) next-action time', '(c) initiative each round', '(b) turns per round over 100 rounds'],
    speeds.map(s => [s, countBy(a0, `s${s}`), countBy(a1, `s${s}`), countBy(b, `s${s}`), countBy(c, `s${s}`), (countBy(long, `s${s}`) / 100).toFixed(2)]));

  out('Table 1.2: when a speed-130 combatant acts in the first 3 rounds (in rounds). (a) can only act on a gauge step, (b) acts at its exact time.');
  out();
  const t130b = timelineB([row('x', 130, 0, 0)], 3 * ROUND).map(s => fmtT(s[0]));
  const t130a = timelineA([{ name: 'x', speed: 130 }], 3 * ROUND, true).map(s => fmtT(s[0]));
  table(['Variant', 'Turn times'], [['(a) overflow kept', t130a.join(', ')], ['(b)', t130b.join(', ')]]);

  const five = [
    { name: 'Kai (speed)', speed: 141 }, { name: 'Bram (tank)', speed: 86 }, { name: 'Mira (cannon)', speed: 98 },
    { name: 'Ogre (boss)', speed: 105 }, { name: 'Wolf', speed: 120 },
  ];
  const r = rng(7);
  const rolled = five.map(x => ({ ...x, d20: d(r, 20), tie: d(r, 1000) }));
  out('Table 1.3: the sample fight. Opening d20s (seed 7) and the first `at` each gives in (b).');
  out();
  table(['Combatant', 'Speed', 'Opening d20', 'Interval (ticks)', 'First at (ticks)'],
    rolled.map(x => [x.name, x.speed, x.d20, interval(x.speed), openingAt(x.speed, x.d20)]));
  const rowsB = rolled.map(x => row(x.name, x.speed, openingAt(x.speed, x.d20), x.tie));
  const N = 14;
  const sa = timelineA(five, 100 * ROUND, true, N), sb = timelineB(rowsB, 100 * ROUND, N), sc = timelineC(five, 20, rng(7), N);
  out(`Table 1.4: the first ${N} turns of the sample fight in each variant (time in rounds; (c) shows the round it is in).`);
  out();
  table(['#', '(a) gauge, overflow kept', '(b) next-action time', '(c) initiative each round'],
    Array.from({ length: N }, (_, i) => [i + 1,
      sa[i] ? `${fmtT(sa[i][0])} ${sa[i][1]}` : '', sb[i] ? `${fmtT(sb[i][0])} ${sb[i][1]}` : '', sc[i] ? `R${sc[i][0] / ROUND + 1} ${sc[i][1]}` : '']));

  out('Table 1.5: the same fight in (b) with three events. Bram uses a heavy ability (cost 150) on his first turn. On Kai\'s first');
  out('turn Kai slows the Wolf by 30%: its speed drops and its remaining wait is rescaled by old speed over new. On Mira\'s first');
  out('turn Mira stuns the Ogre for 2 rounds: its `at` moves 2.00 later. Nothing else in the loop knows about either.');
  out();
  const seen = new Set<string>();
  const ev = timelineB(rowsB, 100 * ROUND, N, (actor, now, rows) => {
    const first = !seen.has(actor.id); seen.add(actor.id);
    const other = (p: string): Row => rows.find(x => x.id.startsWith(p)) as Row;
    if (first && actor.id.startsWith('Bram')) return COST.heavy;
    if (first && actor.id.startsWith('Kai')) { const w = other('Wolf'); Object.assign(w, withSpeed(w, now, Math.round(w.speed * 0.7))); }
    if (first && actor.id.startsWith('Mira')) { const o = other('Ogre'); Object.assign(o, stunned(o, tick(2 * ROUND))); }
    return COST.standard;
  });
  table(['#', 'Time', 'Who'], ev.map((s, i) => [i + 1, fmtT(s[0]), s[1]]));

  out('Table 1.6: a damage status of 10 a round for 2 rounds, settled pro rata at each of the bearer\'s turn starts (applied at time 0.40).');
  out();
  const settle = (speed: number): string => {
    const start = 400, until = start + 2 * ROUND, step = interval(speed); const parts: number[] = [];
    let last = start;
    for (let t = step; last < until; t += step) { if (t <= start) continue; const upto = Math.min(t, until); parts.push(Math.round(10 * (upto - last) / ROUND * 10) / 10); last = upto; }
    return `${parts.join(' + ')} = ${parts.reduce((s, x) => s + x, 0).toFixed(1)}`;
  };
  table(['Bearer speed', 'Ticks (damage each)'], [80, 100, 200].map(s => [s, settle(s)]));
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Stats and the Sheet
// ════════════════════════════════════════════════════════════════════════════

type Build = { id: string; name: string; main: StatKey; second: StatKey; kit: Kit };
const BUILDS: readonly Build[] = [
  { id: 'speed', name: 'Speed (Agility 2 : Strength 1)', main: 'agi', second: 'str', kit: 'light' },
  { id: 'tank', name: 'Tank (Vitality 2 : Strength 1)', main: 'vit', second: 'str', kit: 'heavy' },
  { id: 'cannon', name: 'Cannon (Power 2 : Control 1)', main: 'pow', second: 'ctl', kit: 'light' },
  { id: 'bruiser', name: 'Bruiser (Strength 2 : Vitality 1)', main: 'str', second: 'vit', kit: 'medium' },
  { id: 'support', name: 'Support (Presence 2 : Discipline 1)', main: 'pre', second: 'dis', kit: 'light' },
];
const LEVEL = RULES.rankLevels;
/** A paper build's stats at `rank`: its points split 2:1 (derive.ts), plus the rank's reference bonus on the main stat. */
function statsOf(main: StatKey, second: StatKey, rank: Rank): Stats {
  const st = split(main, second, pointsAt(LEVEL[rank], RULES), RULES);
  return { ...st, [main]: st[main] + referenceBonus(rank) };
}
/** The sheet of a body with these stats at `level` in `kit` (derive.ts). */
const body = (stats: Stats, level: number, kit: Kit): Sheet => derive({ stats, level, gear: kitGear(kit, RULES), perks: {} }, RULES);
const sheetOf = (b: Build, rank: Rank): Sheet => body(statsOf(b.main, b.second, rank), LEVEL[rank], b.kit);
const monsterSheet = (arch: Archetype, rank: Rank, kind: MonsterKind): Sheet => monsterOf(rank, arch, kind, RULES);
const reduction = (def: number): number => F.armorK / (F.armorK + Math.max(0, def));

const SHEET_ROWS = Object.entries(SHEET_LABELS) as [SheetNumber, string][];

function part2(): void {
  section('2. Stats and the Sheet');
  out('Table 2.1: the eight stats of each build (creation 12 + 3 a level split 2:1, every perk on the main stat).');
  out();
  table(['Build', ...RANKS.filter(r => r === 'E' || r === 'C' || r === 'S').map(r => `${r} (level ${LEVEL[r]})`)],
    BUILDS.map(b => [b.name, ...(['E', 'C', 'S'] as const).map(r => { const st = statsOf(b.main, b.second, r); return `${b.main} ${st[b.main]}, ${b.second} ${st[b.second]}, others 10`; })]));
  out('Table 2.2: the effective score and the share of each capped curve reached, for the stat values above.');
  out();
  table(['Score', 'eff(score)', 'x = eff - 10', 'Share of a cap reached'], [10, 14, 20, 33, 63, 83, 174, 250].map(v => [v, eff(v, F), above(v, F), pct(capped(above(v, F), 1, F))]));
  for (const r of ['E', 'C', 'S'] as const) {
    out(`Table 2.3.${r}: every derived number of the five builds at ${r} (level ${LEVEL[r]}).`);
    out();
    const sh = BUILDS.map(b => sheetOf(b, r));
    table(['Number', ...BUILDS.map(b => b.id)], SHEET_ROWS.map(([k, label]) => [label, ...sh.map(s => s[k])]));
  }
  out('Table 2.4: the speed bound. Fastest and slowest of the five builds, and the slowest possible (heavy kit on Strength 10).');
  out();
  table(['Rank', 'Fastest build', 'Slowest build', 'Ratio', 'Heavy kit, Strength 10', 'Fastest over that'], (['E', 'C', 'S'] as const).map(r => {
    const sp = BUILDS.map(b => sheetOf(b, r).speed), worst = body(statsOf('vit', 'dis', r), LEVEL[r], 'heavy').speed;
    const hi = Math.max(...sp), lo = Math.min(...sp);
    return [r, hi, lo, hi / lo, worst, hi / worst];
  }));
  out('Table 2.5: kits. Speed factor from load for three Strength scores; damage taken after armor and resist (K = 100).');
  out();
  table(['Kit', 'Weight', 'Armor', 'Resist', 'Physical taken', 'Magical taken', 'Speed factor, Str 10', 'Str 33', 'Str 83'],
    (Object.keys(F.kits) as Kit[]).map(k => {
      const kit = F.kits[k];
      const f = (str: number): number => body({ ...statsOf('vit', 'dis', 'E'), str, agi: 10 }, 1, k).speed / 100;
      return [k, kit.weight, kit.armor, kit.resist, pct(reduction(kit.armor)), pct(reduction(kit.resist)), f(10), f(33), f(83)];
    }));
  out('Table 2.6: monsters. A monster is a hunter of its rank\'s first level with no perks and no creation choice beyond its');
  out('archetype\'s 2:1 split, times its kind\'s factors on HP and power.');
  out();
  const mrows: (string | number)[][] = [];
  for (const r of ['E', 'C', 'S'] as const) for (const arch of ['brute', 'skirmisher', 'caster'] as const) for (const kind of ['normal', 'elite', 'boss'] as const) {
    const m = monsterSheet(arch, r, kind);
    mrows.push([r, arch, kind, m.hpMax, m.speed, m.armor, m.resist, Math.max(m.phys, m.mag)]);
  }
  table(['Rank', 'Archetype', 'Kind', 'Max HP', 'Speed', 'Armor', 'Resist', 'Main power'], mrows);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. One use, end to end
// ════════════════════════════════════════════════════════════════════════════

/** The 5-10-5 distance in tiles (space.ts). */
const dist = (a: readonly [number, number], b: readonly [number, number]): number => dist505(place(a[0], a[1]), place(b[0], b[1]));
const reactEdge = (react: number, aim: number): number => Math.max(-F.reactCap, Math.min(F.reactCap, Math.round(F.reactK * (react - aim))));
/** The share of the land time the target uses, from its d20 and edge. */
const share = (d20: number, edge: number): number => Math.max(0, Math.min(1, (d20 + edge) / 20));
/** Whole tiles the target can move in the land time. */
const reach = (move: number, landRounds: number, d20: number, edge: number): number => Math.floor(move * landRounds * share(d20, edge));
const mitigate = (raw: number, def: number, pen: number, penFlat = 0): number => {
  const left = Math.max(0, def * (1 - pen) - penFlat);
  return Math.max(1, Math.round(Math.max(0, raw - F.armorFlat * left) * F.armorK / (F.armorK + left)));
};

type Avoid = 'caught' | 'ring' | 'out';
/** The outcome for a target who needs `toRing` tiles to reach the ring and `toOut` to be out, with `can` tiles. */
const avoidOf = (can: number, toRing: number | null, toOut: number): Avoid => can >= toOut ? 'out' : toRing !== null && can >= toRing ? 'ring' : 'caught';

function part3(): void {
  section('3. One use, end to end');
  out('Table 3.1: the reaction roll. The target rolls one d20 and adds its edge, round(0.25 * (its Reaction - the user\'s Accuracy)),');
  out('at most 6 either way. It uses (d20 + edge) / 20 of the land time, 0 to 1. Spread by edge:');
  out();
  const faces = Array.from({ length: 20 }, (_, i) => i + 1);
  table(['Edge', 'Mean share', 'Share 0.5 or more', 'Share 1 (all of it)', `Resists a no-travel ability (d20 + edge >= ${F.resistDc}, a 20 always)`],
    [-6, -3, 0, 3, 6].map(e => [e, faces.reduce((s, f) => s + share(f, e), 0) / 20, pct(faces.filter(f => share(f, e) >= 0.5).length / 20),
      pct(faces.filter(f => share(f, e) >= 1).length / 20), pct(faces.filter(f => f === 20 || f + e >= F.resistDc).length / 20)]));
  out('Edges between the five builds at C (row: the target\'s Reaction or Will; column: the user\'s Accuracy):');
  out();
  const sC = BUILDS.map(b => sheetOf(b, 'C'));
  table(['Target \\ user', ...BUILDS.map(b => b.id)], BUILDS.map((b, i) => [`${b.id} (react ${Math.round(sC[i]!.react)})`, ...sC.map(u => reactEdge(sC[i]!.react, u.aim))]));

  // Example 1: a sword swing at touch.
  const bruiser = sheetOf(BUILDS[3]!, 'C'), skirm = monsterSheet('skirmisher', 'C', 'normal');
  const swingLand = 0.1, swingDie = 6, swingReact = 9;
  const e1 = reactEdge(skirm.react, bruiser.aim), can1 = reach(skirm.move, swingLand, swingReact, e1);
  const raw1 = swingDie + bruiser.phys;
  out('Example 3.A: a sword swing at touch. C bruiser (Cleave: 1d8 + phys, physical, touch reach 1, wind-up 0.10 round, cost 8 fatigue,');
  out('standard) on an adjacent C skirmisher (normal). Dice: 1d8 = 6; the skirmisher\'s reaction d20 = 9.');
  out();
  table(['Step', 'Value'], [
    ['Land time', `0.10 + 0 travel = 0.10 round`], ['Target move', `${skirm.move.toFixed(2)} tiles a round`], ['Edge', e1],
    ['Tiles it can move', `floor(${skirm.move.toFixed(2)} * 0.10 * ${share(swingReact, e1).toFixed(2)}) = ${can1}`], ['Needs to be out', '1 (from distance 1 to 2)'],
    ['Outcome', avoidOf(can1, null, 1)], ['Best case (d20 = 20)', `${reach(skirm.move, swingLand, 20, e1)} tile: ${avoidOf(reach(skirm.move, swingLand, 20, e1), null, 1)}`],
    ['Crit', `react die ${swingReact} <= crit faces ${bruiser.critFaces}? no`], ['Formula', `6 + ${bruiser.phys.toFixed(2)} = ${raw1.toFixed(2)}`],
    ['Armor', `${skirm.armor}, penetration ${bruiser.armorPen / 100}: x ${(100 / (100 + skirm.armor)).toFixed(3)}`], ['Dealt', `${mitigate(raw1, skirm.armor, bruiser.armorPen / 100)} of ${skirm.hpMax} HP`],
    ['Bruiser next turn', `now + ${interval(bruiser.speed)} ticks`],
  ]);

  // Example 2: an arrow at 8 tiles.
  const speed = sheetOf(BUILDS[0]!, 'C'), caster = monsterSheet('caster', 'C', 'normal');
  const arrowLand = 0.1 + 8 / 80;
  out('Example 3.B: an arrow at 8 tiles. C speed build (Shot: 1d8 + phys, physical, line of width 0 that stops at the first body,');
  out('range 12, wind-up 0.10, travel 80 tiles a round, cost 6 fatigue, quick 70). Land time 0.10 + 8 / 80 = 0.20 round. Every face:');
  out();
  const ex2 = (t: Sheet, label: string): (string | number)[] => {
    const e = reactEdge(t.react, speed.aim);
    const outs = faces.map(f => avoidOf(reach(t.move, arrowLand, f, e), null, 1));
    const caught = outs.filter(o => o === 'caught').length;
    const crit = faces.filter((f, i) => outs[i] === 'caught' && f <= speed.critFaces).length;
    const raw = 4.5 + speed.phys, hit = mitigate(raw, t.armor, speed.armorPen / 100);
    return [label, t.move.toFixed(2), e, `${faces.find((f, i) => outs[i] === 'out') ?? 'never'}`, pct(caught / 20), pct(crit / 20), hit,
      ((caught - crit) / 20 * hit + crit / 20 * mitigate(raw * speed.critSize, t.armor, speed.armorPen / 100)).toFixed(1)];
  };
  table(['Target', 'Move', 'Edge', 'Lowest d20 that dodges', 'Caught', 'Crit', 'Dealt on a hit (average dice)', 'Expected dealt'],
    [ex2(caster, 'C caster (normal), speed 100'), ex2(skirm, 'C skirmisher (normal), speed 138'), ex2(speed, 'C speed build, speed 141')]);

  // Example 3: a slow radius blast with a ring.
  const cannon = sheetOf(BUILDS[2]!, 'C'), tank = sheetOf(BUILDS[1]!, 'C');
  const blastLand = F.abilityKinds.blast.windup / F.round;
  out(`Example 3.C: a slow blast. C cannon (Meteor: 3d8 + 1.5 * mag, magical, radius 2 with a ring to 3 at half, wind-up ${blastLand.toFixed(2)} round,`);
  out('no travel after the wind-up, range 10, cost 10 mana, heavy 150) centred one tile from the target. The target needs 2 tiles');
  out('to reach the ring and 3 to be out. Every face of the target\'s d20:');
  out();
  const ex3 = (t: Sheet, label: string): (string | number)[] => {
    const e = reactEdge(t.react, cannon.aim);
    const outs = faces.map(f => avoidOf(reach(t.move, blastLand, f, e), 2, 3));
    const raw = 13.5 + 1.5 * cannon.mag, hit = mitigate(raw, t.resist, cannon.resistPen / 100), ringHit = mitigate(raw * F.ringShare, t.resist, cannon.resistPen / 100);
    const n = (o: Avoid): number => outs.filter(x => x === o).length;
    const crit = faces.filter((f, i) => outs[i] === 'caught' && f <= cannon.critFaces).length;
    return [label, t.move.toFixed(2), e, `${floorMax(t.move * blastLand)}`, pct(n('caught') / 20), pct(n('ring') / 20), pct(n('out') / 20), hit, ringHit,
      ((n('caught') - crit) / 20 * hit + crit / 20 * mitigate(raw * cannon.critSize, t.resist, cannon.resistPen / 100) + n('ring') / 20 * ringHit).toFixed(1)];
  };
  const floorMax = (v: number): number => Math.floor(v);
  table(['Target', 'Move', 'Edge', 'Most tiles (d20 = 20)', 'Caught', 'Ring', 'Out', 'Dealt caught', 'Dealt in ring', 'Expected dealt'],
    [ex3(speed, 'C speed build, speed 141'), ex3(tank, 'C tank, speed 70')]);
  const eCaster = monsterSheet('caster', 'E', 'normal');
  out(`The same blast cast by an E-rank caster monster (Accuracy ${eCaster.aim.toFixed(1)}), against a speed build at E and at C:`);
  out();
  const sE = sheetOf(BUILDS[0]!, 'E');
  table(['Target', 'Edge', 'Caught', 'Ring', 'Out'], [[sE, 'E speed build'], [speed, 'C speed build']].map(([t, label]) => {
    const tt = t as Sheet, e = reactEdge(tt.react, eCaster.aim), outs = faces.map(f => avoidOf(reach(tt.move, blastLand, f, e), 2, 3));
    return [label as string, e, pct(outs.filter(o => o === 'caught').length / 20), pct(outs.filter(o => o === 'ring').length / 20), pct(outs.filter(o => o === 'out').length / 20)];
  }));
  void dist;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. The extras
// ════════════════════════════════════════════════════════════════════════════

/** A same-rank hit: the bruiser's average Cleave on a same-rank normal brute, after armor. */
const sameRankHit = (rank: Rank): number => {
  const u = sheetOf(BUILDS[3]!, rank), t = monsterSheet('brute', rank, 'normal');
  return mitigate(4.5 + u.phys, t.armor, u.armorPen / 100);
};

function part4(): void {
  section('4. The extras');
  out('Table 4.1: a channel of a base ability (3d8 + 1.5 * mag by a C cannon, 47 after a normal target\'s resist), by turns held.');
  out('Linear is `base * (1 + 0.5 * charge)`, exponential `base * 1.45 ^ charge`. Broken fires at half the charge, rounded down.');
  out();
  const base = mitigate(13.5 + 1.5 * sheetOf(BUILDS[2]!, 'C').mag, monsterSheet('brute', 'C', 'normal').resist, sheetOf(BUILDS[2]!, 'C').resistPen / 100);
  const bossHp = monsterSheet('brute', 'C', 'boss').hpMax;
  table(['Turns held (charge)', 'Linear', 'Exponential', 'Broken at this charge (exponential)', 'Exponential as a share of a C boss (449 HP)'],
    [0, 1, 2, 3, 4, 5].map(c => [c, Math.round(base * (1 + F.channelLin * c)), Math.round(base * Math.pow(F.channelExp, c)),
      Math.round(base * Math.pow(F.channelExp, Math.floor(c * F.breakShare))), pct(base * Math.pow(F.channelExp, c) / bossHp)]));
  out('Table 4.2: what breaks a channel. A single hit of at least `hold * hpMax` does; `hold` is 0.15 + capped(x(dis), 0.25).');
  out();
  table(['Channeler', 'Max HP', 'Hold share', 'Damage that breaks it', 'Same-rank hits needed at once'], (['E', 'C', 'S'] as const).flatMap(r =>
    [['cannon', BUILDS[2]!], ['support', BUILDS[4]!]].map(([label, b]) => {
      const sh = sheetOf(b as Build, r), need = Math.ceil(sh.hold * sh.hpMax);
      return [`${r} ${label as string}`, sh.hpMax, sh.hold.toFixed(2), need, (need / sameRankHit(r)).toFixed(2)];
    })));

  out('Table 4.3: the threat table. Each hunter\'s threat with a monster is the damage dealt to it times the dealer\'s threat');
  out('multiplier, falling 10% a round. Three C hunters attacking one monster for 5 rounds, each at its own rate, no taunt:');
  out();
  const party = [['bruiser', BUILDS[3]!], ['cannon', BUILDS[2]!], ['support', BUILDS[4]!]] as const;
  const per = party.map(([, b]) => sheetOf(b, 'C'));
  const names = party.map(([n], i) => `${n} (x${per[i]!.threat.toFixed(2)})`);
  // damage a round: a strike or blast each turn, at the build's own turn rate
  const dmgRound = [mitigate(4.5 + per[0]!.phys, 39, 0), mitigate(13.5 + 1.5 * per[1]!.mag, 5, per[1]!.resistPen / 100) * 100 / COST.heavy, mitigate(4.5 + per[2]!.phys, 39, 0)]
    .map((dd, i) => dd * per[i]!.speed / 100);
  const threat = [0, 0, 0];
  const rows4: (string | number)[][] = [];
  for (let r = 1; r <= 5; r++) {
    for (let i = 0; i < 3; i++) threat[i] = threat[i]! * (1 - F.threatDecay) + dmgRound[i]! * per[i]!.threat;
    const top = threat.indexOf(Math.max(...threat));
    rows4.push([r, ...threat.map(t => Math.round(t)), party[top]![0]]);
  }
  table(['Round', ...names, 'Suggested target'], rows4);
  const lead = Math.max(...threat) - threat[2]!;
  out(`After round 5 the support taunts: its threat gains ${F.tauntBurst} times its gap to the leader (${Math.round(lead)}), so it leads by`);
  out(`${Math.round(threat[2]! + F.tauntBurst * lead - Math.max(...threat))} and stays the suggested target after the taunt ends, until the decay and the others' damage pass it.`);
  out();
  out(`A taunt adds ${F.tauntBurst} times the current leader's lead over the taunter, so the taunter leads at once, and forces the`);
  out(`target for ${F.tauntRounds} rounds before tenacity.`);
  out();
  out('Table 4.4: how long a taunt holds against the build with the most tenacity (from Strength and Discipline together), with the taunter\'s potency at 0.');
  out();
  table(['Target', 'Tenacity', 'Taunt rounds'], (['E', 'C', 'S'] as const).map(r => {
    const b = BUILDS.reduce((best, x) => sheetOf(x, r).tenacity > sheetOf(best, r).tenacity ? x : best);
    const sh = sheetOf(b, r), f = F.tauntRounds * 100 / (100 + sh.tenacity);
    return [`${r} ${b.id}`, sh.tenacity.toFixed(1), f.toFixed(2)];
  }));
  out('An elite and a boss take a taunt as long as any body: a monster\'s kind does not shorten what lands on it (the owner, Nov 21).');

  out('Table 4.5: the stagger bar, in same-rank hits. Weak hits (under a third of a same-rank hit) fill 1.5 times their share.');
  out();
  table(['Rank', 'Same-rank hit', 'Elite bar (2.5 hits)', 'Boss bar (4 hits)', 'Boss HP', 'Hits to kill the boss', 'Full bars in that time (normal hits)'],
    (['E', 'C', 'S'] as const).map(r => {
      const h = sameRankHit(r), bossMax = monsterSheet('brute', r, 'boss').hpMax, toKill = bossMax / h;
      return [r, h, Math.round(F.kinds.elite.stagger * h), Math.round(F.kinds.boss.stagger * h), bossMax, toKill.toFixed(1), (toKill / F.kinds.boss.stagger).toFixed(1)];
    }));
  out(`A full bar costs the boss ${F.staggerCost} rounds of its own time (its \`at\` moves to now + ${F.staggerCost} rounds) and empties.`);
  out();

  out('Table 4.6: shields. A support\'s shield is `sup * 1.5`, expiring after 2 rounds. The larger of two shields holds.');
  out();
  table(['Rank', 'Support power', 'Shield', 'A same-rank hit', 'Hits it absorbs', 'Share of the tank\'s max HP'], (['E', 'C', 'S'] as const).map(r => {
    const sh = Math.round(sheetOf(BUILDS[4]!, r).sup * 1.5);
    return [r, sheetOf(BUILDS[4]!, r).sup, sh, sameRankHit(r), (sh / sameRankHit(r)).toFixed(2), pct(sh / sheetOf(BUILDS[1]!, r).hpMax)];
  }));

  out('Table 4.7: movement. Moving k tiles costs round(100 * k / 6) hundredths of the mover\'s own standard action, the same for');
  out('everyone, so in absolute time a walk covers `move` tiles a round, the rate a dodge uses. One move command goes at most a');
  out('stride, ceil(move / 2) tiles, so a turn is never one long walk.');
  out();
  table(['Build', 'Rank', 'Speed', 'Move a round', 'Stride (most tiles in one move)', 'Cost of a full stride (hundredths)', 'Tiles a round if it only moves'], BUILDS.flatMap(b =>
    (['E', 'C', 'S'] as const).map(r => {
      const sh = sheetOf(b, r), cost = walkCost(sh.stride, F);
      return [b.id, r, sh.speed, sh.move.toFixed(2), sh.stride, cost, (sh.stride / (interval(sh.speed, cost) / ROUND)).toFixed(1)];
    })));
}

// ════════════════════════════════════════════════════════════════════════════
// 5. The map's data
// ════════════════════════════════════════════════════════════════════════════

/** The default places with no map (space.ts): each combatant takes the first free tile of its side's line, in order. */
const defaultPlaces = (allies: number, foes: number): { side: Side; place: Place }[] => {
  const grid = openGrid(F.grid.w, F.grid.h), taken: Place[] = [], out: { side: Side; place: Place }[] = [];
  for (const [side, n] of [['party', allies], ['foe', foes]] as const) {
    for (let i = 0; i < n; i++) { const p = defaultPlace(side, taken, grid, F)!; taken.push(p); out.push({ side, place: p }); }
  }
  return out;
};

function part5(): void {
  section('5. The map\'s data');
  out(`Table 5.1: distances under the 5-10-5 metric (a diagonal step costs 1, the next costs 2) in tiles and feet (${F.tileFeet} ft a tile).`);
  out();
  const pairs: [number, number][] = [[1, 0], [1, 1], [2, 2], [3, 0], [3, 3], [4, 2], [8, 0], [8, 6]];
  table(['dx, dy', '5-10-5 tiles', 'Feet', 'Euclidean tiles', 'Chebyshev tiles'],
    pairs.map(([dx, dy]) => [`${dx}, ${dy}`, dist([0, 0], [dx, dy]), feet(dist505(place(0, 0), place(dx, dy)), F), Math.hypot(dx, dy).toFixed(2), Math.max(dx, dy)]));
  out(`Table 5.2: the default places with no map, for 4 hunters, 4 shadows and 12 monsters on a ${F.grid.w} by ${F.grid.h} grid.`);
  out();
  const places = defaultPlaces(8, 12);
  table(['Side', 'Count', 'Places', 'Distance to the nearest foe'],
    [['party', places.filter(p => p.side === 'party')], ['foe', places.filter(p => p.side === 'foe')]].map(([side, ps]) => {
      const list = ps as { place: Place }[];
      return [side as string, list.length, list.map(p => `(${p.place.x},${p.place.y})`).join(' '), F.lineGap];
    }));

  // The doc: one row per combatant plus the fight's own fields.
  const row = (i: number, kind: string, withHp: boolean) => ({
    id: `c-${i}${'x'.repeat(6)}`, n: `Combatant name ${i}`, k: kind, s: i % 2, p: [i % 20, (i * 3) % 14], at: 12345 + i * 97,
    sp: 100 + i, b: 3, ...(withHp ? { hp: 120 - i, hm: 140 } : {}), c: [{ k: 'burning', l: 'Burning', u: 20000 }, { k: 'slowed', l: 'Slowed', u: 18000 }],
    ...(kind === 'monster' ? { it: { n: 'Crushing Slam', t: `c-3${'x'.repeat(6)}` }, st: 40, sm: 88 } : {}), sh: 39,
  });
  const doc = {
    a: 1, now: 12345, cur: `c-3${'x'.repeat(6)}`, by: 'd-abcdefghij',
    l: Array.from({ length: 5 }, (_, i) => `R13: Combatant name ${i} used Meteor on Combatant name ${i + 1} for 47 (caught, crit)`),
    r: [...Array.from({ length: 4 }, (_, i) => row(i, 'hunter', true)), ...Array.from({ length: 4 }, (_, i) => row(i + 4, 'shadow', true)),
      ...Array.from({ length: 12 }, (_, i) => row(i + 8, 'monster', false))],
    o: Array.from({ length: 8 }, (_, i) => `c-${i}${'x'.repeat(6)}`),
  };
  const size = JSON.stringify(doc).length;
  const noMap = JSON.stringify({ ...doc, r: doc.r.map(({ p, ...rest }) => { void p; return rest; }) }).length;
  out('Table 5.3: the size of the encounter doc for 4 hunters, 4 shadows and 12 monsters (20 rows), each with two statuses, a');
  out('shield, a place, a timeline value and a monster\'s intent and stagger, plus 5 log lines and the 8 turns ahead.');
  out();
  table(['Doc', 'Characters', `Share of the ${PAPER.DOC_MAX} cap`, 'Characters a row'],
    [['With places', size, pct(size / PAPER.DOC_MAX), Math.round(size / 20)], ['Without places (for comparison)', noMap, pct(noMap / PAPER.DOC_MAX), Math.round(noMap / 20)]]);
  const fixed = size - Math.round(size / 20) * 20;
  const long = JSON.stringify({ ...row(8, 'monster', false), n: 'N'.repeat(60), c: Array.from({ length: 6 }, (_, i) => ({ k: `status${i}`, l: `Status name ${i}`, u: 20000 })) }).length + 1;
  table(['Row', 'Characters a row', 'Rows that fit in the cap'],
    [['As above (a name of 20, two statuses)', Math.round(size / 20), Math.floor((PAPER.DOC_MAX - fixed) / Math.round(size / 20))],
      ['Worst case (a monster, a name of 60, six statuses)', long, Math.floor((PAPER.DOC_MAX - fixed) / long)]]);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Balance bounds, the paper check
// ════════════════════════════════════════════════════════════════════════════

type Attack = { dice: number; faces: number; flat: (s: Sheet) => number; type: 'physical' | 'magical'; cost: number; land: number; fatigue: number; mana: number };
/** The default attack of each build: the cost's share of the damage budget (quick 0.7, standard 1, heavy 1.5). */
const ATTACK: Record<string, Attack> = {
  speed: { dice: 1, faces: 6, flat: s => 0.7 * s.phys, type: 'physical', cost: COST.quick, land: 0.2, fatigue: 6, mana: 0 },
  tank: { dice: 1, faces: 8, flat: s => s.phys, type: 'physical', cost: COST.standard, land: 0.1, fatigue: 8, mana: 0 },
  cannon: { dice: 1, faces: 8, flat: s => s.mag, type: 'magical', cost: COST.standard, land: 0.25, fatigue: 8, mana: 0 },
  bruiser: { dice: 1, faces: 8, flat: s => s.phys, type: 'physical', cost: COST.standard, land: 0.1, fatigue: 8, mana: 0 },
  support: { dice: 1, faces: 6, flat: s => s.sup, type: 'magical', cost: COST.standard, land: 0, fatigue: 6, mana: 0 },
};
const faces20 = Array.from({ length: 20 }, (_, i) => i + 1);
/** Expected damage of one use of `a` by `u` on `t`, over the target's 20 faces (touch when land * move < 1 tile). */
function expected(a: Attack, u: Sheet, t: Sheet): number {
  const avg = a.dice * (a.faces + 1) / 2 + a.flat(u);
  const def = a.type === 'physical' ? t.armor : t.resist, pen = (a.type === 'physical' ? u.armorPen : u.resistPen) / 100;
  const hit = mitigate(avg, def, pen), crit = mitigate(avg * u.critSize, def, pen);
  const e = reactEdge(t.react, u.aim);
  let total = 0;
  for (const f of faces20) {
    const out = reach(t.move, a.land, f, e) >= 1;
    if (out) continue;
    total += f <= u.critFaces ? crit : hit;
  }
  return total / 20;
}
const perRound = (a: Attack, u: Sheet): number => u.speed / 100 * 100 / a.cost;
/** The blast a mana build spends its mana on: heavy, 3d8 + 1.5 * mag, a radius a fast body can leave. */
const BLAST: Attack = { dice: 3, faces: 8, flat: s => 1.5 * s.mag, type: 'magical', cost: COST.heavy, land: 0.6, fatigue: 0, mana: F.abilityKinds.blast.mana };
/** Damage a round: the default attack every turn, plus what a mana build's casts add, spread over a reference fight. */
function dps(id: string, u: Sheet, t: Sheet): number {
  const a = ATTACK[id]!, base = expected(a, u, t) * perRound(a, u);
  const casts = Math.floor(u.manaMax / F.abilityKinds.blast.mana);
  if (!casts) return base;
  const extra = expected(BLAST, u, t) - expected(a, u, t) * COST.heavy / a.cost;  // a blast in place of the attacks it displaces
  return base + Math.max(0, casts * extra) / PAPER.FIGHT_ROUNDS;
}

function duel(aId: string, bId: string, rank: Rank): { ttkA: number; ttkB: number } {
  const a = sheetOf(BUILDS.find(b => b.id === aId)!, rank), b = sheetOf(BUILDS.find(x => x.id === bId)!, rank);
  return { ttkA: b.hpMax / dps(aId, a, b), ttkB: a.hpMax / dps(bId, b, a) };
}

function part6(): void {
  section('6. Balance, the paper check');
  out('Table 6.1: the one-on-one rows. Each build uses its kind\'s default attack every turn, at its cost\'s share of the damage');
  out('budget: speed a quick shot (0.7), tank, bruiser and cannon a standard strike or bolt, support a direct curse. Rounds to kill');
  out('is the target\'s max HP over the expected damage a round, with section 3\'s dodge chances and crits in it. The margin is the');
  out('loser\'s rounds over the winner\'s: at 1.0 the dice decide, and the further from 1.0, the surer the favoured side is.');
  out();
  const rows: (string | number)[][] = [];
  for (const [a, b] of [['speed', 'cannon'], ['tank', 'speed'], ['cannon', 'tank'], ['bruiser', 'support']] as const) {
    for (const r of ['E', 'C', 'S'] as const) {
      const { ttkA, ttkB } = duel(a, b, r);
      rows.push([`${a} against ${b}`, r, ttkA.toFixed(1), ttkB.toFixed(1), ttkA < ttkB ? a : b, (Math.max(ttkA, ttkB) / Math.min(ttkA, ttkB)).toFixed(2)]);
    }
  }
  table(['Row', 'Rank', `Rounds for the first to kill`, 'Rounds for the second', 'Deterministic winner', 'Margin'], rows);

  out('Table 6.2: a party of three (tank, bruiser, cannon) against a same-rank pack of three normal brutes and against a boss.');
  out('The party\'s damage a round is the sum of its three; the pack\'s is three monsters at their rate against the tank\'s armor.');
  out();
  const PARTY = ['tank', 'bruiser', 'cannon'] as const;
  table(['Rank', 'Foe', 'Foe HP in total', 'Party damage a round', 'Rounds to clear', 'Foe damage a round on the tank', 'Rounds to down the tank'],
    (['E', 'C', 'S'] as const).flatMap(r => {
      const party = PARTY.map(id => sheetOf(BUILDS.find(b => b.id === id)!, r));
      const tank = party[0]!;
      return ([['a pack of three normals', 3, 'normal'], ['a boss', 1, 'boss']] as const).map(([label, n, kind]) => {
        const m = monsterSheet('brute', r, kind);
        const partyDps = PARTY.reduce((s, id, i) => s + dps(id, party[i]!, m), 0);
        const mAttack: Attack = { dice: 1, faces: 8, flat: sh => sh.phys, type: 'physical', cost: COST.standard, land: 0.1, fatigue: 0, mana: 0 };
        const foeDps = n * expected(mAttack, m, tank) * perRound(mAttack, m);
        return [r, label, Math.round(m.hpMax * n), partyDps.toFixed(1), (m.hpMax * n / partyDps).toFixed(1), foeDps.toFixed(1), (tank.hpMax / foeDps).toFixed(1)];
      });
    }));

  out('Table 6.3: a mirrored party of three speed builds against the mixed party\'s pack, at the same rank.');
  out();
  table(['Rank', 'Party', 'Damage a round on a normal brute', 'Rounds to clear a pack of three', 'Rounds to down its front hunter'],
    (['E', 'C', 'S'] as const).flatMap(r => {
      const m = monsterSheet('brute', r, 'normal');
      const mAttack: Attack = { dice: 1, faces: 8, flat: sh => sh.phys, type: 'physical', cost: COST.standard, land: 0.1, fatigue: 0, mana: 0 };
      return ([['mixed (tank, bruiser, cannon)', PARTY], ['three speed builds', ['speed', 'speed', 'speed']]] as const).map(([label, ids]) => {
        const sh = ids.map(id => sheetOf(BUILDS.find(b => b.id === id)!, r));
        const d = ids.reduce((s, id, i) => s + dps(id, sh[i]!, m), 0);
        const front = sh[0]!;
        return [r, label, d.toFixed(1), (3 * m.hpMax / d).toFixed(1), (front.hpMax / (3 * expected(mAttack, m, front) * perRound(mAttack, m))).toFixed(1)];
      });
    }));

  out(`Table 6.4: fatigue and mana over three fights of 6 rounds, with ${F.fightRest} fatigue back after each fight and no mana back.`);
  out();
  table(['Build', 'Rank', 'Capacity', 'Fatigue a round', 'After fight 1', 'After fight 2', 'After fight 3', 'Mana left after three major casts'],
    BUILDS.flatMap(b => (['E', 'C', 'S'] as const).map(r => {
      const sh = sheetOf(b, r), a = ATTACK[b.id]!;
      const perR = Math.ceil(a.fatigue * (1 - sh.costCut)) * perRound(a, sh);
      const after: number[] = [];
      let f = 0;
      for (let i = 0; i < 3; i++) { f = Math.min(sh.fatigueMax, f + perR * 6); after.push(Math.round(f)); f = Math.max(0, f - F.fightRest); }
      return [b.id, r, sh.fatigueMax, perR.toFixed(1), after[0]!, after[1]!, after[2]!, Math.max(0, sh.manaMax - 3 * 10)];
    })));

  out('Table 6.5: a channel of 5 of the cannon\'s turns against a same-rank boss, with no taunt and a party of three, so the boss');
  out('aims at the channeler a third of the time. It breaks on one hit of at least `hold * hpMax`.');
  out();
  table(['Rank', 'Cannon max HP', 'Breaks at', 'Boss hit on the cannon', 'Boss turns in 5 of the cannon\'s', 'Chance a hit lands and breaks', 'Channel completes'],
    (['E', 'C', 'S'] as const).map(r => {
      const c = sheetOf(BUILDS[2]!, r), boss = monsterSheet('brute', r, 'boss');
      const mAttack: Attack = { dice: 1, faces: 8, flat: sh => sh.phys, type: 'physical', cost: COST.standard, land: 0.1, fatigue: 0, mana: 0 };
      const hit = expected(mAttack, boss, c), need = Math.ceil(c.hold * c.hpMax);
      const turns = 5 * (interval(c.speed) / ROUND) * (boss.speed / 100);
      const pBreak = hit >= need ? PAPER.TARGET_SHARE : 0;
      return [r, c.hpMax, need, hit.toFixed(1), turns.toFixed(1), pct(pBreak), pct(Math.pow(1 - pBreak, turns))];
    }));

  out('Table 6.6: the single hit. "Expected" is the average dice with no crit on a caught target; "best case" is every die at its');
  out('top face and a crit. Each against a same-rank normal brute and a same-rank tank.');
  out();
  table(['Rank', 'Use', 'Expected on a brute', 'Share of its HP', 'Expected on a tank', 'Share of its HP', 'Best case on a tank', 'Share'],
    (['E', 'C', 'S'] as const).flatMap(r => {
      const m = monsterSheet('brute', r, 'normal'), tank = sheetOf(BUILDS[1]!, r);
      const uses: [string, Build, Attack][] = [...BUILDS.map(b => [`${b.id}, its default attack`, b, ATTACK[b.id]!] as [string, Build, Attack]),
        ['cannon, a mana blast', BUILDS[2]!, BLAST]];
      return uses.map(([label, b, a]) => {
        const u = sheetOf(b, r), def = (t: Sheet): number => a.type === 'physical' ? t.armor : t.resist;
        const avg = a.dice * (a.faces + 1) / 2 + a.flat(u), top = a.dice * a.faces + a.flat(u);
        const pen = (a.type === 'physical' ? u.armorPen : u.resistPen) / 100;
        const onM = mitigate(avg, def(m), pen), onT = mitigate(avg, def(tank), pen), best = mitigate(top * u.critSize, def(tank), pen);
        return [r, label, onM, pct(onM / m.hpMax), onT, pct(onT / tank.hpMax), best, pct(best / tank.hpMax)];
      });
    }));
}

part1();
part2();
part3();
part4();
part5();
part6();
