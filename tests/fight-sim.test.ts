// The balance rows of the reworked fight: one row per bound of docs/agent-handoff/rw/design.md section 6 (per rank where
// the bound names ranks), each played on the real reducer by tests/models/fight-sim.ts with seeded dice. A row is
// `{ name, setup, runs, measure, low, high, lever }`: a new class or bound is a new row. What each miss means, and every
// number moved, is docs/agent-handoff/rw/sim-log.md.
//
// The noise floor, chosen before the first run. A share p measured over n fights has a standard error of
// sqrt(p * (1 - p) / n). It is largest at p = 0.5, where n = 400 gives sqrt(0.25 / 400) = 0.025, so every share whose
// bound has an edge between 0.25 and 0.75 plays 400 fights. A share bounded near 0 is judged at its edge: at p = 0.10,
// n = 150 gives sqrt(0.09 / 150) = 0.0245; at p = 0.25, n = 300 gives sqrt(0.1875 / 300) = 0.025; at p = 0.05, n = 100
// gives 0.022. A share bounded on both sides near 0 (M1, 0.05 to 0.10) plays 600 fights: sqrt(0.075 * 0.925 / 600) =
// 0.011. A mean (rounds, staggers, casts) prints its own standard error, sd / sqrt(n); a ratio of two means or shares
// prints the delta-method error, r * sqrt((se_a / a)^2 + (se_b / b)^2). A row whose value is within one standard error
// of its edge is printed as "near"; a change to a number is accepted only when it moves a row by more than twice its
// standard error.
//
// How each bound is read, where the design's words leave a choice (section 6 as the lead restated it after round one):
// - "the favoured build wins 60 to 90%": the first build's share of the fights it wins, the mean of two openings played
//   400 times each: the default lines (8 tiles apart) and adjacent (the two side by side, the party's at (0, 2), the
//   foe's at (0, 3)). The mean's standard error is half the root of the sum of the two squared errors. A fight that
//   reaches the 40-round cap is no win.
//   Each opening is printed beside the mean with its own standard error and no bound (the lead's decision 6 of round
//   three).
// - "every build wins 25 to 75% against every other" (E): the three builds of the triangle, one row a pair, read the
//   same way (the second build's share is one minus the first's, as no duel reached the cap).
// - "a pack that can hurt" (the speed party's rows): two normal skirmishers (ranged) and an elite brute.
// - A hunter at 0 HP is dead (the owner, Nov 21: no death saves), so going down and dying are one event, a death, and
//   each bound below is a share of fights in which some hunter dies.
// - "no hunter dying in more than 1 run in 10": a hunter dies in at most 1 pack fight in 10.
// - "at most one hunter down in more than 1 run in 4, a death in under 1 in 20": with down and death one event, the
//   pair cannot both stand; the row keeps the design's bound on a hunter lost, a death in under 1 boss fight in 20.
// - "A mythic should be basically impossible to beat, like 5-10% odds for a party of 3" (the owner, Nov 21; balance plan
//   section 4, M1): the mixed party at S's first level wins 5 to 10% of fights against one mythic alone, one row for
//   each archetype, so the kind holds whatever the body.
// - "front hunter": the first hunter of the party's line, the one the pack reaches first; "goes down" is read as dies.
// - "Fatigue over three fights of 6 rounds": a party of the five builds against two same-rank bosses, ended by the GM at
//   6 rounds, three times, with HP back to full and 55 fatigue back between fights (`RULES.fight.fightRest`) and no mana
//   back. "No build is at its capacity before the third fight" is read as at most 1 dungeon in 20; "the fastest is" as
//   the speed build at its capacity by the end of the third fight in at least half of them.
// - "A cannon casts 2 or 3 major casts a dungeon and none after": the blasts a fresh cannon's mana pays for by the rules'
//   own cost check (`blastsAllowed`), as mana comes back only on a clear. The blasts a careful cannon cast are printed.
// - "A channel of 5 turns completes in N% of tries": of the channels begun, the share released at full charge. The
//   unprotected bound reads only channels begun while the boss aimed at the channeler (a cannon that begins on its first
//   turn under fire); channels begun while it aimed elsewhere are printed.
// - "Staggers in a boss fight: 1 or 2": the mean count of staggers in the party's boss fight.
// - "The best single use with no channel": the mean HP a same-rank tank loses to one use of each build's abilities,
//   reaction roll and crit included, over 400 uses; the row is the largest of them.
// - Penetration's fairness (balance plan section 9, P1 and P2): one build of the mixed party spends one item of its tier's
//   middle budget all on its main stat, on percent or on flat penetration of its pair (the bruiser armor, the cannon
//   magic), the other build on its main stat (`spending`). Each pair is its own row, so a row names the pair that misses.
//   P1 is the paired difference in rounds on the same seeds, at the boss whose thick defence the pair counters: the
//   brute boss (armor) for the armor pair, a warded caster boss (resist) for the magic pair. "More than 25% faster" is
//   the main stat's rounds over the variant's, the larger of the two variants.
// - The party's control (P3): the share of the fight's time the boss's turn was pushed by the tank's stun (a hold of a
//   round, `abilities().stun`, which adds its length to the boss's next turn: timeline.ts `stunned`), a stagger's push apart. No built-in skill holds, so the stun is the plain one. The tank
//   uses it whenever it is ready and the boss acts before the tank's next turn (`controlPolicy`), before a taunt.
import { describe, expect, test } from 'bun:test';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { place } from '../src/core/combat/space.ts';
import { reduce, fightId } from '../src/core/combat/fight.ts';
import type { Fight } from '../src/core/combat/fight.ts';
import { diceOf } from '../src/core/formula.ts';
import type { Place } from '../src/core/combat/space.ts';
import { BUILDS, KIT_BUILDS, MONSTER_ABILITY, PLAIN_OF, SIM_RANKS, abilities, blastsAllowed, controlPolicy, hunter, monster, playDungeon, playFight, rng, spending, turnsPolicy, wave2 } from './models/fight-sim.ts';
import type { Archetype, FightRecord, KitBuild, PenBuild, PenSpend, Plan, SimRow } from './models/fight-sim.ts';
import type { Archetype as MonsterArchetype } from '../src/core/hunter/derive.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';

// ── the setups ──
const foe = (s: SimRow): SimRow => ({ ...s, row: { ...s.row, side: 'foe' } });
const at = (s: SimRow, p: Place | null): SimRow => ({ ...s, row: { ...s.row, place: p } });
/** Where a duel starts: the default lines, 8 tiles apart, or side by side. */
type Opening = 'lines' | 'adjacent';
const OPENINGS: readonly Opening[] = ['lines', 'adjacent'];
const START: { readonly [O in Opening]: readonly [Place | null, Place | null] } = { lines: [null, null], adjacent: [place(0, 2), place(0, 3)] };
const duel = (a: Archetype, b: Archetype, rank: Rank, opening: Opening = 'lines') => (seed: number): FightRecord[] =>
  [playFight({ rows: [at(hunter(a, rank), START[opening][0]), at(foe(hunter(b, rank, a === b ? `${b}-foe` : b)), START[opening][1])] }, seed)];
const pack = (rank: Rank) => [1, 2, 3].map(i => monster(rank, 'brute', 'normal', `brute-${i}`));
/** A pack that can hurt (decision 5): two skirmishers that shoot from range and an elite brute. */
const hurtingPack = (rank: Rank) => [monster(rank, 'brute', 'elite', 'elite'), monster(rank, 'skirmisher', 'normal', 'skirmisher-1'), monster(rank, 'skirmisher', 'normal', 'skirmisher-2')];
const MIXED: readonly Archetype[] = ['tank', 'bruiser', 'cannon'];
const party = (ids: readonly Archetype[], rank: Rank): SimRow[] => ids.map((a, i) => hunter(a, rank, ids.indexOf(a) === i ? a : `${a}-${i}`));
const vsPack = (ids: readonly Archetype[], rank: Rank) => (seed: number): FightRecord[] => [playFight({ rows: [...party(ids, rank), ...pack(rank)] }, seed)];
const vsHurtingPack = (ids: readonly Archetype[], rank: Rank) => (seed: number): FightRecord[] => [playFight({ rows: [...party(ids, rank), ...hurtingPack(rank)] }, seed)];
const vsBoss = (ids: readonly Archetype[], rank: Rank, channel: Plan['channel'] = 'none') => (seed: number): FightRecord[] =>
  [playFight({ rows: [...party(ids, rank), monster(rank, 'brute', 'boss', 'boss')], plan: { channel } }, seed)];
const FIVE: readonly Archetype[] = ['speed', 'tank', 'cannon', 'bruiser', 'support'];
const dungeon = (rank: Rank) => (seed: number): FightRecord[] => playDungeon(() => ({
  rows: [...party(FIVE, rank), monster(rank, 'brute', 'boss', 'boss-1'), monster(rank, 'brute', 'boss', 'boss-2')], endAtRounds: 6,
}), seed, 3, RULES.fight.fightRest);

type Play = (seed: number) => FightRecord[];
const cache = new Map<string, FightRecord[][]>();
/** Every run of a setup, played once and shared by the rows that read it. */
function runsOf(key: string, play: Play, runs: number): FightRecord[][] {
  const k = `${key}/${runs}`;
  if (!cache.has(k)) cache.set(k, Array.from({ length: runs }, (_, i) => play(1 + i)));
  return cache.get(k)!;
}

// ── measures ──
type Measure = { value: number; se: number; note: string };
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]): number => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const share = (xs: readonly boolean[]): Measure => {
  const p = xs.filter(Boolean).length / xs.length;
  return { value: p, se: Math.sqrt(p * (1 - p) / xs.length), note: '' };
};
const avg = (xs: readonly number[]): Measure => ({ value: mean(xs), se: sd(xs) / Math.sqrt(xs.length), note: '' });
const ratio = (a: Measure, b: Measure): Measure => {
  if (a.value === 0 && b.value === 0) return { value: NaN, se: NaN, note: 'neither dies' };
  const r = a.value / b.value;
  return { value: r, se: Math.abs(r) * Math.sqrt((a.se / a.value) ** 2 + (b.se / b.value) ** 2), note: `${fmt(a.value)} over ${fmt(b.value)}` };
};
const fmt = (n: number): string => Number.isFinite(n) ? (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3)) : Number.isNaN(n) ? 'none' : 'no limit';
const capNote = (runs: FightRecord[][]): string => {
  const c = runs.flat().filter(r => r.capped).length;
  return c ? `${c} fights hit the cap` : '';
};
const wins = (key: string, play: Play, runs: number, side: 'party' | 'foe' = 'party'): Measure => {
  const rs = runsOf(key, play, runs);
  return { ...share(rs.map(r => r[0]!.winner === side)), note: [capNote(rs), `mean ${mean(rs.map(r => r[0]!.rounds)).toFixed(1)} rounds`].filter(Boolean).join('; ') };
};
/**
 * The first build's share of wins, the mean of the two openings (decision 6 of round three: the bound is on the mean).
 * Each opening is printed beside it with its own standard error and no bound: who wins from which distance is for a GM
 * to read, and at the table the party decides the distance.
 */
const bothOpenings = (a: Archetype, b: Archetype, rank: Rank, runs: number): Measure => {
  const ms = OPENINGS.map(o => wins(`${a} v ${b} ${rank} ${o}`, duel(a, b, rank, o), runs));
  return {
    value: mean(ms.map(m => m.value)), se: Math.sqrt(ms.reduce((n, m) => n + m.se ** 2, 0)) / ms.length,
    note: `each opening, no bound: ${OPENINGS.map((o, i) => `${o} ${fmt(ms[i]!.value)} (se ${fmt(ms[i]!.se)}, ${ms[i]!.note})`).join(', ')}`,
  };
};
const rounds = (key: string, play: Play, runs: number, won = false): Measure => {
  const rs = runsOf(key, play, runs).map(r => r[0]!).filter(r => !won || r.winner === 'party');
  return { ...avg(rs.map(r => r.rounds)), note: `${rs.filter(r => r.winner === 'party').length} of ${runs} won` };
};
const anyDead = (key: string, play: Play, runs: number): Measure => share(runsOf(key, play, runs).map(r => r[0]!.dead.length > 0));
/** Of the channels begun (all, or only those begun while the boss aimed at the channeler), the share released at full charge. */
const completes = (key: string, play: Play, runs: number, which: 'all' | 'aimed' | 'elsewhere' = 'all'): Measure => {
  const rs = runsOf(key, play, runs).map(r => r[0]!.channels);
  const of = (c: FightRecord['channels']) => which === 'all' ? [c.begun, c.completed] : which === 'aimed' ? [c.aimed.begun, c.aimed.completed] : [c.begun - c.aimed.begun, c.completed - c.aimed.completed];
  const begun = rs.reduce((n, c) => n + of(c)[0]!, 0), done = rs.reduce((n, c) => n + of(c)[1]!, 0), p = begun ? done / begun : NaN;
  return { value: p, se: Math.sqrt(p * (1 - p) / begun), note: `${begun} channels begun in ${runs} fights, ${rs.reduce((n, c) => n + c.broken, 0)} broken in all` };
};
const frontDead = (key: string, play: Play, runs: number, front: string): Measure => share(runsOf(key, play, runs).map(r => r[0]!.dead.includes(front)));

/** The builds of design section 2 and the status build, before the kits. */
const PLAIN_BUILDS = (Object.keys(BUILDS) as Archetype[]).filter(a => !(KIT_BUILDS as readonly string[]).includes(a));
/** The mean HP a same-rank tank loses to one use, as a share of its max HP, for every ability of `builds` but a channel. */
function bestUse(rank: Rank, uses: number, builds: readonly Archetype[] = PLAIN_BUILDS): Measure {
  const results: { label: string; m: Measure }[] = [];
  for (const a of builds) {
    const user = hunter(a, rank, 'user'), tank = foe(hunter('tank', rank, 'tank'));
    for (const ability of user.row.abilities) {
      // a channel, and a use with a price (Violence spends Pain it holds none of here), are not single uses on a fresh body
      if (ability.channel || ability.prices || !ability.effect || (ability.effect.type !== 'physical' && ability.effect.type !== 'magical')) continue;
      const gap = ability.range <= 1 ? 1 : 4;
      const rows = [{ ...user.row, place: place(5, 5) }, { ...tank.row, place: place(5, 5 + gap) }];
      const ctx = { rules: RULES };
      let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('use'), rows, openings: [] }, ctx).fight;
      f = reduce(f, { type: 'start', openings: [{ id: rows[0]!.id, d20: 20, tie: 2 }, { id: rows[1]!.id, d20: 1, tie: 1 }] }, ctx).fight;
      const g = rng(rank.charCodeAt(0) * 1000 + ability.id.length);
      const lost: number[] = [];
      for (let i = 0; i < uses; i++) {
        const running = f as Extract<Fight, { phase: 'running' }>;
        const dice = diceOf(formulaOf(ability, RULES)!).map(d => Array.from({ length: d.count }, () => g.int(1, d.sides)).reduce((x, y) => x + y, 0));
        const aim = ability.aim === 'place' ? running.rows[1]!.place : running.rows[1]!.id;
        const r = reduce(running, { type: 'act', by: running.rows[0]!.id, ability: ability.id, aim, rolls: { dice: { [running.rows[1]!.id]: dice }, react: { [running.rows[1]!.id]: g.int(1, 20) } }, force: true }, ctx);
        if (r.effects.some(e => e.type === 'refused')) throw new Error(`${a} ${ability.id} refused at ${rank}`);
        const after = r.fight!.rows.find(x => x.id === running.rows[1]!.id)!;
        lost.push((rowHp(running.rows[1]!) - rowHp(after)) / running.rows[1]!.sheet.hpMax);
      }
      results.push({ label: `${a} ${ability.id}`, m: avg(lost) });
    }
  }
  const best = results.sort((x, y) => y.m.value - x.m.value)[0]!;
  return { ...best.m, note: `${best.label}; next ${results[1]!.label} ${fmt(results[1]!.m.value)}` };
}

// ── the rows ──
type Row = { name: string; setup: string; runs: number; measure: () => Measure; low: number; high: number; lever: string };
const RUNS = { even: 400, tenth: 150, quarter: 300, twentieth: 100, mythic: 600 } as const;
/** The triangle's three sides: who should win, against whom (decision 1). */
const SIDES: readonly (readonly [Archetype, Archetype, string])[] = [
  ['speed', 'cannon', 'the builds, the policies, the blast (wind-up, radius, mana)'],
  ['tank', 'speed', 'the builds, the policies, a flat part of armor, the heavy kit'],
  ['cannon', 'tank', 'the heavy kit\'s resist, penetration'],
];
const triangle = (rank: Rank): Row[] => SIDES.map(([a, b, lever]) => ({
  name: `${a} beats ${b} one on one at ${rank}`, setup: `${a} v ${b} ${rank}`, runs: 2 * RUNS.even,
  measure: () => bothOpenings(a, b, rank, RUNS.even), low: 0.6, high: 0.9, lever,
}));
const atE: Row[] = SIDES.map(([a, b]) => ({
  name: `${a} against ${b} wins 25 to 75% at E`, setup: `${a} v ${b} E`, runs: 2 * RUNS.even,
  measure: () => bothOpenings(a, b, 'E', RUNS.even), low: 0.25, high: 0.75, lever: 'creationPoints',
}));
const partyRows = (rank: Rank): Row[] => [
  { name: `the mixed party clears a same-rank pack in 2 to 5 rounds at ${rank}`, setup: `mixed v pack ${rank}`, runs: RUNS.tenth, measure: () => rounds(`mixed v pack ${rank}`, vsPack(MIXED, rank), RUNS.tenth), low: 2, high: 5, lever: 'kinds.normal' },
  { name: `a hunter dies in at most 1 pack fight in 10 at ${rank}`, setup: `mixed v pack ${rank}`, runs: RUNS.tenth, measure: () => anyDead(`mixed v pack ${rank}`, vsPack(MIXED, rank), RUNS.tenth), low: 0, high: 0.1, lever: 'kinds.normal' },
  { name: `the mixed party beats a same-rank boss in 4 to 8 rounds at ${rank}`, setup: `mixed v boss ${rank}`, runs: RUNS.quarter, measure: () => rounds(`mixed v boss ${rank}`, vsBoss(MIXED, rank), RUNS.quarter), low: 4, high: 8, lever: 'kinds.boss' },
  { name: `a hunter dies in under 1 boss fight in 20 at ${rank}`, setup: `mixed v boss ${rank}`, runs: RUNS.quarter, measure: () => anyDead(`mixed v boss ${rank}`, vsBoss(MIXED, rank), RUNS.quarter), low: 0, high: 0.05, lever: 'kinds.boss' },
  { name: `a boss fight has 1 or 2 staggers at ${rank}`, setup: `mixed v boss ${rank}`, runs: RUNS.quarter, measure: () => avg(runsOf(`mixed v boss ${rank}`, vsBoss(MIXED, rank), RUNS.quarter).map(r => r[0]!.staggers)), low: 1, high: 2, lever: 'kinds.boss.stagger and staggerRegrow' },
  { name: `three speed builds clear a pack that can hurt no faster than the mixed party at ${rank}`, setup: `speed v hurting pack ${rank}`, runs: RUNS.tenth,
    measure: () => ratio(rounds(`speed v hurting pack ${rank}`, vsHurtingPack(['speed', 'speed', 'speed'], rank), RUNS.tenth, true), rounds(`mixed v hurting pack ${rank}`, vsHurtingPack(MIXED, rank), RUNS.tenth, true)), low: 1, high: Infinity, lever: 'cost.quick (the quick share 0.7)' },
  { name: `the speed party's front hunter dies at least twice as often as the mixed party's against a pack that can hurt at ${rank}`, setup: `speed v hurting pack ${rank}`, runs: RUNS.tenth,
    measure: () => ratio(frontDead(`speed v hurting pack ${rank}`, vsHurtingPack(['speed', 'speed', 'speed'], rank), RUNS.tenth, 'speed'), frontDead(`mixed v hurting pack ${rank}`, vsHurtingPack(MIXED, rank), RUNS.tenth, 'tank')), low: 2, high: Infinity, lever: 'cost.quick (the quick share 0.7)' },
];
// ── the kits (kits design 3.2) ──
/** Opponents a kit is weighed against: the triangle's three. */
const TRIANGLE: readonly Archetype[] = ['speed', 'tank', 'cannon'];
const KIT_RUNS = RUNS.even / 2;
/** A kit's share of duels won against `opp` less its plain build's, the mean of the two openings each. */
const kitOverPlain = (kit: KitBuild, opp: Archetype, rank: Rank): Measure => {
  const k = bothOpenings(kit, opp, rank, KIT_RUNS), p = bothOpenings(PLAIN_OF[kit], opp, rank, KIT_RUNS);
  return { value: k.value - p.value, se: Math.sqrt(k.se ** 2 + p.se ** 2), note: `kit ${fmt(k.value)}, plain ${fmt(p.value)}` };
};
const KIT_LEVER: { readonly [K in KitBuild]: string } = { blood: 'kit.examples.blood (share, burst)', mark: 'kit.examples.mark (share, burst)', pain: 'kit.examples.pain (perStack, spendAt)', summoner: 'summonRounds' };
const kitDuels = (rank: Rank): Row[] => (['blood', 'mark', 'pain'] as const).flatMap(kit => TRIANGLE.map((opp): Row => ({
  name: `the ${kit} kit against ${opp} wins within ${RULES.fight.kit.tolerance} of its plain build at ${rank}`, setup: `${kit} v ${opp} ${rank}`, runs: 4 * KIT_RUNS,
  measure: () => kitOverPlain(kit, opp, rank), low: -RULES.fight.kit.tolerance, high: RULES.fight.kit.tolerance, lever: KIT_LEVER[kit],
})));
const BLOOD_PARTY: readonly Archetype[] = ['tank', 'bruiser', 'blood'];
/** Damage to foes per use of one ability of `who` (a threshold it set off counted with it), over every fight of a setup. */
const perUse = (rs: FightRecord[][], who: string, ability: string): number => {
  const t = rs.map(r => r[0]!.tally[who]!);
  return t.reduce((n, x) => n + (x.byAct[ability] ?? 0), 0) / Math.max(1, t.reduce((n, x) => n + (x.acts[ability] ?? 0), 0));
};
const kitRows = (rank: Rank): Row[] => [
  ...kitDuels(rank),
  { name: `a party with the blood kit in place of the cannon beats a same-rank boss in 4 to 8 rounds at ${rank}`, setup: `blood party v boss ${rank}`, runs: RUNS.quarter,
    measure: () => rounds(`blood party v boss ${rank}`, vsBoss(BLOOD_PARTY, rank), RUNS.quarter), low: 4, high: 8, lever: 'kit.scalerStart' },
  { name: `a party with the blood kit in place of the cannon clears a same-rank pack in 2 to 5 rounds at ${rank}`, setup: `blood party v pack ${rank}`, runs: RUNS.tenth,
    measure: () => rounds(`blood party v pack ${rank}`, vsPack(BLOOD_PARTY, rank), RUNS.tenth), low: 2, high: 5, lever: 'kit.scalerStart' },
  { name: `the kits' best single use takes at most 60% of a same-rank tank's HP at ${rank}`, setup: `kits one use ${rank}`, runs: 400,
    measure: () => bestUse(rank, 400, KIT_BUILDS), low: 0, high: 0.6, lever: 'kit.examples' },
];
const KIT_ROWS: readonly Row[] = [
  ...kitRows('C'), ...kitRows('S'),
  { name: 'the mark caster in a pack deals per use at most a blast\'s damage per standard action of time at C', setup: 'mark v pack C', runs: RUNS.tenth,
    measure: () => {
      const mark = runsOf('mark party v pack C', vsPack(['tank', 'bruiser', 'mark'], 'C'), RUNS.tenth), cannon = runsOf('mixed v pack C', vsPack(MIXED, 'C'), RUNS.tenth);
      const stroke = perUse(mark, 'mark', 'disaster-stroke'), blast = perUse(cannon, 'cannon', 'blast') / (RULES.fight.cost.heavy / RULES.fight.cost.standard);
      return { value: stroke / blast, se: 0, note: `a stroke ${fmt(stroke)} (its marks' bursts with it), a blast ${fmt(blast)} a standard action` };
    }, low: 0, high: 1, lever: 'kit.examples.mark.burst' },
  { name: 'a party with a summoner beats a same-rank boss in 4 to 8 rounds, its sprite keeping no side up, at C', setup: 'summoner v boss C', runs: RUNS.quarter,
    measure: () => {
      const m = rounds('summoner v boss C', vsBoss(['tank', 'bruiser', 'summoner'], 'C'), RUNS.quarter);
      return { ...m, note: `${m.note}; ${runsOf('summoner v boss C', vsBoss(['tank', 'bruiser', 'summoner'], 'C'), RUNS.quarter).filter(r => r[0]!.capped).length} capped` };
    }, low: 4, high: 8, lever: 'summonRounds' },
  { name: 'the pain kit\'s Violence in a boss fight at C (measured, no bound)', setup: 'pain v boss C', runs: RUNS.quarter,
    measure: () => {
      const rs = runsOf('pain v boss C', vsBoss(['tank', 'pain', 'cannon'], 'C'), RUNS.quarter);
      return { ...avg(rs.map(r => r[0]!.tally.pain!.acts.violence ?? 0)), note: `${fmt(perUse(rs, 'pain', 'violence'))} a Violence, ${fmt(perUse(rs, 'pain', 'attack'))} a strike` };
    }, low: 0, high: Infinity, lever: 'kit.examples.pain' },
];

// ── wave 2 (kits design 8.10) ──
const W2 = wave2();
/** A hunter of `a` with an extra ability, armed with it when it is a reaction, a worn status, or another policy. */
const withW2 = (s: SimRow, o: { add?: typeof W2.parry; worn?: ReturnType<typeof W2.bowExpert>; policy?: SimRow['policy'] }): SimRow => ({
  row: { ...s.row, abilities: o.add ? [...s.row.abilities, o.add] : s.row.abilities, statuses: o.worn ? [...s.row.statuses, o.worn] : s.row.statuses,
    ...(o.add?.react ? { armed: { ability: o.add.id, on: null, spent: false } } : {}) },
  policy: o.policy ?? s.policy,
});
const duelOf = (key: string, first: (rank: Rank) => SimRow, b: Archetype, rank: Rank, runs: number): Measure => {
  const ms = OPENINGS.map(o => wins(`${key} v ${b} ${rank} ${o}`, (seed: number) => [playFight({ rows: [at(first(rank), START[o][0]), at(foe(hunter(b, rank)), START[o][1])] }, seed)], runs));
  return { value: mean(ms.map(m => m.value)), se: Math.sqrt(ms.reduce((n, m) => n + m.se ** 2, 0)) / ms.length, note: '' };
};
/** A build with a wave 2 block, less its plain build, the mean of the two openings, against `b` at `rank`. */
const overPlain = (key: string, a: Archetype, first: (rank: Rank) => SimRow, b: Archetype, rank: Rank): Measure => {
  const k = duelOf(key, first, b, rank, KIT_RUNS), p = bothOpenings(a, b, rank, KIT_RUNS);
  return { value: k.value - p.value, se: Math.sqrt(k.se ** 2 + p.se ** 2), note: `with it ${fmt(k.value)}, plain ${fmt(p.value)}` };
};
const parrying = (rank: Rank) => withW2(hunter('speed', rank), { add: W2.parry });
const bowExpert = (rank: Rank) => withW2(hunter('speed', rank), { worn: W2.bowExpert() });
/** The mixed party against a boss that holds a damage-taken curse of +100% all fight: the cap of 1.5, which a boss takes in full as any body (the owner, Nov 21). */
const vsCursedBoss = (rank: Rank) => (seed: number): FightRecord[] => {
  const boss = monster(rank, 'brute', 'boss', 'boss');
  return [playFight({ rows: [...party(MIXED, rank), { ...boss, row: { ...boss.row, statuses: [W2.exposed(100)] } }] }, seed)];
};
/** The mixed party whose bruiser holds Surge and Transfer (its turn given to the cannon), against a boss. */
const vsBossTurns = (rank: Rank) => (seed: number): FightRecord[] => {
  const [tank, bruiser, cannon] = party(MIXED, rank), b = withW2(bruiser!, { add: W2.surge, policy: turnsPolicy });
  return [playFight({ rows: [tank!, { ...b, row: { ...b.row, abilities: [...b.row.abilities, W2.transfer] } }, cannon!, monster(rank, 'brute', 'boss', 'boss')] }, seed)];
};
const W2_ROWS: readonly Row[] = [
  ...(['C', 'S'] as const).flatMap(rank => (['tank', 'bruiser'] as const).map((opp): Row => ({
    name: `the speed build with Parry armed all fight against the ${opp} wins within ${RULES.fight.kit.tolerance} of without at ${rank}`, setup: `parry v ${opp} ${rank}`, runs: 4 * KIT_RUNS,
    measure: () => overPlain('parry', 'speed', parrying, opp, rank), low: -RULES.fight.kit.tolerance, high: RULES.fight.kit.tolerance, lever: 'kit.parry',
  }))),
  ...(['C', 'S'] as const).map((rank): Row => ({
    name: `a party beats a same-rank boss that holds a damage-taken curse all fight in 4 to 8 rounds at ${rank}`, setup: `party v cursed boss ${rank}`, runs: RUNS.quarter,
    measure: () => rounds(`party v cursed boss ${rank}`, vsCursedBoss(rank), RUNS.quarter), low: 4, high: 8, lever: 'kit.shareCap and kinds.boss.hp',
  })),
  ...(['C', 'S'] as const).map((rank): Row => ({
    name: `a party with Transfer and an extra action a round beats a same-rank boss in 4 to 8 rounds at ${rank}`, setup: `party with turns v boss ${rank}`, runs: RUNS.quarter,
    measure: () => rounds(`party with turns v boss ${rank}`, vsBossTurns(rank), RUNS.quarter), low: 4, high: 8, lever: 'kit.extraPerRound',
  })),
  ...TRIANGLE.filter(o => o !== 'speed').map((opp): Row => ({
    name: `the speed build with a worn attack edge (Bow Expert) against the ${opp} at C, less without (measured, no bound)`, setup: `bow expert v ${opp} C`, runs: 4 * KIT_RUNS,
    measure: () => overPlain('bow expert', 'speed', bowExpert, opp, 'C'), low: -Infinity, high: Infinity, lever: 'the maker\'s warning (a worn edge is past the tolerance)',
  })),
];

// ── penetration and control against a boss tough by its body (balance plan section 9, rows P1 to P3) ──
/**
 * The fights P1 and P2 read: a same-rank pack of three normal brutes, a same-rank brute boss, and its mirror, a same-rank
 * caster boss with the warded trait, whose thick defence is resist (34 against armor 15 at C and S, where the brute
 * boss holds armor 58 and 69 against resist 8).
 */
type PenFight = 'pack' | 'boss' | 'warded';
const PEN_FOES: { readonly [F in PenFight]: (rank: Rank) => SimRow[] } = {
  pack, boss: rank => [monster(rank, 'brute', 'boss', 'boss')], warded: rank => [monster(rank, 'caster', 'boss', 'boss', RULES, ['warded'])],
};
const PEN_RUNS: { readonly [F in PenFight]: number } = { pack: RUNS.tenth, boss: RUNS.quarter, warded: RUNS.quarter };
/**
 * Each build that spends an item on a penetration, the pair it holds, and the boss P1 reads the pair on: the one whose
 * thick defence the pair counters (the lead's ruling after balance unit 2), the brute for the bruiser's armor and the
 * warded caster for the cannon's magic.
 */
const PAIRS: readonly (readonly [PenBuild, string, PenFight, string])[] = [['bruiser', 'armor', 'boss', 'boss'], ['cannon', 'magic', 'warded', 'warded caster boss']];
/** The mixed party with `who` spending one item of its tier's middle budget `spend`'s way and the other build on its main stat. */
const spendKey = (who: PenBuild, spend: PenSpend, fight: PenFight, rank: Rank): string => `spend ${spend === 'main' ? 'main' : `${who} ${spend}`} v ${fight} ${rank}`;
const spendRuns = (who: PenBuild, spend: PenSpend, fight: PenFight, rank: Rank): FightRecord[][] => runsOf(spendKey(who, spend, fight, rank), (seed: number) => [playFight({
  rows: [hunter('tank', rank), spending('bruiser', rank, who === 'bruiser' ? spend : 'main'), spending('cannon', rank, who === 'cannon' ? spend : 'main'), ...PEN_FOES[fight](rank)],
}, seed)], PEN_RUNS[fight]);
/** The rounds `slow` takes over those `fast` takes, fight by fight on the same seeds (the paired difference and its error). */
const roundsOver = (slow: FightRecord[][], fast: FightRecord[][]): Measure => {
  const d = slow.map((r, i) => r[0]!.rounds - fast[i]![0]!.rounds);
  return { ...avg(d), note: `${fmt(mean(slow.map(r => r[0]!.rounds)))} over ${fmt(mean(fast.map(r => r[0]!.rounds)))} rounds` };
};
/** How much faster the quicker penetration clears than the main stat: the main stat's rounds over the variant's, the larger. */
const fasterThanMain = (who: PenBuild, fight: PenFight, rank: Rank): Measure => {
  const rounds = (spend: PenSpend): Measure => avg(spendRuns(who, spend, fight, rank).map(r => r[0]!.rounds));
  const main = rounds('main'), [pct, flat] = [ratio(main, rounds('percent')), ratio(main, rounds('flat'))];
  return { ...(pct.value >= flat.value ? pct : flat), note: `main over percent ${fmt(pct.value)}, over flat ${fmt(flat.value)}` };
};
/** The mixed party whose tank holds a control (a stun of a round, `abilities().stun`) and uses it (`controlPolicy`), against a boss. */
const vsBossControlled = (rank: Rank) => (seed: number): FightRecord[] => {
  const [tank, bruiser, cannon] = party(MIXED, rank);
  return [playFight({ rows: [{ row: { ...tank!.row, abilities: [...tank!.row.abilities, abilities().stun] }, policy: controlPolicy }, bruiser!, cannon!, monster(rank, 'brute', 'boss', 'boss')] }, seed)];
};
const PEN_LEVER = 'itemBudget.penFoe, fight.penMax, the kinds\' armor and resist';
const PEN_ROWS: readonly Row[] = (['C', 'S'] as const).flatMap(rank => [
  ...PAIRS.flatMap(([who, pair, boss, bossWords]): Row[] => [
    { name: `against a same-rank ${bossWords} the ${who}'s ${pair} penetration clears in fewer rounds as percent than as flat at ${rank}`, setup: spendKey(who, 'flat', boss, rank), runs: 2 * PEN_RUNS[boss],
      measure: () => roundsOver(spendRuns(who, 'flat', boss, rank), spendRuns(who, 'percent', boss, rank)), low: 0, high: Infinity, lever: PEN_LEVER },
    { name: `against a same-rank pack the ${who}'s ${pair} penetration clears in fewer rounds as flat than as percent at ${rank}`, setup: spendKey(who, 'flat', 'pack', rank), runs: 2 * RUNS.tenth,
      measure: () => roundsOver(spendRuns(who, 'percent', 'pack', rank), spendRuns(who, 'flat', 'pack', rank)), low: 0, high: Infinity, lever: PEN_LEVER },
    ...(['pack', 'boss'] as const).map((fight): Row => ({
      name: `neither penetration of the ${who} clears a same-rank ${fight} more than 25% faster than its main stat at ${rank}`, setup: spendKey(who, 'main', fight, rank), runs: 3 * PEN_RUNS[fight],
      measure: () => fasterThanMain(who, fight, rank), low: 0, high: 1.25, lever: PEN_LEVER,
    })),
  ]),
  { name: `the party's control takes 10 to 35% of a same-rank boss's turns, stagger counted apart, at ${rank}`, setup: `control v boss ${rank}`, runs: RUNS.quarter,
    measure: () => {
      const rs = runsOf(`control v boss ${rank}`, vsBossControlled(rank), RUNS.quarter).map(r => r[0]!);
      const stuns = rs.reduce((n, r) => n + (r.tally.tank!.acts.stun ?? 0), 0), held = rs.reduce((n, r) => n + (r.held.boss ?? 0), 0);
      return { ...avg(rs.map(r => (r.held.boss ?? 0) / r.ticks)), note: `${fmt(stuns / rs.length)} stuns a fight, each holding ${fmt(held / stuns / RULES.fight.round)} rounds, ${fmt(mean(rs.map(r => r.rounds)))} rounds` };
    }, low: 0.1, high: 0.35, lever: 'the party\'s control (abilities().stun) and Tenacity' },
]);

/** The mixed party at S against one same-rank mythic of `archetype` (balance plan section 4, row M1). */
const vsMythic = (archetype: MonsterArchetype) => (seed: number): FightRecord[] => [playFight({ rows: [...party(MIXED, 'S'), monster('S', archetype, 'mythic', 'mythic')] }, seed)];
const MONSTER_ARCHETYPES = Object.keys(RULES.fight.archetypes) as MonsterArchetype[];

const ROWS: readonly Row[] = [
  ...triangle('C'), ...triangle('S'), ...atE,
  ...partyRows('C'), ...partyRows('S'),
  ...MONSTER_ARCHETYPES.map((a): Row => ({
    name: `three hunters at S win 5 to 10% of fights against a same-rank ${a} mythic`, setup: `mixed v ${a} mythic S`, runs: RUNS.mythic,
    measure: () => wins(`mixed v ${a} mythic S`, vsMythic(a), RUNS.mythic), low: 0.05, high: 0.1, lever: a === 'brute' ? 'kinds.mythic.hp' : `archetypes.${a} (hp, power)`,
  })),
  { name: 'no build is at its fatigue capacity before the third fight at C', setup: 'dungeon C', runs: RUNS.twentieth,
    measure: () => share(runsOf('dungeon C', dungeon('C'), RUNS.twentieth).map(d => d.slice(0, 2).some(r => Object.values(r.tally).some(t => t.fatigueMax > 0 && t.fatigue >= t.fatigueMax)))), low: 0, high: 0.05, lever: 'fightRest' },
  { name: 'the speed build reaches its fatigue capacity in the third fight at C', setup: 'dungeon C', runs: RUNS.twentieth,
    measure: () => share(runsOf('dungeon C', dungeon('C'), RUNS.twentieth).map(d => { const t = d[2]!.tally.speed!; return t.fatigue >= t.fatigueMax; })), low: 0.5, high: 1, lever: 'fightRest' },
  { name: 'a cannon\'s mana allows 2 or 3 blasts a dungeon at C', setup: 'cannon C', runs: 1,
    measure: () => ({ value: blastsAllowed('C'), se: 0, note: `E ${blastsAllowed('E')}, S ${blastsAllowed('S')}` }), low: 2, high: 3, lever: 'manaBase, manaCap and abilityKinds.blast.mana' },
  { name: 'blasts a careful cannon casts in a dungeon at C (measured, no bound)', setup: 'dungeon C', runs: RUNS.twentieth,
    measure: () => {
      const ds = runsOf('dungeon C', dungeon('C'), RUNS.twentieth);
      const m = avg(ds.map(d => d.reduce((n, r) => n + (r.tally.cannon!.acts.blast ?? 0), 0)));
      return { ...m, note: `mana for another left in ${fmt(share(ds.map(d => d[2]!.tally.cannon!.mana >= RULES.fight.abilityKinds.blast.mana)).value)} of dungeons; it never blasts an ally` };
    }, low: 0, high: Infinity, lever: 'the policy (friendly fire stays)' },
  { name: 'a channel begun while the boss aims at the channeler completes in 10 to 25% of tries at C', setup: 'channel under fire C', runs: RUNS.quarter,
    measure: () => completes('channel under fire C', vsBoss(['bruiser', 'speed', 'cannon'], 'C', 'aimed'), RUNS.quarter, 'aimed'), low: 0.1, high: 0.25, lever: 'holdBase' },
  { name: 'a channel begun while the boss aims elsewhere completes at C (measured, no bound)', setup: 'channel, no taunt C', runs: RUNS.quarter,
    measure: () => completes('channel, no taunt C', vsBoss(['bruiser', 'speed', 'cannon'], 'C', 'safe'), RUNS.quarter, 'elsewhere'), low: 0, high: 1, lever: 'the threat table' },
  { name: 'a channel behind a taunting tank completes in over half of boss fights at C', setup: 'channel, taunt C', runs: RUNS.even,
    measure: () => completes('channel, taunt C', vsBoss(['tank', 'bruiser', 'cannon'], 'C', 'safe'), RUNS.even), low: 0.5, high: 1, lever: 'holdBase' },
  ...(['E', 'C', 'S'] as const).map((rank): Row => ({
    name: `the best single use takes at most 60% of a same-rank tank's HP at ${rank}`, setup: `one use ${rank}`, runs: 400,
    measure: () => bestUse(rank, 400), low: 0, high: 0.6, lever: 'cost.heavy (the heavy share 1.5) and critSizeCap',
  })),
  { name: 'a status build against a tank at C (measured, no bound)', setup: 'status v tank C', runs: RUNS.even, measure: () => wins('status v tank C', duel('status', 'tank', 'C'), RUNS.even), low: 0, high: 1, lever: 'per-round damage skips armor and resist (notes-u4)' },
  ...KIT_ROWS,
  ...W2_ROWS,
  ...PEN_ROWS,
];

/**
 * The rows outside their bound, with the value measured: each stays `todo` until a change in RULES.fight brings it inside
 * (docs/agent-handoff/rw/sim-log.md says why each misses). The rule calls are the lead's. None today: P3 came inside when
 * a stun began to add its length to the turn (sim-log.md, balance unit 6).
 */
const OPEN: Readonly<Record<string, string>> = {};

// ── one test per row: the row is measured inside its test, so a bun timeout or the per-test times name the row ──
const inside = (r: Row, m: Measure): boolean => m.value >= r.low && m.value <= r.high;
const edge = (r: Row, m: Measure): string => inside(r, m) && Math.min(m.value - r.low, r.high - m.value) < m.se ? ' near' : '';
/**
 * A compute budget for one row, not a wait: no test asserts a time. Rows that share a `setup` share its fights (`cache`),
 * so the first row of a setup pays for them and the rest read them back. Measured Nov 19 on the 4-core box, run alone:
 * the 74 rows take 100.6 s together (the file was 95 s of module load before the measuring moved here), the slowest row
 * 4.0 s, the median about 1.3 s. Inside the whole unit run the slowest row took 5.4 s in one process and 4.2 s with four
 * workers (scripts/ci.ts), three runs each. The budget is 30 s, over five times the slowest, so only a row that stops
 * ending reaches it, and it names that row.
 */
const BUDGET_MS = 30_000;

describe('the reworked fight holds the bounds of design section 6', () => {
  test('every open row names a row of the table', () => {
    expect(Object.keys(OPEN).filter(name => !ROWS.some(r => r.name === name))).toEqual([]);
  });
  for (const row of ROWS) {
    const open = OPEN[row.name];
    if (open) { test.todo(`${row.name} (${open})`); continue; }
    test(row.name, () => {
      const m = row.measure();
      const bound = `${fmt(row.low)} to ${fmt(row.high)}`;
      console.log(`  ${inside(row, m) ? 'in ' : 'OUT'}${edge(row, m)}  ${row.name}: ${fmt(m.value)} (se ${fmt(m.se)}, ${row.runs} runs), bound ${bound}, lever ${row.lever}${m.note ? `; ${m.note}` : ''}`);
      expect(m.value).toBeGreaterThanOrEqual(row.low);
      expect(m.value).toBeLessThanOrEqual(row.high);
    }, BUDGET_MS);
  }
});

describe('every build and monster plays a fight to its end', () => {
  for (const rank of SIM_RANKS) {
    for (const a of Object.keys(BUILDS) as Archetype[]) {
      test(`a ${a} hunter at ${rank} fights a same-rank elite brute until one side is down`, () => {
        const r = playFight({ rows: [hunter(a, rank), monster(rank, 'brute', 'elite', 'elite')] }, 1);
        expect(r.capped).toBe(false);
        expect(r.winner).not.toBeNull();
      });
    }
    for (const m of Object.keys(MONSTER_ABILITY) as (keyof typeof MONSTER_ABILITY)[]) {
      test(`a normal ${m} at ${rank} fights a same-rank bruiser until one side is down`, () => {
        const r = playFight({ rows: [hunter('bruiser', rank), monster(rank, m, 'normal', m)] }, 2);
        expect(r.capped).toBe(false);
        expect(r.winner).not.toBeNull();
      });
    }
  }
});

// ── what the GM's fudge does to a mythic (notes-8-fudge.md section 4) ──
/**
 * The mixed party at S against a same-rank brute mythic, the hunters weighted +0 to +5 (the table stops at +5, not a
 * bound), 600 fights each from the seeds of row M1. Printed so the GM's question "what does +2 do to a mythic" has a row.
 * Asserted: the win rate does not fall as the weight rises (a higher face is never worse for the hunters), and at 0 it is
 * the ruling's 5 to 10%. A weight moves a d20 by a tenth of its faces at +2, so a step of +1 is 5 points of every hit and
 * crit roll, far over the noise of 600 fights (se 0.011 at p = 0.075).
 */
const FUDGE_STEPS = [0, 1, 2, 3, 4, 5] as const;
const weightedMythic = (n: number) => (seed: number): FightRecord[] => [playFight({
  rows: [...party(MIXED, 'S'), monster('S', 'brute', 'mythic', 'mythic')],
  fudge: { sides: { party: n, foe: 0 }, rows: {}, forced: {} },
}, seed)];

describe('the GM\'s fudge on a party of 3 against a mythic', () => {
  test('the win rate does not fall as the hunters\' weight rises, and at 0 it is 5 to 10%', () => {
    const rates = FUDGE_STEPS.map(n => ({ n, m: wins(`mixed v brute mythic S fudge +${n}`, weightedMythic(n), RUNS.mythic) }));
    console.log(['  hunters  win rate (se)', ...rates.map(({ n, m }) => `  +${n}       ${(100 * m.value).toFixed(1)}% (${(100 * m.se).toFixed(1)})  ${m.note}`)].join('\n'));
    expect(rates[0]!.m.value).toBeGreaterThanOrEqual(0.05);
    expect(rates[0]!.m.value).toBeLessThanOrEqual(0.1);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!.m.value, `+${rates[i]!.n} against +${rates[i - 1]!.n}`).toBeGreaterThanOrEqual(rates[i - 1]!.m.value);
  }, 6 * BUDGET_MS);
});
